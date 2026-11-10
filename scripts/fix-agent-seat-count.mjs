#!/usr/bin/env node
/** Count only agentmeta keys that still exist (KV.list can lag after delete). */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

if (s.includes("liveAgentCount")) {
  console.log("already patched");
  process.exit(0);
}

const marker = "const existing = await KV.list({ prefix: `agentmeta:${session.tenantId}:`, limit: MAX_AGENTS_PER_TENANT + 1 });";
const idx = s.indexOf(marker);
if (idx < 0) {
  console.error("list marker not found");
  process.exit(1);
}

const after = s.indexOf("const id = \"ag_\" + randomHex(8);", idx);
if (after < 0) {
  console.error("id marker not found");
  process.exit(1);
}

const replacement =
  marker +
  "\n  // KV.list is eventually consistent — only count keys that still GET.\n" +
  "  let liveAgentCount = 0;\n" +
  "  for (const k of existing.keys) {\n" +
  "    if (await KV.get(k.name)) liveAgentCount++;\n" +
  "    else { try { await KV.delete(k.name); } catch (_) {} }\n" +
  "  }\n" +
  "  if (liveAgentCount >= sub.agentSeats) {\n" +
  "    throw new HttpError(400, `Plan allows ${sub.agentSeats} desktop agent(s). Revoke one or upgrade.`);\n" +
  "  }\n  ";

s = s.slice(0, idx) + replacement + s.slice(after);
fs.writeFileSync(file, s);
console.log("patched seat count", s.length);
