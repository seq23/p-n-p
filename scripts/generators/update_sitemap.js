const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const domain = 'https://porchandparty901.com';
function walk(dir, acc = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    // .pages-output is the assembled deploy copy of this same tree. Walking it
    // put every page into the sitemap twice, the second time under a
    // /.pages-output/ prefix that does not exist on the live site - which the
    // assembler then correctly refused to publish.
    if (item.name === 'node_modules' || item.name === '.pages-output' || item.name === 'dist' || item.name.startsWith('.git')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, acc);
    else if (item.isFile() && item.name.endsWith('.html')) acc.push(full);
  }
  return acc;
}
// A noindex page must never be submitted in the sitemap - Search Console reports
// that as an error against the whole file. The 404 surface is the case that
// surfaced it.
const isNoindex = (abs) => /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i
  .test(fs.readFileSync(abs, 'utf8'));
const htmlFiles = walk(root)
  .filter((abs) => !isNoindex(abs))
  .map(f => path.relative(root, f).replace(/\\/g, '/'))
  .sort();
// lastmod comes from the page's own content, not from build time and no longer
// from `git log`. Stamping every URL with today would tell a crawler the whole
// site changed on every deploy, which is the date-bump pattern that makes a
// freshness signal worthless, and recency is the strongest single correlate of
// being cited by an answer engine.
//
// This used to read `git log -1 --format=%cs -- <file>`, which produced exactly
// that date bump in CI without looking like one: monthly-audit.yml and
// deploy-distribution.yml check out with actions/checkout@v7 at its default
// depth of 1, so there is a single commit and every file's "last commit" is
// that commit. Confirmed with a --depth 1 clone of this repo: index.html reads
// 2026-08-25 with full history and 2026-08-26 - the tip - when shallow. The
// same call returns nothing where git is unavailable, and this then emitted
// <url> with no <lastmod>, which data/cadence/policy.json treats as a blocking
// no_freshness_signal.
//
// The ledger keys the date on a content hash instead, so it is the same in
// every checkout. Git history is still consulted, but only to seed a URL never
// recorded before, and only when the clone actually has the history.
const ledgerLib = require('../lib/lastmod_ledger');
const today = ledgerLib.buildDate();
const ledger = ledgerLib.load();
// A directory index is served at the directory, not at its index.html: the
// live host answers /answers/index.html with a 308 to /answers/. Advertising
// the redirecting form in a sitemap points a crawler at a URL that is not the
// one that will be indexed, for the six section indexes this site has. Only the
// root index.html was special-cased before.
// ...and the same is true of the `.html` suffix itself: the origin answers
// /pricing.html with a 308 to /pricing. Both rules now live in one place, so
// the sitemap, the canonical tags and the guard cannot disagree about what a
// public URL on this site looks like.
const { sitePathForFile } = require('../lib/site_url');
const canonicalPath = (rel) => sitePathForFile(rel).replace(/^\//, '');
const pages = {};
for (const rel of htmlFiles) {
  const loc = `${domain}/${canonicalPath(rel)}`;
  pages[loc] = { hash: ledgerLib.contentHash(fs.readFileSync(path.join(root, rel))), file: rel };
}
const lastmods = ledgerLib.resolve(pages, ledger, today);
ledgerLib.save(ledgerLib.rebuilt(pages, ledger, today, { prune: true }));
// Count what actually moved, not what happens to carry today's date. On the day
// the ledger is seeded those are the same number, and reporting the second as
// the first would overstate how much changed every time a build ran on a date
// that already appears in the ledger.
const before = (ledger.entries || {});
const advanced = Object.keys(pages).filter((url) => {
  const prev = before[url];
  return !prev || prev.hash !== pages[url].hash;
}).length;
const body = htmlFiles.map(rel => {
  const loc = `${domain}/${canonicalPath(rel)}`;
  const mod = lastmods[loc];
  return `  <url><loc>${loc}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ''}</url>`;
}).join('\n');
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
fs.writeFileSync(path.join(root, 'sitemap.xml'), xml);
console.log(
  `Updated sitemap with ${htmlFiles.length} HTML files; ` +
  `${advanced} lastmod advanced to ${today} (new or changed content), ` +
  `${htmlFiles.length - advanced} held their existing date.`
);
