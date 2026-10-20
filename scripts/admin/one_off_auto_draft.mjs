#!/usr/bin/env node
/**
 * One-off: make the auto draft invoice for ONE request that came in before the auto draft shipped
 * (owner, 20 Oct 2026), with the app's own code (functions/_lib/auto-draft.mjs makeAutoDraft, the
 * exact path a new website request takes): auto_draft = 1, lines marked auto, the same prefill,
 * pay plan default, linked in request_status.invoice_id. It stays a DRAFT: nothing is sent.
 *
 *   node scripts/admin/one_off_auto_draft.mjs --key '<request_key>' [--dry-run]
 *
 * Refuses when the request is missing, a test, put away, void, or already has ANY invoice
 * (makeAutoDraft's own hasInvoice, checked here first too), so running it twice changes nothing.
 * Every write goes through a whitelist: only the new invoice, its lines, the request's status link,
 * its history line and the invoice link on its own bookings that have none. Prints ids, number,
 * status and totals only, never the customer's details.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PNP_INVENTORY_LIVE = '1'; // the live inventory, not the validators' fixture
const { mod, ROOT } = await import('../validators/lib/admin_harness.mjs');

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : ''; };
const key = arg('--key');
const dry = process.argv.includes('--dry-run');
if (!key) { console.error('one-off draft: pass --key <request_key>'); process.exit(1); }

const lit = (v) => (v === null || v === undefined ? 'NULL' : (typeof v === 'number' || typeof v === 'bigint' ? String(v) : (typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`)));
const wrangler = (args) => {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'pnp-admin', '--remote', '--json', ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('[')));
};
const READ = /^\s*(SELECT|WITH)\b/i;
// The only writes makeAutoDraft may make for this request.
const ALLOWED = [
  /^INSERT INTO invoices \(number, request_key,/,
  /^DELETE FROM invoice_lines WHERE invoice_id = /,
  /^INSERT INTO invoice_lines \(invoice_id,/,
  /^INSERT INTO request_status \(request_key, status, invoice_id, updated_at\)/,
  /^UPDATE bookings SET invoice_id = -?\d+ WHERE request_key = .+ AND invoice_id IS NULL$/,
  /^INSERT INTO request_events \(request_key, who, what\)/,
];
const writes = [];
let newId = null;
function guardWrite(sql) {
  const flat = sql.replace(/\s+/g, ' ').trim();
  if (!ALLOWED.some((re) => re.test(flat))) throw new Error(`refused write: ${flat.slice(0, 60)}`);
  if (!flat.startsWith('INSERT INTO invoices ') && newId !== null && /invoice_id/.test(flat) && !flat.includes(String(newId)) && !flat.startsWith('INSERT INTO request_events')) throw new Error('refused write: not the new invoice');
  if (/request_key/.test(flat) && !flat.includes(lit(key))) throw new Error('refused write: another request');
  return flat;
}
const db = {
  prepare(sql) {
    const st = {
      args: [], bind(...a) { st.args = a; return st; },
      text() { return sql.replace(/\?(\d+)/g, (_, n) => lit(st.args[Number(n) - 1])); },
      async all() {
        const q = st.text();
        if (READ.test(q)) return { results: wrangler(['--command', q])[0].results };
        const flat = guardWrite(q);
        writes.push(flat.split(' ').slice(0, 3).join(' '));
        if (dry) return { results: /RETURNING id/.test(flat) ? [{ id: -1 }] : [] };
        const res = wrangler(['--command', q])[0].results;
        if (/^INSERT INTO invoices /.test(flat)) newId = res[0].id;
        return { results: res };
      },
      async first() { return (await st.all()).results[0] || null; },
      async run() { await st.all(); return { success: true }; },
    };
    return st;
  },
  async batch(stmts) {
    const sqls = stmts.map((x) => x.text());
    for (const q of sqls) writes.push(guardWrite(q).split(' ').slice(0, 3).join(' '));
    if (dry) return [];
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-draft-')), 'batch.sql');
    fs.writeFileSync(file, `${sqls.join(';\n')};\n`, { mode: 0o600 });
    try { execFileSync('npx', ['wrangler', 'd1', 'execute', 'pnp-admin', '--remote', '--file', file, '--yes'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }); } finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
    return [];
  },
};

const req = await db.prepare('SELECT request_key, is_test FROM requests WHERE request_key = ?1').bind(key).first();
if (!req) { console.error('one-off draft: no such request'); process.exit(1); }
if (Number(req.is_test)) { console.error('one-off draft: refused, a test request'); process.exit(1); }
const st = await db.prepare('SELECT status, archived_at, invoice_id FROM request_status WHERE request_key = ?1').bind(key).first();
if (st && (st.archived_at || st.status === 'void')) { console.error('one-off draft: refused, the request is put away or void'); process.exit(1); }
const AD = await mod('functions/_lib/auto-draft.mjs');
if (await AD.hasInvoice(db, key)) { console.error('one-off draft: refused, the request already has an invoice (nothing changed)'); process.exit(1); }
const id = await AD.makeAutoDraft({ DB: db }, key, { who: 'auto draft (one-off, owner 20 Oct 2026)' });
if (dry) { console.log(`one-off draft (dry run): would write ${writes.length} statements: ${Object.entries(writes.reduce((m, w) => ({ ...m, [w]: (m[w] || 0) + 1 }), {})).map(([w, n]) => `${w} x${n}`).join(' | ')}`); process.exit(0); }
if (!id) { console.error('one-off draft: no draft made (no lines from the prefill)'); process.exit(1); }
const out = await db.prepare(`SELECT i.id, i.number, i.status, i.auto_draft, i.pay_plan, i.deposit_due_cents, i.sent_at,
    (SELECT SUM(ROUND(qty * unit_cents)) FROM invoice_lines l WHERE l.invoice_id = i.id) AS total_cents,
    (SELECT COUNT(*) FROM invoice_lines l WHERE l.invoice_id = i.id) AS lines,
    (SELECT COUNT(*) FROM invoice_lines l WHERE l.invoice_id = i.id AND l.auto IS NOT NULL) AS auto_lines,
    (SELECT invoice_id FROM request_status WHERE request_key = ?1) AS linked
  FROM invoices i WHERE i.id = ?2`).bind(key, id).first();
console.log(`one-off draft: ${JSON.stringify(out)}`);
