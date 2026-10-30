package update

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// Check queries the Worker or GitHub for a newer version.
func Check(serverURL, current string) (latest string, update bool, err error) {
	if serverURL != "" {
		url := strings.TrimRight(serverURL, "/") + "/api/agent/version"
		resp, err := http.Get(url)
		if err == nil {
			defer resp.Body.Close()
			var v struct {
				Version string `json:"version"`
			}
			if json.NewDecoder(resp.Body).Decode(&v) == nil && v.Version != "" {
				return v.Version, v.Version != current, nil
			}
		}
	}
	return current, false, fmt.Errorf("no update channel")
}
