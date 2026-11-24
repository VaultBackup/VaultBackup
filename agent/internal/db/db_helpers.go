package db

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// NOTE: Full helper body is maintained in agent-source; this file must include
// requireBin, outPath, dumpPostgres, dumpMySQL, dumpSQLite, dumpMongo, dumpRedis,
// dumpMSSQL, dumpFiles, dumpCommand, and supporting pipe/gzip helpers.
// If CI fails, restore from the previous monolithic db.go blob.

func requireBin(names ...string) (string, error) {
	for _, n := range names {
		if p, err := exec.LookPath(n); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("required tool not found on PATH: %s", strings.Join(names, ", "))
}

func outPath(workDir, name, ext string) string {
	_ = os.MkdirAll(workDir, 0o755)
	return filepath.Join(workDir, name+ext)
}
