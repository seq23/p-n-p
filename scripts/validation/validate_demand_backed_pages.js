#!/usr/bin/env node
/**
 * Fails the build on the three ways a page fan-out goes wrong here.
 *
 *   1. A sitemap URL that does not render. This site's sitemap is a filesystem
 *      walk, so it cannot claim a file that is not there - but it could, and did,
 *      claim the wrong form of a URL: six section indexes were advertised as
 *      /answers/index.html, which the host answers with a 308 to /answers/. A
 *      sitemap that points a crawler at a redirect is the same defect as one
 *      that points it at nothing, one degree weaker.
 *
 *   2. A registry that has drifted from the pages that exist. The three
 *      registries under data/ were written only when build_pages.js was invoked
 *      with the literal argument `all`, which `npm run build:all` never passes.
 *      They said 26 entries for a month while 109 URLs were live.
 *
 *   3. A fan-out record that has turned into a page. data/authority_scale/
 *      fanout_100k/ holds 100,000 cartesian strings like "best way to compare
 *      options for birthday room setup small space for homeowners in Memphis TN
 *      while evaluating a local provider". Every one is stamped
 *      OPPORTUNITY_ONLY. Against them stand three queries with a measured
 *      volume. This check asserts the 100,000 never crosses into the site.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const errors = [];
const notes = [];

// --- 1. every sitemap URL renders, at the URL it claims ----------------------
const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const missing = [];
const redirecting = [];
for (const loc of locs) {
  let p;
  try { p = new URL(loc).pathname; } catch { p = loc; }
  if (/\/index\.html$/.test(p)) redirecting.push(p);
  const rel = p.replace(/^\//, '').replace(/\/$/, '');
  const candidates = rel === '' ? ['index.html'] : [rel, `${rel}.html`, path.join(rel, 'index.html')];
  if (!candidates.some(exists)) missing.push(p);
}
if (missing.length) errors.push(`${missing.length} sitemap URL(s) have no file to render: ${missing.slice(0, 5).join(', ')}`);
if (redirecting.length) {
  errors.push(
    `${redirecting.length} sitemap URL(s) end in /index.html and will 308 to the directory form. ` +
    `Submit the canonical URL: ${redirecting.slice(0, 5).join(', ')}`
  );
}
if (!missing.length && !redirecting.length) notes.push(`sitemap: ${locs.length} URLs, all render at the URL claimed`);

// --- 2. registries match the pages that exist -------------------------------
const onDisk = new Set();
(function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.pages-output', 'dist'].includes(item.name) || item.name.startsWith('.git')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full);
    else if (item.name.endsWith('.html')) onDisk.add('/' + path.relative(ROOT, full).replace(/\\/g, '/'));
  }
})(ROOT);

const manifestRel = 'data/published_manifest/published_manifest.json';
if (exists(manifestRel)) {
  const manifest = read(manifestRel);
  const phantom = manifest.filter((m) => !onDisk.has(m.path)).map((m) => m.path);
  if (phantom.length) {
    errors.push(`${phantom.length} published-manifest entry/entries name a page that does not exist: ${phantom.slice(0, 5).join(', ')}`);
  }
  notes.push(`published manifest: ${manifest.length} entries against ${onDisk.size} HTML files on disk`);
}

// --- 3. no fan-out record has become a page ---------------------------------
const backlogRel = 'data/authority_scale/candidate_backlog.json';
if (exists(backlogRel)) {
  const backlog = read(backlogRel);
  const rows = Array.isArray(backlog) ? backlog : (backlog.candidates || backlog.records || []);
  const promoted = rows.filter((r) => r && r.disposition && r.disposition !== 'OPPORTUNITY_ONLY');
  if (promoted.length) {
    errors.push(`${promoted.length} fan-out candidate(s) are no longer OPPORTUNITY_ONLY; the 100k planning set must not become pages`);
  }
  notes.push(`fan-out backlog: ${rows.length} candidates, all opportunity-only`);
}

// --- reporting: measured demand vs what exists ------------------------------
if (exists('data/demand/measured_demand.json')) {
  const demand = read('data/demand/measured_demand.json');
  const haystack = [...onDisk].join(' ').toLowerCase();
  const uncovered = (demand.records || []).filter((r) => {
    const slug = r.query.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return !haystack.includes(slug);
  });
  notes.push(
    `demand: ${(demand.records || []).length} measured queries worth ${demand.total_measured_volume_per_month}/mo; ` +
    `${uncovered.length} have no page` +
    (uncovered.length ? `:\n    ` + uncovered.map((r) => `${r.volume}/mo KD${r.keyword_difficulty} ${r.query}`).join('\n    ') : '')
  );
}

for (const n of notes) console.log(`note: ${n}`);
if (errors.length) {
  console.error('validate:demand-backed-pages FAILED');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('validate:demand-backed-pages OK');
