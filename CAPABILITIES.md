# VaultBackup Agent — capability matrix

**Version:** 1.2.9+  
**Downloads:** https://backup.enadoctemp.workers.dev/install  
**Windows MSI:** https://backup.enadoctemp.workers.dev/download/windows-msi  
**Support:** [docs/SUPPORT.md](docs/SUPPORT.md)

## Operating systems

| OS | Build | Service installer | Secrets on disk | Locked files |
|----|-------|-------------------|-----------------|--------------|
| Linux | `GOOS=linux` | `scripts/install-linux.sh` (systemd), optional `.deb` | Sealed config + `0600` key | N/A |
| Windows | `GOOS=windows` | **MSI** + `scripts/install-windows.ps1` | Sealed config + key file | VSS (`use_vss`) |
| macOS | `GOOS=darwin` | `scripts/install-macos.sh` (launchd), optional `.pkg` | Sealed config + key file | N/A |

Same binary behavior: **schedule → dump → encrypt (optional) → upload to your storage**.

### Published artifacts

| Artifact | Notes |
|----------|--------|
| `vaultbackup-agent-windows-amd64.msi` | WiX MSI (x64) — preferred Windows install |
| `vaultbackup-agent-windows-amd64.exe` / `-arm64.exe` | Portable Windows |
| `vaultbackup-agent-darwin-amd64` / `-arm64` | macOS |
| `vaultbackup-agent-linux-amd64` / `-arm64` | Linux |

CI: `.github/workflows/build-agents.yml`.

## Size limits (agent vs Worker)

| Path | Limit |
|------|--------|
| **Desktop agent** | **No hard MB/GB dump cap.** Needs free disk ≈ **2× compressed dump** (dump + encrypt temp). Preflight blocks if work dir has **< 512 MB** free. |
| **S3 / R2 / B2 / Wasabi** | Multipart (≥ 64 MB), 8 MiB parts — multi‑GB objects supported |
| **Azure Blob** | Block upload (≥ 64 MB), 8 MiB blocks — large objects supported |
| **Local / SFTP** | Free disk / session stability |
| **WebDAV** | ≥ 64 MiB: Nextcloud chunked (auto-detect), Content-Range PUT (Apache/NAS), SabreDAV PATCH append; else single PUT |
| **Worker console dumps** | **~20 MB** hard (Worker memory); public hosts only |

For multi‑GB MySQL/Postgres, prefer **native tools** (`PreferNativeTools`) when installed.

## Local Web UI (`127.0.0.1:8787`)

- Setup wizard: Welcome → Database (**test required**) → Destination (**test required**) → Review
- Save is blocked until **both** connection tests pass
- One-time **EULA** acceptance (re-prompt only when terms version changes)
- Live status (includes **disk free MB**), detailed history, **Stored backups** (list / restore / delete)
- Secrets masked on read; blank fields keep previous values on save
- Optional `--webui-password`; CSP-hardened UI

## Config secrets

Sensitive fields (license token, DB URI, storage keys/passwords) are stored in a **sealed envelope** (AES-256-GCM) with key file `security.key_file` (default under work dir). Legacy plaintext configs still load and re-seal on next Save. See [docs/SECURITY.md](docs/SECURITY.md).

## Databases (`database.type`)

Most engines use **built-in pure-Go dumps** first (no `mysqldump` / `pg_dump` required). Native tools are optional fallback when configured.

| Type | Built-in / tool | full | schema-only | Notes |
|------|-----------------|------|-------------|--------|
| sqlite / turso / libsql | Built-in / file | yes | N/A | File copy path |
| postgres / postgresql | Built-in; optional `pg_dump` | yes | yes | Prefer `127.0.0.1` over `localhost` |
| cockroach / cockroachdb | Postgres-compatible path | yes | yes | |
| mysql / mariadb | Built-in; optional `mysqldump` | yes | yes | TCP recommended; large dumps: no read timeout |
| mssql / sqlserver | Built-in / sqlcmd | yes | limited | |
| mongodb / mongo | Built-in / mongodump | yes | limited | |
| redis | Built-in / redis-cli | yes | N/A | Snapshot-style |
| oracle | `expdp` / `exp` / RMAN helper | yes | tool-dependent | **Logical only** — not full RMAN product |
| files / quickbooks / sage50 / access | File archive / copy | yes | N/A | Best on Windows for some app paths |
| as400 | SSH SAVLIB/SAVOBJ or `file:.savf` | yes | N/A | Needs SSH authority on IBM i; not full BRMS |
| command / custom | Allowlisted argv; shell off by default | yes | your script | `VAULTBACKUP_ALLOW_SHELL_COMMAND=1` for shell |

Not claimed as full enterprise coverage for AS/400 BRMS/SAVSYS or Oracle physical RMAN fleets.

## Destinations (direct upload)

Backup data is written **directly** to your storage. The Worker is used for **license / control plane only** — not as a transit path for dump bytes.

| Mode | Notes |
|------|--------|
| `local` | Folder on disk |
| `s3` | AWS S3 + S3-compatible (R2, B2, MinIO, Wasabi); multipart large files |
| `azure` | Azure Blob (Shared Key); block upload for large files |
| `webdav` | WebDAV with large-file fallbacks (Nextcloud chunked / Content-Range / SabreDAV PATCH) |
| `sftp` | SFTP (password or key file) |

Aliases: `r2`, `b2`, `minio`, `wasabi` → `s3`; `azureblob` → `azure`.  

Object operations on all modes: **List**, **Get** (restore), **Delete**, retention.  
Presets: [docs/STORAGE.md](docs/STORAGE.md).

## Safety

- Disk space preflight before dump (≥ 512 MB free on work dir)
- Single-flight backup lock
- 72h offline license grace
- Optional AES-256-GCM file encryption before upload (streaming)
- Device fingerprint binding (one token ↔ one device)
- Config secrets not stored as plaintext JSON
- Retention skips `agent.key`, logs, and history files
- Stable error codes on history + events (`LICENSE_BLOCKED`, `DISK_FULL`, …)
- Webhook notify on failure **and** success when configured

## Build

```bash
cd agent
go test ./internal/config/ ./internal/errcode/
GOOS=linux   GOARCH=amd64 go build -o ../vaultbackup-agent-linux-amd64 ./cmd/agent
GOOS=windows GOARCH=amd64 go build -o ../vaultbackup-agent-windows-amd64.exe ./cmd/agent
GOOS=darwin  GOARCH=arm64 go build -o ../vaultbackup-agent-darwin-arm64 ./cmd/agent
```

See: [INSTALL.md](INSTALL.md) · [RUN.md](RUN.md) · [docs/README.md](docs/README.md) · [docs/SUPPORT.md](docs/SUPPORT.md)


### Backup completeness and restore guarantees

- Incremental and differential modes are rejected until the agent has durable chain metadata, chain-aware retention, and chain restore tests. Configure full backups instead.
- The built-in PostgreSQL and MySQL dump paths are logical table/data exporters, not complete substitutes for `pg_dump` or `mysqldump`. They do not guarantee preservation of every engine object, permission, extension, trigger, routine, sequence, or database-specific feature. For production recovery requirements, enable `PreferNativeTools` and install the matching vendor CLI, then validate a restore on the target engine.
- A successful upload read-back checksum proves that the remote object matches the local bytes. It does not prove that the dump is transactionally consistent or restorable. Maintain scheduled restore drills and test application-level data after restore.
- The current automated restore smoke path decrypts an artifact; it is not yet an engine-by-engine restore certification.
