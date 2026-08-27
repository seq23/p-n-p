#!/usr/bin/env node
'use strict';
/**
 * Every published page still carries the markup that was added after it was generated.
 *
 * The defect this exists for. scripts/generators/build_pages.js renders pages
 * from data/queries/query_universe.json, but it is not the last thing that
 * writes them. Two later passes add markup it knows nothing about:
 *
 *   scripts/install_clarity.js          -> <script data-clarity-loader>
 *   scripts/build_related_navigation.js -> <section data-nav="related-pages">
 *
 * So re-rendering an existing page does not reproduce it, it reverts it. On
 * 2026-08-27 all 26 template pages differed from a fresh render, every one
 * smaller by 1,500-1,900 bytes, and all 26 sit among the 98 frozen routes.
 * `npm run build:all` would have stripped the analytics tag and the
 * internal-link block from every one of them.
 *
 * build_pages.js now refuses that write. This is the second layer, and it exists
 * because the first one can be bypassed: --force is a documented escape hatch,
 * and nothing stops a future script, a bad merge, or a hand-edit from doing the
 * same damage by another route.
 *
 * Why it needs catching at all. Both losses are invisible in the ways anyone
 * would normally look. A page missing the Clarity tag renders identically and
 * validates identically - it simply records no sessions, silently, forever. A
 * page missing its related-pages block is still a valid page - it is just
 * orphaned, and orphan count is the strongest correlate in this portfolio's own
 * link-graph data with whether a property gets cited at all. Neither shows up as
 * an error. Both show up as a number that never moves.
 *
 * This ran green on introduction: 112 of 112 published pages carried both.
 * A failure here means something removed one, which is always a regression.
 *
 * Scope is the sitemap, not the disk. The sitemap is the set of pages this site
 * claims to publish; a file on disk it does not name is not a published page and
 * is not this validator's business.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'reports/validation/retrofit-integrity.json');

const REQUIRED = [
  {
    id: 'clarity_tag',
    marker: 'data-clarity-loader',
    wrote: 'scripts/install_clarity.js',
    repair: 'npm run clarity:install',
    why: 'the Microsoft Clarity analytics tag - without it the page records no sessions and reports nothing, silently',
  },
  {
    id: 'related_nav',
    marker: 'data-nav="related-pages"',
    wrote: 'scripts/build_related_navigation.js',
    repair: 'node scripts/build_related_navigation.js --write --only=<the page>',
    why: 'the related-pages internal-link block - without it the page is orphaned, and orphan count is this portfolio\'s strongest measured correlate with whether a property is cited',
  },
];

const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();

/** Resolve a sitemap URL to the file that serves it, the way the host does. */
function resolve(pathname) {
  const rel = pathname.replace(/^\//, '').replace(/\/$/, '');
  const candidates = rel === ''
    ? ['index.html']
    : [rel, `${rel}.html`, path.join(rel, 'index.html')];
  return candidates.map((c) => path.join(ROOT, c)).find(isFile) || null;
}

const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => {
  try { return new URL(m[1]).pathname; } catch { return m[1]; }
});

const missing = [];
const unresolved = [];
let checked = 0;

for (const pathname of locs) {
  const abs = resolve(pathname);
  if (!abs) { unresolved.push(pathname); continue; }
  checked += 1;
  const html = fs.readFileSync(abs, 'utf8');
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  for (const req of REQUIRED) {
    if (!html.includes(req.marker)) missing.push({ path: rel, block: req.id, why: req.why, repair: req.repair });
  }
}

const byBlock = Object.fromEntries(REQUIRED.map((r) => [
  r.id,
  {
    marker: r.marker,
    written_by: r.wrote,
    pages_missing: missing.filter((m) => m.block === r.id).length,
    coverage_pct: Number((100 * (1 - missing.filter((m) => m.block === r.id).length / Math.max(checked, 1))).toFixed(1)),
  },
]));

fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, `${JSON.stringify({
  schema_version: '1.0',
  validator: 'retrofit-integrity',
  generated_at: new Date().toISOString(),
  sitemap_urls: locs.length,
  pages_checked: checked,
  unresolved_sitemap_urls: unresolved,
  status: missing.length ? 'FAIL' : 'PASS',
  blocks: byBlock,
  missing,
}, null, 2)}\n`);

// An unresolved sitemap URL is validate:demand-backed-pages' job, not this one.
// Reported here so a shrinking checked-count cannot masquerade as clean.
if (unresolved.length) {
  console.log(`  note: ${unresolved.length} sitemap URL(s) resolved to no file and were not checked here`);
}

if (missing.length) {
  console.error(`RETROFIT INTEGRITY FAIL: ${missing.length} post-generation block(s) missing across ${checked} published pages\n`);
  for (const m of missing.slice(0, 20)) {
    console.error(`  ${m.path}`);
    console.error(`      missing ${m.block} - ${m.why}`);
    console.error(`      repair: ${m.repair}`);
  }
  if (missing.length > 20) console.error(`  ...and ${missing.length - 20} more`);
  console.error('\n  This is almost always a page that was re-rendered by a generator that does');
  console.error('  not run last. See the guard comment in scripts/generators/build_pages.js.\n');
  process.exit(1);
}

console.log(`Retrofit integrity OK: ${checked} published pages all carry the Clarity tag and the related-pages block.`);
