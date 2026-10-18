#!/usr/bin/env node
/**
 * Money tab, year-end summary for taxes, expenses with receipts and the Google Sheet sync
 * (docs/admin-console.md), proven on a local SQLite copy of the schema through the real guard
 * and router. Workers AI, R2 and Google Sheets are in-memory stand-ins: nothing leaves the box.
 * Rule 0: zero checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (cond, msg) => { checks += 1; if (!cond) errors.push(msg); };

const M = await mod('functions/_lib/money.mjs');
const X = await mod('functions/_lib/expenses.mjs');
const S = await mod('functions/_lib/sheets-sync.mjs');
const R = await mod('functions/_lib/reminders.mjs');
const Z = await mod('functions/_lib/zip.mjs');
const AM = await mod('functions/_lib/admin-money.mjs');
const { renderYearPdf } = await mod('functions/_lib/pdf-year.mjs');
const { PDFDocument } = await import('pdf-lib');

// ---- Pure money rules ------------------------------------------------------------------
must(R.chicagoDate(new Date('2026-11-01T03:30:00Z')) === '2026-10-31', 'a payment at 10:30 PM Oct 31 in Memphis is not dated Oct 31');
must(R.chicagoDate(new Date('2027-01-01T05:30:00Z')) === '2026-12-31', 'a payment at 11:30 PM Dec 31 in Memphis is not dated 2026');
{
  const invoices = [
    { id: 1, number: 'PNP-2026-0001', customer_name: 'Ann', issue_date: '2026-09-28', status: 'paid', deposit_due_cents: 8500 },
    { id: 2, number: 'PNP-2026-0002', customer_name: 'Bo', issue_date: '2026-10-02', status: 'void', deposit_due_cents: 0 },
    { id: 3, number: 'PNP-2026-0003', customer_name: 'Cy', issue_date: '2026-10-05', status: 'deposit_paid', deposit_due_cents: 10000 },
  ];
  const lines = [
    { invoice_id: 1, description: 'Pick 3 bundle, 1 day: Giant Uno, Giant Checkers, Grab the Mic', qty: 1, unit_cents: 11000, refundable: 0 },
    { invoice_id: 1, description: 'Damage deposit (refundable)', qty: 1, unit_cents: 5000, refundable: 1 },
    { invoice_id: 2, description: 'Porch decorating', qty: 1, unit_cents: 50000, refundable: 0 },
    { invoice_id: 3, description: 'Decor: Birthday party', qty: 1, unit_cents: 15001, refundable: 0 },
    { invoice_id: 3, description: 'Grazing table', qty: 1, unit_cents: 4999, refundable: 0 },
  ];
  const payments = [
    { id: 1, invoice_id: 1, amount_cents: 8000, received_on: '2026-09-30', method: 'zelle', kind: 'payment', note: 'deposit' },
    { id: 2, invoice_id: 1, amount_cents: 8000, received_on: '2026-10-01', method: 'cash', kind: 'payment', note: 'paid in full' },
    { id: 3, invoice_id: 2, amount_cents: 50000, received_on: '2026-10-03', method: 'zelle', kind: 'payment', note: '' },
    { id: 4, invoice_id: 3, amount_cents: 10000, received_on: '2026-10-31', method: 'cashapp', kind: 'payment', note: 'deposit' },
    { id: 5, invoice_id: 1, amount_cents: 3000, received_on: '2026-10-05', method: 'zelle', kind: 'refund', note: 'damage deposit refunded' },
    { id: 6, invoice_id: 1, amount_cents: 2000, received_on: '2026-10-05', method: '', kind: 'deposit_kept', note: 'damage deposit kept for damage' },
  ];
  const bookings = [
    { id: 1, request_key: 'a', kind: 'rental_pickup', date: '2026-10-03', invoice_id: 1, customer_name: 'Ann' },
    { id: 2, request_key: 'b', kind: 'porch_install', date: '2026-10-10', invoice_id: 2, customer_name: 'Bo' },
    { id: 3, request_key: 'c', kind: 'party_setup', date: '2026-10-20', invoice_id: 3, customer_name: 'Cy' },
    { id: 4, request_key: 'c', kind: 'party_takedown', date: '2026-10-21', invoice_id: 3, customer_name: 'Cy' },
  ];
  const data = M.prepare({ invoices, lines, payments, bookings, statuses: [], expenses: [{ id: 1, date: '2026-10-12', vendor: 'Party City', category: 'Supplies & decor', total_cents: 4217, tax_cents: 317 }] });
  const sep = M.periodTotals(data, '2026-09');
  const oct = M.periodTotals(data, '2026-10');
  must(sep.received === 8000 && sep.revenue === 8000 && sep.depositsIn === 0, 'September: the deposit payment should be income (charges first)');
  must(oct.received === 18000 && oct.revenue === 3000 + 10000 && oct.depositsIn === 5000, `October: received ${oct.received}, income ${oct.revenue}, deposits ${oct.depositsIn}`);
  must(!oct.payments.some((p) => p.invoice_id === 2), 'a void invoice payment is counted');
  must(oct.byCategory.rentals === 3000 && oct.byCategory.party + oct.byCategory.grazing === 10000 && Object.values(oct.byCategory).reduce((a, b) => a + b, 0) === oct.revenue, `category split does not add up: ${JSON.stringify(oct.byCategory)}`);
  must(oct.kept === 2000 && oct.refunds === 3000 && oct.depositRefunds === 3000, 'refunds or deposits kept wrong');
  must(oct.jobs === 2 && oct.owed === 10000, `jobs ${oct.jobs} / still owed ${oct.owed} (void excluded, one job per invoice start)`);
  must(oct.expenses === 4217 && oct.left === oct.revenue + oct.kept - 4217, 'expenses or left-after-expenses wrong');
  must(M.depositsHeldAt(data, '2026-10-31') === 0, 'deposits held after refund + kept should be 0');
  const y = M.yearSummary(data, 2026);
  must(y.total.received === y.months.reduce((n, m) => n + m.received, 0), 'year total does not reconcile with the months');
  must(y.voided.length === 1 && y.voided[0].number === 'PNP-2026-0002' && !y.list.some((i) => i.number === 'PNP-2026-0002'), 'void invoices not listed apart');
  const csv = M.yearCsv(y);
  must(csv.charCodeAt(0) === 0xFEFF && csv.includes('Invoice number,Date,Customer,Total,Paid') && csv.includes('Expense date,Vendor,Category,Amount,Tax,Receipt') && csv.includes(M.FOOTER), 'CSV lacks the BOM, its columns or the footer');
  must(/Gross money received,260\.00/.test(csv) && /Damage deposits kept for damage \(income\),20\.00/.test(csv), 'CSV totals wrong');
  const pdf = await renderYearPdf(y);
  const doc = await PDFDocument.load(pdf);
  must(doc.getPageCount() >= 1 && /year-end summary 2026/.test(doc.getTitle()), 'year-end PDF does not render');
  must(!/tax owed|sales tax due|deduction/i.test(csv), 'the summary computes tax or deductions');
  must(M.splitByShare(100, { a: 1, b: 1, c: 1 }, 3).a + M.splitByShare(100, { a: 1, b: 1, c: 1 }, 3).b + M.splitByShare(100, { a: 1, b: 1, c: 1 }, 3).c === 100, 'split by share loses cents');
}

// ---- Receipt extraction parse ------------------------------------------------------------
{
  const bad = X.parseExtraction('I am sorry, I cannot read that');
  must(!bad.ok && bad.total_cents === 0 && bad.vendor === '', 'garbage extraction is not empty');
  const odd = X.parseExtraction('Sure! {"vendor":"Kroger","date":"10/12/2026","total":"$12.50","tax":99,"suggested_category":"food for grazing tables"} thanks');
  must(odd.ok && odd.vendor === 'Kroger' && odd.date === '2026-10-12' && odd.total_cents === 1250 && odd.tax_cents === 0 && odd.category === 'Food for grazing tables', `defensive parse wrong: ${JSON.stringify(odd)}`);
  must(odd.confidence.tax === 0, 'an impossible tax is not marked for checking');
}

// ---- Through the router: expenses, receipts, zip ------------------------------------------
const s = await session();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
{
  const up = await s.upload(PNG, 'image/jpeg');
  must(up.status === 200 && up.json.id && up.json.read, 'receipt upload failed');
  const row = await s.one('SELECT * FROM expenses WHERE id = ?1', up.json.id);
  must(row.status === 'needs_check' && row.vendor === 'Party City' && row.total_cents === 4217, 'an AI-read receipt is not stored as Needs checking with its fields');
  must(s.env.objects.has(row.receipt_key) && /^receipts\/\d{4}\/[a-f0-9]{24}\.jpg$/.test(row.receipt_key), 'receipt original not stored in R2 under a random key');
  must(s.env.aiCalls.length >= 1 && s.env.aiCalls.every((c) => c.model === X.VISION_MODEL), 'receipts went to something other than the Workers AI model');
  const page = (await s.get(`/admin/money/expenses/${up.json.id}`)).text;
  must(page.includes('Please check this') && page.includes('Needs checking'), 'low-confidence field (tax 0.4) is not highlighted');
  const money = (await s.get('/admin/money?month=2026-10')).text;
  must(money.includes('Expenses: $0.00'), 'an unchecked receipt already counts in the totals (auto-saved)');
  await s.post(`/admin/money/expenses/${up.json.id}`, { vendor: 'Party City', date: '2026-10-12', total: '42.17', tax: '3.17', category: 'Supplies & decor', payment_method: 'card', note: '' });
  must((await s.one('SELECT status FROM expenses WHERE id = ?1', up.json.id)).status === 'saved', 'Save does not save');
  must((await s.get('/admin/money?month=2026-10')).text.includes('Expenses: $42.17'), 'a saved expense is not in the month');
  // Workers AI answers { response: {...} } (an object) when the model's text was JSON.
  s.env.aiReply.value = { vendor: 'Sample Party Supply Co', date: '2026-10-12', total: 30.44, tax: 2.7, suggested_category: 'Supplies & decor', confidence: { vendor: 1, date: 1, total: 1, tax: 1 } };
  const obj = await s.upload(PNG, 'image/jpeg');
  const objRow = await s.one('SELECT vendor, total_cents, tax_cents, status FROM expenses WHERE id = ?1', obj.json.id);
  must(obj.json.read && objRow.vendor === 'Sample Party Supply Co' && objRow.total_cents === 3044 && objRow.tax_cents === 270 && objRow.status === 'needs_check', `an object-shaped AI answer is not read: ${JSON.stringify(objRow)}`);
  const lastCall = s.env.aiCalls[s.env.aiCalls.length - 1].input;
  must(Array.isArray(lastCall.image) && lastCall.messages && lastCall.messages.some((m) => m.role === 'user'), 'the vision call does not send the image as bytes with a user message');
  await s.post(`/admin/money/expenses/${obj.json.id}/delete`, {});
  // AI garbage / failure / cap -> empty form with a plain message, nothing breaks.
  s.env.aiReply.value = 'no idea';
  const g = await s.upload(PNG, 'image/jpeg');
  must(g.status === 200 && !g.json.read && /could not make out/.test(g.json.message), 'garbage AI answer does not fall back to typing');
  s.env.aiReply.value = new Error('Capacity temporarily exceeded');
  const f = await s.upload(PNG, 'image/jpeg');
  must(f.status === 200 && /not working right now/.test(f.json.message), 'AI failure does not fall back to typing');
  await s.db.prepare('UPDATE ai_usage SET count = ?1').bind(X.AI_DAILY_CAP).run();
  const before = s.env.aiCalls.length;
  const c = await s.upload(PNG, 'image/jpeg');
  must(c.status === 200 && /done its \d+ receipts for today/.test(c.json.message) && s.env.aiCalls.length === before, 'the daily free-allocation cap is not enforced');
  const pdfUp = await s.upload(Buffer.from('%PDF-1.4 fake'), 'application/pdf');
  must(pdfUp.status === 200, 'PDF receipt upload failed');
  must((await s.upload(Buffer.from('x'), 'text/html')).status === 415, 'a non-receipt file type is accepted');
  // Auth: receipts are never reachable signed out.
  const r1 = await s.get(`/admin/money/expenses/${up.json.id}/receipt`, { auth: false });
  must(r1.status === 303, `a receipt is reachable signed out (${r1.status})`);
  const r2 = await (await mod('scripts/validators/lib/admin_harness.mjs')).call(s.routed, s.env, 'POST', '/api/admin/receipts', { raw: PNG, headers: { 'Content-Type': 'image/jpeg' } });
  must(r2.status === 401, 'receipt upload works signed out');
  must((await s.get(`/admin/money/expenses/${up.json.id}/receipt`)).status === 200, 'the receipt does not open for her');
  // A 2025 receipt must not be in the 2026 zip.
  s.env.aiReply.value = '{"vendor":"Old","date":"2025-12-30","total":5}';
  await s.db.prepare('UPDATE ai_usage SET count = 0').run();
  const old = await s.upload(PNG, 'image/jpeg');
  await s.post(`/admin/money/expenses/${old.json.id}`, { vendor: 'Old', date: '2025-12-30', total: '5', tax: '0', category: 'Other' });
  const zipRes = await (await mod('scripts/validators/lib/admin_harness.mjs')).call(s.routed, s.env, 'GET', '/admin/money/receipts.zip?year=2026', { headers: { Cookie: s.cookie } });
  const entries = Z.readZip(new Uint8Array(await zipRes.arrayBuffer()));
  must(entries.length === 1 && /^2026-10-12-Party-City-\d+\.jpg$/.test(entries[0].name) && entries[0].crcOk, `zip holds ${entries.map((e) => e.name).join(', ')}`);
  // Delete asks first and removes the receipt too.
  await s.post(`/admin/money/expenses/${old.json.id}/delete`, {});
  must(!(await s.one('SELECT id FROM expenses WHERE id = ?1', old.json.id)), 'expense delete did not persist');
  // Category totals reconcile with the year-end summary.
  const data = await AM.moneyData(s.db);
  const y = M.yearSummary(data, 2026);
  must(Object.values(y.total.expenseByCategory).reduce((a, b) => a + b, 0) === y.total.expenses, 'expense categories do not add up to the year total');
  must(y.total.expenses === (await M.periodTotals(data, '2026-10')).expenses, 'year-end expenses do not match the Money tab');
  const yp = (await s.get('/admin/money/year?year=2026')).text;
  must(yp.includes('Kerseta LLC') && yp.includes(M.FOOTER.replace(/&/g, '&amp;').replace(/'/g, '&#39;')) && yp.includes('Download all receipts (zip)'), 'year page lacks the legal entity, footer or zip button');
  const mail = await s.post('/admin/money/year/email?year=2026', {});
  const sent = s.env.sent.find((m) => /year-end summary 2026/.test(m.subject));
  must(sent && sent.attachments.length === 2 && sent.attachments.map((a) => a.type).join(',') === 'application/pdf,text/csv' && /Sent%20to/.test(mail.location), 'year-end email lacks its PDF + CSV attachments');
}

// ---- Damage deposit refund / kept ----------------------------------------------------------
{
  const req = s.requests[0];
  const inv = await s.invoiceFor(req, { go: 'send' });
  await s.post(`/admin/invoices/${inv.id}/status`, { action: 'paid', method: 'zelle' });
  await s.post(`/admin/invoices/${inv.id}/deposit`, { kind: 'deposit_kept', amount: '20.00' });
  await s.post(`/admin/invoices/${inv.id}/deposit`, { kind: 'refund', amount: '999' });
  const rows = await s.all("SELECT kind, amount_cents FROM payments WHERE invoice_id = ?1 AND kind <> 'payment' ORDER BY id", inv.id);
  must(rows.length === 2 && rows[0].amount_cents === 2000 && rows[1].amount_cents === 3000, `deposit outcome rows wrong: ${JSON.stringify(rows)}`);
  const L = await mod('functions/_lib/ledger.mjs');
  must((await L.balances(s.db))[inv.id].owed === 0, 'a deposit refund makes the customer owe again');
}

// ---- Google Sheet sync against an in-memory spreadsheet -----------------------------------
function fakeSheets({ failWith = 0 } = {}) {
  const tabs = new Map([['Form Responses 1', [['Timestamp', 'Email Address'], ['x', 'y']]]]);
  const touched = [];
  const parse = (range) => { const m = decodeURIComponent(range).match(/^'((?:[^']|'')+)'(?:!([A-Z]+)(\d+)?(?::[A-Z]+(\d+)?)?)?/); return { tab: m[1].replace(/''/g, "'"), row: m[3] ? Number(m[3]) : 1 }; };
  const put = (tab, row, values) => { const t = tabs.get(tab); for (let i = 0; i < values.length; i += 1) t[row - 1 + i] = values[i]; };
  const fetchImpl = async (url, init) => {
    if (failWith) return new Response(JSON.stringify({ error: { message: 'The caller does not have permission' } }), { status: failWith });
    const u = new URL(url); const p = decodeURIComponent(u.pathname.split('/spreadsheets/')[1].replace(/^[^/:]+/, ''));
    const body = init.body ? JSON.parse(init.body) : {};
    const ok = (j) => new Response(JSON.stringify(j), { status: 200 });
    if (init.method === 'GET' && p === '') return ok({ sheets: [...tabs.keys()].map((title, i) => ({ properties: { sheetId: i, title } })) });
    if (p === ':batchUpdate') { const add = body.requests.find((r) => r.addSheet); if (add) { tabs.set(add.addSheet.properties.title, []); touched.push(add.addSheet.properties.title); return ok({ replies: [{ addSheet: { properties: { sheetId: tabs.size - 1 } } }] }); } return ok({}); }
    if (p === '/values:batchUpdate') { for (const d of body.data) { const r = parse(d.range); touched.push(r.tab); put(r.tab, r.row, d.values); } return ok({}); }
    const m = p.match(/^\/values\/(.+?)(:append|:clear)?$/);
    const r = parse(m[1]); touched.push(r.tab);
    if (m[2] === ':append') { tabs.get(r.tab).push(...body.values); return ok({}); }
    if (m[2] === ':clear') { tabs.set(r.tab, []); return ok({}); }
    if (init.method === 'PUT') { put(r.tab, r.row, body.values); return ok({}); }
    return ok({ values: (tabs.get(r.tab) || []).map((row) => [row[0]]) });
  };
  return { tabs, touched, fetchImpl };
}
{
  await s.post('/admin/calendar/bookings', { kind: 'grazing_setup', date: '2026-11-07', customer_name: 'Gia Graze', phone: '901', email: '', place: 'Oak St', items: 'Grazing table', note: 'Side gate' });
  const sheet = fakeSheets();
  const client = S.sheetsClient('tok', sheet.fetchImpl, 'SHEET');
  const r1 = await AM.syncSafely(s.env, { client });
  must(r1.ok, `sync failed: ${r1.error}`);
  const book = sheet.tabs.get('Bookings');
  must(book && book[0].join('|') === S.BOOKING_HEADER.join('|'), 'Bookings tab header wrong or missing');
  const n = (await s.all('SELECT id FROM bookings')).length;
  must(book.length === n + 1, `Bookings tab has ${book.length - 1} rows for ${n} bookings`);
  const gia = book.find((r) => r[4] === 'Gia Graze');
  must(gia && gia[3] === 'Grazing table setup' && gia[1] === '2026-11-07' && gia[15] === 'Side gate' && gia[13] === 'Scheduled', `booking row mapping wrong: ${JSON.stringify(gia)}`);
  const r2 = await AM.syncSafely(s.env, { client });
  must(r2.ok && sheet.tabs.get('Bookings').length === n + 1 && r2.bookings.appended === 0, 'a second sync duplicated rows (upsert by ID broken / not idempotent)');
  must(sheet.tabs.get('Form Responses 1').length === 2 && !sheet.touched.includes('Form Responses 1'), 'the sync touched Form Responses 1');
  must(sheet.touched.every((t) => ['Bookings', 'Monthly totals', 'Expenses', 'Site requests'].includes(t)), `the sync wrote other tabs: ${[...new Set(sheet.touched)].join(', ')}`);
  const site = sheet.tabs.get('Site requests');
  must(site && site[0].join('|') === S.SITE_REQUEST_HEADER.join('|'), 'Site requests tab header wrong or missing');
  must((sheet.tabs.get('Monthly totals') || []).some((r) => r[0] === '2026-10') && (sheet.tabs.get('Expenses') || []).length >= 2, 'Monthly totals or Expenses tab missing rows');
  let refused = false;
  try { S.rangeFor('Form Responses 1', 'A1'); } catch { refused = true; }
  must(refused, 'rangeFor allows the form responses tab');
  await AM.syncSafely(s.env, { client, year: '2026' });
  must((sheet.tabs.get('Year 2026') || []).some((r) => /year-end summary 2026/.test(r[0] || '')), 'Year 2026 tab not written on demand');
  // Failure queues a retry and the next page says so; a later success clears it.
  const broken = S.sheetsClient('tok', fakeSheets({ failWith: 403 }).fetchImpl, 'SHEET');
  const r3 = await AM.syncSafely(s.env, { client: broken });
  must(!r3.ok && (await AM.pendingSync(s.db)) === 1, 'a failed sync is not queued');
  const routedWithKey = { ...s.env };
  const page = await (await mod('scripts/validators/lib/admin_harness.mjs')).call((ctx) => s.routed({ ...ctx, waitUntil: () => {} }), routedWithKey, 'GET', '/admin/calendar', { headers: { Cookie: s.cookie } });
  must((await page.text()).includes('Google Sheet will catch up shortly.'), 'no "Google Sheet will catch up shortly" notice while a sync waits');
  await AM.syncSafely(s.env, { client });
  must((await AM.pendingSync(s.db)) === 0, 'a successful sync does not clear the retry queue');
  // The cron's hook: wrong token 404, POST only.
  const { handleSync } = await mod('functions/_lib/sync-route.mjs');
  const tok = (await s.one("SELECT value FROM settings WHERE key = 'sync_token'")).value;
  must(/^[a-f0-9]{64}$/.test(tok), 'migration 0005 did not make a sync token');
  const hook = (t, method = 'POST') => handleSync({ request: new Request(`https://porchandparty901.com/api/sync/${t}`, { method }), env: s.env, params: { token: t } });
  must((await hook('0'.repeat(64))).status === 404 && (await hook(tok, 'GET')).status === 405 && (await hook(tok)).status === 200, 'sync hook: wrong token / method / right token answers wrong');
  const worker = fs.readFileSync(path.join(ROOT, 'workers/pnp-mailer/src/index.js'), 'utf8');
  must(/askForSheetResync/.test(worker) && /\/api\/sync\//.test(worker), 'the daily cron does not ask for the full sheet resync');
}

if (checks === 0) errors.push('Rule 0: no checks ran');
if (errors.length) {
  console.error(`VALIDATION FAIL: admin money (${errors.length} of ${checks} checks)`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`validate_admin_money: OK (${checks} checks: Memphis month/year boundaries, deposits apart from income, void excluded, categories reconcile, CSV/PDF, receipts never auto-saved, AI fallback + cap, R2 private, zip, sheet sync upsert/idempotent/never other tabs/retry)`);
