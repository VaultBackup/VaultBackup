# VaultBackup Desktop Agent (Go)

Cross-platform agent that **backs up a local database on a schedule**, **uploads** the dump (S3/R2/B2, VaultBackup Worker, or local disk), and exposes a **local Web UI** for easy setup.

**Public install guide:** [INSTALL.md](INSTALL.md) · **Live downloads:** [https://backup.enadoctemp.workers.dev/install](https://backup.enadoctemp.workers.dev/install)

## Download (pre-built)

| Platform | Download |
|----------|----------|
| Windows x64 | [vaultbackup-agent-windows-amd64.exe](https://github.com/VaultBackup/VaultBackup/raw/main/vaultbackup-agent-windows-amd64.exe) |
| Windows ARM64 | [vaultbackup-agent-windows-arm64.exe](https://github.com/VaultBackup/VaultBackup/raw/main/vaultbackup-agent-windows-arm64.exe) |
| macOS Apple Silicon | [vaultbackup-agent-darwin-arm64](https://github.com/VaultBackup/VaultBackup/raw/main/vaultbackup-agent-darwin-arm64) |
| macOS Intel | [vaultbackup-agent-darwin-amd64](https://github.com/VaultBackup/VaultBackup/raw/main/vaultbackup-agent-darwin-amd64) |
| Linux x64 | [vaultbackup-agent-linux-amd64](https://github.com/VaultBackup/VaultBackup/raw/main/vaultbackup-agent-linux-amd64) |
| Linux ARM64 | [vaultbackup-agent-linux-arm64](https://github.com/VaultBackup/VaultBackup/raw/main/vaultbackup-agent-linux-arm64) |

Binaries are rebuilt by GitHub Actions whenever `agent/` changes and committed to this repo.

## Source code

Reconstructed Go source lives under [`agent/`](agent/):

```bash
cd agent
go build -o vaultbackup-agent ./cmd/agent
# or: make build / make release
```

See [`agent/SOURCE.md`](agent/SOURCE.md) for layout, package map, and notes.

## Quick start (Web UI)

1. In the VaultBackup console ([backup.enadoctemp.workers.dev](https://backup.enadoctemp.workers.dev/)), create an **agent token** under **Desktop Agents**.
2. Download the binary for your OS (table above) or open [/install](https://backup.enadoctemp.workers.dev/install).
3. Run:

```bash
./vaultbackup-agent-linux-amd64 --webui 127.0.0.1:8787
# Windows: vaultbackup-agent-windows-amd64.exe --webui 127.0.0.1:8787
```

4. Open **http://127.0.0.1:8787** → paste the **token only** (server URL is hardcoded) → database + destination → **Save** → **Test license** → **Run backup now**.

The UI is bound to **localhost only** by default. Use `-webui=0.0.0.0:8787 -webui-password=...` for LAN access, or `-no-webui` to disable it.

### Enhanced Web UI

Drop-in UI: [`vaultbackup-agent-ui-enhanced.html`](vaultbackup-agent-ui-enhanced.html) (also embedded under `agent/internal/webui`).

## Flags

| Flag | Default | Meaning |
|------|---------|---------|
| `-config` | `config.yaml` | Config path |
| `-webui` | `127.0.0.1:8787` | Web UI listen |
| `-webui-password` | | Optional UI password (or `WEBUI_PASSWORD`) |
| `-no-webui` | false | Disable Web UI |
| `-once` | false | One backup then exit |
| `-type` | | Override backup type for this run |
| `-restore` / `-restore-out` | | Decrypt an encrypted backup file |

## Live status

While running, the agent reports **OS, CPU, RAM, and DB config status** to the Worker every ~30s. The console shows **Live / Idle / Offline** plus resource bars.

## Supported sources

sqlite, postgres, mysql/mariadb, mongodb, redis, mssql, files, command

## Destinations

`local` · `s3` (R2/B2/AWS/Wasabi/MinIO) · `vaultbackup` (Worker upload) · `azure` · `webdav` · `sftp`

## License / offline

Agent must phone home at least once every **72 hours**. Within that window it can run offline. After grace expires, backups are **blocked** until contact is restored.

Hardcoded license server: `https://backup.enadoctemp.workers.dev`

## Security

- Web UI defaults to **127.0.0.1**; LAN bind requires `-webui-password`
- Optional AES-256-GCM encryption before upload
- Agent token binds to one device fingerprint
- Disk preflight and single-flight backup lock

## Build

```bash
cd agent && make build
# cross-compile:
cd agent && make release
```
