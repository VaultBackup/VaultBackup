package db

import (
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

// pipeGzip runs cmd and compresses stdout with pure-Go gzip (no external gzip binary).
func pipeGzip(cmd *exec.Cmd, outPath string) (string, error) {
	f, err := os.Create(outPath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	gz := gzip.NewWriter(f)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	var errBuf strings.Builder
	cmd.Stderr = &errBuf
	if err := cmd.Start(); err != nil {
		return "", err
	}
	if _, err := io.Copy(gz, stdout); err != nil {
		_ = cmd.Process.Kill()
		return "", fmt.Errorf("copy: %w: %s", err, errBuf.String())
	}
	if err := cmd.Wait(); err != nil {
		return "", fmt.Errorf("%w: %s", err, errBuf.String())
	}
	if err := gz.Close(); err != nil {
		return "", fmt.Errorf("gzip close: %w", err)
	}
	return outPath, nil
}

// gzipFile compresses src to dst using pure-Go gzip, then removes src.
func gzipFile(src, dst string) (string, error) {
	in, err := os.Open(src)
	if err != nil {
		return "", err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return "", err
	}
	defer out.Close()
	gz := gzip.NewWriter(out)
	if _, err := io.Copy(gz, in); err != nil {
		return "", err
	}
	if err := gz.Close(); err != nil {
		return "", err
	}
	_ = os.Remove(src)
	return dst, nil
}
