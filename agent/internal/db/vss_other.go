//go:build !windows

package db

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// withVSSCopy falls back to a direct copy outside Windows (no VSS).
func withVSSCopy(src, dstDir string) (string, error) {
	src = filepath.Clean(src)
	st, err := os.Stat(src)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dstDir, 0o755); err != nil {
		return "", err
	}
	base := filepath.Base(src)
	dst := filepath.Join(dstDir, base)
	if st.IsDir() {
		return dst, copyDir(src, dst)
	}
	return dst, copyFilePath(src, dst)
}

func copyFilePath(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		return copyFilePath(path, target)
	})
}

func findExeUnderProgramFiles(name string) string {
	return ""
}

func directCopyTree(src, dstDir string, isDir bool) (string, error) {
	base := filepath.Base(src)
	dst := filepath.Join(dstDir, base)
	if isDir {
		return dst, copyDir(src, dst)
	}
	return dst, copyFilePath(src, dst)
}

// Silence unused on non-windows builds that reference helpers indirectly.
var _ = fmt.Errorf
