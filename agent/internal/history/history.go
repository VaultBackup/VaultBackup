package history

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Entry is one backup run record.
type Entry struct {
	Started   time.Time `json:"started"`
	Finished  time.Time `json:"finished,omitempty"`
	Status    string    `json:"status"` // ok | failed | running
	Type      string    `json:"type,omitempty"`
	SizeBytes int64     `json:"sizeBytes,omitempty"`
	Path      string    `json:"path,omitempty"`
	Message   string    `json:"message,omitempty"`
	Error     string    `json:"error,omitempty"`
	Code      string    `json:"code,omitempty"` // stable errcode, e.g. DISK_FULL
	Duration  string    `json:"duration,omitempty"`
}

var (
	mu   sync.Mutex
	file string
	max  = 100
)

// Init sets the history file under workDir.
func Init(workDir string) {
	_ = os.MkdirAll(workDir, 0o755)
	file = filepath.Join(workDir, "history.json")
}

// Append adds an entry and trims to max.
func Append(e Entry) error {
	mu.Lock()
	defer mu.Unlock()
	list, _ := load()
	list = append([]Entry{e}, list...)
	if len(list) > max {
		list = list[:max]
	}
	return save(list)
}

// Complete replaces a matching "running" entry (same Started) with the final
// status, or appends if none is found. Prevents orphan "running" rows.
func Complete(started time.Time, e Entry) error {
	mu.Lock()
	defer mu.Unlock()
	list, _ := load()
	if e.Finished.IsZero() {
		e.Finished = time.Now()
	}
	for i := range list {
		if list[i].Status == "running" && almostSameTime(list[i].Started, started) {
			list[i] = e
			return save(list)
		}
	}
	// Fallback: newest running entry of same type
	for i := range list {
		if list[i].Status == "running" && (e.Type == "" || list[i].Type == e.Type) {
			list[i] = e
			return save(list)
		}
	}
	list = append([]Entry{e}, list...)
	if len(list) > max {
		list = list[:max]
	}
	return save(list)
}

func almostSameTime(a, b time.Time) bool {
	if a.Equal(b) {
		return true
	}
	d := a.Sub(b)
	if d < 0 {
		d = -d
	}
	return d < time.Second
}

// List returns the most recent entries (stale "running" older than 6h are marked failed).
func List(limit int) []Entry {
	mu.Lock()
	defer mu.Unlock()
	list, _ := load()
	changed := false
	cutoff := time.Now().Add(-6 * time.Hour)
	for i := range list {
		if list[i].Status == "running" && list[i].Started.Before(cutoff) {
			list[i].Status = "failed"
			list[i].Finished = list[i].Started
			if list[i].Error == "" {
				list[i].Error = "stale running entry (agent restarted or crashed)"
			}
			if list[i].Code == "" {
				list[i].Code = "UNKNOWN"
			}
			changed = true
		}
	}
	if changed {
		_ = save(list)
	}
	if limit > 0 && len(list) > limit {
		return list[:limit]
	}
	return list
}

func load() ([]Entry, error) {
	if file == "" {
		return nil, nil
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, err
	}
	var list []Entry
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, err
	}
	return list, nil
}

func save(list []Entry) error {
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(file, data, 0o600)
}
