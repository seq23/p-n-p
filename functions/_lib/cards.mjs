// Request cards (owner-approved 18 Oct 2026, JOB B): ONE rules table decides which buttons a
// card shows, by service x stage. views.mjs renders whatever this returns and nothing else, so
// a rental can never show a porch, takedown or walk-through button, and a void or finished card
// shows only Bring back / Put away. validate:admin-cards walks every service x stage.
import { SERVICE_KINDS } from './kinds.mjs';
import { STEP_KEYS } from './progress.mjs';

export const CARD_SERVICES = ['porch', 'party', 'grazing', 'rentals'];

// The filter chips on Requests (and on the Put away section): All, one per service, Not paid yet.
export const FILTERS = [
  ['all', 'All'], ['porch', 'Porch'], ['party', 'Party & decor'], ['grazing', 'Grazing'], ['rentals', 'Rentals'], ['unpaid', 'Not paid yet'],
];

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
export function cardStage({ pr, inv = null, archived = false }) {
  if (archived) return 'archived';
  if (pr.void) return 'void';
  if (pr.finished) return 'finished';
  // With no invoice at all (a job she handles by hand), the money steps never block the job steps.
  let stage = 'new';
  for (const s of pr.steps) {
    if (!s.done && !inv && (s.key === 'invoiced' || s.key === 'deposit_paid')) continue;
    if (!s.done) break;
    stage = s.key;
  }
  if (stage === 'new' && inv) return 'draft';
  return stage;
}
export const STAGES = ['new', 'draft', ...STEP_KEYS.slice(1, -1), 'finished', 'void', 'archived']; // 'paid' as the last step done is always Finished

// The scheduling button per service: [help key, booking kind].
export const SCHEDULE_FIRST = {
  porch: ['card.schedInstall', 'porch_install'],
  party: ['card.schedSetup', 'party_setup'],
  grazing: ['card.schedSetup', 'grazing_setup'],
  rentals: ['card.schedPickup', 'rental_pickup'],
};
// The optional second booking (never required): porch/party takedown, grazing pickup.
export const SCHEDULE_SECOND = {
  porch: ['card.schedTakedown', 'porch_takedown'],
  party: ['card.schedTakedown', 'party_takedown'],
  grazing: ['card.schedGrazingPickup', 'grazing_pickup'],
};

// Buttons that belong to one service only. A key here never shows on a card without it.
export const SERVICE_ONLY = {
  'card.checklist': ['porch', 'party', 'grazing'],
  'card.printChecklist': ['porch', 'party', 'grazing'],
  'card.schedInstall': ['porch'],
  'card.schedTakedown': ['porch', 'party'],
  'card.schedSetup': ['party', 'grazing'],
  'card.schedGrazingPickup': ['grazing'],
  'card.schedPickup': ['rentals'],
  'ret.mark': ['rentals'],
  'ret.see': ['rentals'],
  'card.jobDone': ['porch', 'party', 'grazing'],
  'card.undoJobDone': ['porch', 'party', 'grazing'],
};

// The rules table. facts: { services, stage, inv, plan, sched, kinds (booked kinds),
// returned, jobDoneAt }. Returns { primary: key|'', secondary: [key, ...] } where a key
// may carry a booking kind as "key|kind".
export function cardButtons({ services, stage, inv = null, plan = 'half', sched = false, kinds = [], returned = false, jobDoneAt = false, takedownPlan = '' }) {
  const has = (k) => services.includes(k);
  const decorish = services.filter((k) => k !== 'rentals');
  if (stage === 'archived') return { primary: 'pa.bringBack', secondary: [] };
  if (stage === 'void') return { primary: 'pay.unvoid', secondary: ['card.archive'] };
  if (stage === 'finished') return { primary: 'card.archive', secondary: [] };
  const firstSched = services.filter((k) => SCHEDULE_FIRST[k] && !kinds.includes(SCHEDULE_FIRST[k][1])).map((k) => `${SCHEDULE_FIRST[k][0]}|${SCHEDULE_FIRST[k][1]}`);
  let primary = '';
  if (stage === 'new') primary = 'card.createInvoice';
  else if (stage === 'draft') primary = 'card.openInvoice';
  else if (stage === 'invoiced') primary = plan === 'full' ? 'pay.paid' : 'pay.deposit';
  else if (stage === 'deposit_paid') primary = firstSched[0] || (decorish.length ? 'card.jobDone' : 'ret.mark');
  else if (stage === 'scheduled') primary = decorish.length && !jobDoneAt ? 'card.jobDone' : (has('rentals') && !returned ? 'ret.mark' : 'pay.paid');
  else if (stage === 'job_done') primary = 'pay.paid';
  const sec = [];
  if (inv && primary !== 'card.openInvoice') sec.push('card.openInvoice');
  if (!inv && primary !== 'card.createInvoice') sec.push('card.createInvoice');
  for (const s of firstSched) if (s !== primary) sec.push(s);
  if (sched) sec.push('card.seeCal');
  // The second booking: once the first one is on the calendar, and not booked yet. A porch or
  // party takedown shows as a button only when the plan is "scheduled" (the form said yes);
  // undecided, the takedown box on the card asks (takedownChoice); "customer will handle it"
  // shows nothing (no booking, no nagging). The grazing pickup is always just optional.
  for (const k of decorish) {
    const second = SCHEDULE_SECOND[k];
    if (!second || !kinds.includes(SCHEDULE_FIRST[k][1]) || kinds.includes(second[1])) continue;
    if (k !== 'grazing' && takedownPlan !== 'scheduled') continue;
    if (!sec.includes(`${second[0]}|${second[1]}`)) sec.push(`${second[0]}|${second[1]}`);
  }
  if (has('rentals') && returned) sec.push('ret.see');
  if (has('rentals') && !returned && sched && primary !== 'ret.mark') sec.push('ret.mark');
  if (decorish.length && jobDoneAt && !returned) sec.push('card.undoJobDone');
  if (decorish.length) sec.push('card.checklist', 'card.printChecklist');
  sec.push('card.archive');
  // The never-rules, applied last so no branch above can break them.
  const allowed = (key) => { const only = SERVICE_ONLY[key.split('|')[0]]; return !only || only.some((k) => has(k)); };
  return { primary: allowed(primary) ? primary : '', secondary: [...new Set(sec)].filter(allowed).filter((k) => k !== primary) };
}

// The takedown box: which porch/party takedown still needs a decision on this card.
// Returns '' (nothing to show), 'ask' (no plan yet), 'not_sure', or 'customer_handles'.
export function takedownChoice({ services, kinds = [], takedownPlan = '', stage }) {
  if (['void', 'finished', 'archived'].includes(stage)) return '';
  const k = services.find((x) => (x === 'porch' || x === 'party') && kinds.includes(SCHEDULE_FIRST[x][1]) && !kinds.includes(SCHEDULE_SECOND[x][1]));
  if (!k) return '';
  if (takedownPlan === 'scheduled') return '';
  return takedownPlan === 'not_sure' || takedownPlan === 'customer_handles' ? takedownPlan : 'ask';
}
export const TAKEDOWN_PLANS = ['scheduled', 'not_sure', 'customer_handles'];

// ---- Key facts: the one line under the name (date, where, Call) -----------------------
const iso = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/) || String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (!m) return ''; return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; };
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

export function matchesFilter(f, { services, inv }) {
  if (!f || f === 'all') return true;
  if (f === 'unpaid') return notPaidYet(inv);
  return services.includes(f);
}

// The badge colours come from the one service map (kinds.mjs), words always shown.
export function serviceBadge(k) {
  const s = SERVICE_KINDS[k];
  return s ? { label: { porch: 'Porch', party: 'Party & decor', grazing: 'Grazing', rentals: 'Rentals' }[k], bar: s.bar, tint: s.tint } : null;
}
