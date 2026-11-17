package webui

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/health"
	"github.com/vaultbackup/agent/internal/history"
	"github.com/vaultbackup/agent/internal/license"
	"github.com/vaultbackup/agent/internal/secure"
	"github.com/vaultbackup/agent/internal/sysinfo"
	"github.com/vaultbackup/agent/internal/update"
	"github.com/vaultbackup/agent/internal/upload"
)

func newCSPNonce() string {
	var b [18]byte
	if _, err := rand.Read(b[:]); err != nil {
		return base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}

func applyCSPNonce(page, nonce string) string {
	reTag := regexp.MustCompile(`(?i)<(script|style)(\s[^>]*)?>`)
	return reTag.ReplaceAllStringFunc(page, func(open string) string {
		lower := strings.ToLower(open)
		if strings.Contains(lower, "nonce=") {
			return open
		}
		if strings.HasSuffix(open, ">") {
			return open[:len(open)-1] + " nonce=\"" + nonce + "\">"
		}
		return open
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func first(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func containsMask(s string) bool {
	return strings.Contains(s, "••••") || strings.Contains(s, "***")
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	nonce := newCSPNonce()
	html := applyCSPNonce(EmbeddedUI, nonce)
	csp := strings.Join([]string{
		"default-src 'none'",
		"script-src 'nonce-" + nonce + "'",
		"style-src 'nonce-" + nonce + "'",
		"img-src 'self' data:",
		"connect-src 'self'",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'",
		"object-src 'none'",
	}, "; ")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", csp)
	_, _ = w.Write([]byte(html))
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cfg := config.Get()
		writeJSON(w, map[string]any{"config": config.Sanitized(cfg)})
	case http.MethodPost:
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		cfg := config.Get()
		applyUIBody(&cfg, body)
		if err := config.Save(cfg); err != nil {
			writeErr(w, 500, "save failed: "+err.Error())
			return
		}
		writeJSON(w, map[string]any{"ok": true, "complete": config.Complete(cfg), "config": config.Sanitized(cfg)})
	default:
		writeErr(w, 405, "method not allowed")
	}
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	cfg := config.Get()
	host := sysinfo.Snapshot()
	db := health.ProbeDB(cfg)
	lic := license.Get()
	ok, reason := license.Allowed()
	s.mu.Lock()
	lastErr := s.lastErr
	s.mu.Unlock()
	out := map[string]any{
		"name": cfg.Name, "version": s.Version, "host": host, "database": db,
		"complete": config.Complete(cfg), "licenseOk": ok && lic.OK,
		"licenseReason": first(reason, lic.Reason), "lastError": lastErr,
	}
	server := cfg.License.ServerURL
	if server == "" {
		server = "https://backup.enadoctemp.workers.dev"
	}
	if s.Version != "" {
		if latest, avail, err := update.Check(server, s.Version); err == nil && avail {
			out["updateAvailable"] = true
			out["latestVersion"] = latest
		}
	}
	writeJSON(w, out)
}

func (s *Server) handleTestLicense(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "method not allowed")
		return
	}
	cfg := config.Get()
	st, err := license.Check(cfg)
	if err != nil && !st.Allowed {
		writeJSON(w, map[string]any{"ok": false, "allowed": false, "error": err.Error(), "reason": st.Reason})
		return
	}
	writeJSON(w, map[string]any{"ok": st.OK, "allowed": st.Allowed, "plan": st.Plan, "agentId": st.AgentID, "reason": st.Reason})
}

func (s *Server) handleRunOnce(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "method not allowed")
		return
	}
	if s.OnRun == nil {
		writeErr(w, 500, "run handler not configured")
		return
	}
	go func() {
		if err := s.OnRun(); err != nil {
			s.mu.Lock()
			s.lastErr = err.Error()
			s.mu.Unlock()
		}
	}()
	writeJSON(w, map[string]any{"message": "Backup started"})
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	list := history.List(50)
	out := make([]map[string]any, 0, len(list))
	for _, e := range list {
		row := map[string]any{
			"started": e.Started.Format(time.RFC3339), "status": e.Status,
			"size": e.SizeBytes, "message": e.Message, "error": e.Error,
			"code": e.Code, "path": e.Path, "type": e.Type, "duration": e.Duration,
		}
		if !e.Finished.IsZero() {
			row["finished"] = e.Finished.Format(time.RFC3339)
		}
		out = append(out, row)
	}
	writeJSON(w, map[string]any{"history": out, "count": len(out)})
}

func (s *Server) handleLogs(w http.ResponseWriter, r *http.Request) {
	cfg := config.Get()
	logPath := cfg.LogFile
	if logPath == "" {
		logPath = "./data/agent.log"
	}
	data, err := os.ReadFile(logPath)
	if err != nil {
		writeJSON(w, map[string]any{"log": "(no log yet)"})
		return
	}
	if len(data) > 32*1024 {
		data = data[len(data)-32*1024:]
	}
	writeJSON(w, map[string]any{"log": secure.RedactText(string(data))})
}
