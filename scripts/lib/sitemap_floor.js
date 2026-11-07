'use strict';
/**
 * What sitemap.xml must submit, and where each URL comes from (7 Nov 2026).
 *
 * WHY
 * ---
 * Two writers own pages in sitemap.xml:
 *   1. the reviewed kept ledger, data/search_intelligence/page_quality_kept.json `kept`
 *      (hand-reviewed after the 26 Oct 2026 hub consolidation);
 *   2. the Search Loop (seq23/search-loop), which publishes question pages daily under
 *      search-loop.config.json `output.url_prefix` (/questions/) and records each one in its
 *      ledger, data/search-loop/pages.json `pages` (status "live").
 * The loop never writes the kept ledger, so validators that held sitemap.xml === kept went red on
 * the loop's first daily commit (06567b93). Every validator that checks the sitemap's size or
 * membership reads this module instead, so the floor follows both writers and nothing else.
 *
 * Rule 0 stays: an empty kept ledger fails, and a sitemap URL owned by neither writer fails by name.
 */
const fs = require('node:fs');
const path = require('node:path');

const DOMAIN = 'https://porchandparty901.com';
const KEPT = 'data/search_intelligence/page_quality_kept.json';
const LOOP_CONFIG = 'search-loop.config.json';
const LOOP_LEDGER = 'data/search-loop/pages.json';

const readJson = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const toPath = (loc) => loc.trim().replace(DOMAIN, '') || '/';

/** Routes the Search Loop ledger owns: its live pages under its own prefix, plus that prefix's index. */
function searchLoopRoutes({ ledger, config }) {
  const prefix = config && config.output && config.output.url_prefix;
  if (!prefix || !prefix.startsWith('/') || !prefix.endsWith('/') || prefix === '/') return [];
  const live = ((ledger && ledger.pages) || [])
    .filter((p) => p && p.status === 'live' && typeof p.route === 'string' && p.route.startsWith(prefix) && p.route !== prefix)
    .map((p) => p.route);
  return live.length ? [prefix, ...new Set(live)] : [];
}

/**
 * Pure check: compare sitemap locs against kept + search-loop routes.
 * Returns { expected, kept, loop, submitted, unaccounted, missing, duplicates, errors }.
 */
function accountSitemap({ locs, kept, ledger, config }) {
  const submitted = locs.map(toPath);
  const loop = searchLoopRoutes({ ledger, config });
  const expected = new Set([...(kept || []), ...loop]);
  const seen = new Set();
  const duplicates = submitted.filter((p) => (seen.has(p) ? true : (seen.add(p), false)));
  const unaccounted = [...seen].filter((p) => !expected.has(p));
  const missing = [...expected].filter((p) => !seen.has(p));
  const errors = [];
  if (!kept || !kept.length) errors.push(`Rule 0: the kept ledger ${KEPT} is empty`);
  if (!submitted.length) errors.push('Rule 0: sitemap.xml lists no URLs');
  if (duplicates.length) errors.push(`sitemap.xml lists ${duplicates.length} URL(s) twice: ${duplicates.slice(0, 8).join(', ')}`);
  if (unaccounted.length) errors.push(`sitemap.xml lists ${unaccounted.length} URL(s) in neither ${KEPT} nor the Search Loop ledger ${LOOP_LEDGER}: ${unaccounted.slice(0, 8).join(', ')}`);
  if (missing.length) errors.push(`sitemap.xml is missing ${missing.length} page(s) the kept ledger or the Search Loop ledger owns: ${missing.slice(0, 8).join(', ')}`);
  return { expected: [...expected], kept: kept || [], loop, submitted, unaccounted, missing, duplicates, errors };
}

/** Reads sitemap.xml, the kept ledger and the Search Loop ledger from `root`. */
function sitemapFloor(root = process.cwd()) {
  const xml = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const kept = readJson(root, KEPT).kept;
  const config = fs.existsSync(path.join(root, LOOP_CONFIG)) ? readJson(root, LOOP_CONFIG) : null;
  const ledger = fs.existsSync(path.join(root, LOOP_LEDGER)) ? readJson(root, LOOP_LEDGER) : null;
  return accountSitemap({ locs, kept, ledger, config });
}

/** Proves the check fails on a URL in neither list and passes on a clean one. Returns a list of failures. */
function selfTest() {
  const config = { output: { url_prefix: '/questions/' } };
  const ledger = { pages: [{ route: '/questions/a', status: 'live' }, { route: '/questions/b', status: 'dropped' }, { route: '/services/x', status: 'live' }] };
  const kept = ['/', '/about'];
  const loc = (p) => DOMAIN + p;
  const fails = [];
  const clean = accountSitemap({ locs: ['/', '/about', '/questions/', '/questions/a'].map(loc), kept, ledger, config });
  if (clean.errors.length) fails.push(`clean sitemap failed: ${clean.errors.join('; ')}`);
  const stray = accountSitemap({ locs: ['/', '/about', '/questions/', '/questions/a', '/stray'].map(loc), kept, ledger, config });
  if (!stray.errors.some((e) => e.includes('/stray'))) fails.push('a sitemap URL in neither list was not named');
  const notLive = accountSitemap({ locs: ['/', '/about', '/questions/', '/questions/a', '/questions/b'].map(loc), kept, ledger, config });
  if (!notLive.errors.some((e) => e.includes('/questions/b'))) fails.push('a non-live Search Loop page was accepted');
  const outside = accountSitemap({ locs: ['/', '/about', '/questions/', '/questions/a', '/services/x'].map(loc), kept, ledger, config });
  if (!outside.errors.some((e) => e.includes('/services/x'))) fails.push('a Search Loop page outside its prefix was accepted');
  const empty = accountSitemap({ locs: ['/'].map(loc), kept: [], ledger, config });
  if (!empty.errors.some((e) => e.startsWith('Rule 0'))) fails.push('an empty kept ledger passed');
  const gone = accountSitemap({ locs: ['/', '/questions/', '/questions/a'].map(loc), kept, ledger, config });
  if (!gone.errors.some((e) => e.includes('/about'))) fails.push('a kept page missing from the sitemap passed');
  return fails;
}

module.exports = { DOMAIN, KEPT, LOOP_LEDGER, accountSitemap, searchLoopRoutes, sitemapFloor, selfTest };
