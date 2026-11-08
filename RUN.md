# VaultBackup Desktop Agent — run guide

**Downloads:** https://backup.enadoctemp.workers.dev/install  
**Console:** https://backup.enadoctemp.workers.dev/  
**Docs:** [docs/README.md](docs/README.md)

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

3. Open http://127.0.0.1:8787
4. Paste token → database + destination → **Save** → **Test license** → **Run backup now**

License server URL is built in (`https://backup.enadoctemp.workers.dev`).

## Flags

| Flag | Default | Meaning |
|------|---------|---------|
| `-config` / `--config` | `config.yaml` | Config path |
| `-webui` / `--webui` | `127.0.0.1:8787` | Web UI listen |
| `-webui-password` | | Optional UI password (or `WEBUI_PASSWORD`) |
| `-no-webui` / `--no-webui` | false | Disable Web UI |
| `-once` / `--once` | false | One backup then exit |
| `-type` | | Override backup type for this run |
| `-restore` / `-restore-out` | | Decrypt an encrypted backup file |

Staging only: `VAULTBACKUP_SERVER_URL=https://...`

## Service install (production)

```bash
# Linux (systemd)
sudo ./scripts/install-linux.sh ./vaultbackup-agent-linux-amd64

# macOS (launchd)
sudo ./scripts/install-macos.sh ./vaultbackup-agent-darwin-arm64

# Windows (Admin PowerShell)
.\scripts\install-windows.ps1 -BinaryPath .\vaultbackup-agent-windows-amd64.exe

# Windows MSI
msiexec /i vaultbackup-agent-windows-amd64.msi
```

Post-install: open UI → token → Test license → confirm service running.

## License / offline

Agent must check in at least every **72 hours**. After grace expires, backups are blocked. New hardware → new agent token.

## Security notes

- Default Web UI is **localhost only**
- LAN bind requires `--webui-password`
- **Config secrets are sealed at rest** (AES-256-GCM + `agent.key`) — protect both files
- Optional AES-256-GCM encryption of backup files before upload
- Use absolute paths for `work_dir`, `log_file`, and `key_file`

Details: [docs/SECURITY.md](docs/SECURITY.md) · [docs/AGENT.md](docs/AGENT.md)

See also: [INSTALL.md](INSTALL.md) · [CAPABILITIES.md](CAPABILITIES.md)
