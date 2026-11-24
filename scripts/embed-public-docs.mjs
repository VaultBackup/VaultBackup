#!/usr/bin/env node
/** Professional public docs; Support page is customer-facing (account email). */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

function jsonLd(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

const SHELL_CSS = `
:root{--bg:#020617;--card:#0f172a;--border:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--brand:#22c55e}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.65}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
.topbar{border-bottom:1px solid var(--border);background:rgba(2,6,23,.92);position:sticky;top:0;z-index:20}
.topbar-inner{max-width:64rem;margin:0 auto;padding:.85rem 1.25rem;display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:.65rem;color:#fff;text-decoration:none;font-weight:700}
.brand img{width:28px;height:28px;border-radius:7px}
.brand small{display:block;font-weight:500;font-size:.7rem;color:var(--muted)}
.nav{display:flex;gap:1rem;flex-wrap:wrap;font-size:.875rem;align-items:center}
.nav a{color:var(--muted)}.nav a:hover{color:#fff;text-decoration:none}
.nav a.cta{background:var(--brand);color:#052e16;font-weight:700;padding:.4rem .75rem;border-radius:8px}
main{max-width:48rem;margin:0 auto;padding:2rem 1.25rem 3rem}
.hero{padding:1rem 0 1.5rem;border-bottom:1px solid var(--border);margin-bottom:1.5rem}
.eyebrow{font-size:.75rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--brand);margin:0 0 .5rem}
h1{font-size:clamp(1.75rem,4vw,2.25rem);margin:0 0 .75rem;color:#fff}
.lead{font-size:1.1rem;color:var(--muted);margin:0;max-width:40rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:1.35rem 1.4rem;margin:1.15rem 0}
h2{font-size:1.05rem;margin:0 0 .65rem;color:#fff}.muted{color:var(--muted)}
ul,ol{margin:.4rem 0;padding-left:1.2rem}li{margin:.4rem 0}
.btn{display:inline-block;background:var(--brand);color:#052e16!important;font-weight:700;padding:.6rem 1rem;border-radius:9px;text-decoration:none!important;margin:.25rem .4rem .25rem 0}
.btn.secondary{background:#1e293b;color:#e2e8f0!important;border:1px solid var(--border)}
.site-footer{border-top:1px solid var(--border);margin-top:2rem;background:#01040c}
.site-footer-inner{max-width:64rem;margin:0 auto;padding:2rem 1.25rem;display:grid;gap:1.5rem}
@media(min-width:700px){.site-footer-inner{grid-template-columns:2fr 1fr 1fr 1fr}}
.site-footer h3{margin:0 0 .6rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:#64748b}
.site-footer a{display:block;color:var(--muted);font-size:.875rem;margin:.35rem 0;text-decoration:none}
.site-footer a:hover{color:#fff}
.site-footer .legal{grid-column:1/-1;border-top:1px solid var(--border);padding-top:1rem;font-size:.8rem;color:#64748b;display:flex;flex-wrap:wrap;gap:.75rem 1.25rem;justify-content:space-between}\n.faq details{border-top:1px solid var(--border);padding:.85rem 0}.faq summary{cursor:pointer;color:#e2e8f0;font-weight:650}.faq details p{margin:.55rem 0 0;color:var(--muted)}
`;

function page(title, description, path, body, faq = []) {
  const canonical = `https://backup.enadoctemp.workers.dev${path}`;
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": "https://backup.enadoctemp.workers.dev/#organization",
    name: "VaultBackup",
    url: "https://backup.enadoctemp.workers.dev/",
    logo: "https://backup.enadoctemp.workers.dev/icon.svg",
  };
  const web = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": canonical + "#webpage",
    name: title,
    description,
    url: canonical,
    isPartOf: { "@id": "https://backup.enadoctemp.workers.dev/#website" },
    publisher: { "@id": "https://backup.enadoctemp.workers.dev/#organization" },
    inLanguage: "en",
  };
  const graph = [org, {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": "https://backup.enadoctemp.workers.dev/#website",
    name: "VaultBackup",
    url: "https://backup.enadoctemp.workers.dev/",
    publisher: { "@id": "https://backup.enadoctemp.workers.dev/#organization" },
    inLanguage: "en",
  }, web];
  if (faq.length) graph.push({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  });
  const ld = graph.map(jsonLd).join("\n");
  const escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const faqHtml = faq.length ? `<section class="card faq" aria-labelledby="faq-title"><h2 id="faq-title">Frequently asked questions</h2>${faq.map(([question, answer]) => `<details><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join("")}</section>` : "";
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | VaultBackup</title>
<meta name="description" content="${description}">
<meta name="robots" content="index,follow">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">\n<meta property="og:url" content="${canonical}">\n<meta property="og:site_name" content="VaultBackup">\n<meta property="og:title" content="${title} | VaultBackup">
<meta property="og:description" content="${description}">
<meta property="og:image" content="https://backup.enadoctemp.workers.dev/og.svg">\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${title} | VaultBackup">\n<meta name="twitter:description" content="${description}">\n<meta name="twitter:image" content="https://backup.enadoctemp.workers.dev/og.svg">
${ld}
<style>${SHELL_CSS}</style></head><body>
<div class="topbar"><div class="topbar-inner">
  <a class="brand" href="/"><img src="/icon.svg" width="28" height="28" alt=""><div><span>VaultBackup</span><small>Database backup platform</small></div></a>
  <nav class="nav" aria-label="Primary">
    <a href="/docs/about">About</a>
    <a href="/docs/product">Product</a>
    <a href="/docs/security">Security</a>
    <a href="/docs">Docs</a>
    <a href="/install">Install</a>
    <a class="cta" href="/">Sign in</a>
  </nav>
</div></div>
<main>${body}${faqHtml}</main>
<footer class="site-footer"><div class="site-footer-inner">
  <div><a class="brand" href="/" style="margin-bottom:.75rem"><img src="/icon.svg" width="28" height="28" alt=""><div><span>VaultBackup</span><small>Your data. Your storage.</small></div></a>
  <p class="muted" style="margin:0;font-size:.875rem">Encrypted database backups for SMBs and accounting firms.</p></div>
  <div><h3>Product</h3><a href="/docs/about">About</a><a href="/docs/product">Overview</a><a href="/install">Desktop agent</a></div>
  <div><h3>Resources</h3><a href="/docs">Documentation</a><a href="/docs/restore">Restore</a><a href="/docs/security">Security</a></div>
  <div><h3>Company</h3><a href="/docs/support">Support</a><a href="/docs/privacy">Privacy</a><a href="/">Customer login</a></div>
  <div class="legal"><span>&copy; ${new Date().getFullYear()} VaultBackup. All rights reserved.</span>
  <span><a href="/docs/privacy" style="display:inline;color:inherit">Privacy</a> · <a href="/docs/support" style="display:inline;color:inherit">Support</a></span></div>
</div></footer>
</body></html>`;
}

const pages = {
  "/docs/about": page("About VaultBackup", "Learn why VaultBackup is built for small businesses and accounting firms that want encrypted database backups in storage they control.", "/docs/about",
    `<div class="hero"><p class="eyebrow">About VaultBackup</p><h1>Database backups to storage you control</h1>
<p class="lead">VaultBackup combines a desktop backup agent with a lightweight cloud console. It is designed for small businesses and accounting firms that want control over where backup files are stored.</p></div>
<div class="card"><h2>What the product does</h2><p>The desktop agent runs on a machine that can reach your database, creates a backup, optionally encrypts the backup file, and uploads it directly to the destination you configure. Supported destinations include local disk, S3-compatible storage, Azure Blob, WebDAV, and SFTP.</p></div>
<div class="card"><h2>Why customer-owned storage?</h2><p>Keep backup objects in your own bucket, NAS, or disk and contract with the storage provider directly. VaultBackup provides the agent and control plane rather than requiring every backup byte to pass through the cloud console.</p></div>
<div class="card"><h2>Who it is for</h2><ul><li>Accounting firms protecting office and client databases</li><li>Small and medium businesses that want direct control of backup destinations</li><li>Teams with databases on private networks that a cloud service cannot directly reach</li></ul><p><a class="btn" href="/install">Install the desktop agent</a> <a class="btn secondary" href="/docs/product">Explore product capabilities</a></p></div>`,
    [["What is VaultBackup?", "VaultBackup is a database backup platform with a desktop agent and cloud console. The agent backs up supported databases and sends backup files directly to storage configured by the customer."],["Where are backup files stored?", "Backup files are sent to the destination configured by the customer, such as local disk, S3-compatible storage, Azure Blob, WebDAV, or SFTP."]]),

  "/docs": page("VaultBackup Documentation", "Documentation for installing, configuring, securing, and restoring VaultBackup database backups.", "/docs",
    `<div class="hero"><p class="eyebrow">Documentation</p><h1>VaultBackup guides</h1><p class="lead">Practical product, installation, storage, security, and recovery information.</p></div>
<div class="card"><h2>Getting started</h2><ul><li><a href="/install">Install the desktop agent</a></li><li><a href="/docs/product">Product overview and supported workflows</a></li><li><a href="/docs/agent">Desktop agent setup</a></li></ul></div>
<div class="card"><h2>Database guides</h2><ul><li><a href="/docs/sql-server-backup">SQL Server backup</a></li><li><a href="/docs/postgresql-backup">PostgreSQL backup</a></li><li><a href="/docs/mysql-backup">MySQL and MariaDB backup</a></li><li><a href="/docs/mongodb-backup">MongoDB backup</a></li><li><a href="/docs/redis-backup">Redis backup</a></li><li><a href="/docs/accounting-firms">Accounting firm use case</a></li></ul></div>\n<div class="card"><h2>Operations and security</h2><ul><li><a href="/docs/storage">Configure your storage destination</a></li><li><a href="/docs/security">Security model and encryption</a></li><li><a href="/docs/restore">Restore a backup</a></li><li><a href="/docs/support">Troubleshooting and support</a></li><li><a href="/docs/privacy">Data handling summary</a></li></ul></div>
<p class="muted">For detailed engine and platform compatibility, see the <a href="https://github.com/VaultBackup/VaultBackup/blob/main/CAPABILITIES.md">capability matrix</a>.</p>`),

  "/docs/product": page("VaultBackup Product Overview", "Understand the VaultBackup desktop agent, cloud console, supported databases, backup encryption, and customer-owned storage destinations.", "/docs/product",
    `<div class="hero"><p class="eyebrow">Product overview</p><h1>Backup architecture built around your storage</h1><p class="lead">Run backup jobs from the machine that can reach the database, then upload the resulting backup directly to your chosen destination.</p></div>
<div class="card"><h2>Desktop agent and cloud console</h2><p>The desktop agent handles database access, backup creation, optional file encryption, and destination uploads. The cloud console handles account access, agent tokens, licensing, status, and job visibility. For normal agent destinations, backup bytes do not transit through the Worker.</p></div>
<div class="card"><h2>Supported database families</h2><p>The agent capability matrix lists SQLite/Turso/libSQL, PostgreSQL, CockroachDB, MySQL, MariaDB, Microsoft SQL Server, MongoDB, Redis, Oracle logical exports, file-based sources, and selected custom command workflows. Support varies by engine and backup type. Review the <a href="https://github.com/VaultBackup/VaultBackup/blob/main/CAPABILITIES.md">current capability matrix</a> before deployment.</p></div>
<div class="card"><h2>Storage destinations</h2><p>Configure local disk, S3-compatible storage such as AWS S3, Cloudflare R2, Backblaze B2, Wasabi, or MinIO, Azure Blob, WebDAV, or SFTP. Credentials and network access are configured on the agent host.</p></div>
<div class="card"><h2>Important limits</h2><p>The desktop agent is intended for larger and private-network workloads. The separate Worker-based cloud database path has an approximately 20 MB practical dump limit and requires publicly reachable database hosts. Do not confuse this limit with the desktop agent.</p></div>
<p><a class="btn" href="/install">Get the agent</a> <a class="btn secondary" href="/docs/storage">Storage guide</a></p>`,
    [["Does VaultBackup store backup files in its cloud console?", "For normal desktop-agent destinations, the agent uploads backup bytes directly to the customer-configured storage. The Worker provides licensing and control-plane functions."],["Does VaultBackup support private office databases?", "Yes. Install the desktop agent on a machine that can reach the private database. The cloud Worker cannot directly reach a private LAN database."],["Is backup-file encryption automatic?", "Backup-file encryption is optional and can be enabled in the agent configuration. Agent configuration secrets are separately sealed at rest."]]),

  "/docs/agent": page("VaultBackup Desktop Agent", "Install and configure the VaultBackup desktop agent on Windows, macOS, or Linux to back up databases from the machine that can reach them.", "/docs/agent",
    `<div class="hero"><p class="eyebrow">Desktop agent</p><h1>Run backups close to your database</h1><p class="lead">The agent runs on Windows, macOS, or Linux and can reach databases on the local machine or private network.</p></div>
<div class="card"><h2>Install steps</h2><ol><li>Download the correct build from the <a href="/install">install page</a>.</li><li>Sign in to the console and create a Desktop Agent token.</li><li>Start the agent and open its local setup UI at <code>http://127.0.0.1:8787</code>.</li><li>Enter the token, test the database connection, and test the storage destination.</li><li>Save the configuration and run a test backup.</li></ol></div>
<div class="card"><h2>Windows installation</h2><p>The Windows MSI is the recommended installer for supported x64 Windows systems. Portable EXE builds are also published. Install with administrator privileges when using the service installer.</p><p><a class="btn" href="/download/windows-msi">Download Windows MSI</a> <a class="btn secondary" href="/install">All downloads</a></p></div>
<div class="card"><h2>Local UI security</h2><p>The setup UI binds to <code>127.0.0.1</code> by default. Keep it on localhost unless remote access is required and properly protected. Use the optional UI password and restrict host access.</p></div>`,
    [["Where do I enter the agent token?", "Open the local agent setup page at http://127.0.0.1:8787 and paste the token created in the VaultBackup dashboard."],["Can the agent back up a database on a private LAN?", "Yes. Run the agent on a host that has network access to the database. The cloud Worker itself cannot connect to private LAN addresses."]]),

  "/docs/storage": page("VaultBackup Own-Storage Guide", "Send encrypted database backups to your own S3, Cloudflare R2, Backblaze B2, Wasabi, Azure Blob, WebDAV, SFTP, or local disk destination.", "/docs/storage",
    `<div class="hero"><p class="eyebrow">Bring your own storage</p><h1>Choose where backup files live</h1><p class="lead">VaultBackup sends agent backup files directly to the destination configured in your agent.</p></div>
<div class="card"><h2>Supported destinations</h2><ul><li><strong>S3-compatible:</strong> AWS S3, Cloudflare R2, Backblaze B2, Wasabi, and MinIO</li><li><strong>Azure Blob:</strong> Shared Key authentication</li><li><strong>WebDAV:</strong> including supported large-file upload strategies</li><li><strong>SFTP:</strong> password or key-file authentication</li><li><strong>Local disk:</strong> a folder accessible to the agent service account</li></ul></div>
<div class="card"><h2>Configure a destination safely</h2><ol><li>Create a private bucket, container, folder, or account dedicated to backups.</li><li>Use credentials with only the required access to the intended bucket or prefix.</li><li>Enter endpoint, region, bucket/container, and credentials in the agent setup UI.</li><li>Run the destination connection test before saving.</li><li>Run a backup and confirm the object appears in Stored backups.</li></ol></div>
<div class="card"><h2>Encryption and retention</h2><p>Enable optional AES-256-GCM backup-file encryption in the agent when required. Configure retention deliberately and coordinate it with any lifecycle rules at the storage provider. Keep encryption recovery material separate from the backup objects.</p><p><a class="btn" href="/docs/security">Security guide</a> <a class="btn secondary" href="/docs/restore">Restore guide</a></p></div>`,
    [["Can I use my own S3 bucket?", "Yes. Configure an S3 or S3-compatible destination, including AWS S3, Cloudflare R2, Backblaze B2, Wasabi, or MinIO."],["Does backup traffic pass through VaultBackup?", "For normal desktop-agent destinations, backup files are uploaded directly from the agent to the configured storage destination. The Worker handles licensing and control-plane functions."]]),

  "/docs/security": page("VaultBackup Security Overview", "Review VaultBackup security controls, agent configuration secret sealing, optional backup-file encryption, and deployment responsibilities.", "/docs/security",
    `<div class="hero"><p class="eyebrow">Security</p><h1>Understand the security boundaries</h1><p class="lead">VaultBackup provides security controls, while operators remain responsible for host hardening, storage permissions, key recovery, and restore validation.</p></div>
<div class="card"><h2>Agent configuration secrets</h2><p>Sensitive agent configuration values, including database and storage credentials, are stored in a sealed configuration envelope using AES-256-GCM. The agent uses a separate key file. Protect both the configuration and key file with host permissions and disk encryption.</p></div>
<div class="card"><h2>Backup-file encryption</h2><p>Backup-file encryption is optional and can be enabled in the agent configuration. When enabled, files are encrypted before upload. Store recovery material separately from the backup destination and test decryption and restore procedures.</p></div>
<div class="card"><h2>Network and access controls</h2><ul><li>The local agent UI binds to localhost by default.</li><li>Use least-privilege credentials for databases and storage destinations.</li><li>Keep registration disabled unless account creation is intentionally enabled.</li><li>Protect agent tokens and rotate them after suspected exposure.</li></ul></div>
<div class="card"><h2>What this page does not claim</h2><p>This overview is not a certification, penetration-test attestation, or guarantee of recovery. Encryption settings, supported database operations, and restore results depend on the deployed configuration. Schedule independent restore drills.</p></div>`,
    [["Are backup files encrypted by default?", "Backup-file encryption is optional and must be enabled in the agent configuration. Agent configuration secrets are separately sealed at rest."],["Does encryption remove the need for key backups?", "No. Keep encryption recovery material separate and protected. Without the required key material, encrypted backup files may not be recoverable."],["Does VaultBackup guarantee successful recovery?", "No software can guarantee recovery without validation. Perform scheduled restore drills and verify the restored database and application."]]),

  "/docs/restore": page("Restore a VaultBackup Backup", "Learn the safe workflow for locating, decrypting, restoring, and validating a VaultBackup database backup.", "/docs/restore",
    `<div class="hero"><p class="eyebrow">Recovery</p><h1>Plan and validate restores</h1><p class="lead">A successful backup job is not proof that an application can be recovered. Test the full restore path on a separate environment.</p></div>
<div class="card"><h2>Restore workflow</h2><ol><li>Identify the backup object and confirm its timestamp and source database.</li><li>Download or retrieve the object from your configured storage.</li><li>If file encryption is enabled, use the correct recovery key material to decrypt it.</li><li>Restore using the matching database engine and appropriate native tooling or agent workflow.</li><li>Check database integrity, schema, expected records, and application functionality.</li><li>Record the result, elapsed recovery time, and any corrective actions.</li></ol></div>
<div class="card"><h2>Important precautions</h2><ul><li>Restore to an isolated test instance first, not over production.</li><li>Confirm the database engine and version compatibility.</li><li>Preserve encryption keys and credentials separately from backup objects.</li><li>Document recovery point and recovery time objectives, then test them.</li></ul></div>
<p><a class="btn" href="/docs/security">Security and key handling</a> <a class="btn secondary" href="/docs/support">Troubleshooting</a></p>`,
    [["Does a successful backup mean the restore is verified?", "No. A successful backup status confirms the backup job completed, not that the database can be restored and used. Run scheduled restore drills."],["Where should I test a restore?", "Use a separate, isolated test environment so the test does not overwrite production data."]]),

  "/docs/support": page("VaultBackup Support", "Troubleshoot VaultBackup agent, database connectivity, storage destinations, licensing, and restore workflows.", "/docs/support",
    `<div class="hero"><p class="eyebrow">Support</p><h1>Get help with VaultBackup</h1><p class="lead">Start with the agent history and logs, then collect the exact error before contacting support.</p></div>
<div class="card"><h2>Before contacting support</h2><ol><li>Open the local agent at <code>http://127.0.0.1:8787</code> and inspect Recent history and Logs.</li><li>Confirm the agent host can reach the database and storage destination.</li><li>Check license status in the local UI and dashboard.</li><li>Record the agent version, operating system, error code, and approximate time of failure.</li></ol></div>
<div class="card"><h2>Common troubleshooting</h2><ul><li><strong>Database connection:</strong> verify hostname, port, credentials, firewall, and database service status.</li><li><strong>Storage upload:</strong> verify endpoint, region, bucket, credentials, and write permissions.</li><li><strong>Disk space:</strong> ensure the agent work directory has sufficient free space.</li><li><strong>License:</strong> check token validity and whether the device is bound to another agent.</li></ul></div>
<div class="card"><h2>Contact</h2><p>Use the same email address associated with your VaultBackup account. Include your company name, agent version, relevant error text, and steps to reproduce. Never send passwords, agent tokens, encryption keys, or storage secrets.</p><p><a class="btn" href="/">Open dashboard</a> <a class="btn secondary" href="/install">Install guide</a></p></div>`),

  "/docs/privacy": page("VaultBackup Data Handling Summary", "A concise summary of the data categories used by the VaultBackup service and where customer backup files are stored.", "/docs/privacy",
    `<div class="hero"><p class="eyebrow">Data handling</p><h1>Data handling summary</h1><p class="lead">This page summarizes the product architecture. It is not a substitute for a complete legal privacy notice or customer agreement.</p></div>
<div class="card"><h2>Service and account data</h2><p>The cloud console processes account and authentication information, agent registration and token metadata, licensing checks, heartbeats, and operational job status needed to provide the service.</p></div>
<div class="card"><h2>Backup content and destinations</h2><p>For normal desktop-agent workflows, backup files are uploaded directly from the agent to the storage destination configured by the customer. Customers are responsible for the access policies, retention settings, data residency, and protection of that destination.</p></div>
<div class="card"><h2>Credentials and security</h2><p>Agent configuration secrets are sealed on the agent host. Treat account credentials, agent tokens, storage keys, and encryption recovery material as confidential. Do not include them in support requests.</p></div>
<p class="muted">For formal privacy, retention, and contractual questions, contact the service operator before deploying with regulated or sensitive data.</p>`),

  "/docs/accounting-firms": page("Database Backup for Accounting Firms", "VaultBackup helps accounting firms back up supported office databases from private networks to storage the firm controls.", "/docs/accounting-firms",
    `<div class="hero"><p class="eyebrow">Use case</p><h1>Database backup for accounting firms</h1><p class="lead">Protect office and client workloads without requiring a cloud backup service to connect directly to private office networks.</p></div>
<div class="card"><h2>Run the agent where the data is</h2><p>Install the desktop agent on a Windows, macOS, or Linux host that can reach the database. This is useful for SQL Server and other supported databases running on office PCs or private LAN servers.</p></div>
<div class="card"><h2>Keep storage under firm control</h2><p>Send backup files to a firm-managed S3 bucket, B2, Wasabi, R2, Azure Blob, WebDAV, SFTP, or local disk. Use separate buckets or prefixes for client separation and least-privilege credentials.</p></div>
<div class="card"><h2>Build a recovery process</h2><p>Define retention, protect encryption recovery material, and schedule restore drills. Validate client-specific recovery procedures rather than relying only on green backup status.</p><p><a class="btn" href="/install">Install the agent</a> <a class="btn secondary" href="/docs/restore">Restore planning</a></p></div>`,
    [["Can an accounting firm back up a private office SQL Server?", "Yes. Install the VaultBackup desktop agent on a machine that can reach the SQL Server instance. The cloud Worker cannot directly access a private LAN database."],["Can each client use a separate storage location?", "The agent supports customer-configured storage destinations. Firms can use separate buckets or prefixes and least-privilege credentials for client separation."]]),

  "/docs/sql-server-backup": page("SQL Server Backup for Private Networks", "Use the VaultBackup desktop agent on a Windows host that can reach Microsoft SQL Server, then upload backup files to your own storage.", "/docs/sql-server-backup",
    `<div class="hero"><p class="eyebrow">Database guide</p><h1>SQL Server backup for office networks</h1><p class="lead">Run the VaultBackup agent on a Windows machine with network access to SQL Server, including private LAN deployments.</p></div>
<div class="card"><h2>How it works</h2><ol><li>Install the Windows agent on the database host or another permitted machine.</li><li>Create an agent token in the VaultBackup console.</li><li>Configure SQL Server connectivity in the local agent UI and test the connection.</li><li>Choose and test your storage destination.</li><li>Schedule backups and validate a restore in a separate SQL Server environment.</li></ol></div>
<div class="card"><h2>Connectivity and operational notes</h2><p>Confirm SQL Server TCP connectivity, instance/port configuration, firewall rules, and the database account permissions required by the selected backup method. Review the current <a href="https://github.com/VaultBackup/VaultBackup/blob/main/CAPABILITIES.md">capability matrix</a> for current SQL Server backup details and limitations.</p></div>
<p><a class="btn" href="/install">Download Windows agent</a> <a class="btn secondary" href="/docs/accounting-firms">Accounting firm use case</a></p>`,
    [["Can VaultBackup reach SQL Server on a private office LAN?", "The cloud Worker cannot reach private LAN addresses. Run the desktop agent on a machine that has network access to the SQL Server instance."],["Where are SQL Server backup files stored?", "The agent uploads backup files directly to the storage destination configured by the customer."]]),

  "/docs/postgresql-backup": page("PostgreSQL Backup", "Back up PostgreSQL databases using the VaultBackup agent, with optional native pg_dump tooling and customer-owned storage.", "/docs/postgresql-backup",
    `<div class="hero"><p class="eyebrow">Database guide</p><h1>PostgreSQL backup</h1><p class="lead">Run PostgreSQL backup jobs from the desktop agent on a host that can reach your database.</p></div>
<div class="card"><h2>Agent workflow</h2><p>The agent supports full and schema-only PostgreSQL backup modes. It includes a built-in dump path and can optionally use native <code>pg_dump</code> when configured. For large databases, review the capability matrix and test the chosen method against your version and workload.</p></div>
<div class="card"><h2>Deployment checklist</h2><ul><li>Verify database host, port, user permissions, and TLS requirements.</li><li>Prefer an explicit loopback address such as <code>127.0.0.1</code> when connecting locally and appropriate.</li><li>Test the database and storage destination in the agent UI.</li><li>Perform a restore drill using a compatible PostgreSQL environment.</li></ul></div>
<p><a class="btn" href="/install">Install agent</a> <a class="btn secondary" href="/docs/restore">Restore guide</a></p>`,
    [["Does the agent require pg_dump?", "The agent includes a built-in PostgreSQL dump path. Native pg_dump is optional and may be preferred for some workloads."],["Does VaultBackup verify PostgreSQL restores automatically?", "A successful backup job is not an automatic restore test. Run and document a separate restore drill."]]),

  "/docs/mysql-backup": page("MySQL and MariaDB Backup", "Back up MySQL and MariaDB databases with the VaultBackup desktop agent and store backup files in your own destination.", "/docs/mysql-backup",
    `<div class="hero"><p class="eyebrow">Database guide</p><h1>MySQL and MariaDB backup</h1><p class="lead">Schedule database backups from the agent host and upload the resulting files directly to your storage.</p></div>
<div class="card"><h2>Supported workflow</h2><p>The agent supports full and schema-only backup modes for MySQL and MariaDB. It includes built-in dump support and can optionally use native <code>mysqldump</code>. Choose the method that matches your database version, size, and operational requirements.</p></div>
<div class="card"><h2>Before scheduling</h2><ul><li>Confirm TCP connectivity, host, port, and database permissions.</li><li>Test the destination and ensure the service account can access it.</li><li>For large dumps, review disk space and the native-tool recommendations in the capability matrix.</li><li>Test a restore in a separate MySQL or MariaDB instance.</li></ul></div>
<p><a class="btn" href="/install">Install agent</a> <a class="btn secondary" href="/docs/restore">Restore guide</a></p>`,
    [["Does VaultBackup require mysqldump?", "The agent includes built-in MySQL and MariaDB dump support. Native mysqldump is optional and may be preferred for some workloads."],["Can I store MySQL backups in my own S3 bucket?", "Yes. Configure an S3-compatible destination, including AWS S3, Cloudflare R2, Backblaze B2, Wasabi, or MinIO."]]),,

  "/docs/mongodb-backup": page("MongoDB Backup", "Back up MongoDB databases using the VaultBackup desktop agent and store backup files in your own destination.", "/docs/mongodb-backup",
    `<div class="hero"><p class="eyebrow">Database guide</p><h1>MongoDB backup</h1><p class="lead">Run MongoDB backup jobs from a host that can reach your deployment, then send the backup archive to your configured storage destination.</p></div>
<div class="card"><h2>Supported workflow</h2><p>The agent supports full MongoDB backups and a limited schema-only mode. The capability matrix documents the built-in path and optional <code>mongodump</code> tooling. Validate behavior against your MongoDB topology, version, and permissions before relying on a schedule.</p></div>
<div class="card"><h2>Deployment checklist</h2><ul><li>Confirm the agent host can reach the MongoDB deployment and required replica-set members.</li><li>Use a dedicated database account with the permissions required by the selected dump method.</li><li>Test the destination and confirm the archive appears in Stored backups.</li><li>Restore into an isolated MongoDB environment and validate collections and application behavior.</li></ul></div>
<p><a class="btn" href="/install">Install agent</a> <a class="btn secondary" href="/docs/restore">Restore guide</a></p>`,
    [["Does VaultBackup support MongoDB backups?", "The desktop agent supports full MongoDB backups. Schema-only support is limited. Review the current capability matrix for details and validate your deployment."],["Does a successful MongoDB backup confirm recovery?", "No. Restore the backup into a separate MongoDB environment and verify the required collections and application behavior."]]),

  "/docs/redis-backup": page("Redis Backup", "Create Redis backups with the VaultBackup desktop agent and send backup files to storage you control.", "/docs/redis-backup",
    `<div class="hero"><p class="eyebrow">Database guide</p><h1>Redis backup</h1><p class="lead">Use the VaultBackup agent on a host that can connect to Redis and store the resulting backup artifact in your configured destination.</p></div>
<div class="card"><h2>Supported workflow</h2><p>The agent lists Redis full backup support using a snapshot-style workflow. Confirm the Redis persistence and snapshot behavior that matches your operational requirements before scheduling production backups.</p></div>
<div class="card"><h2>Before scheduling</h2><ul><li>Verify Redis host, port, authentication, TLS, and network access.</li><li>Understand whether the selected snapshot represents the required recovery point.</li><li>Test uploads to your destination and verify the object is present.</li><li>Perform a restore test with a separate Redis instance and validate the application.</li></ul></div>
<p><a class="btn" href="/install">Install agent</a> <a class="btn secondary" href="/docs/restore">Restore guide</a></p>`,
    [["Does VaultBackup support Redis backups?", "The desktop agent supports full Redis backups using a snapshot-style workflow."],["Are Redis restores tested automatically?", "No. Run a separate restore drill with a test Redis instance and validate the application that depends on it."]]),
};

const markerStart = "/* __PUBLIC_DOCS_START__ */";
const markerEnd = "/* __PUBLIC_DOCS_END__ */";
const block = `${markerStart}
const PUBLIC_DOCS = ${JSON.stringify(pages)};
function publicDocsResponse(docPath) {
  const html = PUBLIC_DOCS[docPath];
  if (!html) return null;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    },
  });
}
${markerEnd}
`;

if (s.includes(markerStart) && s.includes(markerEnd)) {
  s = s.replace(new RegExp(markerStart.replace(/[/*]/g, "\\$&") + "[\\s\\S]*?" + markerEnd.replace(/[/*]/g, "\\$&")), block);
} else if (s.includes("const AGENT_BINARIES")) {
  s = s.replace("const AGENT_BINARIES", block + "\nconst AGENT_BINARIES");
} else {
  s = block + "\n" + s;
}

const installCombo = 'if (method === "GET" && (path === "/install" || path === "/download" || path === "/agent"))';
const docsBefore = `if (method === "GET" && (path === "/docs" || path.startsWith("/docs/"))) {
    const docRes = publicDocsResponse(path);
    if (docRes) return docRes;
  }
  ${installCombo}`;
if (s.includes(installCombo) && !s.includes("publicDocsResponse(path)")) {
  s = s.replace(installCombo, docsBefore);
} else if (s.includes(installCombo) && !s.includes('path === "/docs" || path.startsWith("/docs/")')) {
  s = s.replace(installCombo, docsBefore);
}

fs.writeFileSync(file, s);
console.log("docs embedded", s.length);
