#!/usr/bin/env node
/** Professional public docs + About (company-style). */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

function jsonLd(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

const SHELL_CSS = `
:root{--bg:#020617;--card:#0f172a;--border:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--brand:#22c55e;--brand-dim:#16a34a}
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.65}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
.topbar{border-bottom:1px solid var(--border);background:rgba(2,6,23,.92);backdrop-filter:blur(8px);position:sticky;top:0;z-index:20}
.topbar-inner{max-width:64rem;margin:0 auto;padding:.85rem 1.25rem;display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:.65rem;color:#fff;text-decoration:none;font-weight:700}
.brand img,.brand svg{width:28px;height:28px;border-radius:7px}
.brand span{font-size:1rem;letter-spacing:-.01em}
.brand small{display:block;font-weight:500;font-size:.7rem;color:var(--muted);letter-spacing:.02em}
.nav{display:flex;gap:1rem;flex-wrap:wrap;font-size:.875rem;align-items:center}
.nav a{color:var(--muted)} .nav a:hover{color:#fff;text-decoration:none}
.nav a.cta{background:var(--brand);color:#052e16;font-weight:700;padding:.4rem .75rem;border-radius:8px}
.nav a.cta:hover{filter:brightness(1.05)}
main{max-width:48rem;margin:0 auto;padding:2rem 1.25rem 3rem}
.hero{padding:1rem 0 1.5rem;border-bottom:1px solid var(--border);margin-bottom:1.5rem}
.eyebrow{font-size:.75rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--brand);margin:0 0 .5rem}
h1{font-size:clamp(1.75rem,4vw,2.25rem);line-height:1.2;margin:0 0 .75rem;letter-spacing:-.02em;color:#fff}
.lead{font-size:1.1rem;color:var(--muted);margin:0;max-width:40rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:1.35rem 1.4rem;margin:1.15rem 0}
h2{font-size:1.05rem;margin:0 0 .65rem;color:#fff;letter-spacing:-.01em}
h3{font-size:.95rem;margin:1rem 0 .35rem;color:#f1f5f9}
.muted{color:var(--muted)}
.grid-2{display:grid;gap:1rem}@media(min-width:640px){.grid-2{grid-template-columns:1fr 1fr}}
.stat{background:#0b1220;border:1px solid var(--border);border-radius:12px;padding:1rem}
.stat strong{display:block;font-size:1.15rem;color:#fff}
.stat span{font-size:.8rem;color:var(--muted)}
ul,ol{margin:.4rem 0;padding-left:1.2rem}li{margin:.4rem 0}
.btn{display:inline-block;background:var(--brand);color:#052e16!important;font-weight:700;padding:.6rem 1rem;border-radius:9px;text-decoration:none!important;margin:.25rem .4rem .25rem 0}
.btn.secondary{background:#1e293b;color:#e2e8f0!important;border:1px solid var(--border)}
.btn:hover{filter:brightness(1.06)}
pre{background:#0b1220;border:1px solid var(--border);border-radius:8px;padding:.85rem 1rem;overflow:auto;font-size:.85rem}
.site-footer{border-top:1px solid var(--border);margin-top:2rem;background:#01040c}
.site-footer-inner{max-width:64rem;margin:0 auto;padding:2rem 1.25rem;display:grid;gap:1.5rem}
@media(min-width:700px){.site-footer-inner{grid-template-columns:2fr 1fr 1fr 1fr}}
.site-footer h3{margin:0 0 .6rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:#64748b}
.site-footer a{display:block;color:var(--muted);font-size:.875rem;margin:.35rem 0;text-decoration:none}
.site-footer a:hover{color:#fff}
.site-footer .legal{grid-column:1/-1;border-top:1px solid var(--border);padding-top:1rem;font-size:.8rem;color:#64748b;display:flex;flex-wrap:wrap;gap:.75rem 1.25rem;justify-content:space-between}
`;

function page(title, description, path, body, extraLd = []) {
  const canonical = `https://backup.enadoctemp.workers.dev${path}`;
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "VaultBackup",
    url: "https://backup.enadoctemp.workers.dev/",
    logo: "https://backup.enadoctemp.workers.dev/icon.svg",
    description: "Encrypted database backups for SMBs and accounting firms, stored in customer-owned storage.",
  };
  const web = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: "VaultBackup", url: "https://backup.enadoctemp.workers.dev/" },
  };
  const ld = [org, web, ...extraLd].map(jsonLd).join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | VaultBackup</title>
<meta name="description" content="${description}">
<meta name="robots" content="index,follow">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/icon.svg">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="VaultBackup">
<meta property="og:title" content="${title} | VaultBackup">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="https://backup.enadoctemp.workers.dev/og.svg">
<meta name="twitter:card" content="summary_large_image">
${ld}
<style>${SHELL_CSS}</style></head><body>
<div class="topbar"><div class="topbar-inner">
  <a class="brand" href="/">
    <img src="/icon.svg" width="28" height="28" alt="">
    <div><span>VaultBackup</span><small>Database backup platform</small></div>
  </a>
  <nav class="nav" aria-label="Primary">
    <a href="/docs/about">About</a>
    <a href="/docs/product">Product</a>
    <a href="/docs/security">Security</a>
    <a href="/docs">Docs</a>
    <a href="/install">Install</a>
    <a class="cta" href="/">Sign in</a>
  </nav>
</div></div>
<main>
${body}
</main>
<footer class="site-footer"><div class="site-footer-inner">
  <div>
    <a class="brand" href="/" style="margin-bottom:.75rem">
      <img src="/icon.svg" width="28" height="28" alt="">
      <div><span>VaultBackup</span><small>Your data. Your storage.</small></div>
    </a>
    <p class="muted" style="margin:0;font-size:.875rem;max-width:22rem">Encrypted database backups for SMBs and accounting firms. Built for office databases and customer-owned buckets.</p>
  </div>
  <div>
    <h3>Product</h3>
    <a href="/docs/about">About</a>
    <a href="/docs/product">Overview</a>
    <a href="/docs/storage">Own storage</a>
    <a href="/install">Desktop agent</a>
  </div>
  <div>
    <h3>Resources</h3>
    <a href="/docs">Documentation</a>
    <a href="/docs/restore">Restore guide</a>
    <a href="/docs/security">Security</a>
    <a href="/download/windows-msi">Windows MSI</a>
  </div>
  <div>
    <h3>Company</h3>
    <a href="/docs/about">About us</a>
    <a href="/docs/privacy">Privacy</a>
    <a href="/docs/support">Support</a>
    <a href="/">Customer login</a>
  </div>
  <div class="legal">
    <span>&copy; ${new Date().getFullYear()} VaultBackup. All rights reserved.</span>
    <span><a href="/docs/privacy" style="display:inline;color:inherit">Privacy</a> · <a href="/docs/support" style="display:inline;color:inherit">Support</a></span>
  </div>
</div></footer>
</body></html>`;
}

const aboutLd = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: "About VaultBackup",
  url: "https://backup.enadoctemp.workers.dev/docs/about",
  mainEntity: {
    "@type": "Organization",
    name: "VaultBackup",
    url: "https://backup.enadoctemp.workers.dev/",
    description: "Database backup platform for SMBs and accounting firms using customer-owned storage.",
  },
};

const pages = {
  "/docs/about": page(
    "About",
    "VaultBackup is a database backup platform for SMBs and accounting firms. Encrypt backups and store them in your own S3, B2, Wasabi, R2, or local disk.",
    "/docs/about",
    `<div class="hero">
  <p class="eyebrow">Company</p>
  <h1>Backups that stay on infrastructure you control</h1>
  <p class="lead">VaultBackup is a database backup platform built for small and medium businesses and accounting firms. We focus on practical office databases, clear setup, and storage accounts you already own.</p>
</div>

<div class="grid-2">
  <div class="stat"><strong>Your bucket</strong><span>S3, B2, Wasabi, R2, Azure, disk</span></div>
  <div class="stat"><strong>Office-ready</strong><span>Desktop agent for LAN databases</span></div>
  <div class="stat"><strong>Encrypted</strong><span>Optional AES-256-GCM before upload</span></div>
  <div class="stat"><strong>Predictable cost</strong><span>You pay your storage provider</span></div>
</div>

<div class="card">
  <h2>Our mission</h2>
  <p class="muted" style="margin:0">Make reliable database backup accessible without forcing teams into expensive all-in-one vaults. Firms should be able to keep backups encrypted, scheduled, and stored in a place they control.</p>
</div>

<div class="card">
  <h2>What we build</h2>
  <ul>
    <li><strong>Desktop agent</strong> for Windows, macOS, and Linux, including a Windows MSI for office PCs</li>
    <li><strong>Token-based onboarding</strong> so setup is guided and short</li>
    <li><strong>Bring-your-own storage</strong> for S3-compatible APIs, WebDAV, and local folders</li>
    <li><strong>Control plane</strong> for license checks, agent health, and optional cloud database jobs</li>
  </ul>
</div>

<div class="card">
  <h2>Who we serve</h2>
  <ul>
    <li>Accounting and bookkeeping practices with SQL Server or local MySQL</li>
    <li>SMBs that need scheduled dumps without a large backup SaaS bill</li>
    <li>Teams that care about data residency and holding their own encryption and storage keys</li>
  </ul>
</div>

<div class="card">
  <h2>How companies use VaultBackup</h2>
  <ol>
    <li>Create an account and an agent token in the console</li>
    <li>Install the agent on the machine that can see the database</li>
    <li>Connect the database and your storage destination</li>
    <li>Schedule backups and verify the first successful run</li>
  </ol>
  <p style="margin-top:1rem">
    <a class="btn" href="/install">Install the desktop agent</a>
    <a class="btn secondary" href="/docs/product">Product overview</a>
    <a class="btn secondary" href="/docs/security">Security</a>
  </p>
</div>

<div class="card">
  <h2>Trust and security</h2>
  <p class="muted">Agent configuration secrets are sealed at rest. Backup files can be encrypted before they leave the machine. Public registration is controlled by the operator. See the <a href="/docs/security">security overview</a> and <a href="/docs/privacy">privacy summary</a>.</p>
</div>

<div class="card">
  <h2>Contact</h2>
  <p class="muted" style="margin:0">For product access, licensing, or operational issues, use <a href="/docs/support">Support</a>. If you received an agent token from a partner or administrator, start with them for account-specific help.</p>
</div>`,
    [aboutLd]
  ),

  "/docs": page("Documentation", "VaultBackup documentation: install, storage, security, restore, and support.", "/docs",
    `<div class="hero"><p class="eyebrow">Resources</p><h1>Documentation</h1>
<p class="lead">Guides for installing the agent, connecting your storage, and restoring with confidence.</p></div>
<div class="card"><h2>Browse</h2>
<ul>
<li><a href="/docs/about"><strong>About the company</strong></a></li>
<li><a href="/install"><strong>Install the desktop agent</strong></a></li>
<li><a href="/docs/product"><strong>Product overview</strong></a></li>
<li><a href="/docs/storage"><strong>Own storage</strong></a></li>
<li><a href="/docs/security"><strong>Security</strong></a></li>
<li><a href="/docs/restore"><strong>Restore guide</strong></a></li>
<li><a href="/docs/support"><strong>Support</strong></a></li>
<li><a href="/docs/privacy"><strong>Privacy</strong></a></li>
</ul>
<p><a class="btn" href="/download/windows-msi">Download Windows MSI</a>
<a class="btn secondary" href="/install">Install guide</a></p></div>`),

  "/docs/product": page("Product", "VaultBackup product overview for SMBs and accounting firms.", "/docs/product",
    `<div class="hero"><p class="eyebrow">Product</p><h1>Database backup for real offices</h1>
<p class="lead">Agent-based backups to your own storage, with a light control plane for tokens, health, and optional cloud databases.</p></div>
<div class="card"><h2>Two paths</h2>
<ul>
<li><strong>Desktop agent</strong> for LAN and office databases (recommended for accounting firms)</li>
<li><strong>Worker console</strong> for small public cloud databases only</li>
</ul>
<p><a class="btn" href="/install">Install agent</a> <a class="btn secondary" href="/docs/about">About us</a></p></div>`),

  "/docs/security": page("Security", "VaultBackup security practices for agents, encryption, and access control.", "/docs/security",
    `<div class="hero"><p class="eyebrow">Trust</p><h1>Security</h1>
<p class="lead">Practical controls for credentials, backup files, and the control plane.</p></div>
<div class="card"><h2>Highlights</h2>
<ul>
<li>Public sign-up locked unless the operator opens it</li>
<li>Agent secrets sealed at rest (AES-256-GCM + local key file)</li>
<li>Optional AES-256-GCM encryption of backup files before upload</li>
<li>Local agent UI defaults to localhost only</li>
</ul></div>`),

  "/docs/storage": page("Own storage", "Store VaultBackup dumps in S3, B2, Wasabi, R2, Azure, WebDAV, or local disk.", "/docs/storage",
    `<div class="hero"><p class="eyebrow">Product</p><h1>Own storage</h1>
<p class="lead">Backup data belongs in a destination you control.</p></div>
<div class="card"><h2>Supported destinations</h2>
<ul>
<li>AWS S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO</li>
<li>Azure Blob</li>
<li>WebDAV and SFTP</li>
<li>Local disk or NAS path on the agent machine</li>
</ul>
<p><a class="btn" href="/install">Install agent</a></p></div>`),

  "/docs/agent": page("Desktop agent", "Install the VaultBackup desktop agent on Windows, macOS, or Linux.", "/docs/agent",
    `<div class="hero"><p class="eyebrow">Product</p><h1>Desktop agent</h1>
<p class="lead">Runs next to your database. Dumps, optionally encrypts, uploads to your storage.</p></div>
<div class="card"><h2>Quick start</h2>
<ol>
<li>Sign in → Desktop Agents → Create token</li>
<li><a href="/download/windows-msi">Download Windows MSI</a></li>
<li>Open http://127.0.0.1:8787 and complete setup</li>
</ol>
<pre>msiexec /i vaultbackup-agent-windows-amd64.msi</pre></div>`),

  "/docs/restore": page("Restore", "Restore a VaultBackup dump from your own storage.", "/docs/restore",
    `<div class="hero"><p class="eyebrow">Operations</p><h1>Restore a backup</h1>
<p class="lead">Treat restore as a practiced skill, not an emergency experiment.</p></div>
<div class="card"><h2>Standard process</h2>
<ol>
<li>Locate the object in your bucket or folder</li>
<li>Download to a secure machine</li>
<li>Decrypt if the file is agent-encrypted</li>
<li>Restore with the native database tool</li>
<li>Verify the application and key records</li>
</ol>
<p><a class="btn secondary" href="/docs/support">Support</a></p></div>`),

  "/docs/support": page("Support", "Get help with VaultBackup agents, licenses, and failed jobs.", "/docs/support",
    `<div class="hero"><p class="eyebrow">Company</p><h1>Support</h1>
<p class="lead">Start with agent logs and storage connectivity, then escalate to your administrator.</p></div>
<div class="card"><h2>Failed backup checklist</h2>
<ol>
<li>Agent History and Logs on the local UI</li>
<li>Database and storage reachability</li>
<li>License status (online within 72 hours)</li>
<li>Desktop Agents panel on the <a href="/">console</a></li>
</ol>
<p class="muted">Account operators can enable email notifications with Resend credentials on the Worker.</p></div>`),

  "/docs/privacy": page("Privacy", "How VaultBackup handles account data and backup metadata.", "/docs/privacy",
    `<div class="hero"><p class="eyebrow">Company</p><h1>Privacy</h1>
<p class="lead">We minimize what the control plane stores. Backup payloads stay in your storage by default.</p></div>
<div class="card"><h2>Data we handle</h2>
<ul>
<li>Account email and password hash</li>
<li>Agent token metadata and heartbeats</li>
<li>Job success and failure summaries</li>
</ul>
<p>Backup file contents are written to your configured destination unless you explicitly use a managed upload path.</p>
<p><a href="/docs/about">About VaultBackup</a></p></div>`),
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
  console.log("Replaced PUBLIC_DOCS");
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
