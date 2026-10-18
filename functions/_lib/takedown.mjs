// The porch/party takedown as one derived fact (owner, 18 Oct 2026): a request whose customer
// asked for a takedown is NOT Finished until the takedown is resolved, either a takedown
// booking marked done or "the customer will handle it". Every screen that asks "is the
// takedown still open?" (the card, Finished, Calendar & Bookings, the Day sheet, the Monday
// summary) reads takedownState / takedownsToSchedule here, never its own list.
//
// "Asked for a takedown" = takedown_plan is scheduled or not_sure (the form answer, mapped at
// source), the invoice carries the takedown add-on, or a takedown booking exists.
import { parseFormDate, isISODate as isISO, addDays, normName, digitsOf } from './calendar.mjs';

export const TAKEDOWN_KINDS = ['porch_takedown', 'party_takedown'];
export const TAKEDOWN_STATUSES = ['none', 'customer_handles', 'done', 'to_schedule', 'not_sure', 'booked', 'due'];
const PENDING = new Set(['to_schedule', 'not_sure', 'booked', 'due']);

export function takedownKindFor(services = []) {
  if (services.includes('porch')) return 'porch_takedown';
  if (services.includes('party')) return 'party_takedown';
  return '';
}

// A form answer ("Yes, take it down (from $75)", "No, I'll handle it", "Not sure yet", the old
// Google Form's "Yes"/"No") -> takedown_plan. "Not sure" first: it also starts with "No".
export function planFromAnswer(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/not sure|unsure|maybe|don'?t know/i.test(s)) return 'not_sure';
  if (/^yes/i.test(s)) return 'scheduled';
  if (/^no/i.test(s)) return 'customer_handles';
  return '';
}

function answerIn(r, re) {
  const all = [...(r.rentals || []), ...(r.decor || []), ...(r.other || [])];
  const hit = all.find((x) => re.test(x.label));
  return hit ? hit.value : '';
}

// Map a request's own answers at source: the old Google Form ("Need us to take it down
// afterwards?" + "Takedown date") and the /request form ("Want us to take it down afterwards?",
// no date). The date is only kept for a yes; autoTakedownRow (below) books it.
//
// A takedown date with a blank / "n/a" yes-no answer (the one real imported request, 18 Oct
// 2026: "na" + a date) is a yes: the customer named the day. An explicit "No" or "Not sure"
// always wins over a stray date.
export function takedownFromAnswers(r) {
  let plan = planFromAnswer(r && r.takedownAnswer);
  const given = parseFormDate(answerIn(r || {}, /takedown date|take (it )?down.*(date|when)/i));
  if (!plan && given) plan = 'scheduled';
  return { plan, date: plan === 'scheduled' ? given : '' };
}

// facts: { services, takedownPlan, takedownDate, invoiceTakedown, bookings: [{ id, kind, date, done_at }], today }
// -> { kind, status, pending, date, booking, reached }
//   none              no porch/party, or the customer never asked
//   customer_handles  resolved: the customer takes it down
//   done              resolved: the takedown booking is marked done
//   to_schedule       asked for, not booked yet (date = the form's / owner's date, may be '')
//   not_sure          not decided yet
//   booked            booked, before its day
//   due               booked, on/after its day: "Mark takedown done"
export function takedownState({ services = [], takedownPlan = '', takedownDate = '', invoiceTakedown = false, bookings = [], today = '' }) {
  const kind = takedownKindFor(services);
  const none = { kind, status: 'none', pending: false, date: '', booking: null, reached: false };
  if (!kind) return none;
  const booking = (bookings || []).filter((b) => TAKEDOWN_KINDS.includes(b.kind)).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
  const plan = takedownPlan || '';
  // The form answer reaches this through takedown_plan (mapped at source: the import, the
  // /request handler, the backfill), never read again here: after "Change" (plan '') the
  // owner's re-ask wins over the old answer.
  const wanted = Boolean(booking) || plan === 'scheduled' || plan === 'not_sure' || plan === 'customer_handles' || Boolean(invoiceTakedown);
  if (!wanted) return none;
  const out = (status, date = '', reached = false) => ({ kind, status, pending: PENDING.has(status), date, booking, reached });
  if (booking && booking.done_at) return out('done', booking.date);
  if (booking) {
    const reached = !today || String(today) >= String(booking.date);
    return out(reached ? 'due' : 'booked', booking.date, reached);
  }
  if (plan === 'customer_handles') return out('customer_handles');
  if (plan === 'not_sure') return out('not_sure');
  return out('to_schedule', takedownDate || '');
}

// The words under "Job done" on the progress line.
export function takedownStepWords(td, shortDate = (d) => d) {
  switch (td && td.status) {
    case 'done': return 'Takedown done ✓';
    case 'customer_handles': return 'Takedown: the customer handles it';
    case 'booked': case 'due': return `Takedown: ${shortDate(td.date)}`;
    case 'to_schedule': return td.date ? `Takedown: ${shortDate(td.date)} (not booked yet)` : 'Takedown: not booked yet';
    case 'not_sure': return 'Takedown: not decided yet';
    default: return '';
  }
}

// The facts the console needs for every request, in two queries: bookings with their done
// mark, and the invoices that carry the takedown add-on.
export async function loadTakedownFacts(db) {
  const { results: b } = await db.prepare('SELECT id, request_key, kind, date, time, done_at FROM bookings WHERE request_key IS NOT NULL').all();
  const bookingsBy = {};
  for (const row of b || []) (bookingsBy[row.request_key] = bookingsBy[row.request_key] || []).push(row);
  const { results: l } = await db.prepare("SELECT DISTINCT invoice_id FROM invoice_lines WHERE lower(description) LIKE 'takedown%'").all();
  return { bookingsBy, invoiceIds: new Set((l || []).map((x) => x.invoice_id)) };
}

export function stateFor(r, st, facts, today) {
  return takedownState({
    services: r.services || [], takedownPlan: r.takedownPlan, takedownDate: r.takedownDate,
    invoiceTakedown: Boolean(st && st.invoice_id && facts.invoiceIds.has(st.invoice_id)), bookings: facts.bookingsBy[r.key] || [], today,
  });
}

// "Takedowns to schedule": asked for, not booked, request still live (not put away, not void).
export function takedownsToSchedule(requests, statuses, facts, today) {
  return requests.filter((r) => { const st = statuses[r.key]; return !(st && (st.archived_at || st.status === 'void')) && !r.isTest; })
    .map((r) => ({ r, td: stateFor(r, statuses[r.key], facts, today) }))
    .filter((x) => x.td.status === 'to_schedule')
    .map(({ r, td }) => ({ key: r.key, name: r.name, kind: td.kind, date: td.date, note: r.takedownNote || '' }))
    .sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
}

// The one-time backfill (scripts/admin/backfill_takedown.mjs), as a pure plan so it can be
// tested: rows = D1 requests rows already read through fromRow ({ key, takedownPlan,
// takedownDate, ...answers }); marked = request keys that already carry the backfill event.
// Returns [{ key, plan, date }] to write. Idempotent: a row already mapped (event present, or
// nothing left to fill) is never touched again, so the owner's later choices stand.
export const BACKFILL_EVENT = 'Takedown mapped from the request form';
export function backfillPlan(rows, marked = new Set()) {
  const out = [];
  for (const r of rows) {
    if (!r || marked.has(r.key) || !takedownKindFor(r.services || [])) continue;
    const { plan, date } = takedownFromAnswers(r);
    const nextPlan = r.takedownPlan || plan;
    const nextDate = r.takedownDate || (nextPlan === 'scheduled' ? date : '');
    if (nextPlan === (r.takedownPlan || '') && nextDate === (r.takedownDate || '')) continue;
    out.push({ key: r.key, plan: nextPlan || null, date: nextDate });
  }
  return out;
}

// ---- The inline takedown row (owner, 18 Oct 2026, JOB: fewer steps for Valerie) -------------
// Every porch and party & decor card carries ONE line, "Takedown:", with the date box, an
// optional time and Save · Not sure yet · Customer will handle it. Save books the takedown
// right there (no extra page); once booked the line reads "Booked for Tue 20 Oct" with a
// one-tap Mark takedown done (any day: the owner's word, 18 Oct 2026), Change and Remove.
// Grazing gets the same line for its optional pickup (never required, no Not sure / Customer).
export const INLINE_KINDS = { porch: 'porch_takedown', party: 'party_takedown', grazing: 'grazing_pickup' };
const FIRST_OF = { porch_takedown: ['porch_install'], party_takedown: ['party_setup'], grazing_pickup: ['grazing_setup'] };

// Which inline line a card shows: the takedown kind for porch / party, else the grazing pickup.
// Never a rental (a rental-only card has no line at all).
export function inlineKindFor(services = []) {
  return takedownKindFor(services) || (services.includes('grazing') ? 'grazing_pickup' : '');
}

// The day the date box starts on: the booked day, else the form's / owner's takedown date,
// else the day after the install / setup (booked, else the event date the form gave).
export function inlineDefaultDate({ kind, bookings = [], takedownDate = '', eventDate = '' }) {
  const own = (bookings || []).find((b) => b.kind === kind);
  if (own && isISO(own.date)) return own.date;
  if (kind !== 'grazing_pickup' && isISO(takedownDate)) return takedownDate;
  const first = (bookings || []).filter((b) => (FIRST_OF[kind] || []).includes(b.kind)).map((b) => b.date).filter(isISO).sort()[0] || (isISO(eventDate) ? eventDate : '');
  return first ? addDays(first, 1) : '';
}

// ---- Auto-book the form's takedown date ------------------------------------------------------
// A request that arrives (site /request, the old Google Form import) with a takedown date gets
// its takedown booking at once, and again when its install / setup is booked if it had none.
// One pure rule decides it, so the arrival, the install hook and the backfill agree:
//   porch / party, takedown_plan 'scheduled', a real takedown_date, not void / put away / test,
//   and NO takedown booking of either kind yet (a booking she made or edited is never touched).
// "Not sure yet" / "Customer will handle it" never book anything.
export const AUTO_EVENT = 'Takedown booked from the date on the form';
export function autoTakedownRow(r, { bookings = [], status = null } = {}) {
  if (!r || r.isTest) return null;
  if (status && (status.archived_at || status.status === 'void')) return null;
  const kind = takedownKindFor(r.services || []);
  if (!kind || r.takedownPlan !== 'scheduled' || !isISO(r.takedownDate)) return null;
  if ((bookings || []).some((b) => TAKEDOWN_KINDS.includes(b.kind))) return null;
  const place = answerIn(r, /^location|address|where/i);
  const items = kind === 'porch_takedown' ? 'Porch decorating' : (r.eventType ? `Decor: ${r.eventType}` : 'Party decor');
  return { request_key: r.key, kind, date: r.takedownDate, time: null, customer_name: r.name || '', phone: r.phone || '', email: r.email || '', place, items };
}

// The backfill as a plan: rows = requests (fromRow), bookingsBy = { key: [{ kind }] },
// statuses = { key: request_status row }. Returns the rows to insert; idempotent by design.
export function autoBookPlan(rows, bookingsBy = {}, statuses = {}) {
  return (rows || []).map((r) => autoTakedownRow(r, { bookings: bookingsBy[r && r.key] || [], status: statuses[r && r.key] || null })).filter(Boolean);
}

// Insert it. ON CONFLICT DO NOTHING on (request_key, kind) and the either-kind check above mean
// it can run on every arrival / install booking without ever duplicating or overriding a booking.
export async function autoBookTakedown(db, r, { who = 'automatic' } = {}) {
  if (!r || !r.key) return false;
  const { results } = await db.prepare('SELECT kind FROM bookings WHERE request_key = ?1').bind(r.key).all();
  const status = await db.prepare('SELECT status, archived_at FROM request_status WHERE request_key = ?1').bind(r.key).first();
  const row = autoTakedownRow(r, { bookings: results || [], status });
  if (!row) return false;
  const res = await db.prepare(`INSERT INTO bookings (request_key, kind, date, time, customer_name, phone, email, place, items, edited_by_hand, name_norm, phone_digits)
    VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10) ON CONFLICT(request_key, kind) DO NOTHING`)
    .bind(row.request_key, row.kind, row.date, row.customer_name, row.phone, row.email, row.place, row.items, normName(row.customer_name), digitsOf(row.phone)).run();
  const made = Boolean(res && res.meta && res.meta.changes);
  if (made) await db.prepare('INSERT INTO request_events (request_key, who, what) VALUES (?1, ?2, ?3)').bind(r.key, who, `${AUTO_EVENT} (${row.date})`).run();
  return made;
}
