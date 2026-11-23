package webui

import "testing"

func TestOriginAllowed(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		host   string
		want   bool
	}{
		{"same http origin", "http://127.0.0.1:8080", "127.0.0.1:8080", true},
		{"same https origin", "https://localhost:8443", "localhost:8443", true},
		{"opaque origin", "null", "127.0.0.1:8080", false},
		{"different port", "http://127.0.0.1:9090", "127.0.0.1:8080", false},
		{"different host", "http://evil.example", "127.0.0.1:8080", false},
		{"suffix attack", "http://127.0.0.1.evil.example", "127.0.0.1:8080", false},
		{"userinfo", "http://127.0.0.1:8080@evil.example", "127.0.0.1:8080", false},
		{"path", "http://127.0.0.1:8080/evil", "127.0.0.1:8080", false},
		{"unsupported scheme", "file://127.0.0.1:8080", "127.0.0.1:8080", false},
		{"empty", "", "127.0.0.1:8080", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := originAllowed(tt.origin, tt.host); got != tt.want {
				t.Fatalf("originAllowed(%q, %q) = %v, want %v", tt.origin, tt.host, got, tt.want)
			}
		})
	}
}
