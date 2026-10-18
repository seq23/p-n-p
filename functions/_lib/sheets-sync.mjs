// Keeps four tabs of the quote form's Google Sheet up to date (docs/admin-console.md):
// "Bookings" (one row per booking, upserted by Booking ID), "Monthly totals" (rewritten),
// "Expenses" (upserted by Expense ID) and "Year YYYY" (on demand). It writes ONLY those tabs:
// every range goes through rangeFor(), which refuses any other tab, "Form Responses 1" above
// all. As gsc-bot with the spreadsheets scope; the sheet must be shared with it as Editor.
// A failed sync never blocks her: it is queued (sync_queue) and retried on the next admin
// page, by the daily pnp-mailer cron, or by "Update the Google Sheet now" in Settings.
import { SHEET_ID } from './util.mjs';
import { KIND_LABELS } from './kinds.mjs';
import { CATEGORY_KEYS, CATEGORY_LABELS, periodTotals, yearSummary } from './money.mjs';
import { chicagoDayOf } from './calendar.mjs';

export const TABS = { bookings: 'Bookings', monthly: 'Monthly totals', expenses: 'Expenses', siteRequests: 'Site requests' };
const YEAR_TAB = /^Year \d{4}$/;
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export function rangeFor(tab, a1 = '') {
  if (!Object.values(TABS).includes(tab) && !YEAR_TAB.test(tab)) throw new Error(`sheets-sync: refusing to touch tab "${tab}"`);
  return `'${tab.replace(/'/g, "''")}'${a1 ? `!${a1}` : ''}`;
}

export const BOOKING_HEADER = ['Booking ID', 'Date', 'Time', 'Kind', 'Customer', 'Phone', 'Email', 'Items', 'Invoice #', 'Invoice total', 'Paid', 'Still owed', 'Damage deposit', 'Status', 'Returned on', 'Latest note', 'Request key', 'Last updated'];
export const EXPENSE_HEADER = ['Expense ID', 'Date', 'Vendor', 'Category', 'Amount', 'Tax', 'Payment method', 'Note', 'Status', 'Last updated'];
export const MONTHLY_HEADER = ['Month', 'Money received', ...CATEGORY_KEYS.map((k) => CATEGORY_LABELS[k]), 'Damage deposits taken', 'Deposits kept', 'Refunds', 'Jobs', 'Still owed for the month\'s jobs', 'Expenses', 'Left after expenses'];
const d = (c) => (Math.round(c || 0) / 100).toFixed(2);

// ctx: { bal, notes, ret, st } per booking (admin-calendar contextFor + status).
export function bookingRow(b, { bal = null, notes = [], ret = null, st = null, invoice = null } = {}) {
  const isVoid = (bal && bal.void) || (st && st.status === 'void');
  const status = isVoid ? 'Void' : (ret && ret.returned_at ? (ret.damaged ? 'Returned — check damage' : 'Returned') : (st && st.archived_at ? 'Archived' : 'Scheduled'));
  return [
    String(b.id), b.date, b.time || '', KIND_LABELS[b.kind] || b.kind, b.customer_name || '', b.phone || '', b.email || '', b.items || '',
    invoice ? invoice.number : '', bal ? d(bal.total) : '', bal ? d(bal.paid) : '', bal && !bal.void ? d(bal.owed) : '', bal && bal.refundable ? d(bal.refundable) : '',
    status, ret && ret.returned_at ? chicagoDayOf(ret.returned_at) : '', notes[0] ? String(notes[0].body).split('\n')[0].slice(0, 200) : '', b.request_key || '', b.updated_at || '',
  ];
}

// "Site requests": one row per request sent on porchandparty901.com/request, upserted by
// Request key. The ID photo itself never goes to the sheet (it stays in private storage).
export const SITE_REQUEST_HEADER = ['Request key', 'Sent (Memphis time)', 'Services', 'Name', 'Phone', 'Email', 'Date of birth', 'Social media', 'Found us through', 'Answers', 'Photo ID', 'Agreed to rules', 'Rules version', 'Referred by', 'Status', 'Test?'];
export function siteRequestRow(row, { status = '', referrer = '' } = {}) {
  let answers = [];
  try { answers = JSON.parse(row.answers || '[]'); } catch { answers = []; }
  let services = [];
  try { services = JSON.parse(row.services || '[]'); } catch { services = []; }
  return [
    row.request_key, chicagoDayOf(row.submitted_at) + ' ' + chicagoTimeOf(row.submitted_at), services.join(', '), row.name || '', row.phone || '', row.email || '', row.dob || '', row.social || '', row.heard || '',
    answers.map((a) => `${a.label}: ${a.value}`).join(' | ').slice(0, 45000), row.id_deleted_at ? `Deleted ${chicagoDayOf(row.id_deleted_at)}` : (row.id_object ? 'In private storage (open it in the admin console)' : ''),
    row.agreed_at ? `${chicagoDayOf(row.agreed_at)} ${chicagoTimeOf(row.agreed_at)}` : '', row.rules_version || '', referrer, status, row.is_test ? 'yes' : '',
  ];
}
function chicagoTimeOf(utc) {
  const d = new Date(`${String(utc || '').replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
}

export function expenseRow(e) {
  return [String(e.id), e.date, e.vendor, e.category, d(e.total_cents), d(e.tax_cents), e.payment_method || '', e.note || '', e.status === 'saved' ? 'Saved' : 'Needs checking', e.updated_at || ''];
}

export function monthlyRows(data, year) {
  return Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, '0')}`;
    const t = periodTotals(data, m);
    return [m, d(t.received), ...CATEGORY_KEYS.map((k) => d(t.byCategory[k] || 0)), d(t.depositsIn), d(t.kept), d(t.refunds), String(t.jobs), d(t.owed), d(t.expenses), d(t.left)];
  });
}

export function yearRows(data, year) {
  const s = yearSummary(data, year);
  const t = s.total;
  return [
    [`Porch & Party — year-end summary ${year}`], ['Legal entity: Kerseta LLC'], [],
    ['Gross money received', d(t.received)], ['Income (charges)', d(t.revenue)], ['Damage deposits kept for damage (income)', d(t.kept)],
    ['Refunds issued', d(t.refunds)], ['Damage deposits held at year end (not income)', d(s.depositsHeld)], ['Jobs', String(t.jobs)], ['Expenses', d(t.expenses)], [],
    ['Invoice number', 'Date', 'Customer', 'Total', 'Paid'], ...s.list.map((i) => [i.number, i.date, i.customer, d(i.total), d(i.paid)]), [],
    ['Voided invoices', 'Date', 'Customer'], ...s.voided.map((v) => [v.number, v.date, v.customer]), [],
    ['Expense date', 'Vendor', 'Category', 'Amount', 'Tax'], ...t.expenseList.map((e) => [e.date, e.vendor, e.category, d(e.total_cents), d(e.tax_cents)]), [],
    ["Prepared from Porch & Party's admin records for your tax preparer. This is a summary, not tax advice."],
  ];
}

// A tiny client over fetch, so the validator can hand in a fake one.
export function sheetsClient(token, fetchImpl = fetch, sheetId = SHEET_ID) {
  const call = async (method, path, body) => {
    const res = await fetchImpl(`${API}/${sheetId}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(`Google Sheets answered ${res.status}${json.error && json.error.message ? `: ${json.error.message}` : ''}`); e.status = res.status; throw e; }
    return json;
  };
  return {
    async tabs() { const j = await call('GET', '?fields=sheets.properties(sheetId,title)'); return (j.sheets || []).map((x) => x.properties); },
    async ensureTab(title, header) {
      rangeFor(title);
      const tabs = await this.tabs();
      if (tabs.some((t) => t.title === title)) return false;
      const j = await call('POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }] });
      const id = j.replies && j.replies[0] && j.replies[0].addSheet ? j.replies[0].addSheet.properties.sheetId : null;
      if (id !== null) await call('POST', ':batchUpdate', { requests: [{ repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } }] });
      if (header) await this.write(title, 'A1', [header]);
      return true;
    },
    async column(title) { const j = await call('GET', `/values/${encodeURIComponent(rangeFor(title, 'A:A'))}`); return (j.values || []).map((r) => String(r[0] || '')); },
    async write(title, a1, values) { return call('PUT', `/values/${encodeURIComponent(rangeFor(title, a1))}?valueInputOption=USER_ENTERED`, { values }); },
    async batchWrite(title, data) {
      if (!data.length) return null;
      return call('POST', '/values:batchUpdate', { valueInputOption: 'USER_ENTERED', data: data.map((x) => ({ range: rangeFor(title, x.a1), values: x.values })) });
    },
    async append(title, values) { if (!values.length) return null; return call('POST', `/values/${encodeURIComponent(rangeFor(title, 'A1'))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { values }); },
    async clear(title) { return call('POST', `/values/${encodeURIComponent(rangeFor(title, 'A:Z'))}:clear`, {}); },
  };
}

// Upsert rows keyed by their first cell: existing ids are rewritten in place, new ones appended.
export async function upsertById(client, title, header, rows) {
  await client.ensureTab(title, header);
  const ids = await client.column(title);
  const where = new Map(ids.map((id, i) => [id, i + 1]));
  const lastCol = String.fromCharCode(64 + header.length);
  const updates = [{ a1: `A1:${lastCol}1`, values: [header] }];
  const fresh = [];
  for (const r of rows) {
    const at = where.get(String(r[0]));
    if (at && at > 1) updates.push({ a1: `A${at}:${lastCol}${at}`, values: [r] });
    else fresh.push(r);
  }
  await client.batchWrite(title, updates);
  await client.append(title, fresh);
  return { updated: updates.length - 1, appended: fresh.length };
}

export async function rewriteTab(client, title, header, rows) {
  await client.ensureTab(title, header);
  await client.clear(title);
  await client.write(title, 'A1', header ? [header, ...rows] : rows);
}
