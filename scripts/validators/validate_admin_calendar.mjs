#!/usr/bin/env node
/**
 * Calendar & Bookings, Put away, Void, payments, reminders, rental check-in, notes and
 * "Find a customer" for the /admin console (docs/admin-console.md), proven end to end through
 * the real guard + router on a local SQLite copy of the schema (every migration applied).
 * Nothing here touches production or the Google Sheet (the sheet is the fixture).
 *
 * Rule 0: every section counts its checks; zero checks run is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, mod, makeDb, applyMigration } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (cond, msg) => { checks += 1; if (!cond) errors.push(msg); };

const C = await mod('functions/_lib/calendar.mjs');
const VC = await mod('functions/_lib/views-calendar.mjs');
const K = await mod('functions/_lib/kinds.mjs');
const R = await mod('functions/_lib/reminders.mjs');
const L = await mod('functions/_lib/ledger.mjs');
const P = await mod('functions/_lib/progress.mjs');
const util = await mod('functions/_lib/util.mjs');
const { rowsToRequests } = await mod('functions/_lib/sheet.mjs');
const { PRICE_TABLE } = await mod('functions/_lib/prices.mjs');
const email = await mod('functions/_lib/email.mjs');
const pdf = await mod('functions/_lib/pdf.mjs');
const views = await mod('functions/_lib/views.mjs');
const today = R.chicagoDate();

// ---- 1. Migration 0004 keeps every existing row and maps statuses ---------------------------
{
  const db = makeDb({ upTo: 3 });
  db.raw.exec(`INSERT INTO invoices (id, number, request_key, customer_name, issue_date, due_date, deposit_due_cents, status) VALUES
    (1, 'PNP-2026-0001', 'k1', 'Ann Paid', '2026-10-01', '2026-10-08', 5000, 'paid'),
    (2, 'PNP-2026-0002', 'k2', 'Bo Deposit', '2026-10-01', '2026-10-08', 4000, 'deposit_paid'),
    (3, 'PNP-2026-0003', 'k3', 'Cy Done', '2026-10-01', '2026-10-08', 0, 'done'),
    (4, 'PNP-2026-0004', 'k6', 'Di Handpaid', '2026-10-01', '2026-10-08', 0, 'sent');
    INSERT INTO invoice_lines (invoice_id, description, qty, unit_cents, refundable) VALUES (1, 'Giant Uno (1 day)', 1, 10000, 0), (2, 'Porch', 1, 8000, 0), (3, 'Party', 1, 6000, 0), (4, 'Grazing table', 1, 7000, 0);
    INSERT INTO request_status (request_key, status, invoice_id) VALUES ('k1', 'paid', 1), ('k2', 'deposit_paid', 2), ('k3', 'done', 3), ('k4', 'new', NULL), ('k5', 'invoiced', NULL), ('k6', 'paid', 4);`);
  applyMigration(db, 4);
  const rows = db.raw.prepare('SELECT request_key, status, invoice_id, job_done_at FROM request_status ORDER BY request_key').all();
  must(rows.length === 6, `migration 0004 kept ${rows.length} of 6 request_status rows`);
  const by = Object.fromEntries(rows.map((r) => [r.request_key, r]));
  must(by.k1.status === 'paid' && by.k2.status === 'deposit_paid' && by.k4.status === 'new' && by.k5.status === 'invoiced', 'migration 0004 changed a status it should keep');
  must(by.k3.status === 'job_done' && by.k3.job_done_at, "migration 0004 does not map 'done' to 'job_done' with job_done_at");
  must(by.k1.invoice_id === 1, 'migration 0004 lost an invoice link');
  const pays = db.raw.prepare('SELECT invoice_id, amount_cents, method FROM payments ORDER BY invoice_id').all();
  must(pays.length === 3 && pays[0].amount_cents === 10000 && pays[1].amount_cents === 4000 && pays[2].invoice_id === 4 && pays[2].amount_cents === 7000 && pays.every((x) => /unknown/.test(x.method)), `migration 0004 payments backfill is wrong: ${JSON.stringify(pays)}`);
  let threw = false;
  try { db.raw.exec("INSERT INTO request_status (request_key, status) VALUES ('k9', 'void')"); db.raw.exec("INSERT INTO request_status (request_key, status) VALUES ('k10', 'scheduled')"); } catch { threw = true; }
  must(!threw, 'request_status does not accept void / scheduled after 0004');
  threw = false;
  try { db.raw.exec("INSERT INTO request_status (request_key, status) VALUES ('k11', 'done')"); } catch { threw = true; }
  must(threw, "request_status still accepts the retired 'done' status");
  const sql = fs.readFileSync(path.join(ROOT, 'migrations/0004_calendar_archive_void.sql'), 'utf8');
  must(!/DELETE FROM/i.test(sql) && !/DROP TABLE (?!request_status;)/i.test(sql), 'migration 0004 deletes data or drops a table other than the rebuilt request_status');
}

// ---- 2. Pure rules -----------------------------------------------------------------------
must(C.returnDateFor('2026-10-24', 'One day (24 hours)') === '2026-10-25', 'one-day rental does not return the next day');
must(C.returnDateFor('2026-10-30', 'Weekend (Friday pickup, Monday return)') === '2026-11-02', 'weekend rental picked up Friday does not return Monday');
must(C.returnDateFor('2026-10-31', 'Weekend') === '2026-11-02', 'weekend rental picked up Saturday does not return the next Monday');
must(C.parseFormDate('10/24/2026') === '2026-10-24' && C.parseFormDate('2/30/2026') === '', 'form dates are not read right');
// Bundle expansion and games out.
const exp = (t) => C.expandItems(t, PRICE_TABLE);
must(exp('Pick 3 bundle ($110)').unnamed === 3, 'Pick 3 does not count as 3 games');
// Every available item by kind (7 since Giant Checkers went unavailable, 18 Oct 2026; its 8 is both Color Stack sets).
must(JSON.stringify(exp('The Whole Party, all 8 items ($235 day / $350 weekend)').names) === JSON.stringify(PRICE_TABLE.items.map((i) => i.name)) && PRICE_TABLE.items.length === 7 && !PRICE_TABLE.items.some((i) => /checkers/i.test(i.name)), 'The Whole Party does not count every available item');
must(exp('Movie Night bundle, weekend: Inflatable Movie Screen, Giant Uno, Grab the Mic').names.length === 3, 'Movie Night bundle lines miscounted');
{
  const bk = [
    { id: 1, request_key: 'a', kind: 'rental_pickup', date: '2026-11-06', customer_name: 'Ann', items: 'Giant Connect Four, Giant Uno' },
    { id: 2, request_key: 'a', kind: 'rental_return', date: '2026-11-09', customer_name: 'Ann', items: 'Giant Connect Four, Giant Uno' },
    { id: 3, request_key: 'b', kind: 'rental_pickup', date: '2026-11-08', customer_name: 'Bo', items: 'Giant Connect Four' },
    { id: 4, request_key: 'b', kind: 'rental_return', date: '2026-11-09', customer_name: 'Bo', items: 'Giant Connect Four' },
  ];
  const w = C.rentalWindows(bk, {}, PRICE_TABLE);
  const u7 = C.usageOn(w, '2026-11-07', '2026-11-01', PRICE_TABLE);
  const u8 = C.usageOn(w, '2026-11-08', '2026-11-01', PRICE_TABLE);
  must(u7.count === 2 && u8.count === 3, `multi-day games-out counts wrong: ${u7.count}, ${u8.count}`);
  must(u8.over.length === 1 && u8.over[0].item === 'Giant Connect Four', 'overbooking flag missing for Giant Connect Four (stock 1)');
  must(C.overlapWarnings(w, PRICE_TABLE, { today: '2026-11-01' }).length === 1, 'overlap warning missing');
  const returned = { a: { returned_at: '2026-11-07 15:00:00' } };
  const w2 = C.rentalWindows(bk, returned, PRICE_TABLE);
  must(C.usageOn(w2, '2026-11-08', '2026-11-01', PRICE_TABLE).count === 1, 'a rental returned early still counts as out');
  must(C.overlapWarnings(w2, PRICE_TABLE, { today: '2026-11-01' }).length === 0, 'a returned rental still blocks the item in the overlap check');
  const avail = C.availability(w, '2026-11-08', '2026-11-08', '2026-11-01', PRICE_TABLE);
  must(avail['Giant Connect Four'] < 0 && avail['Cornhole Set'] === 1 && avail['Giant Color Stack'] === 2, 'availability per item is wrong (Cornhole stock 1, Giant Color Stack stock 2, owner 18 Oct 2026)');
  const overdue = C.overdueReturns(bk, {}, '2026-11-10');
  must(overdue.length === 2, 'overdue returns not detected');
  must(C.overdueReturns(bk, { a: { returned_at: 'x' } }, '2026-11-10').length === 1, 'a returned rental is reported overdue');
}
// An all-games bundle takes BOTH Giant Color Stack sets out (owner, 18 Oct 2026); typed words
// "Giant Color Stack (1 set of 2)" (and the older "(2 sets)" on saved invoices) count 2; Cornhole is 1 set, so two overlapping cornhole bookings
// double-book it and the second finds none left.
{
  const CS = 'Giant Color Stack';
  const two = (t, why) => { const e = exp(t); must(e.counts[CS] === 2, `${why}: Giant Color Stack counted ${e.counts[CS]} sets, expected 2`); return e; };
  two('Whole Yard, all 6 games ($195)', 'Whole Yard form choice');
  two('Whole Yard', 'typed "Whole Yard"');
  two('The Whole Party, all 8 items ($235 day / $350 weekend)', 'The Whole Party form choice');
  two('Giant Color Stack (2 sets)', 'typed "Giant Color Stack (2 sets)" (older saved invoices)');
  two('Giant Color Stack (1 set of 2)', 'typed "Giant Color Stack (1 set of 2)"');
  two('Giant Color Stack (2 games)', 'typed "Giant Color Stack (2 games)"');
  two('2 Giant Color Stack', 'typed "2 Giant Color Stack"');
  two('Whole Yard bundle, 1 day: Giant Connect Four, Cornhole Set, Giant Uno, Grab the Mic, Giant Color Stack (2 sets)', 'Whole Yard invoice line (older wording)');
  two('Whole Yard bundle, 1 day: Giant Connect Four, Cornhole Set, Giant Uno, Grab the Mic, Giant Color Stack (1 set of 2)', 'Whole Yard invoice line');
  must(exp('Cornhole Set (1 set)').counts['Cornhole Set'] === 1, 'Cornhole "(1 set)" counts more than 1 game');
  must(exp('Giant Color Stack').counts[CS] === 1 && exp('Pick 3 bundle ($110): Giant Color Stack, 2 games of your choice').counts[CS] === 1, 'one Giant Color Stack named counts more than 1 set');
  must(exp('Pick 5 bundle ($175)').counts[CS] === 1, 'Pick 5 (5 games, one of each) takes more than one Giant Color Stack set');
  must(C.itemsText(exp('Whole Yard')).includes('Giant Color Stack (1 set of 2)') && !/2 sets/.test(C.itemsText(exp('Whole Yard'))), `the saved booking words for a Whole Yard do not say "Giant Color Stack (1 set of 2)": ${C.itemsText(exp('Whole Yard'))}`);
  must(C.expandItems(C.itemsText(exp('Whole Yard')), PRICE_TABLE).counts[CS] === 2, 'the saved Whole Yard words read back as fewer than 2 Color Stack games');
  const bk = (id, key, who, from, to, items) => [
    { id, request_key: key, kind: 'rental_pickup', date: from, customer_name: who, items },
    { id: id + 1, request_key: key, kind: 'rental_return', date: to, customer_name: who, items },
  ];
  const T = '2026-11-01';
  const wy = C.rentalWindows(bk(10, 'wy', 'Wy', '2026-11-14', '2026-11-15', 'Whole Yard, all 6 games ($195)'), {}, PRICE_TABLE);
  const u = C.usageOn(wy, '2026-11-14', T, PRICE_TABLE);
  must(u.byItem[CS].used === 2 && u.over.length === 0, `a Whole Yard marks ${u.byItem[CS].used} Giant Color Stack sets out, expected 2 of 2`);
  must(u.count === 6, `a Whole Yard counts ${u.count} games out, expected 6 (both Color Stack sets)`);
  must(C.availability(wy, '2026-11-14', '2026-11-14', T, PRICE_TABLE)[CS] === 0, 'a Whole Yard leaves a Giant Color Stack set free');
  must(/Giant Color Stack<\/strong><span>[^<]*\(2 of 2\)/.test(VC.gamesGrid(u, PRICE_TABLE).html), 'the games-out grid does not show both Giant Color Stack sets out (2 of 2)');
  const party = C.rentalWindows([...bk(10, 'wy', 'Wy', '2026-11-14', '2026-11-15', 'The Whole Party'), ...bk(20, 'cs', 'Cy', '2026-11-15', '2026-11-16', 'Giant Color Stack')], {}, PRICE_TABLE);
  const up = C.usageOn(party, '2026-11-15', T, PRICE_TABLE);
  must(up.over.some((o) => o.item === CS && o.used === 3), 'The Whole Party + one more Color Stack set is not flagged double-booked');
  must(C.overlapWarnings(party, PRICE_TABLE, { today: T }).some((w) => w.item === CS), 'the overlap warning misses a third Color Stack set');
  const ch = C.rentalWindows([...bk(30, 'c1', 'Ann', '2026-11-20', '2026-11-21', 'Cornhole set'), ...bk(40, 'c2', 'Bo', '2026-11-21', '2026-11-22', 'Cornhole set')], {}, PRICE_TABLE);
  must(C.availability(ch.filter((w) => w.key === 'c1'), '2026-11-21', '2026-11-22', T, PRICE_TABLE)['Cornhole Set'] === 0, 'a second cornhole booking overlapping the first still finds a set free (stock 1)');
  must(C.usageOn(ch, '2026-11-21', T, PRICE_TABLE).over.some((o) => o.item === 'Cornhole Set'), 'two overlapping cornhole bookings are not flagged double-booked');
}
// Every service has a kind; every kind has exactly one of the four colours; contrast.
{
  const brand = fs.readFileSync(path.join(ROOT, 'scripts/lib/brand.js'), 'utf8');
  const keys = [...brand.matchAll(/key: '([a-z]+)'/g)].map((m) => m[1]);
  must(keys.length === 4, `brand.js SERVICES has ${keys.length} keys, expected 4`);
  for (const k of keys) must(K.SERVICE_KINDS[k] && K.SERVICE_KINDS[k].kinds.length >= 1, `service ${k} has no booking kind`);
  const colours = new Set(Object.values(K.SERVICE_KINDS).map((s) => s.color));
  must(colours.size === 4 && ['orange', 'purple', 'green', 'blue'].every((c) => colours.has(c)), 'the four service colours are not orange/purple/green/blue');
  for (const kind of K.KINDS.filter((x) => x !== 'other')) {
    const owners = Object.values(K.SERVICE_KINDS).filter((s) => s.kinds.includes(kind));
    must(owners.length === 1, `kind ${kind} maps to ${owners.length} services`);
  }
  const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const s of [...Object.values(K.SERVICE_KINDS), K.OTHER_SERVICE]) must(ratio(K.INK, s.tint) >= 4.5, `${s.label}: text on its tint is under 4.5:1`);
  for (const k of K.KINDS) must(R.REMINDER_TEMPLATES[k], `no reminder template for ${k}`);
}
// A mixed request (party decor + grazing + games) makes the right bookings.
{
  const values = [
    ['Timestamp', 'Email Address', 'Full name', 'Phone number', 'What do you need?', 'Which games?', 'How long?', 'Pickup date', 'Event type', 'Location', 'Event date', 'Grazing table?', 'Need us to take it down afterwards?', 'Takedown date', 'Please confirm'],
    ['10/14/2026 9:15:02', 'mix@example.com', 'Mia Mixed', '901-555-0199', 'Game rentals, Event decor, Grazing table', 'Giant Uno', 'One day (24 hours)', '11/06/2026', 'Birthday party', '12 Oak St', '11/07/2026', 'Yes', 'Yes', '11/08/2026', 'I confirm'],
  ];
  const [req] = rowsToRequests(values);
  const rows = C.bookingsFromInvoice({ invoice: { id: 9, request_key: req.key, customer_name: req.name }, lines: [{ description: 'Giant Uno (1 day)', qty: 1, unit_cents: 4000 }, { description: 'Decor: Birthday party', qty: 1, unit_cents: 30000 }, { description: 'Grazing table', qty: 1, unit_cents: 20000 }], request: req, table: PRICE_TABLE, isRental: true });
  const kinds = rows.map((r) => `${r.kind}@${r.date}`).sort().join(' ');
  must(kinds === 'grazing_setup@2026-11-07 party_setup@2026-11-07 party_takedown@2026-11-08 rental_pickup@2026-11-06 rental_return@2026-11-07', `mixed request made: ${kinds}`);
}
// Balances across pay plans; damage deposit kept apart.
{
  const lines = [{ description: 'Pick 3', qty: 1, unit_cents: 12000 }, { description: 'Damage deposit (refundable)', qty: 1, unit_cents: 5000, refundable: 1 }];
  const b0 = L.balanceOf({ status: 'sent' }, lines, 0);
  must(b0.owed === 12000 && b0.refundable === 5000 && b0.depositOwed === 5000, 'balance before payment: damage deposit counted as owed or charges wrong');
  const half = L.balanceOf({ status: 'deposit_paid' }, lines, 8500);
  // The damage deposit is taken first (ledger.mjs splitPayment, 20 Oct 2026): after the half deposit
  // it is collected and the charges still to pay are the rest.
  must(half.owed === 8500 && half.depositOwed === 0 && half.remaining === 8500 && half.paidDeposit === 5000 && half.paidCharges === 3500 && half.paidInFull === false, 'half-plan balance after deposit is wrong');
  must(L.balanceOf({ status: 'paid' }, lines, 17000).owed === 0 && L.balanceOf({ status: 'paid' }, lines, 17000).depositOwed === 0, 'paid in full still owes');
  must(L.balanceOf({ status: 'void' }, lines, 0).owed === 0 && L.balanceWords(L.balanceOf({ status: 'void' }, lines, 0)) === '', 'void invoice shows a balance');
  must(L.balanceWords(b0) === '$170 due ($120 + $50 refundable deposit)' && L.balanceWords(L.balanceOf({}, lines, 17000)) === 'Paid in full ✓', `balance words wrong (${L.balanceWords(b0)})`);
  // One wording for an amount due (owner, 20 Oct 2026): the deposit apart in words, the numbers unchanged.
  must(L.dueWords(half) === '$85 due' && L.dueCents(half) === 8500 && L.balanceWords(half) === '$85 due' && half.owed === 8500, `dueWords after the half deposit (${L.dueWords(half)})`);
  // Less in than the damage deposit: the deposit still to pay, said in words, in the same total.
  const little = L.balanceOf({ status: 'deposit_paid' }, lines, 2000);
  must(L.dueWords(little) === '$150 due ($120 + $30 refundable deposit)' && L.dueCents(little) === little.remaining && little.remaining === 15000, `dueWords with less in than the damage deposit (${L.dueWords(little)})`);
  must(L.dueWords(L.balanceOf({ status: 'sent' }, lines.slice(0, 1), 0)) === '$120 due', 'dueWords without a refundable deposit is not "$X due"');
  must(L.dueWords(L.balanceOf({ status: 'paid' }, lines, 12000)) === '$50 due' && L.balanceWords(L.balanceOf({ status: 'paid' }, lines, 12000)) === '$50 due' && L.dueWords(L.balanceOf({ status: 'paid' }, [{ description: 'Damage deposit (refundable)', qty: 1, unit_cents: 5000, refundable: 1 }], 0)) === '$50 due (refundable deposit)' && L.dueWords(L.balanceOf({ status: 'paid' }, lines, 17000)) === '' && L.dueWords(L.balanceOf({ status: 'void' }, lines, 0)) === '', 'dueWords: deposit-only / paid / void wrong');
}
// Derived steps.
{
  const bal = (remaining, paid, total = 100) => ({ total, remaining, paid, owed: remaining, refundable: 0 });
  const d1 = P.deriveProgress({ st: { status: 'scheduled' }, inv: { status: 'paid', balance: bal(0, 100) }, scheduled: true });
  must(d1.current === 'scheduled' && d1.paidEarly && !d1.finished, 'paid early: should read Scheduled + Paid in full, not Finished');
  const d2 = P.deriveProgress({ st: { status: 'job_done' }, inv: { status: 'sent', balance: bal(50, 50) }, scheduled: true, ret: { returned_at: 'x', damaged: 1 }, rental: true });
  must(d2.current === 'job_done' && d2.label === 'Returned — check damage' && !d2.finished, 'rental returned with damage reads wrong');
  const d3 = P.deriveProgress({ st: { status: 'job_done', job_done_at: 'x' }, inv: { status: 'paid', balance: bal(0, 100) }, scheduled: true });
  must(d3.current === 'paid' && d3.finished, 'job done + paid in full is not Finished');
  must(P.deriveProgress({ st: { status: 'void' }, inv: { status: 'void', balance: bal(0, 0) } }).label === 'Void — cancelled', 'void does not read Void — cancelled');
  must(P.deriveProgress({ st: { status: 'new' } }).current === 'new', 'a new request is not New');
}
// Reminders: Chicago date boundary, sms: encoding.
{
  must(R.tomorrowChicago(new Date('2026-10-19T04:30:00Z')) === '2026-10-19', '11:30 PM Oct 18 in Memphis: tomorrow should be Oct 19');
  must(R.tomorrowChicago(new Date('2026-10-19T05:30:00Z')) === '2026-10-20', '12:30 AM Oct 19 in Memphis: tomorrow should be Oct 20');
  must(R.tomorrowChicago(new Date('2026-12-19T05:30:00Z')) === '2026-12-19', 'standard time: 11:30 PM Dec 18 should give tomorrow Dec 19');
  const text = R.reminderText({ kind: 'rental_pickup', customer_name: 'Jane Doe', date: '2026-10-25', place: 'Mt. Moriah Station' });
  must(text === 'Hi Jane, this is Valerie with Porch & Party. Reminder: your game rental pickup is tomorrow, Sun 25 Oct, at Mt. Moriah Station. Text me at 901-355-1518 to set your pickup time. See you then!', `rental pickup reminder wording: ${text}`);
  const link = R.smsLink('(901) 555-0100', 'Hi & bye?');
  must(link === 'sms:9015550100?&body=Hi%20%26%20bye%3F', `sms link encoding: ${link}`);
  must(R.smsLink('', 'x') === '' && R.normalizePhone('+1 901 555 0100') === '9015550100', 'phone normalising wrong');
  const terms = fs.readFileSync(path.join(ROOT, 'terms-and-conditions.html'), 'utf8');
  must(/transactional text messages about your quote, booking or rental/.test(terms), 'terms no longer carry the transactional text-message clause the reminders rely on');
  for (const k of K.KINDS) {
    const t = R.reminderText({ kind: k, customer_name: 'Jo', date: '2026-10-25', time: '10:00' });
    must(/Reminder:/.test(t) && !/discount|offer|sale|% off|promo/i.test(t), `${k} reminder is not purely transactional`);
  }
}
// Day sheet text for SMS.
{
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: i, kind: 'rental_pickup', customer_name: `Customer ${i}`, phone: '901-555-0100', items: 'Giant Uno, Cornhole Set', owed: 3500, note: 'Gate 4411', timeLabel: '' }));
  const t = C.daySheetText('2026-10-25', rows, { max: 480 });
  must(t.length <= 480 && /Full list: porchandparty901\.com\/admin\/day\/2026-10-25/.test(t) && /more\./.test(t), `day sheet SMS is not cut politely (${t.length} chars)`);
  const order = [{ id: 1, time: null, kind: 'rental_pickup' }, { id: 2, time: '14:00', kind: 'porch_install' }, { id: 3, time: '09:00', kind: 'rental_return' }].sort(C.daySort).map((x) => x.id).join(',');
  must(order === '3,2,1', `day sheet order is ${order}`);
}
// ICS validity.
{
  const long = 'x'.repeat(200);
  const ics = C.buildIcs([{ id: 7, kind: 'rental_pickup', date: '2026-10-24', customer_name: 'Jané Doe', phone: '901', items: `Uno, ${long}`, place: 'Mt. Moriah', noteList: [{ body: 'Gate code 4411; park, back' }] },
    { id: 8, kind: 'porch_install', date: '2026-10-25', time: '14:30', customer_name: 'Bo' }], { now: new Date('2026-10-18T12:00:00Z') });
  const { events, errors: icsErr } = C.parseIcs(ics);
  must(icsErr.length === 0, `ICS invalid: ${icsErr.join('; ')}`);
  must(events.length === 2 && events[0].UID.value === 'booking-7@porchandparty901.com', 'ICS UIDs are not stable booking ids');
  must(events[0].DTSTART.params === ';VALUE=DATE' && events[0].DTEND.value === '20261025', 'all-day event dates wrong');
  must(events[1].DTSTART.value === '20261025T143000' && events[1].DTEND.value === '20261025T153000', 'timed event wrong');
  must(events[0].SUMMARY.value === 'Rentals: Rental pickup — Jané Doe', `ICS summary: ${events[0].SUMMARY.value}`);
  must(events[0].DESCRIPTION.value.includes('Gate code 4411; park, back') && events[0].DESCRIPTION.value.includes('Phone: 901'), 'ICS description lacks phone or notes');
  must(ics.split('\r\n').some((l) => l.startsWith(' ')), 'ICS long lines are not folded');
}

// ---- 3. End to end through the guard + router ---------------------------------------------
const s = await session();
const [reqA, reqB] = [s.requests.find((r) => r.email === 'test.renter@example.com'), s.requests.find((r) => r.email === 'weekend.renter@example.com')];
must(reqA && reqB, 'fixture requests missing');
// Auth: signed out, /admin/calendar and search redirect to sign-in; cross-site POST refused.
must((await s.get('/admin/calendar', { auth: false })).status === 303, 'Calendar is reachable signed out');
must((await s.get('/admin/search?q=test', { auth: false })).location === '/admin', 'search is reachable signed out');
must((await s.post('/admin/day/2026-10-24/email', {}, { headers: { Origin: 'https://evil.example' } })).status === 403, 'Email it to me accepts a cross-site POST');

// Only the request cards of a Requests page (the weekly count box lists the week's names too).
const cardsOf = (html) => html.split(/<article class="card[^"]*" data-card=/).slice(1).map((c) => c.slice(0, c.indexOf('</article>'))).join('\n');
// Archive round trip.
{
  const r = await s.post('/admin/requests/archive', { r: s.rk(reqB.key) }, { headers: { 'X-Pnp-Fetch': '1' } });
  must(r.status === 200, 'archive POST (fetch) failed');
  const dash = (await s.get('/admin/')).text;
  // The request cards (the weekly count box above them lists every request of the week, put away or not).
  const cards = cardsOf(dash);
  must(!cards.includes('Weekend Renter') && cards.includes('Test Renter'), 'an archived request is still on the main list');
  // Put away left the nav (JOB B): the old route opens the collapsed section at the bottom of Requests.
  const oldRoute = await s.get('/admin/archive');
  must(oldRoute.status === 303 && oldRoute.location === '/admin/?pa=1#put-away', '/admin/archive does not redirect to the opened Put away section');
  const put = (await s.get('/admin/?pa=1')).text;
  const section = put.slice(put.indexOf('id="put-away-section"'));
  must(/<details[^>]*id="put-away"[^>]*\bopen\b/.test(put) && /Put away \(1\)/.test(section) && section.includes('Weekend Renter') && /data-archived=[\s\S]*Bring back/.test(section), 'the Put away section does not list the archived request with Bring back');
  must(!/<details[^>]*id="put-away"[^>]*\bopen\b/.test(dash), 'the Put away section is open by default');
  const undo = (await s.get(`/admin/?put=${s.rk(reqB.key)}`)).text;
  must(/Put away\.<\/strong><form method="post" action="\/admin\/requests\/unarchive">/.test(undo) && undo.includes('data-autohide'), 'no "Put away. Undo" banner after archiving');
  await s.post('/admin/requests/unarchive', { r: s.rk(reqB.key) });
  must(cardsOf((await s.get('/admin/')).text).includes('Weekend Renter'), 'Bring back does not return the request to the list');
  const row = await s.one('SELECT archived_at FROM request_status WHERE request_key = ?1', reqB.key);
  must(row && row.archived_at === null, 'unarchive did not clear archived_at (row must stay, never deleted)');
}

// Invoice -> bookings auto-create, no duplicates on re-send.
let invA;
{
  invA = await s.invoiceFor(reqA, { go: 'save' });
  must(invA.id > 0, 'invoice create failed');
  let rows = await s.all('SELECT kind, date FROM bookings WHERE request_key = ?1 ORDER BY kind', reqA.key);
  const got = rows.map((r) => `${r.kind}@${r.date}`).join(' ');
  must(got === 'party_setup@2026-10-24 party_takedown@2026-10-25 rental_pickup@2026-10-24 rental_return@2026-10-25', `bookings from the invoice: ${got}`);
  await s.post(`/admin/invoices/${invA.id}/send`, {});
  await s.post(`/admin/invoices/${invA.id}/send`, {});
  rows = await s.all('SELECT id FROM bookings WHERE request_key = ?1', reqA.key);
  must(rows.length === 4, `re-sending duplicated bookings (${rows.length})`);
  must(s.env.sent.filter((m) => m.to === reqA.email).length === 2, 'invoice emails not sent');
  const pickup = await s.one("SELECT items FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", reqA.key);
  must(/Giant Connect Four/.test(pickup.items) && /Card Table with Cup Holders/.test(pickup.items), `pickup items not from the invoice lines: ${pickup.items}`);
}

// Payments: deposit then full, exact amounts; mark-paid confirmation wording.
{
  const page = (await s.get(`/admin/invoices/${invA.id}`)).text;
  must(page.includes(`Mark ${reqA.name} as paid in full? Only do this after the money is in your account.`), 'paid-in-full confirmation wording missing');
  must(!/<summary[^>]*>More options<\/summary>[\s\S]*?(Mark paid in full|Mark deposit received)[\s\S]*?<\/details>/.test(page.split('data-payment')[0] + page.split('</section>').slice(-1)[0]), 'a money action sits under More options');
  const more = (page.match(/<summary[^>]*>More options<\/summary>([\s\S]*?)<\/details>/) || ['', ''])[1];
  must(more && !/deposit_paid|value="paid"|value="void"/.test(more), 'More options still holds a payment or void action');
  await s.post(`/admin/invoices/${invA.id}/status`, { action: 'deposit_paid', method: 'zelle' });
  const bals = await L.balances(s.db);
  const b = bals[invA.id];
  const inv = await s.one('SELECT deposit_due_cents FROM invoices WHERE id = ?1', invA.id);
  must(b.paid === inv.deposit_due_cents, `deposit recorded ${b.paid}, expected ${inv.deposit_due_cents}`);
  await s.post(`/admin/invoices/${invA.id}/status`, { action: 'paid', method: 'cash' });
  const b2 = (await L.balances(s.db))[invA.id];
  must(b2.remaining === 0 && b2.owed === 0, 'paid in full leaves a balance');
  const pays = await s.all('SELECT method, amount_cents FROM payments WHERE invoice_id = ?1 AND voided_at IS NULL', invA.id);
  must(pays.length === 2 && pays[0].method === 'zelle' && pays[1].method === 'cash', 'payment methods not recorded');
  await s.post(`/admin/invoices/${invA.id}/status`, { action: 'unpaid' });
  must((await L.balances(s.db))[invA.id].paid === 0 && (await s.all('SELECT id FROM payments WHERE invoice_id = ?1', invA.id)).length === 2, 'mark-as-not-paid deletes payments or leaves them counted');
  await s.post(`/admin/invoices/${invA.id}/status`, { action: 'paid', method: 'cash' });
}

// Day sheet, games out, collect at pickup, day total, email to the configured address.
{
  await s.post('/admin/settings', { day_list_email: 'valeriektaylor13@gmail.com', day_list_phone: '901-355-1518', business_name: 'Porch & Party', zelle: '', cashapp: '', business_address: '', id_folder_url: '' });
  const day = (await s.get('/admin/day/2026-10-24')).text;
  // Day sheet (owner, 18 Oct 2026): one block per job; "Load these items" only with 2+ pickups.
  const pickups = (day.match(/· Game pickup ·/g) || []).length;
  must(day.includes('data-day-sheet') && day.includes('data-strip') && pickups >= 1 && (pickups >= 2) === day.includes('Load these items'), 'day sheet, games grid, or the load list rule (only with 2+ pickups) wrong');
  must(!/Still to collect today/.test(day) && !/\$0\.00/.test(day), 'a "Still to collect today: $0.00" line shows after paid in full');
  must(/(\d+) games out/.test(day) || /data-day-count><strong>\d+ games? out/.test(day), 'games-out count missing on the day');
  must(day.includes(`sms:9013551518?&amp;body=`), 'Text it to me is not an sms: link to her number');
  const r = await s.post('/admin/day/2026-10-24/email', {});
  must(/Sent%20to%20valeriektaylor13%40gmail\.com/.test(r.location), `Email it to me did not confirm the configured address: ${r.location}`);
  must(s.env.sent.some((m) => m.to === 'valeriektaylor13@gmail.com' && /Day list/.test(m.subject)), 'day list email not sent to the configured address');
}

// Schedule from a request -> Scheduled; invoice send keeps her date; unschedule restores.
{
  const form = (await s.get(`/admin/calendar/new?r=${s.rk(reqB.key)}`)).text;
  must(form.includes('value="2026-10-30"') && form.includes('Weekend Renter') && form.includes('On these dates:'), 'scheduling screen is not pre-filled from the request');
  const res = await s.post('/admin/calendar/bookings', { r: s.rk(reqB.key), kind: 'rental_pickup', date: '2026-10-31', return_date: '2026-11-02', customer_name: 'Weekend Renter', phone: '901-555-0101', email: '', place: 'Mt. Moriah Station', items: '', item: ['Cornhole Set', 'Grab the Mic', 'Inflatable Movie Screen'], note: 'Bring the pump' });
  must(/\/admin\/day\/2026-10-31/.test(res.location), 'saving a booking does not open its day');
  let st = await s.one('SELECT status, prev_status FROM request_status WHERE request_key = ?1', reqB.key);
  must(st && st.status === 'scheduled', 'scheduling does not mark the request Scheduled');
  const dash = (await s.get('/admin/')).text;
  // Step cards (19 Oct 2026): the booked day is on the card's one date line, and booking it by
  // hand confirmed the request (solid on the calendar, off Unconfirmed requests); no status pill.
  const wr = dash.split(/<article /).find((c) => /data-card=/.test(c) && c.includes('Weekend Renter')) || '';
  must(/data-when>[^<]*Sat 31 Oct[^<]*Mon 2 Nov/.test(wr) && /data-confirmed="1"/.test(wr) && !/Scheduled for Sat 31 Oct/.test(dash), `the card does not carry the booked days on its date line, or is not confirmed after booking by hand (or a Scheduled pill is back): ${(wr.match(/data-when>[^<]*/) || [''])[0]}`);
  must(!(await s.get('/admin/calendar')).text.match(/data-unconfirmed-row[^>]*>\s*<strong>Weekend Renter/), 'a request booked by hand is still on Unconfirmed requests');
  const invB = await s.invoiceFor(reqB, { go: 'send' });
  const rows = await s.all('SELECT kind, date, edited_by_hand FROM bookings WHERE request_key = ?1 ORDER BY kind', reqB.key);
  must(rows.length === 2 && rows.find((r) => r.kind === 'rental_pickup').date === '2026-10-31', `invoice send changed her scheduled date or duplicated: ${JSON.stringify(rows)}`);
  // Notes survive move.
  const pick = await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", reqB.key);
  await s.post(`/admin/calendar/bookings/${pick.id}/move`, { date: '2026-11-01' });
  must((await s.one('SELECT date FROM bookings WHERE id = ?1', pick.id)).date === '2026-11-01', 'move did not change the date');
  const tok = (await s.get('/admin/calendar/link')).text.match(/\/api\/calendar\/([a-f0-9]{64})\.ics/);
  must(tok, 'Link my Google Calendar page has no feed URL');
  const { handleIcs } = await mod('functions/_lib/ics-route.mjs');
  const feed = await handleIcs({ request: new Request(`https://porchandparty901.com/api/calendar/${tok[1]}.ics`), env: s.env, params: { token: `${tok[1]}.ics` } });
  const feedText = await feed.text();
  must(feed.status === 200 && /text\/calendar/.test(feed.headers.get('Content-Type')) && feed.headers.get('X-Robots-Tag') === 'noindex, nofollow', 'ICS feed answer wrong');
  const parsed = C.parseIcs(feedText);
  must(parsed.errors.length === 0, `live ICS invalid: ${parsed.errors.join('; ')}`);
  const ev = parsed.events.find((e) => e.UID.value === `booking-${pick.id}@porchandparty901.com`);
  must(ev && ev.DTSTART.value === '20261101' && ev.DESCRIPTION.value.includes('Bring the pump'), 'moved booking or its note not in the ICS feed');
  const wrong = await handleIcs({ request: new Request('https://porchandparty901.com/api/calendar/x.ics'), env: s.env, params: { token: `${'0'.repeat(64)}.ics` } });
  must(wrong.status === 404, 'a wrong ICS token is not 404');
  // Notes: edit, delete; customer-facing outputs never carry them.
  const note = await s.one('SELECT id FROM booking_notes WHERE booking_id = ?1', pick.id);
  await s.post(`/admin/notes/${note.id}`, { body: 'Bring the pump SECRETNOTE', back: '/admin/day/2026-11-01' });
  must((await s.one('SELECT body FROM booking_notes WHERE id = ?1', note.id)).body === 'Bring the pump SECRETNOTE', 'editing a note did not persist');
  const sheet = (await s.get('/admin/day/2026-11-01')).text;
  must(sheet.includes('SECRETNOTE'), 'note missing on the day sheet');
  const loaded = { invoice: await s.one('SELECT * FROM invoices WHERE id = ?1', invB.id), lines: await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1', invB.id) };
  const mail = email.renderInvoiceEmail({ invoice: loaded.invoice, lines: loaded.lines, settings: {}, contact: {}, qrSrc: null });
  const sms = pdf.textMessage({ invoice: loaded.invoice, lines: loaded.lines, settings: {} });
  const pdfBytes = await pdf.renderInvoicePdf({ invoice: loaded.invoice, lines: loaded.lines, settings: {}, contact: {} });
  const rem = R.reminderEmail({ ...(await s.one('SELECT * FROM bookings WHERE id = ?1', pick.id)), kind: 'rental_pickup' });
  must(![mail.html, mail.text, sms, rem.html, rem.text, Buffer.from(pdfBytes).toString('latin1')].some((t) => t.includes('SECRETNOTE')) && !s.env.sent.some((m) => JSON.stringify(m).includes('SECRETNOTE') && m.to !== 'valeriektaylor13@gmail.com'), 'an internal note reached a customer-facing output');
  // Unschedule: delete every booking -> back to its previous status; notes stay with the request.
  for (const b of await s.all('SELECT id FROM bookings WHERE request_key = ?1', reqB.key)) await s.post(`/admin/calendar/bookings/${b.id}/delete`, {});
  st = await s.one('SELECT status FROM request_status WHERE request_key = ?1', reqB.key);
  must(st.status !== 'scheduled', `unscheduling left the request Scheduled (${st.status})`);
  must((await s.one('SELECT COUNT(*) AS n FROM booking_notes WHERE request_key = ?1', reqB.key)).n === 1, 'unscheduling lost the request notes');
  await s.post('/admin/calendar/bookings', { r: s.rk(reqB.key), kind: 'rental_pickup', date: '2026-10-30', return_date: '2026-11-02', customer_name: 'Weekend Renter', phone: '', email: '', place: '', items: 'Cornhole Set' });
  must((await s.get('/admin/day/2026-10-30')).text.includes('SECRETNOTE'), 'rescheduling did not bring the notes back');
  await s.post(`/admin/notes/${note.id}/delete`, { back: '/admin/day/2026-10-30' });
  must(!(await s.one('SELECT id FROM booking_notes WHERE id = ?1', note.id)), 'deleting a note did not persist');
}

// Unconfirmed requests (owner, 19 Oct 2026; was "Unscheduled requests"): never archived, void or
// test requests; everything not confirmed, booked or not; confirmed = "Yes, book it", a phone
// request, money in, or the job done (steps.mjs, the one rule).
{
  const ST = await mod('functions/_lib/steps.mjs');
  const statuses = { a: { status: 'void' }, b: { status: 'new', archived_at: 'x' }, c: { status: 'scheduled' }, d: { status: 'invoiced', invoice_id: 1 }, g: { status: 'deposit_paid', invoice_id: 2 }, h: { status: 'job_done', job_done_at: 'x' }, j: { status: 'invoiced', invoice_id: 3 } };
  const reqs = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].map((key) => ({ key, source: key === 'i' ? 'phone' : 'site', isTest: key === 'k' }));
  const unconf = ST.unconfirmedKeys({ requests: reqs, statuses, invoices: { 1: { paid: 0 }, 2: { paid: 0 }, 3: { balance: { paid: 2500 } } }, returns: {}, stored: { c: { confirmed_at: 'x' }, f: { called_at: 'x', confirmed_at: null } } });
  const list = C.unconfirmedRequests(reqs, statuses, unconf).map((r) => r.key).join(',');
  must(list === 'd,e,f', `unconfirmed list is ${list} (want d,e,f: not confirmed; c said yes, g and j paid, h done, i phone; a void, b put away, k test)`);
  must(!('unscheduledRequests' in C), 'the old Unscheduled list (scheduled = off the list) is still exported');
}

// Rental check-in: damage path, amber chip, undo restores, frees overlap.
{
  const k = s.rk(reqA.key);
  const page = (await s.get(`/admin/returns?k=${k}`)).text;
  must(page.includes('Giant Connect Four') && page.includes('Everything came back in good shape'), 'check-in screen lacks the items or the all-good shortcut');
  const before = (await s.one('SELECT status FROM request_status WHERE request_key = ?1', reqA.key)).status;
  await s.post(`/admin/returns?k=${k}`, { back: ['Cornhole Set', 'Giant Uno', 'Card Table with Cup Holders'], 'note_Giant Connect Four': 'cracked leg' });
  const row = await s.one('SELECT returned_at, damaged, items FROM rental_returns WHERE return_key = ?1', reqA.key);
  must(row && row.returned_at && row.damaged === 1 && JSON.parse(row.items).find((i) => i.name === 'Giant Connect Four').note === 'cracked leg', 'check-in did not persist the damaged item');
  const rs = await s.one('SELECT status, job_done_at FROM request_status WHERE request_key = ?1', reqA.key);
  must(rs.status === 'job_done' && rs.job_done_at, 'Mark returned does not set Job done');
  const dash = (await s.get('/admin/')).text;
  must(dash.includes('Returned — check damage') && dash.includes('data-deposit-reminder') && dash.includes('Decide whether to refund the deposit in full or keep part of it'), 'damaged return does not show the amber chip and the deposit reminder');
  await s.post(`/admin/returns/undo?k=${k}`, {});
  const rs2 = await s.one('SELECT status, job_done_at FROM request_status WHERE request_key = ?1', reqA.key);
  must(rs2.status === before && !rs2.job_done_at, `Undo returned did not restore ${before} (got ${rs2.status})`);
  must((await s.one('SELECT returned_at FROM rental_returns WHERE return_key = ?1', reqA.key)).returned_at === null, 'undo deleted the check-in row instead of clearing it');
}

// Void: refuses send and paid, keeps the number, removes its bookings, VOID stamp.
{
  const v = await s.invoiceFor(reqB, { go: 'save' });
  const number = (await s.one('SELECT number FROM invoices WHERE id = ?1', v.id)).number;
  await s.post('/admin/calendar/bookings', { kind: 'other', date: '2026-10-20', customer_name: 'Hand Made', phone: '', email: '', place: '', items: '' });
  const page = (await s.get(`/admin/invoices/${v.id}`)).text;
  must(page.includes(`Void invoice ${number} for Weekend Renter? The customer is not told. Use this when the job is cancelled or the invoice was a mistake.`), 'void confirmation wording missing');
  const auto = (await s.all('SELECT id FROM bookings WHERE invoice_id = ?1 AND edited_by_hand = 0', v.id)).length;
  await s.post(`/admin/invoices/${v.id}/status`, { action: 'void' });
  must((await s.all('SELECT id FROM bookings WHERE invoice_id = ?1', v.id)).length === 0, `voiding left ${auto} auto bookings linked`);
  const sentBefore = s.env.sent.length;
  const send = await s.post(`/admin/invoices/${v.id}/send`, {});
  must(s.env.sent.length === sentBefore && /e=/.test(send.location), 'a void invoice was sent');
  await s.post(`/admin/invoices/${v.id}/status`, { action: 'paid' });
  must((await s.one('SELECT status FROM invoices WHERE id = ?1', v.id)).status === 'void' && !(await s.one('SELECT id FROM payments WHERE invoice_id = ?1', v.id)), 'a void invoice was marked paid');
  const vp = (await s.get(`/admin/invoices/${v.id}`)).text;
  must(vp.includes('data-void-stamp') && vp.includes('>Void</span>'), 'void invoice page lacks the VOID stamp or the Void chip');
  const bytes = await pdf.renderInvoicePdf({ invoice: { ...(await s.one('SELECT * FROM invoices WHERE id = ?1', v.id)) }, lines: v.lines, settings: {}, contact: {} });
  const { PDFDocument } = await import('pdf-lib');
  must((await PDFDocument.load(bytes)).getSubject() === 'VOID', 'void invoice PDF has no VOID stamp');
  const next = await s.invoiceFor(reqB, { go: 'save' });
  const n2 = (await s.one('SELECT number FROM invoices WHERE id = ?1', next.id)).number;
  must(n2 > number && (await s.one('SELECT number FROM invoices WHERE id = ?1', v.id)).number === number, 'a void invoice number was reused or lost');
  must((await s.one('SELECT status FROM request_status WHERE request_key = ?1', reqB.key)).status !== 'void', 'a new invoice did not take the request out of Void');
}

// Reminders: tomorrow box, no double email, void/archived skipped.
{
  const tmr = R.tomorrowChicago();
  // The fixture request has fixed dates (event 24 Oct 2026, takedown/return 25 Oct), so on some
  // days its bookings are "tomorrow" too (red on 24 Oct 2026 with no commit behind it). Count
  // them in, by id, instead of assuming tomorrow holds only the two bookings made here.
  const pre = (await R.tomorrowsBookings(s.db)).filter((b) => R.hasEmail(b.reminder_email) && !b.email_reminded_at);
  await s.post('/admin/calendar/bookings', { kind: 'grazing_setup', date: tmr, time: '14:00', customer_name: 'Gia Graze', phone: '901-555-0123', email: 'gia@example.com', place: '12 Oak St', items: 'Grazing table' });
  await s.post('/admin/calendar/bookings', { kind: 'porch_install', date: tmr, customer_name: 'No Phone', phone: '', email: 'np@example.com', place: '', items: '' });
  const dash = (await s.get('/admin/')).text;
  must(dash.includes("Tomorrow's reminders") && dash.includes('Gia Graze') && dash.includes('sms:9015550123?&amp;body=Hi%20Gia') && dash.includes('No phone on file'), 'tomorrow reminders box wrong');
  const sent = [];
  const r1 = await R.sendEmailReminders(s.db, async (m) => { sent.push(m); return true; });
  const r2 = await R.sendEmailReminders(s.db, async (m) => { sent.push(m); return true; });
  const want = pre.length + 2;
  const tos = sent.map((m) => m.to);
  must(['gia@example.com', 'np@example.com', ...pre.map((b) => b.reminder_email)].every((e) => tos.includes(e)), `a due reminder was not emailed: ${JSON.stringify(tos)}`);
  must(r1.sent === want && r2.sent === 0 && sent.length === want && sent.every((m) => !('bcc' in m) && !('cc' in m) && m.to !== 'hello@porchandparty901.com'), `email reminders double-sent or missed: ${JSON.stringify([r1, r2])}`);
  const before = (await R.tomorrowsBookings(s.db)).length;
  const gia = await s.one("SELECT id FROM bookings WHERE customer_name = 'Gia Graze'");
  await s.db.prepare("UPDATE bookings SET request_key = 'zz' WHERE id = ?1").bind(gia.id).run();
  await s.db.prepare("INSERT INTO request_status (request_key, status, archived_at) VALUES ('zz', 'new', datetime('now'))").run();
  must((await R.tomorrowsBookings(s.db)).length === before - 1, 'an archived request still gets a reminder');
  await s.db.prepare("UPDATE request_status SET archived_at = NULL, status = 'void' WHERE request_key = 'zz'").run();
  must((await R.tomorrowsBookings(s.db)).length === before - 1, 'a void request still gets a reminder');
  const mailer = fs.readFileSync(path.join(ROOT, 'workers/pnp-mailer/wrangler.toml'), 'utf8');
  // Hourly on the hour: covers 15:00 UTC (10 AM CDT) and 16:00 UTC (10 AM CST); the handler gates the daily work.
  must(/crons = \["0 \* \* \* \*"\]/.test(mailer) && /binding = "DB"/.test(mailer), 'pnp-mailer lacks its hourly cron or its D1 binding');
  const worker = fs.readFileSync(path.join(ROOT, 'workers/pnp-mailer/src/index.js'), 'utf8');
  must(/async scheduled\(/.test(worker) && /chicagoHour\(now\) !== 10/.test(worker) && /expireHolds\(/.test(worker) && /sendThankYous\(/.test(worker), 'pnp-mailer has no scheduled handler gated on 10 AM Memphis, or it does not expire holds / send thank-yous');
}

// Find a customer.
{
  await s.post('/admin/calendar/bookings', { kind: 'party_setup', date: '2026-09-01', customer_name: 'José Núñez', phone: '(901) 555-7788', email: 'jose@example.com', place: '', items: 'Balloons' });
  const r1 = (await s.get('/admin/search?partial=1&q=NUNEZ')).text;
  const r2 = (await s.get('/admin/search?partial=1&q=jos')).text;
  const r3 = (await s.get('/admin/search?partial=1&q=5557788')).text;
  must(r1.includes('José Núñez') && r2.includes('José Núñez') && r3.includes('José Núñez'), 'search misses accent/case/partial/phone matches');
  const r4 = (await s.get('/admin/search?partial=1&q=Jnae')).text;
  must(r4.includes("No customer found for 'Jnae'.") && r4.includes('Check the spelling or try part of the name.'), 'search empty-state text wrong');
  await s.post('/admin/requests/archive', { r: s.rk(reqA.key) });
  const r5 = (await s.get('/admin/search?partial=1&q=test%20renter')).text;
  must(r5.includes('Put away'), 'search does not label an archived customer');
  const latest = await s.one('SELECT MAX(id) AS id FROM invoices WHERE request_key = ?1', reqB.key);
  await s.post(`/admin/invoices/${latest.id}/status`, { action: 'void' });
  const r6 = (await s.get('/admin/search?partial=1&q=weekend')).text;
  must(r6.includes('chip void'), 'search does not label a void booking');
  const h = (await s.get('/admin/search?q=x')).headers;
  must(/no-store/.test(h.get('Cache-Control') || ''), 'search results can be cached');
}

if (checks === 0) errors.push('Rule 0: no checks ran');
if (errors.length) {
  console.error(`VALIDATION FAIL: admin calendar (${errors.length} of ${checks} checks)`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`validate_admin_calendar: OK (${checks} checks: migration, archive, bookings, payments, void, schedule, move, ICS, notes, reminders, returns, games out, search)`);
