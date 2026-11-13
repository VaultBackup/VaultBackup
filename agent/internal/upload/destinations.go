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

// putVault is retained only as a hard error — data must never transit the Worker.
func putVault(cfg config.Config, localPath string) (string, error) {
	_ = cfg
	_ = localPath
	return "", fmt.Errorf("managed upload through the control plane is disabled; configure local, s3, azure, webdav, or sftp so backups go directly to your storage")
}
