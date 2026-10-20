#!/usr/bin/env node
/**
 * Every button and link in the /admin console explains itself (owner's ask, 18 Oct 2026).
 *
 * Renders every admin screen through the real guard + router in many states (new, invoiced,
 * paid, void, scheduled, returned with damage, put away, tomorrow's reminders...) and fails if:
 *  1. any <a>, <button>, <summary> or upload <label class="btn"> lacks data-help="key" AND a
 *     title equal to that key's sentence in functions/_lib/helptext.mjs (one central map);
 *  2. a key used on a screen is missing from /admin/help, or a map entry is never rendered;
 *  3. a screen lacks the numbered 1-2-3 steps, or a Back link (Requests and Sign in excepted),
 *     or the link to How to use this;
 *  4. the Requests screen has any "More" disclosure other than each step card's ONE "More:
 *     answers, history, other buttons" (owner-approved step cards, 19 Oct 2026: exactly one per
 *     card, inside the card, after its next-step box), or any disclosure with an id outside the
 *     whitelist (only #put-away, the collapsed Put away section), or lacks the steps panel with
 *     each button in its owner-approved step (JOB B, 18 Oct 2026); Calendar & Bookings and Money
 *     carry the same panel; /admin/archive redirects to the opened Put away section.
 * Rule 0: fewer than 20 screens or 150 controls checked is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const { HELP } = await mod('functions/_lib/helptext.mjs');
// The owner's words for the five Calendar & Bookings steps (calm calendar, 19 Oct 2026), pinned here, not read from the code.
const CAL_STEPS = ["See what's coming up.", 'Put a request on the calendar.', 'Plan your day.', "Check tomorrow's reminders.", 'Look over the next 14 days.'];
const { esc } = await mod('functions/_lib/util.mjs');
const R = await mod('functions/_lib/reminders.mjs');
const errors = [];
const s = await session();
const [reqA, reqB] = [s.requests.find((r) => r.email === 'test.renter@example.com'), s.requests.find((r) => r.email === 'weekend.renter@example.com')];

// Before anything is scheduled: the Unscheduled requests list has Schedule buttons.
const early = [['/admin/calendar (nothing scheduled)', {}, await s.get('/admin/calendar')]];
// A console with something in every state.
const invA = await s.invoiceFor(reqA, { go: 'send' });
await s.post(`/admin/invoices/${invA.id}/status`, { action: 'deposit_paid', method: 'zelle' });
const invB = await s.invoiceFor(reqB, { go: 'save', email: '' });
const tmr = R.tomorrowChicago();
await s.post('/admin/calendar/bookings', { kind: 'grazing_setup', date: tmr, time: '14:00', customer_name: 'Gia Graze', phone: '901-555-0123', email: 'gia@example.com', place: '12 Oak St', items: 'Grazing table', note: 'Side gate' });
await s.post('/admin/calendar/bookings', { kind: 'porch_install', date: tmr, customer_name: 'No Phone', phone: '', email: 'np@example.com', place: '', items: '' });
// A job booked before the auto draft shipped (20 Oct 2026) has no invoice at all: its draft is
// taken away here so Money still shows the "no invoice yet" job link.
{ const np = await s.one("SELECT id FROM invoices WHERE customer_name = 'No Phone'");
  if (np) { await s.db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?1').bind(np.id).run(); await s.db.prepare('DELETE FROM invoices WHERE id = ?1').bind(np.id).run(); await s.db.prepare('UPDATE request_status SET invoice_id = NULL WHERE invoice_id = ?1').bind(np.id).run(); } }
await s.post('/admin/calendar/bookings', { kind: 'rental_pickup', date: '2026-01-05', return_date: '2026-01-06', customer_name: 'Late Larry', phone: '901-555-0999', email: '', place: '', items: 'Giant Uno' });
// A takedown long past and not done (red: "Is Tina T.'s takedown done?" with ✓ Yes, it's done).
await s.post('/admin/calendar/bookings', { kind: 'party_takedown', date: '2026-01-07', customer_name: 'Tina Takedown', phone: '901-555-0997', email: '', place: '', items: 'Party decor' });
// A weekend-long rental (pickup tomorrow, back 4 days later): "Rental out" chips on the days between.
const outMid = (() => { const d = new Date(`${tmr}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 2); return d.toISOString().slice(0, 10); })();
const outEnd = (() => { const d = new Date(`${tmr}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 4); return d.toISOString().slice(0, 10); })();
await s.post('/admin/calendar/bookings', { kind: 'rental_pickup', date: tmr, return_date: outEnd, customer_name: 'Wendy Weekend', phone: '901-555-0998', email: '', place: '', items: 'Giant Connect Four' });
const late = await s.one("SELECT id FROM bookings WHERE customer_name = 'Late Larry' AND kind = 'rental_return'");
const pick = await s.one("SELECT id, date FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", reqA.key);
const note = await s.one('SELECT id FROM booking_notes LIMIT 1');
const lateTd = await s.one("SELECT id FROM bookings WHERE customer_name = 'Tina Takedown'");
const retA = await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind = 'rental_return'", reqA.key);
await s.post(`/admin/returns?k=${s.rk(reqA.key)}`, { back: ['Cornhole Set'] });
await s.post('/admin/settings', { business_name: 'Porch & Party' });
const v = await s.invoiceFor(reqB, { go: 'save' });
await s.post(`/admin/invoices/${v.id}/status`, { action: 'void' });
const paidInv = await s.invoiceFor(reqA, { go: 'send' });
await s.post(`/admin/invoices/${paidInv.id}/status`, { action: 'paid', method: 'cash' });
const draftWithEmail = await s.invoiceFor(reqA, { go: 'save' });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const up1 = await s.upload(PNG, 'image/jpeg');
const up2 = await s.upload(PNG, 'image/jpeg');
await s.post(`/admin/money/expenses/${up2.json.id}`, { vendor: 'Party City', date: '2026-10-12', total: '42.17', tax: '3.17', category: 'Supplies & decor', payment_method: 'card', note: '' });
// A tip (calm Money, 19 Oct 2026) so its list row, its page and Remove render.
await s.post('/admin/money/tips', { amount: '20', date: '2026-10-12', method: 'zelle', job: '|', note: 'thank you', back: '/admin/money?month=2026-10' });
const tipId = (await s.one('SELECT MAX(id) AS id FROM tips')).id;

// Site-form rentals: one held (ending soon), one held by hand; a site porch job done with
// the thank-you turned off; the deposit-received screen.
const F = await mod('functions/_lib/request-form.mjs');
const dplus = (n) => { const d = new Date(`${F.chicagoToday()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const heldReq = await s.siteRequest({ service: 'rentals', games: ['giant-uno'], duration: 'day', rental_date: dplus(12), pickup_when: 'morning', return_when: 'after', name: 'Hana Held', phone: '901-555-0177', email: 'hana@example.com' });
await s.db.prepare("UPDATE holds SET until = datetime('now', '+2 hours') WHERE request_key = ?1").bind(heldReq.row.request_key).run();
await s.db.prepare("INSERT INTO settings (key, value) VALUES ('hold_auto_expire', '0')").run();
const handReq = await s.siteRequest({ service: 'rentals', games: ['cornhole'], duration: 'day', rental_date: dplus(13), pickup_when: 'morning', return_when: 'after', name: 'Hal Hand', phone: '901-555-0178', email: 'hal@example.com' });
await s.db.prepare("DELETE FROM settings WHERE key = 'hold_auto_expire'").run();
const tyReq = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', event_date: dplus(3), location: 'Germantown', name: 'Tia Thanks', phone: '901-555-0179', email: 'tia@example.com' });
await s.post('/admin/requests/jobdone', { r: s.rk(tyReq.row.request_key) });
await s.post('/admin/requests/thankyou-skip', { r: s.rk(tyReq.row.request_key), skip: '1' });
const tyReq2 = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', event_date: dplus(4), location: 'Bartlett', name: 'Tom Thanks', phone: '901-555-0180', email: 'tom@example.com' });
await s.post('/admin/requests/jobdone', { r: s.rk(tyReq2.row.request_key) });
if (!(heldReq.status === 303 && handReq.status === 303 && tyReq.status === 303 && tyReq2.status === 303)) errors.push('the site-form scenario requests did not go through');
const screens = [
  ['/admin', { auth: false, home: true }],
  ['/admin/', { home: true }],
  [`/admin/?put=${s.rk(reqB.key)}`, { home: true }],
  ['/admin/calendar'], ['/admin/calendar?month=2026-10'], ['/admin/calendar?month=2026-01'],
  [`/admin/day/${pick.date}`], [`/admin/day/${tmr}`], ['/admin/day/2026-01-06'],
  ['/admin/calendar/new'], [`/admin/calendar/new?r=${s.rk(reqB.key)}&date=2026-10-30`],
  [`/admin/calendar/bookings/${pick.id}/edit`], [`/admin/calendar/bookings/${pick.id}/move`],
  ['/admin/calendar/link'],
  [`/admin/returns?k=${s.rk(reqA.key)}`], [`/admin/returns?k=${s.rk(`booking:${late.id}`)}`],
  // The confirm screen behind the 7 AM email's ✓ Yes: a late return, a late takedown, an already-back return.
  [`/admin/confirm-done?b=${late.id}&r=`], [`/admin/confirm-done?b=${lateTd.id}&r=`], ...(retA ? [[`/admin/confirm-done?b=${retA.id}&r=${s.rk(reqA.key)}`]] : []),
  ['/admin/invoices'], ['/admin/invoices/new'], [`/admin/invoices/new?r=${s.rk(reqA.key)}`],
  [`/admin/invoices/${invA.id}`], [`/admin/invoices/${invB.id}`], [`/admin/invoices/${draftWithEmail.id}`], [`/admin/invoices/${v.id}`], [`/admin/invoices/${paidInv.id}`], [`/admin/invoices/${invA.id}/edit`],
  ['/admin/settings'], ['/admin/help', { help: true }], ['/admin/packages'],
  // Quick Pricing Summary (20 Oct 2026): plain, after a send, and after a refused send.
  ['/admin/pricing'], ['/admin/pricing?s=rentals&sent=hana%40example.com'], ['/admin/pricing?s=all&to=x&err=That%20email%20address%20does%20not%20look%20right.'],
  // Settings -> Inventory (18 Oct 2026): the Add and Edit forms.
  ['/admin/inventory'], ['/admin/inventory/new'], ['/admin/inventory/giant-uno'], ['/admin/inventory/giant-uno/edit'], ['/admin/inventory/giant-tumble-tower'], ['/admin/inventory/projector'],
  [`/admin/confirmed?r=${s.rk(heldReq.row.request_key)}&m=Deposit%20received&back=/admin/`],
  [`/admin/checklist/online?r=${s.rk(reqA.key)}`], ['/admin/checklist', { print: true }], [`/admin/checklist?r=${s.rk(reqA.key)}`, { print: true }],
  ['/admin/search'], ['/admin/search?q=renter'], ['/admin/search?q=zzzz'],
  ['/admin/nothing-here'],
  ['/admin/money'], ['/admin/money?month=2026-10'], ['/admin/money/year?year=2026'], ['/admin/money/expenses/new'],
  [`/admin/money/expenses/${up1.json.id}`], [`/admin/money/expenses/${up2.json.id}`],
  ['/admin/money?view=all&unconf=1&deposits=in'], ['/admin/money/tips/new'], [`/admin/money/tips/${tipId}`],
  ...['received', 'owed', 'jobs', 'expenses', 'deposits', 'category:rentals', 'tips'].map((w) => [`/admin/money/detail?month=2026-10&what=${w}`]),
];
// Archive one so Put away has rows (after the dashboard renders above are collected below).
const pages = [...early];
for (const [p, o = {}] of screens) pages.push([p, o, await s.get(p, { auth: o.auth !== false })]);
pages.push(['/admin/calendar (rental out)', {}, await s.get(`/admin/calendar?month=${outMid.slice(0, 7)}`)]);
pages.push([`/admin/day/${outMid} (rental out)`, {}, await s.get(`/admin/day/${outMid}`)]);
// An inventory save whose website update failed: the box says so and offers Try again.
await s.post('/admin/settings/inventory/rates', { rate_day: '40', rate_weekend: '60' });
await s.db.prepare("UPDATE inventory_publishes SET status = 'failed', detail = 'The website did not update.' WHERE id = (SELECT MAX(id) FROM inventory_publishes)").run();
pages.push(['/admin/settings (website update failed)', {}, await s.get('/admin/settings')]);
pages.push(['/admin/inventory (website update failed)', {}, await s.get('/admin/inventory')]);
// The old Settings -> Inventory addresses (before 19 Oct 2026) redirect to the Inventory page.
for (const [from, to] of [['/admin/settings/inventory', '/admin/inventory'], ['/admin/settings/inventory/new', '/admin/inventory/new'], ['/admin/settings/inventory/giant-uno', '/admin/inventory/giant-uno/edit']]) {
  const r = await s.get(from);
  if (r.status !== 303 || r.location !== to) errors.push(`${from} must redirect to ${to} (got ${r.status} ${r.location})`);
}
await s.post('/admin/requests/archive', { r: s.rk(reqB.key) });
{
  const old = await s.get('/admin/archive');
  if (old.status !== 303 || old.location !== '/admin/?pa=1#put-away') errors.push(`/admin/archive must redirect to /admin/?pa=1#put-away (got ${old.status} ${old.location})`);
  pages.push(['/admin/?pa=1', { home: true, putAwayOpen: true }, await s.get('/admin/?pa=1')]);
  pages.push(['/admin/?f=porch', { home: true }, await s.get('/admin/?f=porch')]);
  pages.push(['/admin/?f=unpaid', { home: true }, await s.get('/admin/?f=unpaid')]);
}
pages.push(['/admin/search?partial=1&q=renter', { partial: true }, await s.get('/admin/search?partial=1&q=renter')]);
// The no-JS photo ID page (Open ID photo opens over the card with JS; 20 Oct 2026).
{ const viewsId = await mod('functions/_lib/views.mjs'); pages.push(['idPhotoPage (no-JS photo ID page)', {}, { status: 200, text: viewsId.idPhotoPage({ name: 'Rae Rent' }, s.rk(reqA.key)) }]); }
// "Change anything on this request" (the Edit link): with bookings, payments and a return, and
// with nothing booked yet (Put it on the calendar).
await s.post('/admin/requests/edit/payment-add', { r: s.rk(reqA.key), amount: '10.00', method: 'cash' });
pages.push([`/admin/requests/edit (${reqA.email})`, {}, await s.get(`/admin/requests/edit?r=${s.rk(reqA.key)}`)]);
pages.push(['/admin/requests/edit (nothing booked)', {}, await s.get(`/admin/requests/edit?r=${s.rk(tyReq.row.request_key)}`)]);
// A porch job (no rental) on the calendar, then done: Mark job done / Undo job done.
{
  const views = await mod('functions/_lib/views.mjs');
  const porch = { ...reqA, key: 'porch|x', name: 'Pat Porch', gamesAnswer: '', wantsRentals: false, wantsDecor: true, need: 'Porch decorating', services: ['porch'], rentals: [], decor: [], other: [] };
  const base = { requests: [porch], invoices: {}, checklists: {}, returns: {}, folderUrl: 'https://drive.google.com/x', sheetError: '', flash: '', missingPayment: [] };
  for (const st of [{ status: 'scheduled' }, { status: 'job_done', job_done_at: '2026-10-18 10:00:00' }]) {
    pages.push([`dashboardPage(${st.status})`, { home: true, direct: true }, { status: 200, text: views.dashboardPage({ ...base, statuses: { 'porch|x': st }, schedule: { 'porch|x': { date: '2026-10-24' } }, kinds: { 'porch|x': ['porch_install'] }, today: '2026-10-24' }) }]);
  }
  // A booked rental before pickup day with no pickup time yet: "Text about pickup time" is the
  // card's one primary, its email twin a small link (time-aware primary, 18 Oct 2026).
  {
    const rent = { ...reqA, key: 'rentp|x', name: 'Ria Pickup', services: ['rentals'] };
    pages.push(['dashboardPage(rental before pickup, no time)', { home: true, direct: true }, { status: 200, text: views.dashboardPage({ ...base, requests: [rent], statuses: { 'rentp|x': { status: 'scheduled' } },
      schedule: { 'rentp|x': { date: '2026-10-30' } }, kinds: { 'rentp|x': ['rental_pickup', 'rental_return'] }, bookings: { 'rentp|x': [{ kind: 'rental_pickup', date: '2026-10-30', time: null }] }, today: '2026-10-18',
      cardMsgs: { 'rentp|x': { confirm: { sms: { href: 'sms:9015550100?&body=ok' }, canEmail: true }, pickup: { sms: { href: 'sms:9015550100?&body=time' }, canEmail: true } } } }) }]);
  }
  // A rental whose invoice has a Delivery fee line but no business delivery set: the card asks for
  // the business name and address (owner, 20 Oct 2026), the same Step-1 form.
  {
    const rent = { ...reqA, key: 'rentd|x', name: 'Dee Fee', services: ['rentals'], rentals: [], decor: [], other: [] };
    const inv = { id: 77, number: 'PP-77', status: 'sent', total_cents: 15000, deposit_due_cents: 7500, lines: [{ description: 'Giant Uno', qty: 1, unit_cents: 13000 }, { description: 'Delivery fee', qty: 1, unit_cents: 2000 }],
      balance: { total: 15000, charges: 15000, refundable: 0, paid: 0, owed: 15000, depositOwed: 0, remaining: 15000, void: false } };
    pages.push(['dashboardPage(delivery fee, no business address)', { home: true, direct: true }, { status: 200, text: views.dashboardPage({ ...base, requests: [rent], statuses: { 'rentd|x': { status: 'invoiced', invoice_id: 77 } }, invoices: { 77: inv }, today: '2026-10-18' }) }]);
  }
  // Grazing and party once their setup is on the calendar: the optional second booking buttons.
  const graze = { ...porch, key: 'graze|x', name: 'Gia Graze', services: ['grazing'], need: 'grazing', decor: [{ label: 'How many guests?', value: '15–40' }, { label: 'Should we source the food?', value: 'Yes, include food in my quote' }] };
  const party = { ...porch, key: 'party|x', name: 'Pia Party', services: ['party'], need: 'party & decor' };
  // The takedown in each state: scheduled (button), not sure (amber + Job done prompt), the customer handles it.
  // '' = not asked yet (the ask box), scheduled with no booking = "Takedown requested".
  for (const plan of ['', 'scheduled', 'not_sure', 'customer_handles']) {
    const p2 = { ...porch, key: `td|${plan}`, name: `Td ${plan}`, takedownPlan: plan, takedownNote: 'note', takedownDate: plan === 'scheduled' ? '2026-10-25' : '' };
    pages.push([`dashboardPage(takedown ${plan || 'ask'})`, { home: true, direct: true }, { status: 200, text: views.dashboardPage({ ...base, requests: [p2], statuses: { [p2.key]: { status: 'scheduled' } }, schedule: { [p2.key]: { date: '2026-10-24' } }, kinds: { [p2.key]: ['porch_install'] }, bookings: { [p2.key]: [{ id: 1, kind: 'porch_install', date: '2026-10-24' }] }, today: '2026-10-24' }) }]);
  }
  {
    // Job done + paid, takedown booked and its day reached: "Mark takedown done" is the one big button.
    const p3 = { ...porch, key: 'td|due', name: 'Td due', takedownPlan: 'scheduled' };
    pages.push(['dashboardPage(takedown due)', { home: true, direct: true }, { status: 200, text: views.dashboardPage({ ...base, requests: [p3], statuses: { [p3.key]: { status: 'paid', job_done_at: '2026-10-24 12:00:00' } }, schedule: { [p3.key]: { date: '2026-10-24' } }, kinds: { [p3.key]: ['porch_install', 'porch_takedown'] }, bookings: { [p3.key]: [{ id: 1, kind: 'porch_install', date: '2026-10-24' }, { id: 2, kind: 'porch_takedown', date: '2026-10-25' }] }, today: '2026-10-25' }) }]);
    // The day sheet with a takedown marked done (Undo takedown done), through the real routes.
    const today = s.util.todayISO ? s.util.todayISO() : new Date().toISOString().slice(0, 10);
    const tr = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'yes', event_date: '2030-10-24', location: 'Germantown', name: 'Tad Takedown', phone: '901-555-0902', email: 'tad.takedown@example.com' });
    await s.post('/admin/calendar/bookings', { r: s.rk(tr.row.request_key), kind: 'porch_takedown', date: today, customer_name: 'Tad Takedown', phone: '', email: '', place: '', items: 'Porch' });
    const tb = await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind = 'porch_takedown'", tr.row.request_key);
    pages.push([`/admin/day/${today} (takedown due)`, {}, await s.get(`/admin/day/${today}`)]);
    await s.post(`/admin/calendar/bookings/${tb.id}/takedown-done`, {});
    pages.push([`/admin/day/${today} (takedown done)`, {}, await s.get(`/admin/day/${today}`)]);
    // A takedown asked for with no day yet (the /request form has no date box): "Takedowns to
    // schedule" on Calendar & Bookings, plus the outlined Requested chips and the legend.
    await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'yes', event_date: '2030-11-07', location: 'Germantown', name: 'Una Undated', phone: '901-555-0904', email: 'una.undated@example.com' });
    pages.push(['/admin/calendar (takedown to schedule)', {}, await s.get('/admin/calendar?month=2030-11')]);
  }
  {
    // Render the calendar with one undecided takedown through the real route.
    const sr = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'not_sure', event_date: '2030-10-24', location: 'Germantown', name: 'Una Decided', phone: '901-555-0901', email: 'una@example.com' });
    if (sr.status !== 303) errors.push('the not-sure takedown request did not go through');
    pages.push(['/admin/calendar (still to decide)', {}, await s.get('/admin/calendar')]);
    // Requests with NEW website requests not yet opened (owner, 19 Oct 2026): the NEW badge.
    const withNew = await s.get('/admin/');
    if (!withNew.text.includes('data-new-badge')) errors.push('no NEW request on Requests, so the NEW badge goes untested');
    pages.push(['/admin/ (NEW requests)', { home: true }, withNew]);
  }
  pages.push(['dashboardPage(grazing+party scheduled, one put away)', { home: true, direct: true }, { status: 200, text: views.dashboardPage({ ...base, requests: [graze, party, { ...reqA, key: 'rent|x', name: 'Rae Rent', services: ['rentals'] }], archived: [{ ...porch, key: 'old|x' }],
    statuses: { 'graze|x': { status: 'scheduled' }, 'party|x': { status: 'scheduled' }, 'rent|x': { status: 'deposit_paid' }, 'old|x': { status: 'paid', archived_at: '2026-10-01 10:00:00' } },
    schedule: { 'graze|x': { date: '2026-10-24' }, 'party|x': { date: '2026-10-25' } }, kinds: { 'graze|x': ['grazing_setup'], 'party|x': ['party_setup'] }, foodPerHead: { low: 12, high: 18 } }) }]);
}

// Step cards (owner-approved 19 Oct 2026): every step's next-step box renders, so every new
// control is checked for its help entry: called back but not booked (Book it now), a held rental
// waiting for its deposit (Hold longer), pickup day with the rest owed (Mark picked up + They paid
// the rest), back with a damage deposit to give back (Deposit returned, finish + Keep some for
// damage), a booked grazing pickup (Mark pickup done), setup day with the takedown not decided
// (the Mark setup done question). And a confirmed held rental on the calendar (Held chip) with its
// hold controls (Release these games), through the real routes.
{
  const views = await mod('functions/_lib/views.mjs');
  const T = '2026-10-24';
  const lines = [{ description: 'Pick 3 bundle', qty: 1, unit_cents: 11000, refundable: 0 }, { description: 'Damage deposit', qty: 1, unit_cents: 5000, refundable: 1 }];
  const inv = (id, status, paid) => ({ id, status, number: `PNP-2026-01${id}`, total_cents: 16000, deposit_due_cents: 5000, pay_plan: 'custom', lines, balance: { total: 16000, charges: 11000, refundable: 5000, paid, owed: Math.max(0, 11000 - paid), depositOwed: Math.max(0, 5000 - Math.max(0, paid - 11000)), remaining: Math.max(0, 16000 - paid), void: false } });
  const rent = { ...reqA, key: 'sc|rent', name: 'Sky Steps', services: ['rentals'], source: 'site', phone: '901-555-0190' };
  const graze = { ...reqA, key: 'sc|graze', name: 'Gus Steps', services: ['grazing'], gamesAnswer: '', wantsRentals: false, wantsDecor: true, rentals: [], decor: [], other: [], source: 'site' };
  const party = { ...graze, key: 'sc|party', name: 'Pam Steps', services: ['party'], takedownPlan: 'not_sure' };
  const pk = (extra = {}) => [{ id: 71, kind: 'rental_pickup', date: T, time: null, ...extra }, { id: 72, kind: 'rental_return', date: '2026-10-26', time: null }];
  const one = (label, r, o) => pages.push([`dashboardPage(steps: ${label})`, { home: true, direct: true }, { status: 200, text: views.dashboardPage({ requests: [r], checklists: {}, returns: {}, folderUrl: 'https://drive.google.com/x', sheetError: '', flash: '', missingPayment: [], today: T, ...o }) }]);
  one('called, not booked', rent, { statuses: { [rent.key]: { status: 'new' } }, stored: { [rent.key]: { called_at: 'x', confirmed_at: null } } });
  one('held, deposit next', rent, { statuses: { [rent.key]: { status: 'invoiced', invoice_id: 1 } }, invoices: { 1: inv(1, 'sent', 0) }, bookings: { [rent.key]: pk({ date: '2026-10-30' }) }, kinds: { [rent.key]: ['rental_pickup', 'rental_return'] },
    holds: { [rent.key]: { state: 'held', by_hand: 0, untilMs: Date.parse('2026-10-25T20:00:00Z') } }, holdHtml: { [rent.key]: '<p>hold controls</p>' } });
  one('pickup day, rest owed', rent, { statuses: { [rent.key]: { status: 'deposit_paid', invoice_id: 2 } }, invoices: { 2: inv(2, 'deposit_paid', 5000) }, bookings: { [rent.key]: pk() }, kinds: { [rent.key]: ['rental_pickup', 'rental_return'] }, stored: { [rent.key]: { called_at: 'x', confirmed_at: 'x' } } });
  one('back, deposit to give back', rent, { statuses: { [rent.key]: { status: 'paid', invoice_id: 3, job_done_at: '2026-10-26 12:00:00' } }, invoices: { 3: inv(3, 'paid', 16000) }, bookings: { [rent.key]: pk({ done_at: '2026-10-24 12:00:00' }) }, kinds: { [rent.key]: ['rental_pickup', 'rental_return'] }, returns: { [rent.key]: { returned_at: '2026-10-26 12:00:00', damaged: 0 } } });
  one('grazing pickup booked', graze, { statuses: { [graze.key]: { status: 'job_done', job_done_at: '2026-10-24 12:00:00', invoice_id: 4 } }, invoices: { 4: inv(4, 'deposit_paid', 5000) }, bookings: { [graze.key]: [{ id: 81, kind: 'grazing_setup', date: T }, { id: 82, kind: 'grazing_pickup', date: T }] }, kinds: { [graze.key]: ['grazing_setup', 'grazing_pickup'] }, schedule: { [graze.key]: { date: T } } });
  one('setup day, takedown not decided', party, { statuses: { [party.key]: { status: 'deposit_paid' } }, bookings: { [party.key]: [{ id: 91, kind: 'party_setup', date: T }] }, kinds: { [party.key]: ['party_setup'] }, schedule: { [party.key]: { date: T } } });
  // A held rental she said yes to: still held (now by hand), solid on the calendar with "Held".
  await s.post('/admin/requests/talked', { r: s.rk(handReq.row.request_key), go: 'yes', date: dplus(12), return_date: dplus(14) });
  pages.push(['/admin/calendar (confirmed held rental)', {}, await s.get(`/admin/calendar?month=${dplus(12).slice(0, 7)}`)]);
  pages.push(['/admin/ (confirmed held rental)', { home: true }, await s.get('/admin/')]);
  // The invoice editor's "+ Extra game" with games to pick (a rental with its days booked).
  const ri = await s.one('SELECT invoice_id FROM request_status WHERE request_key = ?1', handReq.row.request_key);
  if (ri && ri.invoice_id) { const ed = await s.get(`/admin/invoices/${ri.invoice_id}/edit`); if (!/data-quick-game-pick/.test(ed.text)) errors.push(`the rental invoice editor has no game picker: ${(ed.text.match(/data-quick-game>[\s\S]{0,300}/) || [''])[0]}`); pages.push([`/admin/invoices/${ri.invoice_id}/edit (extra game)`, {}, ed]); }
  else errors.push('the held rental has no draft invoice, so + Extra game goes untested');
}

const used = new Set();
let controls = 0;
let helpHtml = '';
for (const [p, o, res] of pages) {
  if (res.status >= 500 || (res.status !== 200 && res.status !== 404)) { errors.push(`${p} answered ${res.status}`); continue; }
  const html = res.text;
  if (o.help) helpHtml = html;
  // A <select> that carries a help key (the extra-game picker, 19 Oct 2026) is checked like any control.
  const tags = html.match(/<(a|button|summary)\b[^>]*>|<label\b[^>]*class="btn[^"]*"[^>]*>|<(?:input|div|span|select)\b[^>]*data-help="[^"]*"[^>]*>/g) || [];
  for (const tag of tags) {
    controls += 1;
    const key = (tag.match(/data-help="([^"]+)"/) || [])[1];
    const title = (tag.match(/title="([^"]*)"/) || [])[1];
    if (!key) { errors.push(`${p}: control without data-help: ${tag.slice(0, 110)}`); continue; }
    if (!HELP[key]) { errors.push(`${p}: data-help="${key}" is not in the map`); continue; }
    if (title !== esc(HELP[key].title)) errors.push(`${p}: ${key} title is not the map's sentence`);
    used.add(key);
  }
  if (o.partial) continue;
  const steps = (html.match(/<ol class="topsteps[^"]*" data-steps="[^"]+"[^>]*>([\s\S]*?)<\/ol>/) || [])[1];
  // Calendar & Bookings (owner-approved calm calendar, 19 Oct 2026): five numbered steps, the
  // month first; 1-4 in the margin column, 5 under the month (validate:admin-calm-calendar has the rest).
  if (/^\/admin\/calendar(\?| \(|$)/.test(p)) {
    const calm = [...html.matchAll(/data-calstep="(\d)"[^>]*>(?:<summary[^>]*>|<h2[^>]*>)<span class="n">(\d)<\/span><span class="spt">([^<]+)<\/span>/g)].map((m) => [m[1], m[2], m[3]]);
    const want = CAL_STEPS.map((t, i) => [String(i + 1), String(i + 1), esc(t)]);
    const order = (x) => html.indexOf(x);
    if (JSON.stringify([...calm].sort()) !== JSON.stringify(want)) errors.push(`${p}: the five calendar steps are not 1-5 with the owner's words: ${JSON.stringify(calm)}`);
    else if (!(order('<section class="calcal" data-calendar>') > 0 && order('<section class="calcal" data-calendar>') < order('id="calstep-5"') && order('<aside class="calside">') > order('id="calstep-5"') && order('<aside class="calside">') < order('id="calstep-1"'))) errors.push(`${p}: the calendar does not come before the steps`);
  } else if (!steps || (steps.match(/<li>/g) || []).length !== 3) errors.push(`${p}: no numbered 1-2-3 steps at the top`);
  if (/class="subnav"/.test(html)) errors.push(`${p}: the old sub-nav button row is back (the steps panel replaced it)`);
  if (/^\/admin\/money(\?|$)/.test(p) && !/data-steps-panel/.test(html)) errors.push(`${p}: no steps panel (3 steps, each with its buttons)`);
  if (/^\/admin\/calendar(\?| \(|$)/.test(p) && !/data-steps="calendar" data-steps-panel data-calm/.test(html)) errors.push(`${p}: no calm steps panel (5 steps beside the month)`);
  if (!o.home && !/class="back"|&larr; Back to main page/.test(html)) errors.push(`${p}: no Back link`);
  if (o.auth !== false && !o.print && !/href="\/admin\/help"/.test(html)) errors.push(`${p}: no link to How to use this`);
  if (o.print && !/href="\/admin\/help"/.test(html)) errors.push(`${p}: print page has no link to How to use this`);
  if (o.home && o.auth !== false) {
    // The only "More" toggle on Requests is each step card's own one (owner-approved 19 Oct 2026).
    const MORE_CARD = '<summary data-help="card.details" title="';
    // A summary's own text, or the text of its first span (the card toggle wraps Show/Hide in spans).
    const mores = [...html.matchAll(/<summary([^>]*)>(?:<span[^>]*>)?([^<]*\b[Mm]ore\b[^<]*)</g)];
    // "Show more about <first name>" (owner-approved mock-up 20 Oct 2026; Show/Hide wording 20 Oct 2026).
    for (const m of mores) if (!m[0].startsWith(MORE_CARD) || !/^Show more about (\S+|this request)$/.test(m[2])) errors.push(`${p}: a "More" toggle that is not a card's "Show more about <first name>": ${m[0].slice(0, 80)}`);
    for (const a of html.split('<article').slice(1)) {
      const card = a.slice(0, a.indexOf('</article>'));
      if (!/data-reqcard/.test(card)) continue;
      const n = (card.match(/<summary data-help="card\.details"[^>]*><span class="mshow" data-more-show>Show more about ([^<]+)<\/span><span class="mhide" data-more-hide>Hide more about \1<\/span>/g) || []).length;
      if (n !== 1) errors.push(`${p}: a request card has ${n} "More" toggles (must be exactly one)`);
      if (card.indexOf('data-next-step') < 0 || card.indexOf('data-next-step') > card.indexOf('data-details')) errors.push(`${p}: a request card's "More" comes before (or without) its next-step box`);
    }
    const DISCLOSURE_WHITELIST = ['put-away'];
    for (const m of html.matchAll(/<details\b[^>]*\bid="([^"]+)"/g)) if (!DISCLOSURE_WHITELIST.includes(m[1])) errors.push(`${p}: disclosure #${m[1]} is not on the whitelist (only the Put away section may be one)`);
    const lis = steps ? steps.split('<li>').slice(1) : [];
    const PANEL = [['See who&#39;s asking.|See who\'s asking.', ['Check for new requests', 'Find a customer', 'Open responses sheet', 'Open ID folder']],
      ['Send a quote or invoice.', ['Start a blank invoice', 'Print a blank checklist', 'Quick Pricing Summary']], ['Plan your day and get paid.', ["Today's list|Today&#39;s list", 'Calendar &amp; Bookings']]];
    PANEL.forEach(([title, labels], i) => {
      const li = lis[i] || '';
      if (!new RegExp(title).test(li)) errors.push(`${p}: step ${i + 1} of the panel is not "${title.split('|')[0]}"`);
      for (const label of labels) if (!new RegExp(`>(${label})<`).test(li)) errors.push(`${p}: "${label.split('|')[0]}" is not in step ${i + 1} of the panel`);
    });
    const pa = (html.match(/<details[^>]*id="put-away"[^>]*>/) || [])[0];
    if (!pa || !/Put away \(\d+\)/.test(html) || !/Show put-away requests/.test(html)) errors.push(`${p}: no collapsed "Put away (N)" section with "Show put-away requests"`);
    else if (Boolean(o.putAwayOpen) !== /\sopen\b/.test(pa)) errors.push(`${p}: the Put away section is ${o.putAwayOpen ? 'not opened by the old route' : 'open by default'}`);
    if (!o.direct && !/data-filters/.test(html)) errors.push(`${p}: no filter chips`);
    if (/href="\/admin\/archive"/.test(html)) errors.push(`${p}: Put away is still linked as its own page`);
    if (!/class="hint"/.test(html)) errors.push(`${p}: no visible helper lines under the actions`);
  }
}
if (!helpHtml) errors.push('/admin/help did not render');
for (const key of Object.keys(HELP)) {
  if (!helpHtml.includes(`data-help-entry="${key}"`)) errors.push(`help page has no entry for ${key} (${HELP[key].label})`);
  if (!used.has(key)) errors.push(`map entry ${key} (${HELP[key].label}) is never rendered: remove it or render it`);
}
for (const key of used) if (!helpHtml.includes(`data-help-entry="${key}"`)) errors.push(`button ${key} is missing from the help page`);
for (const [key, e] of Object.entries(HELP)) if (e.warn === '' && /delete|void|paid|deposit/i.test(key) && !/no$|undo|unvoid|see/i.test(key)) errors.push(`${key}: a money or delete action has no warning line on the help page`);
if (!/data-status-meanings/.test(helpHtml)) errors.push('help page lacks "What each status means"');
// "Hold longer" is gone everywhere (owner-approved sample, 20 Oct 2026): every admin screen and the
// help page say "Reserve their games longer"; at least one screen here carries the control.
{
  let withControl = 0;
  for (const [p, , r] of pages) {
    const t = String((r && r.text) || '');
    if (/Hold longer|Give them more time|On hold until|data-hold-longer/.test(t)) errors.push(`${p} still says "Hold longer" / "Give them more time" / "On hold until"`);
    if (/data-reserve-longer[\s\S]*?<b>Reserve their games longer<\/b><span class="ressub">Give more time to pay<\/span>[\s\S]*?data-res-new>New date: <b>/.test(t)) withControl += 1;
  }
  if (/Hold longer|Give them more time|On hold until/.test(helpHtml)) errors.push('the help page still says "Hold longer" / "Give them more time" / "On hold until"');
  if (!helpHtml.includes('Reserve their games longer')) errors.push('the help page does not explain Reserve their games longer');
  if (withControl < 1) errors.push('Rule 0: no admin screen rendered the Reserve their games longer control');
}
if (pages.length < 20 || controls < 150) errors.push(`Rule 0: only ${pages.length} screens / ${controls} controls checked`);

// A key written twice in HELP silently keeps only the last one, so the first screen shows the
// other screen's words (inv.row: the Invoices list showed the Inventory wording, 20 Oct 2026).
{
  const src = fs.readFileSync(path.join(ROOT, 'functions/_lib/helptext.mjs'), 'utf8');
  const body = src.slice(src.indexOf('export const HELP = {'));
  const keys = [...body.matchAll(/^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*H\(/gm)].map((m) => m[1] || m[2] || m[3]);
  const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  if (keys.length < 100) errors.push(`helptext.mjs: only ${keys.length} HELP keys found (the duplicate check cannot see the map)`);
  if (dupes.length) errors.push(`helptext.mjs: HELP key(s) defined more than once: ${dupes.join(', ')}`);
  if (HELP['inv.row'].screen !== 'invoice' || !HELP['invt.row'] || HELP['invt.row'].screen !== 'inventory') errors.push('the Invoices list row and the Inventory game row do not each have their own help key (inv.row / invt.row)');
}
if (errors.length) {
  console.error(`VALIDATION FAIL: admin tooltips (${errors.length})`);
  for (const e of [...new Set(errors)].slice(0, 60)) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`validate_admin_tooltips: OK (${pages.length} screens, ${controls} controls, ${used.size} map entries, all on the help page)`);
