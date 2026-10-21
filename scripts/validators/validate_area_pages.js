#!/usr/bin/env node
'use strict';
/**
 * validate:area-pages - every served city has a page for every service (owner-approved
 * 21 Oct 2026), and each one is reachable, linked back and priced from the data files.
 *
 * For each city in data/service_areas/areas.json x each service in
 * scripts/generators/build_area_pages.js SERVICE_KEYS:
 *   - areas/<city>-<st>-<service>.html exists and is in sitemap.xml at its served URL;
 *   - areas/index.html links to it;
 *   - it links back to /areas/, to /request and to /pricing, and to the other three services
 *     in the same city (the <!--area-siblings--> block, with the "from" price from the data);
 *   - generated pages state the prices the data files hold: party game rentals the per-game day
 *     and weekend rate and every availableNow game (and no game that is not available now),
 *     plus the photo ID line; grazing every tier's from-price and the travel line; porch the
 *     lowest package price from data/offers/porch_packages.json and the takedown line;
 *   - the committed output equals a fresh run of the generator (no hand edits, no stale prices).
 * Hard-fails on zero cities or zero services.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const G = require(path.join(ROOT, 'scripts/generators/build_area_pages.js'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const INV = require(path.join(ROOT, 'scripts/lib/inventory.js'));
const rentals = INV.resolve(require(path.join(ROOT, 'data/rentals/games.json')));

const errors = [];
let checks = 0;
const ok = (cond, msg) => { checks += 1; if (!cond) errors.push(msg); };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&middot;/g, '·').replace(/&ndash;/g, '–').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const hrefs = (html) => new Set([...html.matchAll(/<a\b[^>]*?\bhref="([^"]+)"/gi)].map((m) => m[1]));

const cities = G.cities();
if (!cities.length || !G.SERVICE_KEYS.length) {
  console.error(`AREA PAGES FAILED: ${cities.length} cities x ${G.SERVICE_KEYS.length} services. Zero pages enforces nothing.`);
  process.exit(1);
}

const sitemap = read('sitemap.xml');
const index = read('areas/index.html');
const indexLinks = hrefs(index);
let pages = 0;

for (const city of cities) {
  for (const svc of G.SERVICE_KEYS) {
    const rel = G.relOf(city, svc);
    const url = G.urlOf(city, svc);
    if (!fs.existsSync(path.join(ROOT, rel))) { ok(false, `${rel}: missing (every city needs a ${svc} page)`); continue; }
    pages += 1;
    const html = read(rel);
    const links = hrefs(html);
    const text = plain(html);
    ok(sitemap.includes(`<loc>${offers.domain}${url}</loc>`), `${rel}: not in sitemap.xml as ${offers.domain}${url}`);
    ok(indexLinks.has(url), `${rel}: areas/index.html does not link ${url}`);
    ok(links.has('/areas/'), `${rel}: no link back to /areas/`);
    ok([...links].some((h) => h === '/request' || h.startsWith('/request?')), `${rel}: no link to /request`);
    ok(links.has('/pricing'), `${rel}: no link to /pricing`);
    ok((html.match(/<!--area-siblings-->/g) || []).length === 1, `${rel}: needs exactly one sibling-services block`);
    for (const other of G.SERVICE_KEYS) {
      if (other === svc) continue;
      ok(links.has(G.urlOf(city, other)), `${rel}: does not link its sibling ${G.urlOf(city, other)}`);
    }
    for (const s of G.SERVICE_KEYS) ok(text.includes(G.FROM[s]), `${rel}: sibling block does not state "${G.FROM[s]}" for ${s}`);
    if (G.LEGACY.has(G.slugOf(city, svc))) continue;

    ok(new RegExp(`<link rel="canonical" href="${offers.domain}${url}"`).test(html), `${rel}: canonical is not ${offers.domain}${url}`);
    ok(text.includes(city.name), `${rel}: never names ${city.name}`);
    if (svc === 'party-game-rentals') {
      ok(text.includes(`$${rentals.rates.day} a game per day`) || text.includes(`$${rentals.rates.day} a day`), `${rel}: does not state the $${rentals.rates.day} day rate from games.json`);
      ok(text.includes(`$${rentals.rates.weekend}`), `${rel}: does not state the $${rentals.rates.weekend} weekend rate from games.json`);
      for (const g of INV.publicGames(rentals)) ok(text.includes(g.name) && html.includes(`/assets/rentals/${g.slug}.webp`), `${rel}: available game ${g.name} missing (name or photo)`);
      for (const g of (rentals.games || []).filter((x) => !x.availableNow)) ok(!text.includes(g.name), `${rel}: names ${g.name}, which is not available now`);
      ok(text.includes(offers.renterSafety.line), `${rel}: missing the photo ID line from services.json renterSafety`);
      ok(text.includes(rentals.pickup.place) && !/\bwe deliver\b|\bdelivery to your\b/i.test(text), `${rel}: must say pickup at ${rentals.pickup.place} and promise no delivery`);
    } else if (svc === 'grazing-tables') {
      for (const t of offers.services.grazing.tiers) ok(text.includes(`$${t.from}`), `${rel}: grazing tier ${t.name} $${t.from} missing`);
      ok(text.includes(offers.travel.line), `${rel}: missing the travel line from services.json`);
    } else if (svc === 'porch-decorating') {
      ok(text.includes(`$${G.porchFrom}`), `${rel}: porch from-price $${G.porchFrom} missing`);
      ok(text.includes(offers.addOns.takedown.line), `${rel}: missing the takedown line`);
      ok(text.includes(offers.travel.line), `${rel}: missing the travel line from services.json`);
    }
    for (const bad of [/\binsured\b/i, /\breviews?\b/i, /\btestimonial/i, /\b\d(\.\d)? stars?\b/i, /leave us a review/i]) ok(!bad.test(text), `${rel}: says ${bad} (no invented reviews, stats, testimonials or insured claim)`);
    ok(!/placeholder|data:image/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), `${rel}: placeholder image`);
  }
}

// The committed pages must be exactly what the generator produces (new pages are then
// re-touched by the post-generation passes, so compare the generator-owned regions only).
for (const w of G.plan()) {
  if (!w.rel.startsWith('areas/')) { ok(w.before === w.after, `${w.rel}: area-pages section is stale; run node scripts/generators/build_area_pages.js`); continue; }
  const sib = (s) => (s || '').match(/<!--area-siblings-->[\s\S]*?<!--\/area-siblings-->/);
  ok(sib(w.before) && sib(w.after) && sib(w.before)[0] === sib(w.after)[0], `${w.rel}: sibling block is stale; run node scripts/generators/build_area_pages.js`);
  const main = (s) => ((s || '').match(/<section class="section section-soft"><div class="container content-grid">[\s\S]*?<\/section>/) || [''])[0];
  ok(main(w.before) === main(w.after), `${w.rel}: page body differs from the generator; run node scripts/generators/build_area_pages.js`);
}

const expected = cities.length * G.SERVICE_KEYS.length;
ok(pages === expected, `found ${pages} of ${expected} city x service pages`);
if (errors.length) {
  console.error(`AREA PAGES FAILED (${errors.length} of ${checks} checks)`);
  for (const e of errors.slice(0, 40)) console.error(` - ${e}`);
  process.exit(1);
}
console.log(`Area pages OK: ${pages} city x service pages (${cities.length} cities x ${G.SERVICE_KEYS.length} services), ${checks} checks`);
