# VaultBackup Desktop Agent (Go)

Cross-platform agent that **backs up a local database on a schedule**, **uploads** the dump (S3/R2/B2, VaultBackup Worker, or local disk), and exposes a **local Web UI** for easy setup.

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

Always install via the official scripts so the agent survives crashes and reboots:

```bash
# Linux (systemd)
sudo ./scripts/install-linux.sh ./vaultbackup-agent-linux-amd64

# macOS (launchd)
sudo ./scripts/install-macos.sh ./vaultbackup-agent-darwin-arm64

# Windows (Admin PowerShell)
.\scripts\install-windows.ps1 -BinaryPath .\vaultbackup-agent-windows-amd64.exe
```

After install:
1. Edit the generated `config.yaml` (absolute paths already set).
2. Open http://127.0.0.1:8787 → **Test license** → confirm “License OK”.
3. Set `notify.webhook_url` for critical-error alerts.
4. Restart the service.

## License / offline

Agent must phone home at least once every **72 hours**. Within that window it can run offline. After the grace period expires (or on token/fingerprint mismatch) backups are **blocked** until contact is restored.

- Set `license.check_every_hours: 6` (or lower) so problems surface early.
- Monitor the console for agents that stay Offline > 48 h.
- Device fingerprint is permanent; hardware change or major OS reinstall requires a **new** agent token.

## Security

- Web UI defaults to **127.0.0.1**; LAN bind (`0.0.0.0`) requires `-webui-password` / `WEBUI_PASSWORD`
- Optional AES-256-GCM encryption before upload
- Agent token binds to one device fingerprint
- Disk preflight (≥ 512 MB free under `work_dir`)
- Single-flight backup lock

## Build

```bash
make build
make release
```
