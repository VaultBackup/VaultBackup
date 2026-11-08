#!/usr/bin/env node
/** Ensure worker.js exposes /download/windows-msi → vaultbackup-agent-windows-amd64.msi */
import fs from "fs";

const path = process.argv[2] || "worker.js";
let s = fs.readFileSync(path, "utf8");
let changed = false;

if (!s.includes('"windows-msi"')) {
  const needle = "const AGENT_BINARIES = {";
  if (!s.includes(needle)) {
    console.error("AGENT_BINARIES block not found in", path);
    process.exit(1);
  }
  s = s.replace(
    needle,
    `const AGENT_BINARIES = {\n  "windows-msi": { file: "vaultbackup-agent-windows-amd64.msi", contentType: "application/x-msi" },`
  );
  changed = true;
  console.log("Added windows-msi to AGENT_BINARIES");
} else {
  console.log("windows-msi already in AGENT_BINARIES");
}

// Prefer MSI on install page if only windows-amd64 is listed in a simple btn grid
if (!s.includes('/download/windows-msi') && s.includes('/download/windows-amd64')) {
  s = s.replace(
    '<a class="btn" href="/download/windows-amd64">Windows (x64)</a>',
    '<a class="btn" href="/download/windows-msi">Windows Installer (MSI)</a>\n      <a class="btn" href="/download/windows-amd64">Windows (x64 EXE)</a>'
  );
  if (s.includes('/download/windows-msi')) {
    changed = true;
    console.log("Added MSI button on install page");
  }
}

if (changed) {
  fs.writeFileSync(path, s);
  console.log("Wrote", path);
} else {
  console.log("No file changes needed");
}
