# VaultBackup — product overview

## Positioning

**Inexpensive encrypted database backups** for **SMBs and accounting firms**, stored in **your own** bucket or disk—not a forced managed vault.

Tagline: *Your data. Your storage. Simple agent.*

## Who it is for

| Buyer | Need |
|-------|------|
| Accounting firms | SQL Server / local MySQL on office PCs; 7-year retention culture |
| SMBs | Cheap, reliable backups without large SaaS bills |
| Privacy-conscious teams | BYO S3/B2/Wasabi/R2; encryption before upload |

## Two paths

| Path | Use when |
|------|----------|
| **Desktop agent** | Office / LAN databases the cloud cannot reach; large dumps |
| **Worker (console)** | Small **public** cloud DBs only (~20 MB practical limit) |

Marketing and onboarding should lead with **agent + own storage**.

## Value props

1. **Own storage** — S3, B2, Wasabi, R2, Azure, WebDAV, local disk  
2. **Windows-first** — MSI installer + local Web UI (no terminal required)  
3. **Encrypted** — optional AES-256-GCM on backup files; secrets sealed in agent config  
4. **Low infra cost** — Cloudflare Worker control plane  
5. **Simple token onboarding** — create token in console → paste in agent UI  

## Product surface

```
Console (Worker)          Desktop Agent
├─ Auth / account         ├─ Local Web UI :8787
├─ Agent tokens           ├─ Schedule + dump
├─ License check          ├─ Encrypt (optional)
├─ Heartbeats / history   ├─ Upload to BYO storage
├─ Binary downloads       └─ Sealed local config
└─ Optional cloud DB jobs
```

## Pricing narrative (recommended)

- **Hero plan:** Agent seats + BYO storage (customer pays B2/Wasabi/R2)  
- Optional: small cloud-DB add-on on Worker (acknowledge size limits)  

## Roadmap priorities

1. Windows service polish + token-only first-run  
2. Storage presets with vendor-matched labels  
3. Email alerts on failed/missed backups  
4. In-app restore confidence ("get last backup")  
5. Accounting-firm landing (SQL Server, privacy, cost)  

See also: [MINDMAP.md](MINDMAP.md) · [SECURITY.md](SECURITY.md) · [INSTALL.md](../INSTALL.md)
