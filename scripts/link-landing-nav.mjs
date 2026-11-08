#!/usr/bin/env node
/** Add public nav on landing/auth screen including About. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

const navBlock = `
                <nav class="flex flex-wrap gap-3 pt-4 text-sm" aria-label="Product">
                    <a href="/docs/about" class="text-slate-400 hover:text-white">About</a>
                    <a href="/install" class="text-brand-400 hover:text-brand-300 font-medium">Install agent</a>
                    <a href="/docs" class="text-slate-400 hover:text-white">Docs</a>
                    <a href="/docs/product" class="text-slate-400 hover:text-white">Product</a>
                    <a href="/docs/storage" class="text-slate-400 hover:text-white">Own storage</a>
                    <a href="/docs/security" class="text-slate-400 hover:text-white">Security</a>
                    <a href="/download/windows-msi" class="text-slate-400 hover:text-white">Windows MSI</a>
                </nav>`;

// Replace existing product nav if present
if (s.includes('aria-label="Product"')) {
  s = s.replace(/<nav class="flex flex-wrap gap-3 pt-4 text-sm" aria-label="Product">[\s\S]*?<\/nav>/, navBlock.trim());
  console.log("Updated existing product nav with About");
} else {
  const oldLink = '<a href="/install" class="vb-link-muted">Download desktop agent →</a>';
  const oldLink2 = '<a href="/install" class="vb-link-muted">Download desktop agent</a>';
  if (s.includes(oldLink)) {
    s = s.replace(oldLink, oldLink2 + navBlock);
  } else if (s.includes(oldLink2)) {
    s = s.replace(oldLink2, oldLink2 + navBlock);
  } else if (s.includes("<div class=\"pt-6\">")) {
    s = s.replace("<div class=\"pt-6\">", "<div class=\"pt-6\">" + navBlock);
  }
  console.log("Inserted product nav");
}

s = s.replace(/firms , to your/g, "firms, to your");
s = s.replace(/VaultBackup , /g, "VaultBackup: ");

fs.writeFileSync(file, s);
console.log("link-landing-nav done", s.length);
