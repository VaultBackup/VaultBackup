package webui

// EmbeddedUI is served at /. Full enhanced UI is also at repo root:
// vaultbackup-agent-ui-enhanced.html
const EmbeddedUI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>VaultBackup Agent</title>
<style>
:root { --bg:#0b1220; --card:#111827; --border:#1f2937; --text:#e5e7eb; --muted:#94a3b8; --brand:#22c55e; }
body { margin:0; font-family: system-ui,sans-serif; background:var(--bg); color:var(--text); }
header { padding:1rem 1.25rem; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; }
main { max-width:920px; margin:0 auto; padding:1.25rem; display:grid; gap:1rem; }
.card { background:var(--card); border:1px solid var(--border); border-radius:14px; padding:1rem; }
label { display:block; font-size:11px; color:var(--muted); margin-bottom:.25rem; }
input,select,textarea { width:100%; background:#020617; border:1px solid var(--border); color:var(--text); border-radius:10px; padding:.55rem .7rem; font-size:13px; box-sizing:border-box; }
.grid { display:grid; gap:.75rem; } @media(min-width:720px){ .grid-2{ grid-template-columns:1fr 1fr; } }
button { border:0; border-radius:10px; padding:.55rem .9rem; font-size:13px; font-weight:600; cursor:pointer; background:#16a34a; color:#fff; }
button.sec { background:#1e293b; color:#e2e8f0; border:1px solid var(--border); }
.row { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; }
.muted { color:var(--muted); font-size:12px; }
.ok { color:#6ee7b7; } .err { color:#f87171; }
.badge { font-size:11px; padding:.2rem .55rem; border-radius:999px; border:1px solid var(--border); color:var(--muted); }
.badge.ok { color:#6ee7b7; border-color:#065f46; }
.badge.warn { color:#fcd34d; border-color:#92400e; }
</style>
</head>
<body>
<header>
  <div><strong>VaultBackup Agent</strong><div class="muted">Local setup · status reports to your Worker</div></div>
  <div class="row"><span class="badge" id="setup-badge">…</span><span class="badge" id="lic-badge">License</span></div>
</header>
<main>
  <div class="card">
    <h3 style="margin-top:0">Setup</h3>
    <div class="grid grid-2">
      <div><label>Agent name</label><input id="name" placeholder="accounting-pc-1"/></div>
      <div><label>Schedule (cron)</label><input id="schedule" placeholder="0 3 * * *"/></div>
      <div><label>Worker URL</label><input id="server_url" placeholder="https://your-worker.example.com"/></div>
      <div><label>Agent token</label><input id="token" type="password" placeholder="paste token once"/></div>
      <div><label>Database type</label>
        <select id="db_type"><option value="postgres">PostgreSQL</option><option value="mysql">MySQL</option><option value="sqlite">SQLite</option><option value="mongodb">MongoDB</option><option value="redis">Redis</option><option value="mssql">SQL Server</option><option value="files">Files</option><option value="command">Command</option></select>
      </div>
      <div><label>Backup type</label>
        <select id="backup_type"><option value="full">Full</option><option value="incremental">Incremental</option><option value="differential">Differential</option></select>
      </div>
      <div style="grid-column:1/-1"><label>Connection string or path</label><textarea id="db_uri" placeholder="postgresql://user:pass@127.0.0.1:5432/db"></textarea></div>
      <div><label>Destination</label>
        <select id="dest_mode"><option value="s3">S3 / R2 / B2</option><option value="local">Local</option><option value="vaultbackup">Worker upload</option><option value="azure">Azure</option><option value="webdav">WebDAV</option><option value="sftp">SFTP</option></select>
      </div>
      <div><label>Retention</label><input id="retention" type="number" value="14"/></div>
      <div><label>S3 endpoint</label><input id="s3_endpoint"/></div>
      <div><label>S3 bucket</label><input id="s3_bucket"/></div>
      <div><label>S3 access key</label><input id="s3_access_key"/></div>
      <div><label>S3 secret key</label><input id="s3_secret_key" type="password"/></div>
      <div><label>Local dir</label><input id="local_dir"/></div>
      <div><label>Encrypt</label><input id="encrypt" type="checkbox" checked/></div>
    </div>
    <div class="row" style="margin-top:1rem">
      <button id="btn-save">Save</button>
      <button class="sec" id="btn-license">Test license</button>
      <button class="sec" id="btn-run">Run backup now</button>
    </div>
    <p id="msg" class="muted"></p>
  </div>
  <div class="card"><h3 style="margin-top:0">Machine</h3>
    <div class="muted">Host: <span id="m-host">—</span> · CPU: <span id="m-cpu">—</span> · RAM: <span id="m-ram">—</span></div>
  </div>
  <div class="card"><h3 style="margin-top:0">History</h3><div id="history" class="muted">No runs yet</div></div>
  <div class="card"><h3 style="margin-top:0">Log</h3><pre id="log" class="muted" style="white-space:pre-wrap;max-height:200px;overflow:auto">(loading)</pre></div>
</main>
<script>
async function api(path, method, body) {
  const opt = { method: method || 'GET', headers: {}, credentials: 'same-origin' };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(path, opt);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}
function $(id){ return document.getElementById(id); }
function msg(t, bad){ const el=$('msg'); el.textContent=t||''; el.className = bad ? 'err' : 'ok'; }
function bodyFromForm(){
  return {
    name: $('name').value.trim(), schedule: $('schedule').value.trim(),
    retention: Number($('retention').value)||14,
    license: { server_url: $('server_url').value.trim(), token: $('token').value.trim() },
    security: { encrypt: $('encrypt').checked },
    database: { type: $('db_type').value, uri: $('db_uri').value.trim(), backup_type: $('backup_type').value },
    destination: {
      mode: $('dest_mode').value,
      s3_endpoint: $('s3_endpoint').value.trim(), s3_bucket: $('s3_bucket').value.trim(),
      s3_access_key: $('s3_access_key').value.trim(), s3_secret_key: $('s3_secret_key').value,
      local_dir: $('local_dir').value.trim()
    }
  };
}
async function refresh(){
  try {
    const d = await api('/api/status');
    const h = d.host || {};
    $('m-host').textContent = h.hostname || h.host || '—';
    if (h.cpuPercent != null) $('m-cpu').textContent = Math.round(h.cpuPercent)+'%';
    if (h.memUsedMb != null) $('m-ram').textContent = Math.round(h.memUsedMb)+' MB';
    const sb = $('setup-badge');
    if (d.complete) { sb.textContent = 'Ready'; sb.className = 'badge ok'; }
    else { sb.textContent = 'Setup needed'; sb.className = 'badge warn'; }
    const lb = $('lic-badge');
    if (d.licenseOk) { lb.textContent = 'License OK'; lb.className = 'badge ok'; }
    else { lb.textContent = 'License'; lb.className = 'badge warn'; }
  } catch(e) {}
}
$('btn-save').onclick = async () => {
  try { msg('Saving…'); const d = await api('/api/config','POST', bodyFromForm());
    msg(d.complete ? 'Saved. Complete.' : 'Saved, fields missing.', !d.complete);
    $('token').value = ''; await refresh();
  } catch(e){ msg(e.message, true); }
};
$('btn-license').onclick = async () => {
  try { msg('Checking…'); await api('/api/config','POST', bodyFromForm());
    const d = await api('/api/test-license','POST',{});
    msg((d.ok||d.allowed) ? 'License OK' : (d.error||d.reason||'Denied'), !(d.ok||d.allowed));
    await refresh();
  } catch(e){ msg(e.message, true); }
};
$('btn-run').onclick = async () => {
  try { msg('Starting…'); const d = await api('/api/run-once','POST',{}); msg(d.message||'Started'); }
  catch(e){ msg(e.message, true); }
};
(async () => {
  try { const d = await api('/api/config'); const c = d.config||{};
    $('name').value = c.name||''; $('schedule').value = c.schedule||'0 3 * * *';
    if (c.license) $('server_url').value = c.license.server_url||'';
    if (c.database) { $('db_type').value = c.database.type||'postgres'; $('db_uri').value = c.database.uri||''; $('backup_type').value = c.database.backup_type||'full'; }
    if (c.destination) { $('dest_mode').value = c.destination.mode||'s3'; $('s3_endpoint').value = c.destination.s3_endpoint||''; $('s3_bucket').value = c.destination.s3_bucket||''; $('local_dir').value = c.destination.local_dir||''; }
  } catch(e) {}
  await refresh();
  setInterval(refresh, 5000);
  try { const d = await api('/api/logs'); $('log').textContent = d.log||''; } catch(e) {}
  try {
    const d = await api('/api/history');
    if (d.history && d.history.length) {
      $('history').innerHTML = d.history.slice(0,10).map(h => (h.started||'')+' · '+(h.status||'')+' · '+(h.size||'')).join('<br/>');
    }
  } catch(e) {}
})();
</script>
</body>
</html>`
