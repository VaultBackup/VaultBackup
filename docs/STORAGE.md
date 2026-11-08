# Own-storage guide (BYO)

VaultBackup is designed so **backup data lives in storage you control**.

## Modes

| Mode | Typical use |
|------|-------------|
| `s3` | AWS S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO |
| `local` | NAS path or disk on the agent machine |
| `azure` | Azure Blob (shared key) |
| `webdav` | NAS / Nextcloud-style WebDAV |
| `sftp` | SFTP server |
| `vaultbackup` | Upload API on the Worker (control-plane path) |

Aliases: `r2`, `b2`, `minio`, `wasabi` → treated as `s3`.

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

### Local disk
- Destination mode **local**  
- Absolute path the service account can write  
- Prefer a volume that is itself backed up or replicated  

## Encryption

- **In transit:** TLS to S3-compatible APIs  
- **At rest (file):** enable agent `security.encrypt` (AES-256-GCM) before upload  
- **Config secrets:** sealed on disk (see [SECURITY.md](SECURITY.md))  

## Retention

Configure retention in the agent (count / policy fields). Lifecycle rules on the bucket can complement agent-side retention—document who owns deletion.

## Accounting / compliance tips

- Separate buckets or prefixes per client when serving multiple firms  
- Prefer regions that match data-residency expectations  
- Keep restore drills on a schedule (download last backup, decrypt, test restore)  

See also: [PRODUCT.md](PRODUCT.md) · [INSTALL.md](../INSTALL.md)
