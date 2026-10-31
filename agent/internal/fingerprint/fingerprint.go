package fingerprint

import (
	"crypto/sha256"
	"fmt"
	"os"
	"runtime"
	"strings"
)

// Device returns a stable device fingerprint for license binding.
func Device() string {
	parts := []string{
		runtime.GOOS,
		runtime.GOARCH,
		hostname(),
		machineID(),
	}
	h := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return fmt.Sprintf("%x", h[:16])
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	return h
}

func machineID() string {
	// Best-effort cross-platform machine id
	candidates := []string{
		"/etc/machine-id",
		"/var/lib/dbus/machine-id",
		"/sys/class/dmi/id/product_uuid",
	}
	for _, p := range candidates {
		if b, err := os.ReadFile(p); err == nil {
			s := strings.TrimSpace(string(b))
			if s != "" {
				return s
			}
		}
	}
	// Windows / fallback: hostname only
	return hostname()
}
