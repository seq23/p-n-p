#!/usr/bin/env node
/**
 * Admin on a phone (owner-approved mock-up, 20 Oct 2026; docs/admin-console.md "On a phone").
 *
 * Fails unless:
 *  1. Inventory In / Out: a game out today has a solid RED "OUT" pill (class out), a game in has a
 *     solid GREEN "IN" pill ("IN 2", "1 of 2 IN"), a Not offered item a grey "NOT OFFERED" (class
 *     off); Giant Color Stack (a set of 2 games, perSet) reads "IN 2 sets (4 games)" / "1 of 2 sets
 *     IN"; the rows come from itemStatuses (the one bookings matcher), never a second list;
 *  2. the OUT now / IN tiles are the FIRST thing on the Inventory page, before the list, and the
 *     list (Out games with who + back day, then In, then Not offered) comes before the folded
 *     editing tools (<details>, shut unless a save message is showing);
 *  3. the tiles count units (sets), live from the inventory + bookings: adding an item, bumping a
 *     quantity and switching an item to Not offered all move the totals; Not offered counts in neither;
 *  4. every request card with a phone number has 📞 Call (tel:) and 💬 Text (sms:, blank body) in
 *     its header, and a card without one has neither;
 *  5. Open ID photo never opens a new tab: it opens over the card (the viewer with ✕ Close), and
 *     without JS a same-tab page with the admin bar, the photo from the private no-store route,
 *     and Back to the card;
 *  6. every admin screen has the same top bar (← Back, where you are), and the actions that land
 *     on Requests (save, mark paid, job done, ID delete / add, invoice status) carry #c-<card>.
 * Rule 0: fewer than 60 checks is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

const P = await mod('functions/_lib/prices.mjs');
const C = await mod('functions/_lib/calendar.mjs');
const I = await mod('functions/_lib/inventory.mjs');
const V = await mod('functions/_lib/views.mjs');
const VI = await mod('functions/_lib/views-inventory.mjs');
const PR = await mod('functions/_lib/pricing.mjs');
const { chicagoDate } = await mod('functions/_lib/reminders.mjs');
const { shortDate } = await mod('functions/_lib/util.mjs');
const T = P.TRACK_TABLE;
const DATA = P.GAMES;

// ---- 3. Totals: units, live, Not offered excluded --------------------------------------------
const bk = (key, name, start, end, items) => [
  { id: 0, kind: 'rental_pickup', date: start, request_key: key, customer_name: name, items },
  { id: 0, kind: 'rental_return', date: end, request_key: key, customer_name: name, items },
];
const fsx = await import('node:fs');
const readJson = (rel) => JSON.parse(fsx.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const SERVICES = readJson('data/offers/services.json');
const PORCH = readJson('data/offers/porch_packages.json');
const tableFor = (data) => PR.buildTrackTable(PR.buildPriceTable(data, SERVICES, PORCH), data);
const statusesFor = (data, bookings, today) => { const t = tableFor(data); return I.itemStatuses({ table: t, data, windows: C.rentalWindows(bookings, {}, t), today }); };
const units = (data) => [...(data.games || []), ...(data.extras || []), ...(data.adminItems || [])].filter((i) => i.availableNow !== false).reduce((n, i) => n + (i.quantity || 1), 0);
let tableOk = true;
try { tableFor(DATA); } catch { tableOk = false; }
const clone = (x) => JSON.parse(JSON.stringify(x));
if (tableOk) {
  const day = '2026-11-05';
  const none = I.inventoryTotals(statusesFor(DATA, [], day));
  must(none.out === 0 && none.in === units(DATA), `totals with nothing booked are ${JSON.stringify(none)}, not 0 out / ${units(DATA)} in (every offered unit, quantities counted)`);
  const stackQty = DATA.games.find((g) => g.slug === 'giant-color-stack').quantity;
  must(stackQty === 2, 'the fixture Giant Color Stack is not 2 sets');
  const oneOut = I.inventoryTotals(statusesFor(DATA, bk('k1', 'Ana Bee', day, '2026-11-06', 'Giant Color Stack, Giant Uno'), day));
  must(oneOut.out === 2 && oneOut.in === units(DATA) - 2, `one Color Stack set + Giant Uno out reads ${JSON.stringify(oneOut)}`);
  const bothOut = I.inventoryTotals(statusesFor(DATA, [...bk('k1', 'Ana Bee', day, '2026-11-06', 'Giant Color Stack'), ...bk('k2', 'Cy Dee', day, '2026-11-06', 'giant color stack')], day));
  must(bothOut.out === 2, `both Color Stack sets out counts ${bothOut.out} units, not 2 (units are sets, not rows)`);
  // Add an item -> IN goes up by its quantity.
  const added = clone(DATA); added.games.push({ ...clone(added.games[0]), slug: 'giant-jenga-test', name: 'Giant Jenga Test', formChoice: 'Giant Jenga Test', quantity: 3 });
  must(I.inventoryTotals(statusesFor(added, [], day)).in === none.in + 3, 'adding a 3-set game does not add 3 to IN');
  // Bump a quantity -> IN goes up.
  const bumped = clone(DATA); bumped.games.find((g) => g.slug === 'cornhole').quantity += 2;
  must(I.inventoryTotals(statusesFor(bumped, [], day)).in === none.in + 2, 'bumping Cornhole by 2 does not add 2 to IN');
  // Not offered -> drops out of both totals, even when it is out today.
  const offData = clone(DATA); offData.games.find((g) => g.slug === 'giant-uno').availableNow = false;
  const offT = I.inventoryTotals(statusesFor(offData, bk('k3', 'Eve Fox', day, '2026-11-06', 'Giant Uno'), day));
  must(offT.out === 0 && offT.in === none.in - 1, `a Not offered Giant Uno (out today) still counts: ${JSON.stringify(offT)}`);
  const offStack = clone(DATA); offStack.games.find((g) => g.slug === 'giant-color-stack').availableNow = false;
  must(I.inventoryTotals(statusesFor(offStack, [], day)).in === none.in - 2, 'a Not offered Color Stack does not take both sets out of IN');
  // perSet: words only, never the units.
  const per = clone(DATA); delete per.games.find((g) => g.slug === 'giant-color-stack').perSet;
  must(I.inventoryTotals(statusesFor(per, [], day)).in === none.in, 'perSet changes the unit totals (it must only change the words)');
}
must(tableOk, 'pricing.mjs buildTrackTable / buildPriceTable could not build a table for the totals test');
// The schema: perSet optional, 2..10, Color Stack only.
const INVL = (await import('../lib/inventory.js')).default;
must(INVL.validate(DATA).length === 0, `the fixture inventory fails its rules: ${INVL.validate(DATA).join(' | ')}`);
const badPer = clone(DATA); badPer.games.find((g) => g.slug === 'cornhole').perSet = 0;
must(INVL.validate(badPer).some((e) => /Games in one set/.test(e)), 'a perSet of 0 is not refused');
const live = readJson('data/rentals/games.json');
const withPer = INVL.allItems(live).filter(({ item }) => item.perSet != null).map(({ item }) => `${item.slug}:${item.perSet}`);
must(withPer.join() === 'giant-color-stack:2', `games.json perSet is set on ${withPer.join() || 'nothing'}, not Giant Color Stack only (2)`);

// ---- 1/2. Through the router: the Inventory page -----------------------------------------------
const s = await session();
const { db, get, post } = s;
const today = chicagoDate();
const d = (n) => C.addDays(today, n);
await post('/admin/calendar/bookings', { kind: 'rental_pickup', date: d(-1), return_date: d(1), customer_name: 'Tamara Clark', phone: '901-555-0141', email: '', place: '', items: 'Giant Uno, Grab the Mic, Projector' });
await post('/admin/calendar/bookings', { kind: 'rental_pickup', date: d(0), return_date: d(2), customer_name: 'Ana Bee', phone: '901-555-0142', email: '', place: '', items: 'Giant Color Stack' });
const inv = await get('/admin/inventory');
must(inv.status === 200, `/admin/inventory answered ${inv.status}`);
const html = inv.text;
const row = (slug) => { const m = html.match(new RegExp(`<a class="inv-nrow" href="/admin/inventory/${slug}" data-inv-row="${slug}" data-inv-now="([a-z]+)"[^>]*>[\\s\\S]*?</a>`)); return m ? { now: m[1], html: m[0], pill: (m[0].match(/<span class="inv-np ([a-z]+)" data-inv-np>([^<]*)</) || []).slice(1), who: (m[0].match(/data-inv-who>([^<]*)</) || [])[1] || '' } : null; };
const backWords = shortDate(d(1));
for (const slug of ['giant-uno', 'grab-the-mic', 'projector']) {
  const r = row(slug);
  must(r && r.now === 'out' && r.pill[0] === 'out' && r.pill[1] === 'OUT', `${slug}: not a red OUT pill (${JSON.stringify(r && r.pill)})`);
  must(r && r.who.startsWith(`Tamara C. · back ${backWords}`), `${slug}: the row does not say who has it and when it comes back ("${r && r.who}")`);
}
must((row('projector') || {}).who && /not on website/.test(row('projector').who), 'the admin-only Projector row does not say "not on website"');
const cs = row('giant-color-stack');
must(cs && cs.now === 'in' && cs.pill[0] === 'in' && cs.pill[1] === '1 of 2 sets IN', `Giant Color Stack with one set out is not a green "1 of 2 sets IN" (${JSON.stringify(cs && cs.pill)})`);
must(cs && /^1 set out: Ana B\. · back /.test(cs.who), `Giant Color Stack does not say who has the set out ("${cs && cs.who}")`);
const cf = row('giant-connect-four');
must(cf && cf.now === 'in' && cf.pill[0] === 'in' && cf.pill[1] === 'IN', `Giant Connect Four is not a green IN (${JSON.stringify(cf && cf.pill)})`);
const offSlugs = T.items.filter((i) => i.removed).map((i) => i.slug);
must(offSlugs.length > 0 && offSlugs.every((sl) => { const r = row(sl); return r && r.now === 'off' && r.pill[0] === 'off' && r.pill[1] === 'NOT OFFERED'; }), 'a Not offered item is not a grey NOT OFFERED row');
must(/\.inv-np\.out\{background:#b3261e;color:#fff\}/.test(html) && /\.inv-np\.in\{background:#2f6b2a;color:#fff\}/.test(html), 'the OUT pill is not solid red or the IN pill not solid green');
must(/\.inv-pill\[data-state=out\],\.inv-pill\[data-state=hold\]\{background:#b3261e/.test(html) && /\.inv-pill\[data-state=in\],\.inv-pill\[data-state=some\]\{background:#2f6b2a/.test(html), 'the item cards do not use the same red OUT / green IN');
const rows = [...html.matchAll(/data-inv-row="([^"]+)" data-inv-now="([a-z]+)"/g)].map((m) => [m[1], m[2]]);
must(rows.length === T.items.length, `the phone list has ${rows.length} rows for ${T.items.length} items (one per item, no second list)`);
const order = rows.map(([, k]) => ({ out: 0, in: 1, off: 2 }[k]));
must(order.every((x, i) => i === 0 || order[i - 1] <= x), `the phone list is not Out, then In, then Not offered: ${rows.map((r) => r[1]).join(',')}`);
// The one source: each row's kind agrees with the card pill (itemStatuses) for the same item.
for (const [slug, kind] of rows) {
  const card = (html.match(new RegExp(`data-inv-item="${slug}"[^>]*data-inv-now="([a-z]+)"`)) || [])[1];
  const want = { out: 'out', hold: 'out', in: 'in', some: 'in', off: 'off' }[card];
  must(want === kind, `${slug}: the phone row says ${kind} but the item card says ${card}`);
}
// Tiles: first, live, units.
const tot = (k) => Number((html.match(new RegExp(`data-inv-total-${k}>(\\d+)<`)) || [])[1]);
const stockAll = T.items.filter((i) => !i.removed).reduce((n, i) => n + (i.quantity || 1), 0);
must(tot('out') === 4 && tot('in') === stockAll - 4, `the tiles read ${tot('out')} OUT / ${tot('in')} IN, not 4 / ${stockAll - 4} (Uno, Mic, Projector, one Color Stack set)`);
const mainAt = html.indexOf('<main');
const first = html.slice(mainAt, html.indexOf('<div class="inv-sum" data-inv-summary'));
must(mainAt > 0 && !/<(p|section|div|ol|form|details|a class="btn)\b/.test(first.replace(/<nav class="adminbar[\s\S]*?<\/nav>/, '').replace(/<style>[\s\S]*?<\/style>/, '').replace(/<h1 class="inv-sr">Inventory<\/h1>/, '').replace(/<main[^>]*>/, '')), 'something comes before the OUT / IN tiles on the Inventory page');
const at = (x) => html.indexOf(x);
must(at('data-inv-summary') < at('data-inv-now-list') && at('data-inv-now-list') < at('data-inv-edit') && at('data-inv-edit') < at('+ Add a game or item') && at('data-inv-edit') < at('data-steps="inventoryList"') && at('data-inv-edit') < at('data-inv-status'), 'the order is not tiles -> list -> folded editing tools (add, status, steps inside)');
must(/<details class="inv-tools" id="inventory" data-inv-edit data-inventory><summary/.test(html), 'the editing tools are not folded shut');
must(at('data-inv-out-list') < at('data-inv-in-list'), 'Out games do not come before In games');
const saved = await get('/admin/inventory?m=Saved');
must(/<details class="inv-tools"[^>]*data-inventory open>/.test(saved.text), 'after a save the editing tools are not open (the message is inside)');
// Not offered via the editor drops it out of the totals, live.
const before = tot('in');
await post('/admin/inventory/giant-connect-four/remove', {});
const after = await get('/admin/inventory');
const tin = Number((after.text.match(/data-inv-total-in>(\d+)</) || [])[1]);
must(tin === before - 1, `Remove (Not offered) on Giant Connect Four moved IN from ${before} to ${tin}, not ${before - 1}`);
await post('/admin/inventory/giant-connect-four/restore', {});
// Phone width: one column list, nothing wider than the screen.
must(/a\.inv-nrow\{display:grid;grid-template-columns:minmax\(0,1fr\) auto/.test(html) && /\.inv-sum\{display:grid;grid-template-columns:1fr 1fr/.test(html), 'the list / tiles are not a single column that fits 375 px');
// Color Stack all in: "IN 2 sets (4 games)".
const csIn = VI.nowRow({ slug: 'giant-color-stack', section: 'games' }, DATA.games.find((g) => g.slug === 'giant-color-stack'), { offered: true, stock: 2, used: 0, upcoming: [] });
must(/>IN 2 sets \(4 games\)</.test(csIn.html), `Giant Color Stack all in does not read "IN 2 sets (4 games)": ${csIn.html}`);
const two = VI.nowRow({ slug: 'cornhole', section: 'games' }, { name: 'Cornhole', quantity: 2 }, { offered: true, stock: 2, used: 0, upcoming: [] });
must(/>IN 2</.test(two.html) && two.kind === 'in', 'a 2-quantity game all in does not read "IN 2"');

// ---- 4. Call / Text on every request card ------------------------------------------------------
const dash = await get('/admin/');
must(dash.status === 200, `/admin/ answered ${dash.status}`);
const cards = dash.text.split('<article').slice(1).map((a) => a.slice(0, a.indexOf('</article>'))).filter((c) => /data-reqcard/.test(c));
must(cards.length >= 3, `only ${cards.length} request cards on Requests`);
let withPhone = 0; let withoutPhone = 0;
for (const c of cards) {
  const rk = (c.match(/ id="c-([^"]+)"/) || [])[1];
  const req = s.requests.find((r) => s.rk(r.key) === rk);
  if (!req) continue;
  const digits = String(req.phone || '').replace(/\D/g, '');
  const head = c.slice(0, c.indexOf('</div>', c.indexOf('class="schead"')) + 6);
  if (digits.length >= 7) {
    withPhone += 1;
    must(/<div class="qa" data-quick-contact><a href="tel:[\d+]+" data-card-call[^>]*>&#128222; Call<\/a><a href="sms:[\d+]+" data-card-text[^>]*>&#128172; Text<\/a><\/div>/.test(head), `card ${req.name}: no 📞 Call / 💬 Text in the header`);
    must(!/sms:[^"]*body=/.test(head), `card ${req.name}: the Text link carries a ready-made body`);
  } else {
    withoutPhone += 1;
    must(!/data-quick-contact/.test(c), `card ${req.name} (no phone): shows Call / Text`);
  }
}
must(withPhone >= 2, `only ${withPhone} cards with a phone number checked`);
must(/\.stepcard \.qa a\{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px/.test(dash.text), 'Call / Text are not thumb-sized (44 px)');
must(V.quickContact({ phone: '' }) === '' && V.quickContact({}) === '' && V.quickContact({ phone: 'n/a' }) === '', 'Call / Text show without a phone number');
must(/href="tel:9015550101"[\s\S]*href="sms:9015550101"/.test(V.quickContact({ phone: '(901) 555-0101' })), 'Call / Text do not dial the number');
// At every step: a void, a finished and a put-away card keep it (a direct render of each stage).
const base = { checklists: {}, returns: {}, folderUrl: 'https://drive.google.com/x', sheetError: '', flash: '', missingPayment: [], today: '2026-10-24' };
const rq = { ...s.requests.find((r) => String(r.phone || '').replace(/\D/g, '').length >= 7), key: 'step|x' };
for (const st of [{ status: 'new' }, { status: 'void' }, { status: 'paid', job_done_at: '2026-10-24 12:00:00' }]) {
  const page = V.dashboardPage({ ...base, requests: [rq], statuses: { 'step|x': st } });
  must(/data-quick-contact/.test(page), `a ${st.status} card has no Call / Text`);
}
if (withoutPhone === 0) {
  const page = V.dashboardPage({ ...base, requests: [{ ...rq, phone: '' }], statuses: { 'step|x': { status: 'new' } } });
  must(!/data-quick-contact/.test(page), 'a card without a phone number shows Call / Text');
}

// ---- 5. Open ID photo: over the card, never a new tab -----------------------------------------
const made = await s.siteRequest({ service: 'rentals', games: ['giant-connect-four'], duration: 'day', rental_date: d(9), pickup_when: 'morning', return_when: 'after', name: 'Idris Photo', phone: '(901) 555-0177', email: 'id.photo@example.com', heard: 'Google', notes: '' });
must(made.row && made.row.id_object, 'the site request with an ID was not stored');
const rkId = s.rk(made.row.request_key);
const dash2 = await get('/admin/');
const idCard = (dash2.text.match(new RegExp(`<article[^>]* id="c-${rkId}"[\\s\\S]*?</article>`)) || [''])[0];
const idLink = (idCard.match(/<a [^>]*>Open ID photo<\/a>/) || [''])[0];
must(idLink && !/target=/.test(idLink), `Open ID photo still opens a new tab: ${idLink}`);
must(idLink.includes(`href="/admin/requests/id/view?r=${rkId}"`) && idLink.includes(`data-src="/admin/requests/id?r=${rkId}"`) && /data-id-open/.test(idLink), 'Open ID photo is not the in-page viewer link (same-tab page without JS)');
must(!/<a [^>]*href="\/admin\/requests\/id\?r=[^"]*"[^>]*target="_blank"/.test(dash2.text), 'a raw ID image link with target=_blank is still on Requests');
must(/<div class="idview" data-id-viewer hidden role="dialog" aria-modal="true"[^>]*>[\s\S]*?data-id-close[^>]*>&#10005; Close<\/button>/.test(dash2.text), 'Requests has no photo viewer with a ✕ Close button');
must(/e\.key==='Escape'\)shut\(\)/.test(dash2.text) && /touchend[\s\S]*?>80\)shut\(\)/.test(dash2.text) && /e\.target===v\|\|e\.target\.hasAttribute\('data-id-stage'\)\)shut\(\)/.test(dash2.text) && /opener\.focus\(\)/.test(dash2.text), 'the viewer does not close on Escape / swipe down / tap outside, or does not return focus to the card');
must(/\.idview\{position:fixed;inset:0/.test(dash2.text) && /\.idview \.idx\{[^}]*min-height:52px/.test(dash2.text), 'the viewer is not full screen with a big Close');
const view = await get(`/admin/requests/id/view?r=${rkId}`);
must(view.status === 200 && /no-store/.test(view.headers.get('Cache-Control') || ''), `the no-JS photo page answered ${view.status} / ${view.headers.get('Cache-Control')}`);
must(view.text.includes(`<img src="/admin/requests/id?r=${rkId}"`) && view.text.includes(`href="/admin/#c-${rkId}" data-id-back`) && /data-adminbar/.test(view.text), 'the no-JS photo page lacks the photo, Back to the card or the admin bar');
must((await get(`/admin/requests/id/view?r=${rkId}`, { auth: false })).status === 303, 'the photo page is reachable signed out');
const img = await get(`/admin/requests/id?r=${rkId}`);
must(img.status === 200 && /no-store/.test(img.headers.get('Cache-Control') || ''), 'the private photo route lost no-store');

// ---- 6. The top bar everywhere, and actions land on the card ----------------------------------
for (const p of ['/admin/', '/admin/inventory', '/admin/inventory/giant-uno', '/admin/calendar', '/admin/money', '/admin/settings', '/admin/help', '/admin/invoices', `/admin/requests/edit?r=${rkId}`, `/admin/requests/id/view?r=${rkId}`]) {
  const r = await get(p);
  must(/<nav class="adminbar noprint" aria-label="Back" data-adminbar><a class="back" href="\/admin\/[^"]*" data-back[^>]*>&larr; Back<\/a><span class="where" data-where>[^<]+<\/span><\/nav>/.test(r.text), `${p}: no top bar with ← Back and where you are`);
  must(/history\.back\(\)/.test(r.text) && /r\.origin===location\.origin/.test(r.text), `${p}: Back does not use the history when she came from an admin screen`);
}
must(/data-where>Inventory</.test(html) && /href="\/admin\/inventory" data-back/.test((await get('/admin/inventory/giant-uno')).text), 'the bar does not say where she is, or an item page Back has no parent');
const loc = (r) => r.location || '';
const card = `#c-${rkId}`;
const jobs = [
  ['Save (no invoice)', '/admin/requests/status', { r: rkId, status: 'void' }],
  ['Bring back', '/admin/requests/status', { r: rkId, status: 'unvoid' }],
  ['Mark job done', '/admin/requests/jobdone', { r: rkId }],
  ['Undo job done', '/admin/requests/jobdone', { r: rkId, undo: '1' }],
  ['Delete this ID', '/admin/requests/id/delete', { r: rkId }],
];
for (const [what, p, form] of jobs) {
  const r = await post(p, form);
  must(r.status === 303 && loc(r).startsWith('/admin/') && loc(r).endsWith(card), `${what}: lands on ${loc(r)}, not the card (${card})`);
}
const reqA = s.requests.find((r) => r.email === 'test.renter@example.com');
const { id: invId } = await s.invoiceFor(reqA);
const rInv = await post(`/admin/invoices/${invId}/status`, { action: 'texted', back: '/admin/' });
must(rInv.status === 303 && /^\/admin\/\?/.test(loc(rInv)) && loc(rInv).endsWith(`#c-${s.rk(reqA.key)}`), `an invoice action from a card lands on ${loc(rInv)}, not #c-${s.rk(reqA.key)}`);
const paid = await post('/admin/requests/status', { r: rkId, status: 'paid' });
const conf = paid.location.startsWith('/admin/confirmed') ? await get(paid.location) : null;
must(!conf || conf.text.includes(`href="/admin/#c-${rkId}" data-help="conf.back"`), 'after Mark paid, Done does not go back to the card');
// A redirect that already has its own anchor or opens Put away is left alone.
const A = s.A;
must(A.toRequestsWithoutAnchor(new Response(null, { status: 303, headers: { Location: '/admin/?m=x' } })) && !A.toRequestsWithoutAnchor(new Response(null, { status: 303, headers: { Location: '/admin/?m=x#c-a' } }))
  && !A.toRequestsWithoutAnchor(new Response(null, { status: 303, headers: { Location: '/admin/?pa=1&m=x' } })) && !A.toRequestsWithoutAnchor(new Response(null, { status: 303, headers: { Location: '/admin/calendar?m=x' } })), 'the card-anchor rule touches the wrong redirects');
must(await A.cardAnchorFor(s.env, '/admin/requests/status', new URLSearchParams({ r: 'bad key!' })) === '', 'a malformed r becomes an anchor');

if (checks < 60) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) {
  console.error(`VALIDATION FAIL: admin phone fixes (${errors.length})`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`admin phone fixes: OK (${checks} checks: red OUT / green IN / grey NOT OFFERED, tiles first + live unit totals, Out -> In -> Not offered, tools folded, Call / Text on cards with a phone only, ID opens over the card + no-JS page, top bar on every screen, actions land on the card)`);
