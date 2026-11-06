package webui

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"regexp"
	"strings"
	"time"
)

func newCSPNonce() string {
	var b [18]byte
	if _, err := rand.Read(b[:]); err != nil {
		return base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf("%d", time.Now().UnixNano())))
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}

// applyCSPNonce adds nonce= to every <script> and <style> opening tag.
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
