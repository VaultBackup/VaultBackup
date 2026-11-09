#!/usr/bin/env node
/** Fine-tune Connect Database modal UI/UX. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");
let n = 0;

const pairs = [
  // Header copy
  [
    "Name it, pick the engine, paste the URL, test, then save.",
    "Name the database, choose a service, paste the connection URL, test, then save.",
  ],
  [
    "1 Connection · 2 Backup plan · 3 Retention",
    "Step 1 Connection · Step 2 Backup plan · Step 3 Retention",
  ],
  // Section labels (less teletype)
  ["1 · Connection", "Step 1 · Connection"],
  ["2 · Backup plan", "Step 2 · Backup plan"],
  ["3 · Retention", "Step 3 · Retention"],
  ["1 · CONNECTION", "Step 1 · Connection"],
  ["2 · BACKUP PLAN", "Step 2 · Backup plan"],
  ["3 · RETENTION", "Step 3 · Retention"],

  // Status chip default
  [
    'id="conn-status" class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700"',
    'id="conn-status" class="text-[10px] px-2.5 py-1 rounded-full bg-slate-900 text-slate-400 border border-slate-700/80 font-medium"',
  ],

  // Inputs: slightly larger touch targets
  [
    'id="new-db-name" maxlength="64" placeholder="production-db" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200"',
    'id="new-db-name" maxlength="64" placeholder="e.g. production-db" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30 outline-none transition"',
  ],

  // Provider chips denser hover
  [
    'class="provider-chip text-[11px] px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-950 text-slate-300 hover:border-brand-500/50 hover:text-brand-400 transition"',
    'class="provider-chip text-[11px] px-2.5 py-1.5 rounded-full border border-slate-700/90 bg-slate-950/80 text-slate-300 hover:border-brand-500/60 hover:bg-brand-500/10 hover:text-brand-300 transition"',
  ],

  // Labels
  ["Popular services", "Quick pick"],
  ["Database Service", "Database engine"],
  ["Connection string", "Connection URL"],
  ["Host must be publicly reachable", "Host must be reachable from the internet"],
];

for (const [a, b] of pairs) {
  if (s.includes(a)) {
    s = s.replaceAll(a, b);
    n++;
    console.log("ok:", a.slice(0, 48));
  }
}

// Modal panel shell: more padding / softer card
const oldShell =
  'class="flex-1 overflow-y-auto px-5 py-4 space-y-5"';
const newShell =
  'class="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-6"';
if (s.includes(oldShell) && s.includes("db-modal-title")) {
  // only first occurrence near modal if possible
  const idx = s.indexOf("db-modal-title");
  const shellIdx = s.indexOf(oldShell, idx > 0 ? idx : 0);
  if (shellIdx > 0) {
    s = s.slice(0, shellIdx) + newShell + s.slice(shellIdx + oldShell.length);
    n++;
    console.log("modal body spacing");
  }
}

// CSS polish for modal
const mark = "/* __CONNECT_DB_POLISH__ */";
if (!s.includes(mark)) {
  const css = `
${mark}
#db-modal-title { letter-spacing: -0.01em; }
#db-modal-steps { display: flex; flex-wrap: wrap; gap: 0.35rem 0.75rem; }
#conn-status.is-ok { color: #6ee7b7; border-color: rgba(16,185,129,0.35); background: rgba(16,185,129,0.1); }
#conn-status.is-bad { color: #fca5a5; border-color: rgba(248,113,113,0.35); background: rgba(248,113,113,0.1); }
.provider-chip.is-active { border-color: rgba(34,197,94,0.55); background: rgba(34,197,94,0.12); color: #86efac; }
#new-db-url, textarea#new-db-url, #new-db-conn { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.45; }
`;
  if (s.includes("</style>")) {
    s = s.replace("</style>", css + "\n</style>");
    n++;
    console.log("connect-db CSS");
  }
}

// Status class toggles if JS sets textContent of conn-status
if (s.includes("$('conn-status')") || s.includes('conn-status')) {
  // soft enhance when setting tested OK
  if (s.includes("textContent = 'OK'") && s.includes("conn-status")) {
    /* skip ambiguous */
  }
  if (s.includes("'Not tested'")) {
    // leave
  }
}

console.log("connect-db polish", n);
fs.writeFileSync(file, s);
