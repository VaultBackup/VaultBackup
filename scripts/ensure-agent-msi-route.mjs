#!/usr/bin/env node
/** Ensure worker.js has windows-msi download + install-page MSI guidance */
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

// Install page: primary MSI button + secondary EXE
const oldGrid = `    <div class="grid grid-2" style="margin-top:1rem">
      <a class="btn" href="/download/windows-msi">Windows Installer (MSI)</a>
      <a class="btn" href="/download/windows-amd64">Windows (x64 EXE)</a>
      <a class="btn" href="/download/windows-arm64">Windows (ARM64)</a>
      <a class="btn" href="/download/darwin-arm64">macOS (Apple Silicon)</a>
      <a class="btn" href="/download/darwin-amd64">macOS (Intel)</a>
      <a class="btn" href="/download/linux-amd64">Linux (x64)</a>
      <a class="btn" href="/download/linux-arm64">Linux (ARM64)</a>
    </div>`;

const newGrid = `    <p style="margin:0.75rem 0 0.35rem"><strong style="color:#fff">Windows (recommended for offices)</strong></p>
    <div class="grid grid-2" style="margin-top:0.5rem">
      <a class="btn" href="/download/windows-msi" style="background:#16a34a;font-weight:700">Download Windows Installer (MSI)</a>
      <a class="btn" href="/download/windows-amd64">Windows portable EXE (x64)</a>
      <a class="btn" href="/download/windows-arm64">Windows portable EXE (ARM64)</a>
    </div>
    <p style="margin:1rem 0 0.35rem"><strong style="color:#fff">macOS &amp; Linux</strong></p>
    <div class="grid grid-2" style="margin-top:0.5rem">
      <a class="btn" href="/download/darwin-arm64">macOS (Apple Silicon)</a>
      <a class="btn" href="/download/darwin-amd64">macOS (Intel)</a>
      <a class="btn" href="/download/linux-amd64">Linux (x64)</a>
      <a class="btn" href="/download/linux-arm64">Linux (ARM64)</a>
    </div>`;

if (s.includes('/download/windows-msi') && s.includes('Pick the binary for your OS')) {
  // Replace simple grid if present
  if (s.includes(oldGrid)) {
    s = s.replace(oldGrid, newGrid);
    changed = true;
    console.log("Replaced install download grid with MSI-first layout");
  } else if (!s.includes("Download Windows Installer (MSI)")) {
    // Fallback: insert MSI-first block before first windows-amd64-only grid
    const alt = `    <div class="grid grid-2" style="margin-top:1rem">
      <a class="btn" href="/download/windows-amd64">Windows (x64)</a>`;
    if (s.includes(alt)) {
      s = s.replace(alt, newGrid + "\n    <!-- legacy grid continues below if any -->\n    <div class=\"grid grid-2\" style=\"margin-top:1rem;display:none\">\n      <a class=\"btn\" href=\"/download/windows-amd64\">Windows (x64)</a>");
      changed = true;
      console.log("Inserted MSI-first layout (fallback)");
    }
  } else {
    console.log("Install page already has MSI-first CTA");
  }
} else if (!s.includes('/download/windows-msi') && s.includes('/download/windows-amd64')) {
  s = s.replace(
    '<a class="btn" href="/download/windows-amd64">Windows (x64)</a>',
    '<a class="btn" href="/download/windows-msi" style="background:#16a34a;font-weight:700">Download Windows Installer (MSI)</a>\n      <a class="btn" href="/download/windows-amd64">Windows (x64 EXE)</a>'
  );
  changed = true;
  console.log("Prepended MSI button");
}

// Windows run steps: MSI first
const oldWin = `    <h2>Windows</h2>
<pre>vaultbackup-agent-windows-amd64.exe --webui 127.0.0.1:8787</pre>
    <p class="muted">Open the same address in a browser and complete the setup wizard.</p>`;

const newWin = `    <h2>Windows (MSI recommended)</h2>
<pre>msiexec /i vaultbackup-agent-windows-amd64.msi
:: optional quiet install:
msiexec /i vaultbackup-agent-windows-amd64.msi /qn</pre>
    <p class="muted">Then open <code>http://127.0.0.1:8787</code>, paste the agent token, choose database and storage, Save, Test license, Run backup.</p>
    <h2>Windows (portable EXE)</h2>
<pre>vaultbackup-agent-windows-amd64.exe --webui 127.0.0.1:8787</pre>
    <p class="muted">Same browser setup at <code>http://127.0.0.1:8787</code>.</p>`;

if (s.includes(oldWin)) {
  s = s.replace(oldWin, newWin);
  changed = true;
  console.log("Updated Windows install steps for MSI");
} else if (s.includes("vaultbackup-agent-windows-amd64.exe --webui") && !s.includes("msiexec /i vaultbackup-agent-windows-amd64.msi")) {
  s = s.replace(
    `    <h2>Windows</h2>
<pre>vaultbackup-agent-windows-amd64.exe --webui 127.0.0.1:8787</pre>`,
    `    <h2>Windows (MSI recommended)</h2>
<pre>msiexec /i vaultbackup-agent-windows-amd64.msi</pre>
    <p class="muted">Open <code>http://127.0.0.1:8787</code> after install.</p>
    <h2>Windows (portable EXE)</h2>
<pre>vaultbackup-agent-windows-amd64.exe --webui 127.0.0.1:8787</pre>`
  );
  changed = true;
  console.log("Updated Windows section (partial match)");
} else {
  console.log("Windows MSI steps already present or pattern changed");
}

// Copy clarity on private repo
const oldNote = "Files are served from the public GitHub repository.";
const newNote = "Files are served securely from this site (repo is private). Prefer the Windows MSI for office PCs.";
if (s.includes(oldNote)) {
  s = s.replace(oldNote, newNote);
  changed = true;
  console.log("Updated download note");
}

if (changed) {
  fs.writeFileSync(path, s);
  console.log("Wrote", path);
} else {
  console.log("No file changes needed");
}
