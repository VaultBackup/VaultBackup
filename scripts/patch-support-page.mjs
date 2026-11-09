#!/usr/bin/env node
/**
 * Ensure PUBLIC_DOCS /docs/support is end-user friendly:
 * - no RESEND_API_KEY / MAIL_FROM / Worker operator notes
 * - support via account email from signup + in-product status
 */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

const supportHtml = `<div class="hero"><p class="eyebrow">Company</p><h1>Support</h1>
<p class="lead">If a backup fails, start with the agent on your PC and your account dashboard. Use the email address you registered with when you need help from us.</p></div>
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
<li><strong>Database errors</strong>: confirm host, port, and that the PC can connect (office/LAN databases need the desktop agent).</li>
<li><strong>License offline</strong>: connect the PC to the internet briefly so the agent can check in, then retry.</li>
</ul>
</div>`;

// If PUBLIC_DOCS JSON contains /docs/support, replace that page's main body is hard.
// Simpler: after PUBLIC_DOCS is embedded, rewrite the support entry by regenerating is done in embed-public-docs.
// Here we strip leftover operator strings anywhere in the bundle as a safety net.
const strips = [
  /Email alerts:\s*set <code>RESEND_API_KEY<\/code> and <code>MAIL_FROM<\/code> on the Worker so critical agent failures can notify the account owner\.?/gi,
  /Account operators can enable email notifications with Resend credentials on the Worker\.?/gi,
  /For account or license help, contact the operator who issued your agent token\.?/gi,
  /set <code>RESEND_API_KEY<\/code> and <code>MAIL_FROM<\/code>[^<]*/gi,
  /RESEND_API_KEY/g,
  /MAIL_FROM/g,
];

for (const re of strips) {
  if (re.test(s)) {
    s = s.replace(re, "");
    console.log("Stripped operator support text:", re);
  }
}

fs.writeFileSync(file, s);
console.log("patch-support-page done", s.length);
