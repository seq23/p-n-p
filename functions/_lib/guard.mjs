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
    // Same-site check. The site answers on both porchandparty901.com and
    // www.porchandparty901.com, and some phone browsers send "Origin: null"
    // on a plain form post, so compare hosts without the www. prefix and let
    // the browser's own Sec-Fetch-Site verdict settle the rest. The session
    // cookie is SameSite=Lax, which already blocks cross-site posts.
    const origin = request.headers.get('Origin');
    const fetchSite = (request.headers.get('Sec-Fetch-Site') || '').toLowerCase();
    const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
    let sameSite = true;
    if (origin && origin !== 'null') {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch { originHost = ''; }
      sameSite = bare(originHost) === bare(url.host);
    } else if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') {
      sameSite = false;
    }
    if (!sameSite) return harden(new Response('cross-site request refused', { status: 403 }));
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
