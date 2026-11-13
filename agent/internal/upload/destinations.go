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
)

func putWebDAV(d config.Destination, localPath string) (string, error) {
	if d.WebDAVURL == "" {
		return "", fmt.Errorf("webdav_url required")
	}
	base := strings.TrimRight(d.WebDAVURL, "/")
	// Ensure collection exists (best-effort MKCOL on each segment).
	_ = webdavEnsureCollection(d, base)
	remote := base + "/" + path.Base(localPath)
	f, err := os.Open(localPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	st, _ := f.Stat()
	req, err := http.NewRequest(http.MethodPut, remote, f)
	if err != nil {
		return "", err
	}
	if st != nil {
		req.ContentLength = st.Size()
	}
	req.Header.Set("Content-Type", "application/octet-stream")
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

// webdavEnsureCollection issues MKCOL for the URL (ignores 405/409 already-exists).
func webdavEnsureCollection(d config.Destination, collectionURL string) error {
	req, err := http.NewRequest("MKCOL", strings.TrimRight(collectionURL, "/")+"/", nil)
	if err != nil {
		return err
	}
	if d.WebDAVUser != "" {
		req.SetBasicAuth(d.WebDAVUser, d.WebDAVPassword)
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	// 201 created, 405 method not allowed, 409 conflict — all fine for "exists".
	return nil
}

// putVault is retained only as a hard error — data must never transit the Worker.
func putVault(cfg config.Config, localPath string) (string, error) {
	_ = cfg
	_ = localPath
	return "", fmt.Errorf("managed upload through the control plane is disabled; configure local, s3, azure, webdav, or sftp so backups go directly to your storage")
}
