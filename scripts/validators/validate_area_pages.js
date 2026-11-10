#!/usr/bin/env node
'use strict';
/**
 * validate:area-pages (restored 10 Nov 2026, hostile review: prices and generator currency only).
 * For each served city x service page that is still published (data/service_areas/areas.json x
 * scripts/generators/build_area_pages.js SERVICE_KEYS):
 *   - the sibling block states every service's "from" price from the data (G.FROM);
 *   - generated pages state the data-file prices: party game rentals the day and weekend rate
 *     from games.json; grazing every tier's from-price; porch the lowest package price;
 *   - the committed output equals a fresh run of the generator (no hand edits, no stale prices).
 * Hard-fails on zero cities or services, or on zero pages and zero generator outputs examined.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HC = require('../lib/hub_consolidation');
const G = require(path.join(ROOT, 'scripts/generators/build_area_pages.js'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const INV = require(path.join(ROOT, 'scripts/lib/inventory.js'));
const rentals = INV.resolve(require(path.join(ROOT, 'data/rentals/games.json')));

const errors = [];
let checks = 0;
const ok = (cond, msg) => { checks += 1; if (!cond) errors.push(msg); };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/&ndash;/g, '–').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

const cities = G.cities();
if (!cities.length || !G.SERVICE_KEYS.length) {
  console.error(`AREA PAGES FAILED: ${cities.length} cities x ${G.SERVICE_KEYS.length} services. Zero pages enforces nothing.`);
  process.exit(1);
}

let pages = 0;
for (const city of cities) {
  for (const svc of G.SERVICE_KEYS) {
    const rel = G.relOf(city, svc);
    if (HC.isRetiredFile(rel) || !fs.existsSync(path.join(ROOT, rel))) continue;
    pages += 1;
    const text = plain(read(rel));
    for (const s of G.SERVICE_KEYS) ok(text.includes(G.FROM[s]), `${rel}: sibling block does not state "${G.FROM[s]}" for ${s}`);
    if (G.LEGACY.has(G.slugOf(city, svc))) continue;
    if (svc === 'party-game-rentals') {
      ok(text.includes(`$${rentals.rates.day} a game per day`) || text.includes(`$${rentals.rates.day} a day`), `${rel}: does not state the $${rentals.rates.day} day rate from games.json`);
      ok(text.includes(`$${rentals.rates.weekend}`), `${rel}: does not state the $${rentals.rates.weekend} weekend rate from games.json`);
    } else if (svc === 'grazing-tables') {
      for (const t of offers.services.grazing.tiers) ok(text.includes(`$${t.from}`), `${rel}: grazing tier ${t.name} $${t.from} missing`);
    } else if (svc === 'porch-decorating') {
      ok(text.includes(`$${G.porchFrom}`), `${rel}: porch from-price $${G.porchFrom} missing`);
    }
  }
}
// Every city x service page may be folded into its hub (scripts/lib/hub_consolidation.js); then the
// price rows cover zero pages and the generator-currency rows below are what remains, so Rule 0 is
// on the two together.
const planned = G.plan();
if (!pages && !planned.length) { console.error('AREA PAGES FAILED: zero published area pages and zero generator outputs examined; the read is broken, not the site.'); process.exit(1); }

// The committed pages must be exactly what the generator produces (new pages are then
// re-touched by the post-generation passes, so compare the generator-owned regions only).
for (const w of planned) {
  if (!w.rel.startsWith('areas/')) { ok(w.before === w.after, `${w.rel}: area-pages section is stale; run node scripts/generators/build_area_pages.js`); continue; }
  const sib = (s) => (s || '').match(/<!--area-siblings-->[\s\S]*?<!--\/area-siblings-->/);
  ok(sib(w.before) && sib(w.after) && sib(w.before)[0] === sib(w.after)[0], `${w.rel}: sibling block is stale; run node scripts/generators/build_area_pages.js`);
  const main = (s) => ((s || '').match(/<section class="section section-soft"><div class="container content-grid">[\s\S]*?<\/section>/) || [''])[0];
  ok(main(w.before) === main(w.after), `${w.rel}: page body differs from the generator; run node scripts/generators/build_area_pages.js`);
}

if (errors.length) {
  console.error(`AREA PAGES FAILED (${errors.length} of ${checks} checks)`);
  for (const e of errors.slice(0, 40)) console.error(` - ${e}`);
  process.exit(1);
}
console.log(`Area pages OK: ${pages} published city x service page(s) state the data prices; ${planned.length} generator output(s) match a fresh run; ${checks} checks`);
