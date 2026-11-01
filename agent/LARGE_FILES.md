# Large files not pushed via API

These local artifacts exceed practical GitHub Contents API payload limits from the remote agent environment. Copy them with a normal `git` push:

| Local path | Suggested repo path | Size |
|------------|---------------------|------|
| `artifacts/vaultbackup-agent-ui-enhanced.html` | `vaultbackup-agent-ui-enhanced.html` (repo root) | ~41 KB |
| `artifacts/worker.js` | `worker.js` (repo root) | ~422 KB |
| `agent-source/internal/webui/embed.go` | `agent/internal/webui/embed.go` | ~37 KB full UI |
| `agent-source/internal/webui/assets/icon.ico` | optional branding | ~111 KB |
| `agent-source/internal/webui/assets/icon.png` | optional branding | ~11 KB |

## Quick local sync

```bash
git clone git@github.com:VaultBackup/VaultBackup.git
cd VaultBackup
cp /path/to/artifacts/worker.js .
cp /path/to/artifacts/vaultbackup-agent-ui-enhanced.html .
# optional: restore full dashboard
cp /path/to/agent-source/internal/webui/embed.go agent/internal/webui/embed.go
git add worker.js vaultbackup-agent-ui-enhanced.html agent/internal/webui/embed.go
git commit -m "chore: add worker, enhanced UI HTML, full embed"
git push
```

The agent under `agent/` already includes a **compact** `EmbeddedUI` and base64 icons so `go build ./cmd/agent` works without the binary asset files.
