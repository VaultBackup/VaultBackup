#!/usr/bin/env node
/** Rewrite public Support page for end users. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

const oldBlocks = [
  `<div class="hero"><p class="eyebrow">Company</p><h1>Support</h1>
<p class="lead">Start with agent logs and storage connectivity, then escalate to your administrator.</p></div>
<div class="card"><h2>Failed backup checklist</h2>
<ol>
<li>Agent History and Logs on the local UI</li>
<li>Database and storage reachability</li>
<li>License status (online within 72 hours)</li>
<li>Desktop Agents panel on the <a href="/">console</a></li>
</ol>
<p class="muted">Account operators can enable email notifications with Resend credentials on the Worker.</p></div>`,
  `<div class="card"><h2>When a backup fails</h2>
<ol>
<li>Check agent History and Logs at http://127.0.0.1:8787</li>
<li>Confirm storage and database connectivity</li>
<li>Confirm License OK (online at least every 72 hours)</li>
<li>Check Desktop Agents status on the <a href="/">dashboard</a></li>
</ol>
<p class="muted">See also <a href="/docs/about">About</a> and <a href="/docs/privacy">Privacy</a>.</p></div>`,
];

const neu = `<div class="hero"><p class="eyebrow">Company</p><h1>Support</h1>
<p class="lead">If a backup fails, start with the agent on your PC and your account dashboard. Contact us using the email address you registered with.</p></div>
<div class="card"><h2>Before you contact support</h2>
<ol>
<li>Open the agent at <code>http://127.0.0.1:8787</code> and check <strong>History</strong> and <strong>Logs</strong>.</li>
<li>Confirm the PC can reach your database and your storage (S3, B2, R2, or local folder).</li>
<li>Confirm the agent still shows a valid license (it should check in at least every 72 hours).</li>
<li>Sign in at the <a href="/">dashboard</a> and check <strong>Desktop Agents</strong> status.</li>
</ol>
</div>
<div class="card"><h2>How to reach us</h2>
<p>Use the <strong>same email address</strong> you used when you created your VaultBackup account. That is the identity tied to your agents and licenses.</p>
<p class="muted">Include your company name, the agent machine name if you know it, and a short description of the error from History or Logs.</p>
<p><a class="btn" href="/">Open dashboard</a> <a class="btn secondary" href="/docs/restore">Restore guide</a> <a class="btn secondary" href="/install">Install guide</a></p>
</div>
<div class="card"><h2>Common fixes</h2>
<ul>
<li><strong>Storage errors</strong>: re-check bucket name, region, and access keys in the agent setup.</li>
<li><strong>Database errors</strong>: confirm host, port, and that the PC can connect (office databases need the desktop agent).</li>
<li><strong>License offline</strong>: connect the PC to the internet briefly so the agent can check in, then retry.</li>
</ul>
</div>`;

let replaced = false;
for (const old of oldBlocks) {
  if (s.includes(old)) {
    s = s.replaceAll(old, neu);
    replaced = true;
    console.log("Replaced support HTML block");
  }
  // JSON-escaped form inside PUBLIC_DOCS
  const oldEsc = JSON.stringify(old).slice(1, -1);
  const neuEsc = JSON.stringify(neu).slice(1, -1);
  if (s.includes(oldEsc)) {
    s = s.replaceAll(oldEsc, neuEsc);
    replaced = true;
    console.log("Replaced support HTML in JSON string");
  }
}

// Safety strips
const strips = [
  [/Account operators can enable email notifications with Resend credentials on the Worker\.?/g, ""],
  [/Email alerts: set <code>RESEND_API_KEY<\/code> and <code>MAIL_FROM<\/code> on the Worker so critical agent failures can notify the account owner\.?/g, ""],
  [/For account or license help, contact the operator who issued your agent token\.?/g, ""],
  [/contact the operator who issued your agent token\.?/gi, ""],
  [/RESEND_API_KEY/g, ""],
  [/MAIL_FROM/g, ""],
  [/escalate to your administrator\.?/gi, "check your dashboard, then contact us with your account email."],
];
for (const [re, to] of strips) {
  if (re.test(s)) {
    s = s.replace(re, to);
    replaced = true;
    console.log("Stripped", re);
  }
}

if (!replaced) console.warn("No support text matched; check embed output");
fs.writeFileSync(file, s);
console.log("done", s.length);
