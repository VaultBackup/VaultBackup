package upload

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/httpx"
)

const azureBlockThreshold = 64 << 20 // 64 MiB — above this use Put Block list
const azureBlockSize = 8 << 20       // 8 MiB blocks

// putAzure uploads with Shared Key (account key) authentication.
// Large files use Azure block blob staging so uploads are not bound to a single 60m PUT.
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

	st, err := os.Stat(localPath)
	if err != nil {
		return "", err
	}
	if st.Size() >= azureBlockThreshold {
		if err := putAzureBlocks(d, localPath, blobURL, key, st.Size()); err != nil {
			return "", err
		}
		return key, nil
	}

	f, err := os.Open(localPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	req, err := http.NewRequest(http.MethodPut, blobURL, f)
	if err != nil {
		return "", err
	}
	req.ContentLength = st.Size()
	req.Header.Set("x-ms-blob-type", "BlockBlob")
	req.Header.Set("x-ms-version", "2020-10-02")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Content-Length", fmt.Sprintf("%d", st.Size()))

	if err := signAzureSharedKey(req, d.AzureAccount, d.AzureKey, d.AzureContainer, key, st.Size(), nil); err != nil {
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

func putAzureBlocks(d config.Destination, localPath, blobURL, key string, size int64) error {
	f, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer f.Close()

	var blockIDs []string
	buf := make([]byte, azureBlockSize)
	part := 0
	var transferred int64
	reportProgress(0, size)
	for {
		n, rerr := io.ReadFull(f, buf)
		if n > 0 {
			raw := fmt.Sprintf("%08d", part)
			blockID := base64.StdEncoding.EncodeToString([]byte(raw))
			if err := putAzureBlock(d, blobURL, key, blockID, buf[:n]); err != nil {
				return err
			}
			blockIDs = append(blockIDs, blockID)
			part++
			transferred += int64(n)
			reportProgress(transferred, size)
		}
		if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	if len(blockIDs) == 0 {
		return fmt.Errorf("azure block upload: empty file")
	}
	return putAzureBlockList(d, blobURL, key, blockIDs)
}

func putAzureBlock(d config.Destination, blobURL, key, blockID string, chunk []byte) error {
	u := blobURL + "?comp=block&blockid=" + url.QueryEscape(blockID)
	req, err := http.NewRequest(http.MethodPut, u, bytes.NewReader(chunk))
	if err != nil {
		return err
	}
	req.ContentLength = int64(len(chunk))
	req.Header.Set("x-ms-version", "2020-10-02")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Content-Length", fmt.Sprintf("%d", len(chunk)))
	q := map[string]string{"comp": "block", "blockid": blockID}
	if err := signAzureSharedKey(req, d.AzureAccount, d.AzureKey, d.AzureContainer, key, int64(len(chunk)), q); err != nil {
		return err
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("azure put block HTTP %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func putAzureBlockList(d config.Destination, blobURL, key string, blockIDs []string) error {
	var xml strings.Builder
	xml.WriteString(`<?xml version="1.0" encoding="utf-8"?><BlockList>`)
	for _, id := range blockIDs {
		xml.WriteString("<Latest>")
		xml.WriteString(id)
		xml.WriteString("</Latest>")
	}
	xml.WriteString(`</BlockList>`)
	body := xml.String()
	u := blobURL + "?comp=blocklist"
	req, err := http.NewRequest(http.MethodPut, u, strings.NewReader(body))
	if err != nil {
		return err
	}
	req.ContentLength = int64(len(body))
	req.Header.Set("x-ms-version", "2020-10-02")
	req.Header.Set("Content-Type", "application/xml")
	req.Header.Set("Content-Length", fmt.Sprintf("%d", len(body)))
	q := map[string]string{"comp": "blocklist"}
	if err := signAzureSharedKey(req, d.AzureAccount, d.AzureKey, d.AzureContainer, key, int64(len(body)), q); err != nil {
		return err
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("azure put blocklist HTTP %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func escapeAzurePath(p string) string {
	parts := strings.Split(p, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

// signAzureSharedKey applies Authorization: SharedKey for Blob PUT.
// q holds optional query params (comp, blockid) included in CanonicalizedResource.
func signAzureSharedKey(req *http.Request, account, accountKey, container, blobKey string, contentLength int64, q map[string]string) error {
	keyBytes, err := base64.StdEncoding.DecodeString(accountKey)
	if err != nil {
		keyBytes = []byte(accountKey)
	}

	now := time.Now().UTC().Format(http.TimeFormat)
	req.Header.Set("x-ms-date", now)

	cl := fmt.Sprintf("%d", contentLength)
	if contentLength == 0 && req.Method != http.MethodPut {
		cl = ""
	}
	canonicalHeaders := canonicalizeMSHeaders(req.Header)
	canonicalResource := fmt.Sprintf("/%s/%s/%s", account, container, blobKey)
	if len(q) > 0 {
		keys := make([]string, 0, len(q))
		for k := range q {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			canonicalResource += "\n" + strings.ToLower(k) + ":" + q[k]
		}
	}

	stringToSign := strings.Join([]string{
		req.Method,
		"", // Content-Encoding
		"", // Content-Language
		cl, // Content-Length
		"", // Content-MD5
		req.Header.Get("Content-Type"),
		"", // Date (use x-ms-date)
		"", // If-Modified-Since
		"", // If-Match
		"", // If-None-Match
		"", // If-Unmodified-Since
		"", // Range
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
