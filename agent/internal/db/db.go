package db

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Result of a dump operation.
type Result struct {
	Path      string
	SizeBytes int64
	Type      string
	Duration  time.Duration
	Error     string
}

// ChainState tracks incremental/differential base.
type ChainState struct {
	LastFull time.Time `json:"last_full"`
	LastIncr time.Time `json:"last_incr"`
	BaseHash string    `json:"base_hash"`
}

var compression = "gzip"

// SetCompression sets gzip|zstd for dump pipelines.
func SetCompression(c string) { compression = c }

// NormalizeType maps aliases to canonical types.
func NormalizeType(t string) string {
	switch strings.ToLower(t) {
	case "postgresql", "postgres":
		return "postgres"
	case "mariadb":
		return "mysql"
	case "mongo", "mongodb":
		return "mongodb"
	case "sqlserver", "mssql":
		return "mssql"
	case "turso", "libsql":
		return "sqlite"
	case "cockroach", "cockroachdb":
		return "cockroach"
	case "custom":
		return "command"
	default:
		return strings.ToLower(t)
	}
}

// Dump runs a backup for the given type/uri into workDir.
func Dump(workDir, dbType, uri, backupType string) (Result, error) {
	return DumpWithOptions(workDir, dbType, uri, DefaultOptions(backupType))
}

// DumpWithOptions runs a backup with platform options.
func DumpWithOptions(workDir, dbType, uri string, opts Options) (Result, error) {
	start := time.Now()
	t := NormalizeType(dbType)
	bt := opts.BackupType
	if bt == "" {
		bt = "full"
	}
	outName := fmt.Sprintf("backup-%s-%s-%s", t, bt, start.UTC().Format("20060102T150405Z"))
	var (
		path string
		err  error
	)
	switch t {
	case "postgres", "cockroach":
		path, err = dumpPostgres(workDir, outName, uri, t)
	case "mysql":
		path, err = dumpMySQL(workDir, outName, uri)
	case "sqlite":
		path, err = dumpSQLite(workDir, outName, uri)
	case "mongodb":
		path, err = dumpMongo(workDir, outName, uri)
	case "redis":
		path, err = dumpRedis(workDir, outName, uri)
	case "mssql":
		path, err = dumpMSSQL(workDir, outName, uri, bt)
	case "files":
		path, err = dumpFiles(workDir, outName, uri, opts)
	case "command":
		path, err = dumpCommand(workDir, outName, uri)
	default:
		return Result{}, fmt.Errorf("unsupported database type %q", dbType)
	}
	res := Result{Path: path, Type: bt, Duration: time.Since(start)}
	if err != nil {
		res.Error = err.Error()
		return res, err
	}
	if st, e := os.Stat(path); e == nil {
		res.SizeBytes = st.Size()
	}
	return res, nil
}

func requireBin(names ...string) (string, error) {
	for _, n := range names {
		if p, err := exec.LookPath(n); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("required tool not found on PATH: %s", strings.Join(names, ", "))
}

func outPath(workDir, name, ext string) string {
	_ = os.MkdirAll(workDir, 0o755)
	return filepath.Join(workDir, name+ext)
}

func dumpPostgres(workDir, name, uri, kind string) (string, error) {
	bin, err := requireBin("pg_dump")
	if err != nil {
		return "", err
	}
	out := outPath(workDir, name, ".sql.gz")
	cmd := exec.Command(bin, "--dbname="+uri, "--no-owner", "--no-acl")
	return pipeGzip(cmd, out)
}

func dumpMySQL(workDir, name, uri string) (string, error) {
	bin, err := requireBin("mysqldump", "mariadb-dump")
	if err != nil {
		return "", err
	}
	out := outPath(workDir, name, ".sql.gz")
	cmd := exec.Command(bin, uri)
	return pipeGzip(cmd, out)
}

func dumpSQLite(workDir, name, uri string) (string, error) {
	bin, err := requireBin("sqlite3")
	if err != nil {
		return "", err
	}
	out := outPath(workDir, name, ".sql.gz")
	cmd := exec.Command(bin, uri, ".dump")
	return pipeGzip(cmd, out)
}

func dumpMongo(workDir, name, uri string) (string, error) {
	bin, err := requireBin("mongodump")
	if err != nil {
		return "", err
	}
	dir := filepath.Join(workDir, name+"-mongo")
	_ = os.MkdirAll(dir, 0o755)
	cmd := exec.Command(bin, "--uri="+uri, "--out="+dir)
	if b, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("mongodump: %w: %s", err, string(b))
	}
	tarPath := outPath(workDir, name, ".tar.gz")
	tarCmd := exec.Command("tar", "-czf", tarPath, "-C", workDir, filepath.Base(dir))
	if b, err := tarCmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("tar: %w: %s", err, string(b))
	}
	return tarPath, nil
}

func dumpRedis(workDir, name, uri string) (string, error) {
	bin, err := requireBin("redis-cli")
	if err != nil {
		return "", err
	}
	out := outPath(workDir, name, ".rdb")
	cmd := exec.Command(bin, "-u", uri, "--rdb", out)
	if b, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("redis-cli: %w: %s", err, string(b))
	}
	return out, nil
}

func dumpMSSQL(workDir, name, uri, bt string) (string, error) {
	bin, err := requireBin("sqlcmd")
	if err != nil {
		return "", err
	}
	out := outPath(workDir, name, ".bak")
	// Best-effort; real deployments configure sqlcmd flags via supported engines.
	cmd := exec.Command(bin, "-Q", "SELECT 1")
	if b, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("sqlcmd: %w: %s", err, string(b))
	}
	_ = out
	return "", fmt.Errorf("mssql: configure native backup tools on the host; sqlcmd is present")
}

func dumpFiles(workDir, name, uri string, opts Options) (string, error) {
	return "", fmt.Errorf("files: not configured in this security build")
}

// dumpCommand: VAPT V-02 — custom shell dumps disabled by default (no sh -c).
// Optional: VAULTBACKUP_ALLOW_SHELL_COMMAND=1 enables argv-only allowlisted binaries.
func dumpCommand(workDir, name, cmdline string) (string, error) {
	cmdline = strings.TrimSpace(cmdline)
	if cmdline == "" {
		return "", fmt.Errorf("command: empty command")
	}
	if os.Getenv("VAULTBACKUP_ALLOW_SHELL_COMMAND") != "1" {
		return "", fmt.Errorf("command: custom shell dumps are disabled for security; use a supported database engine")
	}
	if len(cmdline) > 2048 {
		return "", fmt.Errorf("command: too long")
	}
	for _, r := range cmdline {
		if r == 10 || r == 13 || r == 0 || r == '|' || r == '&' || r == ';' || r == '`' ||
			r == '$' || r == '>' || r == '<' || r == '(' || r == ')' || r == '{' || r == '}' {
			return "", fmt.Errorf("command: shell metacharacters are not allowed")
		}
	}
	parts := strings.Fields(cmdline)
	if len(parts) == 0 {
		return "", fmt.Errorf("command: empty command")
	}
	base := strings.ToLower(filepath.Base(parts[0]))
	allowed := map[string]bool{
		"pg_dump": true, "pg_dumpall": true,
		"mysqldump": true, "mariadb-dump": true,
		"mongodump": true,
		"redis-cli": true,
		"sqlite3": true,
		"sqlcmd": true,
	}
	if !allowed[base] {
		return "", fmt.Errorf("command: binary %q is not in the allowlist", base)
	}
	resolved, err := exec.LookPath(base)
	if err != nil {
		return "", fmt.Errorf("command: %s not found on PATH: %w", base, err)
	}
	out := outPath(workDir, name, ".dump.gz")
	cmd := exec.Command(resolved, parts[1:]...)
	cmd.Dir = workDir
	cmd.Env = safeCommandEnv()
	return pipeGzip(cmd, out)
}

func safeCommandEnv() []string {
	keep := []string{"PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "WINDIR", "COMSPEC"}
	var out []string
	for _, k := range keep {
		if v := os.Getenv(k); v != "" {
			out = append(out, k+"="+v)
		}
	}
	return out
}

func pipeGzip(cmd *exec.Cmd, outPath string) (string, error) {
	f, err := os.Create(outPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	gzipBin, err := exec.LookPath("gzip")
	if err != nil {
		return "", fmt.Errorf("gzip not found: %w", err)
	}
	gz := exec.Command(gzipBin, "-c")
	gz.Stdin, err = cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	gz.Stdout = f
	var errBuf strings.Builder
	cmd.Stderr = &errBuf
	gz.Stderr = &errBuf
	if err := cmd.Start(); err != nil {
		return "", err
	}
	if err := gz.Start(); err != nil {
		_ = cmd.Process.Kill()
		return "", err
	}
	if err := cmd.Wait(); err != nil {
		_ = gz.Process.Kill()
		return "", fmt.Errorf("%w: %s", err, errBuf.String())
	}
	if err := gz.Wait(); err != nil {
		return "", fmt.Errorf("gzip: %w: %s", err, errBuf.String())
	}
	return outPath, nil
}
