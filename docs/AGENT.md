# Desktop agent guide

## Role

The agent runs **on the machine that can see the database** (office PC, server, LAN). It dumps, optionally encrypts, and uploads to **your** storage. The Worker is the control plane (token, license, heartbeats)—not the place large private DB dumps should go.

## Install

See [INSTALL.md](../INSTALL.md). Preferred Windows path: **MSI**.

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
3. Paste token (server URL is built-in)  
4. Database type + connection  
5. Destination (local or S3-compatible)  
6. **Save** → **Test license** → **Run backup now**  

## Config & secrets

- Default config path: `config.yaml` (JSON envelope on disk after save)  
- Secrets are **sealed at rest** (see [SECURITY.md](SECURITY.md))  
- Key file: `./data/agent.key` (or `security.key_file`)  
- UI never echoes raw secrets; blank password/token on save keeps existing values  

## Web UI

- Guided setup (token → database → destination → review)  
- Status, history, run-once  
- Flags: `--webui`, `--webui-password`, `--no-webui` (see [RUN.md](../RUN.md))  

## License

- Server hardcoded: `https://backup.enadoctemp.workers.dev`  
- **72-hour** offline grace after a successful check-in  
- New hardware / major reinstall → new agent token  

## Service mode

Production should run as a service / scheduled task so backups continue without a logged-in user. Scripts: `scripts/install-*.sh` / `install-windows.ps1`. MSI registers Windows integration at install.

See also: [STORAGE.md](STORAGE.md) · [CAPABILITIES.md](../CAPABILITIES.md)
