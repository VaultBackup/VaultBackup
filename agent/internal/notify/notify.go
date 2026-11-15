package notify

import (
	"bytes"
	"encoding/json"
	"net/http"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/httpx"
)

// post sends a JSON webhook payload when Notify.WebhookURL is set.
func post(cfg config.Config, title, detail, level string) {
	url := cfg.Notify.WebhookURL
	if url == "" {
		return
	}
	payload := map[string]any{
		"text":  title + ": " + detail,
		"name":  cfg.Name,
		"title": title,
		"body":  detail,
		"level": level,
	}
	data, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpx.Client.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
}

// Failure posts a critical error to the configured webhook.
func Failure(cfg config.Config, title, detail string) {
	post(cfg, title, detail, "error")
}

// Success posts a success notice to the configured webhook.
func Success(cfg config.Config, title, detail string) {
	post(cfg, title, detail, "ok")
}
