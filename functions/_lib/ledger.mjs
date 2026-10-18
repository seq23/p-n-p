// Money per invoice from recorded payments (table `payments`, migration 0004), never from a
// status chip. The refundable damage deposit is kept apart from what is owed: a payment
// covers the charges first, then the damage deposit.
import { invoiceTotal, lineTotal, money } from './util.mjs';
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
