#!/usr/bin/env node
'use strict';
/**
 * The "Party game rentals" section of llms.txt, llms-services.txt and llms-full.txt, rendered
 * from data/rentals/games.json (rentals inventory, owner-approved 18 Oct 2026: Valerie edits the
 * items in /admin Settings -> Inventory and the Inventory Publish workflow re-runs this).
 *
 * Rewrites, in place and only these parts:
 *  - the "rents ... for backyard parties" phrase (from the extras on offer);
 *  - the block from "Prices (every game, flat):" through the "Bundles:" line (one line per
 *    available public item, then the bundles on offer, all-games bundles as
 *    "all games (available now: N)");
 *  - the llms.txt summary line "- Party game rentals (...) are $X per game per day; bundles from $Y."
 * Admin-only and removed items never appear. --check exits 1 when a file would change.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const INV = require(path.join(ROOT, 'scripts/lib/inventory.js'));

const FILES = ['llms.txt', 'llms-services.txt', 'llms-full.txt'];
const data = INV.resolve(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rentals/games.json'), 'utf8')));
const money = INV.money;

function priceBlock() {
  const lines = [`Prices (every game, flat): ${money(data.rates.day)} per game per day; ${money(data.rates.weekend)} per game for a weekend (pick up Friday, return Monday). No minimum order.`];
  for (const g of INV.publicGames(data)) lines.push(INV.llmsLine(data, g, 'games'));
  for (const x of INV.publicExtras(data)) lines.push(INV.llmsLine(data, x, 'extras'));
  lines.push('');
  const bundles = INV.offeredBundles(data).map((b) => `${b.name}: ${INV.lcFirst(b.includes)}, ${b.weekendPrice != null ? `${money(b.dayPrice)} a day or ${money(b.weekendPrice)} a weekend` : money(b.dayPrice)}`);
  lines.push(`Bundles: ${bundles.join('; ')}.`);
  return lines.join('\n');
}

function render(text) {
  let out = text.replace(/(Porch & Party rents )[^\n]*?( for backyard parties, birthdays)/, (m, a, b) => `${a}${INV.rentalsPhrase(data)}${b}`);
  out = out.replace(/^Prices \(every game, flat\):[\s\S]*?^Bundles:[^\n]*$/m, () => priceBlock());
  const from = Math.min(...INV.offeredBundles(data).map((b) => b.dayPrice));
  out = out.replace(/^- Party game rentals \([^\n]*\) are \$\d+ per game per day; bundles from \$\d+\.$/m,
    () => `- Party game rentals (${INV.rentalsPhrase(data, { short: true })}, pickup and return in Memphis) are ${money(data.rates.day)} per game per day; bundles from ${money(from)}.`);
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  let changed = 0;
  for (const f of FILES) {
    const abs = path.join(ROOT, f);
    const before = fs.readFileSync(abs, 'utf8');
    if (!/^Prices \(every game, flat\):/m.test(before)) throw new Error(`${f} has no "Prices (every game, flat):" rentals block to render`);
    const after = render(before);
    if (after !== before) { changed += 1; if (!check) fs.writeFileSync(abs, after); }
  }
  console.log(`llms rentals: ${changed} of ${FILES.length} files ${check ? 'would change' : 'written'}`);
  if (check && changed) process.exit(1);
}

module.exports = { render, priceBlock, FILES };
if (require.main === module) main();
