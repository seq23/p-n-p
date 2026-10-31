#!/usr/bin/env node
/**
 * GET /api/inventory/pending stays fast and never hangs (30 Oct 2026).
 *
 * Cloudflare's analytics showed 504s on this path at 22:35, 22:42 and 22:50 UTC. They were
 * Cloudflare's own Early Hints probes (user agent "nginx-ssl early hints", 143 in 24 hours, one
 * beside every poll); the Inventory Poll's own requests answered 200 every time. This validator
 * keeps the endpoint the way that evidence found it, and guards the time budget added then.
 *
 * Fails unless:
 *  1. nothing waiting: the answer is ONE database read, and its query plan uses the primary key
 *     (no temporary sort, no scan of another table), with 20,000 past publishes in the table;
 *  2. a change waiting: a bounded number of reads (no read per item), and no outside call;
 *  3. a database that never answers gets a clear 503 { pending: false, error: 'timeout' } inside
 *     the budget, and a database that fails gets 503 { error: 'unavailable' }; both no-store;
 *  4. the budget is shorter than the Inventory Poll's curl --max-time, so the poll always hears
 *     the plain answer rather than timing out itself;
 *  5. docs/admin-console.md explains the Early Hints 504s, so nobody chases them again.
 * Rule 0: fewer than 20 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, mod, makeDb, makeEnv } from './lib/admin_harness.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

const I = await mod('functions/_lib/inventory.mjs');

// Every SQL statement the handler prepares, and every outside call it tries.
function recording(db) {
  const sql = [];
  return { sql, db: { ...db, prepare: (s) => { sql.push(s); return db.prepare(s); } } };
}
const outside = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => { outside.push(String(u)); throw new Error('no outside calls from /api/inventory/pending'); };

const base = makeDb();
const env = makeEnv(base);
env.PNP_FETCH = async (u) => { outside.push(String(u)); throw new Error('no outside calls'); };

// ---- 1. Nothing waiting: one primary-key read, even with a long history ----------------------
const ins = base.raw.prepare("INSERT INTO inventory_publishes (version, status, detail) VALUES (?, 'live', 'Live ✓')");
base.raw.exec('BEGIN');
for (let i = 0; i < 20000; i += 1) ins.run(`v${i}`);
base.raw.exec('COMMIT');
{
  const r = recording(base);
  const t0 = performance.now();
  const res = await I.handlePending({ env: { ...env, DB: r.db } });
  const ms = performance.now() - t0;
  const body = await res.json();
  must(res.status === 200 && body.pending === false, `nothing waiting does not answer 200 { pending: false } (got ${res.status} ${JSON.stringify(body)})`);
  must(r.sql.length === 1, `nothing waiting takes ${r.sql.length} database reads, not 1: ${r.sql.join(' | ')}`);
  must(ms < 250, `nothing waiting took ${ms.toFixed(0)} ms over 20,000 past publishes (budget 250 ms locally)`);
  must(res.headers.get('Cache-Control') === 'no-store', 'the answer is cacheable');
  must(/^pending;dur=\d+$/.test(res.headers.get('Server-Timing') || ''), 'the answer carries no Server-Timing (the time it took)');
  for (const s of r.sql) {
    const plan = base.raw.prepare(`EXPLAIN QUERY PLAN ${s}`).all().map((x) => x.detail).join(' / ');
    must(!/TEMP B-TREE/i.test(plan), `"${s}" sorts in a temporary table: ${plan}`);
    must(/inventory_publishes/.test(plan) && !/SCAN (?!inventory_publishes)/.test(plan), `"${s}" scans another table: ${plan}`);
    must(!/SCAN inventory_publishes/.test(plan) || /ORDER BY id DESC LIMIT 1/.test(s), `"${s}" scans inventory_publishes without reading the newest id only: ${plan}`);
  }
}

// ---- 2. A change waiting: bounded reads, no outside call -------------------------------------
{
  const st = await I.loadInventory(base);
  base.raw.prepare("INSERT INTO inventory_publishes (version, status, detail) VALUES (?, 'queued', 'q')").run(st.version);
  const r = recording(base);
  const res = await I.handlePending({ env: { ...env, DB: r.db } });
  const body = await res.json();
  must(res.status === 200 && body.pending === true && typeof body.publish_id === 'number', `a waiting change is not handed to the poll (got ${res.status} ${JSON.stringify(body).slice(0, 120)})`);
  must(r.sql.length <= 4, `a waiting change takes ${r.sql.length} database reads (bound 4; a read per item is an N+1): ${r.sql.join(' | ')}`);
  must(st.rows.length >= 8, `the fixture inventory has ${st.rows.length} items (Rule 0: the read bound means nothing on an empty inventory)`);
}
must(outside.length === 0, `the endpoint made outside calls: ${outside.join(', ')}`);

// ---- 3. A database that never answers / fails ------------------------------------------------
const hung = { prepare: () => ({ bind() { return this; }, first: () => new Promise(() => {}), all: () => new Promise(() => {}), run: () => new Promise(() => {}) }) };
{
  const t0 = performance.now();
  // A watchdog of our own, so a handler with no budget fails here by name instead of hanging.
  let dog;
  const watchdog = new Promise((resolve) => { dog = setTimeout(() => resolve(null), 3000); });
  const res = await Promise.race([I.handlePending({ env: { ...env, DB: hung } }, 300), watchdog]);
  clearTimeout(dog);
  const ms = performance.now() - t0;
  if (!res) {
    console.error('VALIDATION FAIL: inventory pending budget\n  - a database that never answers holds GET /api/inventory/pending forever (no time budget)');
    process.exit(1);
  }
  const body = await res.json();
  must(ms < 1500, `a database that never answers held the caller ${ms.toFixed(0)} ms (budget 300 ms)`);
  must(res.status === 503 && body.pending === false && body.error === 'timeout', `a database that never answers does not get 503 { pending: false, error: 'timeout' } (got ${res.status} ${JSON.stringify(body)})`);
  must(/did not answer within/.test(body.detail || '') && /tries again/.test(body.detail || ''), 'the timeout answer does not say in plain words what happened and what happens next');
  must(res.headers.get('Cache-Control') === 'no-store', 'the timeout answer is cacheable');
}
{
  const broken = { prepare: () => { throw new Error('D1_ERROR'); } };
  const res = await I.handlePending({ env: { ...env, DB: broken } });
  const body = await res.json();
  must(res.status === 503 && body.pending === false && body.error === 'unavailable' && /could not be read/.test(body.detail || ''), `a failing database does not get a plain 503 'unavailable' (got ${res.status} ${JSON.stringify(body)})`);
}

// ---- 4. The budget fits inside the poll's own limit ------------------------------------------
const poll = fs.readFileSync(path.join(ROOT, '.github/workflows/inventory-poll.yml'), 'utf8');
const curlMax = Number((poll.match(/curl[^\n]*--max-time (\d+)[^\n]*\/api\/inventory\/pending/) || [])[1]);
must(Number.isFinite(I.PENDING_BUDGET_MS) && I.PENDING_BUDGET_MS > 0 && I.PENDING_BUDGET_MS <= 10000, `PENDING_BUDGET_MS is ${I.PENDING_BUDGET_MS} (must be 1..10000 ms)`);
must(curlMax > 0 && I.PENDING_BUDGET_MS / 1000 < curlMax, `the budget (${I.PENDING_BUDGET_MS} ms) is not shorter than the poll's curl --max-time (${curlMax} s)`);
must(/::warning::NAMED STOP: .*did not answer/.test(poll), 'the poll does not name a stop when the endpoint does not answer');
const route = fs.readFileSync(path.join(ROOT, 'functions/api/inventory/pending.js'), 'utf8');
must(/handlePending\(context\)/.test(route), 'functions/api/inventory/pending.js does not route to handlePending');

// ---- 5. The Early Hints 504s are written down --------------------------------------------------
const doc = fs.readFileSync(path.join(ROOT, 'docs/admin-console.md'), 'utf8');
must(/nginx-ssl early hints/.test(doc) && /PENDING_BUDGET_MS/.test(doc) && /validate:inventory-pending-budget/.test(doc), 'docs/admin-console.md does not explain the Early Hints 504s, the budget and its validator');

globalThis.fetch = realFetch;
if (checks < 20) errors.push(`Rule 0: only ${checks} checks ran (at least 20)`);
if (errors.length) {
  console.error(`VALIDATION FAIL: inventory pending budget (${errors.length} of ${checks} checks)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`VALIDATION PASS: inventory pending budget (${checks} checks)`);
