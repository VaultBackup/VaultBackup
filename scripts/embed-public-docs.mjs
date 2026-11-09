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
.site-footer .legal{grid-column:1/-1;border-top:1px solid var(--border);padding-top:1rem;font-size:.8rem;color:#64748b;display:flex;flex-wrap:wrap;gap:.75rem 1.25rem;justify-content:space-between}
`;

function page(title, description, path, body) {
  const canonical = `https://backup.enadoctemp.workers.dev${path}`;
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "VaultBackup",
    url: "https://backup.enadoctemp.workers.dev/",
    logo: "https://backup.enadoctemp.workers.dev/icon.svg",
  };
  const web = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url: canonical,
  };
  const ld = [org, web].map(jsonLd).join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | VaultBackup</title>
<meta name="description" content="${description}">
<meta name="robots" content="index,follow">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${title} | VaultBackup">
<meta property="og:description" content="${description}">
<meta property="og:image" content="https://backup.enadoctemp.workers.dev/og.svg">
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
<main>${body}</main>
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
  "/docs/about": page("About", "About VaultBackup, the database backup platform for SMBs and accounting firms.", "/docs/about",
    `<div class="hero"><p class="eyebrow">Company</p><h1>Backups that stay on infrastructure you control</h1>
<p class="lead">VaultBackup helps small businesses and accounting firms run encrypted database backups into storage they own.</p></div>
<div class="card"><h2>Our mission</h2><p class="muted">Make reliable database backup accessible without forcing teams into expensive all-in-one vaults.</p>
<p><a class="btn" href="/install">Install the agent</a> <a class="btn secondary" href="/docs/support">Support</a></p></div>`),

  "/docs": page("Documentation", "VaultBackup documentation hub.", "/docs",
    `<div class="hero"><p class="eyebrow">Resources</p><h1>Documentation</h1>
<p class="lead">Install, storage, security, restore, and support.</p></div>
<div class="card"><ul>
<li><a href="/docs/about">About</a></li>
<li><a href="/install">Install</a></li>
<li><a href="/docs/product">Product</a></li>
<li><a href="/docs/storage">Own storage</a></li>
<li><a href="/docs/security">Security</a></li>
<li><a href="/docs/restore">Restore</a></li>
<li><a href="/docs/support">Support</a></li>
<li><a href="/docs/privacy">Privacy</a></li>
</ul></div>`),

  "/docs/product": page("Product", "VaultBackup product overview.", "/docs/product",
    `<div class="hero"><p class="eyebrow">Product</p><h1>Database backup for real offices</h1>
<p class="lead">Agent-based backups to your own storage.</p></div>
<div class="card"><p><a class="btn" href="/install">Install agent</a></p></div>`),

  "/docs/security": page("Security", "VaultBackup security overview.", "/docs/security",
    `<div class="hero"><p class="eyebrow">Trust</p><h1>Security</h1></div>
<div class="card"><ul>
<li>Public sign-up locked unless the operator opens it</li>
<li>Agent secrets sealed at rest</li>
<li>Optional encryption of backup files before upload</li>
</ul></div>`),

  "/docs/storage": page("Own storage", "Bring your own S3, B2, Wasabi, R2, or local disk.", "/docs/storage",
    `<div class="hero"><p class="eyebrow">Product</p><h1>Own storage</h1></div>
<div class="card"><p class="muted">S3, R2, B2, Wasabi, Azure, WebDAV, local disk.</p>
<p><a class="btn" href="/install">Install agent</a></p></div>`),

  "/docs/agent": page("Desktop agent", "Install the VaultBackup desktop agent.", "/docs/agent",
    `<div class="hero"><p class="eyebrow">Product</p><h1>Desktop agent</h1></div>
<div class="card"><pre>msiexec /i vaultbackup-agent-windows-amd64.msi</pre>
<p><a class="btn" href="/download/windows-msi">Download MSI</a></p></div>`),

  "/docs/restore": page("Restore", "Restore a backup from your own storage.", "/docs/restore",
    `<div class="hero"><p class="eyebrow">Operations</p><h1>Restore a backup</h1></div>
<div class="card"><ol>
<li>Locate the file in your bucket or folder</li>
<li>Download to a secure machine</li>
<li>Decrypt if needed, then restore with the native database tool</li>
<li>Verify the application</li>
</ol></div>`),

  "/docs/support": page("Support", "Get help with VaultBackup using your account email.", "/docs/support",
    `<div class="hero"><p class="eyebrow">Company</p><h1>Support</h1>
<p class="lead">If a backup fails, start with the agent on your PC and your account dashboard. Contact us using the email address you registered with.</p></div>
<div class="card"><h2>Before you contact support</h2>
<ol>
<li>Open the agent at <code>http://127.0.0.1:8787</code> and check <strong>History</strong> and <strong>Logs</strong>.</li>
<li>Confirm the PC can reach your database and your storage.</li>
<li>Confirm the agent license is valid (online check-in at least every 72 hours).</li>
<li>Sign in at the <a href="/">dashboard</a> and check <strong>Desktop Agents</strong> status.</li>
</ol></div>
<div class="card"><h2>How to reach us</h2>
<p>Use the <strong>same email address</strong> you used when you created your VaultBackup account. That is the identity tied to your agents and licenses.</p>
<p class="muted">Include your company name, the agent machine name if you know it, and a short description of the error from History or Logs.</p>
<p><a class="btn" href="/">Open dashboard</a> <a class="btn secondary" href="/docs/restore">Restore guide</a> <a class="btn secondary" href="/install">Install guide</a></p></div>
<div class="card"><h2>Common fixes</h2>
<ul>
<li><strong>Storage errors</strong>: re-check bucket name, region, and access keys in the agent setup.</li>
<li><strong>Database errors</strong>: confirm host, port, and that the PC can connect.</li>
<li><strong>License offline</strong>: connect the PC to the internet briefly so the agent can check in, then retry.</li>
</ul></div>`),

  "/docs/privacy": page("Privacy", "How VaultBackup handles account data.", "/docs/privacy",
    `<div class="hero"><p class="eyebrow">Company</p><h1>Privacy</h1></div>
<div class="card"><ul>
<li>Account email and password hash</li>
<li>Agent token metadata and heartbeats</li>
<li>Job success and failure summaries</li>
</ul>
<p class="muted">Backup file contents go to your storage by default.</p></div>`),
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
