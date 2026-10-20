#!/usr/bin/env node
/**
 * Owner additions of 19 Oct 2026 (after the step cards). Fails when:
 *  1. the rental invoice note is not one of the six owner wordings for its numbers (rest / covers
 *     everything / paid in full on the online page only; pickup or business delivery), the rest
 *     counts the refundable deposit, a hand-typed note is overwritten, or the phone / place are
 *     typed anywhere but games.json;
 *  2. business delivery: the line is not on the public pages at the services.json price, the
 *     /request tick box does not require Business name + Delivery address, or a ticked request
 *     does not get the Delivery fee line on its draft invoice, "Business delivery" with the address
 *     on its card, and Delivery / Collect bookings at that address on the calendar and Day sheet;
 *  3. hold numbers (48 hours, Hold longer 3 days) are typed outside services.json rentalHolds;
 *  4. "Waiting N days" does not count Memphis calendar days (across midnight), or the un-called
 *     list includes a called, phone or put-away request;
 *  5. the invoice editor is not compact rows + one row of chips + ONE big "Send invoice", or its
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
  ['a deposit the amount due now does not cover is never owed', { invoice: inv({ pay_plan: 'custom', deposit_due_cents: 3000 }), lines: L }, `Pay the rest ($120.00) at pickup. ${PICK}`],
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
// The public pages carry the line; the form page shows the tick box.
const BDL = BD.businessDeliveryLine(SERVICES);
for (const [f, min] of [['rentals/index.html', 3], ['faq/index.html', 2], ['rules.html', 1], ['request.html', 1], ['llms.txt', 1]]) {
  const t = read(f).replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  must(t.split(BDL).length - 1 >= min, `${f} lacks the business delivery line`);
}
const formHtml = (await s.get('/request')).text || read('request.html');
must(/name="business_delivery" value="yes" data-business-tick/.test(read('request.html')) && read('request.html').includes(BD.tickLabel(SERVICES).replace('—', '—')) && /name="business_name"/.test(read('request.html')) && /name="delivery_address"/.test(read('request.html')), 'request.html lacks the business delivery tick box with Business name + Delivery address');
void formHtml;
// Ticked without the details: refused, both named.
const base = { service: 'rentals', games: ['giant-uno'], duration: 'day', rental_date: plus(14), pickup_when: 'morning', return_when: 'after', phone: '901-555-0401' };
{
  const r = await s.siteRequest({ ...base, name: 'Nia Nodetails', email: 'nia.nodetails@example.com', business_delivery: 'yes' });
  must(r.status === 400 && /Type the business name/.test(r.text) && /Type the delivery address/.test(r.text), 'business delivery ticked without name / address was accepted');
}
const biz = await s.siteRequest({ ...base, name: 'Bo Business', email: 'bo.business@example.com', business_delivery: 'yes', business_name: 'Acme Offices', delivery_address: '100 Main St, Memphis' });
must(biz.status === 303, `the business delivery request was refused: ${biz.text.slice(0, 200)}`);
const home = await s.siteRequest({ ...base, rental_date: plus(20), name: 'Hal Homeparty', email: 'hal.home@example.com', phone: '901-555-0402' });
if (biz.row && home.row) {
  const bi = await s.one('SELECT invoice_id FROM request_status WHERE request_key = ?1', biz.row.request_key);
  const lines = await s.all('SELECT description, unit_cents, refundable FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position', bi.invoice_id);
  const fee = lines.find((l) => l.description === 'Delivery fee');
  must(fee && fee.unit_cents === FEE && fee.refundable === 0, `the business draft invoice has no ${FEE / 100} Delivery fee line (${JSON.stringify(lines.map((l) => l.description))})`);
  const hi = await s.one('SELECT invoice_id FROM request_status WHERE request_key = ?1', home.row.request_key);
  must(!(await s.all('SELECT description FROM invoice_lines WHERE invoice_id = ?1', hi.invoice_id)).some((l) => /deliver/i.test(l.description)), 'a home rental got a delivery line');
  const bks = await s.all("SELECT kind, place, date FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return') ORDER BY kind", biz.row.request_key);
  must(bks.length === 2 && bks.every((b) => b.place === '100 Main St, Memphis'), `the business bookings are not at the delivery address (${JSON.stringify(bks)})`);
  const hb = await s.one("SELECT place FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", home.row.request_key);
  must(hb && hb.place === table.pickupPlace, 'the home rental is not at the safe exchange zone');
  const dash = (await s.get('/admin/')).text;
  const c = cardOf(dash, biz.row.request_key);
  must(/data-business-delivery><strong>Business delivery<\/strong>: Acme Offices, 100 Main St, Memphis</.test(c), 'the card does not show "Business delivery" with the business and address');
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
  const rowsN = (ed.match(/<details class="lrow" data-line/g) || []).length;
  must(rowsN === lines.length + 1 && /<summary class="lsum"[^>]*><span class="ld" data-l-desc>Delivery fee<\/span><span class="lq" data-l-qty><\/span><span class="lt" data-l-total>\$20\.00<\/span><\/summary>/.test(ed), `the editor lines are not compact rows (${rowsN} rows)`);
  must(/<div class="qchips" data-quick-adds><button type="button" class="chipbtn" id="add-line"/.test(ed) && (ed.match(/class="chipbtn"/g) || []).length >= 5, 'the quick-adds are not one row of chips with + Line');
  must((ed.match(/class="btn primary"/g) || []).length === 1 && /<button class="btn primary" type="submit" name="go" value="send"[^>]*>Send invoice<\/button>/.test(ed) && /value="save"[^>]*>Save draft</.test(ed) && /value="preview"[^>]*>See it before sending</.test(ed), 'the editor does not have ONE big Send invoice (Save draft + See it before sending small)');
  must(ed.indexOf('data-ed-summary') > ed.indexOf('data-ed-plan') && /id="sum-total"/.test(ed) && /id="sum-deposit"/.test(ed) && /id="sum-rest"/.test(ed), 'the total / due now / rest summary is not at the bottom');
  must(/name="line_refundable"/.test(ed) && /name="line_note"/.test(ed) && /data-remove/.test(ed) && /name="notes"/.test(ed) && /name="customer_email"/.test(ed), 'the editor lost an ability (refundable / note / remove / message / customer)');
  for (const js of [...ed.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])) { let ok = true; try { new Function(js); } catch { ok = false; } must(ok, 'the editor script does not parse'); }
}

if (checks < 60) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) {
  console.error(`rental extras: FAIL (${errors.length} of ${checks})`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`rental extras: OK (${checks} checks: six note wordings from the numbers + hand note wins + phone from games.json, business delivery line/price/form/invoice/card/calendar/Day sheet, 48 h / 3 day holds from services.json, waiting days in Memphis + the un-called list, compact invoice editor)`);
