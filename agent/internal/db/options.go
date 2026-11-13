package db

import "strings"

// Options controls dump behaviour for platform and file engines.
type Options struct {
	// BackupType is full|schema|native|files|incremental|differential (engine-specific).
	BackupType string
	// UseVSS requests a Windows Volume Shadow Copy when files may be locked.
	UseVSS bool
	// PreferNativeTools tries product CLIs (mysqldump, pg_dump, …) before pure-Go builtins.
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

// SchemaOnly reports whether BackupType requests structure without table data.
func (o Options) SchemaOnly() bool {
	t := strings.ToLower(strings.TrimSpace(o.BackupType))
	return t == "schema" || t == "schema-only" || t == "ddl"
}
