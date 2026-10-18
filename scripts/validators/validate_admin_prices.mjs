#!/usr/bin/env node
/**
 * Invoice prices in the /admin console cannot drift from the prices the public
 * site shows (data/rentals/games.json, data/offers/services.json).
 *
 * 1. functions/_lib/prices.mjs builds the table from exactly those two files.
 * 2. The quote form contract (rentals v3, owner-approved 2026-10-15): the 14
 *    "Which games?" strings and 2 "How long?" strings below are the ones the
 *    rebuilt Google Form uses. docs/admin-console.md lists exactly them,
 *    games.json carries exactly them as formChoice on available items and
 *    bundles, and prefilling an invoice from each one alone gives the price
 *    games.json says (day, and weekend; The Whole Party has its own weekend
 *    price). A hidden item (availableNow:false) is never priced.
 * 3. Never a delivery line; the refundable damage deposit is on every rental
 *    invoice; the takedown add-on keeps its data price; rental invoices carry
 *    the pickup line, decor-only invoices do not.
 * 4. The same requests priced from a PERTURBED table move by exactly the
 *    perturbation, so a price typed into the code instead of read from the
 *    table fails here even if it equals today's price.
 * 5. The walk-through checklist (functions/_lib/assets/walkthrough-checklist.html.txt)
 *    prints prices in its wording; every one must equal the data files, it must
 *    name every available item and no hidden one, and say no delivery fee.
 *
 * Rule 0: zero items, zero bundles or zero scenarios is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const games = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rentals/games.json'), 'utf8'));
const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8'));
const { buildPriceTable, prefillLines, isRentalInvoice, pickupNote } = await import(pathToFileURL(path.join(ROOT, 'functions/_lib/pricing.mjs')).href);
const errors = [];

const pricesSrc = fs.readFileSync(path.join(ROOT, 'functions/_lib/prices.mjs'), 'utf8');
if (!/import games from '\.\.\/\.\.\/data\/rentals\/games\.json';/.test(pricesSrc)) errors.push('functions/_lib/prices.mjs does not import data/rentals/games.json');
if (!/import services from '\.\.\/\.\.\/data\/offers\/services\.json';/.test(pricesSrc)) errors.push('functions/_lib/prices.mjs does not import data/offers/services.json');
if (!/buildPriceTable\(games, services, porchPackages\)/.test(pricesSrc) || !/import porchPackages from '\.\.\/\.\.\/data\/offers\/porch_packages\.json'/.test(pricesSrc)) errors.push('functions/_lib/prices.mjs does not build the table from the three data files (games, services, porch packages)');

// ---- 2. The quote form contract ---------------------------------------------
const CONTRACT_GAMES = ['Giant Connect Four', 'Cornhole set', 'Giant Color Stack', 'Giant Uno', 'Grab the Mic',
  'Inflatable movie screen', 'Card table with cup holders', 'Pick 3 bundle ($110)', 'Pick 5 bundle ($175)', 'Whole Yard, all 6 games ($195)',
  'Movie Night, screen + 2 games ($110)', 'Game Night, card table + 2 games ($85)', 'The Whole Party, all 8 items ($235 day / $350 weekend)'];
const CONTRACT_HOW_LONG = ['One day (24 hours)', 'Weekend (Friday pickup, Monday return)'];
const DAY = CONTRACT_HOW_LONG[0]; const WEEKEND = CONTRACT_HOW_LONG[1];

const shown = [...games.games, ...(games.extras || [])].filter((i) => i.availableNow);
const hidden = [...games.games, ...(games.extras || [])].filter((i) => !i.availableNow);
const bundles = games.bundles || [];
if (!shown.length) errors.push('data/rentals/games.json lists 0 available items');
if (!bundles.length) errors.push('data/rentals/games.json lists 0 bundles');
if (bundles.length !== 6) errors.push(`data/rentals/games.json lists ${bundles.length} bundles; rentals v3 is 6`);
const dataChoices = [...shown.map((i) => i.formChoice), ...bundles.map((b) => b.formChoice)];
if (JSON.stringify([...dataChoices].sort()) !== JSON.stringify([...CONTRACT_GAMES].sort())) errors.push(`games.json formChoice strings differ from the quote form contract: ${JSON.stringify(dataChoices)}`);
for (const h of hidden) if (h.formChoice) errors.push(`hidden item ${h.slug} still carries a formChoice; it would reach the form contract`);

const doc = fs.readFileSync(path.join(ROOT, 'docs/admin-console.md'), 'utf8');
const docSec = (doc.split('## Quote form contract')[1] || '').split(/\n## /)[0];
const docList = [...docSec.matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]);
if (JSON.stringify(docList) !== JSON.stringify([...CONTRACT_GAMES, ...CONTRACT_HOW_LONG])) errors.push('docs/admin-console.md "Quote form contract" does not list exactly the 14 + 2 contract strings, in order');
for (const h of hidden) if (docSec.toLowerCase().includes(h.name.toLowerCase())) errors.push(`docs/admin-console.md form contract names hidden item ${h.name}`);

// ---- 3/4. Prefill scenarios, on the live and a perturbed table --------------
const c = (d) => Math.round(d * 100);
const sumRental = (lines) => lines.filter((l) => !l.refundable && l.description !== 'Takedown').reduce((s, l) => s + Math.round(l.qty * l.unit_cents), 0);

function scenarios(table, g, s) {
  const out = [];
  const itemDay = (i) => (i.dayPrice != null ? i.dayPrice : g.rates.day);
  const itemWk = (i) => (i.weekendPrice != null ? i.weekendPrice : g.rates.weekend);
  const avail = [...g.games, ...(g.extras || [])].filter((i) => i.availableNow);
  const run = (answer, howLong, label) => {
    const lines = prefillLines({ wantsRentals: true, gamesAnswer: answer, durationAnswer: howLong }, table);
    if (lines.some((l) => /deliver/i.test(l.description) || /deliver/i.test(l.note))) errors.push(`${label}: prefill has a delivery line`);
    const dep = lines.filter((l) => l.refundable);
    if (dep.length !== 1 || dep[0].unit_cents !== c(g.damageDeposit)) errors.push(`${label}: prefill lacks the one refundable $${g.damageDeposit} damage deposit`);
    if (!isRentalInvoice(lines, table)) errors.push(`${label}: prefill is not recognised as a rental invoice`);
    if (pickupNote(lines, table) !== table.pickupLine) errors.push(`${label}: rental invoice does not carry the pickup line`);
    if (lines.some((l) => /^Game rental \(/.test(l.description))) errors.push(`${label}: "${answer}" was not matched (fell back to "Game rental")`);
    return lines;
  };
  for (const i of avail) {
    out.push([`${i.formChoice} day`, sumRental(run(i.formChoice, DAY, i.formChoice)), c(itemDay(i))]);
    out.push([`${i.formChoice} weekend`, sumRental(run(i.formChoice, WEEKEND, i.formChoice)), c(itemWk(i))]);
  }
  for (const b of g.bundles) {
    const lines = run(b.formChoice, DAY, b.formChoice);
    out.push([`${b.formChoice} day`, sumRental(lines), c(b.dayPrice)]);
    if (!lines[0].description.startsWith(`${b.name} bundle`)) errors.push(`${b.formChoice}: first line is "${lines[0].description}", not the ${b.name} bundle`);
    // Weekend: only a bundle with a weekendPrice has one; any other bundle's slots go at weekend rates.
    const slotsWk = b.games * g.rates.weekend + b.items.reduce((t, slug) => t + itemWk(avail.find((i) => i.slug === slug)), 0);
    out.push([`${b.formChoice} weekend`, sumRental(run(b.formChoice, WEEKEND, `${b.formChoice} weekend`)), c(b.weekendPrice != null ? b.weekendPrice : slotsWk)]);
  }
  const everything = avail.map((i) => i.formChoice).join(', ');
  // Owner, 18 Oct 2026: a game with bundleSets 2 (Giant Color Stack) fills two slots of an all-games bundle.
  const slotsAll = avail.reduce((n, i) => n + (g.games.includes(i) ? (i.bundleSets || 1) : 1), 0);
  const all = g.bundles.find((b) => b.games + b.items.length === slotsAll);
  if (!all) errors.push('no bundle covers every available item');
  else {
    out.push(['all items ticked, day', sumRental(run(everything, DAY, 'all items day')), c(all.dayPrice)]);
    out.push(['all items ticked, weekend', sumRental(run(everything, WEEKEND, 'all items weekend')), c(all.weekendPrice)]);
  }
  const pick3 = g.bundles.find((b) => b.games === 3 && !b.items.length);
  const gameChoices = g.games.filter((x) => x.availableNow).map((x) => x.formChoice);
  if (pick3) out.push(['three named games, day', sumRental(run(gameChoices.slice(0, 3).join(', '), DAY, 'three games')), c(pick3.dayPrice)]);
  const decor = prefillLines({ wantsDecor: true, eventType: 'Birthday', takedownAnswer: 'Yes' }, table);
  out.push(['takedown add-on', (decor.find((l) => l.description === 'Takedown') || {}).unit_cents, c(s.addOns.takedown.fromPrice)]);
  if (isRentalInvoice(decor, table) || pickupNote(decor, table)) errors.push('a decor-only invoice is treated as a rental invoice');
  for (const h of hidden) {
    const lines = prefillLines({ wantsRentals: true, gamesAnswer: h.name, durationAnswer: DAY }, table);
    if (lines.some((l) => l.description.startsWith(h.name))) errors.push(`hidden item ${h.name} is priced by the prefill`);
  }
  return out;
}

const table = buildPriceTable(games, services);
const P = games.pickup || {};
const PICKUP_LINE = 'Pay the rest at pickup. Text or call 901-355-1518 to set your pickup time at Mt. Moriah Station.';
if (table.pickupLine !== PICKUP_LINE) errors.push(`pickup line is "${table.pickupLine}", owner-approved is "${PICKUP_LINE}"`);
if (P.phone !== '901-355-1518' || P.address !== '2602 Mt. Moriah Rd, Memphis, TN 38115') errors.push('games.json pickup is not Mt. Moriah Station, 2602 Mt. Moriah Rd, 901-355-1518');
if ('delivery' in games) errors.push('games.json still carries a delivery block; rentals v3 has no delivery');
if (table.items.length !== shown.length) errors.push(`price table has ${table.items.length} items, games.json shows ${shown.length}`);

const live = scenarios(table, games, services);
const bump = (n) => n + 7;
const g2 = JSON.parse(JSON.stringify(games));
g2.rates.day = bump(g2.rates.day); g2.rates.weekend = bump(g2.rates.weekend);
(g2.extras || []).forEach((x) => { x.dayPrice = bump(x.dayPrice); x.weekendPrice = bump(x.weekendPrice); });
g2.bundles.forEach((b) => { b.dayPrice = bump(b.dayPrice); if (b.weekendPrice != null) b.weekendPrice = bump(b.weekendPrice); });
g2.damageDeposit = bump(g2.damageDeposit);
const s2 = JSON.parse(JSON.stringify(services)); s2.addOns.takedown.fromPrice = bump(s2.addOns.takedown.fromPrice);
const perturbed = scenarios(buildPriceTable(g2, s2), g2, s2);
for (const [label, got, want] of [...live, ...perturbed.map(([l, g, w]) => [`${l} (perturbed table)`, g, w])]) {
  if (got !== want) errors.push(`${label}: invoice prefill gives ${got} cents, data files say ${want}`);
}
if (!live.length) errors.push('no price scenarios ran');

// ---- 5. The checklist's printed prices --------------------------------------
const checklist = fs.readFileSync(path.join(ROOT, 'functions/_lib/assets/walkthrough-checklist.html.txt'), 'utf8');
const page4 = checklist.split('<!-- PAGE 4')[1] || '';
const ex = Object.fromEntries((games.extras || []).map((x) => [x.slug, x]));
const bb = Object.fromEntries(bundles.map((b) => [b.slug, b]));
const expectInChecklist = [
  [`Day ($${games.rates.day} each) or weekend ($${games.rates.weekend} each)`, 'day / weekend rates'],
  [`×$${games.rates.day} day / ×$${games.rates.weekend} weekend`, 'quote worksheet game rates'],
  [`screen $${ex['inflatable-movie-screen'].dayPrice} / $${ex['inflatable-movie-screen'].weekendPrice}`, 'worksheet movie screen'],
  [`card table $${ex['card-table'].dayPrice} / $${ex['card-table'].weekendPrice}`, 'worksheet card table'],
  [`Pick 3 $${bb['pick-3'].dayPrice}`, 'Pick 3'],
  [`Pick 5 $${bb['pick-5'].dayPrice}`, 'Pick 5'],
  [`Whole Yard $${bb['whole-yard'].dayPrice}`, 'Whole Yard'],
  [`Movie Night $${bb['movie-night'].dayPrice}`, 'Movie Night'],
  [`Game Night $${bb['game-night'].dayPrice}`, 'Game Night'],
  [`Whole Party $${bb['whole-party'].dayPrice} / $${bb['whole-party'].weekendPrice} weekend`, 'The Whole Party'],
  [`$${games.damageDeposit} damage deposit + ${games.holdPercent}% holds the date`, 'damage deposit + hold'],
  [`Takedown starts at $${services.addOns.takedown.fromPrice}`, 'takedown'],
];
for (const [needle, what] of expectInChecklist) {
  if (!checklist.includes(needle.replace(/&/g, '&amp;'))) errors.push(`walk-through checklist ${what} wording drifted from the data files: expected "${needle}"`);
}
// Every $ amount on the rentals page of the checklist is one of the data prices.
const known = new Set([games.rates.day, games.rates.weekend, games.damageDeposit, services.addOns.takedown.fromPrice, 5,
  ...(games.extras || []).flatMap((x) => [x.dayPrice, x.weekendPrice]), ...bundles.flatMap((b) => [b.dayPrice, b.weekendPrice]).filter((n) => n != null),
  ...Object.values(services.services || {}).map((v) => Number(String(v.price || '').replace(/[^0-9]/g, ''))).filter(Boolean)]);
const rentalsBlock = (page4.split('<h2>Quote worksheet')[0] || '') + ((page4.match(/<tr><td>Rentals \([^<]*<\/td>/) || [''])[0]);
const amounts = [...rentalsBlock.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
if (!amounts.length) errors.push('checklist rentals page quotes 0 prices');
for (const n of amounts) if (!known.has(n)) errors.push(`checklist rentals page quotes $${n}, which is not a price in games.json`);
if (/deliver/i.test(checklist.replace(/\bno delivery\b/gi, ''))) errors.push('walk-through checklist mentions delivery; rentals v3 is pickup and return only');
for (const i of shown) if (!page4.toLowerCase().includes((i.formChoice || i.name).replace(/ set$/i, '').toLowerCase())) errors.push(`checklist rentals page does not list ${i.name}`);
for (const h of hidden) if (page4.toLowerCase().includes(h.name.toLowerCase())) errors.push(`checklist rentals page lists hidden item ${h.name}`);
for (const step of ['Payment confirmed before leaving', 'Photo ID matches the invoice name', 'Photo of the loaded car', 'Return check', 'Damage deposit refunded the same day']) {
  if (!page4.includes(step)) errors.push(`checklist meet-up steps lack "${step}"`);
}

// ---- Both Giant Color Stack sets in an all-games bundle (owner, 18 Oct 2026) ----------------
{
  const T = buildPriceTable(games, services);
  if (T.gameSlots !== 6 || T.gameNames.length !== 5 || T.gameNames.includes('Giant Checkers')) errors.push(`price table counts ${T.gameSlots} bundle games over ${T.gameNames.length} kinds; want 6 over 5, no Giant Checkers`);
  const allChoices = T.items.filter((i) => i.kind === 'game').map((i) => i.choice).join(', ');
  const wy = prefillLines({ wantsRentals: true, gamesAnswer: 'Whole Yard, all 6 games ($195)', durationAnswer: DAY }, T);
  if (!/^Whole Yard bundle, 1 day: .*Giant Color Stack \(2 sets\)/.test(wy[0].description) || wy[0].unit_cents !== 19500) errors.push(`a Whole Yard ask does not invoice both Color Stack sets at $195: "${wy[0].description}"`);
  const five = prefillLines({ wantsRentals: true, gamesAnswer: allChoices, durationAnswer: DAY }, T);
  if (!five[0].description.startsWith('Pick 5 bundle') || five[0].unit_cents !== 17500 || /2 sets/.test(five[0].description)) errors.push(`all five games ticked (one each) is not the cheaper Pick 5: "${five[0].description}"`);
  const party = prefillLines({ wantsRentals: true, gamesAnswer: `${allChoices}, Inflatable movie screen, Card table with cup holders`, durationAnswer: DAY }, T);
  if (!/^The Whole Party bundle, 1 day: .*Giant Color Stack \(2 sets\)/.test(party[0].description) || party[0].unit_cents !== 23500) errors.push(`every item ticked is not The Whole Party with both Color Stack sets: "${party[0].description}"`);
}

if (errors.length) {
  console.error('VALIDATION FAIL: admin invoice prices');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`Admin prices OK: ${live.length} invoice scenarios match the data files and track a perturbed table; ${CONTRACT_GAMES.length} + ${CONTRACT_HOW_LONG.length} form contract strings mapped; no delivery line; ${expectInChecklist.length} checklist prices + ${amounts.length} printed amounts match.`);
