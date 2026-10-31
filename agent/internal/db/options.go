package db

// Options controls dump behaviour for platform and file engines.
type Options struct {
	// BackupType is full|native|files|incremental|differential (engine-specific).
	BackupType string
	// UseVSS requests a Windows Volume Shadow Copy when files may be locked.
	UseVSS bool
	// PreferNativeTools tries product CLIs (AutoBackupEXE, PeachtreeBackup) before file copy.
	PreferNativeTools bool
}

// DefaultOptions returns sensible defaults for SQL engines.
func DefaultOptions(backupType string) Options {
	if backupType == "" {
		backupType = "full"
	}
	return Options{BackupType: backupType, PreferNativeTools: true}
}
