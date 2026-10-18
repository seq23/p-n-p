// Money per invoice from recorded payments (table `payments`, migration 0004), never from a
// status chip. The refundable damage deposit is kept apart from what is owed: a payment
// covers the charges first, then the damage deposit.
import { invoiceTotal, lineTotal, money, toCents } from './util.mjs';
import { chicagoDate } from './reminders.mjs';

export function splitTotals(lines) {
  const refundable = (lines || []).filter((l) => l.refundable).reduce((s, l) => s + lineTotal(l), 0);
  return { total: invoiceTotal(lines || []), refundable, charges: invoiceTotal(lines || []) - refundable };
}

// paidCents: sum of non-voided payments.
export function balanceOf(invoice, lines, paidCents) {
  const { total, refundable, charges } = splitTotals(lines);
  const paid = Math.max(0, paidCents || 0);
  const isVoid = invoice && invoice.status === 'void';
  return {
    void: isVoid, total, charges, refundable, paid,
    owed: isVoid ? 0 : Math.max(0, charges - paid),
    depositOwed: isVoid ? 0 : Math.max(0, refundable - Math.max(0, paid - charges)),
    remaining: isVoid ? 0 : Math.max(0, total - paid),
  };
}

export function balanceWords(bal) {
  if (!bal || bal.void) return '';
  return bal.owed > 0 ? `Owes ${money(bal.owed)}` : 'Paid in full ✓';
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

// Balance for every invoice, keyed by id.
export async function balances(db) {
  const [{ results: invoices }, lines, paid] = await Promise.all([db.prepare('SELECT * FROM invoices').all(), linesByInvoice(db), paidByInvoice(db)]);
  const out = {};
  for (const inv of invoices || []) out[inv.id] = { invoice: inv, ...balanceOf(inv, lines[inv.id] || [], paid[inv.id] || 0) };
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

export async function recordDepositOutcome(db, invoice, lines, kind, amountCents, method = '') {
  const paid = (await paidByInvoice(db, [invoice.id]))[invoice.id] || 0;
  const bal = balanceOf(invoice, lines, paid);
  const collected = bal.refundable - bal.depositOwed;
  const { refunded, kept } = await depositHeld(db, invoice.id);
  const held = Math.max(0, collected - refunded - kept);
  const amount = Math.max(0, Math.min(held, Math.round(amountCents) || 0));
  if (amount > 0) {
    await db.prepare('INSERT INTO payments (invoice_id, amount_cents, received_on, method, note, kind) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(invoice.id, amount, chicagoDate(), method, kind === 'refund' ? 'damage deposit refunded' : 'damage deposit kept for damage', kind).run();
  }
  return { amount, held: held - amount };
}

// The invoice lines as the editor posts them (line_desc / line_qty / line_price / line_note /
// line_refundable, one of each per line). Used by the invoice editor and by "Change anything".
export function linesFromForm(form) {
  const desc = form.getAll('line_desc'); const qty = form.getAll('line_qty');
  const price = form.getAll('line_price'); const note = form.getAll('line_note'); const ref = form.getAll('line_refundable');
  const lines = [];
  desc.forEach((d, i) => {
    const description = String(d || '').trim();
    if (!description) return;
    const q = Number(qty[i]);
    lines.push({ description, qty: Number.isFinite(q) ? q : 1, unit_cents: toCents(price[i]), note: String(note[i] || '').trim(), refundable: ref[i] === '1' ? 1 : 0 });
  });
  return lines;
}

export async function saveLines(db, invoiceId, lines) {
  const stmts = [db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?1').bind(invoiceId)];
  lines.forEach((l, i) => stmts.push(db.prepare('INSERT INTO invoice_lines (invoice_id, position, description, qty, unit_cents, note, refundable) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(invoiceId, i, l.description, l.qty, l.unit_cents, l.note, l.refundable)));
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
  const next = bal.total > 0 && bal.remaining === 0 ? 'paid' : (bal.paid > 0 ? 'deposit_paid' : 'sent');
  if (next !== inv.status) await db.prepare("UPDATE invoices SET status = ?2, updated_at = datetime('now') WHERE id = ?1").bind(invoiceId, next).run();
  if (inv.request_key) {
    await db.prepare("UPDATE request_status SET status = ?2, updated_at = datetime('now') WHERE request_key = ?1 AND status IN ('invoiced','deposit_paid','paid')")
      .bind(inv.request_key, MONEY_STATUS[next]).run();
  }
  return next;
}
