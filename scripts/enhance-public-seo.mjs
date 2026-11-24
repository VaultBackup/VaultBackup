#!/usr/bin/env node
/** Safe SEO patches including /docs/about in sitemap. */
import fs from "fs";

const file = process.argv[2] || "worker.js";
let s = fs.readFileSync(file, "utf8");

if (s.includes('"Allow: /install"') && !s.includes('"Allow: /docs"')) {
  s = s.replace(
    '"Allow: /install",',
    '"Allow: /install",\n      "Allow: /docs",\n      "Allow: /docs/about",\n      "Allow: /docs/product",\n      "Allow: /docs/agent",\n      "Allow: /docs/storage",\n      "Allow: /docs/security",'
  );
  console.log("robots: allow /docs*");
} else if (s.includes('"Allow: /docs"') && !s.includes('"Allow: /docs/about"')) {
  s = s.replace('"Allow: /docs",', '"Allow: /docs",\n      "Allow: /docs/about",');
  console.log("robots: allow /docs/about");
}

const sitemapLine = 'const urls = ["/", "/install", "/download", "/agent", "/llms.txt"];';
const expandedLine = 'const urls = ["/", "/install", "/docs", "/docs/about", "/docs/product", "/docs/agent", "/docs/storage", "/docs/security", "/docs/restore", "/docs/support", "/docs/privacy", "/docs/accounting-firms", "/docs/sql-server-backup", "/docs/postgresql-backup", "/docs/mysql-backup", "/docs/mongodb-backup", "/docs/redis-backup"];';
if (s.includes(sitemapLine)) {
  s = s.replace(sitemapLine, expandedLine);
  console.log("sitemap expanded with canonical public content pages");
} else if (s.includes('const urls = [')) {
  s = s.replace(/const urls = \[[^\]]*\];/, expandedLine);
  console.log("sitemap normalized to canonical public content pages");
}

if (s.includes('const pri = u === "/" ? "1.0" : u === "/install" ? "0.9" : "0.7";')) {
  s = s.replace(
    'const pri = u === "/" ? "1.0" : u === "/install" ? "0.9" : "0.7";',
    'const pri = u === "/" ? "1.0" : (u === "/install" || u === "/docs" || u === "/docs/about") ? "0.95" : u.startsWith("/docs/") ? "0.9" : "0.7";'
  );
}

if (s.includes('Install desktop agent: https://backup.enadoctemp.workers.dev/install') &&
    !s.includes('About: https://backup.enadoctemp.workers.dev/docs/about')) {
  s = s.replace(
    'Install desktop agent: https://backup.enadoctemp.workers.dev/install",',
    'Install desktop agent: https://backup.enadoctemp.workers.dev/install",\n      "About: https://backup.enadoctemp.workers.dev/docs/about",\n      "Documentation: https://backup.enadoctemp.workers.dev/docs",'
  );
}

fs.writeFileSync(file, s);
console.log("enhance-public-seo done", s.length);
