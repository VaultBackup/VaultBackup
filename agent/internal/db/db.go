package db

import (
	"fmt"
	"os"
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
	// Incremental / differential / log (PITR) are catalog-reserved but not produced yet.
	switch strings.ToLower(strings.TrimSpace(bt)) {
	case "incremental", "incr", "differential", "diff", "log", "wal", "binlog", "oplog":
		return Result{}, fmt.Errorf("backup type %q is not implemented yet (agent produces full and schema only; see CAPABILITIES.md — catalog chain is ready for a future release)", bt)
	}
	outName := fmt.Sprintf("backup-%s-%s-%s", t, bt, start.UTC().Format("20060102T150405Z"))
	var (
		path string
		err  error
	)
	preferNative := opts.PreferNativeTools
	schemaOnly := opts.SchemaOnly()
	switch t {
	case "postgres", "cockroach":
		path, err = dumpPostgres(workDir, outName, uri, t, preferNative, schemaOnly)
	case "mysql":
		path, err = dumpMySQL(workDir, outName, uri, preferNative, schemaOnly)
	case "sqlite":
		path, err = dumpSQLite(workDir, outName, uri, preferNative)
	case "mongodb":
		path, err = dumpMongo(workDir, outName, uri, preferNative)
	case "redis":
		path, err = dumpRedis(workDir, outName, uri, preferNative)
	case "mssql":
		path, err = dumpMSSQL(workDir, outName, uri, bt, schemaOnly)
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
