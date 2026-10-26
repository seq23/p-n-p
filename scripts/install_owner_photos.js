#!/usr/bin/env node
'use strict';
/**
 * The owner's baby shower photos (owner ruling 21 Oct 2026: the shower + teddy pair "wherever
 * showers are mentioned") on the baby shower pages. The pictures are the registry entries in
 * data/offers/service_ai_images.json whose `pages` include "baby-shower" (owner-provided,
 * registered by sha1); rendered by the same no-caption gallery as the service pages
 * (scripts/lib/service_pages.js gallery).
 *
 * Writes one <!--owner-photos--> block per page, just before the related-pages block (or
 * </main>), and replaces it on a re-run, so a second run writes nothing. Runs after the page
 * generators in build:all; checked by scripts/validators/validate_service_pages.js.
 * Bridal shower pages are left alone: the photos are of a baby shower (BABY boxes, teddy).
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SP = require(path.join(ROOT, 'scripts/lib/service_pages.js'));

// The answers/ and events/ baby shower pages were folded into the baby shower hub on 26 Oct 2026
// (scripts/lib/hub_consolidation.js); the hub is the one baby shower page left, and it keeps the pair.
const HC = require('./lib/hub_consolidation');
const PAGES = ['services/baby-shower-decor-memphis.html', 'answers/baby-shower-decorations-memphis.html', 'events/baby-shower-decorations-memphis.html']
  .filter((rel) => !HC.isRetiredFile(rel));
if (!PAGES.length) throw new Error('install_owner_photos: zero baby shower pages left to carry the owner photos');
const KEY = 'baby-shower';
const BLOCK_RE = /<!--owner-photos-->[\s\S]*?<!--\/owner-photos-->/;
const RELATED_RE = /<section[^>]+data-nav="related-pages"/;

function block() {
  if (SP.imagesFor(KEY).length < 2) throw new Error(`install_owner_photos: fewer than 2 registered "${KEY}" photos`);
  return `<!--owner-photos--><section class="section" data-owner-photos="${KEY}"><div class="container">${SP.gallery(KEY)}</div></section><!--/owner-photos-->`;
}

function apply(html, rel) {
  const b = block();
  if (BLOCK_RE.test(html)) return html.replace(BLOCK_RE, () => b);
  const m = html.match(RELATED_RE);
  if (m) return html.replace(m[0], () => `${b}${m[0]}`);
  if (!html.includes('</main>')) throw new Error(`${rel}: no </main> to put the owner photos before`);
  return html.replace('</main>', () => `${b}</main>`);
}

function main() {
  let written = 0;
  for (const rel of PAGES) {
    const abs = path.join(ROOT, rel);
    const before = fs.readFileSync(abs, 'utf8');
    const after = apply(before, rel);
    if (after !== before) { fs.writeFileSync(abs, after); written += 1; }
  }
  console.log(`owner photos: ${PAGES.length} baby shower pages, ${written} file(s) written`);
}

module.exports = { PAGES, KEY, apply, block };
if (require.main === module) main();
