// Request cards (owner-approved 18 Oct 2026, JOB B): ONE rules table decides which buttons a
// card shows, by service x stage. views.mjs renders whatever this returns and nothing else, so
// a rental can never show a porch, takedown or walk-through button, and a void or finished card
// shows only Bring back / Put away. validate:admin-cards walks every service x stage.
import { SERVICE_KINDS } from './kinds.mjs';
import { STEP_KEYS } from './progress.mjs';
import { parseFormDate } from './calendar.mjs';
import { singlePayment } from './util.mjs';
import { owes, dollars, depositHeldCents } from './ledger.mjs';

export const CARD_SERVICES = ['porch', 'party', 'grazing', 'rentals'];

// The filter chips on Requests (and on the Put away section): Everything (active + done), the
// three groups (owner-approved "Done Cards" mock-up, 20 Oct 2026), one per service, Not paid yet.
export const FILTERS = [
  ['all', 'Everything (active + done)'], ['active', 'Active only'], ['done', 'Done only'], ['cancelled', 'Cancelled only'],
  ['porch', 'Porch'], ['party', 'Party & decor'], ['grazing', 'Grazing'], ['rentals', 'Rentals'], ['unpaid', 'Not paid yet'],
];
export const GROUP_FILTERS = ['active', 'done', 'cancelled'];

// Three ways a job ends (owner-approved mock-up, 20 Oct 2026). Which group a request that is NOT
// put away sits in on the main page: Cancelled (void), Done (done_at, "✓ Mark as done"), else
// Active. Put away (archived_at) is separate and keeps the group for Bring back.
export function groupOf(st = {}, inv = null) {
  if ((st && st.status === 'void') || (inv && inv.status === 'void')) return 'cancelled';
  if (st && st.done_at) return 'done';
  return 'active';
}
export const GROUP_ORDER = ['active', 'done', 'cancelled'];

// The money line on a Done / Cancelled card, in words (owner: "Paid $110 · $50 deposit returned",
// "Nothing owed · invoice voided"). bal: ledger balanceOf; out: { refunded, kept } (depositOutcomes).
export function endedMoneyWords(group, { bal = null, out = null, status = '' } = {}) {
  const refunded = (out && out.refunded) || 0; const kept = (out && out.kept) || 0;
  if (group === 'cancelled') {
    const parts = [bal ? 'Nothing owed · invoice voided' : 'Nothing owed'];
    if (refunded) parts.push(`${dollars(refunded)} refunded`);
    if (kept) parts.push(`${dollars(kept)} kept`);
    return parts.join(' · ');
  }
  if (!bal) return status === 'paid' ? 'Paid in full (no invoice)' : 'No invoice';
  const parts = [`Paid ${dollars(bal.paidCharges || 0)}`];
  if (bal.refundable > 0) {
    const held = depositHeldCents(bal, out);
    if (refunded) parts.push(`${dollars(refunded)} deposit returned`);
    if (kept) parts.push(`${dollars(kept)} deposit kept`);
    if (held) parts.push(`${dollars(held)} deposit still held`);
  }
  return parts.join(' · ');
}

const answerOf = (r, re) => {
  const hit = [...(r.rentals || []), ...(r.decor || []), ...(r.other || [])].find((x) => re.test(x.label));
  return hit ? String(hit.value || '') : '';
};

// Which of the four services a request is for, in the canonical order.
export function servicesOf(r) {
  const out = new Set((r.services || []).filter((k) => CARD_SERVICES.includes(k)));
  if (!out.size) {
    const need = `${r.need || ''} ${r.eventType || ''}`.toLowerCase();
    if (r.gamesAnswer) out.add('rentals');
    if (/porch/.test(need) || r.porchLine) out.add('porch');
    if (/grazing/.test(need) || /^\s*yes/i.test(answerOf(r, /grazing/i))) out.add('grazing');
    if (r.wantsDecor && !out.has('porch')) out.add('party');
    if (!out.size && r.wantsRentals) out.add('rentals');
  }
  return CARD_SERVICES.filter((k) => out.has(k));
}

// Stage = the last step done before the first step not done yet (so the primary button is
// always the NEXT step), plus the states off the line.
export function cardStage({ pr, inv = null, archived = false, done = false }) {
  if (archived) return 'archived';
  if (pr.void) return 'void';
  if (done) return 'done';
  if (pr.finished) return 'finished';
  // With no invoice at all (a job she handles by hand), the money steps never block the job steps.
  let stage = 'new';
  for (const s of pr.steps) {
    if (!s.done && !inv && (s.key === 'invoiced' || s.key === 'deposit_paid')) continue;
    if (!s.done) break;
    stage = s.key;
  }
  if (stage === 'new' && inv) return 'draft';
  // Job done and paid, but the takedown they asked for is still open: not Finished yet.
  if (stage === 'paid') return 'job_done';
  return stage;
}
export const STAGES = ['new', 'draft', ...STEP_KEYS.slice(1, -1), 'finished', 'done', 'void', 'archived']; // 'paid' as the last step done is always Finished

// The scheduling button per service: [help key, booking kind].
export const SCHEDULE_FIRST = {
  porch: ['card.schedInstall', 'porch_install'],
  party: ['card.schedSetup', 'party_setup'],
  grazing: ['card.schedSetup', 'grazing_setup'],
  rentals: ['card.schedPickup', 'rental_pickup'],
};
// The optional second booking (never required): porch/party takedown, grazing pickup. It is
// booked on the card's inline row (views.mjs takedownRow), never through a button to another page.
export const SCHEDULE_SECOND = { porch: 'porch_takedown', party: 'party_takedown', grazing: 'grazing_pickup' };

// Buttons that belong to one service only. A key here never shows on a card without it.
export const SERVICE_ONLY = {
  'card.checklist': ['porch', 'party', 'grazing'],
  'card.printChecklist': ['porch', 'party', 'grazing'],
  'card.schedInstall': ['porch'],
  'card.schedSetup': ['party', 'grazing'],
  'card.schedPickup': ['rentals'],
  'ret.mark': ['rentals'],
  'ret.see': ['rentals'],
  'msg.pickupText': ['rentals'],
  'card.jobDone': ['porch', 'party', 'grazing'],
  'td.markDone': ['porch', 'party'],
  'td.save': ['porch', 'party', 'grazing'],
  'card.undoJobDone': ['porch', 'party', 'grazing'],
};

// Calm cards (owner, 18 Oct 2026): at most this many secondary buttons show on a card; the rest
// wait under "Show details", most relevant first (the order below).
export const MAX_SECONDARY = 3;
const SECONDARY_ORDER = ['card.openInvoice', 'card.createInvoice', 'ret.mark', 'card.seeCal',
  'ret.see', 'card.checklist', 'card.undoJobDone', 'card.printChecklist'];
const rank = (k) => { const i = SECONDARY_ORDER.indexOf(k.split('|')[0]); return i < 0 ? SECONDARY_ORDER.length : i; };

// The rules table. facts: { services, stage, inv, plan, sched, kinds (booked kinds),
// returned, jobDoneAt }. Returns { primary: key|'', secondary: [key, ...] (at most
// MAX_SECONDARY, shown on the card), more: [key, ...] (under Show details) } where a key
// may carry a booking kind as "key|kind". The endings (owner-approved "Done Cards", 20 Oct 2026):
// a Finished card's ONE big button is "✓ Mark as done" with a small "Put away" beside it; a Done
// card has no big button, only "Put away" and "Not done after all (undo)"; a Cancelled (void) card
// only "Put away" and "Not cancelled after all (undo)". Money buttons live in the Payment box
// (cardPayment), never in the secondary row.
//
// Time-aware (owner, 18 Oct 2026): "Mark returned" only on/after the pickup date and "Mark job
// done" only on/after the event date (America/Chicago; cardDates). Before that the primary is
// the next real step; a booked rental with no pickup time set yet may have "Text about pickup
// time" as its primary (msg.pickupText, needs canText); with a pickup time set, nothing big
// until pickup day (primary '' and the card shows the quiet "Next:" line: cardWaiting).
// Exactly ONE big button whenever there is a step to take; never more than one.
//
// Takedown (owner, 18 Oct 2026): after Job done on a porch/party the customer asked to take down,
// the inline takedown row carries the next step: its Save (not booked yet, primary '') or its
// one-tap "Mark takedown done" (booked, any day: primary 'td.markDone'). takedown = takedownState().
export function cardButtons({ services, stage, inv = null, plan = 'half', sched = false, kinds = [], returned = false, jobDoneAt = false, takedownPlan = '',
  eventReached = true, pickupReached = true, pickupTimeSet = false, canText = true, takedown = null, paidFull = false }) {
  const has = (k) => services.includes(k);
  const decorish = services.filter((k) => k !== 'rentals');
  if (stage === 'archived') return { primary: 'pa.bringBack', secondary: [], more: [] };
  if (stage === 'void') return { primary: '', secondary: ['card.archive', 'card.uncancel'], more: [] };
  if (stage === 'done') return { primary: '', secondary: ['card.archive', 'card.undone'], more: [] };
  if (stage === 'finished') return { primary: 'card.markDone', secondary: ['card.archive'], more: [] };
  // Not booked yet: the card's own inline "Yes, book it" (views.mjs bookYesForm) books it, the day
  // from the request filled in. There is no "Schedule setup / install / pickup" button any more
  // (owner-approved job card mock-up, 25 Oct 2026): it repeated Yes, book it.
  const firstSched = services.some((k) => SCHEDULE_FIRST[k] && !kinds.includes(SCHEDULE_FIRST[k][1])) ? ['step.bookYes'] : [];
  let primary = '';
  if (stage === 'new') primary = 'card.createInvoice';
  else if (stage === 'draft') primary = 'card.openInvoice';
  else if (stage === 'invoiced') primary = singlePayment(plan) ? 'pay.paid' : 'pay.deposit';
  else if (stage === 'deposit_paid' || stage === 'scheduled') {
    const jobLeft = decorish.length && !jobDoneAt;
    const backLeft = has('rentals') && !returned;
    if (stage === 'deposit_paid' && firstSched[0]) primary = firstSched[0];
    else if (jobLeft && eventReached) primary = 'card.jobDone';
    else if (backLeft && pickupReached) primary = 'ret.mark';
    else if (firstSched[0]) primary = firstSched[0];
    else if (backLeft && !pickupTimeSet && canText) primary = 'msg.pickupText';
    else if (!jobLeft && !backLeft) primary = 'pay.paid';
  } else if (stage === 'job_done') {
    // The takedown lives in the inline row on the card (views.mjs takedownRow): not booked yet,
    // its Save is the next step (no primary here, so never two big buttons); booked, its
    // one-tap "Mark takedown done" IS the primary, on any day (owner, 18 Oct 2026).
    const td = takedown && takedown.pending ? takedown : null;
    if (td && (td.status === 'to_schedule' || td.status === 'not_sure')) primary = '';
    else if (td && (td.status === 'due' || td.status === 'booked')) primary = 'td.markDone';
    else primary = 'pay.paid';
  }
  const sec = [];
  if (inv && primary !== 'card.openInvoice') sec.push('card.openInvoice');
  if (!inv && primary !== 'card.createInvoice') sec.push('card.createInvoice');
  if (sched) sec.push('card.seeCal');
  // The second booking (porch/party takedown, grazing pickup) is never a button that opens
  // another page any more: the inline row on the card books it in place (owner, 18 Oct 2026).
  void takedownPlan;
  if (has('rentals') && returned) sec.push('ret.see');
  if (has('rentals') && !returned && sched && pickupReached && primary !== 'ret.mark') sec.push('ret.mark');
  if (decorish.length && jobDoneAt && !returned) sec.push('card.undoJobDone');
  if (decorish.length) sec.push('card.checklist', 'card.printChecklist');
  // The never-rules, applied last so no branch above can break them.
  const allowed = (key) => { const only = SERVICE_ONLY[key.split('|')[0]]; return !only || only.some((k) => has(k)); };
  const all = [...new Set(sec)].filter(allowed).filter((k) => k !== primary && k !== 'card.archive' && !k.startsWith('pay.'))
    .map((k, i) => [k, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([k]) => k);
  // The date rules, applied last too: never Mark returned before pickup day, never Mark job
  // done before the event day, on any branch above.
  const early = (k) => (k === 'ret.mark' && !pickupReached) || (k === 'card.jobDone' && !eventReached);
  const shown = all.filter((k) => !early(k));
  const p = allowed(primary) && !early(primary) ? primary : '';
  return { primary: p, secondary: shown.slice(0, MAX_SECONDARY), more: shown.slice(MAX_SECONDARY) };
}

// The dates the time rules read, from the bookings first, then the form answers. A date we do
// not know cannot be "before", so it counts as reached. today: YYYY-MM-DD in America/Chicago.
//   bookings: [{ kind, date, time }]
export function cardDates({ r, services, bookings = [], today }) {
  const booked = (kind) => bookings.filter((b) => b.kind === kind).map((b) => String(b.date || '')).filter(Boolean).sort()[0] || '';
  const decorKinds = services.filter((k) => k !== 'rentals').map((k) => SCHEDULE_FIRST[k][1]);
  const eventDate = decorKinds.map(booked).filter(Boolean).sort()[0] || iso(answerOf(r, /event date/i)) || iso(answerOf(r, /pickup date|delivery date/i));
  const pickupDate = booked('rental_pickup') || iso(answerOf(r, /pickup date|delivery date/i)) || iso(answerOf(r, /event date/i));
  const pickupTimeSet = bookings.some((b) => b.kind === 'rental_pickup' && String(b.time || '').trim());
  const reached = (d) => !d || !today || String(today) >= d;
  return { eventDate, pickupDate, eventReached: reached(eventDate), pickupReached: reached(pickupDate), pickupTimeSet };
}

// The quiet "Next:" line on a card with nothing big to tap yet (waiting for the day).
// It shows IN the primary slot (one place for "what next"), never as a second line.
export function cardWaiting({ services, stage, primary, returned = false, jobDoneAt = false, dates, takedown = null }) {
  void takedown;
  if (primary || !['deposit_paid', 'scheduled'].includes(stage)) return null;
  if (services.some((k) => k !== 'rentals') && !jobDoneAt && !dates.eventReached) return { key: 'card.jobDone', date: dates.eventDate, words: 'Mark job done, on the event day' };
  if (services.includes('rentals') && !returned && !dates.pickupReached) return { key: 'ret.mark', date: dates.pickupDate, words: 'Mark returned, from pickup day' };
  return null;
}

// The Payment box on a card, by where the money stands (owner, 18 Oct 2026):
//   none   no invoice yet           -> one quiet line, no buttons (Create invoice covers it)
//   draft  invoice made, not sent   -> one quiet line, no buttons (Open and send covers it)
//   sent   sent, nothing paid       -> "Invoice sent · owes $X" + Mark deposit received
//                                      (Mark paid in full on a full pay plan)
//   deposit deposit in              -> "Deposit in · still owes $X" + Mark paid in full + undo link
//   paid   paid in full             -> "Paid in full ✓" + undo link
// ONE money button at most, and never the same one as the primary (it would show twice).
// Void is never here: it is a small link under Show details.
export const PAY_STATES = ['none', 'draft', 'sent', 'deposit', 'paid'];
// A stored "paid" status never outvotes the payments: with money still to pay (ledger.mjs
// balanceOf, e.g. a line added after it was paid) the box reads "Deposit in · $X due".
export function payState({ inv = null, status = 'new' }) {
  if (inv) {
    const st = ({ draft: 'draft', deposit_paid: 'deposit', paid: 'paid', done: 'paid', void: 'void' })[inv.status] || 'sent';
    return st === 'paid' && inv.balance && owes(inv.balance) ? 'deposit' : st;
  }
  return ({ deposit_paid: 'deposit', paid: 'paid', done: 'paid', void: 'void' })[status] || 'none';
}
export function cardPayment({ inv = null, status = 'new', plan = 'half', primary = '' }) {
  const state = payState({ inv, status });
  let button = '';
  if (state === 'sent') button = singlePayment(plan) ? 'pay.paid' : 'pay.deposit';
  else if (state === 'deposit') button = 'pay.paid';
  if (button && button === String(primary).split('|')[0]) button = '';
  return { state, button, undo: state === 'deposit' || state === 'paid' };
}

// The inline takedown / pickup row (views.mjs takedownRow): which line a card shows. Porch and
// party & decor: the takedown; grazing: its optional pickup; rentals never. Never on a Void,
// Finished or Put away card.
export function inlineRowKind({ services, stage }) {
  if (['void', 'finished', 'done', 'archived'].includes(stage)) return '';
  if (services.includes('porch')) return 'porch_takedown';
  if (services.includes('party')) return 'party_takedown';
  if (services.includes('grazing')) return 'grazing_pickup';
  return '';
}
export const TAKEDOWN_PLANS = ['scheduled', 'not_sure', 'customer_handles'];

// ---- Key facts: the one line under the name (date, where, Call) -----------------------
// Every date answer reads through the one parser (calendar.mjs parseFormDate: "11/3" -> the next 3 Nov).
const iso = (s) => parseFormDate(s);
export function keyFacts(r, services, { pickupPlace = 'Mt. Moriah Station' } = {}) {
  const rentalOnly = services.length === 1 && services[0] === 'rentals';
  const date = iso(answerOf(r, rentalOnly ? /pickup date|delivery date/i : /event date/i)) || iso(answerOf(r, /pickup date|event date/i));
  const where = rentalOnly ? `Pickup at ${pickupPlace}` : (answerOf(r, /^location|address|where is it/i) || '');
  return { date, dateWord: rentalOnly ? 'Pickup' : 'Event', where, phone: String(r.phone || '') };
}

// Grazing: guest count + a rough food estimate from data/offers/services.json foodPerHead.
export function grazingFacts(r, foodPerHead) {
  const guests = answerOf(r, /how many guests/i);
  const food = answerOf(r, /source the food|food/i);
  const out = { guests, estimate: '' };
  if (/^no/i.test(food)) { out.estimate = 'They bring the food'; return out; }
  if (!foodPerHead || !guests) return out;
  const nums = guests.match(/\d+/g) || [];
  const lo = Number(foodPerHead.low); const hi = Number(foodPerHead.high);
  if (/under/i.test(guests) && nums[0]) out.estimate = `Food estimate: up to $${Number(nums[0]) * hi}`;
  else if (/\+/.test(guests) && nums[0]) out.estimate = `Food estimate: from $${Number(nums[0]) * lo}`;
  else if (nums.length >= 2) out.estimate = `Food estimate: $${Number(nums[0]) * lo}–$${Number(nums[1]) * hi}`;
  else if (nums.length === 1) out.estimate = `Food estimate: $${Number(nums[0]) * lo}–$${Number(nums[0]) * hi}`;
  return out;
}

// "Not paid yet": an invoice that was SENT, is not void, and still has charges owed (the
// refundable damage deposit is never counted as owed: ledger.mjs balance.owed).
export function notPaidYet(inv) {
  if (!inv || !inv.balance) return false;
  if (inv.status === 'void' || inv.status === 'draft' || inv.balance.void) return false;
  return inv.balance.owed > 0;
}

// group: groupOf() (active / done / cancelled). Everything shows every group (Cancelled folded).
export function matchesFilter(f, { services, inv, group = 'active' }) {
  if (!f || f === 'all') return true;
  if (GROUP_FILTERS.includes(f)) return group === f;
  if (f === 'unpaid') return notPaidYet(inv);
  return services.includes(f);
}

// The badge colours come from the one service map (kinds.mjs), words always shown.
export function serviceBadge(k) {
  const s = SERVICE_KINDS[k];
  return s ? { label: { porch: 'Porch', party: 'Party & decor', grazing: 'Grazing', rentals: 'Rentals' }[k], bar: s.bar, tint: s.tint } : null;
}
