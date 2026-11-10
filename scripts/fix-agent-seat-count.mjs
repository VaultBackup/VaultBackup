#!/usr/bin/env node
/** After revoke, KV.list can briefly still return deleted keys. Count only keys that still GET. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

const old = `  const existing = await KV.list({ prefix: \`agentmeta:${session.tenantId}:\`, limit: MAX_AGENTS_PER_TENANT + 1 });
  if (existing.keys.length >= sub.agentSeats) {
    throw new HttpError(400, \`Plan allows ${sub.agentSeats} desktop agent(s). Revoke one or upgrade.\`);
  }`;

const neu = `  const existing = await KV.list({ prefix: \`agentmeta:${session.tenantId}:\`, limit: MAX_AGENTS_PER_TENANT + 1 });
  // KV.list is eventually consistent — verify each key still exists after revoke.
  let liveAgentCount = 0;
  const staleKeys = [];
  for (const k of existing.keys) {
    const still = await KV.get(k.name);
    if (still) liveAgentCount++;
    else staleKeys.push(k.name);
  }
  for (const sk of staleKeys) {
    try { await KV.delete(sk); } catch (_) {}
  }
  if (liveAgentCount >= sub.agentSeats) {
    throw new HttpError(400, \`Plan allows ${sub.agentSeats} desktop agent(s). Revoke one or upgrade.\`);
  }`;

if (!s.includes("const existing = await KV.list({ prefix: `agentmeta:${session.tenantId}:`")) {
  console.error("seat-count list block not found");
  process.exit(1);
}

if (s.includes("liveAgentCount")) {
  console.log("already patched");
} else if (s.includes(old)) {
  s = s.replace(old, neu);
  console.log("patched exact block");
} else {
  // flexible
  const re = /const existing = await KV\.list\(\{ prefix: `agentmeta:\$\{session\.tenantId\}:`, limit: MAX_AGENTS_PER_TENANT \+ 1 \}\);\s*if \(existing\.keys\.length >= sub\.agentSeats\) \{\s*throw new HttpError\(400, `Plan allows \$\{sub\.agentSeats\} desktop agent\(s\)\. Revoke one or upgrade\.`);\s*\}/;
  if (!re.test(s)) {
    console.error("flexible match failed");
    process.exit(1);
  }
  s = s.replace(re, neu.trim());
  console.log("patched flexible");
}

fs.writeFileSync(file, s);
console.log("done", s.length);
