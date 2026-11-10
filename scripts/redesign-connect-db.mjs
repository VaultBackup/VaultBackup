#!/usr/bin/env node
/** Connect Database redesign: visual polish + NON-destructive step wizard. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

// Shell polish
const shellPairs = [
  [
    'id="db-modal-backdrop" class="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"',
    'id="db-modal-backdrop" class="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"',
  ],
  [
    'class="absolute inset-y-0 right-0 w-full max-w-lg bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col"',
    'class="db-drawer absolute inset-y-0 right-0 w-full max-w-xl bg-[#0b1220] border-l border-slate-800/90 shadow-2xl flex flex-col"',
  ],
  [
    'class="absolute inset-y-0 right-0 w-full max-w-xl bg-[#0b1220] border-l border-slate-800/90 shadow-2xl flex flex-col"',
    'class="db-drawer absolute inset-y-0 right-0 w-full max-w-xl bg-[#0b1220] border-l border-slate-800/90 shadow-2xl flex flex-col"',
  ],
];
for (const [a, b] of shellPairs) {
  if (s.includes(a)) s = s.replace(a, b);
}

// Header subtitle
for (const old of [
  "Name it, pick the engine, paste the URL, test, then save.",
  "Name the database, choose a service, paste the connection URL, test, then save.",
  "Three short steps. Test the connection before you save.",
]) {
  if (s.includes(old)) {
    s = s.replaceAll(old, "Step through connection, backup plan, and retention. Test before you save.");
  }
}

// Normalize steps host
if (s.includes('id="db-modal-steps"')) {
  s = s.replace(
    /id="db-modal-steps" class="[^"]*"[^>]*>[^<]*/,
    'id="db-modal-steps" class="db-wiz-steps" role="tablist" aria-label="Setup steps">'
  );
}

// Button classes
const btnPairs = [
  [
    /id="btn-cancel-modal" class="[^"]*"/,
    'id="btn-cancel-modal" class="db-btn db-btn-ghost px-4 py-2.5 text-xs font-medium rounded-xl transition"',
  ],
  [
    /id="btn-test-db" class="[^"]*"/,
    'id="btn-test-db" class="db-btn db-btn-secondary px-4 py-2.5 text-xs font-semibold rounded-xl inline-flex items-center justify-center gap-1.5 transition"',
  ],
  [
    /id="btn-save-db" disabled class="[^"]*"/,
    'id="btn-save-db" disabled class="db-btn db-btn-primary px-5 py-2.5 text-xs font-semibold rounded-xl text-white disabled:opacity-40 disabled:cursor-not-allowed transition"',
  ],
];
for (const [re, b] of btnPairs) {
  if (re.test(s)) s = s.replace(re, b);
}

// CSS
const css = `
/* __DB_REDESIGN_CSS__ */
#db-modal .db-drawer { background: linear-gradient(180deg,#0d1526 0%,#0b1220 45%,#0a101c 100%); }
#db-modal .db-drawer-head h3, #db-modal h3 { letter-spacing: -0.02em; }
#db-modal #db-modal-sub { font-size: 12px; color: #94a3b8; line-height: 1.45; max-width: 28rem; }
#db-modal .overflow-y-auto { padding: 1.25rem 1.5rem 1.5rem !important; }
#db-modal label { font-size: 12px; font-weight: 600; color: #cbd5e1; }
#db-modal input[type="text"],
#db-modal input[type="password"],
#db-modal select,
#db-modal textarea {
  width: 100%; background: #060b14; border: 1px solid #1e293b; border-radius: 12px;
  padding: 0.7rem 0.9rem; font-size: 13px; color: #e2e8f0; outline: none;
  transition: border-color .15s, box-shadow .15s;
}
#db-modal textarea { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; min-height: 5.5rem; }
#db-modal input:focus, #db-modal select:focus, #db-modal textarea:focus {
  border-color: rgba(34,197,94,0.45); box-shadow: 0 0 0 3px rgba(34,197,94,0.12);
}
#db-modal .provider-chip, #db-modal .db-chip {
  display: inline-flex; align-items: center; font-size: 11px; font-weight: 600;
  padding: 0.4rem 0.75rem; border-radius: 999px; border: 1px solid #334155;
  background: #0b1220; color: #cbd5e1; transition: all .15s;
}
#db-modal .provider-chip:hover, #db-modal .db-chip:hover {
  border-color: rgba(34,197,94,0.45); color: #bbf7d0; background: rgba(34,197,94,0.08);
}
#db-modal .db-wiz-steps { display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 0.75rem; }
#db-modal .db-wiz-step {
  display: inline-flex; align-items: center; gap: 0.4rem;
  border: 1px solid #1e293b; background: #0f172a; color: #64748b;
  font-size: 11px; font-weight: 600; padding: 0.4rem 0.75rem; border-radius: 999px; cursor: pointer;
}
#db-modal .db-wiz-step .db-wiz-num {
  width: 1.2rem; height: 1.2rem; border-radius: 999px; display: inline-flex;
  align-items: center; justify-content: center; background: #1e293b; color: #94a3b8; font-size: 10px;
}
#db-modal .db-wiz-step.is-on { border-color: rgba(34,197,94,0.5); background: rgba(34,197,94,0.1); color: #a7f3d0; }
#db-modal .db-wiz-step.is-on .db-wiz-num { background: #16a34a; color: #fff; }
#db-modal .db-wiz-step.is-done { border-color: rgba(34,197,94,0.25); color: #6ee7b7; }
#db-modal .db-btn-ghost { background: transparent; border: 1px solid #334155; color: #94a3b8; border-radius: 12px; }
#db-modal .db-btn-ghost:hover { background: #0f172a; color: #e2e8f0; }
#db-modal .db-btn-secondary { background: #0f172a; border: 1px solid #334155; color: #e2e8f0; border-radius: 12px; }
#db-modal .db-btn-primary { background: #16a34a; border: 1px solid #16a34a; color: #fff; border-radius: 12px; box-shadow: 0 0 24px rgba(22,163,74,0.2); }
#db-modal .db-btn-primary:hover { background: #15803d; }
#db-modal .db-btn-primary:disabled { opacity: 0.4; box-shadow: none; }
#db-modal [data-db-step-item].is-hidden-step { display: none !important; }
`;

// Strip prior CSS markers then inject once
s = s.replace(/\/\* __DB_WIZARD_CSS__[\s\S]*?(?=\n\/\*|\n<\/style>)/g, "");
s = s.replace(/\/\* __DB_REDESIGN_CSS__[\s\S]*?(?=\n\/\*|\n<\/style>)/g, "");
if (s.includes("</style>")) {
  s = s.replace("</style>", css + "\n</style>");
}

// Remove ALL previous wizard IIFEs
s = s.replace(/\/\* __DB_WIZARD__ \*\/[\s\S]*?\}\)\(\);\s*/g, "");

const js = `
/* __DB_WIZARD__ */
(function(){
  function $(id){ return document.getElementById(id); }
  var step = 1, max = 3, tagged = false;

  function modal(){ return $('db-modal'); }
  function scrollEl(){
    var m = modal(); return m ? m.querySelector('.overflow-y-auto') : null;
  }

  function textOf(el){
    return ((el && (el.innerText || el.textContent)) || '').toLowerCase().replace(/\\s+/g,' ').trim();
  }

  function classifyNode(el){
    var t = textOf(el);
    var head = (t.split('\\n')[0] || '').trim();
    // Prefer explicit step headers
    if (/step\\s*3|3\\s*[·•.].{0,12}retention|^retention\\b/.test(head)) return 3;
    if (/step\\s*2|2\\s*[·•.].{0,12}backup|backup\\s*plan/.test(head)) return 2;
    if (/step\\s*1|1\\s*[·•.].{0,12}connection|^connection\\b/.test(head)) return 1;
    // Content hints
    if (el.querySelector && (el.querySelector('#new-db-name') || el.querySelector('#new-db-provider') || el.querySelector('#provider-chips') || el.querySelector('#conn-status'))) return 1;
    if (el.id === 'new-db-name' || el.id === 'new-db-provider' || el.id === 'provider-chips' || el.id === 'conn-status') return 1;
    if (/add a backup job|presets/.test(t) && !/connection url|database name/.test(head)) return 2;
    if (/retention|keep the last|days to keep|keep for/.test(t) && !/connection/.test(head)) return 3;
    return 0;
  }

  function tagSteps(){
    var sc = scrollEl(); if(!sc) return false;
    // If a previous destructive wizard left empty placeholders, abort and do not re-tag
    var emptyOnly = Array.prototype.every.call(sc.querySelectorAll('[data-db-step]'), function(p){
      return /no extra fields/i.test(p.textContent || '');
    });
    if (sc.querySelector('[data-db-step]') && emptyOnly) {
      // Broken state from old wizard — cannot recover fields if they were removed.
      return false;
    }
    // Non-destructive: tag direct children only once
    if (sc.getAttribute('data-wiz-tagged') === '1') return true;
    var kids = Array.prototype.slice.call(sc.children);
    if (!kids.length) return false;
    var cur = 1;
    kids.forEach(function(el){
      // skip our own nav artifacts
      if (el.classList && el.classList.contains('db-wiz-panel')) return;
      var c = classifyNode(el);
      if (c) cur = c;
      // also scan one level deeper for headers
      if (!c && el.children && el.children.length) {
        Array.prototype.forEach.call(el.children, function(ch){
          var cc = classifyNode(ch);
          if (cc) cur = cc;
        });
      }
      el.setAttribute('data-db-step-item', String(cur));
    });
    sc.setAttribute('data-wiz-tagged', '1');
    tagged = true;
    return true;
  }

  function renderBar(){
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

  function ensureNav(){
    if ($('btn-db-next')) return;
    var test = $('btn-test-db'); if(!test || !test.parentElement) return;
    var parent = test.parentElement;
    var back = document.createElement('button');
    back.id = 'btn-db-back'; back.type = 'button';
    back.className = 'db-btn db-btn-ghost px-4 py-2.5 text-xs font-medium';
    back.textContent = 'Back';
    back.onclick = function(){ if(step>1){ step--; paint(); } };
    var next = document.createElement('button');
    next.id = 'btn-db-next'; next.type = 'button';
    next.className = 'db-btn db-btn-primary px-5 py-2.5 text-xs font-semibold';
    next.textContent = 'Continue';
    next.onclick = function(){
      if(step===1){
        var name = $('new-db-name');
        if(name && !String(name.value||'').trim()){ name.focus(); return; }
      }
      if(step < max){ step++; paint(); }
    };
    parent.insertBefore(back, test);
    parent.insertBefore(next, test);
  }

  function paint(){
    var sc = scrollEl(); if(!sc) return;
    tagSteps();
    // Show only current step items (non-destructive)
    Array.prototype.forEach.call(sc.querySelectorAll('[data-db-step-item]'), function(el){
      var n = parseInt(el.getAttribute('data-db-step-item'),10)||1;
      if (n === step) el.classList.remove('is-hidden-step');
      else el.classList.add('is-hidden-step');
    });
    // If old broken panels exist, hide empty ones and show ones with real content for this step
    Array.prototype.forEach.call(sc.querySelectorAll('[data-db-step]'), function(p){
      var n = parseInt(p.getAttribute('data-db-step'),10)||0;
      var empty = /no extra fields/i.test(p.textContent||'');
      p.style.display = (!empty && n === step) ? 'block' : (empty ? 'none' : (n===step?'block':'none'));
    });
    renderBar();
    ensureNav();
    var back=$('btn-db-back'), next=$('btn-db-next'), test=$('btn-test-db'), save=$('btn-save-db');
    if(back) back.style.display = step===1 ? 'none' : 'inline-flex';
    if(next) next.style.display = step===max ? 'none' : 'inline-flex';
    if(test) test.style.display = step===1 ? 'inline-flex' : 'none';
    if(save) save.style.display = step===max ? 'inline-flex' : 'none';
  }

  function openW(){
    // Do not reset tagged if fields are intact
    var sc = scrollEl();
    if (sc && sc.querySelector('#new-db-name, #new-db-provider, [id*="db-name"]')) {
      // fields present in scroll tree — ok
    }
    step = 1;
    setTimeout(paint, 30);
  }

  document.addEventListener('click', function(e){
    var t = e.target && e.target.closest && e.target.closest('button,a');
    if(!t) return;
    var label = (t.textContent||'').toLowerCase();
    if (/connect database|add database|new database|edit database/.test(label)) openW();
  });

  var obs = new MutationObserver(function(){
    var m = modal();
    if (m && !m.classList.contains('hidden')) openW();
  });
  if (document.body) obs.observe(document.body, { subtree:true, attributes:true, attributeFilter:['class'] });
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

fs.writeFileSync(file, s);
console.log("redesign non-destructive done", s.length);
