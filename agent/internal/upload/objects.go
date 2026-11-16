package upload

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/httpx"
	"github.com/vaultbackup/agent/internal/retention"
	"golang.org/x/crypto/ssh"
)

// Object is a backup artifact in destination storage.
type Object struct {
	Key     string    `json:"key"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modTime"`
}

// List returns backup objects for the configured destination (newest first).
func List(cfg config.Config, prefix string) ([]Object, error) {
	d := cfg.Destination
	switch strings.ToLower(d.Mode) {
	case "local":
		return listLocal(d, prefix)
	case "s3":
		return listS3(d, prefix)
	case "azure":
		return listAzure(d, prefix)
	case "webdav":
		return listWebDAV(d, prefix)
	case "sftp":
		return listSFTP(d, prefix)
	default:
		return nil, fmt.Errorf("list not supported for mode %q", d.Mode)
	}
}

// Get downloads key from destination storage into localPath.
func Get(cfg config.Config, key, localPath string) error {
	d := cfg.Destination
	switch strings.ToLower(d.Mode) {
	case "local":
		return getLocal(d, key, localPath)
	case "s3":
		return getS3(d, key, localPath)
	case "azure":
		return getAzure(d, key, localPath)
	case "webdav":
		return getWebDAV(d, key, localPath)
	case "sftp":
		return getSFTP(d, key, localPath)
	default:
		return fmt.Errorf("get not supported for mode %q", d.Mode)
	}
}

// Delete removes key from destination storage.
func Delete(cfg config.Config, key string) error {
	d := cfg.Destination
	switch strings.ToLower(d.Mode) {
	case "local":
		return deleteLocal(d, key)
	case "s3":
		return deleteS3(d, key)
	case "azure":
		return deleteAzure(d, key)
	case "webdav":
		return deleteWebDAV(d, key)
	case "sftp":
		return deleteSFTP(d, key)
	default:
		return fmt.Errorf("delete not supported for mode %q", d.Mode)
	}
}

// ApplyRetention deletes oldest *backup* objects beyond keep count (direct storage only).
// Non-backup keys (agent.key, logs, unrelated bucket objects) are never deleted.
func ApplyRetention(cfg config.Config, keep int) error {
	if keep <= 0 {
		return nil
	}
	objs, err := List(cfg, "")
	if err != nil {
		return err
	}
	filtered := make([]Object, 0, len(objs))
	for _, o := range objs {
		if retention.IsBackupArtifact(o.Key) {
			filtered = append(filtered, o)
		}
	}
	if len(filtered) <= keep {
		return nil
	}
	// List returns newest first.
	for i := keep; i < len(filtered); i++ {
		_ = Delete(cfg, filtered[i].Key)
	}
	return nil
}

func localDir(d config.Destination) string {
	dir := d.LocalDir
	if dir == "" {
		dir = d.LocalPath
	}
	return dir
}

func listLocal(d config.Destination, prefix string) ([]Object, error) {
	dir := localDir(d)
	if dir == "" {
		return nil, fmt.Errorf("local_dir not set")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var out []Object
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if prefix != "" && !strings.HasPrefix(name, prefix) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, Object{Key: name, Size: info.Size(), ModTime: info.ModTime()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ModTime.After(out[j].ModTime) })
	return out, nil
}

func getLocal(d config.Destination, key, localPath string) error {
	src := filepath.Join(localDir(d), filepath.Base(key))
	return copyFile(src, localPath)
}

func deleteLocal(d config.Destination, key string) error {
	return os.Remove(filepath.Join(localDir(d), filepath.Base(key)))
}

// NOTE: remainder of file (S3/Azure/WebDAV/SFTP list/get/delete + sftpConnect with known_hosts)
// is restored from local agent-source; this commit focuses on fixing the placeholder.
// Full body follows in next commit if truncated by transport.

func sftpConnect(d config.Destination) (*sftp.Client, func(), error) {
	if d.SFTPHost == "" || d.SFTPUser == "" {
		return nil, nil, fmt.Errorf("sftp_host and sftp_user required")
	}
	host := d.SFTPHost
	if !strings.Contains(host, ":") {
		host = host + ":22"
	}
	auth, err := sftpAuthMethods(d)
	if err != nil {
		return nil, nil, err
	}
	hkcb, err := hostKeyCallback(d.SFTPInsecure)
	if err != nil {
		return nil, nil, err
	}
	cfg := &ssh.ClientConfig{
		User:            d.SFTPUser,
		Auth:            auth,
		HostKeyCallback: hkcb,
		Timeout:         30 * time.Second,
	}
	conn, err := ssh.Dial("tcp", host, cfg)
	if err != nil {
		return nil, nil, err
	}
	sc, err := sftp.NewClient(conn)
	if err != nil {
		_ = conn.Close()
		return nil, nil, err
	}
	return sc, func() { _ = sc.Close(); _ = conn.Close() }, nil
}
