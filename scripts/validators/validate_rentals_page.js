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
 * Read-only. Rule 0: zero items, zero bundles or zero listings is a failure.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { finalHtml, data, OUT, ITEMS, BUNDLES, bundleValue } = require(path.join(ROOT, 'scripts/generators/build_rentals_page.js'));

const errors = [];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
if (!ITEMS.length) errors.push('data/rentals/games.json shows 0 items');
if (!BUNDLES.length) errors.push('data/rentals/games.json lists 0 bundles');
const onDisk = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
if (onDisk === null) errors.push('rentals/index.html is missing');
else if (onDisk !== finalHtml(onDisk)) errors.push('rentals/index.html differs from a fresh render: run node scripts/generators/build_rentals_page.js');

// ---- Owner-approved v3 (2026-10-15) ------------------------------------------
const V3 = {
  day: 40, weekend: 60, damageDeposit: 50, holdPercent: 50, items: 8, games: 6,
  shownGames: ['giant-connect-four', 'cornhole', 'giant-checkers', 'giant-color-stack', 'giant-uno', 'grab-the-mic'],
  hiddenGames: ['giant-tumble-tower', 'giant-yard-pong', 'ladder-toss'],
  extras: { 'inflatable-movie-screen': [50, 75], 'card-table': [15, 25] },
  bundles: { 'Pick 3': [110, null], 'Pick 5': [175, null], 'Whole Yard': [195, null], 'Movie Night': [110, null], 'Game Night': [85, null], 'The Whole Party': [235, 350] },
  place: 'Mt. Moriah Station, Memphis Police Department', address: '2602 Mt. Moriah Rd, Memphis, TN 38115', phone: '901-355-1518'
};
const R = data.rates || {};
if (R.day !== V3.day || R.weekend !== V3.weekend) errors.push(`games.json rates are ${R.day}/${R.weekend}, owner-approved v3 is ${V3.day}/${V3.weekend}`);
if (ITEMS.length !== V3.items) errors.push(`games.json shows ${ITEMS.length} items, owner-approved v3 is ${V3.items}`);
for (const s of V3.shownGames) if (!(data.games.find((g) => g.slug === s) || {}).availableNow) errors.push(`${s} is not availableNow; v3 shows it`);
for (const s of V3.hiddenGames) {
  const g = data.games.find((x) => x.slug === s);
  if (!g) errors.push(`${s} was deleted from games.json; v3 keeps its data for later`);
  else if (g.availableNow !== false || !g._why) errors.push(`${s} must be availableNow:false with a _why note`);
}
for (const [slug, [day, wk]] of Object.entries(V3.extras)) {
  const x = (data.extras || []).find((e) => e.slug === slug);
  if (!x || x.dayPrice !== day || x.weekendPrice !== wk || !x.availableNow) errors.push(`games.json extra ${slug} is not $${day} a day / $${wk} a weekend, available`);
}
if (BUNDLES.length !== 6) errors.push(`games.json lists ${BUNDLES.length} bundles, v3 is 6`);
for (const [name, [day, wk]] of Object.entries(V3.bundles)) {
  const b = BUNDLES.find((x) => x.name === name);
  if (!b || b.dayPrice !== day || (b.weekendPrice == null ? null : b.weekendPrice) !== wk) errors.push(`games.json bundle ${name} is not $${day}${wk ? ` / $${wk} weekend` : ''}`);
}
const games = ITEMS.filter((i) => data.games.some((g) => g.slug === i.slug));
if (games.length !== V3.games) errors.push(`v3 has ${V3.games} games on offer, games.json shows ${games.length}`);
for (const b of BUNDLES) {
  if (b.games > games.length) errors.push(`bundle ${b.name} needs ${b.games} games, only ${games.length} are on offer`);
  for (const s of b.items) if (!ITEMS.some((i) => i.slug === s)) errors.push(`bundle ${b.name} includes ${s}, which is hidden or missing`);
  if (bundleValue(b, 'day').save <= 0) errors.push(`bundle ${b.name} saves nothing on day prices`);
}
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
const pricesOnlyFromData = (text, where) => {
  const found = [...text.matchAll(/\$(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (!found.length) errors.push(`${where} quotes 0 prices`);
  for (const n of found) if (!PRICES.has(n)) errors.push(`${where} quotes $${n}, which is not a games.json price or saving`);
};
const money = (n) => `$${n}`;
const HIDDEN = [...data.games, ...(data.extras || [])].filter((g) => !g.availableNow);
const hiddenIn = (text, where) => { for (const h of HIDDEN) if (text.toLowerCase().includes(h.name.toLowerCase())) errors.push(`${where} names hidden item ${h.name}`); };
const DELIVERY = /deliver/i;

if (onDisk) {
  const visible = onDisk.replace(/<script[\s\S]*?<\/script>/g, '');
  const main = (visible.split('<main>')[1] || '').split('</main>')[0].replace(/<section[^>]+data-nav="related-pages"[\s\S]*?<\/section>/, '');
  pricesOnlyFromData(main, 'rentals/index.html');
  if (DELIVERY.test(onDisk)) errors.push('rentals/index.html mentions delivery; rentals v3 is pickup and return only');
  hiddenIn(main, 'rentals/index.html');
  for (const i of ITEMS) {
    if (!main.includes(`id="${i.slug}"`)) errors.push(`rentals/index.html items grid lacks ${i.name}`);
    const card = (main.split(`id="${i.slug}"`)[1] || '').split('</article>')[0];
    if (!card.includes(`${money(i.dayPrice)} a day &middot; ${money(i.weekendPrice)} a weekend`)) errors.push(`rentals/index.html ${i.name} card lacks its day and weekend price`);
    if (!card.includes(`href="/request?service=rentals" data-quote-cta="rentals-item-${i.slug}">Book the ${i.name}</a>`)) errors.push(`rentals/index.html ${i.name} card does not link to the booking form (/request?service=rentals, "Book the ${i.name}")`);
  }
  const bundleSec = (main.split('id="bundles"')[1] || '').split('</section>')[0];
  const cards = bundleSec.match(/class="pricing-card"/g) || [];
  if (cards.length !== 6) errors.push(`rentals/index.html #bundles shows ${cards.length} bundle cards, v3 is 6`);
  for (const b of BUNDLES) {
    const card = (bundleSec.split(`id="bundle-${b.slug}"`)[1] || '').split('id="bundle-')[0];
    if (!card.includes(`<img src="${b.image}"`)) errors.push(`rentals/index.html bundle ${b.name} card lacks its collage ${b.image}`);
    if (!card.includes(money(b.dayPrice)) || !card.includes(`Saves ${money(bundleValue(b, 'day').save)}`)) errors.push(`rentals/index.html bundle ${b.name} card lacks its price or saving`);
    if (b.weekendPrice && !card.includes(`${money(b.weekendPrice)} for a weekend`)) errors.push(`rentals/index.html bundle ${b.name} card lacks its weekend price`);
  }
  const pickupSec = (main.split('id="pickup"')[1] || '').split('</section>')[0];
  for (const need of [V3.place, '2602 Mt. Moriah Rd', V3.phone, 'within 24 hours', 'Friday', 'Monday', `${money(V3.damageDeposit)} refundable damage deposit + ${V3.holdPercent}%`, 'never cash', 'refunded at return', 'photo ID'])
    if (!pickupSec.includes(need)) errors.push(`rentals/index.html "How pickup works" lacks "${need}"`);
  const ld = [...onDisk.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const service = ld.find((o) => o['@type'] === 'Service');
  const offerPrices = (service && service.offers || []).map((o) => o.price);
  if (JSON.stringify(offerPrices) !== JSON.stringify(BUNDLES.map((b) => b.dayPrice))) errors.push('rentals/index.html Service offers are not the 6 bundles at their day prices');
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
const RULES = [`${V3.place}, ${V3.address}`, 'within 24 hours', 'picked up Friday and returned Monday', `${money(V3.damageDeposit)} refundable damage deposit + ${V3.holdPercent}% of the rental`, 'Zelle or Cash App', 'paid at pickup', 'government photo ID', 'check it at hand-off'];
const listing = read('docs/listings/facebook-marketplace.md');
const blocks = listing.split(/^## /m).slice(1);
if (blocks.length !== ITEMS.length + BUNDLES.length) errors.push(`facebook-marketplace.md has ${blocks.length} listings, games.json has ${ITEMS.length} items + ${BUNDLES.length} bundles`);
if (PHONE.test(listing)) errors.push('facebook-marketplace.md carries a phone number or call/text line; Facebook copy is email only (owner ruling 2026-10-14)');
if (RETIRED.test(listing)) errors.push('facebook-marketplace.md still quotes retired zones, the 1.5x weekend rate or free delivery');
if (DELIVERY.test(listing)) errors.push('facebook-marketplace.md mentions delivery; rentals v3 is pickup and return only');
hiddenIn(listing, 'facebook-marketplace.md');
pricesOnlyFromData(listing, 'facebook-marketplace.md');
const checkListing = (b, where, title, price, photo) => {
  if (!b) { errors.push(`facebook-marketplace.md has no listing for ${where}`); return; }
  if (!b.includes(`**Price:** ${money(price)} (per day)`)) errors.push(`${where}: Marketplace price is not the ${money(price)} day price`);
  if (!new RegExp(`\\*\\*Title:\\*\\* ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*, \\$${price}/day, Memphis pickup`).test(b)) errors.push(`${where}: Marketplace title is not "${title}…, ${money(price)}/day, Memphis pickup"`);
  if (photo && !b.includes(`assets/rentals/${photo}.webp`)) errors.push(`${where}: Marketplace photo is not assets/rentals/${photo}.webp`);
  for (const r of RULES) if (!b.includes(r)) errors.push(`${where}: Marketplace listing lacks "${r}"`);
  if (!b.trimEnd().endsWith(CONTACT.trimEnd())) errors.push(`${where}: Marketplace listing does not end with the email-only contact block`);
};
for (const i of ITEMS) {
  const b = blocks.find((x) => x.startsWith(`${i.name}\n`));
  checkListing(b, i.name, `${i.name} rental`, i.dayPrice, i.slug);
  if (b && !b.includes(`${money(i.weekendPrice)} for a weekend`)) errors.push(`${i.name}: Marketplace listing lacks its ${money(i.weekendPrice)} weekend price`);
}
for (const bd of BUNDLES) {
  const b = blocks.find((x) => x.startsWith(`${bd.name} bundle\n`));
  checkListing(b, `${bd.name} bundle`, bd.name, bd.dayPrice, null);
  if (!b) continue;
  if (!b.includes(`**Photo:** \`${bd.image.replace(/^\//, '')}\``)) errors.push(`${bd.name} bundle: Marketplace photo is not its collage ${bd.image}`);
  if (!b.toLowerCase().includes(bd.includes.toLowerCase())) errors.push(`${bd.name} bundle: Marketplace listing lacks what it includes ("${bd.includes}")`);
  if (!b.includes(`You save ${money(bundleValue(bd, 'day').save)} on day prices`)) errors.push(`${bd.name} bundle: Marketplace listing lacks its ${money(bundleValue(bd, 'day').save)} saving`);
  if (bd.weekendPrice && !b.includes(`${money(bd.weekendPrice)} for a weekend`)) errors.push(`${bd.name} bundle: Marketplace listing lacks its weekend price`);
}

// ---- Facebook Page -------------------------------------------------------------
const page = read('docs/listings/facebook-page.md');
if (PHONE.test(page)) errors.push('facebook-page.md carries a phone number or call/text line; Facebook copy is email only (owner ruling 2026-10-14)');
if (RETIRED.test(page)) errors.push('facebook-page.md still quotes retired zones, the 1.5x weekend rate or free delivery');
if (DELIVERY.test(page)) errors.push('facebook-page.md mentions delivery; rentals v3 is pickup and return only');
hiddenIn(page, 'facebook-page.md');
pricesOnlyFromData(page.split('## About (long description)')[1] || '', 'facebook-page.md');
const bio = (page.match(/## About \(short bio[^\n]*\n([^\n]+)/) || [])[1] || '';
if (!bio.includes('hello@porchandparty901.com')) errors.push('facebook-page.md short bio does not carry the email');
if (!bio.includes('Mt. Moriah Station')) errors.push('facebook-page.md short bio does not say where pickup is');
if (bio.length > 255) errors.push(`facebook-page.md short bio is ${bio.length} characters, Facebook allows 255`);
if (!/### Post \d+ — Movie night in your backyard/.test(page)) errors.push('facebook-page.md lacks the "Movie night in your backyard" post');
for (const i of ITEMS) if (!page.toLowerCase().includes(i.name.replace(/ Set$/, '').toLowerCase())) errors.push(`facebook-page.md does not name ${i.name}`);
for (const n of [`${money(V3.day)} a day`, `${money(V3.weekend)} for a weekend`, ...BUNDLES.map((b) => money(b.dayPrice)), `${money(V3.damageDeposit)} damage deposit`])
  if (!page.includes(n)) errors.push(`facebook-page.md does not quote ${n}`);

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
  for (const n of [`${money(V3.day)} per game per day`, `${money(V3.weekend)} per game for a weekend`, ...BUNDLES.map((b) => money(b.dayPrice)), `${money(V3.damageDeposit)} damage deposit`, V3.address])
    if (!sec.includes(n)) errors.push(`${f} rentals section does not quote ${n}`);
}
if (onDisk && (/forms\.gle/.test(onDisk) || (onDisk.match(/>Book your games<\/a>/g) || []).length < 4 || /Check My Date/.test(onDisk))) errors.push('rentals/index.html still links the Google Form, or its buttons do not read "Book your games"');
if (errors.length) { for (const e of errors) console.error(`rentals: ${e}`); process.exit(1); }
console.log(`rentals: OK - page matches a fresh render; v3 prices pinned; ${ITEMS.length} items + ${BUNDLES.length} bundles on the page and in ${blocks.length} Marketplace listings; every price from games.json; no delivery and no hidden item in the rentals copy; renter-safety line on the page and in the llms files; Facebook copy email only`);
