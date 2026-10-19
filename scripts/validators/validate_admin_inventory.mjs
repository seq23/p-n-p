#!/usr/bin/env node
/**
 * Settings -> Inventory (owner-approved 18 Oct 2026): Valerie adds, edits, removes and brings back
 * rental items; D1 is the live copy, every save auto-publishes into data/rentals/games.json.
 *
 * Drives the real guard + router over a fresh database (scenario inventory: the seed fixture) and
 * the publish pipeline with GitHub and the live site stubbed, and fails unless:
 *  1. seed: D1 is seeded from games.json on first use, row for row; exporting it and writing it
 *     back (scripts/inventory/apply_publish.mjs) round-trips the file byte for byte, for the
 *     fixture AND for the live data/rentals/games.json;
 *  2. add / edit / remove / bring back work through the Settings forms, each with its message,
 *     and the photo is stored with its EXIF stripped;
 *  3. an added item counts everywhere straight away: price table, /request form, the public
 *     availability answer, the booking picker, invoice prefill, the games-out grid and the weekly
 *     games count; the all-games bundles take it and say "All games (available now: N)", never
 *     "All N games"; Pick 3 / Pick 5 choices include it;
 *  4. a removed item leaves the website-side lists (price table, /request, availability, picker,
 *     prefill) but an old booking keeps it on its Day sheet and its edit form, its invoice keeps
 *     its lines, and Remove says how many future bookings have it;
 *  5. admin-only items are never public (price table, /request, availability, generated pages);
 *  6. save-time validation mirrors CI: every refused save returns exactly scripts/lib/inventory.js
 *     validate()'s sentences (the function validate:rentals runs on the committed file), leaves the
 *     database untouched, and each rule is proven to fire;
 *  7. publishing: with no GitHub key the change waits for the Inventory Poll round (pending
 *     endpoint hands over the whole inventory + new photos, once); signed reports move it along;
 *     only the live /rentals/ version gives "Live ✓" (dirty cleared, photo marked live); a failed
 *     run -> plain words + Try again; with a key the save starts the workflow at once; a dead key
 *     never blocks;
 *  8. the public photo route serves only stored photos, noindex.
 * Rule 0: fewer than 60 checks, or zero items in the live file or the fixture, is a failure.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const INV = createRequire(import.meta.url)('../lib/inventory.js');
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

const LIVE_TEXT = fs.readFileSync(path.join(ROOT, 'data/rentals/games.json'), 'utf8');
const FIX_TEXT = fs.readFileSync(path.join(ROOT, 'scripts/validators/fixtures/games.json'), 'utf8');
const LIVE = JSON.parse(LIVE_TEXT); const FIX = JSON.parse(FIX_TEXT);
const hasFile = (slug) => fs.existsSync(path.join(ROOT, 'assets/rentals', `${slug}.webp`));
must(INV.allItems(LIVE).length > 0 && INV.publicGames(LIVE).length > 0, 'data/rentals/games.json has zero items or zero public games');
must(INV.allItems(FIX).length > 0, 'the scenario fixture has zero items');
must(INV.validate(LIVE, { hasImage: hasFile }).length === 0, `the live games.json breaks the inventory rules: ${INV.validate(LIVE, { hasImage: hasFile }).join(' | ')}`);
must(INV.validate(FIX, { hasImage: hasFile }).length === 0, `the scenario fixture breaks the inventory rules: ${INV.validate(FIX, { hasImage: hasFile }).join(' | ')}`);
must(INV.stringify(INV.resolve(LIVE)) === LIVE_TEXT, 'data/rentals/games.json is not canonical and resolved (export would rewrite it)');

// ---- 1. Round trip: export -> apply_publish -> the same file, byte for byte ---------------
const { applyPublish } = await mod('scripts/inventory/apply_publish.mjs');
const P = await mod('functions/_lib/prices.mjs');
const I = await mod('functions/_lib/inventory.mjs');
const C = await mod('functions/_lib/calendar.mjs');
const F = await mod('functions/_lib/request-form.mjs');
const { prefillLines } = await mod('functions/_lib/pricing.mjs');
async function roundTrip(text, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-inv-'));
  const file = path.join(dir, 'games.json');
  fs.writeFileSync(file, text);
  const data = JSON.parse(text);
  const b64 = Buffer.from(JSON.stringify(INV.inventoryOf(INV.resolve(data)))).toString('base64');
  const r = await applyPublish({ inventoryB64: b64, photos: [], file, assetsDir: path.join(ROOT, 'assets/rentals') });
  must(fs.readFileSync(file, 'utf8') === text && r.changed === false, `${label}: export -> apply_publish does not round-trip games.json exactly`);
  must(r.version === I.versionOf(data), `${label}: apply_publish's version differs from the admin's`);
  fs.rmSync(dir, { recursive: true, force: true });
}
await roundTrip(FIX_TEXT, 'fixture');
await roundTrip(LIVE_TEXT, 'live games.json');

const s = await session();
const { db, get, post } = s;
const all = (sql, ...a) => db.prepare(sql).bind(...a).all().then((r) => r.results);
const one = (sql, ...a) => db.prepare(sql).bind(...a).first();

const settings0 = await get('/admin/settings');
must(settings0.status === 200 && /id="inventory"/.test(settings0.text), 'Settings has no Inventory section');
must(/href="#inventory"/.test(settings0.text), 'Settings top has no link to Inventory');
const seedRows = await all('SELECT slug, section, position, data FROM inventory_items ORDER BY section, position');
for (const sec of INV.SECTIONS) must(seedRows.filter((r) => r.section === sec).map((r) => r.slug).join() === (FIX[sec] || []).map((i) => i.slug).join(), `seed: D1 ${sec} rows are not the games.json ${sec}, in order`);
must(seedRows.every((r) => JSON.stringify(JSON.parse(r.data)) === JSON.stringify(INV.allItems(FIX).find((x) => x.item.slug === r.slug).item)), 'seed: a D1 row is not its games.json object');
const st0 = await I.loadInventory(db);
must(INV.stringify(st0.data) === FIX_TEXT, 'seed: D1 merged over the bundled file does not export the bundled file exactly');
must((settings0.text.match(/data-inv-item=/g) || []).length === INV.allItems(FIX).length, 'Settings does not list every inventory item');
must(/data-inv-section="adminItems"[^>]*>[\s\S]*?Admin only/.test(settings0.text) && /On the website/.test(settings0.text), 'Settings does not say "On the website" / "Admin only"');
must(/Bring back/.test(settings0.text) && /data-inv-state="removed"/.test(settings0.text), 'removed items do not show with Bring back');
must(/Add an item/.test(settings0.text) && /data-inv-status/.test(settings0.text), 'Settings lacks Add an item or the website-update box');
must(/Whole Yard and The Whole Party include every game on the website: <strong>All games \(available now: 6\)<\/strong>/.test(settings0.text), 'Settings does not say what the all-games bundles hold');
const day0 = await get(`/admin/day/${s.util.todayISO(3)}`);
must(/href="\/admin\/settings#inventory"[^>]*data-help="inv.fromGrid"/.test(day0.text), 'the games-out grid has no link to Inventory');

// ---- 2/3. Add a game with a photo ----------------------------------------------------------
const exifJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x0c, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50, 0x53, 0x21, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
const photo = new File([exifJpeg], 'IMG_0001.jpg', { type: 'image/jpeg' });
const jenga = { kind: 'game', name: 'Giant Jenga', quantity: '1', deposit: '50', blurb: 'The giant wooden block tower. Pull a block, stack it on top, and keep it standing.', size: '60 blocks, stacks to 4 ft', use: 'both', alt: 'Black teenagers pulling a block from a giant wooden block tower on a backyard lawn', on_website: ['0', '1'] };
const newForm = await get('/admin/settings/inventory/new');
must(newForm.status === 200 && /name="photo"/.test(newForm.text) && /name="alt"/.test(newForm.text) && /data-suggest="Black family and friends playing/.test(newForm.text) && /name="on_website" value="1" checked/.test(newForm.text), 'the Add form lacks the photo upload, the suggested alt text or the Show on website switch (on by default)');
for (const f of ['name', 'quantity', 'day_price', 'weekend_price', 'deposit', 'blurb', 'size', 'use', 'kind']) must(new RegExp(`name="${f}"`).test(newForm.text), `the Add form lacks ${f}`);
const rev0 = (await one("SELECT value FROM inventory_meta WHERE key = 'rev'")).value;
// Refused first: no photo.
const noPhoto = await post('/admin/settings/inventory/new', jenga);
must(noPhoto.status === 422 && /add a photo before it goes on the website/.test(noPhoto.text), 'a public item without a photo was not refused with a plain message');
must((await one("SELECT value FROM inventory_meta WHERE key = 'rev'")).value === rev0 && !(await one("SELECT slug FROM inventory_items WHERE slug = 'giant-jenga'")), 'a refused save changed the database');
const added = await post('/admin/settings/inventory/new', { ...jenga, photo });
must(added.status === 303 && /#inventory$/.test(added.location) && /Saved/.test(decodeURIComponent(added.location)), `Add did not save and go back to Settings (${added.status} ${added.location})`);
const jrow = await one("SELECT section, data, photo_sha, photo_live FROM inventory_items WHERE slug = 'giant-jenga'");
must(jrow && jrow.section === 'games' && jrow.photo_sha && jrow.photo_live === 0, 'the new game is not a games row with a pending photo');
const ph = jrow ? await one('SELECT bytes FROM inventory_photos WHERE sha = ?1', jrow.photo_sha) : null;
must(ph && !Buffer.from(ph.bytes).includes(Buffer.from('Exif')) && !Buffer.from(ph.bytes).includes(Buffer.from('GPS!')), 'the stored photo still carries its EXIF block');
const ji = JSON.parse(jrow.data);
must(ji.formChoice === 'Giant Jenga' && ji.availableNow === true && ji.quantity === 1 && !('deposit' in ji), 'the new item object is not shaped like the other games (formChoice, availableNow, no default deposit)');
must(P.PRICE_TABLE.items.some((i) => i.slug === 'giant-jenga' && i.dayCents === FIX.rates.day * 100), 'the new game is not in the price table at the game rate');
const req = await s.siteRequest; void req;
// Each public entry point must load the live inventory itself (another isolate may serve it): reset
// the tables to the bundled file first.
const fresh = () => P.applyInventory(P.BUNDLED_GAMES);
fresh();
const reqPage = await (await s.RS.handleRequestPage({ request: new Request('https://porchandparty901.com/request?service=rentals'), env: s.env, params: {} })).text();
must(reqPage.includes('Giant Jenga'), 'the /request form does not offer the new game');
fresh();
const avail = await (await s.RS.handleAvailability({ request: new Request(`https://porchandparty901.com/api/request/availability?event=${s.util.todayISO(20)}&pickup_when=morning&return_when=after&duration=day`), env: s.env })).json();
must(avail.left && avail.left['giant-jenga'] === 1, 'the public availability answer does not count the new game');
const picker = await get(`/admin/calendar/new?date=${s.util.todayISO(20)}`);
must(/data-item="Giant Jenga"/.test(picker.text), 'the booking picker does not offer the new game');
const wy = P.PRICE_TABLE.bundles.find((b) => b.slug === 'whole-yard');
must(wy && wy.games === 7 && P.GAMES.bundles.find((b) => b.slug === 'whole-yard').includes === 'All games (available now: 7)', 'Whole Yard does not take the new game ("All games (available now: 7)")');
must(P.GAMES.bundles.find((b) => b.slug === 'whole-party').includes === 'All games (available now: 7), the movie screen and the card table', 'The Whole Party does not take the new game');
must(!/\ball\s+(\d+|seven|six)\s+(games|items)\b/i.test(JSON.stringify(P.GAMES.bundles.map((b) => [b.includes, b.alt]))), 'a bundle still says "All N games"');
const wyLines = prefillLines({ wantsRentals: true, gamesAnswer: 'Whole Yard, all 6 games ($195)', durationAnswer: 'One day (24 hours)' }, P.PRICE_TABLE);
must(/Giant Jenga/.test(wyLines[0].description) && /Giant Color Stack \(2 sets\)/.test(wyLines[0].description), `a Whole Yard invoice does not carry the new game and both Color Stack sets: "${wyLines[0].description}"`);
must(C.expandItems('Whole Yard bundle', P.TRACK_TABLE).names.includes('Giant Jenga'), 'bundle counting (availability) does not include the new game in Whole Yard');
const p3 = prefillLines({ wantsRentals: true, gamesAnswer: 'Pick 3 bundle ($110), Giant Jenga, Giant Uno, Cornhole set', durationAnswer: 'One day (24 hours)' }, P.PRICE_TABLE);
must(/^Pick 3 bundle, 1 day: .*Giant Jenga/.test(p3[0].description), 'a Pick 3 cannot include the new game');
const single = prefillLines({ wantsRentals: true, gamesAnswer: 'Giant Jenga', durationAnswer: 'One day (24 hours)' }, P.PRICE_TABLE);
must(single.some((l) => l.description.startsWith('Giant Jenga') && l.unit_cents === FIX.rates.day * 100), 'the invoice prefill does not price the new game');
await post('/admin/calendar/bookings', { kind: 'rental_pickup', date: s.util.todayISO(5), return_date: s.util.todayISO(6), customer_name: 'Jen Jenga', phone: '901-555-0101', email: '', place: '', items: 'Giant Jenga' });
const usage = C.usageOn(C.rentalWindows(await C.listBookings(db), {}, P.TRACK_TABLE), s.util.todayISO(5), s.util.todayISO(0), P.TRACK_TABLE);
must(usage.byItem['Giant Jenga'] && usage.byItem['Giant Jenga'].used === 1 && usage.count >= 1, 'the games-out grid / weekly count does not count the new game');
const dayJ = await get(`/admin/day/${s.util.todayISO(5)}`);
must(/<strong>Giant Jenga<\/strong><span>Out/.test(dayJ.text), 'the Day sheet grid does not show the new game Out');

// ---- Edit -------------------------------------------------------------------------------
const editPage = await get('/admin/settings/inventory/giant-uno');
must(editPage.status === 200 && /value="Giant Uno"/.test(editPage.text) && /Every game is \$40 a day/.test(editPage.text), 'the Edit form does not open with the item and the shared game price');
const uno = JSON.parse((await one("SELECT data FROM inventory_items WHERE slug = 'giant-uno'")).data);
const unoForm = { kind: 'game', name: uno.name, quantity: String(uno.quantity), deposit: '50', blurb: uno.blurb, size: uno.size, use: uno.use, alt: uno.alt, on_website: ['0', '1'] };
const ver0 = (await I.loadInventory(db)).version;
const noop = await post('/admin/settings/inventory/giant-uno', unoForm);
must(noop.status === 303 && (await I.loadInventory(db)).version === ver0, 'a no-change save changed the inventory version');
must(JSON.parse((await one("SELECT data FROM inventory_items WHERE slug = 'giant-uno'")).data).formChoice === uno.formChoice, 'a save lost the item\'s form string');
const edited = await post('/admin/settings/inventory/giant-uno', { ...unoForm, quantity: '2', deposit: '75' });
const uno2 = JSON.parse((await one("SELECT data FROM inventory_items WHERE slug = 'giant-uno'")).data);
must(edited.status === 303 && uno2.quantity === 2 && uno2.deposit === 75, 'Edit did not save how many and the deposit');
must(P.PRICE_TABLE.items.find((i) => i.slug === 'giant-uno').depositCents === 7500, 'the price table does not carry the item deposit');
const unoInv = prefillLines({ wantsRentals: true, gamesAnswer: 'Giant Uno, Card table with cup holders', durationAnswer: 'One day (24 hours)' }, P.PRICE_TABLE);
must(unoInv.filter((l) => l.refundable).length === 1 && unoInv.find((l) => l.refundable).unit_cents === 7500, 'an order does not pay one deposit, the biggest among its items');
await post('/admin/settings/inventory/giant-uno', unoForm); // back to 1 / $50

// ---- 4. Remove (with a future booking) and Bring back ----------------------------------------
const inv1 = await s.invoiceFor(s.requests.find((r) => r.email === 'test.renter@example.com'));
const linesBefore = await all('SELECT description FROM invoice_lines WHERE invoice_id = ?1 ORDER BY id', inv1.id);
await post('/admin/calendar/bookings', { kind: 'rental_pickup', date: s.util.todayISO(9), return_date: s.util.todayISO(10), customer_name: 'Una Uno', phone: '901-555-0102', email: '', place: '', items: 'Giant Uno' });
const unoBooking = await one("SELECT id FROM bookings WHERE customer_name = 'Una Uno' AND kind = 'rental_pickup'");
const nUno = (await I.futureBookingsFor(db, 'Giant Uno', s.util.todayISO(0), P.TRACK_TABLE)).length;
must(nUno >= 1, 'the future booking with Giant Uno is not found');
const st1 = await get('/admin/settings');
must(st1.text.includes(`Remove Giant Uno? ${nUno} future ${nUno === 1 ? 'booking has' : 'bookings have'} it. ${nUno === 1 ? 'It keeps' : 'They keep'} it.`), 'Remove does not say plainly how many future bookings have the item');
const removed = await post('/admin/settings/inventory/giant-uno/remove', {});
must(removed.status === 303 && decodeURIComponent(removed.location).includes(`Giant Uno is removed ✓ ${nUno} future ${nUno === 1 ? 'booking keeps' : 'bookings keep'} it.`), `Remove did not confirm with the booking count (${decodeURIComponent(removed.location)})`);
must(JSON.parse((await one("SELECT data FROM inventory_items WHERE slug = 'giant-uno'")).data).availableNow === false, 'Remove did not set availableNow false (soft remove)');
must(!P.PRICE_TABLE.items.some((i) => i.slug === 'giant-uno'), 'a removed item is still in the price table');
fresh();
const reqPage2 = await (await s.RS.handleRequestPage({ request: new Request('https://porchandparty901.com/request?service=rentals'), env: s.env, params: {} })).text();
must(!reqPage2.includes('Giant Uno'), 'a removed item is still on the /request form');
fresh();
const avail2 = await (await s.RS.handleAvailability({ request: new Request(`https://porchandparty901.com/api/request/availability?event=${s.util.todayISO(20)}&pickup_when=morning&return_when=after&duration=day`), env: s.env })).json();
must(avail2.left && !('giant-uno' in avail2.left), 'a removed item is still in the public availability answer');
const picker2 = await get(`/admin/calendar/new?date=${s.util.todayISO(20)}`);
must(!/data-item="Giant Uno"/.test(picker2.text), 'a removed item is still in the booking picker');
const oldEdit = await get(`/admin/calendar/bookings/${unoBooking.id}/edit`);
must(/data-item="Giant Uno"><input type="checkbox" name="item" value="Giant Uno" checked/.test(oldEdit.text), 'a booking made before the removal lost the item on its edit form');
const dayU = await get(`/admin/day/${s.util.todayISO(9)}`);
must(/<strong>Giant Uno<\/strong><span>Out/.test(dayU.text), 'a booking made before the removal does not show the item Out on its Day sheet');
const dayEmpty = await get(`/admin/day/${s.util.todayISO(30)}`);
must(!/<strong>Giant Uno<\/strong>/.test(dayEmpty.text), 'a removed item shows on a Day sheet where nothing has it');
must(JSON.stringify(await all('SELECT description FROM invoice_lines WHERE invoice_id = ?1 ORDER BY id', inv1.id)) === JSON.stringify(linesBefore), 'removing an item changed an existing invoice');
must(!prefillLines({ wantsRentals: true, gamesAnswer: 'Giant Uno', durationAnswer: 'One day (24 hours)' }, P.PRICE_TABLE).some((l) => l.description.startsWith('Giant Uno')), 'a removed item is still priced by the invoice prefill');
must(P.GAMES.bundles.find((b) => b.slug === 'whole-yard').includes === 'All games (available now: 6)', 'Whole Yard does not drop a removed game');
const back = await post('/admin/settings/inventory/giant-uno/restore', {});
must(back.status === 303 && P.PRICE_TABLE.items.some((i) => i.slug === 'giant-uno') && /Giant Uno is back/.test(decodeURIComponent(back.location)), 'Bring back did not put the item back');

// A save of the admin-only Projector with nothing changed changes nothing (19 Oct 2026: the first
// production round trip added "use" and "kind" to it).
{
  const pj = JSON.parse((await one("SELECT data FROM inventory_items WHERE slug = 'projector'")).data);
  const v0 = (await I.loadInventory(db)).version;
  const r = await post('/admin/settings/inventory/projector', { kind: 'extra', name: pj.name, quantity: String(pj.quantity), deposit: '', blurb: pj.blurb || '', size: pj.size || '', use: pj.use || 'both', alt: pj.alt || '', on_website: '0' });
  must(r.status === 303 && (await I.loadInventory(db)).version === v0, 'a no-change save of an admin-only item changed the inventory');
}

// ---- 5. Admin only ---------------------------------------------------------------------------
must(P.TRACK_TABLE.items.some((i) => i.slug === 'projector' && i.adminOnly) && !P.PRICE_TABLE.items.some((i) => i.slug === 'projector'), 'the admin-only Projector is priced or not tracked');
const toAdmin = await post('/admin/settings/inventory/giant-jenga', { ...jenga, on_website: '0' });
must(toAdmin.status === 303 && (await one("SELECT section FROM inventory_items WHERE slug = 'giant-jenga'")).section === 'adminItems', 'switching Show on website off did not make the item admin only');
must(!P.PRICE_TABLE.items.some((i) => i.slug === 'giant-jenga') && P.TRACK_TABLE.items.some((i) => i.slug === 'giant-jenga' && i.adminOnly), 'an admin-only item is public or untracked');
fresh();
const reqPage3 = await (await s.RS.handleRequestPage({ request: new Request('https://porchandparty901.com/request?service=rentals'), env: s.env, params: {} })).text();
fresh();
const avail3 = await (await s.RS.handleAvailability({ request: new Request(`https://porchandparty901.com/api/request/availability?event=${s.util.todayISO(20)}&pickup_when=morning&return_when=after&duration=day`), env: s.env })).json();
must(!reqPage3.includes('Giant Jenga') && !('giant-jenga' in (avail3.left || {})) && !('projector' in (avail3.left || {})), 'an admin-only item reaches the /request form or the availability answer');
must(P.GAMES.bundles.find((b) => b.slug === 'whole-yard').includes === 'All games (available now: 6)', 'an admin-only game is counted in the all-games bundles');
await post('/admin/settings/inventory/giant-jenga', { ...jenga, on_website: ['0', '1'] });
must((await one("SELECT section FROM inventory_items WHERE slug = 'giant-jenga'")).section === 'games', 'switching Show on website back on did not make the item public');
// The generators read games and extras only; the live pages name no admin-only item.
for (const rel of ['scripts/generators/build_rentals_page.js', 'scripts/generators/build_llms_rentals.js', 'scripts/lib/faq_content.js', 'scripts/install_brand_surfaces.js']) must(!/adminItems/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\(data\.adminItems \|\| \[\]\)\.some\(\(x\) => x\.slug === 'projector'[^)]*\)/, '')), `${rel} reads adminItems`);
for (const rel of ['rentals/index.html', 'llms.txt', 'llms-full.txt', 'llms-services.txt', 'faq/index.html']) for (const a of LIVE.adminItems || []) must(!new RegExp(`>\\s*${a.name}\\b|"name":"${a.name} rental"|^- ${a.name}`, 'm').test(fs.readFileSync(path.join(ROOT, rel), 'utf8')), `${rel} lists the admin-only ${a.name} as a rental`);

// ---- 6. Save-time validation mirrors CI -----------------------------------------------------
const revA = (await one("SELECT value FROM inventory_meta WHERE key = 'rev'")).value;
const bad = [
  ['quantity 0', { ...jenga, name: 'Giant Dominoes', quantity: '0', photo }, /"How many" must be a whole number/],
  ['name inside another', { ...jenga, name: 'Giant Uno Deluxe', photo }, /contains the name of "Giant Uno"/],
  ['bundle name', { ...jenga, name: 'Game Night Kit', photo }, /too close to the bundle name "Game Night"/],
  ['all N games', { ...jenga, name: 'Ring Toss', blurb: 'Fun for everyone; goes with all 6 games we have.', photo }, /do not write "all N games"/],
  ['short description', { ...jenga, name: 'Ring Toss', blurb: 'Fun', photo }, /short description must be/],
  ['extra price', { ...jenga, kind: 'extra', name: 'Bubble Machine', day_price: '20', weekend_price: '10', photo }, /weekend price must be a whole number of dollars, at least the day price/],
  ['duplicate', { ...jenga, photo }, /There is already an item called "Giant Jenga"/],
];
for (const [label, form, re] of bad) {
  const r = await post('/admin/settings/inventory/new', form);
  const t = r.text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  must(r.status === 422 && re.test(t) && /Not saved yet/.test(t), `save-time rule "${label}" did not refuse with its plain sentence (${r.status})`);
}
must((await one("SELECT value FROM inventory_meta WHERE key = 'rev'")).value === revA, 'a refused save changed the inventory');
// The same sentences as CI: build the candidate the admin would save and run validate() on it.
{
  const cand = INV.resolve(JSON.parse(JSON.stringify(P.GAMES)));
  cand.games.push(INV.newItem('games', { slug: 'giant-uno-deluxe', name: 'Giant Uno Deluxe', size: 'x', use: 'both', quantity: 1, blurb: 'A long enough description.', alt: 'A long enough photo description.' }));
  const ci = INV.validate(INV.resolve(cand), { hasImage: () => true });
  const r = await post('/admin/settings/inventory/new', { ...jenga, name: 'Giant Uno Deluxe', size: 'x', blurb: 'A long enough description.', alt: 'A long enough photo description.', photo });
  must(ci.length > 0 && ci.every((e) => r.text.includes(e.replace(/&/g, '&amp;').replace(/"/g, '&quot;'))), 'the admin refusal is not word for word the CI rule');
}
for (const [rel, re] of [['scripts/validators/validate_rentals_page.js', /INV\.validate\(RAW/], ['functions/_lib/inventory.mjs', /INV\.validate\(candidate/], ['scripts/inventory/apply_publish.mjs', /INV\.validate\(next/]]) must(re.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')), `${rel} does not run scripts/lib/inventory.js validate()`);
// Each rule fires (negative proofs on a copy of the fixture).
const breakIt = (fn) => { const d = JSON.parse(FIX_TEXT); fn(d); return INV.validate(INV.resolve(d), { hasImage: hasFile }); };
must(breakIt((d) => { d.games.forEach((g) => { g.availableNow = false; }); }).some((e) => /at least one game/.test(e)), 'zero public games is not refused');
must(breakIt((d) => { d.games[0].name = d.games[1].name; }).some((e) => /both called/.test(e)), 'two items with one name is not refused');
must(breakIt((d) => { d.games.push({ ...d.games[0], slug: 'no-photo-game', name: 'Zany Zebra Toss' }); }).some((e) => /add a photo/.test(e)), 'a public item with no photo is not refused');
must(breakIt((d) => { d.rates.weekend = d.rates.day - 1; }).some((e) => /weekend price/.test(e)), 'a weekend game price under the day price is not refused');
must(INV.validate((() => { const d = INV.resolve(JSON.parse(FIX_TEXT)); d.bundles.find((b) => b.slug === 'whole-yard').includes = 'All 6 games'; return d; })(), { hasImage: hasFile }).some((e) => /must say "All games \(available now: 6\)"/.test(e)), '"All 6 games" bundle wording is not refused');
must(INV.validate((() => { const d = INV.resolve(JSON.parse(FIX_TEXT)); d.adminItems[0].admin_only = false; return d; })(), { hasImage: hasFile }).some((e) => /admin only|admin_only/.test(e)), 'an admin item without admin_only is not refused');
{
  const d = JSON.parse(FIX_TEXT); d.games.forEach((g) => { if (g.slug !== 'giant-connect-four' && g.slug !== 'cornhole' && g.slug !== 'giant-uno') g.availableNow = false; });
  const r = INV.resolve(d);
  must(r.bundles.find((b) => b.slug === 'pick-5').offBecause && !INV.offeredBundles(r).some((b) => b.slug === 'pick-5') && r.bundles.find((b) => b.slug === 'whole-yard').includes === 'All games (available now: 3)', 'with 3 games, Pick 5 is still offered or Whole Yard miscounts');
}

// ---- 7. Publishing ----------------------------------------------------------------------------
// No GitHub key in Cloudflare (today): the save waits for the Inventory Poll round.
const stNoKey = await get('/admin/settings');
must(stNoKey.text.includes('Website auto-update needs a GitHub key (PNP_GITHUB_TOKEN) to start at once.'), 'with no GitHub key, Settings does not show the named stop');
must(/data-state="queued"/.test(stNoKey.text) && stNoKey.text.includes('Website updating… (it starts within 5 minutes)'), 'with no GitHub key, Settings does not say the update starts within 5 minutes');
const pend = await (await I.handlePending({ env: s.env })).json();
const stNow0 = await I.loadInventory(db);
must(pend.pending === true && pend.version === stNow0.version && JSON.stringify(JSON.parse(Buffer.from(pend.inventory, 'base64').toString('utf8'))) === JSON.stringify(INV.inventoryOf(stNow0.data)), 'GET /api/inventory/pending does not hand the poll the whole waiting inventory');
must(pend.photos.some((p) => p.slug === 'giant-jenga' && p.sha === jrow.photo_sha), 'the pending change does not carry the new photo');
must(!/customer|phone|email|request_key/i.test(JSON.stringify(Object.keys(pend))) && !/@/.test(Buffer.from(pend.inventory, 'base64').toString('utf8')), 'the pending change carries more than the inventory');
const poll = fs.readFileSync(path.join(ROOT, '.github/workflows/inventory-poll.yml'), 'utf8');
must(/cron: "\*\/5 \* \* \* \*"/.test(poll) && /\/api\/inventory\/pending/.test(poll) && /grep -qx "Inventory publish #\$id"/.test(poll) && /gh workflow run inventory-publish\.yml/.test(poll) && /actions: write/.test(poll), 'the Inventory Poll workflow does not poll every 5 minutes, skip a started change and start Inventory Publish');
const pubWf = fs.readFileSync(path.join(ROOT, '.github/workflows/inventory-publish.yml'), 'utf8');
must(pubWf.includes('run-name: "Inventory publish #${{ inputs.publish_id }}"') && /scripts\/inventory\/apply_publish\.mjs/.test(pubWf) && /scripts\/inventory\/regenerate\.mjs/.test(pubWf) && /npm run validate:release/.test(pubWf) && /report\.sh failed/.test(pubWf), 'the Inventory Publish workflow lacks its run name, apply, regenerate, validate:release or failure report');
must(fs.readFileSync(path.join(ROOT, '.github/workflows/deploy-distribution.yml'), 'utf8').includes('"Inventory Publish"]'), 'deploy-distribution does not validate and announce Inventory Publish commits');
// The signed report.
s.env.PNP_INVENTORY_REPORT_KEY = 'test-report-key';
const crypto = await import('node:crypto');
const report = async (state, { key = 'test-report-key', id = pend.publish_id, ts = Math.floor(Date.now() / 1000) } = {}) => {
  const body = JSON.stringify({ publish_id: id, state, run_url: 'https://github.com/seq23/p-n-p/actions/runs/7', ts });
  const sig = crypto.createHmac('sha256', key).update(body).digest('hex');
  return I.handleReportRoute({ request: new Request('https://porchandparty901.com/api/inventory/report', { method: 'POST', body, headers: { 'X-PNP-Signature': sig } }), env: s.env });
};
must((await report('started', { key: 'wrong' })).status === 403 && (await report('started', { ts: 1 })).status === 403, 'an unsigned or stale report was accepted');
must((await report('started')).status === 200 && (await one('SELECT status FROM inventory_publishes WHERE id = ?1', pend.publish_id)).status === 'running', 'a signed "started" report does not show the update running');
must((await (await I.handlePending({ env: s.env })).json()).pending === false, 'a started change is still pending (the poll would start it twice)');
const calls = [];
let liveVer = '';
s.env.PNP_FETCH = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  if (/\/rentals\/\?inventory=/.test(url)) return new Response(`<html><head><meta name="pnp-inventory" content="${liveVer}" /></head></html>`, { status: 200 });
  return new Response('?', { status: 404 });
};
await report('pushed');
let status = JSON.parse((await get('/api/admin/inventory/status')).text);
must(status.state === 'deploying' && status.text === 'Website updating…', `a pushed run is not "Website updating…" until the page is live (${status.state})`);
liveVer = stNow0.version;
status = JSON.parse((await get('/api/admin/inventory/status')).text);
must(status.state === 'live' && status.text === 'Live ✓', `the live /rentals/ version did not reach "Live ✓" (${status.state})`);
must((await one("SELECT value FROM inventory_meta WHERE key = 'dirty'")).value === '0' && (await one("SELECT photo_live FROM inventory_items WHERE slug = 'giant-jenga'")).photo_live === 1, 'Live ✓ did not clear the waiting change or mark the photo live');
must(/data-state="live"/.test((await get('/admin/settings')).text) && (await (await I.handlePending({ env: s.env })).json()).pending === false, 'Settings does not show Live ✓, or the change is still pending');
// A failed run: plain words and Try again (a new update the poll picks up).
await post('/admin/settings/inventory/rates', { rate_day: '40', rate_weekend: '60' });
const failedId = (await one('SELECT id FROM inventory_publishes ORDER BY id DESC LIMIT 1')).id;
await report('failed', { id: failedId });
status = JSON.parse((await get('/api/admin/inventory/status')).text);
must(status.state === 'failed' && /did not update/.test(status.text) && /Your change is saved/.test(status.text), 'a failed run is not reported in plain words');
must(/Try again/.test((await get('/admin/settings')).text), 'a failed update offers no Try again');
const again = await post('/admin/settings/inventory/publish', {});
const againRow = await one('SELECT id, status FROM inventory_publishes ORDER BY id DESC LIMIT 1');
must(again.status === 303 && againRow.id > failedId && againRow.status === 'queued' && (await (await I.handlePending({ env: s.env })).json()).publish_id === againRow.id, 'Try again does not queue a new update for the poll');
// With the optional key: the save starts the workflow at once, carrying the whole inventory.
s.env.PNP_GITHUB_TOKEN = 'test-token';
s.env.PNP_FETCH = async (url, init = {}) => { calls.push({ url: String(url), init }); return /\/dispatches$/.test(url) ? new Response(null, { status: 204 }) : new Response('?', { status: 404 }); };
await post('/admin/settings/inventory/publish', {});
const pub = await one('SELECT * FROM inventory_publishes ORDER BY id DESC LIMIT 1');
const disp = calls.reverse().find((c) => /\/actions\/workflows\/inventory-publish\.yml\/dispatches$/.test(c.url));
const body = disp ? JSON.parse(disp.init.body) : {};
must(pub.status === 'running' && disp && body.ref === 'main' && body.inputs.publish_id === String(pub.id) && /^Bearer test-token$/.test(disp.init.headers.Authorization), 'with a GitHub key, a save does not start Inventory Publish at once');
must(body.inputs && JSON.stringify(JSON.parse(Buffer.from(body.inputs.inventory, 'base64').toString('utf8'))) === JSON.stringify(INV.inventoryOf((await I.loadInventory(db)).data)), 'the instant start does not carry the whole inventory');
// A dead key never blocks: the change waits for the poll.
s.env.PNP_FETCH = async (url) => (/\/dispatches$/.test(url) ? new Response('bad', { status: 401 }) : new Response('', { status: 404 }));
await post('/admin/settings/inventory/publish', {});
must((await one('SELECT status FROM inventory_publishes ORDER BY id DESC LIMIT 1')).status === 'queued' && (await (await I.handlePending({ env: s.env })).json()).pending === true, 'a dead GitHub key blocks the website update instead of leaving it to the poll');
delete s.env.PNP_GITHUB_TOKEN;
must(/Game price \(every game is the same price\)/.test((await get('/admin/settings')).text), 'Settings lacks the game price form');
const rates = await post('/admin/settings/inventory/rates', { rate_day: '45', rate_weekend: '30' });
must(/weekend price must be a whole number/.test(decodeURIComponent(rates.location)), 'a bad game price was not refused');

// ---- 8. The public photo route ---------------------------------------------------------------
const { handlePhoto } = I;
const okPhoto = await handlePhoto({ params: { sha: jrow.photo_sha }, env: s.env });
must(okPhoto.status === 200 && okPhoto.headers.get('Content-Type') === 'image/jpeg' && okPhoto.headers.get('X-Robots-Tag') === 'noindex', 'the photo route does not serve a stored photo, noindex');
must((await handlePhoto({ params: { sha: 'f'.repeat(40) }, env: s.env })).status === 404 && (await handlePhoto({ params: { sha: '../../etc' }, env: s.env })).status === 404, 'the photo route answers for a photo it does not have');

// ---- How it works / help ----------------------------------------------------------------------
const help = await get('/admin/help');
for (const k of ['inv.add', 'inv.edit', 'inv.remove', 'inv.restore', 'inv.save', 'inv.photo', 'inv.onWebsite', 'inv.retry', 'inv.rates']) must(help.text.includes(`data-help-entry="${k}"`), `/admin/help lacks ${k}`);
must(/data-help-inventory/.test(help.text), '/admin/help has no "Your rental items (Inventory)" how-it-works section');

if (checks < 60) errors.push(`only ${checks} checks ran; want at least 60`);
if (errors.length) {
  console.error(`VALIDATION FAIL: admin inventory (${errors.length} of ${checks} checks)`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`Admin inventory OK: ${checks} checks; seed of ${INV.allItems(FIX).length} items round-trips (fixture and live ${INV.allItems(LIVE).length} items); add / edit / remove / bring back, admin only, bundles "All games (available now: N)", save rules = CI rules, poll + signed reports -> Live ✓ (only from the live page), failure + Try again.`);
