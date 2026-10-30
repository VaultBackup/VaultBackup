# VaultBackup Desktop Agent v1.2.3 — run guide

## Quick start

1. In the VaultBackup console, create an **agent token**.
2. Run the binary for your OS (no config required on first launch):

```bash
# Linux
./vaultbackup-agent-linux-amd64

# macOS Apple Silicon
./vaultbackup-agent-darwin-arm64

# Windows
.\vaultbackup-agent-windows-amd64.exe
```

3. Open the Web UI (logged at startup):
   - http://127.0.0.1:8787   (default — localhost only)
4. Paste Worker URL + token → choose database + destination → **Save** → **Test license** → **Run backup now**.

## Flags

| Flag | Default | Meaning |
|------|---------|---------|
| `-config` | `config.yaml` | Config path |
| `-webui` | `127.0.0.1:8787` | Web UI listen (`0.0.0.0:8787` needs `-webui-password`) |
| `-webui-password` | | Optional UI password (or env `WEBUI_PASSWORD`) |
| `-no-webui` | false | Disable Web UI |
| `-once` | false | One backup then exit |
| `-type` | | Override backup type for this run |
| `-restore` / `-restore-out` | | Decrypt an encrypted backup file |

## Service install (production)

```bash
# Linux (systemd) — Restart=always, StartLimit protection
sudo ./scripts/install-linux.sh ./vaultbackup-agent-linux-amd64

# macOS (launchd) — KeepAlive + RunAtLoad
sudo ./scripts/install-macos.sh ./vaultbackup-agent-darwin-arm64

# Windows (Admin PowerShell) — AtStartup + daily safety-net + RestartCount 999
.\scripts\install-windows.ps1 -BinaryPath .\vaultbackup-agent-windows-amd64.exe
```

Post-install checklist:
1. Edit config.yaml → set `license.server_url` + `token` + `notify.webhook_url`
2. Open http://127.0.0.1:8787 → **Test license** → confirm “License OK”
3. Verify service is running:
   - Linux: `systemctl status vaultbackup-agent`
   - Windows: `Get-ScheduledTask -TaskName VaultBackupAgent | Get-ScheduledTaskInfo`
   - macOS: `launchctl print system/com.vaultbackup.agent`
4. Ensure the machine can reach the Worker at least every few days.

## License / offline

Agent must phone home at least once every **72 hours**. Within that window it can run offline. After grace expires (or on invalid/revoked token / fingerprint mismatch) backups are **blocked**.

Recommendations:
- `license.check_every_hours: 6` (soft preference; hard limit remains 72 h)
- Set a webhook so you are alerted on license denial or critical errors
- Monitor console for agents offline > 48 h
- Hardware change / major OS reinstall → issue a **new** agent token

## Security notes

- Default Web UI binds **localhost only** (`127.0.0.1:8787`).
- For LAN access: `-webui=0.0.0.0:8787 -webui-password=SECRET`
- Optional AES-256-GCM encryption before upload.
- Agent token binds to one device fingerprint.
- Always use absolute paths for `work_dir`, `log_file`, and `key_file`.
