package webui

// EmbeddedUI is the agent dashboard. Must stay CSP-safe:
// no onclick=, no style= attributes, only nonced <script>/<style>.
const EmbeddedUI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>VaultBackup Agent</title>
<link rel="icon" type="image/png" href="/icon.png"/>
<style>
:root{--bg:#0b1220;--card:#111827;--line:#1e293b;--text:#e2e8f0;--muted:#94a3b8;--brand:#16a34a;--brand2:#15803d}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.wrap{max-width:960px;margin:0 auto;padding:1.25rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:1rem 1.15rem;margin-bottom:1rem}
h1{font-size:1.25rem;margin:0 0 .35rem}
h2{font-size:1rem;margin:0 0 .75rem;color:#cbd5e1}
label{display:block;font-size:.8rem;color:#cbd5e1;margin:.55rem 0 .25rem;font-weight:600}
input,select,textarea{width:100%;background:#060b14;border:1px solid var(--line);border-radius:10px;padding:.65rem .8rem;color:var(--text);font-size:.9rem}
textarea{min-height:5rem;font-family:ui-monospace,monospace;font-size:.8rem}
.row{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
@media(max-width:700px){.row{grid-template-columns:1fr}}
.btn{display:inline-flex;align-items:center;gap:.4rem;border:0;border-radius:10px;padding:.6rem 1rem;font-weight:700;font-size:.85rem;cursor:pointer}
.btn-primary{background:var(--brand);color:#fff}
.btn-primary:hover{background:var(--brand2)}
.btn-ghost{background:transparent;border:1px solid var(--line);color:#cbd5e1}
.muted{color:var(--muted);font-size:.85rem}
.ok{color:#4ade80}
.pill{display:inline-block;padding:.15rem .5rem;border-radius:999px;font-size:.7rem;font-weight:700;border:1px solid var(--line)}
.steps{display:flex;flex-wrap:wrap;gap:.4rem;margin:.75rem 0 1rem}
.step{border:1px solid var(--line);background:#0f172a;color:#64748b;border-radius:999px;padding:.35rem .7rem;font-size:.75rem;font-weight:700;cursor:pointer}
.step.on{border-color:rgba(34,197,94,.5);background:rgba(34,197,94,.12);color:#a7f3d0}
.panel{display:none}
.panel.on{display:block}
.hidden{display:none !important}
.toast{position:fixed;right:1rem;bottom:1rem;background:#0f172a;border:1px solid var(--line);padding:.7rem 1rem;border-radius:10px;z-index:50}
.toast.hidden{display:none !important}
.toast.ok{border-color:#166534}
.toast.bad{border-color:#7f1d1d}
.hdr{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:1rem}
.actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem}
pre.status{white-space:pre-wrap;margin:0;font-size:.8rem}
.hist-row{margin:.35rem 0}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <div>
      <h1>VaultBackup Agent</h1>
      <div class="muted">Local setup for private databases and your own storage</div>
    </div>
    <div id="status-pill" class="pill">Loading</div>
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
            <div class="muted">Example: daily at 03:00 UTC</div>
          </div>
          <div>
            <label for="retention">Retention (days)</label>
            <input id="retention" type="number" min="1" value="14"/>
          </div>
        </div>
        <label for="server_url">License server URL</label>
        <input id="server_url" placeholder="https://backup.enadoctemp.workers.dev"/>
        <label for="token">Agent token</label>
        <input id="token" type="password" placeholder="Paste token from dashboard (leave blank to keep)" autocomplete="off"/>
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
        <div class="muted">Host must be reachable from this machine.</div>
      </div>
    </div>

    <div class="panel" data-panel="3">
      <div class="card">
        <h2>Destination</h2>
        <label for="dest_mode">Mode</label>
        <select id="dest_mode">
          <option value="local">Local disk</option>
          <option value="s3">S3 compatible</option>
          <option value="azure">Azure Blob</option>
          <option value="webdav">WebDAV / NAS</option>
          <option value="sftp">SFTP</option>
        </select>
        <div id="dest-local">
          <label for="local_dir">Local directory</label>
          <input id="local_dir" placeholder="./data/backups"/>
        </div>
        <div id="dest-s3" class="hidden">
          <div class="row">
            <div><label for="s3_endpoint">Endpoint</label><input id="s3_endpoint"/></div>
            <div><label for="s3_region">Region</label><input id="s3_region"/></div>
          </div>
          <div class="row">
            <div><label for="s3_bucket">Bucket</label><input id="s3_bucket"/></div>
            <div><label for="s3_prefix">Prefix</label><input id="s3_prefix"/></div>
          </div>
          <div class="row">
            <div><label for="s3_access_key">Access key</label><input id="s3_access_key"/></div>
            <div><label for="s3_secret_key">Secret key</label><input id="s3_secret_key" type="password"/></div>
          </div>
        </div>
        <div id="dest-azure" class="hidden">
          <div class="row">
            <div><label for="azure_account">Account</label><input id="azure_account"/></div>
            <div><label for="azure_container">Container</label><input id="azure_container"/></div>
          </div>
          <label for="azure_key">Key</label><input id="azure_key" type="password"/>
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
          <label for="sftp_path">Path</label><input id="sftp_path"/>
          <div class="row">
            <div><label for="sftp_password">Password</label><input id="sftp_password" type="password"/></div>
            <div><label for="sftp_key_file">Key file</label><input id="sftp_key_file"/></div>
          </div>
        </div>
        <label><input type="checkbox" id="encrypt" checked/> Encrypt backups (AES)</label>
      </div>
    </div>

    <div class="panel" data-panel="4">
      <div class="card">
        <h2>Review</h2>
        <p class="muted">Save config, test the license token, then run a backup once.</p>
        <div id="review" class="muted">Not loaded yet.</div>
        <div class="actions">
          <button type="button" class="btn btn-primary" id="btn-save">Save</button>
          <button type="button" class="btn btn-ghost" id="btn-license">Test license</button>
          <button type="button" class="btn btn-ghost" id="btn-run">Run backup once</button>
        </div>
      </div>
      <div class="card">
        <h2>Status</h2>
        <pre id="status" class="muted status">-</pre>
      </div>
      <div class="card">
        <h2>Recent history</h2>
        <div id="history" class="muted">No runs yet.</div>
      </div>
    </div>
  </form>
</div>
<div class="toast hidden" id="toast"></div>
<script>
(function () {
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
      b.classList.toggle("on", b.getAttribute("data-step") === String(n));
    });
    document.querySelectorAll(".panel").forEach(function (p) {
      p.classList.toggle("on", p.getAttribute("data-panel") === String(n));
    });
    if (n === 4) fillReview();
  }
  document.querySelectorAll(".step").forEach(function (b) {
    b.addEventListener("click", function () {
      setStep(Number(b.getAttribute("data-step")));
    });
  });
  function toggleDest() {
    var m = $("dest_mode").value;
    ["local", "s3", "azure", "webdav", "sftp"].forEach(function (k) {
      var el = $("dest-" + k);
      if (el) el.classList.toggle("hidden", m !== k);
    });
  }
  $("dest_mode").addEventListener("change", toggleDest);
  function bodyFromForm() {
    return {
      name: $("name").value.trim(),
      schedule: $("schedule").value.trim() || "0 3 * * *",
      retention: Number($("retention").value) || 14,
      license: {
        server_url: $("server_url").value.trim(),
        token: $("token").value.trim()
      },
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
      "Server: " + (b.license.server_url || "(none)"),
      "DB: " + b.database.type + " / " + (b.database.uri ? "URI set" : "URI missing"),
      "Dest: " + b.destination.mode,
      "Encrypt: " + b.security.encrypt
    ].join("\n");
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
      $("server_url").value = (c.license && c.license.server_url) || "https://backup.enadoctemp.workers.dev";
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
    });
  }
  function refreshStatus() {
    return api("/api/status").then(function (j) {
      $("status").textContent = JSON.stringify(j, null, 2);
      var pill = $("status-pill");
      if (j.licenseOk) {
        pill.textContent = "License OK";
        pill.className = "pill ok";
      } else {
        pill.textContent = j.licenseReason || "Setup needed";
        pill.className = "pill";
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
          (h.status || "") + "</span> " + (h.started || "") + " · " +
          (h.message || h.error || "") + "</div>";
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
      toast(j.ok ? "Saved" : "Save failed", !!j.ok);
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
      toast(j.message || "Started", true);
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
