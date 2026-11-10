#!/usr/bin/env node
/** Ensure agent download filenames include clear extensions (esp. Linux/macOS). */
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
console.log("AGENT_BINARIES updated with downloadName");

// Content-Disposition should prefer downloadName || file
const oldDisp = [
  `'attachment; filename="' + meta.file + '"'`,
  `"attachment; filename=\"" + meta.file + "\""`,
  'attachment; filename="' + "' + meta.file + '"',
];

// Common patterns in worker
const patterns = [
  [
    "'attachment; filename=\"' + meta.file + '\"'",
    "'attachment; filename=\"' + (meta.downloadName || meta.file) + '\"'",
  ],
  [
    '"attachment; filename=\"" + meta.file + "\""',
    '"attachment; filename=\"" + (meta.downloadName || meta.file) + "\""',
  ],
  [
    "attachment; filename=\"" + meta.file + "\"",
    "attachment; filename=\"" + (meta.downloadName || meta.file) + "\"",
  ],
];

let n = 0;
for (const [a, b] of patterns) {
  if (s.includes(a)) {
    s = s.replaceAll(a, b);
    n++;
    console.log("patched disposition pattern");
  }
}

// Broader replace for Content-Disposition lines using meta.file only
if (s.includes("Content-Disposition") && s.includes("meta.file") && !s.includes("meta.downloadName")) {
  s = s.replace(
    /Content-Disposition":\s*['"]attachment; filename="['"]\s*\+\s*meta\.file\s*\+\s*['"]["']['"]/g,
    'Content-Disposition": \'attachment; filename="\' + (meta.downloadName || meta.file) + \'"\''
  );
  // simpler line-level
  s = s.replace(
    /("Content-Disposition":\s*)('attachment; filename="' \+ meta\.file \+ '"')/g,
    "$1'attachment; filename="' + (meta.downloadName || meta.file) + '"'"
  );
  s = s.replace(
    /("Content-Disposition":\s*)("attachment; filename=\"" \+ meta\.file \+ "\"")/g,
    '$1"attachment; filename=\"" + (meta.downloadName || meta.file) + "\""'
  );
}

// Install page hints: mention .bin for unix downloads in pre blocks if present
s = s.replaceAll(
  "chmod +x vaultbackup-agent-linux-amd64",
  "chmod +x vaultbackup-agent-linux-amd64.bin"
);
s = s.replaceAll(
  "./vaultbackup-agent-linux-amd64 --webui",
  "./vaultbackup-agent-linux-amd64.bin -webui"
);
s = s.replaceAll(
  "./vaultbackup-agent-linux-amd64 -webui",
  "./vaultbackup-agent-linux-amd64.bin -webui"
);
// Generic pre sample
s = s.replaceAll(
  "chmod +x vaultbackup-agent-linux-amd64   # or darwin-arm64, etc.\n./vaultbackup-agent-linux-amd64 --webui 127.0.0.1:8787",
  "chmod +x vaultbackup-agent-linux-amd64.bin   # or darwin-arm64.bin, etc.\n./vaultbackup-agent-linux-amd64.bin -webui 127.0.0.1:8787"
);

fs.writeFileSync(file, s);
console.log("download extensions done", n, s.length);
