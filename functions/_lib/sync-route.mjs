// Handler for functions/api/sync/[token].js. Kept here so the validators can load it.
import { getSettings, safeEqual } from './util.mjs';
import { syncSafely } from './admin-money.mjs';

const HEADERS = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export async function handleSync({ request, env, params }) {
  if (request.method.toUpperCase() !== 'POST') return new Response('method not allowed', { status: 405, headers: { ...HEADERS, Allow: 'POST' } });
  const tok = String((params && params.token) || '');
  if (!/^[a-f0-9]{64}$/.test(tok) || !env.DB) return new Response('not found', { status: 404, headers: HEADERS });
  const settings = await getSettings(env.DB);
  const token = settings.sync_token || '';
  if (token.length !== 64 || !safeEqual(tok, token)) return new Response('not found', { status: 404, headers: HEADERS });
  const out = await syncSafely(env);
  return Response.json(out, { status: out.ok || out.skipped ? 200 : 502, headers: HEADERS });
}
