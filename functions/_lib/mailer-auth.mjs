// The shared secret between the p-n-p Pages Functions and the pnp-mailer Worker (security sweep,
// 3 Nov 2026). The mailer is reachable only through the MAILER service binding, but its fetch()
// sends whatever it is handed, so it also requires this header: defence in depth if a route,
// workers.dev URL or another binding ever reaches it. Both sides read PNP_MAILER_SECRET (a secret
// on the Pages project and on the Worker; the value lives in the Boss OS vault under that name).
export const MAILER_SECRET_HEADER = 'x-pnp-mailer-secret';

/** Headers for every POST to the mailer. */
export function mailerHeaders(env) {
  return { 'Content-Type': 'application/json', [MAILER_SECRET_HEADER]: String((env && env.PNP_MAILER_SECRET) || '') };
}

/** Constant-time check of the caller's header. A missing secret on the Worker fails closed. */
export function mailerCallerOk(request, env) {
  const want = String((env && env.PNP_MAILER_SECRET) || '');
  if (want.length < 32) return false;
  const got = String(request.headers.get(MAILER_SECRET_HEADER) || '');
  const a = new TextEncoder().encode(got.padEnd(want.length, '\0'));
  const b = new TextEncoder().encode(want);
  let diff = got.length === want.length ? 0 : 1;
  for (let i = 0; i < b.length; i += 1) diff |= (a[i] || 0) ^ b[i];
  return diff === 0;
}
