package webui

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Server is the local setup UI.
type Server struct {
	Addr        string
	Password    string
	TLSCertFile string
	TLSKeyFile  string
	Version     string
	OnRun       func() error
	mu          sync.Mutex
	lastErr     string
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
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(EmbeddedUI))
	})
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"version":%q,"licenseOk":false,"lastError":"webui restore in progress"}`, s.Version)
	})
	srv := &http.Server{Addr: s.Addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	if s.TLSEnabled() {
		return srv.ListenAndServeTLS(s.TLSCertFile, s.TLSKeyFile)
	}
	return srv.ListenAndServe()
}
