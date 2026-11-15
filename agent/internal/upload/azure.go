package upload

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/httpx"
)

// putAzure uploads with Shared Key (account key) authentication.
func putAzure(d config.Destination, localPath string) (string, error) {
	if d.AzureAccount == "" || d.AzureContainer == "" {
		return "", fmt.Errorf("azure_account and azure_container required")
	}
	if d.AzureKey == "" {
		return "", fmt.Errorf("azure_key required for Shared Key auth")
	}
	key := path.Join(strings.Trim(d.AzurePrefix, "/"), path.Base(localPath))
	key = strings.TrimPrefix(key, "/")

	endpoint := d.AzureEndpoint
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://%s.blob.core.windows.net", d.AzureAccount)
	}
	endpoint = strings.TrimRight(endpoint, "/")
	blobURL := fmt.Sprintf("%s/%s/%s", endpoint, d.AzureContainer, escapeAzurePath(key))

	f, err := os.Open(localPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodPut, blobURL, f)
	if err != nil {
		return "", err
	}
	req.ContentLength = st.Size()
	req.Header.Set("x-ms-blob-type", "BlockBlob")
	req.Header.Set("x-ms-version", "2020-10-02")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Content-Length", fmt.Sprintf("%d", st.Size()))

	if err := signAzureSharedKey(req, d.AzureAccount, d.AzureKey, d.AzureContainer, key, st.Size()); err != nil {
		return "", err
	}

	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("azure put HTTP %d: %s", resp.StatusCode, string(b))
	}
	return key, nil
}

func escapeAzurePath(p string) string {
	parts := strings.Split(p, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func signAzureSharedKey(req *http.Request, account, accountKey, container, blobKey string, contentLength int64) error {
	keyBytes, err := base64.StdEncoding.DecodeString(accountKey)
	if err != nil {
		keyBytes = []byte(accountKey)
	}

	now := time.Now().UTC().Format(http.TimeFormat)
	req.Header.Set("x-ms-date", now)

	cl := fmt.Sprintf("%d", contentLength)
	canonicalHeaders := canonicalizeMSHeaders(req.Header)
	canonicalResource := fmt.Sprintf("/%s/%s/%s", account, container, blobKey)

	stringToSign := strings.Join([]string{
		req.Method,
		"", "", cl, "",
		req.Header.Get("Content-Type"),
		"", "", "", "", "", "",
		canonicalHeaders,
		canonicalResource,
	}, "\n")

	mac := hmac.New(sha256.New, keyBytes)
	mac.Write([]byte(stringToSign))
	sig := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	req.Header.Set("Authorization", fmt.Sprintf("SharedKey %s:%s", account, sig))
	return nil
}

func canonicalizeMSHeaders(h http.Header) string {
	type kv struct{ k, v string }
	var list []kv
	for name, vals := range h {
		ln := strings.ToLower(name)
		if !strings.HasPrefix(ln, "x-ms-") {
			continue
		}
		list = append(list, kv{ln, strings.TrimSpace(strings.Join(vals, ","))})
	}
	for i := 1; i < len(list); i++ {
		j := i
		for j > 0 && list[j-1].k > list[j].k {
			list[j-1], list[j] = list[j], list[j-1]
			j--
		}
	}
	var b strings.Builder
	for i, e := range list {
		if i > 0 {
			b.WriteByte('\n')
		}
		b.WriteString(e.k)
		b.WriteByte(':')
		b.WriteString(e.v)
	}
	return b.String()
}
