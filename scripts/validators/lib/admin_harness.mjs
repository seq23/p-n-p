// Test harness for the /admin console validators: loads functions/_lib with JSON imports
// (a loader hook turns `import x from './a.json'` into a module), and gives the code a real
// SQLite database behind a D1-shaped adapter, with every migration applied in order.
// Node >= 22.13 (node:sqlite). No network: the sheet reads the fixture (PNP_SHEET_FIXTURE=1).
import fs from 'node:fs';
import path from 'node:path';
import module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequire } from 'node:module';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The rentals inventory is Valerie's to edit (Settings -> Inventory, 18 Oct 2026), so the
// scenario validators run on a fixed copy of it, scripts/validators/fixtures/games.json (the
// seed inventory: Cornhole 1 set, both Giant Color Stack sets, the admin-only Projector...),
// and never break when an item is added or removed. The live file is held to its rules by
// validate:admin-inventory and validate:rentals; PNP_INVENTORY_LIVE=1 loads it here instead.
const GAMES_FILE = /\/data\/rentals\/games\.json$/;
export const GAMES_FIXTURE = path.join(ROOT, 'scripts/validators/fixtures/games.json');
const jsonUrl = (url) => (GAMES_FILE.test(url) && process.env.PNP_INVENTORY_LIVE !== '1' ? pathToFileURL(GAMES_FIXTURE) : new URL(url));

// Sync hooks (module.registerHooks, Node >= 22.15) where available, else the async form.
function loadAsModule(url) {
  if (!url.startsWith('file:') || url.includes('/node_modules/') || false) return null;
  if (url.endsWith('.json')) return { format: 'module', source: `export default ${fs.readFileSync(jsonUrl(url), 'utf8')};`, shortCircuit: true };
  if (url.endsWith('.txt')) return { format: 'module', source: `export default ${JSON.stringify(fs.readFileSync(new URL(url), 'utf8'))};`, shortCircuit: true };
  return null;
}
if (typeof module.registerHooks === 'function') {
  module.registerHooks({ load(url, context, next) { return (context.format !== 'commonjs' && loadAsModule(url)) || next(url, context); } });
} else {
  const HOOKS = `export async function load(url, context, next) {
    const { readFile } = await import('node:fs/promises');
    if (url.includes('/node_modules/')) return next(url, context);
    const live = ${JSON.stringify(process.env.PNP_INVENTORY_LIVE === '1')};
    const fixture = ${JSON.stringify(pathToFileURL(path.join(ROOT, 'scripts/validators/fixtures/games.json')).href)};
    if (url.endsWith('.json')) return { format: 'module', source: 'export default ' + await readFile(new URL(!live && /\\/data\\/rentals\\/games\\.json$/.test(url) ? fixture : url), 'utf8') + ';', shortCircuit: true };
    if (url.endsWith('.txt')) return { format: 'module', source: 'export default ' + JSON.stringify(await readFile(new URL(url), 'utf8')) + ';', shortCircuit: true };
    return next(url, context);
  }`;
  module.register(`data:text/javascript,${encodeURIComponent(HOOKS)}`, import.meta.url);
}

const LIB_ASSETS = createRequire(import.meta.url)('../../lib/library_assets.js');
export const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

let sqlite;
try { sqlite = await import('node:sqlite'); } catch {
  console.error('VALIDATION FAIL: node:sqlite is not available (needs Node >= 22.13); the admin validators cannot run');
  process.exit(1);
}

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args.map((a) => (a === undefined ? null : a))); }
  _p() { return this.db.prepare(this.sql); }
  async first() { const r = this._p().get(...this.args); return r === undefined ? null : { ...r }; }
  async all() { return { results: this._p().all(...this.args).map((r) => ({ ...r })) }; }
  async run() { const r = this._p().run(...this.args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  _sync() {
    if (/^\s*(SELECT|WITH)|RETURNING/i.test(this.sql)) return { results: this._p().all(...this.args) };
    const r = this._p().run(...this.args); return { meta: { changes: Number(r.changes) } };
  }
}

export function makeDb({ upTo = Infinity } = {}) {
  const raw = new sqlite.DatabaseSync(':memory:');
  const d1 = {
    raw,
    prepare: (sql) => new Stmt(raw, sql),
    async batch(stmts) { raw.exec('BEGIN'); try { const out = stmts.map((s) => s._sync()); raw.exec('COMMIT'); return out; } catch (e) { raw.exec('ROLLBACK'); throw e; } },
    exec: async (sql) => raw.exec(sql),
  };
  const dir = path.join(ROOT, 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
    if (Number(f.slice(0, 4)) > upTo) break;
    raw.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  return d1;
}

export function applyMigration(d1, number) {
  const dir = path.join(ROOT, 'migrations');
  const f = fs.readdirSync(dir).find((x) => x.startsWith(String(number).padStart(4, '0')));
  d1.raw.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
}

export const aiReply = { value: '{"vendor":"Party City","date":"2026-10-12","total":42.17,"tax":3.17,"suggested_category":"Supplies & decor","line_items":[],"confidence":{"vendor":0.95,"date":0.9,"total":0.95,"tax":0.4}}' };

// An env like production's, with a fake mailer that records what it was asked to send.
export function makeEnv(db) {
  const sent = [];
  const objects = new Map();
  const aiCalls = [];
  const idObjects = new Map();
  return {
    DB: db, PNP_SHEET_FIXTURE: '1', PNP_ADMIN_PASSWORD: 'local-test-pass', PNP_ADMIN_SESSION_KEY: 'test-session-key',
    MAILER: { fetch: async (_u, init) => { sent.push(JSON.parse(init.body)); return Response.json({ ok: true, messageId: 'x' }); } },
    // A private R2 bucket in memory (binding RECEIPTS).
    RECEIPTS: {
      put: async (key, bytes, opts) => { objects.set(key, { bytes: new Uint8Array(bytes), type: opts && opts.httpMetadata ? opts.httpMetadata.contentType : '' }); },
      get: async (key) => { const o = objects.get(key); return o ? { body: o.bytes, arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength) } : null; },
      delete: async (key) => { objects.delete(key); },
    },
    // The private ID-photo bucket (binding IDS), in memory.
    IDS: {
      put: async (key, bytes, opts) => { idObjects.set(key, { bytes: new Uint8Array(bytes), type: opts && opts.httpMetadata ? opts.httpMetadata.contentType : '' }); },
      get: async (key) => { const o = idObjects.get(key); return o ? { body: o.bytes, arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength) } : null; },
      delete: async (key) => { idObjects.delete(key); },
    },
    // Static assets (the Pages ASSETS binding): request.html and friends from the repo.
    // The Design Library's pictures are published by assemble_pages_output.js from LIB_ASSETS.SOURCE
    // to LIB_ASSETS.OUTPUT; the harness serves that same mapping.
    ASSETS: { fetch: async (req) => { const p = new URL(req.url || req).pathname.replace(/^\//, '');
      if (p.startsWith(`${LIB_ASSETS.OUTPUT}/`)) { const n = p.slice(LIB_ASSETS.OUTPUT.length + 1); const f = path.join(ROOT, LIB_ASSETS.SOURCE, n); return LIB_ASSETS.NAME.test(n) && fs.existsSync(f) ? new Response(fs.readFileSync(f), { headers: { 'Content-Type': 'image/webp' } }) : new Response('not found', { status: 404 }); } const f = path.join(ROOT, `${p || 'index'}.html`); return fs.existsSync(f) ? new Response(fs.readFileSync(f, 'utf8'), { headers: { 'Content-Type': 'text/html' } }) : new Response('not found', { status: 404 }); } },
    // Workers AI stand-in: answers whatever aiReply holds (a string, or a function of the input).
    AI: {
      run: async (model, input) => { aiCalls.push({ model, input }); const r = typeof aiReply.value === 'function' ? aiReply.value(input) : aiReply.value; if (r instanceof Error) throw r; return { response: r }; },
      toMarkdown: async () => [{ data: 'HOME DEPOT 10/12/2026 TOTAL 42.17 TAX 3.17' }],
    },
    sent, objects, idObjects, aiCalls, aiReply,
  };
}

// Drive the real router: { method, path, form, headers } -> Response.
export async function call(handler, env, method, p, { form = null, headers = {}, raw = undefined } = {}) {
  const url = `https://porchandparty901.com${p}`;
  let body = raw;
  if (form) { body = new FormData(); for (const [k, v] of Object.entries(form)) (Array.isArray(v) ? v : [v]).forEach((x) => body.append(k, x)); }
  const request = new Request(url, { method, body, headers: { Origin: 'https://porchandparty901.com', ...headers } });
  const params = {};
  const m = p.match(/^\/api\/calendar\/([^/?]+)/);
  if (m) params.token = m[1];
  return handler({ request, env, params, next: async () => new Response('next') });
}
