// The Money tab and the year-end summary for taxes (docs/admin-console.md). Pure sums over
// the payments record (never inferred from a status chip), split by the four services in
// kinds.mjs. Damage deposits are never revenue: a payment covers the charges first and the
// rest is a deposit held; refunds and deposits kept for damage are their own lines. Void
// invoices are left out of every total and listed apart. Dates are Memphis dates
// (payments.received_on is written with chicagoDate()).
import { lineTotal } from './util.mjs';
import { balanceOf, splitPayment } from './ledger.mjs';
import { SERVICE_KINDS, serviceOfLine, serviceOfKind } from './kinds.mjs';
import { askedDate } from './requested.mjs';

export const CATEGORY_KEYS = [...Object.keys(SERVICE_KINDS), 'other'];
export const CATEGORY_LABELS = {
  rentals: 'Rentals', porch: 'Porch decorating', party: 'Party & decor', grazing: 'Grazing tables', other: 'Other',
};
// How a tip was given (tips table, migration 0019). A tip is never a payment on an invoice.
export const TIP_METHODS = { cash: 'Cash', zelle: 'Zelle', cashapp: 'Cash App', other: 'Other' };
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
  const [invoices, lines, payments, bookings, statuses, expenses, tips] = await Promise.all([
    q('SELECT * FROM invoices'), q('SELECT * FROM invoice_lines ORDER BY invoice_id, position, id'),
    q('SELECT * FROM payments WHERE voided_at IS NULL ORDER BY invoice_id, received_on, id'),
    q('SELECT * FROM bookings ORDER BY date, id'), q('SELECT * FROM request_status'),
    q("SELECT * FROM expenses WHERE status = 'saved' ORDER BY date, id"),
    // Before migration 0019 is applied the table is missing: no tips, never an error page.
    q('SELECT * FROM tips WHERE removed_at IS NULL ORDER BY date, id').catch(() => []),
  ]);
  return prepare({ invoices, lines, payments, bookings, statuses, expenses, tips, rentalLine });
}

// Split each invoice's charges by service, and each payment into charge and deposit parts.
export function prepare({ invoices, lines, payments, bookings = [], statuses = [], expenses = [], tips = [], rentalLine = null }) {
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
    // The one split (ledger.mjs splitPayment): the damage deposit first, then the charges.
    const before = running[p.invoice_id] || 0;
    const { charge, deposit } = splitPayment(before, p.amount_cents, x);
    running[p.invoice_id] = before + p.amount_cents;
    allocated.push({ ...p, kind, charge, deposit, cats: splitByShare(charge, x.cats, x.charges) });
  }
  return { byInv, payments: allocated, bookings, statuses, expenses, tips: tips.filter((t) => !t.removed_at) };
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
    tips: 0, tipList: [],
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
      const { owed } = balanceOf(x.inv, x.lines, paid);
      // A draft (never sent) is owed by nobody (owner, 20 Oct 2026; ledger.mjs balances).
      if (owed > 0 && x.inv.status !== 'draft') { out.owed += owed; out.owedList.push({ booking: b, invoice: x.inv, owed }); }
    }
  }
  for (const e of data.expenses) {
    if (!inPeriod(e.date, prefix)) continue;
    out.expenses += e.total_cents; out.expenseList.push(e);
    out.expenseByCategory[e.category] = (out.expenseByCategory[e.category] || 0) + e.total_cents;
  }
  // Tips: their own line, never part of received, revenue, owed or an invoice balance.
  for (const t of data.tips || []) {
    if (!inPeriod(t.date, prefix)) continue;
    out.tips += t.amount_cents; out.tipList.push(t);
  }
  out.left = out.revenue + out.kept - out.expenses;
  return out;
}

// ---- The calm Money tab (owner-approved 19 Oct 2026) -----------------------------------------
// One row per job: its name, services, date, total, paid, still owed and tips. A job is a
// request (or a booking made without one) with a first booking, an invoice, or (unconfirmed
// only) just the day it asked for. Void requests and invoices are never jobs. Money per job
// comes from the payments record via prepare(): a payment takes the refundable damage deposit
// first, then the charges (ledger.mjs splitPayment, the one split). Still owed is charges minus
// paid charges (plus the deposit not collected yet only when "Leave out refundable deposits" is
// off, so Total - Paid = Still owed on every row) and never a tip. confirmed follows steps.mjs (unconfirmed: a Set of request keys from unconfirmedKeys).
// billed: the job's invoice has been SENT (not a draft, not void). Still owed is every billed
// invoice's balance whether or not the job is confirmed (owner, 21 Oct 2026: a sent invoice is
// owed money, the same number Not paid yet and the 7 AM email show), so a billed row always
// shows and counts. Put away (request_status.archived_at) with nothing sent and nothing in
// (no payment, no tip) is not a job on Money: no row, no totals. Put away and billed, or put
// away with money in, still shows.
export function jobRows(data, { requests = [], unconfirmed = new Set() } = {}) {
  const st = Object.fromEntries((data.statuses || []).map((s) => [s.request_key, s]));
  const voidKey = (k) => Boolean(k && st[k] && st[k].status === 'void');
  const reqBy = Object.fromEntries(requests.map((r) => [r.key, r]));
  const groups = new Map();
  const group = (id) => { if (!groups.has(id)) groups.set(id, { id, bookings: [], requestKey: '', invoiceId: null }); return groups.get(id); };
  for (const b of data.bookings || []) {
    if (!START_KINDS.has(b.kind) || voidKey(b.request_key)) continue;
    const g = group(b.request_key ? `r:${b.request_key}` : (b.invoice_id ? `i:${b.invoice_id}` : `b:${b.id}`));
    g.bookings.push(b); if (b.request_key) g.requestKey = b.request_key; if (b.invoice_id && !g.invoiceId) g.invoiceId = b.invoice_id;
  }
  for (const r of requests) {
    if (r.isTest || voidKey(r.key)) continue;
    const s = st[r.key] || {};
    if (!(groups.has(`r:${r.key}`) || s.invoice_id || unconfirmed.has(r.key))) continue;
    const g = group(`r:${r.key}`); g.requestKey = r.key; if (s.invoice_id) g.invoiceId = s.invoice_id;
  }
  const rows = [];
  for (const g of groups.values()) {
    const x = g.invoiceId ? data.byInv[g.invoiceId] : null;
    if (x && x.inv.status === 'void') continue;
    const billed = Boolean(x && x.inv.status !== 'draft');
    const r = g.requestKey ? reqBy[g.requestKey] : null;
    const first = g.bookings.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
    const services = [...new Set([...g.bookings.map((b) => serviceOfKind(b.kind)), ...((r && r.services) || []), ...(x ? Object.keys(x.cats) : [])])].filter((k) => k && k !== 'other');
    const date = first ? first.date : (r ? (services.map((k) => askedDate(r, k)).find(Boolean) || '') : '');
    const pays = x ? data.payments.filter((p) => p.invoice_id === x.inv.id && p.kind === 'payment') : [];
    const paidCharges = pays.reduce((n, p) => n + p.charge, 0);
    const paidDeposit = pays.reduce((n, p) => n + p.deposit, 0);
    const tips = (data.tips || []).filter((t) => (g.requestKey && t.request_key === g.requestKey) || (x && t.invoice_id === x.inv.id));
    const confirmed = !(g.requestKey && unconfirmed.has(g.requestKey));
    const putAway = Boolean(g.requestKey && st[g.requestKey] && st[g.requestKey].archived_at);
    if (putAway && !billed && !pays.length && !tips.length) continue;
    const charges = x ? x.charges : 0;
    rows.push({
      key: g.id, requestKey: g.requestKey, invoiceId: x ? x.inv.id : null, number: x ? x.inv.number : '',
      name: (x && x.inv.customer_name) || (r && r.name) || (first && first.customer_name) || 'No name',
      services: services.length ? services : ['other'], date, confirmed, billed, putAway, hasPrice: Boolean(x),
      charges, refundable: x ? x.refundable : 0, paidCharges, paidDeposit,
      owed: billed ? Math.max(0, charges - paidCharges) : 0,
      depositOwed: billed ? Math.max(0, x.refundable - paidDeposit) : 0,
      expected: confirmed || billed || putAway ? 0 : charges,
      tips: tips.reduce((n, t) => n + t.amount_cents, 0), tipCount: tips.length,
    });
  }
  return rows;
}

// A row that counts in Money's numbers: confirmed, or billed (a sent invoice is owed money).
export const counted = (r) => Boolean(r.confirmed || r.billed);
// What a row says is still owed: charges, plus the damage deposit not collected yet only when
// deposits are counted (so Total - Paid = Still owed on the row, and the summary is their sum).
export const rowOwed = (r, includeDeposits = false) => (counted(r) ? r.owed + (includeDeposits ? (r.depositOwed || 0) : 0) : 0);

// The rows a view shows. view 'month' (with month 'YYYY-MM') or 'all'. Unconfirmed rows (not
// billed) only when includeUnconfirmed. 'all' is grouped: upcoming (nearest first) then past (newest first).
export function viewRows(rows, { view = 'month', month = '', today = '', includeUnconfirmed = false } = {}) {
  const shown = rows.filter((r) => (includeUnconfirmed || counted(r)) && (view === 'all' || String(r.date).startsWith(month)));
  const by = (a, b) => String(a.date).localeCompare(String(b.date)) || a.name.localeCompare(b.name);
  if (view !== 'all') return { list: shown.sort(by), upcoming: [], past: [] };
  const upcoming = shown.filter((r) => r.date && r.date >= today).sort(by);
  const past = shown.filter((r) => !r.date || r.date < today).sort((a, b) => by(b, a));
  return { list: [...upcoming, ...past], upcoming, past };
}

// The big plain numbers at the top of Money for one view.
//   moneyIn   payments received in the period. includeDeposits false (the default): the
//             refundable damage deposits are left out (charges received + deposits kept for
//             damage, which are income). true: everything received, deposits included.
//   owed      still owed on the jobs shown: the sum of the rows' Still owed (rowOwed), so the
//             figure and the rows always agree. Every sent invoice counts, confirmed or not;
//             charges only unless deposits are counted; never a tip.
//   owedRows  the rows that make it up (the "Still owed" detail page lists them).
//   tips      tips dated in the period, their own line.
//   expected  unconfirmed jobs' invoice charges, only when includeUnconfirmed: never added to
//             money in or owed.
export function moneySummary(data, rows, { view = 'month', month = '', includeDeposits = false, includeUnconfirmed = false, today = '' } = {}) {
  const t = periodTotals(data, view === 'all' ? '' : month);
  const { list } = viewRows(rows, { view, month, today, includeUnconfirmed });
  const confirmed = list.filter(counted);
  const owing = confirmed.filter((r) => rowOwed(r, includeDeposits) > 0);
  const moneyIn = includeDeposits ? t.received : t.revenue + t.kept;
  return {
    t, moneyIn, depositsIn: t.depositsIn, includeDeposits,
    owed: owing.reduce((n, r) => n + rowOwed(r, includeDeposits), 0),
    depositOwed: includeDeposits ? owing.reduce((n, r) => n + (r.depositOwed || 0), 0) : 0,
    owedRows: owing,
    tips: t.tips, expenses: t.expenses,
    left: t.revenue + t.kept + t.tips - t.expenses,
    expected: includeUnconfirmed ? list.filter((r) => !counted(r)).reduce((n, r) => n + r.expected, 0) : 0,
    unconfirmedCount: list.filter((r) => !counted(r)).length,
    jobs: confirmed.length,
  };
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
