package retention

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestApplyKeepsNewestPerCalendarTier(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, time.November, 23, 12, 0, 0, 0, time.UTC)
	files := []struct {
		name string
		at   time.Time
	}{
		{"backup-today.sql", now},
		{"backup-yesterday.sql", now.AddDate(0, 0, -1)},
		{"backup-last-week.sql", now.AddDate(0, 0, -8)},
		{"backup-last-month.sql", now.AddDate(0, -1, 0)},
		{"backup-last-year.sql", now.AddDate(-1, 0, 0)},
		{"backup-old.sql", now.AddDate(-3, 0, 0)},
		{"agent.key", now.AddDate(-5, 0, 0)},
		{"notes.txt", now.AddDate(-5, 0, 0)},
	}
	for _, f := range files {
		p := filepath.Join(dir, f.name)
		if err := os.WriteFile(p, []byte("test"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(p, f.at, f.at); err != nil {
			t.Fatal(err)
		}
	}

	policy := Policy{Daily: 2, Weekly: 3, Monthly: 2, Yearly: 2}
	if err := policy.Apply(dir); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{
		"backup-today.sql", "backup-yesterday.sql",
		"backup-last-week.sql", "backup-last-month.sql",
		"backup-last-year.sql", "agent.key", "notes.txt",
	} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("expected %q to be retained: %v", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "backup-old.sql")); !os.IsNotExist(err) {
		t.Errorf("expected old backup to be deleted, stat error = %v", err)
	}
}

func TestApplyKeepCountIsAdditive(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 4; i++ {
		name := filepath.Join(dir, "backup-"+string(rune('a'+i))+".sql")
		if err := os.WriteFile(name, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		at := time.Date(2026, time.January, 1+i, 0, 0, 0, 0, time.UTC)
		if err := os.Chtimes(name, at, at); err != nil {
			t.Fatal(err)
		}
	}
	if err := (Policy{Keep: 2}).Apply(dir); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 retained files, got %d", len(entries))
	}
}
