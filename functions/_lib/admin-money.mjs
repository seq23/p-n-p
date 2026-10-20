// Money tab, year-end summary for taxes, expenses with receipts, damage-deposit outcomes and
// the Google Sheet sync (docs/admin-console.md). Auth is enforced before this runs.
import { loadRequests, monthCount, logEvent } from './requests.mjs';
import { notPaidYet } from './notpaid.mjs';
import { sendMessage } from './messages.mjs';
import { redirect, htmlResponse, getSettings, putSetting, toCents, FROM_EMAIL, bytesToB64, money, shortDate } from './util.mjs';
import { PRICE_TABLE } from './prices.mjs';
import { isRentalInvoice } from './pricing.mjs';
import { chicagoDate } from './reminders.mjs';
import * as M from './money.mjs';
import * as X from './expenses.mjs';
import * as S from './sheets-sync.mjs';
import { accessToken, WRITE_SCOPES } from './sheet.mjs';
import { balances, recordDepositOutcome } from './ledger.mjs';
import { contextFor, statusMap } from './admin-calendar.mjs';
import { listBookings, loadReturns } from './calendar.mjs';
import { unconfirmedKeys, loadStored } from './steps.mjs';
import { renderYearPdf } from './pdf-year.mjs';
import { makeZip } from './zip.mjs';
import * as VM from './views-money.mjs';

const rentalLine = (l) => isRentalInvoice([l], PRICE_TABLE);
export const moneyData = (db) => M.loadMoneyData(db, { rentalLine });
const okMonth = (m) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || '')) ? m : chicagoDate().slice(0, 7));
const okYear = (y) => (/^\d{4}$/.test(String(y || '')) ? String(y) : chicagoDate().slice(0, 4));

// The view on Money, remembered in the URL so a refresh keeps it (owner, 19 Oct 2026):
//   view=all            All jobs (default: By month, month=YYYY-MM, this month by default)
//   unconf=1            Include unconfirmed jobs (default off)
//   deposits=in         count refundable damage deposits (default: left out). The tick-box form
//                       sends f=1 and deposits=out while ticked, so an unticked box reads as "in".
export function moneyState(url) {
  const q = url.searchParams;
  const view = q.get('view') === 'all' ? 'all' : 'month';
  const includeDeposits = q.get('deposits') === 'in' || (q.get('f') === '1' && q.get('deposits') !== 'out');
  return { view, month: okMonth(q.get('month')), includeUnconfirmed: q.get('unconf') === '1', includeDeposits };
}

// Every job row, with "confirmed" from the one rule in steps.mjs (same as the calendar).
export async function moneyJobs(env, data, requests) {
  const [statuses, bals, returns, stored] = await Promise.all([statusMap(env.DB), balances(env.DB), loadReturns(env.DB), loadStored(env.DB)]);
  const unconfirmed = unconfirmedKeys({ requests, statuses, invoices: bals, returns, stored });
  return M.jobRows(data, { requests, unconfirmed });
}

export async function moneyPage(env, url) {
  const state = moneyState(url);
  const { month } = state;
  const year = url.searchParams.get('year') ? okYear(url.searchParams.get('year')) : month.slice(0, 4);
  const today = chicagoDate();
  const data = await moneyData(env.DB);
  const { results: needs } = await env.DB.prepare("SELECT * FROM expenses WHERE status = 'needs_check' ORDER BY id DESC").all();
  const requests = await loadRequests(env).catch(() => []);
  const notPaid = await notPaidYet(env.DB, requests, today);
  const rows = await moneyJobs(env, data, requests);
  const sum = M.moneySummary(data, rows, { ...state, today });
  const shown = M.viewRows(rows, { ...state, today });
  const expenses = state.view === 'all' ? data.expenses.slice().reverse() : sum.t.expenseList.slice().reverse();
  const tips = (state.view === 'all' ? data.tips : sum.t.tipList).slice().reverse();
  return htmlResponse(VM.moneyPage({ notPaid, state, today, month, year, requestsThisMonth: monthCount(requests, month), t: sum.t, sum, shown, months: M.yearSummary(data, year).months, needs: needs || [], expenses, tips, depositsHeld: M.depositsHeldAt(data, `${month}-31`), flash: url.searchParams.get('m') || '', error: url.searchParams.get('e') || '' }));
}

// "Email a reminder" on Not paid yet: one tap, from hello@, logs reminded_at on the invoice.
export async function remindRoute(env, request) {
  const form = await request.formData();
  const id = Number(form.get('invoice'));
  const requests = await loadRequests(env).catch(() => []);
  const np = await notPaidYet(env.DB, requests, chicagoDate());
  const row = np.owed.find((r) => r.id === id);
  if (!row) return redirect(`/admin/money?e=${encodeURIComponent('That invoice has nothing owed on it any more.')}#not-paid`);
  const ctx = { name: row.name, email: row.email, phone: row.phone, amount: money(row.owed), due: row.due ? shortDate(row.due) : '', late: row.tone === 'late', number: row.number };
  const sent = await sendMessage(env, 'email', 'paymentReminder', ctx);
  if (!sent.ok) return redirect(`/admin/money?e=${encodeURIComponent(`The reminder did not go out: ${sent.error}`)}#not-paid`);
  await env.DB.prepare("UPDATE invoices SET reminded_at = datetime('now') WHERE id = ?1").bind(id).run();
  if (row.requestKey) await logEvent(env.DB, row.requestKey, `Payment reminder emailed (${money(row.owed)} owed on ${row.number})`, 'admin');
  return redirect(`/admin/money?m=${encodeURIComponent(`Reminder emailed to ${row.name.split(/\s+/)[0]} ✓`)}#not-paid`);
}

export async function moneyDetail(env, url) {
  const month = okMonth(url.searchParams.get('month'));
  const all = url.searchParams.get('view') === 'all';
  const what = String(url.searchParams.get('what') || 'received');
  const data = await moneyData(env.DB);
  return htmlResponse(VM.detailPage({ month, all, what, t: M.periodTotals(data, all ? '' : month), byInv: data.byInv, back: String(url.searchParams.get('back') || '') }));
}

export async function yearPage(env, url) {
  const year = okYear(url.searchParams.get('year'));
  const data = await moneyData(env.DB);
  return htmlResponse(VM.yearPage({ year, sum: M.yearSummary(data, year), flash: url.searchParams.get('m') || '', error: url.searchParams.get('e') || '' }));
}

async function yearFiles(env, year) {
  const data = await moneyData(env.DB);
  const sum = M.yearSummary(data, year);
  const pdf = await renderYearPdf(sum);
  const csv = M.yearCsv(sum);
  return { sum, pdf, csv };
}

export async function yearPdf(env, url) {
  const year = okYear(url.searchParams.get('year'));
  const { pdf } = await yearFiles(env, year);
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="Porch-and-Party-${year}-summary.pdf"`, 'Cache-Control': 'no-store' } });
}

export async function yearCsv(env, url) {
  const year = okYear(url.searchParams.get('year'));
  const { csv } = await yearFiles(env, year);
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="Porch-and-Party-${year}-summary.csv"`, 'Cache-Control': 'no-store' } });
}

export async function yearEmail(env, url) {
  const year = okYear(url.searchParams.get('year'));
  const settings = await getSettings(env.DB);
  const to = settings.day_list_email || FROM_EMAIL;
  const { pdf, csv } = await yearFiles(env, year);
  const back = (k, v) => redirect(`/admin/money/year?year=${year}&${k}=${encodeURIComponent(v)}`);
  if (!env.MAILER) return back('e', 'Email is not connected on this copy of the site, so nothing was sent.');
  const payload = {
    to, replyTo: FROM_EMAIL, subject: `Porch & Party year-end summary ${year}`,
    html: `<p>The ${year} year-end summary is attached as a PDF and a spreadsheet (CSV).</p><p>${M.FOOTER}</p>`, text: `The ${year} year-end summary is attached as a PDF and a spreadsheet (CSV).\n\n${M.FOOTER}`,
    attachments: [
      { contentBase64: bytesToB64(pdf), filename: `Porch-and-Party-${year}-summary.pdf`, type: 'application/pdf', disposition: 'attachment' },
      { contentBase64: bytesToB64(new TextEncoder().encode(csv)), filename: `Porch-and-Party-${year}-summary.csv`, type: 'text/csv', disposition: 'attachment' },
    ],
  };
  try {
    const res = await env.MAILER.fetch('https://pnp-mailer.internal/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out.ok) return back('e', `The email did not go out. Please try again in a minute. (${out.error || res.status})`);
  } catch (e) { return back('e', `The email did not go out. Please try again in a minute. (${e.message || e})`); }
  return back('m', `Sent to ${to}`);
}

export async function receiptsZip(env, url) {
  const year = okYear(url.searchParams.get('year'));
  if (!env.RECEIPTS) return htmlResponse('Receipt storage is not connected on this copy of the site.', 503);
  const { results } = await env.DB.prepare("SELECT * FROM expenses WHERE status = 'saved' AND date LIKE ?1 AND receipt_key IS NOT NULL ORDER BY date, id").bind(`${year}-%`).all();
  const files = [];
  for (const e of results || []) {
    const obj = await env.RECEIPTS.get(e.receipt_key);
    if (!obj) continue;
    const ext = e.receipt_key.split('.').pop();
    const safe = `${e.date}-${String(e.vendor || 'receipt').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 40)}-${e.id}.${ext}`;
    files.push({ name: safe, bytes: new Uint8Array(await obj.arrayBuffer()) });
  }
  return new Response(makeZip(files), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="Porch-and-Party-receipts-${year}.zip"`, 'Cache-Control': 'no-store' } });
}

// ---- Expenses ------------------------------------------------------------------------------

export async function uploadReceipt(env, request) {
  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
  if (!X.RECEIPT_TYPES.includes(type)) return Response.json({ error: 'Receipts must be a photo (JPG, PNG, WebP) or a PDF.' }, { status: 415 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return Response.json({ error: 'That file is empty.' }, { status: 400 });
  if (bytes.length > X.MAX_RECEIPT_BYTES) return Response.json({ error: 'That file is over 8 MB.' }, { status: 413 });
  if (!env.RECEIPTS) return Response.json({ error: 'Receipt storage is not connected on this copy of the site.' }, { status: 503 });
  const key = X.receiptKey(type);
  await env.RECEIPTS.put(key, bytes, { httpMetadata: { contentType: type } });
  const settings = await getSettings(env.DB);
  const cats = X.categoriesFrom(settings);
  const { extraction: x, raw, message } = await X.extractReceipt(env, { bytes, type, name: 'receipt' }, cats);
  const row = await env.DB.prepare(`INSERT INTO expenses (receipt_key, receipt_type, vendor, date, total_cents, tax_cents, category, ai_raw_json, ai_confidence, note, status)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'needs_check') RETURNING id`)
    .bind(key, type, x.vendor, x.date, x.total_cents, x.tax_cents, x.category, raw, JSON.stringify({ ...x.confidence, message, line_items: x.line_items }), '').first();
  return Response.json({ ok: true, id: row.id, read: x.ok, message });
}

export async function expensePage(env, id) {
  const settings = await getSettings(env.DB);
  const cats = X.categoriesFrom(settings);
  if (id === 'new') return htmlResponse(VM.expenseForm({ expense: { id: null, vendor: '', date: chicagoDate(), total_cents: 0, tax_cents: 0, category: 'Other', payment_method: '', note: '', status: 'needs_check' }, cats, conf: {}, manual: true }));
  const e = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?1').bind(Number(id)).first();
  if (!e) return redirect('/admin/money?e=That expense is gone.');
  let conf = {};
  try { conf = JSON.parse(e.ai_confidence || '{}'); } catch { conf = {}; }
  return htmlResponse(VM.expenseForm({ expense: e, cats, conf, manual: !e.receipt_key, log: await historyOf(env.DB, 'expense', e.id) }));
}

export async function saveExpense(env, request, id) {
  const form = await request.formData();
  const cats = X.categoriesFrom(await getSettings(env.DB));
  const e = X.parseExpenseForm(form, cats);
  if (!e.total_cents) return redirect(`/admin/money/expenses/${id || 'new'}?e=${encodeURIComponent('Type the amount first.')}`);
  const before = id ? await env.DB.prepare('SELECT * FROM expenses WHERE id = ?1').bind(id).first() : null;
  if (id) {
    await env.DB.prepare(`UPDATE expenses SET vendor=?1, date=?2, total_cents=?3, tax_cents=?4, category=?5, payment_method=?6, note=?7, status='saved', updated_at=datetime('now') WHERE id=?8`)
      .bind(e.vendor, e.date, e.total_cents, e.tax_cents, e.category, e.payment_method, e.note, id).run();
    await history(env.DB, 'expense', id, before && before.status === 'needs_check' ? 'checked and saved' : 'changed', changes(before, e, EXPENSE_FIELDS));
  } else {
    const row = await env.DB.prepare(`INSERT INTO expenses (vendor, date, total_cents, tax_cents, category, payment_method, note, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'saved') RETURNING id`)
      .bind(e.vendor, e.date, e.total_cents, e.tax_cents, e.category, e.payment_method, e.note).first();
    await history(env.DB, 'expense', row.id, 'added by hand', `${money(e.total_cents)} · ${e.date} · ${e.vendor || e.category}`);
  }
  const next = await env.DB.prepare("SELECT id FROM expenses WHERE status = 'needs_check' ORDER BY id LIMIT 1").first();
  if (next) return redirect(`/admin/money/expenses/${next.id}?m=${encodeURIComponent('Saved ✓ Next receipt to check:')}`);
  return redirect(`/admin/money?month=${e.date.slice(0, 7)}&m=${encodeURIComponent('Expense saved ✓')}`);
}

export async function deleteExpense(env, id) {
  const e = await env.DB.prepare('SELECT * FROM expenses WHERE id = ?1').bind(id).first();
  if (e && e.receipt_key && env.RECEIPTS) await env.RECEIPTS.delete(e.receipt_key);
  await env.DB.prepare('DELETE FROM expenses WHERE id = ?1').bind(id).run();
  if (e) await history(env.DB, 'expense', id, 'deleted', `${money(e.total_cents)} · ${e.date} · ${e.vendor || e.category}`);
  return redirect('/admin/money?m=Expense deleted.');
}

export async function receiptFile(env, id) {
  const e = await env.DB.prepare('SELECT receipt_key, receipt_type FROM expenses WHERE id = ?1').bind(id).first();
  if (!e || !e.receipt_key || !env.RECEIPTS) return new Response('not found', { status: 404 });
  const obj = await env.RECEIPTS.get(e.receipt_key);
  if (!obj) return new Response('not found', { status: 404 });
  return new Response(obj.body, { headers: { 'Content-Type': e.receipt_type || 'application/octet-stream', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline' } });
}

export async function saveCategories(env, request) {
  const form = await request.formData();
  const list = String(form.get('categories') || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 30);
  if (!list.includes('Other')) list.push('Other');
  await putSetting(env.DB, 'expense_categories', JSON.stringify(list));
  return redirect('/admin/settings?m=Expense categories saved ✓');
}

// ---- History of a tip or an expense (money_history, migration 0019) -------------------------

const EXPENSE_FIELDS = [['vendor', 'store'], ['date', 'date'], ['total_cents', 'total', true], ['tax_cents', 'tax', true], ['category', 'category'], ['payment_method', 'how paid'], ['note', 'note']];
const TIP_FIELDS = [['amount_cents', 'amount', true], ['date', 'date'], ['method', 'how paid'], ['job_label', 'job'], ['note', 'note']];
function changes(before, after, fields) {
  if (!before) return '';
  return fields.filter(([k]) => String(before[k] ?? '') !== String(after[k] ?? '')).map(([k, label, cents]) => `${label} ${cents ? money(before[k] || 0) : (before[k] || '(blank)')} → ${cents ? money(after[k] || 0) : (after[k] || '(blank)')}`).join('; ');
}
export async function history(db, item, id, action, detail = '') {
  try { await db.prepare('INSERT INTO money_history (item, item_id, action, detail) VALUES (?1, ?2, ?3, ?4)').bind(item, id, action, String(detail).slice(0, 1000)).run(); } catch { /* table missing before 0019: the change itself still saves */ }
}
export async function historyOf(db, item, id) {
  try { return (await db.prepare('SELECT * FROM money_history WHERE item = ?1 AND item_id = ?2 ORDER BY id DESC').bind(item, id).all()).results || []; } catch { return []; }
}

// ---- Tips (owner-approved 19 Oct 2026) ------------------------------------------------------
// Stored apart from payments (tips table): never on an invoice, never in a balance, never owed.
// Each tip may name a job (its request and/or invoice); that request's card history says so.

async function tipJobs(env) {
  const data = await moneyData(env.DB);
  const requests = await loadRequests(env).catch(() => []);
  const rows = (await moneyJobs(env, data, requests)).filter((r) => r.confirmed);
  const today = chicagoDate();
  const from = shiftDays(today, -90); const to = shiftDays(today, 30);
  return rows.filter((r) => !r.date || (r.date >= from && r.date <= to)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
const shiftDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const jobValue = (r) => `${r.requestKey || ''}|${r.invoiceId || ''}`;
const safeBack = (b) => (/^\/admin\/money(\?[^#\s]*)?$/.test(String(b || '')) ? String(b) : '/admin/money');

export async function tipPage(env, url, id) {
  const jobs = await tipJobs(env);
  const back = safeBack(url.searchParams.get('back'));
  if (id === 'new') {
    const r = String(url.searchParams.get('r') || '');
    return htmlResponse(VM.tipForm({ tip: { id: null, amount_cents: 0, date: chicagoDate(), method: 'cash', note: '' }, jobs, picked: jobs.find((j) => j.requestKey && j.requestKey === r) ? jobValue(jobs.find((j) => j.requestKey === r)) : '', jobValue, back, error: url.searchParams.get('e') || '' }));
  }
  const t = await env.DB.prepare('SELECT * FROM tips WHERE id = ?1').bind(id).first();
  if (!t || t.removed_at) return redirect(`/admin/money?e=${encodeURIComponent('That tip is gone.')}`);
  const picked = `${t.request_key || ''}|${t.invoice_id || ''}`;
  const known = jobs.some((j) => jobValue(j) === picked);
  const list = known || picked === '|' ? jobs : [{ requestKey: t.request_key, invoiceId: t.invoice_id, name: t.job_label || 'The job it was for', date: '', services: [] }, ...jobs];
  return htmlResponse(VM.tipForm({ tip: t, jobs: list, picked, jobValue, back, log: await historyOf(env.DB, 'tip', t.id), error: url.searchParams.get('e') || '' }));
}

export function parseTipForm(form, jobs = []) {
  const amount = toCents(form.get('amount'));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(form.get('date') || '')) ? String(form.get('date')) : chicagoDate();
  const method = Object.keys(M.TIP_METHODS).includes(String(form.get('method'))) ? String(form.get('method')) : 'other';
  // value is "<request key>|<invoice id>"; request keys can hold a "|" themselves.
  const raw = String(form.get('job') || '|'); const cut = raw.lastIndexOf('|');
  const rk = cut < 0 ? raw : raw.slice(0, cut); const iv = cut < 0 ? '' : raw.slice(cut + 1);
  const job = jobs.find((j) => jobValue(j) === `${rk}|${iv}`);
  return { amount_cents: amount, date, method, request_key: rk || null, invoice_id: Number(iv) || null, job_label: job ? `${job.name}${job.date ? ` · ${shortDate(job.date)}` : ''}` : (rk || iv ? String(form.get('job_label') || '') : ''), note: String(form.get('note') || '').trim().slice(0, 500) };
}

export async function saveTip(env, request, id) {
  const form = await request.formData();
  const back = safeBack(form.get('back'));
  const jobs = await tipJobs(env);
  const before = id ? await env.DB.prepare('SELECT * FROM tips WHERE id = ?1 AND removed_at IS NULL').bind(id).first() : null;
  if (id && !before) return redirect(`/admin/money?e=${encodeURIComponent('That tip is gone.')}`);
  const t = parseTipForm(form, before ? [{ requestKey: before.request_key, invoiceId: before.invoice_id, name: before.job_label, date: '' }, ...jobs] : jobs);
  if (before && t.request_key === before.request_key && t.invoice_id === before.invoice_id) t.job_label = before.job_label;
  if (!(t.amount_cents > 0)) return redirect(`/admin/money/tips/${id || 'new'}?back=${encodeURIComponent(back)}&e=${encodeURIComponent('Type the tip amount first.')}`);
  const how = M.TIP_METHODS[t.method];
  if (id) {
    await env.DB.prepare("UPDATE tips SET amount_cents=?1, date=?2, method=?3, request_key=?4, invoice_id=?5, job_label=?6, note=?7, updated_at=datetime('now') WHERE id=?8")
      .bind(t.amount_cents, t.date, t.method, t.request_key, t.invoice_id, t.job_label, t.note, id).run();
    await history(env.DB, 'tip', id, 'changed', changes(before, t, TIP_FIELDS));
    if (t.request_key) await logEvent(env.DB, t.request_key, `Tip changed: ${money(t.amount_cents)} (${how})`, 'admin');
  } else {
    const row = await env.DB.prepare('INSERT INTO tips (amount_cents, date, method, request_key, invoice_id, job_label, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id')
      .bind(t.amount_cents, t.date, t.method, t.request_key, t.invoice_id, t.job_label, t.note).first();
    await history(env.DB, 'tip', row.id, 'recorded', `${money(t.amount_cents)} · ${t.date} · ${how}${t.job_label ? ` · ${t.job_label}` : ''}`);
    if (t.request_key) await logEvent(env.DB, t.request_key, `Tip recorded: ${money(t.amount_cents)} (${how}) on ${t.date}`, 'admin');
  }
  return redirect(`${back}${back.includes('?') ? '&' : '?'}m=${encodeURIComponent(`Tip ${id ? 'changed' : 'recorded'}: ${money(t.amount_cents)} ✓`)}#tips`);
}

export async function removeTip(env, request, id) {
  const form = await request.formData().catch(() => null);
  const back = safeBack(form && form.get('back'));
  const t = await env.DB.prepare('SELECT * FROM tips WHERE id = ?1 AND removed_at IS NULL').bind(id).first();
  if (!t) return redirect(back);
  await env.DB.prepare("UPDATE tips SET removed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1").bind(id).run();
  await history(env.DB, 'tip', id, 'removed', `${money(t.amount_cents)} · ${t.date} · ${M.TIP_METHODS[t.method] || t.method}`);
  if (t.request_key) await logEvent(env.DB, t.request_key, `Tip removed: ${money(t.amount_cents)}`, 'admin');
  return redirect(`${back}${back.includes('?') ? '&' : '?'}m=${encodeURIComponent('Tip removed.')}#tips`);
}

// ---- Damage deposit outcome ----------------------------------------------------------------

export async function depositOutcome(env, request, id) {
  const form = await request.formData();
  const kind = form.get('kind') === 'refund' ? 'refund' : 'deposit_kept';
  const inv = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?1').bind(id).first();
  if (!inv || inv.status === 'void') return redirect(`/admin/invoices/${id}`);
  const { results: lines } = await env.DB.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?1').bind(id).all();
  const r = await recordDepositOutcome(env.DB, inv, lines || [], kind, toCents(form.get('amount')), String(form.get('method') || '').slice(0, 20));
  const msg = r.amount ? `${kind === 'refund' ? 'Refund' : 'Kept for damage'}: $${(r.amount / 100).toFixed(2)} recorded ✓` : 'Nothing recorded: there is no damage deposit left to refund or keep.';
  // The step card's "Deposit returned, finish" comes back to the same card.
  const back = String(form.get('back') || '');
  if (/^\/admin\/#c-[A-Za-z0-9_-]+$/.test(back)) return redirect(`/admin/?m=${encodeURIComponent(msg)}${back.slice(7)}`);
  return redirect(`/admin/invoices/${id}?m=${encodeURIComponent(msg)}`);
}

// ---- Google Sheet sync ---------------------------------------------------------------------

export async function sheetRows(env) {
  const all = await listBookings(env.DB);
  const { ctx } = await contextFor(env.DB, all);
  const statuses = await statusMap(env.DB);
  const bals = await balances(env.DB);
  const bookings = all.map((b) => {
    const c = ctx(b);
    return S.bookingRow(b, { ...c, st: b.request_key ? statuses[b.request_key] : null, invoice: b.invoice_id && bals[b.invoice_id] ? bals[b.invoice_id].invoice : null });
  });
  const { results: ex } = await env.DB.prepare('SELECT * FROM expenses ORDER BY id').all();
  const data = await moneyData(env.DB);
  const years = new Set([chicagoDate().slice(0, 4)]);
  for (const p of data.payments) years.add(String(p.received_on).slice(0, 4));
  for (const b of all) years.add(String(b.date).slice(0, 4));
  const monthly = [...years].filter((y) => /^\d{4}$/.test(y)).sort().flatMap((y) => S.monthlyRows(data, y));
  const { results: site } = await env.DB.prepare("SELECT * FROM requests WHERE source IN ('site', 'phone') ORDER BY submitted_at").all();
  const names = {};
  for (const r of site || []) if (r.referral_code) names[r.referral_code] = r.name;
  const siteRequests = (site || []).map((r) => S.siteRequestRow(r, { status: statuses[r.request_key] ? statuses[r.request_key].status : 'new', referrer: r.referred_by ? (names[r.referred_by] || r.referred_by) : '' }));
  return { bookings, expenses: (ex || []).map(S.expenseRow), monthly, data, siteRequests };
}

export async function syncSheet(env, { client = null, year = null } = {}) {
  const c = client || S.sheetsClient(await accessToken(env, WRITE_SCOPES));
  const rows = await sheetRows(env);
  const b = await S.upsertById(c, S.TABS.bookings, S.BOOKING_HEADER, rows.bookings);
  await S.rewriteTab(c, S.TABS.monthly, S.MONTHLY_HEADER, rows.monthly);
  const e = await S.upsertById(c, S.TABS.expenses, S.EXPENSE_HEADER, rows.expenses);
  const sr = await S.upsertById(c, S.TABS.siteRequests, S.SITE_REQUEST_HEADER, rows.siteRequests);
  if (year) await S.rewriteTab(c, `Year ${year}`, null, S.yearRows(rows.data, year));
  return { bookings: b, expenses: e, siteRequests: sr, months: rows.monthly.length };
}

// Never throws; a failure is queued and the next page shows "Google Sheet will catch up shortly".
export async function syncSafely(env, opts = {}) {
  if (!env.GOOGLE_SA_JSON && !opts.client) return { skipped: 'no Google key on this copy' };
  try {
    const out = await syncSheet(env, opts);
    await env.DB.prepare('DELETE FROM sync_queue').run();
    await putSetting(env.DB, 'sheet_synced_at', new Date().toISOString());
    return { ok: true, ...out };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e).slice(0, 500);
    const row = await env.DB.prepare('SELECT id FROM sync_queue LIMIT 1').first();
    if (row) await env.DB.prepare("UPDATE sync_queue SET tries = tries + 1, last_error = ?1, updated_at = datetime('now') WHERE id = ?2").bind(msg, row.id).run();
    else await env.DB.prepare("INSERT INTO sync_queue (what, last_error) VALUES ('all', ?1)").bind(msg).run();
    return { ok: false, error: msg, status: e && e.status };
  }
}

export async function syncNowRoute(env, url) {
  const year = url.searchParams.get('year') ? okYear(url.searchParams.get('year')) : null;
  const r = await syncSafely(env, { year });
  const back = year ? `/admin/money/year?year=${year}` : '/admin/settings';
  if (r.skipped) return redirect(`${back}${back.includes('?') ? '&' : '?'}e=${encodeURIComponent('The Google key is not set on this copy of the site.')}`);
  return redirect(`${back}${back.includes('?') ? '&' : '?'}${r.ok ? `m=${encodeURIComponent(year ? `The "Year ${year}" tab is written ✓` : 'The Google Sheet is up to date ✓')}` : `e=${encodeURIComponent(`The Google Sheet did not update. It will try again by itself. (${r.error})`)}`}`);
}

export async function syncToken(db) {
  const s = await getSettings(db);
  if (s.sync_token && s.sync_token.length === 64) return s.sync_token;
  const t = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await putSetting(db, 'sync_token', t);
  return t;
}

export async function pendingSync(db) {
  try { const r = await db.prepare('SELECT COUNT(*) AS n FROM sync_queue').first(); return r ? r.n : 0; } catch { return 0; }
}
