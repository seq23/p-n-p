#!/usr/bin/env node
'use strict';
/**
 * The engine's published pages join the reviewed kept ledger (7 Nov 2026).
 *
 * data/search_intelligence/page_quality_kept.json is the list every page validator holds the
 * sitemap to (sitemap == kept). The shared search engine publishes /questions/ pages straight
 * away (owner ruling 1 Nov 2026), each one through the engine's own quality gate, so it is
 * reviewed — but nothing wrote it into the ledger. The first real publish (6-7 Nov) put six
 * question URLs in sitemap.xml that the ledger lacked, and validate:no-placeholder-images
 * failed main ("only 42 pages scanned against 41 URLs") on every commit after.
 *
 * Adds every sitemap path under the engine's output dir (search-loop.config.json) to `kept`,
 * keeping order and adding nothing twice. Removes nothing. Idempotent. Run by
 * .github/scripts/search_loop_post_build.sh after the last build:sitemap.
 *   node scripts/keep_search_loop_pages.js [--check]   (--check: exit 1 if a path is missing)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KEPT = path.join(ROOT, 'data/search_intelligence/page_quality_kept.json');

function enginePaths(sitemapXml, dir) {
  const prefix = `/${String(dir).replace(/^\/+|\/+$/g, '')}/`;
  return [...String(sitemapXml).matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => { try { return new URL(m[1]).pathname; } catch { return null; } })
    .filter((p) => p && p.startsWith(prefix));
}

function withEnginePages(ledger, paths) {
  const kept = [...ledger.kept];
  const have = new Set(kept);
  const added = paths.filter((p) => !have.has(p) && have.add(p));
  return { ledger: { ...ledger, kept: [...kept, ...added] }, added };
}

module.exports = { enginePaths, withEnginePages };

if (require.main === module) {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'search-loop.config.json'), 'utf8'));
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const ledger = JSON.parse(fs.readFileSync(KEPT, 'utf8'));
  const { ledger: next, added } = withEnginePages(ledger, enginePaths(sitemap, cfg.output.dir));
  if (process.argv.includes('--check')) {
    if (added.length) { console.error(`NAMED STOP [ENGINE_PAGES_NOT_KEPT] ${added.join(', ')} are in sitemap.xml but not in the kept ledger: run node scripts/keep_search_loop_pages.js`); process.exit(1); }
    console.log('keep_search_loop_pages: every engine page in the sitemap is in the kept ledger');
  } else {
    if (added.length) fs.writeFileSync(KEPT, JSON.stringify(next, null, 2) + '\n');
    console.log(`keep_search_loop_pages: ${added.length} engine page(s) added to the kept ledger${added.length ? `: ${added.join(', ')}` : ''}`);
  }
}
