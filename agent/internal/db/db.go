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
	case "qb", "qbw", "quickbooks", "quickbooks_desktop", "quickbooks-desktop":
		return "quickbooks"
	case "sage", "sage50", "peachtree", "sage_50", "sage-50":
		return "sage50"
	case "access", "msaccess", "accdb", "mdb":
		return "access"
	default:
		return strings.ToLower(t)
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
	case "oracle":
		path, err = dumpOracle(workDir, outName, uri)
	case "quickbooks":
		path, err = dumpQuickBooks(workDir, outName, uri, opts)
	case "sage50":
		path, err = dumpSage50(workDir, outName, uri, opts)
	case "access":
		path, err = dumpAccess(workDir, outName, uri, opts)
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

func dumpPostgres(workDir, name, uri, kind string) (string, error) {
	bin, err := requireBin("pg_dump")
	if err != nil {
		if kind == "cockroach" {
			if b, e := requireBin("cockroach"); e == nil {
				out := outPath(workDir, name, ".sql.gz")
				cmd := exec.Command(b, "dump", "--url="+uri)
				return pipeGzip(cmd, out)
			}
		}
		return "", err
	}
	out := outPath(workDir, name, ".sql.gz")
	cmd := exec.Command(bin, "--no-owner", "--no-acl", uri)
	return pipeGzip(cmd, out)
}

func dumpMySQL(workDir, name, uri string) (string, error) {
	bin, err := requireBin("mysqldump")
	if err != nil {
		return "", err
	}
	// Accept mysql://user:pass@host:port/db or plain args
	args := []string{"--single-transaction", "--routines", "--triggers"}
	if strings.Contains(uri, "://") {
		// best-effort parse left to caller tooling; pass as --defaults or URI-like
		args = append(args, uri)
	} else {
		args = append(args, uri)
	}
	out := outPath(workDir, name, ".sql.gz")
	cmd := exec.Command(bin, args...)
	return pipeGzip(cmd, out)
}

func dumpSQLite(workDir, name, uri string) (string, error) {
	src := strings.TrimPrefix(uri, "file:")
	if _, err := os.Stat(src); err != nil {
		return "", fmt.Errorf("sqlite file: %w", err)
	}
	out := outPath(workDir, name, ".db.gz")
	// Prefer sqlite3 .backup if available, else copy+gzip
	if bin, err := exec.LookPath("sqlite3"); err == nil {
		tmp := outPath(workDir, name, ".db")
		cmd := exec.Command(bin, src, ".backup "+tmp)
		if err := cmd.Run(); err == nil {
			return gzipFile(tmp, out)
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

func dumpMongo(workDir, name, uri string) (string, error) {
	bin, err := requireBin("mongodump")
	if err != nil {
		return "", err
	}
	dir := outPath(workDir, name, "")
	_ = os.MkdirAll(dir, 0o755)
	cmd := exec.Command(bin, "--uri="+uri, "--out="+dir)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("mongodump: %w: %s", err, string(out))
	}
	// tar the directory
	tarPath := dir + ".tar.gz"
	tarCmd := exec.Command("tar", "-czf", tarPath, "-C", workDir, filepath.Base(dir))
	if out, err := tarCmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("tar: %w: %s", err, string(out))
	}
	_ = os.RemoveAll(dir)
	return tarPath, nil
}

func dumpRedis(workDir, name, uri string) (string, error) {
	bin, err := requireBin("redis-cli")
	if err != nil {
		return "", err
	}
	out := outPath(workDir, name, ".rdb")
	args := []string{"--rdb", out}
	if uri != "" {
		args = append([]string{"-u", uri}, args...)
	}
	cmd := exec.Command(bin, args...)
	if b, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("redis-cli: %w: %s", err, string(b))
	}
	return out, nil
}

func dumpMSSQL(workDir, name, uri, backupType string) (string, error) {
	bin, err := requireBin("sqlcmd")
	if err != nil {
		return "", err
	}
	out := outPath(workDir, name, ".bak")
	// Expect uri like server=...;database=...;user=...;password=...
	// Caller should supply a BACKUP DATABASE T-SQL via command mode for full control.
	q := fmt.Sprintf("BACKUP DATABASE [db] TO DISK=N'%s' WITH INIT", out)
	if backupType == "differential" || backupType == "incremental" {
		q = fmt.Sprintf("BACKUP DATABASE [db] TO DISK=N'%s' WITH DIFFERENTIAL", out)
	}
	cmd := exec.Command(bin, "-Q", q)
	if b, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("sqlcmd: %w: %s", err, string(b))
	}
	return out, nil
}

func dumpFiles(workDir, name, src string, opts Options) (string, error) {
	src = strings.TrimSpace(strings.TrimPrefix(src, "file:"))
	if src == "" || strings.Contains(src, "\x00") {
		return "", fmt.Errorf("files path: empty or invalid")
	}
	// Reject relative path escapes in the configured URI.
	if strings.Contains(src, "..") {
		clean := filepath.Clean(src)
		if strings.Contains(clean, "..") {
			return "", fmt.Errorf("files path: path traversal not allowed")
		}
		src = clean
	}
	st, err := os.Stat(src)
	if err != nil {
		return "", fmt.Errorf("files path: %w", err)
	}

	// Auto-detect platform files when user selected generic "files".
	if !st.IsDir() {
		ext := strings.ToLower(filepath.Ext(src))
		switch ext {
		case ".qbw":
			return dumpQuickBooks(workDir, name, src, opts)
		case ".accdb", ".mdb":
			return dumpAccess(workDir, name, src, opts)
		}
	}

	stage := filepath.Join(workDir, name+"-stage")
	_ = os.RemoveAll(stage)
	_ = os.MkdirAll(stage, 0o755)

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
		args := []string{"-czf", out, "-C", filepath.Dir(src), filepath.Base(src)}
		cmd := exec.Command("tar", args...)
		if b, terr := cmd.CombinedOutput(); terr != nil {
			return "", fmt.Errorf("files archive: %v; tar: %v (%s)", err, terr, string(b))
		}
	}
	_ = os.RemoveAll(stage)
	return out, nil
}

func dumpCommand(workDir, name, cmdline string) (string, error) {
	cmdline = strings.TrimSpace(cmdline)
	if cmdline == "" {
		return "", fmt.Errorf("command: empty command")
	}
	if len(cmdline) > 4096 {
		return "", fmt.Errorf("command: too long")
	}
	for _, r := range cmdline {
		if r == 10 || r == 13 || r == 0 {
			return "", fmt.Errorf("command: multiline commands not allowed")
		}
	}
	low := strings.ToLower(cmdline)
	for _, bad := range []string{
		"$(", "${",
		">/", "> /",
		"rm -rf /", "mkfs", "dd if=",
		"curl ", "wget ", "python -c", "perl -e", "ruby -e",
		"/dev/tcp", "bash -i", "nc -e", "ncat ",
	} {
		if strings.Contains(low, bad) {
			return "", fmt.Errorf("command: rejected unsafe pattern")
		}
	}
	if strings.Contains(cmdline, string(rune(96))) {
		return "", fmt.Errorf("command: rejected unsafe pattern")
	}
	out := outPath(workDir, name, ".dump.gz")
	cmd := exec.Command("sh", "-c", cmdline)
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

func dumpOracle(workDir, name, uri string) (string, error) {
	bin, err := requireBin("expdp", "exp")
	if err != nil {
		return "", err
	}
	out := outPath(workDir, name, ".dmp")
	cmd := exec.Command(bin, uri, "FILE="+out)
	if b, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("oracle export: %w: %s", err, string(b))
	}
	return out, nil
}

func pipeGzip(cmd *exec.Cmd, outPath string) (string, error) {
	f, err := os.Create(outPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	// shell out to gzip for portability
	gzipBin, err := exec.LookPath("gzip")
	if err != nil {
		// write raw
		cmd.Stdout = f
		if b, err := cmd.CombinedOutput(); err != nil {
			return "", fmt.Errorf("%v: %s", err, string(b))
		}
		return outPath, nil
	}
	gz := exec.Command(gzipBin, "-c")
	gz.Stdout = f
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	gz.Stdin = stdout
	if err := cmd.Start(); err != nil {
		return "", err
	}
	if err := gz.Start(); err != nil {
		return "", err
	}
	if err := cmd.Wait(); err != nil {
		return "", err
	}
	if err := gz.Wait(); err != nil {
		return "", err
	}
	return outPath, nil
}

func gzipFile(src, dst string) (string, error) {
	cmd := exec.Command("gzip", "-c", src)
	f, err := os.Create(dst)
	if err != nil {
		return "", err
	}
	defer f.Close()
	cmd.Stdout = f
	if b, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("gzip: %w: %s", err, string(b))
	}
	_ = os.Remove(src)
	return dst, nil
}
