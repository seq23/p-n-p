#!/usr/bin/env node
/**
 * Phone requests (owner, 18 Oct 2026: Valerie added a phone-call booking with "Add a booking"
 * and it never reached Requests, because a hand-added booking had request_key NULL).
 *
 * Fails when:
 *  1. migration 0012 loses or changes a requests row or index, or its CHECK does not accept
 *     'phone' (and still reject anything else);
 *  2. "Add a booking" lacks Which service? (Porch, Party & decor, Grazing, Game rentals in their
 *     colours with words, + Just a calendar note (no customer)) or its tooltips;
 *  3. a hand-added booking with a customer does not make ONE source-'phone' request with its
 *     booking(s) linked (a rental: pickup + return), Scheduled, with a Requests card carrying the
 *     "From a phone call" chip, steps, Edit and "ID: not collected (phone booking)" + the
 *     optional upload; the calendar-note option makes a request; a service with no name does;
 *  4. a phone request gets a hold, an automatic confirmation email (deposit received, Email it)
 *     or ever shows "Confirmation email sent"; the thank-you or the day-before reminder does not
 *     go to its email;
 *  5. the backfill is not idempotent, does not pair a rental pickup + return into one request,
 *     touches a calendar note, or does not convert the hand-added 'site' phone request (source ->
 *     'phone', confirm_emailed_at cleared, a history line, no email);
 *  6. a rental's length is not read from its booked days (Sun 18 -> Tue 20 = "pickup Sun 18 Oct,
 *     back Tue 20 Oct (2 days)", never "for one day"), on the card or the new invoice's lines;
 *  7. the month on a 390 px phone is not a day-by-day list with full chips (the grid hidden
 *     under 700 px, nothing in the list wider than the screen), or the computer grid changed;
 *  8. the help page lacks the phone section or a new control's entry.
 * Rule 0: fewer than 90 checks, or any list it walks coming back empty, is a failure.
 * Prove it negatively: break any rule above in functions/_lib or migrations and this fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT, makeDb, applyMigration } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const PR = await mod('functions/_lib/phone-requests.mjs');
const V = await mod('functions/_lib/views.mjs');
const RQ = await mod('functions/_lib/requests.mjs');
const H = await mod('functions/_lib/helptext.mjs');
const CM = await mod('functions/_lib/customer-messages.mjs');
const RM = await mod('functions/_lib/reminders.mjs');
const { prefillLines } = await mod('functions/_lib/pricing.mjs');
const { SERVICE_KINDS } = await mod('functions/_lib/kinds.mjs');
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const nonEmpty = (list, what) => { if (!list || !list.length) errors.push(`Rule 0: ${what} is empty, nothing was checked`); return list || []; };

// ---- 1. Migration 0012: a safe rebuild -------------------------------------------------------
{
  const db = makeDb({ upTo: 11 });
  const cols = db.raw.prepare('PRAGMA table_info(requests)').all().map((c) => c.name);
  const ins = (key, source, extra = {}) => {
    const row = { request_key: key, source, submitted_at: '2026-10-01 12:00:00', name: `${key} Example`, email: `${key}@example.com`, answers: '[]', referral_code: `ref${key}`, receipt_id: `rc${key}`, confirm_emailed_at: '2026-10-02 10:00:00', details_edits: '{"name":"X"}', takedown_note: 'n', ...extra };
    db.raw.prepare(`INSERT INTO requests (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
  };
  ins('a', 'site', { id_object: 'ids/x.jpg', agreed_at: '2026-10-01 12:00:00' }); ins('b', 'google_form', { raw_row: '{"headers":[],"row":[]}' }); ins('c', 'site');
  const before = db.raw.prepare('SELECT * FROM requests ORDER BY request_key').all().map((r) => JSON.stringify(r));
  applyMigration(db, 12);
  const after = db.raw.prepare('SELECT * FROM requests ORDER BY request_key').all().map((r) => JSON.stringify(r));
  must(nonEmpty(before, 'pre-0012 rows').length === 3 && JSON.stringify(before) === JSON.stringify(after), '0012: a requests row was lost or changed by the rebuild');
  const cols2 = db.raw.prepare('PRAGMA table_info(requests)').all().map((c) => c.name);
  must(JSON.stringify(nonEmpty(cols, 'requests columns')) === JSON.stringify(cols2), `0012: the requests columns changed (${cols2.length} vs ${cols.length})`);
  const idx = db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'requests'").all().map((x) => x.name);
  for (const n of ['idx_requests_submitted', 'idx_requests_name_norm', 'idx_requests_referred']) must(idx.includes(n), `0012: index ${n} is gone`);
  must(idx.filter((n) => n.startsWith('sqlite_autoindex')).length >= 3, '0012: the PRIMARY KEY / UNIQUE (referral_code, receipt_id) indexes are gone');
  let dup = false; try { ins('d', 'site', { referral_code: 'refa', receipt_id: 'rcd' }); } catch { dup = true; }
  must(dup, '0012: referral_code is no longer UNIQUE');
  let okPhone = true; try { ins('p', 'phone', { referral_code: 'refp', receipt_id: null }); } catch { okPhone = false; }
  must(okPhone, "0012: the CHECK does not accept source 'phone'");
  let bad = false; try { ins('z', 'bogus', { referral_code: 'refz', receipt_id: null }); } catch { bad = true; }
  must(bad, '0012: the CHECK accepts any source');
  must(db.raw.prepare('PRAGMA table_info(bookings)').all().some((c) => c.name === 'calendar_note'), '0012: bookings.calendar_note is missing');
  must(!/DELETE FROM|UPDATE requests/i.test(fs.readFileSync(path.join(ROOT, 'migrations/0012_phone_requests.sql'), 'utf8')), '0012: the migration deletes or rewrites rows');
}

// ---- 2-4. The form, the phone request, the card, the messages ---------------------------------
const S = await session();
const { env, db, get, post, one, all, rk } = S;
const form = await get('/admin/calendar/new?date=2026-10-18');
must(/data-service-choice/.test(form.text) && /Which service\?/.test(form.text), 'Add a booking: no Which service? choice');
for (const k of nonEmpty(PR.PHONE_SERVICES, 'phone services')) {
  const re = new RegExp(`data-service-pick="${k}" style="border-color:${SERVICE_KINDS[k].bar};background:${SERVICE_KINDS[k].tint}"><input type="radio" name="service" value="${k}" required data-help="bk.service"[^>]*> <span>${PR.PHONE_SERVICE_WORDS[k].replace('&', '&amp;')}</span>`);
  must(re.test(form.text), `Add a booking: the ${k} choice is not its colour + words + tooltip`);
}
must(/data-service-pick="note"><input[^>]*data-help="bk.note"[^>]*> <span>Just a calendar note \(no customer\)/.test(form.text), 'Add a booking: no Just a calendar note (no customer) option');
must(/name="phone"/.test(form.text) && /name="email"/.test(form.text) && /Email \(optional/.test(form.text), 'Add a booking: phone / optional email fields missing');
// From a request ("Put X on the calendar") there is no service question.
const fx = nonEmpty(S.requests, 'fixture requests')[0];
must(!/data-service-choice/.test((await get(`/admin/calendar/new?r=${rk(fx.key)}`)).text), 'Put on the calendar (from a request) asks Which service?');

const reqCount = async () => (await one('SELECT COUNT(*) AS n FROM requests')).n;
const n0 = await reqCount();
// A rental by phone: pickup Sun 18 Oct, return Tue 20 Oct.
const rental = await post('/admin/calendar/bookings', { service: 'rentals', kind: 'rental_pickup', date: '2026-10-18', return_date: '2026-10-20', time: '', customer_name: 'Pat Phonecall', phone: '901-555-0101', email: 'pat@example.com', place: 'Mt. Moriah Station', item: ['Giant Uno', 'Inflatable Movie Screen'], items: '', note: '' });
const pr = await one("SELECT * FROM requests WHERE name = 'Pat Phonecall'");
must(rental.status === 303 && pr && pr.source === 'phone', `rental by phone: no source-'phone' request (status ${rental.status})`);
must((await reqCount()) === n0 + 1, 'rental by phone: not exactly one request made');
if (!pr) { console.error(`VALIDATION FAIL: admin-phone (Add a booking with a customer made no phone request; ${errors.length} earlier failures)`); for (const e of errors) console.error(` - ${e}`); process.exit(1); }
const prBookings = pr ? await all('SELECT kind, date FROM bookings WHERE request_key = ?1 ORDER BY date', pr.request_key) : [];
must(prBookings.length === 2 && prBookings[0].kind === 'rental_pickup' && prBookings[1].kind === 'rental_return' && prBookings[1].date === '2026-10-20', 'rental by phone: the pickup + return pair is not linked to the request');
must((await one("SELECT COUNT(*) AS n FROM bookings WHERE request_key IS NULL AND customer_name = 'Pat Phonecall'")).n === 0, 'rental by phone: a request-less booking was left behind');
must(pr && (await one('SELECT status FROM request_status WHERE request_key = ?1', pr.request_key) || {}).status === 'scheduled', 'rental by phone: the request is not Scheduled');
must(pr && !(await one('SELECT * FROM holds WHERE request_key = ?1', pr.request_key)), 'rental by phone: a hold was made');
must(pr && rental.location.startsWith('/admin/?m=') && rental.location.endsWith(`#c-${rk(pr.request_key)}`), 'rental by phone: Save does not land on its Requests card');
must(pr && (await all('SELECT what FROM request_events WHERE request_key = ?1', pr.request_key)).some((e) => e.what === PR.ADDED_EVENT), 'rental by phone: no "Added from a phone call by Valerie" history line');
must(pr && JSON.parse(pr.services).join() === 'rentals' && /How it came in/.test(pr.answers), 'rental by phone: services / How it came in not on the request');

const cardOf = (html, key) => { const id = `id="c-${rk(key)}"`; const i = html.indexOf(id); if (i < 0) return ''; const start = html.lastIndexOf('<article', i); return html.slice(start, html.indexOf('</article>', i)); };
let dash = await get('/admin/');
let card = pr ? cardOf(dash.text, pr.request_key) : '';
must(Boolean(card), 'phone request: no card on Requests');
must(/data-phone-chip[^>]*data-help="card.phoneChip"[^>]*>From a phone call</.test(card), 'phone card: no "From a phone call" chip with its tooltip');
must(/data-progress/.test(card) && /data-edit-link/.test(card), 'phone card: no steps or Edit link');
must(/data-id-phone>Not collected \(phone booking\)</.test(card) && /data-id-upload/.test(card) && /data-help="card.idUpload"/.test(card), 'phone card: the ID line is not "Not collected (phone booking)" + the optional upload');
must(/Not asked \(phone booking\)/.test(card), 'phone card: the rules line is not "Not asked (phone booking)"');
must(/pickup Sun 18 Oct, back Tue 20 Oct \(2 days\)/.test(card) && !/for one day/.test(card), 'phone card: the rental length is not read from the booked days');
must(!/Confirmation email sent/.test(card), 'phone card: shows Confirmation email sent');
must(!/data-hold|Held — waiting/.test(card), 'phone card: shows a hold');

// Deposit received: no automatic confirmation email, the confirmed screen says why.
const sentBefore = env.sent.length;
const dep = await post('/admin/requests/status', { r: rk(pr.request_key), status: 'deposit_paid' });
must(dep.status === 303 && /\/admin\/confirmed/.test(dep.location), 'phone request: deposit received did not go to the confirmed screen');
must(!env.sent.slice(sentBefore).some((m) => /confirm/i.test(JSON.stringify(m.template || m.subject || m))), 'phone request: an automatic confirmation email went out on deposit');
must(!(await one('SELECT confirm_emailed_at FROM requests WHERE request_key = ?1', pr.request_key)).confirm_emailed_at, 'phone request: confirm_emailed_at was set');
const conf = await get(dep.location);
must(/data-phone-no-confirm/.test(conf.text) && !/Confirmation email sent/.test(conf.text), 'phone request: the confirmed screen shows Confirmation email sent or no phone line');
const em = await post('/admin/msg/email', { r: rk(pr.request_key), template: 'confirmation' });
must(env.sent.length === sentBefore && /no confirmation email/i.test(decodeURIComponent(em.location)), 'phone request: Email it sent a confirmation email');
must((await CM.autoConfirm(env, pr.request_key)).sent === false && env.sent.length === sentBefore, 'phone request: autoConfirm sends');
dash = await get('/admin/');
card = cardOf(dash.text, pr.request_key);
must(Boolean(card) && !/Confirmation email sent/.test(card) && !/data-msg="confirmation"[^]*?Email it/.test(card.replace(/data-msg="pickupTime"[^]*$/, '')), 'phone card after deposit: Confirmation email sent shown, or a confirmation Email it link');
// Even with the old stand-in timestamp set, a phone card never says it.
await db.prepare("UPDATE requests SET confirm_emailed_at = datetime('now') WHERE request_key = ?1").bind(pr.request_key).run();
must(!/Confirmation email sent/.test(cardOf((await get('/admin/')).text, pr.request_key)), 'phone card: shows Confirmation email sent from a stray confirm_emailed_at');
await db.prepare('UPDATE requests SET confirm_emailed_at = NULL WHERE request_key = ?1').bind(pr.request_key).run();

// Thank-you + day-before reminder go to the phone request's email like any request.
await db.prepare("UPDATE request_status SET status = 'job_done', job_done_at = '2026-10-20 18:00:00' WHERE request_key = ?1").bind(pr.request_key).run();
const ty = await CM.sendThankYous(env, new Date('2026-10-21T16:00:00Z'));
must(ty.sent >= 1 && env.sent.some((m) => JSON.stringify(m).includes('pat@example.com')), 'phone request: the thank-you email did not go out');
await db.prepare("UPDATE request_status SET status = 'scheduled', job_done_at = NULL WHERE request_key = ?1").bind(pr.request_key).run();
const to = [];
await RM.sendEmailReminders(db, async (m) => { to.push(m.to); return true; }, new Date('2026-10-17T16:00:00Z'));
must(to.includes('pat@example.com'), 'phone request: no day-before reminder email to its email');

// ID upload later (ID-for-everyone): the phone card takes one.
const jpg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9])], 'id.jpg', { type: 'image/jpeg' });
const up = await post('/admin/requests/id/upload', { r: rk(pr.request_key), id_photo: jpg });
const withId = await one('SELECT id_object FROM requests WHERE request_key = ?1', pr.request_key);
must(up.status === 303 && withId.id_object && env.idObjects.has(withId.id_object), 'Add ID photo: the photo was not stored');
card = cardOf((await get('/admin/')).text, pr.request_key);
must(/Open ID photo/.test(card) && !/Not collected/.test(card), 'Add ID photo: the card still says Not collected');

// Porch by phone + calendar note + no name.
const n1 = await reqCount();
await post('/admin/calendar/bookings', { service: 'porch', kind: 'porch_install', date: '2026-10-24', time: '10:00', customer_name: 'Pam Porchcall', phone: '901-555-0102', email: '', place: '1 Example St', items: 'Fall porch', note: 'gate code' });
const pp = await one("SELECT * FROM requests WHERE name = 'Pam Porchcall'");
must(pp && pp.source === 'phone' && JSON.parse(pp.services).join() === 'porch', 'porch by phone: no porch phone request');
must(pp && (await all('SELECT kind FROM bookings WHERE request_key = ?1', pp.request_key)).map((b) => b.kind).join() === 'porch_install', 'porch by phone: the install is not linked');
must(pp && cardOf((await get('/admin/')).text, pp.request_key).includes('data-phone-chip'), 'porch by phone: no card with the chip');
// A kind from another service is corrected to the picked service.
await post('/admin/calendar/bookings', { service: 'grazing', kind: 'rental_return', date: '2026-10-25', customer_name: 'Gus Grazecall', phone: '901-555-0103', items: 'Board' });
must((await one("SELECT b.kind FROM bookings b JOIN requests r ON r.request_key = b.request_key WHERE r.name = 'Gus Grazecall'") || {}).kind === 'grazing_setup', 'service choice: a kind outside the picked service was saved');
const n2 = await reqCount();
must(n2 === n1 + 2, `phone bookings: ${n2 - n1} requests for 2 bookings`);
await post('/admin/calendar/bookings', { service: 'note', kind: 'other', date: '2026-10-26', customer_name: 'Supply run', phone: '', items: 'Pick up balloons' });
const note = await one("SELECT * FROM bookings WHERE customer_name = 'Supply run'");
must(note && note.request_key === null && note.calendar_note === 1 && (await reqCount()) === n2, 'calendar note: it made a request, or is not marked calendar_note');
await post('/admin/calendar/bookings', { service: 'note', kind: 'rental_pickup', date: '2026-10-27', return_date: '2026-10-28', customer_name: '', items: 'Inventory check' });
must((await all("SELECT calendar_note, request_key FROM bookings WHERE items = 'Inventory check'")).every((b) => b.calendar_note === 1 && b.request_key === null) && (await reqCount()) === n2, 'calendar note (rental kind): the pair is not request-less notes');
await post('/admin/calendar/bookings', { service: 'party', kind: 'party_setup', date: '2026-10-29', customer_name: '', items: 'x' });
must((await reqCount()) === n2 && !(await one("SELECT id FROM bookings WHERE date = '2026-10-29'")), 'a service with no customer name saved a booking or a request');
// Holds are only ever made by the site form.
must(!/createHold/.test(fs.readFileSync(path.join(ROOT, 'functions/_lib/phone-requests.mjs'), 'utf8') + fs.readFileSync(path.join(ROOT, 'functions/_lib/admin-calendar.mjs'), 'utf8')), 'phone path: createHold is reachable from Add a booking');
must((await one("SELECT COUNT(*) AS n FROM holds h JOIN requests r ON r.request_key = h.request_key WHERE r.source = 'phone'")).n === 0, 'phone requests: a hold row exists');

// ---- 5. Backfill ---------------------------------------------------------------------------
{
  const B = await session();
  const ins = (b) => B.db.raw.prepare(`INSERT INTO bookings (request_key, kind, date, customer_name, phone, email, place, items, edited_by_hand, calendar_note, created_at) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, '2026-10-10 12:00:00')`).run(b.kind, b.date, b.name, b.phone || '', b.email || '', b.place || '', b.items || '', b.note ? 1 : 0).lastInsertRowid;
  const rp = ins({ kind: 'rental_pickup', date: '2026-10-18', name: 'Rae Rental', phone: '9015550111', items: 'Giant Uno' });
  const rr = ins({ kind: 'rental_return', date: '2026-10-20', name: 'Rae Rental', phone: '9015550111', items: 'Giant Uno' });
  ins({ kind: 'rental_pickup', date: '2026-11-01', name: 'Rae Rental', phone: '9015550111', items: 'Giant Jenga' });
  ins({ kind: 'rental_return', date: '2026-11-02', name: 'Rae Rental', phone: '9015550111', items: 'Giant Jenga' });
  ins({ kind: 'porch_install', date: '2026-10-24', name: 'Paz Porch', place: '2 Example St', items: 'Fall porch' });
  ins({ kind: 'porch_takedown', date: '2026-11-03', name: 'Paz Porch', place: '2 Example St', items: 'Fall porch' });
  ins({ kind: 'grazing_setup', date: '2026-10-25', name: '', items: 'nameless' });
  ins({ kind: 'party_setup', date: '2026-10-26', name: 'Day off', note: true });
  ins({ kind: 'other', date: '2026-10-27', name: 'Dentist' });
  B.db.raw.prepare("INSERT INTO rental_returns (return_key, booking_id, returned_at, items, damaged) VALUES (?, ?, '2026-10-20 20:00:00', '[]', 0)").run(`booking:${rr}`, rr);
  // The already-converted case: a 'site' row added by hand from a phone call.
  B.db.raw.prepare(`INSERT INTO requests (request_key, source, submitted_at, services, name, email, phone, answers, referral_code, receipt_id, confirm_emailed_at)
    VALUES ('site|hand', 'site', '2026-10-18 12:00:00', '["rentals"]', 'Tam Example', 'tam@example.com', '9015550199', ?, 'tamref01', 'tamrcpt', '2026-10-18 12:05:00')`).run(JSON.stringify([{ group: 'rentals', label: 'Which games?', value: 'Giant Uno' }, { group: 'rentals', label: 'How long?', value: 'Sunday pickup, Tuesday return' }, { group: 'rentals', label: 'Pickup date', value: '2026-10-18' }, { group: 'rentals', label: 'Return date', value: '2026-10-20' }, { group: 'other', label: 'How it came in', value: 'Phone call (added by Valerie)' }]));
  B.db.raw.prepare("INSERT INTO request_status (request_key, status) VALUES ('site|hand', 'paid')").run();
  const read = async () => ({ bookings: await B.all('SELECT * FROM bookings WHERE request_key IS NULL'), requests: await B.all("SELECT * FROM requests WHERE source = 'site'"), returns: await B.all("SELECT * FROM rental_returns WHERE return_key LIKE 'booking:%'") });
  const plan = PR.backfillPlan(await read());
  must(plan.created.length === 3, `backfill: ${plan.created.length} requests planned (want 3: two rentals, a porch + its takedown; nothing for a nameless / note / other booking)`);
  must(plan.created.filter((c) => c.pair).length === 2, 'backfill: a rental pickup + return is not one request');
  must(plan.converted.length === 1, `backfill: ${plan.converted.length} hand-added requests converted (want 1)`);
  for (const [sql, args] of nonEmpty(plan.stmts, 'backfill statements')) await B.db.prepare(sql).bind(...args).run();
  const firstRental = await B.one('SELECT request_key FROM bookings WHERE id = ?1', rp);
  const pairKinds = (await B.all('SELECT kind FROM bookings WHERE request_key = ?1 ORDER BY date', firstRental.request_key)).map((b) => b.kind).join();
  must(pairKinds === 'rental_pickup,rental_return', `backfill: the first rental's request holds ${pairKinds}`);
  must((await B.one('SELECT source FROM requests WHERE request_key = ?1', firstRental.request_key)).source === 'phone', "backfill: the made request is not source 'phone'");
  must((await B.one('SELECT return_key, request_key FROM rental_returns WHERE booking_id = ?1', rr)).request_key === firstRental.request_key, 'backfill: the check-in did not follow the rental to its request');
  must((await B.one('SELECT thankyou_skip FROM requests WHERE request_key = ?1', firstRental.request_key)).thankyou_skip === 1, 'backfill: an already-returned rental would get a surprise thank-you');
  const porchKey = (await B.one("SELECT request_key FROM bookings WHERE customer_name = 'Paz Porch' AND kind = 'porch_install'")).request_key;
  must(porchKey && (await B.one("SELECT request_key FROM bookings WHERE customer_name = 'Paz Porch' AND kind = 'porch_takedown'")).request_key === porchKey, 'backfill: a porch install and its takedown are not one request');
  must((await B.one("SELECT request_key FROM bookings WHERE customer_name = 'Day off'")).request_key === null && (await B.one("SELECT request_key FROM bookings WHERE customer_name = 'Dentist'")).request_key === null, 'backfill: a calendar note or an Other block became a request');
  const tam = await B.one("SELECT * FROM requests WHERE request_key = 'site|hand'");
  must(tam.source === 'phone' && tam.confirm_emailed_at === null, "backfill: the hand-added request is not 'phone' with confirm_emailed_at cleared");
  must((await B.all("SELECT what FROM request_events WHERE request_key = 'site|hand'")).some((e) => e.what === PR.CONVERT_EVENT), 'backfill: no history line on the converted request');
  const sent0 = B.env.sent.length;
  must((await CM.autoConfirm(B.env, 'site|hand')).sent === false && B.env.sent.length === sent0, 'backfill: the converted request would get a confirmation email');
  const tamCard = cardOf((await B.get('/admin/')).text, 'site|hand');
  must(/From a phone call/.test(tamCard) && !/Confirmation email sent/.test(tamCard) && /pickup Sun 18 Oct, back Tue 20 Oct \(2 days\)/.test(tamCard), 'backfill: the converted card lacks the chip / still says Confirmation email sent / wrong rental length');
  const again = PR.backfillPlan(await read());
  must(again.stmts.length === 0 && again.created.length === 0 && again.converted.length === 0, `backfill: not idempotent (${again.stmts.length} statements on the second run)`);
  must(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').includes('"admin:backfill-phone": "node scripts/admin/backfill_phone_requests.mjs"'), 'backfill: npm run admin:backfill-phone is not registered');
}

// ---- 6. Rental length from the booked days -------------------------------------------------
const CASES = nonEmpty([['2026-10-18', '2026-10-20', 'pickup Sun 18 Oct, back Tue 20 Oct (2 days)'], ['2026-10-18', '2026-10-19', 'pickup Sun 18 Oct, back Mon 19 Oct (1 day)'], ['2026-10-23', '2026-10-26', 'pickup Fri 23 Oct, back Mon 26 Oct (weekend)'], ['2026-10-18', '2026-10-22', 'pickup Sun 18 Oct, back Thu 22 Oct (4 days)']], 'length cases');
for (const [a, b, want] of CASES) must(PR.rentalSpanWords(a, b) === want, `rental length ${a} -> ${b}: "${PR.rentalSpanWords(a, b)}"`);
must(PR.rentalSpanWords('2026-10-18', '') === '' && PR.rentalSpanWords('2026-10-20', '2026-10-18') === '', 'rental length: words without both days, or backwards');
const rr = { key: 'k', gamesAnswer: 'Giant Uno', durationAnswer: 'One day', wantsRentals: true, rentals: [{ label: 'Pickup date', value: '2026-10-18' }], decor: [], other: [], services: ['rentals'] };
must(/for one day, 2026-10-18$/.test(V.wantSummary(rr)[0]), 'rental length: a rental with no return day lost its old words');
must(V.wantSummary(rr, [{ kind: 'rental_pickup', date: '2026-10-18' }, { kind: 'rental_return', date: '2026-10-20' }])[0] === 'Games: Giant Uno, pickup Sun 18 Oct, back Tue 20 Oct (2 days)', `rental length (card): "${V.wantSummary(rr, [{ kind: 'rental_pickup', date: '2026-10-18' }, { kind: 'rental_return', date: '2026-10-20' }])[0]}"`);
const lines2 = prefillLines({ ...rr, rentalPickup: '2026-10-18', rentalReturn: '2026-10-20' }, S.PRICE_TABLE).filter((l) => !l.refundable);
must(nonEmpty(lines2, 'invoice lines').every((l) => /pickup Sun 18 Oct, back Tue 20 Oct \(2 days\)/.test(l.description) && !/1 day/.test(l.description)), 'rental length (invoice): a 2-day rental line still says 1 day');
must(prefillLines({ ...rr, rentalPickup: '2026-10-18', rentalReturn: '2026-10-19' }, S.PRICE_TABLE).filter((l) => !l.refundable).every((l) => /1 day/.test(l.description)), 'rental length (invoice): a next-day rental changed its words');
const inv = await get(`/admin/invoices/new?r=${rk(pr.request_key)}`);
must(/pickup Sun 18 Oct, back Tue 20 Oct \(2 days\)/.test(inv.text), 'rental length (invoice): the new invoice for the phone rental does not read the booked days');

// ---- 7. The month on a 390 px phone ----------------------------------------------------------
const cal = await get('/admin/calendar?month=2026-10');
const css = (cal.text.match(/<style>([^]*?)<\/style>/g) || []).join('\n');
// Calm calendar (owner-approved 19 Oct 2026): under 900 px the big grid gives way to the phone
// month (7 small columns with dots) and the tapped day's panel (one .mday at a time).
must(/@media\(max-width:899px\)\{\.month\{display:none\}\.monthlist\{display:grid;gap:8px\}\}/.test(css) && /\.monthlist\{display:none\}/.test(css), '390 px: the month grid is not swapped for the phone day under 900 px');
must(/@media\(max-width:899px\)\{[^]*?\.pmonth\{display:grid;grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/.test(css) && /\.pmonth\{display:none\}/.test(css) && /\.monthlist \.mday\{display:none\}\.monthlist \.mday\.sel\{display:grid\}/.test(css), '390 px: no 7-column phone month, or more than the tapped day shows');
must(/\.month\{display:grid;grid-template-columns:repeat\(7,minmax\(0,1fr\)\);gap:3px\}/.test(css), '1280 px: the computer month grid changed');
const mdayRules = css.match(/\.mday[^{]*\{[^}]*\}/g) || [];
must(nonEmpty(mdayRules, '.mday rules').every((r) => !/(?:^|[;{])(?:min-)?width:\s*(\d{3,})px/.test(r)), '390 px: a day-list rule has a fixed width');
must(mdayRules.some((r) => /^\.mday \.k\{/.test(r) && /overflow-wrap:anywhere/.test(r) && /white-space:normal/.test(r) && /max-width:100%/.test(r)), '390 px: day-list chips can overflow (need overflow-wrap:anywhere, white-space:normal, max-width:100%)');
const list = (cal.text.match(/<div class="monthlist" data-month-list data-phone-day>([^]*?)<\/div>\s*<\/div><\/section>/) || [])[1] || '';
must((list.match(/data-month-day="2026-10-\d\d"/g) || []).length === 31 && (list.match(/class="mday[^"]* sel"/g) || []).length === 1, '390 px: the phone month does not hold a panel for each of the 31 days with exactly one shown');
must((cal.text.match(/<a class="pd[^"]*" href="[^"]*" data-pday="2026-10-\d\d"/g) || []).length === 31, '390 px: the phone month does not have 31 tappable days');
must(Boolean(list), '390 px: no day list in the month');
for (const who of nonEmpty(['Pat Phonecall', 'Pam Porchcall', 'Gus Grazecall', 'Supply run'], 'day-list names')) must(list.includes(`: ${who}`), `390 px: ${who}'s chip is not in the day list in full`);
must(/data-month-day="2026-10-18"[^]*?Rental pickup: Pat Phonecall/.test(list) && /data-month-day="2026-10-20"[^]*?Rental return: Pat Phonecall/.test(list), '390 px: the day list is not by day');
must((list.match(/data-month-day="(\d{4}-\d{2}-\d{2})"/g) || []).map((x) => x.slice(16, 26)).every((d, i, a) => !i || a[i - 1] < d), '390 px: the day list is not in day order');
must(/<span class="k req [^"]*"[^>]*data-requested=/.test(list) || !/data-requested=/.test(cal.text.split('data-month-list')[0]), '390 px: an outlined Requested chip in the grid is missing from the day list');

// ---- 8. Help ---------------------------------------------------------------------------------
const help = await get('/admin/help');
must(/data-help-phone/.test(help.text) && /From a phone call/.test(help.text) && /Just a calendar note \(no customer\)/.test(help.text) && /ID: not collected \(phone booking\)/.test(help.text), 'help: no phone-booking section');
for (const k of nonEmpty(['card.phoneChip', 'card.idUpload', 'bk.service', 'bk.note'], 'new help keys')) must(Boolean(H.HELP[k]) && help.text.includes(`data-help-entry="${k}"`), `help: ${k} missing from the map or the help page`);
const doc = fs.readFileSync(path.join(ROOT, 'docs/admin-console.md'), 'utf8');
must(/## Phone requests/.test(doc) && /validate:admin-phone/.test(doc), 'docs/admin-console.md: no Phone requests section');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
must(/npm run validate:admin-phone(\s|$)/.test(pkg['validate:admin']) && pkg['validate:admin-phone'] === 'node --no-warnings scripts/validators/validate_admin_phone.mjs', 'validate:admin-phone is not registered in validate:admin');

if (checks < 90) errors.push(`Rule 0: only ${checks} checks ran (want >= 90)`);
if (errors.length) {
  console.error(`VALIDATION FAIL: admin-phone (${errors.length} of ${checks} checks)`);
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}
console.log(`VALIDATION PASS: admin-phone (${checks} checks: migration 0012, Add a booking -> phone request + card, calendar note, no hold / confirmation email, backfill, rental length, 390 px month, help)`);
