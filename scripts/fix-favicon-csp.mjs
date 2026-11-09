#!/usr/bin/env node
/** Dashboard favicon blocked: CSP was img-src data: only. Allow same-origin icons. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

const pairs = [
  ["img-src data:;", "img-src 'self' data:;"],
  ['img-src data:;', "img-src 'self' data:;"],
  ["img-src data: ", "img-src 'self' data: "],
];

let n = 0;
for (const [a, b] of pairs) {
  if (s.includes(a) && !s.includes("img-src 'self'")) {
    s = s.replaceAll(a, b);
    n++;
    console.log("CSP patched:", a, "->", b);
  }
}

// Ensure dashboard head has explicit favicon links (rel=icon + shortcut)
if (s.includes('href="/icon.svg"') && !s.includes('rel="shortcut icon"')) {
  s = s.replace(
    '<link rel="icon" type="image/svg+xml" href="/icon.svg">',
    '<link rel="icon" type="image/svg+xml" href="/icon.svg">\n    <link rel="shortcut icon" href="/icon.svg">'
  );
  n++;
  console.log("added shortcut icon link");
}

if (!n) console.warn("No CSP img-src data: pattern found");
fs.writeFileSync(file, s);
console.log("done", s.length);
