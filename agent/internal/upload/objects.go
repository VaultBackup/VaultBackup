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

func listS3(d config.Destination, prefix string) ([]Object, error) {
	if d.S3Bucket == "" {
		return nil, fmt.Errorf("s3_bucket required")
	}
	host, base, pathStyle := s3HostBucket(d)
	p := strings.Trim(d.S3Prefix, "/")
	if prefix != "" {
		if p != "" {
			p = p + "/" + strings.TrimPrefix(prefix, "/")
		} else {
			p = strings.TrimPrefix(prefix, "/")
		}
	}
	var listURL string
	if pathStyle {
		listURL = fmt.Sprintf("%s?list-type=2&max-keys=1000", base)
	} else {
		listURL = fmt.Sprintf("%s/?list-type=2&max-keys=1000", base)
	}
	if p != "" {
		listURL += "&prefix=" + strings.ReplaceAll(p, " ", "%20")
	}
	req, err := http.NewRequest(http.MethodGet, listURL, nil)
	if err != nil {
		return nil, err
	}
	req.Host = host
	if err := signV4(req, nil, d); err != nil {
		return nil, err
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("s3 list HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return parseS3List(string(body)), nil
}

func parseS3List(xmlBody string) []Object {
	var out []Object
	rest := xmlBody
	for {
		i := strings.Index(rest, "<Contents>")
		if i < 0 {
			break
		}
		rest = rest[i+len("<Contents>"):]
		j := strings.Index(rest, "</Contents>")
		if j < 0 {
			break
		}
		block := rest[:j]
		rest = rest[j+len("</Contents>"):]
		key := xmlTag(block, "Key")
		sizeStr := xmlTag(block, "Size")
		modStr := xmlTag(block, "LastModified")
		var size int64
		fmt.Sscan(sizeStr, &size)
		mod, _ := time.Parse(time.RFC3339, modStr)
		if key != "" {
			out = append(out, Object{Key: key, Size: size, ModTime: mod})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ModTime.After(out[j].ModTime) })
	return out
}

func xmlTag(block, tag string) string {
	open := "<" + tag + ">"
	close := "</" + tag + ">"
	i := strings.Index(block, open)
	if i < 0 {
		return ""
	}
	block = block[i+len(open):]
	j := strings.Index(block, close)
	if j < 0 {
		return ""
	}
	return block[:j]
}

func getS3(d config.Destination, key, localPath string) error {
	host, base, _ := s3HostBucket(d)
	key = strings.TrimPrefix(key, "/")
	u := base + "/" + key
	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return err
	}
	req.Host = host
	if err := signV4(req, nil, d); err != nil {
		return err
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("s3 get HTTP %d: %s", resp.StatusCode, string(b))
	}
	return writeResponseToFile(resp.Body, localPath)
}

func deleteS3(d config.Destination, key string) error {
	host, base, _ := s3HostBucket(d)
	key = strings.TrimPrefix(key, "/")
	u := base + "/" + key
	req, err := http.NewRequest(http.MethodDelete, u, nil)
	if err != nil {
		return err
	}
	req.Host = host
	if err := signV4(req, nil, d); err != nil {
		return err
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode != 404 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("s3 delete HTTP %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func listAzure(d config.Destination, prefix string) ([]Object, error) {
	return nil, fmt.Errorf("azure list: use full objects.go restore")
}

func getAzure(d config.Destination, key, localPath string) error {
	return fmt.Errorf("azure get: use full objects.go restore")
}

func deleteAzure(d config.Destination, key string) error {
	return fmt.Errorf("azure delete: use full objects.go restore")
}

func listWebDAV(d config.Destination, prefix string) ([]Object, error) {
	return nil, fmt.Errorf("webdav list: use full objects.go restore")
}

func getWebDAV(d config.Destination, key, localPath string) error {
	return fmt.Errorf("webdav get: use full objects.go restore")
}

func deleteWebDAV(d config.Destination, key string) error {
	return fmt.Errorf("webdav delete: use full objects.go restore")
}

func listSFTP(d config.Destination, prefix string) ([]Object, error) {
	sc, closer, err := sftpConnect(d)
	if err != nil {
		return nil, err
	}
	defer closer()
	remoteDir := strings.TrimSpace(d.SFTPPath)
	if remoteDir == "" {
		remoteDir = "."
	}
	entries, err := sc.ReadDir(remoteDir)
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
		out = append(out, Object{Key: path.Join(remoteDir, name), Size: e.Size(), ModTime: e.ModTime()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ModTime.After(out[j].ModTime) })
	return out, nil
}

func getSFTP(d config.Destination, key, localPath string) error {
	sc, closer, err := sftpConnect(d)
	if err != nil {
		return err
	}
	defer closer()
	remote := key
	if !strings.Contains(key, "/") {
		base := strings.TrimSpace(d.SFTPPath)
		if base == "" {
			base = "."
		}
		remote = path.Join(base, key)
	}
	src, err := sc.Open(remote)
	if err != nil {
		return err
	}
	defer src.Close()
	return writeResponseToFile(src, localPath)
}

func deleteSFTP(d config.Destination, key string) error {
	sc, closer, err := sftpConnect(d)
	if err != nil {
		return err
	}
	defer closer()
	remote := key
	if !strings.Contains(key, "/") {
		base := strings.TrimSpace(d.SFTPPath)
		if base == "" {
			base = "."
		}
		remote = path.Join(base, key)
	}
	return sc.Remove(remote)
}

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

func writeResponseToFile(r io.Reader, localPath string) error {
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return err
	}
	f, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		return err
	}
	return f.Close()
}
