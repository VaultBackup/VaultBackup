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
| `-config` | `config.yaml` | Path to agent config (sealed JSON envelope after first save) |
| `-webui` | `127.0.0.1:8787` | Web UI listen address (`host:port`). Empty + `-no-webui` disables UI |
| `-webui-password` | *(empty)* | Optional HTTP basic-auth password for the UI. Env: `WEBUI_PASSWORD` |
| `-webui-tls-cert` | *(empty)* | PEM certificate path for HTTPS Web UI. Env: `WEBUI_TLS_CERT` or `VAULTBACKUP_WEBUI_TLS_CERT` |
| `-webui-tls-key` | *(empty)* | PEM private key path for HTTPS Web UI. Env: `WEBUI_TLS_KEY` or `VAULTBACKUP_WEBUI_TLS_KEY` |
| `-no-webui` | `false` | Disable the Web UI (scheduler + license loops still run) |
| `-once` | `false` | Run **one** backup then exit (still requires EULA accepted + valid license) |
| `-type` | *(empty)* | Override backup type for this run only (`full` or `schema`) |
| `-restore` | *(empty)* | Local path **or** destination object key of an encrypted backup to decrypt |
| `-restore-out` | *(empty)* | Output path for decrypted data (default: `<source>.decrypted`) |
| `-self-update` | `false` | Download and install the latest agent binary from the license server, then exit |

Go’s `flag` package accepts a single leading dash (`-webui`). Double-dash forms may work on some wrappers; prefer single-dash as shown.

### Environment variables

| Variable | Used for |
|----------|----------|
| `WEBUI_PASSWORD` | Default for `-webui-password` if the flag is omitted |
| `WEBUI_TLS_CERT` / `VAULTBACKUP_WEBUI_TLS_CERT` | Default for `-webui-tls-cert` |
| `WEBUI_TLS_KEY` / `VAULTBACKUP_WEBUI_TLS_KEY` | Default for `-webui-tls-key` |
| `VAULTBACKUP_SERVER_URL` | Staging only — override license server (production binaries ignore this) |

### Example: one-shot backup

```bash
./vaultbackup-agent -config /etc/vaultbackup/config.yaml -once
# optional type override:
./vaultbackup-agent -config /etc/vaultbackup/config.yaml -once -type full
```

### Example: restore (CLI)

```bash
# Local encrypted file
./vaultbackup-agent -config /etc/vaultbackup/config.yaml \
  -restore /var/lib/vaultbackup/backups/job.sql.gz.vbenc \
  -restore-out /tmp/restored.sql.gz

# Object key on the configured destination (downloaded, then decrypted)
./vaultbackup-agent -config /etc/vaultbackup/config.yaml \
  -restore backups/2026-11-19/job.sql.gz.vbenc \
  -restore-out /tmp/restored.sql.gz

# Or use the Web UI: Review → Stored backups → Restore
```

### Example: HTTPS Web UI

```bash
./vaultbackup-agent \
  -webui 0.0.0.0:8787 \
  -webui-password "$WEBUI_PASSWORD" \
  -webui-tls-cert /etc/vaultbackup/tls/cert.pem \
  -webui-tls-key /etc/vaultbackup/tls/key.pem
```

Bind on LAN only with a password (and preferably TLS). Default bind is localhost.

### Example: self-update

```bash
./vaultbackup-agent -config /etc/vaultbackup/config.yaml -self-update
# Then restart the service / process so the new binary is loaded
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

## License / offline / device bind / EULA

- Agent must check in at least every **72 hours**. After grace expires, scheduled backups are blocked until license OK again.
- Each token binds to **one device fingerprint** on first success. Moving machines: console → agent → **Unbind**, or create a new token.
- **EULA:** first-time accept in the Web UI (or re-accept when terms version changes). Until accepted for the current terms version, **UI run-once, schedule, and `-once` are blocked**.
- `-once` works without a prior interactive session only if config already has terms accepted + a valid license path.

## Security notes

- Default Web UI is **localhost only**
- LAN bind should use `-webui-password` (and ideally `-webui-tls-cert` / `-webui-tls-key`)
- **Config secrets are sealed at rest** (AES-256-GCM + `agent.key`) — protect both files
- Optional AES-256-GCM encryption of backup files before upload to your storage
- Use absolute paths for `work_dir`, `log_file`, and `key_file`
- Retention never deletes `agent.key`, logs, or history from the work directory

Details: [docs/SECURITY.md](docs/SECURITY.md) · [docs/AGENT.md](docs/AGENT.md)

See also: [INSTALL.md](INSTALL.md) · [CAPABILITIES.md](CAPABILITIES.md) · [docs/SUPPORT.md](docs/SUPPORT.md)
