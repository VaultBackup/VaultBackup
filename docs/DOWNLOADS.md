# Public agent downloads

Install page: https://backup.enadoctemp.workers.dev/install  
End-user support: [SUPPORT.md](SUPPORT.md)

## Routes

| Path | File on `main` |
|------|----------------|
| `/download/windows-msi` | `vaultbackup-agent-windows-amd64.msi` |
| `/download/windows-amd64` | `vaultbackup-agent-windows-amd64.exe` |
| `/download/windows-arm64` | `vaultbackup-agent-windows-arm64.exe` |
| `/download/darwin-arm64` | `vaultbackup-agent-darwin-arm64` |
| `/download/darwin-amd64` | `vaultbackup-agent-darwin-amd64` |
| `/download/linux-amd64` | `vaultbackup-agent-linux-amd64` |
| `/download/linux-arm64` | `vaultbackup-agent-linux-arm64` |

## Client tip: GET vs HEAD

Use **GET** (browser Save link or `curl -L`). Some monitors use **HEAD** and may see **401** even when **GET** succeeds. Prefer:

```bash
curl -fsSL -o vaultbackup-agent \
  https://backup.enadoctemp.workers.dev/download/linux-amd64
chmod +x vaultbackup-agent
./vaultbackup-agent -h
```

## Why downloads return 401/503

The Worker serves binaries either from:

1. **R2** — object key `agents/<filename>` in `BACKUP_BUCKET` / `AGENT_BUCKET`, or
2. **GitHub Contents API** — requires Worker secret **`GH_TOKEN`** (fine-grained or classic) with `contents:read` on `VaultBackup/VaultBackup`.

Without R2 objects and without `GH_TOKEN`, `/download/*` fails.

## Fix (operators)

```bash
# Option A — Cloudflare Worker secret
wrangler secret put GH_TOKEN
# paste a GitHub PAT with repo contents read

# Option B — mirror binaries to R2
# for each artifact:
#   wrangler r2 object put agents/vaultbackup-agent-linux-amd64 --file=./vaultbackup-agent-linux-amd64
```

Optional: `GH_OWNER`, `GH_REPO`, `GH_BRANCH` (defaults: VaultBackup / VaultBackup / main).
