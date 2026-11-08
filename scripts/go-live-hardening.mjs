#!/usr/bin/env node
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");
let changes = 0;

// Hard lock: any call that checks registrationAllowed fails closed in handleRegister
if (s.includes("if (!registrationAllowed(env))")) {
  s = s.replaceAll(
    "if (!registrationAllowed(env))",
    "if (!registrationAllowed(env) || true /* go-live lock */)"
  );
  // Wait that makes it always true for the if (!x || true) which always enters block - good for throw
  changes++;
  console.log("Patched registrationAllowed checks to always deny path");
}

// Stronger: rewrite function body regardless of formatting
if (s.includes("function registrationAllowed")) {
  s = s.replace(
    /function registrationAllowed\([^)]*\)\s*\{[\s\S]*?\n\}/m,
    `function registrationAllowed(env) {
  return false; // go-live: public registration disabled
}`
  );
  changes++;
  console.log("registrationAllowed -> return false");
}

// Nuclear: first lines of handleRegister
if (s.includes("async function handleRegister")) {
  if (!s.includes("REGISTRATION_HARD_DISABLED")) {
    s = s.replace(
      /async function handleRegister\(([^)]*)\)\s*\{/,
      `async function handleRegister($1) {
  const REGISTRATION_HARD_DISABLED = true;
  if (REGISTRATION_HARD_DISABLED) throw new HttpError(403, "Registration is disabled.");`
    );
    changes++;
    console.log("handleRegister hard disabled");
  }
}

if (!changes) console.warn("No registration patches applied");
fs.writeFileSync(file, s);
console.log("done", s.length);
