package upload

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strings"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/httpx"
	"github.com/vaultbackup/agent/internal/license"
)

func putWebDAV(d config.Destination, localPath string) (string, error) {
	if d.WebDAVURL == "" {
		return "", fmt.Errorf("webdav_url required")
	}
	remote := strings.TrimRight(d.WebDAVURL, "/") + "/" + path.Base(localPath)
	f, err := os.Open(localPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	req, err := http.NewRequest(http.MethodPut, remote, f)
	if err != nil {
		return "", err
	}
	if d.WebDAVUser != "" {
		req.SetBasicAuth(d.WebDAVUser, d.WebDAVPassword)
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("webdav put HTTP %d: %s", resp.StatusCode, string(b))
	}
	return remote, nil
}

func putVault(cfg config.Config, localPath string) (string, error) {
	base := strings.TrimRight(license.ServerURL(), "/")
	if base == "" {
		return "", fmt.Errorf("license server URL not configured")
	}
	if strings.TrimSpace(cfg.License.Token) == "" {
		return "", fmt.Errorf("agent token required for managed (vaultbackup) upload")
	}
	url := base + "/api/agent/upload"
	f, err := os.Open(localPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, url, f)
	if err != nil {
		return "", err
	}
	req.ContentLength = st.Size()
	req.Header.Set("Authorization", "Bearer "+cfg.License.Token)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Content-Length", fmt.Sprintf("%d", st.Size()))
	req.Header.Set("X-Agent-Name", cfg.Name)
	req.Header.Set("X-VaultBackup-Filename", path.Base(localPath))
	ext := path.Base(localPath)
	if i := strings.Index(ext, "."); i >= 0 {
		ext = ext[i+1:]
	}
	if ext == "" {
		ext = "bin.gz"
	}
	req.Header.Set("X-VaultBackup-Ext", ext)
	engine := strings.TrimSpace(cfg.Database.Type)
	if engine == "" {
		engine = "files"
	}
	req.Header.Set("X-VaultBackup-Engine", engine)
	if n := strings.TrimSpace(cfg.Name); n != "" {
		req.Header.Set("X-VaultBackup-DB-Name", n)
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("vaultbackup upload HTTP %d: %s", resp.StatusCode, string(b))
	}
	return path.Base(localPath), nil
}
