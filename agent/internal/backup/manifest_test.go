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
	path := filepath.Join(dir, "m("m.json") // fix below
}
