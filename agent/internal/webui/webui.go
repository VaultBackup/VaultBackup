package webui
import (
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/crypto"
	"github.com/vaultbackup/agent/internal/db"
	"github.com/vaultbackup/agent/internal/health"
	"github.com/vaultbackup/agent/internal/history"
	"github.com/vaultbackup/agent/internal/license"
	"github.com/vaultbackup/agent/internal/secure"
	"github.com/vaultbackup/agent/internal/sysinfo"
	"github.com/vaultbackup/agent/internal/update"
	"github.com/vaultbackup/agent/internal/upload"
)

//go:embed assets/icon.ico assets/icon.png assets/favicon-32.png
var staticAssets embed.FS

type Server struct {
	Addr        string
	Password    string
	TLSCertFile string
	TLSKeyFile  string
	Version     string
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
	mux.HandleFunc("/api/test-dest", s.handleTestDest)
	mux.HandleFunc("/api/terms", s.handleTerms)
	mux.HandleFunc("/api/capabilities", s.handleCapabilities)
	mux.HandleFunc("/api/backups", s.handleBackups)
	mux.HandleFunc("/api/backups/get", s.handleBackupGet)
	mux.HandleFunc("/api/backups/delete", s.handleBackupDelete)
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
