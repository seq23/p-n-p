#!/usr/bin/env node
/**
 * Idempotent backfill of requests.takedown_plan / takedown_date from each request's own form
 * answers (owner, 18 Oct 2026; functions/_lib/takedown.mjs backfillPlan): the old Google Form's
 * "Need us to take it down afterwards?" + "Takedown date", the /request form's "Want us to take
 * it down afterwards?". yes -> scheduled (+ the date, which the booking step below books), not sure -> not_sure, no -> customer_handles. Each mapped row
 * gets the request event "Takedown mapped from the request form", and a row carrying any
 * "Takedown..." event (this one, or the owner's own choice on the card) is never touched again, so running it twice changes nothing and the owner's later choices stand.
 * Payments and status are never touched. Then (owner, 18 Oct 2026) every takedown the form dated
 * and nobody booked yet is booked (takedown.mjs autoBookPlan; never a duplicate, never over hers).
 *
 * Owner's word overrides the form's date (e.g. a takedown moved by phone):
 *   --invoice PNP-YYYY-NNNN --owner-date YYYY-MM-DD   sets that request's takedown_date (plan
 *   'scheduled' if it had none) and the note "Takedown date set to <Day D Mon> by owner";
 *   skipped when the date is already that day.
 *
 *   node scripts/admin/backfill_takedown.mjs [--dry-run] [--invoice PNP-2026-0002 --owner-date 2026-10-20]
 *
 * Prints counts only, never a customer's details.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mod, ROOT } from '../validators/lib/admin_harness.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
const dry = process.argv.includes('--dry-run');
const d1 = (sql) => {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'pnp-admin', '--remote', '--json', '--command', sql], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
};
const q = (s) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

const RQ = await mod('functions/_lib/requests.mjs');
const TD = await mod('functions/_lib/takedown.mjs');
const U = await mod('functions/_lib/util.mjs');
const rows = d1('SELECT * FROM requests');
// Any takedown event (the backfill's own, or the owner's choice on the card) means: leave it.
const marked = new Set(d1("SELECT DISTINCT request_key FROM request_events WHERE what LIKE 'Takedown%'").map((x) => x.request_key));
const reqs = rows.map(RQ.fromRow).filter(Boolean);
const plan = TD.backfillPlan(reqs, marked);
const sql = [];
for (const p of plan) {
  sql.push(`UPDATE requests SET takedown_plan = ${q(p.plan)}, takedown_date = ${q(p.date)} WHERE request_key = ${q(p.key)};`);
  sql.push(`INSERT INTO request_events (request_key, who, what) VALUES (${q(p.key)}, 'backfill', ${q(TD.BACKFILL_EVENT)});`);
}
let override = 'none';
const invoice = arg('--invoice'); const ownerDate = arg('--owner-date');
if (invoice || ownerDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ownerDate) || !invoice) { console.error('backfill: --invoice and --owner-date YYYY-MM-DD go together'); process.exit(1); }
  const hit = d1(`SELECT request_key FROM invoices WHERE number = ${q(invoice)}`)[0];
  if (!hit || !hit.request_key) { console.error('backfill: no request linked to that invoice'); process.exit(1); }
  const r = reqs.find((x) => x.key === hit.request_key);
  if (!r) { console.error('backfill: that invoice\'s request is not in D1'); process.exit(1); }
  const planned = plan.find((p) => p.key === r.key);
  const currentDate = planned ? planned.date : r.takedownDate;
  if (currentDate === ownerDate) override = 'already set';
  else {
    const note = `Takedown date set to ${U.shortDate(ownerDate)} by owner`;
    const nextPlan = (planned ? planned.plan : r.takedownPlan) || 'scheduled';
    sql.push(`UPDATE requests SET takedown_plan = ${q(nextPlan)}, takedown_date = ${q(ownerDate)}, takedown_note = ${q(note)} WHERE request_key = ${q(r.key)};`);
    sql.push(`INSERT INTO request_events (request_key, who, what) VALUES (${q(r.key)}, 'admin', ${q(note)});`);
    override = 'applied';
  }
}
// Then book every takedown the form dated (takedown.mjs autoBookPlan, owner 18 Oct 2026), read
// AFTER the mapping above: porch/party, plan scheduled, a real date, live, and no takedown booking
// of either kind yet. A booking she made or edited is never touched; ON CONFLICT DO NOTHING.
const C = await mod('functions/_lib/calendar.mjs');
const mapped = reqs.map((r) => { const p = plan.find((x) => x.key === r.key); return p ? { ...r, takedownPlan: p.plan || '', takedownDate: p.date } : r; });
const bookingsBy = {};
for (const b of d1('SELECT request_key, kind FROM bookings WHERE request_key IS NOT NULL')) (bookingsBy[b.request_key] = bookingsBy[b.request_key] || []).push(b);
const statuses = Object.fromEntries(d1('SELECT request_key, status, archived_at FROM request_status').map((x) => [x.request_key, x]));
const book = TD.autoBookPlan(mapped, bookingsBy, statuses);
for (const b of book) {
  sql.push(`INSERT INTO bookings (request_key, kind, date, time, customer_name, phone, email, place, items, edited_by_hand, name_norm, phone_digits) VALUES (${[b.request_key, b.kind, b.date].map(q).join(', ')}, NULL, ${[b.customer_name, b.phone, b.email, b.place, b.items].map(q).join(', ')}, 0, ${q(C.normName(b.customer_name))}, ${q(C.digitsOf(b.phone))}) ON CONFLICT(request_key, kind) DO NOTHING;`);
  sql.push(`INSERT INTO request_events (request_key, who, what) VALUES (${q(b.request_key)}, 'backfill', ${q(`${TD.AUTO_EVENT} (${b.date})`)});`);
}
const withDate = mapped.filter((r) => TD.takedownKindFor(r.services || []) && r.takedownPlan === 'scheduled' && /^\d{4}-\d{2}-\d{2}$/.test(r.takedownDate || '')).length;
console.log(`backfill bookings: ${withDate} requests with a takedown date, ${withDate - book.length} already booked or not live, ${book.length} to book`);
const counts = plan.reduce((m, p) => { m[p.plan || 'none'] = (m[p.plan || 'none'] || 0) + 1; return m; }, {});
console.log(`backfill${dry ? ' (dry run)' : ''}: ${reqs.length} requests read, ${marked.size} already mapped, ${plan.length} to map ${JSON.stringify(counts)}; owner date: ${override}`);
if (dry || !sql.length) process.exit(0);
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-td-')), 'backfill.sql');
fs.writeFileSync(file, sql.join('\n'), { mode: 0o600 });
try {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'pnp-admin', '--remote', '--file', file, '--yes'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
} finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
console.log(`backfill: wrote ${plan.length} mapped rows, ${book.length} takedown bookings${override === 'applied' ? ' + the owner date' : ''}`);
