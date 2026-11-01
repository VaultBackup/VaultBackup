package webui

// EmbeddedUI is the agent local dashboard (compact build for repo sync).
// Full enhanced UI lives in agent-source internal/webui/embed.go (~37KB).
const EmbeddedUI = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>VaultBackup Agent</title>
<style>
:root{--bg:#0f1419;--card:#1a2332;--accent:#3b82f6;--ok:#22c55e;--err:#ef4444;--tx:#e7ecf3;--mut:#94a3b8}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--tx)}
header{padding:16px 20px;border-bottom:1px solid #243044;display:flex;justify-content:space-between;align-items:center}
h1{margin:0;font-size:18px}main{max-width:900px;margin:20px auto;padding:0 16px}
.card{background:var(--card);border-radius:10px;padding:16px;margin-bottom:14px}
label{display:block;margin:8px 0 4px;color:var(--mut);font-size:12px}
input,select{width:100%;padding:8px 10px;border-radius:6px;border:1px solid #334155;background:#0b1220;color:var(--tx)}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
button{background:var(--accent);color:#fff;border:0;border-radius:6px;padding:8px 14px;cursor:pointer;margin-right:8px}
button.sec{background:#334155}.ok{color:var(--ok)}.err{color:var(--err)}
pre{background:#0b1220;padding:10px;border-radius:6px;overflow:auto;max-height:240px;font-size:12px}
.badge{padding:2px 8px;border-radius:999px;background:#243044;font-size:12px}
</style></head><body>
<header><h1>VaultBackup Agent</h1><span class="badge" id="lic">...</span></header>
<main>
<div class="card"><h3>Status</h3><div id="status">Loading...</div>
<button onclick="runOnce()">Run backup now</button>
<button class="sec" onclick="refresh()">Refresh</button></div>
<div class="card"><h3>Configuration</h3>
<div class="row">
<div><label>Agent name</label><input id="name"/></div>
<div><label>Schedule (cron)</label><input id="schedule" placeholder="0 3 * * *"/></div>
</div>
<div class="row">
<div><label>Database type</label>
<select id="dbtype"><option>postgres</option><option>mysql</option><option>mongodb</option><option>sqlite</option>
<option>redis</option><option>mssql</option><option>files</option><option>quickbooks</option>
<option>sage50</option><option>access</option><option>command</option></select></div>
<div><label>Backup type</label><select id="btype"><option>full</option><option>incremental</option><option>native</option><option>files</option></select></div>
</div>
<label>Database URI / path</label><input id="uri"/>
<div class="row">
<div><label>Destination mode</label>
<select id="mode" onchange="tog()"><option>s3</option><option>local</option><option>azure</option><option>sftp</option><option>webdav</option><option>vaultbackup</option></select></div>
<div><label>License token</label><input id="token" type="password" autocomplete="off"/></div>
</div>
<div id="dest-s3" class="row"><div><label>S3 bucket</label><input id="s3b"/></div><div><label>S3 region</label><input id="s3r" value="auto"/></div></div>
<div id="dest-local" class="row" style="display:none"><div><label>Local dir</label><input id="local"/></div></div>
<label><input type="checkbox" id="encrypt" checked/> Encrypt backups</label>
<label><input type="checkbox" id="vss"/> Use VSS (Windows)</label>
<div style="margin-top:12px">
<button onclick="save()">Save config</button>
<button class="sec" onclick="testLic()">Test license</button>
</div>
<p id="msg"></p></div>
<div class="card"><h3>History</h3><pre id="hist"></pre></div>
<div class="card"><h3>Logs</h3><pre id="log"></pre></div>
</main>
<script>
var $=function(id){return document.getElementById(id)};
function hdr(){var p=sessionStorage.getItem('ui_pw');return p?{'X-UI-Password':p}:{}};
function j(url,opt){opt=opt||{};var h=Object.assign({},hdr(),opt.headers||{},{'Content-Type':'application/json'});
return fetch(url,Object.assign({},opt,{headers:h})).then(function(r){
  if(r.status===401){var p=prompt('UI password');if(p){sessionStorage.setItem('ui_pw',p);return j(url,opt)}throw new Error('Unauthorized')}
  if(!r.ok)return r.text().then(function(t){throw new Error(t)});return r.json()})}
function tog(){var m=$('mode').value;$('dest-s3').style.display=m==='s3'?'grid':'none';$('dest-local').style.display=m==='local'?'grid':'none'}
function refresh(){j('/api/status').then(function(s){
  $('status').innerHTML='Complete: <b class="'+(s.complete?'ok':'err')+'">'+s.complete+'</b> · DB: '+(s.database&&s.database.status||'—')+' · '+(s.database&&s.database.detail||'');
  $('lic').textContent=s.licenseOk?'License OK':(s.licenseReason||'License?');
  $('lic').className='badge '+(s.licenseOk?'ok':'err');
}).catch(function(e){$('status').innerHTML='<span class="err">'+e.message+'</span>'});
j('/api/history').then(function(h){$('hist').textContent=(h.history||[]).map(function(e){return e.started+' ['+e.status+'] '+(e.type||'')+' '+(e.size?e.size+'B':'')+' '+(e.error||e.message||'')}).join('\n')||'(empty)'});
j('/api/logs').then(function(l){$('log').textContent=l.log||'(no log)'})}
function load(){j('/api/config').then(function(d){var c=d.config||{};
$('name').value=c.name||'';$('schedule').value=c.schedule||'';$('dbtype').value=(c.database&&c.database.type)||'postgres';
$('btype').value=(c.database&&c.database.backup_type)||'full';$('uri').value=(c.database&&c.database.uri)||'';
$('mode').value=(c.destination&&c.destination.mode)||'s3';$('s3b').value=(c.destination&&c.destination.s3_bucket)||'';
$('s3r').value=(c.destination&&c.destination.s3_region)||'auto';$('local').value=(c.destination&&c.destination.local_dir)||'';
$('encrypt').checked=!!(c.security&&c.security.encrypt);$('vss').checked=!!(c.database&&c.database.use_vss);tog()})}
function save(){var body={name:$('name').value,schedule:$('schedule').value,
license:{token:$('token').value},security:{encrypt:$('encrypt').checked},
database:{type:$('dbtype').value,uri:$('uri').value,backup_type:$('btype').value,use_vss:$('vss').checked},
destination:{mode:$('mode').value,s3_bucket:$('s3b').value,s3_region:$('s3r').value,local_dir:$('local').value}};
j('/api/config',{method:'POST',body:JSON.stringify(body)}).then(function(r){$('msg').textContent=r.complete?'Saved · complete':'Saved · incomplete';$('msg').className=r.complete?'ok':'err';refresh()}).catch(function(e){$('msg').textContent=e.message;$('msg').className='err'})}
function testLic(){j('/api/test-license',{method:'POST',body:'{}'}).then(function(r){$('msg').textContent=r.allowed?'License allowed':'License: '+(r.reason||r.error);$('msg').className=r.allowed?'ok':'err'}).catch(function(e){$('msg').textContent=e.message})}
function runOnce(){j('/api/run-once',{method:'POST',body:'{}'}).then(function(){$('msg').textContent='Backup started';refresh()}).catch(function(e){$('msg').textContent=e.message})}
load();refresh();setInterval(refresh,8000);
</script></body></html>`
