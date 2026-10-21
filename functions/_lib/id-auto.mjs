// IDs delete themselves 90 days after they are ready (owner decision and approved mock-up
// "ID Auto Delete", 20 Oct 2026; docs/admin-console.md "IDs ready to delete"; migration 0022).
//
//   Ready     an ID still on file and the job paid in full (for a rental, the games back), or the
//             job cancelled (void). readyToDeleteId is the ONE test: the main page's list, the
//             clock and the hourly delete all read it.
//   Clock     requests.id_ready_since is set the first time an ID is seen ready (the hourly cron or
//             the main page) and cleared by the cron if it stops being ready (a payment undone, a
//             job un-cancelled). IDs already ready when this went live started on that day, so
//             nothing was deleted at switch-on.
//   Delete    deleteDay = the Memphis day 90 days after id_ready_since, or id_keep_until if later;
//             never with id_keep_forever. The pnp-mailer hourly cron (autoDeleteIds) deletes each
//             website-form ID on or after its day through deleteIdNow, the same code path as the
//             manual "Delete now" (R2 object deleted, id_deleted_at set, id_object NULL, logged).
//   Drive     Google-form IDs (source 'google_form', a Drive copy) are NEVER deleted by the cron:
//             the site cannot reach her Drive, so the row says so and offers "I deleted it".
//   Heads-up  the 7 AM to-do email lists, in its last box, every ID that deletes itself within 7
//             days (idsDueSoon), with "Keep it longer" (a confirm screen) and "Open card".
import { loadRequestsFromDb, idOnFile, logEvent } from './requests.mjs';
import { balances } from './ledger.mjs';
import { loadReturns, addDays } from './calendar.mjs';
import { chicagoDate, dayWords } from './reminders.mjs';

export const ID_AUTO_DAYS = 90;
export const ID_WARN_DAYS = 7;
export const AUTO_EVENT = 'ID photo deleted for good automatically (90 days after it was ready)';
export const AUTO_WHO = 'automatic (hourly job)';
export const DRIVE_WORDS = "📁 This one is in your Google Drive ID folder. It can't delete itself.";
export const EMAIL_TITLE = '🪪 IDs that delete themselves this week';
export const EMAIL_FOOT = "Nothing to do if that's fine. It happens by itself.";
// "Keep this ID longer" choices (the approved mock-up, frame 2), in order.
export const KEEP_CHOICES = [['30', 'Keep 30 more days'], ['90', 'Keep 90 more days'], ['forever', 'Keep until I delete it myself']];

// The ONE "ready to delete" test: paid in full and, for a rental, the games back; or cancelled.
export function readyToDeleteId(r, st, inv, ret) {
  const bal = inv && inv.balance;
  if ((st && st.status === 'void') || (bal && bal.void)) return true;
  const paidFull = bal ? (bal.total > 0 && bal.remaining === 0) : Boolean(st && st.status === 'paid');
  if (!paidFull) return false;
  return r.wantsRentals ? Boolean(ret && ret.returned_at) : true;
}

// A website-form (or phone-added) ID lives in the private R2 bucket and can delete itself.
export const canAutoDelete = (r) => r.source !== 'google_form';
const sqlNow = (now) => new Date(now).toISOString().slice(0, 19).replace('T', ' ');
const memphisDayOf = (utc) => chicagoDate(new Date(`${String(utc).replace(' ', 'T')}Z`));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

// The day it deletes itself (Memphis YYYY-MM-DD), or '' when it never does (Drive, kept forever).
// An ID not clocked yet (ready, the cron has not run since) reads as ready today.
export function deleteDay(r, today) {
  if (!canAutoDelete(r) || r.idKeepForever) return '';
  const base = addDays(r.idReadySince ? memphisDayOf(r.idReadySince) : today, ID_AUTO_DAYS);
  return r.idKeepUntil && r.idKeepUntil > base ? r.idKeepUntil : base;
}

// What one row of "IDs ready to delete" says (the approved mock-up, frames 1 and 6).
export function idRowState(r, today) {
  if (!canAutoDelete(r)) return { kind: 'drive', words: DRIVE_WORDS };
  if (r.idKeepForever) return { kind: 'forever', words: '🔒 Kept until you delete it yourself' };
  const day = deleteDay(r, today);
  const days = Math.max(0, daysBetween(today, day));
  const base = addDays(r.idReadySince ? memphisDayOf(r.idReadySince) : today, ID_AUTO_DAYS);
  if (r.idKeepUntil && r.idKeepUntil > base) return { kind: 'kept', day, days, words: `🔒 Kept until ${dayWords(day)}, then deletes itself` };
  const inWords = days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;
  const soon = days <= ID_WARN_DAYS;
  return { kind: 'due', day, days, soon, words: `${soon ? '⏳ ' : ''}Deletes itself on ${dayWords(day)} (${inWords})` };
}

// Every request whose ID is ready to delete, from D1 (or from requests the caller already loaded).
export async function readyIds(db, requests = null) {
  const [reqs, bals, returns, { results: stRows }] = await Promise.all([
    requests ? Promise.resolve(requests) : loadRequestsFromDb(db), balances(db), loadReturns(db), db.prepare('SELECT * FROM request_status').all()]);
  const st = Object.fromEntries((stRows || []).map((s) => [s.request_key, s]));
  const ready = reqs.filter((r) => idOnFile(r) && readyToDeleteId(r, st[r.key], st[r.key] && st[r.key].invoice_id && bals[st[r.key].invoice_id] ? { balance: bals[st[r.key].invoice_id] } : null, returns[r.key]));
  return { all: reqs, ready };
}

// Start the clock on every ready website-form ID that has none. clear: also stop the clock on any
// ID still on file that is no longer ready (only the cron clears; it reads every request first).
export async function syncClock(db, { all, ready }, { now = Date.now(), clear = false } = {}) {
  const at = sqlNow(now);
  const readyKeys = new Set(ready.map((r) => r.key));
  let started = 0; let cleared = 0;
  for (const r of ready) {
    if (!canAutoDelete(r) || r.idReadySince) continue;
    const res = await db.prepare('UPDATE requests SET id_ready_since = ?1 WHERE request_key = ?2 AND id_ready_since IS NULL AND id_deleted_at IS NULL').bind(at, r.key).run();
    if (res && res.meta && res.meta.changes) { started += 1; r.idReadySince = at; }
  }
  if (clear) {
    for (const r of all) {
      if (!r.idReadySince || readyKeys.has(r.key) || r.idDeletedAt) continue;
      const res = await db.prepare('UPDATE requests SET id_ready_since = NULL WHERE request_key = ?1 AND id_deleted_at IS NULL').bind(r.key).run();
      if (res && res.meta && res.meta.changes) { cleared += 1; r.idReadySince = ''; }
    }
  }
  return { started, cleared };
}

// Delete one ID for good: the ONE code path for "Delete now" / "Delete this ID" and the cron.
export async function deleteIdNow(env, key, row, { auto = false, who = '', now = Date.now() } = {}) {
  if (row.id_object && env.IDS) await env.IDS.delete(row.id_object);
  await env.DB.prepare('UPDATE requests SET id_deleted_at = ?1, id_object = NULL, id_deleted_auto = ?2 WHERE request_key = ?3').bind(sqlNow(now), auto ? 1 : 0, key).run();
  const what = auto ? AUTO_EVENT
    : (row.source !== 'google_form' ? 'ID photo deleted for good from private storage' : 'ID marked deleted (the Drive copy is deleted by hand from the ID folder)');
  await logEvent(env.DB, key, what, who || (auto ? AUTO_WHO : ''));
}

// The hourly cron (workers/pnp-mailer): clock every ready ID, then delete the ones whose day came.
export async function autoDeleteIds(env, { now = Date.now(), dryRun = false } = {}) {
  if (!env.IDS) return { ok: false, skipped: 'no IDS binding: nothing deleted' };
  const today = chicagoDate(new Date(now));
  const set = await readyIds(env.DB);
  const clock = dryRun ? { started: 0, cleared: 0 } : await syncClock(env.DB, set, { now, clear: true });
  const due = set.ready.filter((r) => canAutoDelete(r) && r.idObject && !r.idDeletedAt && r.idReadySince && deleteDay(r, today) && deleteDay(r, today) <= today);
  if (dryRun) return { ok: true, dryRun: true, ready: set.ready.length, wouldDelete: due.length };
  for (const r of due) await deleteIdNow(env, r.key, { source: r.source, id_object: r.idObject }, { auto: true, now });
  return { ok: true, ready: set.ready.length, clockStarted: clock.started, clockCleared: clock.cleared, deleted: due.length };
}

// "Keep this ID longer": 30 or 90 more days from the day it would delete itself (or today, if
// that is later), or until she deletes it herself. Returns the words for the flash.
export async function keepLonger(db, r, how, { now = Date.now() } = {}) {
  const today = chicagoDate(new Date(now));
  if (how === 'forever') {
    await db.prepare('UPDATE requests SET id_keep_forever = 1 WHERE request_key = ?1').bind(r.key).run();
    await logEvent(db, r.key, 'ID kept until Valerie deletes it herself', 'Valerie');
    return 'Kept ✓ It stays until you delete it yourself.';
  }
  const n = how === '90' ? 90 : 30;
  const from = deleteDay({ ...r, idKeepForever: false }, today);
  const until = addDays(from > today ? from : today, n);
  await db.prepare('UPDATE requests SET id_keep_until = ?1, id_keep_forever = 0 WHERE request_key = ?2').bind(until, r.key).run();
  await logEvent(db, r.key, `ID kept ${n} more days (deletes itself on ${dayWords(until)})`, 'Valerie');
  return `Kept ✓ It now deletes itself on ${dayWords(until)}.`;
}

// The 7 AM email's last box: website-form IDs that delete themselves within 7 days, soonest first.
export async function idsDueSoon(db, today) {
  const { ready } = await readyIds(db);
  return ready.filter((r) => canAutoDelete(r) && r.idObject && !r.isTest)
    .map((r) => ({ r, day: deleteDay(r, today) }))
    .filter((x) => x.day && daysBetween(today, x.day) <= ID_WARN_DAYS)
    .sort((a, b) => a.day.localeCompare(b.day));
}
