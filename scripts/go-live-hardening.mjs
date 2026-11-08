#!/usr/bin/env node
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

const oldExact = `function registrationAllowed(env) {
  // Default DENY: only explicit "true" / "1" / "yes" opens sign-up (VAPT critical).
  const v = String(env.ALLOW_REGISTRATION || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}`;

const neu = `function registrationAllowed(env) {
  // Go-live lock: both flags must be explicit true (ALLOW_REGISTRATION alone is not enough).
  const on = (x) => {
    const v = String(x || "").trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes";
  };
  return on(env.ALLOW_REGISTRATION) && on(env.OPEN_REGISTRATION);
}`;

if (s.includes(oldExact)) {
  s = s.replace(oldExact, neu);
  console.log("Locked registrationAllowed (exact match)");
} else if (s.includes("function registrationAllowed(env)")) {
  s = s.replace(/function registrationAllowed\(env\) \{[\s\S]*?\n\}/, neu);
  console.log("Locked registrationAllowed (regex)");
} else {
  console.warn("registrationAllowed not found");
}

// Also block handleRegister early
if (s.includes("async function handleRegister") && !s.includes("/* __REG_LOCK_HINT__ */")) {
  s = s.replace(
    "async function handleRegister(request, env, KV) {",
    "async function handleRegister(request, env, KV) {\n  /* __REG_LOCK_HINT__ */"
  );
}

fs.writeFileSync(file, s);
console.log("done", s.length);
