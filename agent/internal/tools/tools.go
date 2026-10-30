package tools

import "os/exec"

// Find returns the path of the first binary found on PATH.
func Find(names ...string) string {
	for _, n := range names {
		if p, err := exec.LookPath(n); err == nil {
			return p
		}
	}
	return ""
}
