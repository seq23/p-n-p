#!/usr/bin/env node
/**
 * Every canonical, every sitemap <loc>, and every internal href names a URL the
 * origin serves directly — never one it answers with a redirect.
 *
 * WHAT THIS CATCHES
 * -----------------
 * Ahrefs crawled porchandparty901.com on 2026-09-03 and reported "Canonical
 * points to redirect: 219 URLs" against a Health Score of 33. Reproduced live:
 *
 *   /answers/grazing-tables-memphis      -> 200, and its canonical said
 *   /answers/grazing-tables-memphis.html -> 308 back to the page it was on.
 *
 * 112 of 113 published pages did that. A canonical is the strongest claim a
 * page makes about which URL should be indexed; naming a URL that immediately
 * redirects tells Google to index something that never serves. The same defect
 * class was confirmed on approvalprep.com the day before, where Search Console
 * excluded 123 pages as "Page with redirect".
 *
 * WHAT "RESOLVES DIRECTLY" MEANS HERE
 * -----------------------------------
 * Two things, both required, because either alone passes a broken site:
 *
 *  1. The URL is backed by a file this repo publishes — otherwise the canonical
 *     is a 404, which is worse than a redirect.
 *  2. The URL is not in a form Cloudflare Pages rewrites. Verified live: this
 *     origin 308s `/x.html` to `/x`, `/index.html` to `/`, and `/dir` to
 *     `/dir/`. `scripts/lib/site_url.js` is the single definition of that, and
 *     this validator and the normalizer pass both read it, so they cannot drift
 *     apart into two lists of the same rule.
 *
 * It hard-fails when it examines zero pages, zero canonicals or zero sitemap
 * entries: an empty loop that exits 0 is the failure mode this check exists to
 * make impossible.
 */

const fs = require('fs');
const path = require('path');
const { DOMAIN, sitePathForFile, isRedirectingForm } = require('../lib/site_url');

const ROOT = path.resolve(__dirname, '../..');
const SKIP = new Set(['node_modules', '.git', '.pages-output', '.build', 'dist', '.clarity']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
if (!files.length) {
  console.error('CANONICAL RESOLVES FAILED: walked the tree and found zero HTML files. The scan is broken, not the site.');
  process.exit(1);
}

// The set of site paths this repo actually publishes, in their served form.
const served = new Set(files.map((abs) => sitePathForFile(path.relative(ROOT, abs))));

const redirectSources = new Set(
  fs.existsSync(path.join(ROOT, '_redirects'))
    ? fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split(/\s+/)[0])
    : []
);

const failures = [];
const fail = (msg) => failures.push(msg);

function attr(html, tag, keyAttr, keyValue, wanted) {
  const re = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  for (const m of html.match(re) || []) {
    const key = new RegExp(`\\b${keyAttr}=["']${keyValue}["']`, 'i');
    if (!key.test(m)) continue;
    const got = new RegExp(`\\b${wanted}=["']([^"']*)["']`, 'i').exec(m);
    if (got) return got[1];
  }
  return null;
}

function assertDirect(label, url, { mustExist = true } = {}) {
  if (isRedirectingForm(url)) {
    fail(`${label}: ${url} is a redirecting form; the origin answers it with a 3xx, not with the page`);
    return;
  }
  if (!mustExist) return;
  const sitePath = url.startsWith(DOMAIN) ? url.slice(DOMAIN.length) : url;
  const bare = sitePath.split('#')[0].split('?')[0];
  if (redirectSources.has(bare)) return; // an intentional, declared redirect source
  if (!served.has(bare)) {
    fail(`${label}: ${url} is not backed by any published page (would 404)`);
  }
}

let canonicals = 0;
let hrefs = 0;

for (const abs of files) {
  const rel = path.relative(ROOT, abs);
  const html = fs.readFileSync(abs, 'utf8');

  const canonical = attr(html, 'link', 'rel', 'canonical', 'href');
  if (!canonical) {
    fail(`${rel}: no <link rel="canonical"> at all`);
  } else {
    canonicals += 1;
    if (!canonical.startsWith(`${DOMAIN}/`)) {
      fail(`${rel}: canonical ${canonical} is not an absolute URL on ${DOMAIN}`);
    } else {
      assertDirect(`${rel} canonical`, canonical);
      const self = `${DOMAIN}${sitePathForFile(rel)}`;
      if (canonical !== self) fail(`${rel}: canonical ${canonical} does not name this page's own served URL ${self}`);
    }
  }

  const ogUrl = attr(html, 'meta', 'property', 'og:url', 'content');
  if (ogUrl) assertDirect(`${rel} og:url`, ogUrl);

  for (const m of html.matchAll(/href=["']([^"']+)["']/g)) {
    const href = m[1];
    if (/^(mailto:|tel:|javascript:|data:|#)/i.test(href)) continue;
    if (/^(https?:)?\/\//i.test(href) && !href.startsWith(DOMAIN)) continue;
    hrefs += 1;
    if (isRedirectingForm(href)) {
      fail(`${rel}: internal href ${href} is a redirecting form`);
    }
  }
}

if (!canonicals) {
  console.error(`CANONICAL RESOLVES FAILED: ${files.length} HTML file(s) carried zero canonical tags between them. The scan is broken, not the site.`);
  process.exit(1);
}
if (!hrefs) {
  console.error(`CANONICAL RESOLVES FAILED: ${files.length} HTML file(s) carried zero internal hrefs between them. The scan is broken, not the site.`);
  process.exit(1);
}

// Sitemap: same rule, different surface. A sitemap full of redirects is the
// other half of the same "we tell Google to index URLs that do not serve" bug.
const sitemapPath = path.join(ROOT, 'sitemap.xml');
let locs = 0;
if (!fs.existsSync(sitemapPath)) {
  console.error('CANONICAL RESOLVES FAILED: sitemap.xml is missing; there is nothing to check.');
  process.exit(1);
}
for (const m of fs.readFileSync(sitemapPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) {
  locs += 1;
  assertDirect('sitemap <loc>', m[1].trim());
}
if (!locs) {
  console.error('CANONICAL RESOLVES FAILED: sitemap.xml contains zero <loc> entries. The scan is broken, not the site.');
  process.exit(1);
}

// _redirects targets: a redirect that lands on another redirect is a chain, and
// a chain is what turns one hop into three. /services used to point at
// /services/porch-decorating.html, which then 308'd again.
const redirFile = path.join(ROOT, '_redirects');
if (fs.existsSync(redirFile)) {
  for (const line of fs.readFileSync(redirFile, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [from, to] = t.split(/\s+/);
    if (!to) continue;
    if (isRedirectingForm(to)) fail(`_redirects: ${from} -> ${to} lands on another redirect (chain)`);
  }
}

if (failures.length) {
  console.error(`CANONICAL RESOLVES FAILED (${failures.length} problem(s)):`);
  for (const f of failures.slice(0, 40)) console.error(`- ${f}`);
  if (failures.length > 40) console.error(`  ...and ${failures.length - 40} more`);
  process.exit(1);
}

console.log(
  `CANONICAL RESOLVES: PASS (${canonicals} canonical(s) across ${files.length} page(s), ` +
  `${hrefs} internal href(s), ${locs} sitemap <loc>(s) — every one names a URL this origin serves directly)`
);
