#!/usr/bin/env node
/** Safe SEO/AEO/GEO patches — only well-scoped replacements. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

// 1) robots: insert Allow: /docs after Allow: /install if missing
if (s.includes('"Allow: /install"') && !s.includes('"Allow: /docs"')) {
  s = s.replace(
    '"Allow: /install",',
    '"Allow: /install",\n      "Allow: /docs",\n      "Allow: /docs/product",\n      "Allow: /docs/agent",\n      "Allow: /docs/storage",\n      "Allow: /docs/security",'
  );
  console.log("robots: allow /docs*");
}

// 2) sitemap URL list
if (s.includes('const urls = ["/", "/install", "/download", "/agent", "/llms.txt"];')) {
  s = s.replace(
    'const urls = ["/", "/install", "/download", "/agent", "/llms.txt"];',
    'const urls = ["/", "/install", "/docs", "/docs/product", "/docs/agent", "/docs/storage", "/docs/security", "/download", "/agent", "/llms.txt"];'
  );
  console.log("sitemap: expanded urls");
}

// 3) sitemap priority
if (s.includes('const pri = u === "/" ? "1.0" : u === "/install" ? "0.9" : "0.7";')) {
  s = s.replace(
    'const pri = u === "/" ? "1.0" : u === "/install" ? "0.9" : "0.7";',
    'const pri = u === "/" ? "1.0" : (u === "/install" || u === "/docs") ? "0.95" : u.startsWith("/docs/") ? "0.9" : "0.7";'
  );
  console.log("sitemap: priorities");
}

// 4) Append doc links inside llms.txt body array (single safe line inserts)
if (s.includes('Install desktop agent: https://backup.enadoctemp.workers.dev/install') &&
    !s.includes('Documentation: https://backup.enadoctemp.workers.dev/docs')) {
  s = s.replace(
    'Install desktop agent: https://backup.enadoctemp.workers.dev/install",',
    'Install desktop agent: https://backup.enadoctemp.workers.dev/install",\n      "Documentation: https://backup.enadoctemp.workers.dev/docs",\n      "Product: https://backup.enadoctemp.workers.dev/docs/product",\n      "Security: https://backup.enadoctemp.workers.dev/docs/security",\n      "Storage: https://backup.enadoctemp.workers.dev/docs/storage",\n      "Agent guide: https://backup.enadoctemp.workers.dev/docs/agent",\n      "Windows MSI: https://backup.enadoctemp.workers.dev/download/windows-msi",'
  );
  console.log("llms.txt: doc links");
}

if (s.includes('## Key URLs') && !s.includes('/docs/product')) {
  s = s.replace(
    'https://backup.enadoctemp.workers.dev/install",',
    'https://backup.enadoctemp.workers.dev/install",\n      "- https://backup.enadoctemp.workers.dev/docs",\n      "- https://backup.enadoctemp.workers.dev/docs/product",'
  );
  console.log("llms.txt: key urls");
}

fs.writeFileSync(file, s);
console.log("enhance-public-seo done", s.length);
