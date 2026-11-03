// pnp-mailer's fetch() sends only for a caller holding the shared secret (security sweep,
// 3 Nov 2026). Entirely local: the real Worker module with a fake EMAIL binding; nothing is sent.
// The other half (every Pages caller sends the header) is proven by the harness's fake MAILER,
// which refuses a call without it, in every validator that sends mail.
import assert from 'node:assert/strict';
import { mod } from './lib/admin_harness.mjs';
const worker = (await mod('workers/pnp-mailer/src/index.js')).default;
const { mailerHeaders } = await mod('functions/_lib/mailer-auth.mjs');
const SECRET = 'test-only-mailer-secret-thirty-two-plus-chars';
const msg = { to: 'fixture@example.com', subject: 'Fixture', html: '<p>Fixture</p>' };
async function send(headers, env) {
  const sent = [];
  const e = { ...env, EMAIL: { send: async (m) => { sent.push(m); return { messageId: 'fx' }; } } };
  const res = await worker.fetch(new Request('https://pnp-mailer.internal/send', { method: 'POST', headers, body: JSON.stringify(msg) }), e);
  return { status: res.status, sent: sent.length };
}
const env = { PNP_MAILER_SECRET: SECRET };
const cases = [
  ['no header', { 'Content-Type': 'application/json' }, env, 401, 0],
  ['wrong header', { 'Content-Type': 'application/json', 'x-pnp-mailer-secret': 'x'.repeat(SECRET.length) }, env, 401, 0],
  ['prefix of the secret', { 'Content-Type': 'application/json', 'x-pnp-mailer-secret': SECRET.slice(0, -1) }, env, 401, 0],
  ['Worker missing its secret fails closed', mailerHeaders({ PNP_MAILER_SECRET: '' }), {}, 401, 0],
  ['Worker missing its secret, caller sends one', mailerHeaders(env), {}, 401, 0],
  ['the shared secret sends once', mailerHeaders(env), env, 200, 1],
];
let n = 0;
for (const [name, headers, e, status, sent] of cases) {
  const r = await send(headers, e);
  assert.deepEqual(r, { status, sent }, `${name}: got ${JSON.stringify(r)}`);
  n += 1;
}
assert.ok(n === cases.length && n > 0, 'examined zero cases');
console.log(`validate_mailer_auth: ${n} cases pass (no secret, wrong or partial secret, or an unconfigured Worker sends nothing).`);
