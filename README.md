# VaultBackup Desktop Agent (Go)

Cross-platform agent that **backs up a local database on a schedule**, **uploads** the dump (S3/R2/B2, VaultBackup Worker, or local disk), and exposes a **local Web UI** for easy setup.

## Source code

Reconstructed Go source lives under [`agent/`](agent/):

```bash
cd agent
go build -o vaultbackup-agent ./cmd/agent
# or: make build / make release
```

See [`agent/SOURCE.md`](agent/SOURCE.md) for layout, package map, and notes.  
This tree matches the binary’s package paths (`github.com/vaultbackup/agent/...`), config, Web UI API, and CAPABILITIES — it is an open reimplementation aligned with the v1.2.3 release behavior, not a decompile of proprietary source.

## Quick start (Web UI)

1. In the VaultBackup console, create an **agent token**.
2. Run the agent binary (no config required on first launch):

```bash
./vaultbackup-agent
# Windows: vaultbackup-agent-windows-amd64.exe
```

3. Open **http://127.0.0.1:8787** in a browser.
4. Paste Worker URL + token, choose database + destination, **Save**, **Test license**, **Run backup now**.

The UI is bound to **localhost only** by default. Use `-webui=0.0.0.0:8787 -webui-password=...` for LAN access, or `-no-webui` / `-webui=""` to disable it.

### Enhanced Web UI

An improved drop-in UI is available as [`vaultbackup-agent-ui-enhanced.html`](vaultbackup-agent-ui-enhanced.html) and is embedded in the reconstructed source (`internal/webui`).

## Flags

| Flag | Default | Meaning |
|------|---------|---------|
| `-config` | `config.yaml` | Config path |
| `-webui` | `127.0.0.1:8787` | Web UI listen (`0.0.0.0` needs `-webui-password`) |
| `-webui-password` | | Optional UI password (or env `WEBUI_PASSWORD`) |
| `-no-webui` | false | Disable Web UI |
| `-once` | false | One backup then exit |
| `-type` | | Override backup type for this run |
| `-restore` / `-restore-out` | | Decrypt an encrypted backup file |

## Live status

While running, the agent reports **OS, CPU, RAM, and DB config status** to the Worker every ~30s (`POST /api/agent/status`). The console shows **Live / Idle / Offline** plus resource bars.

## Supported sources

sqlite, postgres, mysql/mariadb, mongodb, redis, mssql, files, command

## Destinations

`local` · `s3` (R2/B2/AWS/Wasabi/MinIO) · `vaultbackup` (Worker upload) · `azure` · `webdav` · `sftp`

## Service install (recommended for production)

```bash
# Linux (systemd)
sudo ./scripts/install-linux.sh ./vaultbackup-agent-linux-amd64

# macOS (launchd)
sudo ./scripts/install-macos.sh ./vaultbackup-agent-darwin-arm64

# Windows (Admin PowerShell)
.\scripts\install-windows.ps1 -BinaryPath .\vaultbackup-agent-windows-amd64.exe
```

## License / offline

Agent must phone home at least once every **72 hours**. Within that window it can run offline. After grace expires, backups are **blocked** until contact is restored.

## Security

- Web UI defaults to **127.0.0.1**; LAN bind requires `-webui-password`
- Optional AES-256-GCM encryption before upload
- Agent token binds to one device fingerprint
- Disk preflight (≥ 512 MB free under `work_dir`)
- Single-flight backup lock

## Build

```bash
cd agent && make build
# cross-compile:
cd agent && make release
```
