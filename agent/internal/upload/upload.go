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

// Put writes localPath to the configured destination. Returns remote key/path.
// Data never passes through the control-plane Worker.
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

func sanitize(s string) string {
	s = strings.ReplaceAll(s, "..", "")
	s = strings.ReplaceAll(s, "\\", "/")
	return s
}
