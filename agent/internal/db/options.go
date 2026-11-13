package db

// Options controls dump behaviour for platform and file engines.
type Options struct {
	// BackupType is full|native|files|incremental|differential (engine-specific).
	BackupType string
	// UseVSS requests a Windows Volume Shadow Copy when files may be locked.
	UseVSS bool
	// PreferNativeTools tries OS/product CLIs (mysqldump, pg_dump, AutoBackupEXE, …)
	// before pure-Go builtins. Default is false so the agent is self-contained.
	PreferNativeTools bool
}

// DefaultOptions returns sensible defaults for SQL engines.
func DefaultOptions(backupType string) Options {
	if backupType == "" {
		backupType = "full"
	}
	// PreferNativeTools false: pure-Go builtins first so the agent works without OS DB client tools.
	return Options{BackupType: backupType, PreferNativeTools: false}
}
