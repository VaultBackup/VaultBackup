package backup

import (
	"os"
	"path/filepath"
	"testing"
)

func TestManifestRoundTrip(t *testing.T) {
	dir := t.TempDir()
	m := NewManifest("agent-1", "1.3.0", "postgres", "full", "backups/job.sql.gz.vbenc", 1024, true, "s3", "job.sql.gz")
	if m.Kind != KindFull {
		t.Fatalf("kind %s", m.Kind)
	}
	if m.OriginalExt != ".sql.gz" {
		t.Fatalf("ext %s", m.OriginalExt)
	}
	path := filepath.Join(dir, "m.json")
	if err := WriteLocal(path, m); err != nil {
		t.Fatal(err)
	}
	got, err := ReadLocal(path)
	if err != nil {
		t.Fatal(err)
	}
	if got.ObjectKey != m.ObjectKey || got.Engine != "postgres" {
		t.Fatalf("got %+v", got)
	}
}

func TestChainUpdate(t *testing.T) {
	dir := t.TempDir()
	st, err := UpdateChainAfterFull(dir, "mysql", "backups/a.sql.gz", "abc")
	if err != nil {
		t.Fatal(err)
	}
	if st.LastFullKey != "backups/a.sql.gz" || st.Sequence < 1 {
		t.Fatalf("%+v", st)
	}
	st2, err := LoadChain(dir)
	if err != nil {
		t.Fatal(err)
	}
	if st2.LastFullKey != st.LastFullKey {
		t.Fatalf("%+v", st2)
	}
	_ = os.Remove(ChainPath(dir))
}

func TestNormalizeKind(t *testing.T) {
	if NormalizeKind("schema-only") != KindSchema {
		t.Fatal("schema")
	}
	if NormalizeKind("") != KindFull {
		t.Fatal("full")
	}
}
