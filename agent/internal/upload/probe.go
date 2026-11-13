package upload

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/httpx"
	"golang.org/x/crypto/ssh"
)

// DestResult is a destination connectivity probe result.
type DestResult struct {
	OK        bool   `json:"ok"`
	Status    string `json:"status"`
	LatencyMs int64  `json:"latencyMs,omitempty"`
	Detail    string `json:"detail,omitempty"`
	Mode      string `json:"mode,omitempty"`
}

// ProbeDestination checks that the configured destination is reachable/writable
// without uploading a real backup file. Data-plane only — never the Worker.
func ProbeDestination(d config.Destination) DestResult {
	start := time.Now()
	mode := strings.ToLower(strings.TrimSpace(d.Mode))
	if mode == "" {
		mode = "local"
	}
	var res DestResult
	switch mode {
	case "local":
		res = probeLocal(d.LocalDir)
	case "s3":
		res = probeS3(d)
	case "azure":
		res = probeAzure(d)
	case "webdav":
		res = probeWebDAV(d)
	case "sftp":
		res = probeSFTP(d)
	case "vaultbackup", "managed", "platform":
		res = DestResult{OK: false, Status: "Failed", Detail: "managed control-plane upload is disabled; choose local, s3, azure, webdav, or sftp (agent writes directly to storage; Worker is license-only)"}
	default:
		res = DestResult{OK: false, Status: "Failed", Detail: "unknown destination mode: " + mode}
	}
	if res.LatencyMs == 0 {
		res.LatencyMs = time.Since(start).Milliseconds()
	}
	res.Mode = mode
	return res
}

func probeLocal(dir string) DestResult {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return DestResult{OK: false, Status: "Failed", Detail: "local directory is empty"}
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return DestResult{OK: false, Status: "Unreachable", Detail: "cannot create directory: " + err.Error()}
	}
	name := path.Join(dir, ".vaultbackup-probe-"+fmt.Sprintf("%d", time.Now().UnixNano()))
	if err := os.WriteFile(name, []byte("ok"), 0o600); err != nil {
		return DestResult{OK: false, Status: "Unreachable", Detail: "directory not writable: " + err.Error()}
	}
	_ = os.Remove(name)
	return DestResult{OK: true, Status: "OK", Detail: "directory writable"}
}

func probeS3(d config.Destination) DestResult {
	if d.S3Bucket == "" {
		return DestResult{OK: false, Status: "Failed", Detail: "s3_bucket required"}
	}
	if d.S3AccessKey == "" || d.S3SecretKey == "" {
		return DestResult{OK: false, Status: "Failed", Detail: "s3_access_key and s3_secret_key required"}
	}
	host, base, pathStyle := s3HostBucket(d)
	var listURL string
	if pathStyle {
		listURL = fmt.Sprintf("%s?list-type=2&max-keys=1", base)
	} else {
		listURL = fmt.Sprintf("%s/?list-type=2&max-keys=1", base)
	}
	if p := strings.Trim(d.S3Prefix, "/"); p != "" {
		if pathStyle {
			listURL = fmt.Sprintf("%s?list-type=2&max-keys=1&prefix=%s/", base, p)
		} else {
			listURL = fmt.Sprintf("%s/?list-type=2&max-keys=1&prefix=%s/", base, p)
		}
	}
	start := time.Now()
	req, err := http.NewRequest(http.MethodGet, listURL, nil)
	if err != nil {
		return DestResult{OK: false, Status: "Failed", Detail: err.Error()}
	}
	req.Host = host
	if err := signV4(req, nil, d); err != nil {
		return DestResult{OK: false, Status: "Failed", Detail: "sign: " + err.Error()}
	}
	resp, err := httpx.UploadClient.Do(req)
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return DestResult{OK: false, Status: "Unreachable", LatencyMs: lat, Detail: err.Error()}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	if resp.StatusCode >= 300 {
		return DestResult{OK: false, Status: "Unreachable", LatencyMs: lat,
			Detail: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))}
	}
	return DestResult{OK: true, Status: "OK", LatencyMs: lat, Detail: "bucket list ok"}
}

func probeAzure(d config.Destination) DestResult {
	if d.AzureAccount == "" || d.AzureContainer == "" {
		return DestResult{OK: false, Status: "Failed", Detail: "azure_account and azure_container required"}
	}
	if d.AzureKey == "" {
		return DestResult{OK: false, Status: "Failed", Detail: "azure_key required"}
	}
	endpoint := d.AzureEndpoint
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://%s.blob.core.windows.net", d.AzureAccount)
	}
	endpoint = strings.TrimRight(endpoint, "/")
	listURL := fmt.Sprintf("%s/%s?restype=container&comp=list&maxresults=1", endpoint, d.AzureContainer)
	start := time.Now()
	req, err := http.NewRequest(http.MethodGet, listURL, nil)
	if err != nil {
		return DestResult{OK: false, Status: "Failed", Detail: err.Error()}
	}
	req.Header.Set("x-ms-version", "2020-10-02")
	req.Header.Set("x-ms-date", time.Now().UTC().Format(http.TimeFormat))
	if err := signAzureList(req, d.AzureAccount, d.AzureKey, d.AzureContainer); err != nil {
		return DestResult{OK: false, Status: "Failed", Detail: "sign: " + err.Error()}
	}
	resp, err := httpx.UploadClient.Do(req)
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return DestResult{OK: false, Status: "Unreachable", LatencyMs: lat, Detail: err.Error()}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	if resp.StatusCode >= 300 {
		return DestResult{OK: false, Status: "Unreachable", LatencyMs: lat,
			Detail: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))}
	}
	return DestResult{OK: true, Status: "OK", LatencyMs: lat, Detail: "container list ok"}
}

func signAzureList(req *http.Request, account, accountKey, container string) error {
	keyBytes, err := base64.StdEncoding.DecodeString(accountKey)
	if err != nil {
		keyBytes = []byte(accountKey)
	}
	now := time.Now().UTC().Format(http.TimeFormat)
	req.Header.Set("x-ms-date", now)
	req.Header.Set("x-ms-version", "2020-10-02")
	canonicalHeaders := canonicalizeMSHeaders(req.Header)
	canonicalResource := fmt.Sprintf("/%s/%s\ncomp:list\nmaxresults:1\nrestype:container", account, container)
	stringToSign := strings.Join([]string{
		"GET",
		"", "", "", "", "",
		"",
		"", "", "", "", "",
		canonicalHeaders,
		canonicalResource,
	}, "\n")
	mac := hmac.New(sha256.New, keyBytes)
	mac.Write([]byte(stringToSign))
	sig := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	req.Header.Set("Authorization", fmt.Sprintf("SharedKey %s:%s", account, sig))
	return nil
}

func probeWebDAV(d config.Destination) DestResult {
	if strings.TrimSpace(d.WebDAVURL) == "" {
		return DestResult{OK: false, Status: "Failed", Detail: "webdav_url required"}
	}
	url := strings.TrimRight(d.WebDAVURL, "/") + "/"
	start := time.Now()
	req, err := http.NewRequest("PROPFIND", url, nil)
	if err != nil {
		return DestResult{OK: false, Status: "Failed", Detail: err.Error()}
	}
	req.Header.Set("Depth", "0")
	if d.WebDAVUser != "" {
		req.SetBasicAuth(d.WebDAVUser, d.WebDAVPassword)
	}
	resp, err := httpx.UploadClient.Do(req)
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return DestResult{OK: false, Status: "Unreachable", LatencyMs: lat, Detail: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		return DestResult{OK: false, Status: "Unreachable", LatencyMs: lat, Detail: fmt.Sprintf("auth failed (HTTP %d)", resp.StatusCode)}
	}
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return DestResult{OK: false, Status: "Unreachable", LatencyMs: lat,
			Detail: fmt.Sprintf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))}
	}
	return DestResult{OK: true, Status: "OK", LatencyMs: lat, Detail: "webdav reachable"}
}

func probeSFTP(d config.Destination) DestResult {
	if d.SFTPHost == "" || d.SFTPUser == "" {
		return DestResult{OK: false, Status: "Failed", Detail: "sftp_host and sftp_user required"}
	}
	host := d.SFTPHost
	if !strings.Contains(host, ":") {
		host = host + ":22"
	}
	auth, err := sftpAuthMethods(d)
	if err != nil {
		return DestResult{OK: false, Status: "Failed", Detail: err.Error()}
	}
	insecure := d.SFTPInsecure
	cb := hostKeyCallback(insecure)
	if !insecure {
		cb = ssh.InsecureIgnoreHostKey() //nolint:gosec
	}
	cfg := &ssh.ClientConfig{
		User:            d.SFTPUser,
		Auth:            auth,
		HostKeyCallback: cb,
		Timeout:         8 * time.Second,
	}
	start := time.Now()
	conn, err := ssh.Dial("tcp", host, cfg)
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return DestResult{OK: false, Status: "Unreachable", LatencyMs: lat, Detail: err.Error()}
	}
	defer conn.Close()
	sc, err := sftp.NewClient(conn)
	if err != nil {
		return DestResult{OK: false, Status: "Unreachable", LatencyMs: lat, Detail: "sftp client: " + err.Error()}
	}
	defer sc.Close()
	remoteDir := strings.TrimSpace(d.SFTPPath)
	if remoteDir == "" {
		remoteDir = "."
	}
	if _, err := sc.Stat(remoteDir); err != nil {
		if mkErr := sc.MkdirAll(remoteDir); mkErr != nil {
			return DestResult{OK: false, Status: "Unreachable", LatencyMs: lat,
				Detail: "path not accessible: " + err.Error()}
		}
	}
	detail := "sftp connected"
	if !insecure {
		detail += " (probe used temporary host-key skip; set sftp_insecure=true for production if needed)"
	}
	return DestResult{OK: true, Status: "OK", LatencyMs: lat, Detail: detail}
}
