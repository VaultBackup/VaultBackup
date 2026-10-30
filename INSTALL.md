# VaultBackup Desktop Agent — Install Guide

**Public page:** https://backup.enadoctemp.workers.dev/install

For **SMBs and accounting firms**: back up office databases to **your own** disk or S3-compatible storage (B2, Wasabi, R2, AWS).

## Office databases vs cloud databases

| Scenario | Use |
|----------|-----|
| SQL Server / MySQL on office PC or LAN | **Desktop agent** (this guide) |
| Tiny public cloud DB | Web console serverless backup (size limits) |

## Download

| Platform | URL |
|----------|-----|
| Windows x64 | https://backup.enadoctemp.workers.dev/download/windows-amd64 |
| Windows ARM64 | https://backup.enadoctemp.workers.dev/download/windows-arm64 |
| macOS Apple Silicon | https://backup.enadoctemp.workers.dev/download/darwin-arm64 |
| macOS Intel | https://backup.enadoctemp.workers.dev/download/darwin-amd64 |
| Linux x64 | https://backup.enadoctemp.workers.dev/download/linux-amd64 |
| Linux ARM64 | https://backup.enadoctemp.workers.dev/download/linux-arm64 |

## Create a token

1. Sign in at https://backup.enadoctemp.workers.dev/
2. **Desktop Agents** → **Create token** → copy once

## Windows service (recommended)

1. Put the exe in `C:\VaultBackup\vaultbackup-agent.exe`
2. Run the UI once to paste token + set database + storage
3. Register auto-start:

**Task Scheduler:**
```text
schtasks /Create /TN "VaultBackup Agent" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "C:\VaultBackup\vaultbackup-agent.exe --config C:\VaultBackup\config.yaml --webui 127.0.0.1:8787"
```

**Or NSSM:**
```text
nssm install VaultBackupAgent "C:\VaultBackup\vaultbackup-agent.exe"
nssm set VaultBackupAgent AppParameters "--config C:\VaultBackup\config.yaml --webui 127.0.0.1:8787"
nssm start VaultBackupAgent
```

## Own storage presets

In the agent UI choose **S3 / R2 / B2 / Wasabi**, then a preset:

- **Backblaze B2** — endpoint `s3.<region>.backblazeb2.com`, Key ID + Application key
- **Wasabi** — `s3.wasabisys.com` or regional host
- **Cloudflare R2** — `<accountid>.r2.cloudflarestorage.com`, region `auto`
- **AWS S3** — empty endpoint + region, IAM keys
- **Local disk** — destination mode Local

## Alerts

When `RESEND_API_KEY` and `MAIL_FROM` are set on the Worker, critical agent failures email the account owner (rate-limited to about once per hour per agent).

## License server

Built into the binary: `https://backup.enadoctemp.workers.dev`
