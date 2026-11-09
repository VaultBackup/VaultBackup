#!/usr/bin/env node
/** Safe Support page text swaps inside PUBLIC_DOCS only (no global secret wipes). */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

const pairs = [
  [
    "Start with agent logs and storage connectivity, then escalate to your administrator.",
    "If a backup fails, start with the agent on your PC and your account dashboard. Contact us using the email address you registered with.",
  ],
  [
    "Account operators can enable email notifications with Resend credentials on the Worker.",
    "Use the same email address you used when you created your account. Include your company name and the error text from History or Logs.",
  ],
  [
    "Failed backup checklist",
    "Before you contact support",
  ],
  [
    "Agent History and Logs on the local UI",
    "Open the agent at http://127.0.0.1:8787 and check History and Logs",
  ],
  [
    "Database and storage reachability",
    "Confirm the PC can reach your database and your storage",
  ],
  [
    "License status (online within 72 hours)",
    "Confirm the agent license is valid (online check-in at least every 72 hours)",
  ],
  [
    'Desktop Agents panel on the <a href="/">console</a>',
    'Sign in at the <a href="/">dashboard</a> and check Desktop Agents status',
  ],
];

let n = 0;
for (const [a, b] of pairs) {
  if (s.includes(a)) {
    s = s.replaceAll(a, b);
    n++;
    console.log("ok:", a.slice(0, 50));
  }
}
console.log("support patches", n);
fs.writeFileSync(file, s);
