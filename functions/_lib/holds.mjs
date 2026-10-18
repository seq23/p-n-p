// Rental holds (owner, 18 Oct 2026; table `holds`, migration 0006). A rental booked on the
// site form holds its games for the hold length (Settings, default 24 hours): its pickup and
// return bookings are on the calendar and count as games out. "Mark deposit received" turns
// the hold into a confirmed booking. Unpaid at the end time: the hold expires by itself (when
// "Expire unpaid holds automatically" is on), the bookings come off, the games free up and the
// request stays New with a "Hold expired" note. Every change is logged on the request.
import { logEvent } from './requests.mjs';

export const RENTAL_KINDS = ['rental_pickup', 'rental_return'];

export const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
export const fromSql = (s) => (s ? Date.parse(`${String(s).replace(' ', 'T')}Z`) : NaN);

export function holdSettings(settings = {}) {
  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  return {
    hours: num(settings.hold_hours, 24, 1, 336),
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
  await logEvent(db, key, until ? `Games held until ${until} UTC (${s.hours} hours)` : 'Games held by hand (automatic expiry is off in Settings)', 'website form');
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
