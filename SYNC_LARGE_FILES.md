# Sync status

## On `main` (via API)
- Agent Go source under `agent/`
- Embedded enhanced agent UI in `agent/internal/webui/embed.go`
- Config examples: `config.example.yaml`, `agent/packaging/windows/config.example.json`
- **Placeholder** `worker.js` only (returns HTTP 503)

## NOT on GitHub yet — must push locally

| File | Size | Why |
|------|------|-----|
| Full `worker.js` | ~415–422 KB | GitHub Contents API / connector cannot accept this payload |

The **live** Worker at https://backup.enadoctemp.workers.dev/ is already the full version.
GitHub `main/worker.js` is still the placeholder.

### Push the full worker from your machine

```bash
git clone git@github.com:VaultBackup/VaultBackup.git
cd VaultBackup

# Use the full source (project artifacts or the file you exported)
cp /path/to/artifacts/worker.js .
# or the pasted full worker file

git add worker.js
git commit -m "feat: full Cloudflare worker (~422 KB)"
git push origin main
```

Optional after push:

```bash
npx wrangler deploy
```

No other large artifacts are required for source-of-truth on GitHub; agent binaries are published by the Build Agent Binaries workflow.
