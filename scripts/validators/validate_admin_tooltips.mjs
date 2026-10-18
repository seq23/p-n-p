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
 *  4. the Requests screen has any "More" disclosure (its menu became a visible sub-nav).
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
  ['/admin/settings'], ['/admin/help', { help: true }],
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
pages.push(['/admin/archive', {}, await s.get('/admin/archive')]);
pages.push(['/admin/search?partial=1&q=renter', { partial: true }, await s.get('/admin/search?partial=1&q=renter')]);
// A porch job (no rental) on the calendar, then done: Mark job done / Undo job done.
{
  const views = await mod('functions/_lib/views.mjs');
  const porch = { ...reqA, key: 'porch|x', name: 'Pat Porch', gamesAnswer: '', wantsRentals: false, wantsDecor: true, need: 'Porch decorating', rentals: [], decor: [], other: [] };
  const base = { requests: [porch], invoices: {}, checklists: {}, returns: {}, folderUrl: 'https://drive.google.com/x', sheetError: '', flash: '', missingPayment: [] };
  for (const st of [{ status: 'scheduled' }, { status: 'job_done', job_done_at: '2026-10-18 10:00:00' }]) {
    pages.push([`dashboardPage(${st.status})`, { home: true, direct: true }, { status: 200, text: views.dashboardPage({ ...base, statuses: { 'porch|x': st }, schedule: { 'porch|x': { date: '2026-10-24' } } }) }]);
  }
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
  const steps = (html.match(/<ol class="topsteps" data-steps="[^"]+">([\s\S]*?)<\/ol>/) || [])[1];
  if (!steps || (steps.match(/<li>/g) || []).length !== 3) errors.push(`${p}: no numbered 1-2-3 steps at the top`);
  if (!o.home && !/class="back"|&larr; Back to requests/.test(html)) errors.push(`${p}: no Back link`);
  if (o.auth !== false && !o.print && !/href="\/admin\/help"/.test(html)) errors.push(`${p}: no link to How to use this`);
  if (o.print && !/href="\/admin\/help"/.test(html)) errors.push(`${p}: print page has no link to How to use this`);
  if (o.home && o.auth !== false) {
    if (/<summary[^>]*>[^<]*\bMore\b/.test(html)) errors.push(`${p}: the Requests screen still has a "More" toggle`);
    for (const label of ['Start a blank invoice', 'Print a blank checklist', 'Check for new requests now']) {
      if (!new RegExp(`class="subnav"[\\s\\S]*${label}`).test(html)) errors.push(`${p}: "${label}" is not in the visible sub-nav`);
    }
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
