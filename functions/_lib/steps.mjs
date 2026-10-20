// Step cards on Requests (owner-approved 19 Oct 2026, the clickable mock-up "Requests page, one
// step at a time"). Each card is a checklist of named steps with ONE next step. Every step is
// DERIVED from what already happened, so doing a thing anywhere (the invoice page, Money, the
// Edit page, the Day sheet, Mark returned) ticks it here by itself:
//   called        "Called back": request_steps.called_at (migration 0018), a phone-call request,
//                 or any later step already done (nobody sends an invoice before talking)
//   invoiced      the invoice went out (email or "texted"), or money already came in
//   deposit       a deposit (or more) is recorded on Money
//   setup         porch "Install done" / party, grazing "Setup done": request_status.job_done_at
//   takedown      porch / party: takedown.mjs takedownState (done, or "not needed" when the
//                 customer handles it or never asked for one)
//   pickup        grazing (optional): its pickup booking marked done, or "not needed"
//   picked        rentals: the pickup booking marked done (bookings.done_at)
//   returned      rentals: Mark returned (rental_returns.returned_at)
//   deposit_back  rentals: the damage deposit given back (or kept for damage) on Money, or there
//                 was none to give back
//   paid          paid in full on Money
// Only "Called back" (and the "Yes, book it" answer, `confirmed`) needed new stored facts.
// The one place a request counts as CONFIRMED (its calendar chips solid, off the Unconfirmed
// requests list): she answered "Yes, book it", or it came by phone, or money came in, or the job
// is done. Everything else on the calendar is a tentative, outlined "Requested · not confirmed".

export const STEP_LABELS = {
  called: 'Called back', invoiced: 'Invoice sent', deposit: 'Deposit paid',
  setup: 'Setup done', takedown: 'Takedown done', pickup: 'Pickup done (optional)',
  picked: 'Picked up', returned: 'Returned', deposit_back: 'Deposit given back', paid: 'Paid in full',
};
// How each step is ticked: 'stored' = a tap on this card that can be taken back here;
// 'money' / 'invoice' = it follows Money or the invoice (undo explains where to change it).
export const STEP_SOURCE = {
  called: 'stored', invoiced: 'invoice', deposit: 'money', setup: 'stored', takedown: 'stored',
  pickup: 'stored', picked: 'stored', returned: 'stored', deposit_back: 'money', paid: 'money',
};

const DECOR = ['porch', 'party', 'grazing'];

// The steps for a request, by its services (canonical order; cards.mjs servicesOf).
//   Rentals: Called back -> Invoice sent -> Deposit paid -> Picked up -> Returned -> Deposit given back
//   Party & decor / Porch: ... -> Setup (Install) done -> Takedown done -> Paid in full
//   Grazing: ... -> Setup done -> Pickup done (optional) -> Paid in full
// A request for decor AND games has both job parts. A rental whose rest was not paid at pickup
// gets "Paid in full" before it can finish (extraPaid).
export function stepPlan(services = [], { extraPaid = false } = {}) {
  const decor = services.filter((k) => DECOR.includes(k));
  const rentals = services.includes('rentals');
  const plan = ['called', 'invoiced', 'deposit'];
  if (decor.length) {
    plan.push('setup');
    if (decor.includes('porch') || decor.includes('party')) plan.push('takedown');
    else plan.push('pickup');
  }
  if (rentals) plan.push('picked', 'returned');
  if (decor.length || (rentals && extraPaid)) plan.push('paid');
  if (rentals) plan.push('deposit_back');
  if (!decor.length && !rentals) plan.push('setup', 'paid');
  return plan;
}

export function stepLabel(key, services = [], { auto = '' } = {}) {
  if (key === 'setup') return services.includes('porch') ? 'Install done' : 'Setup done';
  if (key === 'takedown' && auto === 'not_needed') return 'Takedown: not needed';
  if (key === 'pickup' && auto === 'not_needed') return 'Pickup: not needed';
  if (key === 'deposit_back' && auto === 'none') return 'No damage deposit to give back';
  return STEP_LABELS[key];
}

// The single rule for CONFIRMED (see the header). stored: request_steps row (or null).
export function isConfirmed({ r = {}, stored = null, depositIn = false, jobDone = false } = {}) {
  return Boolean((stored && stored.confirmed_at) || r.source === 'phone' || depositIn || jobDone);
}

// facts:
//   r          the request (fromRow), services (servicesOf)
//   pr         progress.mjs deriveProgress result (money + job facts)
//   inv        its invoice row with .balance (ledger.mjs), or null
//   st         request_status row
//   bookings   this request's bookings [{ id, kind, date, time, done_at }]
//   ret        rental check-in row
//   tdS        takedown.mjs takedownState
//   stored     request_steps row
//   depositOut { refunded, kept } of the damage deposit (ledger.mjs depositHeld)
export function deriveSteps({ r = {}, services = [], pr, inv = null, st = {}, bookings = [], ret = null, tdS = null, stored = null, depositOut = null, today = '' }) {
  const stepDone = (k) => Boolean(pr && pr.steps.find((x) => x.key === k && x.done));
  const bal = inv && inv.balance ? inv.balance : null;
  const paidFull = stepDone('paid') || Boolean(pr && pr.paidEarly);
  const depositIn = stepDone('deposit_paid') || paidFull;
  const sent = stepDone('invoiced');
  const returned = Boolean(ret && ret.returned_at);
  const jobDone = Boolean(st && st.job_done_at) || returned;
  const booked = (kind) => (bookings || []).find((b) => b.kind === kind) || null;
  const pickupB = booked('rental_pickup');
  const picked = Boolean(pickupB && pickupB.done_at) || returned;
  const grazingB = booked('grazing_pickup');
  const facts = {};
  // Takedown (porch/party): resolved = done, the customer handles it, or never asked for.
  const td = tdS || { status: 'none' };
  // Never asked for one: it ticks itself as "not needed" once the setup is done (not before, so a
  // fresh card never opens with step 5 already ticked).
  const setupDone = Boolean(st && st.job_done_at);
  facts.takedown = td.status === 'done' ? { done: true } : (td.status === 'customer_handles' ? { done: true, auto: 'not_needed', how: td.status }
    : (td.status === 'none' ? { done: setupDone, auto: 'not_needed', how: 'none' } : { done: false }));
  facts.pickup = grazingB && grazingB.done_at ? { done: true } : (r.takedownPlan === 'customer_handles' && !grazingB ? { done: true, auto: 'not_needed', how: 'customer_handles' } : { done: false });
  // Damage deposit: none on the invoice -> nothing to give back; else everything collected is
  // refunded or kept (only once the games are back).
  const refundable = bal ? bal.refundable : 0;
  const collected = bal ? Math.max(0, bal.refundable - bal.depositOwed) : 0;
  const out = depositOut || { refunded: 0, kept: 0 };
  const held = Math.max(0, collected - (out.refunded || 0) - (out.kept || 0));
  facts.deposit_back = !refundable ? { done: Boolean(inv) && returned, auto: 'none' } : { done: returned && held === 0, held };
  const owed = bal ? bal.owed : 0;
  const extraPaid = services.includes('rentals') && !services.some((k) => DECOR.includes(k)) && picked && !paidFull && Boolean(inv);
  const plan = stepPlan(services, { extraPaid });
  const later = sent || depositIn || jobDone || picked;
  const doneOf = {
    called: Boolean(stored && stored.called_at) || r.source === 'phone' || later,
    invoiced: sent, deposit: depositIn, setup: setupDone, takedown: facts.takedown.done, pickup: facts.pickup.done,
    picked, returned, deposit_back: facts.deposit_back.done, paid: paidFull,
  };
  const steps = plan.map((key, i) => ({
    key, n: i + 1, done: Boolean(doneOf[key]), auto: (facts[key] && facts[key].auto) || '',
    label: stepLabel(key, services, { auto: doneOf[key] ? (facts[key] && facts[key].auto) || '' : '' }),
    how: key === 'called' && !(stored && stored.called_at) ? (r.source === 'phone' ? 'phone' : 'later') : ((facts[key] && facts[key].how) || ''),
  }));
  if (returned && ret.damaged) steps.find((s) => s.key === 'returned').label = 'Returned — check damage';
  const isVoid = Boolean(pr && pr.void);
  // The next step is the first one not done, with one exception: on the day of the job (the
  // setup / install day, the pickup day) the job itself comes first, even while the invoice or the
  // deposit is still open (they stay unticked and come back right after).
  const FIRST_DECOR = ['porch_install', 'party_setup', 'grazing_setup'];
  const setupDay = (bookings || []).filter((b) => FIRST_DECOR.includes(b.kind)).map((b) => b.date).sort()[0] || '';
  const reached = (d) => Boolean(d && today && String(today) >= d);
  let firstOpen = steps.find((s) => !s.done);
  if (firstOpen && ['called', 'invoiced', 'deposit'].includes(firstOpen.key)) {
    const onTheDay = steps.find((x) => !x.done && ((x.key === 'setup' && reached(setupDay)) || (x.key === 'picked' && pickupB && reached(pickupB.date))));
    if (onTheDay) firstOpen = onTheDay;
  }
  const allDone = !firstOpen;
  const finished = allDone && paidFull && !isVoid && !(pr && pr.takedownPending);
  const lastDone = [...steps].reverse().find((s) => s.done) || null;
  return {
    plan, steps, total: steps.length, doneCount: steps.filter((s) => s.done).length,
    current: isVoid ? 'void' : (firstOpen ? firstOpen.key : 'finished'), currentN: firstOpen ? firstOpen.n : steps.length + 1,
    finished, allDone, lastDone, confirmed: isConfirmed({ r, stored, depositIn, jobDone }), called: doneOf.called,
    paidFull, depositIn, sent, owed, held, refundable, picked, returned, jobDone,
    pickupBooking: pickupB, grazingPickup: grazingB, today,
  };
}

// The one undo beside the last ✓ (owner: "never deletes payments or invoices"). A tap that
// lives on this card is taken back here; a step that follows Money or the invoice says where
// to change it instead. -> { key, kind: 'form' | 'explain', ... }
export function undoFor(s, { tdS = null, stored = null } = {}) {
  const last = s.lastDone;
  if (!last) return null;
  const k = last.key;
  if (k === 'called') {
    if (last.how === 'phone') return { key: k, kind: 'explain', words: 'This request came by phone, so it counts as called. Nothing to undo.' };
    if (!(stored && stored.called_at)) return { key: k, kind: 'explain', words: 'This ticked itself because a later step is done.' };
    return { key: k, kind: 'form', action: '/admin/requests/called', fields: { undo: '1' }, question: 'Take back "Called back"? Any booking stays on the calendar, marked not confirmed.' };
  }
  if (k === 'setup') return { key: k, kind: 'form', action: '/admin/requests/jobdone', fields: { undo: '1' }, question: 'Take back "Setup done"? Nothing is sent to the customer.' };
  if (k === 'takedown') {
    if (last.auto === 'not_needed' && last.how === 'none') return { key: k, kind: 'explain', words: 'They never asked for a takedown. To add one, open More and use the Takedown line.' };
    if (last.auto === 'not_needed') return { key: k, kind: 'form', action: '/admin/requests/takedown', fields: { plan: '' }, question: 'Take back "Not needed"? The takedown question comes back on the card.' };
    const b = tdS && tdS.booking;
    return b ? { key: k, kind: 'form', action: `/admin/calendar/bookings/${b.id}/done`, fields: { undo: '1' }, question: 'Take back "Takedown done"? The booking stays on the calendar.' } : null;
  }
  if (k === 'pickup') {
    if (last.auto === 'not_needed') return { key: k, kind: 'form', action: '/admin/requests/takedown', fields: { plan: '' }, question: 'Take back "Pickup: not needed"?' };
    return s.grazingPickup ? { key: k, kind: 'form', action: `/admin/calendar/bookings/${s.grazingPickup.id}/done`, fields: { undo: '1' }, question: 'Take back "Pickup done"?' } : null;
  }
  if (k === 'picked') {
    if (s.returned) return { key: k, kind: 'explain', words: 'The games are already back. Undo "Returned" first.' };
    return s.pickupBooking ? { key: k, kind: 'form', action: `/admin/calendar/bookings/${s.pickupBooking.id}/done`, fields: { undo: '1' }, question: 'Take back "Picked up"? A payment you recorded stays: money is changed on the invoice.' } : null;
  }
  if (k === 'returned') return { key: k, kind: 'returns', question: 'Take back "Returned"? Open the check-in and tap Undo returned.' };
  if (k === 'invoiced') return { key: k, kind: 'explain', words: 'An invoice that went out cannot be un-sent. To cancel it, open the invoice and tap Void.', link: 'invoice' };
  if (k === 'deposit_back' && last.auto === 'none') return { key: k, kind: 'explain', words: 'There was no damage deposit on the invoice, so there is nothing to undo.' };
  // deposit, paid, deposit_back: money is never deleted here.
  return { key: k, kind: 'explain', words: 'Money is changed on the invoice: open it and use "That was a mistake: mark as not paid" or the damage deposit box. Nothing is ever deleted.', link: 'invoice' };
}

export async function loadStored(db) {
  try {
    const { results } = await db.prepare('SELECT request_key, called_at, confirmed_at FROM request_steps').all();
    return Object.fromEntries((results || []).map((x) => [x.request_key, x]));
  } catch { return {}; }
}

// Damage deposit refunded / kept, per invoice (ledger.mjs depositHeld, for every invoice at once).
export async function depositOutcomes(db) {
  const { results } = await db.prepare(`SELECT invoice_id,
      COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount_cents END), 0) AS refunded,
      COALESCE(SUM(CASE WHEN kind = 'deposit_kept' THEN amount_cents END), 0) AS kept
    FROM payments WHERE voided_at IS NULL AND kind IN ('refund','deposit_kept') GROUP BY invoice_id`).all();
  return Object.fromEntries((results || []).map((x) => [x.invoice_id, { refunded: x.refunded, kept: x.kept }]));
}

// Every live request that is NOT confirmed: the "Unconfirmed requests" list on Calendar &
// Bookings, the tentative chips, and the Monday summary. invoices: { id: { balance } }.
export function unconfirmedKeys({ requests = [], statuses = {}, invoices = {}, returns = {}, stored = {} }) {
  const out = new Set();
  for (const r of requests) {
    const st = statuses[r.key] || {};
    if (r.isTest || st.archived_at || st.status === 'void') continue;
    const inv = st.invoice_id ? invoices[st.invoice_id] : null;
    const bal = inv && (inv.balance || inv);
    const depositIn = Boolean(bal && bal.paid > 0) || ['deposit_paid', 'paid', 'done'].includes(st.status);
    const jobDone = Boolean(st.job_done_at) || Boolean(returns[r.key] && returns[r.key].returned_at) || st.status === 'job_done';
    if (!isConfirmed({ r, stored: stored[r.key], depositIn, jobDone })) out.add(r.key);
  }
  return out;
}

export async function markCalled(db, key, { confirm = false, how = '' } = {}) {
  await db.prepare(`INSERT INTO request_steps (request_key, called_at, confirmed_at, how) VALUES (?1, datetime('now'), CASE WHEN ?2 = 1 THEN datetime('now') END, ?3)
    ON CONFLICT(request_key) DO UPDATE SET called_at = COALESCE(request_steps.called_at, datetime('now')),
      confirmed_at = CASE WHEN ?2 = 1 THEN COALESCE(request_steps.confirmed_at, datetime('now')) ELSE request_steps.confirmed_at END, how = ?3, updated_at = datetime('now')`)
    .bind(key, confirm ? 1 : 0, String(how).slice(0, 40)).run();
}
export async function markConfirmed(db, key, how = '') { await markCalled(db, key, { confirm: true, how }); }
export async function undoCalled(db, key) {
  await db.prepare("UPDATE request_steps SET called_at = NULL, confirmed_at = NULL, how = 'undone', updated_at = datetime('now') WHERE request_key = ?1").bind(key).run();
}

// "Waiting N days" (owner, 19 Oct 2026): whole Memphis calendar days between the day the request
// came in and today, so a request sent at 11:50 PM is "since yesterday" ten minutes later.
const memphisDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
export function waitingDays(sentMs, today) {
  if (!Number.isFinite(sentMs) || !today) return 0;
  const a = Date.parse(`${memphisDay(sentMs)}T12:00:00Z`); const b = Date.parse(`${today}T12:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86400000));
}
export function waitingWords(n) {
  if (n <= 0) return 'Sent today';
  if (n === 1) return 'Waiting since yesterday';
  return `Waiting ${n} days`;
}
export const WAIT_HIGHLIGHT_DAYS = 3;
