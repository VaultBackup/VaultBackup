# VaultBackup Desktop Agent — Install Guide

**Public page:** https://backup.enadoctemp.workers.dev/install  
**Console:** https://backup.enadoctemp.workers.dev/

For **SMBs and accounting firms**: back up office databases to **your own** disk or S3-compatible storage (B2, Wasabi, R2, AWS).

## Office databases vs cloud databases

| Scenario | Use |
|----------|-----|
| SQL Server / MySQL / Postgres on office PC or LAN | **Desktop agent** (this guide) |
| Small public cloud DB | Web console serverless backup (Worker size limits) |

## Download

| Platform | URL |
|----------|-----|
| **Windows MSI (recommended)** | https://backup.enadoctemp.workers.dev/download/windows-msi |
| Windows x64 EXE | https://backup.enadoctemp.workers.dev/download/windows-amd64 |
| Windows ARM64 EXE | https://backup.enadoctemp.workers.dev/download/windows-arm64 |
| macOS Apple Silicon | https://backup.enadoctemp.workers.dev/download/darwin-arm64 |
| macOS Intel | https://backup.enadoctemp.workers.dev/download/darwin-amd64 |
| Linux x64 | https://backup.enadoctemp.workers.dev/download/linux-amd64 |
| Linux ARM64 | https://backup.enadoctemp.workers.dev/download/linux-arm64 |

Also on GitHub `main` (maintainers): `vaultbackup-agent-windows-amd64.msi`, `vaultbackup-agent-1.2.3-x64.msi`, and platform binaries.

## Create a token

1. Sign in at https://backup.enadoctemp.workers.dev/
2. **Desktop Agents** → **Create token** → copy once

## Windows — MSI (recommended)

```text
msiexec /i vaultbackup-agent-windows-amd64.msi
# quiet:
msiexec /i vaultbackup-agent-windows-amd64.msi /qn
# optional UI password at install:
msiexec /i vaultbackup-agent-windows-amd64.msi WEBUIPASSWORD=your-secret
```

1. Open `http://127.0.0.1:8787`
2. Paste the agent token → choose database and destination → **Save**
3. **Test license** → **Run backup now**

Uninstall: Settings → Apps → VaultBackup Agent, or:

```text
msiexec /x vaultbackup-agent-windows-amd64.msi /qn
```

## Windows — portable EXE + service

1. Put the exe in `C:\VaultBackup\vaultbackup-agent.exe`
2. Run once with `--webui 127.0.0.1:8787` to paste token + set database + storage
3. Register auto-start:

**Task Scheduler:**
```text
schtasks /Create /TN "VaultBackup Agent" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "C:\VaultBackup\vaultbackup-agent.exe --config C:\VaultBackup\config.yaml --webui 127.0.0.1:8787"
```

**Or packaged script:**
```powershell
.\scripts\install-windows.ps1 -BinaryPath .\vaultbackup-agent-windows-amd64.exe
```

**Or NSSM:**
```text
nssm install VaultBackupAgent "C:\VaultBackup\vaultbackup-agent.exe"
nssm set VaultBackupAgent AppParameters "--config C:\VaultBackup\config.yaml --webui 127.0.0.1:8787"
nssm start VaultBackupAgent
```

## Linux / macOS

```bash
chmod +x vaultbackup-agent-linux-amd64   # or darwin-arm64, etc.
./vaultbackup-agent-linux-amd64 --webui 127.0.0.1:8787
```

Open `http://127.0.0.1:8787`, paste token, configure, save.

Production service:

```bash
sudo ./scripts/install-linux.sh ./vaultbackup-agent-linux-amd64
sudo ./scripts/install-macos.sh ./vaultbackup-agent-darwin-arm64
```

## Own storage presets

In the agent UI choose **S3 / R2 / B2 / Wasabi**, then a preset:

- **Backblaze B2** — endpoint `s3.<region>.backblazeb2.com`, Key ID + Application key
- **Wasabi** — `s3.wasabisys.com` or regional host
- **Cloudflare R2** — `<accountid>.r2.cloudflarestorage.com`, region `auto`
- **AWS S3** — empty endpoint + region, IAM keys
- **Local disk** — destination mode Local

## Alerts

When `RESEND_API_KEY` and `MAIL_FROM` are set on the Worker, critical agent failures can email the account owner (rate-limited).

## License server

Built into the binary: `https://backup.enadoctemp.workers.dev` (72-hour offline grace).

See also: [RUN.md](RUN.md) · [CAPABILITIES.md](CAPABILITIES.md) · [README.md](README.md)
