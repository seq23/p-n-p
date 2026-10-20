#!/usr/bin/env node
/**
 * The takedown gates Finished (owner, live bug 18 Oct 2026: a porch/party customer who asked
 * for a takedown read as Finished, with "Put it away?", before the takedown had happened; the
 * old Google Form's "Takedown date" answer was dropped; the IDs box sat above the cards).
 *
 * Fails when:
 *  1. a request whose customer asked for a takedown (plan scheduled / not_sure, the takedown
 *     add-on on the invoice, or a takedown booking) is Finished, shows "Put it away?" or the
 *     Finished chip before the takedown booking is marked done, or "customer will handle it";
 *     or a request that never asked is held back; or after Job done the inline row's Save is
 *     not the next step (not booked) / its one-tap "Mark takedown done" not the primary (booked, any day);
 *     or the progress line lacks the takedown sub-step;
 *  2. the old form's "Need us to take it down afterwards?" + "Takedown date" or the /request
 *     form's answer does not map at source into takedown_plan (+ date), or a yes with NO date books anything;
 *  3. the backfill plan is not idempotent, or overrides the owner's later choice;
 *  4. Calendar & Bookings, the Day sheet, the Monday summary or the booking screen prefill miss
 *     a requested takedown; "Mark takedown done" is refused before the takedown day;
 *  5. "IDs ready to delete" is not the very last box of Requests (after Put away).
 * Rule 0: fewer than 60 checks is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const TD = await mod('functions/_lib/takedown.mjs');
const PG = await mod('functions/_lib/progress.mjs');
const K = await mod('functions/_lib/cards.mjs');
const V = await mod('functions/_lib/views.mjs');
const RQ = await mod('functions/_lib/requests.mjs');
const W = await mod('functions/_lib/weekly.mjs');
const TODO = await mod('functions/_lib/todo-email.mjs');
const fixture = (await mod('data/admin/fixture-request.json')).default;
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const bigBtns = (h) => (String(h).replace(/<div class="confirmbox">[\s\S]*?<\/details>/g, '').match(/class="btn primary"/g) || []).length;

// ---- 1. Finished gating, every takedown state, porch and party ------------------------------
const paid = { status: 'paid', balance: { total: 50000, paid: 50000, remaining: 0, owed: 0, refundable: 0, void: false } };
const install = (svc) => ({ id: 1, kind: svc === 'porch' ? 'porch_install' : 'party_setup', date: '2026-10-17' });
const tdKind = (svc) => `${svc}_takedown`;
const STATES = [
  // [label, plan, invoiceTakedown, takedown booking, today, expected status, finished]
  ['never asked', '', false, null, '2026-10-18', 'none', true],
  ['customer handles', 'customer_handles', false, null, '2026-10-18', 'customer_handles', true],
  ['customer handles despite the add-on', 'customer_handles', true, null, '2026-10-18', 'customer_handles', true],
  ['asked, not booked', 'scheduled', false, null, '2026-10-18', 'to_schedule', false],
  ['not sure', 'not_sure', false, null, '2026-10-18', 'not_sure', false],
  ['add-on on the invoice only', '', true, null, '2026-10-18', 'to_schedule', false],
  ['booked, before its day', 'scheduled', false, { id: 2, date: '2026-10-20' }, '2026-10-18', 'booked', false],
  ['booked, its day', 'scheduled', false, { id: 2, date: '2026-10-18' }, '2026-10-18', 'due', false],
  ['booked, after its day', 'scheduled', false, { id: 2, date: '2026-10-16' }, '2026-10-18', 'due', false],
  ['booked and done', 'scheduled', false, { id: 2, date: '2026-10-18', done_at: '2026-10-18 20:00:00' }, '2026-10-18', 'done', true],
  ['booked although the customer handles it', 'customer_handles', false, { id: 2, date: '2026-10-18' }, '2026-10-18', 'due', false],
];
for (const svc of ['porch', 'party']) {
  for (const [label, plan, invTd, tb, today, status, finished] of STATES) {
    const tag = `${svc} / ${label}`;
    const bookings = [install(svc), ...(tb ? [{ ...tb, kind: tdKind(svc) }] : [])];
    const td = TD.takedownState({ services: [svc], takedownPlan: plan, takedownDate: plan === 'scheduled' ? '2026-10-18' : '', invoiceTakedown: invTd, bookings, today });
    must(td.status === status, `${tag}: takedown status ${td.status}, expected ${status}`);
    const st = { status: 'paid', job_done_at: '2026-10-17 18:00:00', invoice_id: 7 };
    const pr = PG.deriveProgress({ st, inv: paid, scheduled: true, takedown: td });
    must(pr.finished === finished, `${tag}: Finished is ${pr.finished}, expected ${finished}`);
    const stage = K.cardStage({ pr, inv: paid });
    must(stage === (finished ? 'finished' : 'job_done'), `${tag}: stage ${stage}`);
    const rules = K.cardButtons({ services: [svc], stage, inv: paid, sched: true, kinds: bookings.map((b) => b.kind), jobDoneAt: true, takedownPlan: plan, takedown: td, paidFull: true });
    // The inline row (owner, 18 Oct 2026): not booked -> its Save is the next step (no separate
    // primary); booked -> its one-tap Mark takedown done IS the primary, before the day too.
    const wantPrimary = finished ? 'card.archive' : ({ to_schedule: '', not_sure: '', due: 'td.markDone', booked: 'td.markDone' })[status];
    must(rules.primary === wantPrimary, `${tag}: primary "${rules.primary}", expected "${wantPrimary}"`);
    if (status === 'booked') {
      const w = K.cardWaiting({ services: [svc], stage, primary: rules.primary, jobDoneAt: true, dates: { eventReached: true }, takedown: td });
      must(!w, `${tag}: a "Next:" line waits for the takedown day instead of the one-tap button`);
    }
    // The real card.
    const r = { key: `k|${svc}|${label}`, name: 'Ann Example', services: [svc], need: svc, wantsDecor: true, wantsRentals: false, gamesAnswer: '', rentals: [], decor: [{ label: 'Event date', value: '10/17/2026' }], other: [],
      takedownPlan: plan, takedownDate: plan === 'scheduled' ? '2026-10-18' : '', takedownNote: '' };
    const html = V.requestCard(r, { st, inv: { ...paid, id: 7, total_cents: 50000 }, sched: { date: '2026-10-17' }, kinds: bookings.map((b) => b.kind), bookings, today, invoiceTakedown: invTd });
    must(/data-put-away-prompt/.test(html) === finished, `${tag}: "Put it away?" ${finished ? 'missing' : 'shown before the takedown is resolved'}`);
    must(/Finished: job done and paid/.test(html) === finished, `${tag}: Finished chip ${finished ? 'missing' : 'shown'}`);
    // Step cards (19 Oct 2026): the takedown is its own named step after Setup / Install done:
    // ticked when done ("Takedown done") or not needed ("Takedown: not needed"), else it is THE
    // current step (job done and paid, takedown still open).
    if (status !== 'none') {
      const li = html.match(/<li class="([duc])" data-step="takedown"([^>]*)><span class="ck"[^>]*>([^<]*)<\/span><span class="t">([^<]*)/) || [];
      const wantDone = status === 'done' || status === 'customer_handles';
      const wantLabel = status === 'customer_handles' ? 'Takedown: not needed' : 'Takedown done';
      must(li[1] === (wantDone ? 'd' : 'c') && li[4] === wantLabel && (li[3] === '✓') === wantDone && /data-step-current/.test(li[2] || '') === !wantDone
        && html.indexOf('data-step="takedown"') > html.indexOf('data-step="setup"'), `${tag}: the takedown step is not ${wantDone ? `ticked as "${wantLabel}"` : 'the current step'} right after the setup step (${li.slice(1).join(' | ')})`);
    }
    if (status === 'to_schedule' && plan === 'scheduled') must(/data-takedown-row="open"[\s\S]*Asked for, not booked yet[\s\S]*name="date" value="2026-10-18"[\s\S]*class="btn primary" type="submit" name="go" value="save"/.test(html) && !/calendar\/new\?r=[^"]*_takedown/.test(html), `${tag}: no inline Takedown row with the asked-for day (Sun 18 Oct) and Save as the big button`);
    if (status === 'booked' || status === 'due') must(/data-takedown-row="booked"[\s\S]*data-takedown-booked="2026-10-(20|18|16)"/.test(html) && /Booked for (Tue 20|Sun 18|Fri 16) Oct/.test(html) && (html.match(/data-takedown-done-tap/g) || []).length === 1 && bigBtns(html) === 1, `${tag}: the booked row lacks "Booked for …" + exactly one one-tap Mark takedown done (and one big button)`);
    if (status === 'due') must(/action="\/admin\/calendar\/bookings\/2\/takedown-done"/.test(html) && /class="btn primary"[^>]*>Mark takedown done/.test(html), `${tag}: "Mark takedown done" is not the big button`);
  }
}
// Not paid yet + takedown open: still not Finished, and never more than one big button.
{
  const td = TD.takedownState({ services: ['porch'], takedownPlan: 'scheduled', bookings: [{ id: 1, kind: 'porch_install', date: '2026-10-17' }], today: '2026-10-18' });
  const pr = PG.deriveProgress({ st: { status: 'job_done', job_done_at: 'x' }, inv: { status: 'sent', balance: { total: 100, paid: 50, remaining: 50, owed: 50 } }, scheduled: true, takedown: td });
  must(!pr.finished && K.cardStage({ pr, inv: {} }) === 'job_done', 'job done, not paid, takedown open: not job_done');
  must(TD.takedownState({ services: ['rentals'], takedownPlan: 'scheduled', today: '2026-10-18' }).status === 'none', 'a rental can have a takedown');
  must(TD.takedownState({ services: ['grazing'], takedownPlan: 'scheduled', today: '2026-10-18' }).status === 'none', 'a grazing pickup gates Finished');
}

// ---- 2. Mapping at source ------------------------------------------------------------------
for (const [answer, plan] of [['Yes', 'scheduled'], ['yes please', 'scheduled'], ['No', 'customer_handles'], ['Not sure', 'not_sure'], ['Not sure yet', 'not_sure'], ['Maybe', 'not_sure'], ['', ''],
  ['Yes, take it down (from $75)', 'scheduled'], ["No, I'll handle it", 'customer_handles']]) {
  must(TD.planFromAnswer(answer) === plan, `answer "${answer}" maps to "${TD.planFromAnswer(answer)}", expected "${plan}"`);
}
{
  const [headers] = fixture.values;
  const row = (over) => headers.map((h) => (h in over ? over[h] : ''));
  const base = { Timestamp: '10/1/2026 9:00:00', 'Email Address': 'a@example.com', 'Full name': 'Old Form', 'Phone number': '901-555-0000', 'What do you need?': 'Event decor', 'Event type': 'Birthday party', 'Event date': '10/17/2026', 'Also need decor?': 'Yes' };
  const yes = RQ.importRowFor(headers, row({ ...base, 'Need us to take it down afterwards?': 'Yes', 'Takedown date': '10/18/2026' }));
  must(yes && yes.takedown_plan === 'scheduled' && yes.takedown_date === '2026-10-18', `old form yes + Takedown date did not map to scheduled 2026-10-18 (got ${yes && yes.takedown_plan} ${yes && yes.takedown_date})`);
  const ns = RQ.importRowFor(headers, row({ ...base, 'Need us to take it down afterwards?': 'Not sure', 'Takedown date': '10/18/2026' }));
  must(ns && ns.takedown_plan === 'not_sure' && ns.takedown_date === '', 'old form "Not sure" did not map to not_sure (no date)');
  const no = RQ.importRowFor(headers, row({ ...base, 'Need us to take it down afterwards?': 'No' }));
  must(no && no.takedown_plan === 'customer_handles', 'old form "No" did not map to customer_handles');
  for (const na of ['na', 'n/a', '']) {
    const d = RQ.importRowFor(headers, row({ ...base, 'Need us to take it down afterwards?': na, 'Takedown date': '10/18/2026' }));
    must(d && d.takedown_plan === 'scheduled' && d.takedown_date === '2026-10-18', `old form "${na}" + a Takedown date did not read as a takedown asked for 2026-10-18`);
  }
  const noDate = RQ.importRowFor(headers, row({ ...base, 'Need us to take it down afterwards?': 'No', 'Takedown date': '10/18/2026' }));
  must(noDate && noDate.takedown_plan === 'customer_handles' && noDate.takedown_date === '', 'an explicit "No" lost to a stray Takedown date');
  const blank = RQ.importRowFor(headers, row(base));
  must(blank && blank.takedown_plan === null && blank.takedown_date === '', 'old form with no takedown answer was given a plan');
  // Read back through fromRow, the card shows the prompt dated Sun 18 Oct and is not Finished.
  const r = RQ.fromRow({ ...yes, takedown_note: '' });
  must(r.takedownPlan === 'scheduled' && r.takedownDate === '2026-10-18', 'fromRow lost the takedown plan/date');
  const html = V.requestCard(r, { st: { status: 'paid', job_done_at: '2026-10-17 18:00:00' }, sched: { date: '2026-10-17' }, kinds: ['party_setup'], bookings: [{ id: 1, kind: 'party_setup', date: '2026-10-17' }], today: '2026-10-18' });
  must(/data-takedown-row="open"[\s\S]*name="date" value="2026-10-18"/.test(html) && !/data-put-away-prompt/.test(html) && /data-stage="job_done"/.test(html), 'an imported old-form request with takedown 18 Oct does not show the inline row on 18 Oct, or reads as Finished');
}

// ---- 3. Backfill: idempotent, never over the owner's choice --------------------------------
{
  const mk = (key, plan, answer, date, svc = 'porch') => ({ key, services: [svc], takedownPlan: plan, takedownDate: '', takedownAnswer: answer, rentals: [], decor: date ? [{ label: 'Takedown date', value: date }] : [], other: [] });
  const rows = [mk('a', '', 'Yes', '10/18/2026'), mk('b', '', 'Not sure'), mk('c', '', 'No'), mk('d', 'customer_handles', 'Yes', '10/18/2026'), mk('e', '', 'Yes', '', 'rentals'), mk('f', 'scheduled', 'Yes', '10/20/2026'), mk('g', '', '')];
  const p1 = TD.backfillPlan(rows);
  const by = Object.fromEntries(p1.map((p) => [p.key, p]));
  must(by.a && by.a.plan === 'scheduled' && by.a.date === '2026-10-18', 'backfill: yes + date not mapped');
  must(by.b && by.b.plan === 'not_sure' && by.c && by.c.plan === 'customer_handles', 'backfill: not sure / no not mapped');
  must(!by.d, 'backfill overrode the owner\'s "customer will handle it"');
  must(!by.e && !by.g, 'backfill mapped a rental or a request with no answer');
  must(by.f && by.f.plan === 'scheduled' && by.f.date === '2026-10-20', 'backfill: an existing scheduled plan did not get its form date');
  const applied = rows.map((r) => (by[r.key] ? { ...r, takedownPlan: by[r.key].plan || '', takedownDate: by[r.key].date } : r));
  must(TD.backfillPlan(applied).length === 0, 'backfill is not idempotent: a second run still writes');
  must(TD.backfillPlan(rows, new Set(rows.map((r) => r.key))).length === 0, 'backfill touches a request that already has a takedown event');
  // The owner's "Change" (plan back to '') is never re-filled by the card from the old answer.
  must(TD.takedownState({ services: ['porch'], takedownPlan: '', today: '2026-10-18' }).status === 'none', 'an asked-again takedown is read back from the form answer');
}

// ---- 4. Calendar & Bookings, Day sheet, Monday summary, prefill, Mark takedown done ---------
const s = await session();
const today = s.util.todayISO();
const plus = (n) => s.util.todayISO(n);
const req = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'yes', event_date: plus(2), location: 'Germantown', name: 'Dee Takedown', phone: '901-555-0903', email: 'dee.takedown@example.com' });
must(req.status === 303 && req.row && req.row.takedown_plan === 'scheduled' && req.row.takedown_date === '', '/request "yes" did not store scheduled (and no date of its own)');
must(!(await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind = 'porch_takedown'", req.row.request_key)), 'a takedown yes created a booking by itself');
const tdDay = plus(3);
await s.db.prepare('UPDATE requests SET takedown_date = ?2 WHERE request_key = ?1').bind(req.row.request_key, tdDay).run();
const rk = s.rk(req.row.request_key);
const boxOf = (html) => (html.includes('data-takedowns-to-schedule') ? html.slice(html.indexOf('data-takedowns-to-schedule'), html.indexOf('</section>', html.indexOf('data-takedowns-to-schedule'))) : '');
const cal = (await s.get('/admin/calendar')).text;
const box = boxOf(cal);
must(/Dee Takedown/.test(box) && new RegExp(`kind=porch_takedown&amp;date=${tdDay}`).test(box), 'Calendar & Bookings has no "Takedowns to schedule" entry with the date prefilled');
must(cal.indexOf('data-takedowns-to-schedule') < cal.indexOf('id="still-to-decide"') || !/id="still-to-decide"/.test(cal), '"Takedowns to schedule" is not at the top of Calendar & Bookings');
const day = (await s.get(`/admin/day/${tdDay}`)).text;
must(/Dee Takedown/.test(boxOf(day)), 'the Day sheet for the takedown day does not list the takedown to schedule');
must(!/Dee Takedown/.test(boxOf((await s.get(`/admin/day/${plus(5)}`)).text)), 'another day lists the takedown to schedule');
const wk = await W.weeklyData(s.db, today, Date.now());
must((wk.needs.takedownsToSchedule || []).some((x) => /^Dee T\./.test(x)), 'the Monday summary "Needs you" misses the takedown to schedule');
{
  const ST = await mod('functions/_lib/steps.mjs');
  const dee = (await TODO.todoData(s.db, today, Date.now()));
  const deeKey = (dee.sections[2].find((x) => /^Dee T\./.test(x.t)) || {}).key;
  must(deeKey && !dee.sections[4].some((x) => x.key === deeKey), 'before the call back, the takedown to schedule is not part of "Call these people back" (it shows in Book it or decide)');
  if (deeKey) await ST.markCalled(s.db, deeKey, { how: 'test' });
  const tdd = await TODO.todoData(s.db, today, Date.now());
  if (deeKey) await ST.undoCalled(s.db, deeKey);
  const row = tdd.sections[4].find((x) => x.type === 'takedown' && /^Dee T\. · porch takedown$/.test(x.t));
  must(row && row.btns.map((b) => b.label).join() === 'Schedule takedown,Not needed' && /data-section="4"[\s\S]*Dee T\. · porch takedown[\s\S]*Schedule takedown/.test(TODO.renderTodo(tdd).html), 'the daily to-do email has no "Schedule takedown" line for the takedown to schedule');
}
const form = (await s.get(`/admin/calendar/new?r=${rk}&kind=porch_takedown`)).text;
must(new RegExp(`name="date"[^>]*value="${tdDay}"|value="${tdDay}"[^>]*name="date"`).test(form), 'Schedule takedown does not prefill the requested takedown date');
// Book it (she confirms), then Mark takedown done is refused before its day and works on it.
await s.post('/admin/calendar/bookings', { r: rk, kind: 'porch_takedown', date: tdDay, customer_name: 'Dee Takedown', phone: '', email: '', place: '', items: 'Porch' });
const tb = await s.one("SELECT id, done_at FROM bookings WHERE request_key = ?1 AND kind = 'porch_takedown'", req.row.request_key);
must(tb && !tb.done_at, 'booking the takedown did not make one booking');
must(!/Dee Takedown/.test(boxOf((await s.get('/admin/calendar')).text)), 'a booked takedown is still in "Takedowns to schedule"');
// One tap, ANY day (owner, 18 Oct 2026): before the takedown day it works too, and comes back to the card.
const early = await s.post(`/admin/calendar/bookings/${tb.id}/takedown-done`, {});
must(!/e=/.test(early.location) && new RegExp(`#c-${rk}$`).test(early.location) && Boolean((await s.one('SELECT done_at FROM bookings WHERE id = ?1', tb.id)).done_at), 'Mark takedown done before the takedown day was refused, or did not come back to the card');
await s.post(`/admin/calendar/bookings/${tb.id}/takedown-done`, { undo: '1' });
must(!(await s.one('SELECT done_at FROM bookings WHERE id = ?1', tb.id)).done_at, 'Undo takedown done (before the day) did not undo');
await s.db.prepare('UPDATE bookings SET date = ?2 WHERE id = ?1').bind(tb.id, today).run();
must(/Mark takedown done/.test((await s.get(`/admin/day/${today}`)).text), 'the Day sheet has no "Mark takedown done" on the takedown day');
await s.post(`/admin/calendar/bookings/${tb.id}/takedown-done`, {});
must(Boolean((await s.one('SELECT done_at FROM bookings WHERE id = ?1', tb.id)).done_at), 'Mark takedown done on its day did not save');
must(/Takedown done ✓/.test((await s.get(`/admin/day/${today}`)).text), 'the Day sheet does not show Takedown done ✓');
await s.post(`/admin/calendar/bookings/${tb.id}/takedown-done`, { undo: '1' });
must(!(await s.one('SELECT done_at FROM bookings WHERE id = ?1', tb.id)).done_at, 'Undo takedown done did not undo');

// ---- 5. IDs ready to delete: the very last box of Requests ----------------------------------
{
  const page = V.dashboardPage({ requests: [], statuses: {}, folderUrl: 'https://drive.google.com/x', sheetError: '', flash: '', idsBox: '<section class="card" data-ids-ready><h2>IDs ready to delete</h2></section>', archived: [] });
  const ids = page.indexOf('data-ids-ready'); const pa = page.indexOf('data-put-away');
  must(ids > 0 && pa > 0 && ids > pa, 'IDs ready to delete is not after the Put away section');
  must(!/<section class="card" data-/.test(page.slice(ids + 20).replace(/<template[\s\S]*$/, '')), 'a box follows IDs ready to delete');
  const live = (await s.get('/admin/')).text;
  if (live.includes('data-ids-ready')) must(live.indexOf('data-ids-ready') > live.indexOf('data-put-away'), 'on the live route, IDs ready to delete is above Put away');
}

if (checks < 60) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: admin takedown (${errors.length})\n${errors.map((e) => `- ${e}`).join('\n')}`); process.exit(1); }
console.log(`validate_admin_takedown: OK (${checks} checks: Finished gated by every takedown state, porch + party; old + new form mapping; backfill idempotent; Takedowns to schedule on Calendar, Day sheet, Monday summary; prefill; one-tap Mark takedown done any day; IDs box last)`);
