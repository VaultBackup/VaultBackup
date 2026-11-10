# Linux service install

Runs the agent in the background with Web UI on **0.0.0.0:8787** (all interfaces).

## Quick install

```bash
curl -L -o vaultbackup-agent-linux-amd64.bin \
  https://backup.enadoctemp.workers.dev/download/linux-amd64
chmod +x vaultbackup-agent-linux-amd64.bin

# Download install script from the repo packaging, or run the one-liner unit below.
sudo bash install-service.sh ./vaultbackup-agent-linux-amd64.bin
```

## Service name

```text
vaultbackup-agent.service
```

Useful commands:

```bash
sudo systemctl status vaultbackup-agent
sudo systemctl restart vaultbackup-agent
sudo journalctl -u vaultbackup-agent -f
```

## Web UI login

Password is in `/etc/vaultbackup/agent.env` as `WEBUI_PASSWORD`.
Username can be anything; password is that value.

Browser: `http://<server-ip>:8787`

## Paths

| Path | Purpose |
|------|--------|
| `/opt/vaultbackup/vaultbackup-agent` | Binary |
| `/etc/vaultbackup/config.yaml` | Config |
| `/etc/vaultbackup/agent.env` | UI password |
| `/var/lib/vaultbackup` | Data, logs, backups |
