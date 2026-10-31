package secure

import (
	"net/url"
	"regexp"
	"strings"
)

var (
	reURIUserPass = regexp.MustCompile(`(?i)^(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|http|https|ftp|sftp)://([^:/@]+):([^@/]+)@`)
	reKeyish      = regexp.MustCompile(`(?i)(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[=:]\s*\S+`)
	reBearer      = regexp.MustCompile(`(?i)(bearer\s+)[a-z0-9._\-]+`)
)

// RedactURI masks passwords embedded in connection URIs.
func RedactURI(uri string) string {
	if uri == "" {
		return uri
	}
	if reURIUserPass.MatchString(uri) {
		return reURIUserPass.ReplaceAllString(uri, "$1://$2:***@")
	}
	// Query password=
	if u, err := url.Parse(uri); err == nil && u.Scheme != "" {
		q := u.Query()
		changed := false
		for _, k := range []string{"password", "pwd", "secret", "token", "api_key"} {
			if q.Has(k) {
				q.Set(k, "***")
				changed = true
			}
		}
		if changed {
			u.RawQuery = q.Encode()
			return u.String()
		}
		if u.User != nil {
			if _, ok := u.User.Password(); ok {
				u.User = url.UserPassword(u.User.Username(), "***")
				return u.String()
			}
		}
	}
	return uri
}

// RedactText removes common secret patterns from free-form log/error text.
func RedactText(s string) string {
	if s == "" {
		return s
	}
	s = RedactURI(s)
	s = reKeyish.ReplaceAllStringFunc(s, func(m string) string {
		parts := strings.SplitN(m, "=", 2)
		if len(parts) == 2 {
			return parts[0] + "=***"
		}
		parts = strings.SplitN(m, ":", 2)
		if len(parts) == 2 {
			return parts[0] + ":***"
		}
		return "***"
	})
	s = reBearer.ReplaceAllString(s, "${1}***")
	return s
}

// IsLoopbackAddr reports whether host is loopback (127.0.0.1, ::1, localhost).
func IsLoopbackHost(host string) bool {
	h := strings.Trim(strings.ToLower(host), "[]")
	return h == "localhost" || h == "127.0.0.1" || h == "::1" || h == "0:0:0:0:0:0:0:1"
}
