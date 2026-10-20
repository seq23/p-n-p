#!/usr/bin/env node
'use strict';
/**
 * Guards the party game rentals line (owner-approved 2026-10-13; pricing v2
 * 2026-10-14; rentals v3 2026-10-15: no delivery, pickup and return at
 * Mt. Moriah Station, six bundles, a movie screen and a card table).
 *
 * 1. rentals/index.html equals a fresh render of data/rentals/games.json, so
 *    the page cannot drift from the rates its JSON-LD declares.
 * 2. The v3 prices are pinned (an owner decision: change them here and in
 *    games.json together), and every price on the page, in its schema, in the
 *    Facebook copy and in the llms rentals sections is a games.json price.
 * 3. docs/listings/facebook-marketplace.md carries one listing per available
 *    item and per bundle (8 + 6), each with its data price, includes, saving,
 *    the pickup rule, the deposit + 50% rule and ID at hand-off, email only.
 * 4. No delivery anywhere in the rentals context: the page, the listings, the
 *    llms rentals sections, the homepage and services index rentals copy, the
 *    contact page form note. ("No delivery" as a plain negation is allowed in
 *    the llms files.)
 * 5. Items with availableNow:false appear nowhere: not on the page, its schema,
 *    the listings, the Facebook Page copy or the llms rentals sections.
 * 6. Renter safety (2026-10-14): the booking section and the llms rentals
 *    sections carry the photo-ID line and the form note; no takedown here.
 *
 * 7. Request page (2026-10-18): every live Marketplace description's line 2 and
 *    the Page bio and action button point at porchandparty901.com/request.
 *
 * Read-only. Rule 0: zero items, zero bundles or zero listings is a failure.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { finalHtml, data, OUT, ITEMS, BUNDLES, bundleValue } = require(path.join(ROOT, 'scripts/generators/build_rentals_page.js'));

const errors = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
if (!ITEMS.length) errors.push('data/rentals/games.json shows 0 items');
if (!BUNDLES.length) errors.push('data/rentals/games.json lists 0 bundles');
const onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
if (onDisk === null) errors.push('rentals/index.html is missing');
else if (onDisk !== finalHtml(onDisk)) errors.push('rentals/index.html differs from a fresh render: run node scripts/generators/build_rentals_page.js');

// ---- The inventory (Settings -> Inventory, owner-approved 18 Oct 2026) --------
// Valerie adds, edits, removes and brings back items from the admin, so the item list, the game
// rate and the extras' prices are hers. Every rule below holds for ANY inventory she can save
// (scripts/lib/inventory.js validate() is the same function the admin refuses a save with). The
// owner's v3 pins hold while the inventory is the seed (scripts/validators/fixtures/games.json, the
// inventory the Facebook listings were written for); once she edits it, a hand-written Facebook
// listing that no longer matches is reported as "update on Facebook", never a red build.
const INV = require(path.join(ROOT, 'scripts/lib/inventory.js'));
const FIXTURE = JSON.parse(read('scripts/validators/fixtures/games.json'));
const versionOf = (d) => INV.hash(JSON.stringify(INV.inventoryOf(INV.resolve(d))));
const SEED = versionOf(FIXTURE) === versionOf(data);
const stale = [];
const listingErrors = SEED ? errors : stale;
const RAW = JSON.parse(read('data/rentals/games.json'));
if (read('data/rentals/games.json') !== INV.stringify(RAW)) errors.push('data/rentals/games.json is not in its canonical form (2-space JSON + newline); write it with scripts/lib/inventory.js stringify');
if (INV.stringify(INV.resolve(RAW)) !== INV.stringify(RAW)) errors.push('data/rentals/games.json bundles are not resolved from its items (run scripts/inventory/apply_publish.mjs or INV.resolve)');
for (const e of INV.validate(RAW, { hasImage: (slug) => fs.existsSync(path.join(ROOT, 'assets/rentals', `${slug}.webp`)) })) errors.push(`inventory rule: ${e}`);
// Remove is soft: no item the seed had may vanish from the file (old bookings and invoices name it).
const allSlugs = new Set(INV.allItems(RAW).map(({ item }) => item.slug));
for (const { item } of INV.allItems(FIXTURE)) if (!allSlugs.has(item.slug)) errors.push(`${item.slug} was deleted from games.json; Remove keeps an item's data (availableNow false)`);
const V3 = {
  // 18 Oct 2026 (owner): Giant Checkers is not available right now; "the 6 games" are both
  // Giant Color Stack sets + Connect Four, Cornhole, Uno and Grab the Mic (5 kinds, 6 games).
  day: 40, weekend: 60, damageDeposit: 50, holdPercent: 50, items: 7, games: 5, gameUnits: 6,
  shownGames: ['giant-connect-four', 'cornhole', 'giant-color-stack', 'giant-uno', 'grab-the-mic'],
  hiddenGames: ['giant-tumble-tower', 'giant-yard-pong', 'ladder-toss', 'giant-checkers'],
  extras: { 'inflatable-movie-screen': [50, 75], 'card-table': [15, 25] },
  // Bundle prices are not edited in the admin: pinned always.
  bundles: { 'Pick 3': [110, null], 'Pick 5': [175, null], 'Whole Yard': [195, null], 'Movie Night': [110, null], 'Game Night': [85, null], 'The Whole Party': [235, 350] },
  place: 'Mt. Moriah Station, Memphis Police Department', address: '2602 Mt. Moriah Rd, Memphis, TN 38115', phone: '901-355-1518'
};
const R = data.rates || {};
const games = ITEMS.filter((i) => data.games.some((g) => g.slug === i.slug));
const units = INV.gameUnits(data);
if (SEED) {
  if (R.day !== V3.day || R.weekend !== V3.weekend) errors.push(`games.json rates are ${R.day}/${R.weekend}, owner-approved v3 is ${V3.day}/${V3.weekend}`);
  if (ITEMS.length !== V3.items) errors.push(`games.json shows ${ITEMS.length} items, owner-approved v3 is ${V3.items}`);
  for (const sl of V3.shownGames) if (!(data.games.find((g) => g.slug === sl) || {}).availableNow) errors.push(`${sl} is not availableNow; v3 shows it`);
  for (const sl of V3.hiddenGames) {
    const g = data.games.find((x) => x.slug === sl);
    if (!g) errors.push(`${sl} was deleted from games.json; v3 keeps its data for later`);
    else if (g.availableNow !== false || !g._why) errors.push(`${sl} must be availableNow:false with a _why note`);
  }
  for (const [slug, [day, wk]] of Object.entries(V3.extras)) {
    const x = (data.extras || []).find((e) => e.slug === slug);
    if (!x || x.dayPrice !== day || x.weekendPrice !== wk || !x.availableNow) errors.push(`games.json extra ${slug} is not $${day} a day / $${wk} a weekend, available`);
  }
  if (games.length !== V3.games) errors.push(`v3 has ${V3.games} games on offer, games.json shows ${games.length}`);
  const colorStack = data.games.find((g) => g.slug === 'giant-color-stack') || {};
  if (colorStack.quantity !== 2 || colorStack.bundleSets !== 2) errors.push('games.json Giant Color Stack is not quantity 2 with bundleSets 2 (owner, 18 Oct 2026: both sets count in "the 6 games")');
  const cornholeSeed = data.games.find((g) => g.slug === 'cornhole') || {};
  if (cornholeSeed.quantity !== 1) errors.push(`games.json Cornhole quantity is ${cornholeSeed.quantity}, the owner has 1 set (18 Oct 2026)`);
  if (units !== V3.gameUnits) errors.push(`the games on offer count ${units} bundle games, the owner's count is ${V3.gameUnits}`);
}
if ((data.bundles || []).length !== 6) errors.push(`games.json lists ${(data.bundles || []).length} bundles, v3 is 6`);
for (const [name, [day, wk]] of Object.entries(V3.bundles)) {
  const b = (data.bundles || []).find((x) => x.name === name);
  if (!b || b.dayPrice !== day || (b.weekendPrice == null ? null : b.weekendPrice) !== wk) errors.push(`games.json bundle ${name} is not $${day}${wk ? ` / $${wk} weekend` : ''}`);
}
// Owner, 18 Oct 2026: no public copy may promise more sets of an item than there are.
const cornhole = data.games.find((g) => g.slug === 'cornhole') || {};
const TWO_CORNHOLE = /two (cornhole )?sets available|sets? available for a tournament|cornhole \(2 sets\)|2 cornhole sets|two cornhole sets/i;
if ((cornhole.quantity || 1) < 2) for (const rel of ['rentals/index.html', 'llms.txt', 'llms-full.txt', 'llms-services.txt', 'faq/index.html', 'request.html', 'functions/_lib/assets/walkthrough-checklist.html.txt']) if (TWO_CORNHOLE.test(read(rel))) errors.push(`${rel} still says there are two cornhole sets; there is ${cornhole.quantity || 1}`);
// The all-games bundles (owner, 18 Oct 2026): every available public game at its quantity, worded
// "All games (available now: N)", never "All N games".
const ALL = (data.bundles || []).filter((x) => x.allGames);
if (ALL.length !== 2) errors.push('want exactly 2 all-games bundles (Whole Yard, The Whole Party), marked allGames');
for (const b of ALL) {
  if (b.games !== units) errors.push(`bundle ${b.name} is "all games" but counts ${b.games}, the games on offer count ${units}`);
  if (!b.includes.startsWith(INV.ALL_GAMES_WORDS(units))) errors.push(`bundle ${b.name} includes "${b.includes}", want "${INV.ALL_GAMES_WORDS(units)}..."`);
}
const ALL_N = /\ball\s+(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(games|items)\b/i;
for (const rel of ['rentals/index.html', 'llms.txt', 'llms-full.txt', 'llms-services.txt', 'faq/index.html', 'request.html', 'index.html', 'services/index.html', 'pricing.html']) {
  const visible = read(rel).replace(/<script[\s\S]*?<\/script>/g, (m) => (/application\/ld\+json/.test(m) ? m : ''));
  const hit = visible.match(ALL_N);
  if (hit) errors.push(`${rel} says "${hit[0]}"; the all-games bundles say "All games (available now: N)"`);
}
for (const b of BUNDLES) if (/checkers/i.test(`${b.includes} ${b.alt} ${b.formChoice}`) && !(data.games.find((g) => g.slug === 'giant-checkers') || {}).availableNow) errors.push(`bundle ${b.name} copy or alt text names Giant Checkers, which is not available`);
for (const b of BUNDLES) {
  if (b.games > units) errors.push(`bundle ${b.name} needs ${b.games} games, only ${games.length} are on offer`);
  for (const s2 of b.items) if (!ITEMS.some((i) => i.slug === s2)) errors.push(`bundle ${b.name} includes ${s2}, which is hidden or missing`);
  if (bundleValue(b, 'day').save <= 0) errors.push(`bundle ${b.name} saves nothing on day prices`);
}
// A bundle that cannot be offered is off the page, its schema and the price table, never on it.
for (const b of (data.bundles || []).filter((x) => x.offBecause)) if (BUNDLES.includes(b)) errors.push(`bundle ${b.name} is off (${b.offBecause}) but still offered`);
// The inventory version the admin's "Live ✓" waits for.
const { INVENTORY_VERSION } = require(path.join(ROOT, 'scripts/generators/build_rentals_page.js'));
if (INVENTORY_VERSION !== versionOf(data) || !(onDisk || '').includes(`<meta name="pnp-inventory" content="${INVENTORY_VERSION}" />`)) errors.push('rentals/index.html does not carry <meta name="pnp-inventory"> with the inventory version');
if (data.damageDeposit !== V3.damageDeposit || data.holdPercent !== V3.holdPercent) errors.push('games.json damage deposit / hold percent is not $50 + 50%');
const P = data.pickup || {};
if (P.place !== V3.place || P.address !== V3.address || P.phone !== V3.phone) errors.push('games.json pickup is not Mt. Moriah Station, 2602 Mt. Moriah Rd, 901-355-1518');
if ('delivery' in data || 'zones' in data || 'weekendMultiplier' in data) errors.push('games.json still carries a delivery block, zones or weekend multiplier');

// Every item has its image; no image belongs to nothing.
const imgDir = path.join(ROOT, 'assets/rentals');
const slugs = new Set([...data.games, ...(data.extras || [])].map((g) => g.slug));
for (const i of ITEMS) if (!fs.existsSync(path.join(imgDir, `${i.slug}.webp`))) errors.push(`assets/rentals/${i.slug}.webp is missing`);
for (const f of fs.readdirSync(imgDir)) {
  if (f === 'bundles' && fs.statSync(path.join(imgDir, f)).isDirectory()) continue;
  const slug = f.replace(/(-alt)?\.webp$/, '');
  if (slug !== 'hero' && !slugs.has(slug)) errors.push(`assets/rentals/${f} belongs to no item in games.json`);
}
// Bundle collages: each bundle names its image in games.json; every file under
// assets/rentals/bundles/ is some bundle's image.
const bundleImages = new Set(BUNDLES.map((b) => String(b.image || '').replace(/^\//, '')));
for (const b of BUNDLES) {
  if (b.image !== `/assets/rentals/bundles/bundle-${b.slug}.jpg`) errors.push(`games.json bundle ${b.name} image is not /assets/rentals/bundles/bundle-${b.slug}.jpg`);
  else if (!fs.existsSync(path.join(ROOT, b.image))) errors.push(`${b.image} is missing`);
  if (!b.alt) errors.push(`games.json bundle ${b.name} has no alt text`);
}
const bundleDir = path.join(imgDir, 'bundles');
for (const f of fs.existsSync(bundleDir) ? fs.readdirSync(bundleDir) : []) if (!bundleImages.has(`assets/rentals/bundles/${f}`)) errors.push(`assets/rentals/bundles/${f} belongs to no bundle in games.json`);

// ---- Prices: every $ amount is a games.json price ----------------------------
const PRICES = new Set([R.day, R.weekend, data.damageDeposit, 5,
  ...ITEMS.flatMap((i) => [i.dayPrice, i.weekendPrice]),
  ...BUNDLES.flatMap((b) => [b.dayPrice, b.weekendPrice].filter((n) => n != null)),
  ...BUNDLES.flatMap((b) => [bundleValue(b, 'day').save, bundleValue(b, 'day').list, ...(b.weekendPrice ? [bundleValue(b, 'weekend').save, bundleValue(b, 'weekend').list] : [])])]);
const pricesOnlyFromData = (text, where, out = errors) => {
  const found = [...text.matchAll(/\$(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (!found.length) errors.push(`${where} quotes 0 prices`);
  for (const n of found) if (!PRICES.has(n)) out.push(`${where} quotes $${n}, which is not a games.json price or saving`);
};
const money = (n) => `$${n}`;
const HIDDEN = [...data.games, ...(data.extras || [])].filter((g) => !g.availableNow);
const hiddenIn = (text, where, out = errors) => { for (const h of HIDDEN) if (text.toLowerCase().includes(h.name.toLowerCase())) out.push(`${where} names hidden item ${h.name}`); };
// Business delivery (owner, 19 Oct 2026): home rentals stay pickup and return; the ONE delivery
// mention allowed is the business line from scripts/lib/business_delivery.js, priced from
// services.json invoiceQuickAdds.deliveryFee. Anything else about delivery still fails.
const BDOFFERS = require(path.join(ROOT, 'data/offers/services.json'));
const BDL = require(path.join(ROOT, 'scripts/lib/business_delivery.js')).businessDeliveryLine(BDOFFERS);
const DELIVERY_ANY = /deliver/i;
const DELIVERY = { test: (t) => DELIVERY_ANY.test(String(t).split(BDL).join('')) };
PRICES.add(Number(BDOFFERS.invoiceQuickAdds.deliveryFee));

if (onDisk) {
  const visible = onDisk.replace(/<script[\s\S]*?<\/script>/g, '');
  const main = (visible.split('<main>')[1] || '').split('</main>')[0].replace(/<section[^>]+data-nav="related-pages"[\s\S]*?<\/section>/, '');
  pricesOnlyFromData(main, 'rentals/index.html');
  if (DELIVERY.test(onDisk)) errors.push('rentals/index.html mentions delivery beyond the business delivery line');
  if ((main.split(BDL).length - 1) < 3) errors.push(`rentals/index.html does not carry the business delivery line ("${BDL}") in Where, the pickup FAQ and How pickup works`);
  for (const [f, min] of [['faq/index.html', 2], ['rules.html', 1], ['request.html', 1], ['llms.txt', 1]]) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    if ((t.split(BDL).length - 1) < min) errors.push(`${f} lacks the business delivery line ("${BDL}")`);
    if (/We do not bring rentals to you/.test(t)) errors.push(`${f} still says "We do not bring rentals to you"`);
  }
  // A bundle photo's description names what is in the photo (the alt text), not what is on offer.
  hiddenIn(main.replace(/ alt="[^"]*"/g, ''), 'rentals/index.html');
  for (const i of ITEMS) {
    if (!main.includes(`id="${i.slug}"`)) errors.push(`rentals/index.html items grid lacks ${i.name}`);
    const card = (main.split(`id="${i.slug}"`)[1] || '').split('</article>')[0];
    if (!card.includes(`${money(i.dayPrice)} a day &middot; ${money(i.weekendPrice)} a weekend`)) errors.push(`rentals/index.html ${i.name} card lacks its day and weekend price`);
    if (!card.includes(`href="/request?service=rentals" data-quote-cta="rentals-item-${i.slug}">Book the ${i.name}</a>`)) errors.push(`rentals/index.html ${i.name} card does not link to the booking form (/request?service=rentals, "Book the ${i.name}")`);
  }
  const bundleSec = (main.split('id="bundles"')[1] || '').split('</section>')[0];
  const cards = bundleSec.match(/class="pricing-card"/g) || [];
  if (cards.length !== BUNDLES.length) errors.push(`rentals/index.html #bundles shows ${cards.length} bundle cards, ${BUNDLES.length} bundles are on offer`);
  for (const b of BUNDLES) {
    const card = (bundleSec.split(`id="bundle-${b.slug}"`)[1] || '').split('id="bundle-')[0];
    if (!card.includes(`<img src="${b.image}"`)) errors.push(`rentals/index.html bundle ${b.name} card lacks its collage ${b.image}`);
    if (!card.includes(money(b.dayPrice)) || !card.includes(`Saves ${money(bundleValue(b, 'day').save)}`)) errors.push(`rentals/index.html bundle ${b.name} card lacks its price or saving`);
    if (b.weekendPrice && !card.includes(`${money(b.weekendPrice)} for a weekend`)) errors.push(`rentals/index.html bundle ${b.name} card lacks its weekend price`);
  }
  const pickupSec = (main.split('id="pickup"')[1] || '').split('</section>')[0];
  for (const need of [V3.place, '2602 Mt. Moriah Rd', V3.phone, 'pick up the day before your event or that morning', 'the day after or 2 days after', 'pick up Thursday or Friday', 'Monday or Tuesday', `${money(data.damageDeposit)} refundable damage deposit + ${V3.holdPercent}%`, 'never cash', 'refunded at return', 'photo ID'])
    if (!pickupSec.includes(need)) errors.push(`rentals/index.html "How pickup works" lacks "${need}"`);
  const ld = [...onDisk.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const service = ld.find((o) => o['@type'] === 'Service');
  const offerPrices = (service && service.offers || []).map((o) => o.price);
  if (JSON.stringify(offerPrices) !== JSON.stringify(BUNDLES.map((b) => b.dayPrice))) errors.push('rentals/index.html Service offers are not the bundles on offer at their day prices');
  const list = ld.find((o) => o['@type'] === 'ItemList');
  if (!list || list.numberOfItems !== ITEMS.length) errors.push('rentals/index.html ItemList does not list every available item');
  pricesOnlyFromData(JSON.stringify(ld.filter((o) => o['@type'] !== 'FAQPage').map((o) => JSON.stringify(o).match(/"price":\d+/g)).flat().join(' ').replace(/"price":/g, '$')), 'rentals/index.html JSON-LD');
  hiddenIn(JSON.stringify(ld), 'rentals/index.html JSON-LD');
  const faq = ld.find((o) => o['@type'] === 'FAQPage');
  const qs = (faq && faq.mainEntity || []).map((q) => q.name);
  for (const q of ['Where do I pick up?', 'How do I pay?', 'What do I need to bring?']) if (!qs.includes(q)) errors.push(`rentals/index.html FAQPage lacks "${q}"`);
  if (qs.some((q) => DELIVERY.test(q))) errors.push('rentals/index.html FAQ still asks about delivery');
  if (!onDisk.includes(V3.phone)) errors.push(`rentals/index.html lost the site phone ${V3.phone}`);
  if (/takedown/i.test(onDisk)) errors.push('rentals/index.html mentions takedown; the add-on is porch and event decor only');
}

// ---- Facebook Marketplace: 8 items + 6 bundles -------------------------------
const CONTACT = 'Porch & Party, Memphis\nWebsite: https://porchandparty901.com/rentals/\nEmail: hello@porchandparty901.com\nFacebook Page: https://www.facebook.com/porchandparty901\n';
const PHONE = /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b|call or text|\btext us\b/i;
const RETIRED = /\bzone\s*\d|\bZIP\b|38103|1\.5\s*(x|times)|free over|free on orders/i;
const RULES = [`${V3.place}, ${V3.address}`, 'pick up the day before your event or that morning, and bring everything back the day after or 2 days after', 'The entire weekend (Friday, Saturday and Sunday): pick up Thursday or Friday, and bring everything back Monday or Tuesday', `${money(V3.damageDeposit)} refundable damage deposit + ${V3.holdPercent}% of the rental`, 'Zelle or Cash App', 'paid at pickup', 'government photo ID', 'check it at hand-off'];
const listing = read('docs/listings/facebook-marketplace.md');
const blocks = listing.split(/^## /m).slice(1);
if (blocks.length !== ITEMS.length + BUNDLES.length) listingErrors.push(`facebook-marketplace.md has ${blocks.length} listings, games.json has ${ITEMS.length} items + ${BUNDLES.length} bundles`);
if (PHONE.test(listing)) errors.push('facebook-marketplace.md carries a phone number or call/text line; Facebook copy is email only (owner ruling 2026-10-14)');
if (RETIRED.test(listing)) errors.push('facebook-marketplace.md still quotes retired zones, the 1.5x weekend rate or free delivery');
if (DELIVERY.test(listing)) errors.push('facebook-marketplace.md mentions delivery; rentals v3 is pickup and return only');
hiddenIn(listing, 'facebook-marketplace.md', listingErrors);
// Live Marketplace wording (owner, 18 Oct 2026): all-games bundles list "2 Giant Color Stack sets",
// and every quote link goes to the site request page, never a Google Form.
for (const bn of ['Whole Yard', 'The Whole Party']) {
  const b = blocks.find((x) => x.startsWith(`${bn} bundle\n`)) || '';
  if (!/Games included: [^\n]*, 2 Giant Color Stack sets\./.test(b)) listingErrors.push(`${bn} bundle: "Games included" does not say "2 Giant Color Stack sets" (live Marketplace wording)`);
}
if (/Color Stack \(both sets\)/.test(listing)) listingErrors.push('facebook-marketplace.md says "Giant Color Stack (both sets)"; live listings say "2 Giant Color Stack sets"');
for (const f of ['facebook-marketplace.md', 'facebook-page.md', 'bark.md', 'thumbtack.md']) if (/forms\.gle|docs\.google\.com\/forms/.test(read(`docs/listings/${f}`))) errors.push(`docs/listings/${f} links a Google Form; quote links go to https://porchandparty901.com/request (owner, 18 Oct 2026)`);
pricesOnlyFromData(blocks.join('## '), 'facebook-marketplace.md', listingErrors);
// ---- Request-page lines (owner-approved wording, 2026-10-18) -------------------
// Line 2 of every live Marketplace description points at the site request page;
// listings are edited in place, never deleted and re-added.
const RENTAL_L1 = 'RENTAL ONLY. This is a rental, not a sale. The items come back to us after your event.';
const RENTAL_L2 = "Reserve your date at porchandparty901.com/request. See what's free and hold it for 24 hours.";
const DECOR_L2 = 'Request your date at porchandparty901.com/request. We reply with a quote.';
const decorBlocks = (listing.split(/^## /m)[0].split(/^### Decor: /m)).slice(1);
if (decorBlocks.length !== 2) errors.push(`facebook-marketplace.md has ${decorBlocks.length} decor service listings, Marketplace has 2 (porch decor, room decor)`);
for (const d of decorBlocks) {
  const desc = (d.split('**Description:**\n\n')[1] || '').split('\n');
  if (!/^DECOR SERVICE, not an item for sale: /.test(desc[0] || '') || desc[1] !== DECOR_L2) errors.push(`decor listing "${d.split('\n')[0]}": description does not open with the DECOR SERVICE line then "${DECOR_L2}"`);
}
const checkListing = (b, where, title, price, photo) => {
  if (!b) { listingErrors.push(`facebook-marketplace.md has no listing for ${where}`); return; }
  if (!b.includes(`**Price:** ${money(price)} (per day)`)) listingErrors.push(`${where}: Marketplace price is not the ${money(price)} day price`);
  if (!new RegExp(`\\*\\*Title:\\*\\* ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*, \\$${price}/day, Memphis pickup`).test(b)) listingErrors.push(`${where}: Marketplace title is not "${title}…, ${money(price)}/day, Memphis pickup"`);
  if (photo && !b.includes(`assets/rentals/${photo}.webp`)) listingErrors.push(`${where}: Marketplace photo is not assets/rentals/${photo}.webp`);
  for (const r of RULES) if (!b.includes(r)) errors.push(`${where}: Marketplace listing lacks "${r}"`);
  if (!b.trimEnd().endsWith(CONTACT.trimEnd())) errors.push(`${where}: Marketplace listing does not end with the email-only contact block`);
};
for (const i of ITEMS) {
  const b = blocks.find((x) => x.startsWith(`${i.name}\n`));
  checkListing(b, i.name, `${i.name} rental`, i.dayPrice, i.slug);
  if (b && !b.includes(`${money(i.weekendPrice)} for a weekend`)) listingErrors.push(`${i.name}: Marketplace listing lacks its ${money(i.weekendPrice)} weekend price`);
  // The count in the copy is the count we own (owner, 18 Oct 2026: Cornhole is 1 set).
  const owned = (b || '').match(/(\d+) available\./);
  if (b && owned && Number(owned[1]) !== (i.quantity || 1)) listingErrors.push(`${i.name}: Marketplace listing says "${owned ? owned[0] : 'no count'}", games.json has ${i.quantity || 1}`);
  if (b && (i.quantity || 1) === 1 && /two sets|2 sets/i.test(b)) listingErrors.push(`${i.name}: Marketplace listing mentions two sets, games.json has 1`);
}
for (const bd of BUNDLES) {
  const b = blocks.find((x) => x.startsWith(`${bd.name} bundle\n`));
  checkListing(b, `${bd.name} bundle`, `RENTAL ONLY: ${bd.name}`, bd.dayPrice, null);
  if (!b) continue;
  if (!b.includes(`**Description:**\n\n${RENTAL_L1}\n${RENTAL_L2}\n`)) errors.push(`${bd.name} bundle: Marketplace description does not open with the RENTAL ONLY line then "${RENTAL_L2}"`);
  if (!b.includes(`**Photo:** \`${bd.image.replace(/^\//, '')}\``)) errors.push(`${bd.name} bundle: Marketplace photo is not its collage ${bd.image}`);
  if (bd.allGames) {
    const inc = (b.match(/Games included: ([^\n]*)/) || [])[1] || '';
    for (const g of games) if (!inc.toLowerCase().includes(g.name.replace(/ Set$/, '').toLowerCase())) listingErrors.push(`${bd.name} bundle: Marketplace "Games included" does not name ${g.name}`);
  } else if (!b.toLowerCase().includes(bd.includes.toLowerCase())) listingErrors.push(`${bd.name} bundle: Marketplace listing lacks what it includes ("${bd.includes}")`);
  if (!b.includes(`You save ${money(bundleValue(bd, 'day').save)} on day prices`)) listingErrors.push(`${bd.name} bundle: Marketplace listing lacks its ${money(bundleValue(bd, 'day').save)} saving`);
  if (bd.weekendPrice && !b.includes(`${money(bd.weekendPrice)} for a weekend`)) listingErrors.push(`${bd.name} bundle: Marketplace listing lacks its weekend price`);
}

// ---- Facebook Page -------------------------------------------------------------
const page = read('docs/listings/facebook-page.md');
if (PHONE.test(page)) errors.push('facebook-page.md carries a phone number or call/text line; Facebook copy is email only (owner ruling 2026-10-14)');
if (RETIRED.test(page)) errors.push('facebook-page.md still quotes retired zones, the 1.5x weekend rate or free delivery');
if (DELIVERY.test(page)) errors.push('facebook-page.md mentions delivery; rentals v3 is pickup and return only');
hiddenIn(page, 'facebook-page.md', listingErrors);
pricesOnlyFromData(page.split('## About (long description)')[1] || '', 'facebook-page.md', listingErrors);
const bio = (page.match(/## About \(short bio[^\n]*\n([^\n]+)/) || [])[1] || '';
if (!bio.includes('hello@porchandparty901.com')) errors.push('facebook-page.md short bio does not carry the email');
if (!bio.includes('Mt. Moriah Station')) errors.push('facebook-page.md short bio does not say where pickup is');
if (!bio.endsWith('Reserve online: porchandparty901.com/request')) errors.push('facebook-page.md short bio does not end with "Reserve online: porchandparty901.com/request"');
const actionBtn = (page.split('## Action button')[1] || '').split('\n## ')[0];
if (!actionBtn.includes('**Learn more**') || !actionBtn.includes('https://porchandparty901.com/request')) errors.push('facebook-page.md action button is not "Learn more" linked to https://porchandparty901.com/request');
if (bio.length > 255) errors.push(`facebook-page.md short bio is ${bio.length} characters, Facebook allows 255`);
if (!/### Post \d+ — Movie night in your backyard/.test(page)) errors.push('facebook-page.md lacks the "Movie night in your backyard" post');
for (const i of ITEMS) if (!page.toLowerCase().includes(i.name.replace(/ Set$/, '').toLowerCase())) listingErrors.push(`facebook-page.md does not name ${i.name}`);
for (const n of [`${money(R.day)} a day`, `${money(R.weekend)} for a weekend`, ...BUNDLES.map((b) => money(b.dayPrice)), `${money(data.damageDeposit)} damage deposit`])
  if (!page.includes(n)) listingErrors.push(`facebook-page.md does not quote ${n}`);

// ---- Other rentals copy on the site ----------------------------------------------
const home = read('index.html');
for (const m of home.matchAll(/[^.<>]*(?:\/rentals\/|game rental|yard game)[^<]*/gi)) if (DELIVERY.test(m[0])) errors.push(`index.html rentals copy mentions delivery: "${m[0].trim().slice(0, 90)}"`);
const svc = read('services/index.html');
const svcRentals = svc.slice(svc.indexOf('Party Game Rentals - '));
if (DELIVERY.test((svcRentals.split('</article>')[0]) || '')) errors.push('services/index.html rentals card mentions delivery');
const contactPage = read('contact.html');
if (/rentals \([^)]*deliver/i.test(contactPage)) errors.push('contact.html form note still asks rentals for a delivery date');
for (const rel of ['pricing.html', 'terms-and-conditions.html']) if (/rental pickup is (already )?included/i.test(read(rel))) errors.push(`${rel} still says rental pickup is included; v3 renters return the rentals`);

// ---- llms files and renter safety ----------------------------------------------
const SAFE = require(path.join(ROOT, 'data/offers/services.json')).renterSafety || {};
const SAFE_TEXT = `${SAFE.line} ${SAFE.rentalFormNote}`;
if (!/government photo ID/.test(SAFE.line || '') || !/three minutes/.test(SAFE.rentalFormNote || '') || !/no account or sign-in/.test(SAFE.rentalFormNote || '') || /Google sign-in/.test(SAFE.rentalFormNote || '')) errors.push('services.json renterSafety is not the owner-approved ID / three-minute, no-sign-in copy (the site form needs no Google sign-in)');
if (onDisk) {
  const booking = (onDisk.split('id="how-booking-works"')[1] || '').split('</section>')[0];
  if (!booking.includes(SAFE_TEXT)) errors.push('rentals/index.html How Booking Works lacks the renter-safety line and form note');
}
for (const f of ['llms.txt', 'llms-full.txt', 'llms-services.txt']) {
  const t = read(f);
  const sec = (t.split('## Party game rentals')[1] || '').split(/\n## /)[0];
  if (!sec) { errors.push(`${f} has no Party game rentals section`); continue; }
  if (!sec.includes(SAFE_TEXT)) errors.push(`${f} rentals section lacks the renter-safety line and form note`);
  if (RETIRED.test(sec)) errors.push(`${f} rentals section still quotes retired zones, the 1.5x weekend rate or free delivery`);
  if (DELIVERY.test(sec.replace(/\bNo delivery\b/g, ''))) errors.push(`${f} rentals section mentions delivery`);
  hiddenIn(sec, `${f} rentals section`);
  pricesOnlyFromData(sec, `${f} rentals section`);
  for (const i of ITEMS) if (!sec.toLowerCase().includes(i.name.replace(/ Set$/, '').toLowerCase())) errors.push(`${f} rentals section does not name ${i.name}`);
  for (const n of [`${money(R.day)} per game per day`, `${money(R.weekend)} per game for a weekend`, ...BUNDLES.map((b) => money(b.dayPrice)), `${money(data.damageDeposit)} damage deposit`, V3.address])
    if (!sec.includes(n)) errors.push(`${f} rentals section does not quote ${n}`);
}
if (onDisk && (/forms\.gle/.test(onDisk) || (onDisk.match(/>Book your games<\/a>/g) || []).length < 4 || /Check My Date/.test(onDisk))) errors.push('rentals/index.html still links the Google Form, or its buttons do not read "Book your games"');
// ---- The projector, on request (owner, 18 Oct 2026) ------------------------------------
const PROJ_LINE = 'Need a projector? We can include one, just ask when you book. Bring your own speaker; it needs a plug within 50 ft.';
const PROJ_Q = 'Do you have a projector?';
const PROJ_A = "Yes, we can include one with the movie screen. Just ask when you book; it's one projector, so ask early.";
const screen = (data.extras || []).find((x) => x.slug === 'inflatable-movie-screen') || {};
const PROJ_ON = screen.availableNow && (data.adminItems || []).some((x) => x.slug === 'projector' && x.availableNow !== false);
if (SEED && !String(screen.blurb || '').endsWith(PROJ_LINE)) errors.push('the movie screen blurb does not offer the projector on request');
const { FAQ: RFAQ } = require(path.join(ROOT, 'scripts/generators/build_rentals_page.js'));
if (PROJ_ON && !RFAQ.some(([q, a]) => q === PROJ_Q && a === PROJ_A)) errors.push('the rentals FAQ lacks "Do you have a projector?" with the owner answer');
if (!PROJ_ON && RFAQ.some(([q]) => q === PROJ_Q)) errors.push('the rentals FAQ offers a projector while the movie screen or the projector is removed');
if (ITEMS.some((i) => /projector/i.test(i.name)) || BUNDLES.some((b) => (b.items || []).includes('projector'))) errors.push('the admin-only Projector is a public rental item or in a bundle');
const PUBLIC = ['rentals/index.html', 'faq/index.html', 'request.html', 'index.html', 'services/index.html', 'llms.txt', 'llms-full.txt', 'llms-services.txt', 'docs/listings/facebook-marketplace.md', 'docs/listings/facebook-page.md', 'data/rentals/games.json'];
for (const rel of PUBLIC) {
  const t = read(rel);
  if (/own projector/i.test(t)) errors.push(`${rel} still says to bring your own projector`);
  if (/projector[^.<\n]{0,60}\$\d|\$\d[^.<\n]{0,30}projector/i.test(t)) errors.push(`${rel} quotes a projector price`);
}
if (PROJ_ON) for (const rel of ['rentals/index.html', 'faq/index.html']) if (!read(rel).includes(esc(PROJ_A)) || !read(rel).includes(PROJ_Q)) errors.push(`${rel} does not carry the projector question and answer`);
if (String(screen.blurb || '').endsWith(PROJ_LINE) && screen.availableNow) for (const rel of ['rentals/index.html', 'llms.txt', 'llms-full.txt', 'llms-services.txt', 'docs/listings/facebook-marketplace.md']) if (!read(rel).includes(esc(PROJ_LINE)) && !read(rel).includes(PROJ_LINE)) (rel.startsWith('docs/') ? listingErrors : errors).push(`${rel} lacks the projector-on-request line`);
// No removed item (Giant Checkers today, anything Valerie removes) is named on a public surface.
for (const h of HIDDEN) for (const rel of PUBLIC.filter((r) => r !== 'data/rentals/games.json')) {
  const word = h.slug === 'giant-checkers' ? /checkers/i : new RegExp(h.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (word.test(read(rel).replace(/ alt="[^"]*"/g, ''))) (rel.startsWith('docs/') ? listingErrors : errors).push(`${rel} names ${h.name}, which is not available`);
}
if (stale.length) { console.log(`rentals: the inventory was changed in Settings -> Inventory; ${stale.length} hand-written Facebook listing line(s) to update on Facebook (not a build failure):`); for (const w of stale) console.log(`  - ${w}`); }
if (errors.length) { for (const e of errors) console.error(`rentals: ${e}`); process.exit(1); }
console.log(`rentals: OK - page matches a fresh render; v3 prices pinned; ${ITEMS.length} items + ${BUNDLES.length} bundles on the page and in ${blocks.length} Marketplace listings; every price from games.json; no delivery and no hidden item in the rentals copy; renter-safety line on the page and in the llms files; Facebook copy email only`);
