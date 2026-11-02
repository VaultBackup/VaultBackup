# Sync status

## On `main` (current)

| Item | Status |
|------|--------|
| Full `worker.js` | **Present** (~415 KB) — Cloudflare Worker source |
| Agent Go source `agent/` | Present |
| Embedded agent Web UI | `agent/internal/webui/embed.go` |
| Config examples | `config.example.yaml`, `agent/packaging/windows/config.example.json` |
| Platform agent binaries | Present (CI) |
| **Windows MSI** | **Present** — `vaultbackup-agent-windows-amd64.msi`, `vaultbackup-agent-1.2.3-x64.msi` |
| Docs | README, INSTALL, RUN, CAPABILITIES updated for MSI + downloads |

## CI

`.github/workflows/build-agents.yml`:

- Ubuntu: builds all platform binaries, race-safe push
- Windows: WiX MSI build, race-safe push

## Live site

Public console: https://backup.enadoctemp.workers.dev/  
Install / downloads: https://backup.enadoctemp.workers.dev/install

After changing `worker.js` locally, deploy with:

```bash
npx wrangler deploy
```

Worker download routes (after deploying an MSI-aware `worker.js`):

| Route | Artifact |
|-------|----------|
| `/download/windows-msi` | `vaultbackup-agent-windows-amd64.msi` |
| `/download/windows-amd64` | `vaultbackup-agent-windows-amd64.exe` |
| `/download/windows-arm64` | `vaultbackup-agent-windows-arm64.exe` |
| `/download/darwin-arm64` | `vaultbackup-agent-darwin-arm64` |
| `/download/darwin-amd64` | `vaultbackup-agent-darwin-amd64` |
| `/download/linux-amd64` | `vaultbackup-agent-linux-amd64` |
| `/download/linux-arm64` | `vaultbackup-agent-linux-arm64` |

Binaries are served via `GH_TOKEN` (private repo read) or R2 objects under `agents/`.

## Optional / low priority

| Item | Notes |
|------|--------|
| Standalone `vaultbackup-agent-ui-enhanced.html` | Prefer embedded UI in the agent binary |
| Branding `icon.ico` in `agent/packaging/windows/` | CI can synthesize a minimal icon if missing; commit a real icon for production MSI |
