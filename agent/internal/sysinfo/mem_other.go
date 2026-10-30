//go:build !linux

package sysinfo

import "runtime"

func memInfo() (usedMb, totalMb float64) {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return float64(m.Alloc) / 1024 / 1024, 0
}

func cpuPercent() float64 { return 0 }
