// A past step not ticked (owner-approved mock-up, panel 7, 20 Oct 2026): the one definition the 7 AM to-do
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
// Two tiers (classify / tiers below, owner-approved 20 Oct 2026): RED = our things still out
// (return / collect, takedown, grazing pickup) and hand-overs answered ✗ No; YELLOW = hand-overs
// not ticked ("Did this happen?"), never red, never in the email subject.
//
// The strip's ✕ (settings.missed_strip_dismissed = {"day": <Memphis day>, "ids": [booking ids]})
// hides the strip on every device until the next Memphis day; a missed job that was not in the
// dismissed list shows it again at once. It never hides the card tag, the calendar chip or the email.
import { isEnded } from './util.mjs';
import { listBookings, loadReturns, overdueReturns, addDays, isISODate, returnKeyOf } from './calendar.mjs';
import { balances } from './ledger.mjs';
import { shortName } from './requested.mjs';
import { dayWords } from './reminders.mjs';

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
  if (isEnded(st)) return false;
  if (b.request_key && reqBy[b.request_key] && reqBy[b.request_key].is_test) return false;
  const inv = b.invoice_id || (st && st.invoice_id) || null;
  return !(inv && bals[inv] && bals[inv].void);
}

// bookings: LIVE bookings. delivered(b): a business-delivery rental (Delivery / Collect words).
// notHappened: Set of "<booking id>@<date>" she answered ✗ No for (notHappenedSet, request_events).
export function missedFrom({ bookings = [], returns = {}, today, statuses = {}, reqBy = {}, delivered = () => false, notHappened = new Set() }) {
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
      returnKey: returnKeyOf(b), dl, nh: notHappened.has(`${b.id}@${b.date}`),
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
  const notHappened = await notHappenedSet(db);
  return missedFrom({ bookings: all.filter((b) => isLiveBooking(b, { statuses, reqBy, bals })), returns, today, statuses, reqBy, delivered, notHappened });
}

// ---- two tiers (owner-approved mock-up "Did this happen? vs Real problem", 20 Oct 2026) ----------
// THE one classification the Requests strips, the card, the calendar chip and the 7 AM email all
// call (validate:admin-missed-jobs asserts each of the four calls classify / tiers from here):
//   RED     our things still out: a rental return / collect, a porch or party takedown, a grazing
//           pickup, not done by the end of its day (missedFrom only lists days BEFORE today, so
//           the due day itself is normal and red starts the day after). Worded as a question:
//           "Are <Name>'s games back?" / "Is <Name>'s takedown done?". Also red: a hand-over she
//           answered ✗ No for ("<Name> did not pick up on <day>").
//   YELLOW  a hand-over (rental pickup / delivery, porch install, party setup, grazing drop-off,
//           a typed "other" job) past its day and not ticked: "Did this happen?". Never red, never
//           in the email subject or the red box: one quiet "Tidy up" line at the bottom.
export const RED_KINDS = new Set(['rental_return', 'porch_takedown', 'party_takedown', 'grazing_pickup']);
// [question phrase, "did not ..." phrase] for a hand-over.
const HANDOVER = {
  rental_pickup: ['pick up the games', 'pick up'], delivery: ['get the delivery', 'get the delivery'],
  porch_install: ['get the porch install', 'get the porch install'], party_setup: ['get the party setup', 'get the party setup'],
  grazing_setup: ['get the grazing table', 'get the grazing table'], other: ['have the job done', 'have the job done'],
};
const possessive = (who) => `${who}'s`;
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
export const NOT_HAPPENED_PREFIX = 'not-happened:';

export function classify(m) {
  const day = dayWords(m.date);
  if (RED_KINDS.has(m.kind)) {
    const ret = m.kind === 'rental_return';
    const what = ret ? 'games' : (m.kind === 'grazing_pickup' ? 'grazing pickup' : 'takedown');
    return {
      ...m, tier: 'red', reason: 'out', day,
      question: ret ? `Are ${possessive(m.who)} games back?` : `Is ${possessive(m.who)} ${what} done?`,
      due: `Due ${ret ? 'back ' : ''}${day}`,
      notYet: ret ? 'not marked back yet' : 'not marked done yet',
      yes: ret ? '✓ Yes, they\'re back' : '✓ Yes, it\'s done',
      tag: `${ret ? 'Not back yet' : 'Not done yet'} · ${lateWords(m.days)}`,
      marked: ret ? `${possessive(m.who)} games are back` : `${possessive(m.who)} ${what} is done`,
      tidy: '',
    };
  }
  const [ask, didNot] = HANDOVER[m.dl && m.kind === 'rental_pickup' ? 'delivery' : m.kind] || HANDOVER.other;
  if (m.nh) {
    return {
      ...m, tier: 'red', reason: 'not_happened', day,
      question: `${m.who} did not ${didNot} on ${day}`, due: `Was ${day}`, notYet: 'you said it did not happen',
      yes: '✓ Yes, it happened', tag: `Did not happen · ${day}`, marked: `${m.who}: ${m.job} done`, tidy: '',
    };
  }
  return {
    ...m, tier: 'yellow', reason: 'handover', day,
    question: `Did ${m.first} ${ask} on ${day}?`, due: day, notYet: 'not ticked off yet',
    yes: '✓ Yes, it happened', no: '✗ No', tag: `Did this happen? ${cap(m.job)} ${day}`,
    row: `${m.who} · ${m.job} · ${day}`, tidy: `${possessive(m.who)} ${m.short}`, marked: `${m.who}: ${m.job} done`,
  };
}
// { red, yellow }: each classified, oldest first (the order missedFrom gives).
export function tiers(list = []) {
  const all = list.map(classify);
  return { red: all.filter((m) => m.tier === 'red'), yellow: all.filter((m) => m.tier === 'yellow') };
}
// The email subject's warning: ONLY red items. "⚠ N not back yet · " when every red item is
// something still out, "⚠ N to check · " when a ✗ No is among them.
export function subjectWarning(red = []) {
  if (!red.length) return '';
  return red.some((m) => m.reason === 'not_happened') ? `⚠ ${red.length} to check · ` : `⚠ ${red.length} not back yet · `;
}
export const stepWords = (n) => `${n} step${n === 1 ? '' : 's'} to tick off`;

// ✗ No on a yellow item: one request_events row (the card's history shows its words; who carries
// the marker "not-happened:<booking id>@<date>", so moving the booking to another day clears it).
export async function notHappenedSet(db) {
  const { results } = await db.prepare("SELECT who FROM request_events WHERE who LIKE 'not-happened:%'").all();
  return new Set((results || []).map((r) => String(r.who).slice(NOT_HAPPENED_PREFIX.length)));
}
export async function recordNotHappened(db, b, m) {
  await db.prepare('INSERT INTO request_events (request_key, who, what) VALUES (?1, ?2, ?3)')
    .bind(b.request_key || `booking:${b.id}`, `${NOT_HAPPENED_PREFIX}${b.id}@${b.date}`, `Did not happen: ${m.question}. Call them.`).run();
}

// ---- auto-tick (owner, 20 Oct 2026) --------------------------------------------------------------
// When a later step of a job is marked done, the earlier steps of the SAME job (same request)
// that are still open are ticked too: games back / collected => pickup / delivery done; takedown
// done => setup / install done; grazing pickup done => grazing setup done. Applies at the moment
// the later step is marked (never retroactively). One history line per ticked step.
export const EARLIER = { rental_return: ['rental_pickup'], porch_takedown: ['porch_install'], party_takedown: ['party_setup'], grazing_pickup: ['grazing_setup'] };
export async function autoTickEarlier(db, { kind, request_key: key }, { delivered = false } = {}) {
  const earlier = EARLIER[kind];
  if (!earlier || !key) return [];
  const ph = earlier.map((_, i) => `?${i + 2}`).join(',');
  const { results } = await db.prepare(`SELECT id, kind, date FROM bookings WHERE request_key = ?1 AND kind IN (${ph}) AND done_at IS NULL`).bind(key, ...earlier).all();
  const st = await db.prepare('SELECT job_done_at FROM request_status WHERE request_key = ?1').bind(key).first();
  const ticked = [];
  for (const b of results || []) {
    await db.prepare("UPDATE bookings SET done_at = COALESCE(done_at, datetime('now')) WHERE id = ?1").bind(b.id).run();
    ticked.push(b);
  }
  // A setup step is ticked on the card by request_status.job_done_at (steps.mjs): same SQL as "Mark setup done".
  const setupOpen = (results || []).some((b) => SETUP_KINDS.has(b.kind)) && !(st && st.job_done_at);
  if (setupOpen) {
    await db.prepare(`INSERT INTO request_status (request_key, status, job_done_at, prev_status, updated_at) VALUES (?1, 'job_done', datetime('now'), 'new', datetime('now'))
      ON CONFLICT(request_key) DO UPDATE SET prev_status = CASE WHEN request_status.status = 'job_done' THEN request_status.prev_status ELSE request_status.status END,
        status = 'job_done', job_done_at = COALESCE(request_status.job_done_at, datetime('now')), updated_at = datetime('now')`).bind(key).run();
  }
  for (const b of ticked) await db.prepare('INSERT INTO request_events (request_key, who, what) VALUES (?1, ?2, ?3)').bind(key, 'auto', autoTickWords(b.kind, kind, delivered)).run();
  return ticked;
}
export function autoTickWords(earlierKind, laterKind, delivered = false) {
  const step = earlierKind === 'rental_pickup' ? (delivered ? 'Delivery' : 'Pickup') : (earlierKind === 'porch_install' ? 'Install' : 'Setup');
  const why = laterKind === 'rental_return' ? (delivered ? 'games collected' : 'games came back') : (laterKind === 'grazing_pickup' ? 'pickup done' : 'takedown done');
  return `${step} ticked off automatically (${why})`;
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
