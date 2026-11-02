# VaultBackup Desktop Agent v1.2.3 — run guide

**Downloads:** https://backup.enadoctemp.workers.dev/install  
**Console:** https://backup.enadoctemp.workers.dev/

## Quick start

1. In the VaultBackup console, create an **agent token**.
2. Install or run the agent for your OS:

```bash
# Windows MSI (recommended)
msiexec /i vaultbackup-agent-windows-amd64.msi

# Windows EXE
.\vaultbackup-agent-windows-amd64.exe --webui 127.0.0.1:8787

# Linux
chmod +x ./vaultbackup-agent-linux-amd64
./vaultbackup-agent-linux-amd64 --webui 127.0.0.1:8787

# macOS Apple Silicon
chmod +x ./vaultbackup-agent-darwin-arm64
./vaultbackup-agent-darwin-arm64 --webui 127.0.0.1:8787
```

3. Open the Web UI:
   - http://127.0.0.1:8787 (default — localhost only)
4. Paste the agent token → choose database + destination → **Save** → **Test license** → **Run backup now**.

The license server URL is built into the agent (`https://backup.enadoctemp.workers.dev`). You only need the token.

## Flags

| Flag | Default | Meaning |
|------|---------|---------|
| `-config` / `--config` | `config.yaml` | Config path |
| `-webui` / `--webui` | `127.0.0.1:8787` | Web UI listen (`0.0.0.0:8787` needs password) |
| `-webui-password` | | Optional UI password (or env `WEBUI_PASSWORD`) |
| `-no-webui` / `--no-webui` | false | Disable Web UI |
| `-once` / `--once` | false | One backup then exit |
| `-type` | | Override backup type for this run |
| `-restore` / `-restore-out` | | Decrypt an encrypted backup file |

Environment override (staging only): `VAULTBACKUP_SERVER_URL=https://...`

## Service install (production)

```bash
# Linux (systemd) — Restart=always, StartLimit protection
sudo ./scripts/install-linux.sh ./vaultbackup-agent-linux-amd64

# macOS (launchd) — KeepAlive + RunAtLoad
sudo ./scripts/install-macos.sh ./vaultbackup-agent-darwin-arm64

# Windows (Admin PowerShell) — AtStartup + daily safety-net + RestartCount 999
.\scripts\install-windows.ps1 -BinaryPath .\vaultbackup-agent-windows-amd64.exe

# Windows MSI already registers a service during install
msiexec /i vaultbackup-agent-windows-amd64.msi
```

Post-install checklist:

1. Open http://127.0.0.1:8787 → paste token → **Test license** → confirm “License OK”
2. Verify service is running:
   - Linux: `systemctl status vaultbackup-agent`
   - Windows: `Get-ScheduledTask -TaskName VaultBackupAgent | Get-ScheduledTaskInfo` (or Services → VaultBackup Agent after MSI)
   - macOS: `launchctl print system/com.vaultbackup.agent`
3. Ensure the machine can reach the Worker at least every few days.

## License / offline

Agent must phone home at least once every **72 hours**. Within that window it can run offline. After grace expires (or on invalid/revoked token / fingerprint mismatch) backups are **blocked**.

Recommendations:

- Prefer checking in more often when online
- Set a webhook so you are alerted on license denial or critical errors
- Monitor console for agents offline > 48 h
- Hardware change / major OS reinstall → issue a **new** agent token

## Security notes

- Default Web UI binds **localhost only** (`127.0.0.1:8787`).
- For LAN access: `--webui=0.0.0.0:8787 --webui-password=SECRET`
- Optional AES-256-GCM encryption before upload.
- Agent token binds to one device fingerprint.
- Always use absolute paths for `work_dir`, `log_file`, and `key_file`.

See also: [INSTALL.md](INSTALL.md) · [CAPABILITIES.md](CAPABILITIES.md)
