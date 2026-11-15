// Package errcode defines stable agent error codes for history, events, and UI.
package errcode

import (
	"strings"
)

// Stable codes (do not rename casually — console and docs may key off them).
const (
	OK              = "OK"
	LicenseBlocked  = "LICENSE_BLOCKED"
	DiskFull        = "DISK_FULL"
	DBUnreachable   = "DB_UNREACHABLE"
	DBDumpFailed    = "DB_DUMP_FAILED"
	ToolMissing     = "TOOL_MISSING"
	EncryptFailed   = "ENCRYPT_FAILED"
	UploadFailed    = "UPLOAD_FAILED"
	DestProbeFailed = "DEST_PROBE_FAILED"
	AlreadyRunning  = "ALREADY_RUNNING"
	ConfigInvalid   = "CONFIG_INVALID"
	Unknown         = "UNKNOWN"
)

// Classify maps a free-text or wrapped error to a stable code.
func Classify(err error) string {
	if err == nil {
		return OK
	}
	return ClassifyText(err.Error())
}

// ClassifyText maps an error message string to a stable code.
func ClassifyText(msg string) string {
	s := strings.ToLower(strings.TrimSpace(msg))
	if s == "" {
		return Unknown
	}
	switch {
	case strings.Contains(s, "backup already running"):
		return AlreadyRunning
	case strings.Contains(s, "license") || strings.Contains(s, "token_bound") ||
		strings.Contains(s, "token invalid") || strings.Contains(s, "not allowed") ||
		strings.Contains(s, "backup blocked: license"):
		return LicenseBlocked
	case strings.Contains(s, "insufficient free disk") || strings.Contains(s, "no space left") ||
		strings.Contains(s, "disk full") || strings.Contains(s, "not enough space"):
		return DiskFull
	case strings.Contains(s, "required tool not found") || strings.Contains(s, "executable file not found") ||
		strings.Contains(s, "not found on path"):
		return ToolMissing
	case strings.Contains(s, "encrypt") && (strings.Contains(s, "fail") || strings.Contains(s, "key")):
		return EncryptFailed
	case strings.Contains(s, "upload") || strings.Contains(s, "s3 ") || strings.Contains(s, "azure") ||
		strings.Contains(s, "webdav") || strings.Contains(s, "sftp") ||
		strings.Contains(s, "put http") || strings.Contains(s, "multipart"):
		return UploadFailed
	case strings.Contains(s, "destination") && strings.Contains(s, "test"):
		return DestProbeFailed
	case strings.Contains(s, "connection refused") || strings.Contains(s, "i/o timeout") ||
		strings.Contains(s, "no such host") || strings.Contains(s, "dial tcp") ||
		strings.Contains(s, "connect:") || strings.Contains(s, "ping:") ||
		strings.Contains(s, "access denied") || strings.Contains(s, "authentication") ||
		strings.Contains(s, "can't connect") || strings.Contains(s, "unreachable"):
		return DBUnreachable
	case strings.Contains(s, "dump") || strings.Contains(s, "mysqldump") || strings.Contains(s, "pg_dump") ||
		strings.Contains(s, "mongodump") || strings.Contains(s, "expdp") || strings.Contains(s, "backup failed"):
		return DBDumpFailed
	case strings.Contains(s, "config") || strings.Contains(s, "invalid"):
		return ConfigInvalid
	default:
		return Unknown
	}
}
