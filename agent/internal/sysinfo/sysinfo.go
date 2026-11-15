package sysinfo

import (
	"fmt"
	"os"
	"runtime"
)

// Host holds live machine metrics for status reporting.
type Host struct {
	Hostname   string  `json:"hostname"`
	OS         string  `json:"os"`
	Arch       string  `json:"arch"`
	Version    string  `json:"version,omitempty"`
	CPUPercent float64 `json:"cpuPercent"`
	MemUsedMb  float64 `json:"memUsedMb"`
	MemTotalMb float64 `json:"memTotalMb"`
	DiskFreeMb float64 `json:"diskFreeMb,omitempty"`
}

// Snapshot returns current host info (best-effort).
func Snapshot() Host {
	h := Host{
		OS:   runtime.GOOS,
		Arch: runtime.GOARCH,
	}
	if name, err := os.Hostname(); err == nil {
		h.Hostname = name
	}
	h.CPUPercent = cpuPercent()
	used, total := memInfo()
	h.MemUsedMb = used
	h.MemTotalMb = total
	if free, err := FreeBytes("."); err == nil && free > 0 {
		h.DiskFreeMb = float64(free) / (1024 * 1024)
	}
	return h
}

// EnsureWorkSpace checks that dir has at least minFree bytes available.
// Returns a clear error so operators can free disk before a large dump fails mid-run.
func EnsureWorkSpace(dir string, minFree uint64) error {
	if dir == "" {
		dir = "."
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	free, err := FreeBytes(dir)
	if err != nil {
		// Non-fatal on exotic FS — dump may still succeed.
		return nil
	}
	if free < minFree {
		return fmt.Errorf("insufficient free disk on work directory %q: have %.0f MB, need at least %.0f MB (dump + optional encrypt copy)",
			dir, float64(free)/(1024*1024), float64(minFree)/(1024*1024))
	}
	return nil
}
