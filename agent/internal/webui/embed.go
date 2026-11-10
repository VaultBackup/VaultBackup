package webui

// EmbeddedUI is the agent dashboard. CSP-safe only (no inline handlers/styles).
// License server URL is hardcoded in the binary and never shown as editable.
const EmbeddedUI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>VaultBackup Agent</title>
<link rel="icon" type="image/png" href="/icon.png"/>
<style>
:root{
  --bg:#070d18;--card:#0f172a;--card2:#111c31;--line:#1e293b;--line2:#334155;
  --text:#f1f5f9;--muted:#94a3b8;--brand:#16a34a;--brand2:#15803d;--brand-soft:rgba(22,163,74,.14);
  --warn:#f59e0b;--bad:#ef4444;--ok:#4ade80;
}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:radial-gradient(1200px 600px at 10% -10%,#122033 0%,var(--bg) 55%);color:var(--text);min-height:100vh}
.wrap{max-width:920px;margin:0 auto;padding:1.5rem 1.25rem 3rem}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;margin-bottom:1.25rem}
.brand{display:flex;align-items:center;gap:.75rem}
.logo{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#16a34a,#0f766e);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.9rem;box-shadow:0 8px 24px rgba(22,163,74,.25)}
h1{font-size:1.35rem;margin:0 0 .2rem;letter-spacing:-.02em}
.sub{color:var(--muted);font-size:.88rem;margin:0}
.pill{display:inline-flex;align-items:center;gap:.35rem;padding:.3rem .7rem;border-radius:999px;font-size:.72rem;font-weight:700;border:1px solid var(--line);background:#0b1322;color:var(--muted)}
.pill.ok{color:var(--ok);border-color:rgba(74,222,128,.35);background:rgba(22,163,74,.12)}
.pill.warn{color:#fbbf24;border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.1)}
.steps{display:flex;flex-wrap:wrap;gap:.45rem;margin:0 0 1.15rem}
.step{border:1px solid var(--line);background:#0b1322;color:#64748b;border-radius:999px;padding:.42rem .85rem;font-size:.78rem;font-weight:700;cursor:pointer;transition:.15s ease}
.step:hover{border-color:var(--line2);color:#cbd5e1}
.step.on{border-color:rgba(34,197,94,.45);background:var(--brand-soft);color:#bbf7d0}
.step.done{color:#86efac}
.card{background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);border-radius:16px;padding:1.15rem 1.25rem;margin-bottom:1rem;box-shadow:0 10px 40px rgba(0,0,0,.25)}
h2{font-size:1rem;margin:0 0 .85rem;color:#e2e8f0;font-weight:700}
label{display:block;font-size:.78rem;color:#cbd5e1;margin:.6rem 0 .28rem;font-weight:600}
input,select,textarea{width:100%;background:#060b14;border:1px solid var(--line);border-radius:11px;padding:.7rem .85rem;color:var(--text);font-size:.9rem;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus,select:focus,textarea:focus{border-color:rgba(34,197,94,.55);box-shadow:0 0 0 3px rgba(22,163,74,.15)}
textarea{min-height:5.2rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem;resize:vertical}
.row{display:grid;grid-template-columns:1fr 1fr;gap:.8rem}
@media(max-width:720px){.row{grid-template-columns:1fr}.hdr{flex-direction:column}}
.hint{color:var(--muted);font-size:.78rem;margin-top:.35rem;line-height:1.4}
.note{display:flex;gap:.55rem;align-items:flex-start;background:rgba(15,23,42,.8);border:1px solid var(--line);border-radius:12px;padding:.7rem .85rem;margin:.75rem 0 .25rem}
.note strong{color:#e2e8f0;font-size:.8rem}
.note span{color:var(--muted);font-size:.78rem;display:block;margin-top:.15rem}
.lock{font-size:.95rem;line-height:1}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;border:0;border-radius:11px;padding:.65rem 1.05rem;font-weight:700;font-size:.85rem;cursor:pointer;transition:.15s}
.btn-primary{background:linear-gradient(180deg,#22c55e,#16a34a);color:#fff;box-shadow:0 8px 20px rgba(22,163,74,.25)}
.btn-primary:hover{filter:brightness(1.05)}
.btn-ghost{background:transparent;border:1px solid var(--line);color:#cbd5e1}
.btn-ghost:hover{border-color:var(--line2);background:rgba(148,163,184,.06)}
.actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem}
.nav{display:flex;justify-content:space-between;gap:.5rem;margin-top:1rem}
.panel{display:none}
.panel.on{display:block}
.hidden{display:none !important}
.presets{display:flex;flex-wrap:wrap;gap:.4rem;margin:.5rem 0 .25rem}
.preset{border:1px solid var(--line);background:#0b1322;color:#94a3b8;border-radius:999px;padding:.3rem .7rem;font-size:.72rem;font-weight:700;cursor:pointer}
.preset:hover,.preset.on{border-color:rgba(34,197,94,.4);color:#bbf7d0;background:var(--brand-soft)}
.check{display:flex;align-items:center;gap:.5rem;margin-top:.85rem;font-size:.85rem;color:#cbd5e1}
.check input{width:auto}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:.65rem;margin-bottom:1rem}
@media(max-width:720px){.kpis{grid-template-columns:1fr}}
.kpi{background:rgba(15,23,42,.9);border:1px solid var(--line);border-radius:14px;padding:.8rem .9rem}
.kpi .l{font-size:.7rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.kpi .v{font-size:.95rem;font-weight:700;margin-top:.25rem;color:#e2e8f0}
.review{font-family:ui-monospace,monospace;font-size:.8rem;line-height:1.55;color:#cbd5e1;background:#060b14;border:1px solid var(--line);border-radius:12px;padding:.85rem;white-space:pre-wrap}
pre.status{white-space:pre-wrap;margin:0;font-size:.78rem;color:#94a3b8;max-height:220px;overflow:auto}
.hist-row{display:flex;gap:.5rem;align-items:center;padding:.45rem 0;border-bottom:1px solid rgba(30,41,59,.8);font-size:.82rem;color:#cbd5e1}
.hist-row:last-child{border-bottom:0}
.toast{position:fixed;right:1rem;bottom:1rem;background:#0f172a;border:1px solid var(--line);padding:.75rem 1rem;border-radius:12px;z-index:50;box-shadow:0 12px 40px rgba(0,0,0,.35);max-width:320px}
.toast.hidden{display:none !important}
.toast.ok{border-color:rgba(22,163,74,.5)}
.toast.bad{border-color:rgba(239,68,68,.5)}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <div class="brand">
      <div class="logo">VB</div>
      <div>
        <h1>VaultBackup Agent</h1>
        <p class="sub">Backup private databases to your own disk or cloud storage</p>
      </div>
    </div>
    <div id="status-pill" class="pill">Loading</div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="l">License</div><div class="v" id="kpi-lic">—</div></div>
    <div class="kpi"><div class="l">Database</div><div class="v" id="kpi-db">—</div></div>
    <div class="kpi"><div class="l">Schedule</div><div class="v" id="kpi-sch">—</div></div>
  </div>

  <div class="steps" id="steps">
    <button type="button" class="step on" data-step="1">1 Token</button>
    <button type="button" class="step" data-step="2">2 Database</button>
    <button type="button" class="step" data-step="3">3 Destination</button>
    <button type="button" class="step" data-step="4">4 Review</button>
  </div>

  <form id="cfg-form">
    <div class="panel on" data-panel="1">
      <div class="card">
        <h2>Token and schedule</h2>
        <label for="name">Agent name</label>
        <input id="name" placeholder="office-linux-1" autocomplete="off"/>
        <div class="row">
          <div>
            <label for="schedule">Schedule (cron)</label>
            <input id="schedule" placeholder="0 3 * * *"/>
            <div class="hint">Example: daily at 03:00 UTC</div>
          </div>
          <div>
            <label for="retention">Retention (days)</label>
            <input id="retention" type="number" min="1" value="14"/>
          </div>
        </div>
        <div class="note">
          <div class="lock">🔒</div>
          <div>
            <strong>License server is fixed in this agent</strong>
            <span>https://backup.enadoctemp.workers.dev · cannot be changed</span>
          </div>
        </div>
        <label for="token">Agent token</label>
        <input id="token" type="password" placeholder="Paste token from the cloud dashboard (leave blank to keep)" autocomplete="off"/>
        <div class="hint">Create a token under Desktop Agents in the VaultBackup dashboard.</div>
        <div class="nav">
          <span></span>
          <button type="button" class="btn btn-primary" id="next-1">Continue to database</button>
        </div>
      </div>
    </div>

    <div class="panel" data-panel="2">
      <div class="card">
        <h2>Database</h2>
        <div class="row">
          <div>
            <label for="db_type">Type</label>
            <select id="db_type">
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL / MariaDB</option>
              <option value="mongodb">MongoDB</option>
              <option value="redis">Redis</option>
              <option value="sqlite">SQLite / Turso</option>
            </select>
          </div>
          <div>
            <label for="backup_type">Backup type</label>
            <select id="backup_type">
              <option value="full">Full</option>
              <option value="schema">Schema only</option>
            </select>
          </div>
        </div>
        <label for="db_uri">Connection URI</label>
        <textarea id="db_uri" placeholder="postgres://user:pass@host:5432/db?sslmode=require"></textarea>
        <div class="hint" id="uri_hint">Host must be reachable from this machine (LAN or public).</div>
        <div class="nav">
          <button type="button" class="btn btn-ghost" id="back-2">Back</button>
          <button type="button" class="btn btn-primary" id="next-2">Continue to destination</button>
        </div>
      </div>
    </div>

    <div class="panel" data-panel="3">
      <div class="card">
        <h2>Destination</h2>
        <label for="dest_mode">Storage mode</label>
        <select id="dest_mode">
          <option value="local">Local disk</option>
          <option value="s3">S3 compatible (AWS, B2, Wasabi, R2)</option>
          <option value="azure">Azure Blob</option>
          <option value="webdav">WebDAV / NAS</option>
          <option value="sftp">SFTP</option>
        </select>
        <div id="dest-local">
          <label for="local_dir">Local directory</label>
          <input id="local_dir" placeholder="/var/lib/vaultbackup/backups"/>
        </div>
        <div id="dest-s3" class="hidden">
          <div class="presets" id="s3-presets">
            <button type="button" class="preset" data-preset="aws">AWS S3</button>
            <button type="button" class="preset" data-preset="b2">Backblaze B2</button>
            <button type="button" class="preset" data-preset="wasabi">Wasabi</button>
            <button type="button" class="preset" data-preset="r2">Cloudflare R2</button>
          </div>
          <div class="row">
            <div><label for="s3_endpoint">Endpoint</label><input id="s3_endpoint" placeholder="https://s3.amazonaws.com"/></div>
            <div><label for="s3_region">Region</label><input id="s3_region" placeholder="us-east-1"/></div>
          </div>
          <div class="row">
            <div><label for="s3_bucket">Bucket</label><input id="s3_bucket"/></div>
            <div><label for="s3_prefix">Prefix</label><input id="s3_prefix" placeholder="backups/"/></div>
          </div>
          <div class="row">
            <div><label for="s3_access_key">Access key / Key ID</label><input id="s3_access_key"/></div>
            <div><label for="s3_secret_key">Secret key</label><input id="s3_secret_key" type="password" placeholder="Leave blank to keep"/></div>
          </div>
        </div>
        <div id="dest-azure" class="hidden">
          <div class="row">
            <div><label for="azure_account">Account</label><input id="azure_account"/></div>
            <div><label for="azure_container">Container</label><input id="azure_container"/></div>
          </div>
          <label for="azure_key">Key</label><input id="azure_key" type="password" placeholder="Leave blank to keep"/>
          <label for="azure_prefix">Prefix</label><input id="azure_prefix"/>
        </div>
        <div id="dest-webdav" class="hidden">
          <label for="webdav_url">WebDAV URL</label><input id="webdav_url"/>
          <div class="row">
            <div><label for="webdav_user">User</label><input id="webdav_user"/></div>
            <div><label for="webdav_password">Password</label><input id="webdav_password" type="password"/></div>
          </div>
        </div>
        <div id="dest-sftp" class="hidden">
          <div class="row">
            <div><label for="sftp_host">Host</label><input id="sftp_host"/></div>
            <div><label for="sftp_user">User</label><input id="sftp_user"/></div>
          </div>
          <label for="sftp_path">Path</label><input id="sftp_path" placeholder="/backups"/>
          <div class="row">
            <div><label for="sftp_password">Password</label><input id="sftp_password" type="password"/></div>
            <div><label for="sftp_key_file">Key file path</label><input id="sftp_key_file"/></div>
          </div>
        </div>
        <label class="check"><input type="checkbox" id="encrypt" checked/> Encrypt backups on this machine (AES)</label>
        <div class="nav">
          <button type="button" class="btn btn-ghost" id="back-3">Back</button>
          <button type="button" class="btn btn-primary" id="next-3">Continue to review</button>
        </div>
      </div>
    </div>

    <div class="panel" data-panel="4">
      <div class="card">
        <h2>Review and run</h2>
        <p class="hint">Save config, test the license token, then run a backup once.</p>
        <div id="review" class="review">Not loaded yet.</div>
        <div class="actions">
          <button type="button" class="btn btn-primary" id="btn-save">Save configuration</button>
          <button type="button" class="btn btn-ghost" id="btn-license">Test license</button>
          <button type="button" class="btn btn-ghost" id="btn-run">Run backup once</button>
        </div>
        <div class="nav">
          <button type="button" class="btn btn-ghost" id="back-4">Back</button>
          <span></span>
        </div>
      </div>
      <div class="card">
        <h2>Live status</h2>
        <pre id="status" class="status">—</pre>
      </div>
      <div class="card">
        <h2>Recent history</h2>
        <div id="history" class="hint">No runs yet.</div>
      </div>
    </div>
  </form>
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
    setTimeout(function () { t.classList.add("hidden"); }, 3500);
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
      mongodb: "mongodb://user:pass@host:27017/db",
      redis: "redis://:pass@host:6379/0",
      sqlite: "file:/path/to/db.sqlite or libsql://..."
    };
    $("uri_hint").textContent = "Example: " + (map[t] || "") + " · host must be reachable from this machine.";
  }
  $("db_type").addEventListener("change", uriHint);

  function bodyFromForm() {
    return {
      name: $("name").value.trim(),
      schedule: $("schedule").value.trim() || "0 3 * * *",
      retention: Number($("retention").value) || 14,
      license: { token: $("token").value.trim() },
      database: {
        type: $("db_type").value,
        uri: $("db_uri").value.trim(),
        backup_type: $("backup_type").value
      },
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
      toggleDest();
      uriHint();
      $("kpi-sch").textContent = c.schedule || "0 3 * * *";
    });
  }
  function refreshStatus() {
    return api("/api/status").then(function (j) {
      $("status").textContent = JSON.stringify(j, null, 2);
      var pill = $("status-pill");
      if (j.licenseOk) {
        pill.textContent = "License OK";
        pill.className = "pill ok";
        $("kpi-lic").textContent = "OK";
      } else {
        pill.textContent = j.licenseReason || "Setup needed";
        pill.className = "pill warn";
        $("kpi-lic").textContent = j.licenseReason || "Needed";
      }
      if (j.database) {
        $("kpi-db").textContent = j.database.ok ? "Reachable" : (j.database.status || "Unreachable");
      }
    }).catch(function (e) {
      $("status").textContent = String(e);
    });
  }
  function loadHistory() {
    return api("/api/history").then(function (j) {
      var list = j.history || [];
      if (!list.length) {
        $("history").textContent = "No runs yet.";
        return;
      }
      $("history").innerHTML = list.map(function (h) {
        return "<div class=\"hist-row\"><span class=\"pill\">" +
          (h.status || "") + "</span><span>" + (h.started || "") + " · " +
          (h.message || h.error || "") + "</span></div>";
      }).join("");
    }).catch(function (e) {
      $("history").textContent = String(e);
    });
  }
  $("btn-save").addEventListener("click", function () {
    api("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyFromForm())
    }).then(function (j) {
      toast(j.ok ? "Configuration saved" : "Save failed", !!j.ok);
      $("token").value = "";
      return refreshStatus();
    }).catch(function (e) { toast(String(e), false); });
  });
  $("btn-license").addEventListener("click", function () {
    api("/api/test-license", { method: "POST" }).then(function (j) {
      toast(j.allowed || j.ok ? "License OK" : (j.reason || j.error || "Failed"), !!(j.allowed || j.ok));
      return refreshStatus();
    }).catch(function (e) { toast(String(e), false); });
  });
  $("btn-run").addEventListener("click", function () {
    api("/api/run-once", { method: "POST" }).then(function (j) {
      toast(j.message || "Backup started", true);
      setTimeout(loadHistory, 1500);
      return refreshStatus();
    }).catch(function (e) { toast(String(e), false); });
  });
  $("cfg-form").addEventListener("submit", function (e) { e.preventDefault(); });
  loadConfig().then(function () {
    refreshStatus();
    loadHistory();
  });
  setInterval(refreshStatus, 5000);
})();
</script>
</body>
</html>
`
