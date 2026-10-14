#!/usr/bin/env node
'use strict';
/**
 * Guards the party game rentals line (owner-approved 2026-10-13).
 *
 * 1. rentals/index.html equals a fresh render of data/rentals/games.json, so
 *    the page cannot drift from the rates its Product/Offer JSON-LD declares.
 * 2. docs/listings/facebook-marketplace.md carries one listing per game with
 *    the same title, day rate and availability. That copy is pasted into
 *    Facebook by hand, so a rate changed in games.json without it would put
 *    two prices for one game in public.
 *
 * Read-only. Rule 0: zero games or zero listings is a failure, not a pass.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { finalHtml, data, OUT } = require(path.join(ROOT, 'scripts/generators/build_rentals_page.js'));

const errors = [];
if (!data.games.length) errors.push('data/rentals/games.json lists 0 games');
const onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
if (onDisk === null) errors.push('rentals/index.html is missing');
else if (onDisk !== finalHtml(onDisk)) errors.push('rentals/index.html differs from a fresh render: run npm run build:rentals');

const listing = fs.readFileSync(path.join(ROOT, 'docs/listings/facebook-marketplace.md'), 'utf8');
const blocks = listing.split(/^## /m).slice(1);
if (blocks.length !== data.games.length) errors.push(`facebook-marketplace.md has ${blocks.length} listings, games.json has ${data.games.length}`);
for (const g of data.games) {
  const b = blocks.find((x) => x.startsWith(`${g.name}\n`));
  if (!b) { errors.push(`facebook-marketplace.md has no listing for ${g.name}`); continue; }
  if (!b.includes(`**Price:** $${g.dayRate} (per day)`)) errors.push(`${g.name}: Marketplace price is not the $${g.dayRate} day rate`);
  if (!b.includes(`**Title:** ${g.name} rental – Memphis`)) errors.push(`${g.name}: Marketplace title is not "${g.name} rental – Memphis"`);
  if (g.availableNow !== b.includes('AVAILABLE NOW')) errors.push(`${g.name}: Marketplace availability disagrees with games.json`);
}
if (errors.length) { for (const e of errors) console.error(`rentals: ${e}`); process.exit(1); }
console.log(`rentals: OK - page matches a fresh render; ${data.games.length} Marketplace listings match games.json`);
