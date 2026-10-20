/**
 * The rentals inventory rules, in ONE place (owner-approved 18 Oct 2026: Valerie adds, edits,
 * removes and brings back rental items from /admin Settings -> Inventory).
 *
 * Who reads this file:
 *  - the admin (functions/_lib/inventory.mjs) when it saves an item: validate() refuses a save
 *    CI would reject, with a plain sentence for Valerie;
 *  - the publish step (scripts/inventory/apply_publish.mjs) when it writes data/rentals/games.json;
 *  - every public generator through resolve(): the all-games bundles (Whole Yard, The Whole Party)
 *    take every available public game at its quantity and say "All games (available now: N)";
 *  - validate:rentals and validate:admin-inventory, which run validate() over the committed file.
 *
 * Pure CommonJS: no fs, no bindings, so the Pages Functions bundle and Node both load it.
 */
'use strict';

const SECTIONS = ['games', 'extras', 'adminItems'];
const USES = ['both', 'indoor', 'outdoor'];
const LIMITS = { name: 60, size: 120, blurb: 400, alt: 300, short: 40, quantity: 20, price: 2000, deposit: 1000, rate: 500, perSet: 10 };
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

const clone = (o) => JSON.parse(JSON.stringify(o));
const words = (n) => NUMBER_WORDS[n] || String(n);
const money = (n) => (Number.isInteger(n) ? `$${n}` : `$${Number(n).toFixed(2)}`);
const isInt = (n) => Number.isInteger(n);
const lcFirst = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);

function slugify(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
}

// "a, b and c"
function joinAnd(list) {
  const l = list.filter(Boolean);
  if (l.length <= 1) return l.join('');
  return `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`;
}

const article = (s) => (/^[aeiou]/i.test(String(s)) ? 'an' : 'a');

// Every item with its section, in file order.
function allItems(data) {
  const out = [];
  for (const section of SECTIONS) for (const item of data[section] || []) out.push({ section, item });
  return out;
}

const available = (i) => i && i.availableNow !== false;
const publicGames = (data) => (data.games || []).filter((g) => g.availableNow);
const publicExtras = (data) => (data.extras || []).filter((x) => x.availableNow);

// How many slots a game fills in an all-games bundle: its quantity (owner, 18 Oct 2026: "at its
// quantity"; both Giant Color Stack sets count). bundleSets, where present, is kept equal to it.
const setsOf = (g) => g.bundleSets || g.quantity || 1;
function gameUnits(data) {
  return publicGames(data).reduce((n, g) => n + setsOf(g), 0);
}

// The words an extra goes by in running copy. Seed extras carry them ("an inflatable movie
// screen" / "a movie screen"); an extra added from the admin derives them from its name.
function extraPhrase(x) {
  if (x.phrase) return x.phrase;
  const n = String(x.name || '').toLowerCase();
  return `${article(n)} ${n}`;
}
function extraShort(x) {
  if (x.short) return `${article(x.short)} ${x.short}`;
  return extraPhrase(x);
}
function extraThe(x) {
  return `the ${x.short || String(x.name || '').toLowerCase()}`;
}

// "giant yard games, an inflatable movie screen and a card table"
function rentalsPhrase(data, { short = false, games = 'giant yard games' } = {}) {
  return joinAnd([games, ...publicExtras(data).map(short ? extraShort : extraPhrase)]);
}

const ALL_GAMES_WORDS = (n) => `All games (available now: ${n})`;

// What one bundle saves against the same items at day (or weekend) prices.
function bundleValue(data, b, span) {
  const gameRate = span === 'weekend' ? data.rates.weekend : data.rates.day;
  const extras = (b.items || []).map((s) => (data.extras || []).find((x) => x.slug === s));
  if (extras.some((x) => !x)) return { list: 0, price: 0, save: 0 };
  const list = b.games * gameRate + extras.reduce((t, x) => t + (span === 'weekend' ? x.weekendPrice : x.dayPrice), 0);
  const price = span === 'weekend' ? b.weekendPrice : b.dayPrice;
  return { list, price, save: list - price };
}

// Why a bundle cannot be offered right now ('' = it can). Never an error: a bundle simply comes
// off the website (and out of the price table) until the items it needs are back.
function bundleBlocker(data, b) {
  const units = gameUnits(data);
  for (const s of b.items || []) {
    const x = (data.extras || []).find((e) => e.slug === s);
    if (!x || !x.availableNow) return `${x ? x.name : s} is removed`;
  }
  if (b.games > units) return `it needs ${b.games} games and ${units} ${units === 1 ? 'is' : 'are'} on the website`;
  if (bundleValue(data, b, 'day').save <= 0) return 'it would cost more than renting the same things one by one';
  if (b.weekendPrice != null && bundleValue(data, b, 'weekend').save <= 0) return 'its weekend price would cost more than renting the same things one by one';
  return '';
}

// games.json with everything derived from the items filled in: the all-games bundles' size and
// wording, and offBecause on a bundle that cannot be offered. Never mutates its argument.
function resolve(data) {
  const out = clone(data);
  const units = gameUnits(out);
  for (const b of out.bundles || []) {
    if (b.allGames) {
      b.games = units;
      const extras = (b.items || []).map((s) => (out.extras || []).find((x) => x.slug === s)).filter(Boolean);
      b.includes = `${ALL_GAMES_WORDS(units)}${extras.length ? `, ${joinAnd(extras.map(extraThe))}` : ''}`;
    }
    delete b.offBecause;
    const why = bundleBlocker(out, b);
    if (why) b.offBecause = why;
  }
  for (const g of out.games || []) if (g.bundleSets && g.bundleSets !== g.quantity) g.bundleSets = g.quantity;
  return out;
}

const offeredBundles = (data) => (data.bundles || []).filter((b) => !b.offBecause);

// The one item deposit an order pays: the biggest deposit among its items (the standard
// damageDeposit unless an item says more or less).
const depositOf = (data, item) => (item && item.deposit != null ? item.deposit : data.damageDeposit);

// Canonical text of games.json (the file is always written this way).
function stringify(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

// 64-bit FNV-1a, hex. Sync and identical in Node and the Workers runtime.
function hash(text) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(String(text));
  for (const b of bytes) { h ^= BigInt(b); h = (h * prime) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, '0').slice(0, 12);
}

// The inventory part of games.json (what the admin owns): the three item lists and the game rates.
function inventoryOf(data) {
  return { rates: clone(data.rates), games: clone(data.games || []), extras: clone(data.extras || []), adminItems: clone(data.adminItems || []) };
}

// games.json = base (bundles, pickup, deposit rules, hero...) + the admin's inventory, resolved.
function merge(base, inv) {
  const out = clone(base);
  out.rates = { ...out.rates, ...(inv.rates || {}) };
  for (const s of SECTIONS) if (inv[s] !== undefined) out[s] = clone(inv[s]);
  if (out.adminItems && !out.adminItems.length && !base.adminItems) delete out.adminItems;
  return resolve(out);
}

/**
 * Every rule CI holds games.json to, as plain sentences Valerie can act on. The admin refuses a
 * save that returns any; validate:rentals and validate:admin-inventory fail on any.
 * hasImage(slug) says whether an item has a photo (the repo file, or one uploaded in the admin).
 */
function validate(data, { hasImage = () => true } = {}) {
  const errors = [];
  const items = allItems(data);
  const rates = data.rates || {};
  if (!isInt(rates.day) || rates.day < 1 || rates.day > LIMITS.rate) errors.push(`The game day price must be a whole number of dollars from $1 to $${LIMITS.rate}.`);
  if (!isInt(rates.weekend) || rates.weekend < rates.day || rates.weekend > LIMITS.rate) errors.push('The game weekend price must be a whole number of dollars, at least the day price.');
  const seenSlug = new Set();
  const names = [];
  for (const { section, item: i } of items) {
    const label = i.name ? `"${i.name}"` : 'An item';
    if (!SLUG.test(String(i.slug || ''))) errors.push(`${label} has no usable web address name (slug).`);
    if (seenSlug.has(i.slug)) errors.push(`Two items share the web address name "${i.slug}".`);
    seenSlug.add(i.slug);
    const name = String(i.name || '').trim();
    if (name.length < 2 || name.length > LIMITS.name) errors.push(`${label}: the name must be 2 to ${LIMITS.name} letters.`);
    if (/[<>"]/.test(name)) errors.push(`${label}: the name cannot use < > or ".`);
    names.push({ name, slug: i.slug });
    if (!isInt(i.quantity) || i.quantity < 1 || i.quantity > LIMITS.quantity) errors.push(`${label}: "How many" must be a whole number from 1 to ${LIMITS.quantity}.`);
    // perSet (optional, owner 20 Oct 2026): games in one set (Giant Color Stack: a set of 2). Quantity still counts sets.
    if (i.perSet != null && (!isInt(i.perSet) || i.perSet < 2 || i.perSet > LIMITS.perSet)) errors.push(`${label}: "Games in one set" must be a whole number from 1 to ${LIMITS.perSet}.`);
    if (typeof i.availableNow !== 'boolean') errors.push(`${label}: it must be either available or removed.`);
    if (i.deposit != null && (!isInt(i.deposit) || i.deposit < 0 || i.deposit > LIMITS.deposit)) errors.push(`${label}: the deposit must be a whole number of dollars from $0 to $${LIMITS.deposit}.`);
    if (section === 'adminItems') {
      if (i.admin_only !== true) errors.push(`${label}: an admin-only item must say admin_only.`);
      continue;
    }
    if (i.admin_only) errors.push(`${label} is on the website list but marked admin only.`);
    if (!USES.includes(i.use)) errors.push(`${label}: pick indoor, outdoor or both.`);
    const size = String(i.size || '').trim();
    if (!size || size.length > LIMITS.size) errors.push(`${label}: the size line must be 1 to ${LIMITS.size} letters.`);
    const blurb = String(i.blurb || '').trim();
    if (blurb.length < 10 || blurb.length > LIMITS.blurb) errors.push(`${label}: the short description must be 10 to ${LIMITS.blurb} letters.`);
    const alt = String(i.alt || '').trim();
    if (alt.length < 10 || alt.length > LIMITS.alt) errors.push(`${label}: the photo description must be 10 to ${LIMITS.alt} letters.`);
    if (/\ball\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(games|items)\b/i.test(`${blurb} ${alt}`)) errors.push(`${label}: please do not write "all N games"; the bundles count the games by themselves.`);
    if (section === 'extras') {
      if (!isInt(i.dayPrice) || i.dayPrice < 1 || i.dayPrice > LIMITS.price) errors.push(`${label}: the day price must be a whole number of dollars from $1 to $${LIMITS.price}.`);
      if (!isInt(i.weekendPrice) || i.weekendPrice < i.dayPrice || i.weekendPrice > LIMITS.price) errors.push(`${label}: the weekend price must be a whole number of dollars, at least the day price.`);
      if (i.short != null && (!String(i.short).trim() || String(i.short).length > LIMITS.short)) errors.push(`${label}: the short name must be 1 to ${LIMITS.short} letters.`);
    }
    if (i.availableNow && !hasImage(i.slug)) errors.push(`${label}: add a photo before it goes on the website.`);
  }
  // Booking words are matched by name, so no name may hide inside another one or a bundle's.
  const bundleNames = (data.bundles || []).map((b) => String(b.name || ''));
  for (const a of names) {
    for (const b of names) {
      if (a.slug !== b.slug && a.name && b.name && a.name.toLowerCase() === b.name.toLowerCase()) errors.push(`Two items are both called "${a.name}". Give one a different name.`);
      else if (a.slug !== b.slug && a.name && b.name && a.name.length >= 4 && b.name.toLowerCase().includes(a.name.toLowerCase())) errors.push(`"${b.name}" contains the name of "${a.name}", so bookings would mix them up. Pick a different name.`);
    }
    for (const bn of bundleNames) if (a.name && bn && (a.name.toLowerCase().includes(bn.toLowerCase()) || bn.toLowerCase().includes(a.name.toLowerCase()))) errors.push(`"${a.name}" is too close to the bundle name "${bn}". Pick a different name.`);
  }
  if (!publicGames(data).length) errors.push('The website needs at least one game. Bring one back first.');
  // Bundles: derived fields must match the items (resolve() writes them, so a hand edit is caught).
  const want = resolve(data);
  for (const [k, b] of (data.bundles || []).entries()) {
    const w = want.bundles[k];
    if (b.allGames && (b.games !== w.games || b.includes !== w.includes)) errors.push(`The ${b.name} bundle must say "${w.includes}" and count ${w.games} games.`);
    if ((b.offBecause || '') !== (w.offBecause || '')) errors.push(`The ${b.name} bundle is ${w.offBecause ? `off the website because ${w.offBecause}` : 'on offer'}, but the file says otherwise.`);
    if (/\ball\s+(\d+|six|eight|seven|five)\s+(games|items)\b/i.test(`${b.includes} ${b.alt}`)) errors.push(`The ${b.name} bundle still says "all N games"; it must say "All games (available now: N)".`);
  }
  for (const g of data.games || []) if (g.bundleSets && g.bundleSets !== g.quantity) errors.push(`"${g.name}" counts ${g.bundleSets} sets in bundles but you have ${g.quantity}.`);
  if (!(data.bundles || []).filter((b) => b.allGames).length) errors.push('The all-games bundles (Whole Yard, The Whole Party) are missing their allGames mark.');
  return [...new Set(errors)];
}

// A new item in the shape its section's existing items have (key order kept for a clean diff).
function newItem(section, f) {
  const base = { slug: f.slug, name: f.name };
  if (section === 'adminItems') return { ...base, quantity: f.quantity, admin_only: true, availableNow: true, kind: f.kind || 'extra' };
  if (section === 'extras') {
    return { ...base, formChoice: f.name, dayPrice: f.dayPrice, weekendPrice: f.weekendPrice, size: f.size, use: f.use, quantity: f.quantity, availableNow: true, blurb: f.blurb, alt: f.alt };
  }
  return { ...base, size: f.size, use: f.use, quantity: f.quantity, availableNow: true, blurb: f.blurb, alt: f.alt, formChoice: f.name };
}

// A suggested photo description for a new item (Valerie edits it).
function suggestAlt(name, kind = 'game') {
  const n = String(name || 'the item').trim().toLowerCase();
  return kind === 'extra' ? `${n.charAt(0).toUpperCase()}${n.slice(1)} set up for a backyard party in Memphis` : `Black family and friends playing ${n} on a backyard lawn at a Memphis party`;
}

// The llms*.txt line for one public item.
function llmsLine(data, i, section) {
  const many = i.quantity > 1 ? ` (${words(i.quantity)} available)` : '';
  if (section === 'extras') return `- ${i.name}: ${money(i.dayPrice)} a day, ${money(i.weekendPrice)} a weekend. ${i.blurb}${many ? ` ${words(i.quantity).replace(/^./, (c) => c.toUpperCase())} available.` : ''}`;
  return `- ${i.llms || `${i.name}, ${i.size}`}${many}`;
}

module.exports = {
  SECTIONS, USES, LIMITS, slugify, joinAnd, allItems, publicGames, publicExtras, gameUnits, setsOf, available,
  extraPhrase, extraShort, extraThe, rentalsPhrase, ALL_GAMES_WORDS, bundleValue, bundleBlocker, resolve, offeredBundles,
  depositOf, stringify, hash, inventoryOf, merge, validate, newItem, suggestAlt, llmsLine, money, words, lcFirst,
};
