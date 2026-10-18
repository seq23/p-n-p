// The Money tab and the year-end summary for taxes (docs/admin-console.md). Pure sums over
// the payments record (never inferred from a status chip), split by the four services in
// kinds.mjs. Damage deposits are never revenue: a payment covers the charges first and the
// rest is a deposit held; refunds and deposits kept for damage are their own lines. Void
// invoices are left out of every total and listed apart. Dates are Memphis dates
// (payments.received_on is written with chicagoDate()).
import { lineTotal } from './util.mjs';
import { SERVICE_KINDS, serviceOfLine, serviceOfKind } from './kinds.mjs';

export const CATEGORY_KEYS = [...Object.keys(SERVICE_KINDS), 'other'];
export const CATEGORY_LABELS = {
  rentals: 'Rentals', porch: 'Porch decorating', party: 'Party & decor', grazing: 'Grazing tables', other: 'Other',
};
export const METHOD_LABELS = { zelle: 'Zelle', cashapp: 'Cash App', cash: 'Cash', card: 'Card', other: 'Other', unknown: 'Not recorded' };
export const DEFAULT_EXPENSE_CATEGORIES = ['Supplies & decor', 'Food for grazing tables', 'Game equipment', 'Gas & mileage', 'Advertising', 'Rentals & storage', 'Fees (Zelle/Cash App/bank)', 'Other'];
export const START_KINDS = new Set(['rental_pickup', 'porch_install', 'party_setup', 'grazing_setup', 'other']);
export const FOOTER = "Prepared from Porch & Party's admin records for your tax preparer. This is a summary, not tax advice.";

export function methodKey(m) {
  const s = String(m || '').toLowerCase();
  if (!s || /unknown/.test(s)) return 'unknown';
  if (/zelle/.test(s)) return 'zelle';
  if (/cash ?app/.test(s)) return 'cashapp';
  if (/^cash$/.test(s)) return 'cash';
  if (/card|credit|debit|square/.test(s)) return 'card';
  return 'other';
}

export async function loadMoneyData(db, { rentalLine } = {}) {
  const q = async (sql) => (await db.prepare(sql).all()).results || [];
  const [invoices, lines, payments, bookings, statuses, expenses] = await Promise.all([
    q('SELECT * FROM invoices'), q('SELECT * FROM invoice_lines ORDER BY invoice_id, position, id'),
    q('SELECT * FROM payments WHERE voided_at IS NULL ORDER BY invoice_id, received_on, id'),
    q('SELECT * FROM bookings ORDER BY date, id'), q('SELECT * FROM request_status'),
    q("SELECT * FROM expenses WHERE status = 'saved' ORDER BY date, id"),
  ]);
  return prepare({ invoices, lines, payments, bookings, statuses, expenses, rentalLine });
}

// Split each invoice's charges by service, and each payment into charge and deposit parts.
export function prepare({ invoices, lines, payments, bookings = [], statuses = [], expenses = [], rentalLine = null }) {
  const byInv = {};
  for (const inv of invoices) byInv[inv.id] = { inv, lines: [], charges: 0, refundable: 0, cats: {} };
  for (const l of lines) {
    const x = byInv[l.invoice_id];
    if (!x) continue;
    x.lines.push(l);
    const amt = lineTotal(l);
    if (l.refundable) { x.refundable += amt; continue; }
    x.charges += amt;
    const isRental = rentalLine ? rentalLine(l) : /\b(giant|cornhole|grab the mic|movie screen|card table|game|pick 3|pick 5|whole yard|movie night|game night|whole party)\b/i.test(l.description) || /damage deposit/i.test(l.description);
    const cat = serviceOfLine(l.description, isRental);
    x.cats[cat] = (x.cats[cat] || 0) + amt;
  }
  const allocated = [];
  const running = {};
  for (const p of payments) {
    const x = byInv[p.invoice_id];
    if (!x || x.inv.status === 'void') continue;
    const kind = p.kind || 'payment';
    if (kind !== 'payment') { allocated.push({ ...p, kind, charge: 0, deposit: 0, cats: {} }); continue; }
    const before = running[p.invoice_id] || 0;
    const charge = Math.max(0, Math.min(p.amount_cents, x.charges - before));
    running[p.invoice_id] = before + p.amount_cents;
    allocated.push({ ...p, kind, charge, deposit: p.amount_cents - charge, cats: splitByShare(charge, x.cats, x.charges) });
  }
  return { byInv, payments: allocated, bookings, statuses, expenses };
}

// Largest-remainder split so the parts always add up to the whole, to the cent.
export function splitByShare(amount, shares, total) {
  const keys = Object.keys(shares).filter((k) => shares[k] > 0);
  if (!amount || !keys.length || !total) return amount ? { other: amount } : {};
  const raw = keys.map((k) => ({ k, v: (amount * shares[k]) / total }));
  const out = {}; let used = 0;
  for (const r of raw) { out[r.k] = Math.floor(r.v); used += out[r.k]; }
  raw.sort((a, b) => (b.v - Math.floor(b.v)) - (a.v - Math.floor(a.v)));
  for (let i = 0; used < amount; i += 1, used += 1) out[raw[i % raw.length].k] += 1;
  return out;
}

const inPeriod = (date, prefix) => String(date || '').startsWith(prefix);

// One period ('2026-10' or '2026') of money in, deposits, jobs, expenses.
export function periodTotals(data, prefix) {
  const out = {
    received: 0, revenue: 0, byCategory: Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0])), byMethod: {},
    depositsIn: 0, refunds: 0, depositRefunds: 0, kept: 0, payments: [], jobs: 0, jobList: [], owed: 0, owedList: [], expenses: 0, expenseList: [], expenseByCategory: {},
  };
  for (const p of data.payments) {
    if (!inPeriod(p.received_on, prefix)) continue;
    out.payments.push(p);
    if (p.kind === 'payment') {
      out.received += p.amount_cents; out.revenue += p.charge; out.depositsIn += p.deposit;
      for (const [k, v] of Object.entries(p.cats)) out.byCategory[k] = (out.byCategory[k] || 0) + v;
      const m = methodKey(p.method); out.byMethod[m] = (out.byMethod[m] || 0) + p.amount_cents;
    } else if (p.kind === 'refund') { out.refunds += p.amount_cents; if (/deposit/.test(p.note || '')) out.depositRefunds += p.amount_cents; } else if (p.kind === 'deposit_kept') { out.kept += p.amount_cents; }
  }
  const voidKeys = new Set(data.statuses.filter((s) => s.status === 'void').map((s) => s.request_key));
  const seenInv = new Set();
  for (const b of data.bookings) {
    if (!inPeriod(b.date, prefix) || !START_KINDS.has(b.kind)) continue;
    const x = b.invoice_id ? data.byInv[b.invoice_id] : null;
    if ((x && x.inv.status === 'void') || (b.request_key && voidKeys.has(b.request_key))) continue;
    out.jobs += 1; out.jobList.push(b);
    if (x && !seenInv.has(b.invoice_id)) {
      seenInv.add(b.invoice_id);
      const paid = data.payments.filter((p) => p.invoice_id === b.invoice_id && p.kind === 'payment').reduce((s, p) => s + p.amount_cents, 0);
      const owed = Math.max(0, x.charges - paid);
      if (owed > 0) { out.owed += owed; out.owedList.push({ booking: b, invoice: x.inv, owed }); }
    }
  }
  for (const e of data.expenses) {
    if (!inPeriod(e.date, prefix)) continue;
    out.expenses += e.total_cents; out.expenseList.push(e);
    out.expenseByCategory[e.category] = (out.expenseByCategory[e.category] || 0) + e.total_cents;
  }
  out.left = out.revenue + out.kept - out.expenses;
  return out;
}

// Damage deposits still held at the end of a period (a liability, never income).
export function depositsHeldAt(data, endDate) {
  let held = 0;
  for (const p of data.payments) {
    if (p.received_on > endDate) continue;
    if (p.kind === 'payment') held += p.deposit;
    else if (p.kind === 'refund' && /deposit/.test(p.note || '')) held -= p.amount_cents;
    else if (p.kind === 'deposit_kept') held -= p.amount_cents;
  }
  return Math.max(0, held);
}

export function yearSummary(data, year) {
  const y = String(year);
  const total = periodTotals(data, y);
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = `${y}-${String(i + 1).padStart(2, '0')}`;
    const t = periodTotals(data, m);
    return { month: m, received: t.received, revenue: t.revenue, kept: t.kept, refunds: t.refunds, jobs: t.jobs, expenses: t.expenses };
  });
  const invoices = Object.values(data.byInv).filter((x) => inPeriod(x.inv.issue_date, y)).sort((a, b) => String(a.inv.number).localeCompare(String(b.inv.number)));
  const paidOf = (id) => data.payments.filter((p) => p.invoice_id === id && p.kind === 'payment').reduce((s, p) => s + p.amount_cents, 0);
  const list = invoices.filter((x) => x.inv.status !== 'void').map((x) => ({ number: x.inv.number, date: x.inv.issue_date, customer: x.inv.customer_name, total: x.charges + x.refundable, paid: paidOf(x.inv.id) }));
  const voided = invoices.filter((x) => x.inv.status === 'void').map((x) => ({ number: x.inv.number, date: x.inv.issue_date, customer: x.inv.customer_name }));
  const expenseByMonth = months.map((m) => ({ month: m.month, expenses: m.expenses }));
  return { year: y, total, months, list, voided, depositsHeld: depositsHeldAt(data, `${y}-12-31`), expenseByMonth };
}

const usd = (c) => (Math.round(c) / 100).toFixed(2);
const cell = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

// One CSV: a summary block, then the line items. UTF-8 with a BOM so Excel reads it right.
export function yearCsv(sum, business = 'Porch & Party', legal = 'Kerseta LLC') {
  const rows = [];
  const t = sum.total;
  rows.push([`${business} — year-end summary ${sum.year}`], [`Legal entity: ${legal}`], []);
  rows.push(['Summary', 'Amount (USD)']);
  rows.push(['Gross money received', usd(t.received)]);
  rows.push(['  of which charges (income)', usd(t.revenue)]);
  rows.push(['  of which damage deposits taken (not income)', usd(t.depositsIn)]);
  rows.push(['Damage deposits kept for damage (income)', usd(t.kept)]);
  rows.push(['Refunds issued', usd(t.refunds)]);
  rows.push(['  of which damage-deposit refunds', usd(t.depositRefunds)]);
  rows.push(['Damage deposits held at year end (owed back, not income)', usd(sum.depositsHeld)]);
  rows.push(['Number of jobs', t.jobs]);
  rows.push(['Expenses', usd(t.expenses)]);
  rows.push([]);
  rows.push(['Income by category', 'Amount (USD)']);
  for (const k of CATEGORY_KEYS) rows.push([CATEGORY_LABELS[k], usd(t.byCategory[k] || 0)]);
  rows.push([]);
  rows.push(['Money received by payment method', 'Amount (USD)']);
  for (const [k, v] of Object.entries(t.byMethod)) rows.push([METHOD_LABELS[k] || k, usd(v)]);
  rows.push([]);
  rows.push(['Month', 'Money received', 'Income (charges)', 'Deposits kept', 'Refunds', 'Jobs', 'Expenses']);
  for (const m of sum.months) rows.push([m.month, usd(m.received), usd(m.revenue), usd(m.kept), usd(m.refunds), m.jobs, usd(m.expenses)]);
  rows.push([]);
  rows.push(['Expenses by category', 'Amount (USD)']);
  for (const [k, v] of Object.entries(t.expenseByCategory)) rows.push([k, usd(v)]);
  rows.push([]);
  rows.push(['Invoice number', 'Date', 'Customer', 'Total', 'Paid']);
  for (const i of sum.list) rows.push([i.number, i.date, i.customer, usd(i.total), usd(i.paid)]);
  rows.push([]);
  rows.push(['Voided invoices (for the record, $0)', 'Date', 'Customer']);
  for (const v of sum.voided) rows.push([v.number, v.date, v.customer]);
  rows.push([]);
  rows.push(['Expense date', 'Vendor', 'Category', 'Amount', 'Tax', 'Receipt']);
  for (const e of t.expenseList) rows.push([e.date, e.vendor, e.category, usd(e.total_cents), usd(e.tax_cents), e.receipt_key ? 'receipt saved in admin' : '']);
  rows.push([]);
  rows.push([FOOTER]);
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function serviceOfBookingKind(kind) {
  return serviceOfKind(kind);
}
