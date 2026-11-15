//go:build windows

package sysinfo

import (
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

// FreeBytes returns available bytes on the volume containing path.
func FreeBytes(path string) (uint64, error) {
	p := path
	if p == "" {
		p = "."
	}
	// Resolve to an existing directory for the volume query.
	for {
		if st, err := os.Stat(p); err == nil {
			if !st.IsDir() {
				p = filepath.Dir(p)
			}
			break
		}
		parent := filepath.Dir(p)
		if parent == p {
			break
		}
		p = parent
	}
	p, err := filepath.Abs(p)
	if err != nil {
		return 0, err
	}
	pathPtr, err := syscall.UTF16PtrFromString(p)
	if err != nil {
		return 0, err
	}
	var freeBytesAvailable, totalNumberOfBytes, totalNumberOfFreeBytes uint64
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	getDiskFreeSpaceEx := kernel32.NewProc("GetDiskFreeSpaceExW")
	r1, _, e1 := getDiskFreeSpaceEx.Call(
		uintptr(unsafe.Pointer(pathPtr)),
		uintptr(unsafe.Pointer(&freeBytesAvailable)),
		uintptr(unsafe.Pointer(&totalNumberOfBytes)),
		uintptr(unsafe.Pointer(&totalNumberOfFreeBytes)),
	)
	if r1 == 0 {
		if e1 != nil {
			return 0, e1
		}
		return 0, syscall.EINVAL
	}
	return freeBytesAvailable, nil
}
