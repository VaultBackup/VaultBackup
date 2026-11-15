//go:build !windows

package sysinfo

import (
	"os"
	"path/filepath"
	"syscall"
)

// FreeBytes returns available bytes on the filesystem containing path.
// path may be a file or directory; missing path walks up to an existing parent.
func FreeBytes(path string) (uint64, error) {
	p := path
	if p == "" {
		p = "."
	}
	for {
		var st syscall.Statfs_t
		err := syscall.Statfs(p, &st)
		if err == nil {
			// Prefer free blocks available to non-root (Bavail).
			return st.Bavail * uint64(st.Bsize), nil
		}
		parent := filepath.Dir(p)
		if parent == p {
			return 0, err
		}
		if _, e := os.Stat(p); e == nil {
			return 0, err
		}
		p = parent
	}
}
