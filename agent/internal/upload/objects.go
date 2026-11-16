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

// --- Azure / WebDAV / SFTP: full implementations restored from local agent-source ---
// (If transport truncates, re-push from artifacts/agent-source/internal/upload/objects.go)

func listAzure(d config.Destination, prefix string) ([]Object, error) {
	if d.AzureAccount == "" || d.AzureContainer == "" {
		return nil, fmt.Errorf("azure_account and azure_container required")
	}
	endpoint := d.AzureEndpoint
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://%s.blob.core.windows.net", d.AzureAccount)
	}
	endpoint = strings.TrimRight(endpoint, "/")
	p := strings.Trim(d.AzurePrefix, "/")
	if prefix != "" {
		if p != "" {
			p = p + "/" + strings.TrimPrefix(prefix, "/")
		} else {
			p = strings.TrimPrefix(prefix, "/")
		}
	}
	listURL := fmt.Sprintf("%s/%s?restype=container&comp=list", endpoint, d.AzureContainer)
	if p != "" {
		listURL += "&prefix=" + strings.ReplaceAll(p, " ", "%20")
	}
	req, err := http.NewRequest(http.MethodGet, listURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-ms-version", "2020-10-02")
	req.Header.Set("x-ms-date", time.Now().UTC().Format(time.RFC1123))
	if err := signAzureList(req, d.AzureAccount, d.AzureKey, d.AzureContainer); err != nil {
		return nil, err
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("azure list HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return parseAzureList(string(body)), nil
}

func parseAzureList(xmlBody string) []Object {
	var out []Object
	rest := xmlBody
	for {
		i := strings.Index(rest, "<Blob>")
		if i < 0 {
			break
		}
		rest = rest[i+len("<Blob>"):]
		j := strings.Index(rest, "</Blob>")
		if j < 0 {
			break
		}
		block := rest[:j]
		rest = rest[j+len("</Blob>"):]
		key := xmlTag(block, "Name")
		sizeStr := xmlTag(block, "Content-Length")
		if sizeStr == "" {
			sizeStr = xmlTag(block, "ContentLength")
		}
		modStr := xmlTag(block, "Last-Modified")
		if modStr == "" {
			modStr = xmlTag(block, "LastModified")
		}
		var size int64
		fmt.Sscan(sizeStr, &size)
		mod, err := time.Parse(time.RFC1123, modStr)
		if err != nil {
			mod, _ = time.Parse(time.RFC3339, modStr)
		}
		if key != "" {
			out = append(out, Object{Key: key, Size: size, ModTime: mod})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ModTime.After(out[j].ModTime) })
	return out
}

func getAzure(d config.Destination, key, localPath string) error {
	endpoint := d.AzureEndpoint
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://%s.blob.core.windows.net", d.AzureAccount)
	}
	endpoint = strings.TrimRight(endpoint, "/")
	key = strings.TrimPrefix(key, "/")
	blobURL := fmt.Sprintf("%s/%s/%s", endpoint, d.AzureContainer, escapeAzurePath(key))
	req, err := http.NewRequest(http.MethodGet, blobURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("x-ms-version", "2020-10-02")
	req.Header.Set("x-ms-date", time.Now().UTC().Format(http.TimeFormat))
	if err := signAzureSharedKey(req, d.AzureAccount, d.AzureKey, d.AzureContainer, key, 0, nil); err != nil {
		return err
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("azure get HTTP %d: %s", resp.StatusCode, string(b))
	}
	return writeResponseToFile(resp.Body, localPath)
}

func deleteAzure(d config.Destination, key string) error {
	endpoint := d.AzureEndpoint
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://%s.blob.core.windows.net", d.AzureAccount)
	}
	endpoint = strings.TrimRight(endpoint, "/")
	key = strings.TrimPrefix(key, "/")
	blobURL := fmt.Sprintf("%s/%s/%s", endpoint, d.AzureContainer, escapeAzurePath(key))
	req, err := http.NewRequest(http.MethodDelete, blobURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("x-ms-version", "2020-10-02")
	req.Header.Set("x-ms-date", time.Now().UTC().Format(http.TimeFormat))
	if err := signAzureSharedKey(req, d.AzureAccount, d.AzureKey, d.AzureContainer, key, 0, nil); err != nil {
		return err
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode != 404 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("azure delete HTTP %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func listWebDAV(d config.Destination, prefix string) ([]Object, error) {
	if d.WebDAVURL == "" {
		return nil, fmt.Errorf("webdav_url required")
	}
	url := strings.TrimRight(d.WebDAVURL, "/") + "/"
	bodyXML := `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop>
<d:displayname/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/>
</d:prop></d:propfind>`
	req, err := http.NewRequest("PROPFIND", url, strings.NewReader(bodyXML))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Depth", "1")
	req.Header.Set("Content-Type", "application/xml")
	if d.WebDAVUser != "" {
		req.SetBasicAuth(d.WebDAVUser, d.WebDAVPassword)
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("webdav propfind HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var out []Object
	rest := string(body)
	lower := strings.ToLower(rest)
	for {
		ri := strings.Index(lower, "<d:response")
		if ri < 0 {
			ri = strings.Index(lower, "<response")
		}
		if ri < 0 {
			break
		}
		endMarkers := []string{"</d:response>", "</response>"}
		ej := -1
		endLen := 0
		for _, m := range endMarkers {
			if k := strings.Index(lower[ri:], m); k >= 0 {
				if ej < 0 || k < ej {
					ej = k
					endLen = len(m)
				}
			}
		}
		if ej < 0 {
			break
		}
		block := rest[ri : ri+ej+endLen]
		blockLower := lower[ri : ri+ej+endLen]
		rest = rest[ri+ej+endLen:]
		lower = lower[ri+ej+endLen:]
		if strings.Contains(blockLower, "<d:collection") || strings.Contains(blockLower, "<collection") {
			continue
		}
		href := xmlTagAny(block, "href")
		if href == "" {
			continue
		}
		baseName := path.Base(strings.TrimRight(href, "/"))
		if baseName == "" || baseName == "." {
			continue
		}
		if prefix != "" && !strings.HasPrefix(baseName, prefix) {
			continue
		}
		var size int64
		if sz := xmlTagAny(block, "getcontentlength"); sz != "" {
			fmt.Sscanf(sz, "%d", &size)
		}
		var mod time.Time
		if ms := xmlTagAny(block, "getlastmodified"); ms != "" {
			for _, layout := range []string{time.RFC1123, time.RFC1123Z, time.RFC3339} {
				if t, err := time.Parse(layout, ms); err == nil {
					mod = t
					break
				}
			}
		}
		out = append(out, Object{Key: baseName, Size: size, ModTime: mod})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ModTime.After(out[j].ModTime) })
	return out, nil
}

func xmlTagAny(s, local string) string {
	low := strings.ToLower(s)
	candidates := []string{"<" + local + ">", "<d:" + local + ">", "<D:" + local + ">"}
	for _, open := range candidates {
		i := strings.Index(low, strings.ToLower(open))
		if i < 0 {
			continue
		}
		gt := strings.Index(s[i:], ">")
		if gt < 0 {
			continue
		}
		start := i + gt + 1
		closeLow := "</" + strings.ToLower(local)
		restLow := low[start:]
		j := strings.Index(restLow, closeLow)
		if j < 0 {
			j = strings.Index(restLow, "</d:"+strings.ToLower(local))
			if j < 0 {
				j = strings.Index(restLow, "</D:"+strings.ToLower(local))
			}
		}
		if j < 0 {
			continue
		}
		return strings.TrimSpace(s[start : start+j])
	}
	return ""
}

func getWebDAV(d config.Destination, key, localPath string) error {
	remote := strings.TrimRight(d.WebDAVURL, "/") + "/" + path.Base(key)
	req, err := http.NewRequest(http.MethodGet, remote, nil)
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
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("webdav get HTTP %d: %s", resp.StatusCode, string(b))
	}
	return writeResponseToFile(resp.Body, localPath)
}

func deleteWebDAV(d config.Destination, key string) error {
	remote := strings.TrimRight(d.WebDAVURL, "/") + "/" + path.Base(key)
	req, err := http.NewRequest(http.MethodDelete, remote, nil)
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
	if resp.StatusCode >= 300 && resp.StatusCode != 404 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("webdav delete HTTP %d: %s", resp.StatusCode, string(b))
	}
	return nil
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
