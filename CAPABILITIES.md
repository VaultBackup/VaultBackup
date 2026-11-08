# VaultBackup Agent — capability matrix

**Version:** 1.2.3+  
**Downloads:** https://backup.enadoctemp.workers.dev/install  
**Windows MSI:** https://backup.enadoctemp.workers.dev/download/windows-msi

## Operating systems

| OS | Build | Service installer | Secrets on disk | Locked files |
|----|-------|-------------------|-----------------|--------------|
| Linux | `GOOS=linux` | `scripts/install-linux.sh` (systemd) | Sealed config + `0600` key | N/A |
| Windows | `GOOS=windows` | **MSI** + `scripts/install-windows.ps1` | Sealed config + key file | VSS (`use_vss`) |
| macOS | `GOOS=darwin` | `scripts/install-macos.sh` (launchd) | Sealed config + key file | N/A |

Same binary behavior: **schedule → dump → encrypt (optional) → upload**.

### Published artifacts

| Artifact | Notes |
|----------|--------|
| `vaultbackup-agent-windows-amd64.msi` | WiX MSI (x64) — preferred Windows install |
| `vaultbackup-agent-1.2.3-x64.msi` | Versioned MSI copy |
| `vaultbackup-agent-windows-amd64.exe` / `-arm64.exe` | Portable Windows |
| `vaultbackup-agent-darwin-amd64` / `-arm64` | macOS |
| `vaultbackup-agent-linux-amd64` / `-arm64` | Linux |

CI: `.github/workflows/build-agents.yml`.

## Local Web UI (`127.0.0.1:8787`)

- Setup wizard (token → database → destination → review)
- Live status + history
- Secrets masked on read; blank fields keep previous values on save
- Optional `--webui-password`; CSP-hardened UI

## Config secrets

Sensitive fields (license token, DB URI, storage keys/passwords) are stored in a **version-2 sealed envelope** (AES-256-GCM) with key file `security.key_file` (default `./data/agent.key`). Legacy plaintext configs still load and re-seal on next Save. See [docs/SECURITY.md](docs/SECURITY.md).

## Databases (`database.type`)

| Type | Tool | full | incremental | differential |
|------|------|------|-------------|--------------|
| sqlite / turso / libsql | sqlite3 or file | yes | skip if unchanged | same |
| postgres / postgresql | pg_dump | yes | consistent full* | same |
| cockroach / cockroachdb | cockroach dump or pg_dump | yes | consistent full* | same |
| mysql / mariadb | mysqldump | yes | consistent full* | same |
| mssql / sqlserver | sqlcmd BACKUP | yes | DIFFERENTIAL | DIFFERENTIAL |
| mongodb / mongo | mongodump | yes | --oplog if RS | same |
| redis | redis-cli --rdb | yes | full snapshot | full |
| oracle | exp / expdp | yes | full logical* | same |
| files | tar+gzip | yes | mtime since last | mtime since full |
| command / custom | argv only; shell off by default | yes | your script | your script |

\* Without WAL/binlog/RMAN on the server, incr/diff may still produce a restorable full logical dump. Custom shell dumps require `VAULTBACKUP_ALLOW_SHELL_COMMAND=1`.

## Destinations

| Mode | Notes |
|------|--------|
| `local` | Folder on disk |
| `s3` | AWS S3 + S3-compatible (R2, B2, MinIO, Wasabi) |
| `vaultbackup` | Worker `/api/agent/upload` |
| `azure` | Azure Blob (Shared Key) |
| `webdav` | WebDAV PUT |
| `sftp` | SFTP (password or key file) |

Aliases: `r2`, `b2`, `minio`, `wasabi` → `s3`; `azureblob` → `azure`.  
Presets: [docs/STORAGE.md](docs/STORAGE.md).

## Safety

- Disk space preflight before dump
- Single-flight backup lock
- 72h offline license grace
- Optional AES-256-GCM file encryption before upload
- Device fingerprint binding
- Config secrets not stored as plaintext JSON

## Build

```bash
cd agent
go test ./internal/config/
GOOS=linux   GOARCH=amd64 go build -o ../vaultbackup-agent-linux-amd64 ./cmd/agent
GOOS=windows GOARCH=amd64 go build -o ../vaultbackup-agent-windows-amd64.exe ./cmd/agent
GOOS=darwin  GOARCH=arm64 go build -o ../vaultbackup-agent-darwin-arm64 ./cmd/agent
```

See: [INSTALL.md](INSTALL.md) · [RUN.md](RUN.md) · [docs/README.md](docs/README.md)
