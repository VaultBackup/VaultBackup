# Sync large local files to GitHub

These files could not be uploaded through the remote agent’s GitHub file API
(payload size limits). Copy them from your machine:

| Local artifact | Repo path | Approx size |
|----------------|-----------|-------------|
| `artifacts/worker.js` | `worker.js` | ~422 KB |
| `artifacts/vaultbackup-agent-ui-enhanced.html` | `vaultbackup-agent-ui-enhanced.html` | ~41 KB |
| `agent-source/internal/webui/embed.go` (optional full UI) | `agent/internal/webui/embed.go` | ~37 KB |

## Commands

```bash
git clone git@github.com:VaultBackup/VaultBackup.git
cd VaultBackup

# Adjust paths to your project folder
ART=/path/to/artifacts

cp "$ART/worker.js" .
cp "$ART/vaultbackup-agent-ui-enhanced.html" .

# Optional: full embedded agent dashboard (replaces compact UI on main)
# cp "$ART/agent-source/internal/webui/embed.go" agent/internal/webui/embed.go

git add worker.js vaultbackup-agent-ui-enhanced.html
git commit -m "feat: add full Cloudflare worker and enhanced agent UI HTML"
git push
```

## Already on `main`

The **agent** Go tree under `agent/` is synced (cmd, internal packages, webui
server + compact embed + base64 icons, packaging scripts). `go build ./cmd/agent`
should work without the large root files.
