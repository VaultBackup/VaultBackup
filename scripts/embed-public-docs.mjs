#!/usr/bin/env node
/** Inject public /docs pages into worker.js using the real route style. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · VaultBackup</title>
<meta name="robots" content="index,follow">
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
<header><div><strong>VaultBackup</strong> <span class="muted">· Docs</span></div>
<div class="links">
<a href="/">Dashboard</a><a href="/install">Install</a><a href="/docs">Docs</a>
<a href="/docs/product">Product</a><a href="/docs/security">Security</a>
<a href="/docs/storage">Storage</a><a href="/docs/agent">Agent</a>
</div></header>
<main>${body}</main>
<footer>VaultBackup — backups to your own storage. <a href="/install">Install agent</a></footer>
</body></html>`;
}

const pages = {
  "/docs": page("Documentation", `<h1>Documentation</h1>
<p class="lead">Guides for SMBs and accounting firms using VaultBackup with their own storage.</p>
<div class="card"><h2>Guides</h2>
<ul>
<li><a href="/install"><strong>Install the desktop agent</strong></a></li>
<li><a href="/docs/product"><strong>Product overview</strong></a></li>
<li><a href="/docs/agent"><strong>Desktop agent</strong></a></li>
<li><a href="/docs/storage"><strong>Own storage (BYO)</strong></a></li>
<li><a href="/docs/security"><strong>Security</strong></a></li>
</ul>
<p style="margin-top:1.25rem"><a class="btn" href="/download/windows-msi">Download Windows MSI</a>
<a class="btn secondary" href="/install">Full install guide</a></p></div>`),
  "/docs/product": page("Product overview", `<h1>Product overview</h1>
<p class="lead">Inexpensive encrypted database backups for SMBs and accounting firms — stored in <strong>your</strong> bucket or disk.</p>
<div class="card"><h2>Who it is for</h2>
<ul><li>Accounting firms (SQL Server / local MySQL)</li>
<li>SMBs that want reliable backups without large SaaS storage bills</li>
<li>Teams that need control of the storage account</li></ul></div>
<div class="card"><h2>Two paths</h2>
<table><tr><th>Path</th><th>Use when</th></tr>
<tr><td><strong>Desktop agent</strong></td><td>Office / LAN databases; your disk or S3-compatible storage</td></tr>
<tr><td>Worker console</td><td>Small public cloud databases only</td></tr></table>
<p><a class="btn" href="/install">Install agent</a> <a class="btn secondary" href="/docs/storage">Storage guide</a></p></div>`),
  "/docs/security": page("Security", `<h1>Security</h1>
<p class="lead">How VaultBackup protects credentials and backup data.</p>
<div class="card"><h2>Control plane</h2>
<ul><li>Registration locked unless explicitly enabled</li>
<li>Login rate limiting</li><li>Agent APIs require authentication</li></ul></div>
<div class="card"><h2>Agent config</h2>
<p>Secrets are stored in a <strong>sealed AES-256-GCM envelope</strong> with a local key file (<code>agent.key</code>), not plaintext JSON.</p></div>
<div class="card"><h2>Backup files</h2>
<ul><li>Optional AES-256-GCM before upload</li><li>TLS to object storage</li><li>Local Web UI defaults to localhost</li></ul>
<p><a class="btn secondary" href="/docs/agent">Agent guide</a></p></div>`),
  "/docs/storage": page("Own storage", `<h1>Own storage (BYO)</h1>
<p class="lead">Backup data lives in storage you control.</p>
<div class="card"><h2>Modes</h2>
<table><tr><th>Mode</th><th>Use</th></tr>
<tr><td>S3-compatible</td><td>AWS S3, R2, B2, Wasabi, MinIO</td></tr>
<tr><td>Local</td><td>Disk or NAS on the agent machine</td></tr>
<tr><td>Azure / WebDAV / SFTP</td><td>Cloud or NAS targets</td></tr></table></div>
<div class="card"><h2>Presets</h2>
<p class="muted"><strong>B2</strong> — s3.&lt;region&gt;.backblazeb2.com · Key ID + Application key<br>
<strong>Wasabi</strong> — s3.wasabisys.com<br>
<strong>R2</strong> — &lt;accountid&gt;.r2.cloudflarestorage.com · region auto<br>
<strong>AWS S3</strong> — empty endpoint + region + IAM keys</p>
<p><a class="btn" href="/install">Install agent</a></p></div>`),
  "/docs/agent": page("Desktop agent", `<h1>Desktop agent</h1>
<p class="lead">Runs on the machine that can see your database.</p>
<div class="card"><h2>Quick start</h2>
<ol>
<li><a href="/">Dashboard</a> → Desktop Agents → <strong>Create token</strong></li>
<li><a href="/download/windows-msi">Download Windows MSI</a></li>
<li>Open <code>http://127.0.0.1:8787</code> → token → database + storage → Save → Test → Run backup</li>
</ol>
<pre>msiexec /i vaultbackup-agent-windows-amd64.msi</pre>
<p><a class="btn" href="/download/windows-msi">Download MSI</a>
<a class="btn secondary" href="/install">Full install guide</a></p></div>`),
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

// Real route in this codebase:
// if (method === "GET" && (path === "/install" || path === "/download" || path === "/agent"))
const installCombo =
  'if (method === "GET" && (path === "/install" || path === "/download" || path === "/agent"))';
const docsBeforeInstall = `
if (method === "GET" && (path === "/docs" || path.startsWith("/docs/"))) {
    const docRes = publicDocsResponse(path);
    if (docRes) return docRes;
  }
  ${installCombo}`;

if (s.includes("publicDocsResponse(path)")) {
  // Ensure it sits immediately before install combo
  if (!s.includes(docsBeforeInstall) && s.includes(installCombo)) {
    // Remove stray earlier injections of publicDocsResponse blocks (best effort)
    s = s.replace(
      /\n\s*\/\/ Public docs[\s\S]*?if \(method === "GET" && \(path === "\/docs"[\s\S]*?\n  /g,
      "\n  "
    );
    s = s.replace(installCombo, docsBeforeInstall);
    console.log("Re-bound /docs handler before install combo");
  } else {
    console.log("/docs handler already wired");
  }
} else if (s.includes(installCombo)) {
  s = s.replace(installCombo, docsBeforeInstall);
  console.log("Inserted /docs handler before install combo");
} else {
  console.warn("install combo route not found");
}

// robots allow docs
if (s.includes('"Allow: /install"') && !s.includes('"Allow: /docs"')) {
  s = s.replace('"Allow: /install"', '"Allow: /install",\n      "Allow: /docs"');
  console.log("robots.txt allow /docs");
}

fs.writeFileSync(file, s);
console.log("Wrote", file, s.length);
