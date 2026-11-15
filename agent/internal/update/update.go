package update

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Check queries the Worker for a newer version.
func Check(serverURL, current string) (latest string, update bool, err error) {
	if serverURL != "" {
		url := strings.TrimRight(serverURL, "/") + "/api/agent/version"
		client := &http.Client{Timeout: 15 * time.Second}
		resp, err := client.Get(url)
		if err == nil {
			defer resp.Body.Close()
			var v struct {
				Version string `json:"version"`
			}
			if json.NewDecoder(resp.Body).Decode(&v) == nil && v.Version != "" {
				return v.Version, Compare(v.Version, current) > 0, nil
			}
		}
	}
	return current, false, fmt.Errorf("no update channel")
}

// Compare returns 1 if a>b, -1 if a<b, 0 if equal (simple dotted numeric).
func Compare(a, b string) int {
	as := splitVer(a)
	bs := splitVer(b)
	n := len(as)
	if len(bs) > n {
		n = len(bs)
	}
	for i := 0; i < n; i++ {
		var ai, bi int
		if i < len(as) {
			ai = as[i]
		}
		if i < len(bs) {
			bi = bs[i]
		}
		if ai > bi {
			return 1
		}
		if ai < bi {
			return -1
		}
	}
	return 0
}

func splitVer(s string) []int {
	s = strings.TrimPrefix(strings.TrimSpace(s), "v")
	// strip build metadata / prerelease
	if i := strings.IndexAny(s, "-+"); i >= 0 {
		s = s[:i]
	}
	parts := strings.Split(s, ".")
	out := make([]int, 0, len(parts))
	for _, p := range parts {
		var n int
		for _, c := range p {
			if c < '0' || c > '9' {
				break
			}
			n = n*10 + int(c-'0')
		}
		out = append(out, n)
	}
	return out
}

// DownloadURL builds the platform binary URL from the control-plane base.
// Matches Worker routes: /download/linux-amd64, /download/windows-amd64, etc.
func DownloadURL(serverURL string) string {
	base := strings.TrimRight(serverURL, "/")
	if base == "" {
		base = "https://backup.enadoctemp.workers.dev"
	}
	goos, goarch := runtime.GOOS, runtime.GOARCH
	slug := goos + "-" + goarch
	// Worker also publishes MSI separately; self-update always fetches the EXE/binary.
	return base + "/download/" + slug
}

// Apply downloads the latest binary for this platform and replaces the current executable.
// On success the process should exit so the new binary (or service manager) can start.
// Windows: renames the running EXE to .old then writes the new file alongside.
// Unix: writes to a sibling temp file and renames over the current path.
func Apply(serverURL, currentVersion string) (latest string, err error) {
	latest, avail, err := Check(serverURL, currentVersion)
	if err != nil {
		return "", err
	}
	if !avail {
		return latest, fmt.Errorf("already at latest version %s", currentVersion)
	}

	url := DownloadURL(serverURL)
	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return latest, fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return latest, fmt.Errorf("download HTTP %d: %s", resp.StatusCode, string(body))
	}

	exe, err := os.Executable()
	if err != nil {
		return latest, fmt.Errorf("executable path: %w", err)
	}
	exe, err = filepath.EvalSymlinks(exe)
	if err != nil {
		return latest, fmt.Errorf("resolve executable: %w", err)
	}

	dir := filepath.Dir(exe)
	tmp := filepath.Join(dir, ".vaultbackup-agent.new")
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return latest, fmt.Errorf("create temp binary: %w", err)
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		_ = os.Remove(tmp)
		return latest, fmt.Errorf("write binary: %w", err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return latest, err
	}
	_ = os.Chmod(tmp, 0o755)

	if runtime.GOOS == "windows" {
		// Cannot overwrite a running EXE; move it aside first.
		old := exe + ".old"
		_ = os.Remove(old)
		if err := os.Rename(exe, old); err != nil {
			_ = os.Remove(tmp)
			return latest, fmt.Errorf("rename current exe: %w", err)
		}
		if err := os.Rename(tmp, exe); err != nil {
			// Best-effort rollback
			_ = os.Rename(old, exe)
			_ = os.Remove(tmp)
			return latest, fmt.Errorf("install new exe: %w", err)
		}
		return latest, nil
	}

	// Unix: atomic rename over current path.
	if err := os.Rename(tmp, exe); err != nil {
		_ = os.Remove(tmp)
		return latest, fmt.Errorf("replace binary: %w", err)
	}
	return latest, nil
}
