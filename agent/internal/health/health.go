package health

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/vaultbackup/agent/internal/config"
	"github.com/vaultbackup/agent/internal/db"
)

// DBResult is a connectivity probe result.
type DBResult struct {
	Status    string `json:"status"`
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latencyMs,omitempty"`
	Detail    string `json:"detail,omitempty"`
	Tools     string `json:"tools,omitempty"`
	Version   string `json:"version,omitempty"`
}

// ProbeDB checks database reachability based on config.
func ProbeDB(cfg config.Config) DBResult {
	t := db.NormalizeType(cfg.Database.Type)
	uri := cfg.Database.URI
	start := time.Now()
	var res DBResult
	switch t {
	case "postgres", "cockroach":
		res = probeTCP(uri, 5432)
	case "mysql":
		res = probeTCP(uri, 3306)
	case "mongodb":
		res = probeTCP(uri, 27017)
	case "redis":
		res = probeRedis(uri)
	case "mssql":
		res = probeTCP(uri, 1433)
	case "sqlite", "files", "quickbooks", "sage50", "access":
		p := strings.TrimPrefix(uri, "file:")
		if _, err := os.Stat(p); err != nil {
			res = DBResult{Status: "Unreachable", OK: false, Detail: err.Error()}
		} else {
			detail := "path exists"
			switch t {
			case "quickbooks":
				detail = "path exists (QuickBooks company file/folder)"
			case "sage50":
				detail = "path exists (Sage 50 company folder)"
			case "access":
				detail = "path exists (Access database)"
			}
			res = DBResult{Status: "OK", OK: true, Detail: detail}
		}
	case "command":
		res = DBResult{Status: "OK", OK: true, Detail: "command engine (no live probe)"}
	default:
		res = DBResult{Status: "—", OK: false, Detail: "unknown type"}
	}
	if res.LatencyMs == 0 {
		res.LatencyMs = time.Since(start).Milliseconds()
	}
	// tool discovery
	tools := discoverTools(t)
	if len(tools) > 0 {
		res.Tools = strings.Join(tools, ", ")
	}
	return res
}

func probeTCP(uri string, defaultPort int) DBResult {
	host := extractHost(uri, defaultPort)
	start := time.Now()
	conn, err := net.DialTimeout("tcp", host, 3*time.Second)
	lat := time.Since(start).Milliseconds()
	if err != nil {
		return DBResult{Status: "Unreachable", OK: false, LatencyMs: lat, Detail: err.Error()}
	}
	_ = conn.Close()
	return DBResult{Status: "OK", OK: true, LatencyMs: lat, Detail: "tcp connected"}
}

func probeRedis(uri string) DBResult {
	// Prefer redis-cli PING when available
	if bin, err := exec.LookPath("redis-cli"); err == nil {
		args := []string{"PING"}
		if uri != "" {
			args = append([]string{"-u", uri}, args...)
		}
		start := time.Now()
		out, err := exec.Command(bin, args...).CombinedOutput()
		lat := time.Since(start).Milliseconds()
		if err != nil {
			return DBResult{Status: "Unreachable", OK: false, LatencyMs: lat, Detail: string(out)}
		}
		return DBResult{Status: "OK", OK: true, LatencyMs: lat, Detail: strings.TrimSpace(string(out))}
	}
	return probeTCP(uri, 6379)
}

func extractHost(uri string, defaultPort int) string {
	u := uri
	if i := strings.Index(u, "://"); i >= 0 {
		u = u[i+3:]
	}
	if i := strings.Index(u, "@"); i >= 0 {
		u = u[i+1:]
	}
	if i := strings.IndexAny(u, "/?"); i >= 0 {
		u = u[:i]
	}
	if !strings.Contains(u, ":") {
		u = fmt.Sprintf("%s:%d", u, defaultPort)
	}
	if u == "" || strings.HasPrefix(u, ":") {
		u = fmt.Sprintf("127.0.0.1:%d", defaultPort)
	}
	return u
}

func discoverTools(dbType string) []string {
	var names []string
	switch dbType {
	case "postgres", "cockroach":
		names = []string{"pg_dump", "cockroach"}
	case "mysql":
		names = []string{"mysqldump"}
	case "mongodb":
		names = []string{"mongodump"}
	case "redis":
		names = []string{"redis-cli"}
	case "mssql":
		names = []string{"sqlcmd"}
	case "sqlite":
		names = []string{"sqlite3"}
	case "oracle":
		names = []string{"expdp", "exp"}
	case "quickbooks", "sage50", "files", "access":
		names = []string{"tar"}
	default:
		return nil
	}
	var found []string
	for _, n := range names {
		if _, err := exec.LookPath(n); err == nil {
			found = append(found, n)
		}
	}
	return found
}
