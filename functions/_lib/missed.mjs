// A MISSED job (owner-approved mock-up, panel 7, 20 Oct 2026): the one definition the 7 AM to-do
// email (todo-email.mjs), the thin red strip on /admin Requests, the card's MISSED tag and the red
// calendar chip all read. Before this, a booking not marked done simply vanished from the email the
// next day (section 1 only lists date === today); only a late rental return was caught, quietly,
// under Money.
//
// Missed = a live booking (its request not put away / void / a test, its invoice not void) whose
// Memphis day is BEFORE today and that is not done:
//   rental_return             the games are not checked back in (calendar.mjs overdueReturns,
//                             the existing definition; a late return was already "overdue")
//   porch_install / *_setup   the booking is not marked done and the request's job is not done
//                             (request_status.job_done_at: "Mark setup done" on the card)
//   rental_pickup             not marked picked up / delivered, and the games are not back
//   *_takedown / grazing_pickup  not marked done and not "Not needed" (takedown_plan =
//                             customer_handles, the card's Not needed button)
//   other                     not marked done
// It clears by itself: marked done, moved to today or later, or Not needed. Oldest first.
//
// The strip's ✕ (settings.missed_strip_dismissed = {"day": <Memphis day>, "ids": [booking ids]})
// hides the strip on every device until the next Memphis day; a missed job that was not in the
// dismissed list shows it again at once. It never hides the card tag, the calendar chip or the email.
import { listBookings, loadReturns, overdueReturns, addDays, isISODate, returnKeyOf } from './calendar.mjs';
import { balances } from './ledger.mjs';
import { shortName } from './requested.mjs';

// The job in her words ("party takedown", "games return"); the email, Set a time and Tomorrow use them.
export const JOB_WORDS = {
  rental_pickup: 'games pickup', rental_return: 'games return', porch_install: 'porch install', porch_takedown: 'porch takedown',
  party_setup: 'party setup', party_takedown: 'party takedown', grazing_setup: 'grazing setup', grazing_pickup: 'grazing pickup', other: 'job',
};
// A rental going to a business: Delivery / Collect (owner, 20 Oct 2026).
export const DELIVERY_JOB_WORDS = { rental_pickup: 'delivery', rental_return: 'collect' };
// The short word on the strip and the card ("set a new takedown day").
export const SHORT_WORDS = {
  rental_pickup: 'pickup', rental_return: 'return', porch_install: 'install', porch_takedown: 'takedown', party_setup: 'setup',
  party_takedown: 'takedown', grazing_setup: 'setup', grazing_pickup: 'pickup', other: 'job',
};
const SETUP_KINDS = new Set(['porch_install', 'party_setup', 'grazing_setup']);
const NOT_NEEDED_KINDS = new Set(['porch_takedown', 'party_takedown', 'grazing_pickup']);
export const DISMISS_KEY = 'missed_strip_dismissed';

export const daysLate = (date, today) => Math.max(1, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 864e5));
export const lateWords = (n) => `${n} day${n === 1 ? '' : 's'} late`;
export const missedCountWords = (n) => `${n} missed job${n === 1 ? '' : 's'}`;
const firstNameOf = (s) => String(s || '').trim().split(/\s+/)[0] || 'them';

// A booking counts unless its request is put away / void / a test, or its invoice is void.
export function isLiveBooking(b, { statuses = {}, reqBy = {}, bals = {} } = {}) {
  const st = b.request_key ? statuses[b.request_key] : null;
  if (st && (st.archived_at || st.status === 'void')) return false;
  if (b.request_key && reqBy[b.request_key] && reqBy[b.request_key].is_test) return false;
  const inv = b.invoice_id || (st && st.invoice_id) || null;
  return !(inv && bals[inv] && bals[inv].void);
}

// bookings: LIVE bookings. delivered(b): a business-delivery rental (Delivery / Collect words).
export function missedFrom({ bookings = [], returns = {}, today, statuses = {}, reqBy = {}, delivered = () => false }) {
  const overdue = new Set(overdueReturns(bookings, returns, today).map((b) => b.id));
  const out = [];
  for (const b of bookings) {
    if (!isISODate(b.date) || b.date >= today) continue;
    const st = b.request_key ? statuses[b.request_key] || null : null;
    const req = b.request_key ? reqBy[b.request_key] || null : null;
    if (b.kind === 'rental_return') {
      if (!overdue.has(b.id)) continue;
    } else {
      if (b.done_at) continue;
      if (SETUP_KINDS.has(b.kind) && st && (st.job_done_at || st.status === 'job_done')) continue;
      if (b.kind === 'rental_pickup' && returns[returnKeyOf(b)] && returns[returnKeyOf(b)].returned_at) continue;
      if (NOT_NEEDED_KINDS.has(b.kind) && req && req.takedown_plan === 'customer_handles') continue;
    }
    const name = b.customer_name || (req && req.name) || '';
    const dl = Boolean(DELIVERY_JOB_WORDS[b.kind] && delivered(b));
    const days = daysLate(b.date, today);
    out.push({
      id: b.id, kind: b.kind, date: b.date, time: b.time || '', key: b.request_key || '', invoice: b.invoice_id || (st && st.invoice_id) || null,
      who: shortName(name) || 'No name', first: firstNameOf(name), phone: b.phone || (req && req.phone) || '', days,
      job: dl ? (b.kind === 'rental_pickup' ? 'games delivery' : 'games collection') : (JOB_WORDS[b.kind] || 'job'),
      short: dl ? DELIVERY_JOB_WORDS[b.kind] : (SHORT_WORDS[b.kind] || 'job'),
      strip: b.kind === 'rental_return' ? (dl ? 'games not collected' : 'games not back') : (dl ? DELIVERY_JOB_WORDS[b.kind] : (SHORT_WORDS[b.kind] || 'job')),
      returnKey: returnKeyOf(b),
    });
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)) || a.id - b.id);
}

// Everything the screens need, straight from D1 (the email builds its own from the data it has).
export async function loadMissed(db, today, { delivered = () => false } = {}) {
  const [all, returns, bals] = await Promise.all([listBookings(db, '0000-01-01', addDays(today, -1)), loadReturns(db), balances(db)]);
  const { results: stRows } = await db.prepare('SELECT * FROM request_status').all();
  const statuses = Object.fromEntries((stRows || []).map((s) => [s.request_key, s]));
  const { results: reqRows } = await db.prepare('SELECT request_key, name, phone, is_test, takedown_plan FROM requests').all();
  const reqBy = Object.fromEntries((reqRows || []).map((x) => [x.request_key, x]));
  return missedFrom({ bookings: all.filter((b) => isLiveBooking(b, { statuses, reqBy, bals })), returns, today, statuses, reqBy, delivered });
}

// ---- the strip's ✕ ----------------------------------------------------------------------------
export function parseDismissed(value) {
  try { const v = JSON.parse(String(value || '')); return v && typeof v.day === 'string' && Array.isArray(v.ids) ? { day: v.day, ids: v.ids.map(Number) } : null; } catch { return null; }
}
// Hidden only today (Memphis) and only while every missed job was already in the dismissed list.
export function stripHidden(missed, value, today) {
  const v = parseDismissed(value);
  if (!v || v.day !== today) return false;
  return missed.every((m) => v.ids.includes(Number(m.id)));
}
export async function dismissStrip(db, today, ids) {
  const clean = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  await db.prepare(`INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(DISMISS_KEY, JSON.stringify({ day: today, ids: clean })).run();
  return clean;
}
