#!/usr/bin/env node
/** Shared /icon.svg favicon + strip em/en dashes from worker source. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

const svgBody =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="8" fill="#020617"/>' +
  '<path d="M16 4l10 4v8c0 7-4.5 11.5-10 13C10.5 27.5 6 23 6 16V8l10-4z" fill="#16a34a"/>' +
  '<path d="M16 8l6 2.4V15c0 4.2-2.5 7.2-6 8.5-3.5-1.3-6-4.3-6-8.5V10.4L16 8z" fill="#4ade80"/>' +
  "</svg>";

// 1) Public icon routes (only if missing)
if (!s.includes('path === "/icon.svg"')) {
  const route =
    "\n  if (method === \"GET\" && (path === \"/icon.svg\" || path === \"/favicon.ico\" || path === \"/favicon.svg\")) {\n" +
    "    const body = " +
    JSON.stringify(svgBody) +
    ";\n" +
    "    return new Response(body, { headers: { \"content-type\": \"image/svg+xml; charset=utf-8\", \"cache-control\": \"public, max-age=86400\" } });\n" +
    "  }\n";

  const installCombo =
    'if (method === "GET" && (path === "/install" || path === "/download" || path === "/agent"))';
  if (s.includes(installCombo)) {
    s = s.replace(installCombo, route + "  " + installCombo);
    console.log("Inserted /icon.svg routes before install");
  } else {
    console.warn("install route not found; icon routes skipped");
  }
}

// 2) Point install data-URI icon at /icon.svg (simple string replace of common pattern)
if (s.includes('href="data:image/svg+xml') && s.includes('rel="icon"')) {
  s = s.replace(
    /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,[^"]*">/g,
    '<link rel="icon" type="image/svg+xml" href="/icon.svg">'
  );
  s = s.replace(
    /<link rel="apple-touch-icon" href="data:image\/svg\+xml,[^"]*">/g,
    '<link rel="apple-touch-icon" href="/icon.svg">'
  );
  console.log("Install/header icons point to /icon.svg");
}

// 3) Docs pages: after charset, ensure icon link once
if (s.includes("const PUBLIC_DOCS")) {
  if (!s.includes('href=\\"/icon.svg\\"') && !s.includes('href=\"/icon.svg\"') && !s.includes('href="/icon.svg"')) {
    // PUBLIC_DOCS is JSON.stringified HTML — icon may already be embedded by embed script
    console.log("PUBLIC_DOCS present (icon may be inside HTML strings)");
  }
  // Replace any data URI icons inside PUBLIC_DOCS JSON with /icon.svg
  s = s.replace(
    /href=\\"data:image\/svg\+xml[^\\"]*\\"/g,
    'href=\\"/icon.svg\\"'
  );
  s = s.replace(
    /href=\"data:image\/svg\+xml[^\"]*\"/g,
    'href=\"/icon.svg\"'
  );
}

// 4) Humanize: em/en dashes -> comma or space (not AI-style long dashes)
const em = (s.match(/\u2014/g) || []).length;
const en = (s.match(/\u2013/g) || []).length;
s = s.replace(/\u2014/g, ",");
s = s.replace(/\u2013/g, ",");
console.log("Removed em/en dashes:", em, en);

fs.writeFileSync(file, s);
console.log("done", s.length);
