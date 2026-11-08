package config_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/vaultbackup/agent/internal/config"
)

func TestSaveLoadSealsSecrets(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	keyPath := filepath.Join(dir, "agent.key")

	in := config.Default()
	in.Security.KeyFile = keyPath
	in.License.Token = "super-secret-license-token-abc"
	in.Database.Type = "postgres"
	in.Database.URI = "postgres://user:s3cret@db.example.com:5432/app"
	in.Destination.Mode = "s3"
	in.Destination.S3Bucket = "backups"
	in.Destination.S3AccessKey = "AKIAEXAMPLE"
	in.Destination.S3SecretKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"

	if _, err := config.Load(cfgPath); err != nil {
		t.Fatal(err)
	}
	if err := config.Save(in); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{
		"super-secret-license-token-abc",
		"s3cret",
		"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
	} {
		if containsStr(string(raw), secret) {
			t.Fatalf("plaintext secret found on disk: %s", secret)
		}
	}
	var env map[string]any
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatal(err)
	}
	if int(env["version"].(float64)) < 2 {
		t.Fatalf("expected version>=2 envelope, got %v", env["version"])
	}
	if env["sealed"] == nil || env["sealed"] == "" {
		t.Fatal("missing sealed blob")
	}

	out, err := config.Load(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	if out.License.Token != in.License.Token {
		t.Fatalf("token mismatch: %q", out.License.Token)
	}
	if out.Database.URI != in.Database.URI {
		t.Fatalf("uri mismatch: %q", out.Database.URI)
	}
	if out.Destination.S3SecretKey != in.Destination.S3SecretKey {
		t.Fatalf("s3 secret mismatch")
	}
	if out.Destination.S3AccessKey != in.Destination.S3AccessKey {
		t.Fatalf("s3 access mismatch")
	}
}

func containsStr(hay, needle string) bool {
	return len(needle) == 0 || indexOf(hay, needle) >= 0
}
func indexOf(hay, needle string) int {
	for i := 0; i+len(needle) <= len(hay); i++ {
		if hay[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
