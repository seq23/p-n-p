#!/usr/bin/env node
'use strict';
/**
 * validate:faq-page (restored 10 Nov 2026, hostile review: prices and travel only).
 *   - every dollar amount on /faq/ is a price in services.json (tiers, travel fee, starting
 *     prices, takedown, food per head, delivery quick-add), porch_packages.json or games.json
 *     (rates, deposit, extras, bundles): a typed-in price fails;
 *   - the travel answer names every city in areas.json and the $75 (extendedFee) travel fee.
 * Hard-fails on a missing page or a page quoting no prices. Self-test: a typed-in price fails.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const games = require(path.join(ROOT, 'data/rentals/games.json'));
const porchPackages = require(path.join(ROOT, 'data/offers/porch_packages.json'));
const areas = require(path.join(ROOT, 'data/service_areas/areas.json'));

const errors = [];
const fail = (m) => errors.push(m);
const text = (s) => s.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function allowedPrices() {
  const S = offers.services;
  const n = new Set();
  const add = (v) => { if (v == null) return; const m = String(v).match(/\d[\d,]*/g); if (m) m.forEach((x) => n.add(Number(x.replace(/,/g, '')))); };
  for (const k of Object.keys(S)) { add(S[k].price); (S[k].tiers || []).forEach((t) => add(t.from)); }
  porchPackages.seasons.forEach((x) => Object.values(x.tiers).forEach((t) => add(t.from)));
  add(S.grazing.foodPerHead.low); add(S.grazing.foodPerHead.high);
  add(offers.addOns.takedown.fromPrice); add(offers.travel.extendedFee);
  add(offers.invoiceQuickAdds.deliveryFee);
  add(games.rates.day); add(games.rates.weekend); add(games.damageDeposit);
  (games.extras || []).forEach((x) => { add(x.dayPrice); add(x.weekendPrice); add(x.rates && x.rates.day); add(x.rates && x.rates.weekend); });
  (games.bundles || []).forEach((b) => { add(b.dayPrice); add(b.weekendPrice); });
  return n;
}

function checkFaqPage(html) {
  const t = text(html);
  const allowed = allowedPrices();
  const seen = new Set((t.match(/\$\d[\d,]*/g) || []).map((x) => Number(x.slice(1).replace(/,/g, ''))));
  for (const n of seen) if (!allowed.has(n)) fail(`faq/index.html quotes $${n}, which is not a price in services.json, porch_packages.json or games.json`);
  if (!seen.size) fail('faq/index.html quotes no prices at all');
  const cities = areas.areas.map((a) => a.split(',')[0]);
  if (!cities.length) fail('data/service_areas/areas.json lists no cities');
  for (const city of cities) if (!t.includes(city)) fail(`faq/index.html: travel answer does not name ${city}`);
  if (!t.includes(`$${offers.travel.extendedFee} travel fee`)) fail(`faq/index.html: no $${offers.travel.extendedFee} travel fee line`);
}

const faqPath = path.join(ROOT, 'faq/index.html');
if (!fs.existsSync(faqPath)) { console.error('validate_faq_page: FAIL - faq/index.html is missing'); process.exit(1); }
const html = read('faq/index.html');
checkFaqPage(html);
{
  const before = errors.length;
  checkFaqPage(html.replace('faq-section" id="party"', 'faq-section" id="party"><p>$999</p'));
  const caught = errors.length > before; errors.length = before;
  if (!caught) fail('self-test: a page with a typed-in $999 price passed');
}
if (errors.length) { console.error(`validate_faq_page: FAIL\n - ${errors.join('\n - ')}`); process.exit(1); }
console.log(`validate_faq_page: OK - every $ amount on /faq/ is a data price; the travel answer names ${areas.areas.length} cities and the $${offers.travel.extendedFee} fee`);
