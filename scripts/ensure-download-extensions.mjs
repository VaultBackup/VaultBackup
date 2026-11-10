#!/usr/bin/env node
/** Agent downloads: Linux/macOS save as .bin; Windows keep .msi/.exe. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

const desired = `const AGENT_BINARIES = {
  "windows-msi": { file: "vaultbackup-agent-windows-amd64.msi", downloadName: "vaultbackup-agent-windows-amd64.msi", contentType: "application/x-msi" },
  "windows-amd64": { file: "vaultbackup-agent-windows-amd64.exe", downloadName: "vaultbackup-agent-windows-amd64.exe", contentType: "application/vnd.microsoft.portable-executable" },
  "windows-arm64": { file: "vaultbackup-agent-windows-arm64.exe", downloadName: "vaultbackup-agent-windows-arm64.exe", contentType: "application/vnd.microsoft.portable-executable" },
  "darwin-amd64": { file: "vaultbackup-agent-darwin-amd64", downloadName: "vaultbackup-agent-darwin-amd64.bin", contentType: "application/octet-stream" },
  "darwin-arm64": { file: "vaultbackup-agent-darwin-arm64", downloadName: "vaultbackup-agent-darwin-arm64.bin", contentType: "application/octet-stream" },
  "linux-amd64": { file: "vaultbackup-agent-linux-amd64", downloadName: "vaultbackup-agent-linux-amd64.bin", contentType: "application/octet-stream" },
  "linux-arm64": { file: "vaultbackup-agent-linux-arm64", downloadName: "vaultbackup-agent-linux-arm64.bin", contentType: "application/octet-stream" },
};`;

const re = /const AGENT_BINARIES = \{[\s\S]*?\n\};/;
if (!re.test(s)) {
  console.error("AGENT_BINARIES block not found");
  process.exit(1);
}
s = s.replace(re, desired);
console.log("AGENT_BINARIES set");

// Replace any Content-Disposition that only uses meta.file
const before = s;
s = s.replace(
  /Content-Disposition"\s*:\s*[`'"]attachment; filename="['"`]\s*\+\s*meta\.file\s*\+\s*[`'"]["'`][`'"]/g,
  'Content-Disposition": "attachment; filename=\"" + (meta.downloadName || meta.file) + "\""'
);

// More patterns
const replacements = [
  [
    "'attachment; filename=\"' + meta.file + '\"'",
    "'attachment; filename=\"' + (meta.downloadName || meta.file) + '\"'",
  ],
  [
    '"attachment; filename=\"" + meta.file + "\""',
    '"attachment; filename=\"" + (meta.downloadName || meta.file) + "\""',
  ],
  [
    "`attachment; filename=\"${meta.file}\"`",
    "`attachment; filename=\"${meta.downloadName || meta.file}\"`",
  ],
  [
    'attachment; filename="' + meta.file + '"',
    'attachment; filename="' + (meta.downloadName || meta.file) + '"',
  ],
];

for (const [a, b] of replacements) {
  if (s.includes(a)) {
    s = s.replaceAll(a, b);
    console.log("replaced disposition:", a.slice(0, 50));
  }
}

// Last resort: inside handleAgentBinaryDownload, replace meta.file in disposition only
if (s.includes("handleAgentBinaryDownload") && s.includes("Content-Disposition")) {
  // Replace occurrences of filename=" + meta.file within ~2k after function start
  const fn = s.indexOf("handleAgentBinaryDownload");
  const slice = s.slice(fn, fn + 3500);
  if (slice.includes("meta.file") && !slice.includes("meta.downloadName")) {
    let updated = slice.replace(
      /filename="'\s*\+\s*meta\.file/g,
      "filename=\"' + (meta.downloadName || meta.file)"
    );
    updated = updated.replace(
      /filename=\""\s*\+\s*meta\.file/g,
      'filename=\"" + (meta.downloadName || meta.file)'
    );
    updated = updated.replace(
      /filename="\s*"\s*\+\s*meta\.file/g,
      'filename=" + (meta.downloadName || meta.file)'
    );
    // generic: ' + meta.file + '"' after filename=
    updated = updated.replace(
      /(filename=")('\s*\+\s*)meta\.file(\s*\+\s*')(")/g,
      "$1$2(meta.downloadName || meta.file)$3$4"
    );
    s = s.slice(0, fn) + updated + s.slice(fn + 3500);
    console.log("patched handleAgentBinaryDownload slice");
  }
}

// Nuclear option: any remaining attachment filename concat with meta.file
s = s.replace(
  /(attachment; filename=")(['"`]?)(\'?"?\s*\+\s*)meta\.file/g,
  "$1$2$3(meta.downloadName || meta.file)"
);

// Install docs
s = s.replaceAll("chmod +x vaultbackup-agent-linux-amd64", "chmod +x vaultbackup-agent-linux-amd64.bin");
s = s.replaceAll("./vaultbackup-agent-linux-amd64 --webui", "./vaultbackup-agent-linux-amd64.bin -webui");
s = s.replaceAll("./vaultbackup-agent-linux-amd64 -webui", "./vaultbackup-agent-linux-amd64.bin -webui");

if (before === s) console.log("warning: no disposition text changed (map may still be enough if code already uses downloadName)");

fs.writeFileSync(file, s);
console.log("done", s.length);

// Verify map has .bin downloadNames
if (!s.includes('downloadName: "vaultbackup-agent-linux-amd64.bin"')) {
  console.error("linux downloadName missing after write");
  process.exit(1);
}
