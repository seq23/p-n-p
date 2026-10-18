// A signed-in admin session over a fresh local database (validators only). Drives the real
// router (functions/_lib/admin.mjs) and the real guard; never touches production.
import { mod, makeDb, makeEnv, call } from './admin_harness.mjs';

export async function session({ db = makeDb() } = {}) {
  const A = await mod('functions/_lib/admin.mjs');
  const { guard } = await mod('functions/_lib/guard.mjs');
  const { issueCookie } = await mod('functions/_lib/auth.mjs');
  const { PRICE_TABLE } = await mod('functions/_lib/prices.mjs');
  const { prefillLines } = await mod('functions/_lib/pricing.mjs');
  const { loadRequests } = await mod('functions/_lib/sheet.mjs');
  const util = await mod('functions/_lib/util.mjs');
  const env = makeEnv(db);
  const cookie = (await issueCookie(env)).split(';')[0];
  // Through the guard, like production: guard -> router.
  const routed = (ctx) => guard({ ...ctx, next: () => (new URL(ctx.request.url).pathname.startsWith('/api/admin') ? A.handleApi(ctx) : A.handleAdmin(ctx)) });
  const get = async (p, { auth = true, headers = {} } = {}) => {
    const r = await call(routed, env, 'GET', p, { headers: { ...(auth ? { Cookie: cookie } : {}), ...headers } });
    return { status: r.status, location: r.headers.get('Location') || '', headers: r.headers, text: await r.text() };
  };
  const post = async (p, form = {}, { auth = true, headers = {} } = {}) => {
    const r = await call(routed, env, 'POST', p, { form, headers: { ...(auth ? { Cookie: cookie } : {}), ...headers } });
    return { status: r.status, location: r.headers.get('Location') || '', text: await r.text() };
  };
  const requests = await loadRequests(env);
  const rk = (key) => util.b64urlText(key);
  // Create an invoice from a fixture request the way the editor posts it.
  async function invoiceFor(request, { plan = 'half', go = 'save', deposit = '', email = request.email } = {}) {
    const lines = prefillLines(request, PRICE_TABLE).map((l) => (l.unit_cents === 0 && !l.refundable ? { ...l, unit_cents: 25000 } : l));
    const form = {
      r: rk(request.key), customer_name: request.name, customer_email: email, customer_phone: request.phone, issue_date: '2026-10-18', due_date: '2026-10-22',
      pay_plan: plan, deposit, notes: '', go,
      line_desc: lines.map((l) => l.description), line_qty: lines.map((l) => String(l.qty)), line_price: lines.map((l) => (l.unit_cents / 100).toFixed(2)),
      line_note: lines.map((l) => l.note), line_refundable: lines.map((l) => (l.refundable ? '1' : '0')),
    };
    const res = await post('/admin/invoices', form);
    const id = Number((res.location.match(/\/admin\/invoices\/(\d+)/) || [])[1]);
    return { id, res, lines };
  }
  const one = async (sql, ...args) => db.prepare(sql).bind(...args).first();
  const all = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
  return { env, db, A, get, post, requests, rk, invoiceFor, one, all, PRICE_TABLE, util, cookie };
}
