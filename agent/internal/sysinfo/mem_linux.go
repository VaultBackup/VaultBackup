//go:build linux

package sysinfo

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

func memInfo() (usedMb, totalMb float64) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	var total, available float64
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		val, _ := strconv.ParseFloat(fields[1], 64) // kB
		switch fields[0] {
		case "MemTotal:":
			total = val / 1024
		case "MemAvailable:":
			available = val / 1024
		}
	}
	if total > 0 {
		return total - available, total
	}
	return 0, 0
}

func cpuPercent() float64 {
	// Lightweight: report 0 if we can't sample; full sampling needs two reads.
	return 0
}
