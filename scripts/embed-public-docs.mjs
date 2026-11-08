#!/usr/bin/env node
/** Inject public /docs pages with SEO + JSON-LD + shared favicon. */
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
    description:
      "Inexpensive encrypted database backups for SMBs and accounting firms to your own storage.",
  };
  const web = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    description,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: "VaultBackup", url: "https://backup.enadoctemp.workers.dev/" },
  };
  const software = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "VaultBackup Desktop Agent",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Windows, macOS, Linux",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    description:
      "Desktop agent for encrypted database backups to S3, Backblaze B2, Wasabi, R2, or local disk.",
    downloadUrl: "https://backup.enadoctemp.workers.dev/download/windows-msi",
  };
  const ld = [org, web, software, ...extraLd].map(jsonLd).join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | VaultBackup</title>
<meta name="description" content="${description}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<meta name="keywords" content="database backup, accounting firm backup, SMB backup, SQL Server backup, backup to S3, Backblaze B2, Wasabi, Cloudflare R2, own storage backup, encrypted database backup, desktop backup agent">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/icon.svg">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="VaultBackup">
<meta property="og:locale" content="en_US">
<meta property="og:url" content="${canonical}">
<meta property="og:title" content="${title} | VaultBackup">
<meta property="og:description" content="${description}">
<meta property="og:image" content="https://backup.enadoctemp.workers.dev/og.svg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title} | VaultBackup">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="https://backup.enadoctemp.workers.dev/og.svg">
${ld}
<style>
:root{--bg:#020617;--card:#0f172a;--border:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--brand:#22c55e}
body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
a{color:var(--brand)}header{border-bottom:1px solid var(--border);padding:1rem 1.25rem;display:flex;justify-content:space-between;flex-wrap:wrap;gap:.75rem}
header .links{display:flex;gap:1rem;flex-wrap:wrap;font-size:.9rem}
main{max-width:48rem;margin:0 auto;padding:1.5rem 1.25rem 3rem}
h1{font-size:1.75rem;margin:0 0 .5rem}.lead{color:var(--muted);margin:0 0 1.5rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.25rem;margin:1rem 0}
h2{font-size:1.1rem;margin:0 0 .5rem;color:#fff}h3{font-size:1rem;margin:1rem 0 .35rem}
.muted{color:var(--muted)}table{width:100%;border-collapse:collapse;font-size:.9rem;margin:.75rem 0}
th,td{border:1px solid var(--border);padding:.5rem .65rem;text-align:left}th{background:#0b1220}
pre{background:#0b1220;border:1px solid var(--border);border-radius:8px;padding:.85rem 1rem;overflow:auto;font-size:.85rem}
.btn{display:inline-block;background:var(--brand);color:#052e16;font-weight:700;padding:.55rem 1rem;border-radius:8px;text-decoration:none;margin:.25rem .35rem .25rem 0}
.btn.secondary{background:#1e293b;color:#e2e8f0;border:1px solid var(--border)}
ul{padding-left:1.25rem}li{margin:.35rem 0}
footer{max-width:48rem;margin:0 auto;padding:1rem 1.25rem 2rem;color:var(--muted);font-size:.85rem}
</style></head><body>
<header><div><strong>VaultBackup</strong> <span class="muted">Docs</span></div>
<div class="links">
<a href="/">Dashboard</a><a href="/install">Install</a><a href="/docs">Docs</a>
<a href="/docs/product">Product</a><a href="/docs/security">Security</a>
<a href="/docs/storage">Storage</a><a href="/docs/agent">Agent</a>
</div></header>
<main>${body}</main>
<footer>VaultBackup. Encrypted database backups to your own storage. <a href="/install">Install agent</a> · <a href="/llms.txt">llms.txt</a></footer>
</body></html>`;
}

const faqLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Can VaultBackup store backups in our own bucket?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Use S3-compatible storage (AWS S3, Backblaze B2, Wasabi, Cloudflare R2), Azure, WebDAV, or a local disk via the desktop agent.",
      },
    },
    {
      "@type": "Question",
      name: "Does VaultBackup support SQL Server on a Windows office PC?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Install the Windows MSI desktop agent on the office network. The cloud Worker cannot reach private LAN databases; the agent can.",
      },
    },
    {
      "@type": "Question",
      name: "Who is VaultBackup for?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Small and medium businesses and accounting firms that need reliable database backups without paying premium storage markup.",
      },
    },
  ],
};

const pages = {
  "/docs": page(
    "Documentation",
    "VaultBackup documentation: install the desktop agent, own-storage backups, security, and product overview for SMBs and accounting firms.",
    "/docs",
    `<h1>Documentation</h1>
<p class="lead">Guides for SMBs and accounting firms using VaultBackup with their own storage.</p>
<div class="card"><h2>Guides</h2>
<ul>
<li><a href="/install"><strong>Install the desktop agent</strong></a> (Windows MSI, macOS, Linux)</li>
<li><a href="/docs/product"><strong>Product overview</strong></a></li>
<li><a href="/docs/agent"><strong>Desktop agent</strong></a></li>
<li><a href="/docs/storage"><strong>Own storage (BYO)</strong></a></li>
<li><a href="/docs/security"><strong>Security</strong></a></li>
</ul>
<p style="margin-top:1.25rem"><a class="btn" href="/download/windows-msi">Download Windows MSI</a>
<a class="btn secondary" href="/install">Full install guide</a></p></div>`,
    [faqLd]
  ),
  "/docs/product": page(
    "Product overview",
    "Inexpensive encrypted database backups for SMBs and accounting firms to your own S3, B2, Wasabi, R2, or local disk.",
    "/docs/product",
    `<h1>Product overview</h1>
<p class="lead">Inexpensive encrypted database backups for SMBs and accounting firms, stored in <strong>your</strong> bucket or disk.</p>
<div class="card"><h2>Who it is for</h2>
<ul><li>Accounting firms (SQL Server / local MySQL)</li>
<li>SMBs that want reliable backups without large SaaS storage bills</li>
<li>Teams that need control of the storage account</li></ul></div>
<div class="card"><h2>Two paths</h2>
<table><tr><th>Path</th><th>Use when</th></tr>
<tr><td><strong>Desktop agent</strong></td><td>Office / LAN databases; your disk or S3-compatible storage</td></tr>
<tr><td>Worker console</td><td>Small public cloud databases only</td></tr></table>
<p><a class="btn" href="/install">Install agent</a> <a class="btn secondary" href="/docs/storage">Storage guide</a></p></div>`,
    [faqLd]
  ),
  "/docs/security": page(
    "Security",
    "VaultBackup security: sealed agent config, optional AES-256-GCM backup encryption, authenticated APIs, and locked registration by default.",
    "/docs/security",
    `<h1>Security</h1>
<p class="lead">How VaultBackup protects credentials and backup data.</p>
<div class="card"><h2>Control plane</h2>
<ul><li>Registration locked unless explicitly enabled</li>
<li>Login rate limiting</li><li>Agent APIs require authentication</li></ul></div>
<div class="card"><h2>Agent config</h2>
<p>Secrets are stored in a <strong>sealed AES-256-GCM envelope</strong> with a local key file (<code>agent.key</code>), not plaintext JSON.</p></div>
<div class="card"><h2>Backup files</h2>
<ul><li>Optional AES-256-GCM before upload</li><li>TLS to object storage</li><li>Local Web UI defaults to localhost</li></ul>
<p><a class="btn secondary" href="/docs/agent">Agent guide</a></p></div>`
  ),
  "/docs/storage": page(
    "Own storage",
    "Store VaultBackup dumps in your own S3, Backblaze B2, Wasabi, Cloudflare R2, Azure, WebDAV, or local disk.",
    "/docs/storage",
    `<h1>Own storage (BYO)</h1>
<p class="lead">Backup data lives in storage you control.</p>
<div class="card"><h2>Modes</h2>
<table><tr><th>Mode</th><th>Use</th></tr>
<tr><td>S3-compatible</td><td>AWS S3, R2, B2, Wasabi, MinIO</td></tr>
<tr><td>Local</td><td>Disk or NAS on the agent machine</td></tr>
<tr><td>Azure / WebDAV / SFTP</td><td>Cloud or NAS targets</td></tr></table></div>
<div class="card"><h2>Presets</h2>
<p class="muted"><strong>B2</strong>: s3.&lt;region&gt;.backblazeb2.com, Key ID + Application key<br>
<strong>Wasabi</strong>: s3.wasabisys.com<br>
<strong>R2</strong>: &lt;accountid&gt;.r2.cloudflarestorage.com, region auto<br>
<strong>AWS S3</strong>: empty endpoint + region + IAM keys</p>
<p><a class="btn" href="/install">Install agent</a></p></div>`
  ),
  "/docs/agent": page(
    "Desktop agent",
    "Install the VaultBackup desktop agent on Windows, macOS, or Linux. Token setup, MSI installer, and license basics.",
    "/docs/agent",
    `<h1>Desktop agent</h1>
<p class="lead">Runs on the machine that can see your database.</p>
<div class="card"><h2>Quick start</h2>
<ol>
<li><a href="/">Dashboard</a> then Desktop Agents, then <strong>Create token</strong></li>
<li><a href="/download/windows-msi">Download Windows MSI</a></li>
<li>Open <code>http://127.0.0.1:8787</code>, paste token, set database and storage, Save, Test, Run backup</li>
</ol>
<pre>msiexec /i vaultbackup-agent-windows-amd64.msi</pre>
<p><a class="btn" href="/download/windows-msi">Download MSI</a>
<a class="btn secondary" href="/install">Full install guide</a></p></div>`
  ),
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
  s = s.replace(
    new RegExp(
      markerStart.replace(/[/*]/g, "\\$&") +
        "[\\s\\S]*?" +
        markerEnd.replace(/[/*]/g, "\\$&")
    ),
    block
  );
  console.log("Replaced PUBLIC_DOCS block");
} else if (s.includes("const AGENT_BINARIES")) {
  s = s.replace("const AGENT_BINARIES", block + "\nconst AGENT_BINARIES");
  console.log("Inserted PUBLIC_DOCS before AGENT_BINARIES");
} else {
  s = block + "\n" + s;
  console.log("Prepended PUBLIC_DOCS");
}

const installCombo =
  'if (method === "GET" && (path === "/install" || path === "/download" || path === "/agent"))';
const docsBeforeInstall = `
if (method === "GET" && (path === "/docs" || path.startsWith("/docs/"))) {
    const docRes = publicDocsResponse(path);
    if (docRes) return docRes;
  }
  ${installCombo}`;

if (s.includes(installCombo)) {
  if (!s.includes("publicDocsResponse(path)")) {
    s = s.replace(installCombo, docsBeforeInstall);
    console.log("Inserted /docs handler before install combo");
  } else if (!s.includes('path === "/docs" || path.startsWith("/docs/")')) {
    s = s.replace(installCombo, docsBeforeInstall);
    console.log("Re-inserted /docs handler");
  } else {
    console.log("/docs handler present");
  }
} else {
  console.warn("install combo route not found");
}

fs.writeFileSync(file, s);
console.log("Wrote", file, s.length);
