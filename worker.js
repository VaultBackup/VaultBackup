/**
 * VaultBackup Cloudflare Worker — PLACEHOLDER (not the full worker)
 *
 * Full source is ~415–422 KB and is already deployed on:
 *   https://backup.enadoctemp.workers.dev/
 *
 * It cannot be uploaded through the GitHub Contents API from the remote agent.
 * Push it from your machine:
 *
 *   git clone git@github.com:VaultBackup/VaultBackup.git
 *   cd VaultBackup
 *   cp /path/to/artifacts/worker.js .
 *   git add worker.js
 *   git commit -m "feat: full Cloudflare worker"
 *   git push origin main
 *
 * This placeholder returns HTTP 503 so a mis-deploy from the repo is obvious.
 */
export default {
  async fetch() {
    return new Response(
      JSON.stringify({
        error: "worker.js placeholder",
        message:
          "Replace this file with the full worker via a local git push, then redeploy.",
        bytes_expected: 422518,
        live_site: "https://backup.enadoctemp.workers.dev/",
      }),
      {
        status: 503,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  },
};
