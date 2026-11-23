package crypto

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestDecryptFileWritesPrivateOutput(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "plain")
	encrypted := filepath.Join(dir, "encrypted")
	restored := filepath.Join(dir, "restored")
	plain := []byte("backup contents must remain private")
	key := bytes.Repeat([]byte{0x42}, 32)

	if err := os.WriteFile(src, plain, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := EncryptFile(src, encrypted, key); err != nil {
		t.Fatal(err)
	}
	if err := DecryptFile(encrypted, restored, key); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(restored)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, plain) {
		t.Fatalf("restored contents = %q, want %q", got, plain)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(restored)
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != 0o600 {
			t.Fatalf("restored file permissions = %04o, want 0600", got)
		}
	}
}

func TestLoadOrCreateKeyDoesNotReplaceDamagedKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.key")
	original := []byte("broken")
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreateKey(path); err == nil {
		t.Fatal("expected damaged existing key to be rejected")
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, original) {
		t.Fatalf("damaged key was changed: %q", got)
	}
}
