package upload

// Mode describes a supported direct-to-storage destination.
type Mode struct {
	ID        string   `json:"id"`
	Label     string   `json:"label"`
	Direct    bool     `json:"direct"` // true = agent writes to storage without Worker
	Providers []string `json:"providers,omitempty"`
	Notes     string   `json:"notes,omitempty"`
}

// Modes returns the storage modules built into the agent.
// Backups always go directly from the agent to these targets.
// The control-plane Worker is license-only and is never a data plane.
func Modes() []Mode {
	return []Mode{
		{
			ID:     "local",
			Label:  "Local disk",
			Direct: true,
			Notes:  "Writes to a folder on this machine (or mounted network path).",
		},
		{
			ID:        "s3",
			Label:     "S3 compatible",
			Direct:    true,
			Providers: []string{"AWS S3", "Cloudflare R2", "Backblaze B2", "Wasabi", "MinIO", "Google Cloud Storage (XML API)", "Any S3-compatible"},
			Notes:     "SigV4. Custom endpoint uses path-style. Multipart for objects >= 64 MiB (8 MiB parts).",
		},
		{
			ID:     "azure",
			Label:  "Azure Blob",
			Direct: true,
			Notes:  "Shared Key auth. Block blob staging for objects >= 64 MiB (8 MiB blocks). Optional custom endpoint.",
		},
		{
			ID:     "webdav",
			Label:  "WebDAV / NAS",
			Direct: true,
			Notes:  "Single HTTP PUT with optional Basic auth (60m client timeout). Prefer S3/Azure for multi-GB. MKCOL ensures collection exists.",
		},
		{
			ID:     "sftp",
			Label:  "SFTP",
			Direct: true,
			Notes:  "Password or private key. Creates remote path when missing.",
		},
	}
}
