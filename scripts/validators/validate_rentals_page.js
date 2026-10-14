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
 * 3. Pricing v2 (owner-approved 2026-10-14) is pinned; the Facebook Page copy,
 *    the llms files and every Marketplace listing quote it, carry no retired
 *    zone or game, and the Facebook copy is email only (no phone).
 *
 * 4. Renter safety (owner-approved 2026-10-14): the booking section and the
 *    llms rentals sections carry the photo-ID / social-link line and the
 *    three-minute, Google-sign-in form note from services.json renterSafety;
 *    the takedown add-on never appears here (rental pickup is included).
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

// Owner-approved pricing v2 (2026-10-14). A price change is an owner
// decision: change it here and in games.json together, never one alone.
const V2 = { day: 40, weekend: 60, bundles: { 'Pick 3': 110, 'Pick 5': 175, 'Whole Yard': 275 }, deliveryFee: 30, freeOver: 150, damageDeposit: 50, games: 9 };
const R = data.rates || {};
if (R.day !== V2.day || R.weekend !== V2.weekend) errors.push(`games.json rates are ${R.day}/${R.weekend}, owner-approved v2 is ${V2.day}/${V2.weekend}`);
if (data.games.length !== V2.games) errors.push(`games.json lists ${data.games.length} games, owner-approved line is ${V2.games}`);
for (const [name, price] of Object.entries(V2.bundles)) {
  const b = (data.bundles || []).find((x) => x.name === name);
  if (!b || b.dayPrice !== price) errors.push(`games.json bundle ${name} is not $${price}`);
}
if ((data.bundles || []).length !== Object.keys(V2.bundles).length) errors.push('games.json bundles differ from the owner-approved three');
const D = data.delivery || {};
if (D.fee !== V2.deliveryFee || D.freeOver !== V2.freeOver) errors.push(`games.json delivery is $${D.fee} (free over $${D.freeOver}), v2 is $${V2.deliveryFee} (free over $${V2.freeOver})`);
if (data.damageDeposit !== V2.damageDeposit) errors.push(`games.json damage deposit is not $${V2.damageDeposit}`);
if ('zones' in data || 'weekendMultiplier' in data) errors.push('games.json still carries the retired zones / weekend multiplier');

// Every game has its image; no image of a retired game is left behind.
const imgDir = path.join(ROOT, 'assets/rentals');
const slugs = new Set(data.games.map((g) => g.slug));
for (const g of data.games) if (!fs.existsSync(path.join(imgDir, `${g.slug}.webp`))) errors.push(`assets/rentals/${g.slug}.webp is missing`);
for (const f of fs.readdirSync(imgDir)) {
  const slug = f.replace(/(-alt)?\.webp$/, '');
  if (slug !== 'hero' && !slugs.has(slug)) errors.push(`assets/rentals/${f} belongs to no game in games.json`);
}

const money = (n) => `$${n}`;
const CONTACT = 'Porch & Party, Memphis\nWebsite: https://porchandparty901.com/rentals/\nEmail: hello@porchandparty901.com\nFacebook Page: https://www.facebook.com/porchandparty901\n';
const PHONE = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|call or text|\btext us\b/i;
const RETIRED = /\bzone\s*\d|\bZIP\b|38103|1\.5\s*(x|times)/i;
const pricesIn = (text, where) => {
  const need = [money(V2.day), `${money(V2.weekend)} for a weekend`, ...Object.values(V2.bundles).map(money), `${money(V2.deliveryFee)} flat`, `${money(V2.freeOver)} or more`, `${money(V2.damageDeposit)} damage deposit`];
  for (const n of need) if (!text.includes(n)) errors.push(`${where} does not quote ${n}`);
};

const listing = fs.readFileSync(path.join(ROOT, 'docs/listings/facebook-marketplace.md'), 'utf8');
const blocks = listing.split(/^## /m).slice(1);
if (blocks.length !== data.games.length) errors.push(`facebook-marketplace.md has ${blocks.length} listings, games.json has ${data.games.length}`);
if (PHONE.test(listing)) errors.push('facebook-marketplace.md carries a phone number or call/text line; Facebook copy is email only (owner ruling 2026-10-14)');
if (RETIRED.test(listing)) errors.push('facebook-marketplace.md still quotes the retired delivery zones or 1.5x weekend rate');
for (const g of data.games) {
  const b = blocks.find((x) => x.startsWith(`${g.name}\n`));
  if (!b) { errors.push(`facebook-marketplace.md has no listing for ${g.name}`); continue; }
  if (!b.includes(`**Price:** $${R.day} (per day)`)) errors.push(`${g.name}: Marketplace price is not the $${R.day} day rate`);
  if (!b.includes(`**Title:** ${g.name} rental – Memphis`)) errors.push(`${g.name}: Marketplace title is not "${g.name} rental – Memphis"`);
  if (!b.includes(`assets/rentals/${g.slug}.webp`)) errors.push(`${g.name}: Marketplace photo is not assets/rentals/${g.slug}.webp`);
  if (g.availableNow !== b.includes('AVAILABLE NOW')) errors.push(`${g.name}: Marketplace availability disagrees with games.json`);
  if (!b.trimEnd().endsWith(CONTACT.trimEnd())) errors.push(`${g.name}: Marketplace listing does not end with the email-only contact block`);
  pricesIn(b, `Marketplace listing ${g.name}`);
}

const page = fs.readFileSync(path.join(ROOT, 'docs/listings/facebook-page.md'), 'utf8');
if (PHONE.test(page)) errors.push('facebook-page.md carries a phone number or call/text line; Facebook copy is email only (owner ruling 2026-10-14)');
if (RETIRED.test(page)) errors.push('facebook-page.md still quotes the retired delivery zones or 1.5x weekend rate');
const bio = (page.match(/## About \(short bio[^\n]*\n([^\n]+)/) || [])[1] || '';
if (!bio.includes('hello@porchandparty901.com')) errors.push('facebook-page.md short bio does not carry the email');
if (bio.length > 255) errors.push(`facebook-page.md short bio is ${bio.length} characters, Facebook allows 255`);
for (const g of data.games) if (!page.toLowerCase().includes(g.name.replace(/ Set$/, '').toLowerCase())) errors.push(`facebook-page.md does not name ${g.name}`);
for (const n of [`${money(V2.day)} a day`, `${money(V2.weekend)} for a weekend`, ...Object.values(V2.bundles).map(money), money(V2.deliveryFee), `${money(V2.damageDeposit)} damage deposit`])
  if (!page.includes(n)) errors.push(`facebook-page.md does not quote ${n}`);

// The site keeps the phone; the rentals page and the llms files quote v2 and
// no retired zone or game.
if (onDisk) {
  if (RETIRED.test(onDisk.replace(/<script[\s\S]*?<\/script>/g, ''))) errors.push('rentals/index.html still quotes the retired delivery zones or 1.5x weekend rate');
  if (!onDisk.includes('901-355-1518')) errors.push('rentals/index.html lost the site phone 901-355-1518');
}
const SAFE = require(path.join(ROOT, 'data/offers/services.json')).renterSafety || {};
const SAFE_TEXT = `${SAFE.line} ${SAFE.rentalFormNote}`;
if (!/government photo ID/.test(SAFE.line || '') || !/three minutes/.test(SAFE.rentalFormNote || '') || !/Google sign-in/.test(SAFE.rentalFormNote || '')) errors.push('services.json renterSafety is not the owner-approved ID / three-minute Google sign-in copy');
if (onDisk) {
  const booking = (onDisk.split('id="how-booking-works"')[1] || '').split('</section>')[0];
  if (!booking.includes(SAFE_TEXT)) errors.push('rentals/index.html How Booking Works lacks the renter-safety line and form note');
  if (/takedown/i.test(onDisk)) errors.push('rentals/index.html mentions takedown; rental pickup is included, the add-on is porch and event decor only');
}
for (const f of ['llms.txt', 'llms-full.txt', 'llms-services.txt']) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const sec = (t.split('## Party game rentals')[1] || '').split(/\n## /)[0];
  if (!sec) { errors.push(`${f} has no Party game rentals section`); continue; }
  if (!sec.includes(SAFE_TEXT)) errors.push(`${f} rentals section lacks the renter-safety line and form note`);
  if (RETIRED.test(sec)) errors.push(`${f} rentals section still quotes the retired zones or 1.5x weekend rate`);
  for (const g of data.games) if (!sec.toLowerCase().includes(g.name.replace(/ Set$/, '').toLowerCase())) errors.push(`${f} rentals section does not name ${g.name}`);
  for (const n of [`${money(V2.day)} per game per day`, `${money(V2.weekend)} per game for a weekend`, ...Object.values(V2.bundles).map(money), `${money(V2.deliveryFee)} flat`, `${money(V2.damageDeposit)} damage deposit`])
    if (!sec.includes(n)) errors.push(`${f} rentals section does not quote ${n}`);
}
if (errors.length) { for (const e of errors) console.error(`rentals: ${e}`); process.exit(1); }
console.log(`rentals: OK - page matches a fresh render; v2 prices pinned; ${data.games.length} Marketplace listings, the Facebook Page copy and 3 llms files match games.json; renter-safety line on the page and in the llms files; Facebook copy email only`);
