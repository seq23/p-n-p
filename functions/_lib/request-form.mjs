// The porchandparty901.com/request form (owner-approved 18 Oct 2026; spec: the request-form
// audit plus every owner correction). Pure: no JSON imports and no bindings, so the page
// generator (scripts/generators/build_request_pages.js, Node) and the Pages Function
// (functions/_lib/request-submit.mjs) render the SAME markup, and validators can load it.
//
// One page, phone-first, no framework. Every path asks only what it needs: page-1 service
// question in the canonical order (scripts/lib/brand.js SERVICES), then that service's
// questions, then contact, the photo ID (required for every customer on every path), and the
// rules checkbox. Without JavaScript every section shows, each headed by the choice it
// belongs to, and the server validates only the chosen path; with JavaScript the other
// sections hide, the ID photo is shrunk and re-encoded on the phone (which also drops its
// EXIF), and rentals show live availability and the exact total.
import { esc } from './util.mjs';
import { prefillLines } from './pricing.mjs';
import PP from '../../scripts/lib/porch_packages.js';
import BD from '../../scripts/lib/business_delivery.js';
import { isISODate, RENTAL_LENGTHS, PICKUP_CHOICES, RETURN_CHOICES, rentalSpan } from './calendar.mjs';

export const RULES_VERSION = '2026-10-19';
export const RULES_PATH = '/rules';
export const TERMS_PATH = '/terms-and-conditions';
// Owner wording, 18 Oct 2026, right above the ID upload on every path.
export const ID_NOTE = 'Your photo ID is for our safety and security. We never share it, and we delete it after your final payment.';
export const AGREE_LABEL = "I have read and agree to Porch & Party's Rules & Responsibilities and Terms & Conditions";
export const PARTY_PARENTHETICAL = '(hotel-room surprises, home celebrations, showers, event spaces — big or small)';
export const MAX_ID_BYTES = 10 * 1024 * 1024;
export const ID_TYPES = ['image/jpeg', 'image/png'];

const dollars = (p) => Number(String(p).replace(/[^0-9.]/g, ''));

// Page-1 choices, canonical order. Prices come from the data files via the arguments.
export function serviceChoices(offers, table) {
  return [
    { key: 'porch', label: 'Porch decorating', note: `seasonal and holiday porches, from $${dollars(offers.services.porch.price)}` },
    { key: 'party', label: 'Party planning & decor', note: `${PARTY_PARENTHETICAL.slice(1, -1)}; from $${dollars(offers.services.celebration.price)}` },
    { key: 'grazing', label: 'Grazing tables', note: `styling from $${dollars(offers.services.grazing.price)}, food extra` },
    { key: 'rentals', label: 'Party game rentals', note: `giant yard games, $${table.dayCents / 100} a game a day` },
  ];
}
export const SERVICE_KEYS = ['porch', 'party', 'grazing', 'rentals'];

const EVENT_TYPES = ['Birthday', 'Anniversary', 'Proposal', 'Baby or bridal shower', 'Graduation', 'Holiday or other'];
const TAKEDOWN = (price) => [['yes', `Yes, take it down (from $${price})`], ['no', "No, I'll handle it"], ['not_sure', 'Not sure yet']];
export const TAKEDOWN_PLAN = { yes: 'scheduled', no: 'customer_handles', not_sure: 'not_sure' };
export const HEARD = ['Facebook', 'Google', 'Instagram', 'Friend or family', 'Saw your work', 'Other'];
// Rental length and the pickup/return choices (owner, 19 Oct 2026; calendar.mjs rentalSpan).
export const DURATIONS = RENTAL_LENGTHS;
export const RENTAL_DATE_LABEL = 'What date is your event?';
export const PICKUP_LABEL = 'When do you pick up the games?';
export const RETURN_LABEL = 'When do you bring them back?';

// The porch path (owner, 18 Oct 2026; data/offers/porch_packages.json): the season, then
// "How much decor are you picturing?" with the package names and NO tier prices (only the
// from-price and range per season, the final-quote line and a "See examples and prices"
// link to the calculator), "Book both seasons", the unpriced add-ons and notes.
export function porchQuestions(pk, td) {
  const seasons = pk.seasons.map((x) => x.formChoice);
  const decorHelp = `<span class="rq-range">${PP.formRangeLines(pk).map((l) => esc(l)).join('<br>')}</span><br>${esc(pk.finalQuoteLine)} <a href="${esc(pk.form.examplesHref)}" target="_blank" rel="noopener" data-porch-examples>${esc(pk.form.examplesLink)}</a>`;
  return [
    { name: 'porch_season', label: 'What season or occasion?', type: 'radio', required: true, group: 'decor', choices: [...seasons, 'Spring / Easter', 'Birthday or special moment', 'Other'] },
    { name: 'porch_decor', label: pk.form.question, type: 'radio', group: 'decor', helpHtml: decorHelp, choices: PP.decorChoices(pk) },
    { name: 'porch_both', label: pk.bundle.checkbox, type: 'check', group: 'decor', help: pk.form.bothSeasonsHelp },
    { name: 'porch_addons', label: 'Add-ons', type: 'checks', group: 'decor', help: 'Want more? Tick anything you would like us to add. We price add-ons with your quote.', choices: pk.addOns.formItems },
    { name: 'porch_takedown', label: 'Want us to take it down afterwards?', type: 'radio', group: 'decor', choices: TAKEDOWN(td) },
    { name: 'porch_notes', label: 'Notes about your porch or the look you want', type: 'textarea', group: 'decor', help: 'Steps, columns, colors, a link to a photo. Optional.' },
  ];
}

// Every question, by section. group decides where the admin card shows the answer.
export function questions(offers, table) {
  const td = offers.addOns && offers.addOns.takedown ? offers.addOns.takedown.fromPrice : 75;
  return {
    porch: porchQuestions(table.porchPackages, td),
    party: [
      { name: 'party_event', label: "What's the event type?", type: 'radio', required: true, group: 'decor', choices: EVENT_TYPES },
      { name: 'party_where', label: 'Where is it?', type: 'radio', required: true, group: 'decor', choices: ['Hotel room', 'Home', 'Event space or venue', 'Backyard or outdoors', 'Not sure yet'] },
      { name: 'party_guests', label: 'How many guests?', type: 'radio', group: 'decor', choices: ['Just the two of us', 'Under 15', '15–40', '40+'] },
      { name: 'party_grazing', label: 'Add a grazing table?', type: 'radio', group: 'decor', choices: [`Yes (styling from $${dollars(offers.services.grazing.price)}, food extra)`, 'No', 'Maybe'] },
      { name: 'party_takedown', label: 'Want us to take it down afterwards?', type: 'radio', group: 'decor', choices: TAKEDOWN(td) },
      { name: 'party_budget', label: 'Budget', type: 'radio', group: 'decor', choices: ['$300–$500', '$500–$1,000', '$1,000+', 'Not sure yet'] },
    ],
    grazing: [
      { name: 'grazing_event', label: "What's the event type?", type: 'radio', required: true, group: 'decor', choices: EVENT_TYPES },
      { name: 'grazing_guests', label: 'How many guests?', type: 'radio', required: true, group: 'decor', choices: ['Under 15', '15–40', '40–75', '75+'] },
      { name: 'grazing_food', label: 'Should we source the food?', type: 'radio', required: true, group: 'decor', help: `Styling starts at $${dollars(offers.services.grazing.price)}. Food is sourced for you at cost and added to the quote.`, choices: ['Yes, include food in my quote', "No, I'll provide the food"] },
      { name: 'grazing_budget', label: 'Budget', type: 'radio', group: 'decor', choices: ['$250–$500', '$500–$1,000', '$1,000+', 'Not sure yet'] },
    ],
    rentals: [
      { name: 'games', label: 'Which games?', type: 'games', required: true, group: 'rentals' },
      { name: 'rental_date', label: RENTAL_DATE_LABEL, type: 'date', required: true, group: 'rentals', help: `Pickup and return at ${table.pickupPlace}.` },
      { name: 'duration', label: 'How long?', type: 'radio', required: true, group: 'rentals', choices: DURATIONS },
      { name: 'pickup_when', label: PICKUP_LABEL, type: 'radio', required: true, group: 'rentals', byLength: PICKUP_CHOICES, choices: [...PICKUP_CHOICES.day, ...PICKUP_CHOICES.weekend] },
      { name: 'return_when', label: RETURN_LABEL, type: 'radio', required: true, group: 'rentals', byLength: RETURN_CHOICES, choices: [...RETURN_CHOICES.day, ...RETURN_CHOICES.weekend] },
      { name: 'occasion', label: "What's the occasion?", type: 'text', group: 'rentals', optionalNote: true },
    ],
    event: [
      { name: 'event_date', label: 'Event date', type: 'date', required: true, group: 'decor', help: 'Best guess is fine.' },
      { name: 'location', label: 'Location (hotel name, address or neighborhood)', type: 'text', required: true, group: 'decor', help: offers.travel ? offers.travel.line : '' },
    ],
    contact: [
      { name: 'name', label: 'Your full name', type: 'text', required: true, autocomplete: 'name' },
      { name: 'phone', label: 'Mobile number (we text your quote)', type: 'tel', required: true, autocomplete: 'tel' },
      { name: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' },
      { name: 'dob', label: 'Date of birth', type: 'date', required: true, autocomplete: 'bday' },
      { name: 'social', label: 'Social media link', type: 'text', help: 'Optional. Helps us confirm who we are working with.' },
      { name: 'heard', label: 'How did you hear about us?', type: 'radio', choices: HEARD },
      { name: 'notes', label: 'Anything else? Colors, theme, surprise details', type: 'textarea', group: 'other' },
    ],
  };
}

// The projector ask (owner, 18 Oct 2026: "we can include a projector but they must ask for
// that"). Offered only beside the movie screen; it is a request, never a line item: it does
// not add the admin-only Projector, change the price or touch availability. Valerie decides.
export const SCREEN_SLUG = 'inflatable-movie-screen';
export const PROJECTOR_ASK = 'Please include a projector (just ask, one available)';
export const PROJECTOR_ANSWER = 'Asked for a projector';

// The rental items a customer can pick (available now), with their bundle-friendly names.
export const rentalItems = (table) => table.items.map((i) => ({ slug: i.slug, name: i.name, choice: i.choice, quantity: i.quantity }));

// Exact rental money for a pick: the cheapest bundle mix (pricing.mjs prefillLines), the
// refundable damage deposit, what is due now (damage deposit + holdPercent of the rental) and
// what is left for pickup.
export function rentalQuote(slugs, duration, table, holdPercent = 50) {
  const picked = rentalItems(table).filter((i) => slugs.includes(i.slug));
  if (!picked.length) return null;
  const lines = prefillLines({ wantsRentals: true, gamesAnswer: picked.map((i) => i.choice).join(', '), durationAnswer: duration === 'weekend' ? 'Weekend' : 'One day' }, table);
  const rental = lines.filter((l) => !l.refundable).reduce((s, l) => s + Math.round(l.qty * l.unit_cents), 0);
  const damage = lines.filter((l) => l.refundable).reduce((s, l) => s + Math.round(l.qty * l.unit_cents), 0);
  const holdPart = Math.round((rental * holdPercent) / 100);
  return { lines, picked, rental, damage, total: rental + damage, dueNow: damage + holdPart, atPickup: rental - holdPart };
}
export const money = (c) => `$${(Math.round(c) / 100).toFixed(2).replace(/\.00$/, '')}`;

export function chicagoToday(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export const digits = (s) => { let d = String(s || '').replace(/\D/g, ''); if (d.length === 11 && d.startsWith('1')) d = d.slice(1); return d; };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// The services a submission asks for: the page-1 answer, or the "More than one" boxes.
export function chosenServices(fields) {
  const one = String(fields.service || '');
  if (one === 'multi') return SERVICE_KEYS.filter((k) => (fields.multi || []).includes(k));
  return SERVICE_KEYS.includes(one) ? [one] : [];
}

const choiceValue = (q, raw) => {
  const v = String(raw || '').trim();
  if (!v) return '';
  for (const c of q.choices || []) { const [val, label] = Array.isArray(c) ? c : [c, c]; if (v === val) return label; }
  return null; // not one of the choices
};

// Server-side validation of a whole submission. fields: plain object (arrays for multi/games).
// Returns { errors: {name: message}, answers: [{group,label,value}], clean }.
export function validateSubmission(fields, { offers, table, today, file = null }) {
  const Q = questions(offers, table);
  const errors = {};
  const answers = [];
  const services = chosenServices(fields);
  if (!fields.service) errors.service = 'Pick what you are planning.';
  else if (fields.service === 'multi' && !services.length) errors.multi = 'Tick the services you want.';
  const ask = (q) => {
    const raw = fields[q.name];
    if (q.type === 'games') return;
    if (q.type === 'checks') {
      const picked = (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map(String).filter((v) => q.choices.includes(v));
      const value = picked.join(', ');
      if (value && q.group) answers.push({ group: q.group, label: q.label, value });
      return value;
    }
    let value = String(raw == null ? '' : raw).trim().slice(0, 2000);
    if (q.type === 'check') value = value === 'yes' ? 'Yes' : '';
    if (q.type === 'radio') {
      const v = choiceValue(q, value);
      if (v === null) { errors[q.name] = 'Please pick one of the choices.'; return; }
      value = v;
    }
    if (q.required && !value) { errors[q.name] = `Please answer "${q.label.replace(/\?$/, '')}".`; return; }
    if (q.type === 'date' && value) {
      if (!isISODate(value)) { errors[q.name] = 'Please pick a date.'; return; }
      if (q.name !== 'dob' && value < today) { errors[q.name] = 'That date has passed. Please pick a future date.'; return; }
      if (q.name === 'dob' && value >= today) { errors[q.name] = 'Please check your date of birth.'; return; }
    }
    if (value && q.group) answers.push({ group: q.group, label: q.label, value });
    return value;
  };
  const clean = { services };
  for (const k of services.filter((s) => s !== 'rentals')) for (const q of Q[k]) clean[q.name] = ask(q);
  if (services.some((s) => s !== 'rentals')) for (const q of Q.event) clean[q.name] = ask(q);
  if (services.includes('rentals')) {
    const items = rentalItems(table);
    const games = (Array.isArray(fields.games) ? fields.games : [fields.games]).filter(Boolean).map(String).filter((g) => items.some((i) => i.slug === g));
    if (!games.length) errors.games = 'Tick at least one game.';
    clean.games = games;
    for (const q of Q.rentals.filter((x) => x.type !== 'games')) clean[q.name] = ask(q);
    clean.duration = String(fields.duration || '');
    // Event date + length + pickup/return choices -> the pickup and return days (owner, 19 Oct 2026).
    const len = clean.duration === 'weekend' ? 'weekend' : 'day';
    const pw = String(fields.pickup_when || ''); const rw = String(fields.return_when || '');
    if (pw && !errors.pickup_when && !PICKUP_CHOICES[len].some(([k]) => k === pw)) errors.pickup_when = `Please pick ${PICKUP_CHOICES[len].map(([, l]) => `"${l}"`).join(' or ')}.`;
    if (rw && !errors.return_when && !RETURN_CHOICES[len].some(([k]) => k === rw)) errors.return_when = `Please pick ${RETURN_CHOICES[len].map(([, l]) => `"${l}"`).join(' or ')}.`;
    if (clean.rental_date && clean.duration && !errors.rental_date && !errors.pickup_when && !errors.return_when && pw && rw) {
      const span = rentalSpan({ event: clean.rental_date, length: len, pickup: pw, ret: rw });
      if (span.error) errors.rental_date = span.error;
      else if (span.pickup < today) errors.pickup_when = 'That pickup day has already passed. Pick "The morning of", or another event date.';
      else {
        clean.pickup_date = span.pickup; clean.return_date = span.ret;
        answers.push({ group: 'rentals', label: 'Pickup date', value: span.pickup }, { group: 'rentals', label: 'Return date', value: span.ret });
      }
    }
    if (games.includes(SCREEN_SLUG) && String(fields.projector || '') === 'yes') {
      clean.projector = true;
      answers.push({ group: 'rentals', label: PROJECTOR_ANSWER, value: 'Yes' });
    }
    if (String(fields.business_delivery || '') === 'yes') {
      const bn = String(fields.business_name || '').trim().slice(0, 200);
      const ad = String(fields.delivery_address || '').trim().slice(0, 300);
      if (!bn) errors.business_name = 'Type the business name, or untick business delivery.';
      if (!ad) errors.delivery_address = 'Type the delivery address, or untick business delivery.';
      if (bn && ad) {
        clean.business = { name: bn, address: ad };
        answers.push({ group: 'rentals', label: 'Business delivery', value: 'Yes' }, { group: 'rentals', label: 'Business name', value: bn }, { group: 'rentals', label: 'Delivery address', value: ad });
      }
    }
    if (games.length) answers.unshift({ group: 'rentals', label: 'Which games?', value: items.filter((i) => games.includes(i.slug)).map((i) => i.choice).join(', ') });
  }
  for (const q of Q.contact) clean[q.name] = ask(q);
  if (clean.phone !== undefined && !errors.phone && digits(clean.phone).length !== 10) errors.phone = 'Please type a 10-digit mobile number.';
  if (clean.email !== undefined && !errors.email && !EMAIL_RE.test(clean.email)) errors.email = 'Please check your email address.';
  if (clean.social && !/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$|^@[\w.]+$/i.test(clean.social)) errors.social = 'Please paste a link to your profile (or leave it blank).';
  if (!file || !file.size) errors.id_photo = 'Please add a photo of your government photo ID.';
  else if (!ID_TYPES.includes(file.type)) errors.id_photo = 'That file is not a photo we can use. Take a photo with your phone camera, or upload a JPG or PNG.';
  else if (file.size > MAX_ID_BYTES) errors.id_photo = 'That photo is too large (over 10 MB). Please take it again.';
  if (String(fields.agree || '') !== 'yes') errors.agree = 'Please tick the box to agree to our Rules & Responsibilities and Terms & Conditions.';
  for (const k of ['porch_takedown', 'party_takedown']) if (fields[k]) clean.takedown_plan = TAKEDOWN_PLAN[String(fields[k])] || clean.takedown_plan;
  return { errors, answers, clean };
}

// ---- Markup -------------------------------------------------------------------------------

const req = '<span class="rq-req" aria-hidden="true">*</span>';
function fieldError(name, errors) {
  return errors[name] ? `<p class="rq-error" id="err-${esc(name)}">${esc(errors[name])}</p>` : '';
}
function describedBy(name, q, errors) {
  const ids = [q.help || q.helpHtml ? `help-${name}` : '', errors[name] ? `err-${name}` : ''].filter(Boolean);
  return ids.length ? ` aria-describedby="${ids.join(' ')}"` : '';
}

// Business delivery (owner, 19 Oct 2026): home rentals are picked up; a business can have the
// games delivered for the delivery fee (scripts/lib/business_delivery.js, the invoice quick-add's
// price). The tick box reveals Business name + Delivery address, both required when ticked.
function businessBlock(offers, table, values, errors) {
  const on = values.business_delivery === 'yes';
  const input = (name, label, auto) => `<div class="rq-q${errors[name] ? ' rq-bad' : ''}" id="q-${name}" data-q="${name}"><label for="f-${name}">${esc(label)}</label>${fieldError(name, errors)}<input type="text" id="f-${name}" name="${name}" value="${esc(values[name] || '')}" autocomplete="${auto}"${errors[name] ? ' aria-invalid="true"' : ''}></div>`;
  return `<div class="rq-q" id="q-business_delivery" data-q="business_delivery"><p class="rq-help" data-business-line>${esc(BD.businessDeliveryLine(offers))} Home and personal rentals are picked up and returned at ${esc(table.pickupPlace)}.</p>
    <label class="rq-choice"><input type="checkbox" name="business_delivery" value="yes" data-business-tick${on ? ' checked' : ''}> <span>${esc(BD.tickLabel(offers))}</span></label>
    <div class="rq-business" data-business-fields>${input('business_name', 'Business name', 'organization')}${input('delivery_address', 'Delivery address', 'street-address')}<p class="rq-help">The delivery fee is added to your invoice and paid at delivery.</p></div></div>`;
}

function renderQuestion(q, values, errors) {
  const v = values[q.name];
  const help = q.helpHtml ? `<p class="rq-help" id="help-${esc(q.name)}">${q.helpHtml}</p>` : q.help ? `<p class="rq-help" id="help-${esc(q.name)}">${esc(q.help)}</p>` : '';
  const invalid = errors[q.name] ? ' aria-invalid="true"' : '';
  const opt = q.required ? '' : ' <span class="rq-opt">(optional)</span>';
  if (q.type === 'radio') {
    const radios = q.choices.map((c) => {
      const [val, label] = Array.isArray(c) ? c : [c, c];
      const len = q.byLength ? Object.keys(q.byLength).find((k) => q.byLength[k].some(([x]) => x === val)) : '';
      if (len) return `<label class="rq-choice" data-length="${esc(len)}"><input type="radio" name="${esc(q.name)}" value="${esc(val)}"${String(v) === String(val) ? ' checked' : ''}${q.required ? ' required' : ''}> <span>${esc(label)} <span class="rq-len">(${len === 'weekend' ? 'entire weekend' : 'one day'})</span></span></label>`;
      return `<label class="rq-choice"><input type="radio" name="${esc(q.name)}" value="${esc(val)}"${String(v) === String(val) ? ' checked' : ''}${q.required ? ' required' : ''}> <span>${esc(label)}</span></label>`;
    }).join('');
    return `<fieldset class="rq-q${errors[q.name] ? ' rq-bad' : ''}" id="q-${esc(q.name)}" data-q="${esc(q.name)}"${describedBy(q.name, q, errors)}><legend>${esc(q.label)}${q.required ? req : opt}</legend>${help}${fieldError(q.name, errors)}${radios}</fieldset>`;
  }
  if (q.type === 'check') {
    return `<div class="rq-q" id="q-${esc(q.name)}" data-q="${esc(q.name)}"><label class="rq-choice"><input type="checkbox" name="${esc(q.name)}" value="yes"${v === 'yes' ? ' checked' : ''}${describedBy(q.name, q, errors)}> <span><strong>${esc(q.label)}</strong></span></label>${help}</div>`;
  }
  if (q.type === 'checks') {
    const picked = Array.isArray(v) ? v : (v ? [v] : []);
    const boxes = q.choices.map((c) => `<label class="rq-choice"><input type="checkbox" name="${esc(q.name)}" value="${esc(c)}"${picked.includes(c) ? ' checked' : ''}> <span>${esc(c)}</span></label>`).join('');
    return `<fieldset class="rq-q" id="q-${esc(q.name)}" data-q="${esc(q.name)}"${describedBy(q.name, q, errors)}><legend>${esc(q.label)}${opt}</legend>${help}${boxes}</fieldset>`;
  }
  const id = `f-${q.name}`;
  const common = `id="${esc(id)}" name="${esc(q.name)}"${q.required ? ' required' : ''}${q.autocomplete ? ` autocomplete="${esc(q.autocomplete)}"` : ''}${invalid}${describedBy(q.name, q, errors)}`;
  const input = q.type === 'textarea'
    ? `<textarea ${common} rows="4" maxlength="2000">${esc(v || '')}</textarea>`
    : `<input type="${q.type === 'tel' ? 'tel' : q.type === 'email' ? 'email' : q.type === 'date' ? 'date' : 'text'}" ${common} value="${esc(v || '')}"${q.type === 'tel' ? ' inputmode="tel"' : ''}${q.type === 'text' ? ' maxlength="300"' : ''}>`;
  return `<div class="rq-q${errors[q.name] ? ' rq-bad' : ''}" id="q-${esc(q.name)}" data-q="${esc(q.name)}"><label for="${esc(id)}">${esc(q.label)}${q.required ? req : opt}</label>${help}${fieldError(q.name, errors)}${input}</div>`;
}

function renderGames(table, values, errors) {
  const picked = Array.isArray(values.games) ? values.games : [];
  const boxes = rentalItems(table).map((i) => `<label class="rq-choice rq-game" data-game="${esc(i.slug)}"><input type="checkbox" name="games" value="${esc(i.slug)}"${picked.includes(i.slug) ? ' checked' : ''}> <span>${esc(i.name)}</span> <span class="rq-left" data-left="${esc(i.slug)}"></span></label>`).join('');
  const screen = rentalItems(table).some((i) => i.slug === SCREEN_SLUG);
  const projector = screen ? `<label class="rq-choice rq-projector${picked.includes(SCREEN_SLUG) ? '' : ' rq-hide'}" data-projector><input type="checkbox" name="projector" value="yes"${values.projector === 'yes' ? ' checked' : ''}> <span>${esc(PROJECTOR_ASK)}</span></label>` : '';
  return `<fieldset class="rq-q${errors.games ? ' rq-bad' : ''}" id="q-games" data-q="games"${errors.games ? ' aria-describedby="err-games"' : ''}><legend>Which games?${req}</legend>
    <p class="rq-help">$${table.dayCents / 100} a game for a day, $${table.weekendCents / 100} for a weekend. We apply the best bundle price for you. Greyed out = already booked for your dates.</p>${fieldError('games', errors)}${boxes}${projector}</fieldset>`;
}

function section(key, title, body, { hidden = false } = {}) {
  return `<section class="rq-section" data-section="${esc(key)}"${hidden ? ' data-start-hidden' : ''}><h2>${title}</h2>${body}</section>`;
}

// The whole form. values/errors after a failed POST; ts = the server-signed render time.
export function renderForm({ offers, table, values = {}, errors = {}, ts = '', sitekey = '', referral = '', today = '' }) {
  const Q = questions(offers, table);
  const choices = serviceChoices(offers, table);
  const errList = Object.entries(errors);
  const summary = errList.length ? `<div class="rq-summary" role="alert" tabindex="-1" id="rq-errors"><h2>Please fix ${errList.length === 1 ? 'one thing' : `${errList.length} things`}</h2><ul>${errList.map(([k, m]) => `<li><a href="#q-${esc(k)}">${esc(m)}</a></li>`).join('')}</ul><p>If you added your ID photo, please add it again: we never keep a photo from a form that did not go through.</p></div>` : '';
  const svc = String(values.service || '');
  const multi = Array.isArray(values.multi) ? values.multi : [];
  const page1 = `<fieldset class="rq-q rq-services${errors.service ? ' rq-bad' : ''}" id="q-service" data-q="service"><legend>What are you planning?${req}</legend>
    <p class="rq-help">Pick the main one. You can pick more than one with the last choice.</p>${fieldError('service', errors)}
    ${choices.map((c) => `<label class="rq-choice rq-service"><input type="radio" name="service" value="${c.key}"${svc === c.key ? ' checked' : ''} required> <span><strong>${esc(c.label)}</strong> <span class="rq-note">(${esc(c.note)})</span></span></label>`).join('')}
    <label class="rq-choice rq-service"><input type="radio" name="service" value="multi"${svc === 'multi' ? ' checked' : ''} required> <span><strong>More than one of these</strong></span></label>
    <div class="rq-multi" data-multi id="q-multi"><p class="rq-help">Which services?</p>${fieldError('multi', errors)}${choices.map((c) => `<label class="rq-choice"><input type="checkbox" name="multi" value="${c.key}"${multi.includes(c.key) ? ' checked' : ''}> <span>${esc(c.label)}</span></label>`).join('')}</div>
  </fieldset>`;
  const sections = [
    section('porch', 'Your porch <span class="rq-for">(if you picked porch decorating)</span>', Q.porch.map((q) => renderQuestion(q, values, errors)).join('')),
    section('party', 'Your celebration <span class="rq-for">(if you picked party planning &amp; decor)</span>', Q.party.map((q) => renderQuestion(q, values, errors)).join('')),
    section('grazing', 'Your grazing table <span class="rq-for">(if you picked grazing tables)</span>', Q.grazing.map((q) => renderQuestion(q, values, errors)).join('')),
    section('event', 'Date and place <span class="rq-for">(porch, party &amp; decor, grazing)</span>', Q.event.map((q) => renderQuestion(q, values, errors)).join('')),
    section('rentals', 'Your games <span class="rq-for">(if you picked party game rentals)</span>', `<p class="rq-help">Booking, not a quote: we hold your games for ${esc(String(offers.rentalHolds.defaultHours))} hours while you pay the deposit.</p>${renderGames(table, values, errors)}${Q.rentals.filter((q) => q.type !== 'games').map((q) => renderQuestion(q, values, errors)).join('')}${businessBlock(offers, table, values, errors)}
      <div class="rq-total" data-total aria-live="polite"><noscript><p class="rq-help">Your exact total is shown on the next screen.</p></noscript></div>`),
  ].join('');
  const contact = section('contact', 'About you', Q.contact.map((q) => renderQuestion(q, values, errors)).join(''));
  const id = section('id', 'Your photo ID', `<p class="rq-idnote" id="help-id_photo">${esc(ID_NOTE)}</p>
    <div class="rq-q${errors.id_photo ? ' rq-bad' : ''}" id="q-id_photo" data-q="id_photo"><label for="f-id_photo">Government photo ID${req}</label><p class="rq-help">Take a photo of the front of your ID.</p>${fieldError('id_photo', errors)}
    <input type="file" id="f-id_photo" name="id_photo" accept="image/jpeg,image/png,image/*" required aria-describedby="help-id_photo${errors.id_photo ? ' err-id_photo' : ''}"><p class="rq-help" data-id-status aria-live="polite"></p></div>`);
  const agree = section('agree', 'Last step', `<div class="rq-q${errors.agree ? ' rq-bad' : ''}" id="q-agree" data-q="agree">${fieldError('agree', errors)}
    <label class="rq-choice rq-agree"><input type="checkbox" name="agree" value="yes" required${values.agree === 'yes' ? ' checked' : ''}> <span>I have read and agree to Porch &amp; Party's <a href="${RULES_PATH}" target="_blank" rel="noopener">Rules &amp; Responsibilities</a> and <a href="${TERMS_PATH}" target="_blank" rel="noopener">Terms &amp; Conditions</a>${req}</span></label>
    <input type="hidden" name="rules_version" value="${RULES_VERSION}"></div>
    ${sitekey ? `<div class="cf-turnstile" data-sitekey="${esc(sitekey)}" data-size="flexible"></div>` : ''}
    <button type="submit" class="btn-primary rq-submit" data-quote-cta="request-form">Send my request</button>
    <p class="rq-help">Takes about 3 minutes. No account needed. We usually reply within a day. Questions? Call or text <a href="tel:+19013551518">901-355-1518</a>.</p>`);
  return `<!--request-form--><div class="rq-wrap" id="request-form">${summary}
  <form class="rq-form" method="post" action="/request" enctype="multipart/form-data" novalidate data-today="${esc(today)}">
    <div class="rq-hp" aria-hidden="true"><label for="f-website">Leave this empty</label><input type="text" id="f-website" name="website" tabindex="-1" autocomplete="off"></div>
    <input type="hidden" name="ts" value="${esc(ts)}"><input type="hidden" name="ref" value="${esc(referral)}">
    ${page1}${sections}${contact}${id}${agree}
  </form></div>
  ${sitekey ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>' : ''}
  <style>${FORM_CSS}</style><script>${FORM_JS}</script><!--/request-form-->`;
}

const FORM_CSS = `.rq-range{font-weight:600;color:#3b302a}.rq-wrap{max-width:680px;margin:0 auto}.rq-form{display:block}.rq-section{background:#fff;border:1px solid #e8dfd4;border-radius:16px;padding:18px 16px;margin:16px 0}
.rq-section h2{font-size:1.5rem;margin:0 0 8px}.rq-for{font-size:.95rem;font-weight:400;color:#6b5c52}.rq-q{border:0;margin:0 0 18px;padding:0;min-width:0}
.rq-q legend,.rq-q>label{display:block;font-weight:600;font-size:1.05rem;margin-bottom:6px;padding:0}.rq-req{color:#a8442b;margin-left:3px}.rq-opt{font-weight:400;color:#6b5c52;font-size:.95rem}
.rq-help{margin:2px 0 8px;color:#5f5148;font-size:.95rem}.rq-note{font-weight:400;color:#5f5148}.rq-choice{display:flex;gap:10px;align-items:flex-start;min-height:44px;padding:8px 10px;border:1px solid #e8dfd4;border-radius:10px;margin:0 0 8px;cursor:pointer;font-size:1rem;line-height:1.35}
.rq-choice input{width:22px;height:22px;margin:2px 0 0;flex:none;accent-color:#a8442b}.rq-q input[type=text],.rq-q input[type=tel],.rq-q input[type=email],.rq-q input[type=date],.rq-q textarea{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:12px;border:1px solid #c9b8a8;border-radius:10px;background:#fff;color:#3b302a}
.rq-q input[type=file]{font-size:16px;width:100%}.rq-bad input,.rq-bad textarea,.rq-bad .rq-choice{border-color:#a8442b}.rq-error{color:#a8442b;font-weight:600;margin:4px 0 8px}
.rq-summary{border:2px solid #a8442b;border-radius:14px;padding:14px 16px;background:#fff6f3;margin:12px 0}.rq-summary h2{font-size:1.3rem;margin:0 0 6px}.rq-summary a{color:#a8442b}
.rq-idnote{background:#faf7f2;border-left:4px solid #b85f40;padding:10px 12px;border-radius:8px;font-weight:600}.rq-hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.rq-game.rq-off{opacity:.45}.rq-left{margin-left:auto;font-size:.9rem;color:#6b5c52}.rq-total{background:#faf7f2;border-radius:12px;padding:4px 14px}.rq-total table{width:100%;border-collapse:collapse}.rq-total td{padding:4px 0}.rq-total td+td{text-align:right}
.rq-submit{width:100%;min-height:52px;font-size:1.1rem;margin-top:8px;border:0;cursor:pointer}.rq-multi{margin:6px 0 0 18px}.rq-js .rq-section[hidden]{display:none}.rq-projector{margin-left:30px}.rq-js .rq-projector.rq-hide{display:none}.rq-js .rq-len{display:none}.rq-js .rq-choice[data-length].rq-hide{display:none}`;

// Progressive enhancement only: the form works without any of this.
const FORM_JS = `(function(){var f=document.querySelector('.rq-form');if(!f)return;document.documentElement.classList.add('rq-js');
var show={porch:['porch','event'],party:['party','event'],grazing:['grazing','event'],rentals:['rentals']};
function picked(){var s=f.querySelector('input[name=service]:checked');if(!s)return[];if(s.value!=='multi')return[s.value];return[].slice.call(f.querySelectorAll('input[name=multi]:checked')).map(function(x){return x.value;});}
function sync(){var p=picked(),on={};p.forEach(function(k){(show[k]||[]).forEach(function(s){on[s]=1;});});var m=f.querySelector('input[name=service][value=multi]');var box=f.querySelector('[data-multi]');if(box)box.hidden=!(m&&m.checked);
['porch','party','grazing','event','rentals'].forEach(function(k){var s=f.querySelector('[data-section='+k+']');if(!s)return;s.hidden=!on[k];[].slice.call(s.querySelectorAll('input,textarea')).forEach(function(i){if(i.hasAttribute('required')||i.dataset.req){i.dataset.req=1;i.required=!!on[k];}});});
['contact','id','agree'].forEach(function(k){var s=f.querySelector('[data-section='+k+']');if(s)s.hidden=!p.length;});proj();quote();}
function proj(){var l=f.querySelector('[data-projector]');if(!l)return;var s=f.querySelector('input[name=games][value=inflatable-movie-screen]'),on=!!(s&&s.checked);l.classList.toggle('rq-hide',!on);if(!on){var i=l.querySelector('input');if(i)i.checked=false;}}
function biz(){var t=f.querySelector('[data-business-tick]'),b=f.querySelector('[data-business-fields]');if(t&&b)b.hidden=!t.checked;}biz();f.addEventListener('change',function(e){if(e.target.matches&&e.target.matches('[data-business-tick]'))biz();});
f.addEventListener('change',function(e){if(e.target.name==='service'||e.target.name==='multi')sync();if(e.target.name==='games')proj();if(e.target.name==='duration')lens();if(/^(games|duration|rental_date|pickup_when|return_when)$/.test(e.target.name))quote();});
f.addEventListener('input',function(e){if(e.target.name==='rental_date')quote();});
function lens(){var d=f.querySelector('input[name=duration]:checked'),len=d?d.value:'';[].slice.call(f.querySelectorAll('[data-length]')).forEach(function(l){var off=!len||l.getAttribute('data-length')!==len;l.classList.toggle('rq-hide',off);var i=l.querySelector('input');if(off&&i&&i.checked)i.checked=false;});}
var t;function quote(){clearTimeout(t);t=setTimeout(function(){var box=f.querySelector('[data-total]');if(!box||picked().indexOf('rentals')<0)return;var d=f.querySelector('input[name=duration]:checked'),ev=f.querySelector('input[name=rental_date]'),pw=f.querySelector('input[name=pickup_when]:checked'),rw=f.querySelector('input[name=return_when]:checked');
var g=[].slice.call(f.querySelectorAll('input[name=games]:checked')).map(function(x){return x.value;});var q='/api/request/availability?event='+encodeURIComponent(ev&&ev.value||'')+'&pickup_when='+encodeURIComponent(pw?pw.value:'')+'&return_when='+encodeURIComponent(rw?rw.value:'')+'&duration='+encodeURIComponent(d&&d.value||'day')+'&games='+encodeURIComponent(g.join(','));
fetch(q).then(function(r){return r.json();}).then(function(j){if(!j||!j.ok)return;[].slice.call(f.querySelectorAll('[data-game]')).forEach(function(l){var s=l.getAttribute('data-game'),left=j.left?j.left[s]:null,inp=l.querySelector('input'),tag=l.querySelector('[data-left]');var off=left!==null&&left!==undefined&&left<=0&&!inp.checked;l.classList.toggle('rq-off',off);inp.disabled=off;if(tag)tag.textContent=off?'Booked those dates':'';});
box.innerHTML=j.html||'';}).catch(function(){});},250);}
var file=f.querySelector('input[name=id_photo]'),st=f.querySelector('[data-id-status]');
if(file&&window.DataTransfer&&window.HTMLCanvasElement)file.addEventListener('change',function(){var src=file.files&&file.files[0];if(!src||!/^image\\//.test(src.type))return;st.textContent='Getting your photo ready…';var url=URL.createObjectURL(src),img=new Image();
img.onload=function(){var max=1600,w=img.naturalWidth,h=img.naturalHeight,k=Math.min(1,max/Math.max(w,h));var c=document.createElement('canvas');c.width=Math.round(w*k);c.height=Math.round(h*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);
c.toBlob(function(b){if(!b){st.textContent='';return;}var dt=new DataTransfer();dt.items.add(new File([b],'id-photo.jpg',{type:'image/jpeg'}));file.files=dt.files;st.textContent='Photo ready ✓';},'image/jpeg',0.85);};img.onerror=function(){st.textContent='';URL.revokeObjectURL(url);};img.src=url;});
f.addEventListener('submit',function(e){var bad=null;[].slice.call(f.querySelectorAll('[required]')).forEach(function(i){if(bad)return;var s=i.closest('[data-section]');if(s&&s.hidden)return;if(i.type==='radio'||i.type==='checkbox'){if(i.type==='radio'&&!f.querySelector('input[name='+i.name+']:checked'))bad=i;if(i.type==='checkbox'&&!i.checked)bad=i;}else if(!i.value)bad=i;});
if(picked().indexOf('rentals')>=0&&!f.querySelector('input[name=games]:checked'))bad=bad||f.querySelector('input[name=games]');if(bad){e.preventDefault();var q=bad.closest('.rq-q');if(q){q.classList.add('rq-bad');q.scrollIntoView({block:'center'});}try{bad.focus({preventScroll:true});}catch(x){}return;}
var b=f.querySelector('.rq-submit');if(b){b.disabled=true;b.textContent='Sending…';}});
var es=document.getElementById('rq-errors');if(es)es.focus();lens();sync();})();`;
