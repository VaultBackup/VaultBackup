# VaultBackup Mindmap

See **[docs/MINDMAP.md](docs/MINDMAP.md)** for the full product & architecture mindmap (Mermaid).

Quick branches:

```
VaultBackup
├─ Audience → SMBs, accounting firms, own storage
├─ Worker → auth, KV, license, downloads, dashboard, cron
├─ Agent → Win/macOS/Linux, sealed config, backup pipeline
├─ Storage → S3/B2/Wasabi/R2/Azure/WebDAV/local
├─ Security → reg lock, CSP, sealed secrets, SSRF checks
├─ CI/CD → multi-platform + MSI, wrangler Worker
└─ Roadmap → Windows service, presets, alerts, restore UX
```
