# VaultBackup — Product & Architecture Mindmap

```mermaid
mindmap
  root((VaultBackup))
    Audience
      SMBs
      Accounting firms
      Own-storage buyers
    Control plane
      Cloudflare Worker
        Auth login register
        KV sessions tokens
        License API
        Agent downloads
        Dashboard UI
        Cron scheduler
        Public install page
      Secrets
        ENCRYPTION_KEY
        GH_TOKEN
        ALLOW_REGISTRATION
      Bindings
        backup_kv
        optional R2
    Desktop Agent
      Platforms
        Windows MSI
        Windows EXE x64 ARM64
        macOS Intel Apple Silicon
        Linux x64 ARM64
      Local config
        Sealed secrets v2
        agent.key AES-256-GCM
        DB URI keys passwords
      Backup pipeline
        Dump native tools
        Optional encrypt file
        Upload S3 B2 Wasabi R2
        Local disk WebDAV SFTP Azure
      Web UI
        4-step wizard
        CSP nonce
        XSS hardened
      License
        Hardcoded server URL
        Token check
    Storage BYO
      S3 compatible
      Backblaze B2
      Wasabi
      Cloudflare R2
      Azure Blob
      WebDAV NAS
      Local disk
    Security VAPT
      Registration deny-by-default
      Minimal public health
      Admin token gate
      Rate limited login
      SSRF host checks
      Config not plaintext
      Shell dumps disabled
    CI CD
      GitHub Actions
        Multi-platform build
        MSI WiX job
        Commit binaries
      Worker deploy
        wrangler
    Gaps roadmap
      Windows service installer
      Storage presets plain labels
      Email failure alerts
      Restore confidence UX
      Pricing agent BYO hero
```

## Structure (outline)

### 1. Audience
- SMBs and accounting firms
- Cheap backups to **their** storage (not forced managed bucket)

### 2. Control plane (Cloudflare Worker)
- Auth, KV, license, agent binary proxy, dashboard, cron
- Public: `/install`, `/download/*`
- Secrets: `ENCRYPTION_KEY`, `GH_TOKEN`; flag `ALLOW_REGISTRATION`

### 3. Desktop Agent
- **Windows** MSI + EXE (x64/ARM64), **macOS**, **Linux**
- Config secrets sealed at rest (AES-256-GCM + `agent.key`)
- Backup → encrypt optional → upload to BYO storage
- Embedded Web UI (wizard, CSP)

### 4. Storage (BYO)
- S3 / B2 / Wasabi / R2 / Azure / WebDAV / SFTP / local

### 5. Security posture
- Registration locked by default
- Minimal public health
- Admin gate, rate limits, SSRF checks
- No plaintext config secrets on disk

### 6. CI/CD
- GitHub Actions builds all platforms + MSI
- Binaries committed to private repo; Worker proxies downloads

### 7. Near-term product gaps
- Windows service installer
- Plain-language storage presets
- Failure email alerts
- Clearer restore path
- Agent + BYO as pricing hero

---

*Render the Mermaid block on GitHub or any Mermaid-compatible viewer.*
