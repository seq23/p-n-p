#!/usr/bin/env node
/**
 * Owner additions of 19 Oct 2026 (after the step cards). Fails when:
 *  1. the rental invoice note is not one of the six owner wordings for its numbers (rest / covers
 *     everything / paid in full on the online page only; pickup or business delivery), the rest
 *     counts the refundable deposit, a hand-typed note is overwritten, or the phone / place are
 *     typed anywhere but games.json;
 *  2. business delivery: the line is not on the website pages (rentals, FAQ, rules, llms) at the
 *     services.json price; the /request form (file or served) carries ANY business delivery tick,
 *     field or line (owner, 19 Oct 2026: removed from the form, "people lying or getting ideas");
 *     the server honours a forged business_delivery / business_name / delivery_address POST (an
 *     answer, a Delivery fee line or a booking anywhere but the safe zone); or Valerie setting it
 *     on Change anything → Customer details does not give "Business delivery" with the address on
 *     the card, Delivery / Collect at that address on the calendar and Day sheet, the delivery
 *     invoice wording, and the "+ Delivery fee" quick-add at the services.json price;
 *  3. hold numbers (48 hours, Hold longer 3 days) are typed outside services.json rentalHolds;
 *  4. "Waiting N days" does not count Memphis calendar days (across midnight), or the un-called
 *     list includes a called, phone or put-away request;
 *  5. the invoice editor is not rows with ✏️ Change + ONE "＋ Add something" list + ONE big "Send invoice", or its
 *     script does not parse.
 * Rule 0: fewer than 60 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SERVICES = JSON.parse(read('data/offers/services.json'));
const GAMES = JSON.parse(read('data/rentals/games.json'));
const NOTE = await mod('functions/_lib/invoice-note.mjs');
const { buildPriceTable } = await mod('functions/_lib/pricing.mjs');
const ST = await mod('functions/_lib/steps.mjs');
const CB = await mod('functions/_lib/callback-list.mjs');
const BD = require(path.join(ROOT, 'scripts/lib/business_delivery.js'));
const table = buildPriceTable(GAMES, SERVICES, JSON.parse(read('data/offers/porch_packages.json')));

// ---- 1. The invoice note ----------------------------------------------------------------
const L = [
  { description: 'Giant Uno (1 day)', qty: 1, unit_cents: 4000, note: '', refundable: 0 },
  { description: 'Cornhole Set (1 day)', qty: 2, unit_cents: 4000, note: '', refundable: 0 },
  { description: 'Damage deposit (refundable)', qty: 1, unit_cents: 5000, note: '', refundable: 1 },
];
const LD = [...L.slice(0, 2), { description: 'Delivery fee', qty: 1, unit_cents: 2000, note: '', refundable: 0 }, L[2]];
const PICK = 'Text or call 901-355-1518 to set your pickup time at Mt. Moriah Station unless otherwise agreed upon.';
const DELI = 'Text or call 901-355-1518 to set your delivery time unless otherwise agreed upon.';
const inv = (o = {}) => ({ id: 1, status: 'sent', pay_plan: 'half', deposit_due_cents: 8500, notes: '', ...o });
for (const [label, opts, want] of [
  ['half now, nothing paid', { invoice: inv(), lines: L }, `Pay the rest ($85.00) at pickup. ${PICK}`],
  ['custom deposit = the damage deposit only', { invoice: inv({ pay_plan: 'custom', deposit_due_cents: 5000 }), lines: L }, `Pay the rest ($120.00) at pickup. ${PICK}`],
  ['all now', { invoice: inv({ pay_plan: 'full', deposit_due_cents: 17000 }), lines: L }, `This covers everything. Nothing more to pay at pickup. ${PICK}`],
  ['paid in full, online page', { invoice: inv(), lines: L, paidCents: 17000, view: true }, `Paid in full. Thank you! ${PICK}`],
  ['paid in full, email / PDF / text', { invoice: inv(), lines: L, paidCents: 17000 }, `This covers everything. Nothing more to pay at pickup. ${PICK}`],
  ['deposit paid, more than due now', { invoice: inv(), lines: L, paidCents: 10000 }, `Pay the rest ($70.00) at pickup. ${PICK}`],
  ['delivery line, half now', { invoice: inv({ deposit_due_cents: 9500 }), lines: LD }, `Pay the rest ($95.00) at delivery. ${DELI}`],
  ['delivery, all now', { invoice: inv({ pay_plan: 'full', deposit_due_cents: 19000 }), lines: LD }, `This covers everything. Nothing more to pay at delivery. ${DELI}`],
  ['delivery, paid, online page', { invoice: inv(), lines: LD, paidCents: 19000, view: true }, `Paid in full. Thank you! ${DELI}`],
  ['request ticked business delivery (no fee line yet)', { invoice: inv(), lines: L, delivery: true }, `Pay the rest ($85.00) at delivery. ${DELI}`],
  ['the website\'s old draft note is not hers', { invoice: inv({ notes: NOTE.LEGACY_DRAFT_NOTE }), lines: L }, `Pay the rest ($85.00) at pickup. ${PICK}`],
  // The owner's 19 Oct rule (the deposit is never "owed") is kept in words, never by dropping it
  // from the sum (20 Oct 2026): the rest is step ② of the pay box, $170 - $30.
  ['a deposit the amount due now does not cover is said in words, inside the sum', { invoice: inv({ pay_plan: 'custom', deposit_due_cents: 3000 }), lines: L }, `Pay the rest ($120.00 + $20.00 refundable deposit = $140.00) at pickup. ${PICK}`],
  ['that deposit paid, online page: still the same rest, never "Paid in full"', { invoice: inv({ pay_plan: 'custom', deposit_due_cents: 3000 }), lines: L, paidCents: 3000, view: true }, `Pay the rest ($120.00 + $20.00 refundable deposit = $140.00) at pickup. ${PICK}`],
  ['charges paid, damage deposit not: online page is never "Paid in full"', { invoice: inv({ pay_plan: 'custom', deposit_due_cents: 12000 }), lines: L, paidCents: 12000, view: true }, `Pay the rest ($50.00) at pickup. ${PICK}`],
  ['no deposit, nothing paid', { invoice: inv({ pay_plan: 'none', deposit_due_cents: 0 }), lines: L }, `Pay the rest ($120.00 + $50.00 refundable deposit = $170.00) at pickup. ${PICK}`],
]) {
  const got = NOTE.pickupNote(opts.lines, table, opts);
  must(got === want, `note / ${label}: "${got}"\n    want "${want}"`);
}
must(NOTE.pickupNote(L, table, { invoice: inv({ notes: 'Pick up Friday after 5, thanks!' }) }) === '', 'a note Valerie typed is overwritten by the automatic one');
must(NOTE.pickupNote([{ description: 'Party decor setup', qty: 1, unit_cents: 30000 }], table, { invoice: inv() }) === '', 'a decor-only invoice gets the rental note');
{
  const t2 = { ...table, pickupPhone: '901-555-0000', pickupPlace: 'Somewhere Else' };
  const got = NOTE.pickupNote(L, t2, { invoice: inv() });
  must(got.includes('901-555-0000') && got.includes('Somewhere Else') && !got.includes('355-1518'), 'the note does not follow the phone / place in games.json');
  for (const f of ['functions/_lib/invoice-note.mjs', 'functions/_lib/pricing.mjs', 'functions/_lib/admin.mjs', 'functions/_lib/email.mjs', 'functions/_lib/pdf.mjs']) must(!/355-1518|Mt\. Moriah Station unless/.test(read(f)), `${f} types the note's phone or place`);
  must(table.pickupPhone === GAMES.pickup.phone, 'the note phone is not games.json pickup.phone');
}

// ---- 3. Hold numbers: one source ------------------------------------------------------------
{
  const H = await mod('functions/_lib/hold-rules.mjs');
  must(H.HOLD_DEFAULT_HOURS === SERVICES.rentalHolds.defaultHours && H.HOLD_EXTEND_DAYS === SERVICES.rentalHolds.extendDays && SERVICES.rentalHolds.defaultHours === 48 && SERVICES.rentalHolds.extendDays === 3, 'hold-rules.mjs does not read 48 h / 3 days from services.json');
  for (const f of ['functions/_lib/holds.mjs', 'functions/_lib/admin.mjs', 'functions/_lib/views-messages.mjs', 'functions/_lib/views.mjs', 'functions/_lib/request-form.mjs']) {
    const src = read(f);
    must(!/hold_hours', 24|num\(settings\.hold_hours, \d|hours: '?(24|48)'?[,}]|value="(24|48)"|\+24 hours|\+48 hours|held for 24|for 24 hours/.test(src), `${f} types a hold length`);
  }
  for (const f of ['scripts/generators/build_rentals_page.js', 'scripts/generators/build_request_pages.js']) must(!/held for 24 hours|held for 48 hours/.test(read(f)) && /rentalHolds\.defaultHours/.test(read(f)), `${f} types the hold length instead of reading services.json`);
  for (const f of ['rentals/index.html', 'rules.html', 'request.html']) must(read(f).includes(`${SERVICES.rentalHolds.defaultHours} hours`) && !/24 hours/.test(read(f)), `${f} does not say the ${SERVICES.rentalHolds.defaultHours}-hour hold`);
}

// ---- 4. Waiting days (Memphis calendar days) --------------------------------------------------
{
  const ms = (iso) => Date.parse(iso);
  must(ST.waitingDays(ms('2026-10-20T04:50:00Z'), '2026-10-19') === 0, '11:50 PM Memphis on the 19th is not "today" on the 19th');
  must(ST.waitingDays(ms('2026-10-20T04:50:00Z'), '2026-10-20') === 1, '11:50 PM Memphis, read the next Memphis day, is not 1 day');
  must(ST.waitingDays(ms('2026-10-20T05:10:00Z'), '2026-10-20') === 0, '12:10 AM Memphis is not "today"');
  must(ST.waitingDays(ms('2026-10-16T15:00:00Z'), '2026-10-19') === 3, 'three Memphis days is not 3');
  must(ST.waitingDays(ms('2026-11-01T06:30:00Z'), '2026-11-02') === 1, 'across the end of daylight saving is not 1 day');
  // The callers pass the real sent instant (steps.mjs sentMs from submitted_at, UTC), never the
  // wall-clock sortTime: a request in at 12:20 AM Memphis (05:20 UTC) is "Sent today" that day.
  must(ST.sentMs({ submittedAt: '2026-10-20 05:20:00' }) === ms('2026-10-20T05:20:00Z') && ST.waitingDays(ST.sentMs({ submittedAt: '2026-10-20 05:20:00' }), '2026-10-20') === 0, 'a request sent at 12:20 AM Memphis is not "Sent today" that day');
  for (const f of ['functions/_lib/callback-list.mjs', 'functions/_lib/views.mjs']) must(/waitingDays\(sentMs\(r\), today\)/.test(read(f)) && !/waitingDays\(r\.sortTime/.test(read(f)), `${f} reads the waiting days from the wall-clock sortTime`);
  must(ST.waitingWords(0) === 'Sent today' && ST.waitingWords(1) === 'Waiting since yesterday' && ST.waitingWords(4) === 'Waiting 4 days' && CB.WAIT_HIGHLIGHT_DAYS === 3, 'the waiting words / highlight are not "Sent today" / "since yesterday" / "N days", 3+');
}

// ---- 2 + 4 + 5 through the real router ----------------------------------------------------
const s = await session();
const F = await mod('functions/_lib/request-form.mjs');
const today = F.chicagoToday();
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const cardOf = (html, key) => { const i = html.indexOf(`id="c-${s.rk(key)}"`); return i < 0 ? '' : html.slice(html.lastIndexOf('<article', i), html.indexOf('</article>', i)); };
const FEE = Math.round(BD.deliveryFee(SERVICES) * 100);
must(FEE === Math.round(SERVICES.invoiceQuickAdds.deliveryFee * 100) && BD.businessDeliveryLine(SERVICES) === `Renting for a business? We can deliver to your business for $${SERVICES.invoiceQuickAdds.deliveryFee}.`, 'the business delivery line / fee do not come from services.json invoiceQuickAdds.deliveryFee');
{
  const perturbed = BD.businessDeliveryLine({ invoiceQuickAdds: { deliveryFee: 37 } });
  must(perturbed.includes('$37'), 'the business delivery line does not follow the data');
}
// The website pages carry the line; the /request form carries nothing about business delivery.
const BDL = BD.businessDeliveryLine(SERVICES);
for (const [f, min] of [['rentals/index.html', 3], ['faq/index.html', 2], ['rules.html', 1], ['llms.txt', 1]]) {
  const t = read(f).replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  must(t.split(BDL).length - 1 >= min, `${f} lacks the business delivery line`);
}
// Every "business" on the form page is the LocalBusiness schema / its #business @id, nothing else.
const formWords = (html) => html.replace(/"LocalBusiness"/g, '').replace(/\/#business\b/g, '').replace(/BUSINESS_ID/g, '');
const formFile = read('request.html');
// The form the server renders (a GET, and a re-shown form after an error, even one posted with
// business_delivery=yes: no tick, no field, nothing sticky).
const formServed = F.renderForm({ offers: SERVICES, table, today });
const formReshown = F.renderForm({ offers: SERVICES, table, today, values: { service: ['rentals'], business_delivery: 'yes', business_name: 'Acme Offices', delivery_address: '100 Main St' }, errors: { phone: 'x' } });
for (const [where, html] of [['request.html', formFile], ['the served form', formServed], ['the re-shown form', formReshown]]) {
  must(html.length > 5000 && /name="games"/.test(html), `${where} is not the request form (${html.length} bytes)`);
  // The holiday office "Who is this for? Home · Business or lobby" choice (30 Oct 2026) is the one
  // allowed use of the word: exactly one such radio, and nothing else may say business.
  const lobby = html.match(/<input type="radio" name="audience" value="corporate"[^>]*> <span>Business or lobby<\/span>/g) || [];
  must(lobby.length === 1, `${where} does not carry exactly one "Business or lobby" choice (${lobby.length})`);
  must(!/business_delivery|business_name|delivery_address/i.test(html), `${where} still carries a business delivery field`);
  const rest = formWords(html).replace(/<input type="radio" name="audience" value="corporate"[^>]*> <span>Business or lobby<\/span>/g, '');
  must(!/business/i.test(rest), `${where} still mentions business delivery: ${(rest.match(/.{0,60}business.{0,60}/i) || [''])[0]}`);
  must(!/name="(business_delivery|business_name|delivery_address)"/.test(html) && !/data-business/.test(html) && !html.includes('Acme Offices') && !html.includes('100 Main St'), `${where} still has a business delivery field`);
  must(!html.includes(BDL) && !/This is for a business/i.test(html) && !/deliver to (us|your business)/i.test(html), `${where} still carries the business delivery line or tick label`);
}
// A forged POST with every business field: accepted as a plain pickup rental, the fields ignored.
const base = { service: 'rentals', games: ['giant-uno'], duration: 'day', rental_date: plus(14), pickup_when: 'morning', return_when: 'after', phone: '901-555-0401' };
{
  const r = await s.siteRequest({ ...base, rental_date: plus(30), name: 'Nia Nodetails', email: 'nia.nodetails@example.com', phone: '901-555-0405', business_delivery: 'yes' });
  must(r.status === 303 && !/Type the business name|Type the delivery address/.test(r.text), `a stray business_delivery tick changed the form's answer (${r.status})`);
}
const biz = await s.siteRequest({ ...base, name: 'Bo Business', email: 'bo.business@example.com', business_delivery: 'yes', business_name: 'Acme Offices', delivery_address: '100 Main St, Memphis' });
must(biz.status === 303, `the request with forged business fields was refused: ${biz.text.slice(0, 200)}`);
const home = await s.siteRequest({ ...base, rental_date: plus(20), name: 'Hal Homeparty', email: 'hal.home@example.com', phone: '901-555-0402' });
must(Boolean(biz.row && home.row), 'the website requests were not stored');
if (biz.row && home.row) {
  const stored = JSON.parse((await s.one('SELECT answers FROM requests WHERE request_key = ?1', biz.row.request_key)).answers || '[]');
  must(stored.length > 0 && !stored.some((x) => /business|delivery/i.test(`${x.label} ${x.value}`)) && !JSON.stringify(stored).includes('Acme Offices') && !JSON.stringify(stored).includes('100 Main St'), `the server stored forged business delivery answers (${JSON.stringify(stored)})`);
  const bi = await s.one('SELECT invoice_id FROM request_status WHERE request_key = ?1', biz.row.request_key);
  let lines = await s.all('SELECT description, unit_cents, refundable FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position', bi.invoice_id);
  must(lines.length > 0 && !lines.some((l) => /deliver/i.test(l.description)), `a forged business POST got a delivery line (${JSON.stringify(lines.map((l) => l.description))})`);
  let bks = await s.all("SELECT kind, place, date FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return') ORDER BY kind", biz.row.request_key);
  must(bks.length === 2 && bks.every((b) => b.place === table.pickupPlace), `a forged business POST booked away from the safe exchange zone (${JSON.stringify(bks)})`);
  const hb = await s.one("SELECT place FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", home.row.request_key);
  must(hb && hb.place === table.pickupPlace, 'the home rental is not at the safe exchange zone');
  let dash = (await s.get('/admin/')).text;
  must(!/data-business-delivery/.test(cardOf(dash, biz.row.request_key)), 'a forged business POST shows Business delivery on its card');
  // Valerie sets business delivery herself: Change anything → Customer details.
  const brk = s.rk(biz.row.request_key);
  const editPage = (await s.get(`/admin/requests/edit?r=${brk}`)).text;
  must(/data-edit-delivery/.test(editPage) && /name="delivery_name"/.test(editPage) && /name="delivery_address"/.test(editPage), 'Customer details has no Business delivery name / address for Valerie');
  const homeEdit = (await s.get(`/admin/requests/edit?r=${s.rk(home.row.request_key)}`)).text;
  must(/name="delivery_address" value=""/.test(homeEdit), 'a pickup rental does not show an empty delivery address');
  await s.post('/admin/requests/edit/customer', { r: brk, name: 'Bo Business', phone: '901-555-0401', email: 'bo.business@example.com', delivery_name: 'Acme Offices', delivery_address: '100 Main St, Memphis' });
  bks = await s.all("SELECT kind, place, date FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return') ORDER BY kind", biz.row.request_key);
  must(bks.length === 2 && bks.every((b) => b.place === '100 Main St, Memphis'), `the business bookings did not move to the delivery address (${JSON.stringify(bks)})`);
  const hist = await s.all('SELECT what FROM request_events WHERE request_key = ?1', biz.row.request_key).catch(() => []);
  void hist;
  dash = (await s.get('/admin/')).text;
  const c = cardOf(dash, biz.row.request_key);
  must(/data-business-delivery><span class="biztag">🚚 Business delivery<\/span> Acme Offices, 100 Main St, Memphis</.test(c.slice(0, c.indexOf('data-details'))), 'the card does not show the "🚚 Business delivery" tag with the business and address above More');
  must(!/data-business-delivery/.test(cardOf(dash, home.row.request_key)), 'a home rental card says Business delivery');
  const pick = bks.find((b) => b.kind === 'rental_pickup');
  const ret = bks.find((b) => b.kind === 'rental_return');
  const cal = (await s.get(`/admin/calendar?month=${pick.date.slice(0, 7)}`)).text;
  must(new RegExp(`Delivery: Bo Business`).test(cal) && !/Rental pickup: Bo Business/.test(cal), 'the calendar does not say "Delivery" for the business rental');
  const calR = (await s.get(`/admin/calendar?month=${ret.date.slice(0, 7)}`)).text;
  must(/Collect: Bo Business/.test(calR) && !/Rental return: Bo Business/.test(calR), 'the calendar does not say "Collect" for the business return');
  const day = (await s.get(`/admin/day/${pick.date}`)).text;
  must(/Delivery · Bo/.test(day) && /100 Main St, Memphis/.test(day) && !/Game pickup · Bo/.test(day), 'the Day sheet does not say "Delivery" at the business address');
  // The draft's online invoice page words the note for delivery.
  const page = (await s.get(`/admin/invoices/${bi.invoice_id}`)).text;
  must(/Pay the rest \(\$[\d.]+\) at delivery\. Text or call 901-355-1518 to set your delivery time unless otherwise agreed upon\./.test(page), `the business invoice page note is not the delivery wording (${(page.match(/(Pay the rest|This covers|Paid in full)[^<]{0,160}/) || ['none'])[0]})`);
  // Valerie adds the delivery fee herself (the quick-add's price, services.json).
  const full = await s.all('SELECT description, qty, unit_cents, note, refundable FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position', bi.invoice_id);
  const withFee = [...full.filter((l) => !l.refundable), { description: 'Delivery fee', qty: 1, unit_cents: FEE, note: '', refundable: 0 }, ...full.filter((l) => l.refundable)];
  await s.post('/admin/requests/edit/invoice', { r: brk, invoice_id: String(bi.invoice_id), line_desc: withFee.map((l) => l.description), line_qty: withFee.map((l) => String(l.qty)), line_price: withFee.map((l) => (l.unit_cents / 100).toFixed(2)), line_note: withFee.map((l) => l.note || ''), line_refundable: withFee.map((l) => String(l.refundable)) });
  lines = await s.all('SELECT description, unit_cents, refundable FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position', bi.invoice_id);
  const fee = lines.find((l) => l.description === 'Delivery fee');
  must(fee && fee.unit_cents === FEE && fee.refundable === 0, `Valerie's Delivery fee line did not save at ${FEE / 100} (${JSON.stringify(lines.map((l) => l.description))})`);
  // Taking the delivery address away puts the bookings back at the safe exchange zone.
  {
    const r2 = await s.siteRequest({ ...base, rental_date: plus(40), name: 'Una Undo', email: 'una.undo@example.com', phone: '901-555-0406' });
    const rk2 = s.rk(r2.row.request_key);
    await s.post('/admin/requests/edit/customer', { r: rk2, delivery_name: 'Undo Co', delivery_address: '5 Side St, Memphis' });
    await s.post('/admin/requests/edit/customer', { r: rk2, delivery_name: '', delivery_address: '' });
    const back2 = await s.all("SELECT place FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return')", r2.row.request_key);
    must(back2.length === 2 && back2.every((b) => b.place === table.pickupPlace), `clearing the delivery address left the bookings away from the safe zone (${JSON.stringify(back2)})`);
    must(!/data-business-delivery/.test(cardOf((await s.get('/admin/')).text, r2.row.request_key)), 'a cleared business delivery still shows on the card');
  }
  // 4. Un-called list: both website requests are waiting; a called one, a phone one and a put-away one are not.
  let rows = await CB.callbackRows(s.db, today);
  const names = () => rows.map((r) => r.name);
  must(names().includes('Bo B.') && names().includes('Hal H.'), `the un-called list misses a new request (${names()})`);
  must(rows.every((r) => typeof r.days === 'number' && /^(Sent today|Waiting since yesterday|Waiting \d+ days)$/.test(r.words)), 'a list row lacks its waiting words');
  must(rows.every((r, i) => !i || rows[i - 1].sortTime <= r.sortTime), 'the un-called list is not oldest first');
  await s.post('/admin/requests/talked', { r: s.rk(home.row.request_key), go: 'later' });
  rows = await CB.callbackRows(s.db, today);
  must(!names().includes('Hal H.') && names().includes('Bo B.'), 'a request ticked Called back stays on the un-called list');
  await s.post('/admin/requests/archive', { r: s.rk(biz.row.request_key) });
  rows = await CB.callbackRows(s.db, today);
  must(!names().includes('Bo B.'), 'a put-away request stays on the un-called list');
  must(!(await s.all("SELECT name FROM requests WHERE source = 'phone'")).some((p) => names().includes(p.name)), 'a phone request is on the un-called list');
  await s.post('/admin/calendar/bookings', { service: 'party', kind: 'party_setup', date: plus(9), customer_name: 'Pat Phonecall', phone: '901-555-0403', email: '', place: '', items: 'Decor' });
  rows = await CB.callbackRows(s.db, today);
  must(!names().includes('Pat P.'), 'a phone-call request is on the un-called list');
  // The card's step 1 says how long they have waited.
  const fresh = await s.siteRequest({ ...base, rental_date: plus(25), name: 'Wes Waiting', email: 'wes.waiting@example.com', phone: '901-555-0404' });
  const wc = cardOf((await s.get('/admin/')).text, fresh.row.request_key);
  must(/data-next-step="called"[\s\S]*<p class="waitline" data-waiting="0">Sent today<\/p>/.test(wc), 'step 1 does not say "Sent today" on a request sent today');
  await s.db.prepare("UPDATE requests SET submitted_at = datetime('now', '-4 days') WHERE request_key = ?1").bind(fresh.row.request_key).run();
  const wc2 = cardOf((await s.get('/admin/')).text, fresh.row.request_key);
  must(/<p class="waitline late" data-waiting="4">Waiting 4 days<\/p>/.test(wc2), 'step 1 does not say "Waiting 4 days" (highlighted) after 4 days');
  // 5. The editor.
  const ed = (await s.get(`/admin/invoices/${bi.invoice_id}/edit`)).text;
  // Owner-approved mock-up (20 Oct 2026): each line at rest = name, note, "how many × price", total
  // and a visible ✏️ Change; ONE "＋ Add something to this invoice" opens the labelled list (no
  // bubbles); two primaries only (Add something, Send invoice); "Total so far" under the lines and
  // the numbered "How <name> pays" summary at the bottom.
  const rowsN = (ed.match(/<div class="lrow" data-line/g) || []).length;
  must(rowsN === lines.length + 1 && /<span class="ld" data-l-desc>Delivery fee<\/span>\s*<span class="lnote" data-l-note hidden><\/span><span class="lq" data-l-qty>1 × \$20\.00<\/span>\s*<\/div>\s*<div class="lr"><span class="lt" data-l-total>\$20\.00<\/span>\s*<button type="button" class="chg" data-change data-help="ed\.lineChange"[^>]*>✏️ Change<\/button>/.test(ed), `the editor lines are not rows with "1 × $20.00", the total and ✏️ Change (${rowsN} rows)`);
  must(/<div class="addwrap" data-quick-adds><div class="act"><button type="button" class="btn primary addbig" id="add-open"[^>]*>＋ Add something to this invoice<\/button>/.test(ed) && /<div class="addmenu" id="add-menu" data-add-menu hidden><p class="addq">What do you want to add\?<\/p>\s*<button type="button" class="addopt" id="add-line"/.test(ed) && (ed.match(/class="addopt"/g) || []).length >= 6 && !/chipbtn|qchips/.test(ed), 'the quick-adds are not ONE "＋ Add something to this invoice" with its labelled list (Something else first)');
  const prim = [...ed.matchAll(/class="btn primary[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1]);
  must(prim.join('|') === '＋ Add something to this invoice|Send invoice' && /<button class="btn primary" type="submit" name="go" value="send"[^>]*>Send invoice<\/button>/.test(ed) && /value="save"[^>]*>Save draft</.test(ed) && /value="preview"[^>]*>See it before sending</.test(ed), `the editor's big buttons are ${prim.join('|')}, not Add something + ONE Send invoice (Save draft and See it before sending small)`);
  must(ed.indexOf('data-ed-summary') > ed.indexOf('data-ed-plan') && /id="sum-total"/.test(ed) && /id="pay-steps-live"/.test(ed) && ed.indexOf('id="sum-sofar"') > ed.indexOf('data-lines') && ed.indexOf('id="sum-sofar"') < ed.indexOf('id="add-open"'), 'the "Total so far" / How they pay summary is not where the mock-up has it');
  must(/name="line_refundable"/.test(ed) && /name="line_note"/.test(ed) && /data-remove/.test(ed) && /name="notes"/.test(ed) && /name="customer_email"/.test(ed), 'the editor lost an ability (refundable / note / remove / message / customer)');
  for (const js of [...ed.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])) { let ok = true; try { new Function(js); } catch { ok = false; } must(ok, 'the editor script does not parse'); }
}

if (checks < 60) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) {
  console.error(`rental extras: FAIL (${errors.length} of ${checks})`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`rental extras: OK (${checks} checks: six note wordings from the numbers + hand note wins + phone from games.json, business delivery line on the website, none on the form, forged POST ignored, set by Valerie → card/calendar/Day sheet/invoice/fee, 48 h / 3 day holds from services.json, waiting days in Memphis + the un-called list, compact invoice editor)`);
