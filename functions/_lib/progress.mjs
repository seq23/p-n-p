// The owner-approved request steps (18 Oct 2026), DERIVED from facts rather than stored as one
// chip: 1 New -> 2 Invoice sent -> 3 Deposit paid -> 4 Scheduled -> 5 Job done ("Returned" for
// a rental-only request) -> 6 Paid in full. Void sits off the line. Money (payments) and job
// progress (bookings, job_done_at) are independent; a request is Finished only when the job is
// done AND it is paid in full AND, when the customer asked for a porch/party takedown, the
// takedown is resolved (functions/_lib/takedown.mjs). "Put away" is a separate flag.

export const STEP_KEYS = ['new', 'invoiced', 'deposit_paid', 'scheduled', 'job_done', 'paid'];

export const STATUS_MEANINGS = [
  ['New', 'The request just came in from the website form. Nothing sent yet.'],
  ['Invoice sent', 'You sent the invoice by email or text.'],
  ['Deposit paid', 'The deposit is in your account.'],
  ['Scheduled', 'It is on the calendar.'],
  ['Job done (Returned for rentals)', 'The job is over. For a game rental this is set when you tap Mark returned.'],
  ['Paid in full', 'All the money is in. With Job done (and the takedown done, when they asked for one) this means Finished.'],
  ['Void — cancelled', 'Cancelled. The customer was not told. It is off the calendar and nothing is owed.'],
  ['Put away', 'Not a status: a finished request you moved off the main list. Tap Bring back to see it again.'],
];

// st: request_status row ({status, job_done_at, invoice_id}); inv: invoice row with .balance;
// scheduled: has any booking; ret: rental check-in row; rental: rental-only request;
// takedown: takedownState() (takedown.mjs), its .pending holds Finished back.
export function deriveProgress({ st = {}, inv = null, scheduled = false, ret = null, rental = false, takedown = null }) {
  const bal = inv && inv.balance ? inv.balance : null;
  const isVoid = st.status === 'void' || (inv && inv.status === 'void');
  const sent = inv ? ['sent', 'deposit_paid', 'paid', 'done'].includes(inv.status) : ['invoiced', 'deposit_paid', 'paid'].includes(st.status);
  const paidFull = bal ? (bal.total > 0 && bal.remaining === 0) : st.status === 'paid';
  const deposit = bal ? bal.paid > 0 : ['deposit_paid', 'paid'].includes(st.status);
  const returned = Boolean(ret && ret.returned_at);
  const jobDone = Boolean(st.job_done_at) || returned || (inv && inv.status === 'done');
  const damaged = returned && Boolean(ret.damaged);
  const jobLabel = rental ? (damaged ? 'Returned — check damage' : 'Returned') : 'Job done';
  const done = {
    new: true, invoiced: sent || deposit || paidFull, deposit_paid: deposit || paidFull,
    scheduled: scheduled || jobDone, job_done: jobDone, paid: paidFull && jobDone,
  };
  const labels = { new: 'New', invoiced: 'Invoice sent', deposit_paid: 'Deposit paid', scheduled: 'Scheduled', job_done: jobLabel, paid: 'Paid in full' };
  let current = 'new';
  for (const k of STEP_KEYS) if (done[k]) current = k;
  const takedownPending = Boolean(takedown && takedown.pending);
  const finished = jobDone && paidFull && !isVoid && !takedownPending;
  return {
    void: isVoid, current: isVoid ? 'void' : current, label: isVoid ? 'Void — cancelled' : labels[current],
    steps: STEP_KEYS.map((k, i) => ({ key: k, n: i + 1, label: labels[k], done: done[k] })),
    paidEarly: paidFull && !jobDone && !isVoid, finished, damaged, jobLabel, rental, takedown, takedownPending,
  };
}

// "A later step ticks the earlier ones" (owner, 20 Oct 2026). Step 1, "Called back", is the one
// step only a tap stores (request_steps.called_at); every later fact means she already talked to
// them, so it counts the call as done by itself. DERIVED on every read, never written back: no old
// row is changed, and undoing the later fact (voiding the invoice, "mark as not paid", taking the
// booking off the calendar, undoing Job done / Picked up / Returned) brings step 1 back exactly as
// it was. The later facts:
//   sent      the invoice went out (email or "Mark as sent by text")
//   depositIn a payment is recorded (deposit or more)
//   jobDone   Setup / Install done, or the games came back
//   picked    the games were picked up
//   booked    she put the job on the calendar herself (bookedByHand)
export function pastFirstCall({ sent = false, depositIn = false, jobDone = false, picked = false, booked = false } = {}) {
  return Boolean(sent || depositIn || jobDone || picked || booked);
}

// The job is on the calendar because SHE put it there: the request is Scheduled (calendar.mjs
// markScheduled, only ever from a booking made by hand), or a first booking (install, setup, game
// pickup, Other) was made or changed by hand (bookings.edited_by_hand). The website's own pencilled
// game pickup / return (request-submit.mjs, edited_by_hand = 0) is not her booking and never counts.
const SECOND_BOOKINGS = ['porch_takedown', 'party_takedown', 'grazing_pickup', 'rental_return'];
export function bookedByHand(st = {}, bookings = []) {
  return Boolean((st && st.status === 'scheduled') || (bookings || []).some((b) => Number(b.edited_by_hand) === 1 && !SECOND_BOOKINGS.includes(b.kind)));
}
