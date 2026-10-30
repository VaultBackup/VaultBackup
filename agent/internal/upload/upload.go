package upload

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
	case "vaultbackup":
		return putVault(cfg, localPath)
	default:
		return "", fmt.Errorf("unknown destination mode %q", dest.Mode)
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
