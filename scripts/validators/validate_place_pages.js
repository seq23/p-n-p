#!/usr/bin/env node
'use strict';
/**
 * validate:place-pages (restored 10 Nov 2026, hostile review: the non-affiliation sentence only).
 * A page titled with a hotel's name reads as a page that hotel endorses unless it says otherwise,
 * and no hotel has endorsed anything. Every anchor (hotel) page, or the hub it was folded into,
 * must say in visible text "Porch & Party is not affiliated with <hotel>" (or "... with the hotels").
 * Rule 0: zero anchors fails. Self-test: the sentence removed must fail.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HC = require('../lib/hub_consolidation');
const G = require(path.join(ROOT, 'scripts/generators/build_place_pages.js'));

const errors = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Visible text only: the FAQPage JSON-LD repeats the sentence, so script bodies are dropped first.
const plain = (html) => String(html)
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ');
const notAffiliated = (name, text) => text.includes(`Porch & Party is not affiliated with ${name}`) || text.includes('Porch & Party is not affiliated with the hotels');

const { anchors } = G.places;
if (!anchors.length) { console.error('PLACE PAGES FAILED: 0 anchor (hotel) pages. Zero places covers nothing.'); process.exit(1); }

const pageOf = (place) => {
  const rel = `areas/${place.slug}-hotel-room-decor.html`;
  if (HC.isRetiredFile(rel)) return `${HC.foldTarget(`/areas/${place.slug}-hotel-room-decor`).to.slice(1)}.html`;
  return rel;
};
for (const place of anchors) {
  const rel = pageOf(place);
  if (!fs.existsSync(path.join(ROOT, rel))) { errors.push(`${rel}: missing (the page for ${place.name})`); continue; }
  if (!notAffiliated(place.name, plain(read(rel)))) errors.push(`${rel}: does not say "Porch & Party is not affiliated with ${place.name}". A page named after a hotel claims the hotel's blessing unless it says otherwise.`);
}
const probeText = plain(read(pageOf(anchors[0])));
const broken = probeText.split(`Porch & Party is not affiliated with ${anchors[0].name}`).join('X').split('Porch & Party is not affiliated with the hotels').join('X');
if (notAffiliated(anchors[0].name, broken)) errors.push('self-test: an anchor page without the non-affiliation sentence passed');

if (errors.length) { console.error(`place-pages: FAIL (${errors.length})`); errors.forEach((e) => console.error(`  - ${e}`)); process.exit(1); }
console.log(`place-pages: OK - ${anchors.length} hotel anchor page(s) each state Porch & Party is not affiliated with the hotel; self-test fails as it should`);
