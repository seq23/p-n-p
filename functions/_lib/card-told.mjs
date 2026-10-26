// The job card's "What they told us", "Still to ask" and the pre-made questions text
// (owner-approved mock-up "P&P Job Card Redo", 25 Oct 2026). Pure: reads the request's answers
// (r.rentals / r.decor / r.other) and its bookings, never writes anything.
//
//   toldFacts(r, services, bookings)  -> [{ key, label, value }]   only answers that exist
//   stillToAsk(r, services, bookings) -> [{ key, chip, question }] only answers that are missing,
//                                        in the owner's order (10 for party & decor; porch,
//                                        grazing and rentals have their own sets)
//   questionsText(r, services, ask)   -> the text in Valerie's wording, numbered 1, 2, 3 ...
//   questionsSms(phone, text)         -> sms:<digits>?&body=<URL-encoded text> ('' without a phone)
//   askedWords(r, nowMs)              -> "Asked Sun 25 Oct, 12:06 PM · 2 hours ago" (Memphis)

import { shortDate } from './util.mjs';
import { parseFormDate } from './calendar.mjs';
import { smsHref } from './quick-texts.mjs';

export const QUESTIONS_SIGN_OFF = '— Valerie, Porch & Party';

const all = (r) => [...(r.rentals || []), ...(r.decor || []), ...(r.other || [])];
const ans = (r, re) => { const hit = all(r).find((x) => re.test(String(x.label || ''))); return hit ? String(hit.value == null ? '' : hit.value).trim() : ''; };
// "Not sure yet" (and blanks) count as not answered: the question is still worth asking.
const real = (v) => (v && !/^not sure/i.test(v) ? v : '');
const notes = (r) => [ans(r, /^anything else/i), ans(r, /^notes about your porch/i), ans(r, /^notes$/i)].filter(Boolean).join(' · ');
const said = (r, re) => re.test(notes(r));
const COLOR_RE = /\b(colou?rs?|theme|red|pink|purple|blue|green|gold|silver|black|white|ivory|cream|yellow|orange|teal|navy|lavender|lilac|burgundy|maroon|rose ?gold|pastel|neutral|boho|blush)\b/i;
const DECOR_RE = /\b(balloons?|rose petals?|petals|flowers?|candles?|sign|banner|garland|backdrop|marquee|neon)\b/i;
const PHOTO_RE = /\b(photos?|pictures?|pics?|inspo|inspiration|pinterest|screenshot|https?:\/\/)/i;
const ADDON_RE = /\b(champagne|wine|chocolates?|strawberr(y|ies)|gifts?|teddy|bear|cake|grazing|charcuterie)\b/i;
const DIET_RE = /\b(allerg\w*|vegan|vegetarian|gluten|dairy|nut[- ]?free|halal|kosher|diet\w*)\b/i;
const PORCH_SIZE_RE = /\b(steps?|stairs|columns?|wide|feet|ft|small|big|large|size|door)\b/i;

const has = (services, k) => services.includes(k);
const decorKind = (services) => (has(services, 'party') ? 'party' : (has(services, 'porch') ? 'porch' : (has(services, 'grazing') ? 'grazing' : '')));
const prettyTime = (hhmm) => { const m = /^(\d{2}):(\d{2})/.exec(String(hhmm || '')); if (!m) return ''; const h = Number(m[1]); return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; };

// The facts the card reads, once, for every service.
function facts(r, services, bookings = []) {
  const kind = decorKind(services);
  const firstKind = kind === 'porch' ? 'porch_install' : (kind === 'party' ? 'party_setup' : (kind === 'grazing' ? 'grazing_setup' : ''));
  const setupB = firstKind ? bookings.find((b) => b.kind === firstKind) : null;
  const pickB = bookings.find((b) => b.kind === 'rental_pickup') || null;
  const occasion = real(r.porchSeason || ans(r, /event type/i) || ans(r, /occasion/i));
  const placeKind = real(ans(r, /^where is it/i));
  const location = real(ans(r, /^location/i));
  const eventDate = parseFormDate(ans(r, /^event date|what date is your event/i)) || (setupB && setupB.date) || '';
  return {
    kind, occasion, placeKind, location, eventDate,
    readyBy: setupB && setupB.time ? setupB.time : '',
    guests: real(ans(r, /how many guests/i)),
    budget: real(ans(r, /^budget/i)),
    notes: notes(r),
    grazing: real(ans(r, /^add a grazing table/i)),
    food: real(ans(r, /source the food/i)),
    porchDecor: real(r.porchDecor || ans(r, /^how much decor/i)),
    porchAddOns: real(r.porchAddOns || ans(r, /^add-ons/i)),
    takedown: r.takedownPlan === 'customer_handles' ? "They'll handle it" : (r.takedownPlan === 'scheduled' ? 'Yes, they want it' : real(ans(r, /take (it )?down/i))),
    games: real(ans(r, /^which games/i) || r.gamesAnswer || ''),
    length: real(ans(r, /^how long/i) || r.durationAnswer || ''),
    pickupWhen: real(ans(r, /when do you pick up/i)),
    returnWhen: real(ans(r, /when do you bring/i)),
    pickupDate: (pickB && pickB.date) || parseFormDate(ans(r, /^pickup date|^delivery date/i)) || '',
    pickupTime: pickB && pickB.time ? pickB.time : '',
  };
}

// "What they told us": event/date, where, guests, budget, colors/theme, grazing/add-ons, takedown
// (rentals: games, pickup and back). An empty answer is never shown.
export function toldFacts(r, services = [], bookings = []) {
  const f = facts(r, services, bookings);
  const out = [];
  const add = (key, label, value) => { if (value) out.push({ key, label, value }); };
  const rentalsOnly = services.length === 1 && services[0] === 'rentals';
  add('event', 'Event', [f.eventDate ? shortDate(f.eventDate) : '', f.occasion].filter(Boolean).join(' · '));
  if (!rentalsOnly) {
    add('where', 'Where', [f.placeKind, f.location].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '));
    if (f.readyBy) add('ready', 'Ready by', prettyTime(f.readyBy));
    add('guests', 'Guests', f.guests);
    add('budget', 'Budget', f.budget);
    if (f.kind === 'porch') add('decor', 'Porch', f.porchDecor);
  }
  if (has(services, 'rentals')) {
    add('games', 'Games', f.games);
    add('pickup', 'Pick up', [f.pickupDate ? shortDate(f.pickupDate) : '', f.pickupTime ? prettyTime(f.pickupTime) : f.pickupWhen].filter(Boolean).join(', '));
    add('back', 'Back', f.returnWhen);
  }
  add('notes', 'Colors & notes', f.notes);
  add('grazing', f.kind === 'grazing' ? 'Food' : (f.kind === 'porch' ? 'Add-ons' : 'Grazing'), f.kind === 'grazing' ? f.food : (f.kind === 'porch' ? f.porchAddOns : f.grazing));
  if (!rentalsOnly) add('takedown', 'Takedown', f.takedown);
  return out;
}

// Each question: key, its chip (short words) and the text line. `when` is the date words.
function questionSet(f, services) {
  const day = f.eventDate ? shortDate(f.eventDate) : '';
  const when = !f.eventDate ? 'What date is it, and what time must it be ready?' : `What time do you need it completed on ${day}?`;
  const Q = {
    occasion: ['What we are celebrating', 'What are we celebrating?', () => !f.occasion],
    where: ['Hotel or address', 'Which hotel (or address) is the setup at?', () => !f.location],
    when: [f.eventDate ? 'What time it must be ready' : 'Date and ready-by time', when, () => !f.eventDate || !f.readyBy],
    guests: ['How many guests', 'How many guests will there be?', () => !f.guests],
    decor: ['Decorations they picture', 'What decorations are you imagining (balloons, rose petals, flowers, candles, a custom sign)?', () => !DECOR_RE.test(f.notes)],
    photos: ['Inspiration photos', 'Do you have any inspiration photos you can send?', () => !PHOTO_RE.test(f.notes)],
    colors: ['Colors or theme', 'What colors or theme would you like?', () => !COLOR_RE.test(f.notes)],
    addons: ['Add-ons (champagne, chocolates, gifts, grazing)', 'Would you like any add-ons, like champagne, chocolates, gifts or a grazing table?', () => !ADDON_RE.test(f.notes)],
    takedown: ['Takedown afterwards', 'Would you like us to take it down afterwards?', () => !f.takedown],
    budget: ['Budget', 'Is there a budget you would like me to work within?', () => !f.budget],
    // Porch
    p_occasion: ['Season or occasion', 'What season or occasion is the porch for?', () => !f.occasion],
    p_where: ['Address', 'What is the address for the porch?', () => !f.location],
    p_when: [f.eventDate ? 'What time it must be ready' : 'Install date and time', f.eventDate ? `What time would you like it ready on ${day}?` : 'What day would you like it installed, and by what time?', () => !f.eventDate || !f.readyBy],
    p_size: ['Porch size', 'How big is the porch (steps, columns, how wide)? A photo of it helps a lot.', () => !PORCH_SIZE_RE.test(f.notes)],
    p_decor: ['How much decor', 'How much decor are you picturing (a few pieces or a full porch)?', () => !f.porchDecor],
    p_addons: ['Add-ons', 'Would you like any add-ons, like lights, extra pumpkins or a custom sign?', () => !f.porchAddOns],
    // Grazing
    g_food: ['Food: us or them', 'Should we source the food, or will you provide it?', () => !f.food],
    g_diet: ['Allergies or diet needs', 'Any allergies or diet needs we should plan around?', () => !DIET_RE.test(f.notes)],
    // Rentals
    r_games: ['Which games', 'Which games would you like?', () => !f.games],
    r_date: ['Event date', 'What date is your event?', () => !f.eventDate && !f.pickupDate],
    r_length: ['One day or the weekend', 'Do you need them for one day or the weekend?', () => !f.length],
    r_pickup: ['Pickup time', f.pickupDate ? `What time will you pick up on ${shortDate(f.pickupDate)}?` : 'What day and time will you pick up?', () => !f.pickupTime],
    r_return: ['When they bring them back', 'When will you bring them back?', () => !f.returnWhen],
    r_occasion: ['The occasion', 'What is the occasion?', () => !f.occasion],
  };
  const order = [];
  const kind = f.kind;
  if (kind === 'party') order.push('occasion', 'where', 'when', 'guests', 'decor', 'photos', 'colors', 'addons', 'takedown', 'budget');
  else if (kind === 'porch') order.push('p_occasion', 'p_where', 'p_when', 'p_size', 'p_decor', 'photos', 'colors', 'p_addons', 'takedown');
  else if (kind === 'grazing') order.push('occasion', 'where', 'when', 'guests', 'g_food', 'g_diet', 'colors', 'budget');
  if (has(services, 'rentals')) order.push('r_games', ...(kind ? [] : ['r_date', 'r_occasion']), 'r_length', 'r_pickup', 'r_return');
  return order.filter((k, i) => order.indexOf(k) === i).map((k) => ({ key: k, chip: Q[k][0], question: Q[k][1], missing: Q[k][2]() }));
}

// "Still to ask": only the questions the request did not answer, in order.
export function stillToAsk(r, services = [], bookings = []) {
  return questionSet(facts(r, services, bookings), services).filter((q) => q.missing).map(({ key, chip, question }) => ({ key, chip, question }));
}
// Every question for the set (for tests and the help page): [{ key, question, missing }].
export function allQuestions(r, services = [], bookings = []) {
  return questionSet(facts(r, services, bookings), services);
}

const firstOf = (name) => String(name || '').trim().split(/\s+/)[0] || '';
// "a beautiful hotel room setup / porch / party / grazing table" (rentals: "the games").
function whatWords(f, services) {
  if (f.kind === 'porch') return `a beautiful ${f.occasion && !/other|special/i.test(f.occasion) ? `${f.occasion.split('/')[0].trim()} ` : ''}porch`;
  if (f.kind === 'party') return /hotel/i.test(`${f.placeKind} ${f.location}`) ? 'a beautiful hotel room setup' : 'a beautiful party';
  if (f.kind === 'grazing') return 'a beautiful grazing table';
  return has(services, 'rentals') ? 'a fun day with our games' : 'something beautiful';
}

// The pre-made text, in Valerie's words: "Hi Tiffany! 💕 I'd love to help you create a beautiful
// hotel room setup for your birthday! To put together your quote, a few quick questions:
// 1. ... 2. ... Once I have those, I'll put together some options and pricing for you! 💕
// — Valerie, Porch & Party". Questions are numbered 1, 2, 3 in order, only the missing ones.
export function questionsText(r, services = [], ask = null, bookings = []) {
  const f = facts(r, services, bookings);
  const list = ask || stillToAsk(r, services, bookings);
  const hi = firstOf(r.name) ? `Hi ${firstOf(r.name)}! 💕` : 'Hi! 💕';
  const occ = f.kind === 'porch' ? '' : (f.occasion && !/other/i.test(f.occasion) ? ` for your ${f.occasion.toLowerCase()}` : '');
  const what = f.kind ? `I'd love to help you create ${whatWords(f, services)}${occ}!` : `I'd love to help you plan ${whatWords(f, services)}${occ}!`;
  const lead = list.length === 1 ? 'To put together your quote, one quick question:' : 'To put together your quote, a few quick questions:';
  const qs = list.map((q, i) => `${i + 1}. ${q.question}`);
  return [`${hi} ${what}`, lead, ...qs, `Once I have ${list.length === 1 ? 'that' : 'those'}, I'll put together some options and pricing for you! 💕`, QUESTIONS_SIGN_OFF].join('\n');
}

// The sms: link: the same rule as every other pre-made text (quick-texts.mjs smsHref), so the
// body is encodeURIComponent'd (emoji, "&", "?", "#" and new lines survive on an iPhone).
export function questionsSms(phone, text) {
  return smsHref(phone, text);
}

// ---- When the request came in ------------------------------------------------------------------
// r.sortTime is Memphis wall-clock time stored as UTC (requests.mjs wallClockMs / sheet.mjs), so it
// is read in UTC for the words, and "now" is turned into Memphis wall-clock time for the age.
const memphisWallNow = (nowMs) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(nowMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
};
export function ageWords(ms) {
  if (!Number.isFinite(ms)) return '';
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
export function askedWords(r, nowMs = Date.now()) {
  if (!r || !Number.isFinite(r.sortTime) || !r.sortTime) return r && r.timestamp ? `Asked ${r.timestamp}` : '';
  const d = new Date(r.sortTime);
  const iso = d.toISOString().slice(0, 10);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const age = ageWords(memphisWallNow(nowMs) - r.sortTime);
  return `Asked ${shortDate(iso)}, ${time}${age ? ` · ${age}` : ''}`;
}
