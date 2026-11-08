#!/usr/bin/env node
/** Add public nav on landing/auth screen so / links to install + docs. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

const navBlock = `
                <nav class="flex flex-wrap gap-3 pt-4 text-sm" aria-label="Product">
                    <a href="/install" class="text-brand-400 hover:text-brand-300 font-medium">Install agent</a>
                    <a href="/docs" class="text-slate-400 hover:text-white">Docs</a>
                    <a href="/docs/product" class="text-slate-400 hover:text-white">Product</a>
                    <a href="/docs/storage" class="text-slate-400 hover:text-white">Own storage</a>
                    <a href="/docs/security" class="text-slate-400 hover:text-white">Security</a>
                    <a href="/download/windows-msi" class="text-slate-400 hover:text-white">Windows MSI</a>
                </nav>`;

// Prefer placing under the existing install link
const oldLink =
  '<a href="/install" class="vb-link-muted">Download desktop agent →</a>';
const newLink =
  '<a href="/install" class="vb-link-muted">Download desktop agent</a>' +
  navBlock;

if (s.includes(oldLink)) {
  s = s.replace(oldLink, newLink);
  console.log("Replaced auth install link with nav");
} else if (s.includes("Download desktop agent") && !s.includes('href="/docs"')) {
  // Insert nav after first /install link in auth brand
  s = s.replace(
    /(<a href="\/install" class="vb-link-muted">[^<]*<\/a>)/,
    `$1${navBlock}`
  );
  console.log("Inserted nav after install link");
} else if (s.includes("vb-auth-brand") && !s.includes('aria-label="Product"')) {
  s = s.replace(
    /(<div class="pt-6">)/,
    `$1${navBlock}\n`
  );
  console.log("Inserted nav into vb-auth-brand footer");
} else if (s.includes('aria-label="Product"')) {
  console.log("Landing product nav already present");
} else {
  console.warn("Could not find auth brand anchor for nav");
}

// Fix awkward " , " left from em-dash stripping on landing copy
s = s.replace(/firms , to your/g, "firms, to your");
s = s.replace(/VaultBackup , /g, "VaultBackup: ");
s = s.replace(/VaultBackup ,/g, "VaultBackup:");

// Ensure homepage uses same favicon path
if (s.includes("FRONTEND") || s.includes("auth-view")) {
  if (!s.includes('href="/icon.svg"') && s.includes('rel="icon"')) {
    s = s.replace(
      /<link rel="icon"[^>]*>/,
      '<link rel="icon" type="image/svg+xml" href="/icon.svg">'
    );
  }
}

fs.writeFileSync(file, s);
console.log("link-landing-nav done", s.length);
