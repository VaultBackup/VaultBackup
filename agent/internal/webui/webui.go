package webui

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/health"
	"github.com/vaultbackup/agent/internal/history"
	"github.com/vaultbackup/agent/internal/license"
	"github.com/vaultbackup/agent/internal/sysinfo"
)

// Server is the local setup UI.
type Server struct {
	Addr     string
	Password string
	OnRun    func() error
	mu       sync.Mutex
	lastErr  string
}

// New creates a web UI server.
func New(addr, password string) *Server {
	return &Server{Addr: addr, Password: password}
}

// Start listens and serves. Blocks.
func (s *Server) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/test-license", s.handleTestLicense)
	mux.HandleFunc("/api/run-once", s.handleRunOnce)
	mux.HandleFunc("/api/history", s.handleHistory)
	mux.HandleFunc("/api/logs", s.handleLogs)
	mux.HandleFunc("/api/tools", s.handleTools)

	srv := &http.Server{
		Addr:              s.Addr,
		Handler:           s.authMiddleware(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	return srv.ListenAndServe()
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.Password == "" {
			next.ServeHTTP(w, r)
			return
		}
		if p := r.Header.Get("X-UI-Password"); p == s.Password {
			next.ServeHTTP(w, r)
			return
		}
		u, p, ok := r.BasicAuth()
		if ok && (p == s.Password || u == s.Password) {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("WWW-Authenticate", `Basic realm="VaultBackup Agent"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
	})
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(EmbeddedUI))
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
		writeJSON(w, map[string]any{
			"ok": true, "complete": config.Complete(cfg), "config": config.Sanitized(cfg),
		})
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
	writeJSON(w, map[string]any{
		"host": host, "database": db, "complete": config.Complete(cfg),
		"licenseOk": ok && lic.OK, "licenseReason": first(reason, lic.Reason), "lastError": lastErr,
	})
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
	list := history.List(30)
	out := make([]map[string]any, 0, len(list))
	for _, e := range list {
		out = append(out, map[string]any{
			"started": e.Started.Format(time.RFC3339), "status": e.Status,
			"size": e.SizeBytes, "message": e.Message, "error": e.Error,
			"path": e.Path, "type": e.Type, "duration": e.Duration,
		})
	}
	writeJSON(w, map[string]any{"history": out})
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
	writeJSON(w, map[string]any{"log": string(data)})
}

func (s *Server) handleTools(w http.ResponseWriter, r *http.Request) {
	cfg := config.Get()
	db := health.ProbeDB(cfg)
	writeJSON(w, map[string]any{"tools": db.Tools, "detail": db.Detail})
}

func applyUIBody(cfg *config.Config, body map[string]any) {
	if v, ok := body["name"].(string); ok {
		cfg.Name = strings.TrimSpace(v)
	}
	if v, ok := body["schedule"].(string); ok {
		cfg.Schedule = strings.TrimSpace(v)
	}
	if v, ok := body["retention"].(float64); ok {
		cfg.Retention = int(v)
	}
	if lic, ok := body["license"].(map[string]any); ok {
		if v, ok := lic["server_url"].(string); ok {
			cfg.License.ServerURL = strings.TrimSpace(v)
		}
		if v, ok := lic["token"].(string); ok {
			v = strings.TrimSpace(v)
			if v != "" && !containsMask(v) {
				cfg.License.Token = v
			}
		}
	}
	if sec, ok := body["security"].(map[string]any); ok {
		if v, ok := sec["encrypt"].(bool); ok {
			cfg.Security.Encrypt = v
		}
	}
	if db, ok := body["database"].(map[string]any); ok {
		if v, ok := db["type"].(string); ok {
			cfg.Database.Type = v
		}
		if v, ok := db["uri"].(string); ok {
			cfg.Database.URI = strings.TrimSpace(v)
		}
		if v, ok := db["backup_type"].(string); ok {
			cfg.Database.BackupType = v
		}
	}
	if dest, ok := body["destination"].(map[string]any); ok {
		str := func(k string) string {
			if v, ok := dest[k].(string); ok {
				return strings.TrimSpace(v)
			}
			return ""
		}
		if v := str("mode"); v != "" {
			cfg.Destination.Mode = v
		}
		cfg.Destination.S3Endpoint = str("s3_endpoint")
		cfg.Destination.S3Region = str("s3_region")
		cfg.Destination.S3Bucket = str("s3_bucket")
		cfg.Destination.S3Prefix = str("s3_prefix")
		cfg.Destination.S3AccessKey = str("s3_access_key")
		if sk := str("s3_secret_key"); sk != "" && !containsMask(sk) {
			cfg.Destination.S3SecretKey = sk
		}
		cfg.Destination.LocalDir = str("local_dir")
		cfg.Destination.AzureAccount = str("azure_account")
		cfg.Destination.AzureContainer = str("azure_container")
		cfg.Destination.AzurePrefix = str("azure_prefix")
		cfg.Destination.AzureEndpoint = str("azure_endpoint")
		if ak := str("azure_key"); ak != "" && !containsMask(ak) {
			cfg.Destination.AzureKey = ak
		}
		cfg.Destination.WebDAVURL = str("webdav_url")
		cfg.Destination.WebDAVUser = str("webdav_user")
		if wp := str("webdav_password"); wp != "" && !containsMask(wp) {
			cfg.Destination.WebDAVPassword = wp
		}
		cfg.Destination.SFTPHost = str("sftp_host")
		cfg.Destination.SFTPUser = str("sftp_user")
		cfg.Destination.SFTPKeyFile = str("sftp_key_file")
		cfg.Destination.SFTPPath = str("sftp_path")
		if sp := str("sftp_password"); sp != "" && !containsMask(sp) {
			cfg.Destination.SFTPPassword = sp
		}
	}
}

func containsMask(s string) bool {
	return strings.Contains(s, "••••") || strings.Contains(s, "***")
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

// LocalIPs returns non-loopback IPs (for LAN bind hints).
func LocalIPs() []string {
	var out []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, iface := range ifaces {
		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() {
				continue
			}
			if ip4 := ip.To4(); ip4 != nil {
				out = append(out, ip4.String())
			}
		}
	}
	return out
}
