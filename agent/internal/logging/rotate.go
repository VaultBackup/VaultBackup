package logging

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Rotator is a simple size-based log rotator.
type Rotator struct {
	path    string
	maxSize int64
	mu      sync.Mutex
	f       *os.File
}

func NewRotator(path string, maxSizeMB int) (*Rotator, error) {
	if maxSizeMB <= 0 {
		maxSizeMB = 10
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	r := &Rotator{path: path, maxSize: int64(maxSizeMB) * 1024 * 1024}
	if err := r.open(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *Rotator) open() error {
	f, err := os.OpenFile(r.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	r.f = f
	return nil
}

func (r *Rotator) Write(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f == nil {
		if err := r.open(); err != nil {
			return 0, err
		}
	}
	st, err := r.f.Stat()
	if err == nil && st.Size()+int64(len(p)) > r.maxSize {
		_ = r.f.Close()
		rotated := fmt.Sprintf("%s.%s", r.path, time.Now().UTC().Format("20060102-150405"))
		_ = os.Rename(r.path, rotated)
		if err := r.open(); err != nil {
			return 0, err
		}
	}
	return r.f.Write(p)
}

func (r *Rotator) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.f != nil {
		err := r.f.Close()
		r.f = nil
		return err
	}
	return nil
}

var _ io.Writer = (*Rotator)(nil)
