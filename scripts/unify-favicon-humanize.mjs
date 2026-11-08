#!/usr/bin/env node
/**
 * 1) One shared VaultBackup favicon (shield) for install, docs, and /favicon.ico
 * 2) Humanize public copy: remove em/en dashes and stiff AI punctuation
 */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

// Compact green shield icon (same mark as product)
const ICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
  "<rect width='32' height='32' rx='8' fill='%23020617'/>" +
  "<path d='M16 4l10 4v8c0 7-4.5 11.5-10 13C10.5 27.5 6 23 6 16V8l10-4z' fill='%2316a34a'/>" +
  "<path d='M16 8l6 2.4V15c0 4.2-2.5 7.2-6 8.5-3.5-1.3-6-4.3-6-8.5V10.4L16 8z' fill='%234ade80'/>" +
  "</svg>";

const ICON_HREF = "/icon.svg";
const ICON_LINK = `<link rel="icon" href="${ICON_HREF}" type="image/svg+xml">\n    <link rel="apple-touch-icon" href="${ICON_HREF}">`;

// Replace long data-URI icons in INSTALL_HTML / heads with /icon.svg
const dataIconRe =
  /<link rel="icon"[^>]*href="data:image\/svg\+xml[^>]*>\s*<link rel="apple-touch-icon"[^>]*>/g;
if (dataIconRe.test(s)) {
  s = s.replace(dataIconRe, ICON_LINK);
  console.log("Replaced data-URI favicons with /icon.svg");
}

// Docs pages generated later also need the link; patch PUBLIC_DOCS template if present
if (s.includes("PUBLIC_DOCS") && !s.includes('href=\"/icon.svg\"') && !s.includes('href="/icon.svg"')) {
  // embed-public-docs injects pages; ensure those HTML strings get icon after that script runs
  // (this script runs after embed-public-docs in CI)
}

// Inject /icon.svg into every public HTML head that has <title> but no /icon.svg
if (s.includes("<title>") && s.includes("INSTALL_HTML")) {
  // Ensure install head has icon once
  if (s.includes("Install VaultBackup") && !s.includes(`href="${ICON_HREF}"`)) {
    s = s.replace(
      /(<title>Install VaultBackup[^<]*<\/title>)/,
      `$1\n    <link rel="icon" href="${ICON_HREF}" type="image/svg+xml">\n    <link rel="apple-touch-icon" href="${ICON_HREF}">`
    );
    console.log("Install page icon link added");
  }
}

// Force icon links inside PUBLIC_DOCS HTML blobs
if (s.includes("const PUBLIC_DOCS")) {
  const before = s;
  // Add after charset meta in docs pages if missing
  s = s.replace(
    /(<meta charset=\"utf-8\">)/g,
    `$1<link rel=\"icon\" href=\"/icon.svg\" type=\"image/svg+xml\"><link rel=\"apple-touch-icon\" href=\"/icon.svg\">`
  );
  // Also plain quotes variant
  s = s.replace(
    /(<meta charset="utf-8">)/g,
    `$1<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icon.svg">`
  );
  // Avoid double injection
  s = s.replace(
    /(<link rel="icon" href="\/icon\.svg" type="image\/svg\+xml"><link rel="apple-touch-icon" href="\/icon\.svg">){2,}/g,
    "$1"
  );
  s = s.replace(
    /(<link rel=\"icon\" href=\"\/icon\.svg\" type=\"image\/svg\+xml\"><link rel=\"apple-touch-icon\" href=\"\/icon\.svg\">){2,}/g,
    "$1"
  );
  if (s !== before) console.log("Docs HTML: unified /icon.svg");
}

// Public routes for /icon.svg and /favicon.ico (before auth)
const iconRoute = `
  if (method === "GET" && (path === "/icon.svg" || path === "/favicon.ico" || path === "/favicon.svg")) {
    const svg = "${ICON_SVG.replace(/"/g, '"')}".replace(/%23/g, "#").replace(/%3c/gi, "<").replace(/%3e/gi, ">");
    // ICON_SVG uses %23 for # in some embeds; serve a clean SVG:
    const body = ${JSON.stringify(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#020617"/><path d="M16 4l10 4v8c0 7-4.5 11.5-10 13C10.5 27.5 6 23 6 16V8l10-4z" fill="#16a34a"/><path d="M16 8l6 2.4V15c0 4.2-2.5 7.2-6 8.5-3.5-1.3-6-4.3-6-8.5V10.4L16 8z" fill="#4ade80"/></svg>`
    )};
    return new Response(body, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  }
`;

if (!s.includes('path === "/icon.svg"')) {
  const installCombo =
    'if (method === "GET" && (path === "/install" || path === "/download" || path === "/agent"))';
  if (s.includes(installCombo)) {
    s = s.replace(installCombo, iconRoute + "\n  " + installCombo);
    console.log("Added /icon.svg and /favicon.ico routes");
  } else if (s.includes('path === "/og.svg"')) {
    s = s.replace('if (method === "GET" && path === "/og.svg")', iconRoute + "\n  if (method === \"GET\" && path === \"/og.svg\")");
    console.log("Added icon routes near og.svg");
  } else {
    console.warn("Could not insert icon routes");
  }
} else {
  console.log("Icon routes already present");
}

// Humanize: remove AI-style dashes from public-facing strings
const replacements = [
  [/ — /g, ". "],
  [/ – /g, ", "],
  [/\u2014/g, " - "], // remaining em dash to simple hyphen for code contexts only if needed
];
// Prefer removing em dash entirely in marketing copy
s = s.replace(/\u2014/g, ",");
s = s.replace(/\u2013/g, ",");
// Clean doubled punctuation from replacements
s = s.replace(/,\./g, ".");
s = s.replace(/\.\./g, ".");
console.log("Humanized dash characters in worker bundle");

fs.writeFileSync(file, s);
console.log("unify-favicon-humanize done", s.length);
