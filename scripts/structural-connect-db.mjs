#!/usr/bin/env node
/** Structural step panels + wizard that does not reset step on every mutation. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

if (!(s.includes('data-db-step="1"') && s.includes('data-db-step="2"') && s.includes('data-db-step="3"'))) {
  const scrollOpen = 'class="flex-1 overflow-y-auto px-5 py-4 space-y-5">';
  let scrollMarker = scrollOpen;
  let idx = s.indexOf(scrollOpen);
  if (idx < 0) {
    const m = s.match(/class="flex-1 overflow-y-auto[^"]*">/);
    if (m) { scrollMarker = m[0]; idx = s.indexOf(scrollMarker); }
  }
  if (idx < 0) { console.error("scroll not found"); process.exit(1); }
  let step2 = s.indexOf('<div class="space-y-2 border-t border-slate-800 pt-4">', idx);
  if (step2 < 0) {
    const t = s.indexOf("2 · Backup", idx);
    if (t > 0) step2 = s.lastIndexOf("<div", t);
  }
  let step3 = s.indexOf('<div class="db-section space-y-3">', idx);
  if (step3 < 0) {
    const t = s.indexOf("3 · Retention", idx);
    if (t > 0) step3 = s.lastIndexOf("<div", t);
  }
  let footer = s.indexOf('class="db-footer shrink-0', idx);
  if (footer < 0) footer = s.indexOf("btn-cancel-modal", idx);
  if (footer > 0) footer = s.lastIndexOf("<div", footer);
  if (!(step2 > idx && step3 > step2 && footer > step3)) {
    console.error("boundaries", { idx, step2, step3, footer });
    process.exit(1);
  }
  const posAfter = idx + scrollMarker.length;
  s =
    s.slice(0, posAfter) +
    '\n                <div data-db-step="1" class="db-step-panel space-y-4">' +
    s.slice(posAfter, step2) +
    '</div>\n                <div data-db-step="2" class="db-step-panel space-y-4">' +
    s.slice(step2, step3) +
    '</div>\n                <div data-db-step="3" class="db-step-panel space-y-4">' +
    s.slice(step3, footer) +
    '</div>\n            ' +
    s.slice(footer);
  console.log("wrapped panels");
} else {
  console.log("panels present");
}

if (s.includes('id="db-modal-steps"')) {
  s = s.replace(/id="db-modal-steps" class="[^"]*"[^>]*>[^<]*/, 'id="db-modal-steps" class="db-wiz-steps" role="tablist" aria-label="Setup steps">');
}

for (const old of [
  "Name it, pick the engine, paste the URL, test, then save.",
  "Name the database, choose a service, paste the connection URL, test, then save.",
  "Three short steps. Test the connection before you save.",
  "Step through connection, backup plan, and retention. Test before you save.",
  "Complete each step. Test the connection before saving.",
]) {
  if (s.includes(old)) s = s.replaceAll(old, "Complete each step. Test the connection before saving.");
}

for (const [a, b] of [
  ['class="absolute inset-y-0 right-0 w-full max-w-lg bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col"', 'class="db-drawer absolute inset-y-0 right-0 w-full max-w-xl bg-[#0b1220] border-l border-slate-800 shadow-2xl flex flex-col"'],
  ['id="db-modal-backdrop" class="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"', 'id="db-modal-backdrop" class="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"'],
]) {
  if (s.includes(a)) s = s.replace(a, b);
}

const css = `
/* __DB_STRUCT_CSS__ */
#db-modal .db-drawer { background: linear-gradient(180deg,#0d1526 0%,#0b1220 50%,#0a101c 100%); }
#db-modal .db-step-panel { display: none; animation: dbStepIn .18s ease; }
#db-modal .db-step-panel.is-active { display: block; }
#db-modal .db-wiz-steps { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .75rem; }
#db-modal .db-wiz-step {
  display: inline-flex; align-items: center; gap: .45rem;
  border: 1px solid #1e293b; background: #0f172a; color: #64748b;
  font-size: 11px; font-weight: 600; padding: .4rem .75rem; border-radius: 999px; cursor: pointer;
}
#db-modal .db-wiz-step .db-wiz-num {
  width: 1.25rem; height: 1.25rem; border-radius: 999px; display: inline-flex;
  align-items: center; justify-content: center; background: #1e293b; color: #94a3b8; font-size: 10px;
}
#db-modal .db-wiz-step.is-on { border-color: rgba(34,197,94,.5); background: rgba(34,197,94,.1); color: #a7f3d0; }
#db-modal .db-wiz-step.is-on .db-wiz-num { background: #16a34a; color: #fff; }
#db-modal .db-wiz-step.is-done { border-color: rgba(34,197,94,.25); color: #6ee7b7; }
#db-modal input[type="text"], #db-modal input[type="password"], #db-modal select, #db-modal textarea {
  width: 100%; background: #060b14; border: 1px solid #1e293b; border-radius: 12px;
  padding: .7rem .9rem; font-size: 13px; color: #e2e8f0; outline: none;
}
#db-modal textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; min-height: 5.5rem; }
#db-modal input:focus, #db-modal select:focus, #db-modal textarea:focus {
  border-color: rgba(34,197,94,.45); box-shadow: 0 0 0 3px rgba(34,197,94,.12);
}
#db-modal .provider-chip {
  display: inline-flex; font-size: 11px; font-weight: 600; padding: .4rem .75rem;
  border-radius: 999px; border: 1px solid #334155; background: #0b1220; color: #cbd5e1;
}
@keyframes dbStepIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
`;

s = s.replace(/\/\* __DB_STRUCT_CSS__[\s\S]*?(?=\n\/\*|\n<\/style>)/g, "");
s = s.replace(/\/\* __DB_REDESIGN_CSS__[\s\S]*?(?=\n\/\*|\n<\/style>)/g, "");
s = s.replace(/\/\* __DB_WIZARD_CSS__[\s\S]*?(?=\n\/\*|\n<\/style>)/g, "");
if (s.includes("</style>")) s = s.replace("</style>", css + "\n</style>");

s = s.replace(/\/\* __DB_WIZARD__ \*\/[\s\S]*?\}\)\(\);\s*/g, "");

const js = `
/* __DB_WIZARD__ */
(function(){
  function $(id){ return document.getElementById(id); }
  var step = 1, max = 3, wasOpen = false;

  function panels(){
    var m = $('db-modal'); if(!m) return [];
    return [1,2,3].map(function(n){ return m.querySelector('[data-db-step="'+n+'"]'); });
  }

  function bar(){
    var el = $('db-modal-steps'); if(!el) return;
    var labels = ['Connection','Backup plan','Retention'];
    el.innerHTML = labels.map(function(label,i){
      var n = i+1;
      var cls = 'db-wiz-step'+(step===n?' is-on':'')+(n<step?' is-done':'');
      return '<button type="button" class="'+cls+'" data-goto="'+n+'"><span class="db-wiz-num">'+n+'</span> '+label+'</button>';
    }).join('');
    el.querySelectorAll('[data-goto]').forEach(function(btn){
      btn.onclick = function(e){ e.preventDefault(); step = parseInt(btn.getAttribute('data-goto'),10)||1; paint(); };
    });
  }

  function nav(){
    if ($('btn-db-next')) return;
    var test = $('btn-test-db'); if(!test||!test.parentElement) return;
    var parent = test.parentElement;
    var back = document.createElement('button');
    back.id='btn-db-back'; back.type='button';
    back.className='px-4 py-2.5 text-xs font-medium rounded-xl border border-slate-700 text-slate-300 bg-transparent';
    back.textContent='Back';
    back.onclick=function(e){ e.preventDefault(); if(step>1){ step--; paint(); } };
    var next = document.createElement('button');
    next.id='btn-db-next'; next.type='button';
    next.className='px-5 py-2.5 text-xs font-semibold rounded-xl text-white bg-brand-600 hover:bg-brand-700';
    next.textContent='Continue';
    next.onclick=function(e){
      e.preventDefault();
      if(step===1){
        var name=$('new-db-name');
        if(name && !String(name.value||'').trim()){ name.focus(); return; }
      }
      if(step<max){ step++; paint(); }
    };
    parent.insertBefore(back, test);
    parent.insertBefore(next, test);
  }

  function paint(){
    panels().forEach(function(p,i){
      if(!p) return;
      var on = (i+1===step);
      if(on) p.classList.add('is-active'); else p.classList.remove('is-active');
      p.style.display = on ? 'block' : 'none';
    });
    bar(); nav();
    var back=$('btn-db-back'), next=$('btn-db-next'), test=$('btn-test-db'), save=$('btn-save-db');
    if(back) back.style.display = step===1 ? 'none' : 'inline-flex';
    if(next) next.style.display = step===max ? 'none' : 'inline-flex';
    if(test) test.style.display = step===1 ? 'inline-flex' : 'none';
    if(save) save.style.display = step===max ? 'inline-flex' : 'none';
  }

  function onOpen(){ step=1; paint(); }

  document.addEventListener('click', function(e){
    var t=e.target&&e.target.closest&&e.target.closest('button,a');
    if(!t) return;
    var label=(t.textContent||'').toLowerCase();
    if(/connect database|add database|new database|edit database/.test(label)) {
      setTimeout(onOpen, 30);
    }
  });

  // Only react when modal transitions hidden -> visible
  var obs = new MutationObserver(function(){
    var m = $('db-modal');
    if(!m) return;
    var open = !m.classList.contains('hidden');
    if(open && !wasOpen) onOpen();
    wasOpen = open;
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
console.log("structural wizard fixed", s.length);
