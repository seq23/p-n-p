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
 *  4. the Requests screen has any "More" disclosure, or any disclosure with an id outside the
 *     whitelist (only #put-away, the collapsed Put away section), or lacks the steps panel with
 *     each button in its owner-approved step (JOB B, 18 Oct 2026); Calendar & Bookings and Money
 *     carry the same panel; /admin/archive redirects to the opened Put away section.
 * Rule 0: fewer than 20 screens or 150 controls checked is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const { HELP } = await mod('functions/_lib/helptext.mjs');
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
await s.post('/admin/calendar/bookings', { kind: 'rental_pickup', date: '2026-01-05', return_date: '2026-01-06', customer_name: 'Late Larry', phone: '901-555-0999', email: '', place: '', items: 'Giant Uno' });
const late = await s.one("SELECT id FROM bookings WHERE customer_name = 'Late Larry' AND kind = 'rental_return'");
const pick = await s.one("SELECT id, date FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", reqA.key);
const note = await s.one('SELECT id FROM booking_notes LIMIT 1');
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

// Site-form rentals: one held (ending soon), one held by hand; a site porch job done with
// the thank-you turned off; the deposit-received screen.
const F = await mod('functions/_lib/request-form.mjs');
const dplus = (n) => { const d = new Date(`${F.chicagoToday()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const heldReq = await s.siteRequest({ service: 'rentals', games: ['giant-uno'], duration: 'day', pickup_date: dplus(12), name: 'Hana Held', phone: '901-555-0177', email: 'hana@example.com' });
await s.db.prepare("UPDATE holds SET until = datetime('now', '+2 hours') WHERE request_key = ?1").bind(heldReq.row.request_key).run();
await s.db.prepare("INSERT INTO settings (key, value) VALUES ('hold_auto_expire', '0')").run();
const handReq = await s.siteRequest({ service: 'rentals', games: ['giant-checkers'], duration: 'day', pickup_date: dplus(13), name: 'Hal Hand', phone: '901-555-0178', email: 'hal@example.com' });
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
  ['/admin/invoices'], ['/admin/invoices/new'], [`/admin/invoices/new?r=${s.rk(reqA.key)}`],
  [`/admin/invoices/${invA.id}`], [`/admin/invoices/${invB.id}`], [`/admin/invoices/${draftWithEmail.id}`], [`/admin/invoices/${v.id}`], [`/admin/invoices/${paidInv.id}`], [`/admin/invoices/${invA.id}/edit`],
  ['/admin/settings'], ['/admin/help', { help: true }], ['/admin/packages'],
  [`/admin/confirmed?r=${s.rk(heldReq.row.request_key)}&m=Deposit%20received&back=/admin/`],
  [`/admin/checklist/online?r=${s.rk(reqA.key)}`], ['/admin/checklist', { print: true }], [`/admin/checklist?r=${s.rk(reqA.key)}`, { print: true }],
  ['/admin/search'], ['/admin/search?q=renter'], ['/admin/search?q=zzzz'],
  ['/admin/nothing-here'],
  ['/admin/money'], ['/admin/money?month=2026-10'], ['/admin/money/year?year=2026'], ['/admin/money/expenses/new'],
  [`/admin/money/expenses/${up1.json.id}`], [`/admin/money/expenses/${up2.json.id}`],
  ...['received', 'owed', 'jobs', 'expenses', 'deposits', 'category:rentals'].map((w) => [`/admin/money/detail?month=2026-10&what=${w}`]),
];
// Archive one so Put away has rows (after the dashboard renders above are collected below).
const pages = [...early];
for (const [p, o = {}] of screens) pages.push([p, o, await s.get(p, { auth: o.auth !== false })]);
await s.post('/admin/requests/archive', { r: s.rk(reqB.key) });
{
  const old = await s.get('/admin/archive');
  if (old.status !== 303 || old.location !== '/admin/?pa=1#put-away') errors.push(`/admin/archive must redirect to /admin/?pa=1#put-away (got ${old.status} ${old.location})`);
  pages.push(['/admin/?pa=1', { home: true, putAwayOpen: true }, await s.get('/admin/?pa=1')]);
  pages.push(['/admin/?f=porch', { home: true }, await s.get('/admin/?f=porch')]);
  pages.push(['/admin/?f=unpaid', { home: true }, await s.get('/admin/?f=unpaid')]);
}
pages.push(['/admin/search?partial=1&q=renter', { partial: true }, await s.get('/admin/search?partial=1&q=renter')]);
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
  }
  pages.push(['dashboardPage(grazing+party scheduled, one put away)', { home: true, direct: true }, { status: 200, text: views.dashboardPage({ ...base, requests: [graze, party, { ...reqA, key: 'rent|x', name: 'Rae Rent', services: ['rentals'] }], archived: [{ ...porch, key: 'old|x' }],
    statuses: { 'graze|x': { status: 'scheduled' }, 'party|x': { status: 'scheduled' }, 'rent|x': { status: 'deposit_paid' }, 'old|x': { status: 'paid', archived_at: '2026-10-01 10:00:00' } },
    schedule: { 'graze|x': { date: '2026-10-24' }, 'party|x': { date: '2026-10-25' } }, kinds: { 'graze|x': ['grazing_setup'], 'party|x': ['party_setup'] }, foodPerHead: { low: 12, high: 18 } }) }]);
}

const used = new Set();
let controls = 0;
let helpHtml = '';
for (const [p, o, res] of pages) {
  if (res.status >= 500 || (res.status !== 200 && res.status !== 404)) { errors.push(`${p} answered ${res.status}`); continue; }
  const html = res.text;
  if (o.help) helpHtml = html;
  const tags = html.match(/<(a|button|summary)\b[^>]*>|<label\b[^>]*class="btn[^"]*"[^>]*>|<(?:input|div|span)\b[^>]*data-help="[^"]*"[^>]*>/g) || [];
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
  if (!steps || (steps.match(/<li>/g) || []).length !== 3) errors.push(`${p}: no numbered 1-2-3 steps at the top`);
  if (/class="subnav"/.test(html)) errors.push(`${p}: the old sub-nav button row is back (the steps panel replaced it)`);
  if (/^\/admin\/(calendar|money)(\?|$)/.test(p) && !/data-steps-panel/.test(html)) errors.push(`${p}: no steps panel (3 steps, each with its buttons)`);
  if (!o.home && !/class="back"|&larr; Back to requests/.test(html)) errors.push(`${p}: no Back link`);
  if (o.auth !== false && !o.print && !/href="\/admin\/help"/.test(html)) errors.push(`${p}: no link to How to use this`);
  if (o.print && !/href="\/admin\/help"/.test(html)) errors.push(`${p}: print page has no link to How to use this`);
  if (o.home && o.auth !== false) {
    if (/<summary[^>]*>[^<]*\bMore\b/.test(html)) errors.push(`${p}: the Requests screen still has a "More" toggle`);
    const DISCLOSURE_WHITELIST = ['put-away'];
    for (const m of html.matchAll(/<details\b[^>]*\bid="([^"]+)"/g)) if (!DISCLOSURE_WHITELIST.includes(m[1])) errors.push(`${p}: disclosure #${m[1]} is not on the whitelist (only the Put away section may be one)`);
    const lis = steps ? steps.split('<li>').slice(1) : [];
    const PANEL = [['See who&#39;s asking.|See who\'s asking.', ['Check for new requests', 'Find a customer', 'Open responses sheet', 'Open ID folder']],
      ['Send a quote or invoice.', ['Start a blank invoice', 'Print a blank checklist', 'Porch packages']], ['Plan your day and get paid.', ["Today's list|Today&#39;s list", 'Calendar &amp; Bookings']]];
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
if (pages.length < 20 || controls < 150) errors.push(`Rule 0: only ${pages.length} screens / ${controls} controls checked`);

if (errors.length) {
  console.error(`VALIDATION FAIL: admin tooltips (${errors.length})`);
  for (const e of [...new Set(errors)].slice(0, 60)) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`validate_admin_tooltips: OK (${pages.length} screens, ${controls} controls, ${used.size} map entries, all on the help page)`);
