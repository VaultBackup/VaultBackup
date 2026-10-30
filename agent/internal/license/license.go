package license

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/fingerprint"
)

const gracePeriod = 72 * time.Hour

// DefaultServerURL is the hardcoded VaultBackup Worker / license server.
// Override at build time with:
//
//	-ldflags "-X github.com/vaultbackup/agent/internal/license.DefaultServerURL=https://..."
//
or at runtime with env VAULTBACKUP_SERVER_URL (staging only).
var DefaultServerURL = "https://api.vaultbackup.com"

// ServerURL returns the effective license/Worker base URL (hardcoded).
func ServerURL() string {
	if v := strings.TrimSpace(os.Getenv("VAULTBACKUP_SERVER_URL")); v != "" {
		return strings.TrimRight(v, "/")
	}
	return strings.TrimRight(DefaultServerURL, "/")
}

var (
	mu          sync.RWMutex
	lastOK      time.Time
	lastReason  string
	lastAllowed bool
	lastPlan    string
	lastAgentID string
)

// Status is the last known license state.
type Status struct {
	OK      bool      `json:"ok"`
	Allowed bool      `json:"allowed"`
	Reason  string    `json:"reason,omitempty"`
	Plan    string    `json:"plan,omitempty"`
	AgentID string    `json:"agentId,omitempty"`
	Checked time.Time `json:"checked,omitempty"`
}

// Check contacts the Worker and updates offline grace.
func Check(cfg config.Config) (Status, error) {
	base := ServerURL()
	if cfg.License.Token == "" {
		return Status{Reason: "missing token"}, fmt.Errorf("license not configured: token required")
	}
	body := map[string]any{
		"token":       cfg.License.Token,
		"fingerprint": fingerprint.Device(),
		"name":        cfg.Name,
		"version":     "1.2.3",
	}
	data, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, base+"/api/agent/license", bytes.NewReader(data))
	if err != nil {
		return offlineStatus(), err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.License.Token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return offlineStatus(), fmt.Errorf("license server unreachable: %w", err)
	}
	defer resp.Body.Close()
	var out struct {
		OK      bool   `json:"ok"`
		Allowed bool   `json:"allowed"`
		Reason  string `json:"reason"`
		Error   string `json:"error"`
		Plan    string `json:"plan"`
		AgentID string `json:"agentId"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	st := Status{
		OK:      out.OK || out.Allowed,
		Allowed: out.OK || out.Allowed,
		Reason:  firstNonEmpty(out.Reason, out.Error),
		Plan:    out.Plan,
		AgentID: out.AgentID,
		Checked: time.Now(),
	}
	mu.Lock()
	if st.Allowed {
		lastOK = time.Now()
		lastAllowed = true
		lastReason = ""
		lastPlan = st.Plan
		lastAgentID = st.AgentID
	} else {
		lastAllowed = false
		lastReason = st.Reason
	}
	mu.Unlock()
	return st, nil
}

// Allowed returns whether backups may run (online OK or within 72h grace).
func Allowed() (bool, string) {
	mu.RLock()
	defer mu.RUnlock()
	if lastAllowed && !lastOK.IsZero() {
		return true, ""
	}
	if !lastOK.IsZero() && time.Since(lastOK) < gracePeriod {
		return true, fmt.Sprintf("license offline grace until %s", lastOK.Add(gracePeriod).Format(time.RFC3339))
	}
	if lastReason != "" {
		return false, lastReason
	}
	return false, "license check needed"
}

// Get returns cached status.
func Get() Status {
	mu.RLock()
	defer mu.RUnlock()
	return Status{
		OK:      lastAllowed,
		Allowed: lastAllowed,
		Reason:  lastReason,
		Plan:    lastPlan,
		AgentID: lastAgentID,
		Checked: lastOK,
	}
}

// ReportStatus posts host + db health to Worker.
func ReportStatus(cfg config.Config, payload any) error {
	return post(cfg, "/api/agent/status", payload)
}

// PushEvent posts a structured backup event.
func PushEvent(cfg config.Config, payload any) error {
	return post(cfg, "/api/agent/events", payload)
}

// PushLog posts log lines.
func PushLog(cfg config.Config, payload any) error {
	return post(cfg, "/api/agent/logs", payload)
}

// PushCritical posts a critical error.
func PushCritical(cfg config.Config, msg string) error {
	return post(cfg, "/api/agent/logs", map[string]any{
		"level":   "critical",
		"message": msg,
		"name":    cfg.Name,
	})
}

// SyncConfig pushes sanitized config to Worker.
func SyncConfig(cfg config.Config) error {
	return post(cfg, "/api/agent/config", config.Sanitized(cfg))
}

func post(cfg config.Config, path string, payload any) error {
	base := ServerURL()
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, base+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.License.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("worker %s HTTP %d", path, resp.StatusCode)
	}
	return nil
}

func offlineStatus() Status {
	mu.RLock()
	defer mu.RUnlock()
	ok, reason := false, "license server unreachable"
	if !lastOK.IsZero() && time.Since(lastOK) < gracePeriod {
		ok = true
		reason = fmt.Sprintf("license offline grace until %s", lastOK.Add(gracePeriod).Format(time.RFC3339))
	}
	return Status{OK: ok, Allowed: ok, Reason: reason, Checked: lastOK}
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
