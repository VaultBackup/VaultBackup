# VaultBackup — security guide

## Summary (current posture)

| Area | Status |
|------|--------|
| Public registration | **Disabled by default** (`ALLOW_REGISTRATION` must be `true`) |
| Public `/api/health` | Minimal `{ ok: true }` only |
| Login | Rate limited (429 after repeated failures) |
| Admin UI | Token-gated |
| Agent APIs | Bearer auth required |
| Config secrets on disk | **Sealed** (AES-256-GCM envelope v2 + `agent.key`) |
| Backup files | Optional AES-256-GCM (`Security.Encrypt`) |
| Agent Web UI | CSP with nonces; XSS-hardened escaping |
| Custom shell dumps | Disabled unless `VAULTBACKUP_ALLOW_SHELL_COMMAND=1` |
| SSRF | Public host checks on Worker DB paths |

## Agent config at rest

On **Save**, sensitive fields are not written as plaintext JSON:

- License token  
- Database URI (includes password)  
- S3 access/secret keys, Azure key, WebDAV/SFTP passwords  

**On-disk format (version 2):**

```json
{
  "version": 2,
  "config": { "/* non-secret fields */": true },
  "sealed": "<base64 AES-256-GCM blob>"
}
```

Key file: `Security.KeyFile` (default `./data/agent.key`), mode `0600`.  
Legacy plaintext configs still **load**; the next **Save** migrates to sealed form.

Empty secret fields from the UI mean **"keep previous"** (token/password not wiped).

### Operational requirements

- Protect both **config** and **agent.key** (permissions + host disk encryption)  
- Do not commit config or keys to git  
- Prefer running as a dedicated service account  

## Worker hardening checklist

1. KV binding name: `backup_kv`  
2. Secret: `ENCRYPTION_KEY` (≥ 32 characters)  
3. Do **not** set `ALLOW_REGISTRATION=true` unless intentional  
4. Optional: `ADMIN_TOKEN` for admin routes  
5. Cron every 5 minutes for scheduler  
6. `GH_TOKEN` (Contents: Read) for private-repo binary proxy  

## Agent Web UI

- Default bind: `127.0.0.1:8787` (localhost only)  
- Use `--webui-password` if binding beyond localhost  
- API responses use **sanitized** config (secrets redacted)  

## Reporting issues

Treat license tokens and storage keys as credentials. Rotate agent tokens after device reimage or suspected leak.

See also: [AGENT.md](AGENT.md) · [CAPABILITIES.md](../CAPABILITIES.md)
