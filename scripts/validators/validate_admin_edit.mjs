#!/usr/bin/env node
/**
 * "Change anything on this request" (owner, 18 Oct 2026): Valerie can edit anything after the
 * fact, at any stage, Finished, Void and Put away included (functions/_lib/admin-edit.mjs).
 *
 * Fails when:
 *  1. a request card at any stage (new, draft, invoiced, deposit paid, scheduled, job done,
 *     finished, void, put away; every service) lacks the always-visible Edit link with its
 *     tooltip, or the link is not a large tap target;
 *  2. the page lacks a section, or the six sections are out of order (Bookings, Done dates,
 *     Invoice, Payments, Status, Customer details), each with its own Save;
 *  3. a section does not save: booking day/time/done/notes (and the reminder and the ICS feed
 *     follow the new day), Remove booking (asked first), Job done / Returned / Takedown done
 *     dates set and cleared (Finished recomputes; clearing Job done before the thank-you stops
 *     it; a sent thank-you is never sent again), invoice lines after paid (balance recomputes,
 *     "Changing this changes what they owe", nothing re-sent), payments edited / added /
 *     removed, status to every step and Void, takedown plan + date, customer details (raw
 *     Google Form row untouched, bookings and invoice follow);
 *  4. a change writes no history line with old → new and "(by Valerie)";
 *  5. a removed payment is deleted instead of kept (voided_at), or still counts;
 *  6. /admin/help lacks an entry for the Edit link or any edit.* button.
 * Rule 0: zero cards rendered, or fewer than 80 checks, is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const V = await mod('functions/_lib/views.mjs');
const { HELP } = await mod('functions/_lib/helptext.mjs');
const { esc } = await mod('functions/_lib/util.mjs');
const R = await mod('functions/_lib/reminders.mjs');
const C = await mod('functions/_lib/calendar.mjs');
const CM = await mod('functions/_lib/customer-messages.mjs');
const RQ = await mod('functions/_lib/requests.mjs');
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

// ---- 1. The Edit link on every card, at every stage ------------------------------------
const EDIT_TITLE = esc(HELP['card.edit'] ? HELP['card.edit'].title : '');
const hasEdit = (html, rk) => new RegExp(`<a class="editlink" href="/admin/requests/edit\\?r=${rk}" data-edit-link data-help="card.edit" title="${EDIT_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">Edit</a>`).test(html);
const paidBal = { total: 50000, paid: 50000, remaining: 0, owed: 0, refundable: 0, charges: 50000, void: false };
const owedBal = { total: 50000, paid: 0, remaining: 50000, owed: 50000, refundable: 0, charges: 50000, void: false };
const depBal = { total: 50000, paid: 25000, remaining: 25000, owed: 25000, refundable: 0, charges: 50000, void: false };
const STAGE_CASES = [
  ['new', { status: 'new' }, null, null],
  ['draft', { status: 'new' }, { id: 7, status: 'draft', total_cents: 50000, balance: owedBal }, null],
  ['invoiced', { status: 'invoiced' }, { id: 7, status: 'sent', total_cents: 50000, balance: owedBal }, null],
  ['deposit_paid', { status: 'deposit_paid' }, { id: 7, status: 'deposit_paid', total_cents: 50000, balance: depBal }, null],
  ['scheduled', { status: 'scheduled' }, { id: 7, status: 'deposit_paid', total_cents: 50000, balance: depBal }, { date: '2026-10-24' }],
  ['job_done', { status: 'job_done', job_done_at: '2026-10-24 17:00:00' }, { id: 7, status: 'deposit_paid', total_cents: 50000, balance: depBal }, { date: '2026-10-24' }],
  ['finished', { status: 'paid', job_done_at: '2026-10-24 17:00:00' }, { id: 7, status: 'paid', total_cents: 50000, balance: paidBal }, { date: '2026-10-24' }],
  ['void', { status: 'void' }, { id: 7, status: 'void', total_cents: 50000, balance: { ...owedBal, void: true, owed: 0, remaining: 0 } }, null],
  ['archived', { status: 'paid', job_done_at: '2026-10-24 17:00:00', archived_at: '2026-10-25 10:00:00' }, { id: 7, status: 'paid', total_cents: 50000, balance: paidBal }, { date: '2026-10-24' }],
];
const SVC = {
  porch: { services: ['porch'], need: 'porch', wantsDecor: true, wantsRentals: false, gamesAnswer: '', kinds: ['porch_install'] },
  party: { services: ['party'], need: 'party & decor', wantsDecor: true, wantsRentals: false, gamesAnswer: '', kinds: ['party_setup'] },
  grazing: { services: ['grazing'], need: 'grazing', wantsDecor: true, wantsRentals: false, gamesAnswer: '', kinds: ['grazing_setup'] },
  rentals: { services: ['rentals'], need: 'rentals', wantsDecor: false, wantsRentals: true, gamesAnswer: 'Giant Uno', kinds: ['rental_pickup', 'rental_return'] },
};
let cards = 0;
const stagesSeen = new Set();
for (const [svc, base] of Object.entries(SVC)) {
  for (const [stage, st, inv, sched] of STAGE_CASES) {
    const r = { key: `edit|${svc}|${stage}`, name: 'Ann Example', rentals: [], decor: [{ label: 'Event date', value: '10/24/2026' }], other: [], takedownPlan: 'customer_handles', ...base };
    const ret = svc === 'rentals' && ['job_done', 'finished', 'archived'].includes(stage) ? { returned_at: '2026-10-25 17:00:00', damaged: 0 } : null;
    const html = V.requestCard(r, { st, inv, sched, ret, kinds: sched ? base.kinds : [], bookings: sched ? base.kinds.map((kind, i) => ({ id: i + 1, kind, date: '2026-10-24' })) : [], archived: stage === 'archived', today: '2026-10-26' });
    cards += 1;
    const got = (html.match(/data-stage="([^"]+)"/) || [])[1];
    stagesSeen.add(got);
    const rk = (html.match(/data-reqcard[^>]*?id="c-([^"]+)"/) || html.match(/id="c-([^"]+)"/) || [])[1];
    must(got === stage, `${svc}/${stage}: the card rendered stage ${got}`);
    must(hasEdit(html, rk), `${svc}/${stage}: no always-visible Edit link with its tooltip`);
    must(html.indexOf('data-edit-link') < html.indexOf('data-details'), `${svc}/${stage}: the Edit link is hidden under Show details`);
  }
}
for (const st of ['new', 'draft', 'invoiced', 'deposit_paid', 'scheduled', 'job_done', 'finished', 'void', 'archived']) must(stagesSeen.has(st), `stage ${st} never rendered`);
must(/\.editlink\{[^}]*min-height:48px/.test(V.CARD_CSS), 'the Edit link is not a large tap target (min-height 48px)');

// ---- 2-5. The page and every section, through the real guard and router ----------------
const s = await session();
const today = s.util.todayISO();
const plus = (n) => s.util.todayISO(n);
const req = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'yes', event_date: plus(3), location: 'Germantown', name: 'Eve Editor', phone: '901-555-0950', email: 'eve.editor@example.com' });
must(req.status === 303 && req.row, 'the porch request did not go through');
const key = req.row.request_key;
const rk = s.rk(key);
const reqObj = (await RQ.loadRequests(s.env)).find((x) => x.key === key);
const inv = await s.invoiceFor(reqObj, { go: 'send' });
must(inv.id > 0, 'no invoice was made');
const sentBefore = s.env.sent.length;
await s.post(`/admin/invoices/${inv.id}/status`, { action: 'deposit_paid', method: 'zelle' });
await s.post('/admin/calendar/bookings', { r: rk, kind: 'porch_install', date: plus(-3), time: '10:00', customer_name: 'Eve Editor', phone: '901-555-0950', email: 'eve.editor@example.com', place: 'Germantown', items: 'Porch', note: 'Gate code 12' });
await s.post('/admin/calendar/bookings', { r: rk, kind: 'porch_takedown', date: plus(-1), customer_name: 'Eve Editor', phone: '901-555-0950', email: '', place: 'Germantown', items: 'Porch' });
const install = await s.one("SELECT * FROM bookings WHERE request_key = ?1 AND kind = 'porch_install'", key);
const takedown = await s.one("SELECT * FROM bookings WHERE request_key = ?1 AND kind = 'porch_takedown'", key);
await s.post('/admin/requests/jobdone', { r: rk });
await s.post(`/admin/invoices/${inv.id}/status`, { action: 'paid', method: 'cash' });
await s.post(`/admin/calendar/bookings/${takedown.id}/takedown-done`, {});
await s.post('/admin/requests/archive', { r: rk });
const stageOf = async () => { const h = (await s.get('/admin/?pa=1')).text; const m = h.match(new RegExp(`id="c-${rk}"[^>]*data-stage="([^"]+)"`)); return m ? m[1] : ''; };
must(await stageOf() === 'archived', 'the scenario request is not Put away');
const evCount = async () => (await s.one('SELECT COUNT(*) AS n FROM request_events WHERE request_key = ?1', key)).n;
const lastEvents = async (n) => (await s.all('SELECT what, who FROM request_events WHERE request_key = ?1 ORDER BY id DESC LIMIT ?2', key, n));
const logged = async (re, msg) => { const ev = await lastEvents(8); must(ev.some((e) => re.test(e.what) && / → /.test(e.what) && /\(by Valerie\)$/.test(e.what) && e.who === 'Valerie'), `${msg}: no history line with old → new and "(by Valerie)"`); };

// Put away cards keep the Edit link through the real route.
must(hasEdit((await s.get('/admin/?pa=1')).text, rk), 'a Put away card on Requests has no Edit link');
const page = await s.get(`/admin/requests/edit?r=${rk}`);
must(page.status === 200, `the edit page answered ${page.status}`);
const order = [...page.text.matchAll(/data-edit-section="([^"]+)"/g)].map((m) => m[1]);
must(order.join(',') === 'bookings,dates,invoice,payments,status,customer', `sections out of order or missing: ${order.join(',')}`);
for (const [sec, saveKey] of [['dates', 'edit.saveDates'], ['invoice', 'edit.saveInvoice'], ['status', 'edit.saveStatus'], ['customer', 'edit.saveCustomer']]) {
  const part = page.text.slice(page.text.indexOf(`data-edit-section="${sec}"`), page.text.indexOf('</section>', page.text.indexOf(`data-edit-section="${sec}"`)));
  must((part.match(new RegExp(`data-help="${saveKey}"`, 'g')) || []).length === 1, `section ${sec} does not have exactly one Save`);
}
must((page.text.match(/data-help="edit.saveBooking"/g) || []).length === 2, 'each booking does not have its own Save');
must((page.text.match(/data-help="edit.savePayment"/g) || []).length === 2, 'each payment does not have its own Save');
must(/data-owe-note><strong>Changing this changes what they owe\.<\/strong>/.test(page.text), 'a paid invoice does not say "Changing this changes what they owe"');
must(/<details class="confirm"><summary class="btn danger" data-help="edit.removeBooking"/.test(page.text) && /data-help="edit.removeBookingYes"/.test(page.text), 'Remove booking has no confirm step');
must(/<details class="confirm"><summary class="btn danger" data-help="edit.removePayment"/.test(page.text) && /data-help="edit.removePaymentYes"/.test(page.text), 'Remove payment has no confirm step');
must(/\.editpage input,\.editpage select,\.editpage textarea\{[^}]*min-height:48px/.test(page.text), 'the edit page inputs are not large tap targets');
must(!/(?<!-)width:\s*(?:[4-9]\d\d|\d{4,})px/.test(page.text.slice(page.text.indexOf('.editpage'), page.text.indexOf('</style>', page.text.indexOf('.editpage')))), 'the edit page has a fixed width wider than a phone');
must(/data-step="paid"|now: 6\. Paid in full/.test(page.text) && /· Finished/.test(page.text) && /· Put away/.test(page.text), 'the page does not say where the request stands');

// 3a. Booking: day, time, done, notes; reminder and ICS follow. (Brought back first: a put-away
// request gets no reminders by design, tomorrowsBookings.)
await s.post('/admin/requests/unarchive', { r: rk });
const newDay = R.tomorrowChicago();
await s.db.prepare("UPDATE bookings SET email_reminded_at = datetime('now'), reminded_at = datetime('now') WHERE id = ?1").bind(install.id).run();
const note = await s.one('SELECT id, body FROM booking_notes WHERE booking_id = ?1', install.id);
const bsave = await s.post('/admin/requests/edit/booking', { r: rk, id: String(install.id), date: newDay, time: '14:30', done: '1', [`note_${note.id}`]: 'Gate code 34', new_note: 'Bring the ladder' });
must(/\/admin\/requests\/edit\?r=.*m=/.test(bsave.location), `booking save did not come back with a message (${bsave.location})`);
const b2 = await s.one('SELECT * FROM bookings WHERE id = ?1', install.id);
must(b2.date === newDay && b2.time === '14:30' && b2.done_at && b2.edited_by_hand === 1, 'the booking day/time/done did not save');
must(!b2.email_reminded_at && !b2.reminded_at, 'the reminder did not follow the new day (still marked reminded)');
must((await R.tomorrowsBookings(s.db)).some((x) => x.id === install.id), "the moved booking is not in tomorrow's reminders");
must((await s.one('SELECT body FROM booking_notes WHERE id = ?1', note.id)).body === 'Gate code 34', 'the booking note did not save');
must(Boolean(await s.one("SELECT id FROM booking_notes WHERE booking_id = ?1 AND body = 'Bring the ladder'", install.id)), 'the new booking note was not added');
const ics = C.buildIcs(await C.listBookings(s.db));
must(new RegExp(`UID:booking-${install.id}@[\\s\\S]*?DTSTART[^:]*:${newDay.replace(/-/g, '')}T143000`).test(ics), 'the Google Calendar feed does not show the new day and time');
await logged(/Porch install day: .* → /, 'booking day change');
await logged(/Porch install time: 10:00 AM → 2:30 PM|Porch install time: .* → /, 'booking time change');
await logged(/note: Gate code 12 → Gate code 34/, 'booking note change');
// Same day again keeps "reminded" (no double send).
await s.db.prepare("UPDATE bookings SET email_reminded_at = datetime('now') WHERE id = ?1").bind(install.id).run();
await s.post('/admin/requests/edit/booking', { r: rk, id: String(install.id), date: newDay, time: '15:00', done: '1' });
must(Boolean((await s.one('SELECT email_reminded_at FROM bookings WHERE id = ?1', install.id)).email_reminded_at), 'a time-only change re-arms the email reminder (would send twice)');
// Not done again.
await s.post('/admin/requests/edit/booking', { r: rk, id: String(install.id), date: newDay, time: '15:00' });
must(!(await s.one('SELECT done_at FROM bookings WHERE id = ?1', install.id)).done_at, 'unticking done did not save');

// 3b. Done dates: Job done, Takedown done; Finished recomputes; thank-you.
const finishedNow = async () => { const h = (await s.get(`/admin/requests/edit?r=${rk}`)).text; return /· Finished/.test(h); };
must(await finishedNow(), 'the scenario request is not Finished before the date edits');
must(/name="job_done" type="date" value="\d{4}-\d{2}-\d{2}"/.test(page.text) && /name="takedown_done" type="date" value="\d{4}-\d{2}-\d{2}"/.test(page.text), 'the Done dates section lacks Job done or Takedown done');
const fut = await s.post('/admin/requests/edit/dates', { r: rk, job_done: plus(3), td_id: String(takedown.id), takedown_done: plus(-1) });
must(/e=/.test(fut.location), 'a done date after today was accepted');
await s.post('/admin/requests/edit/dates', { r: rk, job_done: '', td_id: String(takedown.id), takedown_done: plus(-1) });
must(!(await s.one('SELECT job_done_at FROM request_status WHERE request_key = ?1', key)).job_done_at, 'clearing Job done did not clear it');
must(!(await finishedNow()), 'clearing Job done left the request Finished');
const ty = await CM.sendThankYous(s.env);
must(!s.env.sent.slice(sentBefore).some((m) => /thank/i.test(JSON.stringify(m.subject || ''))) && !(await s.one('SELECT thankyou_emailed_at FROM requests WHERE request_key = ?1', key)).thankyou_emailed_at, `a thank-you went out after Job done was cleared (${JSON.stringify(ty)})`);
await logged(/Job done date: .* → \(none\)/, 'clearing Job done');
await s.post('/admin/requests/edit/dates', { r: rk, job_done: plus(-2), td_id: String(takedown.id), takedown_done: plus(-1) });
const jd = await s.one('SELECT job_done_at FROM request_status WHERE request_key = ?1', key);
must(jd.job_done_at && C.chicagoDayOf(jd.job_done_at) === plus(-2), 'setting the Job done date did not save that day');
must(await finishedNow(), 'setting Job done again did not make it Finished again');
await logged(/Job done date: \(none\) → /, 'setting Job done');
const sentTy0 = s.env.sent.length;
await CM.sendThankYous(s.env);
must(s.env.sent.length === sentTy0 + 1 && (await s.one('SELECT thankyou_emailed_at FROM requests WHERE request_key = ?1', key)).thankyou_emailed_at, 'the thank-you did not follow the edited Job done date');
await s.post('/admin/requests/edit/dates', { r: rk, job_done: plus(-1), td_id: String(takedown.id), takedown_done: plus(-1) });
const sentTy1 = s.env.sent.length;
await CM.sendThankYous(s.env);
must(s.env.sent.length === sentTy1, 'moving the Job done date after the thank-you went out sent it again');
await s.post('/admin/requests/edit/dates', { r: rk, job_done: plus(-1), td_id: String(takedown.id), takedown_done: '' });
must(!(await s.one('SELECT done_at FROM bookings WHERE id = ?1', takedown.id)).done_at && !(await finishedNow()), 'clearing Takedown done did not hold Finished back');
await logged(/Takedown done date: .* → \(none\)/, 'clearing Takedown done');
await s.post('/admin/requests/edit/dates', { r: rk, job_done: plus(-1), td_id: String(takedown.id), takedown_done: plus(-1) });
must(await finishedNow(), 'setting Takedown done again did not make it Finished');

// 3c. Invoice after paid: balance recomputes, nothing re-sent.
const lines = await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position', inv.id);
const sentInv = s.env.sent.length;
const form = { r: rk, invoice_id: String(inv.id), line_desc: [...lines.map((l) => l.description), 'Extra pumpkins'], line_qty: [...lines.map((l) => String(l.qty)), '2'],
  line_price: [...lines.map((l) => (l.unit_cents / 100).toFixed(2)), '15.00'], line_note: [...lines.map((l) => l.note), ''], line_refundable: [...lines.map((l) => (l.refundable ? '1' : '0')), '0'] };
await s.post('/admin/requests/edit/invoice', form);
must((await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1', inv.id)).length === lines.length + 1, 'the invoice line was not added');
must(s.env.sent.length === sentInv, 'saving the invoice sent something to the customer');
const after = (await s.get(`/admin/requests/edit?r=${rk}`)).text;
must(/data-owed="3000"/.test(after), `the balance did not recompute to $30.00 owed (${(after.match(/data-owed="(\d+)"/) || [])[1]})`);
must((await s.one('SELECT status FROM invoices WHERE id = ?1', inv.id)).status === 'deposit_paid', 'a paid invoice with more owed still reads paid');
must(!/· Finished/.test(after), 'still Finished with $30 owed');
await logged(/Invoice PNP-\d{4}-\d{4} changed: total \$[\d,.]+ → \$[\d,.]+/, 'invoice change');
must(/e=/.test((await s.post('/admin/requests/edit/invoice', { r: rk, invoice_id: String(inv.id) })).location), 'an invoice with no lines was accepted');

// 3d. Payments: add, edit, remove (soft).
await s.post('/admin/requests/edit/payment-add', { r: rk, amount: '30.00', date: today, method: 'cashapp' });
const added = await s.one("SELECT * FROM payments WHERE invoice_id = ?1 AND note = 'added by hand'", inv.id);
must(added && added.amount_cents === 3000 && added.method === 'cashapp', 'Add a payment did not record it');
must((await s.one('SELECT status FROM invoices WHERE id = ?1', inv.id)).status === 'paid' && /data-owed="0"/.test((await s.get(`/admin/requests/edit?r=${rk}`)).text), 'adding the rest did not make it paid again');
await logged(/Payment added: \(none\) → \$30\.00/, 'payment added');
await s.post('/admin/requests/edit/payment', { r: rk, id: String(added.id), amount: '20.00', date: plus(-1), method: 'zelle' });
const edited = await s.one('SELECT * FROM payments WHERE id = ?1', added.id);
must(edited.amount_cents === 2000 && edited.received_on === plus(-1) && edited.method === 'zelle', 'editing the payment did not save amount, day and method');
await logged(/Payment amount: \$30\.00 → \$20\.00/, 'payment amount');
await logged(/Payment method: Cash App → Zelle/, 'payment method');
must(/data-owed="1000"/.test((await s.get(`/admin/requests/edit?r=${rk}`)).text), 'the balance did not recompute after the payment edit');
const nPay = (await s.one('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?1', inv.id)).n;
await s.post('/admin/requests/edit/payment-remove', { r: rk, id: String(added.id) });
const removed = await s.one('SELECT * FROM payments WHERE id = ?1', added.id);
must(removed && removed.voided_at, 'the removed payment row is gone or not marked removed (must be soft)');
must((await s.one('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?1', inv.id)).n === nPay, 'removing a payment deleted a row');
const pg2 = (await s.get(`/admin/requests/edit?r=${rk}`)).text;
must(/data-owed="3000"/.test(pg2), 'a removed payment still counts toward the balance');
must(new RegExp(`data-payment-removed="${added.id}"`).test(pg2), 'the removed payment is not shown as removed (kept in history)');
await logged(/Payment removed: \$20\.00 .* → removed, kept in the history/, 'payment removal');

// 3e. Status: every step and Void, on a request with an invoice and no booking yet.
{
  const sr = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', event_date: plus(6), location: 'Bartlett', name: 'Stan Status', phone: '901-555-0953', email: 'stan.status@example.com' });
  const k3 = sr.row.request_key; const rk3 = s.rk(k3);
  const inv3 = await s.invoiceFor((await RQ.loadRequests(s.env)).find((x) => x.key === k3), { go: 'send' });
  const evs = async () => (await s.all('SELECT what, who FROM request_events WHERE request_key = ?1 ORDER BY id DESC', k3));
  const WANT = { void: 'Void — cancelled', invoiced: '2. Invoice sent', new: '1. New', deposit_paid: '3. Deposit paid', scheduled: '3. Deposit paid', job_done: '5. Job done', paid: '6. Paid in full' };
  for (const step of ['void', 'invoiced', 'new', 'deposit_paid', 'scheduled', 'job_done', 'paid']) {
    const before = (await evs()).length;
    const res = await s.post('/admin/requests/edit/status', { r: rk3, step, method: 'cash' });
    const h = (await s.get(`/admin/requests/edit?r=${rk3}`)).text;
    must(new RegExp(`now: ${WANT[step].replace(/[.()]/g, '\\$&')}`).test(h), `status → ${step}: the page reads "${(h.match(/now: ([^<·]+)/) || [])[1]}"`);
    if (step === 'scheduled') must(/Add%20a%20booking/.test(res.location), 'status → Scheduled with no booking does not say to add one');
    const ev = await evs();
    must(ev.length > before, `status → ${step}: no history line`);
    const last = ev.find((e) => /^Status: /.test(e.what));
    must(last && / → /.test(last.what) && /\(by Valerie\)$/.test(last.what) && last.who === 'Valerie', `status → ${step}: the history line lacks old → new / by Valerie`);
  }
  must((await s.one('SELECT status FROM invoices WHERE id = ?1', inv3.id)).status === 'paid', 'status Paid in full did not leave the invoice paid');
  must(/data-owed="0"/.test((await s.get(`/admin/requests/edit?r=${rk3}`)).text), 'status Paid in full did not record the rest');
  await s.post('/admin/requests/edit/status', { r: rk3, step: 'invoiced' });
  must((await s.one('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?1 AND voided_at IS NOT NULL', inv3.id)).n >= 2 && (await s.one('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?1 AND voided_at IS NULL', inv3.id)).n === 0, 'stepping back to Invoice sent did not soft-remove the payments (kept, voided)');
  must(!(await s.one('SELECT job_done_at FROM request_status WHERE request_key = ?1', k3)).job_done_at, 'stepping back before Job done did not clear Job done');
  // On the calendar, an earlier step says why it still reads Scheduled.
  const res = await s.post('/admin/requests/edit/status', { r: rk, step: 'invoiced' });
  must(/still%20reads%20Scheduled/.test(res.location), 'an earlier step on a booked request does not explain it still reads Scheduled');
}
await s.post('/admin/requests/edit/status', { r: rk, step: 'paid', takedown_plan: 'customer_handles', takedown_date: plus(4), takedown_note: 'They have a ladder' });
const tdRow = await s.one('SELECT takedown_plan, takedown_date, takedown_note FROM requests WHERE request_key = ?1', key);
must(tdRow.takedown_plan === 'customer_handles' && tdRow.takedown_date === plus(4) && tdRow.takedown_note === 'They have a ladder', 'the takedown plan / date / note did not save');
await logged(/Takedown plan: we take it down \(scheduled\) → the customer will handle it/, 'takedown plan');

// 3f. Remove a booking (after the confirm step on the page).
await s.post('/admin/requests/edit/booking-remove', { r: rk, id: String(takedown.id) });
must(!(await s.one('SELECT id FROM bookings WHERE id = ?1', takedown.id)), 'Remove booking did not take it off the calendar');
must(!C.buildIcs(await C.listBookings(s.db)).includes(`UID:booking-${takedown.id}@`), 'a removed booking is still in the Google Calendar feed');
await logged(/Booking removed: Porch takedown on .* → \(none\)/, 'booking removal');

// 3g. Customer details: site request; bookings and invoice follow.
await s.post('/admin/requests/edit/customer', { r: rk, name: 'Eve Edited', phone: '901-555-0951', email: 'eve.edited@example.com', address: '12 New St', notes: 'Orange and black' });
const rq = (await RQ.loadRequests(s.env)).find((x) => x.key === key);
must(rq.name === 'Eve Edited' && rq.phone === '901-555-0951' && rq.email === 'eve.edited@example.com', 'the corrected name / phone / email do not read back');
must([...rq.rentals, ...rq.decor, ...rq.other].some((x) => /^location/i.test(x.label) && x.value === '12 New St'), 'the corrected address does not read back');
must([...rq.rentals, ...rq.decor, ...rq.other].some((x) => x.value === 'Orange and black'), 'the corrected notes do not read back');
const bk = await s.one('SELECT customer_name, phone, email, place FROM bookings WHERE id = ?1', install.id);
must(bk.customer_name === 'Eve Edited' && bk.phone === '901-555-0951' && bk.place === '12 New St', 'the bookings did not follow the customer details');
must((await s.one('SELECT customer_name, customer_phone FROM invoices WHERE id = ?1', inv.id)).customer_name === 'Eve Edited', 'the invoice did not follow the customer name');
must(/Eve Edited/.test((await s.get('/admin/search?q=edited')).text), 'Find a customer does not find the corrected name');
await logged(/Name: Eve Editor → Eve Edited/, 'customer name');
await logged(/Address: Germantown → 12 New St/, 'customer address');
must(/>Eve Edited</.test((await s.get('/admin/?pa=1')).text), 'the card does not show the corrected name');

// Old Google Form request: the raw row is never rewritten, the correction reads back.
{
  const gf = s.requests.find((x) => x.source === 'google_form');
  must(Boolean(gf), 'no Google Form request in the fixture to edit');
  if (gf) {
    const raw0 = (await s.one('SELECT raw_row FROM requests WHERE request_key = ?1', gf.key)).raw_row;
    await s.post('/admin/requests/edit/customer', { r: s.rk(gf.key), name: 'Gail Fixed', phone: gf.phone, email: gf.email, address: 'Cordova', notes: '' });
    must((await s.one('SELECT raw_row FROM requests WHERE request_key = ?1', gf.key)).raw_row === raw0, 'editing an old Google Form request rewrote its raw row');
    must((await RQ.loadRequests(s.env)).find((x) => x.key === gf.key).name === 'Gail Fixed', 'the old Google Form request does not read back the corrected name');
  }
}

// 3h. A rental: Returned date set and cleared (the Undo returned path).
{
  const rr = await s.siteRequest({ service: 'rentals', games: ['giant-uno'], duration: 'day', pickup_date: plus(5), name: 'Rex Return', phone: '901-555-0952', email: 'rex.return@example.com' });
  const k2 = rr.row.request_key; const rk2 = s.rk(k2);
  await s.post('/admin/calendar/bookings', { r: rk2, kind: 'rental_pickup', date: plus(-2), return_date: plus(-1), customer_name: 'Rex Return', phone: '', email: '', place: '', items: 'Giant Uno' });
  const p0 = (await s.get(`/admin/requests/edit?r=${rk2}`)).text;
  must(/data-not-returned/.test(p0) && /href="\/admin\/returns\?k=/.test(p0), 'a rental not returned yet has no Mark returned link on the page');
  await s.post(`/admin/returns?k=${rk2}`, { back: ['Giant Uno'] });
  must(/name="returned" type="date"/.test((await s.get(`/admin/requests/edit?r=${rk2}`)).text), 'a returned rental has no Returned date to change');
  await s.post('/admin/requests/edit/dates', { r: rk2, returned: plus(-1) });
  must(C.chicagoDayOf((await s.one('SELECT returned_at FROM rental_returns WHERE return_key = ?1', k2)).returned_at) === plus(-1), 'changing the Returned date did not save');
  await s.post('/admin/requests/edit/dates', { r: rk2, returned: '' });
  must(!(await s.one('SELECT returned_at FROM rental_returns WHERE return_key = ?1', k2)).returned_at && !(await s.one('SELECT job_done_at FROM request_status WHERE request_key = ?1', k2)).job_done_at, 'clearing Returned did not take it back (Undo returned path)');
  const ev = await s.all('SELECT what FROM request_events WHERE request_key = ?1', k2);
  must(ev.some((e) => /^Returned date: .* → \(none\) \(by Valerie\)$/.test(e.what)), 'clearing Returned wrote no old → new history line');
  // Void through Status, then Edit is still there and the page still opens.
  await s.post('/admin/requests/edit/status', { r: rk2, step: 'void' });
  const h = (await s.get('/admin/')).text;
  must(new RegExp(`id="c-${rk2}"[^>]*data-stage="void"`).test(h) && hasEdit(h, rk2), 'a request voided from the page has no Edit link on its card');
  must((await s.get(`/admin/requests/edit?r=${rk2}`)).status === 200, 'the edit page of a void request does not open');
}
must((await s.get('/admin/requests/edit?r=nope')).status === 404, 'an unknown request does not answer 404');
must((await s.get(`/admin/requests/edit?r=${rk}`, { auth: false })).status !== 200, 'the edit page opens without signing in');

// ---- 6. Help entries --------------------------------------------------------------------
const help = (await s.get('/admin/help')).text;
const editKeys = ['card.edit', ...Object.keys(HELP).filter((k) => k.startsWith('edit.'))];
must(editKeys.length >= 12, `only ${editKeys.length} edit help entries`);
for (const k of editKeys) must(help.includes(`data-help-entry="${k}"`), `/admin/help has no entry for ${k}`);
must(/Change anything on this request/.test(help), '/admin/help has no "Change anything on this request" section');

if (!cards) errors.push('Rule 0: no cards rendered');
if (checks < 80) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: admin edit (${errors.length})\n${errors.map((e) => `- ${e}`).join('\n')}`); process.exit(1); }
console.log(`validate_admin_edit: OK (${checks} checks: Edit link on ${cards} cards at every stage incl. finished/void/put away; six sections in order, one Save each; bookings + reminder + ICS follow; done dates set/cleared with Finished and the thank-you; invoice after paid recomputes, nothing re-sent; payments edited/added/soft-removed; every status + Void; customer details incl. raw row kept; history old → new by Valerie; help entries)`);
