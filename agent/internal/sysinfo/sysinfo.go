package sysinfo

import (
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
	return h
}
