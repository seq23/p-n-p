#!/usr/bin/env node
/**
 * One-time, idempotent import of ONE Google Form request into the D1 requests store
 * (owner, 18 Oct 2026: only the one real customer's row is imported; every other row of
 * "Form Responses 1" is a test and stays only in the sheet). Read-only on the sheet: it never
 * edits or deletes a row of the Form Responses tab.
 *
 *   GSC_SERVICE_ACCOUNT_JSON=... node scripts/admin/import_form_request.mjs --invoice PNP-2026-0002 [--dry-run]
 *
 * The row is found by the request_key its invoice is already linked to (or --key), so the
 * imported request keeps that key and its status, invoice, payments, bookings, notes and
 * checklist stay linked. source = 'google_form'; the raw row is kept; the ID stays the Drive
 * link. INSERT OR IGNORE: running it twice changes nothing. Prints counts only, never the
 * customer's details.
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
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

let key = arg('--key');
const invoice = arg('--invoice');
if (!key && invoice) {
  const rows = d1(`SELECT request_key FROM invoices WHERE number = ${q(invoice)}`);
  key = rows[0] && rows[0].request_key;
}
if (!key) { console.error('import: no request key (pass --invoice PNP-YYYY-NNNN or --key)'); process.exit(1); }
if (!process.env.GSC_SERVICE_ACCOUNT_JSON) { console.error('import: NAMED STOP - GSC_SERVICE_ACCOUNT_JSON is not set (run under the vault)'); process.exit(1); }

const S = await mod('functions/_lib/sheet.mjs');
const RQ = await mod('functions/_lib/requests.mjs');
const values = await S.readSheetValues({ GOOGLE_SA_JSON: process.env.GSC_SERVICE_ACCOUNT_JSON }, { fresh: true });
const [headers, ...rows] = values;
const recs = rows.map((r) => RQ.importRowFor(headers, r)).filter((r) => r && r.request_key === key);
if (recs.length !== 1) { console.error(`import: expected exactly one sheet row for that request, found ${recs.length}`); process.exit(1); }
const rec = recs[0];
const cols = Object.keys(rec);
let sql = `INSERT OR IGNORE INTO requests (${cols.join(', ')}) VALUES (${cols.map((c) => (rec[c] === null || rec[c] === undefined ? 'NULL' : q(rec[c]))).join(', ')});`;
// A takedown date on the form books the takedown too (takedown.mjs autoTakedownRow): never a
// duplicate (ON CONFLICT DO NOTHING + no takedown booking of either kind yet), never over hers.
const TD = await mod('functions/_lib/takedown.mjs');
const C = await mod('functions/_lib/calendar.mjs');
const have = d1(`SELECT kind FROM bookings WHERE request_key = ${q(key)}`);
const auto = TD.autoTakedownRow(RQ.fromRow({ ...rec, takedown_note: '' }), { bookings: have });
if (auto) {
  sql += `\nINSERT INTO bookings (request_key, kind, date, time, customer_name, phone, email, place, items, edited_by_hand, name_norm, phone_digits) VALUES (${[auto.request_key, auto.kind, auto.date].map(q).join(', ')}, NULL, ${[auto.customer_name, auto.phone, auto.email, auto.place, auto.items].map(q).join(', ')}, 0, ${q(C.normName(auto.customer_name))}, ${q(C.digitsOf(auto.phone))}) ON CONFLICT(request_key, kind) DO NOTHING;`;
  sql += `\nINSERT INTO request_events (request_key, who, what) VALUES (${q(key)}, 'import', ${q(`${TD.AUTO_EVENT} (${auto.date})`)});`;
}
const before = d1(`SELECT COUNT(*) AS n FROM requests WHERE request_key = ${q(key)}`)[0].n;
if (dry) { console.log(`import (dry run): 1 row found; already in D1: ${before}`); process.exit(0); }
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-import-')), 'import.sql');
fs.writeFileSync(file, sql, { mode: 0o600 });
try {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'pnp-admin', '--remote', '--file', file, '--yes'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
} finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
const after = d1(`SELECT r.source, rs.status, i.number FROM requests r LEFT JOIN request_status rs ON rs.request_key = r.request_key LEFT JOIN invoices i ON i.id = rs.invoice_id WHERE r.request_key = ${q(key)}`);
console.log(`import: takedown auto-booked: ${auto ? 1 : 0}; imported ${before ? 0 : 1} row (already there before: ${before}); now in D1: ${after.length}; source ${after[0] && after[0].source}; status ${after[0] && after[0].status}; invoice ${after[0] && after[0].number} linked`);
