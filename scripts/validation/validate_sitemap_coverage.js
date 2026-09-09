#!/usr/bin/env node
/**
 * Every indexable page is in sitemap.xml, and every sitemap URL is a real page.
 *
 * WHY THIS FILE REQUIRES site_url.js
 * ----------------------------------
 * It used to invert sitemap URLs into file paths with its own two-line rule:
 *
 *   urls.map(u => u === '' ? 'index.html' : u.replace(/\/$/, '/index.html'))
 *
 * That was correct while every producer emitted the `.html` form. PR #12
 * (450e1f8, 2026-09-02) moved the sitemap, the canonicals and every internal
 * href onto scripts/lib/site_url.js, because Cloudflare Pages answers
 * /answers/grazing.html with a 308 to /answers/grazing and the redirecting form
 * was being named as canonical on 112 of 113 pages. The builder changed. THIS
 * GUARD DID NOT.
 *
 * So from that commit on it compared `answers/grazing` against
 * `answers/grazing.html`, matched nothing, and reported all 112 pages both
 * missing from the sitemap AND as sitemap URLs with no file. `Bounded
 * Self-Healing` run 34376648600 on 2026-09-09 — its first scheduled run after
 * #12 — then ran the repair `npm run build:sitemap` three times, rebuilt a
 * perfectly correct sitemap each time, re-checked it against the wrong rule,
 * and gave up: "NOT CLEAN after 3 attempt(s)".
 *
 * A REPAIR THAT CANNOT SATISFY ITS OWN CHECK NEVER TERMINATES. The lane exists
 * to fix other things and could not fix itself, which is the "guard that cannot
 * reach what it governs" defect exactly, produced by the other one: two
 * components each keeping their own copy of the same rule with no link between
 * them.
 *
 * site_url.js says of itself: "validators, generators and the normalizer pass
 * all require it, and they must agree by construction rather than by three
 * copies of the same regex staying in sync." This file is now one of them, and
 * the comparison happens in SITE-PATH space — the builder's own output — so the
 * two cannot drift again without the shared function changing under both.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, __dirname.endsWith('validation') ? '../..' : '..');
// A plain relative require, the same form every other consumer of the rule uses,
// so `validate:url-rule-single-source` can see this file defers to it.
const { sitePathForFile } = require('../lib/site_url');

const SITEMAP = path.join(ROOT, 'sitemap.xml');
if (!fs.existsSync(SITEMAP)) { console.error('Missing sitemap.xml'); process.exit(1); }

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (['.pages-output', 'node_modules', '.git'].includes(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (name.endsWith('.html')) out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
  }
  return out;
}

const html = walk(ROOT);
const xml = fs.readFileSync(SITEMAP, 'utf8');

// Compare in site-path space. The sitemap's <loc> already carries the serving
// form, so the guard normalizes FILES FORWARD with the shared function rather
// than trying to reverse URLs into filenames — a mapping that is not injective
// (both `a/index.html` and a hypothetical `a/` would come back to the same
// place) and that is exactly what went stale here.
const sitemapPaths = new Set(
  [...xml.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((m) => m[1] || '/')
);

// A page marked noindex must not appear in the sitemap - submitting one is an
// error Search Console reports. Excluding them here keeps the coverage rule
// honest instead of special-casing individual filenames.
const isNoindex = (rel) => /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i
  .test(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const pathForFile = new Map(html.map((rel) => [rel, sitePathForFile(rel)]));
const servedPaths = new Set();
for (const [rel, p] of pathForFile) if (!isNoindex(rel)) servedPaths.add(p);

const missing = html.filter((rel) => !isNoindex(rel) && !sitemapPaths.has(pathForFile.get(rel)));
const wronglyListed = html.filter((rel) => isNoindex(rel) && sitemapPaths.has(pathForFile.get(rel)));
const broken = [...sitemapPaths].filter((p) => !servedPaths.has(p));

// RULE 0: a guard that examined nothing has proven nothing. An empty repo, a
// walk that silently matched no files, or a sitemap with no <loc> would all have
// produced "coverage OK" from the old version.
if (html.length === 0 || sitemapPaths.size === 0) {
  console.error(
    `Sitemap coverage examined nothing: ${html.length} HTML file(s), ` +
    `${sitemapPaths.size} sitemap URL(s). That is not a pass — a coverage check ` +
    `over an empty set is evidence of nothing.`
  );
  process.exit(1);
}

if (missing.length || broken.length || wronglyListed.length) {
  if (wronglyListed.length) console.error('Noindex pages listed in sitemap:', wronglyListed.slice(0, 50));
  if (missing.length) console.error('HTML files missing from sitemap:', missing.slice(0, 50));
  if (broken.length) console.error('Sitemap URLs with no page behind them:', broken.slice(0, 50));
  process.exit(1);
}
console.log(
  `Sitemap coverage OK: ${html.length} HTML file(s), ${sitemapPaths.size} sitemap URL(s), ` +
  `mapped through site_url.sitePathForFile so the guard and the builder cannot disagree.`
);
