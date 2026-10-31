package notify

import (
	"bytes"
	"encoding/json"
	"net/http"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/httpx"
)

// Failure posts a critical error to the configured webhook.
func Failure(cfg config.Config, title, detail string) {
	url := cfg.Notify.WebhookURL
	if url == "" {
		return
	}
	payload := map[string]any{
		"text":  title + ": " + detail,
		"name":  cfg.Name,
		"title": title,
		"body":  detail,
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
