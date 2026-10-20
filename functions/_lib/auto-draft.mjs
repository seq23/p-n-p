// The auto draft (owner-approved mock-up "Invoices: total and deposit broken out", 20 Oct 2026):
// the moment a request arrives (the website form, functions/_lib/request-submit.mjs, or a phone
// booking, admin-calendar.mjs createBookingRoute) a DRAFT invoice is made from it with the same
// prefill as "Create invoice" (pricing.mjs prefillLines). It is NEVER sent by itself: Valerie
// checks it and taps Send. Drafts are owed by nobody (ledger.mjs balances).
//   - one draft per request, never a second (any invoice already on the request = nothing made);
//   - a failure never blocks the request: the caller logs it and the card falls back to its
//     normal "Create invoice" button;
//   - new requests only: nothing is ever made for a request that came in before this shipped;
//   - "What they want" changed on the Edit page (admin-edit.mjs saveWant): an auto draft that was
//     never sent is rebuilt to match (rebuildAutoDraft), keeping every line Valerie typed or
//     changed by hand (invoice_lines.auto NULL). A sent or void invoice is never touched.
import { todayISO, invoiceTotal, amountDueNow, payPlanOf } from './util.mjs';
import { PRICE_TABLE } from './prices.mjs';
import { prefillLines } from './pricing.mjs';
import { rentalDates } from './phone-requests.mjs';
import { fromRow, logEvent } from './requests.mjs';
import { saveLines } from './ledger.mjs';
import { normName } from './calendar.mjs';

export async function nextInvoiceNumber(db, isoDate) {
  const year = isoDate.slice(0, 4);
  const row = await db.prepare('SELECT number FROM invoices WHERE number LIKE ?1 ORDER BY number DESC LIMIT 1').bind(`PNP-${year}-%`).first();
  const n = row ? Number(row.number.split('-')[2]) + 1 : 1;
  return `PNP-${year}-${String(n).padStart(4, '0')}`;
}

async function setRequestInvoice(db, key, invoiceId) {
  await db.prepare(`INSERT INTO request_status (request_key, status, invoice_id, updated_at) VALUES (?1, 'new', ?2, datetime('now'))
    ON CONFLICT(request_key) DO UPDATE SET invoice_id = COALESCE(request_status.invoice_id, excluded.invoice_id), updated_at = excluded.updated_at`)
    .bind(key, invoiceId).run();
}

// A draft invoice for a request: plan "custom" with depositCents asked for now (the website's rental
// quote), else "half". auto: 1 marks the auto draft (invoices.auto_draft, migration 0020).
export async function createDraftInvoice(env, { key, name, email, phone, lines, depositCents = null, dueDate, notes = '', auto = 0 }) {
  const issue = todayISO();
  const plan = depositCents !== null && depositCents !== undefined ? 'custom' : 'half';
  const deposit = amountDueNow(plan, invoiceTotal(lines), depositCents || 0);
  let number = await nextInvoiceNumber(env.DB, issue);
  let id = null;
  for (let attempt = 0; attempt < 3 && id === null; attempt += 1) {
    try {
      const row = await env.DB.prepare(`INSERT INTO invoices (number, request_key, customer_name, customer_email, customer_phone, issue_date, due_date, deposit_due_cents, notes, status, pay_plan, name_norm, auto_draft)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'draft', ?10, ?11, ?12) RETURNING id`).bind(number, key, name, email, phone, issue, dueDate || issue, deposit, notes, plan, normName(name), auto ? 1 : null).first();
      id = row.id;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
      number = await nextInvoiceNumber(env.DB, issue);
    }
  }
  await saveLines(env.DB, id, lines);
  await setRequestInvoice(env.DB, key, id);
  return id;
}

// The request as the prefill reads it, from D1, with a rental's booked pickup and return days.
async function requestFor(db, key) {
  const row = await db.prepare('SELECT * FROM requests WHERE request_key = ?1').bind(key).first();
  if (!row) return null;
  let r = fromRow(row);
  if (r && r.wantsRentals) {
    const { results: bk } = await db.prepare("SELECT kind, date FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return')").bind(key).all();
    const d = rentalDates(r, bk || []);
    r = { ...r, rentalPickup: d.pickup, rentalReturn: d.ret };
  }
  return r;
}

// Due in a week, or on the job's first day when that comes sooner (never in the past).
async function dueDateFor(db, key) {
  const week = todayISO(7); const today = todayISO();
  const first = await db.prepare("SELECT MIN(date) AS d FROM bookings WHERE request_key = ?1 AND kind NOT IN ('porch_takedown','party_takedown','grazing_pickup','rental_return')").bind(key).first();
  const d = first && first.d;
  return d && d >= today && d < week ? d : week;
}

export async function hasInvoice(db, key) {
  const row = await db.prepare("SELECT id FROM invoices WHERE request_key = ?1 LIMIT 1").bind(key).first();
  const st = await db.prepare('SELECT invoice_id FROM request_status WHERE request_key = ?1').bind(key).first();
  return Boolean(row || (st && st.invoice_id));
}

// Make the auto draft for a new request. extra: { lines, depositCents, dueDate } when the caller
// already priced part of it (the website's rental quote); the rest of the prefill (porch, party,
// grazing) is added after those lines. -> invoice id, or null when the request already has one.
export async function makeAutoDraft(env, key, { who = 'website form', quote = null } = {}) {
  const db = env.DB;
  if (await hasInvoice(db, key)) return null;
  const r = await requestFor(db, key);
  if (!r) return null;
  let lines; let depositCents = null; let dueDate = await dueDateFor(db, key);
  if (quote) {
    // The rental quote the customer saw on the form; decor services ticked with it follow.
    const decorOnly = prefillLines({ ...r, wantsRentals: false, gamesAnswer: '', services: (r.services || []).filter((k) => k !== 'rentals') }, PRICE_TABLE);
    lines = [...quote.lines.map((l) => ({ ...l, auto: l.refundable ? 'deposit' : 'rental' })), ...(r.wantsDecor ? decorOnly : [])];
    depositCents = quote.depositCents; dueDate = quote.dueDate || dueDate;
  } else lines = prefillLines(r, PRICE_TABLE);
  if (!lines.length) return null;
  const id = await createDraftInvoice(env, { key, name: r.name, email: r.email, phone: r.phone, lines, depositCents, dueDate, auto: 1 });
  // Bookings already made for it (a phone booking, an auto-booked takedown) carry the invoice.
  await db.prepare('UPDATE bookings SET invoice_id = ?1 WHERE request_key = ?2 AND invoice_id IS NULL').bind(id, key).run();
  await logEvent(db, key, 'Invoice draft made from the request (not sent)', who);
  return id;
}

// "What they want" changed: rebuild the unsent auto draft. -> { rebuilt, kept } or null.
export async function rebuildAutoDraft(env, key) {
  const db = env.DB;
  const inv = await db.prepare("SELECT * FROM invoices WHERE request_key = ?1 AND auto_draft = 1 AND status = 'draft' AND sent_at IS NULL ORDER BY id DESC LIMIT 1").bind(key).first();
  if (!inv) return null;
  const r = await requestFor(db, key);
  if (!r) return null;
  const { results: old } = await db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id').bind(inv.id).all();
  const kept = (old || []).filter((l) => !l.auto);
  const fresh = prefillLines(r, PRICE_TABLE);
  // A line she changed by hand that the new prefill would write again is not written twice.
  const keptNames = new Set(kept.map((l) => String(l.description).toLowerCase()));
  const lines = [...fresh.filter((l) => !keptNames.has(String(l.description).toLowerCase())), ...kept];
  await saveLines(db, inv.id, lines);
  const plan = payPlanOf(inv, invoiceTotal(old || []));
  await db.prepare("UPDATE invoices SET deposit_due_cents = ?2, updated_at = datetime('now') WHERE id = ?1 AND status = 'draft' AND sent_at IS NULL")
    .bind(inv.id, amountDueNow(plan, invoiceTotal(lines), inv.deposit_due_cents || 0)).run();
  await logEvent(db, key, `Invoice draft rebuilt to match what they want${kept.length ? ` (${kept.length} ${kept.length === 1 ? 'line' : 'lines'} changed by hand kept)` : ''}`, 'Valerie');
  return { rebuilt: true, kept: kept.length, id: inv.id };
}
