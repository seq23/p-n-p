#!/usr/bin/env node
/**
 * The calm Money tab (owner-approved 19 Oct 2026; functions/_lib/money.mjs jobRows / viewRows /
 * moneySummary, views-money.mjs, admin-money.mjs tips + history, weekly.mjs).
 *  1. By month vs All jobs: a month shows only its jobs; All jobs shows every job, Upcoming
 *     (nearest first) then Past (newest first). Void jobs never show.
 *  2. Include unconfirmed jobs (default off): unconfirmed rows only when ticked, dashed and
 *     labelled "Not confirmed"; their price only in "Expected if confirmed", never in Money in or
 *     Still owed.
 *  3. Leave out refundable deposits (default on): Money in and job totals leave the damage
 *     deposit out; unticked they include it, labelled "deposit (given back later)"; a deposit is
 *     never owed.
 *  4. Tips: stored apart, totalled as their own line, on the job row and the request history,
 *     never in an invoice balance, never owed, never on the invoice; changed/removed with history.
 *  5. Expenses: added by hand, changed and deleted with history; the list follows the view;
 *     "Check N receipts" when receipts wait.
 *  6. The Monday summary's last-week money line carries tips as a separate figure.
 *  7. The view lives in the URL; nothing that was on Money before is missing.
 * Rule 0: fewer than 80 checks is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const M = await mod('functions/_lib/money.mjs');
const AM = await mod('functions/_lib/admin-money.mjs');
const L = await mod('functions/_lib/ledger.mjs');
const W = await mod('functions/_lib/weekly.mjs');
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

// ---- 1-3. Pure rules over a hand-made ledger ------------------------------------------------
{
  const invoices = [
    { id: 1, number: 'PNP-2026-0101', customer_name: 'Ann Able', status: 'paid' },
    { id: 2, number: 'PNP-2026-0102', customer_name: 'Bo Brown', status: 'sent' },
    { id: 3, number: 'PNP-2026-0103', customer_name: 'Cy Void', status: 'void' },
  ];
  const lines = [
    { invoice_id: 1, description: 'Pick 3 bundle, 1 day', qty: 1, unit_cents: 11000, refundable: 0 },
    { invoice_id: 1, description: 'Damage deposit (refundable)', qty: 1, unit_cents: 5000, refundable: 1 },
    { invoice_id: 2, description: 'Porch decorating', qty: 1, unit_cents: 30000, refundable: 0 },
    { invoice_id: 3, description: 'Decor: Birthday party', qty: 1, unit_cents: 9900, refundable: 0 },
  ];
  const payments = [
    { id: 1, invoice_id: 1, amount_cents: 11000, received_on: '2026-10-02', method: 'zelle', kind: 'payment', note: 'deposit' },
    { id: 2, invoice_id: 1, amount_cents: 5000, received_on: '2026-10-03', method: 'cash', kind: 'payment', note: 'paid in full' },
    { id: 3, invoice_id: 3, amount_cents: 9900, received_on: '2026-10-09', method: 'zelle', kind: 'payment', note: '' },
  ];
  const bookings = [
    { id: 1, request_key: 'a', kind: 'rental_pickup', date: '2026-10-03', invoice_id: 1, customer_name: 'Ann Able' },
    { id: 2, request_key: 'a', kind: 'rental_return', date: '2026-10-04', invoice_id: 1, customer_name: 'Ann Able' },
    { id: 3, request_key: 'b', kind: 'porch_install', date: '2026-10-24', invoice_id: 2, customer_name: 'Bo Brown' },
    { id: 4, request_key: 'c', kind: 'party_setup', date: '2026-10-10', invoice_id: 3, customer_name: 'Cy Void' },
    { id: 5, request_key: 'd', kind: 'rental_pickup', date: '2026-11-05', invoice_id: null, customer_name: 'Di Dunn' },
    { id: 6, request_key: null, kind: 'grazing_setup', date: '2026-09-20', invoice_id: null, customer_name: 'Dee Phone' },
  ];
  const statuses = [{ request_key: 'a', status: 'paid', invoice_id: 1 }, { request_key: 'b', status: 'invoiced', invoice_id: 2 }, { request_key: 'c', status: 'void', invoice_id: 3 }, { request_key: 'd', status: 'scheduled' }];
  const requests = [
    { key: 'a', name: 'Ann Able', services: ['rentals'] }, { key: 'b', name: 'Bo Brown', services: ['porch'] }, { key: 'c', name: 'Cy Void', services: ['party'] },
    { key: 'd', name: 'Di Dunn', services: ['rentals'] },
    { key: 'e', name: 'Eve Early', services: ['party'], rentals: [], decor: [{ label: 'Event date', value: '2026-10-28' }], other: [] },
  ];
  const tips = [
    { id: 1, amount_cents: 2000, date: '2026-10-04', method: 'cash', request_key: 'a', invoice_id: 1 },
    { id: 2, amount_cents: 1500, date: '2026-11-06', method: 'zelle', request_key: 'd', invoice_id: null },
    { id: 3, amount_cents: 900, date: '2026-10-05', method: 'cash', request_key: 'a', invoice_id: 1, removed_at: '2026-10-06 10:00:00' },
  ];
  const data = M.prepare({ invoices, lines, payments, bookings, statuses, expenses: [{ id: 1, date: '2026-10-12', total_cents: 4000, category: 'Other' }, { id: 2, date: '2026-09-01', total_cents: 700, category: 'Other' }], tips });
  const unconfirmed = new Set(['b', 'e']);
  const rows = M.jobRows(data, { requests, unconfirmed });
  const by = (k) => rows.find((r) => r.key === k);
  must(!rows.some((r) => r.name === 'Cy Void'), 'a void job is listed');
  must(rows.length === 5 && by('r:a') && by('r:b') && by('r:d') && by('r:e') && rows.some((r) => r.name === 'Dee Phone'), `job rows wrong: ${rows.map((r) => r.key).join(',')}`);
  const a = by('r:a');
  must(a.date === '2026-10-03' && a.charges === 11000 && a.refundable === 5000 && a.paidCharges === 11000 && a.paidDeposit === 5000 && a.owed === 0 && a.tips === 2000 && a.confirmed, `Ann's row wrong: ${JSON.stringify(a)}`);
  must(a.services.includes('rentals'), 'a job row lacks its service');
  const b = by('r:b');
  must(!b.confirmed && b.owed === 0 && b.expected === 30000 && b.date === '2026-10-24', `unconfirmed Bo is counted as owed or lacks expected: ${JSON.stringify(b)}`);
  const e = by('r:e');
  must(!e.confirmed && e.date === '2026-10-28' && !e.hasPrice && e.expected === 0, `an unconfirmed request with no booking has no asked-for date: ${JSON.stringify(e)}`);
  must(by('r:d').tips === 1500 && by('r:d').confirmed, 'a tip for a job with no invoice is not on its row');
  must(rows.reduce((n, r) => n + r.tips, 0) === 3500, 'a removed tip still counts on a job row');

  // 1. Month vs all.
  const oct = M.viewRows(rows, { view: 'month', month: '2026-10', today: '2026-10-19' });
  must(oct.list.map((r) => r.key).join() === 'r:a', `October (unconfirmed off) should be Ann only: ${oct.list.map((r) => r.key)}`);
  const octU = M.viewRows(rows, { view: 'month', month: '2026-10', today: '2026-10-19', includeUnconfirmed: true });
  must(octU.list.map((r) => r.key).join() === 'r:a,r:b,r:e', `October with unconfirmed: ${octU.list.map((r) => r.key)}`);
  const nov = M.viewRows(rows, { view: 'month', month: '2026-11', today: '2026-10-19', includeUnconfirmed: true });
  must(nov.list.map((r) => r.key).join() === 'r:d', 'November shows a job from another month');
  const allV = M.viewRows(rows, { view: 'all', today: '2026-10-19' });
  must(allV.upcoming.map((r) => r.key).join() === 'r:d' && allV.past.map((r) => r.name).join() === 'Ann Able,Dee Phone', `All jobs grouping wrong: up ${allV.upcoming.map((r) => r.key)} past ${allV.past.map((r) => r.name)}`);
  const allU = M.viewRows(rows, { view: 'all', today: '2026-10-19', includeUnconfirmed: true });
  must(allU.upcoming.map((r) => r.key).join() === 'r:b,r:e,r:d', `Upcoming is not nearest first: ${allU.upcoming.map((r) => r.key)}`);
  must(allU.list.length === 5 && allV.list.length === 3, 'All jobs does not show every job');

  // 2-3. The summary.
  const s0 = M.moneySummary(data, rows, { view: 'month', month: '2026-10', today: '2026-10-19' });
  const sU = M.moneySummary(data, rows, { view: 'month', month: '2026-10', today: '2026-10-19', includeUnconfirmed: true });
  const sD = M.moneySummary(data, rows, { view: 'month', month: '2026-10', today: '2026-10-19', includeDeposits: true });
  const sDU = M.moneySummary(data, rows, { view: 'month', month: '2026-10', today: '2026-10-19', includeDeposits: true, includeUnconfirmed: true });
  must(s0.moneyIn === 11000, `Money in with deposits left out should be 110.00 (void excluded), got ${s0.moneyIn}`);
  must(sD.moneyIn === 16000 && sD.depositsIn === 5000, `Money in with deposits counted should be 160.00, got ${sD.moneyIn}`);
  must(sU.moneyIn === s0.moneyIn && sDU.moneyIn === sD.moneyIn, 'ticking unconfirmed changed Money in (mixed into received)');
  must(sU.owed === s0.owed && s0.owed === 0, 'an unconfirmed job is counted in Still owed');
  must(sU.expected === 30000 && s0.expected === 0, `Expected if confirmed should be 300.00 only when ticked (${sU.expected}/${s0.expected})`);
  must(s0.tips === 2000 && sD.tips === 2000 && s0.moneyIn + s0.tips !== s0.moneyIn, 'tips are not their own October line');
  must(s0.expenses === 4000 && s0.left === 11000 + 2000 - 4000, `left after expenses (money in + tips - expenses) wrong: ${s0.left}`);
  must(s0.t.received === 16000 && s0.t.tips === 2000 && !s0.t.payments.some((p) => p.amount_cents === 2000), 'a tip leaked into payments received');
  const sAll = M.moneySummary(data, rows, { view: 'all', today: '2026-10-19', includeUnconfirmed: true });
  must(sAll.tips === 3500 && sAll.expenses === 4700 && sAll.expected === 30000 && sAll.moneyIn === 11000, `All jobs summary wrong: ${JSON.stringify({ t: sAll.tips, e: sAll.expenses, x: sAll.expected, m: sAll.moneyIn })}`);
  // A deposit is never owed: half-paid invoice with a deposit line.
  const half = M.prepare({ invoices: [{ id: 9, number: 'N', customer_name: 'Hal', status: 'deposit_paid' }], lines: [{ invoice_id: 9, description: 'Pick 3 bundle', qty: 1, unit_cents: 11000, refundable: 0 }, { invoice_id: 9, description: 'Damage deposit', qty: 1, unit_cents: 5000, refundable: 1 }], payments: [{ id: 1, invoice_id: 9, amount_cents: 11000, received_on: '2026-10-02', kind: 'payment' }], bookings: [{ id: 1, request_key: 'h', kind: 'rental_pickup', date: '2026-10-05', invoice_id: 9 }], statuses: [{ request_key: 'h', invoice_id: 9 }] });
  const hr = M.jobRows(half, { requests: [{ key: 'h', name: 'Hal', services: ['rentals'] }] })[0];
  must(hr.owed === 0 && M.moneySummary(half, [hr], { view: 'month', month: '2026-10', includeDeposits: true }).owed === 0, 'an uncollected damage deposit is counted as owed');
}

// ---- 4-7. End to end through the real guard + router -----------------------------------------
const s = await session();
const db = s.db;
const reqA = s.requests.find((r) => r.email === 'test.renter@example.com');
const reqB = s.requests.find((r) => r.email === 'weekend.renter@example.com');
const invA = await s.invoiceFor(reqA, { go: 'send' });
const invB = await s.invoiceFor(reqB, { go: 'send' });
await s.post(`/admin/invoices/${invA.id}/status`, { action: 'paid', method: 'zelle' }); // paid in full: confirmed, deposit collected
const data0 = await AM.moneyData(db);
const rows0 = await AM.moneyJobs(s.env, data0, s.requests);
const rowA = rows0.find((r) => r.requestKey === reqA.key);
const rowB = rows0.find((r) => r.requestKey === reqB.key);
must(rowA && rowA.confirmed && rowA.refundable > 0 && rowA.paidDeposit === rowA.refundable, `the paid-in-full rental is not a confirmed job with its deposit collected: ${JSON.stringify(rowA)}`);
must(rowB && !rowB.confirmed && rowB.expected > 0, 'a sent-but-not-confirmed invoice is not an unconfirmed job (steps.mjs rule)');
const monthA = String(rowA.date).slice(0, 7);
const today = (await mod('functions/_lib/reminders.mjs')).chicagoDate();
const jobsOf = (html) => html.slice(html.indexOf('data-jobs>'), html.indexOf('id="tips"'));
const fig = (html, what) => ((html.match(new RegExp(`data-total="${what}">([^<]+)<`)) || [])[1] || '');
const usd = (c) => `$${(c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

const allOff = (await s.get('/admin/money?view=all')).text;
const allOn = (await s.get('/admin/money?view=all&unconf=1')).text;
must(jobsOf(allOff).includes(reqA.name) && !jobsOf(allOff).includes(reqB.name), 'All jobs (unconfirmed off) does not show the confirmed job only');
must(jobsOf(allOn).includes(reqB.name) && /data-confirmed="0"[\s\S]{0,600}data-not-confirmed>Not confirmed/.test(jobsOf(allOn)) && /class="job unconf"/.test(allOn), 'ticked, the unconfirmed job is not shown dashed with "Not confirmed"');
must(fig(allOn, 'expected') === usd(rowB.expected) && !allOff.includes('data-expected'), `"Expected if confirmed" is wrong or shows unticked (${fig(allOn, 'expected')} vs ${usd(rowB.expected)})`);
must(fig(allOn, 'received') === fig(allOff, 'received') && fig(allOn, 'owed') === fig(allOff, 'owed'), 'ticking unconfirmed changed Money in or Still owed');
must(/<input type="checkbox" name="unconf" value="1" checked/.test(allOn) && !/name="unconf" value="1" checked/.test(allOff), 'the unconfirmed tick box does not reflect the URL');
must(/data-group="upcoming"|data-group="past"/.test(allOff), 'All jobs is not grouped Upcoming / Past');
// Month filter on the page.
const inMonth = (await s.get(`/admin/money?month=${monthA}`)).text;
const otherMonth = M.periodTotals ? (await s.get(`/admin/money?month=${monthA === '2020-01' ? '2020-02' : '2020-01'}`)).text : '';
must(jobsOf(inMonth).includes(reqA.name) && !jobsOf(otherMonth).includes(reqA.name), 'By month does not filter jobs to the month');
// Deposits toggle.
const depOut = (await s.get(`/admin/money?month=${today.slice(0, 7)}`)).text;
const depIn = (await s.get(`/admin/money?month=${today.slice(0, 7)}&deposits=in`)).text;
const depInForm = (await s.get(`/admin/money?month=${today.slice(0, 7)}&f=1`)).text; // the tick box unticked
const depOutForm = (await s.get(`/admin/money?month=${today.slice(0, 7)}&f=1&deposits=out`)).text;
const cents = (v) => Math.round(Number(String(v).replace(/[$,]/g, '')) * 100);
must(cents(fig(depIn, 'received')) - cents(fig(depOut, 'received')) === rowA.paidDeposit, `deposits toggle math: in ${fig(depIn, 'received')} out ${fig(depOut, 'received')} deposit ${rowA.paidDeposit}`);
must(fig(depInForm, 'received') === fig(depIn, 'received') && fig(depOutForm, 'received') === fig(depOut, 'received'), 'the unticked deposits box (form submit) does not read as "include"');
must(/name="deposits" value="out" checked/.test(depOut) && !/name="deposits" value="out" checked/.test(depIn), 'the deposits tick box is not on by default / does not follow the URL');
must(depIn.includes('deposit (given back later)') && /Damage deposits \(\$50\) are given back, so they are not your money/.test(depOut), 'deposits are not labelled "given back later" when counted, or the box lacks its explanation');
must(fig(depIn, 'owed') === fig(depOut, 'owed'), 'counting deposits changed Still owed (a deposit is never owed)');
// The view stays in the URL: links carry it.
const kept = (await s.get(`/admin/money?month=${today.slice(0, 7)}&unconf=1&deposits=in`)).text;
must(/href="\/admin\/money\?view=all&amp;unconf=1&amp;deposits=in"/.test(kept) && /aria-label="Next month"/.test(kept) && new RegExp(`href="/admin/money\\?month=[0-9-]+&amp;unconf=1&amp;deposits=in" aria-label="Previous month"`).test(kept), 'the view switch or month arrows lose the tick boxes');
must(/<input type="hidden" name="f" value="1">/.test(kept) && /onchange="this.form.submit\(\)"/.test(kept), 'the tick boxes do not submit themselves into the URL');

// 4. Tips.
const balBefore = (await L.balances(db))[invA.id];
const npBefore = (await s.get('/admin/money')).text.match(/data-not-paid-total>[^<]*/);
const add = await s.post('/admin/money/tips', { amount: '7.77', date: today, method: 'cashapp', job: `${reqA.key}|${invA.id}`, note: 'for the kids', back: '/admin/money?view=all' });
const tipRow = await s.one('SELECT * FROM tips ORDER BY id DESC LIMIT 1');
must(add.status === 303 && /^\/admin\/money\?view=all&m=Tip%20recorded/.test(add.location), `recording a tip did not come back to Money (${add.location})`);
must(tipRow && tipRow.amount_cents === 777 && tipRow.method === 'cashapp' && tipRow.request_key === reqA.key && tipRow.invoice_id === invA.id && tipRow.date === today && tipRow.note === 'for the kids' && /\S/.test(tipRow.job_label), `tip not stored apart with its fields: ${JSON.stringify(tipRow)}`);
must(!(await s.one('SELECT COUNT(*) AS n FROM payments WHERE amount_cents = 777')).n, 'a tip was written as a payment');
const balAfter = (await L.balances(db))[invA.id];
must(JSON.stringify(balAfter) === JSON.stringify(balBefore), 'a tip changed the invoice balance');
must(!(await s.get(`/admin/invoices/${invA.id}`)).text.includes('$7.77'), 'a tip shows on the invoice');
const pageAll = (await s.get('/admin/money?view=all')).text;
must(fig(pageAll, 'tips') === '$7.77' && /data-tips-total>\$7\.77</.test(pageAll) && /data-tip-row>[\s\S]{0,200}Cash App/.test(pageAll), 'the tip is not totalled as its own line with its row');
must(/<dt>Tips<\/dt><dd class="">\$7\.77<\/dd>/.test(jobsOf(pageAll).slice(jobsOf(pageAll).indexOf(reqA.name))), 'the tip is not on its job row');
must(fig(pageAll, 'received') === fig(allOff, 'received') && fig(pageAll, 'owed') === fig(allOff, 'owed'), 'a tip changed Money in or Still owed');
must(JSON.stringify((await s.get('/admin/money')).text.match(/data-not-paid-total>[^<]*/)) === JSON.stringify(npBefore), 'a tip changed Not paid yet');
must((await s.all('SELECT what FROM request_events WHERE request_key = ?1', reqA.key)).some((x) => /Tip recorded: \$7\.77 \(Cash App\)/.test(x.what)), 'the tip is not in the request card history');
const ed = await s.post(`/admin/money/tips/${tipRow.id}`, { amount: '8', date: today, method: 'cash', job: `${reqA.key}|${invA.id}`, note: 'for the kids', back: '/admin/money?view=all' });
must(ed.status === 303 && (await s.one('SELECT amount_cents, method FROM tips WHERE id = ?1', tipRow.id)).amount_cents === 800, 'changing a tip does not save');
const tipPage = (await s.get(`/admin/money/tips/${tipRow.id}`)).text;
must(/data-history>[\s\S]*changed[\s\S]*amount \$7\.77 → \$8\.00[\s\S]*recorded/.test(tipPage), 'a changed tip has no history (old → new, then recorded)');
must(/data-tip-form/.test(tipPage) && /name="method" value="cash" checked/.test(tipPage) && /Remove this tip/.test(tipPage), 'the tip page does not show the saved tip with Remove');
const bad = await s.post('/admin/money/tips', { amount: '0', date: today, method: 'cash', job: '|', back: '/admin/money' });
must(bad.status === 303 && /\/admin\/money\/tips\/new\?.*e=Type/.test(bad.location) && (await s.one('SELECT COUNT(*) AS n FROM tips')).n === 1, 'a $0 tip is saved');
const evil = await s.post('/admin/money/tips', { amount: '1', date: today, method: 'other', job: '|', back: 'https://evil.example/x' });
must(evil.location.startsWith('/admin/money?'), `a tip's back link can leave the console (${evil.location})`);
const evilId = (await s.one('SELECT MAX(id) AS id FROM tips')).id;
must(!(await s.one('SELECT request_key, invoice_id FROM tips WHERE id = ?1', evilId)).request_key, 'a tip for no job was tied to a job');
const rm = await s.post(`/admin/money/tips/${tipRow.id}/delete`, { back: '/admin/money?view=all' });
const gone = await s.one('SELECT removed_at FROM tips WHERE id = ?1', tipRow.id);
must(rm.status === 303 && gone.removed_at, 'removing a tip does not mark it removed (the row must stay for history)');
must(fig((await s.get('/admin/money?view=all')).text, 'tips') === '$1.00', 'a removed tip still counts');
must((await s.all("SELECT action FROM money_history WHERE item = 'tip' AND item_id = ?1 ORDER BY id", tipRow.id)).map((x) => x.action).join() === 'recorded,changed,removed', 'tip history is not recorded, changed, removed');
must((await s.get(`/admin/money/tips/${tipRow.id}`)).status === 303, 'a removed tip still opens as editable');
const newTip = (await s.get(`/admin/money/tips/new?r=${encodeURIComponent(reqA.key)}`)).text;
must(new RegExp(`<input id="t-date" name="date" type="date" value="${today}"`).test(newTip) && /name="method" value="cash" checked/.test(newTip) && ['Cash', 'Zelle', 'Cash App', 'Other'].every((l) => newTip.includes(`>${l}</label>`)) && /<select id="t-job" name="job"[^>]*><option value="\|">Not for a particular job/.test(newTip) && /selected>/.test(newTip), 'the Record a tip form lacks amount/date today/how paid/optional job (picked from ?r=)/note');

// 5. Expenses by hand, with history; the list follows the view; "Check N receipts".
const ex = await s.post('/admin/money/expenses', { vendor: 'Dollar Tree', date: '2026-09-15', total: '12.50', tax: '1', category: 'Other', payment_method: '', note: 'balloons' });
const exRow = await s.one("SELECT * FROM expenses WHERE vendor = 'Dollar Tree'");
must(ex.status === 303 && exRow && exRow.status === 'saved' && exRow.total_cents === 1250, 'an expense added by hand is not saved');
await s.post(`/admin/money/expenses/${exRow.id}`, { vendor: 'Dollar Tree', date: '2026-09-15', total: '13.75', tax: '1', category: 'Other', payment_method: '', note: 'balloons' });
const exPage = (await s.get(`/admin/money/expenses/${exRow.id}`)).text;
must(/data-history>[\s\S]*changed[\s\S]*total \$12\.50 → \$13\.75[\s\S]*added by hand/.test(exPage), 'a changed expense has no history');
const sep = (await s.get('/admin/money?month=2026-09')).text;
const octP = (await s.get('/admin/money?month=2026-10')).text;
must(/data-expense-row>[\s\S]{0,120}Dollar Tree/.test(sep) && !octP.includes('Dollar Tree') && /Dollar Tree/.test((await s.get('/admin/money?view=all')).text), 'the expenses list does not follow By month / All jobs');
must(/href="\/admin\/money\/expenses\/new"[^>]*>\+ Add an expense</.test(sep) && /<label class="btn ghost"[^>]*>Upload a receipt<input id="receipt-input" type="file" accept="image\/\*,application\/pdf"/.test(sep), 'Expenses lacks "+ Add an expense" and "Upload a receipt"');
await s.post(`/admin/money/expenses/${exRow.id}/delete`, {});
must(!(await s.one('SELECT id FROM expenses WHERE id = ?1', exRow.id)) && (await s.all("SELECT action FROM money_history WHERE item = 'expense' AND item_id = ?1", exRow.id)).map((x) => x.action).join() === 'added by hand,changed,deleted', 'a deleted expense leaves no history');
await db.prepare("INSERT INTO expenses (vendor, date, total_cents, category, status) VALUES ('Wait1', '2026-10-01', 100, 'Other', 'needs_check'), ('Wait2', '2026-10-01', 100, 'Other', 'needs_check')").run();
must(/data-check-receipts><span>Check 2 receipts</.test((await s.get('/admin/money')).text), 'waiting receipts are not shown as "Check 2 receipts"');

// 6. The Monday summary: tips as their own figure on the last-week money line.
await db.prepare("INSERT INTO payments (invoice_id, amount_cents, received_on, method, note, kind) VALUES (?1, 4400, '2026-10-14', 'zelle', 'x', 'payment')").bind(invB.id).run();
await db.prepare("INSERT INTO tips (amount_cents, date, method) VALUES (2500, '2026-10-15', 'cash'), (600, '2026-10-20', 'cash')").run();
await db.prepare("INSERT INTO tips (amount_cents, date, method, removed_at) VALUES (999, '2026-10-16', 'cash', datetime('now'))").run();
const wd = await W.weeklyData(db, '2026-10-19');
const TD = await mod('functions/_lib/todo-email.mjs');
const wk = TD.renderTodo(await TD.todoData(db, '2026-10-19'));
const paidLast = (await s.one("SELECT SUM(amount_cents) AS c FROM payments WHERE voided_at IS NULL AND kind = 'payment' AND received_on BETWEEN '2026-10-12' AND '2026-10-18'")).c || 0;
const tipsLast = (await s.one("SELECT SUM(amount_cents) AS c FROM tips WHERE removed_at IS NULL AND date BETWEEN '2026-10-12' AND '2026-10-18'")).c || 0;
must(wd.last.tips === tipsLast && wd.last.received === paidLast, `weekly last-week tips ${wd.last.tips} (want ${tipsLast}) / received ${wd.last.received} (want ${paidLast}; tips never in it)`);
const u0 = (c) => usd(c).replace(/\.00$/, '');
must(wk.text.includes(`- Money in last week: ${u0(paidLast)}\n- Tips: ${u0(tipsLast)}\n`) && wk.html.includes(`Money in last week</td><td style="padding:4px 0;border-bottom:1px solid #ece4da;text-align:right;font-weight:700;">${u0(paidLast)}<`) && wk.html.includes(`>Tips</td><td style="padding:4px 0;border-bottom:1px solid #ece4da;text-align:right;font-weight:700;">${u0(tipsLast)}<`), 'the Monday email Your week lacks money in and the separate tips figure');

// 7. Nothing that was on Money before is missing.
const page = (await s.get('/admin/money?month=2026-10')).text;
const before = ['data-not-paid-box', 'data-total="received"', 'data-total="owed"', 'data-total="jobs"', 'data-total="expenses"', 'data-total="deposits"', ...M.CATEGORY_KEYS.map((k) => `data-total="category:${k}"`),
  'data-requests-month', 'Requests this month: ', 'data-left', 'Left after expenses', 'data-year-list', 'id="receipt-input"', 'id="receipt-state"', 'data-steps-panel', 'href="/admin/money/year?year=2026"',
  'href="/admin/invoices"', 'href="/admin/?f=unpaid"', 'href="/admin/money/expenses/new"', 'aria-label="Previous month"', 'aria-label="Next month"', 'data-help="mon.yearPrev"', 'data-help="mon.yearNext"', 'data-help="mon.month"', '/api/admin/receipts'];
for (const m of before) must(page.includes(m), `Money lost something it had before: ${m}`);
must(['data-money-summary', 'data-money-controls', 'data-jobs', 'id="tips"', 'id="expenses"', 'data-more-numbers'].every((m) => page.includes(m)), 'the calm layout is missing a section');
must(page.indexOf('data-money-summary') < page.indexOf('data-not-paid-box') && page.indexOf('data-not-paid-box') < page.indexOf('data-jobs'), 'summary first, then Not paid yet, then the lists');
for (const w of ['received', 'owed', 'jobs', 'expenses', 'deposits', 'tips', 'category:rentals']) {
  for (const v of ['', '&view=all']) {
    const r = await s.get(`/admin/money/detail?month=2026-10&what=${encodeURIComponent(w)}${v}`);
    must(r.status === 200 && /data-detail/.test(r.text) && (v ? /: all time</.test(r.text) : /October 2026/.test(r.text)), `detail ${w}${v} does not open`);
  }
}
must(/class="back" href="\/admin\/money\?view=all&amp;unconf=1"/.test((await s.get(`/admin/money/detail?view=all&what=owed&back=${encodeURIComponent('/admin/money?view=all&unconf=1')}`)).text), 'a detail page does not go back to the same view');
must(!/class="back" href="https:/.test((await s.get(`/admin/money/detail?what=owed&back=${encodeURIComponent('https://evil.example')}`)).text), 'a detail Back link can leave the console');

if (checks < 80) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) {
  console.error(`VALIDATION FAIL: calm Money (${errors.length} of ${checks} checks)`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`validate_admin_money_calm: OK (${checks} checks: month vs all jobs, unconfirmed apart from received, deposits toggle math, tips apart/totalled/never owed or on the invoice + history, expenses by hand + history + view, weekly tips line, URL state, nothing lost)`);
