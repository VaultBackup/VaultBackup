# Sync status

## On `main` (pushed via API)
- **Full enhanced agent UI** in `agent/internal/webui/embed.go` (gzip+base64; decompresses at runtime to the full dashboard).
- Agent Go tree under `agent/` (cmd, packages, packaging, webui server + icons).
- Placeholder `worker.js` (replace with the real ~422 KB worker locally).

## Still push locally (too large for Contents API)

| Local artifact | Repo path | Size |
|----------------|-----------|------|
| `artifacts/worker.js` | `worker.js` | ~422 KB |
| `artifacts/vaultbackup-agent-ui-enhanced.html` | optional root copy | ~41 KB |

```bash
git clone git@github.com:VaultBackup/VaultBackup.git
cd VaultBackup
cp /path/to/artifacts/worker.js .
git add worker.js
git commit -m "feat: full Cloudflare worker"
git push
```
