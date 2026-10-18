// The porch/party takedown as one derived fact (owner, 18 Oct 2026): a request whose customer
// asked for a takedown is NOT Finished until the takedown is resolved, either a takedown
// booking marked done or "the customer will handle it". Every screen that asks "is the
// takedown still open?" (the card, Finished, Calendar & Bookings, the Day sheet, the Monday
// summary) reads takedownState / takedownsToSchedule here, never its own list.
//
// "Asked for a takedown" = takedown_plan is scheduled or not_sure (the form answer, mapped at
// source), the invoice carries the takedown add-on, or a takedown booking exists.
import { parseFormDate } from './calendar.mjs';

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
// no date). The date is only kept for a yes; it PREFILLS the Schedule takedown screen and never
// creates a booking by itself.
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
