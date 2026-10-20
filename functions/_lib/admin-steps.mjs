// The step-card actions on Requests (owner-approved 19 Oct 2026; steps.mjs has the rules):
//   POST /admin/requests/talked   "I've talked to them" -> "Are you taking this job?"
//        go=yes   Yes, book it: called + confirmed; the date(s) she sees (editable right there)
//                 become solid bookings (porch install / party or grazing setup, or the rental
//                 pickup + return pair), the form's takedown day books itself, a held rental is
//                 kept held for them (no expiry). The calendar and Bookings follow by themselves.
//        go=later Not yet: called only; the date stays a tentative "Requested · not confirmed".
//        go=no    No, put it away: called, games released, put away (Bring back undoes it).
//   POST /admin/requests/called   undo=1: takes back "Called back" (and the Yes) only; bookings stay.
//   POST /admin/requests/note     Add a note (internal, only Valerie sees it).
import { redirect, b64urlText, fromB64urlText, shortDate } from './util.mjs';
import { loadRequests, logEvent } from './requests.mjs';
import { TRACK_TABLE as PRICE_TABLE } from './prices.mjs';
import { autoBookTakedown } from './takedown.mjs';
import { servicesOf, SCHEDULE_FIRST } from './cards.mjs';
import * as C from './calendar.mjs';
import { getHold, keepHolding, releaseHold } from './holds.mjs';
import { markCalled, markConfirmed, undoCalled } from './steps.mjs';
import { markOpened } from './request-new.mjs';
import { syncExtraGames } from './extra-games.mjs';

const decodeKey = (v) => { try { return fromB64urlText(v); } catch { return ''; } };
const toCard = (key, m, e = false) => redirect(`/admin/?${e ? 'e' : 'm'}=${encodeURIComponent(m)}#c-${b64urlText(key)}`);
// Calendar & Bookings posts the same "Yes, book it" form with back=/admin/calendar?month=...
// (owner-approved calm calendar, 19 Oct 2026): the answer lands back on the calendar, where the
// chip has turned solid. Only a /admin/calendar path is ever followed.
export const calendarBack = (v) => (/^\/admin\/calendar(\?month=\d{4}-\d{2})?(#[A-Za-z0-9_-]+)?$/.test(String(v || '')) ? String(v) : '');
const backOr = (back, key, m, e = false) => {
  if (!back) return toCard(key, m, e);
  const [path, hash] = back.split('#');
  return redirect(`${path}${path.includes('?') ? '&' : '?'}${e ? 'e' : 'm'}=${encodeURIComponent(m)}${hash ? `#${hash}` : ''}`);
};

export async function bookIt(env, req, { date, returnDate = '', eventDate = '' }) {
  const key = req.key;
  const services = servicesOf(req);
  const base = C.bookingFromRequest(req, PRICE_TABLE);
  const { results } = await env.DB.prepare('SELECT * FROM bookings WHERE request_key = ?1').bind(key).all();
  const have = (kind) => (results || []).find((b) => b.kind === kind) || null;
  const booked = [];
  if (services.includes('rentals')) {
    const p = have('rental_pickup');
    const items = (p && p.items) || base.items;
    const pick = { ...base, kind: 'rental_pickup', date, time: p ? p.time : null, place: PRICE_TABLE.pickupPlace || base.place, items };
    await C.saveRequestBooking(env.DB, key, pick);
    const r = have('rental_return');
    await C.saveRequestBooking(env.DB, key, { ...pick, kind: 'rental_return', date: returnDate, time: r ? r.time : null });
    booked.push(`pickup ${shortDate(date)}, return ${shortDate(returnDate)}`);
    // A held rental stays held for them now that the job is taken: no end time.
    const h = await getHold(env.DB, key);
    if (h && h.state === 'held') await keepHolding(env.DB, key, 'Valerie');
    await syncExtraGames(env.DB, key);
  }
  const day = services.includes('rentals') ? eventDate : date;
  for (const svc of services.filter((k) => k !== 'rentals')) {
    const kind = SCHEDULE_FIRST[svc][1];
    const b = have(kind);
    await C.saveRequestBooking(env.DB, key, { ...base, kind, date: day, time: b ? b.time : null, items: (b && b.items) || base.items });
    booked.push(`${svc === 'porch' ? 'install' : 'setup'} ${shortDate(day)}`);
  }
  if (services.some((k) => k === 'porch' || k === 'party')) await autoBookTakedown(env.DB, req);
  return booked;
}

export async function talkedRoute(env, request) {
  const form = await request.formData();
  const key = decodeKey(form.get('r'));
  const go = String(form.get('go') || '');
  if (!key || !['yes', 'later', 'no'].includes(go)) return redirect('/admin/');
  const req = (await loadRequests(env)).find((r) => r.key === key);
  if (!req) return redirect(`/admin/?e=${encodeURIComponent('That request was not found.')}`);
  await markOpened(env.DB, key, 'card');
  const rk = b64urlText(key);
  if (go === 'later') {
    await markCalled(env.DB, key, { how: 'not yet' });
    await logEvent(env.DB, key, 'Called back: not booked yet (Not yet)', 'Valerie');
    return toCard(key, 'Called back ✓ The date stays pencilled in (not confirmed).');
  }
  if (go === 'no') {
    await markCalled(env.DB, key, { how: 'not taking it' });
    await releaseHold(env.DB, key, 'Valerie');
    await env.DB.prepare(`INSERT INTO request_status (request_key, status, archived_at, updated_at) VALUES (?1, 'new', datetime('now'), datetime('now'))
      ON CONFLICT(request_key) DO UPDATE SET archived_at = datetime('now'), updated_at = datetime('now')`).bind(key).run();
    await logEvent(env.DB, key, 'Called back: not taking this job. Put away.', 'Valerie');
    return redirect(`/admin/?put=${encodeURIComponent(rk)}`);
  }
  const services = servicesOf(req);
  const back = calendarBack(form.get('back'));
  const date = C.parseFormDate(form.get('date'));
  const rentals = services.includes('rentals');
  const returnDate = rentals ? C.parseFormDate(form.get('return_date')) : '';
  const eventDate = rentals && services.some((k) => k !== 'rentals') ? C.parseFormDate(form.get('event_date')) : '';
  if (!date) return backOr(back, key, 'Pick the day first, then tap Yes, book it.', true);
  if (rentals && !(returnDate && returnDate > date)) return backOr(back, key, 'Pick a return day after the pickup day, then tap Yes, book it.', true);
  if (rentals && services.some((k) => k !== 'rentals') && !eventDate) return backOr(back, key, 'Pick the setup day too, then tap Yes, book it.', true);
  await markConfirmed(env.DB, key, 'yes, book it');
  const booked = await bookIt(env, req, { date, returnDate, eventDate });
  await logEvent(env.DB, key, `Called back: taking this job. Booked (${booked.join('; ')})`, 'Valerie');
  if (back) return backOr(back, key, `✓ Booked ${req.name || 'them'}: ${booked.join(' · ')}. It is solid on the calendar now.`);
  return toCard(key, `Booked ✓ ${booked.join(' · ')} is on the calendar, confirmed.`);
}

export async function calledRoute(env, request) {
  const form = await request.formData();
  const key = decodeKey(form.get('r'));
  if (!key) return redirect('/admin/');
  if (form.get('undo') === '1') {
    await undoCalled(env.DB, key);
    await logEvent(env.DB, key, 'Called back taken back (bookings kept, marked not confirmed)', 'Valerie');
    return toCard(key, '"Called back" taken back.');
  }
  await markCalled(env.DB, key, { how: 'called' });
  return toCard(key, 'Called back ✓');
}

export async function noteRoute(env, request) {
  const form = await request.formData();
  const key = decodeKey(form.get('r'));
  const body = String(form.get('body') || '').trim().slice(0, 2000);
  if (!key || !body) return key ? toCard(key, 'Type the note first.', true) : redirect('/admin/');
  await env.DB.prepare('INSERT INTO booking_notes (booking_id, request_key, body) VALUES (NULL, ?1, ?2)').bind(key, body).run();
  return toCard(key, 'Note saved ✓ Only you see it.');
}
