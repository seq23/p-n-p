#!/usr/bin/env node
/**
 * Rental dates (owner, 19 Oct 2026): event date + length + pickup/return days. Drives the real
 * form handler, availability API, calendar, day sheet, Monday summary and Edit over a fresh local
 * database (never production). Fails when:
 *  1. any of the 8 pickup/return combinations gives the wrong days, the entire weekend does not
 *     cover Friday, Saturday and Sunday, or a Monday-Thursday weekend is accepted;
 *  2. a price moves with the days picked: one day is always the day price, the weekend always the
 *     weekend price, single-sourced from games.json (draft invoices included);
 *  3. a game out on ANY day of a span (not only the event day) can be booked again, or the
 *     availability API, the Rental-out span or the clash words miss it;
 *  4. the calendar does not show pickup, "Rental out" on every day between, and return (outlined
 *     for an unpaid request), or the Day sheet / Monday summary do not read the span;
 *  5. Edit -> Rental dates does not move both bookings, log old -> new, and warn (still saving)
 *     when the new span clashes; an old request (no Return date answer) changes its days.
 * Rule 0: fewer than 60 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const C = await mod('functions/_lib/calendar.mjs');
const F = await mod('functions/_lib/request-form.mjs');
const RQ = await mod('functions/_lib/requests.mjs');
const W = await mod('functions/_lib/weekly.mjs');
const { PRICE_TABLE } = await mod('functions/_lib/prices.mjs');
const games = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/validators/fixtures/games.json'), 'utf8'));
const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rentals/games.json'), 'utf8'));

// ---- 1. Span math, all 8 combinations ------------------------------------------------------
const today = F.chicagoToday();
const add = C.addDays;
let sat = add(today, 70); while (C.weekday(sat) !== 6) sat = add(sat, 1);
const fri = add(sat, -1); const sun = add(sat, 1); const wed = add(sat, -3);
const DAY = [['before', 'after', -1, 1], ['before', 'two_after', -1, 2], ['morning', 'after', 0, 1], ['morning', 'two_after', 0, 2]];
for (const [p, r, dp, dr] of DAY) {
  const s = C.rentalSpan({ event: wed, length: 'day', pickup: p, ret: r });
  must(s.pickup === add(wed, dp) && s.ret === add(wed, dr), `one day ${p}/${r}: ${JSON.stringify(s)}`);
}
const WK = [['thursday', 'monday', -1, 3], ['thursday', 'tuesday', -1, 4], ['friday', 'monday', 0, 3], ['friday', 'tuesday', 0, 4]];
for (const ev of [fri, sat, sun]) {
  for (const [p, r, dp, dr] of WK) {
    const s = C.rentalSpan({ event: ev, length: 'weekend', pickup: p, ret: r });
    must(s.pickup === add(fri, dp) && s.ret === add(fri, dr), `weekend ${p}/${r} (event ${ev}): ${JSON.stringify(s)}`);
    const days = C.spanDays(s.pickup, s.ret);
    must([fri, sat, sun].every((d) => days.includes(d)), `weekend ${p}/${r} does not block Fri, Sat and Sun`);
  }
}
must(/Pick a Friday, Saturday or Sunday/.test(C.rentalSpan({ event: wed, length: 'weekend', pickup: 'friday', ret: 'monday' }).error || ''), 'a Wednesday weekend was accepted');
must(C.rentalSpan({ event: wed, length: 'day', pickup: 'thursday', ret: 'after' }).error, 'a weekend pickup choice was accepted on one day');
must(JSON.stringify(F.DURATIONS) === JSON.stringify([['day', 'One day'], ['weekend', 'The entire weekend (Fri, Sat and Sun)']]), 'the length choices are not the owner wording');
must(JSON.stringify(C.PICKUP_CHOICES) === JSON.stringify({ day: [['before', 'The day before'], ['morning', 'The morning of']], weekend: [['thursday', 'Thursday'], ['friday', 'Friday']] }) && JSON.stringify(C.RETURN_CHOICES) === JSON.stringify({ day: [['after', 'The day after'], ['two_after', '2 days after']], weekend: [['monday', 'Monday'], ['tuesday', 'Tuesday']] }), 'the pickup/return choices are not the owner wording');
const blank = F.renderForm({ offers: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8')), table: PRICE_TABLE });
must(blank.includes('What date is your event?') && blank.indexOf('What date is your event?') < blank.indexOf('How long?') && blank.indexOf('How long?') < blank.indexOf(F.PICKUP_LABEL) && blank.indexOf(F.PICKUP_LABEL) < blank.indexOf(F.RETURN_LABEL), 'the rentals path does not ask event date, length, pickup, return in that order');
must(!/name="pickup_date"/.test(blank) && (blank.match(/data-length="(day|weekend)"/g) || []).length === 8, 'the form still asks a pickup date, or the 8 pickup/return choices are not tagged by length');

// ---- 2. Prices never move -----------------------------------------------------------------
const quote = (slugs, d) => F.rentalQuote(slugs, d, PRICE_TABLE, games.holdPercent);
must(quote(['giant-uno'], 'day').rental === games.rates.day * 100 && quote(['giant-uno'], 'weekend').rental === games.rates.weekend * 100, 'one game is not the day / weekend price from games.json');
must(live.rates.day === 40 && live.rates.weekend === 60, `the live prices changed: ${JSON.stringify(live.rates)}`);

// ---- Real submissions, one per combination, in separate weeks --------------------------------
const s = await session();
const env = s.env;
let n = 0;
const contact = () => { n += 1; return { name: `Rae Span${n}`, phone: `(901) 555-03${String(10 + n).slice(-2)}`, email: `span${n}@example.com` }; };
const made = [];
for (const [i, [p, r, dp, dr]] of DAY.entries()) {
  const ev = add(wed, 7 * (i + 1));
  const res = await s.siteRequest({ service: 'rentals', games: ['giant-uno', 'cornhole'], duration: 'day', rental_date: ev, pickup_when: p, return_when: r, ...contact() });
  made.push({ res, len: 'day', p, r, pick: add(ev, dp), ret: add(ev, dr) });
}
for (const [i, [p, r, dp, dr]] of WK.entries()) {
  const evSat = add(sat, 7 * (i + 6));
  const res = await s.siteRequest({ service: 'rentals', games: ['giant-uno', 'cornhole'], duration: 'weekend', rental_date: evSat, pickup_when: p, return_when: r, ...contact() });
  made.push({ res, len: 'weekend', p, r, pick: add(evSat, -1 + dp), ret: add(evSat, -1 + dr) });
}
for (const m of made) {
  must(m.res.status === 303 && m.res.row, `${m.len} ${m.p}/${m.r} was refused: ${m.res.text.slice(m.res.text.indexOf('rq-summary'), m.res.text.indexOf('rq-summary') + 300)}`);
  if (!m.res.row) continue;
  const bk = await s.all('SELECT kind, date FROM bookings WHERE request_key = ?1 ORDER BY date', m.res.row.request_key);
  must(bk.length === 2 && bk[0].kind === 'rental_pickup' && bk[0].date === m.pick && bk[1].kind === 'rental_return' && bk[1].date === m.ret, `${m.len} ${m.p}/${m.r}: bookings ${JSON.stringify(bk)}, want ${m.pick} -> ${m.ret}`);
  const ans = JSON.parse(m.res.row.answers);
  must(ans.some((a) => a.label === 'Pickup date' && a.value === m.pick) && ans.some((a) => a.label === 'Return date' && a.value === m.ret) && ans.some((a) => a.label === 'What date is your event?'), `${m.len} ${m.p}/${m.r}: the answers lack the event, pickup or return date`);
  const inv = await s.one('SELECT i.id FROM invoices i WHERE i.request_key = ?1', m.res.row.request_key);
  const lines = inv ? await s.all('SELECT qty, unit_cents, refundable FROM invoice_lines WHERE invoice_id = ?1', inv.id) : [];
  const rental = lines.filter((l) => !l.refundable).reduce((t, l) => t + Math.round(l.qty * l.unit_cents), 0);
  const want = quote(['giant-uno', 'cornhole'], m.len).rental;
  must(inv && rental === want && want === 2 * games.rates[m.len] * 100, `${m.len} ${m.p}/${m.r}: draft invoice rental ${rental}, want ${want} (2 x ${games.rates[m.len]})`);
}

// ---- 3. Clash across the whole span ---------------------------------------------------------
const wide = made[4]; // weekend Thursday -> Monday
const mid = add(wide.pick, 2); // Saturday: not a pickup or return day
const clash = await s.siteRequest({ service: 'rentals', games: ['cornhole'], duration: 'day', rental_date: mid, pickup_when: 'morning', return_when: 'after', ...contact() });
must(clash.status === 400 && /already booked for those dates/.test(clash.text), 'a game out mid-span (weekend Saturday) could be booked again');
const avail = await (await s.RS.handleAvailability({ request: new Request(`https://porchandparty901.com/api/request/availability?event=${mid}&pickup_when=morning&return_when=after&duration=day&games=cornhole`), env })).json();
must(avail.ok && avail.left.cornhole === 0 && avail.returnDate === add(mid, 1), `availability does not grey a game out mid-span: ${JSON.stringify(avail)}`);
const touch = await s.siteRequest({ service: 'rentals', games: ['cornhole'], duration: 'day', rental_date: add(wide.ret, 1), pickup_when: 'before', return_when: 'after', ...contact() });
must(touch.status === 400, 'a pickup on the return day of another rental of the same game was accepted');
// Pickup the day before another rental starts (a free day) but back after it began: the later days clash.
const tail = await s.siteRequest({ service: 'rentals', games: ['cornhole'], duration: 'day', rental_date: wide.pick, pickup_when: 'before', return_when: 'two_after', ...contact() });
must(tail.status === 400 && /already booked for those dates/.test(tail.text), 'a rental whose pickup day is free but whose later days clash was accepted (only the first day was checked)');
const windows = C.rentalWindows(await C.listBookings(s.db), await C.loadReturns(s.db), PRICE_TABLE);
const sc = C.spanClashes(windows, { start: add(mid, -1), end: add(mid, 1), items: 'Cornhole Set' }, today, PRICE_TABLE, 'none');
must(sc.length === 1 && sc[0].item === 'Cornhole Set' && sc[0].dates.length === 3 && sc[0].who.includes('Rae Span5'), `spanClashes misses the span: ${JSON.stringify(sc)}`);

// ---- 4. Calendar, Day sheet, Monday summary -------------------------------------------------
const cal = (await s.get(`/admin/calendar?month=${mid.slice(0, 7)}`)).text;
const between = C.spanDays(wide.pick, wide.ret).slice(1, -1);
for (const d of between) {
  const cell = cal.slice(cal.indexOf(`data-day="${d}"`), cal.indexOf('</a>', cal.indexOf(`data-day="${d}"`)));
  must(/class="k rental_out"[^>]*data-rental-out[^>]*>Rental out: Rae Span5/.test(cell), `no "Rental out" chip on ${d} in the month grid`);
}
must([add(wide.pick, 1), add(wide.pick, 2), add(wide.pick, 3)].every((d) => between.includes(d)), 'the Thursday-Monday weekend does not show Fri, Sat and Sun as out');
const pickCell = cal.slice(cal.indexOf(`data-day="${wide.pick}"`), cal.indexOf('</a>', cal.indexOf(`data-day="${wide.pick}"`)));
must(/Rental pickup: Rae Span5/.test(pickCell) && !/Rental out: Rae Span5/.test(pickCell), 'the pickup day lacks its pickup chip or shows Rental out');
const list = cal.slice(cal.indexOf('data-month-list'));
must(between.filter((d) => d.slice(0, 7) === mid.slice(0, 7)).every((d) => { const b = list.slice(list.indexOf(`data-month-day="${d}"`)); return /data-rental-out[^>]*>Rental out: Rae Span5/.test(b.slice(0, b.indexOf('</div>'))); }), 'the phone month list lacks the Rental out days');
const day = (await s.get(`/admin/day/${mid}`)).text;
must(/data-day-out/.test(day) && /Rental out · Rae/.test(day) && /data-day-count>\d+ of \d+ games out/.test(day), 'the Day sheet does not list the rental out mid-span');
must(/Rental out - Rae Span5 \(/.test(decodeURIComponent((day.match(/sms:[^"]*body=([^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&')), 'the texted day list lacks "Rental out"');
const monday = (() => { let d = add(wide.pick, -7); while (C.weekday(d) !== 1) d = add(d, 1); return d; })();
const wd = await W.weeklyData(s.db, monday, Date.parse(`${monday}T12:00:00Z`));
const wday = (wd.this.days || []).find((x) => x.date === mid);
must(wday && wday.bookings.some((b) => b.kind === 'Rental out' && /^Rae S/.test(b.who)), `the Monday summary does not list "Rental out" mid-span: ${JSON.stringify(wday)}`);
// Unpaid (requested): the hold ends -> the whole span shows outlined.
await s.db.prepare("UPDATE holds SET until = '2000-01-01 00:00:00' WHERE request_key = ?1").bind(made[6].res.row.request_key).run();
const H = await mod('functions/_lib/holds.mjs');
await H.expireHolds(s.db);
const span6 = C.spanDays(made[6].pick, made[6].ret);
const cal6 = (await s.get(`/admin/calendar?month=${span6[1].slice(0, 7)}`)).text;
const cellOf = (html, d) => html.slice(html.indexOf(`data-day="${d}"`), html.indexOf('</a>', html.indexOf(`data-day="${d}"`)));
// Calm calendar (19 Oct 2026): "? Kind: Name" (dashed) in the month grid.
must(/class="k req rental_pickup"[^>]*>\? Rentals: Rae S\.</.test(cellOf(cal6, span6[0])), 'the unpaid rental has no outlined pickup chip');
{ const mid6 = span6.slice(1, -1).filter((d) => d.slice(0, 7) === span6[1].slice(0, 7)); must(mid6.length > 0, 'Rule 0: no span days between pickup and return to check'); }
must(span6.slice(1, -1).filter((d) => d.slice(0, 7) === span6[1].slice(0, 7)).every((d) => /class="k req rental_out"[^>]*>\? Rental out: Rae S\.</.test(cellOf(cal6, d))), 'the unpaid rental has no outlined Rental out chips between');
must(span6[span6.length - 1].slice(0, 7) !== span6[1].slice(0, 7) || /class="k req rental_return"[^>]*>Requested · not confirmed · Rental return: Rae S\./.test(cellOf(cal6, span6[span6.length - 1])), 'the unpaid rental has no outlined return chip');
must(!/data-rental-out="[^"]*"[^>]*>Rental out: Rae Span7/.test(cal6), 'an unpaid rental is drawn as filled Rental out');

// ---- 5. Edit -> Rental dates -----------------------------------------------------------------
const e = made[0].res.row; const rkE = s.rk(e.request_key);
const page = (await s.get(`/admin/requests/edit?r=${rkE}`)).text;
must(/data-rental-dates/.test(page) && new RegExp(`name="pickup" type="date" required value="${made[0].pick}"`).test(page) && new RegExp(`name="return" type="date" required value="${made[0].ret}"`).test(page), 'Edit has no Rental dates block with both days');
// Move it onto the Thursday-Monday weekend (Cornhole already out): saved + plain warning.
const newPick = add(wide.pick, 1); const newRet = add(wide.pick, 2);
const moved = await s.post('/admin/requests/edit/rental-dates', { r: rkE, pickup: newPick, return: newRet });
const loc = decodeURIComponent(moved.location);
const bkE = await s.all('SELECT kind, date FROM bookings WHERE request_key = ?1 ORDER BY kind', e.request_key);
must(bkE.find((b) => b.kind === 'rental_pickup').date === newPick && bkE.find((b) => b.kind === 'rental_return').date === newRet, `Rental dates did not move both bookings: ${JSON.stringify(bkE)}`);
must(/Rental dates saved/.test(loc) && /w=Heads up: Cornhole Set is already out with Rae Span5 on /.test(loc) && loc.includes(s.util.shortDate(newPick)), `no plain clash warning (game, who, dates): ${loc}`);
const evE = await s.all('SELECT what FROM request_events WHERE request_key = ?1', e.request_key);
must(evE.some((x) => x.what.startsWith(`Rental pickup day: ${s.util.shortDate(made[0].pick)} → ${s.util.shortDate(newPick)}`)) && evE.some((x) => x.what.startsWith(`Rental return day: ${s.util.shortDate(made[0].ret)} → ${s.util.shortDate(newRet)}`)), 'history does not log old → new for both days');
const shown = (await s.get(`/admin/requests/edit?r=${rkE}&m=x&w=${encodeURIComponent('Heads up: test')}`)).text;
must(/class="notice warn" data-clash>Heads up: test/.test(shown), 'the clash warning is not shown on the Edit page');
const bad = await s.post('/admin/requests/edit/rental-dates', { r: rkE, pickup: newRet, return: newPick });
must(/e=/.test(bad.location), 'a return before the pickup was saved');
const calm = await s.post('/admin/requests/edit/rental-dates', { r: rkE, pickup: add(today, 300), return: add(today, 301) });
must(!/w=/.test(calm.location), 'a clash warning on free dates');
// One booking moved alone also warns.
const pk = await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", e.request_key);
const single = await s.post('/admin/requests/edit/booking', { r: rkE, id: String(pk.id), date: mid, time: '' });
must(/w=Heads%20up|w=Heads\+up|w=Heads/.test(single.location) || /Heads up/.test(decodeURIComponent(single.location)), `moving the pickup alone into a clash does not warn: ${single.location}`);

// ---- Old requests keep working -------------------------------------------------------------
const old = { rentals: [{ label: 'Pickup date', value: fri }, { label: 'How long?', value: 'Weekend (Friday pickup, Monday return)' }], durationAnswer: 'Weekend (Friday pickup, Monday return)' };
must(C.requestReturnDate(old, fri) === add(fri, 3), 'an old weekend request no longer returns Monday');
must(C.requestReturnDate({ rentals: [{ label: 'Return date', value: add(fri, 4) }], durationAnswer: 'The entire weekend (Fri, Sat and Sun)' }, add(fri, -1)) === add(fri, 4), 'a new request does not keep its own Return date');
must(/weekend/i.test(F.DURATIONS[1][1]) && !/weekend/i.test(F.DURATIONS[0][1]), 'the weekend wording no longer prices as a weekend');

// ---- Public wording matches ------------------------------------------------------------------
for (const f of ['rentals/index.html', 'faq/index.html', 'rules.html', 'terms-and-conditions.html', 'llms.txt']) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  must(!/within 24 hours of pickup|picked up Friday and returned Monday|pick up Friday, return Monday/.test(t) && /Thursday or Friday/.test(t) && /Monday or Tuesday/.test(t), `${f} still describes the old pickup/return rules`);
}

if (checks < 60) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`rental dates: FAIL (${errors.length} of ${checks})\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`rental dates: OK (${checks} checks: 8 combinations, weekend Fri-Sun, prices unchanged, clash across the span, calendar/day sheet/summary, Edit moves + logs + warns, old requests)`);
