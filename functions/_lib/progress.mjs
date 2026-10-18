// The owner-approved request steps (18 Oct 2026), DERIVED from facts rather than stored as one
// chip: 1 New -> 2 Invoice sent -> 3 Deposit paid -> 4 Scheduled -> 5 Job done ("Returned" for
// a rental-only request) -> 6 Paid in full. Void sits off the line. Money (payments) and job
// progress (bookings, job_done_at) are independent; a request is Finished only when the job is
// done AND it is paid in full. "Put away" is a separate flag.

export const STEP_KEYS = ['new', 'invoiced', 'deposit_paid', 'scheduled', 'job_done', 'paid'];

export const STATUS_MEANINGS = [
  ['New', 'The request just came in from the website form. Nothing sent yet.'],
  ['Invoice sent', 'You sent the invoice by email or text.'],
  ['Deposit paid', 'The deposit is in your account.'],
  ['Scheduled', 'It is on the calendar.'],
  ['Job done (Returned for rentals)', 'The job is over. For a game rental this is set when you tap Mark returned.'],
  ['Paid in full', 'All the money is in. With Job done this means Finished.'],
  ['Void — cancelled', 'Cancelled. The customer was not told. It is off the calendar and nothing is owed.'],
  ['Put away', 'Not a status: a finished request you moved off the main list. Tap Bring back to see it again.'],
];

// st: request_status row ({status, job_done_at, invoice_id}); inv: invoice row with .balance;
// scheduled: has any booking; ret: rental check-in row; rental: rental-only request.
export function deriveProgress({ st = {}, inv = null, scheduled = false, ret = null, rental = false }) {
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
  const finished = jobDone && paidFull && !isVoid;
  return {
    void: isVoid, current: isVoid ? 'void' : current, label: isVoid ? 'Void — cancelled' : labels[current],
    steps: STEP_KEYS.map((k, i) => ({ key: k, n: i + 1, label: labels[k], done: done[k] })),
    paidEarly: paidFull && !jobDone && !isVoid, finished, damaged, jobLabel, rental,
  };
}
