package retention

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Policy describes tiered retention. Each tier keeps the newest backup in
// each of the most recent distinct calendar periods. Keep is an additional
// minimum count retained for compatibility with count-based configurations.
type Policy struct {
	Daily   int
	Weekly  int
	Monthly int
	Yearly  int
	Keep    int
}

// IsBackupArtifact returns true for known backup payload names, not keys,
// logs, configuration, or unrelated objects in a shared destination.
func IsBackupArtifact(name string) bool {
	base := strings.ToLower(filepath.Base(name))
	switch base {
	case "agent.key", "agent.log", "history.json", "config.yaml", "config.json":
		return false
	}
	// The agent names every generated artifact with the backup- prefix.
	// Extension-only matching could delete unrelated archives in shared storage.
	return strings.HasPrefix(base, "backup-")
}

// Apply applies calendar-tier retention to backup artifacts in dir. It never
// removes directories or files that do not look like backup artifacts.
func (p Policy) Apply(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	type item struct {
		path string
		mod  time.Time
	}
	var files []item
	for _, entry := range entries {
		if entry.IsDir() || !IsBackupArtifact(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("stat retention candidate %q: %w", entry.Name(), err)
		}
		files = append(files, item{path: filepath.Join(dir, entry.Name()), mod: info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod.After(files[j].mod) })
	if len(files) == 0 {
		return nil
	}

	keep := make(map[string]struct{})
	// Keep is additive to tiered retention and preserves legacy count-based
	// expectations when a policy mixes both forms.
	count := p.Keep
	if count > len(files) {
		count = len(files)
	}
	for i := 0; i < count; i++ {
		keep[files[i].path] = struct{}{}
	}

	keepNewestPerPeriod(files, keep, p.Daily, func(t time.Time) string {
		return t.Format("2006-01-02")
	})
	keepNewestPerPeriod(files, keep, p.Weekly, func(t time.Time) string {
		year, week := t.ISOWeek()
		return fmt.Sprintf("%04d-W%02d", year, week)
	})
	keepNewestPerPeriod(files, keep, p.Monthly, func(t time.Time) string {
		return t.Format("2006-01")
	})
	keepNewestPerPeriod(files, keep, p.Yearly, func(t time.Time) string {
		return t.Format("2006")
	})

	var failures []string
	for _, file := range files {
		if _, ok := keep[file.path]; ok {
			continue
		}
		if err := os.Remove(file.path); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", file.path, err))
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("retention could not remove %d backup file(s): %s", len(failures), strings.Join(failures, "; "))
	}
	return nil
}

// KeepMask returns a boolean for each input timestamp, preserving the original
// order. It is shared by local and remote retention so both destinations use
// identical tier-selection rules.
func KeepMask(times []time.Time, p Policy) []bool {
	type indexed struct { index int; mod time.Time }
	items := make([]indexed, len(times))
	for i, t := range times { items[i] = indexed{index: i, mod: t} }
	sort.Slice(items, func(i, j int) bool { return items[i].mod.After(items[j].mod) })
	mask := make([]bool, len(times))
	keep := make(map[int]struct{})
	count := p.Keep
	if count > len(items) { count = len(items) }
	for i := 0; i < count; i++ { keep[items[i].index] = struct{}{} }
	mark := func(limit int, key func(time.Time) string) {
		if limit <= 0 { return }
		seen := make(map[string]struct{})
		n := 0
		for _, item := range items {
			k := key(item.mod)
			if _, ok := seen[k]; ok { continue }
			seen[k] = struct{}{}
			keep[item.index] = struct{}{}
			n++
			if n == limit { return }
		}
	}
	mark(p.Daily, func(t time.Time) string { return t.Format("2006-01-02") })
	mark(p.Weekly, func(t time.Time) string { y, w := t.ISOWeek(); return fmt.Sprintf("%04d-W%02d", y, w) })
	mark(p.Monthly, func(t time.Time) string { return t.Format("2006-01") })
	mark(p.Yearly, func(t time.Time) string { return t.Format("2006") })
	for i := range mask { _, mask[i] = keep[i] }
	return mask
}

func keepNewestPerPeriod(files []struct {
	path string
	mod  time.Time
}, keep map[string]struct{}, limit int, period func(time.Time) string) {
	if limit <= 0 {
		return
	}
	seen := make(map[string]struct{})
	retained := 0
	for _, file := range files {
		key := period(file.mod)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		keep[file.path] = struct{}{}
		retained++
		if retained == limit {
			return
		}
	}
}
