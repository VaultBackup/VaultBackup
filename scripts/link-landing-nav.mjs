#!/usr/bin/env node
/** Fine-tune landing/auth hero: accurate copy, tidy nav, mobile layout. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

// --- CSS: auth brand + foot + mobile ---
const cssNeedle = `.vb-auth-brand h2 { font-size: 1.5rem; font-weight: 700; color: #fff; letter-spacing: -0.02em; margin: 0 0 0.5rem; }
.vb-auth-brand p { color: #94a3b8; font-size: 0.875rem; line-height: 1.55; margin: 0; }
.vb-auth-points { list-style: none; padding: 0; margin: 1.5rem 0 0; display: grid; gap: 0.75rem; }
.vb-auth-points li {
  display: flex; gap: 0.65rem; align-items: flex-start;
  font-size: 0.8rem; color: #cbd5e1;
}
.vb-auth-points span.icon {
  flex-shrink: 0; width: 1.5rem; height: 1.5rem; border-radius: 0.5rem;
  background: var(--vb-brand-dim); border: 1px solid rgba(34,197,94,0.25);
  display: flex; align-items: center; justify-content: center; color: var(--vb-brand);
  font-size: 0.7rem; font-weight: 700;
}
.vb-auth-form { padding: 1.75rem 1.5rem; }
@media (min-width: 768px) { .vb-auth-form { padding: 2rem; } }`;

const cssNew = `.vb-auth-brand h2 { font-size: 1.45rem; font-weight: 700; color: #fff; letter-spacing: -0.025em; margin: 0 0 0.55rem; line-height: 1.25; }
.vb-auth-brand p { color: #94a3b8; font-size: 0.84rem; line-height: 1.55; margin: 0; max-width: 36rem; }
.vb-auth-points { list-style: none; padding: 0; margin: 1.35rem 0 0; display: grid; gap: 0.7rem; }
.vb-auth-points li {
  display: flex; gap: 0.65rem; align-items: flex-start;
  font-size: 0.8rem; color: #cbd5e1; line-height: 1.4;
}
.vb-auth-points span.icon {
  flex-shrink: 0; width: 1.5rem; height: 1.5rem; border-radius: 0.5rem;
  background: var(--vb-brand-dim); border: 1px solid rgba(34,197,94,0.25);
  display: flex; align-items: center; justify-content: center; color: var(--vb-brand);
  font-size: 0.7rem; font-weight: 700;
}
.vb-auth-foot { margin-top: 1.75rem; padding-top: 1.25rem; border-top: 1px solid rgba(51,65,85,0.65); }
.vb-auth-cta {
  display: inline-flex; align-items: center; gap: 0.35rem;
  font-size: 0.82rem; font-weight: 650; color: #86efac; text-decoration: none;
}
.vb-auth-cta:hover { color: #bbf7d0; }
.vb-auth-nav {
  display: flex; flex-wrap: wrap; gap: 0.45rem 0.85rem;
  margin-top: 0.85rem; font-size: 0.72rem;
}
.vb-auth-nav a { color: #94a3b8; text-decoration: none; white-space: nowrap; }
.vb-auth-nav a:hover { color: #e2e8f0; }
.vb-auth-form { padding: 1.75rem 1.5rem; display: flex; flex-direction: column; justify-content: center; }
@media (min-width: 768px) {
  .vb-auth-form { padding: 2.1rem 2rem; }
  .vb-auth-shell { min-height: 28rem; }
}
@media (max-width: 767px) {
  .vb-auth-brand {
    display: block !important;
    padding: 1.15rem 1.25rem 1rem;
    border-right: 0;
    border-bottom: 1px solid var(--vb-border);
  }
  .vb-auth-brand h2 { font-size: 1.15rem; }
  .vb-auth-brand p { font-size: 0.78rem; }
  .vb-auth-points { display: none; }
  .vb-auth-foot { margin-top: 0.85rem; padding-top: 0.75rem; }
  .vb-auth-nav { gap: 0.35rem 0.7rem; }
}`;

if (s.includes(cssNeedle)) {
  s = s.replace(cssNeedle, cssNew);
  console.log("Updated auth CSS");
} else if (!s.includes(".vb-auth-foot")) {
  // insert after .vb-auth-points icon block if present
  const anchor = `.vb-auth-form { padding: 1.75rem 1.5rem; }
@media (min-width: 768px) { .vb-auth-form { padding: 2rem; } }`;
  if (s.includes(anchor)) {
    s = s.replace(anchor, cssNew);
    console.log("Injected auth CSS via form anchor");
  } else {
    console.log("Auth CSS anchor not found — skip CSS");
  }
} else {
  console.log("Auth foot CSS already present");
}

// --- Brand HTML ---
const brandNew = `<div class="vb-auth-brand">
                <div>
                    <div class="vb-chip mb-4">Console · Desktop agent</div>
                    <h2>Private database backups to storage you control</h2>
                    <p class="mt-2">Encrypted backups for SMBs and accounting firms. The desktop agent dumps on your network and uploads <strong style="color:#bbf7d0;font-weight:600">directly</strong> to your S3, B2, Wasabi, R2, Azure, WebDAV, SFTP, or local disk. The console handles license and health — not your dump traffic.</p>
                    <ul class="vb-auth-points">
                        <li><span class="icon">1</span><span>Install the agent on the host that can reach the database (or connect a public DB here).</span></li>
                        <li><span class="icon">2</span><span>Test DB + destination, encrypt on the agent, upload straight to your bucket or disk.</span></li>
                        <li><span class="icon">3</span><span>Track agents, retention, and restore readiness from one console.</span></li>
                    </ul>
                </div>
                <div class="vb-auth-foot">
                    <a href="/install" class="vb-auth-cta">Download desktop agent →</a>
                    <nav class="vb-auth-nav" aria-label="Product links">
                        <a href="/install">Install guide</a>
                        <a href="/download/windows-msi">Windows MSI</a>
                        <a href="/docs/product">Product</a>
                        <a href="/docs/storage">Own storage</a>
                        <a href="/docs/security">Security</a>
                        <a href="/docs/about">About</a>
                    </nav>
                </div>
            </div>`;

if (s.includes('<div class="vb-auth-brand">')) {
  s = s.replace(/<div class="vb-auth-brand">[\s\S]*?<div class="vb-auth-form/, brandNew + '\n            <div class="vb-auth-form');
  console.log("Replaced vb-auth-brand block");
} else {
  console.log("vb-auth-brand not found");
}

// Sign-in actions: better mobile stack
s = s.replace(
  /<div id="auth-actions-login" class="flex items-center gap-3">[\s\S]*?<\/div>/,
  `<div id="auth-actions-login" class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <button id="btn-login" class="flex-1 bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm py-2.5 rounded-xl transition shadow-lg shadow-emerald-900/20">Sign in</button>
                <button id="btn-register" class="flex-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-medium text-sm py-2.5 rounded-xl transition">Create account</button>
            </div>`
);

// Tiny copy fixes
s = s.replace(/firms , to your/g, "firms, to your");
s = s.replace(/VaultBackup , /g, "VaultBackup: ");
s = s.replace(/client-side encryption keys on the Worker/g, "optional encryption on the agent before upload");

fs.writeFileSync(file, s);
console.log("link-landing-nav done", s.length);
