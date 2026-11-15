package db

import "runtime"

// Capability describes what the agent can do for an engine on this platform.
type Capability struct {
	Type        string   `json:"type"`
	Label       string   `json:"label"`
	Builtin     bool     `json:"builtin"`     // pure-Go dump works without OS tools
	NativeTools []string `json:"nativeTools"` // preferred CLI tools if present
	Platforms   []string `json:"platforms"`   // linux, windows, darwin
	Notes       string   `json:"notes,omitempty"`
}

// Capabilities returns the engine matrix for this build/OS.
func Capabilities() []Capability {
	osName := runtime.GOOS
	all := []Capability{
		{Type: "mysql", Label: "MySQL / MariaDB / TiDB / SingleStore", Builtin: true, NativeTools: []string{"mysqldump", "mariadb-dump"}, Platforms: []string{"linux", "windows", "darwin"}, Notes: "Pure-Go logical dump embedded; optional mysqldump if PreferNativeTools; large DBs: native tools recommended"},
		{Type: "postgres", Label: "PostgreSQL / Neon / Supabase / Timescale", Builtin: true, NativeTools: []string{"pg_dump"}, Platforms: []string{"linux", "windows", "darwin"}, Notes: "Pure-Go logical dump embedded; optional pg_dump; large DBs: native tools recommended"},
		{Type: "cockroach", Label: "CockroachDB", Builtin: true, NativeTools: []string{"pg_dump", "cockroach"}, Platforms: []string{"linux", "windows", "darwin"}},
		{Type: "sqlite", Label: "SQLite / Turso / libSQL", Builtin: true, NativeTools: []string{"sqlite3"}, Platforms: []string{"linux", "windows", "darwin"}, Notes: "File copy always works"},
		{Type: "mongodb", Label: "MongoDB / DocumentDB", Builtin: true, NativeTools: []string{"mongodump"}, Platforms: []string{"linux", "windows", "darwin"}},
		{Type: "redis", Label: "Redis / Valkey / KeyDB", Builtin: true, NativeTools: []string{"redis-cli"}, Platforms: []string{"linux", "windows", "darwin"}},
		{Type: "mssql", Label: "Microsoft SQL Server / Azure SQL", Builtin: true, NativeTools: []string{"sqlcmd"}, Platforms: []string{"linux", "windows", "darwin"}},
		{Type: "oracle", Label: "Oracle Database", Builtin: false, NativeTools: []string{"expdp", "exp", "rman"}, Platforms: []string{"linux", "windows"}, Notes: "Data Pump expdp (DIRECTORY + ORACLE_DIRECTORY_PATH), classic exp, or RMAN disk backupset"},
		{Type: "files", Label: "Generic files / folders", Builtin: true, NativeTools: []string{"tar"}, Platforms: []string{"linux", "windows", "darwin"}},
		{Type: "quickbooks", Label: "QuickBooks Desktop", Builtin: true, NativeTools: []string{"AutoBackupEXE.exe"}, Platforms: []string{"windows"}, Notes: "Native .qbb on Windows; file archive elsewhere"},
		{Type: "sage50", Label: "Sage 50 / Peachtree", Builtin: true, NativeTools: []string{}, Platforms: []string{"windows"}, Notes: "Company folder archive; best on Windows"},
		{Type: "access", Label: "Microsoft Access", Builtin: true, NativeTools: []string{}, Platforms: []string{"windows", "linux", "darwin"}, Notes: "File copy of .accdb/.mdb"},
		{Type: "as400", Label: "IBM i / AS/400", Builtin: true, NativeTools: []string{"ssh"}, Platforms: []string{"linux", "windows", "darwin"}, Notes: "SAVLIB/SAVOBJ via SSH+SFTP; multi-lib; optional SAVSECDTA/SAVCFG; or file:.savf"},
		{Type: "command", Label: "Custom allowlisted command", Builtin: false, NativeTools: []string{}, Platforms: []string{"linux", "windows", "darwin"}, Notes: "Disabled unless VAULTBACKUP_ALLOW_SHELL_COMMAND=1"},
	}
	// Size guidance (soft): agent has no hard dump cap; need ~2x free disk for dump+encrypt.
	// Worker console path remains ~20MB. Prefer native tools for multi-GB MySQL/Postgres.
	// Filter notes by platform awareness (still list all; UI can show support)
	_ = osName
	return all
}

// Supports reports whether type is known on this OS (soft check).
func Supports(dbType string) bool {
	t := NormalizeType(dbType)
	for _, c := range Capabilities() {
		if c.Type == t {
			for _, p := range c.Platforms {
				if p == runtime.GOOS {
					return true
				}
			}
			return true
		}
	}
	return false
}
