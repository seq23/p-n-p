#!/usr/bin/env node
/**
 * Phone-request backfill (owner, 18 Oct 2026; functions/_lib/phone-requests.mjs backfillPlan).
 * Before phone requests existed, "Add a booking" wrote bookings with request_key NULL, so a
 * phone-call job never reached Requests. This makes a phone request (source 'phone') for every
 * request-less booking with a customer name (not a calendar note): a rental pickup + its return,
 * or an install/setup + its takedown/pickup, become ONE request. It also converts a request that
 * was already added by hand as source 'site' with "How it came in: Phone call" to 'phone', and
 * clears its confirm_emailed_at (set only to stop the automatic confirmation; the phone rule does
 * that now), with a history line. No email is sent by any of this.
 *
 * Idempotent: a linked booking is no longer request-less and a converted row is already 'phone',
 * so a second run plans nothing.
 *
 *   node scripts/admin/backfill_phone_requests.mjs [--dry-run]
 *
 * Prints counts only, never a customer's details.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mod, ROOT } from '../validators/lib/admin_harness.mjs';

const dry = process.argv.includes('--dry-run');
const d1 = (sql) => {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'pnp-admin', '--remote', '--json', '--command', sql], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
};
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const inline = ([sql, args]) => `${sql.replace(/\?(\d+)/g, (_, n) => q(args[Number(n) - 1]))};`;

const PR = await mod('functions/_lib/phone-requests.mjs');
const plan = PR.backfillPlan({
  bookings: d1('SELECT * FROM bookings WHERE request_key IS NULL'),
  requests: d1("SELECT request_key, source, answers, id_object, agreed_at FROM requests WHERE source = 'site'"),
  returns: d1("SELECT return_key, returned_at FROM rental_returns WHERE return_key LIKE 'booking:%'"),
});
const pairs = plan.created.filter((c) => c.pair).length;
const by = plan.created.reduce((m, c) => { m[c.service] = (m[c.service] || 0) + 1; return m; }, {});
console.log(`backfill-phone${dry ? ' (dry run)' : ''}: ${plan.created.length} phone requests to make ${JSON.stringify(by)} (${pairs} rental pairs, ${plan.created.reduce((n, c) => n + c.bookings, 0)} bookings linked); ${plan.converted.length} hand-added requests to convert to 'phone'`);
if (dry || !plan.stmts.length) process.exit(0);
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-phone-')), 'backfill.sql');
fs.writeFileSync(file, plan.stmts.map(inline).join('\n'), { mode: 0o600 });
try {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'pnp-admin', '--remote', '--file', file, '--yes'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
} finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
const left = d1("SELECT COUNT(*) AS n FROM bookings WHERE request_key IS NULL AND calendar_note = 0 AND TRIM(customer_name) <> '' AND kind <> 'other'")[0].n;
console.log(`backfill-phone: wrote ${plan.created.length} requests and ${plan.converted.length} conversions; request-less customer bookings left: ${left}`);
