// Routes for the Quick Pricing Summary (/admin/pricing; owner, 20 Oct 2026). Behind the one
// admin guard (functions/admin/_middleware.js: session + same-origin POSTs + noindex).
//   GET  /admin/pricing        the page (prices from the live inventory + the offer files)
//   POST /admin/pricing/email  s=<section|all>, to=<address>: sends the price list from hello@
//                              through the same mailer seam as every customer email
//                              (messages.mjs sendPriceList -> the shared deliver()), logs "Price list emailed (<service>)"
//                              on the newest request with that address, once a minute at most
//                              per address + section.
import services from '../../data/offers/services.json';
import porchPackages from '../../data/offers/porch_packages.json';
import { GAMES } from './prices.mjs';
import { priceSummary, emailFor, sectionOf, SECTION_KEYS } from './price-summary.mjs';
import { pricingPage } from './views-pricing.mjs';
import { sendPriceList } from './messages.mjs';
import { hasEmail } from './reminders.mjs';
import { holdSettings } from './holds.mjs';
import { getSettings, putSetting } from './util.mjs';
import { logEvent } from './requests.mjs';

export const RATE_MS = 60 * 1000;
const RATE_KEY = 'pricelist_recent';

const html = (body) => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const back = (q, which) => new Response(null, { status: 303, headers: { Location: `/admin/pricing?${q}${which && which !== 'all' ? `#${which}` : ''}` } });

export async function liveModel(env) {
  let hours = NaN;
  try { hours = holdSettings(env.DB ? await getSettings(env.DB) : {}).hours; } catch { hours = holdSettings({}).hours; }
  return priceSummary({ games: GAMES, services, porchPackages, holdHours: hours });
}

async function customerEmails(db) {
  if (!db) return [];
  try {
    const { results } = await db.prepare("SELECT lower(trim(email)) AS e FROM requests WHERE email LIKE '%_@_%._%' GROUP BY lower(trim(email)) ORDER BY MAX(submitted_at) DESC LIMIT 300").all();
    return (results || []).map((r) => r.e).filter(hasEmail);
  } catch { return []; }
}

export async function pricingRoute(env, url) {
  const p = url.searchParams;
  const s = p.get('s') || '';
  const flash = s ? { s, sent: p.get('sent') || '', err: p.get('err') || '', to: p.get('to') || '' } : null;
  return html(pricingPage(await liveModel(env), { emails: await customerEmails(env.DB), flash }));
}

// Same address + section once a minute (a double tap never sends twice). Kept in one settings
// row (no migration), pruned on every send; marked only after the mailer said yes.
async function recentSends(db, now) {
  if (!db) return {};
  let seen = {};
  try { seen = JSON.parse((await getSettings(db))[RATE_KEY] || '{}') || {}; } catch { seen = {}; }
  return Object.fromEntries(Object.entries(seen).filter(([, t]) => now - Number(t) < RATE_MS));
}

export async function emailRoute(env, request, { now = Date.now() } = {}) {
  let form;
  try { form = await request.formData(); } catch { form = new FormData(); }
  const which = String(form.get('s') || '');
  const to = String(form.get('to') || '').trim().toLowerCase();
  if (which !== 'all' && !SECTION_KEYS.includes(which)) return back(`s=all&err=${encodeURIComponent('That price list could not be found.')}`, 'all');
  const q = (err) => `s=${encodeURIComponent(which)}&to=${encodeURIComponent(to)}&err=${encodeURIComponent(err)}`;
  if (!hasEmail(to)) return back(q('That email address does not look right. Check it and try again.'), which);
  const model = await liveModel(env);
  const ctx = emailFor(model, which);
  const mark = `${to}|${which}`;
  const recent = await recentSends(env.DB, now);
  if (recent[mark]) return back(q(`You already sent this to ${to} a moment ago. Wait a minute to send it again.`), which);
  const out = await sendPriceList(env, ctx, { to });
  if (!out.ok) return back(q(`The email did not go out. (${out.error})`), which);
  if (env.DB) await putSetting(env.DB, RATE_KEY, JSON.stringify({ ...recent, [mark]: now }));
  if (env.DB) {
    const row = await env.DB.prepare('SELECT request_key FROM requests WHERE lower(trim(email)) = ?1 ORDER BY submitted_at DESC LIMIT 1').bind(to).first().catch(() => null);
    const service = which === 'all' ? 'all services' : sectionOf(model, which).title.toLowerCase();
    if (row && row.request_key) await logEvent(env.DB, row.request_key, `Price list emailed (${service})`, 'Valerie');
  }
  return back(`s=${encodeURIComponent(which)}&sent=${encodeURIComponent(to)}`, which);
}
