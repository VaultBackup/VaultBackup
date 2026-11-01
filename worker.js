/**
 * VaultBackup Cloudflare Worker — PLACEHOLDER (not the full worker)
 *
 * Full source: local project file `artifacts/worker.js` (~422 KB).
 * It cannot be uploaded through the GitHub Contents API from the remote agent
 * (payload size limit). Push it from your machine:
 *
 *   git clone git@github.com:VaultBackup/VaultBackup.git
 *   cd VaultBackup
 *   cp /path/to/artifacts/worker.js .
 *   git add worker.js
 *   git commit -m "feat: full Cloudflare worker"
 *   git push
 *
 * Then:
 *   npx wrangler deploy
 *
 * This placeholder returns HTTP 503 so a mis-deploy is obvious.
 */
export default {
  async fetch() {
    return new Response(
      JSON.stringify({
        error: "worker.js placeholder",
        message:
          "Replace this file with artifacts/worker.js via a local git push, then redeploy.",
        bytes_expected: 422518,
      }),
      {
        status: 503,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  },
};
