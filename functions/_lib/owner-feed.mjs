// Read-only owner feed for Boss OS (owner-approved 22 Oct 2026): Simone's emails show
// "Porch & Party — To do for Valerie" from GET /api/owner-feed?range=day|week.
//
// ONE list: every item comes from todoData() in todo-email.mjs, the same object Valerie's 7 AM
// to-do email renders (and, with includeWeek, the Monday "Your week" box). This file only maps
// that object to the feed shape; it never decides on its own what needs her.
// validate:owner-feed proves the feed and the 7 AM email list the same things for one fixture.
//
// Auth: `Authorization: Bearer <token>` against the Pages secret OWNER_FEED_TOKEN (vault name
// pnp-owner-feed-token), compared in constant time (both sides hashed, then XOR-compared). Missing
// secret, missing header or wrong token = 401. No CORS headers, ever (server-to-server only);
// never cached, never indexed. GET / HEAD only. Nothing here writes to the database.
//
// Response, exactly:
//   {"generated_at": ISO, "range": "day"|"week",
//    "items": [{"kind": "deadline|money|renewal|id_delete|mark_done|post|other",
//               "title": str, "detail": str, "due": ISO|null, "link": url|null,
//               "actions"?: [{"label": str, "href": url}]}]}
// range=day : the 7 AM email's list for today (red "check these first", sections 1-5, Tomorrow,
//             Tidy up, the IDs box) + the Marketplace renewal when today is a renew day.
// range=week: the day list + the "Your week" figures (the Monday box, shown every day here) + the
//             jobs of the next 7 days after tomorrow (weekly.mjs, the same 14-day list the Monday
//             box counts) + every Marketplace renewal day in the next 7 days.
import { todoData, WEEK_ROWS } from './todo-email.mjs';
import { weeklyData } from './weekly.mjs';
import { isRenewDay, LISTINGS } from './marketplace-renew.mjs';
import { chicagoDate, dayWords, timeWords } from './reminders.mjs';
import { b64urlText } from './util.mjs';
import { addDays } from './calendar.mjs';
import { useInventory } from './inventory.mjs';

export const SITE = 'https://porchandparty901.com';
export const FEED_KINDS = ['deadline', 'money', 'renewal', 'id_delete', 'mark_done', 'post', 'other'];
export const FEED_RANGES = ['day', 'week'];
export const TOKEN_NAME = 'OWNER_FEED_TOKEN';
const SECTION_KIND = { 1: 'deadline', 2: 'other', 3: 'deadline', 4: 'other', 5: 'money' };
const SELLING = 'https://www.facebook.com/marketplace/you/selling';

const abs = (href) => (href && href.startsWith('/') ? `${SITE}${href}` : (/^https:\/\//.test(href || '') ? href : null));
// Money opens its payment confirmation; other items keep their Open card link.
const linkOf = (it) => {
  const btns = it.btns || [];
  const b = btns.find((x) => x.label === '✓ They paid the deposit') || btns.find((x) => x.label === 'Open card') || btns.find((x) => String(x.href || '').startsWith('/admin'));
  return abs(b ? b.href : it.href || '');
};
const isoDay = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? d : null);
const item = (kind, title, detail, due, link) => ({ kind, title: String(title || ''), detail: String(detail || ''), due: due || null, link: link || null });

// Map one todoData() object to feed items, in the email's order. Pure (the parity test calls it).
export function feedItemsFromTodo(d) {
  const out = [];
  for (const m of d.missed || []) out.push(item(m.reason === 'out' ? 'mark_done' : 'other', m.t, m.d, isoDay(m.date), linkOf(m)));
  for (const n of [1, 2, 3, 4, 5]) {
    for (const it of d.sections[n] || []) {
      let due = null;
      if (n === 1) due = d.today;
      else if (n === 3) due = isoDay(it.date);
      else if (n === 5) due = it.type === 'hold' ? (Number.isFinite(it.untilMs) ? new Date(it.untilMs).toISOString() : null) : isoDay(it.dueDate);
      const entry = item(SECTION_KIND[n], it.t, [it.d, it.p].filter(Boolean).join(' · '), due, linkOf(it));
      // The feed never exposes contact details through telephone / text-message actions.
      if ((it.btns || []).some((b) => b.label === '✓ They paid the deposit')) entry.actions = it.btns.filter((b) => b.href.startsWith('/admin')).map((b) => ({ label: b.label, href: abs(b.href) }));
      out.push(entry);
    }
  }
  for (const j of d.tomorrowJobs || []) out.push(item('deadline', j.t, `Tomorrow, ${dayWords(d.tomorrow)}`, d.tomorrow, linkOf(j)));
  for (const t of d.tidy || []) out.push(item('mark_done', t.t, 'Tidy up: tick it off in the admin', null, `${SITE}/admin/`));
  for (const x of d.ids || []) out.push(item('id_delete', x.t, 'Deletes itself that day. Nothing to do if that is fine.', isoDay(x.day), linkOf(x)));
  const corporate = (d.corporateKeys || []).map((request_key) => ({ request_key }));
  for (const it of out) if (corporate.some((r) => {
    const key = b64urlText(r.request_key);
    return [it.link, ...(it.actions || []).map((a) => a.href)].some((href) => href && (href.includes(`r=${key}`) || href.endsWith(`#c-${key}`)));
  })) it.detail = ['Business / lobby', it.detail].filter(Boolean).join(' · ');
  return out;
}

const renewItem = (day) => item('renewal', 'Renew the Facebook Marketplace listings', `Tap "Renew listing" on each of the ${LISTINGS.length} listings (never delete and re-add)`, day, SELLING);

// The whole feed from D1. now = the request time.
export async function buildOwnerFeed(env, range, now = new Date()) {
  await useInventory(env);
  const today = chicagoDate(now);
  const week = range === 'week';
  const d = await todoData(env.DB, today, now.getTime(), { includeWeek: week });
  const items = feedItemsFromTodo(d);
  if (week) {
    if (d.week) items.push(item('other', 'Your week', WEEK_ROWS(d.week).map(([k, v]) => `${k}: ${v}`).join(' · '), null, `${SITE}/admin/`));
    const w = await weeklyData(env.DB, today, now.getTime());
    const from = addDays(today, 2);
    const to = addDays(today, 6);
    for (const day of w.this.days || []) {
      if (day.date < from || day.date > to) continue;
      for (const b of day.bookings || []) {
        if (b.kind === 'Rental out') continue;
        items.push(item('deadline', `${timeWords(b.time) || 'time not set'} · ${b.who} · ${b.kind}`, dayWords(day.date), day.date, `${SITE}/admin/day/${day.date}`));
      }
    }
  }
  const days = week ? Array.from({ length: 7 }, (_, i) => addDays(today, i)) : [today];
  for (const day of days) if (isRenewDay(day)) items.push(renewItem(day));
  return { generated_at: now.toISOString(), range: week ? 'week' : 'day', items };
}

// Constant-time token check: SHA-256 both sides (equal length), then XOR every byte.
export async function tokenMatches(given, expected) {
  if (typeof expected !== 'string' || expected.length < 32 || typeof given !== 'string' || !given) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(expected))]);
  const x = new Uint8Array(a); const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
}

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const deny = (status, error) => new Response(JSON.stringify({ error }), { status, headers: HEADERS });

export async function handleOwnerFeed({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  const m = /^Bearer\s+(\S+)\s*$/.exec(request.headers.get('Authorization') || '');
  if (!m || !(await tokenMatches(m[1], env[TOKEN_NAME]))) return deny(401, 'unauthorized');
  const raw = new URL(request.url).searchParams.get('range') || 'day';
  if (!FEED_RANGES.includes(raw)) return deny(400, 'range must be day or week');
  const feed = await buildOwnerFeed(env, raw);
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(feed), { status: 200, headers: HEADERS });
}
