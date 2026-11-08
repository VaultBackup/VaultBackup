#!/usr/bin/env node
/** Inject public /docs HTML + early GET routes (before auth / getKV). */
import fs from "fs";

const path = process.argv[2] || "worker.js";
let s = fs.readFileSync(path, "utf8");

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
<li><a href="/install"><strong>Install the desktop agent</strong></a> — Windows MSI, macOS, Linux</li>
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
<tr><td><strong>Desktop agent</strong></td><td>Office / LAN databases; large dumps; your disk or S3-compatible storage</td></tr>
<tr><td>Worker console</td><td>Small public cloud databases only</td></tr></table>
<p class="muted">Lead with agent + own storage for office workloads.</p>
<p><a class="btn" href="/install">Install agent</a> <a class="btn secondary" href="/docs/storage">Storage guide</a></p></div>`),
  "/docs/security": page("Security", `<h1>Security</h1>
<p class="lead">How VaultBackup protects credentials and backup data.</p>
<div class="card"><h2>Control plane</h2>
<ul><li>Registration locked unless explicitly enabled</li>
<li>Login rate limiting</li><li>Agent APIs require authentication</li></ul></div>
<div class="card"><h2>Agent config</h2>
<p>License token, database URI, and storage keys are stored in a <strong>sealed AES-256-GCM envelope</strong> with a local key file (<code>agent.key</code>), not plaintext JSON.</p>
<p class="muted">Protect config + key files; use full-disk encryption where possible.</p></div>
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
<h3>Backblaze B2</h3><p class="muted">Endpoint <code>s3.&lt;region&gt;.backblazeb2.com</code> — Key ID + Application key.</p>
<h3>Wasabi</h3><p class="muted"><code>s3.wasabisys.com</code> or regional endpoint.</p>
<h3>Cloudflare R2</h3><p class="muted"><code>&lt;accountid&gt;.r2.cloudflarestorage.com</code>, region <code>auto</code>.</p>
<h3>AWS S3</h3><p class="muted">Empty custom endpoint + region + IAM keys.</p>
<p><a class="btn" href="/install">Install agent</a></p></div>`),
  "/docs/agent": page("Desktop agent", `<h1>Desktop agent</h1>
<p class="lead">Runs on the machine that can see your database.</p>
<div class="card"><h2>Quick start</h2>
<ol>
<li><a href="/">Dashboard</a> → Desktop Agents → <strong>Create token</strong></li>
<li><a href="/download/windows-msi">Download Windows MSI</a> (or other OS on <a href="/install">install</a>)</li>
<li>Open <code>http://127.0.0.1:8787</code> → token → database + storage → Save → Test → Run backup</li>
</ol></div>
<div class="card"><h2>Windows MSI</h2>
<pre>msiexec /i vaultbackup-agent-windows-amd64.msi</pre>
<p class="muted">License server is built in. 72-hour offline grace after check-in.</p>
<p><a class="btn" href="/download/windows-msi">Download MSI</a>
<a class="btn secondary" href="/install">Full install guide</a></p></div>`),
};

const markerStart = "/* __PUBLIC_DOCS_START__ */";
const markerEnd = "/* __PUBLIC_DOCS_END__ */";
const block = `${markerStart}
const PUBLIC_DOCS = ${JSON.stringify(pages)};
function publicDocsResponse(path) {
  const html = PUBLIC_DOCS[path];
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

// Remove any previous weak injection attempts
s = s.replace(/\n\s*\/\/ Public product documentation[\s\S]*?if \(method === "GET" && path === "\/install"\)/g, "\n  if (method === \"GET\" && path === \"/install\")");

const routeEarly = `
  // Public docs (must run before auth / getKV)
  if (method === "GET" && (path === "/docs" || path.startsWith("/docs/"))) {
    const docRes = publicDocsResponse(path === "/docs" ? "/docs" : path);
    if (docRes) return docRes;
  }
`;

if (s.includes("publicDocsResponse(path")) {
  console.log("Early /docs route already present");
} else {
  const installNeedle = 'if (method === "GET" && path === "/install")';
  if (s.includes(installNeedle)) {
    s = s.replace(installNeedle, routeEarly + "\n  " + installNeedle);
    console.log("Inserted early /docs route before /install");
  } else {
    // Fallback: after URL path is computed — look for common pattern
    const alt = "const path = url.pathname";
    const idx = s.indexOf(alt);
    if (idx >= 0) {
      const insertAt = s.indexOf("\n", idx) + 1;
      s = s.slice(0, insertAt) + routeEarly + s.slice(insertAt);
      console.log("Inserted early /docs route after pathname");
    } else {
      console.warn("WARNING: could not insert /docs route");
    }
  }
}

fs.writeFileSync(path, s);
console.log("Wrote", path, s.length);
