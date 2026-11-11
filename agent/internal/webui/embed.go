package webui

// EmbeddedUI is the agent dashboard. CSP-safe (no inline handlers/styles).
// License server URL is fixed in the binary and not user-editable.
const EmbeddedUI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>VaultBackup Agent</title>
<link rel="icon" type="image/png" href="/icon.png"/>
<style>
:root{
  --bg:#050a12;--line:rgba(148,163,184,.12);--line2:rgba(148,163,184,.22);
  --text:#f8fafc;--muted:#94a3b8;--dim:#64748b;--brand:#22c55e;--brand-d:#16a34a;
  --brand-glow:rgba(34,197,94,.18);--ok:#4ade80;--warn:#fbbf24;--bad:#f87171;
  --radius:16px;--shadow:0 18px 50px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  min-height:100vh;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
  color:var(--text);
  background:
    radial-gradient(900px 420px at 0% -10%, rgba(34,197,94,.12), transparent 55%),
    radial-gradient(700px 360px at 100% 0%, rgba(14,165,233,.08), transparent 50%),
    linear-gradient(180deg,#071018 0%, var(--bg) 40%);
}
.shell{max-width:980px;margin:0 auto;padding:1.4rem 1.2rem 3rem}
.topbar{
  display:flex;align-items:center;justify-content:space-between;gap:1rem;
  padding:.9rem 1.1rem;margin-bottom:1.2rem;
  background:rgba(11,18,32,.82);border:1px solid var(--line);border-radius:18px;
  backdrop-filter:blur(12px);box-shadow:var(--shadow);
}
.brand{display:flex;align-items:center;gap:.8rem;min-width:0}
.mark{
  width:42px;height:42px;border-radius:13px;flex:0 0 auto;
  display:grid;place-items:center;font-weight:800;font-size:.82rem;
  background:linear-gradient(145deg,#22c55e 0%,#0f766e 100%);
  box-shadow:0 10px 28px rgba(34,197,94,.28), inset 0 1px 0 rgba(255,255,255,.2);
}
.title h1{margin:0;font-size:1.15rem;font-weight:750;letter-spacing:-.03em}
.title p{margin:.15rem 0 0;color:var(--muted);font-size:.8rem}
.badge{
  display:inline-flex;align-items:center;gap:.4rem;
  padding:.38rem .75rem;border-radius:999px;font-size:.72rem;font-weight:700;
  border:1px solid var(--line);background:rgba(15,23,42,.9);color:var(--muted);
}
.badge::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--dim)}
.badge.ok{color:var(--ok);border-color:rgba(74,222,128,.28);background:rgba(22,163,74,.1)}
.badge.ok::before{background:var(--ok);box-shadow:0 0 0 4px rgba(74,222,128,.12)}
.badge.warn{color:var(--warn);border-color:rgba(251,191,36,.28);background:rgba(245,158,11,.1)}
.badge.warn::before{background:var(--warn)}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1.15rem}
@media(max-width:760px){.stats{grid-template-columns:1fr}.topbar{flex-direction:column;align-items:flex-start}}
.stat{
  background:linear-gradient(180deg,rgba(18,28,48,.95),rgba(11,18,32,.95));
  border:1px solid var(--line);border-radius:14px;padding:.9rem 1rem;
}
.stat .k{font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--dim)}
.stat .v{margin-top:.35rem;font-size:.98rem;font-weight:700;color:#e2e8f0}
.rail{
  display:flex;gap:.4rem;padding:.35rem;margin-bottom:1.15rem;
  background:rgba(11,18,32,.75);border:1px solid var(--line);border-radius:999px;
}
@media(max-width:760px){.rail{border-radius:16px;flex-wrap:wrap}}
.step{
  flex:1;min-width:110px;border:0;cursor:pointer;background:transparent;color:var(--dim);
  border-radius:999px;padding:.55rem .7rem;font-size:.78rem;font-weight:700;transition:.18s ease;
}
.step:hover{color:#cbd5e1;background:rgba(148,163,184,.06)}
.step.on{background:var(--brand-glow);color:#bbf7d0;box-shadow:inset 0 0 0 1px rgba(34,197,94,.35)}
.step.done{color:#86efac}
.card{
  background:linear-gradient(180deg,rgba(18,28,48,.98),rgba(11,18,32,.98));
  border:1px solid var(--line);border-radius:var(--radius);padding:1.25rem 1.3rem 1.15rem;
  margin-bottom:1rem;box-shadow:var(--shadow);
}
.card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:1rem}
.card-head h2{margin:0;font-size:1.02rem;font-weight:750;letter-spacing:-.02em}
.card-head p{margin:.25rem 0 0;color:var(--muted);font-size:.8rem;line-height:1.4}
.sec{font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--dim);margin:1rem 0 .45rem}
label{display:block;font-size:.78rem;font-weight:650;color:#cbd5e1;margin:0 0 .32rem}
.field{margin-bottom:.85rem}
.row{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}
@media(max-width:760px){.row{grid-template-columns:1fr}}
input,select,textarea{
  width:100%;background:#070d18;border:1px solid var(--line);border-radius:12px;
  color:var(--text);padding:.72rem .88rem;font-size:.9rem;outline:none;
  transition:border-color .15s, box-shadow .15s, background .15s;
}
input::placeholder,textarea::placeholder{color:#475569}
input:hover,select:hover,textarea:hover{border-color:var(--line2)}
input:focus,select:focus,textarea:focus{
  border-color:rgba(34,197,94,.55);box-shadow:0 0 0 4px rgba(34,197,94,.12);background:#080f1a;
}
textarea{min-height:5.4rem;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;line-height:1.45}
.hint{color:var(--dim);font-size:.76rem;margin-top:.35rem;line-height:1.4}
.callout{
  display:flex;gap:.7rem;align-items:flex-start;
  background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.2);
  border-radius:13px;padding:.8rem .9rem;margin:.2rem 0 1rem;
}
.callout .ic{
  width:28px;height:28px;border-radius:8px;flex:0 0 auto;
  display:grid;place-items:center;background:rgba(34,197,94,.15);color:#86efac;font-size:.85rem;
}
.callout strong{display:block;font-size:.82rem;color:#e2e8f0;margin-bottom:.15rem}
.callout span{display:block;font-size:.76rem;color:var(--muted);line-height:1.4}
.probe{
  display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;
  margin:.35rem 0 .9rem;padding:.7rem .85rem;border-radius:12px;
  border:1px solid var(--line);background:#070d18;
}
.probe .msg{font-size:.8rem;color:var(--muted);line-height:1.4;flex:1;min-width:180px}
.probe.ok{border-color:rgba(74,222,128,.35);background:rgba(22,163,74,.08)}
.probe.ok .msg{color:var(--ok)}
.probe.bad{border-color:rgba(248,113,113,.35);background:rgba(239,68,68,.08)}
.probe.bad .msg{color:var(--bad)}
.probe.busy .msg{color:var(--warn)}
.presets{display:flex;flex-wrap:wrap;gap:.4rem;margin:0 0 .75rem}
.preset{
  border:1px solid var(--line);background:#0a1322;color:var(--muted);
  border-radius:999px;padding:.34rem .72rem;font-size:.72rem;font-weight:700;cursor:pointer;
}
.preset:hover,.preset.on{color:#bbf7d0;border-color:rgba(34,197,94,.4);background:var(--brand-glow)}
.check{display:flex;align-items:center;gap:.55rem;margin:.4rem 0 0;color:#cbd5e1;font-size:.86rem}
.check input{width:auto;accent-color:var(--brand)}
.actions,.nav{display:flex;flex-wrap:wrap;gap:.55rem;margin-top:1.05rem}
.nav{justify-content:space-between;align-items:center}
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:.4rem;
  border:0;border-radius:12px;padding:.68rem 1.1rem;font-size:.85rem;font-weight:750;cursor:pointer;
}
.btn:disabled{opacity:.55;cursor:not-allowed}
.btn-primary{
  color:#fff;background:linear-gradient(180deg,#4ade80 0%, var(--brand) 45%, var(--brand-d) 100%);
  box-shadow:0 10px 24px rgba(22,163,74,.28), inset 0 1px 0 rgba(255,255,255,.2);
}
.btn-ghost{color:#cbd5e1;background:transparent;border:1px solid var(--line)}
.btn-ghost:hover{border-color:var(--line2);background:rgba(148,163,184,.05)}
.panel{display:none}
.panel.on{display:block;animation:in .22s ease}
@keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.hidden{display:none !important}
.review{
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;line-height:1.6;
  color:#cbd5e1;background:#070d18;border:1px solid var(--line);border-radius:12px;padding:1rem;white-space:pre-wrap;
}
pre.status{
  margin:0;white-space:pre-wrap;font-size:.76rem;line-height:1.5;color:var(--muted);
  max-height:220px;overflow:auto;background:#070d18;border:1px solid var(--line);border-radius:12px;padding:.9rem;
}
.hist-row{
  display:flex;gap:.55rem;align-items:center;padding:.55rem 0;
  border-bottom:1px solid rgba(30,41,59,.7);font-size:.82rem;color:#cbd5e1;
}
.hist-row:last-child{border-bottom:0}
.tag{
  display:inline-flex;padding:.16rem .45rem;border-radius:999px;font-size:.68rem;font-weight:700;
  border:1px solid var(--line);background:#0a1322;color:var(--muted);
}
.toast{
  position:fixed;right:1rem;bottom:1rem;z-index:50;max-width:340px;
  background:rgba(15,23,42,.96);border:1px solid var(--line);border-radius:14px;
  padding:.85rem 1rem;box-shadow:var(--shadow);
}
.toast.hidden{display:none !important}
.toast.ok{border-color:rgba(34,197,94,.45)}
.toast.bad{border-color:rgba(248,113,113,.45)}
.foot{margin-top:1.2rem;text-align:center;color:var(--dim);font-size:.74rem}
</style>
</head>
<body>
<div class="shell">
  <header class="topbar">
    <div class="brand">
      <div class="mark">VB</div>
      <div class="title">
        <h1>VaultBackup Agent</h1>
        <p>Private database backups to your own storage</p>
      </div>
    </div>
    <div id="status-pill" class="badge">Loading</div>
  </header>

  <section class="stats">
    <div class="stat"><div class="k">License</div><div class="v" id="kpi-lic">—</div></div>
    <div class="stat"><div class="k">Database</div><div class="v" id="kpi-db">—</div></div>
    <div class="stat"><div class="k">Schedule</div><div class="v" id="kpi-sch">—</div></div>
  </section>

  <nav class="rail" id="steps">
    <button type="button" class="step on" data-step="1">1 · Token</button>
    <button type="button" class="step" data-step="2">2 · Database</button>
    <button type="button" class="step" data-step="3">3 · Destination</button>
    <button type="button" class="step" data-step="4">4 · Review</button>
  </nav>

  <form id="cfg-form">
    <div class="panel on" data-panel="1">
      <div class="card">
        <div class="card-head"><div><h2>Token and schedule</h2><p>Name this agent, set when backups run, and paste your desktop token.</p></div></div>
        <div class="field"><label for="name">Agent name</label><input id="name" placeholder="office-linux-1" autocomplete="off"/></div>
        <div class="row">
          <div class="field"><label for="schedule">Schedule (cron)</label><input id="schedule" placeholder="0 3 * * *"/><div class="hint">Example: daily at 03:00 UTC</div></div>
          <div class="field"><label for="retention">Retention (days)</label><input id="retention" type="number" min="1" value="14"/></div>
        </div>
        <div class="callout"><div class="ic">✓</div><div><strong>License server is fixed in this agent</strong><span>https://backup.enadoctemp.workers.dev · cannot be changed</span></div></div>
        <div class="field"><label for="token">Agent token</label><input id="token" type="password" placeholder="Paste token from the cloud dashboard (leave blank to keep)" autocomplete="off"/></div>
        <div class="nav"><span></span><button type="button" class="btn btn-primary" id="next-1">Continue</button></div>
      </div>
    </div>

    <div class="panel" data-panel="2">
      <div class="card">
        <div class="card-head"><div><h2>Database connection</h2><p>Point the agent at a database reachable from this machine. Test before saving.</p></div></div>
        <div class="row">
          <div class="field">
            <label for="db_type">Engine</label>
            <select id="db_type">
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL / MariaDB</option>
              <option value="mssql">SQL Server</option>
              <option value="mongodb">MongoDB</option>
              <option value="redis">Redis</option>
              <option value="sqlite">SQLite / Turso</option>
            </select>
          </div>
          <div class="field">
            <label for="backup_type">Backup type</label>
            <select id="backup_type"><option value="full">Full</option><option value="schema">Schema only</option></select>
          </div>
        </div>
        <div class="field">
          <label for="db_uri">Connection URI</label>
          <textarea id="db_uri" placeholder="postgres://user:pass@host:5432/db?sslmode=require"></textarea>
          <div class="hint" id="uri_hint">Host must be reachable from this machine (LAN or public).</div>
        </div>
        <div class="probe" id="db-probe">
          <div class="msg" id="db-probe-msg">Test the URI before saving to confirm the host is reachable.</div>
          <button type="button" class="btn btn-ghost" id="btn-test-db">Test connection</button>
        </div>
        <div class="nav">
          <button type="button" class="btn btn-ghost" id="back-2">Back</button>
          <button type="button" class="btn btn-primary" id="next-2">Continue</button>
        </div>
      </div>
    </div>

    <div class="panel" data-panel="3">
      <div class="card">
        <div class="card-head"><div><h2>Backup destination</h2><p>Store backups on local disk or your own S3-compatible bucket.</p></div></div>
        <div class="field">
          <label for="dest_mode">Storage mode</label>
          <select id="dest_mode">
            <option value="local">Local disk</option>
            <option value="s3">S3 compatible (AWS, B2, Wasabi, R2)</option>
            <option value="azure">Azure Blob</option>
            <option value="webdav">WebDAV / NAS</option>
            <option value="sftp">SFTP</option>
          </select>
        </div>
        <div id="dest-local"><div class="field"><label for="local_dir">Local directory</label><input id="local_dir" placeholder="/var/lib/vaultbackup/backups"/></div></div>
        <div id="dest-s3" class="hidden">
          <div class="sec">Provider presets</div>
          <div class="presets" id="s3-presets">
            <button type="button" class="preset" data-preset="aws">AWS S3</button>
            <button type="button" class="preset" data-preset="b2">Backblaze B2</button>
            <button type="button" class="preset" data-preset="wasabi">Wasabi</button>
            <button type="button" class="preset" data-preset="r2">Cloudflare R2</button>
          </div>
          <div class="row">
            <div class="field"><label for="s3_endpoint">Endpoint</label><input id="s3_endpoint"/></div>
            <div class="field"><label for="s3_region">Region</label><input id="s3_region"/></div>
          </div>
          <div class="row">
            <div class="field"><label for="s3_bucket">Bucket</label><input id="s3_bucket"/></div>
            <div class="field"><label for="s3_prefix">Prefix</label><input id="s3_prefix"/></div>
          </div>
          <div class="row">
            <div class="field"><label for="s3_access_key">Access key</label><input id="s3_access_key"/></div>
            <div class="field"><label for="s3_secret_key">Secret key</label><input id="s3_secret_key" type="password" placeholder="Leave blank to keep"/></div>
          </div>
        </div>
        <div id="dest-azure" class="hidden">
          <div class="row">
            <div class="field"><label for="azure_account">Account</label><input id="azure_account"/></div>
            <div class="field"><label for="azure_container">Container</label><input id="azure_container"/></div>
          </div>
          <div class="field"><label for="azure_key">Key</label><input id="azure_key" type="password"/></div>
          <div class="field"><label for="azure_prefix">Prefix</label><input id="azure_prefix"/></div>
        </div>
        <div id="dest-webdav" class="hidden">
          <div class="field"><label for="webdav_url">WebDAV URL</label><input id="webdav_url"/></div>
          <div class="row">
            <div class="field"><label for="webdav_user">User</label><input id="webdav_user"/></div>
            <div class="field"><label for="webdav_password">Password</label><input id="webdav_password" type="password"/></div>
          </div>
        </div>
        <div id="dest-sftp" class="hidden">
          <div class="row">
            <div class="field"><label for="sftp_host">Host</label><input id="sftp_host"/></div>
            <div class="field"><label for="sftp_user">User</label><input id="sftp_user"/></div>
          </div>
          <div class="field"><label for="sftp_path">Path</label><input id="sftp_path"/></div>
          <div class="row">
            <div class="field"><label for="sftp_password">Password</label><input id="sftp_password" type="password"/></div>
            <div class="field"><label for="sftp_key_file">Key file</label><input id="sftp_key_file"/></div>
          </div>
        </div>
        <label class="check"><input type="checkbox" id="encrypt" checked/> Encrypt backups on this machine (AES)</label>
        <div class="nav">
          <button type="button" class="btn btn-ghost" id="back-3">Back</button>
          <button type="button" class="btn btn-primary" id="next-3">Continue</button>
        </div>
      </div>
    </div>

    <div class="panel" data-panel="4">
      <div class="card">
        <div class="card-head"><div><h2>Review and run</h2><p>Save configuration, verify the license, then run a test backup.</p></div></div>
        <div id="review" class="review">Not loaded yet.</div>
        <div class="actions">
          <button type="button" class="btn btn-primary" id="btn-save">Save configuration</button>
          <button type="button" class="btn btn-ghost" id="btn-license">Test license</button>
          <button type="button" class="btn btn-ghost" id="btn-run">Run backup once</button>
        </div>
        <div class="nav"><button type="button" class="btn btn-ghost" id="back-4">Back</button><span></span></div>
      </div>
      <div class="card"><div class="card-head"><div><h2>Live status</h2><p>Updated every few seconds.</p></div></div><pre id="status" class="status">—</pre></div>
      <div class="card"><div class="card-head"><div><h2>Recent history</h2><p>Latest backup attempts.</p></div></div><div id="history" class="hint">No runs yet.</div></div>
    </div>
  </form>
  <div class="foot">VaultBackup Agent · backups stay on your storage</div>
</div>
<div class="toast hidden" id="toast"></div>
<script>
(function () {
  var FIXED_SERVER = "https://backup.enadoctemp.workers.dev";
  function $(id) { return document.getElementById(id); }
  function toast(msg, ok) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden", "ok", "bad");
    t.classList.add(ok ? "ok" : "bad");
    setTimeout(function () { t.classList.add("hidden"); }, 3200);
  }
  function setStep(n) {
    document.querySelectorAll(".step").forEach(function (b) {
      var s = Number(b.getAttribute("data-step"));
      b.classList.toggle("on", s === n);
      b.classList.toggle("done", s < n);
    });
    document.querySelectorAll(".panel").forEach(function (p) {
      p.classList.toggle("on", p.getAttribute("data-panel") === String(n));
    });
    if (n === 4) fillReview();
  }
  document.querySelectorAll(".step").forEach(function (b) {
    b.addEventListener("click", function () { setStep(Number(b.getAttribute("data-step"))); });
  });
  $("next-1").addEventListener("click", function () { setStep(2); });
  $("next-2").addEventListener("click", function () { setStep(3); });
  $("next-3").addEventListener("click", function () { setStep(4); });
  $("back-2").addEventListener("click", function () { setStep(1); });
  $("back-3").addEventListener("click", function () { setStep(2); });
  $("back-4").addEventListener("click", function () { setStep(3); });
  function toggleDest() {
    var m = $("dest_mode").value;
    ["local", "s3", "azure", "webdav", "sftp"].forEach(function (k) {
      var el = $("dest-" + k);
      if (el) el.classList.toggle("hidden", m !== k);
    });
  }
  $("dest_mode").addEventListener("change", toggleDest);
  var presets = {
    aws: { endpoint: "https://s3.amazonaws.com", region: "us-east-1" },
    b2: { endpoint: "https://s3.us-west-004.backblazeb2.com", region: "us-west-004" },
    wasabi: { endpoint: "https://s3.wasabisys.com", region: "us-east-1" },
    r2: { endpoint: "https://<accountid>.r2.cloudflarestorage.com", region: "auto" }
  };
  document.querySelectorAll("#s3-presets .preset").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("#s3-presets .preset").forEach(function (x) { x.classList.remove("on"); });
      btn.classList.add("on");
      var p = presets[btn.getAttribute("data-preset")] || {};
      if (p.endpoint) $("s3_endpoint").value = p.endpoint;
      if (p.region) $("s3_region").value = p.region;
    });
  });
  function uriHint() {
    var t = $("db_type").value;
    var map = {
      postgres: "postgres://user:pass@host:5432/db?sslmode=require",
      mysql: "mysql://user:pass@host:3306/db",
      mssql: "sqlserver://user:pass@host:1433?database=dbname",
      mongodb: "mongodb://user:pass@host:27017/db",
      redis: "redis://:pass@host:6379/0",
      sqlite: "file:/path/to/db.sqlite"
    };
    $("uri_hint").textContent = "Example: " + (map[t] || "") + " · host must be reachable from this machine.";
    $("db_uri").placeholder = map[t] || "";
  }
  $("db_type").addEventListener("change", uriHint);
  function setProbe(state, msg) {
    var box = $("db-probe");
    box.classList.remove("ok", "bad", "busy");
    if (state) box.classList.add(state);
    $("db-probe-msg").textContent = msg;
  }
  $("btn-test-db").addEventListener("click", function () {
    var type = $("db_type").value;
    var uri = $("db_uri").value.trim();
    if (!uri) {
      setProbe("bad", "Enter a connection URI first.");
      toast("Connection URI is required", false);
      return;
    }
    var btn = $("btn-test-db");
    btn.disabled = true;
    setProbe("busy", "Testing connection…");
    api("/api/test-db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: type, uri: uri })
    }).then(function (j) {
      if (j.ok) {
        var tools = j.tools ? (" · tools: " + j.tools) : "";
        setProbe("ok", "Reachable (" + (j.latencyMs || 0) + " ms)" + tools + (j.detail ? " · " + j.detail : ""));
        toast("Database reachable", true);
        $("kpi-db").textContent = "Reachable";
      } else {
        setProbe("bad", (j.status || "Failed") + (j.detail ? ": " + j.detail : "") + (j.tools ? " · tools: " + j.tools : ""));
        toast(j.detail || j.status || "Connection failed", false);
        $("kpi-db").textContent = j.status || "Unreachable";
      }
    }).catch(function (e) {
      setProbe("bad", String(e));
      toast(String(e), false);
    }).then(function () { btn.disabled = false; });
  });
  function bodyFromForm() {
    return {
      name: $("name").value.trim(),
      schedule: $("schedule").value.trim() || "0 3 * * *",
      retention: Number($("retention").value) || 14,
      license: { token: $("token").value.trim() },
      database: { type: $("db_type").value, uri: $("db_uri").value.trim(), backup_type: $("backup_type").value },
      destination: {
        mode: $("dest_mode").value,
        local_dir: $("local_dir").value.trim(),
        s3_endpoint: $("s3_endpoint").value.trim(),
        s3_region: $("s3_region").value.trim(),
        s3_bucket: $("s3_bucket").value.trim(),
        s3_prefix: $("s3_prefix").value.trim(),
        s3_access_key: $("s3_access_key").value.trim(),
        s3_secret_key: $("s3_secret_key").value.trim(),
        azure_account: $("azure_account").value.trim(),
        azure_container: $("azure_container").value.trim(),
        azure_key: $("azure_key").value.trim(),
        azure_prefix: $("azure_prefix").value.trim(),
        webdav_url: $("webdav_url").value.trim(),
        webdav_user: $("webdav_user").value.trim(),
        webdav_password: $("webdav_password").value.trim(),
        sftp_host: $("sftp_host").value.trim(),
        sftp_user: $("sftp_user").value.trim(),
        sftp_password: $("sftp_password").value.trim(),
        sftp_key_file: $("sftp_key_file").value.trim(),
        sftp_path: $("sftp_path").value.trim()
      },
      security: { encrypt: $("encrypt").checked, key_file: "./data/agent.key" }
    };
  }
  function fillReview() {
    var b = bodyFromForm();
    $("review").textContent = [
      "Name: " + (b.name || "(none)"),
      "Schedule: " + b.schedule,
      "License server: " + FIXED_SERVER + " (fixed)",
      "DB: " + b.database.type + " / " + (b.database.uri ? "URI set" : "URI missing"),
      "Dest: " + b.destination.mode,
      "Encrypt: " + b.security.encrypt
    ].join("\n");
    $("kpi-sch").textContent = b.schedule || "—";
  }
  function api(path, opts) {
    return fetch(path, opts).then(function (r) {
      return r.text().then(function (t) {
        try { return JSON.parse(t); }
        catch (e) { throw new Error(t || r.statusText); }
      });
    });
  }
  function loadConfig() {
    return api("/api/config").then(function (j) {
      var c = j.config || {};
      $("name").value = c.name || "";
      $("schedule").value = c.schedule || "0 3 * * *";
      $("retention").value = c.retention || 14;
      $("db_type").value = (c.database && c.database.type) || "postgres";
      $("db_uri").value = (c.database && c.database.uri) || "";
      $("backup_type").value = (c.database && c.database.backup_type) || "full";
      var d = c.destination || {};
      $("dest_mode").value = d.mode || "local";
      $("local_dir").value = d.local_dir || "./data/backups";
      $("s3_endpoint").value = d.s3_endpoint || "";
      $("s3_region").value = d.s3_region || "";
      $("s3_bucket").value = d.s3_bucket || "";
      $("s3_prefix").value = d.s3_prefix || "";
      $("s3_access_key").value = d.s3_access_key || "";
      $("azure_account").value = d.azure_account || "";
      $("azure_container").value = d.azure_container || "";
      $("azure_prefix").value = d.azure_prefix || "";
      $("webdav_url").value = d.webdav_url || "";
      $("webdav_user").value = d.webdav_user || "";
      $("sftp_host").value = d.sftp_host || "";
      $("sftp_user").value = d.sftp_user || "";
      $("sftp_path").value = d.sftp_path || "";
      $("sftp_key_file").value = d.sftp_key_file || "";
      $("encrypt").checked = !c.security || c.security.encrypt !== false;
      toggleDest(); uriHint();
      $("kpi-sch").textContent = c.schedule || "0 3 * * *";
    });
  }
  function refreshStatus() {
    return api("/api/status").then(function (j) {
      $("status").textContent = JSON.stringify(j, null, 2);
      var pill = $("status-pill");
      if (j.licenseOk) { pill.textContent = "License OK"; pill.className = "badge ok"; $("kpi-lic").textContent = "Active"; }
      else { pill.textContent = j.licenseReason || "Setup needed"; pill.className = "badge warn"; $("kpi-lic").textContent = j.licenseReason || "Needed"; }
      if (j.database) $("kpi-db").textContent = j.database.ok ? "Reachable" : (j.database.status || "Unreachable");
    }).catch(function (e) { $("status").textContent = String(e); });
  }
  function loadHistory() {
    return api("/api/history").then(function (j) {
      var list = j.history || [];
      if (!list.length) { $("history").textContent = "No runs yet."; return; }
      $("history").innerHTML = list.map(function (h) {
        return "<div class=\"hist-row\"><span class=\"tag\">" + (h.status || "") + "</span><span>" + (h.started || "") + " · " + (h.message || h.error || "") + "</span></div>";
      }).join("");
    }).catch(function (e) { $("history").textContent = String(e); });
  }
  $("btn-save").addEventListener("click", function () {
    api("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyFromForm()) })
      .then(function (j) { toast(j.ok ? "Configuration saved" : "Save failed", !!j.ok); $("token").value = ""; return refreshStatus(); })
      .catch(function (e) { toast(String(e), false); });
  });
  $("btn-license").addEventListener("click", function () {
    api("/api/test-license", { method: "POST" })
      .then(function (j) { toast(j.allowed || j.ok ? "License OK" : (j.reason || j.error || "Failed"), !!(j.allowed || j.ok)); return refreshStatus(); })
      .catch(function (e) { toast(String(e), false); });
  });
  $("btn-run").addEventListener("click", function () {
    api("/api/run-once", { method: "POST" })
      .then(function (j) { toast(j.message || "Backup started", true); setTimeout(loadHistory, 1500); return refreshStatus(); })
      .catch(function (e) { toast(String(e), false); });
  });
  $("cfg-form").addEventListener("submit", function (e) { e.preventDefault(); });
  loadConfig().then(function () { refreshStatus(); loadHistory(); });
  setInterval(refreshStatus, 5000);
})();
</script>
</body>
</html>
`
