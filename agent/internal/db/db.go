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
	switch strings.ToLower(strings.TrimSpace(t)) {
	case "postgresql", "postgres", "pg", "neon", "supabase", "timescale", "timescaledb":
		return "postgres"
	case "mysql", "mariadb", "tidb", "singlestore", "memsql", "percona":
		return "mysql"
	case "mongo", "mongodb", "documentdb", "azurecosmosmongo":
		return "mongodb"
	case "sqlserver", "mssql", "azure-sql", "azuresql", "sql-server":
		return "mssql"
	case "sqlite", "turso", "libsql", "sqlite3":
		return "sqlite"
	case "cockroach", "cockroachdb", "crdb":
		return "cockroach"
	case "redis", "valkey", "keydb", "redis-stack":
		return "redis"
	case "oracle", "ora":
		return "oracle"
	case "custom", "command":
		return "command"
	case "qb", "qbw", "quickbooks", "quickbooks_desktop", "quickbooks-desktop":
		return "quickbooks"
	case "sage", "sage50", "peachtree", "sage_50", "sage-50":
		return "sage50"
	case "access", "msaccess", "accdb", "mdb":
		return "access"
	case "as400", "ibmi", "ibm i", "ibm-i", "db2i", "db2/400":
		return "as400"
	case "files", "folder", "filesystem":
		return "files"
	default:
		return strings.ToLower(strings.TrimSpace(t))
	}
}

// Dump runs a backup for the given type/uri into workDir.
// Prefer DumpWithOptions when VSS or native-tool flags are needed.
func Dump(workDir, dbType, uri, backupType string) (Result, error) {
	return DumpWithOptions(workDir, dbType, uri, DefaultOptions(backupType))
}

// DumpWithOptions runs a backup with platform options (VSS, native tools, …).
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
	preferNative := opts.PreferNativeTools
	switch t {
	case "postgres", "cockroach":
		path, err = dumpPostgres(workDir, outName, uri, t, preferNative)
	case "mysql":
		path, err = dumpMySQL(workDir, outName, uri, preferNative)
	case "sqlite":
		path, err = dumpSQLite(workDir, outName, uri, preferNative)
	case "mongodb":
		path, err = dumpMongo(workDir, outName, uri, preferNative)
	case "redis":
		path, err = dumpRedis(workDir, outName, uri, preferNative)
	case "mssql":
		path, err = dumpMSSQL(workDir, outName, uri, bt)
	case "files":
		path, err = dumpFiles(workDir, outName, uri, opts)
	case "command":
		path, err = dumpCommand(workDir, outName, uri)
	case "oracle":
		path, err = dumpOracle(workDir, outName, uri)
	case "quickbooks":
		path, err = dumpQuickBooks(workDir, outName, uri, opts)
	case "sage50":
		path, err = dumpSage50(workDir, outName, uri, opts)
	case "access":
		path, err = dumpAccess(workDir, outName, uri, opts)
	case "as400":
		path, err = dumpAS400(workDir, outName, uri, opts)
	default:
		return Result{}, fmt.Errorf("unsupported database type %q", dbType)
	}
	res := Result{
		Path:     path,
		Type:     bt,
		Duration: time.Since(start),
	}
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

func dumpPostgres(workDir, name, uri, kind string, preferNative bool) (string, error) {
	if !preferNative {
		return dumpPostgresBuiltin(workDir, name, uri)
	}
	bin, err := requireBin("pg_dump")
	if err != nil {
		if kind == "cockroach" {
			if b, e := requireBin("cockroach"); e == nil {
				out := outPath(workDir, name, ".sql.gz")
				cmd := exec.Command(b, "dump", "--url="+uri)
				return pipeGzip(cmd, out)
			}
		}
		return dumpPostgresBuiltin(workDir, name, uri)
	}
	out := outPath(workDir, name, ".sql.gz")
	cmd := exec.Command(bin, "--dbname="+uri, "--no-owner", "--no-acl")
	path, err := pipeGzip(cmd, out)
	if err != nil {
		if p2, err2 := dumpPostgresBuiltin(workDir, name, uri); err2 == nil {
			return p2, nil
		}
		return "", err
	}
	return path, nil
}

func dumpMySQL(workDir, name, uri string, preferNative bool) (string, error) {
	if !preferNative {
		return dumpMySQLBuiltin(workDir, name, uri)
	}
	bin, err := requireBin("mysqldump", "mariadb-dump")
	if err != nil {
		return dumpMySQLBuiltin(workDir, name, uri)
	}
	args := []string{"--single-transaction", "--routines", "--triggers", "--protocol=TCP"}
	host, port, user, pass, dbname, err := parseMySQLURI(uri)
	if err != nil {
		return "", err
	}
	if host == "" {
		host = "127.0.0.1"
	}
	if host == "localhost" {
		host = "127.0.0.1"
	}
	args = append(args, "-h", host)
	if port != "" {
		args = append(args, "-P", port)
	}
	if user != "" {
		args = append(args, "-u", user)
	}
	if pass != "" {
		args = append(args, "-p"+pass)
	}
	if dbname != "" {
		args = append(args, "--databases", dbname)
	}
	out := outPath(workDir, name, ".sql.gz")
	cmd := exec.Command(bin, args...)
	path, err := pipeGzip(cmd, out)
	if err != nil {
		if p2, err2 := dumpMySQLBuiltin(workDir, name, uri); err2 == nil {
			return p2, nil
		}
		return "", err
	}
	return path, nil
}

// parseMySQLURI accepts mysql://user:pass@host:port/db?params or user:pass@host:port/db.
func parseMySQLURI(uri string) (host, port, user, pass, db string, err error) {
	u := strings.TrimSpace(uri)
	if u == "" {
		return "", "", "", "", "", fmt.Errorf("mysql URI is empty")
	}
	if i := strings.Index(u, "://"); i >= 0 {
		u = u[i+3:]
	}
	if at := strings.LastIndex(u, "@"); at >= 0 {
		cred := u[:at]
		u = u[at+1:]
		if colon := strings.Index(cred, ":"); colon >= 0 {
			user = cred[:colon]
			pass = cred[colon+1:]
		} else {
			user = cred
		}
	}
	if q := strings.IndexAny(u, "?#"); q >= 0 {
		u = u[:q]
	}
	if slash := strings.Index(u, "/"); slash >= 0 {
		db = strings.TrimPrefix(u[slash:], "/")
		if i := strings.Index(db, "/"); i >= 0 {
			db = db[:i]
		}
		u = u[:slash]
	}
	if strings.HasPrefix(u, "[") {
		if end := strings.Index(u, "]"); end > 0 {
			host = u[1:end]
			rest := u[end+1:]
			if strings.HasPrefix(rest, ":") {
				port = rest[1:]
			}
			return host, port, user, pass, db, nil
		}
	}
	if colon := strings.LastIndex(u, ":"); colon >= 0 {
		host = u[:colon]
		port = u[colon+1:]
	} else {
		host = u
	}
	if port == "" {
		port = "3306"
	}
	return host, port, user, pass, db, nil
}

func dumpSQLite(workDir, name, uri string, preferNative bool) (string, error) {
	src := strings.TrimPrefix(uri, "file:")
	if _, err := os.Stat(src); err != nil {
		return "", fmt.Errorf("sqlite file: %w", err)
	}
	out := outPath(workDir, name, ".db.gz")
	if preferNative {
		if bin, err := exec.LookPath("sqlite3"); err == nil {
			tmp := outPath(workDir, name, ".db")
			cmd := exec.Command(bin, src, ".backup "+tmp)
			if err := cmd.Run(); err == nil {
				return gzipFile(tmp, out)
			}
		}
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return "", err
	}
	tmp := outPath(workDir, name, ".db")
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return "", err
	}
	return gzipFile(tmp, out)
}

func dumpMongo(workDir, name, uri string, preferNative bool) (string, error) {
	if !preferNative {
		return dumpMongoBuiltin(workDir, name, uri)
	}
	bin, err := requireBin("mongodump")
	if err != nil {
		return dumpMongoBuiltin(workDir, name, uri)
	}
	dir := filepath.Join(workDir, name+"-mongo")
	_ = os.MkdirAll(dir, 0o755)
	cmd := exec.Command(bin, "--uri="+uri, "--out="+dir)
	if b, err := cmd.CombinedOutput(); err != nil {
		if p2, err2 := dumpMongoBuiltin(workDir, name, uri); err2 == nil {
			return p2, nil
		}
		return "", fmt.Errorf("mongodump: %w: %s", err, string(b))
	}
	tarPath := outPath(workDir, name, ".tar.gz")
	tarCmd := exec.Command("tar", "-czf", tarPath, "-C", workDir, filepath.Base(dir))
	if b, err := tarCmd.CombinedOutput(); err != nil {
		if p2, err2 := dumpMongoBuiltin(workDir, name, uri); err2 == nil {
			return p2, nil
		}
		return "", fmt.Errorf("tar: %w: %s", err, string(b))
	}
	return tarPath, nil
}

func dumpRedis(workDir, name, uri string, preferNative bool) (string, error) {
	if !preferNative {
		return dumpRedisBuiltin(workDir, name, uri)
	}
	bin, err := requireBin("redis-cli")
	if err != nil {
		return dumpRedisBuiltin(workDir, name, uri)
	}
	out := outPath(workDir, name, ".rdb")
	cmd := exec.Command(bin, "-u", uri, "--rdb", out)
	if b, err := cmd.CombinedOutput(); err != nil {
		if p2, err2 := dumpRedisBuiltin(workDir, name, uri); err2 == nil {
			return p2, nil
		}
		return "", fmt.Errorf("redis-cli: %w: %s", err, string(b))
	}
	return out, nil
}

func dumpMSSQL(workDir, name, uri, backupType string) (string, error) {
	// Prefer built-in pure-Go dump; sqlcmd native backup is host-specific.
	if path, err := dumpMSSQLBuiltin(workDir, name, uri); err == nil {
		return path, nil
	} else if _, e2 := requireBin("sqlcmd"); e2 != nil {
		return "", err
	}
	return dumpMSSQLBuiltin(workDir, name, uri)
}

func dumpFiles(workDir, name, src string, opts Options) (string, error) {
	src = strings.TrimSpace(strings.TrimPrefix(src, "file:"))
	if src == "" || strings.Contains(src, "\x00") {
		return "", fmt.Errorf("files path: empty or invalid")
	}
	if strings.Contains(src, "..") {
		clean := filepath.Clean(src)
		if strings.Contains(clean, "..") {
			return "", fmt.Errorf("files path: path traversal not allowed")
		}
	}
	st, err := os.Stat(src)
	if err != nil {
		return "", fmt.Errorf("files path: %w", err)
	}
	stage := filepath.Join(workDir, name+"-stage")
	_ = os.RemoveAll(stage)
	var staged string
	if opts.UseVSS {
		staged, err = withVSSCopy(src, stage)
	} else {
		staged, err = directCopyTree(src, stage, st.IsDir())
	}
	if err != nil {
		return "", fmt.Errorf("files copy: %w", err)
	}
	out := outPath(workDir, name, ".tar.gz")
	if err := tarGzDir(staged, out); err != nil {
		// fallback single file gzip
		if !st.IsDir() {
			tmp := outPath(workDir, name, ".bin")
			if e := copyFilePath(src, tmp); e == nil {
				return gzipFile(tmp, outPath(workDir, name, ".bin.gz"))
			}
		}
		return "", fmt.Errorf("files archive: %v", err)
	}
	_ = os.RemoveAll(stage)
	return out, nil
}

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
		"expdp": true, "exp": true, "rman": true,
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
	keep := []string{"PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "WINDIR", "COMSPEC",
		"ORACLE_HOME", "ORACLE_SID", "TNS_ADMIN", "ORACLE_DIRECTORY", "ORACLE_DIRECTORY_PATH"}
	var out []string
	for _, k := range keep {
		if v := os.Getenv(k); v != "" {
			out = append(out, k+"="+v)
		}
	}
	return out
}
