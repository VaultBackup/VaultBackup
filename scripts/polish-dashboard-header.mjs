#!/usr/bin/env node
/** Fine-tune logged-in dashboard header: status pills + account cluster. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");
let n = 0;

// Shared pill class for health + scheduler
const oldPill =
  'class="hidden sm:flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 rounded-full px-3 py-1.5 text-xs shadow-sm"';
const newPill =
  'class="hidden sm:inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-xs text-slate-200 shadow-sm backdrop-blur-sm"';

if (s.includes(oldPill)) {
  s = s.replaceAll(oldPill, newPill);
  n++;
  console.log("status pill base class");
}

// Health badge container (often without hidden sm on first)
const oldHealthWrap =
  'id="health-badge" class="flex items-center gap-2 bg-slate-900/90 border border-slate-700/80 rounded-full px-3 py-1.5 text-xs shadow-sm"';
const newHealthWrap =
  'id="health-badge" class="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-xs text-slate-200 shadow-sm backdrop-blur-sm"';
if (s.includes(oldHealthWrap)) {
  s = s.replace(oldHealthWrap, newHealthWrap);
  n++;
  console.log("health badge wrap");
}

// Softer label text
s = s.replace(
  "<span id=\"health-text\" class=\"text-slate-300 font-medium\">Checking...</span>",
  "<span id=\"health-text\" class=\"text-slate-300 font-medium tracking-tight\">Checking worker...</span>"
);
s = s.replace(
  "<span id=\"sched-text\" class=\"text-slate-300 font-medium\">Scheduler: checking...</span>",
  "<span id=\"sched-text\" class=\"text-slate-300 font-medium tracking-tight\">Scheduler checking...</span>"
);

// Account cluster: email chip + quieter actions
const oldEmail =
  '<span id="user-email" class="hidden md:inline text-xs text-slate-400"></span>';
const newEmail =
  '<span id="user-email" class="hidden md:inline-flex items-center max-w-[12rem] truncate rounded-full border border-slate-700/80 bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-400" title="Signed-in account"></span>';
if (s.includes(oldEmail)) {
  s = s.replace(oldEmail, newEmail);
  n++;
  console.log("email chip");
}

const oldPwBtn =
  'id="btn-password" class="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5"';
const newPwBtn =
  'id="btn-password" class="text-xs text-slate-300 hover:text-white bg-slate-900/50 hover:bg-slate-800 border border-slate-700/80 px-2.5 py-1.5 rounded-full inline-flex items-center gap-1.5 transition-colors"';
const oldOutBtn =
  'id="btn-logout" class="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3 py-1.5 rounded-lg flex items-center gap-1.5"';
const newOutBtn =
  'id="btn-logout" class="text-xs text-slate-300 hover:text-white bg-slate-900/50 hover:bg-slate-800 border border-slate-700/80 px-2.5 py-1.5 rounded-full inline-flex items-center gap-1.5 transition-colors"';

if (s.includes(oldPwBtn)) {
  s = s.replace(oldPwBtn, newPwBtn);
  n++;
  console.log("password btn");
}
if (s.includes(oldOutBtn)) {
  s = s.replace(oldOutBtn, newOutBtn);
  n++;
  console.log("logout btn");
}

// Friendlier scheduler copy (match product tone; avoid heavy punctuation)
if (s.includes("'Scheduler OK · ' + ago(t)")) {
  s = s.replace(
    "'Scheduler OK · ' + ago(t)",
    "'Scheduler ' + ago(t)"
  );
  n++;
  console.log("scheduler ok label");
}
if (s.includes("'Scheduler idle'")) {
  s = s.replace("'Scheduler idle'", "'Scheduler waiting'");
  n++;
}

// Health active label if set in JS
if (s.includes("'Worker OK'") || s.includes('Worker: Active')) {
  s = s.replaceAll("'Worker OK'", "'Worker Active'");
  s = s.replaceAll("Worker: Active", "Worker Active");
  n++;
}
// Common patterns for health text updates
const healthPatterns = [
  ["'Connected'", "'Worker Active'"],
  ["\"Connected\"", "\"Worker Active\""],
  ["textContent = 'OK'", "textContent = 'Worker Active'"],
];
for (const [a, b] of healthPatterns) {
  if (s.includes(a) && s.includes("health-text")) {
    // only if near health - skip aggressive
  }
}

// Inject a small CSS block for header polish once
const cssMark = "/* __HEADER_POLISH__ */";
if (!s.includes(cssMark)) {
  const css = `
${cssMark}
#health-badge, #sched-badge { letter-spacing: 0.01em; }
#health-badge #health-dot, #sched-badge #sched-dot { box-shadow: 0 0 0 3px rgba(16,185,129,0.12); }
#health-badge.is-warn, #sched-badge.is-warn { border-color: rgba(245,158,11,0.35); background: rgba(245,158,11,0.08); }
#user-email { font-variant-numeric: tabular-nums; }
header .flex.items-center.gap-2 button:focus-visible { outline: 2px solid rgba(34,197,94,0.45); outline-offset: 2px; }
`;
  // Insert before </style> in main app if present
  if (s.includes("</style>")) {
    s = s.replace("</style>", css + "\n</style>");
    n++;
    console.log("header CSS injected");
  }
}

// When scheduler updates classes, also toggle is-warn for amber state
if (s.includes("$('sched-dot').className = 'w-2 h-2 rounded-full shrink-0 ' + (stale ? 'bg-amber-500' : 'bg-emerald-500');")) {
  s = s.replace(
    "$('sched-dot').className = 'w-2 h-2 rounded-full shrink-0 ' + (stale ? 'bg-amber-500' : 'bg-emerald-500');",
    `$('sched-dot').className = 'w-2 h-2 rounded-full shrink-0 ' + (stale ? 'bg-amber-500' : 'bg-emerald-500');
            var sb2 = $('sched-badge'); if (sb2) { sb2.classList.toggle('is-warn', !!stale); sb2.classList.toggle('border-emerald-500/20', !stale); }`
  );
  n++;
  console.log("scheduler warn class toggle");
}

console.log("header polish changes", n);
fs.writeFileSync(file, s);
