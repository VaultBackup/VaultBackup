package upload

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
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

const s3PartSize = 8 << 20 // 8 MiB

func putS3(d config.Destination, localPath string) (string, error) {
	if d.S3Bucket == "" {
		return "", fmt.Errorf("s3_bucket required")
	}
	if d.S3AccessKey == "" || d.S3SecretKey == "" {
		return "", fmt.Errorf("s3_access_key and s3_secret_key required")
	}
	key := path.Join(strings.Trim(d.S3Prefix, "/"), path.Base(localPath))
	key = strings.TrimPrefix(key, "/")

	st, err := os.Stat(localPath)
	if err != nil {
		return "", err
	}
	if st.Size() < 64<<20 {
		return key, putS3SingleStream(d, localPath, key)
	}
	return key, putS3Multipart(d, localPath, key, st.Size())
}

func s3HostBucket(d config.Destination) (host, urlStr string, pathStyle bool) {
	host = d.S3Endpoint
	pathStyle = d.S3Endpoint != ""
	if host == "" {
		host = d.S3Bucket + ".s3.amazonaws.com"
		pathStyle = false
	}
	host = strings.TrimPrefix(host, "https://")
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimRight(host, "/")
	if pathStyle {
		urlStr = fmt.Sprintf("https://%s/%s", host, d.S3Bucket)
	} else {
		urlStr = fmt.Sprintf("https://%s", host)
	}
	return host, urlStr, pathStyle
}

func putS3SingleStream(d config.Destination, localPath, key string) error {
	f, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer f.Close()
	st, _ := f.Stat()
	// For signing we need payload hash — stream hash first for files under 64MB is OK via ReadAll alternative:
	// use sized buffer read once into memory only if small; we already branch < 64MB.
	body, err := io.ReadAll(io.LimitReader(f, 64<<20+1))
	if err != nil {
		return err
	}
	if int64(len(body)) != st.Size() && st.Size() <= 64<<20 {
		// ok
	}

	host, base, pathStyle := s3HostBucket(d)
	var u string
	if pathStyle {
		u = base + "/" + key
	} else {
		u = base + "/" + key
	}
	_ = host

	req, err := http.NewRequest(http.MethodPut, u, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	if err := signV4(req, body, d); err != nil {
		return err
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("s3 put HTTP %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

type initiateResult struct {
	UploadID string `xml:"UploadId"`
}

type completePart struct {
	PartNumber int    `xml:"PartNumber"`
	ETag       string `xml:"ETag"`
}

type completeMultipart struct {
	XMLName xml.Name       `xml:"CompleteMultipartUpload"`
	Parts   []completePart `xml:"Part"`
}

func putS3Multipart(d config.Destination, localPath, key string, size int64) error {
	host, base, pathStyle := s3HostBucket(d)
	_ = host
	objURL := base + "/" + key
	if pathStyle {
		objURL = base + "/" + key
	}

	// 1) Initiate
	initURL := objURL + "?uploads"
	req, err := http.NewRequest(http.MethodPost, initURL, nil)
	if err != nil {
		return err
	}
	if err := signV4(req, nil, d); err != nil {
		return err
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return err
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("s3 initiate multipart HTTP %d: %s", resp.StatusCode, string(body))
	}
	var init initiateResult
	if err := xml.Unmarshal(body, &init); err != nil || init.UploadID == "" {
		return fmt.Errorf("s3 initiate: parse upload id: %v (%s)", err, string(body))
	}
	uploadID := init.UploadID

	// 2) Upload parts
	f, err := os.Open(localPath)
	if err != nil {
		_ = abortMultipart(d, objURL, uploadID)
		return err
	}
	defer f.Close()

	var parts []completePart
	partNum := 1
	buf := make([]byte, s3PartSize)
	for {
		n, rerr := io.ReadFull(f, buf)
		if n > 0 {
			chunk := buf[:n]
			etag, err := uploadPart(d, objURL, uploadID, partNum, chunk)
			if err != nil {
				_ = abortMultipart(d, objURL, uploadID)
				return err
			}
			parts = append(parts, completePart{PartNumber: partNum, ETag: etag})
			partNum++
		}
		if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
			break
		}
		if rerr != nil {
			_ = abortMultipart(d, objURL, uploadID)
			return rerr
		}
	}
	if len(parts) == 0 {
		_ = abortMultipart(d, objURL, uploadID)
		return fmt.Errorf("s3 multipart: empty file")
	}

	// 3) Complete
	sort.Slice(parts, func(i, j int) bool { return parts[i].PartNumber < parts[j].PartNumber })
	payload, _ := xml.Marshal(completeMultipart{Parts: parts})
	payload = append([]byte(xml.Header), payload...)
	compURL := objURL + "?uploadId=" + url.QueryEscape(uploadID)
	creq, err := http.NewRequest(http.MethodPost, compURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	creq.Header.Set("Content-Type", "application/xml")
	if err := signV4(creq, payload, d); err != nil {
		return err
	}
	cresp, err := httpx.UploadClient.Do(creq)
	if err != nil {
		return err
	}
	cb, _ := io.ReadAll(io.LimitReader(cresp.Body, 1<<20))
	cresp.Body.Close()
	if cresp.StatusCode >= 300 {
		_ = abortMultipart(d, objURL, uploadID)
		return fmt.Errorf("s3 complete multipart HTTP %d: %s", cresp.StatusCode, string(cb))
	}
	_ = size
	return nil
}

func uploadPart(d config.Destination, objURL, uploadID string, partNumber int, chunk []byte) (string, error) {
	u := fmt.Sprintf("%s?partNumber=%d&uploadId=%s", objURL, partNumber, url.QueryEscape(uploadID))
	req, err := http.NewRequest(http.MethodPut, u, bytes.NewReader(chunk))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	if err := signV4(req, chunk, d); err != nil {
		return "", err
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("s3 upload part %d HTTP %d: %s", partNumber, resp.StatusCode, string(b))
	}
	etag := resp.Header.Get("ETag")
	if etag == "" {
		return "", fmt.Errorf("s3 upload part %d: missing ETag", partNumber)
	}
	return etag, nil
}

func abortMultipart(d config.Destination, objURL, uploadID string) error {
	u := objURL + "?uploadId=" + url.QueryEscape(uploadID)
	req, err := http.NewRequest(http.MethodDelete, u, nil)
	if err != nil {
		return err
	}
	if err := signV4(req, nil, d); err != nil {
		return err
	}
	resp, err := httpx.UploadClient.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func signV4(req *http.Request, payload []byte, d config.Destination) error {
	region := d.S3Region
	if region == "" || region == "auto" {
		region = "us-east-1"
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	if payload == nil {
		payload = []byte{}
	}
	payloadHash := sha256Hex(payload)

	// Ensure URL is absolute and Host set
	if req.URL.Host == "" {
		req.URL.Host = req.Host
	}
	host := req.URL.Host
	if host == "" {
		host = strings.TrimPrefix(strings.TrimPrefix(d.S3Endpoint, "https://"), "http://")
		if host == "" {
			host = d.S3Bucket + ".s3.amazonaws.com"
		}
		req.URL.Host = host
	}

	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("Host", host)

	// Build canonical query (sorted)
	canonQuery := ""
	if req.URL.RawQuery != "" {
		values, _ := url.ParseQuery(req.URL.RawQuery)
		keys := make([]string, 0, len(values))
		for k := range values {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var parts []string
		for _, k := range keys {
			for _, v := range values[k] {
				parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(v))
			}
		}
		canonQuery = strings.Join(parts, "&")
	}

	canonicalHeaders := fmt.Sprintf("host:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n",
		host, payloadHash, amzDate)
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalRequest := strings.Join([]string{
		req.Method,
		req.URL.EscapedPath(),
		canonQuery,
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")

	algorithm := "AWS4-HMAC-SHA256"
	credentialScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, region)
	stringToSign := strings.Join([]string{
		algorithm,
		amzDate,
		credentialScope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	signingKey := s3SigningKey(d.S3SecretKey, dateStamp, region, "s3")
	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	auth := fmt.Sprintf("%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		algorithm, d.S3AccessKey, credentialScope, signedHeaders, signature)
	req.Header.Set("Authorization", auth)
	return nil
}

func s3SigningKey(secret, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte(service))
	return hmacSHA256(kService, []byte("aws4_request"))
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
