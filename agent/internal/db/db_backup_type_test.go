package db

import (
	"strings"
	"testing"
)

func TestDumpRejectsUnsupportedIncrementalModes(t *testing.T) {
	for _, mode := range []string{"incremental", "differential"} {
		t.Run(mode, func(t *testing.T) {
			if _, err := DumpWithOptions(t.TempDir(), "sqlite", "missing.db", Options{BackupType: mode}); err == nil || !strings.Contains(err.Error(), "not supported") {
				t.Fatalf("expected explicit unsupported-mode error, got %v", err)
			}
		})
	}
}
