// Calendar for the /admin console (docs/admin-console.md): rental pickups and returns and
// porch jobs in one list (table `bookings`, migration 0004), made automatically when an
// invoice is created or sent from a request, or typed in by hand. Pure helpers plus the few
// D1 statements that touch the table. No JSON imports here, so the validators can load it.

import { KINDS, KIND_LABELS, serviceInfo } from './kinds.mjs';

export { KINDS, KIND_LABELS };
export const RENTAL_KINDS = ['rental_pickup', 'rental_return'];
const RENTAL = new Set(RENTAL_KINDS);

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export function isISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
}

// "10/24/2026" (Google Forms), "2026-10-24" or "October 24, 2026" -> "2026-10-24"; '' if unreadable.
// No year (owner, 19 Oct 2026: a request typed as "11/3" showed as 2001): "11/3", "11-3", "11.3",
// "Nov 3", "November 3rd", "3 Nov", "Tue 3 Nov", "Tuesday, November 3" -> the NEXT time that day
// comes round on or after `today` (Memphis). The engine's own Date.parse is only trusted when the
// text carries a four-digit year: without one it silently picks 2001.
const MONTHS = ['jan(uary)?', 'feb(ruary)?', 'mar(ch)?', 'apr(il)?', 'may', 'june?', 'july?', 'aug(ust)?', 'sep(t|tember)?', 'oct(ober)?', 'nov(ember)?', 'dec(ember)?'];
const memphisToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function ymd(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d, 12));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? iso(dt) : '';
}
function nextOccurrence(mo, d, today) {
  const ty = Number(String(today).slice(0, 4));
  const first = ymd(ty, mo, d);
  if (first && first >= today) return first;
  for (let y = ty + 1; y <= ty + 4; y += 1) { const x = ymd(y, mo, d); if (x) return x; }
  return '';
}
export function parseFormDate(value, today = '') {
  const s = String(value || '').trim();
  if (!s) return '';
  if (isISODate(s)) return s;
  const now = isISODate(today) ? today : memphisToday();
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (m) return ymd(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]), Number(m[2]));
  const md = s.match(/^(\d{1,2})[/.-](\d{1,2})(?![/.\-\d])/);
  if (md) return nextOccurrence(Number(md[1]), Number(md[2]), now);
  const low = s.toLowerCase().replace(/,/g, ' ');
  const year = low.match(/\b(\d{4})\b/);
  const mon = MONTHS.findIndex((x) => new RegExp(`\\b${x}\\b`).test(low));
  const day = low.replace(/\b\d{4}\b/, '').match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (mon >= 0 && day) return year ? ymd(Number(year[1]), mon + 1, Number(day[1])) : nextOccurrence(mon + 1, Number(day[1]), now);
  if (!year) return '';
  const t = Date.parse(`${s} 12:00 UTC`);
  return Number.isNaN(t) ? '' : iso(new Date(t));
}

export function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

export function weekday(isoDate) {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

// Return-date rule (rentals v3): One day = the next day. Weekend = the Monday after the
// (Friday) pickup; a weekend pickup on any other day still returns the next Monday.
export function returnDateFor(pickupISO, durationAnswer) {
  if (!isISODate(pickupISO)) return '';
  if (/weekend/i.test(String(durationAnswer || ''))) {
    const wd = weekday(pickupISO);
    const toMonday = ((1 - wd + 7) % 7) || 7;
    return addDays(pickupISO, toMonday);
  }
  return addDays(pickupISO, 1);
}

// ---- Rental dates (owner, 19 Oct 2026) -----------------------------------------------------
// The form asks the EVENT date, then the length, then when they pick up and when they bring
// the games back. Prices never depend on these: one day is the day price, the entire weekend
// the weekend price (games.json), whatever pickup/return is picked.
//   One day:            pickup "The day before" (event - 1) or "The morning of" (event);
//                       return "The day after" (event + 1) or "2 days after" (event + 2).
//   The entire weekend: the Fri-Sat-Sun holding the event date; pickup Thursday or Friday,
//                       return Monday or Tuesday after it.
export const RENTAL_LENGTHS = [['day', 'One day'], ['weekend', 'The entire weekend (Fri, Sat and Sun)']];
export const PICKUP_CHOICES = { day: [['before', 'The day before'], ['morning', 'The morning of']], weekend: [['thursday', 'Thursday'], ['friday', 'Friday']] };
export const RETURN_CHOICES = { day: [['after', 'The day after'], ['two_after', '2 days after']], weekend: [['monday', 'Monday'], ['tuesday', 'Tuesday']] };
const PICKUP_OFFSET = { before: -1, morning: 0, thursday: -1, friday: 0 };
const RETURN_OFFSET = { after: 1, two_after: 2, monday: 3, tuesday: 4 };

// The Friday of the Fri-Sat-Sun weekend holding a date; '' for Monday to Thursday.
export function weekendFriday(eventISO) {
  if (!isISODate(eventISO)) return '';
  const wd = weekday(eventISO);
  return wd === 5 ? eventISO : wd === 6 ? addDays(eventISO, -1) : wd === 0 ? addDays(eventISO, -2) : '';
}

// { pickup, ret } dates for an event date, a length and the two choices; error words when the
// combination cannot be booked.
export function rentalSpan({ event, length, pickup, ret }) {
  const len = length === 'weekend' ? 'weekend' : length === 'day' ? 'day' : '';
  if (!isISODate(event)) return { error: 'Please pick the date of your event.' };
  if (!len) return { error: 'Please pick how long.' };
  if (!PICKUP_CHOICES[len].some(([k]) => k === pickup)) return { error: 'Please pick when you will pick the games up.' };
  if (!RETURN_CHOICES[len].some(([k]) => k === ret)) return { error: 'Please pick when you will bring the games back.' };
  const base = len === 'weekend' ? weekendFriday(event) : event;
  if (!base) return { error: 'The entire weekend is Friday, Saturday and Sunday. Pick a Friday, Saturday or Sunday event date, or choose One day.' };
  return { length: len, event, pickup: addDays(base, PICKUP_OFFSET[pickup]), ret: addDays(base, RETURN_OFFSET[ret]) };
}

// Every day from pickup through return, both counted.
export function spanDays(start, end) {
  const out = [];
  if (!isISODate(start)) return out;
  const stop = isISODate(end) && end >= start ? end : start;
  for (let d = start; d <= stop; d = addDays(d, 1)) out.push(d);
  return out;
}

// Rentals whose games are out on `day` between their pickup and return days (not those days).
export function outBetween(windows, day, today) {
  return (windows || []).filter((w) => w.start < day && day < w.end && isOut(w, day, today));
}

// Games already out somewhere in [start, end] that this rental (items text) would need more of
// than the shed holds. -> [{ item, dates: [...], who: [names] }]. ignoreKey = this rental itself.
export function spanClashes(windows, { start, end, items }, today, table, ignoreKey = '') {
  const want = expandItems(items || '', table);
  const others = (windows || []).filter((w) => w.key !== ignoreKey);
  const by = new Map();
  for (const day of spanDays(start, end)) {
    const u = usageOn(others, day, today, table);
    for (const name of want.names) {
      const v = u.byItem[name];
      if (!v) continue;
      const need = (want.counts && want.counts[name]) || 1;
      if (v.used + need > v.stock) {
        const c = by.get(name) || { item: name, dates: [], who: new Set() };
        c.dates.push(day);
        v.who.forEach((w) => c.who.add(w.name || 'someone'));
        by.set(name, c);
      }
    }
  }
  return [...by.values()].map((c) => ({ ...c, who: [...c.who] }));
}

// The return day a request asked for: its stored "Return date" answer when there is one
// (requests from the site form since 19 Oct 2026), else the old rule from the pickup date.
export function requestReturnDate(request, pickupISO) {
  const stored = parseFormDate(answer(request, /^return date$/i));
  if (stored && (!pickupISO || stored > pickupISO)) return stored;
  return returnDateFor(pickupISO, request && request.durationAnswer);
}

function answer(request, re) {
  const all = [...(request.rentals || []), ...(request.decor || []), ...(request.other || [])];
  const hit = all.find((x) => re.test(x.label));
  return hit ? hit.value : '';
}

// The game items an invoice rents out, by name, read from its lines (bundle lines list
// their games by name; the refundable damage deposit is skipped).
export function itemsFromLines(lines, table) {
  const text = (lines || []).filter((l) => !l.refundable).map((l) => String(l.description || '').toLowerCase());
  return table.items.filter((i) => text.some((t) => t.includes(i.name.toLowerCase()) || (i.choice && t.includes(String(i.choice).toLowerCase())))).map((i) => i.name);
}

// Which of porch / party / grazing a request (and its invoice lines) asks for.
export function servicesWanted(request, lines = []) {
  const need = String(request.need || '').toLowerCase();
  const ev = String(request.eventType || '').toLowerCase();
  const lineText = (lines || []).map((l) => String(l.description || '').toLowerCase()).join(' | ');
  const grazingAns = answer(request, /grazing/i);
  const porch = /porch/.test(need) || /porch/.test(ev) || /porch/.test(lineText);
  const grazing = /grazing/.test(need) || /^\s*yes/i.test(grazingAns) || /grazing/.test(lineText);
  const decor = request.wantsDecor || /decor|party|event|hotel|setup/.test(need) || /(^|\| )decor/.test(lineText);
  return { porch, party: decor && !porch, grazing };
}

// The bookings one invoice made from one request should have. [] when the request or its
// dates cannot be read (the invoice still saves; the calendar just has nothing to add).
export function bookingsFromInvoice({ invoice, lines, request, table, isRental }) {
  const key = invoice && invoice.request_key;
  if (!key || !request) return [];
  const base = {
    request_key: key, invoice_id: invoice.id, time: null,
    customer_name: invoice.customer_name || request.name || '', phone: invoice.customer_phone || request.phone || '',
    email: invoice.customer_email || request.email || '',
  };
  const out = [];
  const rental = isRental || Boolean(request.gamesAnswer);
  if (rental) {
    const pickup = parseFormDate(answer(request, /pickup date|delivery date/i));
    if (pickup) {
      const lineText = (lines || []).filter((l) => !l.refundable).map((l) => l.description).join(', ');
      const items = itemsText(expandItems(lineText || request.gamesAnswer, table)) || request.gamesAnswer || '';
      const place = table.pickupPlace || '';
      out.push({ ...base, kind: 'rental_pickup', date: pickup, place, items });
      out.push({ ...base, kind: 'rental_return', date: requestReturnDate(request, pickup), place, items });
    }
  }
  // Porch decorating, party planning & decor and grazing tables: each one the request or the
  // invoice names becomes its own booking on the event date.
  const services = servicesWanted(request, lines);
  const eventDay = parseFormDate(answer(request, /event date/i));
  if (eventDay) {
    const place = answer(request, /^location|address|where/i);
    const takedown = /^\s*yes/i.test(String(request.takedownAnswer || '')) || (lines || []).some((l) => /^takedown/i.test(String(l.description || '')));
    const tdDay = parseFormDate(answer(request, /takedown date|take (it )?down.*(date|when)/i)) || addDays(eventDay, 1);
    const linesOf = (re) => (lines || []).filter((l) => re.test(String(l.description || ''))).map((l) => l.description).join(', ');
    if (services.porch) {
      const items = linesOf(/porch/i) || 'Porch decorating';
      out.push({ ...base, kind: 'porch_install', date: eventDay, place, items });
      if (takedown) out.push({ ...base, kind: 'porch_takedown', date: tdDay, place, items });
    }
    if (services.party) {
      const items = linesOf(/^decor|party|hotel/i) || (request.eventType ? `Decor: ${request.eventType}` : 'Party decor');
      out.push({ ...base, kind: 'party_setup', date: eventDay, place, items });
      if (takedown && !services.porch) out.push({ ...base, kind: 'party_takedown', date: tdDay, place, items });
    }
    if (services.grazing) {
      out.push({ ...base, kind: 'grazing_setup', date: eventDay, place, items: linesOf(/grazing/i) || 'Grazing table' });
    }
  }
  return out;
}

// Upsert by (request_key, kind): re-sending an invoice never duplicates a booking. A booking
// she changed by hand keeps her date, time and words; only its invoice link is refreshed.
export async function upsertBookings(db, rows) {
  if (!rows.length) return 0;
  const keep = (col) => `${col} = CASE WHEN bookings.edited_by_hand = 1 THEN bookings.${col} ELSE excluded.${col} END`;
  const stmts = rows.map((b) => db.prepare(`INSERT INTO bookings (request_key, kind, date, time, customer_name, phone, email, place, items, invoice_id, name_norm, phone_digits)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    ON CONFLICT(request_key, kind) DO UPDATE SET invoice_id = excluded.invoice_id, ${['date', 'customer_name', 'phone', 'email', 'place', 'items', 'name_norm', 'phone_digits'].map(keep).join(', ')}, updated_at = datetime('now')`)
    .bind(b.request_key, b.kind, b.date, b.time, b.customer_name, b.phone, b.email || '', b.place, b.items, b.invoice_id, normName(b.customer_name), digitsOf(b.phone)));
  await db.batch(stmts);
  return rows.length;
}

// A voided invoice takes the bookings it created off the calendar and out of the feed. A
// booking she scheduled by hand is hers, not the invoice's: it stays, unlinked.
export async function removeInvoiceBookings(db, invoiceId) {
  await db.batch([
    db.prepare('DELETE FROM bookings WHERE invoice_id = ?1 AND edited_by_hand = 0').bind(invoiceId),
    db.prepare("UPDATE bookings SET invoice_id = NULL, updated_at = datetime('now') WHERE invoice_id = ?1").bind(invoiceId),
  ]);
}

// "Put on the calendar" from a request: her booking, upserted by (request_key, kind) and
// marked edited_by_hand so a later invoice send keeps her date. Returns the booking id.
export async function saveRequestBooking(db, key, b) {
  const row = await db.prepare(`INSERT INTO bookings (request_key, kind, date, time, customer_name, phone, email, place, items, edited_by_hand, name_norm, phone_digits)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?11)
    ON CONFLICT(request_key, kind) DO UPDATE SET date = excluded.date, time = excluded.time, customer_name = excluded.customer_name, phone = excluded.phone,
      email = CASE WHEN excluded.email <> '' THEN excluded.email ELSE bookings.email END,
      place = excluded.place, items = excluded.items, name_norm = excluded.name_norm, phone_digits = excluded.phone_digits,
      edited_by_hand = 1, updated_at = datetime('now') RETURNING id`)
    .bind(key, b.kind, b.date, b.time, b.customer_name, b.phone, b.email || '', b.place, b.items, normName(b.customer_name), digitsOf(b.phone)).first();
  // Only a FIRST booking (install, setup, rental pickup, or one typed in as Other) marks the
  // request Scheduled. A takedown or a grazing pickup booked after Job done never moves it back.
  if (!SECOND_KINDS.has(b.kind)) await markScheduled(db, key);
  return row.id;
}

// The optional second bookings (porch/party takedown, grazing pickup) and a rental's return:
// booking one of them never changes the request's status.
export const SECOND_KINDS = new Set(['porch_takedown', 'party_takedown', 'grazing_pickup', 'rental_return']);

// A booking typed in by hand with no request: "Just a calendar note (no customer)" (calendar_note
// = 1, migration 0012). A booking with a customer gets a phone request first (phone-requests.mjs).
export async function createBooking(db, b) {
  const row = await db.prepare(`INSERT INTO bookings (request_key, kind, date, time, customer_name, phone, email, place, items, edited_by_hand, name_norm, phone_digits, calendar_note)
    VALUES (NULL, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?11) RETURNING id`)
    .bind(b.kind, b.date, b.time, b.customer_name, b.phone, b.email || '', b.place, b.items, normName(b.customer_name), digitsOf(b.phone), b.calendar_note ? 1 : 0).first();
  return row.id;
}

// A booking that moves to another day gets its day-before reminder again (the text button and
// the 10 AM email), so the reminder follows the booking; the same day keeps "reminded".
const REMIND_AGAIN = (p) => `reminded_at = CASE WHEN bookings.date <> ${p} THEN NULL ELSE bookings.reminded_at END, email_reminded_at = CASE WHEN bookings.date <> ${p} THEN NULL ELSE bookings.email_reminded_at END`;

export async function updateBooking(db, id, b) {
  await db.prepare(`UPDATE bookings SET ${REMIND_AGAIN('?2')}, kind = ?1, date = ?2, time = ?3, customer_name = ?4, phone = ?5, email = ?6, place = ?7, items = ?8,
    name_norm = ?9, phone_digits = ?10, edited_by_hand = 1, updated_at = datetime('now') WHERE id = ?11`)
    .bind(b.kind, b.date, b.time, b.customer_name, b.phone, b.email || '', b.place, b.items, normName(b.customer_name), digitsOf(b.phone), id).run();
}

// Delete one booking. Its notes stay with the request (booking_id cleared), so putting the
// request back on the calendar brings them back; the request may go back to its old status.
export async function deleteBooking(db, id) {
  const b = await db.prepare('SELECT * FROM bookings WHERE id = ?1').bind(id).first();
  if (!b) return null;
  await db.batch([
    db.prepare('UPDATE booking_notes SET booking_id = NULL, request_key = COALESCE(request_key, ?2) WHERE booking_id = ?1').bind(id, b.request_key),
    db.prepare('DELETE FROM bookings WHERE id = ?1').bind(id),
  ]);
  await unscheduleIfEmpty(db, b.request_key);
  return b;
}

// ---- Notes (internal only) ---------------------------------------------------------------

export async function notesFor(db, booking) {
  const { results } = await db.prepare(`SELECT * FROM booking_notes WHERE booking_id = ?1 OR (?2 IS NOT NULL AND request_key = ?2)
    ORDER BY created_at DESC, id DESC`).bind(booking.id, booking.request_key || null).all();
  return results || [];
}

// Latest note per booking id, for lists (calendar cells, day sheet, ICS).
export async function notesByBooking(db, bookings) {
  const { results } = await db.prepare('SELECT * FROM booking_notes ORDER BY created_at DESC, id DESC').all();
  const out = {};
  for (const b of bookings) {
    out[b.id] = (results || []).filter((n) => n.booking_id === b.id || (b.request_key && n.request_key === b.request_key));
  }
  return out;
}

export async function addNote(db, booking, body) {
  const text = String(body || '').trim().slice(0, 4000);
  if (!text) return null;
  const row = await db.prepare('INSERT INTO booking_notes (booking_id, request_key, body) VALUES (?1, ?2, ?3) RETURNING id').bind(booking.id, booking.request_key || null, text).first();
  return row.id;
}

export async function editNote(db, id, body) {
  const text = String(body || '').trim().slice(0, 4000);
  if (!text) return false;
  await db.prepare("UPDATE booking_notes SET body = ?1, updated_at = datetime('now') WHERE id = ?2").bind(text, id).run();
  return true;
}

export async function deleteNote(db, id) {
  await db.prepare('DELETE FROM booking_notes WHERE id = ?1').bind(id).run();
}

export function firstLine(text, max = 60) {
  const line = String(text || '').split(/\r?\n/)[0].trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

// ---- Search ("Find a customer") ------------------------------------------------------------

export function normName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function digitsOf(s) {
  return String(s || '').replace(/\D/g, '');
}

// The request's status becomes 'scheduled'; the one it had is kept in prev_status. A request
// already past Scheduled (Job done, Paid, Done) or Void never moves back (live bug, 18 Oct 2026:
// booking a takedown after Job done showed the job as Scheduled again).
export const PAST_SCHEDULED = ['job_done', 'paid', 'done', 'void'];
export async function markScheduled(db, key) {
  await db.prepare(`INSERT INTO request_status (request_key, status, prev_status, updated_at) VALUES (?1, 'scheduled', 'new', datetime('now'))
    ON CONFLICT(request_key) DO UPDATE SET prev_status = CASE WHEN request_status.status = 'scheduled' THEN request_status.prev_status ELSE request_status.status END,
      status = 'scheduled', updated_at = datetime('now')
    WHERE request_status.status NOT IN (${PAST_SCHEDULED.map((x) => `'${x}'`).join(', ')})`).bind(key).run();
}

// After a booking is deleted: if the request has none left and is still 'scheduled', it goes
// back to the status it had before it was scheduled.
export async function unscheduleIfEmpty(db, key) {
  if (!key) return false;
  const left = await db.prepare('SELECT COUNT(*) AS n FROM bookings WHERE request_key = ?1').bind(key).first();
  if (left && left.n > 0) return false;
  await db.prepare("UPDATE request_status SET status = COALESCE(prev_status, 'new'), prev_status = NULL, updated_at = datetime('now') WHERE request_key = ?1 AND status = 'scheduled'").bind(key).run();
  return true;
}

export async function moveBooking(db, id, date) {
  if (!isISODate(date)) return false;
  const r = await db.prepare(`UPDATE bookings SET ${REMIND_AGAIN('?1')}, date = ?1, edited_by_hand = 1, updated_at = datetime('now') WHERE id = ?2`).bind(date, id).run();
  return Boolean(r && r.meta ? r.meta.changes : true);
}

// "Change anything on this request": the day and time of one booking (her change, so a later
// invoice send keeps it), with the reminder following the new day.
export async function editBookingWhen(db, id, { date, time }) {
  if (!isISODate(date)) return false;
  await db.prepare(`UPDATE bookings SET ${REMIND_AGAIN('?1')}, date = ?1, time = ?2, edited_by_hand = 1, updated_at = datetime('now') WHERE id = ?3`).bind(date, time || null, id).run();
  return true;
}

// The second booking's day (porch/party takedown, grazing pickup): the form's takedown date
// when there is one, else the day after the install/setup.
export function secondDateFor(request, firstDate) {
  return parseFormDate(answer(request, /takedown date|take (it )?down.*(date|when)/i)) || (isISODate(firstDate) ? addDays(firstDate, 1) : '');
}

// What "Put on the calendar" pre-fills from one request.
export function bookingFromRequest(request, table) {
  const rental = Boolean(request.gamesAnswer) || (request.wantsRentals && !request.wantsDecor);
  const svc = servicesWanted(request);
  const otherKind = svc.porch ? 'porch_install' : (svc.party ? 'party_setup' : (svc.grazing ? 'grazing_setup' : 'other'));
  const date = parseFormDate(answer(request, rental ? /pickup date|delivery date/i : /event date/i)) || parseFormDate(answer(request, /date/i));
  return {
    kind: rental ? 'rental_pickup' : otherKind, date, time: null,
    customer_name: request.name || '', phone: request.phone || '', email: request.email || '',
    place: rental ? (table.pickupPlace || '') : answer(request, /^location|address|where/i),
    items: rental ? (request.gamesAnswer || 'Game rentals') : (request.eventType ? `Decor: ${request.eventType}` : 'Decor'),
    note: answer(request, /anything else|describe/i),
  };
}

// Request keys with a FIRST booking (a takedown booked straight from the form's date is not one).
export function firstBookedKeys(bookings) {
  return new Set((bookings || []).filter((b) => b.request_key && !SECOND_KINDS.has(b.kind)).map((b) => b.request_key));
}
// "Unconfirmed requests" on Calendar & Bookings (owner, 19 Oct 2026; was "Unscheduled
// requests"): not put away, not void, and not confirmed (steps.mjs unconfirmedKeys: no "Yes,
// book it", no deposit, not a phone booking, job not done). A held rental, or one whose invoice
// already put it on the calendar, stays here (outlined) until she says yes.
export function unconfirmedRequests(requests, statuses, unconfirmedKeySet) {
  return requests.filter((r) => {
    const st = statuses[r.key];
    if (r.isTest || (st && (st.archived_at || st.status === 'void'))) return false;
    return unconfirmedKeySet.has(r.key);
  });
}

export async function listBookings(db, from = '0000-01-01', to = '9999-12-31') {
  const { results } = await db.prepare('SELECT * FROM bookings WHERE date >= ?1 AND date <= ?2 ORDER BY date, COALESCE(time, \'\'), id').bind(from, to).all();
  return results || [];
}

export function parseBookingForm(form) {
  const kind = KINDS.includes(String(form.get('kind'))) ? String(form.get('kind')) : 'other';
  const time = String(form.get('time') || '').trim();
  return {
    kind,
    date: parseFormDate(form.get('date')),
    time: /^\d{2}:\d{2}$/.test(time) ? time : null,
    customer_name: String(form.get('customer_name') || '').trim().slice(0, 200),
    phone: String(form.get('phone') || '').trim().slice(0, 60),
    email: String(form.get('email') || '').trim().slice(0, 200),
    place: String(form.get('place') || '').trim().slice(0, 500),
    items: String(form.get('items') || '').trim().slice(0, 2000),
    note: String(form.get('note') || '').trim().slice(0, 4000),
  };
}

export function prettyTime(hhmm) {
  const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

// ---- Games out: physical items per day ------------------------------------------------

// The physical items a booking's words name, with bundles expanded into their parts from
// data/rentals/games.json (through the price table): "Pick 3" is 3 games, "The Whole Party"
// is all 8 items. Games a bundle leaves "of your choice" count as unnamed games.
// counts = how many of each named item it takes out (owner, 18 Oct 2026): an all-games bundle
// (Whole Yard, The Whole Party) carries every set of a multi-set game (both Giant Color Stack
// sets), and typed words like "Giant Color Stack (2 sets)" or "2 Giant Color Stack" say so too.
const reEsc = (s) => String(s).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function typedCount(t, it) {
  let n = 0;
  for (const label of [it.name, it.choice].filter(Boolean)) {
    const l = reEsc(label);
    const after = t.match(new RegExp(`${l}s?\\s*(?:\\(\\s*(\\d{1,2})\\s*sets?\\s*\\)|[x\u00d7]\\s*(\\d{1,2})(?![0-9])|(\\d{1,2})\\s+sets?\\b)`));
    if (after) n = Math.max(n, Number(after[1] || after[2] || after[3]));
    const before = t.match(new RegExp(`(?:^|[^$\\d.])(\\d{1,2})\\s*[x\u00d7]?\\s+${l}`));
    if (before) n = Math.max(n, Number(before[1]));
  }
  return n;
}
// Hand-typed booking words (owner, 19 Oct 2026: "Giant Uno, Grab the Mic, Inflatable Movie
// Screen, Projector, movie night bundle for $110 + $50 deposit refunded on tuesday"): an item
// counts when its inventory name (or form choice) appears anywhere in the words, any case, with
// any punctuation or spacing ("grab-the-mic", "GIANT  UNO"); the other words are ignored. This is
// the ONE matcher: availability (the /request form), the clash checks, the calendar, the Day sheet
// and Inventory's In / Out all read rentalWindows -> expandItems.
export const matchText = (s) => ` ${String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()} `;
export function namesItem(text, it) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const m = matchText(text);
  return [it.name, it.choice].filter(Boolean).some((label) => t.includes(String(label).toLowerCase()) || (matchText(label).trim() && m.includes(matchText(label))));
}
export function expandItems(text, table) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const counts = {};
  const need = (name, n = 1) => { counts[name] = Math.max(counts[name] || 0, n); };
  for (const i of table.items) if (namesItem(text, i)) need(i.name, typedCount(t, i) || 1);
  const slots = table.gameSlots || table.gameNames.length;
  let wantedGames = 0;
  for (const b of table.bundles) {
    const hit = (b.choice && t.includes(String(b.choice).toLowerCase())) || t.includes(`${b.name.toLowerCase()} bundle`) || new RegExp(`(^|[^a-z])${reEsc(b.name)}([^a-z]|$)`).test(t.replace(/[(),]/g, ' '));
    if (!hit) continue;
    for (const slug of b.items) { const it = table.items.find((x) => x.slug === slug); if (it) need(it.name); }
    if (b.games >= table.gameNames.length) {
      for (const it of table.items.filter((x) => x.kind === 'game' && !x.removed)) need(it.name, b.games >= slots ? (it.sets || 1) : 1);
    } else wantedGames += b.games;
  }
  const namedGames = table.items.filter((i) => i.kind === 'game' && counts[i.name]).reduce((n, i) => n + counts[i.name], 0);
  const m = t.match(/(\d+) games? of your choice/);
  const unnamed = Math.max(wantedGames - namedGames, m ? Number(m[1]) : 0, 0);
  const names = table.items.map((i) => i.name).filter((n) => counts[n]);
  return { names, unnamed, counts: Object.fromEntries(names.map((n) => [n, counts[n]])) };
}

// How many of `name` a window (or expandItems result) takes out: 1 unless its counts say more.
export const countOf = (w, name) => (w && w.counts && w.counts[name]) || 1;
// Its named items in words, a multi-set item as "Giant Color Stack (2 sets)" (the same words
// the invoice lines use, so the count survives being saved as booking text and read back).
export const namesText = (w) => (w.names || []).map((n) => (countOf(w, n) > 1 ? `${n} (${countOf(w, n)} sets)` : n));

export function itemsText(exp) {
  const { unnamed } = exp;
  return [...namesText(exp), ...(unnamed ? [`${unnamed} ${unnamed === 1 ? 'game' : 'games'} of your choice`] : [])].join(', ');
}

// Memphis calendar date of a D1 datetime('now') value ("2026-10-26 15:04:05", UTC).
export function chicagoDayOf(utc) {
  if (!utc) return '';
  const d = new Date(`${String(utc).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(utc).slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (k) => parts.find((p) => p.type === k).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// One window per rental (pickup..return, both days counted). returnedDay = the Memphis day
// it was checked in; from that day on its items are back in the shed.
export function rentalWindows(bookings, returns, table) {
  const groups = new Map();
  for (const b of bookings) {
    if (!RENTAL.has(b.kind)) continue;
    const key = b.request_key || `m:${String(b.customer_name).toLowerCase()}|${String(b.items).toLowerCase()}`;
    const g = groups.get(key) || { key, name: b.customer_name, phone: b.phone, items: b.items, start: '', end: '', returnKeys: new Set() };
    if (b.kind === 'rental_pickup' && (!g.start || b.date < g.start)) g.start = b.date;
    if (b.kind === 'rental_return' && (!g.end || b.date > g.end)) g.end = b.date;
    g.returnKeys.add(returnKeyOf(b));
    if (!g.items) g.items = b.items;
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.start || g.end).map((g) => {
    const start = g.start || g.end;
    const end = g.end && g.end >= start ? g.end : addDays(start, 1);
    const ret = [...g.returnKeys].map((k) => returns[k]).find((r) => r && r.returned_at);
    const { names, unnamed, counts } = expandItems(g.items, table);
    return { key: g.key, name: g.name, phone: g.phone, start, end, returnedDay: ret ? chicagoDayOf(ret.returned_at) : '', names, unnamed, counts };
  });
}

// Is this rental's stuff out of the shed on `day`? An overdue rental (past its return day,
// not checked in) stays out through today.
export function isOut(w, day, today) {
  if (day < w.start) return false;
  if (w.returnedDay) return day < w.returnedDay;
  const last = w.end < today ? today : w.end;
  return day <= last;
}

export function usageOn(windows, day, today, table) {
  const out = windows.filter((w) => isOut(w, day, today));
  const byItem = {};
  // used = how many of the item are out (a Whole Yard takes both Giant Color Stack sets).
  for (const it of table.items) {
    const who = out.filter((w) => w.names.includes(it.name));
    byItem[it.name] = { stock: it.quantity || 1, who, used: who.reduce((n, w) => n + countOf(w, it.name), 0) };
  }
  const count = out.reduce((n, w) => n + w.names.reduce((k, name) => k + countOf(w, name), 0) + w.unnamed, 0);
  const over = Object.entries(byItem).filter(([, v]) => v.used > v.stock).map(([item, v]) => ({ item, stock: v.stock, used: v.used, who: v.who }));
  return { count, out, byItem, over };
}

// Double-booking warnings from today on: an item out with more people than its stock.
export function overlapWarnings(windows, table, { today, days = 120 } = {}) {
  const seen = new Map();
  for (let i = 0; i <= days; i += 1) {
    const day = addDays(today, i);
    for (const o of usageOn(windows, day, today, table).over) {
      const id = `${o.item}|${o.who.map((w) => w.key).sort().join(',')}`;
      if (!seen.has(id)) seen.set(id, { item: o.item, stock: o.stock, who: o.who, first: day });
    }
  }
  return [...seen.values()];
}

// What is free for a rental from start to end (both days): item -> how many are left.
export function availability(windows, start, end, today, table, ignoreKey = '') {
  const left = {};
  for (const it of table.items) left[it.name] = it.quantity || 1;
  if (!isISODate(start)) return left;
  const stop = isISODate(end) && end >= start ? end : start;
  for (let d = start; d <= stop; d = addDays(d, 1)) {
    const u = usageOn(windows.filter((w) => w.key !== ignoreKey), d, today, table);
    for (const [name, v] of Object.entries(u.byItem)) left[name] = Math.min(left[name], v.stock - v.used);
  }
  return left;
}

// ---- Rental check-in ("Mark returned") -------------------------------------------------

// One check-in per rental: the request, or for a rental typed in by hand its return booking.
export function returnKeyOf(b) {
  return b.request_key || `booking:${b.id}`;
}

export async function loadReturns(db) {
  const { results } = await db.prepare('SELECT * FROM rental_returns').all();
  const map = {};
  for (const r of results || []) {
    let items = [];
    try { items = JSON.parse(r.items); } catch { items = []; }
    map[r.return_key] = { ...r, items };
  }
  return map;
}

// items: [{ name, back, damaged, note }]. Anything not back, or damaged, flags the rental.
export async function saveReturn(db, { returnKey, requestKey = null, bookingId = null, items, notes = '' }) {
  const damaged = items.some((i) => !i.back || i.damaged) ? 1 : 0;
  await db.prepare(`INSERT INTO rental_returns (return_key, request_key, booking_id, returned_at, items, notes, damaged, updated_at)
    VALUES (?1, ?2, ?3, datetime('now'), ?4, ?5, ?6, datetime('now'))
    ON CONFLICT(return_key) DO UPDATE SET returned_at = COALESCE(rental_returns.returned_at, excluded.returned_at), items = excluded.items,
      notes = excluded.notes, damaged = excluded.damaged, updated_at = excluded.updated_at`)
    .bind(returnKey, requestKey, bookingId, JSON.stringify(items), notes, damaged).run();
  if (requestKey) {
    await db.prepare(`INSERT INTO request_status (request_key, status, prev_status, job_done_at, updated_at) VALUES (?1, 'job_done', 'new', datetime('now'), datetime('now'))
      ON CONFLICT(request_key) DO UPDATE SET prev_status = CASE WHEN request_status.status = 'job_done' THEN request_status.prev_status ELSE request_status.status END,
        status = 'job_done', job_done_at = COALESCE(request_status.job_done_at, datetime('now')), updated_at = datetime('now')`).bind(requestKey).run();
  }
  return { damaged: Boolean(damaged) };
}

// "Undo returned": the check-in row stays (with its notes), returned_at is cleared and the
// request goes back to the status it had.
export async function undoReturn(db, returnKey) {
  const row = await db.prepare('SELECT request_key FROM rental_returns WHERE return_key = ?1').bind(returnKey).first();
  await db.prepare("UPDATE rental_returns SET returned_at = NULL, updated_at = datetime('now') WHERE return_key = ?1").bind(returnKey).run();
  if (row && row.request_key) {
    await db.prepare("UPDATE request_status SET status = COALESCE(prev_status, 'new'), prev_status = NULL, job_done_at = NULL, updated_at = datetime('now') WHERE request_key = ?1 AND status = 'job_done'").bind(row.request_key).run();
  }
}

// Rental returns whose day has passed (Memphis date) with no check-in.
export function overdueReturns(bookings, returns, today) {
  return bookings.filter((b) => b.kind === 'rental_return' && b.date < today && !(returns[returnKeyOf(b)] && returns[returnKeyOf(b)].returned_at));
}

// ---- ICS (RFC 5545) -------------------------------------------------------------------

export function icsEscape(text) {
  return String(text == null ? '' : text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// Fold a content line at 75 octets (UTF-8), never inside a character; continuation lines
// start with one space (RFC 5545 section 3.1).
export function foldLine(line) {
  const enc = new TextEncoder();
  const out = []; let cur = ''; let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length ? 74 : 75;
    if (bytes + n > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateOnly = (isoDate) => isoDate.replace(/-/g, '');

export function bookingSummary(b) {
  return `${serviceInfo(b.kind).short}: ${KIND_LABELS[b.kind] || 'Booking'} — ${b.customer_name || 'No name'}`;
}

export function buildIcs(bookings, { now = new Date(), host = 'porchandparty901.com' } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Porch & Party//Admin calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Porch & Party bookings', 'X-WR-TIMEZONE:America/Chicago', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const b of bookings) {
    if (!isISODate(b.date)) continue;
    const notes = (b.noteList || []).map((n) => n.body).join(' / ');
    const desc = [b.phone && `Phone: ${b.phone}`, b.items && `What: ${b.items}`, b.place && `Where: ${b.place}`, b.owedText, notes && `Notes: ${notes}`].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT', `UID:booking-${b.id}@${host}`, `DTSTAMP:${stamp(now)}`);
    if (b.time && /^\d{2}:\d{2}$/.test(b.time)) {
      const start = `${dateOnly(b.date)}T${b.time.replace(':', '')}00`;
      const h = Number(b.time.slice(0, 2)) + 1;
      const end = h < 24 ? `${dateOnly(b.date)}T${pad(h)}${b.time.slice(3)}00` : `${dateOnly(addDays(b.date, 1))}T000000`;
      // Floating local time (no TZID, so no VTIMEZONE is needed); X-WR-TIMEZONE tells Google it is Memphis time.
      lines.push(`DTSTART:${start}`, `DTEND:${end}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(b.date)}`, `DTEND;VALUE=DATE:${dateOnly(addDays(b.date, 1))}`, 'TRANSP:TRANSPARENT');
    }
    lines.push(`SUMMARY:${icsEscape(bookingSummary(b))}`);
    if (desc) lines.push(`DESCRIPTION:${icsEscape(desc)}`);
    if (b.place) lines.push(`LOCATION:${icsEscape(b.place)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

// A strict-enough reader used by the validator: unfolds, checks CRLF, line length, nesting
// and the properties every VEVENT must carry. Returns { events, errors }.
export function parseIcs(text) {
  const errors = [];
  if (/[^\r]\n/.test(text) || /\r(?!\n)/.test(text)) errors.push('line endings are not CRLF');
  const enc = new TextEncoder();
  const raw = text.split('\r\n');
  if (raw[raw.length - 1] !== '') errors.push('does not end with CRLF');
  raw.forEach((l, i) => { if (enc.encode(l).length > 75) errors.push(`line ${i + 1} is over 75 octets`); });
  const lines = [];
  for (const l of raw.slice(0, -1)) {
    if (/^[ \t]/.test(l)) { if (!lines.length) errors.push('starts with a continuation'); else lines[lines.length - 1] += l.slice(1); } else lines.push(l);
  }
  if (lines[0] !== 'BEGIN:VCALENDAR' || lines[lines.length - 1] !== 'END:VCALENDAR') errors.push('not wrapped in VCALENDAR');
  if (!lines.includes('VERSION:2.0') || !lines.some((l) => l.startsWith('PRODID:'))) errors.push('VERSION or PRODID missing');
  const events = []; let cur = null;
  for (const l of lines) {
    const m = l.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) { errors.push(`unreadable line: ${l.slice(0, 40)}`); continue; }
    const [, name, params, value] = m;
    if (name === 'BEGIN' && value === 'VEVENT') { if (cur) errors.push('nested VEVENT'); cur = {}; continue; }
    if (name === 'END' && value === 'VEVENT') {
      if (!cur) errors.push('END:VEVENT without BEGIN');
      else {
        for (const req of ['UID', 'DTSTAMP', 'DTSTART', 'SUMMARY']) if (!cur[req]) errors.push(`VEVENT missing ${req}`);
        events.push(cur);
      }
      cur = null; continue;
    }
    if (cur) cur[name] = { params, value: value.replace(/\\n/g, '\n').replace(/\\([,;\\])/g, '$1') };
  }
  if (cur) errors.push('unterminated VEVENT');
  const uids = events.map((e) => e.UID && e.UID.value);
  if (new Set(uids).size !== uids.length) errors.push('duplicate UID');
  return { events, errors };
}

// ---- Day sheet ----------------------------------------------------------------------------

// Time order: timed bookings first by time, then all-day ones, then by kind order.
export function daySort(a, b) {
  const ta = a.time || '99:99'; const tb = b.time || '99:99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ka = KINDS.indexOf(a.kind); const kb = KINDS.indexOf(b.kind);
  return ka - kb || a.id - b.id;
}

const usd = (c) => `$${(Math.round(c) / 100).toFixed(2).replace(/\.00$/, '')}`;

// Short plain text of one day for an SMS to herself. Cut on a whole line, politely, with a
// link to the full list when it would run long.
export function daySheetText(date, rows, { max = 480, host = 'porchandparty901.com', dayLabel = date, holds = [], outRows = [] } = {}) {
  const head = `${dayLabel} day list (${rows.length} ${rows.length === 1 ? 'booking' : 'bookings'}${holds.length ? `, ${holds.length} ${holds.length === 1 ? 'hold' : 'holds'} ending` : ''}):`;
  const holdLines = holds.map((h) => `Hold ends ${h.timeLabel} - ${h.name || 'No name'}${h.items ? ` (${h.items})` : ''}: deposit not in yet${h.phone ? `, ${h.phone}` : ''}`);
  const outLines = outRows.map((w) => `Rental out - ${w.name || 'No name'}${namesText(w).length ? ` (${namesText(w).join(', ')})` : ''}, back ${new Date(`${w.end}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}`);
  const lines = [...holdLines, ...outLines, ...rows.map((r) => {
    const bits = [`${r.timeLabel ? `${r.timeLabel} ` : ''}${KIND_LABELS[r.kind] || 'Booking'} - ${r.customer_name || 'No name'}`];
    if (r.phone) bits.push(r.phone);
    if (r.items) bits.push(r.items);
    if (r.owed > 0) bits.push(`collect ${usd(r.owed)}`);
    if (r.note) bits.push(`note: ${firstLine(r.note, 40)}`);
    return bits.join(', ');
  })];
  const tail = `Full list: ${host}/admin/day/${date}`;
  let out = head;
  for (let i = 0; i < lines.length; i += 1) {
    const next = `${out}\n${lines[i]}`;
    const rest = lines.length - i - 1;
    if (next.length + (rest ? tail.length + 20 : 0) > max) {
      return `${out}\n...and ${lines.length - i} more. ${tail}`;
    }
    out = next;
  }
  return out.length + tail.length + 1 <= max ? `${out}\n${tail}` : out;
}
