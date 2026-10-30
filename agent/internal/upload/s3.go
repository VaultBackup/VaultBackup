package upload

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"time"

	"github.com/vaultbackup/agent/internal/config"
)

func putS3(d config.Destination, localPath string) (string, error) {
	if d.S3Bucket == "" {
		return "", fmt.Errorf("s3_bucket required")
	}
	key := path.Join(strings.Trim(d.S3Prefix, "/"), path.Base(localPath))
	key = strings.TrimPrefix(key, "/")

	st, err := os.Stat(localPath)
	if err != nil {
		return "", err
	}
	if st.Size() < 64<<20 {
		return key, putS3Single(d, localPath, key)
	}
	return key, putS3Multipart(d, localPath, key)
}

func putS3Single(d config.Destination, localPath, key string) error {
	body, err := os.ReadFile(localPath)
	if err != nil {
		return err
	}
	host := d.S3Endpoint
	if host == "" {
		host = d.S3Bucket + ".s3.amazonaws.com"
	}
	host = strings.TrimPrefix(host, "https://")
	host = strings.TrimPrefix(host, "http://")
	url := fmt.Sprintf("https://%s/%s/%s", host, d.S3Bucket, key)

	req, err := http.NewRequest(http.MethodPut, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	if err := signV4(req, body, d); err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("s3 put HTTP %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func putS3Multipart(d config.Destination, localPath, key string) error {
	return putS3Single(d, localPath, key)
}

func signV4(req *http.Request, payload []byte, d config.Destination) error {
	region := d.S3Region
	if region == "" || region == "auto" {
		region = "us-east-1"
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	payloadHash := sha256Hex(payload)

	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("Host", req.URL.Host)

	canonicalHeaders := fmt.Sprintf("host:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n",
		req.URL.Host, payloadHash, amzDate)
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalRequest := strings.Join([]string{
		req.Method,
		req.URL.EscapedPath(),
		req.URL.RawQuery,
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
