// Money per invoice from recorded payments (table `payments`, migration 0004), never from a
// status chip. balanceOf is THE one source of truth for "paid / still owed / the rest" on every
// surface (invoice page, card, rental note, email, PDF, Money, calendar, 7 AM email and the
// "How <name> pays" box in pay-steps.mjs): nothing else works these numbers out.
//
// How money received is split (one rule, splitPayment, used here and by Money in money.mjs):
// a payment takes the refundable damage deposit FIRST, then the charges. That is what the
// website tells customers (due now = damage deposit + 50%) and what the owner's 19 Oct 2026
// rental note rule says ("the amount due now takes the refundable damage deposit first"). So
// the deposit is only ever still to pay while less than it has come in, and a customer who has
// paid less than the total always has charges owed: never "Paid in full" (20 Oct 2026 fix; the
// old charges-first split read "Paid in full" with the damage deposit still to pay).
import { invoiceTotal, lineTotal, money, toCents, lineSig, AUTO_KINDS } from './util.mjs';
import { chicagoDate } from './reminders.mjs';

export function splitTotals(lines) {
  const refundable = (lines || []).filter((l) => l.refundable).reduce((s, l) => s + lineTotal(l), 0);
  return { total: invoiceTotal(lines || []), refundable, charges: invoiceTotal(lines || []) - refundable };
}

// One payment of amountCents after paidBefore cents already came in: { deposit, charge }.
// Deposit first, then charges; anything past the total counts as deposit (given back).
export function splitPayment(paidBefore, amountCents, { charges = 0, refundable = 0 } = {}) {
  const before = Math.max(0, paidBefore || 0);
  const amount = Math.max(0, amountCents || 0);
  const deposit0 = Math.min(amount, Math.max(0, refundable - before));
  const chargesBefore = Math.max(0, before - refundable);
  const charge = Math.min(amount - deposit0, Math.max(0, charges - chargesBefore));
  return { deposit: amount - charge, charge };
}

// paidCents: sum of non-voided payments.
//   owed         charges still to pay (never the damage deposit)
//   depositOwed  the refundable damage deposit not collected yet
//   remaining    everything still to pay (owed + depositOwed): THE "still owed" number
//   paidInFull   the whole total is in; the only thing that may ever say "Paid in full"
export function balanceOf(invoice, lines, paidCents) {
  const { total, refundable, charges } = splitTotals(lines);
  const paid = Math.max(0, paidCents || 0);
  const isVoid = Boolean(invoice && invoice.status === 'void');
  const { deposit, charge } = splitPayment(0, paid, { charges, refundable });
  const remaining = isVoid ? 0 : Math.max(0, total - paid);
  return {
    void: isVoid, total, charges, refundable, paid,
    paidCharges: charge, paidDeposit: Math.min(deposit, refundable),
    owed: isVoid ? 0 : Math.max(0, charges - charge),
    depositOwed: isVoid ? 0 : Math.max(0, refundable - deposit),
    remaining,
    paidInFull: !isVoid && total > 0 && remaining === 0,
  };
}

// The ONE way an amount due is said (owner, 20 Oct 2026): with a refundable damage deposit not
// collected yet, "$180 due ($130 + $50 refundable deposit)"; without one, "$130 due". Words only:
// balance.owed (charges) and balance.depositOwed are the same numbers as always, the deposit is
// still never "owed". '' when nothing is due (or the invoice is void).
export const dollars = (c) => money(c).replace(/\.00$/, '');
export function dueWords(bal, fmt = dollars) {
  if (!bal || bal.void || bal.draft) return '';
  const owed = Math.max(0, bal.owed || 0);
  const dep = bal.refundable > 0 ? Math.max(0, bal.depositOwed || 0) : 0;
  if (dep > 0) return owed > 0 ? `${fmt(owed + dep)} due (${fmt(owed)} + ${fmt(dep)} refundable deposit)` : `${fmt(dep)} due (refundable deposit)`;
  return owed > 0 ? `${fmt(owed)} due` : '';
}
export const dueCents = (bal) => (!bal || bal.void || bal.draft ? 0 : Math.max(0, bal.owed || 0) + (bal.refundable > 0 ? Math.max(0, bal.depositOwed || 0) : 0));

// Still to pay on a sent invoice, in cents (0 for a draft or void). Every "owes / Collect /
// Paid in full" decision reads this, never balance.owed alone.
export const owes = (bal) => dueCents(bal) > 0;

export function balanceWords(bal) {
  if (!bal || bal.void) return '';
  if (bal.draft) return 'Invoice not sent yet';
  if (owes(bal)) return dueWords(bal);
  return bal.paidInFull ? 'Paid in full ✓' : '';
}

export function depositWords(bal) {
  if (!bal || bal.void || !bal.refundable) return '';
  return `Damage deposit ${money(bal.refundable)}, refundable${bal.depositOwed > 0 ? ' (not collected yet)' : ' (collected)'}`;
}

export async function paidByInvoice(db, ids = null) {
  const { results } = await db.prepare("SELECT invoice_id, SUM(amount_cents) AS paid FROM payments WHERE voided_at IS NULL AND kind = 'payment' GROUP BY invoice_id").all();
  const out = {};
  for (const r of results || []) if (!ids || ids.includes(r.invoice_id)) out[r.invoice_id] = r.paid || 0;
  return out;
}

export async function linesByInvoice(db) {
  const { results } = await db.prepare('SELECT * FROM invoice_lines ORDER BY invoice_id, position, id').all();
  const out = {};
  for (const l of results || []) (out[l.invoice_id] = out[l.invoice_id] || []).push(l);
  return out;
}

// Balance for every invoice, keyed by id. A draft (never sent) is owed by nobody (owner-approved
// 20 Oct 2026: "Drafts don't count toward owed anywhere until they're sent"): owed reads 0 and
// draft: true, and dueWords / dueCents say nothing for it (remaining and depositOwed stay as they
// are, so nothing reads a draft as "paid in full" or its damage deposit as collected), so the Money tab, Not paid yet, the calendar's "Collect",
// the card, the missed jobs and the 7 AM email never count an unsent auto draft. The invoice's
// own page and editor still show its full numbers (payStepsOf in pay-steps.mjs).
export async function balances(db) {
  const [{ results: invoices }, lines, paid] = await Promise.all([db.prepare('SELECT * FROM invoices').all(), linesByInvoice(db), paidByInvoice(db)]);
  const out = {};
  for (const inv of invoices || []) {
    const b = balanceOf(inv, lines[inv.id] || [], paid[inv.id] || 0);
    out[inv.id] = { invoice: inv, ...b, ...(inv.status === 'draft' ? { draft: true, owed: 0 } : {}) };
  }
  return out;
}

// Every recorded payment per invoice, oldest first: [{ cents, on }] (the "✓ paid Tue 20 Oct" dates).
export async function paymentsByInvoice(db) {
  const { results } = await db.prepare("SELECT invoice_id, amount_cents, received_on FROM payments WHERE voided_at IS NULL AND kind = 'payment' ORDER BY received_on, id").all();
  const out = {};
  for (const r of results || []) (out[r.invoice_id] = out[r.invoice_id] || []).push({ cents: r.amount_cents || 0, on: r.received_on || '' });
  return out;
}

// "Mark deposit received" records the deposit asked for (never more than what is left);
// "Mark paid in full" records whatever is left. Returns the amount recorded.
export async function recordPayment(db, invoice, lines, kind, method = '') {
  const paid = (await paidByInvoice(db, [invoice.id]))[invoice.id] || 0;
  const { total } = splitTotals(lines);
  const left = Math.max(0, total - paid);
  const amount = kind === 'deposit' ? Math.min(left, Math.max(0, invoice.deposit_due_cents || 0)) : left;
  if (amount > 0) {
    await db.prepare("INSERT INTO payments (invoice_id, amount_cents, received_on, method, note, kind) VALUES (?1, ?2, ?3, ?4, ?5, 'payment')")
      .bind(invoice.id, amount, chicagoDate(), method, kind === 'deposit' ? 'deposit' : 'paid in full').run();
  }
  return amount;
}

// "That was a mistake: mark as not paid": the rows stay, voided.
export async function voidPayments(db, invoiceId) {
  await db.prepare("UPDATE payments SET voided_at = datetime('now') WHERE invoice_id = ?1 AND voided_at IS NULL AND kind = 'payment'").bind(invoiceId).run();
}

// Damage deposit after the event: refund some or all of it, or keep some for damage. Both are
// their own rows (kind 'refund' / 'deposit_kept'); neither changes what the customer owes.
export async function depositHeld(db, invoiceId) {
  const row = await db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount_cents END), 0) AS refunded,
      COALESCE(SUM(CASE WHEN kind = 'deposit_kept' THEN amount_cents END), 0) AS kept
    FROM payments WHERE invoice_id = ?1 AND voided_at IS NULL`).bind(invoiceId).first();
  return { refunded: row ? row.refunded : 0, kept: row ? row.kept : 0 };
}

export async function recordDepositOutcome(db, invoice, lines, kind, amountCents, method = '', tag = '') {
  const paid = (await paidByInvoice(db, [invoice.id]))[invoice.id] || 0;
  const bal = balanceOf(invoice, lines, paid);
  const collected = bal.refundable - bal.depositOwed;
  const { refunded, kept } = await depositHeld(db, invoice.id);
  const held = Math.max(0, collected - refunded - kept);
  const amount = Math.max(0, Math.min(held, Math.round(amountCents) || 0));
  if (amount > 0) {
    await db.prepare('INSERT INTO payments (invoice_id, amount_cents, received_on, method, note, kind) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(invoice.id, amount, chicagoDate(), method, `${kind === 'refund' ? 'damage deposit refunded' : 'damage deposit kept for damage'}${tag}`, kind).run();
  }
  return { amount, held: held - amount };
}

// ---- Three endings (owner, 20 Oct 2026; admin-endings.mjs) ------------------------------------
// The refundable damage deposit still held: collected (balanceOf paidDeposit) less what was
// already refunded or kept (depositOutcomes / depositHeld). The ONE number "✓ Mark as done" asks
// about. out: { refunded, kept }.
export const depositHeldCents = (bal, out = null) => (!bal || bal.void ? 0 : Math.max(0, (bal.paidDeposit || 0) - ((out && out.refunded) || 0) - ((out && out.kept) || 0)));
// Money still held on a job being cancelled: every payment in, less refunds and kept money.
export const cancelHeldCents = (bal, out = null) => (!bal ? 0 : Math.max(0, (bal.paid || 0) - ((out && out.refunded) || 0) - ((out && out.kept) || 0)));
// The rows an ending records carry this tag at the end of their note, so its undo ("Not done
// after all", "Not cancelled after all") takes exactly those rows off again (voided, never deleted).
export const DONE_TAG = ' (on Done)';
export const CANCEL_TAG = ' (on Cancel)';
// Cancel with money in: record what happened to it. how: 'refund' (all back), 'keep' (all kept),
// 'part' (refunded partCents, the rest kept). -> { refunded, kept } in cents.
export async function recordCancelMoney(db, invoiceId, how, partCents = 0) {
  const paid = (await paidByInvoice(db, [invoiceId]))[invoiceId] || 0;
  const { refunded, kept } = await depositHeld(db, invoiceId);
  const held = Math.max(0, paid - refunded - kept);
  const back = how === 'refund' ? held : (how === 'part' ? Math.max(0, Math.min(held, Math.round(partCents) || 0)) : 0);
  const keep = how === 'keep' ? held : (how === 'part' ? held - back : 0);
  const ins = (amount, kind, note) => db.prepare('INSERT INTO payments (invoice_id, amount_cents, received_on, method, note, kind) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(invoiceId, amount, chicagoDate(), '', `${note}${CANCEL_TAG}`, kind).run();
  if (back > 0) await ins(back, 'refund', 'job cancelled: money refunded');
  if (keep > 0) await ins(keep, 'deposit_kept', 'job cancelled: money kept');
  return { refunded: back, kept: keep };
}
export async function voidTagged(db, invoiceId, tag) {
  await db.prepare("UPDATE payments SET voided_at = datetime('now') WHERE invoice_id = ?1 AND voided_at IS NULL AND kind IN ('refund','deposit_kept') AND note LIKE ?2")
    .bind(invoiceId, `%${tag}`).run();
}

// The invoice lines as the editor posts them (line_desc / line_qty / line_price / line_note /
// line_refundable, one of each per line). Used by the invoice editor and by "Change anything".
// line_auto ("<kind>:<sig>", util.mjs autoTag) keeps a starting line's kind only while the line is
// exactly as the auto draft wrote it; anything changed by hand saves with auto NULL.
export function linesFromForm(form) {
  const desc = form.getAll('line_desc'); const qty = form.getAll('line_qty');
  const price = form.getAll('line_price'); const note = form.getAll('line_note'); const ref = form.getAll('line_refundable');
  const auto = form.getAll('line_auto');
  const lines = [];
  desc.forEach((d, i) => {
    const description = String(d || '').trim();
    if (!description) return;
    const q = Number(qty[i]);
    const line = { description, qty: Number.isFinite(q) ? q : 1, unit_cents: toCents(price[i]), note: String(note[i] || '').replace(/\r\n?/g, '\n').trim(), refundable: ref[i] === '1' ? 1 : 0 };
    const [kind, sig] = String(auto[i] || '').split(':');
    line.auto = AUTO_KINDS.includes(kind) && sig === lineSig(line) ? kind : null;
    lines.push(line);
  });
  return lines;
}

export async function saveLines(db, invoiceId, lines) {
  const stmts = [db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?1').bind(invoiceId)];
  lines.forEach((l, i) => stmts.push(db.prepare('INSERT INTO invoice_lines (invoice_id, position, description, qty, unit_cents, note, refundable, auto) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
    .bind(invoiceId, i, l.description, l.qty, l.unit_cents, l.note, l.refundable, AUTO_KINDS.includes(l.auto) ? l.auto : null)));
  await db.batch(stmts);
}

// After a payment or an invoice line is changed by hand: the invoice's money status (and the
// request's, while it sits on a money step) follows the recorded payments, so a removed
// payment or a raised total reads "owes" again. Draft, void and done invoices are left alone.
export const MONEY_STATUS = { sent: 'invoiced', deposit_paid: 'deposit_paid', paid: 'paid' };
export async function syncMoneyStatus(db, invoiceId) {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(invoiceId).first();
  if (!inv || !(inv.status in MONEY_STATUS)) return inv ? inv.status : '';
  const { results: lines } = await db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?1').bind(invoiceId).all();
  const paid = (await paidByInvoice(db, [invoiceId]))[invoiceId] || 0;
  const bal = balanceOf(inv, lines || [], paid);
  // No money left on an invoice that never went out (a payment taken on a draft, then removed):
  // it is a Draft again, not "Sent", so Step 1 comes back on the card (progress.mjs pastFirstCall).
  const next = bal.total > 0 && bal.remaining === 0 ? 'paid' : (bal.paid > 0 ? 'deposit_paid' : (inv.sent_at ? 'sent' : 'draft'));
  if (next !== inv.status) await db.prepare("UPDATE invoices SET status = ?2, updated_at = datetime('now') WHERE id = ?1").bind(invoiceId, next).run();
  if (inv.request_key) {
    await db.prepare("UPDATE request_status SET status = ?2, updated_at = datetime('now') WHERE request_key = ?1 AND status IN ('invoiced','deposit_paid','paid')")
      .bind(inv.request_key, next === 'draft' ? 'new' : MONEY_STATUS[next]).run();
  }
  return next;
}
