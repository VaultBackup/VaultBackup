# Own-storage guide (BYO)

VaultBackup is designed so **backup data lives in storage you control**.

The agent uploads **directly** to local disk, S3-compatible APIs, Azure, WebDAV, or SFTP. The Worker is **not** a transit path for dump bytes — only for license and control-plane APIs.

## Modes

| Mode | Typical use |
|------|-------------|
| `s3` | AWS S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO |
| `local` | NAS path or disk on the agent machine |
| `azure` | Azure Blob (shared key) |
| `webdav` | NAS / Nextcloud-style WebDAV |
| `sftp` | SFTP server |

Aliases: `r2`, `b2`, `minio`, `wasabi` → treated as `s3`.

## Object operations

On every destination mode the agent can:

- **List** backup objects (Web UI → Stored backups)
- **Get** / restore a key into the work directory (optional decrypt)
- **Delete** a key (UI or retention)
- Apply **retention** without deleting `agent.key` or logs

## Presets (agent UI / operators)

### Backblaze B2
- Endpoint: `s3.<region>.backblazeb2.com`  
- Keys: **Key ID** + **Application key**  
- Create a private bucket; use a key limited to that bucket  

### Wasabi
- Endpoint: `s3.wasabisys.com` or regional Wasabi endpoint  
- Access key + secret  

### Cloudflare R2
- Endpoint: `<accountid>.r2.cloudflarestorage.com`  
- Region: `auto`  
- R2 API token with object read/write on the bucket  

### AWS S3
- Leave custom endpoint empty; set region  
- IAM user/role keys with least privilege on the bucket prefix  

### Azure Blob
- Storage account name, container, access key  
- Optional prefix  

### WebDAV / SFTP
- Full URL or host + path; credentials or key file for SFTP  

### Local disk
- Destination mode **local**  
- Absolute path the service account can write  
- Prefer a volume that is itself backed up or replicated  

## Encryption

- **In transit:** TLS to S3-compatible / Azure / WebDAV APIs  
- **At rest (file):** enable agent `security.encrypt` (AES-256-GCM) before upload  
- **Config secrets:** sealed on disk (see [SECURITY.md](SECURITY.md))  

## Retention

Configure retention in the agent UI (keep count / days depending on build fields). Bucket lifecycle rules can complement agent-side retention—document who owns deletion.

## Accounting / compliance tips

- Separate buckets or prefixes per client when serving multiple firms  
- Prefer regions that match data-residency expectations  
- Keep restore drills on a schedule (Stored backups → Restore, or CLI `-restore`)  

See also: [PRODUCT.md](PRODUCT.md) · [INSTALL.md](../INSTALL.md) · [SUPPORT.md](SUPPORT.md)
