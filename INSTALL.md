# VaultBackup Desktop Agent — Install Guide

**Public page:** https://backup.enadoctemp.workers.dev/install

The agent source repository is **private**. Binaries are still available to everyone through the Worker download endpoints below (Worker proxies GitHub with a token, or serves files from R2).

License server URL is **built into the binary** (`https://backup.enadoctemp.workers.dev`). You only need an **agent token** from the dashboard.

---

## Download

| Platform | Download |
|----------|----------|
| Windows x64 | https://backup.enadoctemp.workers.dev/download/windows-amd64 |
| Windows ARM64 | https://backup.enadoctemp.workers.dev/download/windows-arm64 |
| macOS Apple Silicon | https://backup.enadoctemp.workers.dev/download/darwin-arm64 |
| macOS Intel | https://backup.enadoctemp.workers.dev/download/darwin-amd64 |
| Linux x64 | https://backup.enadoctemp.workers.dev/download/linux-amd64 |
| Linux ARM64 | https://backup.enadoctemp.workers.dev/download/linux-arm64 |

Or open the full guide: https://backup.enadoctemp.workers.dev/install

---

## Create a token

1. Open https://backup.enadoctemp.workers.dev/ and sign in.
2. Under **Desktop Agents**, click **Create token**.
3. Copy the token (shown only once).

---

## Run

### Linux / macOS

```bash
curl -fsSL -o vaultbackup-agent https://backup.enadoctemp.workers.dev/download/linux-amd64
chmod +x vaultbackup-agent
./vaultbackup-agent --webui 127.0.0.1:8787
```

Open http://127.0.0.1:8787 → paste the agent token → database + destination → **Save** → **Test license** → **Run backup now**.

### Windows

Download https://backup.enadoctemp.workers.dev/download/windows-amd64 then:

```text
vaultbackup-agent-windows-amd64.exe --webui 127.0.0.1:8787
```

---

## Worker setup (operators)

Because the GitHub repo is private, the Worker must be able to fetch binaries:

```bash
# Classic PAT or fine-grained token with Contents: Read on VaultBackup/VaultBackup
wrangler secret put GH_TOKEN
```

Optional vars: `GH_OWNER`, `GH_REPO`, `GH_BRANCH` (defaults: VaultBackup / VaultBackup / main).

**Alternative:** upload each binary to R2 at `agents/vaultbackup-agent-linux-amd64` (etc.). R2 is tried first; no `GH_TOKEN` needed if all six files are present.

---

## Flags

```text
--config path/to/config.yaml
--webui 127.0.0.1:8787
--webui-password SECRET
--once
--no-webui
```

---

## Verify

- Dashboard → **Desktop Agents** shows **Live** within a few seconds.
- Local UI license check succeeds.
- Run a test backup from the agent UI.
