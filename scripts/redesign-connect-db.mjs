#!/usr/bin/env node
/** Full visual + interaction redesign for Connect Database drawer. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

// --- 1) Modal shell: wider, cleaner surface ---
const shellPairs = [
  [
    'id="db-modal" class="fixed inset-0 z-50 hidden"',
    'id="db-modal" class="fixed inset-0 z-50 hidden" data-db-redesign="1"',
  ],
  [
    'id="db-modal-backdrop" class="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"',
    'id="db-modal-backdrop" class="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"',
  ],
  [
    'class="absolute inset-y-0 right-0 w-full max-w-lg bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col"',
    'class="db-drawer absolute inset-y-0 right-0 w-full max-w-xl bg-[#0b1220] border-l border-slate-800/90 shadow-2xl flex flex-col"',
  ],
  [
    'class="flex items-start justify-between px-5 py-4 border-b border-slate-800 shrink-0 gap-3"',
    'class="db-drawer-head flex items-start justify-between px-6 py-5 border-b border-slate-800/90 shrink-0 gap-3 bg-gradient-to-b from-slate-900/80 to-transparent"',
  ],
];

for (const [a, b] of shellPairs) {
  if (s.includes(a)) {
    s = s.replace(a, b);
    console.log("shell:", a.slice(0, 40));
  }
}

// --- 2) Header copy + step host ---
const headPairs = [
  [
    'Name it, pick the engine, paste the URL, test, then save.',
    'Three short steps. Test the connection before you save.',
  ],
  [
    'Name the database, choose a service, paste the connection URL, test, then save.',
    'Three short steps. Test the connection before you save.',
  ],
  [
    '1 Connection · 2 Backup plan · 3 Retention',
    '', // replaced by wizard bar
  ],
  [
    'Step 1 Connection · Step 2 Backup plan · Step 3 Retention',
    '',
  ],
];
for (const [a, b] of headPairs) {
  if (s.includes(a)) {
    s = s.replaceAll(a, b);
    console.log("head text");
  }
}

// Ensure steps container is a dedicated progress host
if (s.includes('id="db-modal-steps"')) {
  s = s.replace(
    /id="db-modal-steps" class="[^"]*"[^>]*>[^<]*/,
    'id="db-modal-steps" class="db-wiz-steps" role="tablist" aria-label="Setup steps">'
  );
  console.log("steps host");
}

// --- 3) Footer redesign ---
const oldFooterHint =
  'Save unlocks after a successful connection test. Changing the URI or engine resets the test.';
const newFooterHint =
  'Test the connection on step 1. Save is available on the last step after a successful test.';
if (s.includes(oldFooterHint)) {
  s = s.replace(oldFooterHint, newFooterHint);
}

s = s.replace(
  'class="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2"',
  'class="db-drawer-actions flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2"'
);

// Soften primary buttons
const btnPairs = [
  [
    'id="btn-cancel-modal" class="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-800 text-xs font-medium rounded-xl text-slate-300 border border-slate-700/80 transition"',
    'id="btn-cancel-modal" class="db-btn db-btn-ghost px-4 py-2.5 text-xs font-medium rounded-xl transition"',
  ],
  [
    'id="btn-test-db" class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-semibold rounded-xl text-slate-100 flex items-center justify-center gap-1.5 transition"',
    'id="btn-test-db" class="db-btn db-btn-secondary px-4 py-2.5 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 transition"',
  ],
  [
    'id="btn-save-db" disabled class="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-xs font-semibold rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-brand-600 shadow-[0_0_20px_rgba(34,197,94,0.15)] transition"',
    'id="btn-save-db" disabled class="db-btn db-btn-primary px-5 py-2.5 text-xs font-semibold rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed transition"',
  ],
];
for (const [a, b] of btnPairs) {
  if (s.includes(a)) {
    s = s.replace(a, b);
    console.log("btn");
  }
}

// --- 4) Field / chip classes ---
const fieldPairs = [
  [
    'class="provider-chip text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50 hover:text-brand-400 transition"',
    'class="provider-chip db-chip"',
  ],
  [
    'class="provider-chip text-[11px] px-2.5 py-1.5 rounded-full border border-slate-700/90 bg-slate-950/80 text-slate-300 hover:border-brand-500/60 hover:bg-brand-500/10 hover:text-brand-300 transition"',
    'class="provider-chip db-chip"',
  ],
  [
    'id="new-db-name" maxlength="64" placeholder="production-db" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"',
    'id="new-db-name" maxlength="64" placeholder="e.g. production-db" class="db-input"',
  ],
  [
    'id="new-db-name" maxlength="64" placeholder="e.g. production-db" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30 outline-none transition"',
    'id="new-db-name" maxlength="64" placeholder="e.g. production-db" class="db-input"',
  ],
];
for (const [a, b] of fieldPairs) {
  if (s.includes(a)) {
    s = s.replaceAll(a, b);
    console.log("field");
  }
}

// Select / common inputs inside modal — add db-input via CSS child selectors instead of hunting every id

// --- 5) CSS redesign (replace prior wizard css if present) ---
const css = `
/* __DB_REDESIGN_CSS__ */
#db-modal .db-drawer { background: linear-gradient(180deg, #0d1526 0%, #0b1220 40%, #0a101c 100%); }
#db-modal .db-drawer-head h3 { font-size: 1.05rem; letter-spacing: -0.02em; }
#db-modal .db-drawer-head #db-modal-sub { font-size: 12px; color: #94a3b8; line-height: 1.45; max-width: 28rem; }
#db-modal .overflow-y-auto { padding: 1.25rem 1.5rem 1.5rem; }
#db-modal label { font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 0.35rem; }
#db-modal .db-input,
#db-modal input[type="text"],
#db-modal input[type="password"],
#db-modal select,
#db-modal textarea {
  width: 100%;
  background: #060b14;
  border: 1px solid #1e293b;
  border-radius: 12px;
  padding: 0.7rem 0.9rem;
  font-size: 13px;
  color: #e2e8f0;
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
#db-modal textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; min-height: 5.5rem; line-height: 1.5; }
#db-modal .db-input:focus,
#db-modal input:focus,
#db-modal select:focus,
#db-modal textarea:focus {
  border-color: rgba(34,197,94,0.45);
  box-shadow: 0 0 0 3px rgba(34,197,94,0.12);
}
#db-modal .db-chip {
  display: inline-flex; align-items: center;
  font-size: 11px; font-weight: 600;
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  border: 1px solid #334155;
  background: #0b1220;
  color: #cbd5e1;
  transition: all .15s;
}
#db-modal .db-chip:hover { border-color: rgba(34,197,94,0.45); color: #bbf7d0; background: rgba(34,197,94,0.08); }
#db-modal .db-chip.is-active, #db-modal .provider-chip.is-active {
  border-color: rgba(34,197,94,0.55);
  background: rgba(34,197,94,0.14);
  color: #86efac;
}
#db-modal #conn-status {
  font-size: 11px; font-weight: 600;
  padding: 0.3rem 0.65rem;
  border-radius: 999px;
  border: 1px solid #334155;
  background: #0f172a;
  color: #94a3b8;
}
#db-modal #conn-status.is-ok { color: #6ee7b7; border-color: rgba(16,185,129,0.4); background: rgba(16,185,129,0.1); }
#db-modal #conn-status.is-bad { color: #fca5a5; border-color: rgba(248,113,113,0.4); background: rgba(248,113,113,0.1); }

/* Step pills */
#db-modal .db-wiz-steps { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.75rem; }
#db-modal .db-wiz-step {
  display: inline-flex; align-items: center; gap: 0.4rem;
  border: 1px solid #1e293b; background: #0f172a;
  color: #64748b; font-size: 11px; font-weight: 600;
  padding: 0.4rem 0.7rem; border-radius: 999px; cursor: pointer;
}
#db-modal .db-wiz-step .db-wiz-num {
  width: 1.2rem; height: 1.2rem; border-radius: 999px;
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
#db-modal .db-wiz-panel { animation: dbIn .2s ease; }
@keyframes dbIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* Footer actions */
#db-modal .db-drawer-actions { width: 100%; }
#db-modal .db-btn { border-radius: 12px; font-weight: 600; }
#db-modal .db-btn-ghost { background: transparent; border: 1px solid #334155; color: #94a3b8; }
#db-modal .db-btn-ghost:hover { background: #0f172a; color: #e2e8f0; }
#db-modal .db-btn-secondary { background: #0f172a; border: 1px solid #334155; color: #e2e8f0; }
#db-modal .db-btn-secondary:hover { border-color: #475569; }
#db-modal .db-btn-primary { background: #16a34a; border: 1px solid #16a34a; color: #fff; box-shadow: 0 0 24px rgba(22,163,74,0.2); }
#db-modal .db-btn-primary:hover { background: #15803d; }
#db-modal .db-btn-primary:disabled { opacity: 0.4; box-shadow: none; }

/* Section headings inside form */
#db-modal p.text-\\[11px\\].font-semibold,
#db-modal .uppercase.tracking-wider {
  letter-spacing: 0.06em !important;
  color: #64748b !important;
  font-size: 11px !important;
}
`;

// Remove old wizard CSS blocks then inject redesign
s = s.replace(/\/\* __DB_WIZARD_CSS__[\s\S]*?(?=\n\/\*|\n<\/style>)/, "");
s = s.replace(/\/\* __DB_REDESIGN_CSS__[\s\S]*?(?=\n\/\*|\n<\/style>)/, "");
if (s.includes("</style>")) {
  s = s.replace("</style>", css + "\n</style>");
  console.log("redesign CSS");
}

// --- 6) Robust wizard JS (replace old if any) ---
s = s.replace(/\/\* __DB_WIZARD__ \*\/[\s\S]*?\}\)\(\);\s*/g, "");

const js = `
/* __DB_WIZARD__ */
(function(){
  function $(id){ return document.getElementById(id); }
  var step = 1, max = 3, built = false;

  function drawer(){ return $('db-modal'); }
  function scrollEl(){
    var m = drawer(); if(!m) return null;
    return m.querySelector('.overflow-y-auto');
  }

  function classify(el){
    var t = ((el.innerText || el.textContent || '') + '').toLowerCase().replace(/\\s+/g,' ').trim();
    var head = (t.split('\\n')[0] || '').trim();
    if (/step\\s*3|3\\s*[·.].*retention|^retention\\b/.test(head) || (/retention/.test(head) && /step|3/.test(head))) return 3;
    if (/step\\s*2|2\\s*[·.].*backup|backup\\s*plan/.test(head)) return 2;
    if (/step\\s*1|1\\s*[·.].*connection|^connection\\b/.test(head)) return 1;
    if (/add a backup job|presets/.test(t) && !/connection url|database name/.test(head)) return 2;
    if (/retention|keep for|days to keep/.test(t) && !/connection/.test(head)) return 3;
    return 0; // inherit
  }

  function build(){
    var sc = scrollEl(); if(!sc) return false;
    if (built && sc.querySelector('[data-db-step]')) return true;
    var kids = Array.prototype.slice.call(sc.children);
    if (!kids.length) return false;
    var groups = [[],[],[]], cur = 1;
    kids.forEach(function(el){
      var c = classify(el);
      if (c) cur = c;
      groups[cur-1].push(el);
    });
    // If almost everything landed in step1, try split on backup/retention keywords deep in nodes
    if (groups[1].length < 1 || groups[2].length < 1) {
      groups = [[],[],[]]; cur = 1;
      kids.forEach(function(el){
        var t = ((el.innerText||'')+'').toLowerCase();
        if (t.indexOf('backup plan') >= 0 || t.indexOf('add a backup job') >= 0) cur = 2;
        if (t.indexOf('step 3') >= 0 || (t.indexOf('retention') >= 0 && t.indexOf('connection') < 0 && cur >= 2)) cur = 3;
        groups[cur-1].push(el);
      });
    }
    sc.innerHTML = '';
    for (var i = 0; i < 3; i++) {
      var p = document.createElement('div');
      p.setAttribute('data-db-step', String(i+1));
      p.className = 'db-wiz-panel space-y-4';
      (groups[i]||[]).forEach(function(el){ p.appendChild(el); });
      if (!(groups[i]&&groups[i].length)) {
        p.innerHTML = '<div class="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-xs text-slate-400">This step has no extra fields. Continue when you are ready.</div>';
      }
      sc.appendChild(p);
    }
    built = true;
    return true;
  }

  function bar(){
    var el = $('db-modal-steps'); if(!el) return;
    var labels = ['Connection','Backup plan','Retention'];
    el.innerHTML = labels.map(function(label, i){
      var n = i+1;
      var cls = 'db-wiz-step' + (step===n?' is-on':'') + (n<step?' is-done':'');
      return '<button type="button" class="'+cls+'" data-goto="'+n+'"><span class="db-wiz-num">'+n+'</span>'+label+'</button>';
    }).join('');
    el.querySelectorAll('[data-goto]').forEach(function(btn){
      btn.onclick = function(){ step = parseInt(btn.getAttribute('data-goto'),10)||1; paint(); };
    });
  }

  function nav(){
    if ($('btn-db-next')) return;
    var test = $('btn-test-db'); if(!test||!test.parentElement) return;
    var parent = test.parentElement;
    // left cluster for back, right for primary actions
    var left = document.createElement('div');
    left.id = 'db-nav-left';
    left.className = 'flex items-center gap-2';
    var back = document.createElement('button');
    back.id = 'btn-db-back'; back.type='button';
    back.className = 'db-btn db-btn-ghost px-4 py-2.5 text-xs';
    back.textContent = 'Back';
    back.onclick = function(){ if(step>1){ step--; paint(); } };
    left.appendChild(back);
    parent.insertBefore(left, parent.firstChild);

    var next = document.createElement('button');
    next.id = 'btn-db-next'; next.type='button';
    next.className = 'db-btn db-btn-primary px-5 py-2.5 text-xs';
    next.textContent = 'Continue';
    next.onclick = function(){
      if(step===1){
        var name=$('new-db-name');
        if(name && !String(name.value||'').trim()){ name.focus(); return; }
      }
      if(step<max){ step++; paint(); }
    };
    // place next before test
    parent.appendChild(next);
  }

  function paint(){
    if(!build()) return;
    for(var i=1;i<=max;i++){
      var p=document.querySelector('#db-modal [data-db-step="'+i+'"]');
      if(p) p.style.display = (i===step) ? 'block' : 'none';
    }
    bar(); nav();
    var back=$('btn-db-back'), next=$('btn-db-next'), test=$('btn-test-db'), save=$('btn-save-db');
    if(back) back.style.display = step===1 ? 'none' : 'inline-flex';
    if(next) next.style.display = step===max ? 'none' : 'inline-flex';
    if(test) test.style.display = step===1 ? 'inline-flex' : 'none';
    if(save) save.style.display = step===max ? 'inline-flex' : 'none';
  }

  function openW(){ built=false; step=1; setTimeout(paint, 40); }

  document.addEventListener('click', function(e){
    var t=e.target && e.target.closest && e.target.closest('button,a');
    if(!t) return;
    var label=(t.textContent||'').toLowerCase();
    if(/connect database|add database|new database|edit database/.test(label)) openW();
  });

  // When modal becomes visible
  var obs = new MutationObserver(function(){
    var m = drawer();
    if(m && !m.classList.contains('hidden')) openW();
  });
  if(document.body) obs.observe(document.body, {subtree:true, attributes:true, attributeFilter:['class']});
})();
`;

const anchor = "var TOKEN = null;";
const start = s.indexOf(anchor);
if (start < 0) {
  console.error("TOKEN anchor missing");
  process.exit(1);
}
const end = s.indexOf("</script>", start);
s = s.slice(0, end) + "\n" + js + "\n" + s.slice(end);
console.log("wizard js");

fs.writeFileSync(file, s);
console.log("redesign done", s.length);
