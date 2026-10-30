// Quick texts behind the "💬 Text ▾" button on every request card (owner-approved mock-up
// "Quick texts from the Text button", 20 Oct 2026). Valerie taps a ready-made text, it is
// filled in from the request, she can change any word, and it opens in Messages on her own
// phone (an sms: link, free, she presses Send herself). Every text is signed SIGN_OFF.
// The wording below is the approved mock-up's, word for word; a value that is not on file is
// written "__" so she fills it in before sending (the menu says so).
// Pure: no D1, no network. views.mjs renders the menu; admin.mjs logs "Texted: <title>".

export const SIGN_OFF = '— Valerie at Porch & Party 901';
export const BLANK = '__';
const BUSINESS_LINE = '901-355-1518';

const or = (v, fb = BLANK) => (v ? v : fb);

// g: 'rent' game rentals · 'job' porch, party and grazing · 'any' any job · 'money' booking and money.
export const QUICK_TEXTS = [
  { id: 'pickup', g: 'rent', t: 'Set pickup time', b: (c) => `Hi ${c.first}! What time works for your game pickup on ${or(c.day)} at Mt. Moriah Station? Text me here and I'll meet you there.` },
  { id: 'ret', g: 'rent', t: 'Set return (drop-off) time', b: (c) => `Hi ${c.first}! What time works to bring the games back on ${or(c.returnDay)} at Mt. Moriah Station? Text me here and I'll meet you there.` },
  { id: 'here', g: 'rent', t: "I'm here. How far away are you?", b: (c) => `Hi ${c.first}! I'm here at Mt. Moriah Station (2602 Mt. Moriah Rd). How far away are you?` },
  { id: 'bal', g: 'rent', t: 'Bring the balance', b: (c) => `Hi ${c.first}! See you ${or(c.day)}. Please have the rest, ${or(c.amount, '$__')}, ready by Zelle or Cash App at pickup.` },
  { id: 'today', g: 'rent', t: 'Return is today', b: (c) => `Hi ${c.first}! Friendly reminder: the games are due back today. Text me when you're on your way.` },
  { id: 'depback', g: 'rent', t: 'Deposit coming back', b: (c) => `Hi ${c.first}! Everything came back complete. Thank you! Your ${or(c.deposit, '$__')} deposit is on its way back to you.` },
  { id: 'setup', g: 'job', t: 'Set setup time', b: (c) => `Hi ${c.first}! What time works for us to set up on ${or(c.setupDay)}?` },
  { id: 'takedown', g: 'job', t: 'Set takedown time', b: (c) => `Hi ${c.first}! What time works for us to come take everything down on ${or(c.takedownDay)}?` },
  { id: 'photos', g: 'job', t: 'Send address and photos', b: (c) => `Hi ${c.first}! Could you text me the address and a couple of photos of the space? It helps me plan your setup.` },
  { id: 'omw', g: 'job', t: 'On our way', b: (c) => `Hi ${c.first}! We're on our way, about __ minutes out.` },
  { id: 'werehere', g: 'job', t: "We're here", b: (c) => `Hi ${c.first}! We're here!` },
  { id: 'got', g: 'any', t: 'Got your message', b: (c) => `Hi ${c.first}! Got your message. I'll get back to you shortly.` },
  { id: 'late', g: 'any', t: 'Running late', b: (c) => `Hi ${c.first}! I'm running about __ minutes behind. So sorry, see you soon!` },
  { id: 'callme', g: 'any', t: 'Call me back', b: (c) => `Hi ${c.first}! I just tried to call you. Give me a call back at ${BUSINESS_LINE} when you can.` },
  { id: 'conf', g: 'money', t: "It's confirmed", b: (c) => `Hi ${c.first}! Your deposit came in, so you're booked. See you soon!` },
  { id: 'hold', g: 'money', t: 'Reminder: games held until…', rentOnly: true, b: (c) => `Hi ${c.first}! Friendly reminder: your games (${or(c.items, 'your games')}) are held for you until ${or(c.holdEnds)}. Pay the deposit of ${or(c.dueNow, '$__')} by Zelle or Cash App from your invoice to keep them.` },
  { id: 'pay', g: 'money', t: 'Payment reminder', b: (c) => `Hi ${c.first}! Friendly reminder: ${or(c.amount, '$__')} is still due on invoice ${or(c.invoiceNumber)}. You can pay by Zelle or Cash App as shown on the invoice.` },
  { id: 'thanks', g: 'money', t: 'Thank you', b: (c) => `Hi ${c.first}! Thank you for choosing Porch & Party. It was a pleasure!` },
];
export const QUICK_BY_ID = Object.fromEntries(QUICK_TEXTS.map((q) => [q.id, q]));
// The texts that are also one of the older tap-logged messages (admin.mjs TAP_COLUMNS), so
// "Confirmation sent ✓" etc. still read true when she sends them from this menu.
export const QUICK_TAP_TEMPLATE = { conf: 'confirmation', hold: 'holdEnding', thanks: 'thankyou' };

export const GROUP_NAMES = { rent: 'Game rentals', job: 'Porch, party and grazing', any: 'Any job', money: 'Booking and money' };

// Which kind of job: 'rent' (games only), 'job' (porch, party, grazing), 'both' (games + decor).
export function jobKind(services = []) {
  const rent = services.includes('rentals');
  const decor = services.some((k) => k !== 'rentals');
  return rent && decor ? 'both' : (rent ? 'rent' : 'job');
}

export function groupsFor(kind) {
  const head = kind === 'rent' ? ['rent'] : (kind === 'job' ? ['job'] : ['rent', 'job']);
  return [...head, 'any', 'money'];
}

// Best right now: the 3 texts that fit the card's current step (steps.mjs deriveSteps current).
// [stage words, ids]. The two the mock-up shows are pinned: games out -> ret/today/here; porch up
// -> takedown/werehere/late.
const BEST_RENT = {
  called: ['new request', ['got', 'callme', 'hold']],
  invoiced: ['invoice not sent yet', ['got', 'hold', 'callme']],
  deposit: ['waiting for the deposit', ['hold', 'pay', 'callme']],
  picked: ['booked, pickup next', ['pickup', 'bal', 'here']],
  returned: ['games are out', ['ret', 'today', 'here']],
  paid: ['rest still owed', ['pay', 'bal', 'callme']],
  deposit_back: ['games are back', ['depback', 'thanks', 'got']],
  finished: ['all done', ['thanks', 'got', 'callme']],
  void: ['cancelled', ['got', 'callme', 'late']],
};
const BEST_JOB = {
  called: ['new request', ['got', 'callme', 'photos']],
  invoiced: ['invoice not sent yet', ['photos', 'got', 'callme']],
  deposit: ['waiting for the deposit', ['pay', 'photos', 'callme']],
  setup: ['booked, setup next', ['setup', 'omw', 'werehere']],
  takedown: ['set up, takedown next', ['takedown', 'werehere', 'late']],
  pickup: ['set up, pickup next', ['takedown', 'werehere', 'late']],
  paid: ['balance still owed', ['pay', 'thanks', 'got']],
  finished: ['all done', ['thanks', 'got', 'callme']],
  void: ['cancelled', ['got', 'callme', 'late']],
};
const RENT_STEPS = new Set(['picked', 'returned', 'deposit_back']);

export function bestFor(kind, current, services = []) {
  const map = kind === 'rent' || (kind === 'both' && RENT_STEPS.has(current)) ? BEST_RENT : BEST_JOB;
  const hit = map[current] || map.finished;
  let words = hit[0];
  if (current === 'setup' && services.includes('porch')) words = 'booked, install next';
  if (current === 'takedown' && services.includes('porch')) words = 'porch is up';
  return { words, ids: hit[1] };
}

// The texts this job offers, grouped, the best 3 first. -> { best:{words,items}, groups:[{key,name,items}] }
export function menuFor({ services = [], current = 'called' } = {}) {
  const kind = jobKind(services);
  const allowed = (q) => !(q.rentOnly && kind === 'job');
  const best = bestFor(kind, current, services);
  const bestItems = best.ids.map((id) => QUICK_BY_ID[id]).filter(allowed);
  const groups = groupsFor(kind).map((g) => ({ key: g, name: GROUP_NAMES[g], items: QUICK_TEXTS.filter((q) => q.g === g && allowed(q) && !best.ids.includes(q.id)) }));
  return { kind, best: { words: best.words, items: bestItems }, groups };
}

// The full text, signed. q null = the blank text.
export function fullText(q, c) {
  return q ? `${q.b(c)}\n${SIGN_OFF}` : `Hi ${c.first}! \n${SIGN_OFF}`;
}

// The sms: link for the words in the box right now (built at tap time on the page, same rule).
export function smsHref(phone, body) {
  const digits = String(phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (digits.length < 7) return '';
  return `sms:${digits}?&body=${encodeURIComponent(body)}`;
}

const money = (c) => `$${(Math.round(c) / 100).toFixed(2).replace(/\.00$/, '')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// "2026-10-24" -> "Sat 24 Oct" (the mock-up's day words).
export function dayWords(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export function holdWords(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(ms) || Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Chicago' }).replace(/^(\w+), (\w+) (\d+)$/, '$1 $3 $2');
  return `${day}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })}`;
}

const SETUP_KINDS = ['porch_install', 'party_setup', 'grazing_setup'];
const DOWN_KINDS = ['porch_takedown', 'party_takedown', 'grazing_pickup'];

// The values a text fills in, from what the card already has (no extra queries):
//   r (requests.mjs fromRow), bookings [{kind,date,items}], inv (invoice row + .balance),
//   hold ({ untilMs, by_hand } or null), dates ({ pickup, ret } ISO days for a rental).
export function quickCtx({ r = {}, bookings = [], inv = null, hold = null, dates = {} } = {}) {
  const first = String(r.name || '').trim().split(/\s+/)[0] || 'there';
  const bal = inv && inv.balance && !inv.balance.void ? inv.balance : null;
  const pick = bookings.find((b) => b.kind === 'rental_pickup');
  const setupB = bookings.find((b) => SETUP_KINDS.includes(b.kind));
  const downB = bookings.find((b) => DOWN_KINDS.includes(b.kind));
  const rentalDay = dates.pickup || (pick && pick.date) || '';
  const start = pick || setupB;
  return {
    first,
    phone: r.phone || '',
    day: dayWords(rentalDay || (setupB && setupB.date)),
    setupDay: dayWords(setupB && setupB.date),
    returnDay: dayWords(dates.ret || ((bookings.find((b) => b.kind === 'rental_return') || {}).date)),
    takedownDay: dayWords(downB && downB.date),
    amount: bal && bal.remaining > 0 ? money(bal.remaining) : '',
    deposit: bal && bal.refundable > 0 ? money(bal.refundable) : '',
    dueNow: inv && inv.deposit_due_cents > 0 ? money(inv.deposit_due_cents) : '',
    invoiceNumber: inv && inv.number ? inv.number : '',
    items: start ? String(start.items || '').replace(/, ([^,]*)$/, ' and $1') : '',
    holdEnds: hold && !hold.by_hand ? holdWords(hold.untilMs) : '',
  };
}
