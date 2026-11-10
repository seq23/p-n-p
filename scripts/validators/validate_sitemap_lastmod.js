#!/usr/bin/env node
'use strict';
/**
 * sitemap.xml <lastmod> is the date a page's content last changed - never the
 * run date. Two halves, both hard-fail:
 *
 * 1. Proof on fixtures (the "two runs" test). The real ledger code in
 *    scripts/lib/lastmod_ledger.js is driven through two builds on two
 *    different days in a temp directory:
 *      - a page whose content did not change keeps its run-1 lastmod in run 2;
 *      - a page whose only change is site chrome (header call link, nav,
 *        footer, head, scripts) also keeps it - PR #25's header phone link
 *        moved all 115 dates on 2026-10-11 because <header> was not chrome;
 *      - a page whose only change is its OWN printed "Published/Updated" line
 *        also keeps it - that line is written from the date this ledger
 *        resolved, so hashing it closes a loop; PR #145 added it to 126 pages
 *        and moved all 126 dates on 2026-10-26;
 *      - a page whose body text changed advances to the run-2 date;
 *      - a page seen for the first time gets the run date.
 *    Each assertion is checked to FAIL against a deliberately broken resolver
 *    (one that stamps the run date), so the test cannot pass vacuously.
 *
 * 2. The committed sitemap. Every <url> has a lastmod; the values are not all
 *    identical; no single recent date covers 90% or more of them (checklist
 *    item a6); each one equals the ledger's date for that URL; and the
 *    ledger's hash for each URL is the hash of the page on disk, so the ledger
 *    is current and the dates it holds describe the content being served.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const ledgerLib = require('../lib/lastmod_ledger');
const { sitePathForFile } = require('../lib/site_url');

const ROOT = path.resolve(__dirname, '..', '..');
const DOMAIN = 'https://porchandparty901.com';
const errors = [];
const fail = (m) => errors.push(m);

// ---------------------------------------------------------------- 1. fixtures
const page = (header, nav, body, footer) =>
  `<!doctype html><html><head><title>t</title><script>var x=${Math.random()}</script></head><body>` +
  `<header class="site-header"><a href="/">Brand</a><nav>${nav}</nav>${header}</header>` +
  `<main>${body}</main><footer>${footer}</footer></body></html>`;

const v1 = {
  stable: page('', '<a href="/a">A</a>', '<h1>Stable page</h1><p>Same words both runs.</p>', '<p>hello@</p>'),
  chrome: page('', '<a href="/a">A</a>', '<h1>Chrome page</h1><p>Body never changes.</p>', '<p>hello@</p>'),
  edited: page('', '<a href="/a">A</a>', '<h1>Edited page</h1><p>First version.</p>', '<p>hello@</p>'),
  dates: page('', '<a href="/a">A</a>', '<h1>Dated page</h1><p>Body never changes.</p>', '<p>hello@</p>')
};
const v2 = {
  stable: v1.stable,
  chrome: page('<a href="tel:+19013551518">Call or text 901-355-1518</a>', '<a href="/a">A</a><a href="/b">B</a>',
    '<h1>Chrome page</h1><p>Body never changes.</p>', '<p>hello@</p><p>Call or text</p>'),
  edited: page('', '<a href="/a">A</a>', '<h1>Edited page</h1><p>Second version with new prose.</p>', '<p>hello@</p>'),
  // The page's own printed freshness line, which install_page_dates.js writes
  // from the date this ledger resolved. If the hash sees it, the stamp reports
  // itself as a content change and every page carrying one bumps on the build
  // that adds it - PR #145, 126 pages, 2026-10-26. It must not move the date.
  dates: page('', '<a href="/a">A</a>',
    '<h1>Dated page</h1><p class="page-dates" data-page-dates>Published <time datetime="2026-04-29">April 29, 2026</time> &middot; Updated <time datetime="2026-10-26">October 26, 2026</time></p><p>Body never changes.</p>',
    '<p>hello@</p>'),
  added: page('', '', '<h1>New page</h1>', '')
};
const DAY1 = '2026-01-05';
const DAY2 = '2026-01-19';
const toPages = (set) => Object.fromEntries(Object.entries(set).map(([k, html]) => [`${DOMAIN}/${k}`, { hash: ledgerLib.contentHash(html), file: `${k}.html` }]));

function twoRuns(resolve) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-lastmod-'));
  const ledgerPath = path.join(tmp, 'ledger.json');
  const p1 = toPages(v1);
  ledgerLib.save(ledgerLib.rebuilt(p1, ledgerLib.load(ledgerPath), DAY1, { prune: true, trustGit: false }), ledgerPath);
  const run1 = resolve(p1, ledgerLib.load(ledgerPath), DAY1);
  const p2 = toPages(v2);
  const run2 = resolve(p2, ledgerLib.load(ledgerPath), DAY2);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { run1, run2 };
}

function assertions({ run1, run2 }) {
  const u = (k) => `${DOMAIN}/${k}`;
  const out = [];
  if (run1[u('stable')] !== DAY1) out.push(`run 1 dated the stable page ${run1[u('stable')]}, expected ${DAY1}`);
  if (run2[u('stable')] !== DAY1) out.push(`unchanged page moved from ${DAY1} to ${run2[u('stable')]} across two runs`);
  if (run2[u('chrome')] !== DAY1) out.push(`a header/nav/footer-only change moved the lastmod to ${run2[u('chrome')]}`);
  if (run2[u('edited')] !== DAY2) out.push(`a body-text change did not advance the lastmod (got ${run2[u('edited')]})`);
  if (run2[u('dates')] !== DAY1) out.push(`adding the page's own "Published/Updated" line moved its lastmod to ${run2[u('dates')]}`);
  if (run2[u('added')] !== DAY2) out.push(`a new page was not dated with the run date (got ${run2[u('added')]})`);
  return out;
}

const real = (pages, ledger, day) => ledgerLib.resolve(pages, ledger, day, { trustGit: false });
for (const e of assertions(twoRuns(real))) fail(`fixture: ${e}`);
// Negative proof: a resolver that stamps the run date must fail the same checks.
const runDateStamp = (pages, _ledger, day) => Object.fromEntries(Object.keys(pages).map((k) => [k, day]));
if (!assertions(twoRuns(runDateStamp)).length) fail('fixture: the two-run test passed a resolver that stamps every URL with the run date, so it proves nothing');

// ------------------------------------------------------- 2. committed sitemap
const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const urls = [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)].map((m) => ({ loc: m[1], lastmod: m[2] || null }));
if (!urls.length) fail('sitemap.xml lists 0 URLs');
const undated = urls.filter((x) => !x.lastmod);
if (undated.length) fail(`${undated.length} sitemap URL(s) have no lastmod: ${undated.slice(0, 3).map((x) => x.loc).join(', ')}`);
const distinct = new Set(urls.map((x) => x.lastmod).filter(Boolean));
if (urls.length > 1 && distinct.size < 2) fail(`all ${urls.length} sitemap URLs share lastmod ${[...distinct][0]} - a run-date stamp, not content dates`);

/**
 * Item a6 of the owner's Search Readiness Checklist, as her Monday audit reads
 * it: "Fails when 90% or more of a sitemap's URLs (20 or more) carry the same
 * lastmod dated within the last two days: that is a build date, not a content
 * date." The all-identical check above is only its extreme case, and that is
 * why this file passed on 2026-10-26 with 159 of 174 URLs stamped that day -
 * 91%, caught by her audit and by nothing here. A build that bumps almost every
 * date at once must fail in the repo, not a week later in a queue brief.
 */
const byDate = new Map();
for (const { lastmod } of urls) if (lastmod) byDate.set(lastmod, (byDate.get(lastmod) || 0) + 1);
const [topDate, topCount] = [...byDate.entries()].sort((a, b) => b[1] - a[1])[0] || [null, 0];
if (topDate && topCount >= 20 && topCount / urls.length >= 0.9) {
  const ageDays = Math.round((Date.parse(`${ledgerLib.buildDate()}T00:00:00Z`) - Date.parse(`${topDate}T00:00:00Z`)) / 86400000);
  if (ageDays >= 0 && ageDays <= 2) {
    fail(`${topCount} of ${urls.length} sitemap URLs (${Math.round((topCount / urls.length) * 100)}%) share lastmod ${topDate}, ${ageDays} day(s) old - a build date, not content dates (checklist item a6)`);
  }
}

const ledger = ledgerLib.load();
const fileFor = {};
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.pages-output', 'dist'].includes(e.name) || e.name.startsWith('.git')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs);
    else if (e.name.endsWith('.html')) {
      const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
      fileFor[`${DOMAIN}${sitePathForFile(rel)}`] = rel;
    }
  }
})(ROOT);
let stale = 0;
for (const { loc, lastmod } of urls) {
  const entry = (ledger.entries || {})[loc];
  if (!entry) { fail(`${loc} is in sitemap.xml but not in data/cadence/lastmod_ledger.json`); continue; }
  if (entry.lastmod !== lastmod) fail(`${loc}: sitemap lastmod ${lastmod} disagrees with the ledger's ${entry.lastmod}`);
  const rel = fileFor[loc];
  if (!rel) { fail(`${loc}: no file on disk`); continue; }
  if (ledgerLib.contentHash(fs.readFileSync(path.join(ROOT, rel))) !== entry.hash) stale += 1;
}
if (stale) fail(`${stale} page(s) changed on disk since the ledger was written; run npm run build:sitemap so their lastmod advances`);

if (errors.length) {
  console.error(`sitemap-lastmod: FAIL (${errors.length})`);
  errors.slice(0, 20).forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
console.log(`sitemap-lastmod: OK - two-run fixture holds unchanged/chrome-only dates and advances edited ones (and rejects a run-date stamp); ${urls.length} URLs, ${distinct.size} distinct lastmod values, all match the ledger and the content on disk`);
