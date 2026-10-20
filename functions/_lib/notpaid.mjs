// "Not paid yet" (owner-approved 18 Oct 2026, JOB B): every customer whose SENT invoice still has
// charges owed, most overdue first. The refundable damage deposit is never owed (ledger.mjs
// balance.owed); void invoices are never listed; drafts are listed apart as "Invoice not sent
// yet". The same rows feed the top of Money, the "Not paid yet" filter on Requests, the Day sheet
// and the Monday summary, so the count and total can never disagree.
import { balances, linesByInvoice, dueWords as amountDueWords, dueCents } from './ledger.mjs';
import { serviceOfLine } from './kinds.mjs';
import { isRentalInvoice } from './pricing.mjs';
import { PRICE_TABLE } from './prices.mjs';

const DAY = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

// "3 days late" (red) / "Due today" / "Due tomorrow" / "Due in 2 days" (amber, within 3 days) / "Due Mon 26 Oct".
export function dueWords(due, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(due || ''))) return { words: 'No due date', tone: '' };
  const d = daysBetween(today, due);
  if (d < 0) return { words: `${-d} ${d === -1 ? 'day' : 'days'} late`, tone: 'late', days: d };
  if (d === 0) return { words: 'Due today', tone: 'soon', days: d };
  if (d === 1) return { words: 'Due tomorrow', tone: 'soon', days: d };
  if (d <= 3) return { words: `Due in ${d} days`, tone: 'soon', days: d };
  const when = new Date(`${due}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return { words: `Due ${when}`, tone: '', days: d };
}

// Pure: rows from balances + lines + requests. requestsByKey: { key: request }.
export function notPaidRows(bals, linesBy, requestsByKey, today) {
  const owed = []; const drafts = [];
  for (const b of Object.values(bals)) {
    const inv = b.invoice;
    if (!inv || inv.status === 'void' || b.void) continue;
    const lines = linesBy[inv.id] || [];
    const req = inv.request_key ? requestsByKey[inv.request_key] : null;
    const services = req && req.services && req.services.length ? req.services
      : [...new Set(lines.filter((l) => !l.refundable).map((l) => serviceOfLine(l.description, isRentalInvoice([l], PRICE_TABLE))).filter((k) => k !== 'other'))];
    const whatFor = lines.filter((l) => !l.refundable).map((l) => l.description).slice(0, 2).join(', ') || 'Invoice';
    const row = {
      id: inv.id, number: inv.number, name: inv.customer_name || (req && req.name) || 'No name', phone: inv.customer_phone || (req && req.phone) || '',
      email: inv.customer_email || (req && req.email) || '', requestKey: inv.request_key || '', services, whatFor,
      // Total - Paid = what the due words say (ledger.mjs balanceOf: remaining = charges + any damage
      // deposit not collected yet); owed (charges) decides who is listed.
      total: b.total, paid: b.paid, owed: b.owed, remaining: dueCents(b), depositOwed: Math.max(0, dueCents(b) - b.owed), dueWords: amountDueWords(b), due: inv.due_date, remindedAt: inv.reminded_at || '', status: inv.status,
      ...dueWords(inv.due_date, today),
    };
    if (inv.status === 'draft') { if (b.charges > 0) drafts.push(row); continue; }
    if (b.owed > 0) owed.push(row);
  }
  owed.sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')) || b.owed - a.owed);
  drafts.sort((a, b) => b.id - a.id);
  return { owed, drafts, count: owed.length, total: owed.reduce((s, r) => s + r.remaining, 0), depositTotal: owed.reduce((s, r) => s + r.depositOwed, 0) };
}

export async function notPaidYet(db, requests, today) {
  const [bals, linesBy] = await Promise.all([balances(db), linesByInvoice(db)]);
  const byKey = Object.fromEntries((requests || []).map((r) => [r.key, r]));
  return notPaidRows(bals, linesBy, byKey, today);
}

// The reminder text (sms: body and email). No public invoice page exists, so the text names
// the invoice number and the email it was sent in.
export function reminderCtx(row, fmtMoney, prettyDue) {
  return { name: row.name, amount: fmtMoney(row.remaining), due: row.due ? prettyDue(row.due) : '', late: row.tone === 'late', number: row.number };
}
