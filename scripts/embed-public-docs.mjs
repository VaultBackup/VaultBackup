#!/usr/bin/env node
/**
 * Inject public product documentation pages into worker.js and register routes.
 * Runs in CI before wrangler deploy.
 */
import fs from "fs";

const path = process.argv[2] || "worker.js";
let s = fs.readFileSync(path, "utf8");

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · VaultBackup</title>
<meta name="description" content="${title} — VaultBackup encrypted database backups to your own storage.">
<meta name="robots" content="index,follow">
<link rel="canonical" href="https://backup.enadoctemp.workers.dev/docs">
<style>
:root { --bg:#020617; --card:#0f172a; --border:#1e293b; --text:#e2e8f0; --muted:#94a3b8; --brand:#22c55e; }
* { box-sizing: border-box; }
body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--text); line-height:1.6; }
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
header { border-bottom:1px solid var(--border); padding:1rem 1.25rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; }
header .links { display:flex; gap:1rem; flex-wrap:wrap; font-size:0.9rem; }
main { max-width: 48rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
h1 { font-size: 1.75rem; margin: 0 0 0.5rem; }
h2 { font-size: 1.15rem; margin: 1.75rem 0 0.5rem; color:#fff; border-bottom:1px solid var(--border); padding-bottom:0.35rem; }
h3 { font-size: 1rem; margin: 1.25rem 0 0.35rem; color:#f1f5f9; }
.lead { color: var(--muted); font-size: 1.05rem; margin: 0 0 1.5rem; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem; margin: 1rem 0; }
.muted { color: var(--muted); }
table { width:100%; border-collapse: collapse; font-size: 0.9rem; margin: 0.75rem 0; }
th, td { border: 1px solid var(--border); padding: 0.5rem 0.65rem; text-align: left; }
th { background: #0b1220; color: #cbd5e1; }
pre, code { font-family: ui-monospace, monospace; font-size: 0.85rem; }
pre { background: #0b1220; border: 1px solid var(--border); border-radius: 8px; padding: 0.85rem 1rem; overflow-x: auto; }
.btn { display:inline-block; background: var(--brand); color: #052e16 !important; font-weight: 700; padding: 0.55rem 1rem; border-radius: 8px; text-decoration:none !important; margin: 0.25rem 0.35rem 0.25rem 0; }
.btn.secondary { background: #1e293b; color: #e2e8f0 !important; border: 1px solid var(--border); }
ul { padding-left: 1.25rem; }
li { margin: 0.35rem 0; }
footer { max-width: 48rem; margin: 0 auto; padding: 1rem 1.25rem 2rem; color: var(--muted); font-size: 0.85rem; }
</style>
</head>
<body>
<header>
  <div><strong>VaultBackup</strong> <span class="muted">· Docs</span></div>
  <div class="links">
    <a href="/">Dashboard</a>
    <a href="/install">Install</a>
    <a href="/docs">Docs home</a>
    <a href="/docs/product">Product</a>
    <a href="/docs/security">Security</a>
    <a href="/docs/storage">Storage</a>
    <a href="/docs/agent">Agent</a>
  </div>
</header>
<main>
${body}
</main>
<footer>VaultBackup — encrypted database backups to <em>your</em> storage. <a href="/install">Install agent</a></footer>
</body>
</html>`;
}

const pages = {
  "/docs": page(
    "Documentation",
    `<h1>Documentation</h1>
<p class="lead">Guides for SMBs and accounting firms using VaultBackup with their own storage.</p>
<div class="card">
<h2 style="margin-top:0;border:0;padding:0">Guides</h2>
<ul>
<li><a href="/install"><strong>Install the desktop agent</strong></a> — Windows MSI, macOS, Linux</li>
<li><a href="/docs/product"><strong>Product overview</strong></a> — who it is for and how it works</li>
<li><a href="/docs/agent"><strong>Desktop agent</strong></a> — token, Web UI, license</li>
<li><a href="/docs/storage"><strong>Own storage (BYO)</strong></a> — B2, Wasabi, R2, S3, local</li>
<li><a href="/docs/security"><strong>Security</strong></a> — encryption, sealed config, hardening</li>
</ul>
<p style="margin-top:1.25rem">
<a class="btn" href="/download/windows-msi">Download Windows MSI</a>
<a class="btn secondary" href="/install">Full install guide</a>
</p>
</div>`
  ),
  "/docs/product": page(
    "Product overview",
    `<h1>Product overview</h1>
<p class="lead">Inexpensive encrypted database backups for SMBs and accounting firms — stored in <strong>your</strong> bucket or disk.</p>
<div class="card">
<h2 style="margin-top:0;border:0">Who it is for</h2>
<ul>
<li>Accounting firms with SQL Server or local MySQL on office PCs</li>
<li>SMBs that want reliable backups without large SaaS storage bills</li>
<li>Teams that need data residency and control of the storage account</li>
</ul>
</div>
<div class="card">
<h2 style="margin-top:0;border:0">Two paths</h2>
<table>
<tr><th>Path</th><th>Use when</th></tr>
<tr><td><strong>Desktop agent</strong></td><td>Office / LAN databases; large dumps; your disk or S3-compatible storage</td></tr>
<tr><td>Worker console</td><td>Small <em>public</em> cloud databases only (size limits apply)</td></tr>
</table>
<p class="muted">Lead with <strong>agent + own storage</strong> for accounting and SMB workloads.</p>
</div>
<div class="card">
<h2 style="margin-top:0;border:0">Value</h2>
<ul>
<li>BYO storage: S3, B2, Wasabi, R2, Azure, WebDAV, local disk</li>
<li>Windows-first MSI installer and local Web UI</li>
<li>Optional AES-256-GCM encryption before upload</li>
<li>Agent config secrets sealed at rest</li>
<li>Low-cost Cloudflare Worker control plane</li>
</ul>
<p><a class="btn" href="/install">Install agent</a> <a class="btn secondary" href="/docs/storage">Storage guide</a></p>
</div>`
  ),
  "/docs/security": page(
    "Security",
    `<h1>Security</h1>
<p class="lead">How VaultBackup protects credentials and backup data.</p>
<div class="card">
<h2 style="margin-top:0;border:0">Control plane (Worker)</h2>
<ul>
<li>Public registration disabled unless explicitly enabled</li>
<li>Login rate limiting</li>
<li>Minimal public health endpoint on hardened builds</li>
<li>Admin routes require a token</li>
<li>Agent APIs require bearer authentication</li>
</ul>
</div>
<div class="card">
<h2 style="margin-top:0;border:0">Desktop agent config</h2>
<p>Sensitive fields (license token, database URI, storage keys and passwords) are stored in a <strong>sealed envelope</strong> (AES-256-GCM) with a local key file (<code>agent.key</code>), not as plaintext JSON.</p>
<p class="muted">Protect both the config file and the key file (file permissions and full-disk encryption). Do not commit them to git.</p>
</div>
<div class="card">
<h2 style="margin-top:0;border:0">Backup files</h2>
<ul>
<li>Optional AES-256-GCM encryption before upload</li>
<li>TLS to S3-compatible APIs</li>
<li>Local Web UI defaults to localhost only</li>
</ul>
<p><a class="btn secondary" href="/docs/agent">Agent guide</a></p>
</div>`
  ),
  "/docs/storage": page(
    "Own storage",
    `<h1>Own storage (BYO)</h1>
<p class="lead">Backup data lives in storage you control.</p>
<div class="card">
<h2 style="margin-top:0;border:0">Supported modes</h2>
<table>
<tr><th>Mode</th><th>Typical use</th></tr>
<tr><td>S3-compatible</td><td>AWS S3, Cloudflare R2, Backblaze B2, Wasabi, MinIO</td></tr>
<tr><td>Local</td><td>Disk or NAS path on the agent machine</td></tr>
<tr><td>Azure</td><td>Azure Blob</td></tr>
<tr><td>WebDAV / SFTP</td><td>NAS or remote servers</td></tr>
</table>
</div>
<div class="card">
<h2 style="margin-top:0;border:0">Presets</h2>
<h3>Backblaze B2</h3>
<p class="muted">Endpoint <code>s3.&lt;region&gt;.backblazeb2.com</code> — Key ID + Application key.</p>
<h3>Wasabi</h3>
<p class="muted">Endpoint <code>s3.wasabisys.com</code> (or regional) — access key + secret.</p>
<h3>Cloudflare R2</h3>
<p class="muted">Endpoint <code>&lt;accountid&gt;.r2.cloudflarestorage.com</code>, region <code>auto</code>.</p>
<h3>AWS S3</h3>
<p class="muted">Empty custom endpoint, set region, IAM keys with least privilege.</p>
<h3>Local disk</h3>
<p class="muted">Absolute path writable by the service account.</p>
<p><a class="btn" href="/install">Install agent</a></p>
</div>`
  ),
  "/docs/agent": page(
    "Desktop agent",
    `<h1>Desktop agent</h1>
<p class="lead">Runs on the machine that can see your database. Dumps, optionally encrypts, uploads to your storage.</p>
<div class="card">
<h2 style="margin-top:0;border:0">Quick start</h2>
<ol>
<li>Sign in to the <a href="/">dashboard</a> → Desktop Agents → <strong>Create token</strong> (copy once).</li>
<li><a href="/download/windows-msi">Download Windows MSI</a> (recommended) or other OS from <a href="/install">install</a>.</li>
<li>Open <code>http://127.0.0.1:8787</code> → paste token → database + destination → Save → Test license → Run backup.</li>
</ol>
</div>
<div class="card">
<h2 style="margin-top:0;border:0">Windows MSI</h2>
<pre>msiexec /i vaultbackup-agent-windows-amd64.msi</pre>
<p class="muted">License server URL is built into the agent. 72-hour offline grace after a successful check-in.</p>
<p><a class="btn" href="/download/windows-msi">Download MSI</a> <a class="btn secondary" href="/install">Full install guide</a></p>
</div>
<div class="card">
<h2 style="margin-top:0;border:0">Downloads</h2>
<ul>
<li><a href="/download/windows-msi">Windows MSI</a></li>
<li><a href="/download/windows-amd64">Windows EXE x64</a></li>
<li><a href="/download/darwin-arm64">macOS Apple Silicon</a></li>
<li><a href="/download/linux-amd64">Linux x64</a></li>
</ul>
</div>`
  ),
};

// Embed as a single constant map for the Worker
const docsLiteral = JSON.stringify(pages);
const markerStart = "/* __PUBLIC_DOCS_START__ */";
const markerEnd = "/* __PUBLIC_DOCS_END__ */";
const block = `${markerStart}
const PUBLIC_DOCS = ${docsLiteral};
${markerEnd}
`;

if (s.includes(markerStart) && s.includes(markerEnd)) {
  s = s.replace(
    new RegExp(markerStart.replace(/[/*]/g, "\\$&") + "[\\s\\S]*?" + markerEnd.replace(/[/*]/g, "\\$&")),
    block
  );
  console.log("Replaced existing PUBLIC_DOCS block");
} else {
  // Insert before export default or at end of imports section
  const anchor = "const AGENT_BINARIES";
  if (s.includes(anchor)) {
    s = s.replace(anchor, block + "\n" + anchor);
    console.log("Inserted PUBLIC_DOCS before AGENT_BINARIES");
  } else {
    s = block + "\n" + s;
    console.log("Prepended PUBLIC_DOCS");
  }
}

// Route handler injection
const routeSnippet = `
  // Public product documentation
  if (method === "GET" && path === "/docs") {
    return htmlPage(PUBLIC_DOCS["/docs"] || "<h1>Docs</h1>");
  }
  if (method === "GET" && path.startsWith("/docs/")) {
    const html = PUBLIC_DOCS[path];
    if (html) return htmlPage(html);
    return json({ success: false, error: "Not found" }, 404);
  }
`;

if (!s.includes('path === "/docs"') && !s.includes("path === '/docs'")) {
  // Prefer inserting near /install handler
  const installPatterns = [
    'if (method === "GET" && path === "/install")',
    "if (method === 'GET' && path === '/install')",
  ];
  let inserted = false;
  for (const p of installPatterns) {
    if (s.includes(p)) {
      s = s.replace(p, routeSnippet + "\n  " + p);
      inserted = true;
      console.log("Inserted /docs routes before /install");
      break;
    }
  }
  if (!inserted) {
    // Fallback: after download handler mention
    const dl = "handleAgentBinaryDownload";
    const idx = s.indexOf(dl);
    if (idx > 0) {
      // find a GET routing area - inject after first "const path ="
      const pathLine = s.indexOf("const path =");
      if (pathLine > 0) {
        // inject before agent binary download route if present
        const dlRoute = s.indexOf("/download/");
        if (dlRoute > 0) {
          const lineStart = s.lastIndexOf("\n", dlRoute);
          s = s.slice(0, lineStart) + "\n" + routeSnippet + s.slice(lineStart);
          console.log("Inserted /docs routes near /download");
          inserted = true;
        }
      }
    }
  }
  if (!inserted) {
    console.warn("Could not find insertion point for /docs routes — add manually");
  }
} else {
  console.log("/docs routes already present");
}

// Link docs from install header if possible
if (s.includes(">Dashboard</a>") && !s.includes('href="/docs"')) {
  s = s.replace(
    ">Dashboard</a>",
    '>Dashboard</a>\n    <a href="/docs">Docs</a>'
  );
  // may replace multiple - ok
  console.log("Added Docs link next to Dashboard (install/header)");
}

fs.writeFileSync(path, s);
console.log("Wrote", path, "bytes", s.length);
