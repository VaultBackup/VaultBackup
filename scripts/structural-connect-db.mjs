#!/usr/bin/env node
/** Structural step panels + full drawer CSS (does not rely on Tailwind utilities). */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

// --- Wrap panels if needed ---
if (!(s.includes('data-db-step="1"') && s.includes('data-db-step="2"') && s.includes('data-db-step="3"'))) {
  let scrollMarker = 'class="flex-1 overflow-y-auto px-5 py-4 space-y-5">';
  let idx = s.indexOf(scrollMarker);
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
  s = s.replace(
    /id="db-modal-steps" class="[^"]*"[^>]*>[^<]*/,
    'id="db-modal-steps" class="db-wiz-steps" role="tablist" aria-label="Setup steps">'
  );
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

// Ensure drawer has db-drawer class marker
if (s.includes('id="db-modal"') && !s.includes("db-drawer")) {
  s = s.replace(
    /(<div id="db-modal"[^>]*>\s*<div id="db-modal-backdrop"[^>]*><\/div>\s*<div )class="([^"]*)"/,
    '$1class="db-drawer $2"'
  );
}
// If already has class list with absolute..., force db-drawer prefix
s = s.replace(
  /class="(absolute inset-y-0 right-0[^"]*)"/,
  'class="db-drawer $1"'
);
s = s.replace(/class="db-drawer db-drawer /g, 'class="db-drawer ');

// Full self-contained CSS for modal (no Tailwind dependency)
const css = `
/* __DB_STRUCT_CSS__ */
#db-modal {
  position: fixed !important;
  inset: 0 !important;
  z-index: 80 !important;
}
#db-modal.hidden { display: none !important; }
#db-modal:not(.hidden) { display: block !important; }
#db-modal-backdrop {
  position: absolute !important;
  inset: 0 !important;
  background: rgba(2, 6, 23, 0.72) !important;
  backdrop-filter: blur(4px);
}
#db-modal .db-drawer {
  position: absolute !important;
  top: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  max-width: 36rem !important;
  display: flex !important;
  flex-direction: column !important;
  background: linear-gradient(180deg, #0d1526 0%, #0b1220 45%, #0a101c 100%) !important;
  border-left: 1px solid #1e293b !important;
  box-shadow: -12px 0 40px rgba(0,0,0,0.45) !important;
  z-index: 2;
}
#db-modal .db-drawer > .flex.items-start,
#db-modal .db-drawer-head,
#db-modal .db-drawer > div:first-of-type:not(#db-modal-backdrop) {
  /* header */
}
#db-modal .db-drawer > div:first-child {
  /* may be backdrop sibling handled outside */
}
#db-modal .overflow-y-auto {
  flex: 1 1 auto !important;
  overflow-y: auto !important;
  padding: 1.25rem 1.5rem !important;
  min-height: 0 !important;
}
#db-modal .db-footer {
  flex-shrink: 0 !important;
  border-top: 1px solid #1e293b;
  background: rgba(11, 18, 32, 0.95);
  padding: 0.9rem 1.25rem !important;
}
#db-modal .db-step-panel { display: none !important; }
#db-modal .db-step-panel.is-active { display: block !important; animation: dbStepIn .18s ease; }
#db-modal .db-wiz-steps {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 0.5rem !important;
  margin-top: 0.75rem !important;
}
#db-modal .db-wiz-step {
  display: inline-flex !important;
  align-items: center !important;
  gap: 0.45rem !important;
  border: 1px solid #1e293b;
  background: #0f172a;
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  cursor: pointer;
}
#db-modal .db-wiz-step .db-wiz-num {
  width: 1.25rem; height: 1.25rem; border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #1e293b; color: #94a3b8; font-size: 10px;
}
#db-modal .db-wiz-step.is-on {
  border-color: rgba(34,197,94,0.5);
  background: rgba(34,197,94,0.1);
  color: #a7f3d0;
}
#db-modal .db-wiz-step.is-on .db-wiz-num { background: #16a34a; color: #fff; }
#db-modal .db-wiz-step.is-done { border-color: rgba(34,197,94,0.25); color: #6ee7b7; }
#db-modal label { display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 0.35rem; }
#db-modal input[type="text"],
#db-modal input[type="password"],
#db-modal select,
#db-modal textarea {
  width: 100%;
  box-sizing: border-box;
  background: #060b14;
  border: 1px solid #1e293b;
  border-radius: 12px;
  padding: 0.7rem 0.9rem;
  font-size: 13px;
  color: #e2e8f0;
  outline: none;
}
#db-modal textarea {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  min-height: 5.5rem;
}
#db-modal input:focus,
#db-modal select:focus,
#db-modal textarea:focus {
  border-color: rgba(34,197,94,0.45);
  box-shadow: 0 0 0 3px rgba(34,197,94,0.12);
}
#db-modal .provider-chip {
  display: inline-flex;
  font-size: 11px;
  font-weight: 600;
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  border: 1px solid #334155;
  background: #0b1220;
  color: #cbd5e1;
  cursor: pointer;
}
#db-modal .provider-chip:hover {
  border-color: rgba(34,197,94,0.45);
  color: #bbf7d0;
  background: rgba(34,197,94,0.08);
}
#db-modal #btn-close-modal {
  border: none; background: transparent; color: #94a3b8; cursor: pointer;
}
#db-modal #btn-close-modal:hover { color: #fff; }
#db-modal .db-footer .flex,
#db-modal .db-footer > div:last-child {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
  align-items: center;
}
#db-modal #btn-db-back,
#db-modal #btn-cancel-modal {
  padding: 0.6rem 1rem;
  border-radius: 12px;
  border: 1px solid #334155;
  background: transparent;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
#db-modal #btn-test-db {
  padding: 0.6rem 1rem;
  border-radius: 12px;
  border: 1px solid #334155;
  background: #0f172a;
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
#db-modal #btn-db-next,
#db-modal #btn-save-db {
  padding: 0.6rem 1.15rem;
  border-radius: 12px;
  border: 1px solid #16a34a;
  background: #16a34a;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 0 20px rgba(22,163,74,0.2);
}
#db-modal #btn-save-db:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
}
@keyframes dbStepIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
@media (max-width: 640px) {
  #db-modal .db-drawer { max-width: 100% !important; }
}
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
      return '<button type="button" class="'+cls+'" data-goto="'+n+'"><span class="db-wiz-num">'+n+'</span><span>'+label+'</span></button>';
    }).join('');
    el.querySelectorAll('[data-goto]').forEach(function(btn){
      btn.onclick = function(e){ e.preventDefault(); e.stopPropagation(); step = parseInt(btn.getAttribute('data-goto'),10)||1; paint(); };
    });
  }

  function nav(){
    if ($('btn-db-next')) return;
    var test = $('btn-test-db'); if(!test||!test.parentElement) return;
    var parent = test.parentElement;
    var back = document.createElement('button');
    back.id='btn-db-back'; back.type='button';
    back.textContent='Back';
    back.onclick=function(e){ e.preventDefault(); if(step>1){ step--; paint(); } };
    var next = document.createElement('button');
    next.id='btn-db-next'; next.type='button';
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
console.log("drawer CSS + wizard done", s.length);
