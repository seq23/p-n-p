// Phone requests (owner, 18 Oct 2026): a booking Valerie adds by hand for a customer who called
// or texted becomes a request with source 'phone' (migration 0012), so it lands on Requests as
// a normal card (steps, invoice, Edit, Not paid yet) with a "From a phone call" chip. Before
// this, "Add a booking" wrote a booking with request_key NULL and the job never reached Requests.
//   - The booking form asks which service (porch, party & decor, grazing, game rentals) plus
//     name, phone and email (optional). "Just a calendar note (no customer)" keeps the old
//     request-less booking, marked bookings.calendar_note = 1 so the backfill leaves it alone.
//   - A phone request has no ID/rules prompts ("ID: not collected (phone booking)", with an
//     optional upload later), no hold and no automatic confirmation email; the thank-you and
//     the day-before reminders work as for any request with an email on file.
//   - backfillPlan turns every older request-less booking with a customer into a phone request
//     (a rental pickup + return pair, or a takedown with its install, becomes one request).
// No JSON imports here, so the validators and scripts/admin/backfill_phone_requests.mjs load it.
import { SERVICE_KINDS, serviceOfKind } from './kinds.mjs';
import { normName, digitsOf, isISODate, addDays, weekday, SECOND_KINDS } from './calendar.mjs';
import { shortDate } from './util.mjs';

export const PHONE_SOURCE = 'phone';
export const PHONE_SERVICES = ['porch', 'party', 'grazing', 'rentals'];
export const PHONE_SERVICE_WORDS = { porch: 'Porch', party: 'Party & decor', grazing: 'Grazing', rentals: 'Game rentals' };
export const NOTE_CHOICE = 'note';
export const CAME_IN_LABEL = 'How it came in';
export const CAME_IN_VALUE = 'Phone call (added by Valerie)';
export const ADDED_EVENT = 'Added from a phone call by Valerie';
export const BACKFILL_EVENT = 'Made a phone request from a booking added by hand before phone requests existed (backfill)';
export const CONVERT_EVENT = "Now a phone request: phone bookings never get the automatic confirmation email, so the 'marked as sent' stand-in was cleared (no email sent)";

export const isPhone = (r) => Boolean(r) && (r.source === PHONE_SOURCE);

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function randomCode(n = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
const randomHex = (n = 8) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');

// The first kind a service books ("Add a booking" picks it when the service is tapped).
export const FIRST_KIND = { porch: 'porch_install', party: 'party_setup', grazing: 'grazing_setup', rentals: 'rental_pickup' };

// Which booking the form posts: service + kind, checked against the one service map. Returns
// { service, kind } where service is a SERVICE_KINDS key or 'note' (a request-less block).
export function choiceFrom(form, parsedKind) {
  const raw = String(form.get('service') || '');
  if (raw === NOTE_CHOICE) return { service: NOTE_CHOICE, kind: parsedKind };
  const service = PHONE_SERVICES.includes(raw) ? raw : serviceOfKind(parsedKind);
  if (!PHONE_SERVICES.includes(service)) return { service: NOTE_CHOICE, kind: parsedKind };
  const kind = SERVICE_KINDS[service].kinds.includes(parsedKind) ? parsedKind : FIRST_KIND[service];
  return { service, kind };
}

// ---- Rental length from the booked days (owner, 18 Oct 2026) ---------------------------------
// "pickup Sun 18 Oct, back Tue 20 Oct (2 days)". The days are counted pickup -> return, so the
// next-day return is 1 day; Friday -> Monday is the weekend. '' when either day is missing.
export function daysBetween(a, b) {
  if (!isISODate(a) || !isISODate(b)) return 0;
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}
export function rentalLength(pickup, ret) {
  const days = daysBetween(pickup, ret);
  if (days < 1) return null;
  const weekend = weekday(pickup) === 5 && days === 3;
  return { days, weekend, length: weekend ? 'weekend' : `${days} ${days === 1 ? 'day' : 'days'}` };
}
export function rentalSpanWords(pickup, ret) {
  const L = rentalLength(pickup, ret);
  return L ? `pickup ${shortDate(pickup)}, back ${shortDate(ret)} (${L.length})` : '';
}
const answerOf = (r, re) => {
  const hit = [...(r.rentals || []), ...(r.decor || []), ...(r.other || [])].find((x) => re.test(x.label));
  return hit ? String(hit.value || '') : '';
};
const isoOf = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[0] : ''; };
// The rental's pickup and return: the booked days first (bookings: [{kind, date}]), else the
// request's own "Pickup date" / "Return date" answers.
export function rentalDates(r, bookings = []) {
  const p = (bookings || []).find((b) => b.kind === 'rental_pickup');
  const q = (bookings || []).find((b) => b.kind === 'rental_return');
  return { pickup: (p && p.date) || isoOf(answerOf(r, /^pickup date/i)), ret: (q && q.date) || isoOf(answerOf(r, /^return date/i)) };
}

// ---- The request row ---------------------------------------------------------------------------

// The answers a phone request carries, in the same {group, label, value} shape the site form
// writes (requests.mjs fromRow reads both the same way). bookings: the request's bookings.
export function phoneAnswers(service, bookings) {
  const first = bookings.find((b) => !SECOND_KINDS.has(b.kind)) || bookings[0] || {};
  const out = [];
  if (service === 'rentals') {
    const pickup = (bookings.find((b) => b.kind === 'rental_pickup') || first).date || '';
    const ret = (bookings.find((b) => b.kind === 'rental_return') || {}).date || (pickup ? addDays(pickup, 1) : '');
    const L = rentalLength(pickup, ret);
    out.push({ group: 'rentals', label: 'Which games?', value: first.items || 'Game rentals' });
    out.push({ group: 'rentals', label: 'How long?', value: L ? (L.weekend ? 'Weekend' : rentalSpanWords(pickup, ret)) : '' });
    out.push({ group: 'rentals', label: 'Pickup date', value: pickup });
    out.push({ group: 'rentals', label: 'Pickup place', value: first.place || '' });
    out.push({ group: 'rentals', label: 'Return date', value: ret });
  } else {
    out.push({ group: 'decor', label: 'Event date', value: first.date || '' });
    out.push({ group: 'decor', label: 'Location', value: first.place || '' });
    out.push({ group: 'decor', label: 'Event type', value: first.items || '' });
    const second = bookings.find((b) => SECOND_KINDS.has(b.kind));
    if (second && /_takedown$/.test(second.kind)) out.push({ group: 'decor', label: 'Takedown date', value: second.date });
  }
  out.push({ group: 'other', label: CAME_IN_LABEL, value: CAME_IN_VALUE });
  return out.filter((a) => a.value);
}

// One D1 requests row for a phone booking. at: UTC "YYYY-MM-DD HH:MM:SS".
export function phoneRequestRow({ service, name, phone = '', email = '', bookings, at }) {
  const submitted = at || new Date().toISOString().slice(0, 19).replace('T', ' ');
  return {
    request_key: `phone|${submitted}|${randomHex(6)}`, source: PHONE_SOURCE, submitted_at: submitted, services: JSON.stringify([service]),
    name: String(name || '').trim(), email: String(email || '').trim(), phone: String(phone || '').trim(), answers: JSON.stringify(phoneAnswers(service, bookings)),
    takedown_plan: bookings.some((b) => /_takedown$/.test(b.kind)) ? 'scheduled' : null, referral_code: randomCode(),
    name_norm: normName(name), phone_digits: digitsOf(phone),
  };
}
const ROW_COLS = ['request_key', 'source', 'submitted_at', 'services', 'name', 'email', 'phone', 'answers', 'takedown_plan', 'referral_code', 'name_norm', 'phone_digits'];
export function insertRequestSql(row) {
  return [`INSERT INTO requests (${ROW_COLS.join(', ')}) VALUES (${ROW_COLS.map((_, i) => `?${i + 1}`).join(', ')})`, ROW_COLS.map((c) => (row[c] === undefined ? null : row[c]))];
}

// "Add a booking" with a customer: the request first, then the caller books it with
// saveRequestBooking (which marks it Scheduled). Returns the request key.
export async function createPhoneRequest(db, { service, name, phone, email, bookings }, who = 'Valerie') {
  const row = phoneRequestRow({ service, name, phone, email, bookings });
  const [sql, args] = insertRequestSql(row);
  await db.prepare(sql).bind(...args).run();
  await db.prepare('INSERT INTO request_events (request_key, who, what) VALUES (?1, ?2, ?3)').bind(row.request_key, who, ADDED_EVENT).run();
  return row.request_key;
}

// ---- Backfill ----------------------------------------------------------------------------------

// Request-less bookings (request_key NULL, not a calendar note, a customer name, a service kind)
// grouped into jobs: a rental pickup with its return, an install/setup with its takedown or
// pickup, for the same customer (name, else phone) and in date order. Each group is one request.
export function orphanGroups(bookings) {
  const live = (bookings || []).filter((b) => !b.request_key && !b.calendar_note && String(b.customer_name || '').trim() && PHONE_SERVICES.includes(serviceOfKind(b.kind)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id - b.id);
  const who = (b) => normName(b.customer_name) || digitsOf(b.phone);
  const groups = [];
  for (const b of live.filter((x) => !SECOND_KINDS.has(x.kind))) groups.push({ service: serviceOfKind(b.kind), bookings: [b] });
  const seconds = live.filter((x) => SECOND_KINDS.has(x.kind));
  for (const s of seconds) {
    const svc = serviceOfKind(s.kind);
    const fits = groups.filter((g) => g.service === svc && who(g.bookings[0]) === who(s) && g.bookings[0].date <= s.date && !g.bookings.some((x) => x.kind === s.kind));
    const g = fits.sort((a, b) => b.bookings[0].date.localeCompare(a.bookings[0].date))[0];
    if (g) g.bookings.push(s); else groups.push({ service: svc, bookings: [s] });
  }
  return groups;
}

// What the backfill writes: [sql, args] pairs, in order. requests: the D1 requests rows (for
// the already-converted case), returns: rental_returns rows. Running it again plans nothing
// new (a linked booking is no longer request-less; a converted row is already 'phone').
export function backfillPlan({ bookings = [], requests = [], returns = [], invoiceNumbers = {} } = {}) {
  const stmts = [];
  const created = [];
  for (const g of orphanGroups(bookings)) {
    const first = g.bookings.find((b) => !SECOND_KINDS.has(b.kind)) || g.bookings[0];
    const row = phoneRequestRow({ service: g.service, name: first.customer_name, phone: first.phone, email: first.email || (g.bookings.find((b) => b.email) || {}).email || '', bookings: g.bookings, at: g.bookings.map((b) => b.created_at).filter(Boolean).sort()[0] });
    stmts.push(insertRequestSql(row));
    const ids = g.bookings.map((b) => b.id);
    for (const id of ids) stmts.push(['UPDATE bookings SET request_key = ?1 WHERE id = ?2 AND request_key IS NULL', [row.request_key, id]]);
    stmts.push(['UPDATE booking_notes SET request_key = ?1 WHERE booking_id IN (' + ids.map((_, i) => `?${i + 2}`).join(', ') + ') AND request_key IS NULL', [row.request_key, ...ids]]);
    const ret = returns.find((x) => ids.some((id) => x.return_key === `booking:${id}`));
    if (ret) stmts.push(['UPDATE rental_returns SET return_key = ?1, request_key = ?1 WHERE return_key = ?2', [row.request_key, ret.return_key]]);
    const done = Boolean(ret && ret.returned_at);
    stmts.push([`INSERT INTO request_status (request_key, status, prev_status, job_done_at, updated_at) VALUES (?1, ?2, 'new', ?3, datetime('now')) ON CONFLICT(request_key) DO NOTHING`, [row.request_key, done ? 'job_done' : 'scheduled', done ? ret.returned_at : null]]);
    stmts.push(['INSERT INTO request_events (request_key, who, what) VALUES (?1, ?2, ?3)', [row.request_key, 'backfill', BACKFILL_EVENT]]);
    // A job already over before its request existed: no surprise thank-you for it.
    if (done) {
      stmts.push(['UPDATE requests SET thankyou_skip = 1 WHERE request_key = ?1', [row.request_key]]);
      stmts.push(['INSERT INTO request_events (request_key, who, what) VALUES (?1, ?2, ?3)', [row.request_key, 'backfill', 'No thank-you email: the job was done before this request existed']]);
    }
    created.push({ key: row.request_key, service: g.service, bookings: ids.length, pair: g.service === 'rentals' && g.bookings.length === 2 });
  }
  // Already converted by hand before 'phone' existed (source 'site', "How it came in" = phone
  // call, no ID, never agreed on the site): source -> 'phone'; its confirm_emailed_at was set
  // only to stop the automatic confirmation, so it is cleared and the phone rule does that now.
  const converted = [];
  for (const r of requests) {
    if (r.source !== 'site' || r.id_object || r.agreed_at) continue;
    let answers = [];
    try { answers = JSON.parse(r.answers || '[]'); } catch { answers = []; }
    if (!answers.some((a) => a.group === 'other' && a.label === CAME_IN_LABEL && /phone/i.test(String(a.value || '')))) continue;
    stmts.push(['UPDATE requests SET source = ?1, confirm_emailed_at = NULL WHERE request_key = ?2 AND source = ?3', [PHONE_SOURCE, r.request_key, 'site']]);
    stmts.push(['INSERT INTO request_events (request_key, who, what) VALUES (?1, ?2, ?3)', [r.request_key, 'admin', CONVERT_EVENT]]);
    converted.push({ key: r.request_key, invoice: invoiceNumbers[r.request_key] || '' });
  }
  return { stmts, created, converted };
}
