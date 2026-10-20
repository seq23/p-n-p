// Rental holds (owner, 18 Oct 2026; table `holds`, migration 0006). A rental booked on the
// site form holds its games for the hold length (Settings, default 24 hours): its pickup and
// return bookings are on the calendar and count as games out. "Mark deposit received" turns
// the hold into a confirmed booking. Unpaid at the end time: the hold expires by itself (when
// "Expire unpaid holds automatically" is on), the bookings come off, the games free up and the
// request stays New with a "Hold expired" note. Every change is logged on the request.
import { logEvent } from './requests.mjs';

export const RENTAL_KINDS = ['rental_pickup', 'rental_return'];
import { HOLD_DEFAULT_HOURS } from './hold-rules.mjs';
export { HOLD_DEFAULT_HOURS, HOLD_EXTEND_DAYS, HOLD_EXTEND_MAX_DAYS } from './hold-rules.mjs';

export const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
export const fromSql = (s) => (s ? Date.parse(`${String(s).replace(' ', 'T')}Z`) : NaN);

export function holdSettings(settings = {}) {
  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  return {
    hours: num(settings.hold_hours, HOLD_DEFAULT_HOURS, 1, 336),
    autoExpire: settings.hold_auto_expire !== '0',
    reminderOn: settings.hold_reminder !== '0',
    reminderHours: num(settings.hold_reminder_hours, 4, 1, 48),
    soonHours: num(settings.hold_soon_hours, 12, 1, 72),
  };
}

export async function createHold(db, key, { now = Date.now(), settings = {} } = {}) {
  const s = holdSettings(settings);
  const until = s.autoExpire ? sqlTime(now + s.hours * 3600000) : null;
  await db.prepare(`INSERT INTO holds (request_key, state, until, by_hand) VALUES (?1, 'held', ?2, ?3)
    ON CONFLICT(request_key) DO UPDATE SET state = 'held', until = excluded.until, by_hand = excluded.by_hand, reminded_for = NULL, updated_at = datetime('now')`)
    .bind(key, until, s.autoExpire ? 0 : 1).run();
  await logEvent(db, key, until ? `Games reserved until ${until} UTC (${s.hours} hours)` : 'Games reserved by hand (automatic expiry is off in Settings)', 'website form');
  return { until, byHand: !s.autoExpire };
}

export async function getHold(db, key) {
  return db.prepare('SELECT * FROM holds WHERE request_key = ?1').bind(key).first();
}

// Releases the games of a hold that is no longer held (expired / released by hand).
async function freeGames(db, key) {
  await db.prepare(`DELETE FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return')`).bind(key).run();
}

// Every unpaid, timed hold whose end has passed. Safe to call on any request: it is the
// automatic expiry (the hourly mailer cron and every page that shows availability call it).
export async function expireHolds(db, now = Date.now()) {
  const { results } = await db.prepare("SELECT request_key FROM holds WHERE state = 'held' AND by_hand = 0 AND until IS NOT NULL AND until <= ?1").bind(sqlTime(now)).all();
  for (const h of results || []) {
    const claim = await db.prepare("UPDATE holds SET state = 'expired', updated_at = datetime('now') WHERE request_key = ?1 AND state = 'held'").bind(h.request_key).run();
    if (claim && claim.meta && claim.meta.changes === 0) continue;
    await freeGames(db, h.request_key);
    await logEvent(db, h.request_key, 'Hold expired: no deposit by the end time, so the games are free again', 'automatic');
  }
  return (results || []).length;
}

// "Mark deposit received" on a held rental.
export async function confirmHold(db, key, who = 'admin') {
  const r = await db.prepare("UPDATE holds SET state = 'confirmed', updated_at = datetime('now') WHERE request_key = ?1 AND state = 'held'").bind(key).run();
  const changed = Boolean(r && r.meta && r.meta.changes);
  if (changed) await logEvent(db, key, 'Deposit received: the hold is now a confirmed booking', who);
  return changed;
}

// ---- Valerie's hold controls (owner, 18 Oct 2026) -------------------------------------------
// Every change is logged on the request ("Hold extended to ... by Valerie"). The reminder is
// tied to the CURRENT end time (reminded_for), so a new end time gets its own one reminder.

export async function extendHold(db, key, { hours = 0, until = '', now = Date.now() } = {}, who = 'Valerie') {
  const h = await getHold(db, key);
  if (!h || !['held', 'expired'].includes(h.state)) return { ok: false, error: 'There is no hold on these games any more.' };
  let end;
  if (until) { end = Date.parse(until); if (!Number.isFinite(end) || end <= now) return { ok: false, error: 'Pick a day and time in the future.' }; }
  else { const base = Math.max(now, fromSql(h.until) || now); end = base + Math.max(1, Number(hours) || 24) * 3600000; }
  await db.prepare("UPDATE holds SET state = 'held', until = ?2, by_hand = 0, updated_at = datetime('now') WHERE request_key = ?1").bind(key, sqlTime(end)).run();
  await logEvent(db, key, `Hold extended to ${sqlTime(end)} UTC by ${who}`, who);
  return { ok: true, until: sqlTime(end) };
}

export async function keepHolding(db, key, who = 'Valerie') {
  const r = await db.prepare("UPDATE holds SET by_hand = 1, until = NULL, updated_at = datetime('now') WHERE request_key = ?1 AND state = 'held'").bind(key).run();
  if (r && r.meta && r.meta.changes) await logEvent(db, key, `Held by hand: automatic expiry turned off by ${who}`, who);
  return Boolean(r && r.meta && r.meta.changes);
}

export async function releaseHold(db, key, who = 'Valerie') {
  const r = await db.prepare("UPDATE holds SET state = 'released', updated_at = datetime('now') WHERE request_key = ?1 AND state = 'held'").bind(key).run();
  if (!(r && r.meta && r.meta.changes)) return false;
  await db.prepare(`DELETE FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return')`).bind(key).run();
  await logEvent(db, key, `Games released by ${who}: the hold is over and the games are free again`, who);
  return true;
}

// Every current hold, soonest end first, held-by-hand ones last.
export async function currentHolds(db) {
  const { results } = await db.prepare(`SELECT h.*, r.name, r.phone, r.email,
      (SELECT items FROM bookings b WHERE b.request_key = h.request_key AND b.kind = 'rental_pickup' LIMIT 1) AS items,
      (SELECT date FROM bookings b WHERE b.request_key = h.request_key AND b.kind = 'rental_pickup' LIMIT 1) AS pickup,
      (SELECT rs.invoice_id FROM request_status rs WHERE rs.request_key = h.request_key) AS invoice_id
    FROM holds h LEFT JOIN requests r ON r.request_key = h.request_key WHERE h.state = 'held'
    ORDER BY h.by_hand, h.until`).all();
  return (results || []).map((h) => ({ ...h, untilMs: fromSql(h.until) }));
}

export function endingSoon(holds, now = Date.now(), settings = {}) {
  const s = holdSettings(settings);
  return holds.filter((h) => !h.by_hand && Number.isFinite(h.untilMs) && h.untilMs - now <= s.soonHours * 3600000);
}

// The automatic hold reminder (email): once per end time, reminderHours before it.
export async function dueHoldReminders(db, now = Date.now(), settings = {}) {
  const s = holdSettings(settings);
  if (!s.reminderOn) return [];
  const { results } = await db.prepare(`SELECT h.*, r.name, r.email, r.phone FROM holds h JOIN requests r ON r.request_key = h.request_key
    WHERE h.state = 'held' AND h.by_hand = 0 AND h.until IS NOT NULL AND h.until > ?1 AND h.until <= ?2 AND (h.reminded_for IS NULL OR h.reminded_for <> h.until)`)
    .bind(sqlTime(now), sqlTime(now + s.reminderHours * 3600000)).all();
  return results || [];
}

export async function claimHoldReminder(db, key, until) {
  const r = await db.prepare('UPDATE holds SET reminded_for = ?2 WHERE request_key = ?1 AND until = ?2 AND (reminded_for IS NULL OR reminded_for <> ?2)').bind(key, until).run();
  return Boolean(r && r.meta && r.meta.changes);
}
export async function releaseHoldReminderClaim(db, key) {
  await db.prepare('UPDATE holds SET reminded_for = NULL WHERE request_key = ?1').bind(key).run();
}
