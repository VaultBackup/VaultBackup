/**
 * VaultBackup Cloudflare Worker — PLACEHOLDER
 *
 * The full worker (~422 KB) lives in the local project artifacts and must be
 * copied with a normal git push (GitHub Contents API payloads from the remote
 * agent environment cannot carry a file this large in one commit).
 *
 *   cp /path/to/artifacts/worker.js .
 *   git add worker.js && git commit -m "feat: full Cloudflare worker" && git push
 *
 * Then deploy with Wrangler (see header comments in the full worker.js).
 *
 * This placeholder returns 503 so mis-deployments are obvious.
 */
export default {
  async fetch(request, env, ctx) {
    return new Response(
      JSON.stringify({
        error: "worker.js placeholder",
        message:
          "Replace this file with the full worker from project artifacts and redeploy.",
      }),
      {
        status: 503,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  },
};
