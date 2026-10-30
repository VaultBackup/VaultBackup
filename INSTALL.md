# VaultBackup Desktop Agent — Install Guide

Public guide also available on your Worker: **https://backup.enadoctemp.workers.dev/install**

The agent backs up local databases (PostgreSQL, MySQL, MongoDB, Redis, SQLite, files, and more), encrypts dumps, and uploads to S3-compatible storage, local disk, Azure, WebDAV, or the Worker. It reports host and database health to the dashboard.

License server URL is **built into the binary** (`https://backup.enadoctemp.workers.dev`). You only need an **agent token** from the dashboard.

---

## Download

Binaries are built by GitHub Actions on every change under `agent/` and committed to this repository:

| Platform | File |
|----------|------|
| Windows x64 | [vaultbackup-agent-windows-amd64.exe](https://github.com/VaultBackup/VaultBackup/raw/main/vaultbackup-agent-windows-amd64.exe) |
| Windows ARM64 | [vaultbackup-agent-windows-arm64.exe](https://github.com/VaultBackup/VaultBackup/raw/main/vaultbackup-agent-windows-arm64.exe) |
| macOS Apple Silicon | [vaultbackup-agent-darwin-arm64](https://github.com/VaultBackup/VaultBackup/raw/main/vaultbackup-agent-darwin-arm64) |
| macOS Intel | [vaultbackup-agent-darwin-amd64](https://github.com/VaultBackup/VaultBackup/raw/main/vaultbackup-agent-darwin-amd64) |
| Linux x64 | [vaultbackup-agent-linux-amd64](https://github.com/VaultBackup/VaultBackup/raw/main/vaultbackup-agent-linux-amd64) |
| Linux ARM64 | [vaultbackup-agent-linux-arm64](https://github.com/VaultBackup/VaultBackup/raw/main/vaultbackup-agent-linux-arm64) |

---

## Create a token

1. Open [https://backup.enadoctemp.workers.dev/](https://backup.enadoctemp.workers.dev/) and sign in.
2. Under **Desktop Agents**, click **Create token**.
3. Copy the token (shown only once).

---

## Run

### Linux / macOS

```bash
chmod +x vaultbackup-agent-linux-amd64   # or darwin-arm64, etc.
./vaultbackup-agent-linux-amd64 --webui 127.0.0.1:8787
```

Open http://127.0.0.1:8787 → paste the agent token → configure database and destination → **Save** → **Test license** → **Run backup now**.

### Windows

```text
vaultbackup-agent-windows-amd64.exe --webui 127.0.0.1:8787
```

Same browser setup as above.

---

## Flags

```text
--config path/to/config.yaml   # default: config.yaml next to the binary
--webui 127.0.0.1:8787         # local setup UI
--webui-password SECRET        # optional UI password
--once                         # one backup then exit
--no-webui                     # headless after config exists
--type full|incremental|...    # override backup type for this run
```

Staging override only: `VAULTBACKUP_SERVER_URL=https://other-worker.example.com`

---

## Verify

- Dashboard → **Desktop Agents** shows **Live** within a few seconds.
- Local UI license badge turns OK after a successful check.
- History shows the first backup as OK or Failed with a clear error.

---

## Build from source

```bash
git clone https://github.com/VaultBackup/VaultBackup.git
cd VaultBackup/agent
go build -o vaultbackup-agent ./cmd/agent
```

CI: `.github/workflows/build-agents.yml` builds all six platforms on every push to `agent/**` and commits the binaries to the repo root.
