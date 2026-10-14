#!/usr/bin/env node
/**
 * Invoice prices in the /admin console cannot drift from the prices the public
 * site shows (data/rentals/games.json, data/offers/services.json).
 *
 * 1. functions/_lib/prices.mjs builds the table from exactly those two files.
 * 2. Prefilling invoices from fake requests gives the data-file prices: day and
 *    weekend rates, Pick 3 / Pick 5 / Whole Yard, delivery fee and its free-from
 *    threshold, the refundable damage deposit, the takedown add-on.
 * 3. The same requests priced from a PERTURBED table move by exactly the
 *    perturbation, so a price typed into the code instead of read from the
 *    table fails here even if it equals today's price.
 * 4. The walk-through checklist (functions/_lib/assets/walkthrough-checklist.html.txt)
 *    prints prices in its wording; they must equal the data files too.
 *
 * Rule 0: zero bundles or zero scenarios is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const games = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rentals/games.json'), 'utf8'));
const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8'));
const { buildPriceTable, prefillLines } = await import(pathToFileURL(path.join(ROOT, 'functions/_lib/pricing.mjs')).href);
const errors = [];

const pricesSrc = fs.readFileSync(path.join(ROOT, 'functions/_lib/prices.mjs'), 'utf8');
if (!/import games from '\.\.\/\.\.\/data\/rentals\/games\.json';/.test(pricesSrc)) errors.push('functions/_lib/prices.mjs does not import data/rentals/games.json');
if (!/import services from '\.\.\/\.\.\/data\/offers\/services\.json';/.test(pricesSrc)) errors.push('functions/_lib/prices.mjs does not import data/offers/services.json');
if (!/buildPriceTable\(games, services\)/.test(pricesSrc)) errors.push('functions/_lib/prices.mjs does not build the table from the two data files');

const bundles = games.bundles || [];
if (!bundles.length) errors.push('data/rentals/games.json lists 0 bundles');
const c = (d) => Math.round(d * 100);
const names = games.games.map((g) => g.name);

function scenarios(table, g, s) {
  const out = [];
  const bundleBy = (n) => g.bundles.find((b) => b.games === n);
  for (const b of g.bundles) {
    const req = { wantsRentals: true, gamesAnswer: names.slice(0, b.games).join(', '), durationAnswer: 'One day' };
    const lines = prefillLines(req, table);
    out.push([`${b.name} day bundle`, lines[0].unit_cents, c(b.dayPrice)]);
    const sub = c(b.dayPrice);
    const delivery = lines.find((l) => /^Delivery/.test(l.description));
    out.push([`${b.name} delivery`, delivery.unit_cents, sub >= c(g.delivery.freeOver) ? 0 : c(g.delivery.fee)]);
  }
  const one = prefillLines({ wantsRentals: true, gamesAnswer: names[0], durationAnswer: 'One day' }, table);
  out.push(['single game day rate', one[0].unit_cents, c(g.rates.day)]);
  out.push(['single game delivery fee', one.find((l) => /^Delivery/.test(l.description)).unit_cents, c(g.rates.day) >= c(g.delivery.freeOver) ? 0 : c(g.delivery.fee)]);
  out.push(['damage deposit', one.find((l) => l.refundable).unit_cents, c(g.damageDeposit)]);
  const wk = prefillLines({ wantsRentals: true, gamesAnswer: names.slice(0, 2).join(', '), durationAnswer: 'Weekend' }, table);
  out.push(['weekend rate', wk[0].unit_cents, c(g.rates.weekend)]);
  const decor = prefillLines({ wantsDecor: true, eventType: 'Birthday', takedownAnswer: 'Yes' }, table);
  out.push(['takedown add-on', decor.find((l) => l.description === 'Takedown').unit_cents, c(s.addOns.takedown.fromPrice)]);
  if (!bundleBy(3)) errors.push('no Pick 3 bundle in games.json');
  return out;
}

const live = scenarios(buildPriceTable(games, services), games, services);
const bump = (n) => n + 7;
const g2 = JSON.parse(JSON.stringify(games));
g2.rates.day = bump(g2.rates.day); g2.rates.weekend = bump(g2.rates.weekend);
g2.bundles.forEach((b) => { b.dayPrice = bump(b.dayPrice); });
g2.delivery.fee = bump(g2.delivery.fee); g2.delivery.freeOver = bump(g2.delivery.freeOver); g2.damageDeposit = bump(g2.damageDeposit);
const s2 = JSON.parse(JSON.stringify(services)); s2.addOns.takedown.fromPrice = bump(s2.addOns.takedown.fromPrice);
const perturbed = scenarios(buildPriceTable(g2, s2), g2, s2);
for (const [label, got, want] of [...live, ...perturbed.map(([l, g, w]) => [`${l} (perturbed table)`, g, w])]) {
  if (got !== want) errors.push(`${label}: invoice prefill gives ${got} cents, data files say ${want}`);
}
if (!live.length) errors.push('no price scenarios ran');

const checklist = fs.readFileSync(path.join(ROOT, 'functions/_lib/assets/walkthrough-checklist.html.txt'), 'utf8');
const pick = (n) => bundles.find((b) => b.games === n);
const expectInChecklist = [
  [`Day ($${games.rates.day} each) or weekend ($${games.rates.weekend} each)`, 'day / weekend rates'],
  [`×$${games.rates.day} day / ×$${games.rates.weekend} weekend`, 'quote worksheet game rates'],
  [`Pick 3 $${pick(3) && pick(3).dayPrice}`, 'Pick 3'],
  [`Pick 5 $${pick(5) && pick(5).dayPrice}`, 'Pick 5'],
  [`all ${pick(9) ? 9 : '?'} $${pick(9) && pick(9).dayPrice}`, 'Whole Yard'],
  [`delivery $${games.delivery.fee} flat, free on orders of $${games.delivery.freeOver} or more`, 'delivery'],
  [`Delivery ($${games.delivery.fee}, free over $${games.delivery.freeOver})`, 'worksheet delivery'],
  [`$${games.damageDeposit} damage deposit`, 'damage deposit'],
  [`Takedown starts at $${services.addOns.takedown.fromPrice}`, 'takedown'],
];
for (const [needle, what] of expectInChecklist) {
  if (!checklist.includes(needle.replace(/&/g, '&amp;'))) errors.push(`walk-through checklist ${what} wording drifted from the data files: expected "${needle}"`);
}

if (errors.length) {
  console.error('VALIDATION FAIL: admin invoice prices');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`Admin prices OK: ${live.length} invoice scenarios match the data files and track a perturbed table; ${expectInChecklist.length} checklist prices match.`);
