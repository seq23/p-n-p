#!/usr/bin/env node
/**
 * Step cards on Requests (owner-approved 19 Oct 2026, the "one step at a time" mock-up), the
 * tentative -> confirmed calendar, and the invoice quick-adds. Pure rules, then the real router
 * over a fresh local database. Fails when:
 *  1. a service x state derives the wrong steps, current step, "N of M" or labels (rentals,
 *     party & decor, porch, grazing; decor + games), or the day of the job does not come first;
 *  2. doing a thing elsewhere (invoice texted, deposit / paid on the invoice, Job done, takedown
 *     done, Mark picked up, Mark returned, deposit refunded) does not tick its step by itself;
 *  3. an undo can delete or void money or an invoice, or "Called back" undo removes a booking;
 *  4. a new request's day is not an OUTLINED "Requested · not confirmed" chip (and on
 *     Unconfirmed requests, with its asked-for day) for every service, or "Yes, book it" does not
 *     make it a solid service-coloured booking off the list (Not yet keeps it tentative; No puts it
 *     away and frees held games); the Monday summary lacks Unconfirmed requests;
 *  5. "11/3"-style dates (no year, every format the form or a typed answer can produce) do not
 *     read as the next future occurrence, or the 2001 fallback comes back;
 *  6. a quick-add price is typed anywhere but data/offers/services.json invoiceQuickAdds;
 *  7. an extra game is not reserved for the rental's whole span (availability, calendar, Day
 *     sheet, clash check), a booked game can be picked, or a complimentary game is not a $0 line
 *     with the "Complimentary Nth game: <game>" note; removing the line frees it.
 * Rule 0: fewer than 120 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const ST = await mod('functions/_lib/steps.mjs');
const P = await mod('functions/_lib/progress.mjs');
const C = await mod('functions/_lib/calendar.mjs');
const RQ = await mod('functions/_lib/requested.mjs');
const K = await mod('functions/_lib/cards.mjs');
const TD = await mod('functions/_lib/takedown.mjs');
const EG = await mod('functions/_lib/extra-games.mjs');
const F = await mod('functions/_lib/request-form.mjs');
const W = await mod('functions/_lib/weekly.mjs');
const TODO = await mod('functions/_lib/todo-email.mjs');

// ---- 1. Step derivation, service x state ------------------------------------------------
const T = '2026-10-24';
const bal = (paid, { charges = 11000, refundable = 0 } = {}) => ({ total: charges + refundable, charges, refundable, paid, owed: Math.max(0, charges - paid), depositOwed: Math.max(0, refundable - Math.max(0, paid - charges)), remaining: Math.max(0, charges + refundable - paid), void: false });
const invOf = (status, paid, o = {}) => ({ id: 1, status, total_cents: 11000 + (o.refundable || 0), deposit_due_cents: 5000, balance: bal(paid, o) });
function derive(services, { st = { status: 'new' }, inv = null, bookings = [], ret = null, stored = null, r = {}, depositOut = null, today = T, plan = '' } = {}) {
  const rq = { key: 'k', source: 'site', takedownPlan: plan, ...r };
  const tdS = TD.takedownState({ services, takedownPlan: plan, bookings, today });
  const rental = services.length === 1 && services[0] === 'rentals';
  const pr = P.deriveProgress({ st, inv, scheduled: bookings.length > 0, ret, rental, takedown: tdS });
  return { s: ST.deriveSteps({ r: rq, services, pr, inv, st, bookings, ret, tdS, stored, depositOut, today }), tdS };
}
const keys = (s) => s.steps.map((x) => x.key).join(',');
const doneKeys = (s) => s.steps.filter((x) => x.done).map((x) => x.key).join(',');
must(keys(derive(['rentals']).s) === 'called,invoiced,deposit,picked,returned,deposit_back', `rental steps are ${keys(derive(['rentals']).s)}`);
must(keys(derive(['party']).s) === 'called,invoiced,deposit,setup,takedown,paid', `party steps are ${keys(derive(['party']).s)}`);
must(keys(derive(['porch']).s) === 'called,invoiced,deposit,setup,takedown,paid', `porch steps are ${keys(derive(['porch']).s)}`);
must(keys(derive(['grazing']).s) === 'called,invoiced,deposit,setup,pickup,paid', `grazing steps are ${keys(derive(['grazing']).s)}`);
must(keys(derive(['party', 'rentals']).s) === 'called,invoiced,deposit,setup,takedown,picked,returned,paid,deposit_back', `decor + games steps are ${keys(derive(['party', 'rentals']).s)}`);
must(derive(['porch']).s.steps.find((x) => x.key === 'setup').label === 'Install done' && derive(['party']).s.steps.find((x) => x.key === 'setup').label === 'Setup done', 'porch is not "Install done" / party not "Setup done"');
must(derive(['grazing']).s.steps.find((x) => x.key === 'pickup').label === 'Pickup done (optional)', 'grazing pickup is not marked optional');
const pickBk = (o = {}) => [{ id: 5, kind: 'rental_pickup', date: '2026-10-30', time: null, ...o }, { id: 6, kind: 'rental_return', date: '2026-11-01', time: null }];
const R_CASES = [
  // [label, opts, current, done, N]
  ['new', {}, 'called', '', 0],
  ['called (Not yet)', { stored: { called_at: 'x' } }, 'invoiced', 'called', 1],
  ['draft invoice (website rental)', { inv: invOf('draft', 0), bookings: pickBk() }, 'called', '', 0],
  ['invoice sent', { inv: invOf('sent', 0), st: { status: 'invoiced' }, bookings: pickBk() }, 'deposit', 'called,invoiced', 2],
  ['deposit in', { inv: invOf('deposit_paid', 5000), st: { status: 'deposit_paid' }, bookings: pickBk() }, 'picked', 'called,invoiced,deposit', 3],
  ['picked up, paid', { inv: invOf('paid', 11000), st: { status: 'paid' }, bookings: pickBk({ done_at: 'x' }) }, 'returned', 'called,invoiced,deposit,picked', 4],
  ['returned, no deposit line', { inv: invOf('paid', 11000), st: { status: 'paid' }, bookings: pickBk({ done_at: 'x' }), ret: { returned_at: 'x' } }, 'finished', 'called,invoiced,deposit,picked,returned,deposit_back', 6],
  ['returned, deposit held', { inv: invOf('paid', 16000, { refundable: 5000 }), st: { status: 'paid' }, bookings: pickBk({ done_at: 'x' }), ret: { returned_at: 'x' } }, 'deposit_back', 'called,invoiced,deposit,picked,returned', 5],
  ['deposit refunded', { inv: invOf('paid', 16000, { refundable: 5000 }), st: { status: 'paid' }, bookings: pickBk({ done_at: 'x' }), ret: { returned_at: 'x' }, depositOut: { refunded: 5000, kept: 0 } }, 'finished', 'called,invoiced,deposit,picked,returned,deposit_back', 6],
  ['deposit kept for damage', { inv: invOf('paid', 16000, { refundable: 5000 }), st: { status: 'paid' }, bookings: pickBk({ done_at: 'x' }), ret: { returned_at: 'x', damaged: 1 }, depositOut: { refunded: 2000, kept: 3000 } }, 'finished', 'called,invoiced,deposit,picked,returned,deposit_back', 6],
  ['picked up, rest not paid', { inv: invOf('deposit_paid', 5000), st: { status: 'deposit_paid' }, bookings: pickBk({ done_at: 'x' }) }, 'returned', 'called,invoiced,deposit,picked', 4],
  ['pickup day, invoice not sent', { inv: invOf('draft', 0), bookings: pickBk({ date: T }) }, 'picked', '', 0],
  ['phone booking', { r: { source: 'phone' }, bookings: pickBk() }, 'invoiced', 'called', 1],
];
for (const [label, o, cur, done, n] of R_CASES) {
  const { s } = derive(['rentals'], o);
  must(s.current === cur && doneKeys(s) === done && s.doneCount === n, `rentals / ${label}: current ${s.current}, done [${doneKeys(s)}] (${s.doneCount}), want ${cur} [${done}] (${n})`);
}
{
  const { s } = derive(['rentals'], R_CASES[10][1]);
  must(keys(s) === 'called,invoiced,deposit,picked,returned,paid,deposit_back' && s.total === 7, `a rental picked up without the rest paid does not add "Paid in full" before it can finish (${keys(s)})`);
  must(!derive(['rentals'], R_CASES[10][1]).s.finished, 'a rental with money still owed finished');
}
const decorBk = (kind, o = {}) => [{ id: 7, kind, date: '2026-10-30', time: null, ...o }];
const D_CASES = [
  ['party', 'new', {}, 'called', ''],
  ['party', 'invoice sent', { inv: invOf('sent', 0), st: { status: 'invoiced' } }, 'deposit', 'called,invoiced'],
  ['party', 'deposit, booked', { inv: invOf('deposit_paid', 5000), st: { status: 'deposit_paid' }, bookings: decorBk('party_setup') }, 'setup', 'called,invoiced,deposit'],
  ['party', 'setup day, nothing paid', { bookings: decorBk('party_setup', { date: T }), stored: { called_at: 'x', confirmed_at: 'x' } }, 'setup', 'called'],
  ['party', 'setup done, no takedown asked', { inv: invOf('deposit_paid', 5000), st: { status: 'job_done', job_done_at: 'x' }, bookings: decorBk('party_setup') }, 'paid', 'called,invoiced,deposit,setup,takedown'],
  ['party', 'setup done, takedown asked', { inv: invOf('deposit_paid', 5000), st: { status: 'job_done', job_done_at: 'x' }, bookings: decorBk('party_setup'), plan: 'scheduled' }, 'takedown', 'called,invoiced,deposit,setup'],
  ['party', 'takedown not needed', { inv: invOf('deposit_paid', 5000), st: { status: 'job_done', job_done_at: 'x' }, bookings: decorBk('party_setup'), plan: 'customer_handles' }, 'paid', 'called,invoiced,deposit,setup,takedown'],
  ['party', 'takedown done, paid', { inv: invOf('paid', 11000), st: { status: 'paid', job_done_at: 'x' }, bookings: [...decorBk('party_setup'), { id: 8, kind: 'party_takedown', date: '2026-10-31', done_at: 'x' }], plan: 'scheduled' }, 'finished', 'called,invoiced,deposit,setup,takedown,paid'],
  ['porch', 'install done, takedown booked', { inv: invOf('paid', 11000), st: { status: 'paid', job_done_at: 'x' }, bookings: [...decorBk('porch_install'), { id: 9, kind: 'porch_takedown', date: '2026-10-31' }], plan: 'scheduled' }, 'takedown', 'called,invoiced,deposit,setup,paid'],
  ['grazing', 'setup done, pickup open', { inv: invOf('deposit_paid', 5000), st: { status: 'job_done', job_done_at: 'x' }, bookings: decorBk('grazing_setup') }, 'pickup', 'called,invoiced,deposit,setup'],
  ['grazing', 'pickup not needed', { inv: invOf('paid', 11000), st: { status: 'paid', job_done_at: 'x' }, bookings: decorBk('grazing_setup'), plan: 'customer_handles' }, 'finished', 'called,invoiced,deposit,setup,pickup,paid'],
  ['grazing', 'pickup done', { inv: invOf('paid', 11000), st: { status: 'paid', job_done_at: 'x' }, bookings: [...decorBk('grazing_setup'), { id: 10, kind: 'grazing_pickup', date: '2026-10-31', done_at: 'x' }] }, 'finished', 'called,invoiced,deposit,setup,pickup,paid'],
];
for (const [svc, label, o, cur, done] of D_CASES) {
  const { s } = derive([svc], o);
  must(s.current === cur && doneKeys(s) === done, `${svc} / ${label}: current ${s.current}, done [${doneKeys(s)}], want ${cur} [${done}]`);
  if (cur === 'finished') must(s.finished, `${svc} / ${label}: every step done but not Finished`);
}
must(derive(['party'], D_CASES[6][2]).s.steps.find((x) => x.key === 'takedown').label === 'Takedown: not needed', 'a takedown the customer handles is not "Takedown: not needed"');
must(!derive(['party']).s.steps.find((x) => x.key === 'takedown').done, 'a fresh party card opens with the takedown already ticked');
must(derive(['party'], { r: { source: 'phone' } }).s.confirmed && derive(['party'], { inv: invOf('deposit_paid', 5000), st: { status: 'deposit_paid' } }).s.confirmed && derive(['party'], { stored: { confirmed_at: 'x' } }).s.confirmed && !derive(['party'], { stored: { called_at: 'x' } }).s.confirmed && !derive(['party'], { inv: invOf('sent', 0) }).s.confirmed,
  'confirmed is not exactly: Yes, book it / phone / money in / job done');

// ---- 3. Undo safety (pure) ---------------------------------------------------------------
for (const [label, svc, o, key, kind] of [
  ['called (stored)', 'party', { stored: { called_at: 'x' } }, 'called', 'form'],
  ['called (phone)', 'party', { r: { source: 'phone' } }, 'called', 'explain'],
  ['invoice sent', 'party', { inv: invOf('sent', 0), st: { status: 'invoiced' } }, 'invoiced', 'explain'],
  ['deposit', 'party', { inv: invOf('deposit_paid', 5000), st: { status: 'deposit_paid' } }, 'deposit', 'explain'],
  ['setup', 'party', D_CASES[5][2], 'setup', 'form'],
  ['picked', 'rentals', R_CASES[10][1], 'picked', 'form'],
  ['returned', 'rentals', R_CASES[7][1], 'returned', 'returns'],
  ['deposit back', 'rentals', R_CASES[8][1], 'deposit_back', 'explain'],
  ['paid', 'party', D_CASES[7][2], 'paid', 'explain'],
]) {
  const { s, tdS } = derive([svc], o);
  const u = ST.undoFor(s, { tdS, stored: o.stored || null });
  must(u && u.key === key && u.kind === kind, `undo after ${label}: ${u ? `${u.key}/${u.kind}` : 'none'}, want ${key}/${kind}`);
  must(!u || u.kind !== 'form' || !/status|payment|invoices|void|delete/.test(u.action), `undo after ${label} posts to a money / delete route (${u && u.action})`);
}

// ---- 5. Dates without a year ---------------------------------------------------------------
for (const [txt, want] of [['11/3', '2026-11-03'], ['11-3', '2026-11-03'], ['11.3', '2026-11-03'], ['Nov 3', '2026-11-03'], ['Nov. 3', '2026-11-03'], ['November 3rd', '2026-11-03'], ['3 Nov', '2026-11-03'],
  ['Tue 3 Nov', '2026-11-03'], ['Tuesday, November 3', '2026-11-03'], ['11/3/26', '2026-11-03'], ['11/3/2026', '2026-11-03'], ['2026-11-03', '2026-11-03'], ['October 24, 2026', '2026-10-24'],
  ['10/1', '2027-10-01'], ['10/19', '2026-10-19'], ['Jan 5', '2027-01-05'], ['Feb 29', '2028-02-29'], ['2/30', ''], ['13/1', ''], ['soon', ''], ['decor 3', '']]) {
  const got = C.parseFormDate(txt, '2026-10-19');
  must(got === want, `"${txt}" reads as "${got}", want "${want}"`);
  must(!/^2001-/.test(got), `"${txt}" fell back to 2001`);
}
{
  const r = { key: 't', services: ['party'], rentals: [], decor: [{ label: 'Event date', value: '11/3' }], other: [] };
  const want = C.parseFormDate('11/3');
  must(/^\d{4}-11-03$/.test(want) && RQ.askedDate(r, 'party') === want && K.keyFacts(r, ['party']).date === want && RQ.requestedChips([r], {}, []).some((c) => c.date === want), `a request answered "11/3" has no chip / date on its next 3 Nov (${RQ.askedDate(r, 'party')})`);
}

// ---- 6. Quick-add prices: one source -------------------------------------------------------
const SERVICES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8'));
const QA = SERVICES.invoiceQuickAdds || {};
must(Number(QA.deliveryFee) === 20 && Number(QA.extraGame) === 20, `services.json invoiceQuickAdds is not { deliveryFee: 20, extraGame: 20 } (${JSON.stringify(QA)})`);
for (const f of ['functions/_lib/views.mjs', 'functions/_lib/admin.mjs', 'functions/_lib/extra-games.mjs', 'functions/_lib/admin-steps.mjs', 'functions/_lib/delivery.mjs', 'functions/_lib/helptext.mjs']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  must(!/(Delivery fee|Extra game)[^\n]{0,80}\b(20|2000|20\.00)\b/.test(src) && !/deliveryFee\s*[:=]\s*\d|extraGame\s*[:=]\s*\d/.test(src), `${f} types a quick-add price instead of reading services.json`);
}

// ---- 2, 4, 7: the real router ----------------------------------------------------------------
const s = await session();
const today = F.chicagoToday();
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const cardOf = (html, key) => { const i = html.indexOf(`id="c-${s.rk(key)}"`); return i < 0 ? '' : html.slice(html.lastIndexOf('<article', i), html.indexOf('</article>', i)); };
const card = async (key) => cardOf((await s.get('/admin/')).text, key);
const cur = (c) => (c.match(/data-current-step="([^"]+)"/) || [])[1];
const doneList = (c) => [...c.matchAll(/data-step="([a-z_]+)" data-step-done/g)].map((m) => m[1]).join(',');
const moneyRows = async () => (await s.one('SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN voided_at IS NULL THEN amount_cents END), 0) AS live FROM payments')).n;
const cellOf = (html, d) => { const i = html.indexOf(`data-day="${d}"`); return i < 0 ? '' : html.slice(i, html.indexOf('</a>', i)); };
const phoneDayOf = (html, d) => { const i = html.indexOf(`data-month-day="${d}"`); return i < 0 ? '' : html.slice(i, html.indexOf('</section>', i)); };

// 4. Every service arrives tentative.
const svcReq = {
  party: { service: 'party', party_event: 'Birthday', party_where: 'Home', event_date: plus(15), location: 'Bartlett', name: 'Pia Stepper', phone: '901-555-0301', email: 'pia.step@example.com' },
  porch: { service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', event_date: plus(16), location: 'Germantown', name: 'Poe Stepper', phone: '901-555-0302', email: 'poe.step@example.com' },
  grazing: { service: 'grazing', grazing_event: 'Birthday', grazing_guests: '15–40', grazing_food: 'Yes, include food in my quote', event_date: plus(17), location: 'Cordova', name: 'Gil Stepper', phone: '901-555-0303', email: 'gil.step@example.com' },
  rentals: { service: 'rentals', games: ['giant-uno'], duration: 'day', rental_date: plus(18), pickup_when: 'morning', return_when: 'after', name: 'Rex Stepper', phone: '901-555-0304', email: 'rex.step@example.com' },
};
const made = {};
for (const [svc, f] of Object.entries(svcReq)) {
  const r = await s.siteRequest(f);
  if (r.status !== 303) { errors.push(`${svc} request refused: ${r.text.slice(0, 200)}`); continue; }
  made[svc] = r.row;
}
for (const [svc, row] of Object.entries(made)) {
  const day = svc === 'rentals' ? (await s.one("SELECT date FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", row.request_key) || {}).date : svcReq[svc].event_date;
  const cal = (await s.get(`/admin/calendar?month=${day.slice(0, 7)}`)).text;
  const cell = cellOf(cal, day);
  const first = svcReq[svc].name.split(' ')[0];
  // Calm calendar (19 Oct 2026): the month grid reads "? Kind: Name" in a dashed outline; the
  // phone's tapped day (data-month-day) keeps the words "Requested · not confirmed" in full.
  must(new RegExp(`class="k (req [a-z_]+|[a-z_]+ req tent)"[^>]*style="border-color:#[0-9a-f]{6}"[^>]*>\\? [^<]*${first}`).test(cell), `${svc}: the new request's day is not an outlined "? ${first}" chip in the month (${cell.slice(0, 300)})`);
  must(new RegExp(`class="k (req [a-z_]+|[a-z_]+ req tent)"[^>]*style="border-color:#[0-9a-f]{6}"[^>]*>Requested · not confirmed[^<]*${first}`).test(phoneDayOf(cal, day)), `${svc}: the phone's day ${day} does not say "Requested · not confirmed" for ${first}`);
  must(new RegExp(`data-unconfirmed-row[^>]*><strong>${svcReq[svc].name}</strong>[\\s\\S]*?data-asked="${day}"`).test(cal), `${svc}: not on Unconfirmed requests with its asked-for day`);
  const c = await card(row.request_key);
  must(cur(c) === 'called' && /data-confirmed="0"/.test(c) && /<section class="aftercall" data-after-call data-talk><div class="talkbox" data-talk-box><div class="q" data-help="step\.talked"[^>]*><strong>After the call: are you taking this job\?<\/strong><\/div><form method="post" action="\/admin\/requests\/talked" data-talk-yes>/.test(c) && !/I've talked to them/.test(c) && /value="later"/.test(c) && /value="no"/.test(c), `${svc}: a new card does not ask "After the call: are you taking this job?" inline (Yes / Not yet / No), or the old "I've talked to them" dropdown is back`);
  must((c.match(/class="btn primary"/g) || []).length === 1 || (svc === 'rentals'), `${svc}: more than one big button on a new card`);
  must(/data-step-count data-step="called" data-step-current>Step 1 of \d: call back</.test(c) && !/data-step-list/.test(c) && (() => { const f = svcReq[svc].name.split(' ')[0]; return new RegExp(`<summary data-help="card\\.details"[^>]*><span class="mshow" data-more-show>More about ${f}</span><span class="mhide" data-more-hide>Hide more about ${f}</span><span class="mchev" aria-hidden="true">▾</span><small class="msub" data-more-sub>`).test(c); })(), `${svc}: no "Step 1 of M: call back" (with no chips yet) / "More about <first name>" (Hide when open) on a new card`);
}
// Not yet: called, still tentative and listed.
{
  const key = made.porch.request_key;
  await s.post('/admin/requests/talked', { r: s.rk(key), go: 'later' });
  const c = await card(key);
  must(doneList(c) === 'called' && cur(c) === 'invoiced' && /data-confirmed="0"/.test(c) && /data-book-later/.test(c), 'Not yet: not called-only, still unconfirmed, with Book it now');
  const cal = (await s.get(`/admin/calendar?month=${svcReq.porch.event_date.slice(0, 7)}`)).text;
  must(/data-unconfirmed-row[^>]*><strong>Poe Stepper/.test(cal) && />\? [^<]*Poe/.test(cellOf(cal, svcReq.porch.event_date)) && /Requested · not confirmed[^<]*Poe/.test(phoneDayOf(cal, svcReq.porch.event_date)), 'Not yet took the porch off Unconfirmed requests or made it solid');
  must(!(await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind = 'porch_install'", key)), 'Not yet booked something');
}
// Yes, book it (party): solid party_setup on the day she typed, off the list, called + confirmed.
const partyKey = made.party.request_key;
{
  const moved = plus(19);
  await s.post('/admin/requests/talked', { r: s.rk(partyKey), go: 'yes', date: moved });
  const b = await s.one("SELECT date, edited_by_hand FROM bookings WHERE request_key = ?1 AND kind = 'party_setup'", partyKey);
  must(b && b.date === moved && b.edited_by_hand === 1, `Yes, book it did not book the party setup on the day typed (${JSON.stringify(b)})`);
  const cal = (await s.get(`/admin/calendar?month=${moved.slice(0, 7)}`)).text;
  const cell = cellOf(cal, moved);
  must(/<span class="k party_setup"[^>]*>Party setup: Pia Stepper/.test(cell) && !/data-tentative[^>]*>[^<]*Pia/.test(cell), 'the booked party is not a solid party chip');
  must(!/data-unconfirmed-row[^>]*><strong>Pia Stepper/.test(cal), 'the booked party is still on Unconfirmed requests');
  must(/>Party setup: Pia/.test(cellOf(cal, moved)) && !/(?:Requested · not confirmed|>\? )[^<]*Pia/.test(cellOf(cal, svcReq.party.event_date) + phoneDayOf(cal, svcReq.party.event_date)), 'the old asked-for day still shows a tentative chip after booking another day');
  const st = await s.one('SELECT called_at, confirmed_at FROM request_steps WHERE request_key = ?1', partyKey);
  must(st && st.called_at && st.confirmed_at, 'Yes, book it did not store called + confirmed');
  const c = await card(partyKey);
  // The website request already has its auto draft (auto-draft.mjs, owner-approved 20 Oct 2026):
  // the invoice step is "📄 Invoice draft ready: $X" with ONE "Check and send the invoice", never
  // a second "Create invoice".
  const pd = await s.one("SELECT id, auto_draft FROM invoices WHERE request_key = ?1 AND status = 'draft'", partyKey);
  const pdTotal = pd ? (await s.all('SELECT qty, unit_cents FROM invoice_lines WHERE invoice_id = ?1', pd.id)).reduce((t, l) => t + Math.round(l.qty * l.unit_cents), 0) : 0;
  must(pd && pd.auto_draft === 1 && pdTotal >= s.PRICE_TABLE.celebrationFromCents && s.PRICE_TABLE.celebrationFromCents > 0, 'the website party request has no auto draft at the starting price');
  must(cur(c) === 'invoiced' && /data-confirmed="1"/.test(c) && c.includes(`data-next-what>📄 Invoice draft ready: ${s.util.money(pdTotal)}<`) && /Made from Pia&#39;s request\. Nothing has been sent\. Check the price, then send\./.test(c)
    && new RegExp(`href="/admin/invoices/${pd ? pd.id : 0}/edit"[^>]*data-help="step\\.reviewSend"[^>]*>Check and send the invoice<`).test(c) && !/data-help="card\.createInvoice"/.test(c), 'after Yes the party card is not at "📄 Invoice draft ready" with Check and send the invoice (or still offers Create invoice)');
  const day = (await s.get(`/admin/day/${moved}`)).text;
  const pb = await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind = 'party_setup'", partyKey);
  const row = day.slice(day.indexOf(`data-sheet-row="${pb.id}"`), day.indexOf('</div></div>', day.indexOf(`data-sheet-row="${pb.id}"`)));
  must(row.includes('Pia') && !/data-tentative-pill/.test(row), 'the Day sheet still marks the confirmed party as not confirmed');
}
// No, put it away (grazing): put away, off the list, nothing booked.
{
  const key = made.grazing.request_key;
  const r = await s.post('/admin/requests/talked', { r: s.rk(key), go: 'no' });
  must(/\/admin\/\?put=/.test(r.location), 'No, put it away did not come back with the Put away / Undo banner');
  const st = await s.one('SELECT archived_at FROM request_status WHERE request_key = ?1', key);
  const cal = (await s.get(`/admin/calendar?month=${svcReq.grazing.event_date.slice(0, 7)}`)).text;
  must(st && st.archived_at && !/Gil Stepper/.test(cal) && !/(?:Requested · not confirmed|>\? )[^<]*Gil/.test(cal), 'No, put it away did not put the grazing request away (or it still shows on the calendar)');
}
// The Monday summary lists what is unconfirmed (the rental and the porch).
{
  const d = await W.weeklyData(s.db, today).catch((e) => ({ error: String(e) }));
  const names = (d && d.needs && d.needs.unconfirmed) || [];
  must(names.includes('Rex S.') && names.includes('Poe S.') && !names.includes('Pia S.') && !names.includes('Gil S.'), `the Monday summary's Unconfirmed requests are ${JSON.stringify(names)} ${d && d.error ? d.error : ''}`);
  // The daily to-do email (Monday = the summary) puts every unconfirmed request in front of her:
  // not called yet -> "Call these people back", called -> "Set a time" / "Book it or decide".
  const td = await TODO.todoData(s.db, today);
  const mail = TODO.renderTodo(td);
  for (const n of ['Rex S.', 'Poe S.']) must(new RegExp(`data-section="[234]"[\\s\\S]*${n.replace('.', '\\.')} ·`).test(mail.html) && mail.text.includes(`- ${n} ·`), `the daily to-do email does not list the unconfirmed ${n}`);
}

// 2. The party ticks itself from the invoice, Money and the job (never from this card).
{
  const req = (await s.get('/admin/')).status === 200 ? (await (await mod('functions/_lib/requests.mjs')).loadRequests(s.env)).find((r) => r.key === partyKey) : null;
  // She sends the auto draft (never a second invoice).
  const inv = { id: (await s.one("SELECT id FROM invoices WHERE request_key = ?1 AND auto_draft = 1", partyKey) || {}).id || (await s.invoiceFor(req, { plan: 'half' })).id };
  await s.post(`/admin/invoices/${inv.id}/status`, { action: 'texted' });
  let c = await card(partyKey);
  must(doneList(c) === 'called,invoiced' && cur(c) === 'deposit', `marking the invoice texted did not tick "Invoice sent" (${doneList(c)})`);
  const before = await moneyRows();
  await s.post(`/admin/invoices/${inv.id}/status`, { action: 'deposit_paid', method: 'zelle' });
  c = await card(partyKey);
  must(doneList(c) === 'called,invoiced,deposit' && cur(c) === 'setup' && (await moneyRows()) === before + 1, `a deposit recorded on the invoice did not tick "Deposit paid" (${doneList(c)})`);
  // Undo beside "Deposit paid" explains and links to the invoice; it posts nothing.
  must(/data-undo="deposit" data-undo-kind="explain"[\s\S]*?href="\/admin\/invoices\/\d+"/.test(c) && !/data-undo="deposit"[^>]*>(?:(?!<\/details>)[\s\S])*<form/.test(c), 'the undo beside Deposit paid is not explain-only with the invoice link');
  await s.db.prepare("UPDATE bookings SET date = ?2 WHERE request_key = ?1 AND kind = 'party_setup'").bind(partyKey, today).run();
  c = await card(partyKey);
  must(/data-help="card\.jobDone"[^>]*>Mark setup done</.test(c), 'on the setup day the next step has no "Mark setup done"');
  await s.post('/admin/requests/jobdone', { r: s.rk(partyKey) });
  c = await card(partyKey);
  must(/data-step="setup" data-step-done/.test(c) && /data-step="takedown" data-step-done/.test(c) && cur(c) === 'paid', `Job done did not tick Setup done (and the never-asked takedown) (${doneList(c)} -> ${cur(c)})`);
  // Undo "Setup done" (stored) is a form to the jobdone undo: money untouched.
  const n0 = await moneyRows();
  const u = c.match(/data-undo="takedown"|data-undo="setup"/);
  must(Boolean(u), 'no undo beside the last ✓ after Setup done');
  await s.post('/admin/requests/jobdone', { r: s.rk(partyKey), undo: '1' });
  c = await card(partyKey);
  must(!/data-step="setup" data-step-done/.test(c) && (await moneyRows()) === n0 && /data-step="deposit" data-step-done/.test(c), 'undo Setup done changed money or did not untick it');
  await s.post('/admin/requests/jobdone', { r: s.rk(partyKey) });
  await s.post(`/admin/invoices/${inv.id}/status`, { action: 'paid', method: 'cash' });
  c = await card(partyKey);
  must(cur(c) === 'finished' && /data-step-count>Finished ✓</.test(c) && /data-put-away-prompt/.test(c) && /data-help="card\.archive"/.test(c), `paid in full on the invoice did not finish the party (${cur(c)})`);
  // Called back undo cannot delete the bookings; and it is never offered while later steps are done.
  must(!/data-undo="called"/.test(c), 'undo of Called back offered while later steps are done');
  const bk0 = (await s.all('SELECT id FROM bookings WHERE request_key = ?1', partyKey)).length;
  await s.post('/admin/requests/called', { r: s.rk(partyKey), undo: '1' });
  must((await s.all('SELECT id FROM bookings WHERE request_key = ?1', partyKey)).length === bk0 && (await s.one('SELECT COUNT(*) AS n FROM invoices WHERE request_key = ?1', partyKey)).n === 1, 'undo Called back removed a booking or an invoice');
}

// 2 + 7. The rental: extra game across the span, complimentary, picked up with the rest, returned, deposit back.
const rentKey = made.rentals.request_key;
{
  const pk = await s.one("SELECT date FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", rentKey);
  const rt = await s.one("SELECT date FROM bookings WHERE request_key = ?1 AND kind = 'rental_return'", rentKey);
  const span = C.spanDays(pk.date, rt.date);
  // Another rental holds Cornhole across the same days: it must show as booked in the picker.
  const other = await s.siteRequest({ service: 'rentals', games: ['cornhole'], duration: 'day', rental_date: svcReq.rentals.rental_date, pickup_when: 'morning', return_when: 'after', name: 'Ola Other', phone: '901-555-0305', email: 'ola.other@example.com' });
  must(other.status === 303, 'the second rental was refused');
  await s.post('/admin/requests/talked', { r: s.rk(rentKey), go: 'yes', date: pk.date, return_date: rt.date });
  let c = await card(rentKey);
  must(/data-confirmed="1"/.test(c) && cur(c) === 'invoiced' && /data-next-what>📄 Invoice draft ready: \$[\d,]+\.\d\d</.test(c) && /Made from Rex&#39;s request\./.test(c) && /data-help="step\.reviewSend"[^>]*>Check and send the invoice</.test(c), 'the confirmed website rental is not at "📄 Invoice draft ready" with Check and send the invoice (its draft)');
  const invId = (await s.one('SELECT invoice_id FROM request_status WHERE request_key = ?1', rentKey)).invoice_id;
  const ed = (await s.get(`/admin/invoices/${invId}/edit`)).text;
  const cents = Math.round(QA.extraGame * 100);
  must(new RegExp(`data-desc="Delivery fee" data-price="${(Math.round(QA.deliveryFee * 100) / 100).toFixed(2)}" data-help="ed\\.qDelivery"[^>]*><span class="ai"[^>]*>🚚</span><span><b>Delivery fee</b><small>For business delivery</small>`).test(ed), 'no "Delivery fee" (under ＋ Add something) at the services.json price');
  must(/data-desc="Discount" data-discount/.test(ed) && /data-desc="Setup \/ takedown fee"(?! data-price)/.test(ed) && /data-desc="Damage deposit \(refundable\)" data-refundable/.test(ed), 'the Discount / Setup fee / Damage deposit quick-adds are missing or carry a typed price');
  must(new RegExp(`data-q-game data-price="${(cents / 100).toFixed(2)}"`).test(ed), 'the extra game price is not the services.json price');
  must(/<option value="Cornhole Set" disabled>Cornhole Set \(booked those days\)<\/option>/.test(ed) && /<option value="Giant Uno" disabled>Giant Uno \(already in this rental\)<\/option>/.test(ed) && /<option value="Giant Connect Four">Giant Connect Four<\/option>/.test(ed), 'the picker does not grey out the booked game / own game, or hides a free one');
  must(/Complimentary '\+ord\+' game: '\+name/.test(ed) && /Complimentary \(no charge\)/.test(ed), 'the complimentary tick box / note wording is missing from the editor');
  // The editor's script (quick-adds included) must parse: a stray escape once broke every button.
  for (const js of [...ed.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])) {
    let ok = true; try { new Function(js); } catch { ok = false; }
    must(ok, 'the invoice editor script does not parse (the quick-add buttons would do nothing)');
  }
  must(/nt\.value\.replace\(\/\\s\*\$\/,''\)\+'\\n'\+line/.test(ed), 'the complimentary note is not added on its own line');
  // Save with a complimentary extra game ($0, note free) + its note.
  const lines = await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position', invId);
  const note = EG.complimentaryNote(2, 'Giant Connect Four');
  must(note === 'Complimentary 2nd game: Giant Connect Four', `the complimentary note reads "${note}"`);
  const form = (extra) => ({ customer_name: 'Rex Stepper', customer_email: 'rex.step@example.com', customer_phone: '901-555-0304', issue_date: today, due_date: plus(3), pay_plan: 'custom', deposit: '50.00', notes: extra.notes || '', go: 'save',
    line_desc: [...lines.map((l) => l.description), ...(extra.desc || [])], line_qty: [...lines.map((l) => String(l.qty)), ...(extra.desc || []).map(() => '1')],
    line_price: [...lines.map((l) => (l.unit_cents / 100).toFixed(2)), ...(extra.price || [])], line_note: [...lines.map((l) => l.note || ''), ...(extra.note || [])], line_refundable: [...lines.map((l) => (l.refundable ? '1' : '0')), ...(extra.desc || []).map(() => '0')] });
  await s.post(`/admin/invoices/${invId}`, form({ desc: ['Extra game: Giant Connect Four'], price: ['0.00'], note: ['free'], notes: note }));
  const saved = await s.one("SELECT unit_cents, note FROM invoice_lines WHERE invoice_id = ?1 AND description = 'Extra game: Giant Connect Four'", invId);
  const invRow = await s.one('SELECT notes FROM invoices WHERE id = ?1', invId);
  must(saved && saved.unit_cents === 0 && saved.note === 'free' && invRow.notes.includes('Complimentary 2nd game: Giant Connect Four'), 'the complimentary game is not a $0 "free" line with its invoice note');
  const items = (await s.all("SELECT items FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return')", rentKey)).map((b) => b.items);
  must(items.length === 2 && items.every((t) => /Giant Connect Four \(extra game\)/.test(t)), `the extra game is not on both rental bookings (${JSON.stringify(items)})`);
  const { TRACK_TABLE } = await mod('functions/_lib/prices.mjs');
  const windows = C.rentalWindows(await C.listBookings(s.db), await C.loadReturns(s.db), TRACK_TABLE);
  for (const d of span) must(C.usageOn(windows, d, today, TRACK_TABLE).byItem['Giant Connect Four'].used >= 1, `the extra game does not count as out on ${d}`);
  must(C.availability(windows, pk.date, rt.date, today, TRACK_TABLE)['Giant Connect Four'] === Math.max(0, (TRACK_TABLE.items.find((i) => i.name === 'Giant Connect Four').quantity || 1) - 1), 'availability over the span does not take the extra game out');
  const dayHtml = (await s.get(`/admin/day/${pk.date}`)).text;
  must(/Giant Connect Four \(extra game\)/.test(dayHtml), 'the Day sheet does not list the extra game');
  // A second rental asking for the same game over the span is a clash.
  const clash = C.spanClashes(windows, { start: pk.date, end: rt.date, items: 'Giant Connect Four' }, today, TRACK_TABLE, 'nobody');
  must(Array.isArray(clash) ? clash.length > 0 : Boolean(clash), 'the clash check does not see the reserved extra game');
  // Paid instead: $20 from services.json, still reserved.
  await s.post(`/admin/invoices/${invId}`, form({ desc: ['Extra game: Giant Connect Four'], price: [(cents / 100).toFixed(2)], note: [''] }));
  must((await s.one("SELECT unit_cents FROM invoice_lines WHERE invoice_id = ?1 AND description LIKE 'Extra game:%'", invId)).unit_cents === cents
    && (await s.all("SELECT items FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", rentKey))[0].items.includes('Giant Connect Four (extra game)'), 'a paid extra game is not reserved');
  // Removed: freed.
  await s.post(`/admin/invoices/${invId}`, form({}));
  must(!(await s.all("SELECT items FROM bookings WHERE request_key = ?1", rentKey)).some((b) => /extra game/.test(b.items)), 'removing the extra-game line did not free the game');
  await s.post(`/admin/invoices/${invId}`, form({ desc: ['Extra game: Giant Connect Four'], price: [(cents / 100).toFixed(2)], note: [''] }));
  // Send (texted), deposit ($50 of a bigger total), then the pickup day: Mark picked up with the rest.
  await s.post(`/admin/invoices/${invId}/status`, { action: 'texted' });
  await s.post(`/admin/invoices/${invId}/status`, { action: 'deposit_paid', method: 'zelle' });
  c = await card(rentKey);
  must(cur(c) === 'picked' && /data-next-wait="step\.picked"/.test(c), `before pickup day the rental does not wait quietly at "Picked up" (${cur(c)})`);
  must((await s.all("SELECT items FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", rentKey))[0].items.includes('Giant Connect Four (extra game)'), 'texting the invoice dropped the extra game from the booking');
  await s.db.prepare("UPDATE bookings SET date = ?2 WHERE request_key = ?1 AND kind = 'rental_pickup'").bind(rentKey, today).run();
  c = await card(rentKey);
  must(/action="\/admin\/calendar\/bookings\/\d+\/done"[\s\S]*name="paid_rest" value="1" checked[\s\S]*data-help="step\.picked"[^>]*>Mark picked up</.test(c), `on pickup day the next step is not Mark picked up with "They paid the rest" ticked (${cur(c)}: ${(c.match(/data-next-step[\s\S]{0,900}/) || [''])[0].replace(/\s+/g, ' ')})`);
  const pid = (await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", rentKey)).id;
  const m0 = await moneyRows();
  await s.post(`/admin/calendar/bookings/${pid}/done`, { r: s.rk(rentKey), paid_rest: '1', method: 'cash' });
  c = await card(rentKey);
  must(/data-step="picked" data-step-done/.test(c) && cur(c) === 'returned' && (await moneyRows()) === m0 + 1 && (await s.one('SELECT status FROM invoices WHERE id = ?1', invId)).status === 'paid', `Mark picked up (rest paid) did not tick Picked up and record the rest (${doneList(c)})`);
  // Undo Picked up: the done mark only; the payment stays.
  await s.post(`/admin/calendar/bookings/${pid}/done`, { r: s.rk(rentKey), undo: '1' });
  must(!(await s.one('SELECT done_at FROM bookings WHERE id = ?1', pid)).done_at && (await moneyRows()) === m0 + 1, 'undo Picked up removed the payment (or kept the done mark)');
  await s.post(`/admin/calendar/bookings/${pid}/done`, { r: s.rk(rentKey) });
  // Mark returned through the real check-in.
  await s.post(`/admin/returns?k=${s.rk(rentKey)}`, { back: ['Giant Uno', 'Giant Connect Four'] });
  c = await card(rentKey);
  const hasDeposit = /data-step="deposit_back"(?! data-step-done)/.test(c);
  must(hasDeposit, 'the website rental (damage deposit on its invoice) skipped "Deposit given back"');
  must(/data-step="returned" data-step-done/.test(c) && (hasDeposit ? cur(c) === 'deposit_back' : cur(c) === 'finished'), `Mark returned did not tick Returned (${doneList(c)} -> ${cur(c)})`);
  if (hasDeposit) {
    must(/action="\/admin\/invoices\/\d+\/deposit"[\s\S]*name="kind" value="refund"[\s\S]*data-help="step\.depositBack"[^>]*>Deposit returned, finish</.test(c), 'the deposit step has no "Deposit returned, finish"');
    const held = (c.match(/name="amount" value="([\d.]+)"/) || [])[1];
    const back = await s.post(`/admin/invoices/${invId}/deposit`, { kind: 'refund', amount: held, method: 'cash', back: `/admin/#c-${s.rk(rentKey)}` });
    must(/^\/admin\/\?m=[^#]*#c-/.test(back.location), `Deposit returned, finish does not come back to the card (${back.location})`);
    c = await card(rentKey);
    must(cur(c) === 'finished' && /data-step="deposit_back" data-step-done/.test(c), `refunding the deposit on Money did not finish the rental (${cur(c)})`);
    must(/data-undo="deposit_back" data-undo-kind="explain"/.test(c), 'the undo beside Deposit given back is not explain-only');
  }
  must((await s.one('SELECT COUNT(*) AS n FROM payments WHERE voided_at IS NOT NULL')).n === 0, 'a step-card action voided a payment');
}

if (checks < 120) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) {
  console.error(`step cards: FAIL (${errors.length} of ${checks})`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`step cards: OK (${checks} checks: steps for rentals / party / porch / grazing / both x state, ticks from invoice + Money + job + returns, undo never touches money, tentative -> confirmed chips + Unconfirmed requests + Monday summary, dates without a year, quick-add prices from services.json, extra game reserved across the span + complimentary $0 note)`);
