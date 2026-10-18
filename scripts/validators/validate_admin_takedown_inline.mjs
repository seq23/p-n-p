#!/usr/bin/env node
/**
 * The inline takedown row, auto-booked form takedown dates, Requested chips, the calm card, the
 * one-page Day sheet and the admin-only Projector (owner, 18 Oct 2026: Valerie said the takedown
 * flow was too many steps; the card was bulky; the printed Day sheet ran to 2 pages).
 *
 * Fails when:
 *  1. a porch, party & decor or grazing card lacks the ONE inline line (date box + optional
 *     time + Save, and Not sure yet · Customer will handle it on porch/party), or a rental has it;
 *  2. Save leaves the card (it must book the `<kind>_takedown` booking, edited_by_hand = 1,
 *     takedown_plan 'scheduled', one history line, and come back to #c-<card> saying "Takedown on
 *     the calendar for <day> ✓"); Change makes a second booking; Remove leaves it booked;
 *     once booked the line lacks "Booked for <day>" + a one-tap Mark takedown done (any day);
 *  3. booking a takedown after Job done moves request_status back to 'scheduled' (only a FIRST
 *     booking marks Scheduled);
 *  4. a form takedown date is not booked on arrival / at install, is booked twice, overrides a
 *     booking she edited, or "Not sure yet" / "Customer will handle it" / no date books anything;
 *  5. a live request's asked-for day with no booking of that kind is not an OUTLINED "Requested"
 *     chip (all four services) on the month, the day page and Today's list; a Requested rental
 *     counts as games out; a requested name reaches the Google Calendar feed; the legend is gone;
 *     a held rental is not filled + "Held"; an expired hold does not revert to Requested;
 *  6. the card repeats its status in pills, keeps a "Paid in full ✓" box, or the thank-you is
 *     more than one small line at the bottom;
 *  7. the Day sheet prints the banner, prints "$0.00" owed, lists one job's items more than
 *     twice, or its games tiles lack the out/in classes with words;
 *  8. the Projector is not tracked (grid, availability, booking form) or reaches a public page.
 * Rule 0: fewer than 120 checks, or any list it walks coming back empty, is a failure.
 * Prove it negatively: break any rule above in functions/_lib and this fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const TD = await mod('functions/_lib/takedown.mjs');
const K = await mod('functions/_lib/cards.mjs');
const V = await mod('functions/_lib/views.mjs');
const C = await mod('functions/_lib/calendar.mjs');
const RQ = await mod('functions/_lib/requests.mjs');
const RD = await mod('functions/_lib/requested.mjs');
const P = await mod('functions/_lib/prices.mjs');
const F = await mod('functions/_lib/request-form.mjs');
const { handleIcs } = await mod('functions/_lib/ics-route.mjs');
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const nonEmpty = (list, what) => { if (!list || !list.length) errors.push(`Rule 0: ${what} is empty, nothing was checked`); return list || []; };

// ---- 1. The inline row: porch / party / grazing, never rentals ---------------------------------
const mk = (key, services, extra = {}) => ({ key, name: `${key} Example`, services, need: services.join(' '), wantsDecor: services.some((k) => k !== 'rentals'), wantsRentals: services.includes('rentals'),
  gamesAnswer: services.includes('rentals') ? 'Giant Uno' : '', rentals: [], decor: [{ label: 'Event date', value: '2026-10-24' }], other: [], takedownPlan: '', takedownDate: '', takedownNote: '', ...extra });
const SETS = nonEmpty([['porch'], ['party'], ['grazing'], ['rentals'], ['porch', 'rentals'], ['party', 'grazing'], ['grazing', 'rentals']], 'service sets');
for (const services of SETS) {
  for (const st of [{ status: 'new' }, { status: 'scheduled' }, { status: 'job_done', job_done_at: '2026-10-24 12:00:00' }]) {
    const r = mk(`k${services.join('')}${st.status}`, services);
    const html = V.requestCard(r, { st, sched: { date: '2026-10-24' }, kinds: services.map((k) => K.SCHEDULE_FIRST[k][1]), bookings: services.map((k, i) => ({ id: i + 1, kind: K.SCHEDULE_FIRST[k][1], date: '2026-10-24' })), today: '2026-10-25' });
    const tag = `${services.join('+')} @ ${st.status}`;
    const rows = (html.match(/data-takedown-row=/g) || []).length;
    const decor = services.some((k) => k !== 'rentals');
    must(rows === (decor ? 1 : 0), `${tag}: ${rows} inline takedown rows (want ${decor ? 1 : 0}; never on a rental)`);
    if (!decor) { must(!/takedown-inline|Takedown:|Pickup \(optional\):/.test(html), `${tag}: a rental card carries a takedown / pickup line`); continue; }
    const kind = services.includes('porch') ? 'porch_takedown' : services.includes('party') ? 'party_takedown' : 'grazing_pickup';
    must(new RegExp(`name="kind" value="${kind}"`).test(html), `${tag}: the row is not for ${kind}`);
    must(/<input type="date"[^>]*name="date" value="2026-10-25"/.test(html), `${tag}: the date box does not start on the day after the install/setup`);
    must(/<input type="time"[^>]*name="time"/.test(html) && /name="go" value="save"[^>]*>Save</.test(html), `${tag}: no optional time box + Save`);
    must(!/\/admin\/calendar\/new\?r=[^"]*kind=(porch_takedown|party_takedown|grazing_pickup)/.test(html), `${tag}: a takedown / pickup detour to the booking page is still on the card`);
    if (kind === 'grazing_pickup') must(!/Not sure yet|Customer will handle it/.test(html) && /Pickup \(optional\):/.test(html), `${tag}: the grazing pickup line is not the optional pickup (no takedown choices)`);
    else must(/>Takedown:</.test(html) && /value="not_sure"[^>]*>Not sure yet</.test(html) && /value="customer_handles"[^>]*>Customer will handle it</.test(html), `${tag}: the takedown line lacks Not sure yet · Customer will handle it`);
    // Every new control has a tooltip from the one map (helptext.mjs).
    for (const key of ['td.date', 'td.time', 'td.save']) must(html.includes(`data-help="${key}"`), `${tag}: ${key} has no tooltip`);
  }
}
// Never on a Void / Finished / Put away card; the rules table agrees.
for (const stage of ['void', 'finished', 'archived']) must(K.inlineRowKind({ services: ['porch'], stage }) === '', `porch @ ${stage}: inline row shown`);
must(K.inlineRowKind({ services: ['rentals'], stage: 'scheduled' }) === '' && K.inlineRowKind({ services: ['grazing'], stage: 'new' }) === 'grazing_pickup', 'inlineRowKind: rentals get a row, or grazing lacks its pickup');
// Prefill order: booked day, else the form's / owner's date, else the day after the install.
must(TD.inlineDefaultDate({ kind: 'porch_takedown', bookings: [{ kind: 'porch_takedown', date: '2026-10-21' }], takedownDate: '2026-10-22', eventDate: '2026-10-24' }) === '2026-10-21', 'prefill: the booked day does not win');
must(TD.inlineDefaultDate({ kind: 'porch_takedown', bookings: [{ kind: 'porch_install', date: '2026-10-24' }], takedownDate: '2026-10-22' }) === '2026-10-22', 'prefill: the form date does not win over the day after the install');
must(TD.inlineDefaultDate({ kind: 'party_takedown', bookings: [], eventDate: '2026-10-24' }) === '2026-10-25', 'prefill: no day after the event when nothing is booked');

// ---- 2. Save / Change / Remove / one-tap done, through the real routes --------------------------
const s = await session();
const plus = (n) => s.util.todayISO(n);
const short = (d) => s.util.shortDate(d);
const reqP = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'yes', event_date: plus(4), location: 'Germantown', name: 'Ida Inline', phone: '901-555-0960', email: 'ida.inline@example.com' });
const keyP = reqP.row.request_key; const rkP = s.rk(keyP);
must(!(await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind = 'porch_takedown'", keyP)), 'a /request "yes" with no date booked a takedown by itself');
await s.post('/admin/calendar/bookings', { r: rkP, kind: 'porch_install', date: plus(4), customer_name: 'Ida Inline', phone: '901-555-0960', email: '', place: 'Germantown', items: 'Porch' });
const cardOf = (html, name) => { const i = html.indexOf(`>${name}</h3>`); return i < 0 ? '' : html.slice(html.lastIndexOf('<article', i), html.indexOf('</article>', i)); };
const day1 = plus(6);
const saved = await s.post('/admin/requests/takedown-inline', { r: rkP, kind: 'porch_takedown', date: day1, time: '' });
must(saved.status === 303 && saved.location.startsWith('/admin/?tdok=') && saved.location.endsWith(`#c-${rkP}`), `Save left the card (went to ${saved.location})`);
let tdb = await s.all("SELECT * FROM bookings WHERE request_key = ?1 AND kind = 'porch_takedown'", keyP);
must(tdb.length === 1 && tdb[0].date === day1 && tdb[0].edited_by_hand === 1 && tdb[0].time === null, 'Save did not book ONE porch_takedown on that day, marked as hers');
must((await s.one('SELECT takedown_plan, takedown_date FROM requests WHERE request_key = ?1', keyP)).takedown_plan === 'scheduled', 'Save did not set takedown_plan = scheduled');
must(Boolean(await s.one("SELECT id FROM request_events WHERE request_key = ?1 AND what = ?2", keyP, `Takedown booked for ${short(day1)}`)), 'Save wrote no history line');
let back = await s.get(saved.location.replace(/#.*$/, ''));
let card = cardOf(back.text, 'Ida Inline');
must(new RegExp(`data-takedown-saved role="status">Takedown on the calendar for ${short(day1)} ✓<`).test(card), 'the card does not say "Takedown on the calendar for <day> ✓" after Save');
must(new RegExp(`data-takedown-row="booked"[\\s\\S]*Booked for ${short(day1)}<`).test(card) && /data-takedown-done-tap/.test(card) && /data-help="td\.changeDate"/.test(card) && /value="remove"[^>]*>Remove</.test(card), 'the booked line lacks "Booked for <day>" + one-tap Mark takedown done + Change + Remove');
// Change: the same booking moves (never a second one), with a time.
const day2 = plus(7);
await s.post('/admin/requests/takedown-inline', { r: rkP, kind: 'porch_takedown', date: day2, time: '10:30' });
tdb = await s.all("SELECT * FROM bookings WHERE request_key = ?1 AND kind = 'porch_takedown'", keyP);
must(tdb.length === 1 && tdb[0].date === day2 && tdb[0].time === '10:30', 'Change made a second booking or did not move it');
// One tap, before its day: done, and undo.
await s.post(`/admin/calendar/bookings/${tdb[0].id}/takedown-done`, {});
must(Boolean((await s.one('SELECT done_at FROM bookings WHERE id = ?1', tdb[0].id)).done_at), 'one-tap Mark takedown done before its day did not save');
card = cardOf((await s.get('/admin/')).text, 'Ida Inline');
must(/data-takedown-row="done"[\s\S]*Done ✓[\s\S]*data-help="td\.undoDone"/.test(card), 'a done takedown line does not say Done ✓ with a small Undo');
await s.post(`/admin/calendar/bookings/${tdb[0].id}/takedown-done`, { undo: '1' });
// Remove: off the calendar, the asked-for day cleared (so nothing re-books it), the line asks again.
await s.post('/admin/requests/takedown-inline', { r: rkP, kind: 'porch_takedown', go: 'remove' });
must(!(await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind = 'porch_takedown'", keyP)) && (await s.one('SELECT takedown_date FROM requests WHERE request_key = ?1', keyP)).takedown_date === '', 'Remove left the takedown booked (or kept its date)');
must(/data-takedown-row="open"/.test(cardOf((await s.get('/admin/')).text, 'Ida Inline')), 'after Remove the line does not ask again');
// A rental never books one through the route.
const reqR = await s.siteRequest({ service: 'rentals', games: ['giant-uno'], duration: 'day', pickup_date: plus(9), name: 'Rio Rental', phone: '901-555-0961', email: 'rio.rental@example.com' });
const rr = await s.post('/admin/requests/takedown-inline', { r: s.rk(reqR.row.request_key), kind: 'porch_takedown', date: plus(10) });
must(/e=/.test(rr.location) && !(await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind LIKE '%takedown'", reqR.row.request_key)), 'the inline route booked a takedown for a rental');

// ---- 3. Status never regressed after Job done ---------------------------------------------------
await s.post('/admin/requests/jobdone', { r: rkP });
must((await s.one('SELECT status FROM request_status WHERE request_key = ?1', keyP)).status === 'job_done', 'Job done did not save');
await s.post('/admin/requests/takedown-inline', { r: rkP, kind: 'porch_takedown', date: plus(8) });
must((await s.one('SELECT status FROM request_status WHERE request_key = ?1', keyP)).status === 'job_done', 'booking the takedown after Job done (inline) moved the status back');
await s.post('/admin/calendar/bookings', { r: rkP, kind: 'porch_takedown', date: plus(9), customer_name: 'Ida Inline', phone: '', email: '', place: '', items: 'Porch' });
must((await s.one('SELECT status FROM request_status WHERE request_key = ?1', keyP)).status === 'job_done', 'booking the takedown after Job done (booking screen) moved the status back');
for (const before of ['job_done', 'paid', 'void']) {
  await s.db.prepare("INSERT INTO request_status (request_key, status) VALUES ('ms|x', ?1) ON CONFLICT(request_key) DO UPDATE SET status = excluded.status").bind(before).run();
  await C.markScheduled(s.db, 'ms|x');
  must((await s.one("SELECT status FROM request_status WHERE request_key = 'ms|x'")).status === before, `markScheduled moved "${before}" back to scheduled`);
}
await s.db.prepare("UPDATE request_status SET status = 'deposit_paid' WHERE request_key = 'ms|x'").run();
await C.markScheduled(s.db, 'ms|x');
must((await s.one("SELECT status FROM request_status WHERE request_key = 'ms|x'")).status === 'scheduled', 'a first booking no longer marks Scheduled');

// ---- 4. Auto-book the form's takedown date ------------------------------------------------------
const base = { key: 'a|1', name: 'Ann Auto', services: ['party'], takedownPlan: 'scheduled', takedownDate: '2026-11-02', rentals: [], decor: [{ label: 'Location', value: 'Midtown' }], other: [], eventType: 'Birthday' };
const row = TD.autoTakedownRow(base);
must(row && row.kind === 'party_takedown' && row.date === '2026-11-02' && row.place === 'Midtown', 'a party with a form takedown date is not auto-booked');
const NEVER = nonEmpty([
  ['not sure', { takedownPlan: 'not_sure' }], ['customer handles', { takedownPlan: 'customer_handles' }], ['no date', { takedownDate: '' }], ['a rental', { services: ['rentals'] }],
  ['grazing only', { services: ['grazing'] }], ['a test', { isTest: true }],
], 'never-book cases');
for (const [label, over] of NEVER) must(TD.autoTakedownRow({ ...base, ...over }) === null, `auto-book: ${label} booked a takedown`);
must(TD.autoTakedownRow(base, { bookings: [{ kind: 'porch_takedown' }] }) === null && TD.autoTakedownRow(base, { bookings: [{ kind: 'party_takedown' }] }) === null, 'auto-book over an existing takedown booking');
must(TD.autoTakedownRow(base, { status: { status: 'void' } }) === null && TD.autoTakedownRow(base, { status: { archived_at: 'x' } }) === null, 'auto-book for a void / put-away request');
// The old Google Form import (the same statements the import uses), through D1.
const fixture = (await mod('data/admin/fixture-request.json')).default;
const [headers] = fixture.values;
const formRow = (over) => headers.map((h) => (h in over ? over[h] : ''));
const imp = RQ.importRowFor(headers, formRow({ Timestamp: '10/2/2026 9:00:00', 'Email Address': 'old.form@example.com', 'Full name': 'Olga Oldform', 'Phone number': '901-555-0962', 'What do you need?': 'Event decor', 'Event type': 'Birthday party', 'Event date': '10/30/2026', 'Also need decor?': 'Yes', 'Location': 'Cordova', 'Need us to take it down afterwards?': 'Yes', 'Takedown date': '10/31/2026' }));
await RQ.importStatement(s.db, imp).run();
const olga = RQ.fromRow(await s.one('SELECT * FROM requests WHERE request_key = ?1', imp.request_key));
must(await TD.autoBookTakedown(s.db, olga), 'the import did not auto-book the form takedown date');
must(!(await TD.autoBookTakedown(s.db, olga)), 'auto-book is not idempotent (a second run booked again)');
const olgaB = await s.all("SELECT * FROM bookings WHERE request_key = ?1 AND kind LIKE '%takedown'", imp.request_key);
must(olgaB.length === 1 && olgaB[0].date === '2026-10-31' && olgaB[0].edited_by_hand === 0, 'the auto-booked takedown is not ONE booking on 31 Oct');
must(Boolean(await s.one('SELECT id FROM request_events WHERE request_key = ?1 AND what LIKE ?2', imp.request_key, `${TD.AUTO_EVENT}%`)), 'the auto-booking wrote no history line');
// Her hand edit stands: a hand-moved booking is never overridden, by the hook or the backfill plan.
await C.editBookingWhen(s.db, olgaB[0].id, { date: '2026-11-03', time: null });
await TD.autoBookTakedown(s.db, olga);
must((await s.one('SELECT date FROM bookings WHERE id = ?1', olgaB[0].id)).date === '2026-11-03', 'auto-book overrode a booking she edited');
const bookingsBy = {}; for (const b of await s.all('SELECT request_key, kind FROM bookings WHERE request_key IS NOT NULL')) (bookingsBy[b.request_key] = bookingsBy[b.request_key] || []).push(b);
must(!TD.autoBookPlan([olga], bookingsBy).length, 'the backfill plan would book a request that already has its takedown');
// Aashish's shape: a hand-made party_takedown (time null), status job_done: left exactly as is.
must(TD.autoBookPlan([{ ...base, key: 'aash|1' }], { 'aash|1': [{ kind: 'party_takedown' }] }, { 'aash|1': { status: 'job_done' } }).length === 0, 'the backfill would add a second takedown to a request with a hand-made one');
must(TD.autoBookPlan([base], {}, {}).length === 1 && TD.autoBookPlan([base, { ...base, key: 'a|2', takedownPlan: 'not_sure' }], {}, {}).length === 1, 'the backfill plan books the wrong set');
// Install hook: a dated takedown with no booking is booked when its install/setup is booked.
const reqH = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', party_takedown: 'yes', event_date: plus(12), location: 'Bartlett', name: 'Hal Hook', phone: '901-555-0963', email: 'hal.hook@example.com' });
await s.db.prepare('UPDATE requests SET takedown_date = ?2 WHERE request_key = ?1').bind(reqH.row.request_key, plus(13)).run();
await s.post('/admin/calendar/bookings', { r: s.rk(reqH.row.request_key), kind: 'party_setup', date: plus(12), customer_name: 'Hal Hook', phone: '', email: '', place: 'Bartlett', items: 'Decor' });
must((await s.all("SELECT date FROM bookings WHERE request_key = ?1 AND kind = 'party_takedown'", reqH.row.request_key)).map((x) => x.date).join() === plus(13), 'booking the setup did not book the form takedown date');
must((await s.one('SELECT status FROM request_status WHERE request_key = ?1', reqH.row.request_key)).status === 'scheduled', 'booking the setup did not mark Scheduled');

// ---- 5. Requested chips: outlined, all four services, not games out, not in the feed -----------
const askDay = plus(20);
const asked = nonEmpty([
  ['porch', { service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'not_sure', event_date: askDay, location: 'Cordova', name: 'Rhea Porchask', phone: '901-555-0970', email: 'rhea@example.com' }],
  ['party', { service: 'party', party_event: 'Birthday', party_where: 'Home', party_takedown: 'no', event_date: askDay, location: 'Bartlett', name: 'Rene Partyask', phone: '901-555-0971', email: 'rene@example.com' }],
  ['grazing', { service: 'grazing', grazing_event: 'Birthday', grazing_guests: 'Under 15', grazing_food: 'Yes, include food in my quote', event_date: askDay, location: 'Midtown', name: 'Remy Grazeask', phone: '901-555-0972', email: 'remy@example.com' }],
], 'asked-for requests');
for (const [svc, f] of asked) must((await s.siteRequest(f)).status === 303, `the ${svc} request did not go through the form`);
// A rental asked for, not booked: an imported old-form row (the site form books and holds at once).
const rentRow = RQ.importRowFor(headers, formRow({ Timestamp: '10/3/2026 9:00:00', 'Email Address': 'rosa.rent@example.com', 'Full name': 'Rosa Rentask', 'Phone number': '901-555-0973', 'What do you need?': 'Game rentals', 'Which games?': 'Giant Uno, Cornhole set', 'How long?': 'One day', 'Pickup date': `${Number(askDay.slice(5, 7))}/${Number(askDay.slice(8))}/${askDay.slice(0, 4)}` }));
await RQ.importStatement(s.db, rentRow).run();
const cal = (await s.get(`/admin/calendar?month=${askDay.slice(0, 7)}`)).text;
const cell = (() => { const i = cal.indexOf(`data-day="${askDay}"`); return cal.slice(i, cal.indexOf('</a>', i)); })();
for (const [svc, name] of [['porch', 'Rhea P.'], ['party', 'Rene P.'], ['grazing', 'Remy G.'], ['rentals', 'Rosa R.']]) {
  must(new RegExp(`<span class="k req [a-z_]+" style="border-color:#[0-9a-f]{6}" data-requested="${svc}"[^>]*role="link"[^>]*data-open="/admin/#c-[A-Za-z0-9_-]+">Requested · [A-Za-z &]+: ${name.replace('.', '\\.')}</span>`).test(cell), `month: no outlined Requested chip for ${svc} (${name}) that opens the card`);
}
must(/\.k\.req\{background:transparent!important;border-style:solid/.test(cal), 'Requested chips are not outlined (border only, no fill)');
must(/data-fill-legend[^>]*>[\s\S]*Filled = booked · Outlined = asked for, not booked yet/.test(cal), 'the legend line is missing');
must(!/data-games-out/.test(cell) && /data-games-asked[^>]*>2 games asked for</.test(cell), 'a requested rental counts as games out, or "N games asked for" is missing');
const dayHtml = (await s.get(`/admin/day/${askDay}`)).text;
must((dayHtml.match(/<a class="k req [^"]*"[^>]*data-requested="(porch|party|grazing|rentals)"[^>]*href="\/admin\/#c-/g) || []).length === 4, 'the day page does not link the four Requested chips to their cards');
must(/data-day-count>0 of \d+ games out</.test(dayHtml) && /data-games-asked[^>]*>2 games asked for, not booked yet/.test(dayHtml), 'the day page counts requested games as out');
// Today's list is the day page for today.
const todayReq = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', event_date: plus(0), location: 'Cordova', name: 'Tess Todayask', phone: '901-555-0974', email: 'tess.today@example.com' });
must(todayReq.status === 303 && /data-requested="porch"[^>]*>Requested · Porch: Tess T\.</.test((await s.get(`/admin/day/${plus(0)}`)).text), "Today's list lacks the Requested chip");
// The ICS feed and the Sheet's Bookings rows never carry a requested name.
const tok = (await s.get('/admin/calendar/link')).text.match(/\/api\/calendar\/([a-f0-9]{64})\.ics/);
const feed = tok ? await (await handleIcs({ request: new Request(`https://porchandparty901.com/api/calendar/${tok[1]}.ics`), env: s.env, params: { token: `${tok[1]}.ics` } })).text() : '';
must(Boolean(feed) && !/Rhea|Rene|Remy|Rosa|Requested/.test(feed), 'a requested (not booked) name reaches the Google Calendar feed');
for (const f of ['functions/_lib/sheets-sync.mjs', 'functions/_lib/ics-route.mjs', 'functions/_lib/calendar.mjs']) must(!/requested\.mjs/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} reads the Requested chips (they are not bookings)`);
// Booked -> the chip becomes the normal filled booking.
const rhea = await s.one("SELECT request_key FROM requests WHERE email = 'rhea@example.com'");
await s.post('/admin/calendar/bookings', { r: s.rk(rhea.request_key), kind: 'porch_install', date: askDay, customer_name: 'Rhea Porchask', phone: '', email: '', place: '', items: 'Porch' });
const cal2 = (await s.get(`/admin/calendar?month=${askDay.slice(0, 7)}`)).text;
const cell2 = (() => { const i = cal2.indexOf(`data-day="${askDay}"`); return cal2.slice(i, cal2.indexOf('</a>', i)); })();
must(!/data-requested="porch"/.test(cell2) && /<span class="k porch_install"[^>]*>Porch install: Rhea Porchask</.test(cell2), 'a booked porch is still outlined, or not filled');
// Held rental: filled + "Held"; expired: back to outlined Requested, not games out.
const held = await s.siteRequest({ service: 'rentals', games: ['cornhole'], duration: 'day', pickup_date: plus(22), name: 'Hope Heldask', phone: '901-555-0975', email: 'hope.held@example.com' });
let cal3 = (await s.get(`/admin/calendar?month=${plus(22).slice(0, 7)}`)).text;
must(/data-held-chip[^>]*>Held · Rental pickup: Hope Heldask</.test(cal3), 'a held rental is not a filled chip that says Held');
await s.db.prepare("UPDATE holds SET until = '2000-01-01 00:00:00' WHERE request_key = ?1").bind(held.row.request_key).run();
cal3 = (await s.get(`/admin/calendar?month=${plus(22).slice(0, 7)}`)).text;
must(!/Held · Rental pickup: Hope/.test(cal3) && /data-requested="rentals"[^>]*>Requested · Rentals: Hope H\.</.test(cal3), 'an expired hold did not revert to an outlined Requested chip');
// Void, put away and test requests never show.
const chips = RD.requestedChips([{ ...mk('v', ['porch']), name: 'Vic Void' }, { ...mk('p', ['porch']), name: 'Pia Put' }, { ...mk('t', ['porch']), name: 'Tom Test', isTest: true }, { ...mk('l', ['porch']), name: 'Lia Live' }],
  { v: { status: 'void' }, p: { status: 'new', archived_at: 'x' } }, []);
must(chips.length === 1 && chips[0].name === 'Lia L.', 'void / put-away / test requests show as Requested');

// ---- 6. The calm card: no repeated pills, no Paid-in-full box, thank-you one line at the bottom -
{
  const paid = { id: 7, status: 'paid', total_cents: 50000, balance: { total: 50000, paid: 50000, remaining: 0, owed: 0, refundable: 0, void: false } };
  const r = mk('ada', ['party'], { name: 'Ada Example', takedownPlan: 'scheduled' });
  const bk = [{ id: 1, kind: 'party_setup', date: '2026-10-17' }, { id: 2, kind: 'party_takedown', date: '2026-10-20', time: null }];
  const html = V.requestCard(r, { st: { status: 'job_done', job_done_at: '2026-10-17 20:00:00', invoice_id: 7 }, inv: paid, sched: { date: '2026-10-17' }, kinds: bk.map((b) => b.kind), bookings: bk, today: '2026-10-18',
    bottom: '<div class="tyline" data-thankyou>Thank-you email goes out tomorrow morning</div>' });
  must(!/chip sched|data-paid-early|Scheduled for/.test(html), 'the card repeats the progress line in pills (Paid in full / Scheduled for …)');
  must(!/data-payment/.test(html) && /data-paid-undo/.test(html), 'a paid-in-full card still has the Payment box, or lacks the small undo on the progress line');
  must(/data-takedown-row="booked"[\s\S]*Booked for Tue 20 Oct[\s\S]*class="btn primary" type="submit" data-takedown-done-tap/.test(html) && !/data-primary>/.test(html) && !/data-next-wait/.test(html), 'Aashish\'s card: the one-tap Mark takedown done is not THE primary (or a Next: line / second primary shows)');
  must(html.indexOf('data-thankyou') > html.indexOf('data-secondary') && html.indexOf('data-thankyou') < html.indexOf('data-details'), 'the thank-you is not at the bottom, just above Show details');
  must(/\.secrow\{display:flex;flex-wrap:wrap/.test(V.CARD_CSS) && /\.secrow \.btn\{width:auto/.test(V.CARD_CSS), 'the secondary buttons are full-width boxes again');
}

// ---- 7. The Day sheet: no banner in print, no $0.00, items at most twice, out/in tiles ---------
{
  const pick = plus(25);
  await s.post('/admin/calendar/bookings', { kind: 'rental_pickup', date: pick, return_date: plus(27), time: '', customer_name: 'Phil Phonebook', phone: '901-555-0980', email: '', place: 'Mt. Moriah Station', items: 'Inflatable Movie Screen', item: ['Inflatable Movie Screen', 'Projector'] });
  const sheet = (await s.get(`/admin/day/${pick}?m=Saved%20%E2%9C%93`)).text;
  const printCss = (sheet.match(/@media print\{[\s\S]*?\n\}/g) || []).join('');
  must(/\.notice\.ok/.test(printCss) && /\[data-flash\]/.test(printCss) && /nav/.test(printCss) && /\.btn/.test(printCss), 'print does not hide the banner, nav and buttons');
  must(/@page\{size:Letter/.test(printCss), 'the Day sheet is not laid out for one Letter page');
  must(/data-flash>Saved ✓</.test(sheet), 'the flash banner is not marked for print hiding');
  must(!/\$0\.00/.test(sheet) && !/Still to collect today/.test(sheet), 'a "$0.00" owed line shows');
  must(/class="jl">Anytime · Game pickup · Phil</.test(sheet), 'the job line is not "Anytime · Game pickup · <first name>"');
  must(!/<th>Still owed|<table class="sheet"/.test(sheet), 'the squeezed 7-column table is back');
  const items = 'Inflatable Movie Screen, Projector';
  must((sheet.split(items).length - 1) <= 2 && !/data-out-list/.test(sheet) && !/Load these items/.test(sheet), `one job's items are listed ${sheet.split(items).length - 1} times (or the text list / one-job Load list is back)`);
  must(/data-day-count>2 of \d+ games out</.test(sheet), 'the grid header is not "N of M games out"');
  must(new RegExp(`class="tile out" data-tile="out"><strong>Projector</strong><span>Out · back ${short(plus(27))} · Phil</span>`).test(sheet), 'the Projector tile is not OUT with "Out · back <day> · <first name>"');
  must(/class="tile in" data-tile="in"><strong>Giant Uno<\/strong><span>In<\/span>/.test(sheet) && /\.grid \.tile\.out\{background:#fbe3e0;[^}]*linear-gradient/.test(sheet) && /\.grid \.tile\.in\{background:#e7f5e4/.test(sheet), 'the out (light red, diagonal X) / in (light green) tiles or their words are missing');
}

// ---- 8. The Projector: tracked by the admin, never public ---------------------------------------
{
  must(P.TRACK_TABLE.items.some((i) => i.slug === 'projector' && i.quantity === 1 && i.adminOnly) && !P.PRICE_TABLE.items.some((i) => i.slug === 'projector'), 'the Projector is not tracked (quantity 1) or it is priced');
  must(!F.rentalItems(P.PRICE_TABLE).some((i) => /projector/i.test(i.name)), 'the Projector is on the /request form');
  const games = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rentals/games.json'), 'utf8'));
  must(!(games.games || []).concat(games.extras || []).some((g) => /projector/i.test(g.name)) && (games.adminItems || []).every((g) => g.admin_only === true), 'the Projector sits in a public list of games.json');
  const pub = nonEmpty(['rentals/index.html', 'request/index.html', 'faq/index.html', 'index.html'].filter((f) => fs.existsSync(path.join(ROOT, f))), 'public pages');
  for (const f of pub) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    must(!/>\s*Projector\s*</.test(t) && !/"name":\s*"Projector"/.test(t) && !/value="projector"/.test(t), `${f} lists the admin-only Projector`);
  }
  const form = (await s.get(`/admin/calendar/new?kind=rental_pickup&date=${plus(26)}`)).text;
  must(/data-item="Projector"><input type="checkbox" name="item" value="Projector" disabled>/.test(form), 'the booking form does not offer the Projector (or does not grey it out while it is out)');
  const left = C.availability(C.rentalWindows(await C.listBookings(s.db), await C.loadReturns(s.db), P.TRACK_TABLE), plus(26), plus(26), plus(0), P.TRACK_TABLE);
  must(left.Projector === 0, 'a booked Projector does not count against availability');
}

if (checks < 120) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: admin takedown inline (${errors.length} of ${checks})\n${errors.map((e) => `- ${e}`).join('\n')}`); process.exit(1); }
console.log(`validate_admin_takedown_inline: OK (${checks} checks: inline row porch/party/grazing never rentals; Save/Change/Remove/one-tap done on the card; status never back after Job done; form takedown dates auto-booked once, never over hers; Requested chips outlined for all four services, not games out, not in the feed; calm card; one-page Day sheet; admin-only Projector)`);
