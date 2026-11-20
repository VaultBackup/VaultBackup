# Desktop agent guide

## Role

The agent runs **on the machine that can see the database** (office PC, server, LAN). It dumps, optionally encrypts, and uploads to **your** storage. The Worker is the control plane (token, license, heartbeats)—not the place large private DB dumps should go.

## Install

See [INSTALL.md](../INSTALL.md). Preferred Windows path: **MSI** (elevated). Support FAQ: [SUPPORT.md](SUPPORT.md).

| Platform | Download |
|----------|----------|
| Windows MSI | `/download/windows-msi` |
| Windows EXE x64 / ARM64 | `/download/windows-amd64`, `windows-arm64` |
| macOS | `/download/darwin-arm64`, `darwin-amd64` |
| Linux | `/download/linux-amd64`, `linux-arm64` |

Base URL: https://backup.enadoctemp.workers.dev

## First-run checklist

1. Console → **Desktop Agents** → **Create token** (copy once)  
2. Open agent UI: http://127.0.0.1:8787  
3. **Welcome** — name, schedule, paste token, accept **EULA** (first time only)  
4. **Database** — type + URI → **Test connection** (required)  
5. **Destination** — local / S3 / Azure / WebDAV / SFTP → **Test connection** (required)  
6. **Review** — both tests green → **Save** → **Check license** → **Run backup once**  
7. Confirm object under **Stored backups**

## Config & secrets

- Default config path: `config.yaml` (sealed JSON envelope on disk after save)  
- Secrets are **sealed at rest** (see [SECURITY.md](SECURITY.md))  
- Key file: under `work_dir` (or `security.key_file`) — often `agent.key`  
- UI never echoes raw secrets; blank password/token on save keeps existing values  
- Retention policies do **not** delete `agent.key`, logs, or history  

## CLI flags (summary)

Full table and examples: **[RUN.md](../RUN.md)**.

| Flag | Role |
|------|------|
| `-config` | Config path (default `config.yaml`) |
| `-webui` | UI listen address (default `127.0.0.1:8787`) |
| `-webui-password` | Optional UI basic auth (`WEBUI_PASSWORD`) |
| `-webui-tls-cert` / `-webui-tls-key` | HTTPS for the UI (env variants supported) |
| `-no-webui` | Scheduler only, no UI |
| `-once` | One backup then exit |
| `-type` | Override `full` / `schema` for this run |
| `-restore` / `-restore-out` | Decrypt a local file or destination object |
| `-self-update` | Install latest binary from the license server |

Backups (UI, schedule, and `-once`) require **EULA accepted** for the current terms version and a valid license.

## Web UI features

- Guided setup with mandatory DB + destination probes  
- Live status, rich history  
- **Stored backups:** list destination objects, restore (decrypt), delete  
- EULA text from `/api/terms`; re-accept only when terms version changes  

## License

- Server hardcoded: `https://backup.enadoctemp.workers.dev`  
- **72-hour** offline grace after a successful check-in  
- One token ↔ one device fingerprint; unbind in console to move  
- New hardware / major reinstall → new agent token or unbind  

## Service mode

Production should run as a service / scheduled task so backups continue without a logged-in user. Scripts: `scripts/install-*.sh` / `install-windows.ps1`. MSI registers Windows service at install. Linux optional `.deb`: `agent/packaging/linux/build-deb.sh`.

See also: [STORAGE.md](STORAGE.md) · [CAPABILITIES.md](../CAPABILITIES.md) · [SUPPORT.md](SUPPORT.md)
