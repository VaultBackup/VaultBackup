package upload

// Package upload writes backup files directly to customer-owned storage
// (local disk, S3-compatible, Azure, WebDAV, SFTP). The control-plane Worker
// is never used as a data plane — only license checks use the Worker.

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/vaultbackup/agent/internal/config"
)

// Put uploads localPath according to destination settings. Returns remote key/path.
func Put(cfg config.Config, localPath string) (string, error) {
	dest := cfg.Destination
	switch strings.ToLower(dest.Mode) {
	case "local":
		return putLocal(dest, localPath)
	case "s3":
		return putS3(dest, localPath)
	case "azure":
		return putAzure(dest, localPath)
	case "webdav":
		return putWebDAV(dest, localPath)
	case "sftp":
		return putSFTP(dest, localPath)
	case "vaultbackup", "managed", "platform":
		// Backups must go directly to customer storage. Worker is license-only.
		return "", fmt.Errorf("managed upload through the control plane is disabled: set destination to local, s3, azure, webdav, or sftp so the agent writes the backup file directly to your storage (Worker is used only for license checks)")
	default:
		return "", fmt.Errorf("unknown destination mode %q (use local, s3, azure, webdav, or sftp)", dest.Mode)
	}
}

func putLocal(d config.Destination, localPath string) (string, error) {
	dir := d.LocalDir
	if dir == "" {
		dir = d.LocalPath
	}
	if dir == "" {
		return "", fmt.Errorf("local_dir not set")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	dst := filepath.Join(dir, filepath.Base(localPath))
	return dst, copyFile(localPath, dst)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	st, _ := in.Stat()
	var total int64
	if st != nil {
		total = st.Size()
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	reportProgress(0, total)
	pr := newProgressReader(in, total)
	if _, err := io.Copy(out, pr); err != nil {
		return err
	}
	reportProgress(total, total)
	return out.Close()
}

func sanitize(s string) string {
	s = strings.ReplaceAll(s, "..", "")
	s = strings.ReplaceAll(s, "\\", "/")
	return s
}
