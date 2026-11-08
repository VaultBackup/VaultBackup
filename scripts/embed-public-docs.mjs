#!/usr/bin/env node
/** Inject public /docs pages (product + restore + privacy + support). */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

function jsonLd(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
}

function page(title, description, path, body, extraLd = []) {
  const canonical = `https://backup.enadoctemp.workers.dev${path}`;
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "VaultBackup",
    url: "https://backup.enadoctemp.workers.dev/",
    description: "Inexpensive encrypted database backups for SMBs and accounting firms to your own storage.",
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
<meta property="og:title" content="${title} | VaultBackup">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="https://backup.enadoctemp.workers.dev/og.svg">
<meta name="twitter:card" content="summary_large_image">
${ld}
<style>
:root{--bg:#020617;--card:#0f172a;--border:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--brand:#22c55e}
body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
a{color:var(--brand)}header{border-bottom:1px solid var(--border);padding:1rem 1.25rem;display:flex;justify-content:space-between;flex-wrap:wrap;gap:.75rem}
header .links{display:flex;gap:1rem;flex-wrap:wrap;font-size:.9rem}
main{max-width:48rem;margin:0 auto;padding:1.5rem 1.25rem 3rem}
h1{font-size:1.75rem;margin:0 0 .5rem}.lead{color:var(--muted);margin:0 0 1.5rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.25rem;margin:1rem 0}
h2{font-size:1.1rem;margin:0 0 .5rem;color:#fff}.muted{color:var(--muted)}
pre{background:#0b1220;border:1px solid var(--border);border-radius:8px;padding:.85rem 1rem;overflow:auto;font-size:.85rem}
.btn{display:inline-block;background:var(--brand);color:#052e16;font-weight:700;padding:.55rem 1rem;border-radius:8px;text-decoration:none;margin:.25rem .35rem .25rem 0}
.btn.secondary{background:#1e293b;color:#e2e8f0;border:1px solid var(--border)}
ul{padding-left:1.25rem}li{margin:.35rem 0}
ol{padding-left:1.25rem}
footer{max-width:48rem;margin:0 auto;padding:1rem 1.25rem 2rem;color:var(--muted);font-size:.85rem}
</style></head><body>
<header><div><strong>VaultBackup</strong> <span class="muted">Docs</span></div>
<div class="links">
<a href="/">Home</a><a href="/install">Install</a><a href="/docs">Docs</a>
<a href="/docs/product">Product</a><a href="/docs/storage">Storage</a>
<a href="/docs/security">Security</a><a href="/docs/restore">Restore</a>
<a href="/docs/support">Support</a>
</div></header>
<main>${body}</main>
<footer>VaultBackup. Encrypted backups to your own storage. <a href="/install">Install</a> · <a href="/docs/privacy">Privacy</a></footer>
</body></html>`;
}

const pages = {
  "/docs": page("Documentation", "VaultBackup guides for install, storage, security, restore, and support.", "/docs",
    `<h1>Documentation</h1>
<p class="lead">Everything you need to back up office databases to storage you control.</p>
<div class="card"><h2>Start here</h2>
<ul>
<li><a href="/install"><strong>Install the desktop agent</strong></a></li>
<li><a href="/docs/product"><strong>Product overview</strong></a></li>
<li><a href="/docs/storage"><strong>Own storage (B2, Wasabi, R2, S3)</strong></a></li>
<li><a href="/docs/security"><strong>Security</strong></a></li>
<li><a href="/docs/restore"><strong>Restore a backup</strong></a></li>
<li><a href="/docs/support"><strong>Support</strong></a></li>
<li><a href="/docs/privacy"><strong>Privacy</strong></a></li>
</ul>
<p><a class="btn" href="/download/windows-msi">Download Windows MSI</a>
<a class="btn secondary" href="/install">Install guide</a></p></div>`),

  "/docs/product": page("Product overview", "Encrypted database backups for SMBs and accounting firms to your own storage.", "/docs/product",
    `<h1>Product overview</h1>
<p class="lead">Inexpensive encrypted database backups stored in <strong>your</strong> bucket or disk.</p>
<div class="card"><h2>Who it is for</h2>
<ul><li>Accounting firms with SQL Server or local MySQL</li>
<li>SMBs that want reliable backups without large storage markups</li></ul>
<p><a class="btn" href="/install">Install agent</a></p></div>`),

  "/docs/security": page("Security", "Sealed agent config, optional backup encryption, authenticated APIs.", "/docs/security",
    `<h1>Security</h1>
<div class="card"><h2>Highlights</h2>
<ul>
<li>Public sign-up locked unless you explicitly open it</li>
<li>Agent secrets sealed at rest (AES-256-GCM + local key file)</li>
<li>Optional AES-256-GCM encryption of backup files before upload</li>
<li>Agent Web UI defaults to localhost only</li>
</ul></div>`),

  "/docs/storage": page("Own storage", "Use S3, B2, Wasabi, R2, Azure, WebDAV, or local disk.", "/docs/storage",
    `<h1>Own storage</h1>
<div class="card"><h2>Presets</h2>
<p class="muted"><strong>B2</strong>: s3.&lt;region&gt;.backblazeb2.com, Key ID + Application key<br>
<strong>Wasabi</strong>: s3.wasabisys.com<br>
<strong>R2</strong>: &lt;accountid&gt;.r2.cloudflarestorage.com, region auto<br>
<strong>AWS S3</strong>: region + IAM keys<br>
<strong>Local</strong>: folder on the agent machine</p>
<p><a class="btn" href="/install">Install agent</a></p></div>`),

  "/docs/agent": page("Desktop agent", "Install and run the VaultBackup desktop agent.", "/docs/agent",
    `<h1>Desktop agent</h1>
<div class="card"><h2>Quick start</h2>
<ol>
<li>Home → sign in → Desktop Agents → Create token</li>
<li><a href="/download/windows-msi">Download Windows MSI</a></li>
<li>Open http://127.0.0.1:8787 → paste token → database + storage → Save → Test → Run backup</li>
</ol>
<pre>msiexec /i vaultbackup-agent-windows-amd64.msi</pre></div>`),

  "/docs/restore": page("Restore a backup", "How to restore a VaultBackup dump from your own storage.", "/docs/restore",
    `<h1>Restore a backup</h1>
<p class="lead">Practice this once before you need it.</p>
<div class="card"><h2>Steps</h2>
<ol>
<li>Find the backup object in your bucket or local folder (agent history shows the path).</li>
<li>Download the file to a secure machine.</li>
<li>If the file ends with <code>.vbenc</code>, decrypt with the agent:<br>
<pre>vaultbackup-agent --restore backup.vbenc --restore-out backup.dump</pre>
Use the same <code>agent.key</code> / encryption settings that created the backup.</li>
<li>Restore into the database with the native tool:
<ul>
<li>PostgreSQL: <code>pg_restore</code> or <code>psql</code></li>
<li>MySQL: <code>mysql</code> client</li>
<li>SQL Server: restore the <code>.bak</code> via SSMS or <code>sqlcmd</code></li>
<li>MongoDB: <code>mongorestore</code></li>
</ul></li>
<li>Verify application login and a few critical records.</li>
</ol>
<p class="muted">Tip: run a restore drill quarterly and note who owns the storage credentials.</p>
<p><a class="btn secondary" href="/docs/support">Support</a></p></div>`),

  "/docs/support": page("Support", "How to get help when a VaultBackup job fails.", "/docs/support",
    `<h1>Support</h1>
<div class="card"><h2>When a backup fails</h2>
<ol>
<li>Open the agent UI at http://127.0.0.1:8787 and check History and Logs.</li>
<li>Confirm the machine can reach your storage (S3/B2/R2) and the database.</li>
<li>Confirm the agent still shows License OK (online at least every 72 hours).</li>
<li>Sign in at the <a href="/">dashboard</a> and check Desktop Agents status.</li>
</ol>
<p class="muted">Email alerts: set <code>RESEND_API_KEY</code> and <code>MAIL_FROM</code> on the Worker so critical agent failures can notify the account owner.</p>
<p>For account or license help, contact the operator who issued your agent token.</p></div>`),

  "/docs/privacy": page("Privacy", "How VaultBackup handles account and backup data.", "/docs/privacy",
    `<h1>Privacy</h1>
<div class="card"><h2>What we store</h2>
<ul>
<li><strong>Account</strong>: email and password hash for console login</li>
<li><strong>Agent tokens</strong>: hashed/stored for license checks and heartbeats</li>
<li><strong>Status metadata</strong>: last seen, backup success/failure summaries</li>
</ul>
<p><strong>Backup file contents</strong> go to <em>your</em> storage (S3, B2, disk, etc.), not to a VaultBackup managed vault, unless you explicitly use a Worker upload path.</p>
<h2>Your controls</h2>
<ul>
<li>Use your own bucket and encryption keys</li>
<li>Revoke agent tokens from the dashboard</li>
<li>Request account deletion via your operator / support contact</li>
</ul>
<p class="muted">This page is a practical summary for SMBs. Update it with your legal entity details before wide public launch.</p></div>`),
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
  console.log("Inserted PUBLIC_DOCS");
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
