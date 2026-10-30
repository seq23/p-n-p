#!/usr/bin/env node
// Local SQLite only. These scenarios must never reach a mailer or a production database.
import assert from 'node:assert/strict';
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const s = await session();
let mailCalls = 0;
s.env.MAILER = { fetch: async () => { mailCalls += 1; throw new Error('No email allowed'); } };
const T = await mod('functions/_lib/todo-email.mjs');
const OF = await mod('functions/_lib/owner-feed.mjs');
const AC = await mod('functions/_lib/admin-calendar.mjs');
const R = await mod('functions/_lib/reminders.mjs');
const P = await mod('functions/_lib/deposit-paid.mjs');
const today = R.chicagoDate();
const now = Date.now();
const r = s.requests.find((x) => x.wantsRentals);
assert.ok(r, 'fixture has a rental card');
const rk = s.rk(r.key);
assert.equal(P.PAID_LABEL, '✓ They paid the deposit');
assert.equal(P.PAID_HINT, "Paid by Zelle or Cash App? Tap 'They paid' so this comes off the list.");
const noInvoice = await s.get(P.paidHref(r.key));
assert.ok(noInvoice.text.includes('No invoice yet.'));
assert.ok(!noInvoice.text.includes('name="confirm"'));
const create = await s.post('/admin/invoices', {
  r: rk, customer_name: 'Demo Example', customer_email: 'demo@example.com', customer_phone: '901-555-0101',
  issue_date: today, due_date: '2099-12-31', pay_plan: 'custom', deposit: '165.00', go: 'save',
  line_desc: ['Game rental', 'Refundable damage deposit'], line_qty: ['1', '1'], line_price: ['130.00', '100.00'],
  line_note: ['', ''], line_refundable: ['0', '1'],
});
const id = Number(create.location.match(/invoices\/(\d+)/)?.[1]);
assert.ok(id > 0, 'fixture invoice created');
await s.db.prepare("UPDATE invoices SET status='sent', sent_at=datetime('now') WHERE id=?1").bind(id).run();
await s.db.prepare("INSERT INTO request_status(request_key,status,invoice_id) VALUES(?1,'invoiced',?2) ON CONFLICT(request_key) DO UPDATE SET status='invoiced', invoice_id=?2").bind(r.key,id).run();
await s.db.prepare("INSERT INTO holds(request_key,state,by_hand) VALUES(?1,'held',1) ON CONFLICT(request_key) DO UPDATE SET state='held',by_hand=1,until=NULL").bind(r.key).run();
await s.db.prepare("INSERT INTO bookings(kind,date,customer_name,request_key,invoice_id,items) VALUES('rental_pickup',?1,'Demo Example',?2,?3,'Game rental') ON CONFLICT(request_key,kind) DO UPDATE SET date=excluded.date,invoice_id=excluded.invoice_id").bind(today,r.key,id).run();
const list = () => T.todoData(s.db, today, now, { includeWeek: false });
const money = async () => (await list()).sections[5].find((x) => x.key === r.key);
const count = async () => (await s.one('SELECT COUNT(*) n FROM payments WHERE invoice_id=?1', id)).n;
const initial = await money();
assert.equal(initial.type, 'hold');
assert.equal(initial.btns[0].label, P.PAID_LABEL);
assert.equal(initial.btns[0].href, P.paidHref(r.key, id));
assert.ok(initial.d.endsWith(P.PAID_HINT));
await s.db.prepare("UPDATE holds SET by_hand=0,until=?2 WHERE request_key=?1").bind(r.key,`${today} 17:00:00`).run();
assert.ok((await AC.daySheetData(s.env,today)).holds.some((h) => h.request_key === r.key));
await s.db.prepare('UPDATE holds SET by_hand=1,until=NULL WHERE request_key=?1').bind(r.key).run();
const rendered = T.renderTodo(await list());
assert.ok(rendered.html.includes(P.PAID_LABEL) && rendered.text.includes(P.PAID_LABEL));
assert.match(rendered.html, /<a [^>]*style="[^"]*background:#b65f3e;[^"]*">✓ They paid the deposit<\/a>/);
const feed = OF.feedItemsFromTodo(await list()).find((x) => x.title === initial.t);
assert.equal(feed.actions[0].label, P.PAID_LABEL);
assert.equal(feed.link, `https://porchandparty901.com${initial.btns[0].href}`);
assert.ok(feed.detail.includes(P.PAID_HINT));
const day = (await s.get(`/admin/day/${today}`)).text;
assert.ok(day.includes(P.PAID_LABEL) && day.includes(P.paidHref(r.key, id).replaceAll('&','&amp;')));
assert.ok(day.includes('Paid by Zelle or Cash App?'));

const screen = await s.get(initial.btns[0].href);
assert.equal(screen.status, 200);
assert.ok(screen.text.includes('Demo Example') || screen.text.includes(r.name));
for (const words of ['Yes, record it', 'How did they pay?', 'Zelle', 'Cash App', 'Cash', 'Other', 'Day it came in']) assert.ok(screen.text.includes(words), words);
assert.match(screen.text, /name="amount"[^>]*value="165.00"/);
assert.ok(screen.text.includes(`value="${today}"`));
assert.ok(screen.text.includes(`/admin/#c-${rk}`));
assert.equal(await count(), 0, 'opening confirmation never writes a payment');
await s.get(initial.btns[0].href);
assert.equal(await count(), 0, 'reopening confirmation never writes a payment');
assert.notEqual((await s.get(initial.btns[0].href, { auth: false })).status, 200);

const post = (over = {}) => s.post('/admin/requests/edit/deposit-paid', { r: rk, invoice_id: String(id), expected_paid: '0', amount: '165.00', date: today, method: 'zelle', confirm: 'yes', ...over });
for (const over of [{ confirm: '' }, { amount: '0' }, { amount: '-1' }, { amount: '9999' }, { date: '2026-02-30' }, { method: '' }, { method: 'wire' }, { expected_paid: '' , amount: '' }]) {
  await post(over);
  assert.equal(await count(), 0, `invalid confirmation recorded money: ${JSON.stringify(over)}`);
}
await s.post('/admin/requests/edit/deposit-paid', { r: rk, invoice_id: id, amount: '165', date: today, method: 'zelle', confirm: 'yes' });
assert.equal(await count(), 0, 'a stale form without the paid snapshot cannot save');
await post({ amount: '50.00', method: 'cashapp' });
assert.equal(await count(), 1);
const part = await money();
assert.equal(part.type, 'hold');
assert.ok(part.d.includes('$180 due ($130 + $50 refundable deposit)'));
assert.equal((await s.one('SELECT state FROM holds WHERE request_key=?1',r.key)).state, 'held');
assert.match((await s.get(initial.btns[0].href)).text, /name="amount"[^>]*value="115.00"/);
await post();
assert.equal(await count(), 1, 'an old confirmation cannot duplicate a payment');
const saved = await post({ amount: '115.00', expected_paid: '5000' });
assert.equal(saved.status, 303);
assert.ok(saved.location.endsWith(`#c-${rk}`), 'returns to the same card');
assert.equal(await count(), 2);
const rows = await s.all('SELECT * FROM payments WHERE invoice_id=?1 ORDER BY id',id);
assert.deepEqual(rows.map((x) => [x.amount_cents,x.received_on,x.method,x.kind]), [[5000,today,'cashapp','payment'],[11500,today,'zelle','payment']]);
assert.equal((await s.one('SELECT state FROM holds WHERE request_key=?1',r.key)).state,'confirmed');
assert.equal(await money(), undefined, 'hold present → confirmed payment → hold gone on next list');
assert.ok(!OF.feedItemsFromTodo(await list()).some((x) => /Waiting for deposit/.test(x.title) && x.title.includes(initial.t.split(' · ')[0])));
const history = await s.all("SELECT what FROM request_events WHERE request_key=?1 AND what LIKE 'Payment added:%'",r.key);
assert.ok(history.some((x) => x.what.includes('$50.00') && x.what.includes('Cash App')));
assert.ok(history.some((x) => x.what.includes('$115.00') && x.what.includes('Zelle')));
// A stale hold flag must not resurrect a paid-deposit reminder in any next-built list.
await s.db.prepare("UPDATE holds SET state='held' WHERE request_key=?1").bind(r.key).run();
assert.equal(await money(),undefined);
await s.db.prepare("UPDATE holds SET by_hand=0,until=?2 WHERE request_key=?1").bind(r.key,`${today} 17:00:00`).run();
assert.ok(!(await AC.daySheetData(s.env,today)).holds.some((h) => h.request_key === r.key), 'paid deposit leaves the day hold list even with a stale flag');
await s.db.prepare('UPDATE holds SET by_hand=1,until=NULL WHERE request_key=?1').bind(r.key).run();
// Full balance due remains a legitimate money item, with the real remaining charges.
await s.db.prepare('UPDATE invoices SET due_date=?2 WHERE id=?1').bind(id,today).run();
const due = await money();
assert.equal(due.type,'owed');
assert.ok(due.t.includes('$65 due'));
assert.equal(due.btns[0].label,P.PAID_LABEL);
// Voided and already-paid invoices cannot take another shortcut payment.
await s.db.prepare("UPDATE invoices SET status='void' WHERE id=?1").bind(id).run();
assert.ok(!(await s.get(initial.btns[0].href)).text.includes('name="confirm"'));
await post({ amount:'65',expected_paid:'16500' });
assert.equal(await count(),2);
// Manual invoices use the same confirmation and payment path, including Cash and Other.
for (const method of ['cash', 'other']) {
  const created = await s.post('/admin/invoices', {
    customer_name: 'Sample Example', customer_email: 'sample@example.com', customer_phone: '901-555-0102',
    issue_date: today, due_date: today, pay_plan: 'full', go: 'save',
    line_desc: ['Party decor'], line_qty: ['1'], line_price: ['80.00'], line_refundable: ['0'], line_note: [''],
  });
  const manualId = Number(created.location.match(/invoices\/(\d+)/)?.[1]);
  const href = P.paidHref('', manualId);
  const html = (await s.get(href)).text;
  assert.match(html, /name="amount"[^>]*value="80.00"/);
  const form = { r:'', invoice_id: manualId, expected_paid:'0', amount:'80', date:today, method, confirm:'yes' };
  // Two requests with the same snapshot may overlap; the INSERT guards against double taps.
  // Hold both writes until both requests have read the old balance, to force that race.
  const prepare = s.db.prepare;
  let arrivals = 0;
  let release;
  const both = new Promise((resolve) => { release = resolve; });
  const pauseInsert = (stmt) => {
    const bind = stmt.bind.bind(stmt);
    stmt.bind = (...args) => pauseInsert(bind(...args));
    const run = stmt.run.bind(stmt);
    stmt.run = async () => { arrivals += 1; if (arrivals === 2) release(); await both; return run(); };
    return stmt;
  };
  s.db.prepare = (sql) => {
    const stmt = prepare(sql);
    return /INSERT INTO payments/.test(sql) && /SELECT \?1/.test(sql) ? pauseInsert(stmt) : stmt;
  };
  try { await Promise.all([s.post('/admin/requests/edit/deposit-paid',form), s.post('/admin/requests/edit/deposit-paid',form)]); }
  finally { s.db.prepare = prepare; }
  assert.equal(arrivals,2,'the duplicate-tap test actually forced two overlapping inserts');
  const payments = await s.all('SELECT * FROM payments WHERE invoice_id=?1',manualId);
  assert.equal(payments.length,1);
  assert.equal(payments[0].method,method);
  assert.equal(payments[0].amount_cents,8000);
  assert.ok(!(await s.get(href)).text.includes('name="confirm"'));
}
assert.equal(mailCalls,0,'no mail was sent');
console.log('validate_admin_deposit_paid: OK (confirm-only, ledger/history, partial balances, list/feed/day parity, stale forms, auth, no email)');
