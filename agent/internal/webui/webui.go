package webui

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
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
	"github.com/vaultbackup/agent/internal/secure"
	"github.com/vaultbackup/agent/internal/sysinfo"
)

// Server is the local setup UI.
type Server struct {
	Addr        string
	Password    string
	TLSCertFile string
	TLSKeyFile  string
	OnRun       func() error
	mu          sync.Mutex
	lastErr     string
	authMu      sync.Mutex
	authFails   int
	authBlock   time.Time
}

func New(addr, password string) *Server {
	return &Server{Addr: addr, Password: password}
}

func (s *Server) WithTLS(certFile, keyFile string) *Server {
	s.TLSCertFile = strings.TrimSpace(certFile)
	s.TLSKeyFile = strings.TrimSpace(keyFile)
	return s
}

func (s *Server) TLSEnabled() bool {
	return s.TLSCertFile != "" && s.TLSKeyFile != ""
}

func (s *Server) Scheme() string {
	if s.TLSEnabled() {
		return "https"
	}
	return "http"
}

func (s *Server) Start() error {
	if err := s.validateBind(); err != nil {
		return err
	}
	if err := s.validateTLS(); err != nil {
		return err
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/test-license", s.handleTestLicense)
	mux.HandleFunc("/api/run-once", s.handleRunOnce)
	mux.HandleFunc("/api/history", s.handleHistory)
	mux.HandleFunc("/api/logs", s.handleLogs)
	mux.HandleFunc("/api/tools", s.handleTools)
	mux.HandleFunc("/api/test-db", s.handleTestDB)
	mux.HandleFunc("/favicon.ico", s.handleFavicon)
	mux.HandleFunc("/icon.png", s.handleIconPNG)
	mux.HandleFunc("/icon.ico", s.handleFavicon)

	srv := &http.Server{
		Addr:              s.Addr,
		Handler:           s.secureHeaders(s.authMiddleware(mux)),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	if s.TLSEnabled() {
		return srv.ListenAndServeTLS(s.TLSCertFile, s.TLSKeyFile)
	}
	return srv.ListenAndServe()
}

func (s *Server) validateTLS() error {
	cert := strings.TrimSpace(s.TLSCertFile)
	key := strings.TrimSpace(s.TLSKeyFile)
	if cert == "" && key == "" {
		return nil
	}
	if cert == "" || key == "" {
		return fmt.Errorf("web UI TLS requires both cert and key (got cert=%q key=%q)", cert, key)
	}
	if _, err := os.Stat(cert); err != nil {
		return fmt.Errorf("web UI TLS cert: %w", err)
	}
	if _, err := os.Stat(key); err != nil {
		return fmt.Errorf("web UI TLS key: %w", err)
	}
	_ = os.Chmod(key, 0o600)
	return nil
}

func (s *Server) validateBind() error {
	host, _, err := net.SplitHostPort(s.Addr)
	if err != nil {
		host = s.Addr
		if strings.HasPrefix(host, ":") {
			host = "0.0.0.0"
		}
	}
	needPass := host == "" || host == "0.0.0.0" || host == "::" || host == "[::]"
	ip := net.ParseIP(strings.Trim(host, "[]"))
	if ip != nil && !ip.IsLoopback() {
		needPass = true
	}
	if needPass {
		pw := strings.TrimSpace(s.Password)
		if pw == "" {
			return fmt.Errorf("web UI bound to %s requires -webui-password or WEBUI_PASSWORD (refusing open bind)", s.Addr)
		}
		if len(pw) < 8 {
			return fmt.Errorf("web UI password must be at least 8 characters when binding beyond loopback")
		}
	}
	return nil
}

func (s *Server) secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
		if r.Method == http.MethodPost || r.Method == http.MethodPut {
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodDelete {
			if origin := r.Header.Get("Origin"); origin != "" {
				if !originAllowed(origin, r.Host) {
					http.Error(w, "origin not allowed", http.StatusForbidden)
					return
				}
			}
		}
		if s.Password == "" {
			next.ServeHTTP(w, r)
			return
		}
		s.authMu.Lock()
		blocked := time.Now().Before(s.authBlock)
		s.authMu.Unlock()
		if blocked {
			http.Error(w, "too many failed attempts; try later", http.StatusTooManyRequests)
			return
		}
		okAuth := false
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-UI-Password")), []byte(s.Password)) == 1 {
			okAuth = true
		}
		if !okAuth {
			u, p, ok := r.BasicAuth()
			if ok {
				if subtle.ConstantTimeCompare([]byte(p), []byte(s.Password)) == 1 ||
					subtle.ConstantTimeCompare([]byte(u), []byte(s.Password)) == 1 {
					okAuth = true
				}
			}
		}
		if okAuth {
			s.authMu.Lock()
			s.authFails = 0
			s.authMu.Unlock()
			next.ServeHTTP(w, r)
			return
		}
		s.authMu.Lock()
		s.authFails++
		if s.authFails >= 8 {
			s.authBlock = time.Now().Add(30 * time.Second)
			s.authFails = 0
		}
		s.authMu.Unlock()
		w.Header().Set("WWW-Authenticate", `Basic realm="VaultBackup Agent"`)
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
	})
}

func originAllowed(origin, host string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "null" {
		return true
	}
	if strings.HasSuffix(origin, "://"+host) || strings.HasSuffix(origin, "://"+host+"/") {
		return true
	}
	lo := strings.ToLower(origin)
	if strings.Contains(lo, "://127.0.0.1") || strings.Contains(lo, "://localhost") || strings.Contains(lo, "://[::1]") {
		h := strings.ToLower(host)
		if strings.HasPrefix(h, "127.0.0.1") || strings.HasPrefix(h, "localhost") || strings.HasPrefix(h, "[::1]") || strings.HasPrefix(h, "::1") {
			return true
		}
	}
	return false
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
		"font-src 'none'",
		"connect-src 'self'",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'",
		"object-src 'none'",
	}, "; ")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", csp)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
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
			"started": e.Started.Format(time.RFC3339), "status": e.Status, "size": e.SizeBytes,
			"message": e.Message, "error": e.Error, "path": e.Path, "type": e.Type, "duration": e.Duration,
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
	writeJSON(w, map[string]any{"log": secure.RedactText(string(data))})
}

func (s *Server) handleTools(w http.ResponseWriter, r *http.Request) {
	cfg := config.Get()
	db := health.ProbeDB(cfg)
	writeJSON(w, map[string]any{"tools": db.Tools, "detail": db.Detail})
}

// handleTestDB probes a candidate DB type + URI without saving config.
func (s *Server) handleTestDB(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "method not allowed")
		return
	}
	var body struct {
		Type string `json:"type"`
		URI  string `json:"uri"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	body.Type = strings.TrimSpace(body.Type)
	body.URI = strings.TrimSpace(body.URI)
	if body.Type == "" {
		writeErr(w, 400, "database type is required")
		return
	}
	if body.URI == "" {
		writeErr(w, 400, "connection URI is required")
		return
	}
	res := health.ProbeURI(body.Type, body.URI)
	writeJSON(w, map[string]any{
		"ok":        res.OK,
		"status":    res.Status,
		"latencyMs": res.LatencyMs,
		"detail":    res.Detail,
		"tools":     res.Tools,
		"type":      body.Type,
	})
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
	// License server URL is hardcoded — never accept client overrides.
	cfg.License.ServerURL = license.ServerURL()
	if lic, ok := body["license"].(map[string]any); ok {
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
		if v, ok := db["use_vss"].(bool); ok {
			cfg.Database.UseVSS = v
		}
		if v, ok := db["prefer_native_tools"].(bool); ok {
			cfg.Database.PreferNativeTools = v
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
	return strings.Contains(s, "***")
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

func (s *Server) handleFavicon(w http.ResponseWriter, r *http.Request) {
	if len(faviconBytes) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(faviconBytes)
}

func (s *Server) handleIconPNG(w http.ResponseWriter, r *http.Request) {
	if len(iconPNGBytes) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(iconPNGBytes)
}
