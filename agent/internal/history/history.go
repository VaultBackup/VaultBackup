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

// List returns the most recent entries.
func List(limit int) []Entry {
	mu.Lock()
	defer mu.Unlock()
	list, _ := load()
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
