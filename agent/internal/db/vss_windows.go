//go:build windows

package db

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// withVSSCopy copies src (file or directory) to dstDir using a volume shadow copy when possible.
// On failure it falls back to a direct copy. Returns the path of the materialised copy under dstDir.
func withVSSCopy(src, dstDir string) (string, error) {
	src = filepath.Clean(src)
	st, err := os.Stat(src)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dstDir, 0o755); err != nil {
		return "", err
	}

	vol := volumeRoot(src)
	shadow, cleanup, err := createShadow(vol)
	if err != nil {
		// Fall back: direct copy (may fail if file is locked).
		return directCopyTree(src, dstDir, st.IsDir())
	}
	defer cleanup()

	// Map source path onto the shadow device.
	// shadow looks like \\?\GLOBALROOT\Device\HarddiskVolumeShadowCopyN
	rel := strings.TrimPrefix(src, vol)
	rel = strings.TrimPrefix(rel, `\`)
	rel = strings.TrimPrefix(rel, `/`)
	shadowSrc := shadow
	if rel != "" {
		shadowSrc = shadow + `\` + rel
	}

	base := filepath.Base(src)
	dst := filepath.Join(dstDir, base)
	if st.IsDir() {
		if err := copyDir(shadowSrc, dst); err != nil {
			return directCopyTree(src, dstDir, true)
		}
		return dst, nil
	}
	if err := copyFilePath(shadowSrc, dst); err != nil {
		return directCopyTree(src, dstDir, false)
	}
	return dst, nil
}

func volumeRoot(path string) string {
	// C:\foo\bar → C:\
	vol := filepath.VolumeName(path)
	if vol == "" {
		return `C:\`
	}
	return vol + `\`
}

func createShadow(volume string) (shadowPath string, cleanup func(), err error) {
	// Prefer PowerShell Win32_ShadowCopy (works without interactive vssadmin quirks).
	vol := volume
	if !strings.HasSuffix(vol, `\`) {
		vol += `\`
	}
	ps := fmt.Sprintf(
		`$s=(gwmi -List Win32_ShadowCopy).Create('%s','ClientAccessible');`+
			`if($s.ReturnValue -ne 0){exit $s.ReturnValue};`+
			`$id=$s.ShadowID;`+
			`$sc=gwmi Win32_ShadowCopy|?{$_.ID -eq $id};`+
			`Write-Output $sc.DeviceObject;`+
			`Write-Output $id`,
		strings.ReplaceAll(vol, `'`, `''`),
	)
	out, err := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", ps).CombinedOutput()
	if err != nil {
		return "", nil, fmt.Errorf("vss create: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	var device, id string
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		if strings.Contains(ln, "HarddiskVolumeShadowCopy") || strings.Contains(ln, `\\?\GLOBALROOT`) {
			device = strings.TrimRight(ln, `\`)
			continue
		}
		if strings.HasPrefix(ln, "{") {
			id = ln
		}
	}
	if device == "" {
		return "", nil, fmt.Errorf("vss: empty device object from shadow create")
	}
	cleanup = func() {
		if id == "" {
			return
		}
		del := fmt.Sprintf(`$sc=gwmi Win32_ShadowCopy|?{$_.ID -eq '%s'}; if($sc){$sc.Delete()}`, strings.ReplaceAll(id, `'`, `''`))
		_ = exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", del).Run()
	}
	// Brief settle time for the shadow to become readable.
	time.Sleep(300 * time.Millisecond)
	return device, cleanup, nil
}

func directCopyTree(src, dstDir string, isDir bool) (string, error) {
	base := filepath.Base(src)
	dst := filepath.Join(dstDir, base)
	if isDir {
		return dst, copyDir(src, dst)
	}
	return dst, copyFilePath(src, dst)
}

func copyFilePath(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFilePath(path, target)
	})
}

// findExeUnderProgramFiles searches common Program Files trees for name.
func findExeUnderProgramFiles(name string) string {
	roots := []string{
		os.Getenv("ProgramFiles"),
		os.Getenv("ProgramFiles(x86)"),
		`C:\Program Files`,
		`C:\Program Files (x86)`,
	}
	seen := map[string]bool{}
	for _, root := range roots {
		if root == "" || seen[root] {
			continue
		}
		seen[root] = true
		var found string
		_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil || info == nil || info.IsDir() {
				// Skip deep vendor trees after a few levels for speed.
				if info != nil && info.IsDir() {
					depth := strings.Count(strings.TrimPrefix(path, root), string(os.PathSeparator))
					if depth > 4 {
						return filepath.SkipDir
					}
				}
				return nil
			}
			if strings.EqualFold(info.Name(), name) {
				found = path
				return fmt.Errorf("stop")
			}
			return nil
		})
		if found != "" {
			return found
		}
	}
	return ""
}
