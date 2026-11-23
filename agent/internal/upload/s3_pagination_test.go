package upload

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/httpx"
)

func TestListS3FollowsContinuationTokens(t *testing.T) {
	var requests int
	var secondToken string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Header.Get("Authorization") == "" {
			t.Error("expected signed S3 request")
		}
		if requests == 1 {
			fmt.Fprint(w, `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>next&amp;token</NextContinuationToken><Contents><Key>backup-1.vbenc</Key><Size>10</Size><LastModified>2026-01-01T00:00:00Z</LastModified></Contents></ListBucketResult>`)
			return
		}
		secondToken = r.URL.Query().Get("continuation-token")
		fmt.Fprint(w, `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>backup-2.vbenc</Key><Size>20</Size><LastModified>2026-01-02T00:00:00Z</LastModified></Contents></ListBucketResult>`)
	}))
	defer server.Close()

	previous := httpx.UploadClient
	httpx.UploadClient = server.Client()
	defer func() { httpx.UploadClient = previous }()

	objects, err := listS3(config.Destination{
		S3Endpoint: server.URL,
		S3Bucket:   "vault",
		S3Region:   "us-east-1",
		S3AccessKey:"access",
		S3SecretKey:"secret",
	}, "")
	if err != nil {
		t.Fatal(err)
	}
	if requests != 2 {
		t.Fatalf("request count = %d, want 2", requests)
	}
	if secondToken != "next&token" {
		t.Fatalf("continuation token = %q", secondToken)
	}
	if len(objects) != 2 {
		t.Fatalf("object count = %d, want 2", len(objects))
	}
	if objects[0].Key != "backup-2.vbenc" || objects[1].Key != "backup-1.vbenc" {
		t.Fatalf("unexpected object order: %#v", objects)
	}
}

func TestListS3RejectsTruncatedPageWithoutToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>`)
	}))
	defer server.Close()

	previous := httpx.UploadClient
	httpx.UploadClient = server.Client()
	defer func() { httpx.UploadClient = previous }()

	_, err := listS3(config.Destination{
		S3Endpoint: server.URL,
		S3Bucket: "vault",
		S3Region: "us-east-1",
		S3AccessKey: "access",
		S3SecretKey: "secret",
	}, "")
	if err == nil {
		t.Fatal("expected error for truncated response without continuation token")
	}
}
