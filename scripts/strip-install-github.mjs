#!/usr/bin/env node
/** Remove public GitHub links/mentions from INSTALL_HTML (repo is private). */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");
let n = 0;

// Header nav link
const ghLink =
  '<a href="https://github.com/VaultBackup/VaultBackup" target="_blank" rel="noopener">GitHub</a>';
if (s.includes(ghLink)) {
  s = s.replaceAll(ghLink, "");
  n++;
  console.log("Removed GitHub header link");
}

// Any other github.com/VaultBackup anchors in install-ish HTML
s = s.replace(
  /<a[^>]*href="https:\/\/github\.com\/VaultBackup\/VaultBackup"[^>]*>\s*GitHub\s*<\/a>/gi,
  ""
);

// Lead copy: do not advertise GitHub builds to end users
const oldLead =
  "Back up local databases on Windows, macOS, or Linux. The agent talks to this Worker for licensing, status, and optional uploads. Binaries are built automatically from source on GitHub.";
const newLead =
  "Back up local databases on Windows, macOS, or Linux. The agent talks to this site for licensing and status. Download the installer for your system below, then complete the setup wizard.";
if (s.includes(oldLead)) {
  s = s.replaceAll(oldLead, newLead);
  n++;
  console.log("Rewrote install lead (no GitHub)");
} else if (s.includes("from source on GitHub")) {
  s = s.replaceAll("from source on GitHub", "for your platform");
  n++;
  console.log("Softened GitHub build phrase");
}

// Footer / muted notes
s = s.replaceAll(
  "Binaries are published automatically when the agent source is updated. Source repo is private.",
  "Installers are updated regularly. Prefer the Windows MSI for office PCs."
);
s = s.replaceAll("Source repo is private.", "");
s = s.replaceAll("public GitHub repository", "this site");

fs.writeFileSync(file, s);
console.log("strip-install-github done", n, s.length);
