#!/usr/bin/env node
/** Linux/macOS downloads save as .bin; Windows keep .msi/.exe. */
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
  console.error("AGENT_BINARIES not found");
  process.exit(1);
}
s = s.replace(re, desired);

// Exact production pattern from worker.js
const oldDisp = `"Content-Disposition": 'attachment; filename="' + meta.file + '"'`;
const newDisp = `"Content-Disposition": 'attachment; filename="' + (meta.downloadName || meta.file) + '"'`;

if (!s.includes(oldDisp) && !s.includes(newDisp)) {
  // try without spaces variations
  console.warn("exact disposition pattern missing; trying flexible replace");
  s = s.replace(
    /"Content-Disposition":\s*'attachment; filename="'\s*\+\s*meta\.file\s*\+\s*'"'/g,
    newDisp
  );
} else if (s.includes(oldDisp)) {
  s = s.replaceAll(oldDisp, newDisp);
  console.log("disposition patched", (s.match(/meta\.downloadName \|\| meta\.file/g) || []).length);
} else {
  console.log("disposition already uses downloadName");
}

s = s.replaceAll("chmod +x vaultbackup-agent-linux-amd64", "chmod +x vaultbackup-agent-linux-amd64.bin");
s = s.replaceAll("./vaultbackup-agent-linux-amd64 --webui", "./vaultbackup-agent-linux-amd64.bin -webui");
s = s.replaceAll("./vaultbackup-agent-linux-amd64 -webui", "./vaultbackup-agent-linux-amd64.bin -webui");

fs.writeFileSync(file, s);
if (!s.includes(newDisp) && !s.includes("meta.downloadName || meta.file")) {
  console.error("FAILED to patch Content-Disposition");
  process.exit(1);
}
console.log("ok", s.length);
