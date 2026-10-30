# VaultBackup Agent — Go source

This tree is a **reconstructed** open implementation of the desktop agent, derived from:

- Public package paths recovered from the release binaries (`github.com/vaultbackup/agent/...`)
- Documented API surface (`/api/config`, `/api/status`, `/api/run-once`, `/api/test-license`, `/api/history`, `/api/logs`)
- `config.example.yaml`, CAPABILITIES.md, and the embedded Web UI contract

It is **not** a byte-for-byte dump of the proprietary source that produced the v1.2.3 binaries. Behavior is aligned with the documented agent: schedule → dump → optional AES-256-GCM encrypt → upload, plus local Web UI and Worker license/status callbacks.

## Layout

```
agent/
  cmd/agent/          # main entrypoint
  internal/
    compress/         # gzip helpers
    config/           # load/save + sanitized view
    crypto/           # AES-256-GCM (VBK2) + key file
    db/               # pg/mysql/sqlite/mongo/redis/mssql/files/command dumps
    fingerprint/      # device binding
    health/           # DB connectivity probes
    history/          # local run history
    httpx/            # shared HTTP client
    license/          # Worker license + 72h grace
    notify/           # webhook alerts
    retention/        # keep-N / tiered cleanup
    sysinfo/          # host metrics
    tools/            # PATH lookups
    update/           # version check
    upload/           # local, S3, Azure, WebDAV, SFTP, Worker
    webui/            # HTTP UI (enhanced HTML embedded)
```

## Build

```bash
cd agent
go build -o vaultbackup-agent ./cmd/agent
# or: make build / make release
```

## Notes

- Config is stored as JSON when saved from this tree (original release uses YAML). The UI and Worker APIs are unchanged.
- SFTP requires optional `github.com/pkg/sftp` + `golang.org/x/crypto` in a fuller build; the scaffold returns a clear error for that destination.
- Enhanced UI is embedded from `vaultbackup-agent-ui-enhanced.html`.
