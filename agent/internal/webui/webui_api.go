package webui

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/health"
	"github.com/vaultbackup/agent/internal/upload"
)

func (s *Server) handleTools(w http.ResponseWriter, r *http.Request) {
	cfg := config.Get()
	db := health.ProbeDB(cfg)
	writeJSON(w, map[string]any{"tools": db.Tools, "detail": db.Detail})
}

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
	if body.Type == "" || body.URI == "" {
		writeErr(w, 400, "type and uri required")
		return
	}
	res := health.ProbeURI(body.Type, body.URI)
	writeJSON(w, map[string]any{"ok": res.OK, "status": res.Status, "latencyMs": res.LatencyMs, "detail": res.Detail, "tools": res.Tools, "type": body.Type})
}

func (s *Server) handleTerms(w http.ResponseWriter, r *http.Request) {
	cfg := config.Get()
	accepted := cfg.TermsAccepted && cfg.TermsVersion == TermsVersion
	writeJSON(w, map[string]any{"version": TermsVersion, "text": TermsText, "accepted": accepted, "accepted_version": cfg.TermsVersion, "needs_acceptance": !accepted})
}

func (s *Server) handleCapabilities(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleBackups(w http.ResponseWriter, r *http.Request) {
	cfg := config.Get()
	objs, err := upload.List(cfg, "")
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	out := make([]map[string]any, 0, len(objs))
	for _, o := range objs {
		out = append(out, map[string]any{"key": o.Key, "size": o.Size, "modTime": o.ModTime.Format(time.RFC3339)})
	}
	writeJSON(w, map[string]any{"backups": out, "count": len(out)})
}

func (s *Server) handleBackupGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "method not allowed")
		return
	}
	var body struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Key) == "" {
		writeErr(w, 400, "key required")
		return
	}
	cfg := config.Get()
	tmp := "./data/restore-" + strings.ReplaceAll(body.Key, "/", "_")
	if err := upload.Get(cfg, body.Key, tmp); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]any{"ok": true, "path": tmp})
}

func (s *Server) handleBackupDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		writeErr(w, 405, "method not allowed")
		return
	}
	var body struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Key) == "" {
		writeErr(w, 400, "key required")
		return
	}
	cfg := config.Get()
	if err := upload.Delete(cfg, body.Key); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleTestDest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, 405, "method not allowed")
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "invalid json")
		return
	}
	d := config.Destination{}
	str := func(k string) string {
		if v, ok := body[k].(string); ok {
			return strings.TrimSpace(v)
		}
		return ""
	}
	d.Mode = str("mode")
	if d.Mode == "" {
		d.Mode = "local"
	}
	d.LocalDir = str("local_dir")
	d.S3Endpoint = str("s3_endpoint")
	d.S3Region = str("s3_region")
	d.S3Bucket = str("s3_bucket")
	d.S3Prefix = str("s3_prefix")
	d.S3AccessKey = str("s3_access_key")
	d.S3SecretKey = str("s3_secret_key")
	d.AzureAccount = str("azure_account")
	d.AzureContainer = str("azure_container")
	d.AzureKey = str("azure_key")
	d.AzurePrefix = str("azure_prefix")
	d.AzureEndpoint = str("azure_endpoint")
	d.WebDAVURL = str("webdav_url")
	d.WebDAVUser = str("webdav_user")
	d.WebDAVPassword = str("webdav_password")
	d.SFTPHost = str("sftp_host")
	d.SFTPUser = str("sftp_user")
	d.SFTPPassword = str("sftp_password")
	d.SFTPKeyFile = str("sftp_key_file")
	d.SFTPPath = str("sftp_path")
	if v, ok := body["sftp_insecure"].(bool); ok {
		d.SFTPInsecure = v
	}
	saved := config.Get().Destination
	if d.S3SecretKey == "" || containsMask(d.S3SecretKey) {
		d.S3SecretKey = saved.S3SecretKey
	}
	if d.AzureKey == "" || containsMask(d.AzureKey) {
		d.AzureKey = saved.AzureKey
	}
	if d.WebDAVPassword == "" || containsMask(d.WebDAVPassword) {
		d.WebDAVPassword = saved.WebDAVPassword
	}
	if d.SFTPPassword == "" || containsMask(d.SFTPPassword) {
		d.SFTPPassword = saved.SFTPPassword
	}
	if d.S3AccessKey == "" {
		d.S3AccessKey = saved.S3AccessKey
	}
	res := upload.ProbeDestination(d)
	writeJSON(w, map[string]any{"ok": res.OK, "status": res.Status, "latencyMs": res.LatencyMs, "detail": res.Detail, "mode": res.Mode})
}

func (s *Server) handleFavicon(w http.ResponseWriter, r *http.Request) {
	if len(faviconBytes) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/x-icon")
	_, _ = w.Write(faviconBytes)
}

func (s *Server) handleIconPNG(w http.ResponseWriter, r *http.Request) {
	if len(iconPNGBytes) == 0 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	_, _ = w.Write(iconPNGBytes)
}
