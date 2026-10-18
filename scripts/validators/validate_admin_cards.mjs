#!/usr/bin/env node
/**
 * Request cards + admin homepage (JOB B, owner-approved 18 Oct 2026).
 *  1. Rules table coverage: every service x stage gives exactly the buttons the owner set
 *     (rentals never porch/takedown/walk-through; porch/party walk-through + takedown;
 *     grazing guest count + food estimate + optional pickup; void/finished/put away only
 *     Bring back / Put away; one primary button on every live card).
 *  2. Colours map: each badge uses the service's bar and tint from kinds.mjs, with words.
 *  3. Filter chips and the Put away section (same filters, Bring back on each).
 *  4. Not paid yet math: sent and owed only, damage deposits never owed, void never, drafts
 *     apart, most overdue first, the total; the Money list end to end, the Requests chip, the
 *     one-tap email reminder logging reminded_at, the sms: reminder text.
 *  5. Contextual scheduling links: "Schedule takedown" opens the booking screen on that kind.
 * Rule 0: fewer than 150 checks is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const K = await mod('functions/_lib/cards.mjs');
const V = await mod('functions/_lib/views.mjs');
const NP = await mod('functions/_lib/notpaid.mjs');
const { SERVICE_KINDS } = await mod('functions/_lib/kinds.mjs');
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

// ---- 1. the rules table --------------------------------------------------------------
const SINGLE = [['porch'], ['party'], ['grazing'], ['rentals'], ['porch', 'rentals'], ['party', 'grazing', 'rentals']];
const NEVER_RENTAL = ['card.checklist', 'card.printChecklist', 'card.schedInstall', 'card.schedTakedown', 'card.schedSetup', 'card.schedGrazingPickup', 'card.jobDone', 'card.undoJobDone'];
const firstKind = { porch: 'porch_install', party: 'party_setup', grazing: 'grazing_setup', rentals: 'rental_pickup' };
for (const services of SINGLE) {
  for (const stage of K.STAGES) {
    for (const booked of [false, true]) {
      const kinds = booked ? services.map((k) => firstKind[k]) : [];
      const inv = ['new'].includes(stage) ? null : { id: 1, status: stage === 'draft' ? 'draft' : 'sent' };
      const out = K.cardButtons({ services, stage, inv, kinds, sched: booked, returned: false, jobDoneAt: stage === 'job_done' });
      const all = [out.primary, ...out.secondary].filter(Boolean).map((x) => x.split('|')[0]);
      const tag = `${services.join('+')} @ ${stage}${booked ? ' (booked)' : ''}`;
      if (services.length === 1 && services[0] === 'rentals') for (const k of NEVER_RENTAL) must(!all.includes(k), `${tag}: a rental shows ${k}`);
      if (!services.includes('porch') && !services.includes('party')) must(!all.includes('card.schedTakedown'), `${tag}: takedown shown without porch or party`);
      if (!services.includes('grazing')) must(!all.includes('card.schedGrazingPickup'), `${tag}: grazing pickup shown without grazing`);
      if (stage === 'void') must(out.primary === 'pay.unvoid' && out.secondary.join() === 'card.archive', `${tag}: void must show only Bring back + Put away (got ${all})`);
      else if (stage === 'finished') must(out.primary === 'card.archive' && !out.secondary.length, `${tag}: finished must show only Put away (got ${all})`);
      else if (stage === 'archived') must(out.primary === 'pa.bringBack' && !out.secondary.length, `${tag}: put away must show only Bring back (got ${all})`);
      else {
        must(Boolean(out.primary), `${tag}: no primary button`);
        must(out.secondary.includes('card.archive'), `${tag}: no Put away in the secondary row`);
        const decor = services.some((k) => k !== 'rentals');
        must(!decor || (all.includes('card.checklist') && all.includes('card.printChecklist')), `${tag}: porch/party/grazing lacks the walk-through checklist`);
        if (booked) {
          for (const k of services.filter((x) => x === 'porch' || x === 'party')) {
            for (const plan of ['', 'not_sure', 'customer_handles', 'scheduled']) {
              const o2 = K.cardButtons({ services, stage, inv, kinds, sched: true, takedownPlan: plan });
              const has = o2.secondary.includes(`card.schedTakedown|${k}_takedown`);
              must(plan === 'scheduled' ? has : !has, `${tag}: takedown plan "${plan}" ${plan === 'scheduled' ? 'lacks' : 'shows'} the Schedule takedown button`);
              const box = K.takedownChoice({ services, kinds, takedownPlan: plan, stage });
              must(box === ({ '': 'ask', not_sure: 'not_sure', customer_handles: 'customer_handles', scheduled: '' })[plan], `${tag}: takedown box for plan "${plan}" is "${box}"`);
            }
          }
        }
        if (booked && services.includes('grazing')) must(out.secondary.includes('card.schedGrazingPickup|grazing_pickup'), `${tag}: no optional grazing pickup once the setup is booked`);
        if (!booked) must(!all.includes('card.schedTakedown') && !all.includes('card.schedGrazingPickup'), `${tag}: the second booking is offered before the first`);
      }
    }
  }
}
// The primary is the NEXT step.
const P = (services, stage, extra = {}) => K.cardButtons({ services, stage, inv: stage === 'new' ? null : { id: 1, status: 'sent' }, ...extra }).primary;
must(P(['porch'], 'new') === 'card.createInvoice', 'new: primary is not Create invoice');
must(P(['porch'], 'draft') === 'card.openInvoice', 'draft: primary is not Open invoice');
must(P(['porch'], 'invoiced') === 'pay.deposit' && P(['porch'], 'invoiced', { plan: 'full' }) === 'pay.paid', 'invoiced: primary is not the deposit (or paid in full on a full plan)');
must(P(['porch'], 'deposit_paid') === 'card.schedInstall|porch_install', 'porch deposit paid: primary is not Schedule install');
must(P(['party'], 'deposit_paid') === 'card.schedSetup|party_setup' && P(['grazing'], 'deposit_paid') === 'card.schedSetup|grazing_setup', 'party/grazing deposit paid: primary is not Schedule setup');
must(P(['rentals'], 'deposit_paid') === 'card.schedPickup|rental_pickup', 'rentals deposit paid: primary is not Schedule pickup + return');
must(P(['porch'], 'scheduled', { sched: true, kinds: ['porch_install'] }) === 'card.jobDone' && P(['rentals'], 'scheduled', { sched: true }) === 'ret.mark', 'scheduled: primary is not Mark job done / Mark returned');
must(P(['porch'], 'job_done', { jobDoneAt: true }) === 'pay.paid', 'job done: primary is not Mark paid in full');
// Stage: the next step, and a hand-run job without an invoice is not stuck on money.
const PG = await mod('functions/_lib/progress.mjs');
const stageOf = (st, inv, scheduled) => K.cardStage({ pr: PG.deriveProgress({ st, inv, scheduled }), inv });
must(stageOf({ status: 'new' }, null, false) === 'new', 'stage: new');
must(stageOf({ status: 'new' }, { status: 'draft', balance: { total: 100, paid: 0, remaining: 100 } }, true) === 'draft', 'stage: a site rental with a draft invoice and bookings must still ask to send the invoice');
must(stageOf({ status: 'scheduled' }, null, true) === 'scheduled', 'stage: a job scheduled by hand with no invoice');
must(stageOf({ status: 'void' }, null, false) === 'void', 'stage: void');

// ---- 2. colours map + card render ------------------------------------------------------
const base = { source: 'site', rentals: [], decor: [], other: [], phone: '901-555-0100', email: 'x@example.com' };
const mk = (key, name, services, decor = [], rentals = []) => ({ ...base, key, name, services, decor, rentals, wantsRentals: services.includes('rentals'), wantsDecor: services.some((k) => k !== 'rentals'), gamesAnswer: services.includes('rentals') ? 'Giant Uno' : '' });
const reqs = [
  mk('p', 'Pat Porch', ['porch'], [{ label: 'Event date', value: '2026-10-24' }, { label: 'Location (hotel name, address or neighborhood)', value: 'Germantown' }]),
  mk('y', 'Pia Party', ['party']),
  mk('g', 'Gia Graze', ['grazing'], [{ label: 'How many guests?', value: '15–40' }, { label: 'Should we source the food?', value: 'Yes, include food in my quote' }]),
  mk('r', 'Rae Rent', ['rentals'], [], [{ label: 'Pickup date', value: '2026-10-23' }]),
];
const owing = { id: 9, status: 'sent', total_cents: 50000, deposit_due_cents: 25000, pay_plan: 'half', balance: { total: 50000, charges: 50000, paid: 0, owed: 50000, remaining: 50000, refundable: 0, void: false } };
const html = V.dashboardPage({ requests: reqs, statuses: { r: { status: 'invoiced', invoice_id: 9 } }, invoices: { 9: owing }, folderUrl: 'https://drive.google.com/x', sheetError: '', flash: '', missingPayment: [], foodPerHead: { low: 12, high: 18 },
  archived: [mk('old', 'Olive Old', ['rentals']), mk('old2', 'Otto Old', ['porch'])], statuses2: {} });
for (const [k, s] of Object.entries(SERVICE_KINDS)) {
  const label = K.serviceBadge(k).label;
  must(new RegExp(`<span class="svc" data-service="${k}" style="border-color:${s.bar};background:${s.tint}">${label.replace('&', '&amp;')}</span>`).test(html), `${k}: the badge does not use the ${s.color} bar/tint with the words "${label}"`);
}
const card = (h, name) => { const i = h.indexOf(`>${name}</h3>`); const a = h.lastIndexOf('<article', i); return i < 0 ? '' : h.slice(a, h.indexOf('</article>', i)); };
const pc = card(html, 'Pat Porch');
must(/border-left-color:#c2410c/.test(pc), 'porch card has no orange left border');
must(/data-facts>[\s\S]*Event Sat 24 Oct[\s\S]*Germantown[\s\S]*href="tel:9015550100"[^>]*>Call</.test(pc), 'porch card key-facts line lacks date, where and Call');
must((pc.match(/class="btn primary"/g) || []).length === 1, 'porch card does not have exactly ONE big primary button');
must(/<details class="disclose" data-details><summary[^>]*>Show details<\/summary>[\s\S]*Location/.test(pc), 'answers are not behind Show details');
must(!/Show details[\s\S]*class="btn primary"/.test(pc), 'an action is hidden behind Show details');
const gc = card(html, 'Gia Graze');
must(/data-grazing-facts>Guests: 15–40 · Food estimate: \$180–\$720</.test(gc), `grazing card lacks guest count + food estimate (${(gc.match(/data-grazing-facts>[^<]*/) || [''])[0]})`);
const rc = card(html, 'Rae Rent');
must(/Pickup Fri 23 Oct/.test(rc) && /Pickup at Mt\. Moriah Station/.test(rc), 'rental key facts do not read the pickup day and place');
for (const word of ['checklist', 'Schedule takedown', 'Schedule install', 'Mark job done']) must(!new RegExp(word, 'i').test(rc.replace(/<[^>]+>/g, ' ')) && !new RegExp(`data-help="(card\\.checklist|card\\.printChecklist|card\\.sched(Install|Takedown)|card\\.jobDone)"`).test(rc), `rental card shows "${word}"`);
must(/data-owes>Owes \$500\.00/.test(rc), 'rental card with a sent unpaid invoice does not say what is owed');
must(/data-week-counts|data-filters/.test(html) && (html.match(/data-filter="/g) || []).length === 6, 'the six filter chips are missing');
for (const [k, label] of K.FILTERS) must(html.includes(`data-filter="${k}"`) && html.includes(`>${label.replace('&', '&amp;')}</a>`), `filter chip ${label} missing`);

// ---- 3. filters and the Put away section ------------------------------------------------
const opts = { requests: reqs, statuses: { r: { status: 'invoiced', invoice_id: 9 }, old: { status: 'paid', archived_at: '2026-10-01 00:00:00' }, old2: { status: 'paid', archived_at: '2026-10-02 00:00:00' } }, invoices: { 9: owing }, folderUrl: 'x', sheetError: '', flash: '', missingPayment: [], archived: [mk('old', 'Olive Old', ['rentals']), mk('old2', 'Otto Old', ['porch'])] };
const only = V.dashboardPage({ ...opts, filter: 'rentals' });
const live = only.slice(0, only.indexOf('id="put-away-section"'));
const putSec = only.slice(only.indexOf('id="put-away-section"'));
must(live.includes('Rae Rent') && !live.includes('Pat Porch') && !live.includes('Gia Graze'), 'the Rentals chip does not show only rentals');
must(/Put away \(1\)/.test(putSec) && putSec.includes('Olive Old') && !putSec.includes('Otto Old'), 'the Put away section does not follow the same filter');
must(/data-archived="[^"]+"[\s\S]*>Bring back</.test(putSec), 'a put-away card has no Bring back');
must(!/data-card="/.test(putSec), 'a put-away card is drawn as a live card');
const unpaid = V.dashboardPage({ ...opts, filter: 'unpaid' });
const ul = unpaid.slice(0, unpaid.indexOf('id="put-away-section"'));
must(ul.includes('Rae Rent') && !ul.includes('Pat Porch'), 'the Not paid yet chip does not show only customers who owe');
must(V.dashboardPage({ ...opts }).includes('<details class="disclose" id="put-away">'), 'the Put away section is not collapsed by default');

// ---- 4. Not paid yet math ---------------------------------------------------------------
const bal = (id, status, charges, paid, refundable = 0, due = '2026-10-20', extra = {}) => ({ invoice: { id, number: `PNP-2026-${String(id).padStart(4, '0')}`, status, due_date: due, customer_name: `C ${id}`, customer_phone: '901-555-0100', customer_email: 'c@example.com', ...extra },
  total: charges + refundable, charges, refundable, paid, void: status === 'void', owed: status === 'void' ? 0 : Math.max(0, charges - paid), remaining: Math.max(0, charges + refundable - paid) });
const bals = { 1: bal(1, 'sent', 30000, 0, 0, '2026-10-10'), 2: bal(2, 'deposit_paid', 40000, 20000, 0, '2026-10-19'), 3: bal(3, 'deposit_paid', 20000, 20000, 5000), 4: bal(4, 'void', 30000, 0), 5: bal(5, 'draft', 25000, 0), 6: bal(6, 'paid', 10000, 10000), 7: bal(7, 'sent', 15000, 0, 0, '2026-11-30') };
const lines = { 1: [{ description: 'Classic fall porch' }], 2: [{ description: 'Hotel-room birthday decor' }], 3: [{ description: 'Giant Uno' }, { description: 'Damage deposit', refundable: 1 }], 7: [{ description: 'Grazing table' }] };
const np = NP.notPaidRows(bals, lines, {}, '2026-10-18');
must(np.owed.map((r) => r.id).join() === '1,2,7', `not paid yet rows/order wrong: ${np.owed.map((r) => r.id)}`);
must(np.count === 3 && np.total === 30000 + 20000 + 15000, `not paid yet count/total wrong: ${np.count} ${np.total}`);
must(!np.owed.some((r) => r.id === 3), 'a damage deposit still held was counted as owed');
must(!np.owed.some((r) => r.id === 4) && !np.drafts.some((r) => r.id === 4), 'a void invoice is listed');
must(np.drafts.map((r) => r.id).join() === '5', 'the draft is not listed apart as "Invoice not sent yet"');
must(NP.dueWords('2026-10-10', '2026-10-18').words === '8 days late' && NP.dueWords('2026-10-10', '2026-10-18').tone === 'late', 'late wording/red');
must(NP.dueWords('2026-10-19', '2026-10-18').words === 'Due tomorrow' && NP.dueWords('2026-10-21', '2026-10-18').tone === 'soon', 'soon wording/amber');
must(NP.dueWords('2026-10-30', '2026-10-18').tone === '', 'a far due date is not amber');
must(np.owed[0].services.join() === 'porch' && np.owed[2].services.join() === 'grazing', 'service of an invoice without a request is not read from its lines');

// ---- end to end: Money, the chip, the reminders, scheduling links ----------------------
const s = await session();
const reqA = s.requests.find((r) => r.email === 'test.renter@example.com');
const inv = await s.invoiceFor(reqA, { go: 'send' });
await s.db.prepare("UPDATE invoices SET due_date = '2020-01-01' WHERE id = ?1").bind(inv.id).run();
const money = (await s.get('/admin/money')).text;
const npBox = money.slice(money.indexOf('data-not-paid-box'), money.indexOf('</section>', money.indexOf('data-not-paid-box')));
must(money.indexOf('data-not-paid-box') > -1 && money.indexOf('data-not-paid-box') < money.indexOf('<h1>Money'), 'Not paid yet is not at the top of Money');
must(npBox.includes('Test Renter') && /days late/.test(npBox) && /class="late"/.test(npBox), 'the overdue customer is not listed red with "days late"');
must(/>Call</.test(npBox) && /href="sms:\d+\?&amp;body=[^"]*still%20due[^"]*PNP-/.test(npBox) && />Email a reminder</.test(npBox) && />Open invoice</.test(npBox) && />Mark paid</.test(npBox), 'a Not paid yet row lacks Call / Text a reminder / Email a reminder / Open invoice / Mark paid');
must(/data-not-paid-total>1 customer owes \$[\d,.]+ in all/.test(npBox), 'no total line');
const sentBefore = s.env.sent.length;
const rem = await s.post('/admin/money/remind', { invoice: String(inv.id) });
must(rem.status === 303 && /Reminder%20emailed/.test(rem.location), `email reminder did not report back (${rem.status} ${rem.location})`);
must(s.env.sent.length === sentBefore + 1 && /still due/.test(s.env.sent.at(-1).text), 'the email reminder was not sent');
must(Boolean((await s.one('SELECT reminded_at FROM invoices WHERE id = ?1', inv.id)).reminded_at), 'reminded_at was not logged');
must(/data-reminded>Reminder emailed/.test((await s.get('/admin/money')).text), 'the row does not show the reminder went out');
must(cardNames((await s.get('/admin/?f=unpaid')).text).includes('Test Renter'), 'the Requests "Not paid yet" chip does not list the customer');
await s.post(`/admin/invoices/${inv.id}/status`, { action: 'paid', method: 'cash' });
must(!(await s.get('/admin/money')).text.includes('data-not-paid="'), 'a customer paid in full is still on Not paid yet');
must(!cardNames((await s.get('/admin/?f=unpaid')).text).includes('Test Renter'), 'a paid customer is still under the Not paid yet chip');
// Contextual scheduling: the kind on the link preselects the booking screen.
// The form's takedown answer maps straight into takedown_plan.
for (const [answer, plan] of [['yes', 'scheduled'], ['no', 'customer_handles'], ['not_sure', 'not_sure']]) {
  const r = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', party_takedown: answer, event_date: '2030-11-02', location: 'Bartlett', name: `Tess ${answer}`, phone: '901-555-0430', email: `tess.${answer}@example.com` });
  must(r.row && r.row.takedown_plan === plan, `form takedown "${answer}" did not store takedown_plan ${plan} (got ${r.row && r.row.takedown_plan})`);
}
const porchReq = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', event_date: '2030-10-24', location: 'Germantown', porch_takedown: 'not_sure', name: 'Pam Porch', phone: '901-555-0420', email: 'pam@example.com' });
const prk = s.rk(porchReq.row.request_key);
const td = (await s.get(`/admin/calendar/new?r=${prk}&kind=porch_takedown`)).text;
must(/<option value="porch_takedown" selected/.test(td) || /value="porch_takedown"[^>]*selected/.test(td), 'Schedule takedown does not open the booking screen on Porch takedown');
must(/Schedule the takedown for Pam/.test(td), 'the takedown screen is not titled for the takedown');
// The takedown paths end to end on a booked porch: ask -> not sure (amber + Still to decide +
// a Job done prompt) -> customer handles it (no booking, no nagging) -> change -> scheduled.
await s.post('/admin/requests/takedown', { r: prk, plan: '' });
await s.post('/admin/calendar/bookings', { r: prk, kind: 'porch_install', date: '2030-10-24', customer_name: 'Pam Porch', phone: '901-555-0420', email: 'pam@example.com', place: 'Germantown', items: 'Porch' });
const pamCard = async () => { const h = (await s.get('/admin/')).text; const i = h.indexOf('>Pam Porch</h3>'); return h.slice(h.lastIndexOf('<article', i), h.indexOf('</article>', i)); };
let pc2 = await pamCard();
must(/data-takedown="ask"/.test(pc2) && />Schedule it</.test(pc2) && />Not sure yet</.test(pc2) && />Customer will handle it</.test(pc2), 'an undecided booked porch does not ask Schedule it / Not sure yet / Customer will handle it');
await s.post('/admin/requests/takedown', { r: prk, plan: 'not_sure', note: 'after Halloween maybe' });
const pamRow = await s.one('SELECT takedown_plan, takedown_note FROM requests WHERE request_key = ?1', porchReq.row.request_key);
must(pamRow.takedown_plan === 'not_sure' && pamRow.takedown_note === 'after Halloween maybe', 'Not sure yet + note was not stored');
pc2 = await pamCard();
must(/class="notice warn tdbox" data-takedown="not_sure"><strong>Takedown: not decided yet\.<\/strong> after Halloween maybe/.test(pc2), 'not_sure is not shown in amber with its note');
must(/The takedown is not decided yet for Pam Porch\. Mark the job done anyway\?/.test(pc2), 'Job done does not prompt (once) about the undecided takedown');
const cal = (await s.get('/admin/calendar')).text;
must(/id="still-to-decide"[\s\S]*Pam Porch[\s\S]*after Halloween maybe[\s\S]*kind=porch_takedown/.test(cal), 'Still to decide on Calendar & Bookings does not list the undecided takedown');
const jd = await s.post('/admin/requests/jobdone', { r: prk });
must(jd.status === 303 && (await s.one('SELECT job_done_at FROM request_status WHERE request_key = ?1', porchReq.row.request_key)).job_done_at, 'Job done is blocked by an undecided takedown');
await s.post('/admin/requests/jobdone', { r: prk, undo: '1' });
await s.post('/admin/requests/takedown', { r: prk, plan: 'customer_handles', note: 'their nephew' });
pc2 = await pamCard();
must(/data-takedown="customer_handles">Takedown: the customer will handle it \(their nephew\)/.test(pc2) && !/Schedule takedown|data-takedown="ask"/.test(pc2), 'customer_handles still nags or offers the takedown');
{ const c2 = (await s.get('/admin/calendar')).text; const i = c2.indexOf('id="still-to-decide"'); must(i < 0 || !c2.slice(i, c2.indexOf('</section>', i)).includes('Pam Porch'), 'customer_handles is still listed under Still to decide'); }
must(!(await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind = 'porch_takedown'", porchReq.row.request_key)), 'customer_handles made a booking');
await s.post('/admin/calendar/bookings', { r: prk, kind: 'porch_takedown', date: '2030-11-02', customer_name: 'Pam Porch', phone: '', email: '', place: '', items: 'Porch' });
must((await s.one('SELECT takedown_plan FROM requests WHERE request_key = ?1', porchReq.row.request_key)).takedown_plan === 'scheduled', 'booking the takedown does not set takedown_plan = scheduled');
must(!/data-takedown=/.test(await pamCard()), 'a booked takedown still shows the takedown box');
// Rentals: the return is always booked with the pickup; its time may be "not sure yet".
const noRet = await s.post('/admin/calendar/bookings', { kind: 'rental_pickup', date: '2030-12-04', customer_name: 'Rex Return', phone: '901-555-0440', items: 'Giant Uno' });
must(/needs%20its%20return%20day/.test(noRet.location) && !(await s.one("SELECT id FROM bookings WHERE customer_name = 'Rex Return'")), 'a rental pickup was saved without its return');
await s.post('/admin/calendar/bookings', { kind: 'rental_pickup', date: '2030-12-04', return_date: '2030-12-05', return_time: '', customer_name: 'Rex Return', phone: '901-555-0440', items: 'Giant Uno' });
const rex = await s.one("SELECT time FROM bookings WHERE customer_name = 'Rex Return' AND kind = 'rental_return' AND date = '2030-12-05'");
must(rex && rex.time === null, 'a return with "not sure yet" time was not booked as all day');
await s.post('/admin/calendar/bookings', { kind: 'rental_pickup', date: '2030-12-11', return_date: '2030-12-12', return_time: '17:30', customer_name: 'Rhea Return', phone: '901-555-0441', items: 'Giant Uno' });
must((await s.one("SELECT time FROM bookings WHERE customer_name = 'Rhea Return' AND kind = 'rental_return'")).time === '17:30', 'the return time typed was not saved');
const CAL = await mod('functions/_lib/calendar.mjs');
must(CAL.returnDateFor('2030-12-06', 'Weekend (Friday pickup, Monday return)') === '2030-12-09' && CAL.returnDateFor('2030-12-04', 'One day (24 hours)') === '2030-12-05', 'return-date defaults (one day = next day, weekend = Monday) changed');
const rq = s.requests.find((r) => r.email === 'weekend.renter@example.com');
must(new RegExp(`name="return_date" type="date" value="${CAL.returnDateFor(CAL.bookingFromRequest(rq, s.PRICE_TABLE).date, rq.durationAnswer)}"`).test((await s.get(`/admin/calendar/new?r=${s.rk(rq.key)}&kind=rental_pickup`)).text), 'the pickup screen does not prefill the return day from the length');
// Day sheet: a customer with a balance booked that day -> the Not paid yet count + total.
const owe = await s.invoiceFor(reqA, { go: 'send' });
const pick = await s.one("SELECT date FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", reqA.key);
const daySheet = (await s.get(`/admin/day/${pick.date}`)).text;
must(owe.id && /data-day-not-paid>[\s\S]*Not paid yet in all: \d+ customers? owes? \$/.test(daySheet), 'the Day sheet does not show the Not paid yet count + total when a customer with a balance is booked');
must(!/data-day-not-paid/.test((await s.get('/admin/day/2030-12-25')).text), 'the Day sheet shows the Not paid yet line on a day with nobody owing');

function cardNames(h) { return [...h.matchAll(/<article class="card" data-card=[\s\S]*?<h3 class="who">([^<]*)<\/h3>/g)].map((m) => m[1]); }

if (checks < 150) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: admin cards (${errors.length} of ${checks})`); for (const e of [...new Set(errors)].slice(0, 40)) console.error(`- ${e}`); process.exit(1); }
console.log(`validate_admin_cards: OK (${checks} checks: rules table ${SINGLE.length} service sets x ${K.STAGES.length} stages, colours, key facts, filters, Put away section, Not paid yet math + Money + reminders, contextual scheduling)`);
