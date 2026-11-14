# VaultBackup Desktop Agent — run guide

**Downloads:** https://backup.enadoctemp.workers.dev/install  
**Console:** https://backup.enadoctemp.workers.dev/  
**Support:** [docs/SUPPORT.md](docs/SUPPORT.md)  
**Docs:** [docs/README.md](docs/README.md)

## Quick start

1. In the VaultBackup console, create an **agent token** (copy once).
2. Install or run the agent for your OS:

```bash
# Windows MSI (recommended — run elevated)
msiexec /i vaultbackup-agent-windows-amd64.msi

# Windows EXE
.\vaultbackup-agent-windows-amd64.exe -webui 127.0.0.1:8787

# Linux
chmod +x ./vaultbackup-agent-linux-amd64
./vaultbackup-agent-linux-amd64 -webui 127.0.0.1:8787

# macOS Apple Silicon
chmod +x ./vaultbackup-agent-darwin-arm64
./vaultbackup-agent-darwin-arm64 -webui 127.0.0.1:8787
```

3. Open http://127.0.0.1:8787
4. Wizard: Welcome (token + EULA) → **Test** database → **Test** destination → Save → Check license → Run backup once

License server URL is built in (`https://backup.enadoctemp.workers.dev`).

## Flags

| Flag | Default | Meaning |
|------|---------|---------|
| `-config` / `--config` | `config.yaml` | Config path |
| `-webui` / `--webui` | `127.0.0.1:8787` | Web UI listen address |
| `-webui-password` | | Optional UI password (or `WEBUI_PASSWORD`) |
| `-no-webui` / `--no-webui` | false | Disable Web UI |
| `-once` / `--once` | false | One backup then exit (license is checked on cold start) |
| `-type` | | Override backup type for this run (`full` / `schema`) |
| `-restore` | | Path or storage key of a backup to restore |
| `-restore-out` | | Output path for decrypted restore |

Staging only: `VAULTBACKUP_SERVER_URL=https://...`

### Example restore (CLI)

```bash
# Local encrypted file
./vaultbackup-agent -config /etc/vaultbackup/config.yaml \
  -restore /var/lib/vaultbackup/backups/backup.sql.gz.enc \
  -restore-out /tmp/restored.sql.gz

# Or use the Web UI: Review → Stored backups → Restore
```

## Service install (production)

```bash
# Linux (systemd)
sudo ./scripts/install-linux.sh ./vaultbackup-agent-linux-amd64
# optional .deb: agent/packaging/linux/build-deb.sh

# macOS (launchd)
sudo ./scripts/install-macos.sh ./vaultbackup-agent-darwin-arm64

# Windows (Admin PowerShell)
.\scripts\install-windows.ps1 -BinaryPath .\vaultbackup-agent-windows-amd64.exe

# Windows MSI
msiexec /i vaultbackup-agent-windows-amd64.msi
```

Post-install: open UI → complete tests → Save → Check license → confirm service is running.

## License / offline / device bind

- Agent must check in at least every **72 hours**. After grace expires, scheduled backups are blocked until license OK again.
- Each token binds to **one device fingerprint** on first success. Moving machines: console → agent → **Unbind**, or create a new token.
- `-once` works without a prior Web UI session (license is checked on cold start).

## Security notes

- Default Web UI is **localhost only**
- LAN bind should use `--webui-password`
- **Config secrets are sealed at rest** (AES-256-GCM + `agent.key`) — protect both files
- Optional AES-256-GCM encryption of backup files before upload to your storage
- Use absolute paths for `work_dir`, `log_file`, and `key_file`
- Retention never deletes `agent.key`, logs, or history from the work directory

Details: [docs/SECURITY.md](docs/SECURITY.md) · [docs/AGENT.md](docs/AGENT.md)

See also: [INSTALL.md](INSTALL.md) · [CAPABILITIES.md](CAPABILITIES.md) · [docs/SUPPORT.md](docs/SUPPORT.md)
