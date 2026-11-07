#!/usr/bin/env python3
"""Apply critical VAPT fixes to worker.js in-place. Usage: python3 apply-vapt-fixes.py [worker.js]"""
from pathlib import Path
import re
import sys

p = Path(sys.argv[1] if len(sys.argv) > 1 else "worker.js")
src = p.read_text(encoding="utf-8")
orig = src

if "function registrationAllowed" not in src:
    hr = src.find("async function handleRegister")
    if hr < 0:
        raise SystemExit("handleRegister not found")
    src = (
        src[:hr]
        + """function registrationAllowed(env) {
  const v = String(env.ALLOW_REGISTRATION || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

"""
        + src[hr:]
    )

src = src.replace(
    'if (env.ALLOW_REGISTRATION === "false") throw new HttpError(403, "Registration is disabled.");',
    'if (!registrationAllowed(env)) throw new HttpError(403, "Registration is disabled.");',
)

if "async function adminTokenOK" not in src and "function adminTokenOK" not in src:
    i = src.find("function timingSafeEqual")
    if i < 0:
        i = src.find("async function sha256Hex")
    if i < 0:
        raise SystemExit("no insertion point for adminTokenOK")
    src = (
        src[:i]
        + """
async function adminTokenOK(request, env) {
  const expected = String(env.ADMIN_TOKEN || "").trim();
  if (!expected || expected.length < 16) return false;
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\\s+(.+)$/i);
  const provided = (m ? m[1] : request.headers.get("X-Admin-Token") || "").trim();
  if (!provided) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let ok = 0;
  for (let i = 0; i < a.length; i++) ok |= a[i] ^ b[i];
  return ok === 0;
}

"""
        + src[i:]
    )

if "VAPT: public body is minimal" not in src and 'path === "/api/health"' in src:
    src, n = re.subn(
        r'if \(method === "GET" && path === "/api/health"\) \{[\s\S]*?return json\(\{[\s\S]*?\}\);\s*\}',
        """if (method === "GET" && path === "/api/health") {
    // VAPT: public body is minimal; details only with admin token.
    if (!(await adminTokenOK(request, env))) {
      return json({ ok: true });
    }
    return json({
      ok: true,
      kv: !!(env.backup_kv || env.KV_STORE || env.KV),
      encryption: !!(env.ENCRYPTION_KEY && env.ENCRYPTION_KEY.length >= 32),
      r2: !!env.BACKUP_BUCKET,
      registration: registrationAllowed(env),
    });
  }""",
        src,
        count=1,
    )
    print("health replacements", n)

src = src.replace(
    'path === "/admin") return htmlPage(ADMIN_HTML);',
    """path === "/admin") {
    if (!(await adminTokenOK(request, env))) {
      return htmlPage("<!DOCTYPE html><html><body style=\\"font-family:system-ui;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh\\"><p>Admin token required.</p></body></html>");
    }
    return htmlPage(ADMIN_HTML);
  }""",
    1,
)

if src == orig:
    print("No changes (already patched?)")
else:
    p.write_text(src, encoding="utf-8")
    print(f"Patched {p} ({len(orig)} -> {len(src)} bytes)")
print("Deploy with: npx wrangler deploy")
print("Do NOT set ALLOW_REGISTRATION=true unless you want open sign-ups.")
