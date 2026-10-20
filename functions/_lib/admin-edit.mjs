// "Change anything on this request" (owner, 18 Oct 2026): Valerie can correct anything after
// the fact, at any stage, Finished, Void and Put away included. ONE page per request
// (/admin/requests/edit?r=…), sections in order, one Save each: Bookings, Done dates, Invoice,
// Payments, Status, Customer details. It reuses the existing paths so every screen agrees:
//   bookings     calendar.mjs editBookingWhen / deleteBooking / notes (the ICS feed, the Bookings
//                tab and the day-before reminder follow the booking, REMIND_AGAIN);
//   done dates   the same undo paths as Undo job done / Undo returned / Undo takedown done, so
//                Finished recomputes; the thank-you follows job_done_at and is never re-sent;
//   invoice      ledger.mjs linesFromForm / saveLines, then syncMoneyStatus (balance recomputes;
//                nothing is re-sent to the customer);
//   payments     soft: a removed payment keeps its row with voided_at, never deleted;
//   customer     requests.details_edits (migration 0011), laid over the form by fromRow.
// Every change writes a history line "old → new (by Valerie)" through logEvent. The sheet sync
// runs after every admin POST (admin.mjs handleAdmin). Proof: npm run validate:admin-edit.
import { esc, money, redirect, htmlResponse, b64urlText, fromB64urlText, shortDate, invoiceTotal, toCents, payPlanOf, amountDueNow } from './util.mjs';
import { loadRequests, logEvent, eventsFor, DETAIL_FIELDS, ADDRESS_RE, NOTES_RE, detailAnswer, deliveryOf } from './requests.mjs';
import { chicagoDate } from './reminders.mjs';
import * as C from './calendar.mjs';
import { balanceOf, paidByInvoice, linesFromForm, saveLines, syncMoneyStatus, recordPayment, dueWords } from './ledger.mjs';
import { servicesOf, TAKEDOWN_PLANS } from './cards.mjs';
import { deriveProgress, STEP_KEYS } from './progress.mjs';
import { takedownState, loadTakedownFacts, TAKEDOWN_KINDS } from './takedown.mjs';
import { tip } from './helptext.mjs';
import * as V from './views.mjs';
import { TRACK_TABLE } from './prices.mjs';

export const WHO = 'Valerie';
export const SECTIONS = ['bookings', 'dates', 'invoice', 'payments', 'status', 'customer'];
const STEP_WORDS = { new: '1. New', invoiced: '2. Invoice sent', deposit_paid: '3. Deposit paid', scheduled: '4. Scheduled', job_done: '5. Job done (Returned for rentals)', paid: '6. Paid in full', void: 'Void — cancelled' };
const PLAN_WORDS = { '': 'not asked yet', scheduled: 'we take it down (scheduled)', not_sure: 'not sure yet', customer_handles: 'the customer will handle it' };
const METHOD_WORDS = { zelle: 'Zelle', cashapp: 'Cash App', cash: 'Cash', card: 'Card', other: 'Other', '': 'not given' };
const KIND_PAY = { payment: 'Payment', refund: 'Damage deposit refunded', deposit_kept: 'Damage deposit kept' };

const decodeKey = (v) => { try { return fromB64urlText(v); } catch { return ''; } };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const dateIn = (v) => (isDate(v) ? String(v) : '');
const timeIn = (v) => (/^\d{2}:\d{2}$/.test(String(v || '').trim()) ? String(v).trim() : '');
const asUtcNoon = (iso) => `${iso} 17:00:00`; // Memphis midday on that day (CDT 12:00, CST 11:00)
const show = (v) => (v === '' || v === null || v === undefined ? '(empty)' : String(v));
const day = (v) => (v ? shortDate(v) : '(none)');
const log = (db, key, what) => logEvent(db, key, `${what} (by ${WHO})`, WHO);
const changed = (label, a, b) => `${label}: ${show(a)} → ${show(b)}`;

async function setStatusRow(db, key, status, invoiceId = null) {
  await db.prepare(`INSERT INTO request_status (request_key, status, invoice_id, prev_status, updated_at) VALUES (?1, ?2, ?3, 'new', datetime('now'))
    ON CONFLICT(request_key) DO UPDATE SET prev_status = CASE WHEN request_status.status = excluded.status THEN request_status.prev_status ELSE request_status.status END,
      status = excluded.status, invoice_id = COALESCE(excluded.invoice_id, request_status.invoice_id), updated_at = excluded.updated_at`).bind(key, status, invoiceId).run();
}

// Everything the page shows, from the same tables every other screen reads.
export async function loadEdit(env, key) {
  const db = env.DB;
  const r = (await loadRequests(env)).find((x) => x.key === key);
  if (!r) return null;
  const st = (await db.prepare('SELECT * FROM request_status WHERE request_key = ?1').bind(key).first()) || { status: 'new' };
  const inv = st.invoice_id ? await db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(st.invoice_id).first()
    : await db.prepare('SELECT * FROM invoices WHERE request_key = ?1 ORDER BY id DESC LIMIT 1').bind(key).first();
  const lines = inv ? ((await db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id').bind(inv.id).all()).results || []) : [];
  const payments = inv ? ((await db.prepare('SELECT * FROM payments WHERE invoice_id = ?1 ORDER BY received_on, id').bind(inv.id).all()).results || []) : [];
  const paid = inv ? ((await paidByInvoice(db, [inv.id]))[inv.id] || 0) : 0;
  const balance = inv ? balanceOf(inv, lines, paid) : null;
  const bookings = (await db.prepare("SELECT * FROM bookings WHERE request_key = ?1 ORDER BY date, COALESCE(time, ''), id").bind(key).all()).results || [];
  // Each note once: under its own booking; notes whose booking was removed sit with the first one.
  const allNotes = await C.notesByBooking(db, bookings);
  const notes = {};
  bookings.forEach((b, i) => { notes[b.id] = (allNotes[b.id] || []).filter((n) => n.booking_id === b.id || (i === 0 && !bookings.some((x) => x.id === n.booking_id))); });
  const ret = await db.prepare('SELECT * FROM rental_returns WHERE return_key = ?1').bind(key).first();
  const events = await eventsFor(db, key);
  const services = servicesOf(r);
  const today = chicagoDate();
  const facts = await loadTakedownFacts(db);
  const td = takedownState({ services, takedownPlan: r.takedownPlan, takedownDate: r.takedownDate, invoiceTakedown: Boolean(inv && facts.invoiceIds.has(inv.id)), bookings, today });
  const rental = Boolean(r.gamesAnswer) || (r.wantsRentals && !r.wantsDecor);
  const pr = deriveProgress({ st, inv: inv ? { ...inv, balance } : null, scheduled: bookings.length > 0, ret, rental, takedown: td });
  return { r, st, inv, lines, payments, balance, bookings, notes, ret, events, services, today, td, pr };
}

// ---- The page --------------------------------------------------------------------------

const EDIT_CSS = `
.editpage section.card{margin:0 0 16px}.editpage h2{margin-top:0}
.editpage label{display:block;font-weight:600;margin:12px 0 4px}
.editpage input,.editpage select,.editpage textarea{width:100%;min-height:48px;font:inherit;padding:10px 12px;border:2px solid var(--line);border-radius:10px;background:#fff}
.editpage textarea{min-height:90px}
.editpage .two{display:grid;grid-template-columns:1fr;gap:0 14px}@media(min-width:700px){.editpage .two{grid-template-columns:1fr 1fr}}
.editpage .bk{border-top:2px solid var(--line);padding-top:12px;margin-top:12px}.editpage .bk:first-of-type{border-top:0;margin-top:0;padding-top:0}
.editpage .removed{opacity:.65;text-decoration:line-through}.editpage .save{margin-top:14px}
.editpage .choice{display:flex;align-items:center;gap:10px;min-height:48px;font-weight:600}.editpage .choice input{width:28px;min-height:28px}
.editpage .sumline{display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px solid var(--line)}
`;
const LINES_JS = `(function(){var f=document.getElementById('edit-inv');if(!f)return;var l=f.querySelector('[data-lines]'),t=document.getElementById('line-tpl');
f.addEventListener('click',function(e){if(e.target.matches('[data-remove]')){e.target.closest('[data-line]').remove();}});
var a=document.getElementById('add-line');if(a)a.addEventListener('click',function(){l.insertAdjacentHTML('beforeend',t.innerHTML);});})();`;

const save = (key, label) => `<div class="save">${V.act(`<button class="btn primary" type="submit"${tip(key)}>${esc(label)}</button>`, key)}</div>`;
const form = (what, rk, body, extra = '') => `<form method="post" action="/admin/requests/edit/${what}"${extra}>${V.hiddenInputs({ r: rk })}${body}</form>`;
const field = (id, label, input) => `<label for="${id}">${esc(label)}</label>${input}`;

// Rental dates (owner, 19 Oct 2026): pickup and return in one place, phone-sized. Saving moves
// both bookings (calendar, ICS, reminders follow), logs old -> new, and warns in plain words when
// the new span needs a game that is already out with someone else. It still saves.
export async function rentalClashWords(db, key, { start, end, items }) {
  const all = await C.listBookings(db);
  const windows = C.rentalWindows(all, await C.loadReturns(db), TRACK_TABLE);
  const hit = C.spanClashes(windows, { start, end, items }, chicagoDate(), TRACK_TABLE, key);
  if (!hit.length) return '';
  return `Heads up: ${hit.map((c) => `${c.item} is already out with ${c.who.join(' and ')} on ${c.dates.map((x) => shortDate(x)).join(', ')}`).join('; ')}. The dates are saved anyway; change them if that is a mistake.`;
}

function rentalDatesBlock(d, rk) {
  const p = d.bookings.find((b) => b.kind === 'rental_pickup');
  const r = d.bookings.find((b) => b.kind === 'rental_return');
  if (!p || !r) return '';
  return `<div class="bk" data-rental-dates><h3>Rental dates · out ${esc(shortDate(p.date))} to ${esc(shortDate(r.date))}</h3>
    ${form('rental-dates', rk, `<div class="two">
      ${field('rdp', 'Pickup day', `<input id="rdp" name="pickup" type="date" required value="${esc(p.date)}">`)}
      ${field('rdr', 'Return day', `<input id="rdr" name="return" type="date" required value="${esc(r.date)}">`)}</div>
      <p class="muted" style="margin:4px 0 8px">The games count as out every day from pickup through return. Prices do not change.</p>
      ${save('edit.saveRentalDates', 'Save rental dates')}`)}</div>`;
}

function bookingsSection(d, rk) {
  const rows = rentalDatesBlock(d, rk) + d.bookings.map((b) => {
    const ns = d.notes[b.id] || [];
    const isTd = TAKEDOWN_KINDS.includes(b.kind);
    return `<div class="bk" data-edit-booking="${b.id}"><h3>${esc(C.KIND_LABELS[b.kind] || b.kind)} · ${esc(shortDate(b.date))}${b.time ? ` · ${esc(C.prettyTime(b.time))}` : ''}</h3>
      ${form('booking', rk, `<input type="hidden" name="id" value="${b.id}"><div class="two">
        ${field(`bd${b.id}`, 'Day', `<input id="bd${b.id}" name="date" type="date" required value="${esc(b.date)}">`)}
        ${field(`bt${b.id}`, 'Time (leave empty if not sure yet)', `<input id="bt${b.id}" name="time" type="time" value="${esc(b.time || '')}">`)}</div>
        <label class="choice"><input type="checkbox" name="done" value="1"${b.done_at ? ' checked' : ''}> ${isTd ? 'Takedown done' : 'This booking is done'}</label>
        ${ns.map((n) => field(`bn${n.id}`, 'Note (only you see it)', `<textarea id="bn${n.id}" name="note_${n.id}">${esc(n.body)}</textarea>`)).join('')}
        ${field(`bnn${b.id}`, ns.length ? 'Add another note (optional)' : 'Note (optional, only you see it)', `<textarea id="bnn${b.id}" name="new_note"></textarea>`)}
        ${save('edit.saveBooking', 'Save this booking')}`)}
      ${V.confirmStep({ key: 'edit.removeBooking', yesKey: 'edit.removeBookingYes', label: 'Remove booking', danger: true, helper: false,
        question: `Remove the ${C.KIND_LABELS[b.kind] || 'booking'} on ${shortDate(b.date)}? It leaves the calendar and Google Calendar. Its notes stay with the request.`,
        action: '/admin/requests/edit/booking-remove', hidden: V.hiddenInputs({ r: rk, id: b.id }) })}
    </div>`;
  }).join('');
  return `<section class="card" id="bookings" data-edit-section="bookings"><h2>1. Bookings</h2>
    ${rows || `<p>Nothing is on the calendar for this request yet.</p><p><a class="btn ghost" href="/admin/calendar/new?r=${esc(rk)}"${tip('edit.schedule')}>Put it on the calendar</a></p>`}</section>`;
}

function datesSection(d, rk) {
  const decor = d.services.some((k) => k !== 'rentals');
  const rentals = d.services.includes('rentals');
  const tdB = d.bookings.find((b) => TAKEDOWN_KINDS.includes(b.kind));
  const jd = d.st.job_done_at ? C.chicagoDayOf(d.st.job_done_at) : '';
  const rd = d.ret && d.ret.returned_at ? C.chicagoDayOf(d.ret.returned_at) : '';
  const tdd = tdB && tdB.done_at ? C.chicagoDayOf(tdB.done_at) : '';
  const parts = [];
  if (decor || !rentals) parts.push(field('jd', 'Job done date (empty = not done yet)', `<input id="jd" name="job_done" type="date" value="${esc(jd)}">`));
  if (rentals) {
    if (d.ret && d.ret.returned_at) parts.push(field('rd', 'Returned date (empty = not returned yet)', `<input id="rd" name="returned" type="date" value="${esc(rd)}">`));
    else parts.push(`<p data-not-returned>Not returned yet. <a href="/admin/returns?k=${esc(rk)}"${tip('ret.mark')}>Mark returned</a></p>`);
  }
  if (tdB) parts.push(`<input type="hidden" name="td_id" value="${tdB.id}">${field('tdd', 'Takedown done date (empty = not done yet)', `<input id="tdd" name="takedown_done" type="date" value="${esc(tdd)}">`)}`);
  return `<section class="card" id="dates" data-edit-section="dates"><h2>2. Done dates</h2>
    <p class="muted">Empty a date to take it back. Finished and the thank-you email follow these dates; a thank-you that already went out is never sent again.</p>
    ${form('dates', rk, `${parts.join('')}${save('edit.saveDates', 'Save done dates')}`)}</section>`;
}

function invoiceSection(d, rk) {
  const { inv, lines, balance } = d;
  if (!inv) return `<section class="card" id="invoice" data-edit-section="invoice"><h2>3. Invoice</h2><p>No invoice yet.</p><p><a class="btn ghost" href="/admin/invoices/new?r=${esc(rk)}"${tip('card.createInvoice')}>Create invoice</a></p></section>`;
  if (inv.status === 'void') return `<section class="card" id="invoice" data-edit-section="invoice"><h2>3. Invoice ${esc(inv.number)}</h2><div class="notice warn">This invoice is void. Choose a step under Status to bring it back, then change it here.</div></section>`;
  const paidNote = balance && balance.paid > 0 ? `<div class="notice warn" data-owe-note><strong>Changing this changes what they owe.</strong> Nothing is sent to the customer by itself.</div>` : '<p class="muted">Nothing is sent to the customer by itself.</p>';
  const blank = { description: '', qty: 1, unit_cents: 0, note: '', refundable: 0 };
  return `<section class="card" id="invoice" data-edit-section="invoice"><h2>3. Invoice ${esc(inv.number)}</h2>${paidNote}
    ${form('invoice', rk, `<input type="hidden" name="invoice_id" value="${inv.id}"><div data-lines>${lines.map(V.lineEditor).join('')}</div>
      <template id="line-tpl">${V.lineEditor(blank)}</template>
      <div style="margin-top:10px"><button type="button" class="btn ghost" id="add-line"${tip('ed.addLine')}>Add a line</button></div>
      ${save('edit.saveInvoice', 'Save invoice')}`, ' id="edit-inv"')}
    <div data-balance><div class="sumline"><span>Total</span><strong>${money(balance.total)}</strong></div><div class="sumline"><span>Paid</span><strong>${money(balance.paid)}</strong></div>
      <div class="sumline"><span>Due</span><strong data-owed="${balance.owed}" data-due-words>${esc(dueWords(balance) || 'Nothing due')}</strong></div>${balance.refundable ? `<div class="sumline"><span>Damage deposit (refundable, never owed)</span><span>${money(balance.refundable)}</span></div>` : ''}</div>
    <script>${LINES_JS}</script></section>`;
}

const methodSelect = (id, value = '') => `<select id="${id}" name="method">${Object.entries(METHOD_WORDS).filter(([k]) => k).map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
function paymentsSection(d, rk) {
  const { inv, payments } = d;
  if (!inv) return `<section class="card" id="payments" data-edit-section="payments"><h2>4. Payments</h2><p>No invoice yet, so no payments are recorded. Use the Status below to mark a job with no invoice paid.</p></section>`;
  const rows = payments.map((p) => (p.voided_at
    ? `<div class="bk removed" data-payment-removed="${p.id}"><strong>${esc(KIND_PAY[p.kind] || 'Payment')} ${money(p.amount_cents)}</strong> on ${esc(shortDate(p.received_on))} (${esc(METHOD_WORDS[p.method] || p.method || 'not given')}) · removed, kept in the history</div>`
    : `<div class="bk" data-edit-payment="${p.id}"><h3>${esc(KIND_PAY[p.kind] || 'Payment')} · ${money(p.amount_cents)}</h3>
      ${form('payment', rk, `<input type="hidden" name="id" value="${p.id}"><div class="two">
        ${field(`pa${p.id}`, 'Amount ($)', `<input id="pa${p.id}" name="amount" type="number" step="0.01" min="0" inputmode="decimal" value="${(p.amount_cents / 100).toFixed(2)}">`)}
        ${field(`pd${p.id}`, 'Day it came in', `<input id="pd${p.id}" name="date" type="date" value="${esc(p.received_on)}">`)}</div>
        ${field(`pm${p.id}`, 'How did they pay?', methodSelect(`pm${p.id}`, p.method))}
        ${save('edit.savePayment', 'Save this payment')}`)}
      ${V.confirmStep({ key: 'edit.removePayment', yesKey: 'edit.removePaymentYes', label: 'Remove this payment', danger: true, helper: false,
        question: `Remove the ${money(p.amount_cents)} payment from ${shortDate(p.received_on)}? Only do this if it was recorded by mistake. It stays in the history, marked removed.`,
        action: '/admin/requests/edit/payment-remove', hidden: V.hiddenInputs({ r: rk, id: p.id }) })}</div>`)).join('');
  return `<section class="card" id="payments" data-edit-section="payments"><h2>4. Payments</h2>
    ${rows || '<p>No payments recorded yet.</p>'}
    <div class="bk"><h3>Add a payment</h3>${form('payment-add', rk, `<div class="two">
      ${field('pan', 'Amount ($)', '<input id="pan" name="amount" type="number" step="0.01" min="0" inputmode="decimal" required>')}
      ${field('pdn', 'Day it came in', `<input id="pdn" name="date" type="date" value="${esc(d.today)}">`)}</div>
      ${field('pmn', 'How did they pay?', methodSelect('pmn'))}
      ${save('edit.addPayment', 'Add this payment')}`)}</div></section>`;
}

export function currentStep(d) { return d.pr.void ? 'void' : d.pr.current; }
function statusSection(d, rk) {
  const now = currentStep(d);
  const decorTd = d.services.some((k) => k === 'porch' || k === 'party');
  return `<section class="card" id="status" data-edit-section="status"><h2>5. Status</h2>
    ${form('status', rk, `${field('step', 'Which step is it on?', `<select id="step" name="step">${[...STEP_KEYS, 'void'].map((k) => `<option value="${k}"${k === now ? ' selected' : ''}>${esc(STEP_WORDS[k])}</option>`).join('')}</select>`)}
      <p class="muted">An earlier step takes back the later ones (Job done is cleared; payments recorded by mistake are removed and kept in the history). Paid in full records what is left as a payment. Bookings stay; change them under Bookings.</p>
      ${field('pm-status', 'If this records a payment: how did they pay?', methodSelect('pm-status', 'other'))}
      ${decorTd ? `${field('tdp', 'Takedown afterwards?', `<select id="tdp" name="takedown_plan">${['', ...TAKEDOWN_PLANS].map((k) => `<option value="${k}"${k === (d.r.takedownPlan || '') ? ' selected' : ''}>${esc(PLAN_WORDS[k][0].toUpperCase() + PLAN_WORDS[k].slice(1))}</option>`).join('')}</select>`)}
      ${field('tdd2', 'Takedown date (the day they asked for)', `<input id="tdd2" name="takedown_date" type="date" value="${esc(d.r.takedownDate || '')}">`)}
      ${field('tdn', 'Takedown note (optional)', `<textarea id="tdn" name="takedown_note">${esc(d.r.takedownNote || '')}</textarea>`)}` : ''}
      ${save('edit.saveStatus', 'Save status')}`)}</section>`;
}

export function customerValues(r) {
  const a = detailAnswer(r, ADDRESS_RE); const n = detailAnswer(r, NOTES_RE);
  const dl = deliveryOf(r);
  return { name: r.name || '', phone: r.phone || '', email: r.email || '', address: a ? String(a.item.value || '') : '', notes: n ? String(n.item.value || '') : '', delivery_name: dl.name, delivery_address: dl.address };
}
function customerSection(d, rk) {
  const v = customerValues(d.r);
  return `<section class="card" id="customer" data-edit-section="customer"><h2>6. Customer details</h2>
    ${form('customer', rk, `${field('cn', 'Name', `<input id="cn" name="name" value="${esc(v.name)}" autocomplete="off">`)}
      <div class="two">${field('cp', 'Phone', `<input id="cp" name="phone" type="tel" value="${esc(v.phone)}" autocomplete="off">`)}
      ${field('ce', 'Email', `<input id="ce" name="email" type="email" value="${esc(v.email)}" autocomplete="off">`)}</div>
      ${field('ca', 'Address or where it is', `<input id="ca" name="address" value="${esc(v.address)}" autocomplete="off">`)}
      ${field('cno', 'Their notes', `<textarea id="cno" name="notes">${esc(v.notes)}</textarea>`)}
      ${d.services.includes('rentals') ? `<fieldset class="delivery" data-edit-delivery><legend>Business delivery (you set this; the website form does not offer it)</legend>
      <div class="two">${field('cdn', 'Business name', `<input id="cdn" name="delivery_name" value="${esc(v.delivery_name)}" autocomplete="off">`)}
      ${field('cda', 'Delivery address (empty = they pick up)', `<input id="cda" name="delivery_address" value="${esc(v.delivery_address)}" autocomplete="off">`)}</div>
      <p class="muted">With an address, the calendar, Day sheet and card say Delivery and Collect at that address. Add "+ Delivery fee" on the invoice for the charge.</p></fieldset>` : ''}
      <p class="muted">Their bookings and any invoice not yet void change to match. Nothing is sent to them.</p>
      ${save('edit.saveCustomer', 'Save customer details')}`)}</section>`;
}

export function editPageHtml(d, { flash = '', error = '', warn = '' } = {}) {
  const rk = b64urlText(d.r.key);
  const ev = d.events.slice(-30).reverse().map((e) => `<li>${esc(e.what)}</li>`).join('');
  const body = `<style>${EDIT_CSS}</style><div class="editpage" data-edit-page="${esc(rk)}">
    ${flash ? `<div class="notice ok" data-flash>${esc(flash)}</div>` : ''}${error ? `<div class="notice err" data-error>${esc(error)}</div>` : ''}${warn ? `<div class="notice warn" data-clash>${esc(warn)}</div>` : ''}
    <h1>Change anything on this request</h1>
    <p style="font-size:1.15rem"><strong>${esc(d.r.name || 'No name given')}</strong> · now: ${esc(STEP_WORDS[currentStep(d)])}${d.pr.finished ? ' · Finished' : ''}${d.st.archived_at ? ' · Put away' : ''}</p>
    ${bookingsSection(d, rk)}${datesSection(d, rk)}${invoiceSection(d, rk)}${paymentsSection(d, rk)}${statusSection(d, rk)}${customerSection(d, rk)}
    ${ev ? `<section class="card" data-edit-history><h2>History</h2><ul>${ev}</ul></section>` : ''}</div>`;
  return V.layout('Change anything on this request', body, { screen: 'edit', back: { href: d.st.archived_at ? '/admin/?pa=1#put-away' : `/admin/#c-${rk}`, label: 'Back to requests' } });
}

export async function editPage(env, url) {
  const key = decodeKey(url.searchParams.get('r'));
  const d = key ? await loadEdit(env, key) : null;
  if (!d) return htmlResponse(V.layout('Not found', '<p>That request was not found.</p>', { screen: 'notfound', back: { href: '/admin/', label: 'Back to requests' } }), 404);
  return htmlResponse(editPageHtml(d, { flash: url.searchParams.get('m') || '', error: url.searchParams.get('e') || '', warn: url.searchParams.get('w') || '' }));
}

// ---- Saves -----------------------------------------------------------------------------

const back = (rk, section, m, e = false, w = '') => redirect(`/admin/requests/edit?r=${encodeURIComponent(rk)}&${e ? 'e' : 'm'}=${encodeURIComponent(m)}${w ? `&w=${encodeURIComponent(w)}` : ''}#${section}`);

export async function editRoute(env, request, what) {
  const f = await request.formData();
  const rk = String(f.get('r') || '');
  const key = decodeKey(rk);
  const d = key ? await loadEdit(env, key) : null;
  if (!d) return redirect('/admin/?e=That request was not found.');
  const db = env.DB;
  const H = { 'rental-dates': saveRentalDates, booking: saveBooking, 'booking-remove': removeBooking, dates: saveDates, invoice: saveInvoice, payment: savePayment, 'payment-remove': removePayment, 'payment-add': addPayment, status: saveStatus, customer: saveCustomer }[what];
  if (!H) return back(rk, 'bookings', 'Nothing to save there.', true);
  return H({ db, f, d, key, rk });
}

async function saveRentalDates({ db, f, d, key, rk }) {
  const p = d.bookings.find((b) => b.kind === 'rental_pickup');
  const r = d.bookings.find((b) => b.kind === 'rental_return');
  if (!p || !r) return back(rk, 'bookings', 'This request has no rental pickup and return to change.', true);
  const pickup = dateIn(f.get('pickup')); const ret = dateIn(f.get('return'));
  if (!pickup || !ret) return back(rk, 'bookings', 'Pick both days: the pickup day and the return day.', true);
  if (ret < pickup) return back(rk, 'bookings', 'The return day is before the pickup day. Please check the two days.', true);
  const out = [];
  if (pickup !== p.date) { await C.editBookingWhen(db, p.id, { date: pickup, time: p.time || null }); out.push(changed('Rental pickup day', shortDate(p.date), shortDate(pickup))); }
  if (ret !== r.date) { await C.editBookingWhen(db, r.id, { date: ret, time: r.time || null }); out.push(changed('Rental return day', shortDate(r.date), shortDate(ret))); }
  for (const line of out) await log(db, key, line);
  if (!out.length) return back(rk, 'bookings', 'Nothing changed.');
  const warn = await rentalClashWords(db, key, { start: pickup, end: ret, items: p.items || r.items });
  return back(rk, 'bookings', 'Rental dates saved ✓ The calendar shows the new days.', false, warn);
}

async function saveBooking({ db, f, d, key, rk }) {
  const b = d.bookings.find((x) => x.id === Number(f.get('id')));
  if (!b) return back(rk, 'bookings', 'That booking is gone.', true);
  const date = dateIn(f.get('date'));
  if (!date) return back(rk, 'bookings', 'Pick a day for the booking.', true);
  const time = timeIn(f.get('time'));
  const label = C.KIND_LABELS[b.kind] || b.kind;
  const out = [];
  if (date !== b.date || (time || '') !== (b.time || '')) {
    await C.editBookingWhen(db, b.id, { date, time });
    if (date !== b.date) out.push(changed(`${label} day`, shortDate(b.date), shortDate(date)));
    if ((time || '') !== (b.time || '')) out.push(changed(`${label} time`, b.time ? C.prettyTime(b.time) : '', time ? C.prettyTime(time) : ''));
  }
  const done = f.get('done') === '1';
  if (done !== Boolean(b.done_at)) {
    await db.prepare(`UPDATE bookings SET done_at = ${done ? "datetime('now')" : 'NULL'}, updated_at = datetime('now') WHERE id = ?1`).bind(b.id).run();
    out.push(changed(`${label} done`, b.done_at ? 'done' : 'not done', done ? 'done' : 'not done'));
  }
  for (const n of d.notes[b.id] || []) {
    const body = f.get(`note_${n.id}`);
    if (body === null) continue;
    const next = String(body).trim().slice(0, 4000);
    if (next === n.body) continue;
    if (next) await C.editNote(db, n.id, next); else await C.deleteNote(db, n.id);
    out.push(changed(`${label} note`, n.body, next));
  }
  const add = String(f.get('new_note') || '').trim();
  if (add) { await C.addNote(db, b, add); out.push(changed(`${label} note added`, '', add)); }
  for (const line of out) await log(db, key, line);
  // A rental day moved by itself: the same plain clash warning over the new span.
  let warn = '';
  if (C.RENTAL_KINDS.includes(b.kind) && date !== b.date) {
    const p = b.kind === 'rental_pickup' ? date : (d.bookings.find((x) => x.kind === 'rental_pickup') || {}).date;
    const r = b.kind === 'rental_return' ? date : (d.bookings.find((x) => x.kind === 'rental_return') || {}).date;
    if (p && r) warn = await rentalClashWords(db, key, { start: p, end: r, items: b.items });
  }
  return back(rk, 'bookings', out.length ? 'Booking saved ✓' : 'Nothing changed.', false, warn);
}

async function removeBooking({ db, f, d, key, rk }) {
  const b = d.bookings.find((x) => x.id === Number(f.get('id')));
  if (!b) return back(rk, 'bookings', 'That booking is gone.', true);
  await C.deleteBooking(db, b.id);
  await log(db, key, `Booking removed: ${C.KIND_LABELS[b.kind] || b.kind} on ${shortDate(b.date)}${b.time ? ` at ${C.prettyTime(b.time)}` : ''} → (none)`);
  return back(rk, 'bookings', 'Booking removed. It is off the calendar.');
}

async function saveDates({ db, f, d, key, rk }) {
  const today = d.today;
  const out = [];
  const future = ['job_done', 'returned', 'takedown_done'].some((k) => dateIn(f.get(k)) > today);
  if (future) return back(rk, 'dates', 'A done date cannot be after today.', true);
  if (f.has('job_done')) {
    const was = d.st.job_done_at ? C.chicagoDayOf(d.st.job_done_at) : '';
    const now = dateIn(f.get('job_done'));
    if (was !== now) {
      if (!now) await db.prepare("UPDATE request_status SET job_done_at = NULL, status = CASE WHEN status = 'job_done' THEN COALESCE(prev_status, 'new') ELSE status END, prev_status = CASE WHEN status = 'job_done' THEN NULL ELSE prev_status END, updated_at = datetime('now') WHERE request_key = ?1").bind(key).run();
      else if (!was) await db.prepare(`INSERT INTO request_status (request_key, status, job_done_at, prev_status, updated_at) VALUES (?1, 'job_done', ?2, 'new', datetime('now'))
        ON CONFLICT(request_key) DO UPDATE SET prev_status = CASE WHEN request_status.status IN ('job_done','paid','void') THEN request_status.prev_status ELSE request_status.status END,
          status = CASE WHEN request_status.status IN ('paid','void') THEN request_status.status ELSE 'job_done' END, job_done_at = ?2, updated_at = datetime('now')`).bind(key, asUtcNoon(now)).run();
      else await db.prepare("UPDATE request_status SET job_done_at = ?2, updated_at = datetime('now') WHERE request_key = ?1").bind(key, asUtcNoon(now)).run();
      out.push(changed('Job done date', day(was), day(now)));
    }
  }
  if (f.has('returned') && d.ret && d.ret.returned_at) {
    const was = C.chicagoDayOf(d.ret.returned_at);
    const now = dateIn(f.get('returned'));
    if (was !== now) {
      if (!now) await C.undoReturn(db, key);
      else await db.prepare("UPDATE rental_returns SET returned_at = ?2, updated_at = datetime('now') WHERE return_key = ?1").bind(key, asUtcNoon(now)).run();
      out.push(changed('Returned date', day(was), day(now)));
    }
  }
  const tdB = d.bookings.find((b) => b.id === Number(f.get('td_id')) && TAKEDOWN_KINDS.includes(b.kind));
  if (tdB && f.has('takedown_done')) {
    const was = tdB.done_at ? C.chicagoDayOf(tdB.done_at) : '';
    const now = dateIn(f.get('takedown_done'));
    if (was !== now) {
      await db.prepare("UPDATE bookings SET done_at = ?2, updated_at = datetime('now') WHERE id = ?1").bind(tdB.id, now ? asUtcNoon(now) : null).run();
      out.push(changed('Takedown done date', day(was), day(now)));
    }
  }
  for (const line of out) await log(db, key, line);
  return back(rk, 'dates', out.length ? 'Done dates saved ✓' : 'Nothing changed.');
}

const lineWords = (l) => `${l.description}${Number(l.qty) !== 1 ? ` ×${l.qty}` : ''} ${money(Math.round(Number(l.qty) * l.unit_cents))}${l.refundable ? ' (refundable)' : ''}`;
async function saveInvoice({ db, f, d, key, rk }) {
  const inv = d.inv;
  if (!inv || inv.id !== Number(f.get('invoice_id'))) return back(rk, 'invoice', 'That invoice is not on this request.', true);
  if (inv.status === 'void') return back(rk, 'invoice', 'This invoice is void. Bring it back under Status first.', true);
  const lines = linesFromForm(f);
  if (!lines.length) return back(rk, 'invoice', 'An invoice needs at least one line. To cancel it, choose Void under Status.', true);
  const before = d.lines.map(lineWords); const after = lines.map(lineWords);
  if (before.join('|') === after.join('|') && d.lines.every((l, i) => (l.note || '') === lines[i].note)) return back(rk, 'invoice', 'Nothing changed.');
  await saveLines(db, inv.id, lines);
  const total = invoiceTotal(lines);
  const plan = payPlanOf(inv, invoiceTotal(d.lines));
  await db.prepare("UPDATE invoices SET deposit_due_cents = ?2, updated_at = datetime('now') WHERE id = ?1").bind(inv.id, amountDueNow(plan, total, inv.deposit_due_cents)).run();
  await syncMoneyStatus(db, inv.id);
  await log(db, key, `Invoice ${inv.number} changed: total ${money(invoiceTotal(d.lines))} → ${money(total)}; lines ${before.join(', ') || '(none)'} → ${after.join(', ')}. Not re-sent`);
  return back(rk, 'invoice', 'Invoice saved ✓ Nothing was sent to the customer.');
}

async function savePayment({ db, f, d, key, rk }) {
  const p = d.payments.find((x) => x.id === Number(f.get('id')) && !x.voided_at);
  if (!p) return back(rk, 'payments', 'That payment is gone.', true);
  const amount = toCents(f.get('amount'));
  const date = dateIn(f.get('date')) || p.received_on;
  const method = Object.keys(METHOD_WORDS).includes(String(f.get('method') || '')) ? String(f.get('method')) : p.method;
  const out = [];
  if (amount !== p.amount_cents) out.push(changed('Payment amount', money(p.amount_cents), money(amount)));
  if (date !== p.received_on) out.push(changed('Payment day', shortDate(p.received_on), shortDate(date)));
  if (method !== p.method) out.push(changed('Payment method', METHOD_WORDS[p.method] || p.method, METHOD_WORDS[method] || method));
  if (!out.length) return back(rk, 'payments', 'Nothing changed.');
  await db.prepare('UPDATE payments SET amount_cents = ?2, received_on = ?3, method = ?4 WHERE id = ?1').bind(p.id, amount, date, method).run();
  await syncMoneyStatus(db, p.invoice_id);
  for (const line of out) await log(db, key, `${line} (invoice ${d.inv.number})`);
  return back(rk, 'payments', 'Payment saved ✓');
}

async function removePayment({ db, f, d, key, rk }) {
  const p = d.payments.find((x) => x.id === Number(f.get('id')) && !x.voided_at);
  if (!p) return back(rk, 'payments', 'That payment is gone.', true);
  await db.prepare("UPDATE payments SET voided_at = datetime('now') WHERE id = ?1 AND voided_at IS NULL").bind(p.id).run();
  await syncMoneyStatus(db, p.invoice_id);
  await log(db, key, `Payment removed: ${money(p.amount_cents)} on ${shortDate(p.received_on)} (${METHOD_WORDS[p.method] || p.method || 'not given'}) → removed, kept in the history`);
  return back(rk, 'payments', 'Payment removed. It stays in the history.');
}

async function addPayment({ db, f, d, key, rk }) {
  if (!d.inv) return back(rk, 'payments', 'There is no invoice to record a payment on.', true);
  const amount = toCents(f.get('amount'));
  if (!(amount > 0)) return back(rk, 'payments', 'Type the amount that came in.', true);
  const date = dateIn(f.get('date')) || d.today;
  const method = Object.keys(METHOD_WORDS).includes(String(f.get('method') || '')) ? String(f.get('method')) : 'other';
  await db.prepare("INSERT INTO payments (invoice_id, amount_cents, received_on, method, note, kind) VALUES (?1, ?2, ?3, ?4, 'added by hand', 'payment')").bind(d.inv.id, amount, date, method).run();
  await syncMoneyStatus(db, d.inv.id);
  await log(db, key, `Payment added: (none) → ${money(amount)} on ${shortDate(date)} (${METHOD_WORDS[method]}) on invoice ${d.inv.number}`);
  return back(rk, 'payments', 'Payment added ✓');
}

// Status: any of the six steps or Void. The steps are derived from facts (progress.mjs), so a
// chosen step writes the facts that make it true, through the same paths the buttons use.
async function saveStatus({ db, f, d, key, rk }) {
  const out = [];
  const target = String(f.get('step') || '');
  const now = currentStep(d);
  const inv = d.inv;
  const method = Object.keys(METHOD_WORDS).includes(String(f.get('method') || '')) ? String(f.get('method')) : 'other';
  if ([...STEP_KEYS, 'void'].includes(target) && target !== now) {
    if (target === 'void') {
      if (inv && inv.status !== 'void') { await db.prepare("UPDATE invoices SET status = 'void', updated_at = datetime('now') WHERE id = ?1").bind(inv.id).run(); await C.removeInvoiceBookings(db, inv.id); }
      await setStatusRow(db, key, 'void', inv ? inv.id : null);
    } else {
      const idx = STEP_KEYS.indexOf(target);
      let invStatus = inv ? inv.status : '';
      if (inv && invStatus === 'void') invStatus = 'draft';
      if (inv) {
        // Money: an invoice is sent from step 2; the deposit is in from step 3; paid in full at 6.
        if (idx === 0) invStatus = 'draft';
        else if (invStatus === 'draft') invStatus = 'sent';
        await db.prepare(`UPDATE invoices SET status = ?2, sent_at = CASE WHEN ?2 = 'draft' THEN sent_at ELSE COALESCE(sent_at, datetime('now')) END, updated_at = datetime('now') WHERE id = ?1`).bind(inv.id, invStatus).run();
        const live = d.payments.filter((p) => !p.voided_at && p.kind === 'payment');
        if (idx < 2 && live.length) {
          await db.prepare("UPDATE payments SET voided_at = datetime('now') WHERE invoice_id = ?1 AND voided_at IS NULL AND kind = 'payment'").bind(inv.id).run();
          out.push(`Payments removed by the status change: ${live.map((p) => money(p.amount_cents)).join(', ')} → removed, kept in the history`);
        }
        const fresh = await db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(inv.id).first();
        if (idx === 2 && !live.length) { const c = await recordPayment(db, fresh, d.lines, 'deposit', method); if (c) out.push(`Deposit recorded: (none) → ${money(c)}`); }
        if (idx === 5) { const c = await recordPayment(db, fresh, d.lines, 'full', method); if (c) out.push(`Rest recorded as paid: (none) → ${money(c)}`); }
        if (invStatus !== 'draft') await syncMoneyStatus(db, inv.id);
      }
      // The chosen step wins on the request row (after the money sync above).
      await setStatusRow(db, key, target, inv ? inv.id : null);
      // The job: done from step 5 on, not done before it (the same undo paths as the buttons).
      if (idx >= 4) await db.prepare("UPDATE request_status SET job_done_at = COALESCE(job_done_at, datetime('now')) WHERE request_key = ?1").bind(key).run();
      else {
        if (d.ret && d.ret.returned_at) await C.undoReturn(db, key);
        await db.prepare(`UPDATE request_status SET job_done_at = NULL, status = ?2, updated_at = datetime('now') WHERE request_key = ?1`).bind(key, target).run();
      }
    }
    out.unshift(changed('Status', STEP_WORDS[now], STEP_WORDS[target]));
  }
  if (f.has('takedown_plan')) {
    const plan = ['', ...TAKEDOWN_PLANS].includes(String(f.get('takedown_plan'))) ? String(f.get('takedown_plan')) : (d.r.takedownPlan || '');
    const tdDate = dateIn(f.get('takedown_date'));
    const note = String(f.get('takedown_note') || '').trim().slice(0, 500);
    if (plan !== (d.r.takedownPlan || '')) out.push(changed('Takedown plan', PLAN_WORDS[d.r.takedownPlan || ''], PLAN_WORDS[plan]));
    if (tdDate !== (d.r.takedownDate || '')) out.push(changed('Takedown date', day(d.r.takedownDate), day(tdDate)));
    if (note !== (d.r.takedownNote || '')) out.push(changed('Takedown note', d.r.takedownNote, note));
    await db.prepare('UPDATE requests SET takedown_plan = ?2, takedown_date = ?3, takedown_note = ?4 WHERE request_key = ?1').bind(key, plan || null, tdDate, note).run();
  }
  for (const line of out) await log(db, key, line);
  // The steps follow the facts: a booking keeps it at Scheduled, and Scheduled needs a booking.
  const idx = STEP_KEYS.indexOf(target);
  const why = idx >= 0 && idx < 3 && d.bookings.length ? ' It still reads Scheduled because it is on the calendar: remove its bookings under Bookings to go back further.'
    : (target === 'scheduled' && !d.bookings.length ? ' Add a booking under Bookings to put it on the calendar.' : '');
  return back(rk, 'status', out.length ? `Status saved ✓${why}` : 'Nothing changed.');
}

async function saveCustomer({ db, f, d, key, rk }) {
  const was = customerValues(d.r);
  const next = {};
  for (const k of DETAIL_FIELDS) next[k] = String(f.get(k) ?? was[k]).trim().slice(0, k === 'notes' ? 4000 : 500);
  const out = DETAIL_FIELDS.filter((k) => next[k] !== was[k]).map((k) => changed({ name: 'Name', phone: 'Phone', email: 'Email', address: 'Address', notes: 'Their notes', delivery_name: 'Business delivery name', delivery_address: 'Business delivery address' }[k], was[k], next[k]));
  if (!out.length) return back(rk, 'customer', 'Nothing changed.');
  const edits = { ...(d.r.detailsEdits || {}) };
  for (const k of DETAIL_FIELDS) if (next[k] !== was[k]) edits[k] = next[k];
  // Business delivery is one fact: both halves are stored together (requests.mjs applyEdits).
  if (next.delivery_name !== was.delivery_name || next.delivery_address !== was.delivery_address) { edits.delivery_name = next.delivery_name; edits.delivery_address = next.delivery_address; }
  await db.prepare('UPDATE requests SET details_edits = ?2, name = ?3, phone = ?4, email = ?5, name_norm = ?6, phone_digits = ?7 WHERE request_key = ?1')
    .bind(key, JSON.stringify(edits), next.name, next.phone, next.email, C.normName(next.name), C.digitsOf(next.phone)).run();
  // Their bookings (calendar, Google Calendar, reminders, Bookings tab) and live invoices follow.
  await db.prepare(`UPDATE bookings SET customer_name = ?2, phone = ?3, email = ?4, name_norm = ?5, phone_digits = ?6,
      place = CASE WHEN place = ?7 OR place = '' THEN ?8 ELSE place END, updated_at = datetime('now') WHERE request_key = ?1`)
    .bind(key, next.name, next.phone, next.email, C.normName(next.name), C.digitsOf(next.phone), was.address, next.address).run();
  await db.prepare("UPDATE invoices SET customer_name = ?2, customer_phone = ?3, customer_email = ?4, name_norm = ?5, updated_at = datetime('now') WHERE request_key = ?1 AND status <> 'void'")
    .bind(key, next.name, next.phone, next.email, C.normName(next.name)).run();
  // The rental pickup / return go to the business address, or back to the safe exchange zone.
  if (next.delivery_address !== was.delivery_address) {
    await db.prepare(`UPDATE bookings SET place = ?3, updated_at = datetime('now') WHERE request_key = ?1 AND kind IN ('rental_pickup', 'rental_return') AND (place = ?2 OR place = '' OR place = ?4)`)
      .bind(key, was.delivery_address || TRACK_TABLE.pickupPlace, next.delivery_address || TRACK_TABLE.pickupPlace, TRACK_TABLE.pickupPlace).run();
  }
  for (const line of out) await log(db, key, line);
  return back(rk, 'customer', 'Customer details saved ✓ Nothing was sent to them.');
}
