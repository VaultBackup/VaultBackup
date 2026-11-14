# VaultBackup Desktop Agent — Install Guide

**Public page:** https://backup.enadoctemp.workers.dev/install  
**Console:** https://backup.enadoctemp.workers.dev/  
**Support:** [docs/SUPPORT.md](docs/SUPPORT.md)  
**Docs index:** [docs/README.md](docs/README.md)

For **SMBs and accounting firms**: back up office databases to **your own** disk or cloud storage (S3, B2, Wasabi, R2, Azure, WebDAV, SFTP). Backup **bytes go directly** to that storage — the Worker is only for license checks.

## Office databases vs cloud databases

| Scenario | Use |
|----------|-----|
| SQL Server / MySQL / Postgres / files on office PC or LAN | **Desktop agent** (this guide) |
| Small public cloud DB | Web console serverless backup (Worker size limits) |

## Download

Use **GET** (browser or `curl -L`). Some `HEAD` probes may return 401; that is cosmetic when downloads work via GET.

| Platform | URL |
|----------|-----|
| **Windows MSI (recommended)** | https://backup.enadoctemp.workers.dev/download/windows-msi |
| Windows x64 EXE | https://backup.enadoctemp.workers.dev/download/windows-amd64 |
| Windows ARM64 EXE | https://backup.enadoctemp.workers.dev/download/windows-arm64 |
| macOS Apple Silicon | https://backup.enadoctemp.workers.dev/download/darwin-arm64 |
| macOS Intel | https://backup.enadoctemp.workers.dev/download/darwin-amd64 |
| Linux x64 | https://backup.enadoctemp.workers.dev/download/linux-amd64 |
| Linux ARM64 | https://backup.enadoctemp.workers.dev/download/linux-arm64 |

```bash
curl -fsSL -o vaultbackup-agent https://backup.enadoctemp.workers.dev/download/linux-amd64
chmod +x vaultbackup-agent
```

## Create a token

1. Sign in at https://backup.enadoctemp.workers.dev/
2. **Desktop Agents** → **Create token** → copy once (shown only at creation)
3. One token binds to **one device** after the first successful license check. To move the agent, **Unbind** in the console, then use the same token on the new machine (or create a new token).

## First-run wizard (all platforms)

Open **http://127.0.0.1:8787** after install or first launch.

1. **Welcome** — agent name, schedule, paste token, accept the **EULA** (first time only; re-shown only if terms version changes)
2. **Database** — pick engine + connection URI → **Test connection** (must pass)
3. **Destination** — local disk, S3-compatible, Azure, WebDAV, or SFTP → **Test connection** (must pass)
4. **Review** — both tests green → **Save configuration** → **Check license** → **Run backup once**

On the Review page you can also:

- See **Live status** and **Recent history**
- Open **Stored backups** — list objects on your destination, **Restore** (download + decrypt into the agent work dir), or **Delete**

You cannot save until **both** database and destination tests succeed.

## Windows — MSI (recommended)

Run the MSI **as Administrator** so the Windows service can install.

```text
msiexec /i vaultbackup-agent-windows-amd64.msi
# quiet:
msiexec /i vaultbackup-agent-windows-amd64.msi /qn
# optional UI password at install:
msiexec /i vaultbackup-agent-windows-amd64.msi WEBUIPASSWORD=your-secret
```

1. Open `http://127.0.0.1:8787`
2. Complete the wizard (token → test DB → test destination → save)
3. **Check license** → **Run backup once**

Uninstall: Settings → Apps → VaultBackup Agent, or:

```text
msiexec /x vaultbackup-agent-windows-amd64.msi /qn
```

If the service fails to start during install, install the **EXE** as a service (below) or re-run the MSI elevated.

## Windows — portable EXE + service

1. Put the exe in `C:\VaultBackup\vaultbackup-agent.exe`
2. Run once with `-webui 127.0.0.1:8787` to complete the wizard
3. Register auto-start:

**Task Scheduler:**
```text
schtasks /Create /TN "VaultBackup Agent" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "C:\VaultBackup\vaultbackup-agent.exe -config C:\VaultBackup\config.yaml -webui 127.0.0.1:8787"
```

**Or packaged script:**
```powershell
.\scripts\install-windows.ps1 -BinaryPath .\vaultbackup-agent-windows-amd64.exe
```

## Linux

```bash
chmod +x vaultbackup-agent-linux-amd64
./vaultbackup-agent-linux-amd64 -webui 127.0.0.1:8787
```

Open `http://127.0.0.1:8787`, complete the wizard.

**systemd (production):**

```bash
sudo ./scripts/install-linux.sh ./vaultbackup-agent-linux-amd64
# or build a .deb from agent source:
#   ./agent/packaging/linux/build-deb.sh ./vaultbackup-agent-linux-amd64 1.2.8 amd64
```

Typical paths after service install:

| Path | Purpose |
|------|--------|
| `/opt/vaultbackup/vaultbackup-agent` | Binary |
| `/etc/vaultbackup/config.yaml` | Config |
| `/var/lib/vaultbackup` | Work dir, key, history, local backups |

## macOS

```bash
chmod +x vaultbackup-agent-darwin-arm64
./vaultbackup-agent-darwin-arm64 -webui 127.0.0.1:8787
```

Production: `sudo ./scripts/install-macos.sh ./vaultbackup-agent-darwin-arm64`  
or build a `.pkg` with `agent/packaging/macos/build-pkg.sh` on a Mac.

## Own storage

In the agent UI choose destination type, then fill vendor fields:

- **Backblaze B2** — endpoint `s3.<region>.backblazeb2.com`, Key ID + Application key  
- **Wasabi** — `s3.wasabisys.com` or regional host  
- **Cloudflare R2** — `<accountid>.r2.cloudflarestorage.com`, region `auto`  
- **AWS S3** — empty endpoint + region, IAM keys  
- **Azure Blob** — account + container + key  
- **WebDAV / SFTP** — host and credentials  
- **Local disk** — absolute path the service account can write  

Details: [docs/STORAGE.md](docs/STORAGE.md)

## Config secrets (important)

Current agent builds **seal secrets at rest** (DB password, storage keys, license token) using AES-256-GCM and `agent.key`.  
Protect both the config file and `agent.key` (permissions + disk encryption).  
See [docs/SECURITY.md](docs/SECURITY.md).

## License server

Built into the binary: `https://backup.enadoctemp.workers.dev` (72-hour offline grace after a successful check-in).

## Troubleshooting (quick)

| Symptom | What to try |
|---------|-------------|
| Cannot save config | Run **Test connection** on Database and Destination until both are green |
| License / token_bound | Unbind the agent in the console, or create a new token |
| Empty / failed MySQL dump | Prefer `127.0.0.1` over `localhost`; ensure the DB accepts TCP |
| `required tool not found` | Current agents use **built-in** dumps for common engines; update the binary if you still see tool errors |
| MSI service failed | Run MSI as Administrator, or use the EXE + install script |
| Restore | Review → **Stored backups** → **Restore**, or CLI `-restore` / `-restore-out` (see [RUN.md](RUN.md)) |

Full support guide: [docs/SUPPORT.md](docs/SUPPORT.md)

## More docs

- [RUN.md](RUN.md) — flags, service install, offline license  
- [CAPABILITIES.md](CAPABILITIES.md) — engines and destinations  
- [docs/PRODUCT.md](docs/PRODUCT.md) — product overview  
- [docs/AGENT.md](docs/AGENT.md) — agent deep dive  
- [docs/SUPPORT.md](docs/SUPPORT.md) — troubleshooting & FAQ  
