# VaultBackup

Inexpensive encrypted **database backups** for SMBs and accounting firms — to **your own** storage (S3, Backblaze B2, Wasabi, Cloudflare R2, Azure, WebDAV, local disk) plus a **desktop agent** for private office databases.

**Live console & downloads:** [https://backup.enadoctemp.workers.dev/](https://backup.enadoctemp.workers.dev/)  
**Install guide:** [https://backup.enadoctemp.workers.dev/install](https://backup.enadoctemp.workers.dev/install)  
**User support / FAQ:** [docs/SUPPORT.md](docs/SUPPORT.md)

> This repository is **private**. End users download agent binaries from the public Worker, not from GitHub.

---

## What’s in this repo

| Path | Purpose |
|------|---------|
| `worker.js` | Cloudflare Worker (console, API, scheduler, agent license) |
| `agent/` | Go desktop agent source |
| `vaultbackup-agent-*` | CI-built binaries (all platforms + MSI) |
| `.github/workflows/build-agents.yml` | Multi-platform + MSI build |
| `docs/` | Product, security, storage, agent, **support** guides |
| `INSTALL.md` / `RUN.md` / `CAPABILITIES.md` | End-user and operator docs |
| `MINDMAP.md` | Architecture mindmap index |

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

---

## Quick start (end user)

1. Sign in at https://backup.enadoctemp.workers.dev/
2. **Desktop Agents** → **Create token** (copy once)
3. Download from https://backup.enadoctemp.workers.dev/install
4. Open agent UI `http://127.0.0.1:8787`
5. Welcome (token + EULA) → **Test** database → **Test** destination → Save → license → run backup
6. Use **Stored backups** to restore or delete objects on your storage

License server is built into the agent. Config **secrets are sealed at rest** (see [docs/SECURITY.md](docs/SECURITY.md)). Backup bytes go **directly** to your storage.

---

## Documentation

| Doc | Content |
|-----|---------|
| [docs/README.md](docs/README.md) | **Docs index** |
| [docs/SUPPORT.md](docs/SUPPORT.md) | **User support & troubleshooting** |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Product positioning |
| [INSTALL.md](INSTALL.md) | Install all platforms |
| [RUN.md](RUN.md) | Flags, services, offline license |
| [CAPABILITIES.md](CAPABILITIES.md) | Engines, destinations, safety |
| [docs/AGENT.md](docs/AGENT.md) | Agent config & UI |
| [docs/STORAGE.md](docs/STORAGE.md) | BYO storage presets |
| [docs/SECURITY.md](docs/SECURITY.md) | Security & sealed config |
| [docs/MINDMAP.md](docs/MINDMAP.md) | Architecture mindmap |

---

## Cloudflare Worker

```bash
npx wrangler deploy
```

Requires KV (`backup_kv`), `ENCRYPTION_KEY`, optional R2, cron every 5 minutes. Registration is **off** unless `ALLOW_REGISTRATION=true`.

---

## Build agent from source

```bash
cd agent
go build -ldflags="-s -w -X main.version=1.2.8" -o vaultbackup-agent ./cmd/agent
go test ./internal/config/   # sealed-config tests
```

CI builds Linux / macOS / Windows EXEs and Windows MSI on changes under `agent/**`.

---

## Security highlights

- Registration deny-by-default  
- Minimal public health endpoint  
- Agent config secrets: AES-256-GCM sealed envelope (not plaintext JSON)  
- Optional backup-file encryption  
- Agent Web UI CSP + sanitized API responses  
- Direct-to-storage uploads (Worker = license only)  

Details: [docs/SECURITY.md](docs/SECURITY.md)
