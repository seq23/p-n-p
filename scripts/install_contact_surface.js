#!/usr/bin/env node
'use strict';
/**
 * Retrofit pass: puts the phone (call or text) and the Google Business Profile
 * link on every published page, and telephone/hasMap/sameAs on every
 * LocalBusiness JSON-LD node. All markup and values come from
 * scripts/lib/contact_surface.js, which reads data/offers/services.json.
 *
 * It is a pass, like install_clarity.js, because pages here come from several
 * producers (page-shell, the root/answer retrofits, the section indexes) and
 * 98+ of them are frozen accepted outputs that are not re-rendered. The
 * producers emit the same blocks natively, so this pass is a no-op on a fresh
 * render and the generator's marker guard keeps a re-render from dropping it.
 *
 * Exits non-zero if any page has no place for a block (see applyContactSurface)
 * and if it found zero pages, so it can never succeed having done nothing.
 */
const fs = require('fs');
const path = require('path');
const { applyContactSurface } = require('./lib/contact_surface');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.pages-output', 'dist', 'scripts', 'data', 'reports',
  'artifacts', 'docs', 'tests', 'fixtures', 'config', 'content', 'templates']);

function publishedPages(dir = ROOT, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) publishedPages(abs, acc); continue; }
    if (e.name.endsWith('.html')) acc.push(path.relative(ROOT, abs).replace(/\\/g, '/'));
  }
  return acc.sort();
}

if (require.main === module) {
  const pages = publishedPages();
  if (!pages.length) { console.error('contact-surface: found 0 published pages'); process.exit(1); }
  let changed = 0;
  for (const rel of pages) {
    const abs = path.join(ROOT, rel);
    const html = fs.readFileSync(abs, 'utf8');
    const out = applyContactSurface(html, rel);
    if (out !== html) { fs.writeFileSync(abs, out); changed += 1; }
  }
  console.log(`contact-surface: ${pages.length} page(s) checked, ${changed} updated, ${pages.length - changed} already current`);
}

module.exports = { publishedPages };
