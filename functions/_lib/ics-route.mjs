// Handler for functions/api/calendar/[token].js. Kept here so the validators can load it.
import { getSettings, safeEqual } from './util.mjs';
import { listBookings, buildIcs, addDays, notesByBooking } from './calendar.mjs';
import { balances, balanceWords } from './ledger.mjs';

const HEADERS = { 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

function notFound() {
  return new Response('not found', { status: 404, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function handleIcs({ request, env, params }) {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return new Response('method not allowed', { status: 405, headers: { ...HEADERS, Allow: 'GET, HEAD' } });
  const raw = String((params && params.token) || '');
  const m = raw.match(/^([a-f0-9]{64})\.ics$/);
  if (!m || !env.DB) return notFound();
  const settings = await getSettings(env.DB);
  const token = settings.calendar_token || '';
  if (token.length !== 64 || !safeEqual(m[1], token)) return notFound();
  const today = new Date().toISOString().slice(0, 10);
  const bookings = await listBookings(env.DB, addDays(today, -90), '9999-12-31');
  const [bals, notes] = await Promise.all([balances(env.DB), notesByBooking(env.DB, bookings)]);
  const rows = bookings.map((b) => {
    const bal = b.invoice_id ? bals[b.invoice_id] : null;
    return { ...b, noteList: notes[b.id] || [], owedText: bal && !bal.void ? balanceWords(bal) : '' };
  });
  const body = buildIcs(rows, { host: new URL(request.url).host.replace(/^www\./, '') });
  return new Response(method === 'HEAD' ? null : body, {
    headers: { ...HEADERS, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="porch-and-party.ics"', 'Cache-Control': 'private, max-age=300' },
  });
}
