package httpx

import (
	"net/http"
	"time"
)

// Client is a shared HTTP client with timeouts.
var Client = &http.Client{Timeout: 60 * time.Second}
