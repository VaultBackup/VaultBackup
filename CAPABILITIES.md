# VaultBackup Agent — capability matrix

**Version:** 1.2.3

**Downloads:** https://backup.enadoctemp.workers.dev/install  
**Windows MSI:** https://backup.enadoctemp.workers.dev/download/windows-msi

## Operating systems

| OS | Build | Service installer | Secrets | Locked files |
|----|-------|-------------------|---------|--------------|
| Linux | `GOOS=linux` | `scripts/install-linux.sh` (systemd) | file `0600` | N/A |
| Windows | `GOOS=windows` | **MSI** + `scripts/install-windows.ps1` (Task Scheduler) | DPAPI | VSS (`use_vss`) |
| macOS | `GOOS=darwin` | `scripts/install-macos.sh` (launchd) | Keychain | N/A |

Same binary behavior: **schedule → dump → encrypt → upload**.

### Published artifacts (repo root / Worker downloads)

| Artifact | Notes |
|----------|--------|
| `vaultbackup-agent-windows-amd64.msi` | WiX MSI (x64) — preferred Windows install |
| `vaultbackup-agent-1.2.3-x64.msi` | Versioned MSI copy |
| `vaultbackup-agent-windows-amd64.exe` | Portable Windows x64 |
| `vaultbackup-agent-windows-arm64.exe` | Portable Windows ARM64 |
| `vaultbackup-agent-darwin-amd64` / `-arm64` | macOS |
| `vaultbackup-agent-linux-amd64` / `-arm64` | Linux |

CI: `.github/workflows/build-agents.yml` builds EXEs (Ubuntu) and MSI (Windows + WiX).

## Status & health

- Heartbeats every ~30s with OS/CPU/RAM/disk free
- Real DB connectivity probes (TCP / PING / file stat / tool ready)
- Last backup outcome (type, size, duration, error)
- Native tool discovery (PATH + common install roots + env overrides)
- Optional version-nag against Worker `/api/agent/version` or GitHub releases

## Local Web UI (`127.0.0.1:8787` default)

- Setup wizard (token → database → destination)
- Live status + DB health
- Backup history (last 30 runs)
- Tool presence map
- Secrets masked on read; never written back if still masked
- Optional `--webui-password`

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
| command / custom | your argv → stdout | yes | your script | your script |

\* Without WAL/binlog/RMAN on the server, incr/diff still produce a **restorable full** logical dump and maintain chain metadata. First incr/diff with no base always runs **full**.

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

## Events pushed to Worker

- `/api/agent/status` — host + DB health + last backup
- `/api/agent/logs` — critical errors + optional info lines
- `/api/agent/events` — structured `backup_finished` (success/fail + metrics)
- `/api/agent/config` — sanitized config sync
- `/api/agent/license` — license / device fingerprint check

## Safety

- Disk space preflight before dump (≥ 512 MB free under `work_dir`)
- Single-flight backup lock
- 72h offline license grace
- AES-256-GCM optional encryption
- Device fingerprint binding

## Build

```bash
cd agent
make release
# or:
GOOS=linux   GOARCH=amd64 go build -o ../vaultbackup-agent-linux-amd64 ./cmd/agent
GOOS=windows GOARCH=amd64 go build -o ../vaultbackup-agent-windows-amd64.exe ./cmd/agent
GOOS=darwin  GOARCH=arm64 go build -o ../vaultbackup-agent-darwin-arm64 ./cmd/agent
```

Windows MSI (requires WiX Toolset v3 on a Windows machine):

```powershell
cd agent\packaging\windows
.\build-msi.ps1 -Version 1.2.3
```

See also: [INSTALL.md](INSTALL.md) · [RUN.md](RUN.md) · [README.md](README.md)
