package upload

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/vaultbackup/agent/internal/config"
)

func putAzure(d config.Destination, localPath string) (string, error) {
	if d.AzureAccount == "" || d.AzureContainer == "" {
		return "", fmt.Errorf("azure_account and azure_container required")
	}
	key := path.Join(strings.Trim(d.AzurePrefix, "/"), path.Base(localPath))
	key = strings.TrimPrefix(key, "/")
	endpoint := d.AzureEndpoint
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://%s.blob.core.windows.net", d.AzureAccount)
	}
	url := fmt.Sprintf("%s/%s/%s", strings.TrimRight(endpoint, "/"), d.AzureContainer, key)

	f, err := os.Open(localPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	st, _ := f.Stat()

	req, err := http.NewRequest(http.MethodPut, url, f)
	if err != nil {
		return "", err
	}
	req.Header.Set("x-ms-blob-type", "BlockBlob")
	req.Header.Set("x-ms-version", "2020-10-02")
	req.Header.Set("Content-Length", fmt.Sprintf("%d", st.Size()))
	if d.AzureKey != "" {
		req.Header.Set("x-ms-date", time.Now().UTC().Format(http.TimeFormat))
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("azure put HTTP %d: %s", resp.StatusCode, string(b))
	}
	return key, nil
}

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
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("webdav put HTTP %d: %s", resp.StatusCode, string(b))
	}
	return remote, nil
}

func putSFTP(d config.Destination, localPath string) (string, error) {
	return "", fmt.Errorf("sftp destination requires full build with sftp/ssh dependencies")
}

func putVault(cfg config.Config, localPath string) (string, error) {
	base := strings.TrimRight(cfg.License.ServerURL, "/")
	if base == "" {
		return "", fmt.Errorf("license.server_url required for vaultbackup destination")
	}
	url := base + "/api/agent/upload"
	f, err := os.Open(localPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	req, err := http.NewRequest(http.MethodPost, url, f)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.License.Token)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-Agent-Name", cfg.Name)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("vaultbackup upload HTTP %d: %s", resp.StatusCode, string(b))
	}
	return path.Base(localPath), nil
}
