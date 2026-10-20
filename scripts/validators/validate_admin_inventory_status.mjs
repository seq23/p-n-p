#!/usr/bin/env node
/**
 * Inventory In / Out + calm Settings (owner, 19 Oct 2026; docs/admin-console.md "Inventory").
 *
 * Fails unless:
 *  1. every item's status is computed from the bookings across the whole rental span (pickup day
 *     through return day): In · Out: <First L.>, back <Tue 20 Oct> · N of M out (multi-quantity) ·
 *     Reserved until <time> (held, unpaid; "Reserved by hand (no end date)" by hand) · Next booked: <range> · Not offered (removed by hand,
 *     never In / Out, distinct from out); overdue stays out; a checked-in return frees it;
 *  2. the real production case (19 Oct 2026, hand-typed words with extra words) is out today and
 *     the 30-31 Oct rental is "Next booked"; names match in any case / punctuation / spacing;
 *  3. ONE matcher: for every item and every day, Inventory's Out agrees with the /request
 *     availability answer and the clash check (customers can book only offered items not out);
 *  4. /admin/inventory is in the main nav (Requests · Calendar & Bookings · Money · Inventory ·
 *     Settings · Help), reachable from Settings, old Settings -> Inventory links redirect, every
 *     item and its upcoming bookings show, "available" is never an item status there;
 *  5. Settings: the calm sections in order, each opening with one sentence, and nothing that was
 *     in Settings is missing (every form, field and button of the page before 19 Oct 2026).
 * Rule 0: fewer than 80 checks, or zero items in the table, is a failure.
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
const { HELP } = await mod('functions/_lib/helptext.mjs');
const { chicagoDate } = await mod('functions/_lib/reminders.mjs');
const T = P.TRACK_TABLE;
const DATA = P.GAMES;
must(T.items.length >= 8, `the track table has ${T.items.length} items`);
const slugOf = (name) => T.items.find((i) => i.name === name).slug;

// ---- 1/2. Pure: statuses from bookings -------------------------------------------------------
const PROD = 'Giant Uno, Grab the Mic, Inflatable Movie Screen, Projector, movie night bundle for $110 + $50 deposit refunded on tuesday';
const bk = (key, name, start, end, items) => [
  { id: 0, kind: 'rental_pickup', date: start, request_key: key, customer_name: name, items },
  { id: 0, kind: 'rental_return', date: end, request_key: key, customer_name: name, items },
];
const base = [
  ...bk('site|a', 'Tamara Clark', '2026-10-18', '2026-10-20', PROD),
  ...bk('site|b', 'Dee Clark', '2026-10-30', '2026-10-31', 'Giant Connect Four, Giant Uno, Inflatable Movie Screen'),
];
const statusOn = (bookings, today, { holds = [], returns = {}, data = DATA } = {}) => I.itemStatuses({ table: T, data, windows: C.rentalWindows(bookings, returns, T), holds, today });

let st = statusOn(base, '2026-10-19');
for (const name of ['Giant Uno', 'Grab the Mic', 'Inflatable Movie Screen', 'Projector']) {
  must(st[slugOf(name)].state === 'out' && st[slugOf(name)].label === 'Out: Tamara C., back Tue 20 Oct', `production case: ${name} on 19 Oct reads "${st[slugOf(name)].label}", not "Out: Tamara C., back Tue 20 Oct"`);
}
must(st['giant-connect-four'].state === 'in' && st['giant-connect-four'].label === 'In', 'production case: Giant Connect Four is not In on 19 Oct');
must(st['giant-connect-four'].next && st['giant-connect-four'].next.words === 'Next booked: Fri 30 Oct – Sat 31 Oct', `production case: Giant Connect Four next line is "${st['giant-connect-four'].next && st['giant-connect-four'].next.words}"`);
must(st['giant-uno'].next && st['giant-uno'].next.words === 'Next booked: Fri 30 Oct – Sat 31 Oct', 'production case: Giant Uno (out now) does not also show its next booking');
must(st['cornhole'].state === 'in' && !st['cornhole'].next, 'an item no booking names is not plain In');
// The whole span: pickup day and return day count, the days around them do not.
const backOn20 = { 'site|a': { returned_at: '2026-10-20 23:00:00' } }; // checked in late on its return day (Memphis 20 Oct)
for (const [day, want] of [['2026-10-17', 'in'], ['2026-10-18', 'out'], ['2026-10-19', 'out'], ['2026-10-20', 'out'], ['2026-10-21', 'in']]) {
  must(statusOn(base, day, day === '2026-10-21' ? { returns: backOn20 } : {})['grab-the-mic'].state === want, `Grab the Mic on ${day} is not ${want} (span pickup 18 -> return 20 Oct)`);
}
must(statusOn(base, '2026-10-17')['grab-the-mic'].next.words === 'Next booked: Sun 18 Oct – Tue 20 Oct', 'before pickup the item does not say Next booked with the span');
// Overdue: past the return day, not checked in -> still out, "was due back".
const noReturn = statusOn(base, '2026-10-21');
must(noReturn['grab-the-mic'].state === 'out' && noReturn['grab-the-mic'].label === 'Out: Tamara C., was due back Tue 20 Oct', `an overdue rental reads "${noReturn['grab-the-mic'].label}", not "Out: Tamara C., was due back Tue 20 Oct"`);
must(statusOn(base, '2026-10-23')['grab-the-mic'].state === 'out', 'an overdue rental (not checked in) is not still out three days later');
// Checked in: free.
const returns = { 'site|a': { returned_at: '2026-10-20 15:00:00' } };
must(statusOn(base, '2026-10-20', { returns })['grab-the-mic'].state === 'in', 'a checked-in return does not free the item on its return day');
must(statusOn(base, '2026-10-22', { returns })['grab-the-mic'].state === 'in', 'a checked-in return does not free the item afterwards');
// Hand-typed words: any case, punctuation, spacing; other words ignored.
for (const words of ['GIANT  UNO and some chairs', 'giant-uno!', 'grab the mic, giant uno', 'pick up Giant Uno (one set) tues']) {
  must(C.expandItems(words, T).names.includes('Giant Uno'), `the matcher misses Giant Uno in "${words}"`);
}
must(C.expandItems('grab-the-mic; INFLATABLE movie-screen', T).names.join() === 'Grab the Mic,Inflatable Movie Screen', 'the matcher misses hyphenated / upper-case names');
must(!C.expandItems('a big uno party', T).names.includes('Giant Uno'), 'the matcher names an item whose name is not in the words');
// Multi-quantity: Giant Color Stack (2 sets).
const stack = T.items.find((i) => i.slug === 'giant-color-stack');
must(stack && stack.quantity === 2, 'the fixture has no 2-set Giant Color Stack');
const one = [...bk('k1', 'Ana Bee', '2026-11-05', '2026-11-06', 'Giant Color Stack')];
must(statusOn(one, '2026-11-05')['giant-color-stack'].label === '1 of 2 out' && statusOn(one, '2026-11-05')['giant-color-stack'].state === 'some', 'one Giant Color Stack out does not read "1 of 2 out"');
const two = [...one, ...bk('k2', 'Cy Dee', '2026-11-04', '2026-11-06', 'giant color stack')];
must(statusOn(two, '2026-11-05')['giant-color-stack'].label === '2 of 2 out, back Fri 6 Nov', `both sets out reads "${statusOn(two, '2026-11-05')['giant-color-stack'].label}"`);
const yard = [...bk('k3', 'Eve Fox', '2026-11-05', '2026-11-07', 'Whole Yard bundle')];
must(statusOn(yard, '2026-11-06')['giant-color-stack'].label === '2 of 2 out, back Sat 7 Nov', 'a Whole Yard (both sets) does not read 2 of 2 out');
// Holds: held (unpaid) -> "Reserved until <Memphis time>"; by hand -> "Reserved by hand (no end date)".
const held = [...bk('h1', 'Gia Holt', '2026-10-19', '2026-10-20', 'Cornhole set')];
const hTimed = statusOn(held, '2026-10-19', { holds: [{ request_key: 'h1', state: 'held', until: '2026-10-20 20:40:00' }] });
must(hTimed.cornhole.state === 'hold' && hTimed.cornhole.label === 'Reserved until Tue 20 Oct, 3:40 PM', `a held rental reads "${hTimed.cornhole.label}", not "Reserved until Tue 20 Oct, 3:40 PM" (Memphis time)`);
const hHand = statusOn(held, '2026-10-19', { holds: [{ request_key: 'h1', state: 'held', until: null, by_hand: 1 }] });
must(hHand.cornhole.label === 'Reserved by hand (no end date)', 'a hold kept by hand does not say "Reserved by hand (no end date)"');
const hFuture = statusOn(bk('h2', 'Ike Jay', '2026-10-30', '2026-10-31', 'Cornhole set'), '2026-10-19', { holds: [{ request_key: 'h2', state: 'held', until: null }] });
must(hFuture.cornhole.state === 'in' && hFuture.cornhole.next.words === 'Next booked: Fri 30 Oct – Sat 31 Oct (reserved)', 'a future held rental is not "Next booked … (reserved)"');
must(statusOn(held, '2026-10-19', { holds: [{ request_key: 'h1', state: 'confirmed', until: null }] }).cornhole.state === 'out', 'a confirmed hold still reads as on hold');
// Not offered: removed by hand -> Not offered, even with a booking out today; never In / Out.
const removedData = JSON.parse(JSON.stringify(DATA));
removedData.games.find((g) => g.slug === 'giant-uno').availableNow = false;
const off = statusOn(base, '2026-10-19', { data: removedData })['giant-uno'];
must(off.state === 'off' && off.label === 'Not offered' && off.label !== st['grab-the-mic'].label, 'a removed item out today does not read Not offered (distinct from Out)');
const offTable = T.items.filter((i) => i.removed);
must(offTable.length >= 1 && offTable.every((i) => statusOn([], '2026-10-19')[i.slug].state === 'off'), 'the fixture\'s removed items do not read Not offered');
// Never the word "available" as a status.
for (const s2 of [st, hTimed, hHand, noReturn, statusOn(two, '2026-11-05')]) must(!Object.values(s2).some((x) => /availab/i.test(x.label)), 'an item status uses the word "available"');

// ---- 3. One matcher: Inventory Out == /request availability == clash check -------------------
const mix = [...base, ...two, ...yard, ...held, ...bk('m1', 'Kay Lo', '2026-10-25', '2026-10-27', 'grab-the-MIC + card table w/ cup holders')];
const windows = C.rentalWindows(mix, {}, T);
let agree = 0;
for (let i = 0; i < 24; i += 1) {
  const day = C.addDays('2026-10-16', i);
  const sts = I.itemStatuses({ table: T, data: DATA, windows, today: day });
  const left = C.availability(windows, day, day, day, T);
  for (const it of T.items) {
    const s3 = sts[it.slug];
    if (s3.state === 'off') continue;
    const fullyOut = left[it.name] <= 0;
    const someOut = left[it.name] < (it.quantity || 1);
    must((s3.state === 'in') === !someOut, `${it.name} on ${day}: Inventory says ${s3.state} but the /request availability leaves ${left[it.name]} of ${it.quantity || 1}`);
    const clash = C.spanClashes(windows, { start: day, end: day, items: it.name }, day, T).length > 0;
    must(clash === fullyOut, `${it.name} on ${day}: the clash check (${clash}) disagrees with availability (${left[it.name]} left)`);
    if (s3.state === 'out' || s3.state === 'hold') must(fullyOut, `${it.name} on ${day}: Inventory says ${s3.label} but it can still be booked`);
    agree += 1;
  }
}
must(agree > 150, `only ${agree} item-days compared`);

// ---- 4. Through the router: the page, its items, the nav, old links -------------------------
const s = await session();
const { db, get, post } = s;
const today = chicagoDate();
const d = (n) => C.addDays(today, n);
// Hand-typed rental out now (the production words), a 1-of-2, a hold covering today, and a future one.
await post('/admin/calendar/bookings', { kind: 'rental_pickup', date: d(-1), return_date: d(1), customer_name: 'Tamara Clark', phone: '901-555-0141', email: '', place: '', items: PROD });
await post('/admin/calendar/bookings', { kind: 'rental_pickup', date: d(0), return_date: d(1), customer_name: 'Ana Bee', phone: '901-555-0142', email: '', place: '', items: 'Giant Color Stack' });
await post('/admin/calendar/bookings', { kind: 'rental_pickup', date: d(11), return_date: d(12), customer_name: 'Dee Clark', phone: '901-555-0143', email: '', place: '', items: 'Giant Connect Four, Giant Uno, Inflatable Movie Screen' });
for (const [kind, date] of [['rental_pickup', d(0)], ['rental_return', d(2)]]) {
  await db.prepare("INSERT INTO bookings (request_key, kind, date, customer_name, items) VALUES ('site|hold-test', ?1, ?2, 'Gia Holt', 'Cornhole set')").bind(kind, date).run();
}
await db.prepare("INSERT INTO holds (request_key, state, until, by_hand) VALUES ('site|hold-test', 'held', ?1, 0)").bind(`${d(1)} 20:40:00`).run();
const inv = await get('/admin/inventory');
must(inv.status === 200, `/admin/inventory answered ${inv.status}`);
const card = (slug) => { const m = inv.text.match(new RegExp(`<(a|article) class="inv-item[^"]*" (?:href="[^"]*" )?data-inv-item="${slug}"[\\s\\S]*?</\\1>`)); return m ? m[0] : ''; };
const pill = (html) => { const m = html.match(/data-inv-pill data-state="([a-z]+)">([^<]*)</); return m ? { state: m[1], label: m[2] } : null; };
const back1 = C.addDays(today, 1);
const backWords = (await mod('functions/_lib/util.mjs')).shortDate(back1);
for (const slug of ['giant-uno', 'grab-the-mic', 'inflatable-movie-screen', 'projector']) {
  const p = pill(card(slug));
  must(p && p.state === 'out' && p.label === `Out: Tamara C., back ${backWords}`, `/admin/inventory: ${slug} shows ${JSON.stringify(p)}, not Out: Tamara C., back ${backWords}`);
}
must((pill(card('giant-color-stack')) || {}).label === '1 of 2 out', '/admin/inventory: Giant Color Stack is not "1 of 2 out"');
const hp = pill(card('cornhole'));
must(hp && hp.state === 'hold' && /^Reserved until \w{3} \d{1,2} \w{3}, \d{1,2}:40 PM$/.test(hp.label), `/admin/inventory: the held Cornhole set shows ${JSON.stringify(hp)}`);
must(/data-inv-next>Next booked: /.test(card('giant-connect-four')) && (pill(card('giant-connect-four')) || {}).label === 'In', '/admin/inventory: Giant Connect Four is not In with Next booked');
const removedCards = T.items.filter((i) => i.removed).map((i) => card(i.slug));
must(removedCards.length && removedCards.every((c) => /data-state="off">Not offered</.test(c) && /Bring back/.test(c) && /data-inv-now="off"/.test(c)), '/admin/inventory: Not offered items lack the grey Not offered pill or Bring back');
must(inv.text.indexOf('<h2 class="inv-group">Not offered</h2>') > inv.text.indexOf('data-inv-live'), 'Not offered is not its own group below the offered items');
must(/data-inv-section="adminItems"/.test(card('projector')), 'the admin-only Projector is not on the Inventory page');
const pills = [...inv.text.matchAll(/data-inv-pill data-state="[a-z]+">([^<]*)</g)].map((m) => m[1]);
must(pills.length === T.items.length && !pills.some((l) => /availab/i.test(l)), `the Inventory page shows ${pills.length} statuses for ${T.items.length} items, or uses "available"`);
must(/href="\/admin\/inventory\/giant-uno"[^>]*data-help="inv.open"/.test(inv.text), 'an item card does not open the item');
// Item page: upcoming bookings, then Edit / Remove.
const det = await get('/admin/inventory/giant-uno');
must(det.status === 200 && (det.text.match(/data-inv-booking/g) || []).length === 2 && /Tamara C\.[^<]*out now/.test(det.text) && /Dee C\./.test(det.text), 'the Giant Uno page does not list its two upcoming bookings (out now + next)');
must(/href="\/admin\/inventory\/giant-uno\/edit"[^>]*>Edit</.test(det.text) && /action="\/admin\/inventory\/giant-uno\/remove"/.test(det.text) && /href="\/admin\/day\/[\d-]+"[^>]*data-help="inv.bookingDay"/.test(det.text), 'the item page lacks Edit, Remove or Open that day');
const detH = await get('/admin/inventory/cornhole');
must(/data-hold[^>]*>[\s\S]*?Reserved until/.test(detH.text) && !/On hold until|\(on hold\)/.test(detH.text), 'the held booking on the item page does not say Reserved until (or still says On hold)');
const detOff = await get(`/admin/inventory/${T.items.find((i) => i.removed).slug}`);
must(/data-state="off">Not offered</.test(detOff.text) && /\/restore"/.test(detOff.text) && !/\/remove"/.test(detOff.text), 'a Not offered item page lacks Bring back (or offers Remove)');
// The /request availability answer and the Calendar booking picker use the same matcher.
const RS = s.RS;
const avail = await (await RS.handleAvailability({ request: new Request(`https://porchandparty901.com/api/request/availability?event=${d(11)}&pickup_when=morning&return_when=after&duration=day`), env: s.env })).json();
must(avail.left && avail.left['giant-uno'] === 0 && avail.left['giant-connect-four'] === 0 && avail.left['cornhole'] === 1, `the /request availability for the hand-typed future rental is wrong: ${JSON.stringify(avail.left)}`);
// Nav, Settings link, old links.
must(/<nav aria-label="Main">\s*<a href="\/admin\/"[^>]*>Requests<\/a><a href="\/admin\/calendar"[^>]*>Calendar &amp; Bookings<\/a><a href="\/admin\/money"[^>]*>Money<\/a><a href="\/admin\/inventory"[^>]*>Inventory<\/a><a href="\/admin\/settings"[^>]*>Settings<\/a><a href="\/admin\/help"[^>]*>Help<\/a><a href="\/admin\/pricing"[^>]*>Quick Pricing Summary<\/a>\s*<form method="post" action="\/admin\/logout"/.test(inv.text), 'the main nav is not Requests · Calendar & Bookings · Money · Inventory · Settings · Help · Quick Pricing Summary (then Sign out)');
for (const [from, to] of [['/admin/settings/inventory', '/admin/inventory'], ['/admin/settings/inventory/new', '/admin/inventory/new'], ['/admin/settings/inventory/giant-uno', '/admin/inventory/giant-uno/edit']]) {
  const r = await get(from);
  must(r.status === 303 && r.location === to, `${from} does not redirect to ${to} (${r.status} ${r.location})`);
  must((await get(to)).status === 200, `${to} does not answer`);
}
// Help text: every inventory control explained, never "available" as an item status.
for (const key of ['nav.inventory', 'inv.open', 'inv.openOff', 'inv.bookingDay', 'inv.add', 'set.inventoryLink']) must(HELP[key] && HELP[key].title, `no help text for ${key}`);
must(/In[\s\S]*Out[\s\S]*1 of 2 out[\s\S]*Reserved[\s\S]*Next booked/.test(HELP['inv.open'].more), 'the item help does not explain In, Out, 1 of 2 out, Reserved and Next booked');
must(!Object.entries(HELP).filter(([k]) => k === 'nav.inventory' || k.startsWith('inv.open') || k === 'inv.bookingDay').some(([, h]) => /availab/i.test(`${h.title} ${h.more}`)), 'Inventory help text uses the word "available"');

// ---- 5. Settings: calm sections, nothing missing --------------------------------------------
const set = await get('/admin/settings');
must(set.status === 200, 'Settings does not answer');
const secs = [...set.text.matchAll(/<details class="set-sec" id="([a-z]+)"[^>]*><summary[^>]*><span class="set-head"><span class="set-title">([^<]*)<\/span><span class="set-why">([^<]{20,})<\/span><\/span><\/summary>/g)].map((m) => [m[1], m[2], m[3]]);
must(secs.map((x) => x[0]).join() === V.SETTINGS_SECTIONS.map((x) => x[0]).join(), `Settings sections are ${secs.map((x) => x[0]).join()}, not ${V.SETTINGS_SECTIONS.map((x) => x[0]).join()}`);
must(secs.length === 8 && secs.every((x) => x[2].trim().split(/(?<=[.!?])\s/).length === 1), 'a Settings section does not open with exactly one sentence (shown even when folded)');
must(/window\.matchMedia\('\(max-width:700px\)'\)[\s\S]*d\.open=false/.test(set.text), 'Settings sections do not fold on a phone');
must(/<details class="set-sec" id="inventory"[\s\S]*?href="\/admin\/inventory"/.test(set.text), 'Settings -> Inventory does not link to /admin/inventory');
// Everything the Settings page had before the calm layout (19 Oct 2026, 4d43d25): form actions,
// field names and buttons. The Monday "send now" became the daily to-do email's "Send me today's
// list now" (todo-now) with its own on/off (todo), 19 Oct 2026.
const ACTIONS = ['/admin/settings', '/admin/settings/calendar-token', '/admin/settings/weekly', '/admin/settings/todo', '/admin/settings/todo-now', '/admin/settings/sheet-sync', '/admin/settings/holds', '/admin/settings/categories', '/admin/settings/password'];
for (const a of ACTIONS) must(set.text.includes(`action="${a}"`), `Settings lost the form posting to ${a}`);
const FIELDS = ['zelle', 'cashapp', 'qr', 'business_name', 'business_address', 'id_folder_url', 'day_list_phone', 'day_list_email', 'weekly_summary', 'todo_email', 'hold_hours', 'hold_auto_expire', 'hold_reminder', 'hold_reminder_hours', 'hold_soon_hours', 'categories', 'current', 'next', 'confirm'];
for (const f of FIELDS) must(set.text.includes(`name="${f}"`), `Settings lost the field ${f}`);
const BUTTONS = ['set.save', 'set.saveDayList', 'set.weeklyToggle', 'set.todoToggle', 'set.todoNow', 'set.sheetSync', 'set.holds', 'set.categories', 'set.passwordSave', 'set.newToken', 'cal.link', 'set.business', 'set.password', 'set.inventoryLink'];
for (const b of BUTTONS) must(set.text.includes(`data-help="${b}"`), `Settings lost the ${b} control`);
must(/data-inv-status/.test(set.text) && /<details class="set-sec" id="website"[\s\S]*?data-inv-status/.test(set.text), 'Settings has no Website auto-update status box');
// Saving still works the same way.
const saved = await post('/admin/settings', { zelle: 'pay@example.com', cashapp: '$porch', business_name: 'Porch & Party', business_address: '', id_folder_url: '', day_list_phone: '901-555-0100', day_list_email: 'day@example.com' });
must(saved.status === 303 && /Saved/.test(decodeURIComponent(saved.location)) && (await get('/admin/settings')).text.includes('value="pay@example.com"'), 'the payment details no longer save');
const hs = await post('/admin/settings/holds', { hold_hours: '30', hold_reminder_hours: '4', hold_soon_hours: '12', hold_reminder: '1', hold_auto_expire: '1' });
must(hs.status === 303 && (await get('/admin/settings')).text.includes('name="hold_hours" type="number" min="1" max="336" inputmode="numeric" value="30"'), 'the hold settings no longer save');

if (checks < 80) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) {
  console.error(`VALIDATION FAIL: inventory status (${errors.length} of ${checks} checks)`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`inventory status: OK (${checks} checks: In / Out / N of M out / On hold / Next booked / Not offered across the rental span, the 19 Oct production case, one matcher = /request availability = clash check over ${agree} item-days, /admin/inventory in the nav + from Settings + old links redirect, calm Settings with nothing missing)`);
