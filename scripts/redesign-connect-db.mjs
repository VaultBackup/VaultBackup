#!/usr/bin/env node
/** Connect Database: visual polish + non-destructive multi-step (nested-aware). */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

// Shell
for (const [a, b] of [
  ['id="db-modal-backdrop" class="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"', 'id="db-modal-backdrop" class="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"'],
  ['class="absolute inset-y-0 right-0 w-full max-w-lg bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col"', 'class="db-drawer absolute inset-y-0 right-0 w-full max-w-xl bg-[#0b1220] border-l border-slate-800/90 shadow-2xl flex flex-col"'],
]) {
  if (s.includes(a)) s = s.replace(a, b);
}

for (const old of [
  "Name it, pick the engine, paste the URL, test, then save.",
  "Name the database, choose a service, paste the connection URL, test, then save.",
  "Three short steps. Test the connection before you save.",
]) {
  if (s.includes(old)) s = s.replaceAll(old, "Step through connection, backup plan, and retention. Test before you save.");
}

if (s.includes('id="db-modal-steps"')) {
  s = s.replace(/id="db-modal-steps" class="[^"]*"[^>]*>[^<]*/, 'id="db-modal-steps" class="db-wiz-steps" role="tablist" aria-label="Setup steps">');
}

for (const [re, b] of [
  [/id="btn-cancel-modal" class="[^"]*"/, 'id="btn-cancel-modal" class="db-btn db-btn-ghost px-4 py-2.5 text-xs font-medium rounded-xl transition"'],
  [/id="btn-test-db" class="[^"]*"/, 'id="btn-test-db" class="db-btn db-btn-secondary px-4 py-2.5 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 transition"'],
  [/id="btn-save-db" disabled class="[^"]*"/, 'id="btn-save-db" disabled class="db-btn db-btn-primary px-5 py-2.5 text-xs font-semibold rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed transition"'],
]) {
  if (re.test(s)) s = s.replace(re, b);
}

const css = `
/* __DB_REDESIGN_CSS__ */
#db-modal .db-drawer { background: linear-gradient(180deg,#0d1526 0%,#0b1220 45%,#0a101c 100%); }
#db-modal #db-modal-sub { font-size: 12px; color: #94a3b8; line-height: 1.45; max-width: 28rem; }
#db-modal .overflow-y-auto { padding: 1.25rem 1.5rem 1.5rem !important; }
#db-modal label { font-size: 12px; font-weight: 600; color: #cbd5e1; }
#db-modal input[type="text"], #db-modal input[type="password"], #db-modal select, #db-modal textarea {
  width: 100%; background: #060b14; border: 1px solid #1e293b; border-radius: 12px;
  padding: 0.7rem 0.9rem; font-size: 13px; color: #e2e8f0; outline: none;
}
#db-modal textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; min-height: 5.5rem; }
#db-modal input:focus, #db-modal select:focus, #db-modal textarea:focus {
  border-color: rgba(34,197,94,0.45); box-shadow: 0 0 0 3px rgba(34,197,94,0.12);
}
#db-modal .provider-chip {
  display: inline-flex; font-size: 11px; font-weight: 600; padding: 0.4rem 0.75rem;
  border-radius: 999px; border: 1px solid #334155; background: #0b1220; color: #cbd5e1;
}
#db-modal .provider-chip:hover { border-color: rgba(34,197,94,0.45); color: #bbf7d0; background: rgba(34,197,94,0.08); }
#db-modal .db-wiz-steps { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 0.75rem; }
#db-modal .db-wiz-step {
  display: inline-flex; align-items: center; gap: 0.4rem; border: 1px solid #1e293b; background: #0f172a;
  color: #64748b; font-size: 11px; font-weight: 600; padding: 0.4rem 0.75rem; border-radius: 999px; cursor: pointer;
}
#db-modal .db-wiz-step .db-wiz-num {
  width: 1.2rem; height: 1.2rem; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center;
  background: #1e293b; color: #94a3b8; font-size: 10px;
}
#db-modal .db-wiz-step.is-on { border-color: rgba(34,197,94,0.5); background: rgba(34,197,94,0.1); color: #a7f3d0; }
#db-modal .db-wiz-step.is-on .db-wiz-num { background: #16a34a; color: #fff; }
#db-modal .db-wiz-step.is-done { border-color: rgba(34,197,94,0.25); color: #6ee7b7; }
#db-modal .db-btn-ghost { background: transparent; border: 1px solid #334155; color: #94a3b8; border-radius: 12px; }
#db-modal .db-btn-secondary { background: #0f172a; border: 1px solid #334155; color: #e2e8f0; border-radius: 12px; }
#db-modal .db-btn-primary { background: #16a34a; border: 1px solid #16a34a; color: #fff; border-radius: 12px; box-shadow: 0 0 24px rgba(22,163,74,0.2); }
#db-modal .db-btn-primary:disabled { opacity: 0.4; box-shadow: none; }
#db-modal [data-db-step-item].is-hidden-step { display: none !important; }
`;

s = s.replace(/\/\* __DB_WIZARD_CSS__[\s\S]*?(?=\n\/\*|\n<\/style>)/g, "");
s = s.replace(/\/\* __DB_REDESIGN_CSS__[\s\S]*?(?=\n\/\*|\n<\/style>)/g, "");
if (s.includes("</style>")) s = s.replace("</style>", css + "\n</style>");

s = s.replace(/\/\* __DB_WIZARD__ \*\/[\s\S]*?\}\)\(\);\s*/g, "");

const js = `
/* __DB_WIZARD__ */
(function(){
  function $(id){ return document.getElementById(id); }
  var step = 1, max = 3;

  function modal(){ return $('db-modal'); }
  function scrollEl(){ var m = modal(); return m ? m.querySelector('.overflow-y-auto') : null; }

  function headText(el){
    var t = ((el.innerText || el.textContent || '') + '').replace(/\\s+/g,' ').trim().toLowerCase();
    return t.slice(0, 80);
  }

  function stepFromText(t){
    if (/step\\s*3|3\\s*[·•.].{0,16}retention|\\bretention\\b/.test(t) && /step|retention|keep/.test(t)) {
      if (/step\\s*3|3\\s*[·•.]/.test(t) || /^retention/.test(t) || /retention/.test(t) && !/connection|backup plan/.test(t.slice(0,40))) return 3;
    }
    if (/step\\s*2|2\\s*[·•.].{0,16}backup|backup\\s*plan|add a backup job/.test(t)) return 2;
    if (/step\\s*1|1\\s*[·•.].{0,16}connection|database name|connection url|quick pick|popular services/.test(t)) return 1;
    return 0;
  }

  function collectTargets(sc){
    // Prefer tagging nested blocks when scroll has a single wrapper
    var kids = Array.prototype.slice.call(sc.children);
    if (kids.length === 1 && kids[0].children && kids[0].children.length >= 2) {
      return Array.prototype.slice.call(kids[0].children);
    }
    if (kids.length === 1 && kids[0].children && kids[0].children.length === 1 && kids[0].children[0].children) {
      var inner = kids[0].children[0];
      if (inner.children && inner.children.length >= 2) return Array.prototype.slice.call(inner.children);
    }
    return kids;
  }

  function tagSteps(){
    var sc = scrollEl(); if(!sc) return false;
    if (sc.getAttribute('data-wiz-tagged') === '1') return true;
    var targets = collectTargets(sc);
    if (!targets.length) return false;
    var cur = 1;
    targets.forEach(function(el){
      var t = headText(el);
      var c = stepFromText(t);
      // id-based anchors
      if (!c) {
        if (el.querySelector && (el.querySelector('#new-db-name') || el.querySelector('#provider-chips') || el.querySelector('#new-db-provider') || el.id === 'new-db-name')) c = 1;
        else if (el.querySelector && (el.querySelector('[id*="backup"]') || /preset/i.test(el.textContent||''))) c = 2;
      }
      if (c) cur = c;
      el.setAttribute('data-db-step-item', String(cur));
    });
    sc.setAttribute('data-wiz-tagged', '1');
    return true;
  }

  function renderBar(){
    var el = $('db-modal-steps'); if(!el) return;
    var labels = ['Connection','Backup plan','Retention'];
    el.innerHTML = labels.map(function(label,i){
      var n=i+1;
      var cls='db-wiz-step'+(step===n?' is-on':'')+(n<step?' is-done':'');
      return '<button type="button" class="'+cls+'" data-goto="'+n+'"><span class="db-wiz-num">'+n+'</span>'+label+'</button>';
    }).join('');
    el.querySelectorAll('[data-goto]').forEach(function(btn){
      btn.onclick=function(){ step=parseInt(btn.getAttribute('data-goto'),10)||1; paint(); };
    });
  }

  function ensureNav(){
    if ($('btn-db-next')) return;
    var test=$('btn-test-db'); if(!test||!test.parentElement) return;
    var parent=test.parentElement;
    var back=document.createElement('button');
    back.id='btn-db-back'; back.type='button';
    back.className='db-btn db-btn-ghost px-4 py-2.5 text-xs font-medium';
    back.textContent='Back';
    back.onclick=function(){ if(step>1){ step--; paint(); } };
    var next=document.createElement('button');
    next.id='btn-db-next'; next.type='button';
    next.className='db-btn db-btn-primary px-5 py-2.5 text-xs font-semibold';
    next.textContent='Continue';
    next.onclick=function(){
      if(step===1){ var name=$('new-db-name'); if(name&&!String(name.value||'').trim()){ name.focus(); return; } }
      if(step<max){ step++; paint(); }
    };
    parent.insertBefore(back, test);
    parent.insertBefore(next, test);
  }

  function paint(){
    var sc = scrollEl(); if(!sc) return;
    tagSteps();
    Array.prototype.forEach.call(sc.querySelectorAll('[data-db-step-item]'), function(el){
      var n = parseInt(el.getAttribute('data-db-step-item'),10)||1;
      if (n === step) el.classList.remove('is-hidden-step');
      else el.classList.add('is-hidden-step');
    });
    renderBar(); ensureNav();
    var back=$('btn-db-back'), next=$('btn-db-next'), test=$('btn-test-db'), save=$('btn-save-db');
    if(back) back.style.display = step===1 ? 'none' : 'inline-flex';
    if(next) next.style.display = step===max ? 'none' : 'inline-flex';
    if(test) test.style.display = step===1 ? 'inline-flex' : 'none';
    if(save) save.style.display = step===max ? 'inline-flex' : 'none';
  }

  function openW(){ step=1; var sc=scrollEl(); if(sc) sc.removeAttribute('data-wiz-tagged');
    // clear prior tags so re-open retags cleanly
    if(sc) Array.prototype.forEach.call(sc.querySelectorAll('[data-db-step-item]'), function(el){ el.removeAttribute('data-db-step-item'); el.classList.remove('is-hidden-step'); });
    setTimeout(paint, 40);
  }

  document.addEventListener('click', function(e){
    var t=e.target&&e.target.closest&&e.target.closest('button,a');
    if(!t) return;
    var label=(t.textContent||'').toLowerCase();
    if(/connect database|add database|new database|edit database/.test(label)) openW();
  });

  var obs=new MutationObserver(function(){
    var m=modal();
    if(m && !m.classList.contains('hidden')) openW();
  });
  if(document.body) obs.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});
})();
`;

const anchor = "var TOKEN = null;";
const start = s.indexOf(anchor);
if (start < 0) { console.error("no TOKEN"); process.exit(1); }
const end = s.indexOf("</script>", start);
s = s.slice(0, end) + "\n" + js + "\n" + s.slice(end);
fs.writeFileSync(file, s);
console.log("nested-aware wizard done", s.length);
