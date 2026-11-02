# VaultBackup

Inexpensive encrypted **database backups** for SMBs and accounting firms — to **your own** storage (S3, Backblaze B2, Wasabi, Cloudflare R2, Azure, WebDAV, local disk) plus a **desktop agent** for private office databases.

**Live console & downloads:** [https://backup.enadoctemp.workers.dev/](https://backup.enadoctemp.workers.dev/)  
**Install guide:** [https://backup.enadoctemp.workers.dev/install](https://backup.enadoctemp.workers.dev/install)

> This repository is **private**. End users download agent binaries from the public Worker, not from GitHub.

---

## What’s in this repo

| Path | Purpose |
|------|---------|
| `worker.js` | Full Cloudflare Worker (console, API, scheduler, agent license) |
| `agent/` | Go desktop agent source |
| `vaultbackup-agent-*.exe` / platform binaries | CI-built agent binaries |
| `vaultbackup-agent-windows-amd64.msi` | Windows installer (MSI) |
| `vaultbackup-agent-1.2.3-x64.msi` | Versioned MSI copy |
| `.github/workflows/build-agents.yml` | Builds binaries + MSI on `agent/**` changes |
| `config.example.yaml` | Agent config template |
| `CAPABILITIES.md` / `RUN.md` / `INSTALL.md` | Operator docs |

---

## Public downloads (via Worker)

| Platform | URL |
|----------|-----|
| **Windows MSI (recommended)** | https://backup.enadoctemp.workers.dev/download/windows-msi |
| Windows x64 EXE | https://backup.enadoctemp.workers.dev/download/windows-amd64 |
| Windows ARM64 EXE | https://backup.enadoctemp.workers.dev/download/windows-arm64 |
| macOS Apple Silicon | https://backup.enadoctemp.workers.dev/download/darwin-arm64 |
| macOS Intel | https://backup.enadoctemp.workers.dev/download/darwin-amd64 |
| Linux x64 | https://backup.enadoctemp.workers.dev/download/linux-amd64 |
| Linux ARM64 | https://backup.enadoctemp.workers.dev/download/linux-arm64 |

Full guide: [INSTALL.md](INSTALL.md) · [RUN.md](RUN.md) · [CAPABILITIES.md](CAPABILITIES.md)

### Windows MSI

```text
msiexec /i vaultbackup-agent-windows-amd64.msi
# optional: msiexec /i vaultbackup-agent-windows-amd64.msi WEBUIPASSWORD=secret
```

Then open `http://127.0.0.1:8787`, paste the agent token, choose database and storage.

---

## Quick start (end user)

1. Sign in at https://backup.enadoctemp.workers.dev/
2. **Desktop Agents** → **Create token** (copy once)
3. Download from https://backup.enadoctemp.workers.dev/install
4. Run the agent Web UI (`127.0.0.1:8787`), paste the token, save, run a test backup

License server is built into the agent: `https://backup.enadoctemp.workers.dev` (72-hour offline grace).

---

## Operator: public downloads

The Worker serves binaries from this private repo (GitHub Contents API) or from R2:

```bash
wrangler secret put GH_TOKEN   # GitHub token with Contents: Read on this repo
# optional vars: GH_OWNER, GH_REPO, GH_BRANCH
```

Or upload under R2 key prefix `agents/`:

- `agents/vaultbackup-agent-windows-amd64.exe`
- `agents/vaultbackup-agent-windows-amd64.msi`
- `agents/vaultbackup-agent-1.2.3-x64.msi`
- …same names as repo root binaries

---

## Cloudflare Worker

```bash
# wrangler.toml: main = "worker.js"
npx wrangler deploy
```

Requires KV (`backup_kv`), `ENCRYPTION_KEY`, optional R2 (`BACKUP_BUCKET`), cron every 5 minutes for scheduled cloud backups. See the SETUP header in `worker.js`.

---

## Build agent from source

```bash
cd agent
go build -ldflags="-s -w -X main.version=1.2.3" -o vaultbackup-agent ./cmd/agent
```

Cross-compile examples:

```bash
GOOS=windows GOARCH=amd64 go build -o vaultbackup-agent-windows-amd64.exe ./cmd/agent
GOOS=linux   GOARCH=amd64 go build -o vaultbackup-agent-linux-amd64 ./cmd/agent
```

### MSI (Windows + WiX Toolset v3)

```powershell
cd agent\packaging\windows
.\build-msi.ps1 -Version 1.2.3
```

---

## CI

`.github/workflows/build-agents.yml`:

- **Ubuntu job** — builds Linux / macOS / Windows EXEs and commits them to repo root
- **Windows job** — installs WiX, builds `vaultbackup-agent-*-x64.msi` + `vaultbackup-agent-windows-amd64.msi`, commits them
- Race-safe push (rebase + retry) so both jobs can land on `main`

Triggers: changes under `agent/**`, the workflow file, or manual `workflow_dispatch`.

---

## Agent capabilities (summary)

- **OS:** Windows, macOS, Linux
- **Databases:** PostgreSQL, MySQL/MariaDB, SQL Server, MongoDB, Redis, SQLite/Turso, files, custom command
- **Destinations:** local folder, S3-compatible (R2/B2/Wasabi/MinIO), Azure, WebDAV, SFTP, Worker upload API
- **Local Web UI** on `127.0.0.1:8787` (setup wizard, status, history)
- Heartbeats, license check, optional AES-256-GCM encryption

Details: [CAPABILITIES.md](CAPABILITIES.md)

---

## Docs map

| Doc | Content |
|-----|---------|
| [INSTALL.md](INSTALL.md) | End-user install |
| [RUN.md](RUN.md) | Flags, service install, offline license |
| [CAPABILITIES.md](CAPABILITIES.md) | Engines, destinations, safety |
| [SYNC_LARGE_FILES.md](SYNC_LARGE_FILES.md) | Large-file / API notes |
| `agent/packaging/windows/` | WiX source + `build-msi.ps1` |
