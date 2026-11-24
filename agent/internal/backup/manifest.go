// Package backup defines the agent backup catalog: per-object manifests and
// chain state used for full backups today and incremental/PITR later.
package backup

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/vaultbackup/agent/internal/db"
)

// FormatVersion is the catalog schema version.
const FormatVersion = 1

// Kind of backup payload.
const (
	KindFull   = "full"
	KindSchema = "schema"
	KindIncr   = "incremental"  // reserved — not produced yet
	KindDiff   = "differential" // reserved — not produced yet
	KindLog    = "log"          // reserved — WAL/binlog/trn shipping later
)

// Manifest is written alongside each backup object (<object>.manifest.json).
// It is the cross-engine "common catalog" — not a unified WAL format.
type Manifest struct {
	Version      int       `json:"version"`
	CreatedAt    time.Time `json:"created_at"`
	AgentName    string    `json:"agent_name,omitempty"`
	AgentVersion string    `json:"agent_version,omitempty"`

	Engine     string `json:"engine"`
	Kind       string `json:"kind"`
	BackupType string `json:"backup_type,omitempty"`

	ObjectKey    string `json:"object_key"`
	SizeBytes    int64  `json:"size_bytes,omitempty"`
	Encrypted    bool   `json:"encrypted"`
	ContentType  string `json:"content_type,omitempty"`
	OriginalExt  string `json:"original_ext,omitempty"`

	ChainID  string `json:"chain_id,omitempty"`
	Sequence int    `json:"sequence,omitempty"`
	BaseKey  string `json:"base_key,omitempty"`
	BaseHash string `json:"base_hash,omitempty"`

	RangeStart *time.Time `json:"range_start,omitempty"`
	RangeEnd   *time.Time `json:"range_end,omitempty"`

	DestMode string `json:"dest_mode,omitempty"`
	Notes    string `json:"notes,omitempty"`
}

// ChainState is persisted under the agent work dir for incremental/PITR planning.
type ChainState struct {
	ChainID     string    `json:"chain_id"`
	Engine      string    `json:"engine"`
	LastFullAt  time.Time `json:"last_full_at,omitempty"`
	LastFullKey string    `json:"last_full_key,omitempty"`
	LastIncrAt  time.Time `json:"last_incr_at,omitempty"`
	LastIncrKey string    `json:"last_incr_key,omitempty"`
	Sequence    int       `json:"sequence"`
	BaseHash    string    `json:"base_hash,omitempty"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// NormalizeKind maps backup_type to a catalog kind.
func NormalizeKind(backupType string) string {
	t := strings.ToLower(strings.TrimSpace(backupType))
	switch t {
	case "schema", "schema-only", "ddl":
		return KindSchema
	case "incremental", "incr":
		return KindIncr
	case "differential", "diff":
		return KindDiff
	case "log", "wal", "binlog", "oplog":
		return KindLog
	default:
		return KindFull
	}
}

// ContentTypeForExt returns a coarse MIME hint from file extension.
func ContentTypeForExt(path string) string {
	base := strings.ToLower(path)
	switch {
	case strings.HasSuffix(base, ".sql.gz"), strings.HasSuffix(base, ".sql"):
		return "application/sql"
	case strings.HasSuffix(base, ".rdb"):
		return "application/x-redis-rdb"
	case strings.HasSuffix(base, ".tar.gz"), strings.HasSuffix(base, ".tgz"):
		return "application/gzip"
	case strings.HasSuffix(base, ".db.gz"), strings.HasSuffix(base, ".db"):
		return "application/x-sqlite3"
	case strings.HasSuffix(base, ".vbenc"):
		return "application/octet-stream"
	default:
		return "application/octet-stream"
	}
}

// OriginalExt returns the extension of the dump before .vbenc, if any.
func OriginalExt(path string) string {
	base := filepath.Base(path)
	lower := strings.ToLower(base)
	if strings.HasSuffix(lower, ".vbenc") {
		base = strings.TrimSuffix(base, ".vbenc")
		base = strings.TrimSuffix(base, ".VBENC")
		lower = strings.ToLower(base)
	}
	for _, suf := range []string{".sql.gz", ".tar.gz", ".db.gz", ".sql", ".rdb", ".dump", ".bak", ".gz", ".zip", ".db"} {
		if strings.HasSuffix(lower, suf) {
			return suf
		}
	}
	return filepath.Ext(base)
}

// ManifestPath returns local path for a sidecar next to payloadPath.
func ManifestPath(payloadPath string) string {
	return payloadPath + ".manifest.json"
}

// RemoteManifestKey returns the storage key for a payload's manifest.
func RemoteManifestKey(objectKey string) string {
	return objectKey + ".manifest.json"
}

// WriteLocal writes manifest JSON to path (0644).
func WriteLocal(path string, m Manifest) error {
	if m.Version == 0 {
		m.Version = FormatVersion
	}
	if m.CreatedAt.IsZero() {
		m.CreatedAt = time.Now().UTC()
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

// ReadLocal loads a manifest from path.
func ReadLocal(path string) (Manifest, error) {
	var m Manifest
	b, err := os.ReadFile(path)
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return m, err
	}
	return m, nil
}

// ChainPath is workDir/chain.json.
func ChainPath(workDir string) string {
	return filepath.Join(workDir, "chain.json")
}

// LoadChain reads chain state; missing file → empty state, nil error.
func LoadChain(workDir string) (ChainState, error) {
	var st ChainState
	b, err := os.ReadFile(ChainPath(workDir))
	if err != nil {
		if os.IsNotExist(err) {
			return st, nil
		}
		return st, err
	}
	if err := json.Unmarshal(b, &st); err != nil {
		return st, err
	}
	return st, nil
}

// SaveChain writes chain state.
func SaveChain(workDir string, st ChainState) error {
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return err
	}
	st.UpdatedAt = time.Now().UTC()
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(ChainPath(workDir), b, 0o644)
}

// NewManifest builds a manifest after a successful dump/upload.
func NewManifest(agentName, agentVersion, engine, backupType, objectKey string, size int64, encrypted bool, destMode, dumpPath string) Manifest {
	kind := NormalizeKind(backupType)
	ext := OriginalExt(dumpPath)
	if dumpPath == "" {
		ext = OriginalExt(objectKey)
	}
	return Manifest{
		Version:      FormatVersion,
		CreatedAt:    time.Now().UTC(),
		AgentName:    agentName,
		AgentVersion: agentVersion,
		Engine:       db.NormalizeType(engine),
		Kind:         kind,
		BackupType:   backupType,
		ObjectKey:    objectKey,
		SizeBytes:    size,
		Encrypted:    encrypted,
		ContentType:  ContentTypeForExt(dumpPath),
		OriginalExt:  ext,
		DestMode:     destMode,
		Notes:        restoreHint(db.NormalizeType(engine), kind),
	}
}

func restoreHint(engine, kind string) string {
	switch engine {
	case "postgres", "cockroach":
		if kind == KindSchema {
			return "Apply SQL DDL with psql. Full data restore uses the SQL dump (not pg_wal PITR)."
		}
		return "Restore: decrypt if needed, gunzip, apply with psql. PITR via pg_wal is not included in this object."
	case "mysql":
		return "Restore: decrypt if needed, gunzip, apply with mysql client. Binlog PITR is not included in this object."
	case "mssql":
		return "Logical dump — apply with sqlcmd/SSMS tools as appropriate. Native .bak / log chain not in this object."
	case "mongodb":
		return "Restore with mongorestore or extract archive per dump layout."
	case "redis":
		return "RDB/snapshot style — replace dump.rdb or use redis-cli tooling as applicable."
	case "sqlite":
		return "Replace or open the SQLite file after decrypt/decompress."
	default:
		return "Decrypt if encrypted, then restore with engine-native tools for this format."
	}
}

// UpdateChainAfterFull records a successful full/schema backup as chain base.
func UpdateChainAfterFull(workDir, engine, objectKey, baseHash string) (ChainState, error) {
	st, err := LoadChain(workDir)
	if err != nil {
		return st, err
	}
	if st.ChainID == "" {
		st.ChainID = fmt.Sprintf("%s-%d", strings.ReplaceAll(engine, "/", "-"), time.Now().Unix())
	}
	st.Engine = engine
	st.LastFullAt = time.Now().UTC()
	st.LastFullKey = objectKey
	st.Sequence++
	st.BaseHash = baseHash
	if err := SaveChain(workDir, st); err != nil {
		return st, err
	}
	return st, nil
}
