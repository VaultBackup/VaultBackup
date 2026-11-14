# VaultBackup — user support guide

**Console:** https://backup.enadoctemp.workers.dev/  
**Install page:** https://backup.enadoctemp.workers.dev/install  
**Install steps:** [INSTALL.md](../INSTALL.md)  
**Run / flags:** [RUN.md](../RUN.md)

This page is for **end users and operators** who run the desktop agent.

---

## How VaultBackup is meant to work

1. You create an **agent token** in the web console.
2. You install the agent on the machine that can reach the database.
3. The agent **dumps** the database (built-in tools for common engines), optionally **encrypts**, and uploads **directly** to storage **you** control (local disk, S3/B2/R2/Wasabi, Azure, WebDAV, SFTP).
4. The Worker only checks the **license** and shows agent status — it does **not** carry backup file bytes for normal destinations.

---

## Setup checklist

- [ ] Token created and copied once from **Desktop Agents**
- [ ] Agent installed (Windows MSI recommended; Linux/macOS binary or service script)
- [ ] UI open at http://127.0.0.1:8787
- [ ] EULA accepted (first time only)
- [ ] Database **Test connection** green
- [ ] Destination **Test connection** green
- [ ] **Save configuration**
- [ ] **Check license** shows OK
- [ ] **Run backup once** succeeds
- [ ] Object appears under **Stored backups**

---

## Common issues

### Cannot save configuration

Save is blocked until **both** tests pass:

1. Database step → **Test connection**
2. Destination step → **Test connection**

On Review, use **Test database** / **Test destination** again if needed.

### License errors

| Message / symptom | What to do |
|-------------------|------------|
| Token invalid | Create a new token; paste carefully (no spaces) |
| `token_bound_to_another_device` | Console → that agent → **Unbind device**, or use a new token |
| License not OK after offline | Ensure the machine can reach `https://backup.enadoctemp.workers.dev`; wait for check-in (72h grace) |
| Works in UI but `-once` failed on old builds | Update the agent; current builds check license on cold start |

### Database connection fails

- Prefer **`127.0.0.1`** instead of `localhost` (avoids IPv6 `::1` issues).
- Confirm the database listens on TCP and the agent host is allowed (firewall / bind address).
- MySQL socket errors: use a URI with host/port, not only a socket path.
- Postgres `connection refused`: service not running or wrong port.

### Backup failed / empty file

- Open **Live status** and **Recent history** on the Review page for the exact error.
- Check agent log (paths vary):
  - Linux service: `/var/lib/vaultbackup` or journal `vaultbackup-agent`
  - Config `log_file` value
- Update to a current agent if you see `required tool not found` — common engines use **built-in** dumps.
- Oracle needs Oracle client tools (`expdp`/`exp`). AS/400 needs SSH + authority (or a pre-made `.savf`).

### Destination test fails

- **Local:** path must exist or be creatable; service account needs write permission.
- **S3-compatible:** endpoint, region, bucket, keys; for R2 use region `auto` and the account R2 endpoint.
- **Azure / WebDAV / SFTP:** credentials and network reachability from the agent host.

### Restore and delete

**Web UI:** Review → **Stored backups** → **Refresh list** → **Restore** or **Delete**.

**CLI:**

```bash
./vaultbackup-agent -config /path/to/config.yaml \
  -restore /path/to/backup.enc \
  -restore-out /tmp/restored.bin
```

Restore writes under the agent work directory when using the UI (decrypted when encryption is enabled).

### Windows MSI / service

- Install **as Administrator**.
- Prefer MSI; if the service fails to start, use the EXE + `scripts/install-windows.ps1`.
- UI: http://127.0.0.1:8787

### Download links return errors

- Use **browser download** or `curl -L` (**GET**). Occasional **HEAD** 401 is cosmetic.
- If GET also fails, the operator must fix Worker `GH_TOKEN` or R2 mirrors — see [DOWNLOADS.md](DOWNLOADS.md).

---

## FAQ

**Do I need mysqldump / pg_dump installed?**  
Usually no. Current agents prefer built-in dumps for MySQL, Postgres, and several other engines.

**Where do backups live?**  
Only on the destination you configured (your disk or cloud). Not inside the Worker for normal modes.

**Can I move the agent to another PC?**  
Unbind the token in the console, install on the new machine, paste the same token (or create a new token).

**How long can the agent stay offline?**  
About **72 hours** after the last successful license check, then backups pause until check-in succeeds.

**Is Oracle / AS/400 fully enterprise?**  
No. Oracle is logical export-oriented; AS/400 is SSH/SAVLIB or file-based — not a full BRMS/RMAN replacement. See [CAPABILITIES.md](../CAPABILITIES.md).

**Who can see my database passwords?**  
They are sealed on disk with `agent.key`. Protect the key file and config the same way you protect production secrets.

---

## Getting more help

1. Capture **Live status** JSON and the failing **history** line from the agent UI.  
2. Note OS, agent version (download date / binary name), database type, destination mode.  
3. Contact your VaultBackup administrator with that information (do **not** send full tokens or passwords).

Related docs: [AGENT.md](AGENT.md) · [STORAGE.md](STORAGE.md) · [SECURITY.md](SECURITY.md) · [CAPABILITIES.md](../CAPABILITIES.md)
