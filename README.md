# VaultBackup Desktop Agent (Go)

Cross-platform agent that **backs up a local database on a schedule**, **uploads** the dump, and exposes a **local Web UI** for setup.

> **This repository is private.** End users download binaries from the public Worker, not from GitHub:
>
> **https://backup.enadoctemp.workers.dev/install**

## Public downloads (via Worker)

| Platform | URL |
|----------|-----|
| Windows x64 | https://backup.enadoctemp.workers.dev/download/windows-amd64 |
| Windows ARM64 | https://backup.enadoctemp.workers.dev/download/windows-arm64 |
| macOS Apple Silicon | https://backup.enadoctemp.workers.dev/download/darwin-arm64 |
| macOS Intel | https://backup.enadoctemp.workers.dev/download/darwin-amd64 |
| Linux x64 | https://backup.enadoctemp.workers.dev/download/linux-amd64 |
| Linux ARM64 | https://backup.enadoctemp.workers.dev/download/linux-arm64 |

Full guide: [INSTALL.md](INSTALL.md)

## Operator: enable public downloads

The Worker proxies binaries out of this private repo (or serves them from R2):

```bash
wrangler secret put GH_TOKEN   # GitHub token with Contents: Read
# optional: GH_OWNER / GH_REPO / GH_BRANCH
```

Or place files in R2 under `agents/<binary-name>`.

## Source (maintainers)

```bash
cd agent
go build -o vaultbackup-agent ./cmd/agent
```

CI (`.github/workflows/build-agents.yml`) builds all six platforms on changes under `agent/` and commits the binaries to the repo root for the Worker to serve.

## Quick start

1. Dashboard → **Desktop Agents** → **Create token**
2. Download from https://backup.enadoctemp.workers.dev/install
3. Run with `--webui 127.0.0.1:8787` and paste the token (server URL is hardcoded)

## License server

Hardcoded: `https://backup.enadoctemp.workers.dev` (72h offline grace)
