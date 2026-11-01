package logging

import (
	"io"
	"log"
	"os"
	"path/filepath"
)

// Setup configures the global logger to write to path with optional max size (MB).
// When the file exceeds maxMB, it is rotated to path.1 (one generation kept).
func Setup(path string, maxMB int) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if maxMB <= 0 {
		maxMB = 20
	}
	rotateIfNeeded(path, maxMB)

	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	// Avoid leaking the previous file handle on re-setup; process lifetime is usually once.
	log.SetOutput(f)
	log.SetFlags(log.LstdFlags | log.LUTC)
	return nil
}

func rotateIfNeeded(path string, maxMB int) {
	st, err := os.Stat(path)
	if err != nil || st.IsDir() {
		return
	}
	limit := int64(maxMB) * 1024 * 1024
	if st.Size() < limit {
		return
	}
	bak := path + ".1"
	_ = os.Remove(bak)
	_ = os.Rename(path, bak)
}

// MaybeRotate checks size and rotates; call periodically from long-running agents.
func MaybeRotate(path string, maxMB int) {
	if path == "" {
		return
	}
	if maxMB <= 0 {
		maxMB = 20
	}
	rotateIfNeeded(path, maxMB)
}

// Multi returns a writer to file + stderr (optional dual log).
func Multi(path string) (io.Writer, error) {
	if path == "" {
		return os.Stderr, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, err
	}
	return io.MultiWriter(f, os.Stderr), nil
}
