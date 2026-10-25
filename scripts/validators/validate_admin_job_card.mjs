#!/usr/bin/env node
/**
 * The /admin job card redo (owner-approved mock-up "P&P Job Card Redo", 25 Oct 2026), for every
 * card type (party & decor, porch, grazing, rentals). Pure rules, then the real router over a fresh
 * local database (fake customers only). Fails when:
 *  1. step 1 lacks the big "📋 Open the walk-through checklist" (decor jobs, to
 *     /admin/checklist/online?r=) or "💬 Text <name> the questions (N still to ask)";
 *  2. "Still to ask" or the pre-made text asks a question the request already answered, skips one
 *     it did not, or numbers them other than 1, 2, 3 ... in the owner's order (10 for party & decor);
 *  3. the sms: body is not URL-encoded (raw spaces, new lines, "&", "#", "?" or emoji in the href),
 *     or does not decode back to the exact text in Valerie's wording;
 *  4. "What they told us" shows an empty answer, or misses one that exists;
 *  5. "Schedule setup / install / pickup" (card.sched*) appears on any card, any stage, any service;
 *  6. the bottom row does not hold both "📄 Invoice draft: $X · Check and send" and
 *     "✕ Cancel this job" (still two taps);
 *  7. "After the call: are you taking this job?" is not inline (Yes, book it / Not yet / No), or
 *     Yes, book it does not save the ready-by time, turn the calendar chip solid, and keep held
 *     games held;
 *  8. the header lacks "Asked <day>, <time> · <age>" in Memphis time (minutes, hours, then days)
 *     on every card, or More loses it.
 * Rule 0: fewer than 120 checks is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const T = await mod('functions/_lib/card-told.mjs');
const V = await mod('functions/_lib/views.mjs');
const K = await mod('functions/_lib/cards.mjs');
const HT = await mod('functions/_lib/helptext.mjs');

// ---- 1. pure: questions only for missing answers --------------------------------------------
const base = { key: 'site|jc', name: 'Tia Testcase', phone: '901-555-0199', rentals: [], decor: [], other: [], sortTime: Date.UTC(2026, 9, 25, 12, 6) };
const partyAll = { ...base, services: ['party'], wantsDecor: true, takedownPlan: 'customer_handles', decor: [
  { label: "What's the event type?", value: 'Birthday' }, { label: 'Where is it?', value: 'Hotel room' }, { label: 'How many guests?', value: 'Just the two of us' },
  { label: 'Add a grazing table?', value: 'No' }, { label: 'Budget', value: '$300–$500' }, { label: 'Event date', value: '2026-11-02' },
  { label: 'Location (hotel name, address or neighborhood)', value: 'Testville Inn, Room 0' }],
  other: [{ label: 'Anything else? Colors, theme, surprise details', value: 'Purple and blue balloons, rose petals, champagne. Inspiration photos on Pinterest.' }] };
const partyBk = [{ kind: 'party_setup', date: '2026-11-02', time: '17:00' }];
must(T.stillToAsk(partyAll, ['party'], partyBk).length === 0, `a party request that answered all 10 still asks: ${T.stillToAsk(partyAll, ['party'], partyBk).map((q) => q.key)}`);
must(T.allQuestions(partyAll, ['party'], partyBk).length === 10, 'party & decor does not have exactly 10 questions');
const ORDER = ['occasion', 'where', 'when', 'guests', 'decor', 'photos', 'colors', 'addons', 'takedown', 'budget'];
must(T.allQuestions(partyAll, ['party']).map((q) => q.key).join() === ORDER.join(), `party questions are not in the owner's order (${T.allQuestions(partyAll, ['party']).map((q) => q.key)})`);
// The mock-up's Tiffany: date, hotel, occasion, guests, colors and budget given; ready time, photos, add-ons missing.
const tiff = { ...partyAll, other: [{ label: 'Anything else? Colors, theme, surprise details', value: 'Purple and blue, number 28 balloons' }] };
const tAsk = T.stillToAsk(tiff, ['party'], []);
must(tAsk.map((q) => q.key).join() === 'when,photos,addons', `the mock-up's request does not ask exactly ready time, photos, add-ons (${tAsk.map((q) => q.key)})`);
must(tAsk[0].question === 'What time do you need it completed on Mon 2 Nov?', `the ready-time question does not name the day (${tAsk[0].question})`);
// Each single answer removed brings back exactly its own question (every one of the ten).
const drop = {
  occasion: (r) => ({ ...r, decor: r.decor.filter((x) => !/event type/.test(x.label)) }),
  where: (r) => ({ ...r, decor: r.decor.filter((x) => !/^Location/.test(x.label)) }),
  when: (r) => r, guests: (r) => ({ ...r, decor: r.decor.filter((x) => !/guests/.test(x.label)) }),
  decor: (r) => ({ ...r, other: [{ ...r.other[0], value: 'Purple and blue. champagne. photos on Pinterest.' }] }),
  photos: (r) => ({ ...r, other: [{ ...r.other[0], value: 'Purple and blue balloons, rose petals, champagne.' }] }),
  colors: (r) => ({ ...r, other: [{ ...r.other[0], value: 'Balloons, rose petals, champagne. Photos on Pinterest.' }] }),
  addons: (r) => ({ ...r, other: [{ ...r.other[0], value: 'Purple balloons, rose petals. Photos on Pinterest.' }] }),
  takedown: (r) => ({ ...r, takedownPlan: '' }),
  budget: (r) => ({ ...r, decor: r.decor.map((x) => (x.label === 'Budget' ? { ...x, value: 'Not sure yet' } : x)) }),
};
for (const [k, f] of Object.entries(drop)) {
  const got = T.stillToAsk(f(partyAll), ['party'], k === 'when' ? [] : partyBk).map((q) => q.key).join();
  must(got === k, `removing the "${k}" answer asks [${got}] (want exactly ${k})`);
}
// Porch, grazing, rentals: their own sets, only the missing ones.
const porchNone = { ...base, services: ['porch'], wantsDecor: true };
const porchQ = T.stillToAsk(porchNone, ['porch']).map((q) => q.key);
must(porchQ.includes('p_size') && porchQ.includes('p_decor') && !porchQ.includes('guests') && !porchQ.includes('budget') && porchQ[0] === 'p_occasion', `porch questions are not their own set (${porchQ})`);
const porchSome = { ...porchNone, porchSeason: 'Fall / Halloween', porchDecor: 'A full porch', decor: [{ label: 'Event date', value: '2026-11-02' }, { label: 'Location (hotel name, address or neighborhood)', value: 'Testtown' }] };
const pq = T.stillToAsk(porchSome, ['porch']).map((q) => q.key);
must(!pq.includes('p_occasion') && !pq.includes('p_decor') && !pq.includes('p_where') && pq.includes('p_when') && pq.includes('p_size'), `porch asks answered questions or skips missing ones (${pq})`);
const rentNone = { ...base, services: ['rentals'], wantsRentals: true };
const rq = T.stillToAsk(rentNone, ['rentals']).map((q) => q.key);
must(rq.join() === 'r_games,r_date,r_occasion,r_length,r_pickup,r_return', `rental questions are not games, date, occasion, length, pickup time, return (${rq})`);
const rentSome = { ...rentNone, gamesAnswer: 'Giant Jenga', rentals: [{ label: 'Which games?', value: 'Giant Jenga' }, { label: 'What date is your event?', value: '2026-11-07' }, { label: 'How long?', value: 'One day' }] };
const rq2 = T.stillToAsk(rentSome, ['rentals'], [{ kind: 'rental_pickup', date: '2026-11-07', time: null }]);
must(rq2.map((q) => q.key).join() === 'r_occasion,r_pickup,r_return' && rq2[1].question === 'What time will you pick up on Sat 7 Nov?', `rentals ask answered questions or miss the pickup day (${rq2.map((q) => q.question)})`);
const grazNone = { ...base, services: ['grazing'], wantsDecor: true };
const gq = T.stillToAsk(grazNone, ['grazing']).map((q) => q.key);
must(gq.includes('g_food') && gq.includes('g_diet') && !gq.includes('takedown'), `grazing questions are not their own set (${gq})`);

// ---- 2. pure: the text, numbered, in Valerie's words; the sms: encoding -----------------------
const text = T.questionsText(tiff, ['party'], tAsk);
const WANT = "Hi Tia! 💕 I'd love to help you create a beautiful hotel room setup for your birthday!\nTo put together your quote, a few quick questions:\n1. What time do you need it completed on Mon 2 Nov?\n2. Do you have any inspiration photos you can send?\n3. Would you like any add-ons, like champagne, chocolates, gifts or a grazing table?\nOnce I have those, I'll put together some options and pricing for you! 💕\n— Valerie, Porch & Party";
must(text === WANT, `the pre-made text is not the owner's wording:\n${text}`);
const nums = [...text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
must(nums.join() === '1,2,3', `the questions are not numbered 1, 2, 3 (${nums})`);
must(/^Hi Tia! 💕 I'd love to help you create a beautiful porch!/.test(T.questionsText({ ...porchNone, name: 'Tia T' }, ['porch'])), 'the porch text does not say "a beautiful porch"');
must(/a beautiful party for your anniversary!/.test(T.questionsText({ ...partyAll, decor: [{ label: "What's the event type?", value: 'Anniversary' }, { label: 'Where is it?', value: 'Home' }] }, ['party'])), 'a home party does not say "a beautiful party for your anniversary"');
must(/one quick question:\n1\. [^\n]+\nOnce I have that,/.test(T.questionsText(tiff, ['party'], tAsk.slice(0, 1))), 'one question does not read "one quick question" / "Once I have that"');
const tricky = { ...tiff, name: 'Zoë & Co #1?' };
const href = T.questionsSms('(901) 555-0199', T.questionsText(tricky, ['party'], tAsk));
must(/^sms:9015550199\?&body=[A-Za-z0-9%\-_.!~*'()]+$/.test(href), `the sms: href is not digits + ?&body= + URL-encoded text (${href.slice(0, 120)})`);
must(!/[\s#\n💕]/.test(href) && (href.match(/&/g) || []).length === 1 && (href.match(/\?/g) || []).length === 1, 'the sms: href carries a raw space, new line, "#", emoji, extra "&" or "?"');
must(decodeURIComponent(href.split('&body=')[1]) === T.questionsText(tricky, ['party'], tAsk), 'the sms: body does not decode back to the exact text');
must(T.questionsSms('', 'x') === '' && T.questionsSms('55', 'x') === '', 'a missing phone still makes an sms: link');

// ---- 3. pure: "What they told us" ------------------------------------------------------------
const told = T.toldFacts(partyAll, ['party'], partyBk);
const tk = told.map((f) => f.key).join();
must(tk === 'event,where,ready,guests,budget,notes,grazing,takedown', `party told facts are not event, where, ready by, guests, budget, colors & notes, grazing, takedown (${tk})`);
must(told.find((f) => f.key === 'where').value === 'Hotel room, Testville Inn, Room 0' && told.find((f) => f.key === 'ready').value === '5:00 PM' && told.find((f) => f.key === 'takedown').value === "They'll handle it", 'told facts do not read the answers in words');
const sparse = T.toldFacts({ ...base, services: ['party'], decor: [{ label: 'Budget', value: '' }, { label: 'How many guests?', value: 'Not sure yet' }, { label: 'Event date', value: '2026-11-02' }] }, ['party']);
must(sparse.map((f) => f.key).join() === 'event' && sparse.every((f) => f.value), `an empty or "Not sure yet" answer shows in What they told us (${sparse.map((f) => `${f.key}=${f.value}`)})`);
must(T.toldFacts(rentSome, ['rentals']).map((f) => f.key).join() === 'event,games', 'a rental card does not read Event + Games only');

// ---- 4. pure: "Asked <day>, <time> · <age>" ---------------------------------------------------
// sortTime is Memphis wall-clock time stored as UTC; 25 Oct 2026 12:06 PM Memphis = 17:06 UTC (CDT).
const sent = { sortTime: Date.UTC(2026, 9, 25, 12, 6) };
const at = (h, m = 0) => Date.UTC(2026, 9, 25, 17 + h, 6 + m);
const AGES = [[at(0, 0), 'just now'], [at(0, 1), '1 minute ago'], [at(0, 59), '59 minutes ago'], [at(1), '1 hour ago'], [at(2), '2 hours ago'], [at(23, 59), '23 hours ago'], [at(24), '1 day ago'], [at(24 * 5), '5 days ago']];
for (const [now, want] of AGES) must(T.askedWords(sent, now) === `Asked Sun 25 Oct, 12:06 PM · ${want}`, `askedWords at +${(now - at(0)) / 60000} min is "${T.askedWords(sent, now)}" (want "… · ${want}")`);
// CST (after 1 Nov 2026): 6:00 PM Memphis on 3 Dec = 00:00 UTC on 4 Dec.
must(T.askedWords({ sortTime: Date.UTC(2026, 11, 3, 18, 0) }, Date.UTC(2026, 11, 4, 3, 0)) === 'Asked Thu 3 Dec, 6:00 PM · 3 hours ago', `askedWords is not Memphis time in CST (${T.askedWords({ sortTime: Date.UTC(2026, 11, 3, 18, 0) }, Date.UTC(2026, 11, 4, 3, 0))})`);
const hc = V.requestCard({ ...tiff, services: ['party'] }, { st: { status: 'new' }, today: '2026-10-25', nowMs: at(2) });
must(/<p class="scwhen" data-when>[^<]*<\/p>\s*<p class="scasked" data-asked-head>Asked Sun 25 Oct, 12:06 PM · 2 hours ago<\/p>/.test(hc), 'the header does not read "Asked Sun 25 Oct, 12:06 PM · 2 hours ago" right under the event line');
must(/data-details[\s\S]*data-asked>Asked Sun 25 Oct, 12:06 PM/.test(hc), 'More lost the asked line');

// ---- 5. no "Schedule setup / install / pickup" anywhere ----------------------------------------
for (const k of ['card.schedInstall', 'card.schedSetup', 'card.schedPickup']) must(!HT.HELP[k], `helptext still has ${k}`);
const SETS = [['party'], ['porch'], ['grazing'], ['rentals'], ['porch', 'rentals'], ['party', 'grazing']];
const firstKind = { porch: 'porch_install', party: 'party_setup', grazing: 'grazing_setup', rentals: 'rental_pickup' };
const STATES = [['new', { status: 'new' }, false], ['invoiced', { status: 'invoiced' }, false], ['deposit', { status: 'deposit_paid' }, false], ['deposit+booked', { status: 'deposit_paid' }, true], ['scheduled', { status: 'scheduled' }, true]];
for (const services of SETS) {
  const r = { ...base, key: `site|m-${services.join('-')}`, services, wantsDecor: services.some((k) => k !== 'rentals'), wantsRentals: services.includes('rentals'), gamesAnswer: services.includes('rentals') ? 'Giant Jenga' : '',
    decor: [{ label: 'Event date', value: '2026-11-02' }], rentals: services.includes('rentals') ? [{ label: 'Which games?', value: 'Giant Jenga' }, { label: 'Pickup date', value: '2026-11-02' }, { label: 'Return date', value: '2026-11-03' }] : [] };
  for (const [name, st, booked] of STATES) {
    const bookings = booked ? services.map((k, i) => ({ id: 40 + i, kind: firstKind[k], date: '2026-11-02' })).concat(services.includes('rentals') ? [{ id: 49, kind: 'rental_return', date: '2026-11-03' }] : []) : [];
    const rules = K.cardButtons({ services, stage: name.startsWith('deposit') ? 'deposit_paid' : (name === 'invoiced' ? 'invoiced' : (name === 'scheduled' ? 'scheduled' : 'new')), kinds: bookings.map((b) => b.kind), sched: booked });
    must(![rules.primary, ...rules.secondary, ...rules.more].some((k) => /card\.sched/.test(k)), `${services}/${name}: the rules table still hands out a Schedule button (${[rules.primary, ...rules.secondary, ...rules.more]})`);
    const c = V.requestCard(r, { st, bookings, kinds: bookings.map((b) => b.kind), sched: booked ? { date: '2026-11-02' } : null, today: '2026-10-25' });
    must(!/Schedule (setup|install|pickup)|card\.sched|\/admin\/calendar\/new\?r=/i.test(c), `${services}/${name}: the card still has a "Schedule …" button or a calendar/new link`);
    const cur = (c.match(/data-current-step="([^"]+)"/) || [])[1];
    if (!booked && (cur === 'setup' || cur === 'picked')) must(/<div class="talkbox" data-talk-box><form method="post" action="\/admin\/requests\/talked" data-talk-yes>[\s\S]*name="time"[\s\S]*>Yes, book it<\/button>/.test(c), `${services}/${name}: a not-booked ${cur} step is not the inline Yes, book it with a ready-by time`);
    if (booked && name === 'scheduled') must(/data-details[\s\S]*data-change-day[^>]*href|data-details[\s\S]*href="\/admin\/calendar\/bookings\/4\d\/edit" data-change-day/.test(c), `${services}/${name}: a booked card has no "change" path for the day inside More`);
  }
}

// ---- 6-8. the real router, every card type at step 1 --------------------------------------------
const s = await session();
const today = (await mod('functions/_lib/reminders.mjs')).chicagoDate();
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const cardOf = (html, key) => { const i = html.indexOf(`id="c-${s.rk(key)}"`); return i < 0 ? '' : html.slice(html.lastIndexOf('<article', i), html.indexOf('</article>', i)); };
const card = async (key) => cardOf((await s.get('/admin/')).text, key);
const REQ = {
  party: { service: 'party', party_event: 'Birthday', party_where: 'Hotel room', party_guests: 'Just the two of us', party_budget: '$300–$500', party_takedown: 'no', event_date: plus(12), location: 'Testville Inn', notes: 'Purple and blue please', name: 'Jo Cardtest', phone: '901-555-0401', email: 'jo.cardtest@example.com' },
  porch: { service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', event_date: plus(13), location: 'Testtown', name: 'Po Cardtest', phone: '901-555-0402', email: 'po.cardtest@example.com' },
  grazing: { service: 'grazing', grazing_event: 'Birthday', grazing_guests: '15–40', grazing_food: 'Yes, include food in my quote', event_date: plus(14), location: 'Testburg', name: 'Gi Cardtest', phone: '901-555-0403', email: 'gi.cardtest@example.com' },
  rentals: { service: 'rentals', games: ['giant-uno'], duration: 'day', rental_date: plus(15), pickup_when: 'morning', return_when: 'after', name: 'Ru Cardtest', phone: '901-555-0404', email: 'ru.cardtest@example.com' },
};
const made = {};
for (const [svc, f] of Object.entries(REQ)) {
  const r = await s.siteRequest(f);
  must(r.status === 303 && r.row, `${svc}: the request was refused (${r.text.slice(0, 120)})`);
  if (r.row) made[svc] = r.row;
}
const reqs = await (await mod('functions/_lib/requests.mjs')).loadRequests(s.env);
for (const [svc, row] of Object.entries(made)) {
  const c = await card(row.request_key);
  const rk = s.rk(row.request_key);
  const first = REQ[svc].name.split(' ')[0];
  const decor = svc !== 'rentals';
  const nb = (c.match(/<section class="nextbox" data-next-step="called">[\s\S]*?<\/section>/) || [''])[0];
  must(Boolean(nb), `${svc}: no step-1 next-step box`);
  // 1. the checklist button (decor) and the questions text.
  must(decor ? new RegExp(`<a class="btn primary" href="/admin/checklist/online\\?r=${rk}" data-step1-checklist data-help="card\\.checklist"[^>]*>📋 Open the walk-through checklist</a>`).test(nb) : !/checklist/i.test(nb), `${svc}: step 1 ${decor ? 'lacks the big checklist button to /admin/checklist/online?r=' : 'shows a checklist on a rental'}`);
  must(!/What they booked/.test(c) || c.indexOf('data-step1-checklist') < c.indexOf('data-details'), `${svc}: the checklist is still only under More`);
  const req = reqs.find((x) => x.key === row.request_key);
  const services = K.servicesOf(req);
  const bk = await s.all('SELECT * FROM bookings WHERE request_key = ?1', row.request_key);
  const ask = T.stillToAsk(req, services, bk);
  const m = nb.match(/<a class="btn (?:ghost big|primary)" href="([^"]+)" data-questions-text data-ask-count="(\d+)"[^>]*>💬 Text ([^ ]+) the questions \((\d+) still to ask\)<\/a>/);
  must(m && Number(m[2]) === ask.length && Number(m[4]) === ask.length && m[3] === first && ask.length > 0, `${svc}: step 1 lacks "💬 Text ${first} the questions (${ask.length} still to ask)" (${m ? m[0].slice(-80) : 'none'})`);
  if (m) {
    const body = decodeURIComponent(m[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').split('&body=')[1] || '');
    must(body === T.questionsText(req, services, ask, bk), `${svc}: the sms body is not the pre-made text`);
    const qs = [...body.matchAll(/^(\d+)\. (.+)$/gm)];
    must(qs.map((q) => Number(q[1])).join() === ask.map((_, i) => i + 1).join() && qs.map((q) => q[2]).join('|') === ask.map((q) => q.question).join('|'), `${svc}: the text is not the missing questions numbered 1..${ask.length}`);
    must(body.endsWith('— Valerie, Porch & Party') && body.startsWith(`Hi ${first}! 💕`), `${svc}: the text does not open "Hi ${first}! 💕" and sign "— Valerie, Porch & Party"`);
  }
  // 3. chips = the same missing list; 4. told = answers that exist.
  const chips = [...c.matchAll(/<span class="askchip" data-ask="([a-z_]+)">/g)].map((x) => x[1]);
  must(chips.join() === ask.map((q) => q.key).join(), `${svc}: Still to ask chips (${chips}) are not the missing questions (${ask.map((q) => q.key)})`);
  const toldHtml = (c.match(/<section class="told" data-told>[\s\S]*?<\/section>/) || [''])[0];
  must(Boolean(toldHtml) && !/<dd[^>]*>\s*<\/dd>/.test(toldHtml) && c.indexOf('data-told') < c.indexOf('data-details'), `${svc}: What they told us is missing, under More, or shows an empty answer`);
  if (svc === 'party') {
    must(/data-told-item="guests">Just the two of us</.test(toldHtml) && /data-told-item="budget">\$300–\$500</.test(toldHtml) && /data-told-item="notes">Purple and blue please</.test(toldHtml) && /data-told-item="where">Hotel room, Testville Inn</.test(toldHtml), 'party: What they told us does not show guests, budget, colors, where');
    must(!ask.some((q) => ['occasion', 'where', 'guests', 'budget', 'colors', 'takedown'].includes(q.key)) && ask.some((q) => q.key === 'when') && ask.some((q) => q.key === 'photos'), `party: the questions ask what the form answered (${ask.map((q) => q.key)})`);
    must(/hotel room setup for your birthday!/.test(T.questionsText(req, services, ask, bk)), 'party: the text does not say "a beautiful hotel room setup for your birthday"');
  }
  // 5. no Schedule buttons; 7. After the call, inline.
  must(!/Schedule (setup|install|pickup)|card\.sched/i.test(c), `${svc}: a Schedule button is on the card`);
  const ac = (c.match(/<section class="aftercall" data-after-call data-talk>[\s\S]*?<\/section>/) || [''])[0];
  must(/After the call: are you taking this job\?/.test(ac) && /name="time"/.test(ac) && />Yes, book it<\/button>/.test(ac) && /value="later"[\s\S]*>Not yet</.test(ac) && /value="no"[\s\S]*>No, put it away</.test(ac) && !/<summary[^>]*>I've talked to them/.test(c), `${svc}: "After the call: are you taking this job?" is not inline with Yes, book it (time) / Not yet / No`);
  must(c.indexOf('data-told') < c.indexOf('data-after-call') && c.indexOf('data-after-call') < c.indexOf('data-details'), `${svc}: After the call is not under What they told us, above More`);
  must(new RegExp(`data-book-day>${decor ? (svc === 'porch' ? 'Install' : 'Setup') + ' day: <b>' : 'Pick up <b>'}[A-Z][a-z]{2} \\d{1,2} [A-Z][a-z]{2}</b>`).test(ac) && /<details class="bkchg" data-book-change><summary[^>]*>change<\/summary>/.test(ac), `${svc}: Yes, book it does not show the day from the request with a "change" link`);
  // 6. the bottom row: draft + Cancel on one line, Cancel still two taps.
  const foot = c.slice(c.indexOf('data-card-foot'));
  must(c.indexOf('data-card-foot') > c.lastIndexOf('</details>', c.indexOf('data-card-foot')) && /<p class="footinv" data-draft-ready><b data-draft-what>📄 Invoice draft: \$[\d,]+\.\d\d<\/b> <a class="btn ghost" href="\/admin\/invoices\/\d+\/edit" data-help="card\.checkDraft"[^>]*>Check and send<\/a><\/p><div class="cxrow" data-cancel-row="cancel"><details class="confirm cxconfirm" data-cancel-job><summary class="cxbtn" data-help="card\.cancelJob"[^>]*>✕ Cancel this job<\/summary>/.test(foot), `${svc}: the bottom row does not hold "📄 Invoice draft: $X · Check and send" and "✕ Cancel this job" together`);
  must(/action="\/admin\/requests\/cancel"[\s\S]*Yes, cancel/.test(foot), `${svc}: Cancel no longer confirms before it cancels`);
  // 8. header asked line; More has one "More about <name>" with + Add a note inside.
  must(/<p class="scasked" data-asked-head>Asked [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2} [AP]M · (just now|\d+ minutes? ago)<\/p>/.test(c), `${svc}: the header lacks "Asked <day>, <time> · <age>" (${(c.match(/data-asked-head>[^<]*/) || [''])[0]})`);
  must((c.match(/data-more-show>More about /g) || []).length === 1 && /data-more-group="history"[\s\S]*data-add-note/.test(c) && !/data-add-note/.test(c.slice(0, c.indexOf('data-details'))), `${svc}: not ONE "More about ${first}" with + Add a note inside`);
  must(/data-step-count data-step="called" data-step-current>Step 1 of \d: call back</.test(c), `${svc}: the step bar is not "Step 1 of N: call back"`);
}
// 7. Yes, book it: the ready-by time is saved, the chip turns solid, held games stay held.
{
  const key = made.party.request_key;
  const r = await s.post('/admin/requests/talked', { r: s.rk(key), go: 'yes', date: REQ.party.event_date, time: '17:30' });
  must(r.status === 303, `party: Yes, book it answered ${r.status}`);
  const b = await s.one("SELECT date, time FROM bookings WHERE request_key = ?1 AND kind = 'party_setup'", key);
  must(b && b.date === REQ.party.event_date && b.time === '17:30', `party: Yes, book it did not save the setup day + ready-by time (${JSON.stringify(b)})`);
  const c = await card(key);
  must(/data-confirmed="1"/.test(c) && !/data-after-call/.test(c), 'party: after Yes, book it the card is not confirmed, or still asks After the call');
  const cal = (await s.get(`/admin/calendar?month=${REQ.party.event_date.slice(0, 7)}`)).text;
  const i = cal.indexOf(`data-day="${REQ.party.event_date}"`);
  const cell = i < 0 ? '' : cal.slice(i, cal.indexOf('</a>', i));
  must(/Jo C/.test(cell) && !/class="k [^"]*req[^"]*"[^>]*>[^<]*Jo C/.test(cell), `party: the calendar chip is not solid after Yes, book it (${cell.slice(0, 200)})`);
  must(/data-told-item="ready">5:30 PM</.test(c), 'party: What they told us does not show the ready-by time once booked');
  const bad = await s.post('/admin/requests/talked', { r: s.rk(key), go: 'yes', date: REQ.party.event_date, time: '25:99' });
  const b2 = await s.one("SELECT time FROM bookings WHERE request_key = ?1 AND kind = 'party_setup'", key);
  must(bad.status === 303 && b2.time === '17:30', `party: a bad time ("25:99") overwrote the ready-by time (${b2 && b2.time})`);
}
{
  const key = made.rentals.request_key;
  const h0 = await s.one('SELECT state FROM holds WHERE request_key = ?1', key);
  must(h0 && h0.state === 'held', `Rule 0: the rental request is not held (${JSON.stringify(h0)})`);
  const pick = await s.one("SELECT date FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", key);
  const ret = await s.one("SELECT date FROM bookings WHERE request_key = ?1 AND kind = 'rental_return'", key);
  await s.post('/admin/requests/talked', { r: s.rk(key), go: 'yes', date: pick.date, return_date: ret.date, time: '09:15' });
  const h1 = await s.one('SELECT state FROM holds WHERE request_key = ?1', key);
  const p1 = await s.one("SELECT time FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", key);
  must(h1 && h1.state === 'held', `rentals: Yes, book it released the held games (${JSON.stringify(h1)})`);
  must(p1 && p1.time === '09:15', `rentals: Yes, book it did not save the pickup time (${JSON.stringify(p1)})`);
  must(/data-confirmed="1"/.test(await card(key)), 'rentals: Yes, book it did not confirm the card');
}
// Tapping the questions text logs one history line (free sms: from her phone, nothing sent by us).
{
  const key = made.porch.request_key;
  const t = await s.post('/admin/msg/tapped', { r: s.rk(key), template: 'questions' });
  must(t.status === 200, `tapping the questions text answered ${t.status}`);
  const ev = await s.one("SELECT COUNT(*) AS n FROM request_events WHERE request_key = ?1 AND what = 'Texted: the questions still to ask'", key);
  must(ev && ev.n === 1, 'tapping the questions text did not log "Texted: the questions still to ask" once');
}
// Help: every new control is on the help page.
for (const k of ['step.textQuestions', 'step.bookTime', 'step.bookChange', 'card.changeDay', 'card.checklist', 'step.bookYes', 'card.details', 'card.checkDraft', 'card.addNote', 'step.talked']) must(HT.HELP[k] && HT.HELP[k].title, `helptext lacks ${k}`);

if (checks < 120) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) {
  console.error(`job card: FAIL (${errors.length} of ${checks})`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`job card: OK (${checks} checks: step-1 checklist + questions text for party / porch / grazing / rentals, only missing questions numbered in order, sms body URL-encoded and exact, What they told us without blanks, no Schedule buttons on any card, invoice draft + Cancel on the bottom row, Yes, book it saves the ready-by time / solid chip / games stay held, "Asked … · age" in Memphis time)`);
