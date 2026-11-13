package retention

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Policy describes tiered retention.
type Policy struct {
	Daily   int
	Weekly  int
	Monthly int
	Yearly  int
	Keep    int
}

// isBackupArtifact returns true for agent backup payloads only (not keys/logs/config).
func isBackupArtifact(name string) bool {
	base := strings.ToLower(filepath.Base(name))
	switch base {
	case "agent.key", "agent.log", "history.json", "config.yaml", "config.json":
		return false
	}
	if strings.HasPrefix(base, "backup-") {
		return true
	}
	for _, suf := range []string{".sql", ".sql.gz", ".dump", ".archive", ".vbenc", ".gz", ".zip", ".bak", ".db.gz"} {
		if strings.HasSuffix(base, suf) {
			return true
		}
	}
	return false
}

// Apply removes old backup artifacts in dir according to the policy (or Keep N).
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
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if !isBackupArtifact(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, item{filepath.Join(dir, e.Name()), info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod.After(files[j].mod) })

	keep := p.Keep
	if keep <= 0 {
		keep = p.Daily + p.Weekly + p.Monthly + p.Yearly
	}
	if keep <= 0 {
		return nil
	}
	for i := keep; i < len(files); i++ {
		_ = os.Remove(files[i].path)
	}
	return nil
}
