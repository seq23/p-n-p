// The one guard in front of /admin and /api/admin/*: noindex + no-store headers on
// every response, same-origin POSTs only, and a valid session for everything
// except the sign-in form itself.
import { isAuthed } from './auth.mjs';

const PUBLIC = [
  (m, p) => m === 'GET' && (p === '/admin' || p === '/admin/'),
  (m, p) => m === 'POST' && p === '/admin/login',
];

function harden(response) {
  const res = new Response(response.body, response);
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', 'no-store');
  res.headers.set('Referrer-Policy', 'no-referrer');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-Content-Type-Options', 'nosniff');
  return res;
}

export async function guard(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return harden(new Response('cross-site request refused', { status: 403 }));
  }
  const open = PUBLIC.some((rule) => rule(method, url.pathname));
  if (!open && !(await isAuthed(request, env))) {
    if (url.pathname.startsWith('/api/')) return harden(Response.json({ error: 'sign in first' }, { status: 401 }));
    return harden(new Response(null, { status: 303, headers: { Location: '/admin' } }));
  }
  try {
    return harden(await context.next());
  } catch (err) {
    return harden(new Response(`Something went wrong: ${String(err && err.message ? err.message : err)}`, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
  }
}
