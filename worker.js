/**
 * VaultBackup - Cloudflare Worker (full, fixed version)
 *
 * SETUP
 * -----
 * wrangler.toml:
 *   name = "vaultbackup"
 *   main = "worker.js"
 *   compatibility_date = "2024-11-01"
 *
 *   [[kv_namespaces]]
 *   binding = "backup_kv"
 *   id = "<your KV namespace id>"
 *
 *   [[r2_buckets]]                 # needed only for "Platform Managed" storage
 *   binding = "BACKUP_BUCKET"
 *   bucket_name = "vaultbackup"
 *
 *   # Optional but recommended: atomic backup lock (prevents two simultaneous runs of one database)
 *   [[durable_objects.bindings]]
 *   name = "BACKUP_LOCK"
 *   class_name = "BackupLock"
 *   [[migrations]]
 *   tag = "v1"
 *   new_sqlite_classes = ["BackupLock"]
 *
 *   # Optional but recommended: run backups in a Queue consumer (15 min budget instead of ~30 s)
 *   [[queues.producers]]
 *   binding = "BACKUP_QUEUE"
 *   queue = "vaultbackup-jobs"
 *   [[queues.consumers]]
 *   queue = "vaultbackup-jobs"
 *   max_batch_size = 1
 *   max_retries = 0
 *
 *   [triggers]
 *   crons = ["0,5,10,15,20,25,30,35,40,45,50,55 * * * *"]   # REQUIRED for automatic backups (every 5 minutes)
 *
 * Secrets / vars:
 *   wrangler secret put ENCRYPTION_KEY     # >= 32 random chars, e.g. `openssl rand -base64 48`
 *   ALLOW_REGISTRATION = "false"           # optional: lock sign-ups after creating your account
 *   ALLOWED_ORIGIN = "https://example.com" # optional: only if the UI is hosted on another origin
 *
 * Optional (password reset by email, via Resend):
 *   wrangler secret put RESEND_API_KEY
 *   MAIL_FROM = "VaultBackup <backups@yourdomain.com>"
 *   PUBLIC_URL = "https://your-worker.example.com"   # used in reset links
 * Optional (reset links without email, for solo deployments):
 *   wrangler secret put ADMIN_TOKEN                  # >= 24 chars
 *   curl -X POST https://YOUR_HOST/api/admin/reset-link \
 *        -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
 *        -d '{"email":"you@example.com"}'
 *
 * Scheduler (automatic backups). Preferred: add the Cron Trigger shown above. Alternatives that need
 * no dashboard visit (all optional, any one is enough):
 *   1) Let the Worker create its own Cron Trigger through the Cloudflare API:
 *        wrangler secret put CF_API_TOKEN        # token with "Workers Scripts: Edit"
 *        CF_ACCOUNT_ID = "<account id>"          CF_WORKER_NAME = "<this worker's name>"
 *        wrangler secret put ADMIN_TOKEN         # then call once:
 *        curl -X POST https://YOUR_HOST/api/admin/setup-scheduler -H "Authorization: Bearer $ADMIN_TOKEN"
 *      (It also retries by itself, at most hourly, whenever a dashboard is open and the scheduler is silent.)
 *   2) Ping it every 5 minutes from any free uptime/cron service:
 *        wrangler secret put CRON_SECRET         # >= 24 chars
 *        GET https://YOUR_HOST/api/cron/tick   with header  Authorization: Bearer <CRON_SECRET>
 *      (or  ?key=<CRON_SECRET>  for services that cannot send headers)
 *   3) Fallback built in: while a user has the dashboard open it starts that user's due backups.
 *
 * SUPPORTED DATABASES (native wire protocols over cloudflare:sockets, TLS by default)
 *   PostgreSQL, CockroachDB, MySQL, MariaDB, MongoDB (incl. mongodb+srv), Redis, Turso/libSQL.
 *   Output formats: SQL (.sql.gz) for SQL engines; tar.gz in mongodump layout for MongoDB
 *   (restore: mongorestore dump/); raw RESP (.resp.gz) for Redis (restore: redis-cli --pipe).
 *   Not included: triggers/functions/extensions/grants (SQL), MongoDB views/time-series.
 *
 * BACKUP PLAN: every database has one or more jobs (up to 6), each with its own type, schedule, retry limit
 *   and pause switch. Types: full, incremental, differential, schema-only. Incremental and differential are
 *   table-level (collection-level for MongoDB): the database fingerprints each table and only tables whose
 *   data changed are saved. A structure change (new or dropped table, altered columns, changed view, enum or
 *   index) always forces a full backup, and so does a missing or broken base. Full + the incrementals built on
 *   it form a chain; retention keeps or deletes chains whole. Failed scheduled runs retry after 5, 15, 60, 120
 *   and 240 minutes. Runs stuck for 15 minutes are failed by the scheduler. Operator view: GET /admin
 *   (needs ADMIN_TOKEN). Optional TICK_BUDGET_MS caps how long one tick keeps starting inline backups.
 *   Types per engine: PostgreSQL, MySQL, MariaDB, MongoDB = all four; CockroachDB, Turso = full + schema;
 *   Redis = full.
 *
 * LIMITS: dumps are capped at 20 MB (Worker memory). Workers cannot reach private IPs,
 * Cloudflare IPs or port 25, and database hosts must be publicly reachable.
 */

import { connect } from "cloudflare:sockets";

// ---------------------------------------------------------------------------
// Frontend (String.raw: no escaping needed; the script below avoids backticks and ${})
// ---------------------------------------------------------------------------
// Public install / download page (no auth)
const INSTALL_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Install VaultBackup Desktop Agent — Windows, macOS, Linux</title>
    <meta name="description" content="Download the VaultBackup agent to back up office and accounting databases to your own S3, B2, Wasabi, or local disk. Token-only setup. Public install guide.">
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
    <meta name="googlebot" content="index,follow">
    <meta name="bingbot" content="index,follow">
    <meta name="theme-color" content="#020617">
    <meta name="author" content="VaultBackup">
    <meta name="application-name" content="VaultBackup">
    <meta name="keywords" content="database backup, accounting firm backup, SMB database backup, SQL Server backup, MySQL backup, PostgreSQL backup, backup to S3, Backblaze B2 backup, own storage backup, inexpensive database backup, desktop backup agent, encrypted database backups">
    <link rel="canonical" href="https://backup.enadoctemp.workers.dev/install">
    <link rel="alternate" hreflang="en" href="https://backup.enadoctemp.workers.dev/install">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="VaultBackup">
    <meta property="og:locale" content="en_US">
    <meta property="og:url" content="https://backup.enadoctemp.workers.dev/install">
    <meta property="og:title" content="Install VaultBackup Desktop Agent — Windows, macOS, Linux">
    <meta property="og:description" content="Download the VaultBackup agent to back up office and accounting databases to your own S3, B2, Wasabi, or local disk. Token-only setup. Public install guide.">
    <meta property="og:image" content="https://backup.enadoctemp.workers.dev/og.svg">
    <meta property="og:image:alt" content="VaultBackup — encrypted database backups to your own storage">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="Install VaultBackup Desktop Agent — Windows, macOS, Linux">
    <meta name="twitter:description" content="Download the VaultBackup agent to back up office and accounting databases to your own S3, B2, Wasabi, or local disk. Token-only setup. Public install guide.">
    <meta name="twitter:image" content="https://backup.enadoctemp.workers.dev/og.svg">
    <meta name="twitter:image:alt" content="VaultBackup">
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2322c55e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/></svg>">
    <link rel="apple-touch-icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2322c55e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/></svg>">
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"HowTo","name":"Install the VaultBackup desktop agent","description":"Install the VaultBackup agent on Windows, macOS, or Linux to back up private office databases to your own storage.","totalTime":"PT15M","supply":[{"@type":"HowToSupply","name":"VaultBackup agent token from the dashboard"}],"tool":[{"@type":"HowToTool","name":"VaultBackup desktop agent binary"}],"step":[
      {"@type":"HowToStep","name":"Download the agent","text":"Download the binary for your OS from https://backup.enadoctemp.workers.dev/install or /download/windows-amd64, /download/darwin-arm64, /download/linux-amd64."},
      {"@type":"HowToStep","name":"Create an agent token","text":"Sign in at https://backup.enadoctemp.workers.dev/ , open Desktop Agents, and create a token."},
      {"@type":"HowToStep","name":"Run the agent and complete setup","text":"Start the agent with the local web UI, paste the token, choose database and your own storage destination, then save and run a test backup."}
    ]}
    </script>
<style>
:root { --bg:#020617; --card:#0f172a; --border:#1e293b; --text:#e2e8f0; --muted:#94a3b8; --brand:#22c55e; --brand-d:#16a34a; }
* { box-sizing: border-box; }
body { margin:0; font-family: ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--text); line-height:1.5; }
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
header { border-bottom:1px solid var(--border); padding:1rem 1.25rem; display:flex; justify-content:space-between; align-items:center; gap:1rem; flex-wrap:wrap; }
header strong { color:#fff; }
header .links { display:flex; gap:1rem; font-size:0.875rem; }
main { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
h1 { font-size:1.75rem; margin:0 0 0.5rem; color:#fff; }
h2 { font-size:1.15rem; margin:1.75rem 0 0.75rem; color:#fff; border-bottom:1px solid var(--border); padding-bottom:0.4rem; }
.lead { color: var(--muted); margin:0 0 1.5rem; }
.card { background:var(--card); border:1px solid var(--border); border-radius:1rem; padding:1.25rem; margin-bottom:1rem; }
.grid { display:grid; gap:0.75rem; }
@media (min-width:640px){ .grid-2 { grid-template-columns:1fr 1fr; } .grid-3 { grid-template-columns:1fr 1fr 1fr; } }
.btn { display:inline-flex; align-items:center; justify-content:center; gap:0.4rem; padding:0.6rem 1rem; border-radius:0.75rem; font-size:0.875rem; font-weight:600; border:0; cursor:pointer; text-decoration:none; color:#fff; background:var(--brand-d); }
.btn:hover { background:#15803d; text-decoration:none; }
.btn.sec { background:#1e293b; border:1px solid var(--border); color:var(--text); }
.btn.sec:hover { background:#334155; }
.muted { color: var(--muted); font-size:0.8rem; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:0.8rem; }
pre { background:#020617; border:1px solid var(--border); border-radius:0.75rem; padding:0.9rem 1rem; overflow-x:auto; color:#cbd5e1; }
ol, ul { padding-left:1.25rem; color:var(--muted); }
li { margin:0.35rem 0; }
.step { display:flex; gap:0.75rem; margin:0.75rem 0; }
.num { flex-shrink:0; width:1.75rem; height:1.75rem; border-radius:999px; background:rgba(34,197,94,0.15); color:var(--brand); display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:700; }
.badge { font-size:10px; padding:0.15rem 0.5rem; border-radius:999px; border:1px solid var(--border); color:var(--muted); }
footer { margin-top:2rem; padding-top:1rem; border-top:1px solid var(--border); font-size:0.75rem; color:var(--muted); }
</style>
</head>
<body>
<header>
  <div>
    <strong>VaultBackup</strong>
    <span class="muted"> · Desktop Agent</span>
  </div>
  <div class="links">
    <a href="/">Dashboard</a>
    <a href="https://github.com/VaultBackup/VaultBackup" target="_blank" rel="noopener">GitHub</a>
  </div>
</header>
<main>
  <h1>Install the Desktop Agent</h1>
  <p class="lead">Back up local databases on Windows, macOS, or Linux. The agent talks to this Worker for licensing, status, and optional uploads. Binaries are built automatically from source on GitHub.</p>

  <div class="card">
    <h2 style="margin-top:0;border:0;padding:0">1. Download</h2>
    <p class="muted" style="margin-top:0.25rem">Pick the binary for your OS and CPU. Files are served from the public GitHub repository.</p>
    <div class="grid grid-2" style="margin-top:1rem">
      <a class="btn" href="/download/windows-amd64">Windows (x64)</a>
      <a class="btn" href="/download/windows-arm64">Windows (ARM64)</a>
      <a class="btn" href="/download/darwin-arm64">macOS (Apple Silicon)</a>
      <a class="btn" href="/download/darwin-amd64">macOS (Intel)</a>
      <a class="btn" href="/download/linux-amd64">Linux (x64)</a>
      <a class="btn" href="/download/linux-arm64">Linux (ARM64)</a>
    </div>
    <p class="muted" style="margin-top:0.75rem">Binaries are published automatically when the agent source is updated. Source repo is private.</p>
  </div>

  <div class="card">
    <h2 style="margin-top:0;border:0;padding:0">2. Create an agent token</h2>
    <div class="step"><span class="num">1</span><div>Open the <a href="/">dashboard</a> and sign in.</div></div>
    <div class="step"><span class="num">2</span><div>Go to <strong>Desktop Agents</strong> and click <strong>Create token</strong>.</div></div>
    <div class="step"><span class="num">3</span><div>Copy the token once — it is shown only at creation time.</div></div>
  </div>

  <div class="card">
    <h2 style="margin-top:0;border:0;padding:0">3. Run the agent</h2>
    <p class="muted">The license server URL is built into the agent. You only need the token.</p>
    <h2>Linux / macOS</h2>
<pre>chmod +x vaultbackup-agent-linux-amd64   # or darwin-arm64, etc.
./vaultbackup-agent-linux-amd64 --webui 127.0.0.1:8787</pre>
    <p class="muted">Open <code>http://127.0.0.1:8787</code>, paste the agent token, choose database and destination, then Save.</p>
    <h2>Windows</h2>
<pre>vaultbackup-agent-windows-amd64.exe --webui 127.0.0.1:8787</pre>
    <p class="muted">Open the same address in a browser and complete the setup wizard.</p>
  </div>

  <div class="card">
    <h2 style="margin-top:0;border:0;padding:0">4. Optional flags</h2>
<pre>--config path/to/config.yaml   # default: config.yaml
--webui 127.0.0.1:8787         # local setup UI
--webui-password SECRET        # protect the UI
--once                         # run one backup and exit
--no-webui                     # headless after config exists</pre>
    <p class="muted">Environment override (staging only): <code>VAULTBACKUP_SERVER_URL=https://...</code></p>
  </div>

  <div class="card">
    <h2 style="margin-top:0;border:0;padding:0">5. Verify</h2>
    <ul>
      <li>Dashboard → Desktop Agents shows the agent as Live within a few seconds.</li>
      <li>Local UI status badges turn green after a successful license check.</li>
      <li>Use <strong>Run backup now</strong> for a first test.</li>
    </ul>
  </div>

  <div class="card" id="faq">
    <h2 style="margin-top:0;border:0;padding:0">FAQ for SMBs and accounting firms</h2>
    <h3 style="font-size:0.95rem;color:#fff;margin:1rem 0 0.35rem">Who is VaultBackup for?</h3>
    <p class="muted">Small and medium businesses and accounting firms that need reliable database backups without paying premium storage markup. Back up to your own disk or S3-compatible bucket.</p>
    <h3 style="font-size:0.95rem;color:#fff;margin:1rem 0 0.35rem">Can backups go to our own storage?</h3>
    <p class="muted">Yes. Choose S3, Backblaze B2, Wasabi, Cloudflare R2, Azure, WebDAV, or a local folder. You control retention cost and data location.</p>
    <h3 style="font-size:0.95rem;color:#fff;margin:1rem 0 0.35rem">What about SQL Server on a Windows office PC?</h3>
    <p class="muted">Use the Windows agent download above. The cloud worker cannot reach private LAN databases; the desktop agent can.</p>
    <h3 style="font-size:0.95rem;color:#fff;margin:1rem 0 0.35rem">How much does storage cost?</h3>
    <p class="muted">You pay your storage provider directly (for example B2 or Wasabi rates). VaultBackup is the control plane and agent — designed to stay inexpensive as backup size grows.</p>
  </div>

  <footer>
    VaultBackup · Affordable database backups to your own storage · <a href="/">Console</a> · <a href="/llms.txt">llms.txt</a>
  </footer>
</main>
</body>
</html>`;

const FRONTEND_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VaultBackup — Affordable Database Backups for SMBs &amp; Accounting Firms</title>
    <meta name="description" content="Encrypted database backups for small businesses and accounting firms. Use your own S3, Backblaze B2, Wasabi, or local storage. Desktop agent for SQL Server, MySQL, PostgreSQL, and more.">
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
    <meta name="googlebot" content="index,follow">
    <meta name="bingbot" content="index,follow">
    <meta name="theme-color" content="#020617">
    <meta name="author" content="VaultBackup">
    <meta name="application-name" content="VaultBackup">
    <meta name="keywords" content="database backup, accounting firm backup, SMB database backup, SQL Server backup, MySQL backup, PostgreSQL backup, backup to S3, Backblaze B2 backup, own storage backup, inexpensive database backup, desktop backup agent, encrypted database backups">
    <link rel="canonical" href="https://backup.enadoctemp.workers.dev/">
    <link rel="alternate" hreflang="en" href="https://backup.enadoctemp.workers.dev/">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="VaultBackup">
    <meta property="og:locale" content="en_US">
    <meta property="og:url" content="https://backup.enadoctemp.workers.dev/">
    <meta property="og:title" content="VaultBackup — Affordable Database Backups for SMBs &amp; Accounting Firms">
    <meta property="og:description" content="Encrypted database backups for small businesses and accounting firms. Use your own S3, Backblaze B2, Wasabi, or local storage. Desktop agent for SQL Server, MySQL, PostgreSQL, and more.">
    <meta property="og:image" content="https://backup.enadoctemp.workers.dev/og.svg">
    <meta property="og:image:alt" content="VaultBackup — encrypted database backups to your own storage">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="VaultBackup — Affordable Database Backups for SMBs &amp; Accounting Firms">
    <meta name="twitter:description" content="Encrypted database backups for small businesses and accounting firms. Use your own S3, Backblaze B2, Wasabi, or local storage. Desktop agent for SQL Server, MySQL, PostgreSQL, and more.">
    <meta name="twitter:image" content="https://backup.enadoctemp.workers.dev/og.svg">
    <meta name="twitter:image:alt" content="VaultBackup">
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2322c55e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/></svg>">
    <link rel="apple-touch-icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2322c55e' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/></svg>">
    <script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"Organization","@id":"https://backup.enadoctemp.workers.dev/#org","name":"VaultBackup","url":"https://backup.enadoctemp.workers.dev/","logo":{"@type":"ImageObject","url":"https://backup.enadoctemp.workers.dev/og.svg"},"description":"Inexpensive encrypted database backups for small businesses and accounting firms, stored in your own S3-compatible bucket or local disk.","areaServed":"Worldwide","knowsAbout":["database backup","SQL Server backup","MySQL backup","PostgreSQL backup","accounting firm data protection","S3 backup","Backblaze B2"]},
      {"@type":"SoftwareApplication","@id":"https://backup.enadoctemp.workers.dev/#app","name":"VaultBackup","applicationCategory":"BusinessApplication","operatingSystem":"Windows, macOS, Linux, Web","url":"https://backup.enadoctemp.workers.dev/","description":"Serverless console and desktop agent for scheduled, encrypted database backups to your own storage. Built for SMBs and accounting firms.","offers":{"@type":"Offer","price":"0","priceCurrency":"USD","description":"Sign in to choose a plan. Agent backups use your own storage to control cost."},"featureList":["Desktop agent for private office databases","Backup to your S3, B2, Wasabi, R2, Azure, WebDAV, or local disk","Encrypted backups","Retention policies","SQL Server, MySQL, PostgreSQL, MongoDB, Redis support","Install guide at /install"]},
      {"@type":"WebSite","@id":"https://backup.enadoctemp.workers.dev/#website","url":"https://backup.enadoctemp.workers.dev/","name":"VaultBackup","publisher":{"@id":"https://backup.enadoctemp.workers.dev/#org"},"inLanguage":"en"},
      {"@type":"FAQPage","@id":"https://backup.enadoctemp.workers.dev/#faq","mainEntity":[
        {"@type":"Question","name":"What is VaultBackup?","acceptedAnswer":{"@type":"Answer","text":"VaultBackup is an inexpensive database backup service for small and medium businesses and accounting firms. It backs up SQL Server, MySQL, PostgreSQL, MongoDB, and Redis to your own storage (S3, Backblaze B2, Wasabi, Cloudflare R2, Azure, WebDAV, or a local disk) with encryption."}},
        {"@type":"Question","name":"Can I store backups in my own S3 or Backblaze bucket?","acceptedAnswer":{"@type":"Answer","text":"Yes. VaultBackup is designed for bring-your-own storage. Use the desktop agent or cloud connectors to send encrypted backups to your S3-compatible bucket, Azure, WebDAV, or local disk so you control cost and data location."}},
        {"@type":"Question","name":"How do accounting firms back up office databases that are not on the public internet?","acceptedAnswer":{"@type":"Answer","text":"Install the VaultBackup desktop agent on Windows, macOS, or Linux. Create an agent token in the dashboard, paste it into the local agent UI, choose the database and your storage target, then schedule backups. The agent reaches private LAN databases that a cloud worker cannot."}},
        {"@type":"Question","name":"Is VaultBackup less expensive than traditional backup SaaS?","acceptedAnswer":{"@type":"Answer","text":"VaultBackup runs on efficient edge infrastructure and encourages your own storage (for example Backblaze B2 or Wasabi), so you avoid paying markup on large backup volumes. You pay for the control plane and run storage at provider rates."}},
        {"@type":"Question","name":"Where do I download the desktop agent?","acceptedAnswer":{"@type":"Answer","text":"Open https://backup.enadoctemp.workers.dev/install for the public install guide and downloads for Windows, macOS, and Linux."}}
      ]}
    ]}
    </script>
    <style>*,:after,:before{--tw-border-spacing-x:0;--tw-border-spacing-y:0;--tw-translate-x:0;--tw-translate-y:0;--tw-rotate:0;--tw-skew-x:0;--tw-skew-y:0;--tw-scale-x:1;--tw-scale-y:1;--tw-pan-x: ;--tw-pan-y: ;--tw-pinch-zoom: ;--tw-scroll-snap-strictness:proximity;--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;--tw-ordinal: ;--tw-slashed-zero: ;--tw-numeric-figure: ;--tw-numeric-spacing: ;--tw-numeric-fraction: ;--tw-ring-inset: ;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-color:rgba(59,130,246,.5);--tw-ring-offset-shadow:0 0 #0000;--tw-ring-shadow:0 0 #0000;--tw-shadow:0 0 #0000;--tw-shadow-colored:0 0 #0000;--tw-blur: ;--tw-brightness: ;--tw-contrast: ;--tw-grayscale: ;--tw-hue-rotate: ;--tw-invert: ;--tw-saturate: ;--tw-sepia: ;--tw-drop-shadow: ;--tw-backdrop-blur: ;--tw-backdrop-brightness: ;--tw-backdrop-contrast: ;--tw-backdrop-grayscale: ;--tw-backdrop-hue-rotate: ;--tw-backdrop-invert: ;--tw-backdrop-opacity: ;--tw-backdrop-saturate: ;--tw-backdrop-sepia: ;--tw-contain-size: ;--tw-contain-layout: ;--tw-contain-paint: ;--tw-contain-style: }::backdrop{--tw-border-spacing-x:0;--tw-border-spacing-y:0;--tw-translate-x:0;--tw-translate-y:0;--tw-rotate:0;--tw-skew-x:0;--tw-skew-y:0;--tw-scale-x:1;--tw-scale-y:1;--tw-pan-x: ;--tw-pan-y: ;--tw-pinch-zoom: ;--tw-scroll-snap-strictness:proximity;--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;--tw-ordinal: ;--tw-slashed-zero: ;--tw-numeric-figure: ;--tw-numeric-spacing: ;--tw-numeric-fraction: ;--tw-ring-inset: ;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-color:rgba(59,130,246,.5);--tw-ring-offset-shadow:0 0 #0000;--tw-ring-shadow:0 0 #0000;--tw-shadow:0 0 #0000;--tw-shadow-colored:0 0 #0000;--tw-blur: ;--tw-brightness: ;--tw-contrast: ;--tw-grayscale: ;--tw-hue-rotate: ;--tw-invert: ;--tw-saturate: ;--tw-sepia: ;--tw-drop-shadow: ;--tw-backdrop-blur: ;--tw-backdrop-brightness: ;--tw-backdrop-contrast: ;--tw-backdrop-grayscale: ;--tw-backdrop-hue-rotate: ;--tw-backdrop-invert: ;--tw-backdrop-opacity: ;--tw-backdrop-saturate: ;--tw-backdrop-sepia: ;--tw-contain-size: ;--tw-contain-layout: ;--tw-contain-paint: ;--tw-contain-style: }/*! tailwindcss v3.4.19 | MIT License | https://tailwindcss.com*/*,:after,:before{box-sizing:border-box;border:0 solid #e5e7eb}:after,:before{--tw-content:""}:host,html{line-height:1.5;-webkit-text-size-adjust:100%;-moz-tab-size:4;-o-tab-size:4;tab-size:4;font-family:ui-sans-serif,system-ui,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji;font-feature-settings:normal;font-variation-settings:normal;-webkit-tap-highlight-color:transparent}body{margin:0;line-height:inherit}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,pre,samp{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace;font-feature-settings:normal;font-variation-settings:normal;font-size:1em}small{font-size:80%}sub,sup{font-size:75%;line-height:0;position:relative;vertical-align:baseline}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}button,input,optgroup,select,textarea{font-family:inherit;font-feature-settings:inherit;font-variation-settings:inherit;font-size:100%;font-weight:inherit;line-height:inherit;letter-spacing:inherit;color:inherit;margin:0;padding:0}button,select{text-transform:none}button,input:where([type=button]),input:where([type=reset]),input:where([type=submit]){-webkit-appearance:button;background-color:transparent;background-image:none}:-moz-focusring{outline:auto}:-moz-ui-invalid{box-shadow:none}progress{vertical-align:baseline}::-webkit-inner-spin-button,::-webkit-outer-spin-button{height:auto}[type=search]{-webkit-appearance:textfield;outline-offset:-2px}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-file-upload-button{-webkit-appearance:button;font:inherit}summary{display:list-item}blockquote,dd,dl,figure,h1,h2,h3,h4,h5,h6,hr,p,pre{margin:0}fieldset{margin:0}fieldset,legend{padding:0}menu,ol,ul{list-style:none;margin:0;padding:0}dialog{padding:0}textarea{resize:vertical}input::-moz-placeholder,textarea::-moz-placeholder{opacity:1;color:#9ca3af}input::placeholder,textarea::placeholder{opacity:1;color:#9ca3af}[role=button],button{cursor:pointer}:disabled{cursor:default}audio,canvas,embed,iframe,img,object,svg,video{display:block;vertical-align:middle}img,video{max-width:100%;height:auto}[hidden]:where(:not([hidden=until-found])){display:none}.pointer-events-none{pointer-events:none}.visible{visibility:visible}.static{position:static}.fixed{position:fixed}.sticky{position:sticky}.inset-0{inset:0}.top-0{top:0}.z-50{z-index:50}.z-\[60\]{z-index:60}.col-span-2{grid-column:span 2/span 2}.mx-auto{margin-left:auto;margin-right:auto}.mb-1{margin-bottom:.25rem}.mb-2{margin-bottom:.5rem}.mb-4{margin-bottom:1rem}.mb-6{margin-bottom:1.5rem}.mt-0\.5{margin-top:.125rem}.mt-1{margin-top:.25rem}.mt-2{margin-top:.5rem}.block{display:block}.inline{display:inline}.flex{display:flex}.inline-flex{display:inline-flex}.table{display:table}.grid{display:grid}.hidden{display:none}.h-16{height:4rem}.h-2{height:.5rem}.h-3\.5{height:.875rem}.h-4{height:1rem}.h-5{height:1.25rem}.h-6{height:1.5rem}.max-h-40{max-height:10rem}.max-h-56{max-height:14rem}.max-h-\[90vh\]{max-height:90vh}.min-h-\[1rem\]{min-height:1rem}.min-h-screen{min-height:100vh}.\!w-auto{width:auto!important}.w-2{width:.5rem}.w-3\.5{width:.875rem}.w-4{width:1rem}.w-5{width:1.25rem}.w-56{width:14rem}.w-6{width:1.5rem}.w-full{width:100%}.min-w-0{min-width:0}.max-w-2xl{max-width:42rem}.max-w-7xl{max-width:80rem}.max-w-md{max-width:28rem}.max-w-sm{max-width:24rem}.flex-1{flex:1 1 0%}.shrink-0{flex-shrink:0}.flex-grow{flex-grow:1}@keyframes pulse{50%{opacity:.5}}.animate-pulse{animation:pulse 2s cubic-bezier(.4,0,.6,1) infinite}.grid-cols-1{grid-template-columns:repeat(1,minmax(0,1fr))}.grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}.items-center{align-items:center}.justify-end{justify-content:flex-end}.justify-center{justify-content:center}.justify-between{justify-content:space-between}.gap-1{gap:.25rem}.gap-1\.5{gap:.375rem}.gap-2{gap:.5rem}.gap-3{gap:.75rem}.gap-4{gap:1rem}.gap-8{gap:2rem}.space-x-2>:not([hidden])~:not([hidden]){--tw-space-x-reverse:0;margin-right:calc(.5rem*var(--tw-space-x-reverse));margin-left:calc(.5rem*(1 - var(--tw-space-x-reverse)))}.space-x-3>:not([hidden])~:not([hidden]){--tw-space-x-reverse:0;margin-right:calc(.75rem*var(--tw-space-x-reverse));margin-left:calc(.75rem*(1 - var(--tw-space-x-reverse)))}.space-y-1>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(.25rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(.25rem*var(--tw-space-y-reverse))}.space-y-1\.5>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(.375rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(.375rem*var(--tw-space-y-reverse))}.space-y-2>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(.5rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(.5rem*var(--tw-space-y-reverse))}.space-y-3>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(.75rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(.75rem*var(--tw-space-y-reverse))}.space-y-4>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(1rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(1rem*var(--tw-space-y-reverse))}.space-y-6>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(1.5rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(1.5rem*var(--tw-space-y-reverse))}.space-y-8>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(2rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(2rem*var(--tw-space-y-reverse))}.divide-y>:not([hidden])~:not([hidden]){--tw-divide-y-reverse:0;border-top-width:calc(1px*(1 - var(--tw-divide-y-reverse)));border-bottom-width:calc(1px*var(--tw-divide-y-reverse))}.divide-slate-800\/50>:not([hidden])~:not([hidden]){border-color:rgba(30,41,59,.5)}.overflow-x-auto{overflow-x:auto}.overflow-y-auto{overflow-y:auto}.truncate{overflow:hidden;text-overflow:ellipsis}.truncate,.whitespace-nowrap{white-space:nowrap}.whitespace-pre-wrap{white-space:pre-wrap}.break-words{overflow-wrap:break-word}.break-all{word-break:break-all}.rounded{border-radius:.25rem}.rounded-2xl{border-radius:1rem}.rounded-full{border-radius:9999px}.rounded-lg{border-radius:.5rem}.rounded-xl{border-radius:.75rem}.rounded-l-lg{border-top-left-radius:.5rem;border-bottom-left-radius:.5rem}.rounded-r-lg{border-top-right-radius:.5rem;border-bottom-right-radius:.5rem}.border{border-width:1px}.border-b{border-bottom-width:1px}.border-t{border-top-width:1px}.border-amber-700\/60{border-color:rgba(180,83,9,.6)}.border-brand-500\/30{border-color:rgba(34,197,94,.3)}.border-brand-700{--tw-border-opacity:1;border-color:rgb(21 128 61/var(--tw-border-opacity,1))}.border-emerald-800\/60{border-color:rgba(6,95,70,.6)}.border-red-800\/60{border-color:rgba(153,27,27,.6)}.border-slate-700{--tw-border-opacity:1;border-color:rgb(51 65 85/var(--tw-border-opacity,1))}.border-slate-800{--tw-border-opacity:1;border-color:rgb(30 41 59/var(--tw-border-opacity,1))}.border-slate-800\/60{border-color:rgba(30,41,59,.6)}.border-slate-800\/80{border-color:rgba(30,41,59,.8)}.bg-amber-500{--tw-bg-opacity:1;background-color:rgb(245 158 11/var(--tw-bg-opacity,1))}.bg-amber-500\/15{background-color:rgba(245,158,11,.15)}.bg-amber-950\/40{background-color:rgba(69,26,3,.4)}.bg-amber-950\/60{background-color:rgba(69,26,3,.6)}.bg-brand-500\/10{background-color:rgba(34,197,94,.1)}.bg-brand-500\/20{background-color:rgba(34,197,94,.2)}.bg-brand-600{--tw-bg-opacity:1;background-color:rgb(22 163 74/var(--tw-bg-opacity,1))}.bg-emerald-500{--tw-bg-opacity:1;background-color:rgb(16 185 129/var(--tw-bg-opacity,1))}.bg-emerald-500\/10{background-color:rgba(16,185,129,.1)}.bg-emerald-500\/15{background-color:rgba(16,185,129,.15)}.bg-emerald-950\/40{background-color:rgba(2,44,34,.4)}.bg-emerald-950\/90{background-color:rgba(2,44,34,.9)}.bg-purple-500\/10{background-color:rgba(168,85,247,.1)}.bg-red-500{--tw-bg-opacity:1;background-color:rgb(239 68 68/var(--tw-bg-opacity,1))}.bg-red-500\/15{background-color:rgba(239,68,68,.15)}.bg-red-950\/40{background-color:rgba(69,10,10,.4)}.bg-red-950\/90{background-color:rgba(69,10,10,.9)}.bg-sky-500\/15{background-color:rgba(14,165,233,.15)}.bg-slate-500{--tw-bg-opacity:1;background-color:rgb(100 116 139/var(--tw-bg-opacity,1))}.bg-slate-600{--tw-bg-opacity:1;background-color:rgb(71 85 105/var(--tw-bg-opacity,1))}.bg-slate-800{--tw-bg-opacity:1;background-color:rgb(30 41 59/var(--tw-bg-opacity,1))}.bg-slate-900{--tw-bg-opacity:1;background-color:rgb(15 23 42/var(--tw-bg-opacity,1))}.bg-slate-900\/50{background-color:rgba(15,23,42,.5)}.bg-slate-900\/60{background-color:rgba(15,23,42,.6)}.bg-slate-950{--tw-bg-opacity:1;background-color:rgb(2 6 23/var(--tw-bg-opacity,1))}.bg-slate-950\/60{background-color:rgba(2,6,23,.6)}.bg-slate-950\/80{background-color:rgba(2,6,23,.8)}.bg-violet-500\/15{background-color:rgba(139,92,246,.15)}.p-2{padding:.5rem}.p-2\.5{padding:.625rem}.p-3{padding:.75rem}.p-4{padding:1rem}.p-5{padding:1.25rem}.p-6{padding:1.5rem}.px-2{padding-left:.5rem;padding-right:.5rem}.px-2\.5{padding-left:.625rem;padding-right:.625rem}.px-3{padding-left:.75rem;padding-right:.75rem}.px-4{padding-left:1rem;padding-right:1rem}.py-0\.5{padding-top:.125rem;padding-bottom:.125rem}.py-1{padding-top:.25rem;padding-bottom:.25rem}.py-1\.5{padding-top:.375rem;padding-bottom:.375rem}.py-2{padding-top:.5rem;padding-bottom:.5rem}.py-2\.5{padding-top:.625rem;padding-bottom:.625rem}.py-3{padding-top:.75rem;padding-bottom:.75rem}.py-4{padding-top:1rem;padding-bottom:1rem}.py-6{padding-top:1.5rem;padding-bottom:1.5rem}.py-8{padding-top:2rem;padding-bottom:2rem}.pt-2{padding-top:.5rem}.pt-3{padding-top:.75rem}.text-left{text-align:left}.text-center{text-align:center}.text-right{text-align:right}.font-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace}.font-sans{font-family:ui-sans-serif,system-ui,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji}.text-2xl{font-size:1.5rem;line-height:2rem}.text-\[10px\]{font-size:10px}.text-\[11px\]{font-size:11px}.text-base{font-size:1rem;line-height:1.5rem}.text-lg{font-size:1.125rem;line-height:1.75rem}.text-sm{font-size:.875rem;line-height:1.25rem}.text-xl{font-size:1.25rem;line-height:1.75rem}.text-xs{font-size:.75rem;line-height:1rem}.font-bold{font-weight:700}.font-medium{font-weight:500}.font-normal{font-weight:400}.font-semibold{font-weight:600}.uppercase{text-transform:uppercase}.tracking-tight{letter-spacing:-.025em}.tracking-wider{letter-spacing:.05em}.text-amber-200{--tw-text-opacity:1;color:rgb(253 230 138/var(--tw-text-opacity,1))}.text-amber-300{--tw-text-opacity:1;color:rgb(252 211 77/var(--tw-text-opacity,1))}.text-amber-300\/90{color:rgba(252,211,77,.9)}.text-brand-400{--tw-text-opacity:1;color:rgb(74 222 128/var(--tw-text-opacity,1))}.text-brand-500{--tw-text-opacity:1;color:rgb(34 197 94/var(--tw-text-opacity,1))}.text-emerald-200{--tw-text-opacity:1;color:rgb(167 243 208/var(--tw-text-opacity,1))}.text-emerald-300{--tw-text-opacity:1;color:rgb(110 231 183/var(--tw-text-opacity,1))}.text-emerald-400{--tw-text-opacity:1;color:rgb(52 211 153/var(--tw-text-opacity,1))}.text-purple-400{--tw-text-opacity:1;color:rgb(192 132 252/var(--tw-text-opacity,1))}.text-red-200{--tw-text-opacity:1;color:rgb(254 202 202/var(--tw-text-opacity,1))}.text-red-300{--tw-text-opacity:1;color:rgb(252 165 165/var(--tw-text-opacity,1))}.text-red-400{--tw-text-opacity:1;color:rgb(248 113 113/var(--tw-text-opacity,1))}.text-sky-300{--tw-text-opacity:1;color:rgb(125 211 252/var(--tw-text-opacity,1))}.text-slate-100{--tw-text-opacity:1;color:rgb(241 245 249/var(--tw-text-opacity,1))}.text-slate-200{--tw-text-opacity:1;color:rgb(226 232 240/var(--tw-text-opacity,1))}.text-slate-300{--tw-text-opacity:1;color:rgb(203 213 225/var(--tw-text-opacity,1))}.text-slate-400{--tw-text-opacity:1;color:rgb(148 163 184/var(--tw-text-opacity,1))}.text-slate-500{--tw-text-opacity:1;color:rgb(100 116 139/var(--tw-text-opacity,1))}.text-violet-300{--tw-text-opacity:1;color:rgb(196 181 253/var(--tw-text-opacity,1))}.text-white{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.opacity-70{opacity:.7}.shadow-2xl{--tw-shadow:0 25px 50px -12px rgba(0,0,0,.25);--tw-shadow-colored:0 25px 50px -12px var(--tw-shadow-color)}.shadow-2xl,.shadow-lg{box-shadow:var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow)}.shadow-lg{--tw-shadow:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1);--tw-shadow-colored:0 10px 15px -3px var(--tw-shadow-color),0 4px 6px -4px var(--tw-shadow-color)}.filter{filter:var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow)}.backdrop-blur{--tw-backdrop-blur:blur(8px)}.backdrop-blur,.backdrop-blur-sm{-webkit-backdrop-filter:var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia);backdrop-filter:var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia)}.backdrop-blur-sm{--tw-backdrop-blur:blur(4px)}.transition{transition-property:color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,-webkit-backdrop-filter;transition-property:color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,backdrop-filter;transition-property:color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,backdrop-filter,-webkit-backdrop-filter;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.15s}.transition-all{transition-property:all;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.15s}.duration-300{transition-duration:.3s}.\[color-scheme\:dark\]{color-scheme:dark}.selection\:bg-brand-500 ::-moz-selection{--tw-bg-opacity:1;background-color:rgb(34 197 94/var(--tw-bg-opacity,1))}.selection\:bg-brand-500 ::selection{--tw-bg-opacity:1;background-color:rgb(34 197 94/var(--tw-bg-opacity,1))}.selection\:text-white ::-moz-selection{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.selection\:text-white ::selection{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.selection\:bg-brand-500::-moz-selection{--tw-bg-opacity:1;background-color:rgb(34 197 94/var(--tw-bg-opacity,1))}.selection\:bg-brand-500::selection{--tw-bg-opacity:1;background-color:rgb(34 197 94/var(--tw-bg-opacity,1))}.selection\:text-white::-moz-selection{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.selection\:text-white::selection{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.first\:border-0:first-child{border-width:0}.hover\:bg-brand-500\/20:hover{background-color:rgba(34,197,94,.2)}.hover\:bg-brand-700:hover{--tw-bg-opacity:1;background-color:rgb(21 128 61/var(--tw-bg-opacity,1))}.hover\:bg-red-950:hover{--tw-bg-opacity:1;background-color:rgb(69 10 10/var(--tw-bg-opacity,1))}.hover\:bg-slate-700:hover{--tw-bg-opacity:1;background-color:rgb(51 65 85/var(--tw-bg-opacity,1))}.hover\:bg-slate-800:hover{--tw-bg-opacity:1;background-color:rgb(30 41 59/var(--tw-bg-opacity,1))}.hover\:bg-slate-950\/40:hover{background-color:rgba(2,6,23,.4)}.hover\:text-red-300:hover{--tw-text-opacity:1;color:rgb(252 165 165/var(--tw-text-opacity,1))}.hover\:text-white:hover{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.hover\:opacity-100:hover{opacity:1}.disabled\:cursor-not-allowed:disabled{cursor:not-allowed}.disabled\:opacity-40:disabled{opacity:.4}.disabled\:hover\:bg-brand-600:hover:disabled{--tw-bg-opacity:1;background-color:rgb(22 163 74/var(--tw-bg-opacity,1))}@media (min-width:640px){.sm\:flex{display:flex}.sm\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.sm\:grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.sm\:px-6{padding-left:1.5rem;padding-right:1.5rem}}@media (min-width:768px){.md\:inline{display:inline}}@media (min-width:1024px){.lg\:col-span-2{grid-column:span 2/span 2}.lg\:grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.lg\:grid-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}.lg\:grid-cols-6{grid-template-columns:repeat(6,minmax(0,1fr))}.lg\:px-8{padding-left:2rem;padding-right:2rem}}@keyframes spin{to{transform:rotate(360deg)}}.animate-spin{animation:spin 1s linear infinite}.uri-masked{-webkit-text-security:disc;text-security:disc}
/* Professional shell polish */
:root {
  --vb-bg: #020617;
  --vb-surface: rgba(15, 23, 42, 0.72);
  --vb-border: rgba(51, 65, 85, 0.85);
  --vb-brand: #22c55e;
  --vb-brand-dim: rgba(34, 197, 94, 0.12);
  --vb-glow: 0 0 80px rgba(34, 197, 94, 0.08);
}
body.bg-slate-950 {
  background:
    radial-gradient(1200px 600px at 10% -10%, rgba(34,197,94,0.09), transparent 55%),
    radial-gradient(900px 500px at 90% 0%, rgba(56,189,248,0.06), transparent 50%),
    #020617;
}
#auth-view {
  background:
    radial-gradient(900px 500px at 20% 20%, rgba(34,197,94,0.12), transparent 50%),
    radial-gradient(700px 400px at 80% 80%, rgba(56,189,248,0.08), transparent 45%),
    #020617;
}
.vb-auth-shell {
  display: grid;
  width: 100%;
  max-width: 920px;
  border: 1px solid var(--vb-border);
  border-radius: 1.25rem;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.9);
  box-shadow: 0 25px 50px -12px rgba(0,0,0,0.55), var(--vb-glow);
}
@media (min-width: 768px) {
  .vb-auth-shell { grid-template-columns: 1.05fr 0.95fr; }
}
.vb-auth-brand {
  display: none;
  padding: 2rem;
  background:
    linear-gradient(160deg, rgba(34,197,94,0.14), transparent 55%),
    linear-gradient(200deg, rgba(15,23,42,1), rgba(2,6,23,1));
  border-right: 1px solid var(--vb-border);
}
@media (min-width: 768px) {
  .vb-auth-brand { display: flex; flex-direction: column; justify-content: space-between; }
}
.vb-auth-brand h2 { font-size: 1.5rem; font-weight: 700; color: #fff; letter-spacing: -0.02em; margin: 0 0 0.5rem; }
.vb-auth-brand p { color: #94a3b8; font-size: 0.875rem; line-height: 1.55; margin: 0; }
.vb-auth-points { list-style: none; padding: 0; margin: 1.5rem 0 0; display: grid; gap: 0.75rem; }
.vb-auth-points li {
  display: flex; gap: 0.65rem; align-items: flex-start;
  font-size: 0.8rem; color: #cbd5e1;
}
.vb-auth-points span.icon {
  flex-shrink: 0; width: 1.5rem; height: 1.5rem; border-radius: 0.5rem;
  background: var(--vb-brand-dim); border: 1px solid rgba(34,197,94,0.25);
  display: flex; align-items: center; justify-content: center; color: var(--vb-brand);
  font-size: 0.7rem; font-weight: 700;
}
.vb-auth-form { padding: 1.75rem 1.5rem; }
@media (min-width: 768px) { .vb-auth-form { padding: 2rem; } }
header.border-b {
  background: rgba(2, 6, 23, 0.75) !important;
  border-bottom-color: rgba(51, 65, 85, 0.7) !important;
  box-shadow: 0 1px 0 rgba(255,255,255,0.03);
}
.vb-stat {
  position: relative;
  overflow: hidden;
  transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
}
.vb-stat:hover {
  border-color: rgba(34, 197, 94, 0.35) !important;
  box-shadow: 0 8px 24px -12px rgba(0,0,0,0.5);
}
.vb-stat::after {
  content: "";
  position: absolute; inset: auto -20% -40% auto;
  width: 8rem; height: 8rem;
  background: radial-gradient(circle, rgba(34,197,94,0.12), transparent 70%);
  pointer-events: none;
}
main .bg-slate-900\/60 {
  backdrop-filter: blur(8px);
}
input:focus, select:focus, textarea:focus, button:focus-visible {
  outline: 2px solid rgba(34,197,94,0.45);
  outline-offset: 1px;
}
.vb-link-muted { color: #94a3b8; font-size: 0.75rem; }
.vb-link-muted:hover { color: #86efac; }
.vb-chip {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-size: 10px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  padding: 0.2rem 0.55rem; border-radius: 999px;
  background: rgba(34,197,94,0.12); color: #4ade80; border: 1px solid rgba(34,197,94,0.25);
}

.vb-cinematic{position:relative;isolation:isolate;overflow:hidden;min-height:590px;padding:2.35rem!important;background:radial-gradient(ellipse at 12% 10%,rgba(27,184,125,.22),transparent 42%),radial-gradient(ellipse at 95% 75%,rgba(56,189,248,.12),transparent 40%),linear-gradient(145deg,#071b1b 0%,#071321 52%,#050b17 100%)!important}
.vb-cinematic:before{content:"";position:absolute;inset:0;z-index:-1;opacity:.18;background-image:linear-gradient(rgba(148,163,184,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.12) 1px,transparent 1px);background-size:38px 38px;mask-image:linear-gradient(to bottom,black,transparent 85%)}
.vb-cinematic:after{content:"";position:absolute;width:340px;height:340px;right:-190px;top:34%;border:1px solid rgba(45,212,191,.14);border-radius:50%;box-shadow:0 0 0 34px rgba(45,212,191,.025),0 0 0 72px rgba(45,212,191,.02);pointer-events:none}
.vb-brand-copy{position:relative;z-index:1}.vb-hero-title{font-size:clamp(2.5rem,4.5vw,3.6rem)!important;line-height:.99!important;letter-spacing:-.065em!important;font-weight:750!important;margin-top:1.2rem!important}.vb-hero-title span{color:#6ee7b7}.vb-hero-copy{max-width:440px;font-size:.93rem!important;line-height:1.65!important;color:#a9bac8!important}
.vb-live-dot,.vb-demo-top i,.vb-demo-status i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#34d399;box-shadow:0 0 12px #34d399}.vb-demo{position:relative;margin-top:1.8rem;padding:1rem;border:1px solid rgba(148,163,184,.2);border-radius:18px;background:linear-gradient(145deg,rgba(13,28,41,.92),rgba(5,15,27,.88));box-shadow:0 24px 65px rgba(0,0,0,.38),inset 0 1px rgba(255,255,255,.05);backdrop-filter:blur(16px);overflow:hidden}.vb-demo-top,.vb-demo-foot{display:flex;align-items:center;justify-content:space-between;gap:.5rem;font-size:.58rem;letter-spacing:.12em;color:#8da2b4;font-weight:700}.vb-demo-top span:first-child{display:flex;align-items:center;gap:.5rem}.vb-demo-time{font-variant-numeric:tabular-nums;color:#5eead4}.vb-demo-flow{display:grid;grid-template-columns:1fr 28px 1fr 28px 1fr;align-items:center;gap:.2rem;margin:1.3rem 0 1rem}.vb-demo-node{min-width:0;min-height:104px;padding:.65rem .35rem;border-radius:12px;border:1px solid rgba(148,163,184,.2);background:rgba(15,31,46,.85);display:flex;align-items:center;flex-direction:column;justify-content:center;text-align:center;gap:.25rem}.vb-node-icon{font-size:1.35rem;color:#a7f3d0}.vb-demo-node b{font-size:.53rem;letter-spacing:.07em;color:#e2e8f0}.vb-demo-node small{font-size:.55rem;color:#91a4b7;white-space:nowrap}.vb-demo-node em{font-size:.53rem;font-style:normal;color:#6ee7b7}.vb-secure{border-color:rgba(45,212,191,.35);background:linear-gradient(145deg,rgba(13,78,75,.32),rgba(15,31,46,.8))}.vb-demo-link{position:relative;height:2px;background:rgba(148,163,184,.22)}.vb-link-line{position:absolute;inset:0;background:linear-gradient(90deg,transparent,#5eead4,transparent);transform:scaleX(.4);transform-origin:left}.vb-packet{position:absolute;z-index:2;top:-3px;left:0;width:7px;height:7px;border-radius:50%;background:#a7f3d0;box-shadow:0 0 14px #5eead4}.vb-demo-progress{height:3px;background:rgba(148,163,184,.14);border-radius:9px;overflow:hidden}.vb-demo-progress-fill{height:100%;width:0;background:linear-gradient(90deg,#0d9488,#6ee7b7);box-shadow:0 0 12px rgba(45,212,191,.7)}.vb-demo-foot{margin-top:.7rem;letter-spacing:.03em;font-size:.58rem}.vb-demo-status{display:flex;align-items:center;gap:.4rem;color:#a7f3d0}.vb-proof-row{display:flex;justify-content:space-between;gap:.4rem;margin-top:1rem;color:#71879a;font-size:.55rem;letter-spacing:.12em;font-weight:700}.vb-brand-bottom{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding-top:1.2rem}.vb-brand-bottom>span{font-size:.63rem;color:#71879a}.vb-brand-bottom .vb-link-muted{color:#a7f3d0;font-size:.75rem}
/* Responsive layout foundation */
html{width:100%;min-width:320px;scrollbar-gutter:stable}
body{width:100%;min-width:320px;overflow-x:hidden}
*,*::before,*::after{box-sizing:border-box}
img,svg,video,canvas{max-width:100%;height:auto}
input,select,textarea,button{max-width:100%;font:inherit}
#app-view{min-width:0;overflow-x:clip}
#app-view>header>div{min-width:0;gap:1rem}
#app-view main{min-width:0}
#app-view main>*{min-width:0}
#app-view table{width:100%;border-collapse:collapse}
#app-view .overflow-x-auto{max-width:100%;overscroll-behavior-x:contain}
#auth-view{overflow-y:auto;overscroll-behavior-y:contain;min-height:100vh;min-height:100dvh;padding:clamp(.75rem,3vw,2rem)}
.vb-auth-shell{width:min(100%,1120px);min-width:0;margin:auto}
.vb-auth-brand,.vb-auth-form{min-width:0}
.vb-cinematic{min-height:0}
.vb-demo,.vb-demo-flow,.vb-demo-node{min-width:0}
.vb-demo-node small{max-width:100%;overflow-wrap:anywhere;white-space:normal}
@media(max-width:1023px){
  #app-view main{padding-top:1.5rem;padding-bottom:1.5rem}
}
@media(max-width:767px){
  #auth-view{align-items:flex-start;padding:.75rem}
  .vb-auth-shell{display:grid;grid-template-columns:minmax(0,1fr);max-width:480px;border-radius:1rem}
  .vb-auth-brand,.vb-cinematic{display:flex!important;flex-direction:column;justify-content:space-between}
  .vb-auth-brand{padding:1.15rem;border-right:0;border-bottom:1px solid var(--vb-border)}
  .vb-cinematic{min-height:0!important;padding:1.15rem!important}
  .vb-hero-title{font-size:clamp(2rem,8vw,2.8rem)!important;line-height:1.02!important;margin-top:.85rem!important}
  .vb-hero-copy{font-size:.82rem!important;line-height:1.5!important}
  .vb-demo{margin-top:1rem;padding:.75rem}
  .vb-demo-flow{grid-template-columns:minmax(0,1fr) 14px minmax(0,1fr) 14px minmax(0,1fr);gap:.12rem;margin:.85rem 0}
  .vb-demo-node{min-height:82px;padding:.45rem .15rem}
  .vb-demo-node b{font-size:clamp(.42rem,1.7vw,.53rem);letter-spacing:.02em;overflow-wrap:anywhere}
  .vb-demo-node small,.vb-demo-node em{font-size:.48rem}
  .vb-demo-link{min-width:0}
  .vb-proof-row{font-size:.48rem;letter-spacing:.06em}
  .vb-brand-bottom{padding-top:.85rem;flex-wrap:wrap}
  .vb-brand-bottom>span{font-size:.58rem}
  .vb-auth-form{padding:1.25rem!important}
  #app-view>header{position:relative}
  #app-view>header>div{height:auto;min-height:4rem;flex-wrap:wrap;padding-top:.7rem;padding-bottom:.7rem}
  #app-view>header>div>div:first-child{flex:1 1 100%;min-width:0}
  #app-view>header>div>div:last-child{width:100%;display:flex;flex-wrap:wrap;gap:.5rem}
  #app-view>header>div>div:last-child button{flex:1 1 auto;justify-content:center;min-height:2.25rem}
  #app-view main{padding-left:.85rem;padding-right:.85rem;gap:1.25rem}
  #app-view .grid{min-width:0}
  #app-view .rounded-xl,#app-view .rounded-2xl{min-width:0}
  #app-view table{display:block;overflow-x:auto;white-space:nowrap;-webkit-overflow-scrolling:touch}
  #app-view [role=dialog],#app-view .fixed.inset-0>div{max-width:calc(100vw - 1.5rem)}
}
@media(max-width:380px){
  .vb-demo-top,.vb-demo-foot{font-size:.5rem;letter-spacing:.04em}
  .vb-demo-flow{grid-template-columns:minmax(0,1fr) 8px minmax(0,1fr) 8px minmax(0,1fr)}
  .vb-demo-node{min-height:76px}
  .vb-node-icon{font-size:1.05rem}
  .vb-proof-row{gap:.2rem;font-size:.43rem}
  #auth-actions-login{flex-direction:column}
  #auth-actions-login button{width:100%;min-height:2.5rem}
}
@media(min-width:768px) and (max-width:1023px){
  .vb-auth-shell{grid-template-columns:minmax(0,1fr) minmax(300px,.9fr)}
  .vb-auth-brand{padding:1.5rem}
  .vb-cinematic{padding:1.5rem!important}
  .vb-hero-title{font-size:clamp(2.2rem,4vw,3rem)!important}
  .vb-demo-flow{grid-template-columns:minmax(0,1fr) 16px minmax(0,1fr) 16px minmax(0,1fr)}
}
@media(prefers-reduced-motion:reduce){.vb-demo *{animation:none!important;transition:none!important}}
/* Premium 3D depth and high-density display polish */
#auth-view{
  background:
    radial-gradient(ellipse at 18% 18%,rgba(16,185,129,.16),transparent 34%),
    radial-gradient(ellipse at 82% 78%,rgba(14,165,233,.12),transparent 38%),
    #020617;
}
.vb-auth-shell{
  perspective:1800px;
  transform-style:preserve-3d;
  box-shadow:0 42px 110px rgba(0,0,0,.62),0 0 0 1px rgba(148,163,184,.08),0 0 100px rgba(16,185,129,.09);
}
.vb-cinematic{
  position:relative;
  perspective:1400px;
  transform-style:preserve-3d;
  background:
    radial-gradient(ellipse at 18% 20%,rgba(52,211,153,.25),transparent 42%),
    radial-gradient(ellipse at 82% 85%,rgba(14,165,233,.19),transparent 42%),
    linear-gradient(145deg,#071e1c 0%,#071525 52%,#030914 100%)!important;
}
.vb-cinematic:after{
  width:clamp(260px,34vw,460px);height:clamp(260px,34vw,460px);
  right:-12%;top:28%;
  border-color:rgba(94,234,212,.2);
  box-shadow:0 0 0 28px rgba(45,212,191,.035),0 0 0 62px rgba(45,212,191,.025),0 0 90px rgba(45,212,191,.08);
  transform:translateZ(-35px);
}
.vb-brand-copy{transform:translateZ(22px)}
.vb-brand-bottom{transform:translateZ(14px)}
.vb-demo{
  transform:perspective(1100px) rotateX(5deg) rotateY(-4deg) translateZ(28px);
  transform-style:preserve-3d;
  border-color:rgba(110,231,183,.27);
  background:linear-gradient(145deg,rgba(15,39,52,.96),rgba(3,13,25,.96));
  box-shadow:0 38px 75px rgba(0,0,0,.52),0 12px 28px rgba(16,185,129,.1),inset 0 1px rgba(255,255,255,.11),inset 0 -1px rgba(0,0,0,.5);
  transition:transform .65s cubic-bezier(.2,.75,.25,1),box-shadow .65s ease,border-color .4s ease;
}
.vb-demo:before{
  content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit;
  background:linear-gradient(125deg,rgba(255,255,255,.12),transparent 22%,transparent 70%,rgba(45,212,191,.08));
  transform:translateZ(2px);
}
.vb-demo-flow{transform:translateZ(18px);transform-style:preserve-3d}
.vb-demo-node{
  position:relative;transform:translateZ(12px);
  box-shadow:0 14px 24px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.07);
  transition:transform .35s ease,box-shadow .35s ease,border-color .35s ease;
}
.vb-demo-node:after{
  content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:linear-gradient(145deg,rgba(255,255,255,.07),transparent 48%);
}
.vb-source{box-shadow:0 14px 26px rgba(0,0,0,.28),0 0 24px rgba(52,211,153,.07),inset 0 1px rgba(255,255,255,.08)}
.vb-secure{box-shadow:0 16px 30px rgba(0,0,0,.32),0 0 30px rgba(45,212,191,.12),inset 0 1px rgba(255,255,255,.1)}
.vb-storage{box-shadow:0 14px 26px rgba(0,0,0,.28),0 0 24px rgba(56,189,248,.07),inset 0 1px rgba(255,255,255,.08)}
.vb-node-icon{text-shadow:0 0 18px rgba(110,231,183,.45)}
.vb-demo-link{box-shadow:0 0 12px rgba(45,212,191,.1)}
.vb-demo-progress{box-shadow:inset 0 1px 3px rgba(0,0,0,.5)}
.vb-demo-progress-fill{box-shadow:0 0 18px rgba(45,212,191,.85),0 0 34px rgba(45,212,191,.28)}
.vb-chip{box-shadow:0 0 24px rgba(16,185,129,.12),inset 0 1px rgba(255,255,255,.08);backdrop-filter:blur(12px)}
.vb-live-dot{box-shadow:0 0 8px #34d399,0 0 20px rgba(52,211,153,.65)}
.vb-stat,.vb-auth-form,#app-view main .bg-slate-900\/60{
  transform-style:preserve-3d;
  transition:transform .3s ease,border-color .3s ease,box-shadow .3s ease;
}
@media(hover:hover) and (pointer:fine){
  .vb-demo:hover{transform:perspective(1100px) rotateX(1deg) rotateY(0deg) translateY(-5px) translateZ(38px);box-shadow:0 48px 95px rgba(0,0,0,.58),0 16px 38px rgba(16,185,129,.14),inset 0 1px rgba(255,255,255,.13)}
  .vb-demo-node:hover{transform:translateZ(24px) translateY(-3px);border-color:rgba(110,231,183,.48);box-shadow:0 22px 34px rgba(0,0,0,.38),0 0 22px rgba(45,212,191,.12)}
  .vb-stat:hover{transform:perspective(900px) translateY(-4px) rotateX(2deg);box-shadow:0 18px 35px rgba(0,0,0,.3),0 0 24px rgba(34,197,94,.07)}
}
@media(min-width:1600px){
  #app-view main{max-width:1440px}
  .vb-auth-shell{max-width:1280px}
  .vb-cinematic{padding:clamp(2.5rem,3.2vw,4.5rem)!important}
  .vb-hero-title{font-size:clamp(3.6rem,4.2vw,5rem)!important}
  .vb-hero-copy{max-width:560px;font-size:1.05rem!important}
  .vb-demo{margin-top:2.4rem;padding:1.35rem}
  .vb-demo-node{min-height:126px}
}
@media(min-width:2560px){
  #app-view main{max-width:1600px}
  .vb-auth-shell{max-width:1440px}
  .vb-auth-form{padding:clamp(2.5rem,3vw,4.5rem)}
  .vb-cinematic{padding:clamp(3rem,4vw,5rem)!important}
}
@media(max-width:767px){
  .vb-demo{transform:none}
  .vb-demo-flow,.vb-demo-node{transform:none}
}
@media(prefers-reduced-motion:reduce){
  .vb-demo,.vb-demo-node,.vb-stat{transition:none!important;transform:none!important}
}
</style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col font-sans selection:bg-brand-500 selection:text-white">

    <!-- Auth screen -->
    <div id="auth-view" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div class="vb-auth-shell w-full">
            <div class="vb-auth-brand vb-cinematic">
                <div class="vb-brand-copy">
                    <div class="vb-chip mb-4"><span class="vb-live-dot"></span> PRIVATE BY DESIGN · BUILT FOR REAL WORKLOADS</div>
                    <h2 class="vb-hero-title">Your data.<br><span>Always recoverable.</span></h2>
                    <p class="mt-3 vb-hero-copy">A calmer way to protect the databases your business depends on. Encrypted backups, your storage, and a clear path back when it matters.</p>
                    <div class="vb-demo" aria-label="Animated product demonstration of a database backup being encrypted and sent to customer-owned storage">
                        <div class="vb-demo-top"><span><i></i> LIVE BACKUP WALKTHROUGH</span><span class="vb-demo-time">00:00</span></div>
                        <div class="vb-demo-flow">
                            <div class="vb-demo-node vb-source"><span class="vb-node-icon">▤</span><b>PRODUCTION DB</b><small>PostgreSQL · 2.4 GB</small><em>Connected</em></div>
                            <div class="vb-demo-link"><span class="vb-packet"></span><span class="vb-link-line"></span></div>
                            <div class="vb-demo-node vb-secure"><span class="vb-node-icon">⌑</span><b>ENCRYPTION</b><small>AES-256-GCM</small><em>Protected</em></div>
                            <div class="vb-demo-link"><span class="vb-packet"></span><span class="vb-link-line"></span></div>
                            <div class="vb-demo-node vb-storage"><span class="vb-node-icon">▱</span><b>YOUR STORAGE</b><small>S3-compatible</small><em>Verified</em></div>
                        </div>
                        <div class="vb-demo-progress"><div class="vb-demo-progress-fill"></div></div>
                        <div class="vb-demo-foot"><span class="vb-demo-status"><i></i> <b>Backup verified</b></span><span>SHA-256 · 100%</span></div>
                    </div>
                    <div class="vb-proof-row"><span>01 / CONNECT</span><span>02 / ENCRYPT</span><span>03 / VERIFY</span></div>
                </div>
                <div class="vb-brand-bottom">
                    <a href="/install" class="vb-link-muted">Explore desktop agent downloads <span aria-hidden="true">↗</span></a>
                    <span>Windows · macOS · Linux</span>
                </div>
            </div>
            <div class="vb-auth-form space-y-4">
            <div class="flex items-center space-x-3">
                <div class="bg-brand-500/10 border border-brand-500/30 p-2 rounded-lg text-brand-500">
                    <i data-lucide="shield-check" class="w-6 h-6"></i>
                </div>
                <div>
                    <h1 id="auth-title" class="font-bold text-white text-lg">VaultBackup</h1>
                    <p id="auth-sub" class="text-xs text-slate-400">Sign in to manage your backups</p>
                </div>
            </div>
            <div class="space-y-3">
                <div id="auth-email-wrap">
                    <label for="auth-email" class="block text-xs font-medium text-slate-300 mb-1">Email</label>
                    <input type="email" id="auth-email" autocomplete="username" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200">
                </div>
                <div id="auth-password-wrap">
                    <label for="auth-password" id="auth-password-label" class="block text-xs font-medium text-slate-300 mb-1">Password (10+ characters)</label>
                    <input type="password" id="auth-password" autocomplete="current-password" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200">
                    <div class="mt-1 text-right"><button id="link-forgot" type="button" class="text-xs text-brand-400 hover:text-brand-300">Forgot password?</button></div>
                </div>
                <div id="auth-confirm-wrap" class="hidden">
                    <label for="auth-confirm" class="block text-xs font-medium text-slate-300 mb-1">Confirm new password</label>
                    <input type="password" id="auth-confirm" autocomplete="new-password" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200">
                </div>
                <p id="auth-error" class="text-xs text-red-400 min-h-[1rem]"></p>
                <p id="auth-info" class="text-xs text-emerald-400"></p>
                <p id="auth-mail-note" class="hidden text-xs text-amber-300">Email is not set up on this server. Ask the administrator for a reset link.</p>
            </div>
            <div id="auth-actions-login" class="flex items-center gap-3">
                <button id="btn-login" class="flex-1 bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm py-2 rounded-xl transition">Sign in</button>
                <button id="btn-register" class="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-medium text-sm py-2 rounded-xl transition">Create account</button>
            </div>
            <div id="auth-actions-forgot" class="hidden">
                <button id="btn-forgot-send" class="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm py-2 rounded-xl transition">Send reset link</button>
            </div>
            <div id="auth-actions-reset" class="hidden">
                <button id="btn-reset-submit" class="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm py-2 rounded-xl transition">Save new password</button>
            </div>
            <button id="link-back" type="button" class="hidden text-xs text-slate-400 hover:text-white">Back to sign in</button>
            <p class="text-[11px] text-slate-500 pt-1">Need the agent? <a href="/install" class="text-brand-400 hover:text-brand-300">Install guide & downloads</a></p>
            </div>
        </div>
    </div>

    <div id="app-view" class="hidden flex-col flex-grow w-full">
        <header class="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                <div class="flex items-center space-x-3">
                    <div class="bg-brand-500/10 border border-brand-500/30 p-2.5 rounded-xl text-brand-500 shadow-[0_0_24px_rgba(34,197,94,0.15)]">
                        <i data-lucide="shield-check" class="w-5 h-5"></i>
                    </div>
                    <div>
                        <h1 class="font-bold tracking-tight text-white flex items-center gap-2 text-[15px] sm:text-base">
                            VaultBackup <span class="text-[10px] bg-brand-500/20 text-brand-400 px-2 py-0.5 rounded-full font-semibold tracking-wide uppercase">Edge</span>
                        </h1>
                        <p class="text-[11px] text-slate-400">Encrypted backups · agents · restore chains</p>
                    </div>
                </div>
                <div class="flex items-center gap-3">
                    <div id="health-badge" class="hidden sm:flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs">
                        <span id="health-dot" class="w-2 h-2 rounded-full bg-slate-500"></span>
                        <span id="health-text" class="text-slate-300">Checking...</span>
                    </div>
                    <div id="sched-badge" class="hidden sm:flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs">
                        <span id="sched-dot" class="w-2 h-2 rounded-full bg-slate-500"></span>
                        <span id="sched-text" class="text-slate-300">Scheduler: checking...</span>
                    </div>
                    <span id="user-email" class="hidden md:inline text-xs text-slate-400"></span>
                    <button id="btn-password" class="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                        <i data-lucide="key-round" class="w-3.5 h-3.5"></i> Password
                    </button>
                    <button id="btn-logout" class="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                        <i data-lucide="log-out" class="w-3.5 h-3.5"></i> Sign out
                    </button>
                </div>
            </div>
        </header>

        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-grow w-full space-y-8">
            <div id="toast" class="hidden items-center justify-between border px-4 py-3 rounded-xl shadow-lg transition-all duration-300" role="status">
                <div class="flex items-center space-x-3">
                    <i id="toast-icon" data-lucide="check-circle-2" class="w-5 h-5"></i>
                    <span id="toast-msg" class="text-sm font-medium"></span>
                </div>
                <button id="toast-close" aria-label="Dismiss" class="opacity-70 hover:opacity-100"><i data-lucide="x" class="w-4 h-4"></i></button>
            </div>

            <div id="scheduler-banner" class="hidden rounded-xl border border-amber-700/60 bg-amber-950/60 text-amber-200 px-4 py-3">
                <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div class="space-y-1 min-w-0">
                        <p id="scheduler-banner-title" class="text-sm font-medium"></p>
                        <p id="scheduler-banner-text" class="text-xs text-amber-300/90"></p>
                    </div>
                    <button id="btn-sched-help" type="button" class="shrink-0 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-700/60 text-amber-100 font-medium text-xs px-3 py-2 rounded-xl transition">How to start scheduler</button>
                </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="vb-stat bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 min-h-[7.5rem] flex flex-col">
                    <p class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Connected Databases</p>
                    <h3 id="stat-db-count" class="text-2xl font-bold mt-2 text-white tracking-tight">0</h3>
                    <p class="text-xs text-brand-400 mt-auto pt-1">7 engines supported</p>
                </div>
                <div class="vb-stat bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 min-h-[7.5rem] flex flex-col">
                    <p class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Storage Target</p>
                    <h3 id="stat-storage-mode" class="text-2xl font-bold mt-2 text-white tracking-tight truncate" title="">Platform Managed</h3>
                    <p class="text-xs text-slate-400 mt-auto pt-1">R2 vault or your own bucket</p>
                </div>
                <div class="vb-stat bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 min-h-[7.5rem] flex flex-col">
                    <p class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Last Successful Backup</p>
                    <h3 id="stat-last-backup" class="text-xl sm:text-2xl font-bold mt-2 text-white tracking-tight leading-tight">Never</h3>
                    <p id="stat-next" class="text-xs text-emerald-400 mt-auto pt-1">No backups scheduled</p>
                </div>
                <div class="vb-stat bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 min-h-[7.5rem] flex flex-col">
                    <p class="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Encryption</p>
                    <h3 class="text-2xl font-bold mt-2 text-white tracking-tight">AES-256-GCM</h3>
                    <p class="text-xs text-slate-400 mt-auto pt-1">Server-side, encrypted before upload</p>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div class="lg:col-span-2 space-y-6">
                    <div class="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6">
                        <div class="flex items-center justify-between mb-6">
                            <div>
                                <h2 class="text-lg font-semibold text-white">Monitored Databases</h2>
                                <p class="text-xs text-slate-400">Connection strings are encrypted before they are stored.</p>
                            </div>
                            <button id="btn-add-db" class="bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs px-4 py-2 rounded-xl flex items-center gap-2 transition">
                                <i data-lucide="plus" class="w-4 h-4"></i> Add Database
                            </button>
                        </div>
                        <div id="db-list-container" class="space-y-3">
                            <div class="text-xs text-slate-500 text-center py-6">Loading databases...</div>
                        </div>
                    </div>

                    <div class="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6">
                        <div class="flex items-center justify-between mb-6">
                            <div>
                                <h2 class="text-lg font-semibold text-white">Desktop Agents</h2>
                                <p class="text-xs text-slate-400">Install the agent on Windows, macOS or Linux to back up local databases. Agents report OS, CPU, RAM and DB health every few seconds while online.</p>
                                <div class="mt-3 flex flex-wrap gap-2">
                                    <a href="/install" class="text-xs px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition">Download &amp; install guide</a>
                                    <a href="/download/windows-amd64" class="text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition">Windows</a>
                                    <a href="/download/darwin-arm64" class="text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition">macOS</a>
                                    <a href="/download/linux-amd64" class="text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition">Linux</a>
                                    <a href="/install" class="text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 transition">All platforms</a>
                                </div>
                                <p class="text-xs text-slate-500 mt-2 hidden">
                            </div>
                            <button id="btn-add-agent" class="bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs px-4 py-2 rounded-xl flex items-center gap-2 transition">
                                <i data-lucide="plus" class="w-4 h-4"></i> Create token
                            </button>
                        </div>
                        <div id="agent-seats" class="text-xs text-slate-400 mb-3"></div>
                        <div id="agent-list-container" class="space-y-3">
                            <div class="text-xs text-slate-500 text-center py-6">Loading agents...</div>
                        </div>
                    </div>

                    <div class="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6">
                        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                            <h2 class="text-lg font-semibold text-white">Backup History</h2>
                            <div class="flex flex-wrap items-center gap-2">
                                <input type="search" id="hist-filter-q" placeholder="Search database..." class="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 w-40" autocomplete="off">
                                <select id="hist-filter-status" class="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 [color-scheme:dark]">
                                    <option value="">All statuses</option>
                                    <option value="Success">Success</option>
                                    <option value="Failed">Failed</option>
                                    <option value="Running">Running</option>
                                </select>
                                <select id="hist-filter-db" class="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 [color-scheme:dark] max-w-[10rem]">
                                    <option value="">All databases</option>
                                </select>
                            </div>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-xs">
                                <thead class="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-mono">
                                    <tr>
                                        <th class="py-3 px-3 rounded-l-lg">Database</th>
                                        <th class="py-3 px-3">Type</th>
                                        <th class="py-3 px-3">Time</th>
                                        <th class="py-3 px-3">Took</th>
                                        <th class="py-3 px-3">Size</th>
                                        <th class="py-3 px-3">Status</th>
                                        <th class="py-3 px-3 text-right rounded-r-lg">Actions</th>
                                    </tr>
                                </thead>
                                <tbody id="logs-table-body" class="divide-y divide-slate-800/50">
                                    <tr><td colspan="7" class="py-4 text-center text-slate-500">No backup history yet.</td></tr>
                                </tbody>
                            </table>
                        </div>
                        <div id="hist-pager" class="hidden flex items-center justify-between mt-3 text-xs text-slate-400">
                            <span id="hist-page-label"></span>
                            <div class="flex gap-2">
                                <button type="button" id="hist-prev" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-40">Prev</button>
                                <button type="button" id="hist-next" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-40">Next</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="space-y-6">
                    <div class="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 space-y-4">
                        <div class="flex items-center space-x-3">
                            <div class="p-2 bg-purple-500/10 text-purple-400 rounded-lg">
                                <i data-lucide="hard-drive" class="w-5 h-5"></i>
                            </div>
                            <div>
                                <h2 class="text-base font-semibold text-white">Storage Backend</h2>
                                <p class="text-xs text-slate-400">Managed or bring your own bucket</p>
                            </div>
                        </div>

                        <div id="storage-summary" class="hidden rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs space-y-2">
                            <div id="storage-summary-text" class="text-slate-300 break-words"></div>
                            <div id="storage-archived" class="text-[11px] text-slate-500"></div>
                            <button id="btn-edit-storage" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-medium text-xs px-3 py-2 rounded-xl transition">Change storage</button>
                        </div>
                        <div id="storage-form" class="space-y-4">
                        <div>
                            <label for="storage-mode" class="block text-xs font-medium text-slate-300 mb-1">Storage Mode</label>
                            <select id="storage-mode" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200">
                                <option value="MANAGED">Platform Managed Vault (R2)</option>
                                <option value="BYOB">Bring Your Own Bucket (S3 or Backblaze B2)</option>
                            </select>
                            <p id="storage-note" class="text-[11px] text-slate-500 mt-1"></p>
                        </div>

                        <div id="byob-fields" class="space-y-3 hidden border-t border-slate-800 pt-3">
                            <div>
                                <label for="byob-provider" class="block text-xs font-medium text-slate-300 mb-1">Storage Provider</label>
                                <select id="byob-provider" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200">
                                    <option value="BackblazeB2">Backblaze B2</option>
                                    <option value="CloudflareR2">Cloudflare R2</option>
                                    <option value="AWSS3">AWS S3</option>
                                    <option value="Wasabi">Wasabi Storage</option>
                                    <option value="CustomS3">Custom S3-Compatible</option>
                                </select>
                                <p id="byob-help" class="text-[11px] text-slate-500 mt-1"></p>
                            </div>
                            <div>
                                <label for="byob-endpoint" class="block text-xs font-medium text-slate-300 mb-1">S3 Endpoint Host</label>
                                <input type="text" id="byob-endpoint" autocomplete="off" placeholder="s3.us-west-004.backblazeb2.com" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200">
                            </div>
                            <div>
                                <label for="byob-region" class="block text-xs font-medium text-slate-300 mb-1">Region (optional)</label>
                                <input type="text" id="byob-region" autocomplete="off" placeholder="auto-detected from endpoint" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200">
                            </div>
                            <div>
                                <label for="byob-bucket" class="block text-xs font-medium text-slate-300 mb-1">Bucket Name</label>
                                <input type="text" id="byob-bucket" autocomplete="off" placeholder="my-backups-bucket" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200">
                            </div>
                            <div>
                                <label for="byob-key" class="block text-xs font-medium text-slate-300 mb-1">Access Key ID (B2: keyID)</label>
                                <input type="text" id="byob-key" autocomplete="off" placeholder="access_key_id" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200">
                            </div>
                            <div>
                                <label for="byob-secret" class="block text-xs font-medium text-slate-300 mb-1">Secret Access Key (B2: applicationKey)</label>
                                <input type="password" id="byob-secret" autocomplete="new-password" placeholder="secret_access_key" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200">
                            </div>
                        </div>

                        <p id="storage-error" class="text-xs text-red-400 hidden"></p>

                        <p class="text-[11px] text-slate-500">Save unlocks only after a successful test. Changing any field requires a new test.</p>
                        <div class="flex gap-2">
                            <button id="btn-test-storage" class="flex-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-medium text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-2">
                                <i data-lucide="plug-zap" class="w-4 h-4"></i> Test connection
                            </button>
                            <button id="btn-save-storage" disabled class="flex-1 bg-brand-600 hover:bg-brand-700 border border-brand-700 text-white font-medium text-xs py-2.5 rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-brand-600">
                                <i data-lucide="save" class="w-4 h-4"></i> Save target
                            </button>
                        </div>
                            <button id="btn-cancel-storage" type="button" class="hidden text-xs text-slate-400 hover:text-white">Cancel changes</button>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    </div>

    <div id="pw-modal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm hidden items-center justify-center z-50 p-4">
        <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div class="flex items-center justify-between">
                <h3 class="text-base font-semibold text-white">Change password</h3>
                <button id="btn-close-pw" aria-label="Close" class="text-slate-400 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <div class="space-y-3">
                <div>
                    <label for="pw-current" class="block text-xs font-medium text-slate-300 mb-1">Current password</label>
                    <input type="password" id="pw-current" autocomplete="current-password" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200">
                </div>
                <div>
                    <label for="pw-new" class="block text-xs font-medium text-slate-300 mb-1">New password (10+ characters)</label>
                    <input type="password" id="pw-new" autocomplete="new-password" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200">
                </div>
                <div>
                    <label for="pw-confirm" class="block text-xs font-medium text-slate-300 mb-1">Confirm new password</label>
                    <input type="password" id="pw-confirm" autocomplete="new-password" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200">
                </div>
                <p id="pw-error" class="text-xs text-red-400 hidden"></p>
                <p class="text-[11px] text-slate-500">Other devices will be signed out after the change.</p>
            </div>
            <div class="flex items-center justify-end space-x-3 pt-2">
                <button id="btn-cancel-pw" class="px-4 py-2 bg-slate-800 text-xs font-medium rounded-xl text-slate-300">Cancel</button>
                <button id="btn-save-pw" class="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-xs font-medium rounded-xl text-white">Update password</button>
            </div>
        </div>
    </div>

    <div id="log-modal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm hidden items-center justify-center z-50 p-4">
        <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-2xl">
            <div class="flex items-center justify-between gap-3">
                <h3 id="log-title" class="text-base font-semibold text-white"></h3>
                <button id="btn-close-log" aria-label="Close" class="text-slate-400 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <div id="log-body" class="space-y-4 text-xs text-slate-300"></div>
        </div>
    </div>

    <div id="agent-modal" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm hidden items-center justify-center z-50 p-4">
        <div class="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div class="flex items-center justify-between">
                <h3 class="text-base font-semibold text-white" id="agent-modal-title">Create agent token</h3>
                <button id="btn-close-agent" aria-label="Close" class="text-slate-400 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <div id="agent-create-form" class="space-y-3">
                <div>
                    <label for="agent-name" class="block text-xs font-medium text-slate-300 mb-1">Agent name</label>
                    <input type="text" id="agent-name" maxlength="64" placeholder="front-desk-pc" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200">
                </div>
                <p class="text-[11px] text-slate-500">One token binds to one device after the first license check. You can unbind later to move it.</p>
                <p id="agent-create-error" class="text-xs text-red-400 hidden"></p>
                <div class="flex justify-end gap-2 pt-1">
                    <button id="btn-cancel-agent" class="px-4 py-2 bg-slate-800 text-xs font-medium rounded-xl text-slate-300">Cancel</button>
                    <button id="btn-create-agent" class="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-xs font-medium rounded-xl text-white">Create token</button>
                </div>
            </div>
            <div id="agent-token-result" class="hidden space-y-3">
                <p class="text-xs text-amber-300">Copy this token now. It is shown only once.</p>
                <div class="bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-brand-400 break-all select-all" id="agent-token-value"></div>
                <p class="text-[11px] text-slate-500">Put it in the agent config as <code class="text-slate-300">vault_token</code>. Valid 365 days. Phone-home URL: the Worker origin.</p>
                <div class="flex justify-end">
                    <button id="btn-agent-done" class="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-xs font-medium rounded-xl text-white">Done</button>
                </div>
            </div>
        </div>
    </div>

    <div id="db-modal" class="fixed inset-0 z-50 hidden">
        <div id="db-modal-backdrop" class="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"></div>
        <div class="absolute inset-y-0 right-0 w-full max-w-lg bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col">
            <div class="flex items-start justify-between px-5 py-4 border-b border-slate-800 shrink-0 gap-3">
                <div class="min-w-0">
                    <h3 class="text-base font-semibold text-white flex items-center gap-2">
                        <i data-lucide="database" class="w-5 h-5 text-brand-500 shrink-0"></i> <span id="db-modal-title">Connect Database</span>
                    </h3>
                    <p id="db-modal-sub" class="text-[11px] text-slate-400 mt-1">Name it, pick the engine, paste the URL, test, then save.</p>
                    <p id="db-modal-steps" class="text-[10px] text-slate-500 mt-1.5 font-medium tracking-wide">1 Connection · 2 Backup plan · 3 Retention</p>
                </div>
                <button id="btn-close-modal" aria-label="Close" class="text-slate-400 hover:text-white p-1 shrink-0"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <div class="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                <div class="space-y-3">
                <div class="flex items-center justify-between gap-2">
                    <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">1 · Connection</p>
                    <span id="conn-status" class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">Not tested</span>
                </div>
                <div>
                    <label for="new-db-name" class="block text-xs font-medium text-slate-300 mb-1">Database Name</label>
                    <input type="text" id="new-db-name" maxlength="64" placeholder="production-db" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200">
                </div>
                <div>
                    <label class="block text-xs font-medium text-slate-300 mb-1.5">Popular services</label>
                    <div id="provider-chips" class="flex flex-wrap gap-1.5 mb-2">
                        <button type="button" data-chip="Auto|" class="provider-chip text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50 hover:text-brand-400 transition">Auto</button>
                        <button type="button" data-chip="PostgreSQL|Neon" class="provider-chip text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50 hover:text-brand-400 transition">Neon</button>
                        <button type="button" data-chip="PostgreSQL|Supabase" class="provider-chip text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50 hover:text-brand-400 transition">Supabase</button>
                        <button type="button" data-chip="MySQL|PlanetScale" class="provider-chip text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50 hover:text-brand-400 transition">PlanetScale</button>
                        <button type="button" data-chip="MongoDB|MongoDB Atlas" class="provider-chip text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50 hover:text-brand-400 transition">MongoDB Atlas</button>
                        <button type="button" data-chip="Redis|Upstash" class="provider-chip text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50 hover:text-brand-400 transition">Upstash</button>
                        <button type="button" data-chip="Turso / SQLite|Turso / libSQL" class="provider-chip text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50 hover:text-brand-400 transition">Turso</button>
                        <button type="button" data-chip="PostgreSQL|AWS RDS / Aurora PostgreSQL" class="provider-chip text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50 hover:text-brand-400 transition">RDS Postgres</button>
                    </div>
                    <label for="new-db-provider" class="block text-xs font-medium text-slate-300 mb-1">Database Service</label>
                    <select id="new-db-provider" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200">
                        <option value="Auto|">Auto-detect from the connection string</option>
                        <optgroup label="PostgreSQL">
                            <option value="PostgreSQL|Neon">Neon</option>
                            <option value="PostgreSQL|Supabase">Supabase</option>
                            <option value="PostgreSQL|AWS RDS / Aurora PostgreSQL">AWS RDS / Aurora PostgreSQL</option>
                            <option value="PostgreSQL|Google Cloud SQL">Google Cloud SQL</option>
                            <option value="PostgreSQL|Azure Database for PostgreSQL">Azure Database for PostgreSQL</option>
                            <option value="PostgreSQL|DigitalOcean Managed">DigitalOcean Managed</option>
                            <option value="PostgreSQL|Aiven">Aiven</option>
                            <option value="PostgreSQL|Railway">Railway</option>
                            <option value="PostgreSQL|Render">Render</option>
                            <option value="PostgreSQL|Self-hosted PostgreSQL">Self-hosted PostgreSQL</option>
                        </optgroup>
                        <optgroup label="MySQL">
                            <option value="MySQL|PlanetScale">PlanetScale</option>
                            <option value="MySQL|AWS RDS / Aurora MySQL">AWS RDS / Aurora MySQL</option>
                            <option value="MySQL|Google Cloud SQL">Google Cloud SQL</option>
                            <option value="MySQL|Azure Database for MySQL">Azure Database for MySQL</option>
                            <option value="MySQL|DigitalOcean Managed">DigitalOcean Managed</option>
                            <option value="MySQL|Aiven">Aiven</option>
                            <option value="MySQL|TiDB Cloud">TiDB Cloud</option>
                            <option value="MySQL|Self-hosted MySQL">Self-hosted MySQL</option>
                        </optgroup>
                        <optgroup label="MariaDB">
                            <option value="MariaDB|AWS RDS MariaDB">AWS RDS MariaDB</option>
                            <option value="MariaDB|SkySQL">SkySQL</option>
                            <option value="MariaDB|Self-hosted MariaDB">Self-hosted MariaDB</option>
                        </optgroup>
                        <optgroup label="MongoDB">
                            <option value="MongoDB|MongoDB Atlas">MongoDB Atlas</option>
                            <option value="MongoDB|DigitalOcean Managed">DigitalOcean Managed</option>
                            <option value="MongoDB|Self-hosted MongoDB">Self-hosted MongoDB</option>
                        </optgroup>
                        <optgroup label="Redis">
                            <option value="Redis|Upstash">Upstash</option>
                            <option value="Redis|Redis Cloud">Redis Cloud</option>
                            <option value="Redis|Aiven">Aiven</option>
                            <option value="Redis|Self-hosted Redis">Self-hosted Redis</option>
                        </optgroup>
                        <optgroup label="CockroachDB">
                            <option value="CockroachDB|CockroachDB Cloud">CockroachDB Cloud</option>
                            <option value="CockroachDB|Self-hosted CockroachDB">Self-hosted CockroachDB</option>
                        </optgroup>
                        <optgroup label="Turso / SQLite">
                            <option value="Turso / SQLite|Turso / libSQL">Turso / libSQL</option>
                        </optgroup>
                    </select>
                </div>
                <div class="space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <label for="new-db-uri" class="block text-xs font-medium text-slate-300">Connection string</label>
                        <span class="text-[10px] text-slate-500">Host must be publicly reachable</span>
                    </div>
                    <div class="relative">
                        <textarea rows="3" id="new-db-uri" autocomplete="off" spellcheck="false" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 pr-10 text-xs font-mono text-slate-200"></textarea>
                        <button type="button" id="btn-toggle-uri" title="Show or hide connection string" class="absolute top-2 right-2 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
                            <i data-lucide="eye" class="w-4 h-4 pointer-events-none"></i>
                        </button>
                    </div>
                    <p id="uri-hint" class="text-[11px] text-slate-500"></p>
                </div>
                <div class="space-y-2 border-t border-slate-800 pt-4">
                    <div class="flex items-center justify-between gap-2">
                        <p class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">2 · Backup plan</p>
                        <select id="plan-preset" aria-label="Plan presets" class="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 [color-scheme:dark] !w-auto">
                            <option value="">Presets...</option>
                            <option value="daily">Daily full backup</option>
                            <option value="weekly-incr">Weekly full + daily incremental</option>
                            <option value="daily-hourly">Daily full + hourly incremental</option>
                            <option value="weekly-diff">Weekly full + daily differential</option>
                            <option value="full-schema">Daily full + weekly schema-only</option>
                        </select>
                    </div>
                    <div id="plan-jobs" class="space-y-1.5"></div>
                    <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                        <p id="job-editor-title" class="text-xs font-medium text-slate-300">Add a backup job</p>
                        <div class="grid grid-cols-2 gap-2">
                            <select id="job-type" aria-label="Backup type" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 [color-scheme:dark]"></select>
                            <select id="job-retry" aria-label="Retries after a failure" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 [color-scheme:dark]">
                                <option value="0">No retries</option>
                                <option value="1">Retry up to 1 time</option>
                                <option value="2" selected>Retry up to 2 times</option>
                                <option value="3">Retry up to 3 times</option>
                                <option value="4">Retry up to 4 times</option>
                                <option value="5">Retry up to 5 times</option>
                            </select>
                        </div>
                        <p id="job-type-help" class="text-[11px] text-slate-500"></p>
                <div>
                    <label for="sched-type" class="block text-xs font-medium text-slate-300 mb-1">Schedule for this job</label>
                    <div class="grid grid-cols-2 gap-2">
                        <select id="sched-type" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 [color-scheme:dark]">
                            <option value="hourly">Every hour</option>
                            <option value="daily" selected>Every day</option>
                            <option value="weekly">Every week</option>
                            <option value="monthly">Every month</option>
                            <option value="once">One time (pick date and time)</option>
                        </select>
                        <select id="sched-tz" aria-label="Time zone" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 [color-scheme:dark]"></select>
                    </div>
                    <div class="grid grid-cols-2 gap-2 mt-2">
                        <div id="sched-minute-wrap" class="hidden">
                            <label for="sched-minute" class="block text-[11px] text-slate-400 mb-1">Minute past the hour</label>
                            <input type="number" id="sched-minute" min="0" max="59" value="0" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 [color-scheme:dark]">
                        </div>
                        <div id="sched-time-wrap">
                            <label for="sched-time" class="block text-[11px] text-slate-400 mb-1">Time</label>
                            <input type="time" id="sched-time" value="03:00" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 [color-scheme:dark]">
                        </div>
                        <div id="sched-weekday-wrap" class="hidden">
                            <label for="sched-weekday" class="block text-[11px] text-slate-400 mb-1">Day of the week</label>
                            <select id="sched-weekday" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 [color-scheme:dark]">
                                <option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option>
                            </select>
                        </div>
                        <div id="sched-day-wrap" class="hidden">
                            <label for="sched-day" class="block text-[11px] text-slate-400 mb-1">Day of the month</label>
                            <input type="number" id="sched-day" min="1" max="31" value="1" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 [color-scheme:dark]">
                        </div>
                        <div id="sched-once-wrap" class="hidden col-span-2">
                            <label for="sched-once" class="block text-[11px] text-slate-400 mb-1">Date and time</label>
                            <input type="datetime-local" id="sched-once" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 [color-scheme:dark]">
                        </div>
                    </div>
                    <p id="sched-preview" class="text-[11px] text-slate-400 mt-1"></p>
                    <p class="text-[11px] text-slate-500">Backups start within about 5 minutes of the chosen time. Months shorter than the chosen day use their last day.</p>
                </div>
                        <div class="flex gap-2">
                            <button id="btn-job-save" type="button" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-medium text-xs px-3 py-2 rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed">Add job to plan</button>
                            <button id="btn-job-cancel" type="button" class="hidden bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-medium text-xs px-3 py-2 rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed">Cancel edit</button>
                        </div>
                        <p id="job-error" class="text-[11px] text-red-400 hidden"></p>
                    </div>
                    <p class="text-[11px] text-slate-500">Failed scheduled runs are retried automatically (after 5, 15, 60, 120, 240 minutes). Incremental and differential backups save only the tables or collections whose data changed, and need a full backup as their base.</p>
                </div>
                <div class="border-t border-slate-800 pt-4">
                </div>
                <div class="db-section space-y-3">
                    <div class="db-section-head">
                        <p class="db-section-title">3 · Retention</p>
                    </div>
                    <label for="ret-mode" class="block text-xs font-medium text-slate-300 mb-1">How long backups stay in storage</label>
                    <div class="grid grid-cols-2 gap-2">
                        <select id="ret-mode" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 [color-scheme:dark]">
                            <option value="count" selected>Keep the last N backups</option>
                            <option value="days">Keep backups for N days</option>
                            <option value="forever">Keep everything (never delete)</option>
                        </select>
                        <div id="ret-count-wrap"><input type="number" id="ret-count" min="1" max="1000" value="30" aria-label="Number of backups to keep" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 [color-scheme:dark]"></div>
                        <div id="ret-days-wrap" class="hidden"><input type="number" id="ret-days" min="1" max="3650" value="30" aria-label="Number of days to keep backups" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 [color-scheme:dark]"></div>
                    </div>
                    <p class="text-[11px] text-slate-500 mt-1">Only backups created by this service are ever deleted. A full backup and the incrementals built on it are kept or deleted together, and the newest successful backup is always kept.</p>
                </div>
                <label id="runnow-wrap" class="flex items-start gap-2.5 text-xs text-slate-300 bg-slate-950/50 border border-slate-800 rounded-xl px-3 py-2.5 cursor-pointer hover:border-slate-700 transition"><input type="checkbox" id="run-now" checked class="rounded border-slate-700 bg-slate-950 mt-0.5"><span><span class="font-medium text-slate-200">Run first backup on save</span><span class="block text-[11px] text-slate-500 mt-0.5">Starts a full backup immediately after a successful save.</span></span></label>
                <p id="modal-error" class="text-xs text-red-400 hidden"></p>
                <p id="modal-info" class="text-xs text-emerald-400 hidden"></p>
                </div>
            </div>
            <div class="db-footer shrink-0 px-5 py-3.5 space-y-2.5">
                <p class="text-[11px] text-slate-500 leading-relaxed">Save unlocks after a successful connection test. Changing the URI or engine resets the test.</p>
                <div class="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
                    <button id="btn-cancel-modal" class="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-800 text-xs font-medium rounded-xl text-slate-300 border border-slate-700/80 transition">Cancel</button>
                    <button id="btn-test-db" class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold rounded-xl text-slate-100 flex items-center justify-center gap-1.5 transition">
                        <i data-lucide="plug-zap" class="w-3.5 h-3.5"></i> Test connection
                    </button>
                    <button id="btn-save-db" disabled class="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-xs font-semibold rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-brand-600 shadow-[0_0_20px_rgba(34,197,94,0.15)] transition">Save database</button>
                </div>
            </div>
        </div>
    </div>

    <script>
      document.addEventListener('DOMContentLoaded', function () {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !window.gsap) return;
        var g = window.gsap;
        var tl = g.timeline({repeat:-1, repeatDelay:.55});
        tl.to('.vb-demo-time',{textContent:'00:01',duration:.3})
          .to('.vb-source',{boxShadow:'0 0 26px rgba(52,211,153,.2)',borderColor:'rgba(52,211,153,.65)',duration:.35},0)
          .to('.vb-packet',{x:21,duration:.8,ease:'power1.inOut',stagger:.08},.15)
          .to('.vb-demo-progress-fill',{width:'42%',duration:.9,ease:'power1.out'},.15)
          .to('.vb-demo-time',{textContent:'00:02',duration:.3},1)
          .to('.vb-secure',{boxShadow:'0 0 28px rgba(45,212,191,.24)',borderColor:'rgba(45,212,191,.7)',duration:.35},1.1)
          .to('.vb-packet',{x:21,duration:.8,ease:'power1.inOut',stagger:.08},1.2)
          .to('.vb-demo-progress-fill',{width:'78%',duration:.8,ease:'power1.out'},1.2)
          .to('.vb-demo-time',{textContent:'00:03',duration:.3},2.1)
          .to('.vb-storage',{boxShadow:'0 0 28px rgba(52,211,153,.22)',borderColor:'rgba(52,211,153,.7)',duration:.35},2.2)
          .to('.vb-demo-progress-fill',{width:'100%',duration:.6,ease:'power1.out'},2.2)
          .to('.vb-demo-time',{textContent:'00:04',duration:.3},2.8)
          .to('.vb-demo-status b',{textContent:'Backup verified',duration:.2},2.8)
          .to('.vb-demo-progress-fill',{width:'0%',duration:.2},3.7)
          .to('.vb-demo-time',{textContent:'00:00',duration:.2},3.7)
          .set('.vb-demo-node',{boxShadow:'none',borderColor:'rgba(148,163,184,.2)'},3.9);
        g.from('.vb-brand-copy > *',{y:22,opacity:0,duration:.75,stagger:.12,ease:'power3.out',clearProps:'all'});
        g.from('.vb-brand-bottom',{y:12,opacity:0,duration:.6,ease:'power2.out',clearProps:'all'},.65);
      });
    </script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js" defer></script>
        <script>
        var TOKEN = null;
        try { TOKEN = localStorage.getItem('vb_token'); } catch (e) {}
        var ME = '';
        var databases = [];
        var backups = [];
        var HINTS = {
            'Auto': 'Paste any supported URL: postgresql://, mysql://, mariadb://, mongodb://, mongodb+srv://, redis://, rediss://, libsql://',
            'PostgreSQL': 'postgresql://user:password@host:5432/dbname?sslmode=require',
            'MySQL': 'mysql://user:password@host:3306/dbname (TLS on by default; add ?ssl-mode=DISABLED to turn it off)',
            'MariaDB': 'mysql://user:password@host:3306/dbname (TLS on by default; add ?ssl-mode=DISABLED to turn it off)',
            'MongoDB': 'mongodb+srv://user:password@cluster.mongodb.net/dbname or mongodb://user:password@host:27017/dbname?tls=true',
            'Redis': 'rediss://:password@host:6379/0 (use redis:// for a connection without TLS)',
            'CockroachDB': 'postgresql://user:password@host:26257/dbname?sslmode=verify-full',
            'Turso / SQLite': 'libsql://my-db-org.turso.io?authToken=YOUR_TOKEN'
        };
        var URI_PLACEHOLDERS = {
            'Auto': 'postgresql://user:pass@host:5432/dbname?sslmode=require',
            'PostgreSQL': 'postgresql://user:password@host:5432/dbname?sslmode=require',
            'MySQL': 'mysql://user:password@host:3306/dbname',
            'MariaDB': 'mysql://user:password@host:3306/dbname',
            'MongoDB': 'mongodb+srv://user:password@cluster.mongodb.net/dbname',
            'Redis': 'rediss://:password@host:6379/0',
            'CockroachDB': 'postgresql://user:password@host:26257/dbname?sslmode=verify-full',
            'Turso / SQLite': 'libsql://my-db-org.turso.io?authToken=YOUR_TOKEN'
        };

        function $(id) { return document.getElementById(id); }
        function esc(s) {
            return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
        var ICONS = {
            'check-circle-2': '<circle cx="12" cy="12" r="10" /> <path d="m16 9-5.5 5.5L8 12" />',
            'database': '<ellipse cx="12" cy="5" rx="9" ry="3" /> <path d="M3 5V19A9 3 0 0 0 21 19V5" /> <path d="M3 12A9 3 0 0 0 21 12" />',
            'download': '<path d="M12 15V3" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <path d="m7 10 5 5 5-5" />',
            'hard-drive': '<path d="M10 16h.01" /> <path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /> <path d="M21.946 12.013H2.054" /> <path d="M6 16h.01" />',
            'key-round': '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /> <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />',
            'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /> <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
            'log-out': '<path d="m16 17 5-5-5-5" /> <path d="M21 12H9" /> <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />',
            'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /> <path d="m15 5 4 4" />',
            'play': '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />',
            'plug-zap': '<path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" /> <path d="m2 22 3-3" /> <path d="M7.5 13.5 10 11" /> <path d="M10.5 16.5 13 14" /> <path d="m18 3-4 4h6l-4 4" />',
            'plus': '<path d="M5 12h14" /> <path d="M12 5v14" />',
            'save': '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /> <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /> <path d="M7 3v4a1 1 0 0 0 1 1h7" />',
            'server': '<rect width="20" height="8" x="2" y="2" rx="2" ry="2" /> <rect width="20" height="8" x="2" y="14" rx="2" ry="2" /> <line x1="6" x2="6.01" y1="6" y2="6" /> <line x1="6" x2="6.01" y1="18" y2="18" />',
            'shield-check': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /> <path d="m9 12 2 2 4-4" />',
            'trash-2': '<path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
            'x': '<path d="M18 6 6 18" /> <path d="m6 6 12 12" />',
            'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /> <circle cx="12" cy="12" r="3" />',
            'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /> <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /> <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-4.46" /> <path d="m2 2 20 20" />',
            'loader': '<path d="M21 12a9 9 0 1 1-6.219-8.56" />',
            'more-horizontal': '<circle cx="12" cy="12" r="1" /> <circle cx="19" cy="12" r="1" /> <circle cx="5" cy="12" r="1" />',
            'monitor': '<rect width="20" height="14" x="2" y="3" rx="2" /> <line x1="8" x2="16" y1="21" y2="21" /> <line x1="12" x2="12" y1="17" y2="21" />',
            'unlink': '<path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" /> <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" /> <line x1="8" x2="8" y1="2" y2="5" /> <line x1="2" x2="5" y1="8" y2="8" /> <line x1="16" x2="16" y1="19" y2="22" /> <line x1="19" x2="22" y1="16" y2="16" />'
        };
        function icons() {
            var nodes = document.querySelectorAll('i[data-lucide]');
            for (var i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                var inner = ICONS[el.getAttribute('data-lucide')];
                if (!inner) { continue; }
                var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'currentColor');
                svg.setAttribute('stroke-width', '2');
                svg.setAttribute('stroke-linecap', 'round');
                svg.setAttribute('stroke-linejoin', 'round');
                svg.setAttribute('aria-hidden', 'true');
                svg.setAttribute('class', el.getAttribute('class') || '');
                if (el.id) { svg.id = el.id; }
                svg.innerHTML = inner;
                el.parentNode.replaceChild(svg, el);
            }
        }
        function fmtSize(b) {
            if (!b) { return '-'; }
            if (b < 1024) { return b + ' B'; }
            if (b < 1048576) { return (b / 1024).toFixed(1) + ' KB'; }
            return (b / 1048576).toFixed(1) + ' MB';
        }
        function fmtDate(ms) { return ms ? new Date(ms).toLocaleString() : 'Never'; }

        async function api(path, method, body) {
            var headers = {};
            if (TOKEN) { headers['Authorization'] = 'Bearer ' + TOKEN; }
            if (body !== undefined) { headers['Content-Type'] = 'application/json'; }
            var res = await fetch(path, { method: method || 'GET', headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined });
            var data = null;
            try { data = await res.json(); } catch (e) {}
            if (res.status === 401 && path.indexOf('/api/auth/') !== 0) {
                showAuth('Session expired. Please sign in again.');
                throw new Error('Unauthorized');
            }
            if (!res.ok) { throw new Error((data && data.error) || ('Request failed (' + res.status + ')')); }
            return data || {};
        }

        /* ---------- toast ---------- */
        var toastTimer = null;
        function showToast(msg, isError) {
            var t = $('toast');
            $('toast-msg').textContent = msg;
            t.className = 'flex items-center justify-between border px-4 py-3 rounded-xl shadow-lg ' +
                (isError ? 'bg-red-950/90 border-red-800/60 text-red-200' : 'bg-emerald-950/90 border-emerald-800/60 text-emerald-200');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(hideToast, isError ? 9000 : 5000);
        }
        function hideToast() { $('toast').className = 'hidden'; }

        /* ---------- auth ---------- */
        var authMode = 'login';
        var resetToken = null;
        var HEALTH = { email: false };
        function setAuthError(msg) { $('auth-error').textContent = msg || ''; $('auth-info').textContent = ''; }
        function setAuthInfo(msg) { $('auth-info').textContent = msg || ''; $('auth-error').textContent = ''; }
        function setAuthMode(mode) {
            authMode = mode;
            var titles = {
                login: ['VaultBackup', 'Sign in to manage your backups'],
                forgot: ['Reset your password', 'We will email you a reset link'],
                reset: ['Choose a new password', 'Use at least 10 characters']
            };
            $('auth-title').textContent = titles[mode][0];
            $('auth-sub').textContent = titles[mode][1];
            $('auth-email-wrap').classList.toggle('hidden', mode === 'reset');
            $('auth-password-wrap').classList.toggle('hidden', mode === 'forgot');
            $('auth-confirm-wrap').classList.toggle('hidden', mode !== 'reset');
            $('auth-password-label').textContent = mode === 'reset' ? 'New password (10+ characters)' : 'Password (10+ characters)';
            $('auth-password').autocomplete = mode === 'reset' ? 'new-password' : 'current-password';
            $('auth-actions-login').classList.toggle('hidden', mode !== 'login');
            $('auth-actions-forgot').classList.toggle('hidden', mode !== 'forgot');
            $('auth-actions-reset').classList.toggle('hidden', mode !== 'reset');
            $('link-forgot').classList.toggle('hidden', mode !== 'login');
            $('link-back').classList.toggle('hidden', mode === 'login');
            $('auth-mail-note').classList.toggle('hidden', !(mode === 'forgot' && !HEALTH.email));
            setAuthError('');
        }
        function showAuth(msg) {
            clearInterval(tickTimer);
            tickTimer = null;
            if (window.agentPollTimer) { clearInterval(window.agentPollTimer); window.agentPollTimer = null; }
            TOKEN = null;
            try { localStorage.removeItem('vb_token'); } catch (e) {}
            $('app-view').classList.add('hidden');
            $('app-view').classList.remove('flex');
            $('auth-view').classList.remove('hidden');
            $('auth-view').classList.add('flex');
            setAuthMode(resetToken ? 'reset' : 'login');
            setAuthError(msg || '');
            icons();
        }
        function showApp() {
            $('auth-view').classList.add('hidden');
            $('auth-view').classList.remove('flex');
            $('app-view').classList.remove('hidden');
            $('app-view').classList.add('flex');
            $('user-email').textContent = ME;
            if (!window.healthTimer) { window.healthTimer = setInterval(loadHealth, 60000); }
            startTicker();
            loadStorage();
            refresh().then(function () { if (databases.some(function (d) { return d.status === 'Running'; })) { pollUntilIdle(40); } });
            icons();
        }
        function startSession(d) {
            TOKEN = d.token;
            ME = d.email;
            try { localStorage.setItem('vb_token', TOKEN); } catch (e) {}
            $('auth-password').value = '';
            $('auth-confirm').value = '';
            showApp();
        }
        async function submitAuth(mode) {
            setAuthError('');
            try {
                startSession(await api('/api/auth/' + mode, 'POST', { email: $('auth-email').value.trim(), password: $('auth-password').value }));
            } catch (e) { setAuthError(e.message); }
        }
        async function submitForgot() {
            setAuthError('');
            try {
                var d = await api('/api/auth/forgot', 'POST', { email: $('auth-email').value.trim() });
                setAuthInfo(d.message || 'If an account exists for that email, a reset link has been sent.');
            } catch (e) { setAuthError(e.message); }
        }
        async function submitReset() {
            var pw = $('auth-password').value;
            if (pw !== $('auth-confirm').value) { setAuthError('The passwords do not match.'); return; }
            try {
                var d = await api('/api/auth/reset', 'POST', { token: resetToken, password: pw });
                resetToken = null;
                startSession(d);
            } catch (e) { setAuthError(e.message); }
        }
        async function logout() {
            try { await api('/api/auth/logout', 'POST', {}); } catch (e) {}
            databases = []; backups = [];
            showAuth('');
        }

        /* ---------- change password ---------- */
        function pwError(msg) { var el = $('pw-error'); el.textContent = msg || ''; el.classList.toggle('hidden', !msg); }
        function openPwModal() {
            pwError('');
            $('pw-modal').classList.remove('hidden');
            $('pw-modal').classList.add('flex');
            $('pw-current').focus();
        }
        function closePwModal() {
            $('pw-modal').classList.add('hidden');
            $('pw-modal').classList.remove('flex');
            $('pw-current').value = '';
            $('pw-new').value = '';
            $('pw-confirm').value = '';
        }
        async function submitPwChange() {
            pwError('');
            if ($('pw-new').value !== $('pw-confirm').value) { pwError('The new passwords do not match.'); return; }
            try {
                var d = await api('/api/auth/change-password', 'POST', { currentPassword: $('pw-current').value, newPassword: $('pw-new').value });
                TOKEN = d.token;
                try { localStorage.setItem('vb_token', TOKEN); } catch (e) {}
                closePwModal();
                showToast('Password updated. Other devices were signed out.');
            } catch (e) { pwError(e.message); }
        }

        function openAgentModal() {
            $('agent-create-form').classList.remove('hidden');
            $('agent-token-result').classList.add('hidden');
            $('agent-name').value = '';
            $('agent-create-error').classList.add('hidden');
            $('agent-modal-title').textContent = 'Create agent token';
            $('agent-modal').classList.remove('hidden');
            $('agent-modal').classList.add('flex');
            $('agent-name').focus();
        }
        function closeAgentModal() {
            $('agent-modal').classList.add('hidden');
            $('agent-modal').classList.remove('flex');
        }
        async function createAgentToken() {
            var errEl = $('agent-create-error');
            errEl.classList.add('hidden');
            try {
                var d = await api('/api/agent/tokens', 'POST', { name: ($('agent-name').value || '').trim() || 'desktop-agent' });
                $('agent-create-form').classList.add('hidden');
                $('agent-token-result').classList.remove('hidden');
                $('agent-token-value').textContent = d.token;
                $('agent-modal-title').textContent = 'Token created';
                await refresh();
            } catch (e) {
                errEl.textContent = e.message;
                errEl.classList.remove('hidden');
            }
        }

        /* ---------- health ---------- */
        function ago(ms) {
            var sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
            if (sec < 90) { return sec + ' s ago'; }
            var min = Math.round(sec / 60);
            if (min < 90) { return min + ' min ago'; }
            var hr = Math.round(min / 60);
            if (hr < 48) { return hr + ' h ago'; }
            return Math.round(hr / 24) + ' days ago';
        }
        var tickTimer = null;
        async function tick() {
            try {
                var d = await api('/api/tick', 'POST', {});
                if (d.started > 0) { await refresh(); pollUntilIdle(40); }
            } catch (e) {}
        }
        function startTicker() {
            if (tickTimer) { return; }
            tick();
            tickTimer = setInterval(tick, 60000);
            if (!window.agentPollTimer) {
                window.agentPollTimer = setInterval(async function () {
                    if (!TOKEN) return;
                    try {
                        await loadAgents();
                        // Re-render only agent section without full refresh when possible
                        if (typeof render === 'function') render();
                    } catch (e) {}
                }, 15000);
            }
        }
        function updateSchedulerStatus() {
            var t = HEALTH.schedulerLastTickAt;
            var stale = !t || (Date.now() - t) > 15 * 60 * 1000;
            $('sched-dot').className = 'w-2 h-2 rounded-full ' + (stale ? 'bg-amber-500' : 'bg-emerald-500');
            $('sched-text').textContent = t ? 'Scheduler: ' + ago(t) : 'Scheduler: not started';
            var hasSchedule = databases.some(function (d) { return d.nextRunAt; });
            var banner = $('scheduler-banner');
            if (stale && hasSchedule) {
                $('scheduler-banner-title').textContent = t ? 'Automatic backups are not running in the background (scheduler last ran ' + ago(t) + ')' : 'Automatic backups are not running in the background yet (the scheduler has never run)';
                $('scheduler-banner-text').textContent = 'Cloudflare only runs the schedule when this Worker has a Cron Trigger. Until then, due backups still start while this page is open, but not when it is closed. Operator fix, pick one: add a Cron Trigger with */5 * * * * in the Cloudflare dashboard (Workers, Settings, Triggers); or call POST /api/admin/setup-scheduler once (needs CF_API_TOKEN, CF_ACCOUNT_ID, CF_WORKER_NAME and ADMIN_TOKEN); or ping GET /api/cron/tick every 5 minutes using CRON_SECRET.';
                banner.classList.remove('hidden');
            } else {
                banner.classList.add('hidden');
            }
        }
        async function loadHealth() {
            try {
                var r = await fetch('/api/health');
                var h = await r.json();
                HEALTH = h;
                var ok = h.kv && h.encryption;
                $('health-dot').className = 'w-2 h-2 rounded-full ' + (ok ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500');
                $('health-text').textContent = ok ? 'Worker: Active' : (!h.kv ? 'Setup needed: KV binding' : 'Setup needed: ENCRYPTION_KEY');
                if (!h.registration) { $('btn-register').classList.add('hidden'); }
                updateSchedulerStatus();
            } catch (e) {
                $('health-text').textContent = 'Unreachable';
            }
        }

        /* ---------- data loading / rendering ---------- */
        async function loadDatabases() {
            var d = await api('/api/databases');
            databases = d.databases || [];
        }
        async function loadBackups() {
            var d = await api('/api/backups');
            backups = d.backups || [];
        }
        var agents = [];
        var agentSub = null;
        async function loadAgents() {
            try {
                var d = await api('/api/agent/tokens');
                agents = d.agents || [];
            } catch (e) { agents = []; }
            try {
                var s = await api('/api/subscription');
                agentSub = s;
            } catch (e) { agentSub = null; }
        }
        async function refresh() {
            try {
                await Promise.all([loadDatabases(), loadBackups(), loadAgents()]);
                render();
            } catch (e) {
                if (e.message !== 'Unauthorized') { showToast(e.message, true); }
            }
        }
        function pollUntilIdle(tries) {
            setTimeout(async function () {
                await refresh();
                if (tries > 0 && databases.some(function (d) { return d.status === 'Running'; })) { pollUntilIdle(tries - 1); }
            }, 3000);
        }

        function statusBadge(status) {
            var cls = 'bg-slate-800 text-slate-300';
            if (status === 'Healthy' || status === 'Success') { cls = 'bg-emerald-500/15 text-emerald-300'; }
            else if (status === 'Failed') { cls = 'bg-red-500/15 text-red-300'; }
            else if (status === 'Running') { cls = 'bg-amber-500/15 text-amber-300'; }
            return '<span class="text-[10px] px-2 py-0.5 rounded ' + cls + '">' + esc(status) + '</span>';
        }

        function fmtShort(ms) { return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
        function fmtDur(ms) {
            if (!ms || ms < 1000) { return '<1 s'; }
            if (ms < 90000) { return Math.round(ms / 1000) + ' s'; }
            return Math.round(ms / 60000) + ' min';
        }
        function jobsHtml(db) {
            if (!db.jobs || !db.jobs.length) { return ''; }
            return '<div class="mt-2 space-y-1">' + db.jobs.map(function (j) {
                var dot = j.lastStatus === 'Success' ? 'bg-emerald-500' : (j.lastStatus === 'Failed' ? 'bg-red-500' : 'bg-slate-600');
                var next = j.enabled === false ? 'Paused' : (j.retryAt ? 'Retry ' + j.retryAttempt + ' at ' + fmtShort(j.retryAt) : (j.nextRunAt ? 'Next ' + fmtShort(j.nextRunAt) : 'No upcoming run'));
                return '<div class="flex items-center justify-between gap-2 text-[11px]">' +
                    '<div class="flex flex-wrap items-center gap-2 min-w-0"><span class="w-2 h-2 rounded-full ' + dot + '"></span>' + typeBadge(j.type) +
                    '<span class="text-slate-300">' + esc(j.scheduleText) + '</span><span class="text-slate-500">' + esc(next) + '</span></div>' +
                    '<div class="flex gap-1 shrink-0">' +
                    '<button data-action="run-job" data-id="' + esc(db.id) + '" data-job="' + esc(j.id) + '" title="Run this job now" class="text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-2 py-0.5 rounded">Run</button>' +
                    '<button data-action="toggle-job" data-id="' + esc(db.id) + '" data-job="' + esc(j.id) + '" class="text-slate-400 hover:text-white px-2 py-0.5 rounded">' + (j.enabled === false ? 'Resume' : 'Pause') + '</button></div></div>';
            }).join('') + '</div>';
        }
        function nextRunLabel(db) {
            if (db.nextRunAt) { return 'Next backup: ' + new Date(db.nextRunAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
            if (db.schedule && db.schedule.type === 'once') { return 'One-time backup completed'; }
            return 'No upcoming backup';
        }
        function render() {
            $('stat-db-count').textContent = databases.length;
            var lastOk = null;
            for (var i = 0; i < backups.length; i++) {
                if (backups[i].status === 'Success') { lastOk = backups[i]; break; }
            }
            $('stat-last-backup').textContent = lastOk ? fmtDate(lastOk.finishedAt) : 'Never';
            var soon = null;
            databases.forEach(function (d) { if (d.nextRunAt && (soon === null || d.nextRunAt < soon)) { soon = d.nextRunAt; } });
            var schedStale = !HEALTH.schedulerLastTickAt || (Date.now() - HEALTH.schedulerLastTickAt) > 15 * 60 * 1000;
            if (soon && schedStale) {
                $('stat-next').textContent = 'Scheduled, but background scheduler is inactive';
                $('stat-next').className = 'text-xs text-amber-300 mt-auto pt-1';
            } else if (soon) {
                $('stat-next').textContent = 'Next: ' + new Date(soon).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                $('stat-next').className = 'text-xs text-emerald-400 mt-auto pt-1';
            } else {
                $('stat-next').textContent = 'No backups scheduled';
                $('stat-next').className = 'text-xs text-slate-400 mt-auto pt-1';
            }
            updateSchedulerStatus();

            var dbBox = $('db-list-container');
            if (databases.length === 0) {
                dbBox.innerHTML = '<div class="text-xs text-slate-500 text-center py-6">No databases connected yet. Select "Add Database" to start.</div>';
            } else {
                dbBox.innerHTML = databases.map(function (db) {
                    var running = db.status === 'Running';
                    return '<div class="bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-center justify-between gap-3">' +
                        '<div class="flex items-center space-x-3 min-w-0">' +
                        '<div class="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-lg"><i data-lucide="server" class="w-5 h-5"></i></div>' +
                        '<div class="min-w-0">' +
                        '<div class="flex flex-wrap items-center gap-2">' +
                        '<h4 class="text-sm font-semibold text-white truncate">' + esc(db.name) + '</h4>' +
                        '<span class="text-[10px] bg-slate-800 text-brand-400 px-2 py-0.5 rounded font-mono">' + esc(db.service ? db.service + ' / ' + db.provider : db.provider) + '</span>' +
                        statusBadge(db.status) + (db.failStreak > 0 ? '<span class="text-[10px] bg-red-500/15 text-red-300 px-2 py-0.5 rounded">' + esc(db.failStreak) + ' failed in a row</span>' : '') + '</div>' +
                        '<p class="text-xs text-slate-500 mt-0.5">Last backup: ' + esc(fmtDate(db.lastBackupAt)) + ' (' + esc(fmtSize(db.lastSize)) + ')</p>' +
                        '<p class="text-xs text-slate-400 mt-0.5">' + esc(nextRunLabel(db)) + '</p>' +
                        (db.maskedUri ? '<p class="text-[11px] font-mono text-slate-500 mt-0.5 break-all">' + esc(db.maskedUri) + '</p>' : '') +
                        '<p class="text-[11px] text-slate-500 mt-0.5">' + esc(db.retentionText || '') + '</p>' +
                        jobsHtml(db) +
                        (db.lastError ? '<p class="text-xs text-red-400 mt-0.5 break-words">' + esc(db.lastError) + '</p>' : '') +
                        '</div></div>' +
                        '<div class="flex items-center gap-2 shrink-0">' +
                        '<button data-action="run" data-id="' + esc(db.id) + '"' + (running ? ' disabled' : '') + ' title="Run a full backup now" aria-label="Run a full backup now" class="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-slate-300 transition disabled:opacity-40"><i data-lucide="play" class="w-4 h-4 pointer-events-none"></i></button>' +
                        '<button data-action="edit-db" data-id="' + esc(db.id) + '" title="Edit connection and schedule" aria-label="Edit database" class="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-slate-300 transition"><i data-lucide="pencil" class="w-4 h-4 pointer-events-none"></i></button>' +
                        '<button data-action="delete-db" data-id="' + esc(db.id) + '" data-name="' + esc(db.name) + '" title="Remove database" aria-label="Remove database" class="p-2 bg-slate-900 hover:bg-red-950 border border-slate-700 rounded-lg text-slate-300 transition"><i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i></button>' +
                        '</div></div>';
                }).join('');
            }

            var seatsEl = $('agent-seats');
            if (seatsEl) {
                if (agentSub && agentSub.subscription) {
                    var used = agentSub.agentsUsed != null ? agentSub.agentsUsed : agents.length;
                    var seats = agentSub.subscription.agentSeats || 0;
                    var rem = agentSub.agentsRemaining != null ? agentSub.agentsRemaining : Math.max(0, seats - used);
                    seatsEl.textContent = 'Plan: ' + (agentSub.subscription.planName || agentSub.subscription.name || '—') +
                        ' · ' + used + ' of ' + seats + ' seats used' + (rem > 0 ? ' (' + rem + ' remaining)' : ' (full)');
                } else {
                    seatsEl.textContent = '';
                }
            }
            var agentBox = $('agent-list-container');
            if (agentBox) {
                if (agents.length === 0) {
                    agentBox.innerHTML = '<div class="text-xs text-slate-500 text-center py-6">No desktop agents yet. Create a token, then <a href=\'/install\' class=\'text-brand-400 hover:text-brand-300\'>download and install</a> the agent (token only — server URL is built in).</div>';
                } else {
                    agentBox.innerHTML = agents.map(function (a) {
                        var st = a.status || {};
                        var reportedAt = st.reportedAt || a.lastSeenAt;
                        var liveMs = 3 * 60 * 1000;
                        var recentMs = 72 * 3600 * 1000;
                        var age = reportedAt ? (Date.now() - reportedAt) : null;
                        var live = age != null && age < liveMs;
                        var online = age != null && age < recentMs;
                        var badge = live
                            ? '<span class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 animate-pulse">Live</span>'
                            : (online
                                ? '<span class="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300">Idle</span>'
                                : '<span class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400">Offline</span>');
                        var seen = reportedAt ? ago(reportedAt) : 'Never';
                        var osLine = [st.os, st.osVersion, st.arch].filter(Boolean).join(' · ') || (a.boundDevice || 'Unbound');
                        var host = st.hostname ? esc(st.hostname) : '';
                        function bar(pct, color) {
                            if (pct == null || isNaN(pct)) return '<span class="text-slate-500">—</span>';
                            var p = Math.max(0, Math.min(100, Math.round(pct)));
                            var c = color || (p >= 90 ? 'bg-red-500' : (p >= 75 ? 'bg-amber-500' : 'bg-emerald-500'));
                            return '<div class="flex items-center gap-2 min-w-[7rem]"><div class="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden"><div class="' + c + ' h-full rounded-full" style="width:' + p + '%"></div></div><span class="text-[10px] text-slate-300 w-8 text-right">' + p + '%</span></div>';
                        }
                        var cpu = st.cpuPercent;
                        var memPct = (st.memUsedMb != null && st.memTotalMb > 0) ? (100 * st.memUsedMb / st.memTotalMb) : null;
                        var memLabel = (st.memUsedMb != null && st.memTotalMb != null)
                            ? (Math.round(st.memUsedMb) + '/' + Math.round(st.memTotalMb) + ' MB')
                            : '';
                        var dbs = Array.isArray(st.dbs) ? st.dbs : [];
                        var dbsHtml = dbs.length
                            ? '<div class="mt-2 flex flex-wrap gap-1.5">' + dbs.map(function (d) {
                                var ok = String(d.status || '').toLowerCase();
                                var cls = (ok === 'ok' || ok === 'healthy' || ok === 'up') ? 'bg-emerald-500/15 text-emerald-300 border-emerald-800/50'
                                    : (ok === 'error' || ok === 'down' || ok === 'failed') ? 'bg-red-500/15 text-red-300 border-red-800/50'
                                    : 'bg-slate-800 text-slate-300 border-slate-700';
                                return '<span class="text-[10px] px-2 py-0.5 rounded border ' + cls + '">' + esc(d.name || 'db') + (d.engine ? ' · ' + esc(d.engine) : '') + (d.status ? ' · ' + esc(d.status) : '') + '</span>';
                            }).join('') + '</div>'
                            : '';
                        var metrics = (cpu != null || memPct != null || st.os)
                            ? '<div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">' +
                              '<div class="flex items-center justify-between gap-2"><span class="text-slate-500">CPU</span>' + bar(cpu) + '</div>' +
                              '<div class="flex items-center justify-between gap-2"><span class="text-slate-500">RAM</span>' + bar(memPct) + '</div>' +
                              (memLabel ? '<div class="text-slate-500 sm:col-span-2">Memory ' + esc(memLabel) + (st.cpuCores ? ' · ' + st.cpuCores + ' cores' : '') + '</div>' : '') +
                              '</div>'
                            : '';
                        return '<div class="bg-slate-950 border border-slate-800 rounded-xl p-4">' +
                            '<div class="flex items-start justify-between gap-3">' +
                            '<div class="flex items-start space-x-3 min-w-0">' +
                            '<div class="p-2.5 bg-violet-500/15 text-violet-300 rounded-lg shrink-0"><i data-lucide="monitor" class="w-5 h-5"></i></div>' +
                            '<div class="min-w-0">' +
                            '<div class="flex flex-wrap items-center gap-2">' +
                            '<h4 class="text-sm font-semibold text-white truncate">' + esc(a.name || a.id) + '</h4>' + badge +
                            '</div>' +
                            '<p class="text-xs text-slate-400 mt-0.5">' + (host ? '<span class="text-slate-300">' + host + '</span> · ' : '') + esc(osLine) + '</p>' +
                            '<p class="text-[11px] text-slate-500 mt-0.5">Last report: ' + esc(seen) + (st.agentVersion ? ' · agent ' + esc(st.agentVersion) : '') + '</p>' +
                            metrics + dbsHtml +
                            '<p class="text-[11px] font-mono text-slate-600 mt-2">' + esc(a.id) + '</p>' +
                            '</div></div>' +
                            '<div class="flex items-center gap-2 shrink-0">' +
                            '<button data-action="unbind-agent" data-id="' + esc(a.id) + '" title="Unbind device" class="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-slate-300 transition"><i data-lucide="unlink" class="w-4 h-4 pointer-events-none"></i></button>' +
                            '<button data-action="revoke-agent" data-id="' + esc(a.id) + '" data-name="' + esc(a.name || a.id) + '" title="Revoke token" class="p-2 bg-slate-900 hover:bg-red-950 border border-slate-700 rounded-lg text-slate-300 transition"><i data-lucide="trash-2" class="w-4 h-4 pointer-events-none"></i></button>' +
                            '</div></div></div>';
                    }).join('');
                }
            }

            renderHistory();
            icons();
        }

        var histPage = 0;
        var HIST_PAGE_SIZE = 15;
        function filteredBackups() {
            var q = ($('hist-filter-q') && $('hist-filter-q').value || '').trim().toLowerCase();
            var st = $('hist-filter-status') ? $('hist-filter-status').value : '';
            var db = $('hist-filter-db') ? $('hist-filter-db').value : '';
            return backups.filter(function (b) {
                if (st && b.status !== st) return false;
                if (db && b.dbName !== db) return false;
                if (q && String(b.dbName || '').toLowerCase().indexOf(q) < 0 && String(b.jobName || '').toLowerCase().indexOf(q) < 0 && String(b.provider || '').toLowerCase().indexOf(q) < 0) return false;
                return true;
            });
        }
        function syncHistDbFilter() {
            var sel = $('hist-filter-db');
            if (!sel) return;
            var cur = sel.value;
            var names = [];
            backups.forEach(function (b) { if (b.dbName && names.indexOf(b.dbName) < 0) names.push(b.dbName); });
            names.sort();
            sel.innerHTML = '<option value="">All databases</option>' + names.map(function (n) {
                return '<option value="' + esc(n) + '"' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>';
            }).join('');
        }
        function renderHistory() {
            var logBox = $('logs-table-body');
            var list = filteredBackups();
            var pager = $('hist-pager');
            var totalPages = Math.max(1, Math.ceil(list.length / HIST_PAGE_SIZE));
            if (histPage >= totalPages) histPage = totalPages - 1;
            if (histPage < 0) histPage = 0;
            var slice = list.slice(histPage * HIST_PAGE_SIZE, (histPage + 1) * HIST_PAGE_SIZE);
            if (list.length === 0) {
                logBox.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-slate-500">' + (backups.length ? 'No backups match these filters.' : 'No backup history yet.') + '</td></tr>';
                if (pager) pager.classList.add('hidden');
            } else {
                logBox.innerHTML = slice.map(function (b) {
                    var nm = esc(b.dbName + '-' + (b.type || 'full'));
                    var tip = [b.jobName || 'Manual', b.provider, b.bucket ? '→ ' + b.bucket : ''].filter(Boolean).join(' · ');
                    var actions = '';
                    if (b.status === 'Success') {
                        actions += '<button data-action="download" data-id="' + esc(b.id) + '" data-name="' + nm + '" data-ext="' + esc(b.ext || 'sql.gz') + '" title="Download" aria-label="Download" class="p-1.5 rounded-lg text-brand-400 hover:bg-brand-500/15 transition"><i data-lucide="download" class="w-3.5 h-3.5 pointer-events-none"></i></button>';
                        actions += '<button data-action="link" data-id="' + esc(b.id) + '" title="Copy 15-minute link" aria-label="Copy link" class="p-1.5 rounded-lg text-slate-300 hover:bg-slate-800 transition"><i data-lucide="link" class="w-3.5 h-3.5 pointer-events-none"></i></button>';
                    }
                    actions += '<button data-action="details" data-id="' + esc(b.id) + '" title="Details" aria-label="Details" class="p-1.5 rounded-lg text-slate-300 hover:bg-slate-800 transition"><i data-lucide="more-horizontal" class="w-3.5 h-3.5 pointer-events-none"></i></button>';
                    actions += '<button data-action="delete-backup" data-id="' + esc(b.id) + '" title="Delete" aria-label="Delete backup" class="p-1.5 rounded-lg text-slate-400 hover:text-red-300 hover:bg-red-950/40 transition"><i data-lucide="trash-2" class="w-3.5 h-3.5 pointer-events-none"></i></button>';
                    return '<tr class="hover:bg-slate-950/40 transition">' +
                        '<td class="py-2.5 px-3 font-medium text-white"><span title="' + esc(tip) + '">' + esc(b.dbName) + '</span><div class="text-[10px] text-slate-500 font-normal truncate max-w-[12rem]" title="' + esc(tip) + '">' + esc(b.jobName || 'Manual') + ' · ' + esc(b.provider) + '</div></td>' +
                        '<td class="py-2.5 px-3">' + typeBadge(b.type) + (b.promoted ? '<div class="text-[10px] text-amber-300">was ' + esc(b.requestedType) + '</div>' : '') + '</td>' +
                        '<td class="py-2.5 px-3 text-slate-400 whitespace-nowrap">' + esc(fmtDate(b.startedAt)) + '</td>' +
                        '<td class="py-2.5 px-3 text-slate-400">' + esc(fmtDur(b.durationMs)) + '</td>' +
                        '<td class="py-2.5 px-3 text-slate-400">' + esc(fmtSize(b.size)) + '</td>' +
                        '<td class="py-2.5 px-3" title="' + esc(b.error || '') + '">' + statusBadge(b.status) + '</td>' +
                        '<td class="py-2.5 px-3 text-right"><div class="inline-flex items-center gap-0.5">' + actions + '</div></td></tr>';
                }).join('');
                if (pager) {
                    if (list.length > HIST_PAGE_SIZE) {
                        pager.classList.remove('hidden');
                        pager.classList.add('flex');
                        $('hist-page-label').textContent = 'Page ' + (histPage + 1) + ' of ' + totalPages + ' · ' + list.length + ' backups';
                        $('hist-prev').disabled = histPage === 0;
                        $('hist-next').disabled = histPage >= totalPages - 1;
                    } else {
                        pager.classList.add('hidden');
                        pager.classList.remove('flex');
                    }
                }
            }
            syncHistDbFilter();
        }

        /* ---------- row actions (event delegation) ---------- */
        async function onListClick(ev) {
            var btn = ev.target.closest('button[data-action]');
            if (!btn || btn.disabled) { return; }
            var action = btn.getAttribute('data-action');
            var id = btn.getAttribute('data-id');
            try {
                if (action === 'run') { await runBackup(id, btn); }
                else if (action === 'run-job') { await runJob(id, btn.getAttribute('data-job')); }
                else if (action === 'toggle-job') { await toggleJob(id, btn.getAttribute('data-job')); }
                else if (action === 'details') { await openLogDetails(id); }
                else if (action === 'verify') { await verifyBackup(id); }
                else if (action === 'edit-db') { openEdit(id); }
                else if (action === 'delete-db') {
                    if (!confirm('Remove "' + btn.getAttribute('data-name') + '"? Existing backups are kept.')) { return; }
                    await api('/api/database/' + encodeURIComponent(id), 'DELETE');
                    showToast('Database removed.');
                    await refresh();
                }
                else if (action === 'download') { await downloadBackup(id, btn.getAttribute('data-name'), btn.getAttribute('data-ext')); }
                else if (action === 'link') { await copyLink(id); }
                else if (action === 'delete-backup') {
                    if (!confirm('Delete this backup permanently?')) { return; }
                    try {
                        await api('/api/backups/' + encodeURIComponent(id), 'DELETE');
                    } catch (e) {
                        if (/depend/.test(e.message) && confirm(e.message + ' Delete the whole chain (this backup and everything built on it)?')) {
                            await api('/api/backups/' + encodeURIComponent(id) + '?force=1', 'DELETE');
                        } else { throw e; }
                    }
                    showToast('Backup deleted.');
                    closeLogModal();
                    await refresh();
                }
                else if (action === 'unbind-agent') {
                    if (!confirm('Unbind this agent from its current device? The next license check on any machine will bind it again.')) { return; }
                    await api('/api/agent/' + encodeURIComponent(id) + '/unbind', 'POST');
                    showToast('Device unbound.');
                    await refresh();
                }
                else if (action === 'revoke-agent') {
                    if (!confirm('Revoke token for "' + (btn.getAttribute('data-name') || id) + '"? The agent will stop being able to check license.')) { return; }
                    await api('/api/agent/tokens/' + encodeURIComponent(id), 'DELETE');
                    showToast('Agent token revoked.');
                    await refresh();
                }
            } catch (e) {
                if (e.message !== 'Unauthorized') { showToast(e.message, true); }
            }
        }

        async function runJob(id, jobId) {
            await api('/api/trigger-backup', 'POST', { dbId: id, jobId: jobId });
            showToast('Backup job started.');
            await refresh();
            pollUntilIdle(40);
        }
        async function toggleJob(id, jobId) {
            var db = null;
            for (var i = 0; i < databases.length; i++) { if (databases[i].id === id) { db = databases[i]; } }
            if (!db) { return; }
            var jobs = db.jobs.map(function (j) { return { id: j.id, name: j.name, type: j.type, schedule: j.schedule, enabled: j.id === jobId ? j.enabled === false : j.enabled !== false, retry: j.retry }; });
            await api('/api/database/' + encodeURIComponent(id), 'PUT', { jobs: jobs });
            await refresh();
        }

        /* ---------- job log details ---------- */
        function closeLogModal() {
            $('log-modal').classList.add('hidden');
            $('log-modal').classList.remove('flex');
        }
        function kv(label, value) { return '<div><div class="text-[10px] uppercase tracking-wider text-slate-500">' + esc(label) + '</div><div class="text-slate-200 break-words">' + esc(value) + '</div></div>'; }
        async function openLogDetails(id) {
            var d = await api('/api/backups/' + encodeURIComponent(id));
            var b = d.backup;
            $('log-title').textContent = (b.typeLabel || TYPE_LABEL[b.type] || b.type) + ' backup of ' + b.dbName;
            var h = '<div class="flex flex-wrap items-center gap-2">' + typeBadge(b.type) + statusBadge(b.status) + '<span class="text-slate-500">job: ' + esc(b.jobName || '-') + ' / started by ' + esc(b.trigger) + '</span></div>';
            if (b.promoted) { h += '<div class="rounded-lg border border-amber-700/60 bg-amber-950/40 text-amber-200 px-3 py-2">' + esc('Requested ' + b.requestedType + '. ' + b.promoted) + '</div>'; }
            if (b.error) { h += '<div class="rounded-lg border border-red-800/60 bg-red-950/40 text-red-200 px-3 py-2 break-words">' + esc(b.error) + '</div>'; }
            h += '<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">' + kv('Started', fmtDate(b.startedAt)) + kv('Took', fmtDur(b.durationMs)) + kv('Stored size', fmtSize(b.size)) +
                kv('Uncompressed', fmtSize(b.rawBytes)) + kv('Storage', b.bucket || '-') + kv('Checksum (sha256)', b.checksum || '-') + '</div>';
            if (b.tables && b.tables.total !== undefined) {
                h += '<div><div class="font-medium text-slate-200 mb-1">Included: ' + esc(b.tables.included) + ' of ' + esc(b.tables.total) + ' tables or collections</div>';
                if (b.tables.detail && b.tables.detail.length) {
                    h += '<div class="max-h-40 overflow-y-auto rounded-lg border border-slate-800"><table class="w-full text-left"><tbody>' + b.tables.detail.map(function (t) {
                        return '<tr class="border-t border-slate-800/60 first:border-0"><td class="py-1.5 px-3 text-slate-200 break-all">' + esc(t.name) + '</td><td class="py-1.5 px-3 text-slate-400 text-right">' + esc(t.rows) + ' rows</td></tr>';
                    }).join('') + '</tbody></table></div>';
                }
                h += '</div>';
            }
            if (d.chain && d.chain.length) {
                h += '<div><div class="font-medium text-slate-200 mb-1">To restore this point, apply in this order' + (d.chainComplete ? '' : ' (chain incomplete: an earlier backup is missing)') + '</div><div class="space-y-1">' + d.chain.map(function (c, i) {
                    return '<div class="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5"><span>' + (i + 1) + '. ' + typeBadge(c.type) + ' ' + esc(fmtDate(c.finishedAt || c.startedAt)) + '</span>' +
                        '<button data-action="download" data-id="' + esc(c.id) + '" data-name="' + esc(c.dbName + '-' + c.type) + '" data-ext="' + esc(c.ext || 'sql.gz') + '" class="text-brand-400 hover:text-brand-300">Download</button></div>';
                }).join('') + '</div>' + (d.restoreHint ? '<pre class="mt-2 whitespace-pre-wrap rounded-lg bg-slate-950 border border-slate-800 p-3 text-[11px] text-slate-300">' + esc(d.restoreHint) + '</pre>' : '') + '</div>';
            }
            h += '<div><div class="font-medium text-slate-200 mb-1">Job log</div><div class="max-h-56 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-1 font-mono text-[11px]">' + (d.steps || []).map(function (s) {
                var cls = s.l === 'error' ? 'text-red-300' : (s.l === 'warn' ? 'text-amber-300' : 'text-slate-300');
                return '<div class="' + cls + '"><span class="text-slate-500">+' + (s.t / 1000).toFixed(1) + 's</span> ' + esc(s.m) + '</div>';
            }).join('') + '</div></div>';
            h += '<div class="flex flex-wrap items-center gap-2">' + (b.status === 'Success' ? '<button data-action="verify" data-id="' + esc(b.id) + '" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-medium text-xs px-3 py-2 rounded-xl">Verify stored file</button>' : '') + '<span id="verify-result" class="text-slate-400"></span></div>';
            $('log-body').innerHTML = h;
            $('log-modal').classList.remove('hidden');
            $('log-modal').classList.add('flex');
            icons();
        }
        async function verifyBackup(id) {
            var el = $('verify-result');
            if (el) { el.className = 'text-slate-400'; el.textContent = 'Checking...'; }
            var d = await api('/api/backups/' + encodeURIComponent(id) + '/verify', 'POST', {});
            if (el) {
                el.className = d.ok ? 'text-emerald-300' : 'text-red-300';
                el.textContent = d.ok ? 'Verified: the file is present, matches its checksum, decrypts and decompresses correctly.' : (d.problem || 'The stored file did not pass verification.');
            }
        }
        async function runBackup(id, btn) {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 animate-spin pointer-events-none"></i>';
                icons();
            }
            try {
                await api('/api/trigger-backup', 'POST', { dbId: id });
                showToast('Backup started.');
                await refresh();
                pollUntilIdle(40);
            } catch (e) {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i data-lucide="play" class="w-4 h-4 pointer-events-none"></i>';
                    icons();
                }
                throw e;
            }
        }

        async function downloadBackup(id, name, ext) {
            showToast('Preparing download...');
            var res = await fetch('/api/backups/' + encodeURIComponent(id) + '/download', { headers: { 'Authorization': 'Bearer ' + TOKEN } });
            if (!res.ok) {
                var msg = 'Download failed (' + res.status + ')';
                try { var j = await res.json(); if (j.error) { msg = j.error; } } catch (e) {}
                throw new Error(msg);
            }
            var blob = await res.blob();
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = String(name || 'backup').replace(/[^a-zA-Z0-9._-]+/g, '_') + '.' + (ext || 'sql.gz');
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 10000);
            hideToast();
        }

        async function copyLink(id) {
            var d = await api('/api/backups/' + encodeURIComponent(id) + '/link');
            try {
                await navigator.clipboard.writeText(d.downloadUrl);
                showToast('15-minute link to the encrypted file copied.');
            } catch (e) {
                prompt('15-minute link to the encrypted file:', d.downloadUrl);
            }
        }

        /* ---------- add database modal ---------- */
        function setBusy(id, busy, label) {
            var b = $(id);
            if (busy) {
                b.setAttribute('data-label', b.innerHTML);
                b.disabled = true;
                b.textContent = label;
            } else {
                b.disabled = false;
                if (b.getAttribute('data-label')) { b.innerHTML = b.getAttribute('data-label'); b.removeAttribute('data-label'); icons(); }
            }
        }
        function parseProv() {
            var v = $('new-db-provider').value.split('|');
            return { engine: v[0], service: v[1] || '' };
        }
        function updateHint() {
            var eng = parseProv().engine;
            $('uri-hint').textContent = HINTS[eng] || '';
            var ta = $('new-db-uri');
            if (ta && !editingDbId) { ta.placeholder = URI_PLACEHOLDERS[eng] || ''; }
            if (typeof refreshJobTypes === 'function') { refreshJobTypes(); updatePresetOptions(); }
            highlightProviderChip();
        }
        function setConnStatus(state, msg) {
            var el = $('conn-status');
            if (!el) return;
            var map = {
                idle: ['bg-slate-800 text-slate-400 border border-slate-700', 'Not tested'],
                testing: ['bg-amber-500/15 text-amber-300 border border-amber-700/50', 'Testing…'],
                ok: ['bg-emerald-500/15 text-emerald-300 border border-emerald-700/50', 'Connected'],
                fail: ['bg-red-500/15 text-red-300 border border-red-700/50', 'Failed'],
                saved: ['bg-sky-500/15 text-sky-300 border border-sky-700/50', 'Saved connection']
            };
            var m = map[state] || map.idle;
            el.className = 'text-[10px] px-2 py-0.5 rounded-full ' + m[0];
            el.textContent = msg || m[1];
        }
        function highlightProviderChip() {
            var val = $('new-db-provider') ? $('new-db-provider').value : '';
            var chips = document.querySelectorAll('.provider-chip');
            for (var i = 0; i < chips.length; i++) {
                var on = chips[i].getAttribute('data-chip') === val;
                chips[i].className = 'provider-chip text-[11px] px-2.5 py-1 rounded-lg border transition ' +
                    (on ? 'border-brand-500/60 bg-brand-500/15 text-brand-400' : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50 hover:text-brand-400');
            }
        }
        function modalMsg(kind, msg) {
            var e = $('modal-error'), i = $('modal-info');
            e.classList.add('hidden'); i.classList.add('hidden');
            if (!msg) { return; }
            var el = kind === 'error' ? e : i;
            el.textContent = msg;
            el.classList.remove('hidden');
        }
        var dbTestedKey = null;
        var editingDbId = null;
        function dbUri() { return $('new-db-uri').value.trim(); }
        var editOriginalUri = '';
        var editingDb = null;
        var ALL_TYPES = ['full', 'incremental', 'differential', 'schema'];
        var ENGINE_TYPES = {
            'PostgreSQL': ALL_TYPES, 'MySQL': ALL_TYPES, 'MariaDB': ALL_TYPES, 'MongoDB': ALL_TYPES,
            'CockroachDB': ['full', 'schema'], 'Turso / SQLite': ['full', 'schema'], 'Redis': ['full'], 'Auto': ALL_TYPES
        };
        var TYPE_LABEL = { full: 'Full', incremental: 'Incremental', differential: 'Differential', schema: 'Schema only' };
        var TYPE_HELP = {
            full: 'Everything in the database. The base for incremental and differential backups.',
            incremental: 'Only tables or collections whose data changed since the previous backup. Restore: the full backup, then each incremental in order.',
            differential: 'Everything that changed since the last full backup. Restore: the full backup, then the latest differential.',
            schema: 'Table structure only (no data). Small and fast, useful as a frequent safety copy of the schema.'
        };
        var TYPE_CLASS = {
            full: 'bg-emerald-500/15 text-emerald-300', incremental: 'bg-sky-500/15 text-sky-300',
            differential: 'bg-violet-500/15 text-violet-300', schema: 'bg-amber-500/15 text-amber-300'
        };
        var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        var planJobs = [];
        var editingJobIdx = -1;
        function typeBadge(t) { return '<span class="text-[10px] px-2 py-0.5 rounded ' + (TYPE_CLASS[t] || TYPE_CLASS.full) + '">' + esc(TYPE_LABEL[t] || t) + '</span>'; }
        function schedTextClient(sc) {
            function p2(n) { return (n < 10 ? '0' : '') + n; }
            if (sc.type === 'hourly') { return 'Every hour at :' + p2(sc.minute) + ' (' + sc.tz + ')'; }
            if (sc.type === 'daily') { return 'Every day at ' + sc.time + ' (' + sc.tz + ')'; }
            if (sc.type === 'weekly') { return 'Every ' + WEEKDAYS[sc.weekday] + ' at ' + sc.time + ' (' + sc.tz + ')'; }
            if (sc.type === 'monthly') { return 'Monthly on day ' + sc.day + ' at ' + sc.time + ' (' + sc.tz + ')'; }
            return 'Once on ' + String(sc.runAtLocal || '').replace('T', ' ') + ' (' + sc.tz + ')';
        }
        function engineTypes() { return ENGINE_TYPES[parseProv().engine] || ALL_TYPES; }
        function refreshJobTypes() {
            var sel = $('job-type');
            var keep = sel.value;
            var allowed = engineTypes();
            sel.innerHTML = '';
            allowed.forEach(function (t) {
                var o = document.createElement('option');
                o.value = t;
                o.textContent = TYPE_LABEL[t];
                sel.appendChild(o);
            });
            sel.value = allowed.indexOf(keep) >= 0 ? keep : 'full';
            $('job-type-help').textContent = TYPE_HELP[sel.value] || '';
        }
        function updatePresetOptions() {
            var allowed = engineTypes();
            var needs = { 'weekly-incr': 'incremental', 'daily-hourly': 'incremental', 'weekly-diff': 'differential', 'full-schema': 'schema' };
            var opts = $('plan-preset').options;
            for (var i = 0; i < opts.length; i++) {
                var n = needs[opts[i].value];
                opts[i].hidden = !!(n && allowed.indexOf(n) < 0);
                opts[i].disabled = !!(n && allowed.indexOf(n) < 0);
            }
        }
        function planPayload() {
            return planJobs.map(function (j) { return { id: j.id, name: j.name, type: j.type, schedule: j.schedule, enabled: j.enabled !== false, retry: j.retry || { max: 2 } }; });
        }
        function jobError(msg) { var el = $('job-error'); el.textContent = msg || ''; el.classList.toggle('hidden', !msg); }
        function renderPlan() {
            var box = $('plan-jobs');
            if (!planJobs.length) { box.innerHTML = '<div class="text-[11px] text-amber-300">No jobs yet. Pick a preset or add a job below.</div>'; return; }
            box.innerHTML = planJobs.map(function (j, i) {
                return '<div class="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs">' +
                    '<div class="min-w-0">' + typeBadge(j.type) + ' <span class="text-slate-200">' + esc(j.name) + '</span>' +
                    '<div class="text-[11px] text-slate-500">' + esc(j.scheduleText || schedTextClient(j.schedule)) + ' / ' + esc((j.retry && j.retry.max) || 0) + ' retries' + (j.enabled === false ? ' / paused' : '') + '</div></div>' +
                    '<div class="flex gap-1.5 shrink-0">' +
                    '<button type="button" data-plan="edit" data-i="' + i + '" class="text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 px-2 py-1 rounded-lg">Edit</button>' +
                    '<button type="button" data-plan="remove" data-i="' + i + '" class="text-slate-400 hover:text-red-300 px-2 py-1 rounded-lg">Remove</button></div></div>';
            }).join('');
        }
        function applyPreset(name) {
            var tz = $('sched-tz').value || 'UTC';
            var full = { name: 'Full backup', type: 'full', enabled: true, retry: { max: 2 } };
            var sets = {
                'daily': [{ type: 'full', schedule: { type: 'daily', time: '03:00', tz: tz } }],
                'weekly-incr': [{ type: 'full', schedule: { type: 'weekly', weekday: 0, time: '02:00', tz: tz } }, { type: 'incremental', schedule: { type: 'daily', time: '03:00', tz: tz } }],
                'daily-hourly': [{ type: 'full', schedule: { type: 'daily', time: '02:00', tz: tz } }, { type: 'incremental', schedule: { type: 'hourly', minute: 15, tz: tz } }],
                'weekly-diff': [{ type: 'full', schedule: { type: 'weekly', weekday: 0, time: '02:00', tz: tz } }, { type: 'differential', schedule: { type: 'daily', time: '03:00', tz: tz } }],
                'full-schema': [{ type: 'full', schedule: { type: 'daily', time: '03:00', tz: tz } }, { type: 'schema', schedule: { type: 'weekly', weekday: 0, time: '04:00', tz: tz } }]
            };
            var list = sets[name];
            if (!list) { return; }
            planJobs = list.map(function (j) { return { name: TYPE_LABEL[j.type], type: j.type, schedule: j.schedule, enabled: true, retry: { max: 2 } }; });
            editingJobIdx = -1;
            $('job-editor-title').textContent = 'Add a backup job';
            $('btn-job-save').textContent = 'Add job to plan';
            $('btn-job-cancel').classList.add('hidden');
            jobError('');
            renderPlan();
        }
        function saveJob() {
            jobError('');
            var type = $('job-type').value;
            var sc = scheduleFromForm();
            if (sc.type === 'once' && !sc.runAtLocal) { jobError('Pick a date and time for the one-time backup.'); return; }
            var prev = editingJobIdx >= 0 ? planJobs[editingJobIdx] : null;
            var job = { id: prev ? prev.id : undefined, name: TYPE_LABEL[type], type: type, schedule: sc, enabled: prev ? prev.enabled !== false : true, retry: { max: parseInt($('job-retry').value, 10) } };
            if (planJobs.length >= 6 && !prev) { jobError('A plan can have up to 6 jobs.'); return; }
            if (prev) { planJobs[editingJobIdx] = job; } else { planJobs.push(job); }
            editingJobIdx = -1;
            $('job-editor-title').textContent = 'Add a backup job';
            $('btn-job-save').textContent = 'Add job to plan';
            $('btn-job-cancel').classList.add('hidden');
            renderPlan();
        }
        function editJob(i) {
            var j = planJobs[i];
            if (!j) { return; }
            editingJobIdx = i;
            refreshJobTypes();
            $('job-type').value = j.type;
            $('job-type-help').textContent = TYPE_HELP[j.type] || '';
            $('job-retry').value = String((j.retry && j.retry.max) || 0);
            setScheduleForm(j.schedule);
            $('job-editor-title').textContent = 'Edit job: ' + (TYPE_LABEL[j.type] || j.type);
            $('btn-job-save').textContent = 'Update job';
            $('btn-job-cancel').classList.remove('hidden');
        }
        function cancelJobEdit() {
            editingJobIdx = -1;
            $('job-editor-title').textContent = 'Add a backup job';
            $('btn-job-save').textContent = 'Add job to plan';
            $('btn-job-cancel').classList.add('hidden');
            jobError('');
        }
        function updateRetFields() {
            var m = $('ret-mode').value;
            $('ret-count-wrap').classList.toggle('hidden', m !== 'count');
            $('ret-days-wrap').classList.toggle('hidden', m !== 'days');
        }
        function retentionFromForm() {
            var m = $('ret-mode').value;
            if (m === 'forever') { return { mode: 'forever' }; }
            if (m === 'days') { return { mode: 'days', days: parseInt($('ret-days').value, 10) }; }
            return { mode: 'count', count: parseInt($('ret-count').value, 10) };
        }
        function setRetentionForm(r) {
            $('ret-mode').value = r.mode;
            if (r.count) { $('ret-count').value = r.count; }
            if (r.days) { $('ret-days').value = r.days; }
            updateRetFields();
        }
        function effectiveUri() { return (editingDbId && dbUri() === editOriginalUri) ? '' : dbUri(); }
        function dbKey() { return parseProv().engine + '|' + dbUri(); }
        function updateDbSaveState() {
            var allowed = (editingDbId && dbUri() === editOriginalUri) ? true : (dbTestedKey !== null && dbTestedKey === dbKey());
            $('btn-save-db').disabled = !allowed;
        }
        function invalidateDbTest() {
            if (dbTestedKey !== null && dbTestedKey !== dbKey()) {
                dbTestedKey = null;
                modalMsg('', '');
                if (editingDbId && dbUri() === editOriginalUri) { setConnStatus('saved'); }
                else { setConnStatus('idle'); }
            }
            updateDbSaveState();
            highlightProviderChip();
        }

        /* schedule builder */
        function populateTz() {
            var sel = $('sched-tz');
            var zones = [];
            try { zones = Intl.supportedValuesOf('timeZone').slice(); } catch (e) {}
            if (zones.indexOf('UTC') < 0) { zones.unshift('UTC'); }
            var local = 'UTC';
            try { local = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) {}
            if (zones.indexOf(local) < 0) { zones.unshift(local); }
            sel.innerHTML = '';
            zones.forEach(function (z) {
                var o = document.createElement('option');
                o.value = z;
                o.textContent = z;
                sel.appendChild(o);
            });
            sel.value = local;
        }
        function updateSchedFields() {
            var t = $('sched-type').value;
            $('sched-minute-wrap').classList.toggle('hidden', t !== 'hourly');
            $('sched-time-wrap').classList.toggle('hidden', t === 'hourly' || t === 'once');
            $('sched-weekday-wrap').classList.toggle('hidden', t !== 'weekly');
            $('sched-day-wrap').classList.toggle('hidden', t !== 'monthly');
            $('sched-once-wrap').classList.toggle('hidden', t !== 'once');
            previewSchedule();
        }
        function scheduleFromForm() {
            var type = $('sched-type').value;
            var sc = { type: type, tz: $('sched-tz').value };
            if (type === 'hourly') { sc.minute = parseInt($('sched-minute').value, 10); }
            else if (type === 'once') { sc.runAtLocal = $('sched-once').value; }
            else {
                sc.time = $('sched-time').value;
                if (type === 'weekly') { sc.weekday = parseInt($('sched-weekday').value, 10); }
                if (type === 'monthly') { sc.day = parseInt($('sched-day').value, 10); }
            }
            return sc;
        }
        function setScheduleForm(sc) {
            $('sched-type').value = sc.type;
            var has = false;
            for (var i = 0; i < $('sched-tz').options.length; i++) { if ($('sched-tz').options[i].value === sc.tz) { has = true; } }
            if (!has) {
                var o = document.createElement('option');
                o.value = sc.tz;
                o.textContent = sc.tz;
                $('sched-tz').appendChild(o);
            }
            $('sched-tz').value = sc.tz;
            if (sc.minute !== undefined) { $('sched-minute').value = sc.minute; }
            if (sc.time) { $('sched-time').value = sc.time; }
            if (sc.weekday !== undefined) { $('sched-weekday').value = String(sc.weekday); }
            if (sc.day !== undefined) { $('sched-day').value = sc.day; }
            if (sc.runAtLocal) { $('sched-once').value = sc.runAtLocal; }
            updateSchedFields();
        }
        var previewTimer = null;
        function previewSchedule() {
            clearTimeout(previewTimer);
            previewTimer = setTimeout(async function () {
                var el = $('sched-preview');
                try {
                    var d = await api('/api/schedule/preview', 'POST', { schedule: scheduleFromForm() });
                    el.className = 'text-[11px] text-emerald-400 mt-1';
                    el.textContent = d.nextRunAt
                        ? 'Next backup: ' + new Date(d.nextRunAt).toLocaleString(undefined, { timeZone: d.tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' (' + d.tz + ')'
                        : 'No upcoming run.';
                } catch (e) {
                    if (e.message !== 'Unauthorized') { el.className = 'text-[11px] text-red-400 mt-1'; el.textContent = e.message; }
                }
            }, 250);
        }

        function openModal() {
            editingDbId = null;
            dbTestedKey = null;
            editOriginalUri = '';
            $('runnow-wrap').classList.remove('hidden');
            $('run-now').checked = true;
            editingDb = null;
            setRetentionForm({ mode: 'count', count: 30 });
            $('db-modal-title').textContent = 'Connect Database';
            if ($('db-modal-sub')) $('db-modal-sub').textContent = 'Name it, pick the engine, paste the URL, test, then save.';
            $('btn-save-db').textContent = 'Save';
            $('new-db-provider').value = 'Auto|';
            $('new-db-uri').placeholder = '';
            $('sched-type').value = 'daily';
            $('sched-time').value = '03:00';
            populateTz();
            updateSchedFields();
            refreshJobTypes();
            updatePresetOptions();
            applyPreset('daily');
            $('plan-preset').value = '';
            cancelJobEdit();
            setConnStatus('idle');
            updateDbSaveState();
            modalMsg('', '');
            setUriVisible(false);
            $('db-modal').classList.remove('hidden');
            updateHint();
            icons();
            $('new-db-name').focus();
        }
        function openEdit(id) {
            var db = null;
            for (var i = 0; i < databases.length; i++) { if (databases[i].id === id) { db = databases[i]; } }
            if (!db) { return; }
            openModal();
            editingDbId = id;
            $('db-modal-title').textContent = 'Edit database';
            $('btn-save-db').textContent = 'Save changes';
            $('new-db-name').value = db.name;
            var want = db.provider + '|' + (db.service || '');
            var sel = $('new-db-provider');
            var found = false;
            for (var j = 0; j < sel.options.length; j++) { if (sel.options[j].value === want) { found = true; } }
            if (!found) {
                for (var k = 0; k < sel.options.length; k++) { if (sel.options[k].value.indexOf(db.provider + '|') === 0) { want = sel.options[k].value; break; } }
            }
            sel.value = want;
            planJobs = (db.jobs || []).map(function (j) { return JSON.parse(JSON.stringify(j)); });
            editingDb = db;
            setRetentionForm(db.retention || { mode: 'count', count: 30 });
            refreshJobTypes();
            updatePresetOptions();
            renderPlan();
            editOriginalUri = db.maskedUri || '';
            $('new-db-uri').value = editOriginalUri;
            $('new-db-uri').placeholder = '';
            $('runnow-wrap').classList.add('hidden');
            if ($('db-modal-sub')) $('db-modal-sub').textContent = 'Update name, plan, retention, or connection. Re-test if you change the URL or engine.';
            updateHint();
            $('uri-hint').textContent = 'The password is hidden as ********. Keep it to reuse the saved password, or type a new one in its place. ' + $('uri-hint').textContent;
            setConnStatus('saved');
            updateDbSaveState();
            highlightProviderChip();
            icons();
        }
        function closeModal() {
            $('db-modal').classList.add('hidden');
            $('new-db-name').value = '';
            $('new-db-uri').value = '';
            setUriVisible(false);
            editingDbId = null;
            dbTestedKey = null;
            editOriginalUri = '';
            updateDbSaveState();
            modalMsg('', '');
        }
        var uriVisible = false;
        function setUriVisible(on) {
            uriVisible = !!on;
            var ta = $('new-db-uri');
            if (ta) {
                ta.style.webkitTextSecurity = uriVisible ? '' : 'disc';
                ta.classList.toggle('uri-masked', !uriVisible);
            }
            var btn = $('btn-toggle-uri');
            if (btn) {
                btn.innerHTML = '<i data-lucide="' + (uriVisible ? 'eye-off' : 'eye') + '" class="w-4 h-4 pointer-events-none"></i>';
                icons();
            }
        }
        function dbPayload() {
            var p = parseProv();
            return { name: $('new-db-name').value.trim(), provider: p.engine, service: p.service, jobs: planPayload(), uri: dbUri(), runNow: $('run-now').checked, retention: retentionFromForm() };
        }
        async function testDatabaseConn() {
            var body = dbPayload();
            body.uri = effectiveUri();
            modalMsg('', '');
            if (!body.uri && !editingDbId) { modalMsg('error', 'Enter a connection string first.'); setConnStatus('idle'); return; }
            setBusy('btn-test-db', true, 'Testing...');
            setConnStatus('testing');
            try {
                var d = editingDbId
                    ? await api('/api/database/' + encodeURIComponent(editingDbId) + '/test', 'POST', body.uri ? { uri: body.uri, provider: body.provider } : {})
                    : await api('/api/database/test', 'POST', body);
                if (body.uri) { dbTestedKey = dbKey(); setConnStatus('ok'); }
                else { setConnStatus('saved'); }
                modalMsg('info', d.message + (body.uri ? ' You can save now.' : ''));
                showToast(d.message);
            } catch (e) {
                dbTestedKey = null;
                setConnStatus('fail');
                if (e.message !== 'Unauthorized') { modalMsg('error', e.message); showToast(e.message, true); }
            }
            setBusy('btn-test-db', false);
            updateDbSaveState();
        }
        async function submitNewDatabase() {
            var body = dbPayload();
            body.uri = effectiveUri();
            modalMsg('', '');
            if (!body.name) { modalMsg('error', 'Enter a database name.'); return; }
            if (!body.jobs.length) { modalMsg('error', 'Add at least one backup job to the plan.'); return; }
            if (!editingDbId && !body.uri) { modalMsg('error', 'Enter a connection string.'); return; }
            if (body.uri && (dbTestedKey === null || dbTestedKey !== dbKey())) { modalMsg('error', 'Test the connection first. Saving a connection is only allowed after a successful test.'); updateDbSaveState(); return; }
            if (editingDbId && editingDb && JSON.stringify(body.retention) !== JSON.stringify(editingDb.retention)) {
                try {
                    var pv = await api('/api/database/' + encodeURIComponent(editingDbId) + '/retention/preview', 'POST', { retention: body.retention });
                    if (pv.wouldDelete > 0 && !confirm('Saving this retention setting will delete ' + pv.wouldDelete + ' existing backup' + (pv.wouldDelete === 1 ? '' : 's') + ' from your storage. Continue?')) { return; }
                } catch (e) {
                    if (e.message !== 'Unauthorized') { modalMsg('error', e.message); }
                    return;
                }
            }
            setBusy('btn-save-db', true, 'Verifying and saving...');
            try {
                var d;
                if (editingDbId) {
                    var patch = { name: body.name, service: body.service, jobs: body.jobs, retention: body.retention };
                    if (body.uri) { patch.uri = body.uri; patch.provider = body.provider; }
                    d = await api('/api/database/' + encodeURIComponent(editingDbId), 'PUT', patch);
                } else {
                    d = await api('/api/database', 'POST', body);
                }
                closeModal();
                showToast(d.message || 'Saved.');
                await refresh();
                if (d.firstBackupStarted) { pollUntilIdle(40); }
            } catch (e) {
                if (e.message !== 'Unauthorized') { modalMsg('error', e.message + ' Nothing was saved.'); showToast(e.message + ' Nothing was saved.', true); }
            }
            setBusy('btn-save-db', false);
            updateDbSaveState();
        }

        /* ---------- storage ---------- */
        var STORAGE_HELP = {
            BackblazeB2: { ph: 's3.us-west-004.backblazeb2.com', help: 'In B2 create an Application Key limited to one bucket with read, write and delete. Use its keyID and applicationKey. The S3 endpoint is shown on the bucket page.' },
            CloudflareR2: { ph: 'ACCOUNT_ID.r2.cloudflarestorage.com', help: 'Create an R2 API token with Object Read and Write. Leave region empty.' },
            AWSS3: { ph: 's3.us-east-1.amazonaws.com', help: 'Use an IAM user key allowed s3:PutObject, GetObject and DeleteObject on the bucket. Put the bucket region in the endpoint.' },
            Wasabi: { ph: 's3.us-east-1.wasabisys.com', help: 'Use a Wasabi access key with read and write on the bucket.' },
            CustomS3: { ph: 'minio.example.com', help: 'Any S3-compatible service with a public host name.' }
        };
        function updateStorageHelp() {
            var h = STORAGE_HELP[$('byob-provider').value];
            $('byob-endpoint').placeholder = h.ph;
            $('byob-help').textContent = h.help;
        }
        function toggleStorageMode() {
            $('byob-fields').classList.toggle('hidden', $('storage-mode').value !== 'BYOB');
        }
        function storageError(msg) {
            var el = $('storage-error');
            el.textContent = msg || '';
            el.classList.toggle('hidden', !msg);
        }
        async function loadStorage() {
            try {
                var d = await api('/api/storage');
                var cfg = d.config || { mode: 'NONE' };
                var opts = $('storage-mode').options;
                for (var i = 0; i < opts.length; i++) {
                    if (opts[i].value === 'MANAGED') { opts[i].disabled = !cfg.managedAllowed; opts[i].hidden = !cfg.managedAllowed; }
                }
                $('storage-mode').value = (cfg.mode === 'MANAGED' && cfg.managedAllowed) ? 'MANAGED' : 'BYOB';
                if (cfg.mode === 'BYOB') {
                    $('byob-provider').value = cfg.provider || 'BackblazeB2';
                    $('byob-endpoint').value = cfg.endpoint || '';
                    $('byob-region').value = cfg.region || '';
                    $('byob-bucket').value = cfg.bucketName || '';
                    $('byob-key').value = '';
                    $('byob-key').placeholder = cfg.keyHint ? 'Saved (' + cfg.keyHint + '). Leave blank to keep it.' : 'access_key_id';
                    $('byob-secret').value = '';
                    $('byob-secret').placeholder = cfg.hasSecret ? 'Saved. Leave blank to keep it.' : 'secret_access_key';
                    $('stat-storage-mode').textContent = 'Your bucket';
                } else if (cfg.mode === 'MANAGED') {
                    $('stat-storage-mode').textContent = 'Platform Managed';
                } else {
                    $('stat-storage-mode').textContent = 'Not set up';
                }
                $('storage-note').textContent = cfg.mode === 'NONE'
                    ? 'Set up your own bucket first. Nothing is saved until the connection test passes.'
                    : (cfg.verifiedAt ? 'Last verified ' + new Date(cfg.verifiedAt).toLocaleString() : '');
                toggleStorageMode();
                updateStorageHelp();
                storageTestedKey = null;
                updateStorageSaveState();
                lastStorageCfg = cfg;
                storageEditing = false;
                renderStorageSummary(cfg);
            } catch (e) {
                if (e.message !== 'Unauthorized') { storageError(e.message); }
            }
        }
        function collectStorage() {
            var mode = $('storage-mode').value;
            if (mode !== 'BYOB') { return { mode: mode }; }
            return {
                mode: mode,
                provider: $('byob-provider').value,
                endpoint: $('byob-endpoint').value.trim(),
                region: $('byob-region').value.trim(),
                bucketName: $('byob-bucket').value.trim(),
                accessKeyId: $('byob-key').value.trim(),
                secretAccessKey: $('byob-secret').value.trim()
            };
        }
        var storageEditing = false;
        var lastStorageCfg = { mode: 'NONE' };
        function renderStorageSummary(cfg) {
            var configured = cfg.mode === 'BYOB' || cfg.mode === 'MANAGED';
            $('storage-summary').classList.toggle('hidden', !configured || storageEditing);
            $('storage-form').classList.toggle('hidden', configured && !storageEditing);
            $('btn-cancel-storage').classList.toggle('hidden', !(configured && storageEditing));
            if (!configured) { return; }
            $('storage-summary-text').textContent = cfg.mode === 'MANAGED'
                ? 'Platform managed vault (R2)'
                : (cfg.provider + ' / bucket ' + cfg.bucketName + ' / key ' + (cfg.keyHint || '') + ' / verified ' + (cfg.verifiedAt ? new Date(cfg.verifiedAt).toLocaleString() : 'n/a'));
            var n = (cfg.archived || []).length;
            $('storage-archived').textContent = n
                ? 'Older backups stay in their original bucket (' + n + ' previous target' + (n === 1 ? '' : 's') + ') and remain downloadable.'
                : 'Changing storage never moves existing backups. They stay downloadable from where they were saved.';
        }
        var storageTestedKey = null;
        function storageKey() { return JSON.stringify(collectStorage()); }
        function updateStorageSaveState() { $('btn-save-storage').disabled = storageTestedKey === null || storageTestedKey !== storageKey(); }
        function invalidateStorageTest() {
            if (storageTestedKey !== null && storageTestedKey !== storageKey()) { storageTestedKey = null; storageError(''); }
            updateStorageSaveState();
        }
        async function saveStorage() {
            storageError('');
            if (storageTestedKey === null || storageTestedKey !== storageKey()) { storageError('Test the connection first. Saving is only allowed after a successful test.'); updateStorageSaveState(); return; }
            setBusy('btn-save-storage', true, 'Verifying and saving...');
            try {
                var d = await api('/api/storage', 'POST', collectStorage());
                showToast(d.message || 'Storage saved.');
                await loadStorage();
            } catch (e) {
                if (e.message !== 'Unauthorized') { storageError(e.message + ' Nothing was saved.'); showToast(e.message + ' Nothing was saved.', true); }
            }
            setBusy('btn-save-storage', false);
            updateStorageSaveState();
        }
        async function testStorage() {
            storageError('');
            setBusy('btn-test-storage', true, 'Testing...');
            try {
                var d = await api('/api/storage/test', 'POST', collectStorage());
                storageTestedKey = storageKey();
                showToast(d.message + ' You can save now.');
            } catch (e) {
                storageTestedKey = null;
                if (e.message !== 'Unauthorized') { storageError(e.message); showToast(e.message, true); }
            }
            setBusy('btn-test-storage', false);
            updateStorageSaveState();
        }

        /* ---------- wire up ---------- */
        window.addEventListener('DOMContentLoaded', function () {
            $('btn-login').addEventListener('click', function () { submitAuth('login'); });
            $('btn-register').addEventListener('click', function () { submitAuth('register'); });
            $('btn-forgot-send').addEventListener('click', submitForgot);
            $('btn-reset-submit').addEventListener('click', submitReset);
            $('link-forgot').addEventListener('click', function () { setAuthMode('forgot'); });
            $('link-back').addEventListener('click', function () { resetToken = null; setAuthMode('login'); });
            function onAuthEnter(e) {
                if (e.key !== 'Enter') { return; }
                if (authMode === 'login') { submitAuth('login'); }
                else if (authMode === 'forgot') { submitForgot(); }
                else { submitReset(); }
            }
            $('auth-email').addEventListener('keydown', onAuthEnter);
            $('auth-password').addEventListener('keydown', onAuthEnter);
            $('auth-confirm').addEventListener('keydown', onAuthEnter);
            $('btn-password').addEventListener('click', openPwModal);
            $('btn-close-pw').addEventListener('click', closePwModal);
            $('btn-cancel-pw').addEventListener('click', closePwModal);
            $('btn-save-pw').addEventListener('click', submitPwChange);
            $('btn-logout').addEventListener('click', logout);
            $('toast-close').addEventListener('click', hideToast);
            $('btn-add-db').addEventListener('click', openModal);
            $('btn-close-modal').addEventListener('click', closeModal);
            $('btn-cancel-modal').addEventListener('click', closeModal);
            $('btn-save-db').addEventListener('click', submitNewDatabase);
            $('btn-test-db').addEventListener('click', testDatabaseConn);
            $('ret-mode').addEventListener('change', updateRetFields);
            $('btn-job-save').addEventListener('click', saveJob);
            $('btn-job-cancel').addEventListener('click', cancelJobEdit);
            $('job-type').addEventListener('change', function () { $('job-type-help').textContent = TYPE_HELP[$('job-type').value] || ''; });
            $('plan-preset').addEventListener('change', function () { if ($('plan-preset').value) { applyPreset($('plan-preset').value); } });
            $('plan-jobs').addEventListener('click', function (ev) {
                var btn = ev.target.closest('button[data-plan]');
                if (!btn) { return; }
                var i = parseInt(btn.getAttribute('data-i'), 10);
                if (btn.getAttribute('data-plan') === 'edit') { editJob(i); }
                else { planJobs.splice(i, 1); if (editingJobIdx === i) { cancelJobEdit(); } renderPlan(); }
            });
            $('btn-close-log').addEventListener('click', closeLogModal);
            $('log-body').addEventListener('click', onListClick);
            populateTz();
            $('sched-type').addEventListener('change', updateSchedFields);
            ['sched-tz', 'sched-minute', 'sched-time', 'sched-weekday', 'sched-day', 'sched-once'].forEach(function (id) {
                $(id).addEventListener('input', previewSchedule);
                $(id).addEventListener('change', previewSchedule);
            });
            $('btn-edit-storage').addEventListener('click', function () { storageEditing = true; renderStorageSummary(lastStorageCfg); });
            $('btn-cancel-storage').addEventListener('click', function () { storageEditing = false; loadStorage(); });
            $('byob-provider').addEventListener('change', updateStorageHelp);
            ['storage-mode', 'byob-provider', 'byob-endpoint', 'byob-region', 'byob-bucket', 'byob-key', 'byob-secret'].forEach(function (id) {
                $(id).addEventListener('input', invalidateStorageTest);
                $(id).addEventListener('change', invalidateStorageTest);
            });
            $('new-db-uri').addEventListener('input', invalidateDbTest);
            $('new-db-provider').addEventListener('change', invalidateDbTest);
            $('new-db-provider').addEventListener('change', updateHint);
            var chipBox = $('provider-chips');
            if (chipBox) {
                chipBox.addEventListener('click', function (ev) {
                    var btn = ev.target.closest('[data-chip]');
                    if (!btn) return;
                    $('new-db-provider').value = btn.getAttribute('data-chip');
                    invalidateDbTest();
                    updateHint();
                });
            }
            $('storage-mode').addEventListener('change', toggleStorageMode);
            $('btn-save-storage').addEventListener('click', saveStorage);
            $('btn-test-storage').addEventListener('click', testStorage);
            $('db-list-container').addEventListener('click', onListClick);
            if ($('agent-list-container')) $('agent-list-container').addEventListener('click', onListClick);
            $('logs-table-body').addEventListener('click', onListClick);
            if ($('btn-add-agent')) $('btn-add-agent').addEventListener('click', openAgentModal);
            if ($('btn-close-agent')) $('btn-close-agent').addEventListener('click', closeAgentModal);
            if ($('btn-cancel-agent')) $('btn-cancel-agent').addEventListener('click', closeAgentModal);
            if ($('btn-create-agent')) $('btn-create-agent').addEventListener('click', createAgentToken);
            if ($('btn-agent-done')) $('btn-agent-done').addEventListener('click', closeAgentModal);
            var dbBackdrop = $('db-modal-backdrop');
            if (dbBackdrop) dbBackdrop.addEventListener('click', closeModal);
            if ($('btn-toggle-uri')) $('btn-toggle-uri').addEventListener('click', function () { setUriVisible(!uriVisible); });
            function onHistFilter() { histPage = 0; renderHistory(); icons(); }
            ['hist-filter-q', 'hist-filter-status', 'hist-filter-db'].forEach(function (id) {
                var el = $(id);
                if (!el) return;
                el.addEventListener('input', onHistFilter);
                el.addEventListener('change', onHistFilter);
            });
            if ($('hist-prev')) $('hist-prev').addEventListener('click', function () { histPage--; renderHistory(); icons(); });
            if ($('hist-next')) $('hist-next').addEventListener('click', function () { histPage++; renderHistory(); icons(); });
            if ($('btn-sched-help')) $('btn-sched-help').addEventListener('click', function () {
                var t = $('scheduler-banner-text');
                if (t) t.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                showToast('Add a Cron Trigger */5 * * * * in the Cloudflare dashboard, or call POST /api/admin/setup-scheduler with ADMIN_TOKEN.');
            });
            document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeModal(); closePwModal(); closeLogModal(); } });
            icons();
            setUriVisible(false);
            var hash = window.location.hash || '';
            if (hash.indexOf('#reset=') === 0) {
                resetToken = hash.slice(7);
                try { history.replaceState(null, '', window.location.pathname); } catch (e) {}
            }
            loadHealth();
            if (resetToken) { showAuth(''); return; }
            if (!TOKEN) { showAuth(''); return; }
            api('/api/auth/me').then(function (d) { ME = d.email; showApp(); }).catch(function () { showAuth(''); });
        });
    </script>
</body>
</html>`;

const ADMIN_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Operator monitor</title>
    <style>*,:after,:before{--tw-border-spacing-x:0;--tw-border-spacing-y:0;--tw-translate-x:0;--tw-translate-y:0;--tw-rotate:0;--tw-skew-x:0;--tw-skew-y:0;--tw-scale-x:1;--tw-scale-y:1;--tw-pan-x: ;--tw-pan-y: ;--tw-pinch-zoom: ;--tw-scroll-snap-strictness:proximity;--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;--tw-ordinal: ;--tw-slashed-zero: ;--tw-numeric-figure: ;--tw-numeric-spacing: ;--tw-numeric-fraction: ;--tw-ring-inset: ;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-color:rgba(59,130,246,.5);--tw-ring-offset-shadow:0 0 #0000;--tw-ring-shadow:0 0 #0000;--tw-shadow:0 0 #0000;--tw-shadow-colored:0 0 #0000;--tw-blur: ;--tw-brightness: ;--tw-contrast: ;--tw-grayscale: ;--tw-hue-rotate: ;--tw-invert: ;--tw-saturate: ;--tw-sepia: ;--tw-drop-shadow: ;--tw-backdrop-blur: ;--tw-backdrop-brightness: ;--tw-backdrop-contrast: ;--tw-backdrop-grayscale: ;--tw-backdrop-hue-rotate: ;--tw-backdrop-invert: ;--tw-backdrop-opacity: ;--tw-backdrop-saturate: ;--tw-backdrop-sepia: ;--tw-contain-size: ;--tw-contain-layout: ;--tw-contain-paint: ;--tw-contain-style: }::backdrop{--tw-border-spacing-x:0;--tw-border-spacing-y:0;--tw-translate-x:0;--tw-translate-y:0;--tw-rotate:0;--tw-skew-x:0;--tw-skew-y:0;--tw-scale-x:1;--tw-scale-y:1;--tw-pan-x: ;--tw-pan-y: ;--tw-pinch-zoom: ;--tw-scroll-snap-strictness:proximity;--tw-gradient-from-position: ;--tw-gradient-via-position: ;--tw-gradient-to-position: ;--tw-ordinal: ;--tw-slashed-zero: ;--tw-numeric-figure: ;--tw-numeric-spacing: ;--tw-numeric-fraction: ;--tw-ring-inset: ;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-color:rgba(59,130,246,.5);--tw-ring-offset-shadow:0 0 #0000;--tw-ring-shadow:0 0 #0000;--tw-shadow:0 0 #0000;--tw-shadow-colored:0 0 #0000;--tw-blur: ;--tw-brightness: ;--tw-contrast: ;--tw-grayscale: ;--tw-hue-rotate: ;--tw-invert: ;--tw-saturate: ;--tw-sepia: ;--tw-drop-shadow: ;--tw-backdrop-blur: ;--tw-backdrop-brightness: ;--tw-backdrop-contrast: ;--tw-backdrop-grayscale: ;--tw-backdrop-hue-rotate: ;--tw-backdrop-invert: ;--tw-backdrop-opacity: ;--tw-backdrop-saturate: ;--tw-backdrop-sepia: ;--tw-contain-size: ;--tw-contain-layout: ;--tw-contain-paint: ;--tw-contain-style: }/*! tailwindcss v3.4.19 | MIT License | https://tailwindcss.com*/*,:after,:before{box-sizing:border-box;border:0 solid #e5e7eb}:after,:before{--tw-content:""}:host,html{line-height:1.5;-webkit-text-size-adjust:100%;-moz-tab-size:4;-o-tab-size:4;tab-size:4;font-family:ui-sans-serif,system-ui,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji;font-feature-settings:normal;font-variation-settings:normal;-webkit-tap-highlight-color:transparent}body{margin:0;line-height:inherit}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,pre,samp{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace;font-feature-settings:normal;font-variation-settings:normal;font-size:1em}small{font-size:80%}sub,sup{font-size:75%;line-height:0;position:relative;vertical-align:baseline}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}button,input,optgroup,select,textarea{font-family:inherit;font-feature-settings:inherit;font-variation-settings:inherit;font-size:100%;font-weight:inherit;line-height:inherit;letter-spacing:inherit;color:inherit;margin:0;padding:0}button,select{text-transform:none}button,input:where([type=button]),input:where([type=reset]),input:where([type=submit]){-webkit-appearance:button;background-color:transparent;background-image:none}:-moz-focusring{outline:auto}:-moz-ui-invalid{box-shadow:none}progress{vertical-align:baseline}::-webkit-inner-spin-button,::-webkit-outer-spin-button{height:auto}[type=search]{-webkit-appearance:textfield;outline-offset:-2px}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-file-upload-button{-webkit-appearance:button;font:inherit}summary{display:list-item}blockquote,dd,dl,figure,h1,h2,h3,h4,h5,h6,hr,p,pre{margin:0}fieldset{margin:0}fieldset,legend{padding:0}menu,ol,ul{list-style:none;margin:0;padding:0}dialog{padding:0}textarea{resize:vertical}input::-moz-placeholder,textarea::-moz-placeholder{opacity:1;color:#9ca3af}input::placeholder,textarea::placeholder{opacity:1;color:#9ca3af}[role=button],button{cursor:pointer}:disabled{cursor:default}audio,canvas,embed,iframe,img,object,svg,video{display:block;vertical-align:middle}img,video{max-width:100%;height:auto}[hidden]:where(:not([hidden=until-found])){display:none}.pointer-events-none{pointer-events:none}.visible{visibility:visible}.static{position:static}.fixed{position:fixed}.sticky{position:sticky}.inset-0{inset:0}.top-0{top:0}.z-50{z-index:50}.z-\[60\]{z-index:60}.col-span-2{grid-column:span 2/span 2}.mx-auto{margin-left:auto;margin-right:auto}.mb-1{margin-bottom:.25rem}.mb-2{margin-bottom:.5rem}.mb-4{margin-bottom:1rem}.mb-6{margin-bottom:1.5rem}.mt-0\.5{margin-top:.125rem}.mt-1{margin-top:.25rem}.mt-2{margin-top:.5rem}.block{display:block}.inline{display:inline}.flex{display:flex}.inline-flex{display:inline-flex}.table{display:table}.grid{display:grid}.hidden{display:none}.h-16{height:4rem}.h-2{height:.5rem}.h-3\.5{height:.875rem}.h-4{height:1rem}.h-5{height:1.25rem}.h-6{height:1.5rem}.max-h-40{max-height:10rem}.max-h-56{max-height:14rem}.max-h-\[90vh\]{max-height:90vh}.min-h-\[1rem\]{min-height:1rem}.min-h-screen{min-height:100vh}.\!w-auto{width:auto!important}.w-2{width:.5rem}.w-3\.5{width:.875rem}.w-4{width:1rem}.w-5{width:1.25rem}.w-56{width:14rem}.w-6{width:1.5rem}.w-full{width:100%}.min-w-0{min-width:0}.max-w-2xl{max-width:42rem}.max-w-7xl{max-width:80rem}.max-w-md{max-width:28rem}.max-w-sm{max-width:24rem}.flex-1{flex:1 1 0%}.shrink-0{flex-shrink:0}.flex-grow{flex-grow:1}@keyframes pulse{50%{opacity:.5}}.animate-pulse{animation:pulse 2s cubic-bezier(.4,0,.6,1) infinite}.grid-cols-1{grid-template-columns:repeat(1,minmax(0,1fr))}.grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}.items-center{align-items:center}.justify-end{justify-content:flex-end}.justify-center{justify-content:center}.justify-between{justify-content:space-between}.gap-1{gap:.25rem}.gap-1\.5{gap:.375rem}.gap-2{gap:.5rem}.gap-3{gap:.75rem}.gap-4{gap:1rem}.gap-8{gap:2rem}.space-x-2>:not([hidden])~:not([hidden]){--tw-space-x-reverse:0;margin-right:calc(.5rem*var(--tw-space-x-reverse));margin-left:calc(.5rem*(1 - var(--tw-space-x-reverse)))}.space-x-3>:not([hidden])~:not([hidden]){--tw-space-x-reverse:0;margin-right:calc(.75rem*var(--tw-space-x-reverse));margin-left:calc(.75rem*(1 - var(--tw-space-x-reverse)))}.space-y-1>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(.25rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(.25rem*var(--tw-space-y-reverse))}.space-y-1\.5>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(.375rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(.375rem*var(--tw-space-y-reverse))}.space-y-2>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(.5rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(.5rem*var(--tw-space-y-reverse))}.space-y-3>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(.75rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(.75rem*var(--tw-space-y-reverse))}.space-y-4>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(1rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(1rem*var(--tw-space-y-reverse))}.space-y-6>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(1.5rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(1.5rem*var(--tw-space-y-reverse))}.space-y-8>:not([hidden])~:not([hidden]){--tw-space-y-reverse:0;margin-top:calc(2rem*(1 - var(--tw-space-y-reverse)));margin-bottom:calc(2rem*var(--tw-space-y-reverse))}.divide-y>:not([hidden])~:not([hidden]){--tw-divide-y-reverse:0;border-top-width:calc(1px*(1 - var(--tw-divide-y-reverse)));border-bottom-width:calc(1px*var(--tw-divide-y-reverse))}.divide-slate-800\/50>:not([hidden])~:not([hidden]){border-color:rgba(30,41,59,.5)}.overflow-x-auto{overflow-x:auto}.overflow-y-auto{overflow-y:auto}.truncate{overflow:hidden;text-overflow:ellipsis}.truncate,.whitespace-nowrap{white-space:nowrap}.whitespace-pre-wrap{white-space:pre-wrap}.break-words{overflow-wrap:break-word}.break-all{word-break:break-all}.rounded{border-radius:.25rem}.rounded-2xl{border-radius:1rem}.rounded-full{border-radius:9999px}.rounded-lg{border-radius:.5rem}.rounded-xl{border-radius:.75rem}.rounded-l-lg{border-top-left-radius:.5rem;border-bottom-left-radius:.5rem}.rounded-r-lg{border-top-right-radius:.5rem;border-bottom-right-radius:.5rem}.border{border-width:1px}.border-b{border-bottom-width:1px}.border-t{border-top-width:1px}.border-amber-700\/60{border-color:rgba(180,83,9,.6)}.border-brand-500\/30{border-color:rgba(34,197,94,.3)}.border-brand-700{--tw-border-opacity:1;border-color:rgb(21 128 61/var(--tw-border-opacity,1))}.border-emerald-800\/60{border-color:rgba(6,95,70,.6)}.border-red-800\/60{border-color:rgba(153,27,27,.6)}.border-slate-700{--tw-border-opacity:1;border-color:rgb(51 65 85/var(--tw-border-opacity,1))}.border-slate-800{--tw-border-opacity:1;border-color:rgb(30 41 59/var(--tw-border-opacity,1))}.border-slate-800\/60{border-color:rgba(30,41,59,.6)}.border-slate-800\/80{border-color:rgba(30,41,59,.8)}.bg-amber-500{--tw-bg-opacity:1;background-color:rgb(245 158 11/var(--tw-bg-opacity,1))}.bg-amber-500\/15{background-color:rgba(245,158,11,.15)}.bg-amber-950\/40{background-color:rgba(69,26,3,.4)}.bg-amber-950\/60{background-color:rgba(69,26,3,.6)}.bg-brand-500\/10{background-color:rgba(34,197,94,.1)}.bg-brand-500\/20{background-color:rgba(34,197,94,.2)}.bg-brand-600{--tw-bg-opacity:1;background-color:rgb(22 163 74/var(--tw-bg-opacity,1))}.bg-emerald-500{--tw-bg-opacity:1;background-color:rgb(16 185 129/var(--tw-bg-opacity,1))}.bg-emerald-500\/10{background-color:rgba(16,185,129,.1)}.bg-emerald-500\/15{background-color:rgba(16,185,129,.15)}.bg-emerald-950\/40{background-color:rgba(2,44,34,.4)}.bg-emerald-950\/90{background-color:rgba(2,44,34,.9)}.bg-purple-500\/10{background-color:rgba(168,85,247,.1)}.bg-red-500{--tw-bg-opacity:1;background-color:rgb(239 68 68/var(--tw-bg-opacity,1))}.bg-red-500\/15{background-color:rgba(239,68,68,.15)}.bg-red-950\/40{background-color:rgba(69,10,10,.4)}.bg-red-950\/90{background-color:rgba(69,10,10,.9)}.bg-sky-500\/15{background-color:rgba(14,165,233,.15)}.bg-slate-500{--tw-bg-opacity:1;background-color:rgb(100 116 139/var(--tw-bg-opacity,1))}.bg-slate-600{--tw-bg-opacity:1;background-color:rgb(71 85 105/var(--tw-bg-opacity,1))}.bg-slate-800{--tw-bg-opacity:1;background-color:rgb(30 41 59/var(--tw-bg-opacity,1))}.bg-slate-900{--tw-bg-opacity:1;background-color:rgb(15 23 42/var(--tw-bg-opacity,1))}.bg-slate-900\/50{background-color:rgba(15,23,42,.5)}.bg-slate-900\/60{background-color:rgba(15,23,42,.6)}.bg-slate-950{--tw-bg-opacity:1;background-color:rgb(2 6 23/var(--tw-bg-opacity,1))}.bg-slate-950\/60{background-color:rgba(2,6,23,.6)}.bg-slate-950\/80{background-color:rgba(2,6,23,.8)}.bg-violet-500\/15{background-color:rgba(139,92,246,.15)}.p-2{padding:.5rem}.p-2\.5{padding:.625rem}.p-3{padding:.75rem}.p-4{padding:1rem}.p-5{padding:1.25rem}.p-6{padding:1.5rem}.px-2{padding-left:.5rem;padding-right:.5rem}.px-2\.5{padding-left:.625rem;padding-right:.625rem}.px-3{padding-left:.75rem;padding-right:.75rem}.px-4{padding-left:1rem;padding-right:1rem}.py-0\.5{padding-top:.125rem;padding-bottom:.125rem}.py-1{padding-top:.25rem;padding-bottom:.25rem}.py-1\.5{padding-top:.375rem;padding-bottom:.375rem}.py-2{padding-top:.5rem;padding-bottom:.5rem}.py-2\.5{padding-top:.625rem;padding-bottom:.625rem}.py-3{padding-top:.75rem;padding-bottom:.75rem}.py-4{padding-top:1rem;padding-bottom:1rem}.py-6{padding-top:1.5rem;padding-bottom:1.5rem}.py-8{padding-top:2rem;padding-bottom:2rem}.pt-2{padding-top:.5rem}.pt-3{padding-top:.75rem}.text-left{text-align:left}.text-center{text-align:center}.text-right{text-align:right}.font-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation Mono,Courier New,monospace}.font-sans{font-family:ui-sans-serif,system-ui,sans-serif,Apple Color Emoji,Segoe UI Emoji,Segoe UI Symbol,Noto Color Emoji}.text-2xl{font-size:1.5rem;line-height:2rem}.text-\[10px\]{font-size:10px}.text-\[11px\]{font-size:11px}.text-base{font-size:1rem;line-height:1.5rem}.text-lg{font-size:1.125rem;line-height:1.75rem}.text-sm{font-size:.875rem;line-height:1.25rem}.text-xl{font-size:1.25rem;line-height:1.75rem}.text-xs{font-size:.75rem;line-height:1rem}.font-bold{font-weight:700}.font-medium{font-weight:500}.font-normal{font-weight:400}.font-semibold{font-weight:600}.uppercase{text-transform:uppercase}.tracking-tight{letter-spacing:-.025em}.tracking-wider{letter-spacing:.05em}.text-amber-200{--tw-text-opacity:1;color:rgb(253 230 138/var(--tw-text-opacity,1))}.text-amber-300{--tw-text-opacity:1;color:rgb(252 211 77/var(--tw-text-opacity,1))}.text-amber-300\/90{color:rgba(252,211,77,.9)}.text-brand-400{--tw-text-opacity:1;color:rgb(74 222 128/var(--tw-text-opacity,1))}.text-brand-500{--tw-text-opacity:1;color:rgb(34 197 94/var(--tw-text-opacity,1))}.text-emerald-200{--tw-text-opacity:1;color:rgb(167 243 208/var(--tw-text-opacity,1))}.text-emerald-300{--tw-text-opacity:1;color:rgb(110 231 183/var(--tw-text-opacity,1))}.text-emerald-400{--tw-text-opacity:1;color:rgb(52 211 153/var(--tw-text-opacity,1))}.text-purple-400{--tw-text-opacity:1;color:rgb(192 132 252/var(--tw-text-opacity,1))}.text-red-200{--tw-text-opacity:1;color:rgb(254 202 202/var(--tw-text-opacity,1))}.text-red-300{--tw-text-opacity:1;color:rgb(252 165 165/var(--tw-text-opacity,1))}.text-red-400{--tw-text-opacity:1;color:rgb(248 113 113/var(--tw-text-opacity,1))}.text-sky-300{--tw-text-opacity:1;color:rgb(125 211 252/var(--tw-text-opacity,1))}.text-slate-100{--tw-text-opacity:1;color:rgb(241 245 249/var(--tw-text-opacity,1))}.text-slate-200{--tw-text-opacity:1;color:rgb(226 232 240/var(--tw-text-opacity,1))}.text-slate-300{--tw-text-opacity:1;color:rgb(203 213 225/var(--tw-text-opacity,1))}.text-slate-400{--tw-text-opacity:1;color:rgb(148 163 184/var(--tw-text-opacity,1))}.text-slate-500{--tw-text-opacity:1;color:rgb(100 116 139/var(--tw-text-opacity,1))}.text-violet-300{--tw-text-opacity:1;color:rgb(196 181 253/var(--tw-text-opacity,1))}.text-white{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.opacity-70{opacity:.7}.shadow-2xl{--tw-shadow:0 25px 50px -12px rgba(0,0,0,.25);--tw-shadow-colored:0 25px 50px -12px var(--tw-shadow-color)}.shadow-2xl,.shadow-lg{box-shadow:var(--tw-ring-offset-shadow,0 0 #0000),var(--tw-ring-shadow,0 0 #0000),var(--tw-shadow)}.shadow-lg{--tw-shadow:0 10px 15px -3px rgba(0,0,0,.1),0 4px 6px -4px rgba(0,0,0,.1);--tw-shadow-colored:0 10px 15px -3px var(--tw-shadow-color),0 4px 6px -4px var(--tw-shadow-color)}.filter{filter:var(--tw-blur) var(--tw-brightness) var(--tw-contrast) var(--tw-grayscale) var(--tw-hue-rotate) var(--tw-invert) var(--tw-saturate) var(--tw-sepia) var(--tw-drop-shadow)}.backdrop-blur{--tw-backdrop-blur:blur(8px)}.backdrop-blur,.backdrop-blur-sm{-webkit-backdrop-filter:var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia);backdrop-filter:var(--tw-backdrop-blur) var(--tw-backdrop-brightness) var(--tw-backdrop-contrast) var(--tw-backdrop-grayscale) var(--tw-backdrop-hue-rotate) var(--tw-backdrop-invert) var(--tw-backdrop-opacity) var(--tw-backdrop-saturate) var(--tw-backdrop-sepia)}.backdrop-blur-sm{--tw-backdrop-blur:blur(4px)}.transition{transition-property:color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,-webkit-backdrop-filter;transition-property:color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,backdrop-filter;transition-property:color,background-color,border-color,text-decoration-color,fill,stroke,opacity,box-shadow,transform,filter,backdrop-filter,-webkit-backdrop-filter;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.15s}.transition-all{transition-property:all;transition-timing-function:cubic-bezier(.4,0,.2,1);transition-duration:.15s}.duration-300{transition-duration:.3s}.\[color-scheme\:dark\]{color-scheme:dark}.selection\:bg-brand-500 ::-moz-selection{--tw-bg-opacity:1;background-color:rgb(34 197 94/var(--tw-bg-opacity,1))}.selection\:bg-brand-500 ::selection{--tw-bg-opacity:1;background-color:rgb(34 197 94/var(--tw-bg-opacity,1))}.selection\:text-white ::-moz-selection{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.selection\:text-white ::selection{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.selection\:bg-brand-500::-moz-selection{--tw-bg-opacity:1;background-color:rgb(34 197 94/var(--tw-bg-opacity,1))}.selection\:bg-brand-500::selection{--tw-bg-opacity:1;background-color:rgb(34 197 94/var(--tw-bg-opacity,1))}.selection\:text-white::-moz-selection{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.selection\:text-white::selection{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.first\:border-0:first-child{border-width:0}.hover\:bg-brand-500\/20:hover{background-color:rgba(34,197,94,.2)}.hover\:bg-brand-700:hover{--tw-bg-opacity:1;background-color:rgb(21 128 61/var(--tw-bg-opacity,1))}.hover\:bg-red-950:hover{--tw-bg-opacity:1;background-color:rgb(69 10 10/var(--tw-bg-opacity,1))}.hover\:bg-slate-700:hover{--tw-bg-opacity:1;background-color:rgb(51 65 85/var(--tw-bg-opacity,1))}.hover\:bg-slate-800:hover{--tw-bg-opacity:1;background-color:rgb(30 41 59/var(--tw-bg-opacity,1))}.hover\:bg-slate-950\/40:hover{background-color:rgba(2,6,23,.4)}.hover\:text-red-300:hover{--tw-text-opacity:1;color:rgb(252 165 165/var(--tw-text-opacity,1))}.hover\:text-white:hover{--tw-text-opacity:1;color:rgb(255 255 255/var(--tw-text-opacity,1))}.hover\:opacity-100:hover{opacity:1}.disabled\:cursor-not-allowed:disabled{cursor:not-allowed}.disabled\:opacity-40:disabled{opacity:.4}.disabled\:hover\:bg-brand-600:hover:disabled{--tw-bg-opacity:1;background-color:rgb(22 163 74/var(--tw-bg-opacity,1))}@media (min-width:640px){.sm\:flex{display:flex}.sm\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.sm\:grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.sm\:px-6{padding-left:1.5rem;padding-right:1.5rem}}@media (min-width:768px){.md\:inline{display:inline}}@media (min-width:1024px){.lg\:col-span-2{grid-column:span 2/span 2}.lg\:grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.lg\:grid-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}.lg\:grid-cols-6{grid-template-columns:repeat(6,minmax(0,1fr))}.lg\:px-8{padding-left:2rem;padding-right:2rem}}</style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen font-sans">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h1 class="text-xl font-bold text-white">Operator monitor</h1>
                <p class="text-xs text-slate-400">Backup jobs across all customers. Refreshes every 30 seconds.</p>
            </div>
            <div class="flex items-center gap-2">
                <input id="token" type="password" autocomplete="off" placeholder="Admin token" class="bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 w-56">
                <button id="btn-load" class="bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs px-4 py-2 rounded-xl">Load</button>
            </div>
        </div>
        <p id="msg" class="text-xs text-slate-400"></p>
        <div id="content" class="hidden space-y-6">
            <div id="sched-box" class="rounded-xl border px-4 py-3 text-sm"></div>
            <div class="grid grid-cols-2 lg:grid-cols-6 gap-3" id="cards"></div>
            <div>
                <h2 class="text-sm font-semibold text-white mb-2">Failing jobs</h2>
                <div class="overflow-x-auto bg-slate-900/60 border border-slate-800 rounded-2xl"><table class="w-full text-left text-xs" id="t-failing"></table></div>
            </div>
            <div>
                <h2 class="text-sm font-semibold text-white mb-2">Overdue (scheduled time passed, not started)</h2>
                <div class="overflow-x-auto bg-slate-900/60 border border-slate-800 rounded-2xl"><table class="w-full text-left text-xs" id="t-overdue"></table></div>
            </div>
            <div>
                <h2 class="text-sm font-semibold text-white mb-2">Running now</h2>
                <div class="overflow-x-auto bg-slate-900/60 border border-slate-800 rounded-2xl"><table class="w-full text-left text-xs" id="t-running"></table></div>
            </div>
        </div>
    </div>
    <script>
        var KEY = 'vb_admin_token';
        function $(id) { return document.getElementById(id); }
        function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
        function when(ms) { return ms ? new Date(ms).toLocaleString() : '-'; }
        function ago(ms) {
            var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
            if (s < 90) { return s + ' s ago'; }
            var m = Math.round(s / 60);
            if (m < 90) { return m + ' min ago'; }
            var h = Math.round(m / 60);
            return h < 48 ? h + ' h ago' : Math.round(h / 24) + ' days ago';
        }
        function card(label, value, tone) {
            var cls = tone === 'bad' ? 'text-red-300' : (tone === 'warn' ? 'text-amber-300' : 'text-white');
            return '<div class="bg-slate-900/60 border border-slate-800 rounded-2xl p-4"><p class="text-[11px] text-slate-400 uppercase tracking-wider">' + esc(label) + '</p><p class="text-2xl font-bold mt-1 ' + cls + '">' + esc(value) + '</p></div>';
        }
        function table(id, rows, extra) {
            var head = '<thead class="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-mono"><tr><th class="py-3 px-4">Customer</th><th class="py-3 px-4">Database</th><th class="py-3 px-4">Status</th><th class="py-3 px-4">In a row</th><th class="py-3 px-4">Last success</th><th class="py-3 px-4">' + extra + '</th></tr></thead>';
            var body = rows.length ? rows.map(function (r) {
                var last = extra === 'Last error' ? esc(r.lastError || '') : (extra === 'Was due' ? esc(when(r.nextRunAt)) : esc(when(r.lastBackupAt)));
                return '<tr class="border-t border-slate-800/60"><td class="py-3 px-4 text-slate-200">' + esc(r.customer) + '</td><td class="py-3 px-4 text-white">' + esc(r.database) + ' <span class="text-slate-500">(' + esc(r.provider) + ')</span></td><td class="py-3 px-4">' + esc(r.status) + '</td><td class="py-3 px-4">' + esc(r.failStreak) + '</td><td class="py-3 px-4 text-slate-400">' + esc(when(r.lastBackupAt)) + '</td><td class="py-3 px-4 text-slate-300 break-words max-w-md">' + last + '</td></tr>';
            }).join('') : '<tr><td class="py-4 px-4 text-slate-500" colspan="6">None</td></tr>';
            $(id).innerHTML = head + '<tbody>' + body + '</tbody>';
        }
        function render(d) {
            var t = d.totals, sch = d.scheduler;
            var stale = !sch || (d.now - sch.at) > 15 * 60 * 1000;
            var box = $('sched-box');
            box.className = 'rounded-xl border px-4 py-3 text-sm ' + (stale ? 'border-amber-700/60 bg-amber-950/60 text-amber-200' : 'border-emerald-800/60 bg-emerald-950/40 text-emerald-200');
            box.textContent = sch
                ? 'Scheduler last ran ' + ago(sch.at) + ' (source: ' + sch.src + ')' + (stale ? '. It has been silent for more than 15 minutes: scheduled backups are not starting.' : '. Healthy.')
                : 'The scheduler has never run. Add the Cron Trigger or ping /api/cron/tick.';
            var total24 = d.stats.today.s + d.stats.today.f;
            var rate = total24 ? Math.round(100 * d.stats.today.s / total24) + '%' : '-';
            $('cards').innerHTML = card('Customers', t.customers) + card('Databases', t.databases) + card('Healthy', t.healthy) +
                card('Failing', t.failing, t.failing ? 'bad' : '') + card('Overdue', t.overdue, t.overdue ? 'warn' : '') +
                card('Today ok / failed', d.stats.today.s + ' / ' + d.stats.today.f + ' (' + rate + ')', d.stats.today.f ? 'warn' : '');
            table('t-failing', d.failing, 'Last error');
            table('t-overdue', d.overdue, 'Was due');
            table('t-running', d.running, 'Last backup');
            $('content').classList.remove('hidden');
        }
        async function load() {
            var tok = $('token').value.trim() || sessionStorage.getItem(KEY) || '';
            if (!tok) { $('msg').textContent = 'Enter the admin token.'; return; }
            try {
                var r = await fetch('/api/admin/monitor', { headers: { Authorization: 'Bearer ' + tok } });
                if (r.status === 401 || r.status === 404) { $('msg').textContent = r.status === 401 ? 'Wrong admin token.' : 'Monitoring is off: set ADMIN_TOKEN (24+ characters).'; sessionStorage.removeItem(KEY); $('content').classList.add('hidden'); return; }
                var d = await r.json();
                sessionStorage.setItem(KEY, tok);
                $('token').value = '';
                $('msg').textContent = 'Updated ' + new Date().toLocaleTimeString();
                render(d);
            } catch (e) { $('msg').textContent = 'Could not load: ' + e.message; }
        }
        window.addEventListener('DOMContentLoaded', function () {
            $('btn-load').addEventListener('click', load);
            $('token').addEventListener('keydown', function (e) { if (e.key === 'Enter') { load(); } });
            if (sessionStorage.getItem(KEY)) { load(); }
            setInterval(function () { if (sessionStorage.getItem(KEY)) { load(); } }, 30000);
        });
    </script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------
const enc = new TextEncoder();
const dec = new TextDecoder();

const SESSION_TTL = 7 * 24 * 3600;
const AGENT_TOKEN_TTL = 365 * 24 * 3600; // long-lived tokens for desktop agents
const AGENT_OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000; // agent must re-check license within 72h
const LOCK_TTL = 900; // KV minimum is 60s
const MAX_DUMP_BYTES = 20 * 1024 * 1024;
const MAX_AGENT_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_AGENT_LOG_BATCH = 50;
// Subscription plans for product console + desktop agent entitlement
const PLANS = {
  // Free = 14-day trial: 1 online DB + 1 desktop agent, then must upgrade
  free: { id: "free", name: "Free (14-day trial)", agentSeats: 1, cloudDbSlots: 1, priceMonthly: 0, trialDays: 14 },
  pro: { id: "pro", name: "Pro", agentSeats: 5, cloudDbSlots: 5, priceMonthly: 19, trialDays: 0 },
  business: { id: "business", name: "Business", agentSeats: 25, cloudDbSlots: 50, priceMonthly: 49, trialDays: 0 },
};
const MAX_SUBREQUESTS = 900;
const ROWS_PER_PAGE = 1000;
const KEEP_BACKUPS_PER_DB = 30;
const MAX_DBS_PER_TENANT = 25;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_AGENTS_PER_TENANT = 50;
const LOG_ID_RE = /^\d{13}_[0-9a-f]{6}$/;
const DB_ID_RE = /^db_[0-9a-f-]{36}$/;

const SUPPORTED_PROVIDERS = ["PostgreSQL", "MySQL", "MariaDB", "MongoDB", "Redis", "CockroachDB", "Turso / SQLite"];
const SCHEDULES = ["Hourly", "Daily (@ 03:00 UTC)", "Weekly (Sundays)"];
const S3_PROVIDERS = ["BackblazeB2", "CloudflareR2", "AWSS3", "Wasabi", "CustomS3"];

const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8", ...SEC_HEADERS, ...extra },
  });
}

function getKV(env) {
  const KV = env.backup_kv || env.KV_STORE || env.KV;
  if (!KV) throw new HttpError(500, "KV Namespace binding 'backup_kv' not found in Cloudflare settings.");
  return KV;
}

async function readJson(request) {
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (len > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large.");
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
  return body;
}

function safeMessage(err) {
  return String((err && err.message) || err || "Unknown error").slice(0, 300);
}

function toHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
function randomHex(n) {
  return toHex(crypto.getRandomValues(new Uint8Array(n)));
}
function b64encode(bytes) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function b64decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256Hex(data) {
  const buf = typeof data === "string" ? enc.encode(data) : data;
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)));
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function sqlQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}
function quoteIdent(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Reverse timestamp so KV's lexicographic listing returns newest first
function revTs(ms) {
  return String(9999999999999 - ms).padStart(13, "0");
}

// ---------------------------------------------------------------------------
// SSRF guard & validation
// ---------------------------------------------------------------------------
function assertPublicHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  if (!h || h.length > 253) throw new HttpError(400, "Invalid host name.");
  if (h.includes(":") || h.startsWith("[")) throw new HttpError(400, "IPv6 literals are not allowed; use a host name.");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) {
    throw new HttpError(400, "Private host names are not allowed.");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) {
      throw new HttpError(400, "Private IP addresses are not allowed.");
    }
  }
  if (!/^[a-z0-9.-]+$/.test(h)) throw new HttpError(400, "Invalid host name.");
  return h;
}

function normalizeEndpoint(raw) {
  let s = String(raw || "").trim().replace(/^https?:\/\//i, "");
  s = s.split("/")[0].split("?")[0];
  return assertPublicHost(s);
}

function defaultRegion(provider, endpoint) {
  if (provider === "CloudflareR2") return "auto";
  const m = endpoint.match(/^s3[.-]([a-z0-9-]+)\.(?:amazonaws|backblazeb2|wasabisys)\.com$/);
  return m ? m[1] : "us-east-1";
}

// ---------------------------------------------------------------------------
// Crypto (server-side AES-256-GCM, keys derived from the ENCRYPTION_KEY secret)
// ---------------------------------------------------------------------------
const keyCache = new Map();

async function getKey(env, purpose) {
  const secret = env.ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new HttpError(500, "Server is missing the ENCRYPTION_KEY secret (minimum 32 characters).");
  }
  if (keyCache.has(purpose)) return keyCache.get(purpose);
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("vaultbackup-v2"), info: enc.encode(purpose) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  keyCache.set(purpose, key);
  return key;
}

async function encryptBytes(env, purpose, bytes, aad) {
  const key = await getKey(env, purpose);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params = { name: "AES-GCM", iv };
  if (aad) params.additionalData = enc.encode(aad); // binds the ciphertext to its record
  const ct = new Uint8Array(await crypto.subtle.encrypt(params, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

async function decryptBytes(env, purpose, data, aad) {
  const key = await getKey(env, purpose);
  const params = { name: "AES-GCM", iv: data.slice(0, 12) };
  if (aad) params.additionalData = enc.encode(aad);
  return new Uint8Array(await crypto.subtle.decrypt(params, key, data.slice(12)));
}

async function sealString(env, purpose, text, aad) {
  return "v2:" + b64encode(await encryptBytes(env, purpose, enc.encode(text), aad));
}
async function openString(env, purpose, sealed, aad) {
  if (typeof sealed !== "string" || !sealed.startsWith("v2:")) throw new Error("Stored secret has an unknown format.");
  return dec.decode(await decryptBytes(env, purpose, b64decode(sealed.slice(3)), aad));
}

// Removes secrets (connection string, password) from error text before it is shown or stored
function redactSecrets(msg, uri) {
  const secrets = new Set([uri]);
  try {
    const u = new URL(uri);
    if (u.password) {
      secrets.add(u.password);
      secrets.add(decodeURIComponent(u.password));
    }
    const t = u.searchParams.get("authToken");
    if (t) secrets.add(t);
  } catch {
    const m = String(uri).match(/^mongodb(?:\+srv)?:\/\/[^:@/]*:([^@/]*)@/);
    if (m) {
      secrets.add(m[1]);
      try {
        secrets.add(decodeURIComponent(m[1]));
      } catch {}
    }
  }
  let out = String(msg);
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("***");
  return out;
}

async function hashPassword(password, salt) {
  const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, km, 256));
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
async function rateLimit(KV, key, limit, ttl = 900) {
  const k = "rl:" + key;
  const n = parseInt((await KV.get(k)) || "0", 10);
  if (n >= limit) return false;
  await KV.put(k, String(n + 1), { expirationTtl: ttl });
  return true;
}

function normEmail(v) {
  const email = String(v || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new HttpError(400, "Enter a valid email address.");
  }
  return email;
}

async function createSession(KV, user) {
  const token = randomHex(32);
  const hash = await sha256Hex(token);
  await KV.put("session:" + hash, JSON.stringify({ tenantId: user.id, email: user.email, createdAt: Date.now() }), { expirationTtl: SESSION_TTL });
  await KV.put(`us:${user.id}:${hash}`, "1", { expirationTtl: SESSION_TTL });
  return token;
}

async function revokeAllSessions(KV, tenantId) {
  let cursor;
  do {
    const page = await KV.list({ prefix: `us:${tenantId}:`, cursor });
    for (const k of page.keys) {
      await KV.delete("session:" + k.name.split(":")[2]);
      await KV.delete(k.name);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
}

async function setPassword(KV, user, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  user.salt = b64encode(salt);
  user.hash = b64encode(await hashPassword(password, salt));
  await KV.put("user:" + user.email, JSON.stringify(user));
}

function checkNewPassword(p) {
  const password = String(p || "");
  if (password.length < 10 || password.length > 200) throw new HttpError(400, "Password must be 10 to 200 characters.");
  return password;
}

function mailConfigured(env) {
  return !!(env.RESEND_API_KEY && env.MAIL_FROM);
}

async function sendEmail(env, to, subject, text) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error("Email provider responded with HTTP " + res.status);
}

async function createResetToken(KV, email) {
  const token = randomHex(32);
  await KV.put("reset:" + (await sha256Hex(token)), JSON.stringify({ email, createdAt: Date.now() }), { expirationTtl: 1800 });
  return token;
}

function resetLink(env, url, token) {
  return `${String(env.PUBLIC_URL || url.origin).replace(/\/+$/, "")}/#reset=${token}`;
}

async function handleForgot(request, env, KV, ctx, url) {
  const body = await readJson(request);
  const email = normEmail(body.email);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateLimit(KV, "forgot:" + ip, 10)) || !(await rateLimit(KV, "forgot-e:" + email, 3))) {
    throw new HttpError(429, "Too many requests. Try again later.");
  }
  const reply = json({ success: true, message: "If an account exists for that email, a reset link has been sent." });
  if (!(await KV.get("user:" + email))) return reply;
  if (!mailConfigured(env)) {
    console.warn("Password reset requested but RESEND_API_KEY / MAIL_FROM are not set. Use /api/admin/reset-link.");
    return reply;
  }
  const link = resetLink(env, url, await createResetToken(KV, email));
  const app = env.APP_NAME || "VaultBackup";
  ctx.waitUntil(
    sendEmail(env, email, `Reset your ${app} password`, `Someone asked to reset the password for your ${app} account.\n\nOpen this link within 30 minutes to choose a new password:\n${link}\n\nIf you did not ask for this, you can ignore this email.`).catch((e) =>
      console.error("Reset email failed:", safeMessage(e))
    )
  );
  return reply;
}

async function handleReset(request, env, KV) {
  const body = await readJson(request);
  const token = String(body.token || "");
  const password = checkNewPassword(body.password);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateLimit(KV, "reset:" + ip, 20))) throw new HttpError(429, "Too many attempts. Try again later.");
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(400, "This reset link is invalid or has expired.");
  const key = "reset:" + (await sha256Hex(token));
  const raw = await KV.get(key);
  if (!raw) throw new HttpError(400, "This reset link is invalid or has expired.");
  const userRaw = await KV.get("user:" + JSON.parse(raw).email);
  if (!userRaw) throw new HttpError(400, "This reset link is invalid or has expired.");
  const user = JSON.parse(userRaw);
  await KV.delete(key); // single use
  await setPassword(KV, user, password);
  await revokeAllSessions(KV, user.id);
  return json({ success: true, token: await createSession(KV, user), email: user.email });
}

async function handleChangePassword(request, env, KV, session) {
  const body = await readJson(request);
  const newPassword = checkNewPassword(body.newPassword);
  if (!(await rateLimit(KV, "chpw:" + session.tenantId, 10))) throw new HttpError(429, "Too many attempts. Try again later.");
  const raw = await KV.get("user:" + session.email);
  if (!raw) throw new HttpError(401, "Account not found.");
  const user = JSON.parse(raw);
  const ok = timingSafeEqual(await hashPassword(String(body.currentPassword || "").slice(0, 200), b64decode(user.salt)), b64decode(user.hash));
  if (!ok) throw new HttpError(400, "Your current password is incorrect.");
  await setPassword(KV, user, newPassword);
  await revokeAllSessions(KV, user.id);
  return json({ success: true, token: await createSession(KV, user), email: user.email });
}

async function handleAdminResetLink(request, env, KV, url) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 24) throw new HttpError(404, "Endpoint not found.");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateLimit(KV, "admin:" + ip, 10))) throw new HttpError(429, "Too many attempts. Try again later.");
  const m = (request.headers.get("Authorization") || "").match(/^Bearer (.+)$/);
  const given = enc.encode(await sha256Hex(m ? m[1] : ""));
  if (!timingSafeEqual(given, enc.encode(await sha256Hex(env.ADMIN_TOKEN)))) throw new HttpError(401, "Invalid admin token.");
  const body = await readJson(request);
  const email = normEmail(body.email);
  if (!(await KV.get("user:" + email))) throw new HttpError(404, "No account with that email.");
  return json({ success: true, link: resetLink(env, url, await createResetToken(KV, email)), expiresInMinutes: 30 });
}

async function requireAuth(request, KV) {
  const m = (request.headers.get("Authorization") || "").match(/^Bearer ([a-f0-9]{64})$/i);
  if (!m) throw new HttpError(401, "Authentication required.");
  const token = m[1].toLowerCase();
  const hash = await sha256Hex(token);
  const sessionRaw = await KV.get("session:" + hash);
  if (sessionRaw) return { ...JSON.parse(sessionRaw), tokenHash: hash, kind: "session" };
  const agentRaw = await KV.get("agent:" + hash);
  if (agentRaw) {
    const agent = JSON.parse(agentRaw);
    // Touch last-seen without failing the request if KV write flakes
    try {
      agent.lastSeenAt = Date.now();
      await KV.put("agent:" + hash, JSON.stringify(agent), { expirationTtl: AGENT_TOKEN_TTL });
    } catch {}
    return { tenantId: agent.tenantId, email: agent.email, agentId: agent.id, agentName: agent.name, tokenHash: hash, kind: "agent" };
  }
  throw new HttpError(401, "Session expired. Please sign in again.");
}

// ---------------------------------------------------------------------------
// License server + desktop agents (config in KV, heartbeat, critical logs)
// Agent backs up & uploads on its own; Worker only licenses + stores config/logs.
// ---------------------------------------------------------------------------
async function loadUserByTenant(KV, tenantId, emailHint) {
  if (emailHint) {
    const raw = await KV.get("user:" + emailHint);
    if (raw) return JSON.parse(raw);
  }
  const email = await KV.get("userbyid:" + tenantId);
  if (email) {
    const raw = await KV.get("user:" + email);
    if (raw) return JSON.parse(raw);
  }
  return null;
}

function subscriptionOf(user) {
  const planId = (user && user.plan) || "free";
  const plan = PLANS[planId] || PLANS.free;
  const status = (user && user.subscriptionStatus) || "active";
  const exp = user && user.planExpiresAt;
  // Free trial and paid periods both honor planExpiresAt when set
  const expired = !!(exp && exp < Date.now());
  const active = status === "active" && !expired;
  const trialDaysLeft = exp && !expired ? Math.max(0, Math.ceil((exp - Date.now()) / 86400000)) : 0;
  return {
    plan: plan.id,
    planName: plan.name,
    status: expired ? "expired" : status,
    active,
    agentSeats: active ? plan.agentSeats : 0,
    cloudDbSlots: active ? plan.cloudDbSlots : 0,
    planExpiresAt: exp || null,
    trialDaysLeft: planId === "free" ? trialDaysLeft : null,
    offlineGraceHours: 72,
    isTrial: planId === "free",
  };
}

async function handleSubscriptionGet(KV, session) {
  const user = await loadUserByTenant(KV, session.tenantId, session.email);
  if (!user) throw new HttpError(404, "Account not found.");
  const sub = subscriptionOf(user);
  const agents = await listJson(KV, `agentmeta:${session.tenantId}:`, MAX_AGENTS_PER_TENANT);
  return json({
    success: true,
    email: user.email,
    subscription: sub,
    agentsUsed: agents.length,
    agentsRemaining: Math.max(0, sub.agentSeats - agents.length),
    plans: Object.values(PLANS),
  });
}

// Console / admin-style plan change (set via ADMIN_TOKEN or self-serve placeholder)
async function handleSubscriptionSet(request, env, KV, session) {
  if (session.kind === "agent") throw new HttpError(403, "Not allowed.");
  const body = await readJson(request);
  const planId = String(body.plan || "").toLowerCase();
  if (!PLANS[planId]) throw new HttpError(400, "Unknown plan. Use free, pro, or business.");
  // Paid upgrades in production should go through Stripe/etc. Here: allow if ADMIN_TOKEN matches, or free plan always.
  if (planId !== "free") {
    const m = (request.headers.get("X-Admin-Token") || "").trim();
    if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 24 || !m) {
      throw new HttpError(402, "Paid plan changes require billing integration or X-Admin-Token.");
    }
    if (!timingSafeEqual(enc.encode(await sha256Hex(m)), enc.encode(await sha256Hex(env.ADMIN_TOKEN)))) {
      throw new HttpError(401, "Invalid admin token.");
    }
  }
  const user = await loadUserByTenant(KV, session.tenantId, session.email);
  if (!user) throw new HttpError(404, "Account not found.");
  user.plan = planId;
  user.subscriptionStatus = "active";
  if (planId === "free") {
    user.planExpiresAt = Date.now() + 14 * 86400000; // restart 14-day trial
    user.trialStartedAt = Date.now();
  } else {
    user.planExpiresAt = Date.now() + 30 * 86400000; // billing period placeholder until Stripe
  }
  await KV.put("user:" + user.email, JSON.stringify(user));
  await KV.put("userbyid:" + user.id, user.email);
  return json({ success: true, subscription: subscriptionOf(user) });
}

function normalizeAgentStatus(raw) {
  if (!raw || typeof raw !== "object") return null;
  const num = (v, lo, hi) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (lo != null && n < lo) return lo;
    if (hi != null && n > hi) return hi;
    return n;
  };
  const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
  let dbs = [];
  if (Array.isArray(raw.dbs)) {
    dbs = raw.dbs.slice(0, 20).map((d) => {
      if (!d || typeof d !== "object") return null;
      return {
        name: str(d.name, 64) || "db",
        engine: str(d.engine || d.provider, 32) || "",
        status: str(d.status, 24) || "unknown",
        sizeMb: num(d.sizeMb, 0, 1e9),
      };
    }).filter(Boolean);
  }
  const status = {
    reportedAt: Date.now(),
    hostname: str(raw.hostname, 128) || null,
    os: str(raw.os || raw.platform, 64) || null,
    osVersion: str(raw.osVersion || raw.version, 64) || null,
    arch: str(raw.arch, 32) || null,
    agentVersion: str(raw.agentVersion || raw.versionAgent, 32) || null,
    cpuPercent: num(raw.cpuPercent != null ? raw.cpuPercent : raw.cpu, 0, 100),
    cpuCores: num(raw.cpuCores, 0, 512),
    memUsedMb: num(raw.memUsedMb != null ? raw.memUsedMb : raw.ramUsedMb, 0, 1e9),
    memTotalMb: num(raw.memTotalMb != null ? raw.memTotalMb : raw.ramTotalMb, 0, 1e9),
    diskUsedGb: num(raw.diskUsedGb, 0, 1e6),
    diskTotalGb: num(raw.diskTotalGb, 0, 1e6),
    uptimeSec: num(raw.uptimeSec, 0, 1e12),
    dbs,
  };
  // Drop empty-ish payload
  if (!status.os && status.cpuPercent == null && status.memTotalMb == null && !status.dbs.length && !status.hostname) {
    return null;
  }
  return status;
}

async function persistAgentStatus(KV, session, status) {
  if (!status) return;
  try {
    const raw = await KV.get("agent:" + session.tokenHash);
    if (!raw) return;
    const agent = JSON.parse(raw);
    agent.lastSeenAt = Date.now();
    agent.status = status;
    await KV.put("agent:" + session.tokenHash, JSON.stringify(agent), { expirationTtl: AGENT_TOKEN_TTL });
    try {
      const mk = `agentmeta:${session.tenantId}:${session.agentId}`;
      const metaRaw = await KV.get(mk);
      if (metaRaw) {
        const meta = JSON.parse(metaRaw);
        meta.lastSeenAt = agent.lastSeenAt;
        meta.status = status;
        await KV.put(mk, JSON.stringify(meta), { expirationTtl: AGENT_TOKEN_TTL });
      }
    } catch {}
  } catch (e) {
    console.error("persistAgentStatus:", safeMessage(e));
  }
}

async function handleAgentTokenCreate(request, env, KV, session) {
  if (session.kind === "agent") throw new HttpError(403, "Agent tokens cannot create other agent tokens.");
  const user = await loadUserByTenant(KV, session.tenantId, session.email);
  const sub = subscriptionOf(user);
  if (!sub.active) throw new HttpError(402, "Subscription inactive. Renew to register desktop agents.");
  if (sub.agentSeats <= 0) {
    throw new HttpError(402, "Your Free plan does not include desktop agents. Upgrade to Pro or Business.");
  }
  const body = await readJson(request);
  const name = String(body.name || "desktop-agent").trim().slice(0, 64) || "desktop-agent";
  const existing = await KV.list({ prefix: `agentmeta:${session.tenantId}:`, limit: MAX_AGENTS_PER_TENANT + 1 });
  if (existing.keys.length >= sub.agentSeats) {
    throw new HttpError(400, `Plan allows ${sub.agentSeats} desktop agent(s). Revoke one or upgrade.`);
  }
  const id = "ag_" + randomHex(8);
  const token = randomHex(32);
  const hash = await sha256Hex(token);
  const rec = {
    id,
    tenantId: session.tenantId,
    email: session.email,
    name,
    tokenHash: hash,
    createdAt: Date.now(),
    lastSeenAt: null,
    lastLicenseOkAt: null,
  };
  await KV.put("agent:" + hash, JSON.stringify(rec), { expirationTtl: AGENT_TOKEN_TTL });
  await KV.put(
    `agentmeta:${session.tenantId}:${id}`,
    JSON.stringify({ id, name, tokenHash: hash, createdAt: rec.createdAt }),
    { expirationTtl: AGENT_TOKEN_TTL }
  );
  // Empty config shell in KV (agent will PUT full config after install)
  await KV.put(
    `agentcfg:${session.tenantId}:${id}`,
    JSON.stringify({ agentId: id, name, updatedAt: Date.now(), config: null }),
    { expirationTtl: AGENT_TOKEN_TTL }
  );
  return json({
    success: true,
    id,
    name,
    token,
    expiresInDays: 365,
    offlineGraceHours: 72,
    message: "Store this token on the agent. Backups run independently; the agent only phones home for license checks.",
  }, 201);
}

async function handleAgentTokenList(KV, session) {
  if (session.kind === "agent") throw new HttpError(403, "Not allowed.");
  const metas = await listJson(KV, `agentmeta:${session.tenantId}:`, MAX_AGENTS_PER_TENANT);
  const out = [];
  for (const m of metas) {
    let lastSeenAt = null;
    let lastLicenseOkAt = null;
    try {
      const raw = await KV.get("agent:" + m.tokenHash);
      if (raw) {
        const a = JSON.parse(raw);
        lastSeenAt = a.lastSeenAt || null;
        lastLicenseOkAt = a.lastLicenseOkAt || null;
      }
    } catch {}
    let boundDevice = m.boundDevice || null;
    let boundAt = m.boundAt || null;
    try {
      const raw2 = await KV.get("agent:" + m.tokenHash);
      if (raw2) {
        const a2 = JSON.parse(raw2);
        boundDevice = a2.boundDevice || boundDevice;
        boundAt = a2.boundAt || boundAt;
      }
    } catch {}
    let status = null;
    try {
      const rawS = await KV.get("agent:" + m.tokenHash);
      if (rawS) {
        const aS = JSON.parse(rawS);
        status = aS.status || m.status || null;
        if (!lastSeenAt) lastSeenAt = aS.lastSeenAt || null;
      } else if (m.status) {
        status = m.status;
      }
    } catch {}
    out.push({ id: m.id, name: m.name, createdAt: m.createdAt, lastSeenAt, lastLicenseOkAt, boundDevice, boundAt, status });
  }
  out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return json({ success: true, agents: out });
}

async function handleAgentTokenDelete(KV, session, agentId) {
  if (session.kind === "agent") throw new HttpError(403, "Not allowed.");
  if (!/^ag_[0-9a-f]{16}$/.test(agentId)) throw new HttpError(404, "Agent not found.");
  const metaKey = `agentmeta:${session.tenantId}:${agentId}`;
  const raw = await KV.get(metaKey);
  if (!raw) throw new HttpError(404, "Agent not found.");
  const meta = JSON.parse(raw);
  if (meta.tokenHash) await KV.delete("agent:" + meta.tokenHash);
  await KV.delete(metaKey);
  await KV.delete(`agentcfg:${session.tenantId}:${agentId}`);
  return json({ success: true });
}

// Agent heartbeat: must succeed at least once every 72h or the agent stops backups locally.
async function handleAgentLicenseCheck(request, env, KV, session) {
  if (session.kind !== "agent") throw new HttpError(403, "Use an agent token.");
  const user = await loadUserByTenant(KV, session.tenantId, session.email);
  const sub = subscriptionOf(user);
  let allowed = sub.active && sub.agentSeats > 0;
  let reason = allowed ? null : sub.agentSeats <= 0 ? "plan_has_no_agent_seats" : "subscription_inactive";
  const now = Date.now();
  const dev = (request.headers.get("X-VaultBackup-Device") || "").trim().slice(0, 64);
  let bodyStatus = null;
  try {
    const cl = parseInt(request.headers.get("Content-Length") || "0", 10);
    const ct = (request.headers.get("Content-Type") || "").toLowerCase();
    if (cl > 0 || ct.includes("application/json")) {
      let body = {};
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      if (body && typeof body === "object" && !Array.isArray(body)) {
        if (body.status) bodyStatus = normalizeAgentStatus(body.status);
        else if (body.metrics) bodyStatus = normalizeAgentStatus(body.metrics);
        else if (body.os || body.cpuPercent != null || body.memTotalMb != null || body.dbs || body.hostname)
          bodyStatus = normalizeAgentStatus(body);
      }
    }
  } catch {}

  // One token ↔ one machine: bind on first successful check; reject other devices.
  try {
    const raw = await KV.get("agent:" + session.tokenHash);
    if (raw) {
      const agent = JSON.parse(raw);
      agent.lastSeenAt = now;
      if (bodyStatus) agent.status = bodyStatus;

      if (allowed && dev) {
        if (!agent.boundDevice) {
          // First activation on this seat
          agent.boundDevice = dev;
          agent.boundAt = now;
        } else if (agent.boundDevice !== dev) {
          allowed = false;
          reason = "token_bound_to_another_device";
        }
      } else if (allowed && !dev) {
        // Require fingerprint so tokens cannot be shared blindly
        allowed = false;
        reason = "device_fingerprint_required";
      }

      if (allowed) {
        agent.lastLicenseOkAt = now;
        agent.lastDevice = dev;
      }
      // Always record the attempted device for audit
      agent.lastAttemptDevice = dev || null;
      agent.lastAttemptAt = now;
      agent.lastDenyReason = allowed ? null : reason;

      await KV.put("agent:" + session.tokenHash, JSON.stringify(agent), { expirationTtl: AGENT_TOKEN_TTL });

      // Mirror bind info on meta for console list
      try {
        const mk = `agentmeta:${session.tenantId}:${session.agentId}`;
        const metaRaw = await KV.get(mk);
        if (metaRaw) {
          const meta = JSON.parse(metaRaw);
          meta.boundDevice = agent.boundDevice || null;
          meta.boundAt = agent.boundAt || null;
          meta.lastSeenAt = now;
          if (agent.status) meta.status = agent.status;
          await KV.put(mk, JSON.stringify(meta), { expirationTtl: AGENT_TOKEN_TTL });
        }
      } catch {}
    }
  } catch {}

  let remoteConfig = null;
  let desired = null;
  try {
    const cfgRaw = await KV.get(`agentcfg:${session.tenantId}:${session.agentId}`);
    if (cfgRaw) {
      const parsed = JSON.parse(cfgRaw);
      remoteConfig = parsed.config || null;
      desired = parsed.desired || null;
    }
  } catch {}

  return json({
    success: true,
    allowed,
    reason,
    subscription: sub,
    agentId: session.agentId,
    agentName: session.agentName,
    serverTime: now,
    offlineGraceMs: AGENT_OFFLINE_GRACE_MS,
    offlineGraceHours: 72,
    nextCheckSuggestedMs: 24 * 60 * 60 * 1000,
    config: remoteConfig,
    desired: desired,
    deviceBound: allowed,
  });
}

/** Lightweight realtime heartbeat: OS / CPU / RAM / local DB status (agent token only). */
async function handleAgentStatus(request, env, KV, session) {
  if (session.kind !== "agent") throw new HttpError(403, "Use an agent token.");
  const body = await readJson(request);
  const status = normalizeAgentStatus(body.status || body);
  if (!status) throw new HttpError(400, "Send status fields: os, cpuPercent, memUsedMb, memTotalMb, dbs, hostname.");
  await persistAgentStatus(KV, session, status);
  return json({ success: true, receivedAt: status.reportedAt });
}

/** Console: clear device bind so token can be moved to a new machine (still one device after next check). */
async function handleAgentUnbind(KV, session, agentId) {
  if (session.kind === "agent") throw new HttpError(403, "Not allowed.");
  if (!/^ag_[0-9a-f]{16}$/.test(agentId)) throw new HttpError(404, "Agent not found.");
  const metaKey = `agentmeta:${session.tenantId}:${agentId}`;
  const metaRaw = await KV.get(metaKey);
  if (!metaRaw) throw new HttpError(404, "Agent not found.");
  const meta = JSON.parse(metaRaw);
  if (meta.tokenHash) {
    const raw = await KV.get("agent:" + meta.tokenHash);
    if (raw) {
      const agent = JSON.parse(raw);
      delete agent.boundDevice;
      delete agent.boundAt;
      agent.lastDevice = null;
      await KV.put("agent:" + meta.tokenHash, JSON.stringify(agent), { expirationTtl: AGENT_TOKEN_TTL });
    }
  }
  meta.boundDevice = null;
  meta.boundAt = null;
  await KV.put(metaKey, JSON.stringify(meta), { expirationTtl: AGENT_TOKEN_TTL });
  return json({ success: true, message: "Device binding cleared. Next agent check will bind the new machine." });
}

async function handleAgentConfigPut(request, env, KV, session) {
  const body = await readJson(request);
  let agentId = session.kind === "agent" ? session.agentId : String(body.agentId || "").trim();
  let agentName = session.kind === "agent" ? session.agentName : "";
  if (session.kind !== "agent") {
    if (!/^ag_[0-9a-f]{16}$/.test(agentId)) throw new HttpError(400, "agentId required.");
    const meta = await KV.get(`agentmeta:${session.tenantId}:${agentId}`);
    if (!meta) throw new HttpError(404, "Agent not found.");
    agentName = JSON.parse(meta).name || agentId;
  }
  const safe = body.config != null ? sanitizeAgentConfigForKv(body.config) : null;
  const desired = body.desired && typeof body.desired === "object" ? {
    schedule: body.desired.schedule ? String(body.desired.schedule).slice(0, 64) : undefined,
    backup_type: body.desired.backup_type ? String(body.desired.backup_type).toLowerCase().slice(0, 32) : undefined,
    retention: body.desired.retention != null ? Number(body.desired.retention) : undefined,
    jobs: Array.isArray(body.desired.jobs) ? body.desired.jobs.slice(0, 12) : undefined,
    enabled: body.desired.enabled === false ? false : true,
  } : undefined;
  const prevRaw = await KV.get(`agentcfg:${session.tenantId}:${agentId}`);
  const prev = prevRaw ? JSON.parse(prevRaw) : {};
  const payload = {
    agentId,
    name: agentName || prev.name,
    updatedAt: Date.now(),
    config: safe != null ? safe : (prev.config || null),
    desired: desired !== undefined ? desired : (prev.desired || null),
  };
  await KV.put(`agentcfg:${session.tenantId}:${agentId}`, JSON.stringify(payload), { expirationTtl: AGENT_TOKEN_TTL });
  return json({ success: true, updatedAt: payload.updatedAt, desired: payload.desired });
}

async function handleAgentConfigGet(KV, session, agentId) {
  const id = session.kind === "agent" ? session.agentId : agentId;
  if (!id || !/^ag_[0-9a-f]{16}$/.test(id)) throw new HttpError(404, "Agent not found.");
  if (session.kind !== "agent") {
    // session user must own the agent
    const meta = await KV.get(`agentmeta:${session.tenantId}:${id}`);
    if (!meta) throw new HttpError(404, "Agent not found.");
  } else if (id !== session.agentId) {
    throw new HttpError(403, "Not your agent.");
  }
  const raw = await KV.get(`agentcfg:${session.tenantId}:${id}`);
  if (!raw) return json({ success: true, config: null });
  return json({ success: true, ...JSON.parse(raw) });
}

function sanitizeAgentConfigForKv(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  const out = JSON.parse(JSON.stringify(cfg));
  if (out.database && out.database.uri) out.database.uri = maskUri(String(out.database.uri));
  if (out.destination) {
    if (out.destination.s3_secret_key) out.destination.s3_secret_key = "********";
    if (out.destination.s3_access_key) out.destination.s3_access_key = String(out.destination.s3_access_key).slice(0, 4) + "********";
    if (out.destination.vault_token) out.destination.vault_token = "********";
  }
  if (out.encryption_key) out.encryption_key = "********";
  return out;
}

// Critical logs only (agent keeps full logs locally)
async function handleAgentLogsPush(request, env, KV, session) {
  if (session.kind !== "agent") throw new HttpError(403, "Use an agent token.");
  const body = await readJson(request);
  const entries = Array.isArray(body.logs) ? body.logs.slice(0, MAX_AGENT_LOG_BATCH) : [];
  if (!entries.length) return json({ success: true, stored: 0 });
  const now = Date.now();
  let stored = 0;
  for (const e of entries) {
    const level = String(e.level || "error").toLowerCase();
    if (level !== "error" && level !== "critical" && level !== "fatal") continue;
    const id = `${revTs(now)}_${randomHex(3)}`;
    const row = {
      id,
      agentId: session.agentId,
      agentName: session.agentName,
      level,
      message: String(e.message || "").slice(0, 500),
      at: Number(e.at) || now,
      receivedAt: now,
    };
    await KV.put(`agentlog:${session.tenantId}:${id}`, JSON.stringify(row), { expirationTtl: 14 * 86400 });
    stored++;
  }
  return json({ success: true, stored });
}

async function handleAgentLogsList(KV, session) {
  if (session.kind === "agent") throw new HttpError(403, "Not allowed.");
  const logs = await listJson(KV, `agentlog:${session.tenantId}:`, 100);
  logs.sort((a, b) => (b.at || 0) - (a.at || 0));
  return json({ success: true, logs });
}

async function handleAgentUpload(request, env, KV, session) {
  // Desktop agent: POST raw gzip body, already dumped on the machine.
  const len = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (len > MAX_AGENT_UPLOAD_BYTES) throw new HttpError(413, `Upload too large (max ${MAX_AGENT_UPLOAD_BYTES} bytes).`);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (!buf.length) throw new HttpError(400, "Empty upload body.");
  if (buf.length > MAX_AGENT_UPLOAD_BYTES) throw new HttpError(413, `Upload too large (max ${MAX_AGENT_UPLOAD_BYTES} bytes).`);

  const tenantId = session.tenantId;
  const filename = String(request.headers.get("X-VaultBackup-Filename") || "").replace(/[^\w.\-]+/g, "_").slice(0, 180) || `agent-${Date.now()}.gz`;
  const engine = String(request.headers.get("X-VaultBackup-Engine") || "files").toLowerCase().slice(0, 32);
  let ext = String(request.headers.get("X-VaultBackup-Ext") || "sql.gz").replace(/[^\w.]+/g, "").slice(0, 16) || "sql.gz";
  if (!ext.includes(".")) ext = ext + ".gz";
  const agentLabel = session.agentName || session.email || "desktop-agent";
  const dbName = String(request.headers.get("X-VaultBackup-DB-Name") || agentLabel).trim().slice(0, 64) || agentLabel;

  // Optional: attach to an existing dashboard database record
  let dbId = String(request.headers.get("X-VaultBackup-DB-ID") || "").trim();
  let provider = "Desktop Agent";
  if (dbId) {
    if (!DB_ID_RE.test(dbId)) throw new HttpError(400, "Invalid database ID.");
    const raw = await KV.get(`db:${tenantId}:${dbId}`);
    if (!raw) throw new HttpError(404, "Database not found.");
    const db = JSON.parse(raw);
    provider = db.provider || provider;
  } else {
    dbId = "agent_" + (session.agentId || randomHex(8));
  }

  const storage = await getStorage(env, KV, tenantId);
  const startedAt = Date.now();
  const logId = `${revTs(startedAt)}_${randomHex(3)}`;
  const objectKey = `backups/${tenantId}/${dbId}/${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}-full.${ext}.enc`;

  const sealed = await encryptBytes(env, `backup:${tenantId}`, buf, objectKey);
  await storage.put(objectKey, sealed);
  const checksum = await sha256Hex(sealed);
  const finishedAt = Date.now();

  const log = {
    id: logId,
    dbId,
    dbName,
    provider,
    trigger: "agent",
    jobId: null,
    jobName: session.agentName || "Desktop agent",
    requestedType: "full",
    type: "full",
    promoted: null,
    baseId: null,
    chainId: logId,
    seq: 0,
    hasManifest: false,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    status: "Success",
    size: sealed.length,
    rawBytes: buf.length,
    checksum,
    objectKey,
    ext,
    storageMode: storage.mode,
    storageId: storage.id,
    bucket: storage.label,
    tables: null,
    error: null,
    agentId: session.agentId || null,
    filename,
    engine,
  };
  await KV.put(`log:${tenantId}:${logId}`, JSON.stringify(log));
  await bumpStat(KV, true);

  // If attached to a real DB record, update last backup fields
  if (DB_ID_RE.test(dbId)) {
    try {
      const raw = await KV.get(`db:${tenantId}:${dbId}`);
      if (raw) {
        const d = JSON.parse(raw);
        d.lastBackupAt = finishedAt;
        d.lastSize = sealed.length;
        d.status = "Healthy";
        d.failStreak = 0;
        d.lastError = null;
        await KV.put(`db:${tenantId}:${dbId}`, JSON.stringify(d));
      }
    } catch {}
  }

  return json({
    success: true,
    backupId: logId,
    size: sealed.length,
    rawBytes: buf.length,
    checksum: checksum.slice(0, 16),
    objectKey,
    message: "Agent backup stored.",
  }, 201);
}

async function handleRegister(request, env, KV) {
  if (env.ALLOW_REGISTRATION === "false") throw new HttpError(403, "Registration is disabled.");
  const body = await readJson(request);
  const email = normEmail(body.email);
  const password = String(body.password || "");
  if (password.length < 10 || password.length > 200) throw new HttpError(400, "Password must be 10 to 200 characters.");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateLimit(KV, "reg:" + ip, 10))) throw new HttpError(429, "Too many attempts. Try again later.");
  if (await KV.get("user:" + email)) throw new HttpError(409, "An account with this email already exists.");

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt);
  const user = {
    id: crypto.randomUUID(),
    email,
    salt: b64encode(salt),
    hash: b64encode(hash),
    createdAt: Date.now(),
    // Free plan is a 14-day trial (1 online DB + 1 agent). After expiry, upgrade to Pro/Business.
    plan: "free",
    planExpiresAt: Date.now() + 14 * 86400000,
    subscriptionStatus: "active",
    trialStartedAt: Date.now(),
  };
  await KV.put("user:" + email, JSON.stringify(user));
  await KV.put("userbyid:" + user.id, email); // reverse lookup for agents
  const token = await createSession(KV, user);
  return json({ success: true, token, email, plan: user.plan });
}

async function handleLogin(request, env, KV) {
  const body = await readJson(request);
  const email = normEmail(body.email);
  const password = String(body.password || "").slice(0, 200);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateLimit(KV, "login:" + ip + ":" + email, 10))) throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");

  const raw = await KV.get("user:" + email);
  const user = raw ? JSON.parse(raw) : null;
  const salt = user ? b64decode(user.salt) : crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt); // always hash, so timing doesn't reveal unknown emails
  if (!user || !timingSafeEqual(hash, b64decode(user.hash))) throw new HttpError(401, "Invalid email or password.");
  const token = await createSession(KV, user);
  return json({ success: true, token, email: user.email });
}

// ---------------------------------------------------------------------------
// S3 (SigV4) client for BYOB storage
// ---------------------------------------------------------------------------
async function hmacRaw(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
async function sigKey(secret, date, region, service) {
  let k = await hmacRaw(enc.encode("AWS4" + secret), date);
  k = await hmacRaw(k, region);
  k = await hmacRaw(k, service);
  return hmacRaw(k, "aws4_request");
}
function awsEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function s3Path(cfg, key) {
  return "/" + awsEncode(cfg.bucketName) + "/" + key.split("/").map(awsEncode).join("/");
}
function amzDates(d = new Date()) {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

async function s3Fetch(cfg, method, key, body) {
  const host = cfg.endpoint;
  const path = s3Path(cfg, key);
  const { amzDate, dateStamp } = amzDates();
  const payloadHash = await sha256Hex(body || new Uint8Array(0));
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  const signature = toHex(await hmacRaw(await sigKey(cfg.secretAccessKey, dateStamp, cfg.region, "s3"), stringToSign));
  return netFetch(`https://${host}${path}`, {
    method,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
    body: body || undefined,
  });
}

async function s3Presign(cfg, key, expires = 900) {
  const host = cfg.endpoint;
  const path = s3Path(cfg, key);
  const { amzDate, dateStamp } = amzDates();
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  };
  const qs = Object.keys(params).sort().map((k) => `${awsEncode(k)}=${awsEncode(params[k])}`).join("&");
  const canonicalRequest = ["GET", path, qs, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  const signature = toHex(await hmacRaw(await sigKey(cfg.secretAccessKey, dateStamp, cfg.region, "s3"), stringToSign));
  return `https://${host}${path}?${qs}&X-Amz-Signature=${signature}`;
}

const MASK = "********";
const URI_USERINFO = /^([a-z][a-z0-9+.-]*:\/\/[^:@/?#]*:)([^@/?#]*)@/i;
const URI_SECRET_PARAMS = ["authToken", "password", "sslpassword", "token"];

// Shows a connection string with its secrets hidden (password and token parameters)
function maskUri(uri) {
  let out = String(uri).replace(URI_USERINFO, (m, a) => a + MASK + "@");
  for (const p of URI_SECRET_PARAMS) out = out.replace(new RegExp("([?&]" + p + "=)[^&#]*", "gi"), (m, a) => a + MASK);
  return out;
}

// Puts the saved secrets back into a masked string the user edited
function unmaskUri(edited, stored) {
  if (!edited.includes(MASK)) return edited;
  let out = edited;
  const em = out.match(URI_USERINFO);
  const sm = stored.match(URI_USERINFO);
  if (em && em[2] === MASK && sm) out = out.replace(URI_USERINFO, (m, a) => a + sm[2] + "@");
  for (const p of URI_SECRET_PARAMS) {
    const re = new RegExp("([?&]" + p + "=)([^&#]*)", "i");
    const found = out.match(re);
    if (found && found[2] === MASK) {
      const old = stored.match(re);
      if (old) out = out.replace(re, (m, a) => a + old[2]);
    }
  }
  if (out.includes(MASK)) throw new HttpError(400, "The password is hidden as ********. Keep it only if the saved password should be reused; otherwise type the real one in its place.");
  return out;
}

async function netFetch(url, init) {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error("Could not reach the storage endpoint (" + new URL(url).hostname + "). Check the endpoint host name.");
  }
}

async function s3Error(res, action) {
  let text = "";
  try {
    text = await res.text();
  } catch {}
  const code = (text.match(/<Code>([^<]+)<\/Code>/) || [])[1] || "";
  const hints = {
    InvalidAccessKeyId: "The access key ID is not recognised by this provider.",
    SignatureDoesNotMatch: "The secret key or the region is wrong.",
    NoSuchBucket: "The bucket does not exist. Check the bucket name and the endpoint.",
    AccessDenied: "The key cannot use this bucket. It needs read, write and delete permission.",
    InvalidBucketName: "The bucket name is not valid.",
    PermanentRedirect: "Wrong endpoint or region for this bucket.",
    AuthorizationHeaderMalformed: "The region does not match the endpoint.",
    RequestTimeTooSkewed: "The server clock differs from the provider clock.",
  };
  let hint = hints[code];
  if (!hint) {
    if (res.status === 401 || res.status === 403) hint = "Check the key ID, secret key and bucket permissions.";
    else if (res.status === 404) hint = "Bucket or endpoint not found.";
    else if (res.status === 301 || res.status === 307) hint = "Wrong endpoint or region for this bucket.";
    else hint = "";
  }
  return new Error(`Storage ${action} failed (HTTP ${res.status}${code ? " " + code : ""}). ${hint}`.trim());
}

// ---------------------------------------------------------------------------
// Storage abstraction// ---------------------------------------------------------------------------
// Storage abstraction: R2 (managed) or S3-compatible (BYOB)
// ---------------------------------------------------------------------------
function managedAllowed(env) {
  return !!env.BACKUP_BUCKET && env.REQUIRE_BYOB !== "true";
}

async function loadStorageConfig(env, KV, tenantId) {
  const raw = await KV.get(`cfg:${tenantId}:storage`);
  if (raw) return JSON.parse(raw);
  return { mode: managedAllowed(env) ? "MANAGED" : "NONE" };
}

function makeS3Storage(full) {
  return {
    mode: "BYOB",
    id: full.id || "legacy",
    label: full.bucketName,
    async put(key, bytes) {
      const res = await s3Fetch(full, "PUT", key, bytes);
      if (!res.ok) throw await s3Error(res, "upload");
    },
    async get(key) {
      const res = await s3Fetch(full, "GET", key);
      if (res.status === 404) return null;
      if (!res.ok) throw await s3Error(res, "download");
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      const res = await s3Fetch(full, "DELETE", key);
      if (!res.ok && res.status !== 404) throw await s3Error(res, "delete");
    },
    presign: (key) => s3Presign(full, key, 900),
  };
}

function makeR2Storage(bucket) {
  return {
    mode: "MANAGED",
    id: "managed",
    label: "managed-r2",
    async put(key, bytes) {
      await bucket.put(key, bytes);
    },
    async get(key) {
      const obj = await bucket.get(key);
      return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
    },
    async delete(key) {
      await bucket.delete(key);
    },
    presign: null,
  };
}

async function getStorage(env, KV, tenantId, storageId) {
  let cfg;
  if (storageId && storageId !== "managed" && storageId !== "legacy") {
    const rawCfg = await KV.get(`stg:${tenantId}:${storageId}`);
    if (!rawCfg) throw new HttpError(404, "The storage target that holds this backup is no longer available.");
    cfg = JSON.parse(rawCfg);
  } else if (storageId === "managed") {
    cfg = { mode: "MANAGED" };
  } else {
    cfg = await loadStorageConfig(env, KV, tenantId);
  }
  if (cfg.mode === "BYOB") {
    if (!cfg.verifiedAt) throw new HttpError(400, "Your storage target has not passed its connection test. Re-save it in Storage Backend.");
    return makeS3Storage({
      ...cfg,
      accessKeyId: await openString(env, `secret:${tenantId}`, cfg.keySealed, `storage-key:${tenantId}`),
      secretAccessKey: await openString(env, `secret:${tenantId}`, cfg.secretSealed, `storage-secret:${tenantId}`),
    });
  }
  if (cfg.mode === "MANAGED") {
    if (!managedAllowed(env)) throw new HttpError(400, "Platform managed storage is not available. Bring your own S3 or B2 bucket.");
    return makeR2Storage(env.BACKUP_BUCKET);
  }
  throw new HttpError(400, "Set up and test your storage target first (Storage Backend).");
}

// Writes, reads back and deletes a random probe object. Throws HttpError(400) on any failure.
async function verifyStorage(storage, tenantId) {
  const key = `backups/${tenantId}/.vaultbackup-test-${randomHex(6)}`;
  const probe = crypto.getRandomValues(new Uint8Array(32));
  let wrote = false;
  try {
    await storage.put(key, probe);
    wrote = true;
    const back = await storage.get(key);
    if (!back || !timingSafeEqual(back, probe)) throw new Error("The bucket returned different data than was written.");
    await storage.delete(key);
    wrote = false;
  } catch (e) {
    if (wrote) {
      try {
        await storage.delete(key);
      } catch {}
    }
    throw new HttpError(400, "Storage test failed: " + safeMessage(e));
  }
}

// Validates the form input and builds the record to store plus a ready-to-test storage client
async function resolveStorageInput(env, tenantId, body, existing) {
  if (body.mode === "MANAGED") {
    if (!managedAllowed(env)) throw new HttpError(400, "Platform managed storage is not available on this service. Bring your own S3 or B2 bucket.");
    return { stored: { mode: "MANAGED", id: "managed" }, storage: makeR2Storage(env.BACKUP_BUCKET) };
  }
  if (body.mode !== "BYOB") throw new HttpError(400, "Choose a storage mode.");

  const provider = String(body.provider || "");
  if (!S3_PROVIDERS.includes(provider)) throw new HttpError(400, "Unknown storage provider.");
  const endpoint = normalizeEndpoint(body.endpoint);
  const bucketName = String(body.bucketName || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,61}[a-zA-Z0-9]$/.test(bucketName)) throw new HttpError(400, "Enter a valid bucket name.");
  const region = String(body.region || "").trim() || defaultRegion(provider, endpoint);
  if (!/^[a-z0-9-]{2,30}$/.test(region)) throw new HttpError(400, "Enter a valid region.");

  const prev = existing && existing.mode === "BYOB" ? existing : null;
  let accessKeyId = String(body.accessKeyId || "").trim();
  let secretAccessKey = String(body.secretAccessKey || "").trim();
  let keySealed;
  let secretSealed;
  if (accessKeyId) {
    if (!/^[A-Za-z0-9_\-/+=.]{4,128}$/.test(accessKeyId)) throw new HttpError(400, "Enter a valid access key ID.");
    keySealed = await sealString(env, `secret:${tenantId}`, accessKeyId, `storage-key:${tenantId}`);
  } else if (prev) {
    keySealed = prev.keySealed;
    accessKeyId = await openString(env, `secret:${tenantId}`, prev.keySealed, `storage-key:${tenantId}`);
  } else throw new HttpError(400, "Enter the access key ID.");
  if (secretAccessKey) {
    if (secretAccessKey.length < 8 || secretAccessKey.length > 256) throw new HttpError(400, "Enter a valid secret access key.");
    secretSealed = await sealString(env, `secret:${tenantId}`, secretAccessKey, `storage-secret:${tenantId}`);
  } else if (prev) {
    secretSealed = prev.secretSealed;
    secretAccessKey = await openString(env, `secret:${tenantId}`, prev.secretSealed, `storage-secret:${tenantId}`);
  } else throw new HttpError(400, "Enter the secret access key.");

  // Same endpoint + bucket + region = same target (credential rotation). Anything else is a new target.
  const sameTarget = prev && prev.id && prev.endpoint === endpoint && prev.bucketName === bucketName && prev.region === region;
  const id = sameTarget ? prev.id : randomHex(6);
  return {
    stored: { mode: "BYOB", id, provider, endpoint, region, bucketName, keySealed, secretSealed, keyHint: accessKeyId.slice(0, 4) + "..." + accessKeyId.slice(-4) },
    storage: makeS3Storage({ mode: "BYOB", id, provider, endpoint, region, bucketName, accessKeyId, secretAccessKey }),
  };
}

async function handleStorage(request, env, KV, tenantId) {
  const cfgKey = `cfg:${tenantId}:storage`;
  const existing = await loadStorageConfig(env, KV, tenantId);
  if (request.method === "GET") {
    return json({
      success: true,
      config: {
        mode: existing.mode,
        provider: existing.provider,
        endpoint: existing.endpoint,
        region: existing.region,
        bucketName: existing.bucketName,
        keyHint: existing.keyHint,
        hasSecret: !!existing.secretSealed,
        verifiedAt: existing.verifiedAt || null,
        managedAllowed: managedAllowed(env),
        archived: (await listJson(KV, `stg:${tenantId}:`, 20))
          .filter((c) => c.id !== existing.id)
          .map((c) => ({ id: c.id, provider: c.provider, bucketName: c.bucketName, keyHint: c.keyHint, verifiedAt: c.verifiedAt })),
      },
    });
  }
  const body = await readJson(request);
  const { stored, storage } = await resolveStorageInput(env, tenantId, body, existing);
  await verifyStorage(storage, tenantId); // nothing is saved unless this passes
  stored.verifiedAt = Date.now();
  await KV.put(cfgKey, JSON.stringify(stored));
  if (stored.id !== "managed") await KV.put(`stg:${tenantId}:${stored.id}`, JSON.stringify(stored)); // kept so older backups stay reachable
  return json({ success: true, message: "Storage test passed (write, read back, delete). Target saved." });
}

async function handleStorageTest(request, env, KV, tenantId) {
  const body = await readJson(request);
  const existing = await loadStorageConfig(env, KV, tenantId);
  const storage = body.mode ? (await resolveStorageInput(env, tenantId, body, existing)).storage : await getStorage(env, KV, tenantId);
  await verifyStorage(storage, tenantId);
  return json({ success: true, message: "Storage test passed (write, read back, delete)." });
}

// ---------------------------------------------------------------------------
// Generic KV list helper
// ---------------------------------------------------------------------------
async function listJson(KV, prefix, max = 100) {
  const out = [];
  let cursor;
  do {
    const page = await KV.list({ prefix, cursor, limit: Math.min(max, 1000) });
    const vals = await Promise.all(page.keys.map((k) => KV.get(k.name)));
    for (const v of vals) {
      if (!v) continue;
      try {
        out.push(JSON.parse(v));
      } catch {}
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < max);
  return out.slice(0, max);
}

function publicJob(j) {
  return {
    id: j.id,
    name: j.name,
    type: j.type,
    typeLabel: TYPE_LABELS[j.type] || j.type,
    schedule: j.schedule,
    scheduleText: scheduleText(j.schedule),
    enabled: j.enabled !== false,
    retry: j.retry || { max: 0 },
    nextRunAt: j.nextRunAt || null,
    retryAt: j.retryKey ? parseInt(j.retryKey.slice(4, 17), 10) : null,
    retryAttempt: j.retryAttempt || 0,
    lastRunAt: j.lastRunAt || null,
    lastStatus: j.lastStatus || null,
    lastError: j.lastError || null,
  };
}

function publicDb(db) {
  let status = db.status;
  if (status === "Running" && Date.now() - (db.runningSince || 0) > LOCK_TTL * 1000) status = "Failed";
  const jobs = (db.jobs || []).map(publicJob);
  return {
    id: db.id,
    name: db.name,
    provider: db.provider,
    service: db.service || "",
    maskedUri: db.maskedUri || "",
    types: supportedTypes(db.provider),
    jobs,
    schedule: jobs[0] ? jobs[0].schedule : null,
    scheduleText: jobs[0] ? jobs[0].scheduleText : "",
    nextRunAt: dbNextRun(db),
    retention: db.retention || DEFAULT_RETENTION,
    retentionText: retentionText(db.retention || DEFAULT_RETENTION),
    failStreak: db.failStreak || 0,
    lastFailureAt: db.lastFailureAt || null,
    status,
    lastBackupAt: db.lastBackupAt || null,
    lastSize: db.lastSize || 0,
    lastError: db.lastError || null,
    createdAt: db.createdAt,
  };
}

function publicLog(l) {
  return {
    id: l.id,
    dbId: l.dbId,
    dbName: l.dbName,
    provider: l.provider,
    trigger: l.trigger,
    jobId: l.jobId || null,
    jobName: l.jobName || "",
    requestedType: l.requestedType || "full",
    type: l.type || "full",
    typeLabel: TYPE_LABELS[l.type || "full"] || l.type,
    promoted: l.promoted || null,
    baseId: l.baseId || null,
    chainId: l.chainId || null,
    seq: l.seq || 0,
    startedAt: l.startedAt,
    finishedAt: l.finishedAt,
    durationMs: l.durationMs || 0,
    status: l.status,
    size: l.size,
    rawBytes: l.rawBytes || 0,
    ext: l.ext || "sql.gz",
    storageMode: l.storageMode,
    bucket: l.bucket,
    tables: l.tables || null,
    checksum: l.checksum ? l.checksum.slice(0, 16) : null,
    error: l.error,
  };
}

// ---------------------------------------------------------------------------
// Database dump engines
// ---------------------------------------------------------------------------
class DumpWriter {
  constructor() {
    this.chunks = [];
    this.bytes = 0;
  }
  writeBytes(b) {
    this.bytes += b.length;
    if (this.bytes > MAX_DUMP_BYTES) throw new Error("Database is larger than the 20 MB limit for a single Worker backup.");
    this.chunks.push(b);
  }
  write(s) {
    this.writeBytes(enc.encode(s));
  }
  toBytes() {
    const out = new Uint8Array(this.bytes);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

function spend(budget) {
  if (++budget.n > MAX_SUBREQUESTS) throw new Error("Too many requests for one backup run. The database is too large for this Worker.");
}

// ----- Turso / libSQL (HTTP) -----
function parseTurso(uri) {
  let u;
  try {
    u = new URL(uri.replace(/^libsql:/i, "https:"));
  } catch {
    throw new HttpError(400, "Invalid Turso connection string.");
  }
  if (u.protocol !== "https:") throw new HttpError(400, "Use a libsql:// or https:// Turso URL.");
  const host = assertPublicHost(u.hostname);
  const token = u.searchParams.get("authToken") || decodeURIComponent(u.password || "");
  if (!token) throw new HttpError(400, "Turso URL must include ?authToken=...");
  return { base: "https://" + host, token };
}

async function tursoExec(conn, sql, budget) {
  spend(budget);
  const res = await fetch(conn.base + "/v2/pipeline", {
    method: "POST",
    headers: { Authorization: "Bearer " + conn.token, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ type: "execute", stmt: { sql } }, { type: "close" }] }),
  });
  if (!res.ok) throw new Error("Turso responded with HTTP " + res.status);
  const data = await res.json();
  const r = data.results && data.results[0];
  if (!r || r.type !== "ok") throw new Error("Turso query failed: " + ((r && r.error && r.error.message) || "unknown error"));
  return r.response.result;
}

function libsqlLiteral(v) {
  switch (v && v.type) {
    case "integer":
      return String(v.value);
    case "float":
      return Number.isFinite(Number(v.value)) ? String(v.value) : "NULL";
    case "text":
      return sqlQuote(v.value);
    case "blob":
      return "X'" + toHex(b64decode(v.base64)) + "'";
    default:
      return "NULL";
  }
}

async function dumpTurso(uri, w, opts = {}) {
  const conn = parseTurso(uri);
  const budget = { n: 0 };
  const lg = opts.log || NOLOG;
  const type = opts.type === "schema" ? "schema" : "full";
  w.write(`-- VaultBackup ${type} backup (SQLite / libSQL)\nPRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n`);

  const schema = await tursoExec(
    conn,
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream_%' AND name NOT LIKE 'libsql_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, name",
    budget
  );
  const entries = schema.rows.map((r) => ({ type: r[0].value, name: r[1].value, sql: r[2].value }));
  const detail = [];
  let rowsTotal = 0;
  lg.add("info", `Connected to Turso; ${entries.filter((e) => e.type === "table").length} tables found`);

  for (const t of entries.filter((e) => e.type === "table")) {
    w.write(t.sql + ";\n");
    if (type === "schema") continue;
    const before = w.bytes;
    let tableRows = 0;
    for (let offset = 0; ; offset += ROWS_PER_PAGE) {
      const res = await tursoExec(conn, `SELECT * FROM ${quoteIdent(t.name)} LIMIT ${ROWS_PER_PAGE} OFFSET ${offset}`, budget);
      const cols = res.cols.map((c) => quoteIdent(c.name)).join(", ");
      for (const row of res.rows) {
        w.write(`INSERT INTO ${quoteIdent(t.name)} (${cols}) VALUES (${row.map(libsqlLiteral).join(", ")});\n`);
      }
      tableRows += res.rows.length;
      if (res.rows.length < ROWS_PER_PAGE) break;
    }
    rowsTotal += tableRows;
    lg.add("info", `${t.name}: ${tableRows} rows, ${w.bytes - before} bytes`);
    if (detail.length < 100) detail.push({ name: t.name, rows: tableRows, bytes: w.bytes - before });
  }
  for (const e of entries.filter((x) => x.type !== "table")) w.write(e.sql + ";\n");
  w.write("COMMIT;\n");
  const total = entries.filter((e) => e.type === "table").length;
  return { type, manifest: null, tables: { total, included: type === "schema" ? 0 : total, rows: rowsTotal, detail } };
}

// ----- TCP plumbing (Cloudflare Workers sockets) -----
function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      t = setTimeout(() => rej(new Error(what + " timed out.")), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

function concatBytes(list) {
  let n = 0;
  for (const a of list) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of list) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
function i32be(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, false);
  return b;
}
function i32le(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, true);
  return b;
}
function u32le(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}
function cstr(s) {
  return concatBytes([enc.encode(s), new Uint8Array(1)]);
}

class TcpConn {
  static async open(host, port, mode) {
    const socket = connect({ hostname: host, port }, { secureTransport: mode, allowHalfOpen: false });
    await withTimeout(socket.opened, 15000, "Connecting to the database");
    return new TcpConn(socket);
  }
  constructor(socket) {
    this.socket = socket;
    this.seq = -1; // used by the MySQL driver
    this._init();
  }
  _init() {
    this.reader = this.socket.readable.getReader();
    this.writer = this.socket.writable.getWriter();
    this.q = [];
    this.qLen = 0;
    this.head = 0;
  }
  async _pull() {
    const { value, done } = await withTimeout(this.reader.read(), 60000, "Database read");
    if (done) throw new Error("The database server closed the connection.");
    this.q.push(value);
    this.qLen += value.length;
  }
  _take(n) {
    const out = new Uint8Array(n);
    let o = 0;
    while (o < n) {
      const c = this.q[0];
      const k = Math.min(c.length - this.head, n - o);
      out.set(c.subarray(this.head, this.head + k), o);
      o += k;
      this.head += k;
      if (this.head === c.length) {
        this.q.shift();
        this.head = 0;
      }
    }
    this.qLen -= n;
    return out;
  }
  async readExact(n) {
    while (this.qLen < n) await this._pull();
    return this._take(n);
  }
  async readLine() {
    for (;;) {
      let prev = -1;
      let count = 0;
      for (let ci = 0; ci < this.q.length; ci++) {
        const c = this.q[ci];
        for (let i = ci === 0 ? this.head : 0; i < c.length; i++) {
          count++;
          if (prev === 13 && c[i] === 10) {
            const b = this._take(count);
            return b.subarray(0, count - 2);
          }
          prev = c[i];
        }
      }
      await this._pull();
    }
  }
  async write(bytes) {
    await withTimeout(this.writer.write(bytes), 30000, "Database write");
  }
  startTls(hostname) {
    this.reader.releaseLock();
    this.writer.releaseLock();
    this.socket = this.socket.startTls({ expectedServerHostname: hostname });
    this._init();
  }
  close() {
    try {
      this.writer.releaseLock();
    } catch {}
    try {
      const p = this.socket.close();
      if (p && p.catch) p.catch(() => {});
    } catch {}
  }
}

class ByteReader {
  constructor(b) {
    this.b = b;
    this.o = 0;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  u8() {
    return this.b[this.o++];
  }
  u16() {
    const v = this.dv.getUint16(this.o, true);
    this.o += 2;
    return v;
  }
  u32() {
    const v = this.dv.getUint32(this.o, true);
    this.o += 4;
    return v;
  }
  bytes(n) {
    const v = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return v;
  }
  cstr() {
    let e = this.o;
    while (e < this.b.length && this.b[e] !== 0) e++;
    const s = dec.decode(this.b.subarray(this.o, e));
    this.o = e + 1;
    return s;
  }
  lenenc() {
    const f = this.b[this.o++];
    if (f < 0xfb) return f;
    if (f === 0xfb) return null;
    if (f === 0xfc) return this.u16();
    if (f === 0xfd) {
      const v = this.b[this.o] | (this.b[this.o + 1] << 8) | (this.b[this.o + 2] << 16);
      this.o += 3;
      return v;
    }
    const lo = this.u32();
    const hi = this.u32();
    return hi * 4294967296 + lo;
  }
  lenencBytes() {
    const n = this.lenenc();
    return n === null ? null : this.bytes(n);
  }
}

function parseDbUrl(uri, schemes, defaultPort) {
  let u;
  try {
    u = new URL(uri);
  } catch {
    throw new HttpError(400, "That connection string is not a valid URL.");
  }
  if (!schemes.includes(u.protocol)) {
    throw new HttpError(400, "The connection string must start with " + schemes.map((s) => s + "//").join(" or ") + ".");
  }
  const host = assertPublicHost(u.hostname);
  const port = u.port ? parseInt(u.port, 10) : defaultPort;
  if (!(port > 0 && port < 65536) || port === 25) throw new HttpError(400, "Invalid port.");
  let user = "";
  let password = "";
  let database = "";
  try {
    user = decodeURIComponent(u.username || "");
    password = decodeURIComponent(u.password || "");
    database = decodeURIComponent((u.pathname || "").replace(/^\//, ""));
  } catch {
    throw new HttpError(400, "The connection string has invalid percent-encoding.");
  }
  return { host, port, user, password, database, params: u.searchParams, protocol: u.protocol };
}

// ----- SCRAM (PostgreSQL / CockroachDB / MongoDB) -----
async function pbkdf2Bytes(hash, password, salt, iterations, bits) {
  const km = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash, salt, iterations }, km, bits));
}
async function hmacH(hash, key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, typeof data === "string" ? enc.encode(data) : data));
}
async function hashH(hash, data) {
  return new Uint8Array(await crypto.subtle.digest(hash, typeof data === "string" ? enc.encode(data) : data));
}
async function md5Hex(s) {
  return toHex(new Uint8Array(await crypto.subtle.digest("MD5", typeof s === "string" ? enc.encode(s) : s)));
}
function parseScramAttrs(s) {
  const o = {};
  for (const part of s.split(",")) {
    const i = part.indexOf("=");
    if (i > 0) o[part.slice(0, i)] = part.slice(i + 1);
  }
  return o;
}

class Scram {
  constructor(hash, user, passwordBytes) {
    this.hash = hash;
    this.password = passwordBytes;
    this.nonce = b64encode(crypto.getRandomValues(new Uint8Array(18)));
    this.bare = `n=${user.replace(/=/g, "=3D").replace(/,/g, "=2C")},r=${this.nonce}`;
  }
  first() {
    return "n,," + this.bare;
  }
  async final(serverFirst) {
    const a = parseScramAttrs(serverFirst);
    if (a.e) throw new Error("SCRAM authentication failed: " + a.e);
    if (!a.r || !a.r.startsWith(this.nonce) || !a.s || !a.i) throw new Error("SCRAM authentication failed: bad server challenge.");
    const bits = this.hash === "SHA-1" ? 160 : 256;
    const salted = await pbkdf2Bytes(this.hash, this.password, b64decode(a.s), parseInt(a.i, 10), bits);
    const clientKey = await hmacH(this.hash, salted, "Client Key");
    const storedKey = await hashH(this.hash, clientKey);
    const noProof = "c=biws,r=" + a.r;
    const authMessage = this.bare + "," + serverFirst + "," + noProof;
    const sig = await hmacH(this.hash, storedKey, authMessage);
    const proof = new Uint8Array(clientKey.length);
    for (let i = 0; i < proof.length; i++) proof[i] = clientKey[i] ^ sig[i];
    const serverKey = await hmacH(this.hash, salted, "Server Key");
    this.expected = b64encode(await hmacH(this.hash, serverKey, authMessage));
    return noProof + ",p=" + b64encode(proof);
  }
  verify(serverFinal) {
    const a = parseScramAttrs(serverFinal);
    if (a.e) throw new Error("SCRAM authentication failed: " + a.e);
    if (a.v !== this.expected) throw new Error("SCRAM authentication failed: server signature mismatch.");
  }
}

// ----- PostgreSQL / CockroachDB (native wire protocol over TCP) -----
function parsePg(uri, flavor) {
  const c = parseDbUrl(uri, ["postgres:", "postgresql:"], flavor === "cockroach" ? 26257 : 5432);
  if (!c.user) throw new HttpError(400, "The connection string needs a user name.");
  const mode = (c.params.get("sslmode") || "require").toLowerCase();
  if (!["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(mode)) throw new HttpError(400, "Unknown sslmode.");
  c.ssl = !(mode === "disable" || mode === "allow");
  c.options = c.params.get("options") || "";
  c.flavor = flavor;
  return c;
}

async function pgSend(conn, type, body) {
  const head = new Uint8Array(5);
  head[0] = type.charCodeAt(0);
  new DataView(head.buffer).setInt32(1, body.length + 4, false);
  await conn.write(concatBytes([head, body]));
}
async function pgReadMsg(conn) {
  const h = await conn.readExact(5);
  const len = new DataView(h.buffer, h.byteOffset, 5).getInt32(1, false) - 4;
  const body = len > 0 ? await conn.readExact(len) : new Uint8Array(0);
  return { type: String.fromCharCode(h[0]), body };
}
function pgError(body) {
  let o = 0;
  let msg = "";
  let detail = "";
  while (o < body.length && body[o] !== 0) {
    const t = String.fromCharCode(body[o++]);
    let e = o;
    while (body[e] !== 0) e++;
    const val = dec.decode(body.subarray(o, e));
    o = e + 1;
    if (t === "M") msg = val;
    if (t === "D") detail = val;
  }
  return new Error("PostgreSQL: " + (msg || "unknown error") + (detail ? " (" + detail + ")" : ""));
}

async function pgConnect(c) {
  const conn = await TcpConn.open(c.host, c.port, c.ssl ? "starttls" : "off");
  try {
    if (c.ssl) {
      await conn.write(concatBytes([i32be(8), i32be(80877103)]));
      const r = await conn.readExact(1);
      if (r[0] !== 0x53) throw new Error("The server does not support TLS. Use ?sslmode=disable only if you accept an unencrypted connection.");
      conn.startTls(c.host);
    }
    const kv = ["user", c.user, "database", c.database || c.user];
    if (c.options) kv.push("options", c.options);
    const startup = concatBytes([i32be(196608), enc.encode(kv.join("\0") + "\0\0")]);
    await conn.write(concatBytes([i32be(startup.length + 4), startup]));

    let scram = null;
    for (;;) {
      const m = await pgReadMsg(conn);
      if (m.type === "E") throw pgError(m.body);
      if (m.type === "Z") break;
      if (m.type !== "R") continue;
      const code = new DataView(m.body.buffer, m.body.byteOffset, m.body.byteLength).getInt32(0, false);
      if (code === 0) continue;
      if (code === 3) {
        await pgSend(conn, "p", cstr(c.password));
      } else if (code === 5) {
        const salt = m.body.subarray(4, 8);
        const inner = await md5Hex(c.password + c.user);
        const outer = await md5Hex(concatBytes([enc.encode(inner), salt]));
        await pgSend(conn, "p", cstr("md5" + outer));
      } else if (code === 10) {
        scram = new Scram("SHA-256", "", enc.encode(c.password));
        const first = enc.encode(scram.first());
        await pgSend(conn, "p", concatBytes([cstr("SCRAM-SHA-256"), i32be(first.length), first]));
      } else if (code === 11) {
        await pgSend(conn, "p", enc.encode(await scram.final(dec.decode(m.body.subarray(4)))));
      } else if (code === 12) {
        scram.verify(dec.decode(m.body.subarray(4)));
      } else {
        throw new Error("Unsupported PostgreSQL authentication method (code " + code + ").");
      }
    }
    return conn;
  } catch (e) {
    conn.close();
    throw e;
  }
}

async function pgQuery(conn, sql) {
  await pgSend(conn, "Q", cstr(sql));
  let fields = [];
  const rows = [];
  let err = null;
  for (;;) {
    const m = await pgReadMsg(conn);
    if (m.type === "T") {
      const dv = new DataView(m.body.buffer, m.body.byteOffset, m.body.byteLength);
      const n = dv.getInt16(0, false);
      let o = 2;
      fields = [];
      for (let i = 0; i < n; i++) {
        let e = o;
        while (m.body[e] !== 0) e++;
        fields.push({ name: dec.decode(m.body.subarray(o, e)) });
        o = e + 1 + 18;
      }
    } else if (m.type === "D") {
      const dv = new DataView(m.body.buffer, m.body.byteOffset, m.body.byteLength);
      const n = dv.getInt16(0, false);
      let o = 2;
      const row = [];
      for (let i = 0; i < n; i++) {
        const len = dv.getInt32(o, false);
        o += 4;
        if (len < 0) row.push(null);
        else {
          row.push(dec.decode(m.body.subarray(o, o + len)));
          o += len;
        }
      }
      rows.push(row);
    } else if (m.type === "E") {
      err = pgError(m.body);
    } else if (m.type === "Z") {
      break;
    }
  }
  if (err) throw err;
  return { fields, rows };
}

// Compares the current manifest with the base backup's. Returns the changed tables, or why a full backup is needed.
function compareManifests(base, cur) {
  if (!base || base.v !== 1 || base.e !== cur.e || !base.t) return { reason: "the base backup's change manifest is not usable" };
  if (base.g !== cur.g) return { reason: "enums, sequences or views changed" };
  const bn = Object.keys(base.t);
  const cn = Object.keys(cur.t);
  const added = cn.filter((n) => !(n in base.t));
  const removed = bn.filter((n) => !(n in cur.t));
  if (added.length || removed.length) return { reason: `tables were added or removed (${[...added.map((n) => "+" + n), ...removed.map((n) => "-" + n)].slice(0, 5).join(", ")})` };
  const schemaChanged = cn.filter((n) => base.t[n].s !== cur.t[n].s);
  if (schemaChanged.length) return { reason: `the structure of ${schemaChanged.slice(0, 3).join(", ")} changed` };
  return { changed: cn.filter((n) => base.t[n].d !== cur.t[n].d) };
}

const shortHash = async (text) => (await sha256Hex(text)).slice(0, 16);

async function pgDumpTableRows(q, t, w, lg, detail) {
  const before = w.bytes;
  let rows = 0;
  await q(`DECLARE vb_cur CURSOR FOR SELECT * FROM ${t.q}`);
  for (;;) {
    const res = await q(`FETCH ${ROWS_PER_PAGE} FROM vb_cur`);
    const names = res.fields.map((f) => quoteIdent(f.name)).join(", ");
    for (const row of res.rows) {
      w.write(`INSERT INTO ${t.q} (${names}) VALUES (${row.map((v) => (v === null ? "NULL" : sqlQuote(v))).join(", ")});\n`);
    }
    rows += res.rows.length;
    if (res.rows.length < ROWS_PER_PAGE) break;
  }
  await q("CLOSE vb_cur");
  lg.add("info", `${t.q}: ${rows} rows, ${w.bytes - before} bytes`);
  if (detail.length < 100) detail.push({ name: t.q, rows, bytes: w.bytes - before });
  return rows;
}

async function dumpPostgres(uri, w, flavor, opts = {}) {
  const c = parsePg(uri, flavor);
  const conn = await pgConnect(c);
  const lg = opts.log || NOLOG;
  const q = (sql, params) => pgQuery(conn, params ? sql.replace(/\$(\d+)/g, (_, n) => sqlQuote(params[n - 1])) : sql);
  try {
    const crdb = flavor === "cockroach";
    let type = opts.type || "full";
    lg.add("info", `Connected to ${crdb ? "CockroachDB" : "PostgreSQL"}`);
    w.write(`-- VaultBackup ${type} backup (${crdb ? "CockroachDB" : "PostgreSQL"})\n`);
    if (!crdb) w.write("-- Includes enums, sequences, tables, data, constraints, indexes, views. Excludes functions, triggers, extensions, ownership and grants.\n");
    await q(crdb ? "BEGIN READ ONLY" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

    const tables = (
      await q(
        crdb
          ? "SELECT table_schema, table_name FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema','crdb_internal','pg_extension') ORDER BY 1, 2"
          : "SELECT n.nspname, c.relname, c.oid::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' ORDER BY 1, 2"
      )
    ).rows.map((r) => ({ schema: r[0], name: r[1], oid: r[2], q: quoteIdent(r[0]) + "." + quoteIdent(r[1]) }));
    lg.add("info", `${tables.length} tables found`);
    const detail = [];
    const withData = () => type === "full" || type === "incremental" || type === "differential";

    // ---------- CockroachDB: DDL comes from SHOW CREATE ALL TABLES (full and schema only) ----------
    if (crdb) {
      const deferred = [];
      w.write("BEGIN;\n");
      const ddl = (await q("SHOW CREATE ALL TABLES")).rows.map((r) => r[0].trim().replace(/;+$/, ""));
      for (const s of ddl) {
        if (/^CREATE /i.test(s)) w.write(s + ";\n");
        else deferred.push(s + ";\n");
      }
      let rowsTotal = 0;
      if (type === "full") for (const t of tables) rowsTotal += await pgDumpTableRows(q, t, w, lg, detail);
      for (const line of deferred) w.write(line);
      await q("COMMIT");
      w.write("COMMIT;\n");
      try {
        await pgSend(conn, "X", new Uint8Array(0));
      } catch {}
      return { type, manifest: null, tables: { total: tables.length, included: type === "full" ? tables.length : 0, rows: rowsTotal, detail } };
    }

    // ---------- PostgreSQL: introspect first, then write according to the backup type ----------
    const schemas = [...new Set(tables.map((t) => t.schema))].filter((s) => s !== "public");
    const enums = new Map();
    for (const r of (
      await q(
        "SELECT n.nspname, t.typname, e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') ORDER BY n.nspname, t.typname, e.enumsortorder"
      )
    ).rows) {
      const k = quoteIdent(r[0]) + "." + quoteIdent(r[1]);
      if (!enums.has(k)) enums.set(k, []);
      enums.get(k).push(sqlQuote(r[2]));
    }
    const seqs = (
      await q(
        "SELECT schemaname, sequencename, start_value, increment_by, min_value, max_value, cycle, last_value FROM pg_sequences WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1, 2"
      )
    ).rows;
    const views = (await q("SELECT schemaname, viewname, definition FROM pg_views WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1, 2")).rows;

    for (const t of tables) {
      const cols = (
        await q(
          "SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
          [t.q]
        )
      ).rows;
      const cons = (await q("SELECT conname, contype, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY contype, conname", [t.q])).rows;
      const lines = cols.map((col) => `  ${quoteIdent(col[0])} ${col[1]}${col[3] ? " DEFAULT " + col[3] : ""}${col[2] === "t" ? " NOT NULL" : ""}`);
      t.fks = [];
      for (const k of cons) {
        if (k[1] === "f") t.fks.push(`ALTER TABLE ${t.q} ADD CONSTRAINT ${quoteIdent(k[0])} ${k[2]};\n`);
        else lines.push(`  CONSTRAINT ${quoteIdent(k[0])} ${k[2]}`);
      }
      t.create = `CREATE TABLE ${t.q} (\n${lines.join(",\n")}\n);\n`;
      t.idx = (
        await q(
          "SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE conrelid = $3::regclass)",
          [t.schema, t.name, t.q]
        )
      ).rows.map((i) => i[0] + ";\n");
      t.schemaFp = await shortHash(t.create + t.idx.join("") + t.fks.join(""));
    }
    const globalFp = await shortHash(JSON.stringify([[...enums.entries()], seqs.map((s) => s.slice(0, 7)), views]));

    // ---------- change detection (inside the database: no row data leaves it) ----------
    let manifest = null;
    let note = null;
    let changed = null;
    if (type === "incremental" || type === "differential" || (type === "full" && opts.wantManifest)) {
      manifest = { v: 1, e: "pg", g: globalFp, t: {} };
      for (const t of tables) {
        const r = await q(`SELECT count(*)::text || ':' || coalesce(sum(hashtextextended(vb_row::text, 0)::numeric), 0)::text FROM ${t.q} vb_row`);
        manifest.t[t.q] = { s: t.schemaFp, d: r.rows[0][0] };
      }
      lg.add("info", `Fingerprinted ${tables.length} tables`);
      if (type !== "full") {
        const cmp = compareManifests(opts.baseManifest, manifest);
        if (cmp.reason) {
          note = cmp.reason;
          type = "full";
        } else {
          changed = new Set(cmp.changed);
          lg.add("info", `${changed.size} of ${tables.length} tables changed since the base backup${changed.size ? ": " + [...changed].slice(0, 8).join(", ") : ""}`);
        }
      }
    }

    const writeSequences = () => {
      for (const s of seqs) {
        if (s[7] !== null) w.write(`SELECT setval(${sqlQuote(quoteIdent(s[0]) + "." + quoteIdent(s[1]))}, ${s[7]}, true);\n`);
      }
    };

    if (changed) {
      // ---- incremental / differential: data of the changed tables only ----
      const ct = tables.filter((t) => changed.has(t.q));
      const oids = new Map(tables.map((t) => [t.oid, t]));
      const changedOids = new Set(ct.map((t) => t.oid));
      w.write(`-- ${type} backup: data of ${ct.length} changed table${ct.length === 1 ? "" : "s"} out of ${tables.length}. Apply after the base backup (see the restore order in the job log).\n`);
      w.write("BEGIN;\n");
      const fkAll = (await q("SELECT conrelid::text, conname, pg_get_constraintdef(oid), confrelid::text FROM pg_constraint WHERE contype = 'f'")).rows.filter(
        (f) => oids.has(f[0]) && (changedOids.has(f[0]) || changedOids.has(f[3]))
      );
      for (const f of fkAll) w.write(`ALTER TABLE ${oids.get(f[0]).q} DROP CONSTRAINT ${quoteIdent(f[1])};\n`);
      for (const t of ct) {
        w.write(`TRUNCATE ${t.q};\n`);
        await pgDumpTableRows(q, t, w, lg, detail);
      }
      writeSequences();
      for (const f of fkAll) w.write(`ALTER TABLE ${oids.get(f[0]).q} ADD CONSTRAINT ${quoteIdent(f[1])} ${f[2]};\n`);
      await q("COMMIT");
      w.write("COMMIT;\n");
      try {
        await pgSend(conn, "X", new Uint8Array(0));
      } catch {}
      return { type, manifest, note, tables: { total: tables.length, included: ct.length, detail } };
    }

    // ---- full / schema ----
    w.write("BEGIN;\n");
    for (const s of schemas) w.write(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(s)};\n`);
    for (const [k, labels] of enums) w.write(`CREATE TYPE ${k} AS ENUM (${labels.join(", ")});\n`);
    for (const s of seqs) {
      const sq = quoteIdent(s[0]) + "." + quoteIdent(s[1]);
      w.write(`CREATE SEQUENCE IF NOT EXISTS ${sq} START WITH ${s[2]} INCREMENT BY ${s[3]} MINVALUE ${s[4]} MAXVALUE ${s[5]}${s[6] === "t" ? " CYCLE" : ""};\n`);
    }
    for (const t of tables) w.write(t.create);
    let rowsTotal = 0;
    if (withData() && type === "full") for (const t of tables) rowsTotal += await pgDumpTableRows(q, t, w, lg, detail);
    else lg.add("info", "Schema only: no table data included");
    writeSequences();
    for (const t of tables) {
      for (const f of t.fks) w.write(f);
      for (const i of t.idx) w.write(i);
    }
    for (const v of views) w.write(`CREATE VIEW ${quoteIdent(v[0])}.${quoteIdent(v[1])} AS ${v[2].trim().replace(/;+$/, "")};\n`);
    await q("COMMIT");
    w.write("COMMIT;\n");
    try {
      await pgSend(conn, "X", new Uint8Array(0));
    } catch {}
    return { type, manifest: type === "full" ? manifest : null, note, tables: { total: tables.length, included: type === "full" ? tables.length : 0, rows: rowsTotal, detail } };
  } finally {
    conn.close();
  }
}

// ----- MySQL / MariaDB (native wire protocol over TCP) -----
function parseMysql(uri) {
  const c = parseDbUrl(uri, ["mysql:", "mariadb:"], 3306);
  if (!c.user) throw new HttpError(400, "The connection string needs a user name.");
  if (!c.database) throw new HttpError(400, "Add the database name to the connection string, e.g. mysql://user:password@host:3306/dbname");
  const mode = String(c.params.get("ssl-mode") || c.params.get("sslmode") || c.params.get("ssl") || "required").toLowerCase();
  c.ssl = !["disabled", "disable", "false", "0", "off"].includes(mode);
  return c;
}

async function mysqlReadPacket(conn) {
  const parts = [];
  for (;;) {
    const h = await conn.readExact(4);
    const len = h[0] | (h[1] << 8) | (h[2] << 16);
    conn.seq = h[3];
    parts.push(len ? await conn.readExact(len) : new Uint8Array(0));
    if (len < 0xffffff) break;
  }
  return parts.length === 1 ? parts[0] : concatBytes(parts);
}
async function mysqlSend(conn, payload, seq) {
  const h = new Uint8Array(4);
  h[0] = payload.length & 255;
  h[1] = (payload.length >> 8) & 255;
  h[2] = (payload.length >> 16) & 255;
  h[3] = seq & 255;
  conn.seq = seq;
  await conn.write(concatBytes([h, payload]));
}
function mysqlErr(p) {
  const r = new ByteReader(p);
  r.u8();
  const code = r.u16();
  let rest = dec.decode(p.subarray(3));
  if (rest[0] === "#") rest = rest.slice(6);
  return new Error(`MySQL error ${code}: ${rest}`);
}

async function mysqlAuthToken(plugin, password, scramble, ssl) {
  if (!password) return new Uint8Array(0);
  const pw = enc.encode(password);
  // XOR must stay a Uint8Array: Uint8Array.map() returns a plain Array, which breaks
  // concatBytes / mysqlSend (WritableStream expects a BufferSource).
  const xor = (a, b) => {
    const out = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
    return out;
  };
  if (plugin === "mysql_native_password") {
    const h1 = await hashH("SHA-1", pw);
    const h2 = await hashH("SHA-1", h1);
    const h3 = await hashH("SHA-1", concatBytes([scramble, h2]));
    return xor(h1, h3);
  }
  if (plugin === "caching_sha2_password") {
    const h1 = await hashH("SHA-256", pw);
    const h2 = await hashH("SHA-256", h1);
    const h3 = await hashH("SHA-256", concatBytes([h2, scramble]));
    return xor(h1, h3);
  }
  if ((plugin === "mysql_clear_password" || plugin === "sha256_password") && ssl) return concatBytes([pw, new Uint8Array(1)]);
  throw new Error(`The MySQL account uses the "${plugin}" authentication plugin, which is not supported over an unencrypted connection.`);
}

async function mysqlConnect(c) {
  const conn = await TcpConn.open(c.host, c.port, c.ssl ? "starttls" : "off");
  try {
    const p = await mysqlReadPacket(conn);
    if (p[0] === 0xff) throw mysqlErr(p);
    const r = new ByteReader(p);
    r.u8();
    r.cstr();
    r.u32();
    const s1 = r.bytes(8);
    r.u8();
    const capLow = r.u16();
    r.u8();
    r.u16();
    const capHigh = r.u16();
    const authLen = r.u8();
    r.bytes(10);
    const part2 = r.bytes(Math.max(13, authLen - 8));
    const scramble = concatBytes([s1, part2.subarray(0, part2.length - 1)]);
    let plugin = r.cstr() || "mysql_native_password";
    const serverCaps = (capLow | (capHigh << 16)) >>> 0;

    let caps = 0x1 | 0x4 | 0x8 | 0x200 | 0x2000 | 0x8000 | 0x80000;
    if (c.ssl) {
      if (!(serverCaps & 0x800)) throw new Error("The server does not support TLS. Use ?ssl-mode=DISABLED only if you accept an unencrypted connection.");
      caps |= 0x800;
      const ssl = concatBytes([u32le(caps), u32le(0x01000000), Uint8Array.of(45), new Uint8Array(23)]);
      await mysqlSend(conn, ssl, 1);
      conn.startTls(c.host);
    }
    const token = await mysqlAuthToken(plugin, c.password, scramble, c.ssl);
    const resp = concatBytes([
      u32le(caps),
      u32le(0x01000000),
      Uint8Array.of(45),
      new Uint8Array(23),
      cstr(c.user),
      Uint8Array.of(token.length),
      token,
      cstr(c.database),
      cstr(plugin),
    ]);
    await mysqlSend(conn, resp, c.ssl ? 2 : 1);

    for (;;) {
      const pk = await mysqlReadPacket(conn);
      if (pk[0] === 0x00) break;
      if (pk[0] === 0xff) throw mysqlErr(pk);
      if (pk[0] === 0xfe) {
        const rr = new ByteReader(pk);
        rr.u8();
        plugin = rr.cstr();
        const data = pk.subarray(rr.o);
        const sc = data.length && data[data.length - 1] === 0 ? data.subarray(0, data.length - 1) : data;
        await mysqlSend(conn, await mysqlAuthToken(plugin, c.password, sc, c.ssl), conn.seq + 1);
      } else if (pk[0] === 0x01) {
        if (pk[1] === 0x03) continue;
        if (pk[1] === 0x04) {
          if (!c.ssl) throw new Error("This account uses caching_sha2_password, which needs a TLS connection. Remove ssl-mode=DISABLED.");
          await mysqlSend(conn, cstr(c.password), conn.seq + 1);
        } else {
          throw new Error("Unexpected MySQL authentication response.");
        }
      } else {
        throw new Error("Unexpected MySQL authentication packet.");
      }
    }
    return conn;
  } catch (e) {
    conn.close();
    throw e;
  }
}

async function mysqlQuery(conn, sql, onRow) {
  await mysqlSend(conn, concatBytes([Uint8Array.of(0x03), enc.encode(sql)]), 0);
  const first = await mysqlReadPacket(conn);
  if (first[0] === 0xff) throw mysqlErr(first);
  if (first[0] === 0x00) return { cols: [], rows: [] };
  const ncols = new ByteReader(first).lenenc();
  const cols = [];
  for (let i = 0; i < ncols; i++) {
    const r = new ByteReader(await mysqlReadPacket(conn));
    r.lenencBytes();
    r.lenencBytes();
    r.lenencBytes();
    r.lenencBytes();
    const name = dec.decode(r.lenencBytes());
    r.lenencBytes();
    r.lenenc();
    const charset = r.u16();
    r.u32();
    const type = r.u8();
    cols.push({ name, charset, type });
  }
  await mysqlReadPacket(conn); // EOF
  const rows = [];
  for (;;) {
    const p = await mysqlReadPacket(conn);
    if (p[0] === 0xfe && p.length < 9) break;
    if (p[0] === 0xff) throw mysqlErr(p);
    const r = new ByteReader(p);
    const vals = [];
    for (let i = 0; i < ncols; i++) vals.push(r.lenencBytes());
    if (onRow) onRow(vals, cols);
    else rows.push(vals.map((v) => (v === null ? null : dec.decode(v))));
  }
  return { cols, rows };
}

function mysqlIdent(s) {
  return "`" + String(s).replace(/`/g, "``") + "`";
}
function mysqlQuote(s) {
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''").replace(/\0/g, "\\0") + "'";
}
const MYSQL_NUMERIC = new Set([0, 1, 2, 3, 4, 5, 8, 9, 13, 246]);
function mysqlLiteral(bytes, col) {
  if (bytes === null) return "NULL";
  if (MYSQL_NUMERIC.has(col.type)) {
    const t = dec.decode(bytes);
    return /^[-+0-9.eE]+$/.test(t) ? t : mysqlQuote(t);
  }
  if (col.type === 16 || col.type === 255 || (col.charset === 63 && [249, 250, 251, 252, 253, 254].includes(col.type))) {
    return "X'" + toHex(bytes) + "'";
  }
  return mysqlQuote(dec.decode(bytes));
}

async function mysqlDumpTableRows(conn, t, w, lg, detail) {
  const before = w.bytes;
  let rows = 0;
  let batch = [];
  let size = 0;
  const flush = () => {
    if (batch.length) w.write(`INSERT INTO ${mysqlIdent(t)} VALUES ${batch.join(",")};\n`);
    batch = [];
    size = 0;
  };
  await mysqlQuery(conn, "SELECT * FROM " + mysqlIdent(t), (vals, cols) => {
    const row = "(" + vals.map((v, i) => mysqlLiteral(v, cols[i])).join(",") + ")";
    batch.push(row);
    size += row.length;
    rows++;
    if (size > 65536) flush();
  });
  flush();
  lg.add("info", `${t}: ${rows} rows, ${w.bytes - before} bytes`);
  if (detail.length < 100) detail.push({ name: t, rows, bytes: w.bytes - before });
  return rows;
}

async function dumpMysql(uri, w, opts = {}) {
  const c = parseMysql(uri);
  const conn = await mysqlConnect(c);
  const lg = opts.log || NOLOG;
  try {
    let type = opts.type || "full";
    lg.add("info", "Connected to MySQL/MariaDB");
    await mysqlQuery(conn, "SET NAMES utf8mb4");
    await mysqlQuery(conn, "SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await mysqlQuery(conn, "START TRANSACTION WITH CONSISTENT SNAPSHOT");

    const tables = (await mysqlQuery(conn, "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")).rows.map((r) => r[0]);
    const views = (await mysqlQuery(conn, "SHOW FULL TABLES WHERE Table_type = 'VIEW'")).rows.map((r) => r[0]);
    lg.add("info", `${tables.length} tables, ${views.length} views found`);
    const ddl = {};
    const schemaFp = {};
    for (const t of tables) {
      ddl[t] = (await mysqlQuery(conn, "SHOW CREATE TABLE " + mysqlIdent(t))).rows[0][1];
      schemaFp[t] = await shortHash(ddl[t].replace(/ AUTO_INCREMENT=\d+/g, "")); // the counter changes with every insert
    }
    const viewDdl = {};
    for (const v of views) viewDdl[v] = (await mysqlQuery(conn, "SHOW CREATE VIEW " + mysqlIdent(v))).rows[0][1];
    const globalFp = await shortHash(JSON.stringify(viewDdl));

    // ---------- change detection (CHECKSUM TABLE runs inside the database) ----------
    let manifest = null;
    let note = null;
    let changed = null;
    if (type === "incremental" || type === "differential" || (type === "full" && opts.wantManifest)) {
      manifest = { v: 1, e: "mysql", g: globalFp, t: {} };
      for (const t of tables) {
        const r = await mysqlQuery(conn, "CHECKSUM TABLE " + mysqlIdent(t));
        manifest.t[t] = { s: schemaFp[t], d: String(r.rows[0][1]) };
      }
      lg.add("info", `Fingerprinted ${tables.length} tables`);
      if (type !== "full") {
        const cmp = compareManifests(opts.baseManifest, manifest);
        if (cmp.reason) {
          note = cmp.reason;
          type = "full";
        } else {
          changed = new Set(cmp.changed);
          lg.add("info", `${changed.size} of ${tables.length} tables changed since the base backup${changed.size ? ": " + [...changed].slice(0, 8).join(", ") : ""}`);
        }
      }
    }

    // Header after type may have been promoted to full
    w.write(`-- VaultBackup ${type} backup (MySQL / MariaDB)\n-- Includes tables, data, views. Excludes triggers, routines, events and grants.\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\nSET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n`);

    const detail = [];
    let rowsTotal = 0;
    let included = 0;
    if (changed) {
      w.write(`-- ${type} backup: data of ${changed.size} changed table${changed.size === 1 ? "" : "s"} out of ${tables.length}. Apply after the base backup (see the restore order in the job log).\n`);
      for (const t of tables) {
        if (!changed.has(t)) continue;
        w.write(`DELETE FROM ${mysqlIdent(t)};\n`);
        rowsTotal += await mysqlDumpTableRows(conn, t, w, lg, detail);
        included++;
      }
    } else {
      for (const t of tables) {
        w.write(`DROP TABLE IF EXISTS ${mysqlIdent(t)};\n${ddl[t]};\n`);
        if (type === "full") {
          rowsTotal += await mysqlDumpTableRows(conn, t, w, lg, detail);
          included++;
        }
      }
      if (type === "schema") lg.add("info", "Schema only: no table data included");
      for (const v of views) w.write(`DROP VIEW IF EXISTS ${mysqlIdent(v)};\n${viewDdl[v]};\n`);
    }
    w.write("SET FOREIGN_KEY_CHECKS=1;\nSET UNIQUE_CHECKS=1;\n");
    await mysqlQuery(conn, "ROLLBACK");
    return { type, manifest: type === "full" || changed ? manifest : null, note, tables: { total: tables.length, included, rows: rowsTotal, detail } };
  } finally {
    conn.close();
  }
}

// ----- Redis (RESP over TCP) -----
function parseRedis(uri) {
  const c = parseDbUrl(uri, ["redis:", "rediss:"], 6379);
  c.tls = c.protocol === "rediss:";
  c.db = c.database ? parseInt(c.database, 10) : 0;
  if (!(c.db >= 0 && c.db < 1024)) throw new HttpError(400, "The Redis database number in the path must be a number such as /0.");
  return c;
}
function respEncode(args) {
  const parts = [enc.encode("*" + args.length + "\r\n")];
  for (const a of args) {
    const b = typeof a === "string" ? enc.encode(a) : a;
    parts.push(enc.encode("$" + b.length + "\r\n"), b, enc.encode("\r\n"));
  }
  return concatBytes(parts);
}
async function respRead(conn) {
  const line = await conn.readLine();
  const t = String.fromCharCode(line[0]);
  const text = dec.decode(line.subarray(1));
  if (t === "+") return text;
  if (t === "-") throw new Error("Redis: " + text);
  if (t === ":") return parseInt(text, 10);
  if (t === "$") {
    const n = parseInt(text, 10);
    if (n < 0) return null;
    const data = await conn.readExact(n + 2);
    return data.subarray(0, n);
  }
  if (t === "*") {
    const n = parseInt(text, 10);
    if (n < 0) return null;
    const out = [];
    for (let i = 0; i < n; i++) out.push(await respRead(conn));
    return out;
  }
  throw new Error("Unexpected Redis reply.");
}
async function redisCmd(conn, args) {
  await conn.write(respEncode(args));
  return respRead(conn);
}

async function dumpRedis(uri, w, opts = {}) {
  const lg = opts.log || NOLOG;
  const c = parseRedis(uri);
  let keysTotal = 0;
  const conn = await TcpConn.open(c.host, c.port, c.tls ? "on" : "off");
  try {
    if (c.password) await redisCmd(conn, c.user ? ["AUTH", c.user, c.password] : ["AUTH", c.password]);
    if (c.db) await redisCmd(conn, ["SELECT", String(c.db)]);
    lg.add("info", `Connected to Redis (database ${c.db})`);
    // Output is a raw RESP command stream: restore with `redis-cli --pipe < dump.resp`
    w.writeBytes(respEncode(["SELECT", String(c.db)]));
    let cursor = "0";
    do {
      const r = await redisCmd(conn, ["SCAN", cursor, "COUNT", "500"]);
      cursor = dec.decode(r[0]);
      const keys = r[1];
      if (keys.length) {
        const cmds = [];
        for (const k of keys) cmds.push(respEncode(["PTTL", k]), respEncode(["DUMP", k]));
        await conn.write(concatBytes(cmds));
        for (const k of keys) {
          const ttl = await respRead(conn);
          const payload = await respRead(conn);
          if (payload === null || ttl === -2) continue;
          w.writeBytes(respEncode(["RESTORE", k, String(ttl > 0 ? ttl : 0), payload, "REPLACE"]));
          keysTotal++;
        }
      }
    } while (cursor !== "0");
    lg.add("info", `${keysTotal} keys exported from database ${c.db}`);
    return { type: "full", manifest: null, tables: { total: keysTotal, included: keysTotal, rows: keysTotal, detail: [] } };
  } finally {
    conn.close();
  }
}

// ----- MongoDB (OP_MSG over TCP, BSON) -----
function bsonValue(v) {
  if (v === null) return [0x0a, new Uint8Array(0)];
  if (typeof v === "string") {
    const b = enc.encode(v);
    return [0x02, concatBytes([i32le(b.length + 1), b, new Uint8Array(1)])];
  }
  if (typeof v === "boolean") return [0x08, Uint8Array.of(v ? 1 : 0)];
  if (typeof v === "bigint") {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, v, true);
    return [0x12, b];
  }
  if (typeof v === "number") {
    if (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) return [0x10, i32le(v)];
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    return [0x01, b];
  }
  if (v instanceof Uint8Array) return [0x05, concatBytes([i32le(v.length), new Uint8Array(1), v])];
  if (Array.isArray(v)) return [0x04, bsonEncode(Object.fromEntries(v.map((x, i) => [String(i), x])))];
  return [0x03, bsonEncode(v)];
}
function bsonEncode(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const [type, data] = bsonValue(v);
    parts.push(Uint8Array.of(type), cstr(k), data);
  }
  const body = concatBytes(parts);
  const out = new Uint8Array(body.length + 5);
  new DataView(out.buffer).setInt32(0, out.length, true);
  out.set(body, 4);
  return out;
}
// rawKeys: array fields with these names are returned as raw document byte slices
function bsonDecodeDoc(buf, off, asArray, rawKeys) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = off + dv.getInt32(off, true);
  let o = off + 4;
  const out = asArray ? [] : {};
  while (o < end - 1) {
    const type = buf[o++];
    let ke = o;
    while (buf[ke] !== 0) ke++;
    const key = dec.decode(buf.subarray(o, ke));
    o = ke + 1;
    let val;
    switch (type) {
      case 0x01:
        val = dv.getFloat64(o, true);
        o += 8;
        break;
      case 0x02: {
        const l = dv.getInt32(o, true);
        val = dec.decode(buf.subarray(o + 4, o + 3 + l));
        o += 4 + l;
        break;
      }
      case 0x03: {
        const r = bsonDecodeDoc(buf, o, false, rawKeys);
        val = r.value;
        o = r.end;
        break;
      }
      case 0x04: {
        if (rawKeys && rawKeys.has(key)) {
          const aend = o + dv.getInt32(o, true);
          let p = o + 4;
          val = [];
          while (p < aend - 1) {
            p++;
            while (buf[p] !== 0) p++;
            p++;
            const dl = dv.getInt32(p, true);
            val.push(buf.subarray(p, p + dl));
            p += dl;
          }
          o = aend;
        } else {
          const r = bsonDecodeDoc(buf, o, true, rawKeys);
          val = r.value;
          o = r.end;
        }
        break;
      }
      case 0x05: {
        const l = dv.getInt32(o, true);
        val = buf.slice(o + 5, o + 5 + l);
        o += 5 + l;
        break;
      }
      case 0x06:
      case 0x0a:
        val = null;
        break;
      case 0x07:
        val = { $oid: toHex(buf.subarray(o, o + 12)) };
        o += 12;
        break;
      case 0x08:
        val = buf[o++] === 1;
        break;
      case 0x09:
        val = { $date: { $numberLong: String(dv.getBigInt64(o, true)) } };
        o += 8;
        break;
      case 0x0b: {
        let e = o;
        while (buf[e] !== 0) e++;
        const pattern = dec.decode(buf.subarray(o, e));
        o = e + 1;
        e = o;
        while (buf[e] !== 0) e++;
        val = { $regularExpression: { pattern, options: dec.decode(buf.subarray(o, e)) } };
        o = e + 1;
        break;
      }
      case 0x0d:
      case 0x0e: {
        const l = dv.getInt32(o, true);
        val = dec.decode(buf.subarray(o + 4, o + 3 + l));
        o += 4 + l;
        break;
      }
      case 0x0f:
        val = null;
        o += dv.getInt32(o, true);
        break;
      case 0x10:
        val = dv.getInt32(o, true);
        o += 4;
        break;
      case 0x11:
        val = { $timestamp: { t: dv.getUint32(o + 4, true), i: dv.getUint32(o, true) } };
        o += 8;
        break;
      case 0x12:
        val = dv.getBigInt64(o, true);
        o += 8;
        break;
      case 0x13:
        val = { $numberDecimal: "0x" + toHex(buf.subarray(o, o + 16)) };
        o += 16;
        break;
      case 0xff:
        val = { $minKey: 1 };
        break;
      case 0x7f:
        val = { $maxKey: 1 };
        break;
      default:
        throw new Error("Unsupported BSON type 0x" + type.toString(16));
    }
    if (asArray) out.push(val);
    else out[key] = val;
  }
  return { value: out, end };
}

function ejsonStringify(v) {
  return JSON.stringify(v, (k, x) => {
    if (typeof x === "bigint") return { $numberLong: String(x) };
    if (x instanceof Uint8Array) return { $binary: { base64: b64encode(x), subType: "00" } };
    return x;
  });
}

function parseMongo(uri) {
  const m = uri.match(/^(mongodb(?:\+srv)?):\/\/(?:([^:@/]*)(?::([^@/]*))?@)?([^/?]+)(?:\/([^?]*))?(?:\?(.*))?$/);
  if (!m) throw new HttpError(400, "That is not a valid MongoDB connection string.");
  const srv = m[1] === "mongodb+srv";
  let user = "";
  let password = "";
  let database = "";
  try {
    user = m[2] ? decodeURIComponent(m[2]) : "";
    password = m[3] ? decodeURIComponent(m[3]) : "";
    database = m[5] ? decodeURIComponent(m[5]) : "";
  } catch {
    throw new HttpError(400, "The connection string has invalid percent-encoding.");
  }
  const params = new URLSearchParams(m[6] || "");
  const hosts = m[4].split(",").map((h) => {
    const i = h.lastIndexOf(":");
    const host = assertPublicHost(i > 0 ? h.slice(0, i) : h);
    const port = i > 0 ? parseInt(h.slice(i + 1), 10) : 27017;
    if (!(port > 0 && port < 65536) || port === 25) throw new HttpError(400, "Invalid port.");
    return { host, port };
  });
  if (srv && hosts.length !== 1) throw new HttpError(400, "mongodb+srv:// takes exactly one host name.");
  const tlsParam = String(params.get("tls") || params.get("ssl") || "").toLowerCase();
  return { srv, hosts, user, password, database, params, tls: srv ? tlsParam !== "false" : tlsParam === "true" || tlsParam === "1", authSource: params.get("authSource") || "" };
}

async function dohQuery(name, type) {
  const res = await fetch("https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(name) + "&type=" + type, { headers: { accept: "application/dns-json" } });
  if (!res.ok) throw new Error("DNS lookup failed for " + name);
  return (await res.json()).Answer || [];
}

async function resolveMongoHosts(c) {
  if (!c.srv) return c.hosts;
  const name = c.hosts[0].host;
  const srv = await dohQuery("_mongodb._tcp." + name, "SRV");
  const hosts = srv
    .filter((a) => a.type === 33)
    .map((a) => {
      const p = a.data.split(" ");
      return { host: assertPublicHost(p[3].replace(/\.$/, "")), port: parseInt(p[2], 10) };
    });
  if (!hosts.length) throw new Error("No MongoDB hosts found in DNS for " + name);
  if (!c.authSource) {
    try {
      for (const a of await dohQuery(name, "TXT")) {
        if (a.type !== 16) continue;
        const txt = String(a.data).replace(/"\s*"/g, "").replace(/^"|"$/g, "");
        const v = new URLSearchParams(txt).get("authSource");
        if (v) c.authSource = v;
      }
    } catch {}
  }
  return hosts;
}

class MongoClient {
  constructor(conn) {
    this.conn = conn;
    this.reqId = 1;
  }
  async command(db, cmd) {
    const doc = bsonEncode({ ...cmd, $db: db, $readPreference: { mode: "secondaryPreferred" } });
    const body = concatBytes([u32le(0), Uint8Array.of(0), doc]);
    await this.conn.write(concatBytes([i32le(16 + body.length), i32le(this.reqId++), i32le(0), i32le(2013), body]));
    const h = await this.conn.readExact(16);
    const hv = new DataView(h.buffer, h.byteOffset, 16);
    const len = hv.getInt32(0, true);
    if (hv.getInt32(12, true) !== 2013) throw new Error("Unexpected MongoDB reply.");
    const rest = await this.conn.readExact(len - 16);
    if (rest[4] !== 0) throw new Error("Unexpected MongoDB reply section.");
    const reply = bsonDecodeDoc(rest, 5, false, new Set(["firstBatch", "nextBatch"])).value;
    if (reply.ok !== 1) throw new Error("MongoDB: " + (reply.errmsg || "command failed"));
    return reply;
  }
  async auth(c) {
    const authSource = c.authSource || c.database || "admin";
    const mechs = c.hello.saslSupportedMechs || [];
    const sha256 = mechs.includes("SCRAM-SHA-256");
    const pw = sha256 ? enc.encode(c.password) : enc.encode(await md5Hex(c.user + ":mongo:" + c.password));
    const scram = new Scram(sha256 ? "SHA-256" : "SHA-1", c.user, pw);
    let r = await this.command(authSource, {
      saslStart: 1,
      mechanism: sha256 ? "SCRAM-SHA-256" : "SCRAM-SHA-1",
      payload: enc.encode(scram.first()),
      autoAuthorize: 1,
      options: { skipEmptyExchange: true },
    });
    const conversationId = r.conversationId;
    const final = await scram.final(dec.decode(r.payload));
    r = await this.command(authSource, { saslContinue: 1, conversationId, payload: enc.encode(final) });
    scram.verify(dec.decode(r.payload));
    while (!r.done) r = await this.command(authSource, { saslContinue: 1, conversationId, payload: new Uint8Array(0) });
  }
  // Runs a cursor-returning command and calls onBatch with raw BSON document slices
  async cursor(db, cmd, onBatch) {
    let r = await this.command(db, cmd);
    await onBatch(r.cursor.firstBatch);
    while (r.cursor.id !== 0n) {
      const ns = r.cursor.ns;
      r = await this.command(db, { getMore: r.cursor.id, collection: ns.slice(ns.indexOf(".") + 1), batchSize: ROWS_PER_PAGE });
      await onBatch(r.cursor.nextBatch);
    }
  }
}

async function mongoConnect(c, hosts) {
  let lastErr;
  for (const h of hosts) {
    let conn = null;
    try {
      conn = await TcpConn.open(h.host, h.port, c.tls ? "on" : "off");
      const client = new MongoClient(conn);
      const hello = { isMaster: 1, helloOk: true, client: { driver: { name: "vaultbackup", version: "2" } } };
      if (c.user) hello.saslSupportedMechs = (c.authSource || c.database || "admin") + "." + c.user;
      c.hello = await client.command("admin", hello);
      if (c.user) await client.auth(c);
      return client;
    } catch (e) {
      lastErr = e;
      if (conn) conn.close();
    }
  }
  throw lastErr || new Error("Could not connect to MongoDB.");
}

function tarHeader(name, size) {
  const h = new Uint8Array(512);
  const put = (s, off, len) => h.set(enc.encode(s).subarray(0, len), off);
  let nm = name;
  let prefix = "";
  if (enc.encode(nm).length > 100) {
    for (let i = nm.indexOf("/"); i !== -1; i = nm.indexOf("/", i + 1)) {
      const p = nm.slice(0, i);
      const r = nm.slice(i + 1);
      if (enc.encode(p).length <= 155 && enc.encode(r).length <= 100) {
        prefix = p;
        nm = r;
        break;
      }
    }
    if (enc.encode(nm).length > 100) throw new Error("Collection name is too long to archive.");
  }
  put(nm, 0, 100);
  put("0000644\0", 100, 8);
  put("0000000\0", 108, 8);
  put("0000000\0", 116, 8);
  put(size.toString(8).padStart(11, "0") + "\0", 124, 12);
  put(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, 12);
  h.fill(0x20, 148, 156);
  h[156] = 0x30;
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}
function tarAdd(w, name, bytes) {
  w.writeBytes(tarHeader(name, bytes.length));
  w.writeBytes(bytes);
  const pad = (512 - (bytes.length % 512)) % 512;
  if (pad) w.writeBytes(new Uint8Array(pad));
}

// Output is a tar.gz in `mongodump` directory layout: restore with `mongorestore --drop dump/`.
// Incremental / differential archives hold only the changed collections, so applying them in order
// (each with `mongorestore --drop dump/`) replaces exactly those collections.
async function dumpMongo(uri, w, opts = {}) {
  const c = parseMongo(uri);
  const hosts = await resolveMongoHosts(c);
  const client = await mongoConnect(c, hosts);
  const lg = opts.log || NOLOG;
  try {
    let type = opts.type || "full";
    lg.add("info", "Connected to MongoDB");
    let dbs;
    if (c.database) dbs = [c.database];
    else {
      const r = await client.command("admin", { listDatabases: 1, nameOnly: true, authorizedDatabases: true });
      dbs = r.databases.map((d) => d.name).filter((n) => !["admin", "local", "config"].includes(n));
    }

    // ---------- introspect: collections, options, indexes ----------
    const colls = [];
    for (const db of dbs) {
      const infos = [];
      await client.cursor(db, { listCollections: 1, filter: { type: "collection" } }, (batch) => {
        for (const raw of batch) infos.push(bsonDecodeDoc(raw, 0, false).value);
      });
      for (const info of infos) {
        if (info.name.startsWith("system.")) continue;
        const indexes = [];
        await client.cursor(db, { listIndexes: info.name }, (batch) => {
          for (const raw of batch) indexes.push(bsonDecodeDoc(raw, 0, false).value);
        });
        const meta = { options: info.options || {}, indexes };
        colls.push({ db, name: info.name, key: `${db}.${info.name}`, meta, schemaFp: await shortHash(ejsonStringify(meta)) });
      }
    }
    lg.add("info", `${colls.length} collections found in ${dbs.length} database${dbs.length === 1 ? "" : "s"}`);

    // ---------- change detection with dbHash (computed inside the server) ----------
    let manifest = null;
    let note = null;
    let changed = null;
    if (type === "incremental" || type === "differential" || (type === "full" && opts.wantManifest)) {
      try {
        manifest = { v: 1, e: "mongo", g: await shortHash(JSON.stringify(dbs)), t: {} };
        for (const db of dbs) {
          const h = await client.command(db, { dbHash: 1 });
          for (const col of colls.filter((x) => x.db === db)) {
            if (!h.collections || h.collections[col.name] === undefined) throw new Error(`dbHash returned no hash for ${col.key}`);
            manifest.t[col.key] = { s: col.schemaFp, d: String(h.collections[col.name]) };
          }
        }
        lg.add("info", `Fingerprinted ${colls.length} collections with dbHash`);
      } catch (e) {
        manifest = null;
        lg.add("warn", "dbHash is not available: " + safeMessage(e));
        if (type !== "full") {
          note = "this MongoDB server or user cannot run dbHash, which change detection needs";
          type = "full";
        }
      }
      if (manifest && type !== "full") {
        const cmp = compareManifests(opts.baseManifest, manifest);
        if (cmp.reason) {
          note = cmp.reason.replace("tables were added or removed", "collections were added or removed");
          type = "full";
        } else {
          changed = new Set(cmp.changed);
          lg.add("info", `${changed.size} of ${colls.length} collections changed since the base backup${changed.size ? ": " + [...changed].slice(0, 8).join(", ") : ""}`);
        }
      }
    }

    // ---------- write the archive ----------
    const detail = [];
    let docsTotal = 0;
    let included = 0;
    const pick = changed ? colls.filter((x) => changed.has(x.key)) : colls;
    for (const col of pick) {
      const file = `dump/${col.db.replace(/\//g, "%2F")}/${col.name.replace(/\//g, "%2F")}`;
      let docs = 0;
      if (type !== "schema") {
        const chunks = [];
        let pending = 0;
        await client.cursor(col.db, { find: col.name, filter: {}, batchSize: ROWS_PER_PAGE }, (batch) => {
          for (const raw of batch) {
            chunks.push(raw);
            pending += raw.length;
            docs++;
          }
          if (w.bytes + pending > MAX_DUMP_BYTES) throw new Error("Database is larger than the 20 MB limit for a single Worker backup.");
        });
        tarAdd(w, file + ".bson", concatBytes(chunks));
      }
      tarAdd(w, file + ".metadata.json", enc.encode(ejsonStringify(col.meta)));
      lg.add("info", `${col.key}: ${type === "schema" ? "metadata only" : docs + " documents"}`);
      docsTotal += docs;
      if (detail.length < 100) detail.push({ name: col.key, rows: docs });
      if (type !== "schema") included++;
    }
    if (changed) {
      tarAdd(w, "dump/VAULTBACKUP-INCREMENTAL.json", enc.encode(JSON.stringify({ type, changed: [...changed], unchanged: colls.filter((x) => !changed.has(x.key)).map((x) => x.key) })));
    }
    w.writeBytes(new Uint8Array(1024));
    return { type, manifest: type === "full" || changed ? manifest : null, note, tables: { total: colls.length, included, rows: docsTotal, detail } };
  } finally {
    client.conn.close();
  }
}

// ----- Connection tests (run before anything is saved) -----
async function testPostgres(uri, flavor) {
  const c = parsePg(uri, flavor);
  const conn = await pgConnect(c);
  try {
    const crdb = flavor === "cockroach";
    const version = (await pgQuery(conn, "SELECT version()")).rows[0][0].split(" on ")[0].slice(0, 60);
    let readable;
    let total;
    if (crdb) {
      readable = total = Number((await pgQuery(conn, "SELECT count(*) FROM information_schema.tables WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema','crdb_internal','pg_extension')")).rows[0][0]);
    } else {
      const r = (
        await pgQuery(
          conn,
          "SELECT count(*) FILTER (WHERE has_table_privilege(c.oid, 'SELECT')), count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'"
        )
      ).rows[0];
      readable = Number(r[0]);
      total = Number(r[1]);
    }
    if (readable < total) throw new Error(`Connected, but this user can read only ${readable} of ${total} tables. Grant SELECT on all tables so backups are complete.`);
    await pgQuery(conn, crdb ? "BEGIN READ ONLY" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await pgQuery(conn, "ROLLBACK");
    return `${version}, ${total} tables readable`;
  } finally {
    try {
      await pgSend(conn, "X", new Uint8Array(0));
    } catch {}
    conn.close();
  }
}

async function testMysql(uri) {
  const c = parseMysql(uri);
  const conn = await mysqlConnect(c);
  try {
    const version = (await mysqlQuery(conn, "SELECT VERSION()")).rows[0][0];
    const tables = (await mysqlQuery(conn, "SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")).rows.map((r) => r[0]);
    for (const t of tables.slice(0, 50)) await mysqlQuery(conn, "SELECT * FROM " + mysqlIdent(t) + " LIMIT 0");
    await mysqlQuery(conn, "START TRANSACTION WITH CONSISTENT SNAPSHOT");
    await mysqlQuery(conn, "ROLLBACK");
    return `MySQL/MariaDB ${version.slice(0, 40)}, ${tables.length} tables readable`;
  } finally {
    conn.close();
  }
}

async function testRedis(uri) {
  const c = parseRedis(uri);
  const conn = await TcpConn.open(c.host, c.port, c.tls ? "on" : "off");
  try {
    if (c.password) await redisCmd(conn, c.user ? ["AUTH", c.user, c.password] : ["AUTH", c.password]);
    if (c.db) await redisCmd(conn, ["SELECT", String(c.db)]);
    await redisCmd(conn, ["PING"]);
    const size = await redisCmd(conn, ["DBSIZE"]);
    const info = dec.decode((await redisCmd(conn, ["INFO", "server"])) || new Uint8Array(0));
    const version = (info.match(/redis_version:([^\r\n]+)/) || [])[1] || "unknown";
    if (size > 0) {
      const r = await redisCmd(conn, ["SCAN", "0", "COUNT", "100"]);
      if (r[1].length) await redisCmd(conn, ["DUMP", r[1][0]]); // fails if DUMP is not allowed
    }
    return `Redis ${version}, ${size} keys in db ${c.db}`;
  } finally {
    conn.close();
  }
}

async function testMongo(uri) {
  const c = parseMongo(uri);
  const client = await mongoConnect(c, await resolveMongoHosts(c));
  try {
    if (c.database) {
      const infos = [];
      await client.cursor(c.database, { listCollections: 1, filter: { type: "collection" } }, (b) => {
        for (const raw of b) infos.push(bsonDecodeDoc(raw, 0, false).value);
      });
      const first = infos.find((i) => !i.name.startsWith("system."));
      if (first) await client.cursor(c.database, { find: first.name, filter: {}, limit: 1, batchSize: 1 }, () => {});
      return `MongoDB, ${infos.length} collections readable in "${c.database}"`;
    }
    const r = await client.command("admin", { listDatabases: 1, nameOnly: true, authorizedDatabases: true });
    return `MongoDB, ${r.databases.length} databases visible`;
  } finally {
    client.conn.close();
  }
}

async function testTurso(uri) {
  const conn = parseTurso(uri);
  const budget = { n: 0 };
  const v = (await tursoExec(conn, "SELECT sqlite_version()", budget)).rows[0][0].value;
  const n = (await tursoExec(conn, "SELECT count(*) FROM sqlite_master WHERE type = 'table'", budget)).rows[0][0].value;
  return `SQLite ${v}, ${n} tables readable`;
}

function detectProvider(uri) {
  const m = String(uri).match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i);
  const scheme = m ? m[1].toLowerCase() : "";
  const authority = m ? m[2].toLowerCase() : "";
  if (scheme === "postgres" || scheme === "postgresql") return /cockroachlabs\.cloud|:26257$/.test(authority) ? "CockroachDB" : "PostgreSQL";
  if (scheme === "mysql") return "MySQL";
  if (scheme === "mariadb") return "MariaDB";
  if (scheme === "mongodb" || scheme === "mongodb+srv") return "MongoDB";
  if (scheme === "redis" || scheme === "rediss") return "Redis";
  if (scheme === "libsql" || (scheme === "https" && /\.turso\.io/.test(authority))) return "Turso / SQLite";
  throw new HttpError(400, "Could not recognise this connection string. Supported schemes: postgresql://, mysql://, mariadb://, mongodb://, mongodb+srv://, redis://, rediss://, libsql://");
}

// Validates and really connects. Throws HttpError(400) with a user-facing message on any failure.
async function testDatabase(provider, uri) {
  await validateConnection(provider, uri);
  try {
    return await withTimeout(DRIVERS[provider].test(uri), 30000, "Connection test");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "Connection test failed: " + redactSecrets(safeMessage(e), uri));
  }
}

// ----- Driver registry -----
const DRIVERS = {
  "PostgreSQL": { types: ["full", "incremental", "differential", "schema"], test: (u) => testPostgres(u, "postgres"), ext: "sql.gz", validate: (u) => parsePg(u, "postgres"), dump: (u, w, o) => dumpPostgres(u, w, "postgres", o) },
  "CockroachDB": { types: ["full", "schema"], test: (u) => testPostgres(u, "cockroach"), ext: "sql.gz", validate: (u) => parsePg(u, "cockroach"), dump: (u, w, o) => dumpPostgres(u, w, "cockroach", o) },
  "MySQL": { types: ["full", "incremental", "differential", "schema"], test: (u) => testMysql(u), ext: "sql.gz", validate: parseMysql, dump: (u, w, o) => dumpMysql(u, w, o) },
  "MariaDB": { types: ["full", "incremental", "differential", "schema"], test: (u) => testMysql(u), ext: "sql.gz", validate: parseMysql, dump: (u, w, o) => dumpMysql(u, w, o) },
  "MongoDB": { types: ["full", "incremental", "differential", "schema"], test: (u) => testMongo(u), ext: "tar.gz", validate: parseMongo, dump: (u, w, o) => dumpMongo(u, w, o) },
  "Redis": { types: ["full"], test: (u) => testRedis(u), ext: "resp.gz", validate: parseRedis, dump: (u, w, o) => dumpRedis(u, w, o) },
  "Turso / SQLite": { types: ["full", "schema"], test: (u) => testTurso(u), ext: "sql.gz", validate: parseTurso, dump: (u, w, o) => dumpTurso(u, w, o) },
};

async function validateConnection(provider, uri) {
  if (uri.length > 2000) throw new HttpError(400, "Connection string is too long.");
  const d = DRIVERS[provider];
  if (!d) throw new HttpError(400, "That database type is not supported.");
  d.validate(uri);
}

// ---------------------------------------------------------------------------
// Scheduling: user-chosen frequency, time and time zone
// ---------------------------------------------------------------------------
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SCHEDULE_TYPES = ["hourly", "daily", "weekly", "monthly", "once"];

function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zonedParts(ms, tz) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

function tzOffsetMs(ms, tz) {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

// Local wall-clock time in `tz` -> UTC milliseconds (two passes handle daylight-saving changes)
function zonedToUtc(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const t = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(t, tz);
}

function nextRun(sch, after) {
  const tz = sch.tz;
  if (sch.type === "once") return sch.runAt > after ? sch.runAt : null;
  const loc = zonedParts(after, tz);
  const [H, M] = sch.type === "hourly" ? [0, sch.minute] : sch.time.split(":").map(Number);
  if (sch.type === "hourly") {
    for (let k = 0; k < 3; k++) {
      const t = zonedToUtc(loc.y, loc.m, loc.d, loc.h + k, M, tz);
      if (t > after) return t;
    }
  } else if (sch.type === "daily") {
    for (let k = 0; k < 3; k++) {
      const t = zonedToUtc(loc.y, loc.m, loc.d + k, H, M, tz);
      if (t > after) return t;
    }
  } else if (sch.type === "weekly") {
    for (let k = 0; k < 9; k++) {
      const dt = new Date(Date.UTC(loc.y, loc.m - 1, loc.d + k));
      if (dt.getUTCDay() !== sch.weekday) continue;
      const t = zonedToUtc(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), H, M, tz);
      if (t > after) return t;
    }
  } else if (sch.type === "monthly") {
    for (let k = 0; k < 15; k++) {
      const first = new Date(Date.UTC(loc.y, loc.m - 1 + k, 1));
      const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      const t = zonedToUtc(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(sch.day, dim), H, M, tz);
      if (t > after) return t;
    }
  }
  return null;
}

function normalizeSchedule(input, now = Date.now()) {
  if (typeof input === "string") {
    if (input === "Hourly") return { type: "hourly", minute: 0, tz: "UTC" };
    if (input === "Daily (@ 03:00 UTC)") return { type: "daily", time: "03:00", tz: "UTC" };
    if (input === "Weekly (Sundays)") return { type: "weekly", weekday: 0, time: "03:00", tz: "UTC" };
    throw new HttpError(400, "Unknown backup schedule.");
  }
  if (!input || typeof input !== "object") throw new HttpError(400, "Choose a backup schedule.");
  const type = String(input.type || "");
  if (!SCHEDULE_TYPES.includes(type)) throw new HttpError(400, "Choose how often to back up.");
  const tz = String(input.tz || "UTC");
  if (!validTimeZone(tz)) throw new HttpError(400, "Unknown time zone.");
  const out = { type, tz };
  const timeOk = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t));
  if (type === "hourly") {
    const minute = Number(input.minute);
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) throw new HttpError(400, "Minute must be between 0 and 59.");
    out.minute = minute;
  } else if (type === "once") {
    const m = String(input.runAtLocal || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!m) throw new HttpError(400, "Pick a date and time for the one-time backup.");
    const runAt = zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
    if (!(runAt > now + 60000) || runAt > now + 2 * 365 * 86400000) throw new HttpError(400, "Pick a date and time in the future (within 2 years).");
    out.runAtLocal = m[0];
    out.runAt = runAt;
  } else {
    if (!timeOk(input.time)) throw new HttpError(400, "Enter the time as HH:MM.");
    out.time = String(input.time);
    if (type === "weekly") {
      const wd = Number(input.weekday);
      if (!Number.isInteger(wd) || wd < 0 || wd > 6) throw new HttpError(400, "Choose a day of the week.");
      out.weekday = wd;
    }
    if (type === "monthly") {
      const day = Number(input.day);
      if (!Number.isInteger(day) || day < 1 || day > 31) throw new HttpError(400, "Day of month must be between 1 and 31.");
      out.day = day;
    }
  }
  return out;
}

function scheduleText(sc) {
  const pad = (n) => String(n).padStart(2, "0");
  switch (sc.type) {
    case "hourly":
      return `Every hour at :${pad(sc.minute)} (${sc.tz})`;
    case "daily":
      return `Every day at ${sc.time} (${sc.tz})`;
    case "weekly":
      return `Every ${WEEKDAYS[sc.weekday]} at ${sc.time} (${sc.tz})`;
    case "monthly":
      return `Monthly on day ${sc.day} at ${sc.time} (${sc.tz})`;
    default:
      return `Once on ${String(sc.runAtLocal).replace("T", " ")} (${sc.tz})`;
  }
}

function getSchedule(db) {
  return typeof db.schedule === "string" ? normalizeSchedule(db.schedule) : db.schedule;
}

const pad13 = (n) => String(n).padStart(13, "0");

// ---------------------------------------------------------------------------
// Backup plan: several jobs per database, each with its own type and schedule
// ---------------------------------------------------------------------------
const BACKUP_TYPES = ["full", "incremental", "differential", "schema"];
const TYPE_LABELS = { full: "Full", incremental: "Incremental", differential: "Differential", schema: "Schema only" };
const MAX_JOBS_PER_DB = 6;
const RETRY_DELAYS_MIN = [5, 15, 60, 120, 240];
const INLINE_TICK_BUDGET_MS = 10 * 60 * 1000;

function supportedTypes(provider) {
  return (DRIVERS[provider] && DRIVERS[provider].types) || ["full"];
}

// Validates a plan. Existing jobs (matched by id) keep their runtime state.
function normalizeJobs(input, provider, existing = []) {
  if (!Array.isArray(input) || input.length < 1) throw new HttpError(400, "Add at least one backup job.");
  if (input.length > MAX_JOBS_PER_DB) throw new HttpError(400, `A plan can have up to ${MAX_JOBS_PER_DB} jobs.`);
  const supported = supportedTypes(provider);
  const byId = new Map(existing.map((j) => [j.id, j]));
  const jobs = input.map((j) => {
    if (!j || typeof j !== "object") throw new HttpError(400, "Invalid backup job.");
    const type = String(j.type || "full");
    if (!BACKUP_TYPES.includes(type)) throw new HttpError(400, "Unknown backup type.");
    if (!supported.includes(type)) {
      throw new HttpError(400, `${provider} supports these backup types: ${supported.map((t) => TYPE_LABELS[t]).join(", ")}. ${TYPE_LABELS[type]} is not available for it.`);
    }
    const retryMax = j.retry && j.retry.max !== undefined ? Number(j.retry.max) : 2;
    if (!Number.isInteger(retryMax) || retryMax < 0 || retryMax > 5) throw new HttpError(400, "Retries must be between 0 and 5.");
    const prev = j.id ? byId.get(String(j.id)) : null;
    const job = {
      id: prev ? prev.id : "j_" + randomHex(4),
      name: String(j.name || "").trim().slice(0, 40) || TYPE_LABELS[type],
      type,
      schedule: normalizeSchedule(j.schedule),
      enabled: j.enabled !== false,
      retry: { max: retryMax },
    };
    if (prev) {
      for (const k of ["nextRunAt", "dueKey", "retryKey", "retryAttempt", "lastRunAt", "lastStatus", "lastBackupId", "lastError"]) if (prev[k] !== undefined) job[k] = prev[k];
    }
    return job;
  });
  if (jobs.some((j) => j.type === "incremental" || j.type === "differential") && !jobs.some((j) => j.type === "full")) {
    throw new HttpError(400, "Incremental and differential backups need a full backup job in the plan as their base.");
  }
  return jobs;
}

// (Re)computes one job's next run and keeps the sorted "due:" index in KV in step. Caller saves db.
async function scheduleJobNext(KV, db, job, after = Date.now()) {
  if (job.dueKey) await KV.delete(job.dueKey);
  job.dueKey = null;
  job.nextRunAt = null;
  if (!job.enabled) {
    if (job.retryKey) await KV.delete(job.retryKey);
    job.retryKey = null;
    return null;
  }
  const next = nextRun(job.schedule, after);
  job.nextRunAt = next;
  if (next) {
    job.dueKey = `due:${pad13(next)}:${db.tenantId}:${db.id}:${job.id}`;
    await KV.put(job.dueKey, "1");
  }
  return next;
}

async function scheduleAll(KV, db, after = Date.now()) {
  for (const j of db.jobs || []) await scheduleJobNext(KV, db, j, after);
}

async function clearJobKeys(KV, db) {
  for (const j of db.jobs || []) {
    if (j.dueKey) await KV.delete(j.dueKey);
    if (j.retryKey) await KV.delete(j.retryKey);
  }
  if (db.runKey) await KV.delete(db.runKey);
}

function dbNextRun(db) {
  let n = null;
  for (const j of db.jobs || []) if (j.nextRunAt && (n === null || j.nextRunAt < n)) n = j.nextRunAt;
  return n;
}

// A failed scheduled run is retried with back-off (5, 15, 60, 120, 240 minutes), up to the job's retry limit
async function scheduleRetry(KV, d, job) {
  const attempt = job.retryAttempt || 0;
  if (attempt >= (job.retry ? job.retry.max : 0)) return;
  const delay = RETRY_DELAYS_MIN[Math.min(attempt, RETRY_DELAYS_MIN.length - 1)] * 60000;
  if (job.retryKey) await KV.delete(job.retryKey);
  job.retryKey = `due:${pad13(Date.now() + delay)}:${d.tenantId}:${d.id}:${job.id}:r${attempt + 1}`;
  await KV.put(job.retryKey, "1");
  job.retryAttempt = attempt + 1;
}

// ---------------------------------------------------------------------------
// Backup engine
// ---------------------------------------------------------------------------
// Atomic lock via a Durable Object when BACKUP_LOCK is bound, otherwise a best-effort KV lock
async function acquireLock(env, KV, tenantId, dbId) {
  if (env.BACKUP_LOCK) {
    const stub = env.BACKUP_LOCK.get(env.BACKUP_LOCK.idFromName(`${tenantId}:${dbId}`));
    return (await stub.fetch("https://lock/acquire")).status === 200;
  }
  const lockKey = `lock:${tenantId}:${dbId}`;
  if (await KV.get(lockKey)) return false;
  await KV.put(lockKey, String(Date.now()), { expirationTtl: LOCK_TTL });
  return true;
}

async function releaseLock(env, KV, tenantId, dbId) {
  try {
    if (env.BACKUP_LOCK) {
      const stub = env.BACKUP_LOCK.get(env.BACKUP_LOCK.idFromName(`${tenantId}:${dbId}`));
      await stub.fetch("https://lock/release");
    } else {
      await KV.delete(`lock:${tenantId}:${dbId}`);
    }
  } catch (e) {
    console.error("Could not release lock:", safeMessage(e));
  }
}

export class BackupLock {
  constructor(state) {
    this.state = state;
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const now = Date.now();
    if (path === "/acquire") {
      const cur = await this.state.storage.get("expires");
      if (cur && cur > now) return new Response("busy", { status: 409 });
      await this.state.storage.put("expires", now + LOCK_TTL * 1000);
      return new Response("ok");
    }
    if (path === "/release") {
      await this.state.storage.delete("expires");
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }
}

async function beginBackup(env, KV, tenantId, db, jobId = null) {
  if (!(await acquireLock(env, KV, tenantId, db.id))) return false;
  db.status = "Running";
  db.runningSince = Date.now();
  db.runningJobId = jobId;
  db.lastAttemptAt = Date.now();
  db.lastError = null;
  db.runKey = `run:${pad13(Date.now() + LOCK_TTL * 1000)}:${tenantId}:${db.id}`;
  await KV.put(db.runKey, "1");
  await KV.put(`db:${tenantId}:${db.id}`, JSON.stringify(db));
  return true;
}

// Called when a backup was started (lock + "Running") but could not be handed off
async function abortBackupStart(env, KV, tenantId, dbId, message) {
  await releaseLock(env, KV, tenantId, dbId);
  const raw = await KV.get(`db:${tenantId}:${dbId}`);
  if (raw) {
    const d = JSON.parse(raw);
    if (d.runKey) {
      await KV.delete(d.runKey);
      d.runKey = null;
    }
    d.status = "Failed";
    d.runningSince = null;
    d.lastError = message;
    await KV.put(`db:${tenantId}:${dbId}`, JSON.stringify(d));
  }
}

// With a Queue bound, backups run in the queue consumer (15 minute budget). Otherwise inline.
async function dispatchBackup(env, ctx, tenantId, dbId, trigger, jobId = null, type = null) {
  if (env.BACKUP_QUEUE) {
    await env.BACKUP_QUEUE.send({ tenantId, dbId, trigger, jobId, type });
  } else if (ctx) {
    ctx.waitUntil(runBackup(env, tenantId, dbId, trigger, jobId, type));
  } else {
    await runBackup(env, tenantId, dbId, trigger, jobId, type);
  }
}

// Step-by-step log of one backup run (kept for the "job log" view)
class RunLog {
  constructor() {
    this.t0 = Date.now();
    this.steps = [];
    this.dropped = 0;
  }
  add(level, msg) {
    if (this.steps.length >= 200) {
      this.dropped++;
      return;
    }
    this.steps.push({ t: Date.now() - this.t0, l: level, m: String(msg).slice(0, 300) });
  }
}
const NOLOG = { add() {} };

async function deleteLogArtifacts(KV, tenantId, logId) {
  await KV.delete(`log:${tenantId}:${logId}`);
  await KV.delete(`steps:${tenantId}:${logId}`);
  await KV.delete(`man:${tenantId}:${logId}`);
}

// Picks the backup an incremental or differential run builds on, or says why it cannot
async function findBase(KV, tenantId, dbId, type, storageId) {
  const logs = (await listJson(KV, `log:${tenantId}:`, 500)).filter((l) => l.dbId === dbId && l.status === "Success" && l.objectKey);
  const byId = new Map(logs.map((l) => [l.id, l]));
  const cand =
    type === "differential"
      ? logs.find((l) => l.type === "full" && l.hasManifest)
      : logs.find((l) => (l.type === "full" || l.type === "incremental" || l.type === "differential") && l.hasManifest);
  if (!cand) return { reason: type === "differential" ? "there is no full backup with a change manifest yet" : "there is no earlier backup with a change manifest yet" };
  if (cand.storageId !== storageId) return { reason: "the storage target changed since the base backup" };
  let cur = cand;
  for (let guard = 0; cur.type !== "full"; guard++) {
    cur = byId.get(cur.baseId);
    if (!cur || guard > 50) return { reason: "an earlier backup in the chain is missing" };
  }
  const man = await KV.get(`man:${tenantId}:${cand.id}`);
  if (!man) return { reason: "the base backup's change manifest is missing" };
  return { log: cand, manifest: JSON.parse(man) };
}

// The backups needed to restore `id`, in the order to apply them (full first)
function restoreChain(logs, id) {
  const byId = new Map(logs.map((l) => [l.id, l]));
  const chain = [];
  let cur = byId.get(id);
  for (let guard = 0; cur && guard < 60; guard++) {
    chain.unshift(cur);
    if (cur.type === "full" || cur.type === "schema" || !cur.baseId) break;
    cur = byId.get(cur.baseId);
  }
  return { chain, complete: chain.length > 0 && (chain[0].type === "full" || chain[0].type === "schema") };
}

function restoreHint(provider, chain) {
  const how = {
    PostgreSQL: "gunzip -c FILE | psql DATABASE_URL",
    CockroachDB: "gunzip -c FILE | cockroach sql --url DATABASE_URL",
    MySQL: "gunzip -c FILE | mysql -h HOST -u USER -p DATABASE",
    MariaDB: "gunzip -c FILE | mysql -h HOST -u USER -p DATABASE",
    "Turso / SQLite": "gunzip -c FILE | sqlite3 restored.db",
    MongoDB: "tar xzf FILE, then: mongorestore --drop dump/   (repeat for each file, in order)",
    Redis: "gunzip -c FILE | redis-cli --pipe",
  }[provider] || "gunzip -c FILE";
  const order = chain.map((l, i) => `${i + 1}. ${TYPE_LABELS[l.type] || l.type} backup from ${new Date(l.finishedAt || l.startedAt).toISOString()}`).join("\n");
  return `Apply the files in this order, each with: ${how}\n${order}`;
}

async function runBackup(env, tenantId, dbId, trigger, jobId = null, typeOverride = null) {
  const KV = getKV(env);
  const dbKey = `db:${tenantId}:${dbId}`;
  const startedAt = Date.now();
  const lg = new RunLog();
  const log = {
    id: `${revTs(startedAt)}_${randomHex(3)}`,
    dbId,
    dbName: "",
    provider: "",
    trigger,
    jobId: jobId || null,
    jobName: "",
    requestedType: "full",
    type: "full",
    promoted: null,
    baseId: null,
    chainId: null,
    seq: 0,
    hasManifest: false,
    startedAt,
    finishedAt: null,
    durationMs: 0,
    status: "Failed",
    size: 0,
    rawBytes: 0,
    checksum: null,
    objectKey: null,
    ext: "sql.gz",
    storageMode: null,
    storageId: null,
    bucket: null,
    tables: null,
    error: null,
  };
  let found = false;
  let uri = "";
  try {
    const raw = await KV.get(dbKey);
    if (!raw) return;
    found = true;
    const db = JSON.parse(raw);
    log.dbName = db.name;
    log.provider = db.provider;
    const job = jobId ? (db.jobs || []).find((j) => j.id === jobId) : null;
    if (jobId && !job) throw new Error("This backup job no longer exists.");
    const requested = job ? job.type : typeOverride || "full";
    log.jobName = job ? job.name : "Manual";
    log.requestedType = requested;
    log.type = requested;
    lg.add("info", `Started (${trigger}): job "${log.jobName}", requested type ${requested}`);

    uri = await openString(env, `secret:${tenantId}`, db.sealedUri, `db:${dbId}`);
    const storage = await getStorage(env, KV, tenantId);
    log.storageMode = storage.mode;
    log.storageId = storage.id;
    log.bucket = storage.label;
    lg.add("info", `Storage target: ${storage.label}`);

    const driver = DRIVERS[db.provider];
    if (!driver) throw new Error("Backups are not supported for " + db.provider + ".");
    if (!driver.types.includes(requested)) throw new Error(`${db.provider} does not support ${requested} backups.`);
    log.ext = driver.ext;

    const opts = { type: requested, baseManifest: null, baseId: null, wantManifest: false, log: lg };
    if (requested === "incremental" || requested === "differential") {
      const base = await findBase(KV, tenantId, dbId, requested, storage.id);
      if (base.reason) {
        opts.type = "full";
        log.promoted = `A full backup was taken instead because ${base.reason}.`;
        lg.add("warn", log.promoted);
      } else {
        opts.baseManifest = base.manifest;
        opts.baseId = base.log.id;
        log.baseId = base.log.id;
        log.chainId = base.log.chainId || base.log.id;
        log.seq = requested === "incremental" ? (base.log.seq || 0) + 1 : 1;
        lg.add("info", `Base: ${base.log.type} backup finished ${new Date(base.log.finishedAt).toISOString()}`);
      }
    }
    opts.wantManifest = driver.types.includes("incremental") && (db.jobs || []).some((j) => j.type === "incremental" || j.type === "differential");

    const writer = new DumpWriter();
    const result = (await driver.dump(uri, writer, opts)) || {};
    log.type = result.type || opts.type;
    if (result.type && result.type !== opts.type) {
      log.promoted = `A full backup was taken instead because ${result.note || "the database structure changed"}.`;
      lg.add("warn", log.promoted);
    }
    if (log.type === "full" || log.type === "schema") {
      log.baseId = null;
      log.seq = 0;
      log.chainId = log.id;
    }
    log.tables = result.tables || null;
    log.rawBytes = writer.bytes;
    lg.add("info", `Dump finished: ${writer.bytes} bytes${result.note && !log.promoted ? " (" + result.note + ")" : ""}`);

    const compressed = await gzip(writer.toBytes());
    log.objectKey = `backups/${tenantId}/${dbId}/${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}-${log.type}.${driver.ext}.enc`;
    const sealed = await encryptBytes(env, `backup:${tenantId}`, compressed, log.objectKey);
    lg.add("info", `Compressed to ${compressed.length} bytes, encrypted to ${sealed.length} bytes`);
    await storage.put(log.objectKey, sealed);
    log.checksum = await sha256Hex(sealed);
    lg.add("info", `Uploaded to ${storage.label} (sha256 ${log.checksum.slice(0, 12)}...)`);
    if (result.manifest) {
      await KV.put(`man:${tenantId}:${log.id}`, JSON.stringify(result.manifest));
      log.hasManifest = true;
      lg.add("info", `Change manifest saved for ${Object.keys(result.manifest.t || {}).length} tables/collections`);
    }
    log.status = "Success";
    log.size = sealed.length;
  } catch (err) {
    log.error = redactSecrets(safeMessage(err), uri);
    lg.add("error", log.error);
    console.error(`Backup failed for ${dbId}:`, log.error);
  } finally {
    log.finishedAt = Date.now();
    log.durationMs = log.finishedAt - startedAt;
    if (found) await finalizeBackup(env, KV, tenantId, dbId, log, lg);
    await releaseLock(env, KV, tenantId, dbId);
  }
}

// Records the outcome: history, job log, database + job status, failure streak, retry, stats, retention
async function finalizeBackup(env, KV, tenantId, dbId, log, lg) {
  const dbKey = `db:${tenantId}:${dbId}`;
  try {
    await KV.put(`log:${tenantId}:${log.id}`, JSON.stringify(log));
    if (lg) await KV.put(`steps:${tenantId}:${log.id}`, JSON.stringify({ steps: lg.steps, dropped: lg.dropped }));
    const cur = await KV.get(dbKey);
    if (!cur) return;
    const d = JSON.parse(cur);
    const ok = log.status === "Success";
    d.status = ok ? "Healthy" : "Failed";
    d.runningSince = null;
    d.runningJobId = null;
    d.lastError = log.error;
    if (d.runKey) {
      await KV.delete(d.runKey);
      d.runKey = null;
    }
    if (ok) {
      d.lastBackupAt = log.finishedAt;
      d.lastSize = log.size;
      d.failStreak = 0;
    } else {
      d.failStreak = (d.failStreak || 0) + 1;
      d.lastFailureAt = log.finishedAt;
    }
    const job = (d.jobs || []).find((j) => j.id === log.jobId);
    if (job) {
      job.lastRunAt = log.finishedAt;
      job.lastStatus = ok ? "Success" : "Failed";
      job.lastBackupId = log.id;
      job.lastError = ok ? null : log.error;
      if (ok) {
        job.retryAttempt = 0;
        if (job.retryKey) {
          await KV.delete(job.retryKey);
          job.retryKey = null;
        }
      } else if (["schedule", "retry", "initial"].includes(log.trigger)) {
        await scheduleRetry(KV, d, job);
        if (job.retryKey) lg && lg.add("info", `Retry ${job.retryAttempt} of ${job.retry.max} scheduled for ${new Date(parseInt(job.retryKey.slice(4, 17), 10)).toISOString()}`);
        await KV.put(`steps:${tenantId}:${log.id}`, JSON.stringify({ steps: lg ? lg.steps : [], dropped: lg ? lg.dropped : 0 }));
      }
    }
    await KV.put(dbKey, JSON.stringify(d));
    await bumpStat(KV, ok);
    if (ok) await pruneBackups(env, KV, tenantId, dbId);
  } catch (e) {
    console.error("Post-backup bookkeeping failed:", safeMessage(e));
  }
}

async function bumpStat(KV, ok) {
  try {
    const key = "stats:" + new Date().toISOString().slice(0, 10);
    const cur = JSON.parse((await KV.get(key)) || '{"s":0,"f":0}');
    if (ok) cur.s++;
    else cur.f++;
    await KV.put(key, JSON.stringify(cur), { expirationTtl: 4 * 86400 });
  } catch {}
}

// ---------------------------------------------------------------------------
// Retention (set by the customer, per database). Only backups this service created are deleted.
// A full backup and the incrementals built on it form a chain; chains are kept or deleted together.
// ---------------------------------------------------------------------------
const DEFAULT_RETENTION = { mode: "count", count: KEEP_BACKUPS_PER_DB };

function normalizeRetention(input) {
  if (input === undefined || input === null) return { ...DEFAULT_RETENTION };
  if (typeof input !== "object") throw new HttpError(400, "Choose a retention setting.");
  const mode = String(input.mode || "");
  if (mode === "forever") return { mode };
  if (mode === "count") {
    const n = Number(input.count);
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw new HttpError(400, "Keep between 1 and 1000 backups.");
    return { mode, count: n };
  }
  if (mode === "days") {
    const n = Number(input.days);
    if (!Number.isInteger(n) || n < 1 || n > 3650) throw new HttpError(400, "Keep backups for between 1 and 3650 days.");
    return { mode, days: n };
  }
  throw new HttpError(400, "Choose a retention setting.");
}

function retentionText(r) {
  if (r.mode === "forever") return "Keep every backup (never delete)";
  if (r.mode === "days") return `Keep backups for ${r.days} day${r.days === 1 ? "" : "s"}`;
  return `Keep the last ${r.count} backup${r.count === 1 ? "" : "s"}`;
}

// Successful backups the policy no longer keeps. A chain is kept while any of its members is kept,
// and the chain holding the newest successful backup is always kept.
function retentionVictims(logs, retention, now) {
  const ok = logs.filter((l) => l.status === "Success" && l.objectKey);
  if (retention.mode === "forever" || ok.length <= 1) return [];
  const chainOf = (l) => l.chainId || l.id;
  const keep = new Set([chainOf(ok[0])]);
  if (retention.mode === "count") for (const l of ok.slice(0, retention.count)) keep.add(chainOf(l));
  else for (const l of ok) if (now - (l.finishedAt || l.startedAt) <= retention.days * 86400000) keep.add(chainOf(l));
  return ok.filter((l) => !keep.has(chainOf(l)));
}

async function pruneBackups(env, KV, tenantId, dbId) {
  const raw = await KV.get(`db:${tenantId}:${dbId}`);
  if (!raw) return 0;
  const retention = JSON.parse(raw).retention || DEFAULT_RETENTION;
  const logs = (await listJson(KV, `log:${tenantId}:`, 500)).filter((l) => l.dbId === dbId);
  let deleted = 0;
  for (const l of retentionVictims(logs, retention, Date.now())) {
    try {
      await (await getStorage(env, KV, tenantId, l.storageId)).delete(l.objectKey);
      await deleteLogArtifacts(KV, tenantId, l.id);
      deleted++;
    } catch (e) {
      console.error("Retention cleanup could not delete a backup (kept in the history):", safeMessage(e));
    }
  }
  for (const l of logs.filter((x) => x.status !== "Success").slice(50)) await deleteLogArtifacts(KV, tenantId, l.id);
  return deleted;
}

// ---------------------------------------------------------------------------
// Stuck-job detection: a backup that never reports back is failed after 15 minutes
// ---------------------------------------------------------------------------
async function reapStuckRuns(env, KV, now, onlyTenant) {
  const keys = [];
  let cursor;
  scan: do {
    const page = await KV.list({ prefix: "run:", cursor, limit: 1000 });
    for (const k of page.keys) {
      if (parseInt(k.name.slice(4, 17), 10) > now) break scan;
      if (onlyTenant && k.name.split(":")[2] !== onlyTenant) continue;
      keys.push(k.name);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  for (const key of keys) {
    try {
      const [, , tenantId, dbId] = key.split(":");
      const raw = await KV.get(`db:${tenantId}:${dbId}`);
      if (!raw) {
        await KV.delete(key);
        continue;
      }
      const db = JSON.parse(raw);
      if (db.runKey !== key || db.status !== "Running") {
        await KV.delete(key);
        continue;
      }
      const at = Date.now();
      const lg = new RunLog();
      lg.add("error", "No result was reported within 15 minutes; the run was stopped by the scheduler.");
      await releaseLock(env, KV, tenantId, dbId);
      await finalizeBackup(
        env,
        KV,
        tenantId,
        dbId,
        {
          id: `${revTs(at)}_${randomHex(3)}`, dbId, dbName: db.name, provider: db.provider, trigger: "timeout", jobId: db.runningJobId || null, jobName: "", requestedType: "full", type: "full",
          promoted: null, baseId: null, chainId: null, seq: 0, hasManifest: false, startedAt: db.runningSince || at, finishedAt: at, durationMs: at - (db.runningSince || at),
          status: "Failed", size: 0, rawBytes: 0, checksum: null, objectKey: null, ext: "sql.gz", storageMode: null, storageId: null, bucket: null, tables: null,
          error: "The backup did not finish within 15 minutes and was stopped (the Worker was probably interrupted). It will be retried per the job's retry setting.",
        },
        lg
      );
    } catch (e) {
      console.error("Stuck-run cleanup error:", safeMessage(e));
    }
  }
}

// ---------------------------------------------------------------------------
// Operator monitoring (all customers)
// ---------------------------------------------------------------------------
async function scanJson(KV, prefix, max) {
  const out = [];
  let cursor;
  do {
    const page = await KV.list({ prefix, cursor, limit: 1000 });
    const vals = await Promise.all(page.keys.map((k) => KV.get(k.name)));
    for (const v of vals) {
      try {
        if (v) out.push(JSON.parse(v));
      } catch {}
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && out.length < max);
  return out.slice(0, max);
}

async function handleAdminMonitor(request, env, KV) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 24) throw new HttpError(404, "Endpoint not found.");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateLimit(KV, "admin:" + ip, 60))) throw new HttpError(429, "Too many attempts. Try again later.");
  const m = (request.headers.get("Authorization") || "").match(/^Bearer (.+)$/);
  if (!timingSafeEqual(enc.encode(await sha256Hex(m ? m[1] : "")), enc.encode(await sha256Hex(env.ADMIN_TOKEN)))) throw new HttpError(401, "Invalid admin token.");
  const now = Date.now();
  const emails = new Map((await scanJson(KV, "user:", 5000)).map((u) => [u.id, u.email]));
  const dbs = await scanJson(KV, "db:", 5000);
  const row = (d) => ({ customer: emails.get(d.tenantId) || d.tenantId, database: d.name, provider: d.provider, status: d.status, failStreak: d.failStreak || 0, lastError: d.lastError || null, lastFailureAt: d.lastFailureAt || null, lastBackupAt: d.lastBackupAt || null, nextRunAt: dbNextRun(d) });
  const failing = dbs.filter((d) => (d.failStreak || 0) > 0 || d.status === "Failed");
  const overdue = dbs.filter((d) => d.status !== "Running" && (d.jobs || []).some((j) => j.nextRunAt && j.nextRunAt < now - 15 * 60000));
  const running = dbs.filter((d) => d.status === "Running");
  const neverSucceeded = dbs.filter((d) => !d.lastBackupAt && d.lastAttemptAt);
  const day = (offset) => new Date(now - offset * 86400000).toISOString().slice(0, 10);
  const stat = async (dd) => JSON.parse((await KV.get("stats:" + dd)) || '{"s":0,"f":0}');
  const [today, yesterday] = [await stat(day(0)), await stat(day(1))];
  let scheduler = null;
  try {
    scheduler = JSON.parse((await KV.get("sys:cron")) || "null");
  } catch {}
  return json({
    success: true,
    now,
    scheduler,
    totals: { customers: new Set(dbs.map((d) => d.tenantId)).size, databases: dbs.length, healthy: dbs.filter((d) => d.status === "Healthy").length, failing: failing.length, overdue: overdue.length, running: running.length, neverSucceeded: neverSucceeded.length },
    stats: { today, yesterday },
    failing: failing.sort((a, b) => (b.failStreak || 0) - (a.failStreak || 0)).slice(0, 200).map(row),
    overdue: overdue.slice(0, 200).map(row),
    running: running.slice(0, 200).map(row),
  });
}

// Starts every backup job that is due. Used by the Cron Trigger, by the dashboard tick (one tenant)
// and by the external ping endpoint.
async function runAutomatedBackups(env, scheduledTime, ctx, opts = {}) {
  const KV = getKV(env);
  const now = scheduledTime || Date.now();
  const t0 = Date.now();
  if (!opts.onlyTenant) await KV.put("sys:cron", JSON.stringify({ at: Date.now(), phase: "start", src: opts.src || "cron" }));
  await reapStuckRuns(env, KV, Math.max(now, Date.now()), opts.onlyTenant);

  // The index is sorted by due time, so only entries that are due are read
  const dueKeys = [];
  let cursor;
  scan: do {
    const page = await KV.list({ prefix: "due:", cursor, limit: 1000 });
    for (const k of page.keys) {
      if (parseInt(k.name.slice(4, 17), 10) > now) break scan;
      if (opts.onlyTenant && k.name.split(":")[2] !== opts.onlyTenant) continue;
      dueKeys.push(k.name);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  let started = 0;
  let deferred = 0;
  for (const key of dueKeys) {
    // Without a Queue the runs happen one after another in this tick: stop starting new ones when the
    // time budget is used up. The rest stay due and are picked up by the next tick.
    if (!ctx && !env.BACKUP_QUEUE && Date.now() - t0 > (Number(env.TICK_BUDGET_MS) > 0 ? Number(env.TICK_BUDGET_MS) : INLINE_TICK_BUDGET_MS)) {
      deferred++;
      continue;
    }
    try {
      const [, , tenantId, dbId, jobId, retryTag] = key.split(":");
      const dbKey = `db:${tenantId}:${dbId}`;
      const raw = await KV.get(dbKey);
      if (!raw) {
        await KV.delete(key);
        continue;
      }
      const db = JSON.parse(raw);
      const job = (db.jobs || []).find((j) => j.id === jobId);
      if (!job || (retryTag ? job.retryKey !== key : job.dueKey !== key)) {
        await KV.delete(key); // stale index entry
        continue;
      }
      // Move to the next occurrence first: a slow or failed run can never cause a retry storm,
      // and ticks missed while the Worker was down simply run once, late.
      if (retryTag) {
        job.retryKey = null;
        await KV.delete(key);
      } else {
        await scheduleJobNext(KV, db, job, Math.max(now, Date.now()));
      }
      await KV.put(dbKey, JSON.stringify(db));
      if (!job.enabled) continue;
      if (!(await beginBackup(env, KV, tenantId, db, job.id))) continue; // still running: skip this occurrence
      try {
        await dispatchBackup(env, ctx || null, tenantId, dbId, retryTag ? "retry" : "schedule", job.id);
        started++;
      } catch (e) {
        await abortBackupStart(env, KV, tenantId, dbId, "Could not queue the backup: " + safeMessage(e));
      }
    } catch (e) {
      console.error("Scheduled backup error:", safeMessage(e));
    }
  }
  if (!opts.onlyTenant) await KV.put("sys:cron", JSON.stringify({ at: Date.now(), phase: "done", src: opts.src || "cron", due: dueKeys.length, started, deferred }));
  return { due: dueKeys.length, started, deferred };
}

// ---------------------------------------------------------------------------
// Scheduler setup helpers (no dashboard visit needed)
// ---------------------------------------------------------------------------
const CRON_EXPR = "*/5 * * * *";

function cfAutoSetupAvailable(env) {
  return !!(env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.CF_WORKER_NAME);
}

function cfErrorText(json, status) {
  const first = json && json.errors && json.errors[0];
  return (first && first.message) || "HTTP " + status;
}

// Creates the Cron Trigger through the Cloudflare API (keeps any triggers already present)
async function ensureCronTrigger(env) {
  if (!cfAutoSetupAvailable(env)) {
    throw new HttpError(400, "Set the secrets CF_API_TOKEN and the variables CF_ACCOUNT_ID and CF_WORKER_NAME so the Worker can create its own Cron Trigger.");
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}/workers/scripts/${encodeURIComponent(env.CF_WORKER_NAME)}/schedules`;
  const headers = { Authorization: "Bearer " + env.CF_API_TOKEN, "Content-Type": "application/json" };
  const cur = await fetch(url, { headers });
  const curJson = await cur.json().catch(() => null);
  if (!cur.ok || !curJson || !curJson.success) throw new HttpError(502, "Cloudflare API refused the request: " + cfErrorText(curJson, cur.status));
  const existing = ((curJson.result && curJson.result.schedules) || []).map((x) => ({ cron: x.cron }));
  if (existing.some((x) => x.cron === CRON_EXPR)) return { created: false, schedules: existing.map((x) => x.cron) };
  const next = existing.concat([{ cron: CRON_EXPR }]);
  const put = await fetch(url, { method: "PUT", headers, body: JSON.stringify(next) });
  const putJson = await put.json().catch(() => null);
  if (!put.ok || !putJson || !putJson.success) throw new HttpError(502, "Cloudflare API refused the request: " + cfErrorText(putJson, put.status));
  return { created: true, schedules: next.map((x) => x.cron) };
}

// If the scheduler has been silent for 15+ minutes and API access is configured, try to fix it (at most hourly)
async function maybeAutoSetup(env, KV, ctx) {
  if (!cfAutoSetupAvailable(env)) return;
  try {
    const raw = await KV.get("sys:cron");
    if (raw && Date.now() - JSON.parse(raw).at < 15 * 60 * 1000) return;
    if (await KV.get("sys:cron-setup")) return;
    await KV.put("sys:cron-setup", String(Date.now()), { expirationTtl: 3600 });
    ctx.waitUntil(
      ensureCronTrigger(env)
        .then((r) => console.log("Cron Trigger", r.created ? "created" : "already present"))
        .catch((e) => console.error("Cron Trigger setup failed:", safeMessage(e)))
    );
  } catch (e) {
    console.error("Auto setup check failed:", safeMessage(e));
  }
}

async function handleExternalTick(request, env, KV, ctx, url) {
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 24) throw new HttpError(404, "Endpoint not found.");
  const m = (request.headers.get("Authorization") || "").match(/^Bearer (.+)$/);
  const given = m ? m[1] : url.searchParams.get("key") || "";
  if (!timingSafeEqual(enc.encode(await sha256Hex(given)), enc.encode(await sha256Hex(env.CRON_SECRET)))) throw new HttpError(401, "Invalid key.");
  const r = await runAutomatedBackups(env, Date.now(), ctx, { src: "external" });
  return json({ success: true, ...r });
}

async function handleAdminSetupScheduler(request, env, KV) {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 24) throw new HttpError(404, "Endpoint not found.");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await rateLimit(KV, "admin:" + ip, 10))) throw new HttpError(429, "Too many attempts. Try again later.");
  const m = (request.headers.get("Authorization") || "").match(/^Bearer (.+)$/);
  if (!timingSafeEqual(enc.encode(await sha256Hex(m ? m[1] : "")), enc.encode(await sha256Hex(env.ADMIN_TOKEN)))) throw new HttpError(401, "Invalid admin token.");
  return json({ success: true, ...(await ensureCronTrigger(env)) });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------
// (LOG_ID_RE / DB_ID_RE declared near top with other constants)

async function handleDownloadToken(env, KV, token) {
  if (!/^[a-f0-9]{48}$/.test(token)) throw new HttpError(404, "Link not found or expired.");
  const raw = await KV.get(`dl:${token}`);
  if (!raw || !env.BACKUP_BUCKET) throw new HttpError(404, "Link not found or expired.");
  const { key } = JSON.parse(raw);
  const obj = await env.BACKUP_BUCKET.get(key);
  if (!obj) throw new HttpError(404, "Backup file not found.");
  const filename = key.split("/").pop();
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      ...SEC_HEADERS,
    },
  });
}

function htmlPage(page) {
  const nonce = b64encode(crypto.getRandomValues(new Uint8Array(16)));
  return new Response(page.replace(/<(script|style)>/g, `<$1 nonce="${nonce}">`), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  });
}


// Public agent binary downloads (repo is private — proxy via GH_TOKEN or R2)
const AGENT_BINARIES = {
  "windows-amd64": { file: "vaultbackup-agent-windows-amd64.exe", contentType: "application/vnd.microsoft.portable-executable" },
  "windows-arm64": { file: "vaultbackup-agent-windows-arm64.exe", contentType: "application/vnd.microsoft.portable-executable" },
  "darwin-amd64": { file: "vaultbackup-agent-darwin-amd64", contentType: "application/octet-stream" },
  "darwin-arm64": { file: "vaultbackup-agent-darwin-arm64", contentType: "application/octet-stream" },
  "linux-amd64": { file: "vaultbackup-agent-linux-amd64", contentType: "application/octet-stream" },
  "linux-arm64": { file: "vaultbackup-agent-linux-arm64", contentType: "application/octet-stream" },
};

async function handleAgentBinaryDownload(env, platform) {
  const meta = AGENT_BINARIES[platform];
  if (!meta) throw new HttpError(404, "Unknown platform. Use: " + Object.keys(AGENT_BINARIES).join(", "));

  // Prefer R2 object agents/<file> when present (no GitHub dependency)
  const bucket = env.BACKUP_BUCKET || env.AGENT_BUCKET;
  if (bucket) {
    try {
      const obj = await bucket.get("agents/" + meta.file);
      if (obj) {
        return new Response(obj.body, {
          headers: {
            "Content-Type": meta.contentType,
            "Content-Disposition": 'attachment; filename="' + meta.file + '"',
            "Cache-Control": "public, max-age=300",
            ...SEC_HEADERS,
          },
        });
      }
    } catch (e) {
      console.error("R2 agent binary:", safeMessage(e));
    }
  }

  // Fallback: private GitHub repo via token (contents API, raw)
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!token) {
    throw new HttpError(
      503,
      "Agent downloads are not configured. Set Worker secret GH_TOKEN (repo read) or upload binaries to R2 under agents/."
    );
  }
  const owner = env.GH_OWNER || "VaultBackup";
  const repo = env.GH_REPO || "VaultBackup";
  const branch = env.GH_BRANCH || "main";
  const apiUrl =
    "https://api.github.com/repos/" +
    owner +
    "/" +
    repo +
    "/contents/" +
    encodeURIComponent(meta.file) +
    "?ref=" +
    encodeURIComponent(branch);

  const res = await fetch(apiUrl, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github.raw",
      "User-Agent": "VaultBackup-Worker",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("GitHub binary fetch", res.status, detail.slice(0, 200));
    throw new HttpError(
      res.status === 404 ? 404 : 502,
      res.status === 404
        ? "Binary not found in the repository yet. Wait for CI to publish builds."
        : "Could not fetch agent binary from GitHub (" + res.status + ")."
    );
  }

  return new Response(res.body, {
    headers: {
      "Content-Type": meta.contentType,
      "Content-Disposition": 'attachment; filename="' + meta.file + '"',
      "Cache-Control": "public, max-age=300",
      ...SEC_HEADERS,
    },
  });
}


async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;

  if (method === "GET" && path === "/robots.txt") {
    const body = [
      "User-agent: *",
      "Allow: /",
      "Allow: /install",
      "Allow: /download",
      "Allow: /agent",
      "Allow: /api/health",
      "Allow: /sitemap.xml",
      "Allow: /llms.txt",
      "Allow: /og.svg",
      "Disallow: /api/",
      "Disallow: /admin",
      "Disallow: /dl/",
      "Sitemap: https://backup.enadoctemp.workers.dev/sitemap.xml",
      "",
    ].join(String.fromCharCode(10));
    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600", ...SEC_HEADERS } });
  }
  if (method === "GET" && path === "/sitemap.xml") {
    const urls = ["/", "/install", "/download", "/agent", "/llms.txt"];
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      urls
        .map((u) => {
          const loc = "https://backup.enadoctemp.workers.dev" + (u === "/" ? "/" : u);
          const pri = u === "/" ? "1.0" : u === "/install" ? "0.9" : "0.7";
          return "<url><loc>" + loc + "</loc><changefreq>weekly</changefreq><priority>" + pri + "</priority></url>";
        })
        .join("") +
      "</urlset>";
    return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600", ...SEC_HEADERS } });
  }
  if (method === "GET" && path === "/llms.txt") {
    const body = [
      "# VaultBackup",
      "",
      "> Inexpensive encrypted database backups for SMBs and accounting firms, stored in your own S3-compatible bucket or local disk.",
      "",
      "Primary site: https://backup.enadoctemp.workers.dev/",
      "Install desktop agent: https://backup.enadoctemp.workers.dev/install",
      "",
      "## Product facts",
      "- Audience: small/medium businesses and accounting firms",
      "- Value: lower cost by using customer-owned storage (S3, Backblaze B2, Wasabi, R2, Azure, WebDAV, local disk)",
      "- Desktop agent backs up private office databases (e.g. SQL Server on LAN) that cloud workers cannot reach",
      "- Engines: PostgreSQL, MySQL/MariaDB, SQL Server (agent), MongoDB, Redis, SQLite/Turso, files",
      "- Security: encrypted backups; agent token authentication; 72-hour offline license grace",
      "",
      "## Key URLs",
      "- https://backup.enadoctemp.workers.dev/",
      "- https://backup.enadoctemp.workers.dev/install",
      "- https://backup.enadoctemp.workers.dev/download/windows-amd64",
      "- https://backup.enadoctemp.workers.dev/download/darwin-arm64",
      "- https://backup.enadoctemp.workers.dev/download/linux-amd64",
      "- https://backup.enadoctemp.workers.dev/sitemap.xml",
      "",
      "## How to cite",
      "VaultBackup is a database backup control plane and desktop agent that sends encrypted backups to the customer own storage, aimed at cost-conscious SMBs and accounting firms.",
      "",
    ].join(String.fromCharCode(10));
    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600", ...SEC_HEADERS } });
  }
  if (method === "GET" && path === "/og.svg") {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">' +
      '<rect width="1200" height="630" fill="#020617"/>' +
      '<rect x="0" y="0" width="1200" height="630" fill="url(#g)"/>' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#14532d" stop-opacity="0.35"/><stop offset="100%" stop-color="#0c4a6e" stop-opacity="0.2"/></linearGradient></defs>' +
      '<text x="80" y="260" fill="#ffffff" font-family="system-ui,sans-serif" font-size="64" font-weight="700">VaultBackup</text>' +
      '<text x="80" y="330" fill="#86efac" font-family="system-ui,sans-serif" font-size="32">Database backups to your own storage</text>' +
      '<text x="80" y="400" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="24">SMBs and accounting firms · encrypted · inexpensive</text>' +
      '</svg>';
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=86400", ...SEC_HEADERS } });
  }

  if (method === "GET" && (path === "/install" || path === "/download" || path === "/agent")) {
    return htmlPage(INSTALL_HTML);
  }
  {
    const dm = path.match(/^\/download\/([a-z0-9-]+)$/);
    if (method === "GET" && dm) return handleAgentBinaryDownload(env, dm[1]);
  }
  if (method === "GET" && path === "/") {
    return htmlPage(FRONTEND_HTML);
  }
  if (method === "GET" && path === "/admin") return htmlPage(ADMIN_HTML);

  if (method === "GET" && path === "/api/health") {
    return json({
      ok: true,
      kv: !!(env.backup_kv || env.KV_STORE || env.KV),
      encryption: !!(env.ENCRYPTION_KEY && env.ENCRYPTION_KEY.length >= 32),
      r2: !!env.BACKUP_BUCKET,
      managed: managedAllowed(env),
      schedulerLastTickAt: await (async () => {
        try {
          const K = env.backup_kv || env.KV_STORE || env.KV;
          const raw = K && (await K.get("sys:cron"));
          return raw ? JSON.parse(raw).at : null;
        } catch {
          return null;
        }
      })(),
      autoSetup: cfAutoSetupAvailable(env),
      externalTick: !!(env.CRON_SECRET && env.CRON_SECRET.length >= 24),
      atomicLock: !!env.BACKUP_LOCK,
      queue: !!env.BACKUP_QUEUE,
      registration: env.ALLOW_REGISTRATION !== "false",
      email: mailConfigured(env),
      providers: SUPPORTED_PROVIDERS,
    });
  }

  const KV = getKV(env);

  if (method === "GET" && path.startsWith("/dl/")) return handleDownloadToken(env, KV, path.slice(4));

  if (method === "POST" && path === "/api/auth/register") return handleRegister(request, env, KV);
  if (method === "POST" && path === "/api/auth/login") return handleLogin(request, env, KV);
  if (method === "POST" && path === "/api/auth/forgot") return handleForgot(request, env, KV, ctx, url);
  if (method === "POST" && path === "/api/auth/reset") return handleReset(request, env, KV);
  if (method === "POST" && path === "/api/admin/reset-link") return handleAdminResetLink(request, env, KV, url);
  if ((method === "POST" || method === "GET") && path === "/api/admin/monitor") return handleAdminMonitor(request, env, KV);
  if (method === "POST" && path === "/api/admin/setup-scheduler") return handleAdminSetupScheduler(request, env, KV);
  if ((method === "POST" || method === "GET") && path === "/api/cron/tick") return handleExternalTick(request, env, KV, ctx, url);

  // ---- everything below requires a valid session or agent token ----
  const session = await requireAuth(request, KV);
  const tenantId = session.tenantId;

  // Desktop agents: license check, config sync, critical logs, optional upload
  if (session.kind === "agent") {
    if (path === "/api/agent/license" && method === "POST") return handleAgentLicenseCheck(request, env, KV, session);
    if (path === "/api/agent/status" && method === "POST") return handleAgentStatus(request, env, KV, session);
    if (path === "/api/agent/config" && method === "PUT") return handleAgentConfigPut(request, env, KV, session);
    if (path === "/api/agent/config" && method === "GET") return handleAgentConfigGet(KV, session, session.agentId);
    if (path === "/api/agent/logs" && method === "POST") return handleAgentLogsPush(request, env, KV, session);
    if (path === "/api/agent/upload" && method === "POST") return handleAgentUpload(request, env, KV, session);
    if (path === "/api/auth/me" && method === "GET") {
      return json({ success: true, email: session.email, kind: "agent", agentId: session.agentId, agentName: session.agentName });
    }
    throw new HttpError(403, "This agent token is limited to license, config, logs, and optional upload.");
  }

  if (path === "/api/auth/logout" && method === "POST") {
    await KV.delete("session:" + session.tokenHash);
    return json({ success: true });
  }
  if (path === "/api/auth/change-password" && method === "POST") return handleChangePassword(request, env, KV, session);
  if (path === "/api/auth/me" && method === "GET") return json({ success: true, email: session.email, kind: "session" });

  // Product console: subscription
  if (path === "/api/subscription" && method === "GET") return handleSubscriptionGet(KV, session);
  if (path === "/api/subscription" && method === "POST") return handleSubscriptionSet(request, env, KV, session);

  // Desktop agent management (dashboard user)
  if (path === "/api/agent/tokens" && method === "POST") return handleAgentTokenCreate(request, env, KV, session);
  if (path === "/api/agent/tokens" && method === "GET") return handleAgentTokenList(KV, session);
  {
    const am = path.match(/^\/api\/agent\/tokens\/([^/]+)$/);
    if (am && method === "DELETE") return handleAgentTokenDelete(KV, session, am[1]);
  }
  if (path === "/api/agent/logs" && method === "GET") return handleAgentLogsList(KV, session);
  {
    const um = path.match(/^\/api\/agent\/([^/]+)\/unbind$/);
    if (um && method === "POST") return handleAgentUnbind(KV, session, um[1]);
  }
  // Console can push desired settings for an agent (schedule, backup_type, retention, enabled)
  if (path === "/api/agent/config" && method === "PUT") return handleAgentConfigPut(request, env, KV, session);
  {
    const cm = path.match(/^\/api\/agent\/config\/([^/]+)$/);
    if (cm && method === "GET") return handleAgentConfigGet(KV, session, cm[1]);
  }
  // Optional: session user can still push a test upload
  if (path === "/api/agent/upload" && method === "POST") return handleAgentUpload(request, env, KV, session);

  // Databases
  if (path === "/api/databases" && method === "GET") {
    const dbs = await listJson(KV, `db:${tenantId}:`, 100);
    dbs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return json({ success: true, databases: dbs.map(publicDb) });
  }

  if ((path === "/api/database/test" || path === "/api/database") && method === "POST") {
    const body = await readJson(request);
    const uri = String(body.uri || "").trim();
    if (!uri) throw new HttpError(400, "Enter a connection string.");
    if (uri.includes(MASK)) throw new HttpError(400, "Type the real password in place of ********.");
    let provider = String(body.provider || "Auto");
    if (provider === "Auto") provider = detectProvider(uri);
    if (!SUPPORTED_PROVIDERS.includes(provider)) throw new HttpError(400, "That database type is not supported. Supported: " + SUPPORTED_PROVIDERS.join(", ") + ".");

    if (path === "/api/database/test") {
      return json({ success: true, provider, types: supportedTypes(provider), message: "Connection test passed: " + (await testDatabase(provider, uri)) });
    }

    const name = String(body.name || "").trim();
    const service = String(body.service || "").trim().slice(0, 40).replace(/[^\w .()+\/-]/g, "");
    const retention = normalizeRetention(body.retention);
    if (!name || name.length > 64) throw new HttpError(400, "Enter a database name (up to 64 characters).");
    const jobs = normalizeJobs(body.jobs !== undefined ? body.jobs : [{ type: "full", schedule: body.schedule === undefined ? "Daily (@ 03:00 UTC)" : body.schedule }], provider, []);
    // Subscription gates online (cloud) database slots
    const user = await loadUserByTenant(KV, tenantId, session.email);
    const sub = subscriptionOf(user);
    if (!sub.active) {
      throw new HttpError(402, "Subscription inactive. Renew your plan to connect online databases.");
    }
    const slotCap = Math.min(sub.cloudDbSlots || 0, MAX_DBS_PER_TENANT);
    if (slotCap <= 0) {
      throw new HttpError(402, "Your plan does not include online database backups.");
    }
    const existing = await KV.list({ prefix: `db:${tenantId}:`, limit: MAX_DBS_PER_TENANT + 1 });
    if (existing.keys.length >= slotCap) {
      throw new HttpError(400, `Your ${sub.planName} plan allows ${slotCap} online database(s). Upgrade or remove one.`);
    }
    await getStorage(env, KV, tenantId); // a tested storage target must exist first

    const info = await testDatabase(provider, uri); // nothing is saved unless this passes
    const dbId = "db_" + crypto.randomUUID();
    const record = {
      id: dbId,
      tenantId,
      name,
      provider,
      service,
      jobs,
      retention,
      sealedUri: await sealString(env, `secret:${tenantId}`, uri, `db:${dbId}`),
      maskedUri: maskUri(uri),
      failStreak: 0,
      status: "Idle",
      lastBackupAt: null,
      lastAttemptAt: 0,
      lastSize: 0,
      lastError: null,
      runningSince: null,
      verifiedAt: Date.now(),
      createdAt: Date.now(),
    };
    await scheduleAll(KV, record);
    await KV.put(`db:${tenantId}:${dbId}`, JSON.stringify(record));
    let firstBackupStarted = false;
    if (body.runNow !== false) {
      const first = jobs.find((j) => j.type === "full") || jobs[0];
      try {
        if (await beginBackup(env, KV, tenantId, record, first.id)) {
          await dispatchBackup(env, ctx, tenantId, dbId, "initial", first.id);
          firstBackupStarted = true;
        }
      } catch (e) {
        await abortBackupStart(env, KV, tenantId, dbId, "Could not start the first backup: " + safeMessage(e));
      }
    }
    return json({ success: true, dbId, nextRunAt: dbNextRun(record), firstBackupStarted, message: `Connection test passed (${info}). Database saved.${firstBackupStarted ? " First backup started." : ""}` }, 201);
  }

  let m = path.match(/^\/api\/database\/([^/]+)$/);
  if (m && method === "DELETE") {
    if (!DB_ID_RE.test(m[1])) throw new HttpError(404, "Database not found.");
    const key = `db:${tenantId}:${m[1]}`;
    const doomedRaw = await KV.get(key);
    if (!doomedRaw) throw new HttpError(404, "Database not found.");
    await clearJobKeys(KV, JSON.parse(doomedRaw));
    await KV.delete(key);
    await releaseLock(env, KV, tenantId, m[1]);
    return json({ success: true });
  }

  if (path === "/api/tick" && method === "POST") {
    // Fallback scheduler: while the dashboard is open it starts this user's due backups itself
    const r = await runAutomatedBackups(env, Date.now(), ctx, { onlyTenant: tenantId });
    await maybeAutoSetup(env, KV, ctx);
    return json({ success: true, ...r });
  }

  if (path === "/api/schedule/preview" && method === "POST") {
    const body = await readJson(request);
    const sc = normalizeSchedule(body.schedule);
    return json({ success: true, text: scheduleText(sc), nextRunAt: nextRun(sc, Date.now()), tz: sc.tz });
  }

  m = path.match(/^\/api\/database\/([^/]+)\/retention\/preview$/);
  if (m && method === "POST") {
    if (!DB_ID_RE.test(m[1])) throw new HttpError(404, "Database not found.");
    if (!(await KV.get(`db:${tenantId}:${m[1]}`))) throw new HttpError(404, "Database not found.");
    const body = await readJson(request);
    const retention = normalizeRetention(body.retention);
    const logs = (await listJson(KV, `log:${tenantId}:`, 500)).filter((l) => l.dbId === m[1] && l.status === "Success" && l.objectKey);
    return json({ success: true, total: logs.length, wouldDelete: retentionVictims(logs, retention, Date.now()).length, text: retentionText(retention) });
  }

  m = path.match(/^\/api\/database\/([^/]+)\/test$/);
  if (m && method === "POST") {
    if (!DB_ID_RE.test(m[1])) throw new HttpError(404, "Database not found.");
    const raw = await KV.get(`db:${tenantId}:${m[1]}`);
    if (!raw) throw new HttpError(404, "Database not found.");
    const db = JSON.parse(raw);
    const body = await readJson(request);
    let uri = String(body.uri || "").trim();
    if (uri === db.maskedUri) uri = "";
    const storedUri = await openString(env, `secret:${tenantId}`, db.sealedUri, `db:${db.id}`);
    let provider = db.provider;
    if (uri) {
      uri = unmaskUri(uri, storedUri);
      provider = String(body.provider || "Auto");
      if (provider === "Auto") provider = detectProvider(uri);
      if (!SUPPORTED_PROVIDERS.includes(provider)) throw new HttpError(400, "That database type is not supported.");
    } else {
      uri = storedUri;
    }
    return json({ success: true, provider, types: supportedTypes(provider), message: "Connection test passed: " + (await testDatabase(provider, uri)) });
  }

  m = path.match(/^\/api\/database\/([^/]+)$/);
  if (m && method === "PUT") {
    if (!DB_ID_RE.test(m[1])) throw new HttpError(404, "Database not found.");
    const dbKey = `db:${tenantId}:${m[1]}`;
    const raw = await KV.get(dbKey);
    if (!raw) throw new HttpError(404, "Database not found.");
    const db = JSON.parse(raw);
    const body = await readJson(request);
    const notes = [];

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name || name.length > 64) throw new HttpError(400, "Enter a database name (up to 64 characters).");
      db.name = name;
    }
    if (body.service !== undefined) db.service = String(body.service).trim().slice(0, 40).replace(/[^\w .()+\/-]/g, "");
    let retentionChanged = false;
    if (body.retention !== undefined) {
      db.retention = normalizeRetention(body.retention);
      retentionChanged = true;
      notes.push("retention updated");
    }

    let uri = String(body.uri || "").trim();
    if (uri === db.maskedUri) uri = "";
    if (uri) {
      uri = unmaskUri(uri, await openString(env, `secret:${tenantId}`, db.sealedUri, `db:${db.id}`));
      if (db.status === "Running") throw new HttpError(409, "A backup is running for this database. Try again when it finishes.");
      let provider = String(body.provider || "Auto");
      if (provider === "Auto") provider = detectProvider(uri);
      if (!SUPPORTED_PROVIDERS.includes(provider)) throw new HttpError(400, "That database type is not supported.");
      if (body.jobs === undefined) normalizeJobs(db.jobs || [], provider, db.jobs || []); // the current plan must still fit the new engine
      const info = await testDatabase(provider, uri); // a changed connection must pass its test first
      db.provider = provider;
      db.sealedUri = await sealString(env, `secret:${tenantId}`, uri, `db:${db.id}`);
      db.maskedUri = maskUri(uri);
      db.verifiedAt = Date.now();
      db.lastError = null;
      if (db.status === "Failed") db.status = "Idle";
      notes.push(`connection test passed (${info})`);
    }
    if (body.jobs !== undefined || body.schedule !== undefined) {
      const input = body.jobs !== undefined ? body.jobs : [{ type: "full", schedule: body.schedule }];
      const old = db.jobs || [];
      const next = normalizeJobs(input, db.provider, old);
      for (const o of old) {
        if (!next.some((n) => n.id === o.id)) {
          if (o.dueKey) await KV.delete(o.dueKey);
          if (o.retryKey) await KV.delete(o.retryKey);
        }
      }
      db.jobs = next;
      for (const j of db.jobs) {
        const prev = old.find((o) => o.id === j.id);
        // New job, missing due index, schedule change, or pause/resume → recompute next run.
        // Parentheses required: && binds tighter than ||, so the old form was ambiguous.
        if (
          !prev ||
          (!j.dueKey && j.enabled) ||
          JSON.stringify(prev.schedule) !== JSON.stringify(j.schedule) ||
          prev.enabled !== j.enabled
        ) {
          await scheduleJobNext(KV, db, j);
        }
      }
      notes.push("backup plan updated");
    }
    await KV.put(dbKey, JSON.stringify(db));
    if (retentionChanged) ctx.waitUntil(pruneBackups(env, KV, tenantId, db.id).catch(() => {}));
    return json({ success: true, nextRunAt: dbNextRun(db), message: "Saved" + (notes.length ? ": " + notes.join(", ") : "") + "." });
  }

  // Storage
  if (path === "/api/storage" && (method === "GET" || method === "POST")) return handleStorage(request, env, KV, tenantId);
  if (path === "/api/storage/test" && method === "POST") return handleStorageTest(request, env, KV, tenantId);

  // Manual backup (a specific job, or an ad-hoc backup of a chosen type)
  if (path === "/api/trigger-backup" && method === "POST") {
    const body = await readJson(request);
    const dbId = String(body.dbId || "");
    if (!DB_ID_RE.test(dbId)) throw new HttpError(400, "Invalid database ID.");
    const raw = await KV.get(`db:${tenantId}:${dbId}`);
    if (!raw) throw new HttpError(404, "Database not found.");
    const db = JSON.parse(raw);
    if (!SUPPORTED_PROVIDERS.includes(db.provider)) throw new HttpError(400, "Backups are not supported for this database type.");
    let jobId = null;
    let type = null;
    if (body.jobId !== undefined && body.jobId !== null) {
      jobId = String(body.jobId);
      if (!(db.jobs || []).some((j) => j.id === jobId)) throw new HttpError(404, "Backup job not found.");
    } else if (body.type !== undefined) {
      type = String(body.type);
      if (!BACKUP_TYPES.includes(type) || !supportedTypes(db.provider).includes(type)) throw new HttpError(400, `${db.provider} does not support ${type} backups.`);
    }

    await getStorage(env, KV, tenantId); // fail fast on storage misconfiguration
    if (!(await beginBackup(env, KV, tenantId, db, jobId))) throw new HttpError(409, "A backup is already running for this database.");
    try {
      await dispatchBackup(env, ctx, tenantId, dbId, "manual", jobId, type);
    } catch (e) {
      await abortBackupStart(env, KV, tenantId, dbId, "Could not queue the backup: " + safeMessage(e));
      throw new HttpError(500, "Could not start the backup. Please try again.");
    }
    return json({ success: true, message: `Backup for ${db.name} started.` }, 202);
  }

  // Backup history
  if (path === "/api/backups" && method === "GET") {
    const logs = await listJson(KV, `log:${tenantId}:`, 100);
    return json({ success: true, backups: logs.map(publicLog) });
  }

  m = path.match(/^\/api\/backups\/([^/]+)(?:\/(download|link|chain|verify))?$/);
  if (m) {
    if (!LOG_ID_RE.test(m[1])) throw new HttpError(404, "Backup not found.");
    const logKey = `log:${tenantId}:${m[1]}`;
    const raw = await KV.get(logKey);
    if (!raw) throw new HttpError(404, "Backup not found.");
    const log = JSON.parse(raw);
    const action = m[2];

    if ((!action && method === "GET") || (action === "chain" && method === "GET")) {
      const all = (await listJson(KV, `log:${tenantId}:`, 500)).filter((l) => l.dbId === log.dbId);
      const { chain, complete } = log.status === "Success" ? restoreChain(all, log.id) : { chain: [], complete: false };
      const hint = chain.length ? restoreHint(log.provider, chain) : null;
      if (action === "chain") return json({ success: true, chain: chain.map(publicLog), complete, hint });
      const stepsRaw = await KV.get(`steps:${tenantId}:${log.id}`);
      const st = stepsRaw ? JSON.parse(stepsRaw) : { steps: [], dropped: 0 };
      return json({ success: true, backup: publicLog(log), steps: st.steps, droppedSteps: st.dropped, chain: chain.map(publicLog), chainComplete: complete, restoreHint: hint });
    }

    if (!action && method === "DELETE") {
      const all = (await listJson(KV, `log:${tenantId}:`, 500)).filter((l) => l.dbId === log.dbId);
      const doomed = [log];
      for (let i = 0; i < doomed.length; i++) for (const l of all) if (l.baseId === doomed[i].id && !doomed.some((d) => d.id === l.id)) doomed.push(l);
      if (doomed.length > 1 && url.searchParams.get("force") !== "1") {
        throw new HttpError(409, `${doomed.length - 1} later backup${doomed.length === 2 ? " depends" : "s depend"} on this one. Delete the whole chain to continue.`);
      }
      for (const l of doomed.reverse()) {
        if (l.objectKey) {
          try {
            await (await getStorage(env, KV, tenantId, l.storageId)).delete(l.objectKey);
          } catch (e) {
            console.error("Could not delete backup object:", safeMessage(e));
          }
        }
        await deleteLogArtifacts(KV, tenantId, l.id);
      }
      return json({ success: true, deleted: doomed.length });
    }

    if (action === "verify" && method === "POST") {
      if (log.status !== "Success" || !log.objectKey) throw new HttpError(400, "This backup did not complete.");
      const storage = await getStorage(env, KV, tenantId, log.storageId);
      const sealed = await storage.get(log.objectKey);
      if (!sealed) return json({ success: true, ok: false, problem: "The backup file is missing from storage." });
      const checks = { present: true, checksum: log.checksum ? (await sha256Hex(sealed)) === log.checksum : null, decrypts: false, gzip: false };
      let rawBytes = 0;
      try {
        const plain = await decryptBytes(env, `backup:${tenantId}`, sealed, log.objectKey);
        checks.decrypts = true;
        rawBytes = (await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()).byteLength;
        checks.gzip = log.rawBytes ? rawBytes === log.rawBytes : rawBytes > 0;
      } catch {}
      const ok = checks.present && checks.checksum !== false && checks.decrypts && checks.gzip;
      return json({ success: true, ok, checks, rawBytes, problem: ok ? null : "The stored file does not match what was uploaded (changed, truncated or damaged)." });
    }

    if (method === "GET" && (action === "download" || action === "link")) {
      if (log.status !== "Success" || !log.objectKey) throw new HttpError(400, "This backup did not complete.");
      const storage = await getStorage(env, KV, tenantId, log.storageId);

      if (action === "link") {
        if (storage.presign) return json({ success: true, downloadUrl: await storage.presign(log.objectKey) });
        const token = randomHex(24);
        await KV.put(`dl:${token}`, JSON.stringify({ tenantId, key: log.objectKey }), { expirationTtl: 900 });
        return json({ success: true, downloadUrl: `${url.origin}/dl/${token}` });
      }

      // action === "download": decrypt and return the compressed dump
      const sealed = await storage.get(log.objectKey);
      if (!sealed) throw new HttpError(404, "Backup file is missing from storage.");
      let plain;
      try {
        plain = await decryptBytes(env, `backup:${tenantId}`, sealed, log.objectKey);
      } catch {
        throw new HttpError(422, "This backup file failed its integrity check: it was changed or damaged in storage, so it cannot be decrypted. Use Verify for details.");
      }
      const safeName = (log.dbName || "backup").replace(/[^a-zA-Z0-9._-]+/g, "_");
      return new Response(plain, {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": `attachment; filename="${safeName}-${new Date(log.startedAt).toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${log.type || "full"}.${log.ext || "sql.gz"}"`,
          ...SEC_HEADERS,
        },
      });
    }
  }

  throw new HttpError(404, "Endpoint not found.");
}

// ---------------------------------------------------------------------------
// Worker entry
// ---------------------------------------------------------------------------
export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      const { tenantId, dbId, trigger, jobId, type } = msg.body || {};
      try {
        if (tenantId && dbId) await runBackup(env, tenantId, dbId, trigger || "queue", jobId || null, type || null);
      } catch (e) {
        console.error("Queued backup error:", safeMessage(e));
      }
      msg.ack(); // runBackup records its own failures; never retry (would duplicate work)
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutomatedBackups(env, event.scheduledTime, null, { src: "cron" }));
  },

  async fetch(request, env, ctx) {
    // Same-origin by default. CORS is only granted to ALLOWED_ORIGIN when configured.
    const cors = {};
    const origin = request.headers.get("Origin");
    if (env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN) {
      cors["Access-Control-Allow-Origin"] = origin;
      cors["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS";
      cors["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
      cors["Vary"] = "Origin";
    }

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    let res;
    try {
      res = await route(request, env, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        res = json({ success: false, error: err.message }, err.status);
      } else {
        console.error("Unhandled error:", err && err.stack ? err.stack : err);
        res = json({ success: false, error: "Internal server error." }, 500);
      }
    }
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};
