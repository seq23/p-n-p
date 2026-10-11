#!/usr/bin/env node
/**
 * Consolidation ledger - input for a decision, not a decision.
 *
 * Search Console (11 Sep-8 Oct 2026) showed impressions on one page, the
 * homepage. If URL Inspection (data/search_intelligence/index_coverage.json)
 * comes back "Crawled - currently not indexed" for the inner pages, the remedy
 * is fewer, stronger pages: fold thin pages into the hub that already answers
 * the same need. This stage records, for every sitemap URL, what that decision
 * needs - 28-day impressions, word count, current coverage state, and the hub
 * it would fold into - and changes nothing. No redirect is written here; the
 * decision is taken once a week of coverage data exists.
 *
 * Hubs are the hand-authored service pages (data/offers/services.json families
 * plus /services/birthday-party-planner-memphis). Root pages, section indexes
 * and hubs themselves never fold. Hard-fails on zero rows or on a fold target
 * that is not a hub page on disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const { visibleText } = require(path.join(ROOT, 'scripts/lib/lastmod_ledger.js'));
const { sitePathForFile } = require(path.join(ROOT, 'scripts/lib/site_url.js'));
const OUT = 'data/search_intelligence/consolidation_candidates.json';
const DOMAIN = 'https://porchandparty901.com';
const read = (rel, fb) => (fs.existsSync(path.join(ROOT, rel)) ? JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')) : fb);

// First match wins. Each rule names the hub by the need the page serves.
const FOLD_RULES = [
  [/planner|planning|event-management/, '/services/birthday-party-planner-memphis'],
  [/hotel|romantic|anniversary|proposal/, '/services/hotel-room-decor-memphis'],
  [/baby-shower|gender-reveal/, '/services/baby-shower-decor-memphis'],
  [/bridal|bachelorette/, '/services/bridal-shower-decor-memphis'],
  [/birthday|balloon/, '/services/birthday-party-decor-memphis'],
  [/grazing|charcuterie|corporate/, '/services/grazing-tables-memphis'],
  [/christmas|holiday/, '/services/christmas-porch-decorating'],
  [/fall|halloween|autumn|thanksgiving|pumpkin/, '/services/fall-porch-decorating'],
  [/small-porch|apartment|townhome/, '/services/small-porch-decorating'],
  [/front-door|wreath/, '/services/front-door-styling'],
  [/porch/, '/services/porch-decorating'],
  [/luxury/, '/services/luxury-party-decor-memphis'],
  [/budget|under-|cheap|diy/, '/services/budget-party-decor-memphis'],
  [/./, '/services/celebration-setups-memphis']
];
const ROOT_FILES = new Set(['index.html', 'contact.html', 'pricing.html', 'how-it-works.html', 'privacy-policy.html', 'terms-and-conditions.html']);

const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const fileFor = new Map();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.pages-output', 'dist'].includes(e.name) || e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs);
    else if (e.name.endsWith('.html')) { const rel = path.relative(ROOT, abs).replace(/\\/g, '/'); fileFor.set(`${DOMAIN}${sitePathForFile(rel)}`, rel); }
  }
})(ROOT);

const gsc = read('data/search_intelligence/gsc_search_analytics_export.json', null);
const key = (u) => { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + (x.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/'); } catch { return ''; } };
const byPage = new Map(((gsc && gsc.by_page) || []).map((r) => [key(r.keys[0]), r]));
const coverage = read('data/search_intelligence/index_coverage.json', null);
const covBy = new Map(((coverage && coverage.urls) || []).map((r) => [r.url, r]));

const hubFiles = new Set(fs.readdirSync(path.join(ROOT, 'services')).filter((n) => n.endsWith('.html') && n !== 'index.html').map((n) => `/services/${n.replace(/\.html$/, '')}`));
const errors = [];
const rows = locs.map((loc) => {
  const rel = fileFor.get(loc);
  const route = new URL(loc).pathname;
  const html = rel ? fs.readFileSync(path.join(ROOT, rel), 'utf8') : '';
  const words = visibleText(html).split(' ').filter(Boolean).length;
  const g = byPage.get(key(loc));
  const cov = covBy.get(loc);
  let role = 'candidate';
  let fold = null;
  let rule = null;
  if (!rel) errors.push(`${loc}: no file on disk`);
  else if (ROOT_FILES.has(rel)) role = 'root';
  else if (rel.endsWith('/index.html')) role = 'section_index';
  else if (hubFiles.has(route)) role = 'hub';
  else {
    const hit = FOLD_RULES.find(([rx]) => rx.test(route));
    fold = hit[1];
    rule = String(hit[0]);
    if (!hubFiles.has(fold)) errors.push(`${loc}: fold target ${fold} is not a hub page on disk`);
  }
  return {
    url: loc,
    file: rel || null,
    role,
    impressions_28d: g ? Number(g.impressions) || 0 : 0,
    clicks_28d: g ? Number(g.clicks) || 0 : 0,
    word_count: words,
    coverage_state: cov ? cov.coverageState : 'NOT_IN_COVERAGE_FILE',
    fold_into_if_crawled_not_indexed: fold,
    fold_rule: rule
  };
});
if (!rows.length) errors.push('sitemap.xml lists 0 URLs');
if (errors.length) {
  console.error(`consolidation-candidates: FAIL (${errors.length})`);
  errors.slice(0, 15).forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
const candidates = rows.filter((r) => r.role === 'candidate');
const byHub = candidates.reduce((a, r) => ({ ...a, [r.fold_into_if_crawled_not_indexed]: (a[r.fold_into_if_crawled_not_indexed] || 0) + 1 }), {});
const doc = {
  schema_version: '1.0',
  status: 'LEDGER_ONLY_NO_REDIRECTS',
  decision_input_for: 'Fold thin pages into their hub where URL Inspection reports "Crawled - currently not indexed", once index_coverage.json holds 7 days of data.',
  gsc_window: gsc ? `${gsc.start_date}..${gsc.end_date}` : null,
  coverage_collected_at: coverage ? coverage.collected_at : null,
  url_count: rows.length,
  roles: rows.reduce((a, r) => ({ ...a, [r.role]: (a[r.role] || 0) + 1 }), {}),
  candidates_with_impressions: candidates.filter((r) => r.impressions_28d > 0).length,
  candidates_by_hub: Object.fromEntries(Object.entries(byHub).sort((a, b) => b[1] - a[1])),
  rows
};
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(doc, null, 2) + '\n');
console.log(`consolidation-candidates: ${rows.length} URLs (${JSON.stringify(doc.roles)}); ${candidates.length} fold candidates across ${Object.keys(byHub).length} hubs; ${doc.candidates_with_impressions} candidate(s) with impressions; no redirects written`);
