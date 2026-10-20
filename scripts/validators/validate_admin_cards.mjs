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
// Big buttons a viewer sees on a card: filled .btn / .btn primary, not counting the "Yes, …"
// buttons inside a closed confirm box.
const bigButtons = (h) => (String(h).replace(/<div class="confirmbox">[\s\S]*?<\/details>/g, '').match(/class="btn( primary)?"/g) || []).length;
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// ---- 1. the rules table --------------------------------------------------------------
const SINGLE = [['porch'], ['party'], ['grazing'], ['rentals'], ['porch', 'rentals'], ['party', 'grazing', 'rentals']];
const NEVER_RENTAL = ['card.checklist', 'card.printChecklist', 'card.schedInstall', 'card.schedSetup', 'td.markDone', 'td.save', 'card.jobDone', 'card.undoJobDone'];
// The second booking is booked on the card's inline row (owner, 18 Oct 2026): no button ever opens
// another page for it any more.
const DETOUR = /^card\.sched(Takedown|GrazingPickup)$/;
const firstKind = { porch: 'porch_install', party: 'party_setup', grazing: 'grazing_setup', rentals: 'rental_pickup' };
for (const services of SINGLE) {
  for (const stage of K.STAGES) {
    for (const booked of [false, true]) {
      const kinds = booked ? services.map((k) => firstKind[k]) : [];
      const inv = ['new'].includes(stage) ? null : { id: 1, status: stage === 'draft' ? 'draft' : 'sent' };
      const out = K.cardButtons({ services, stage, inv, kinds, sched: booked, returned: false, jobDoneAt: stage === 'job_done' });
      const all = [out.primary, ...out.secondary, ...(out.more || [])].filter(Boolean).map((x) => x.split('|')[0]);
      const tag = `${services.join('+')} @ ${stage}${booked ? ' (booked)' : ''}`;
      if (services.length === 1 && services[0] === 'rentals') for (const k of NEVER_RENTAL) must(!all.includes(k), `${tag}: a rental shows ${k}`);
      must(!all.some((k) => DETOUR.test(k)), `${tag}: a "Schedule takedown / pickup" detour button is back`);
      {
        const row = K.inlineRowKind({ services, stage });
        const want = ['void', 'finished', 'archived'].includes(stage) ? '' : (services.includes('porch') ? 'porch_takedown' : services.includes('party') ? 'party_takedown' : services.includes('grazing') ? 'grazing_pickup' : '');
        must(row === want, `${tag}: inline row "${row}", expected "${want}" (porch/party takedown, grazing pickup, never a rental)`);
        if (!services.includes('porch') && !services.includes('party')) must(!/_takedown$/.test(row), `${tag}: takedown row without porch or party`);
        if (!services.includes('grazing') || services.includes('porch') || services.includes('party')) must(row !== 'grazing_pickup', `${tag}: grazing pickup row without grazing (or over a takedown)`);
      }
      if (stage === 'void') must(out.primary === 'pay.unvoid' && out.secondary.join() === 'card.archive', `${tag}: void must show only Bring back + Put away (got ${all})`);
      else if (stage === 'finished') must(out.primary === 'card.archive' && !out.secondary.length, `${tag}: finished must show only Put away (got ${all})`);
      else if (stage === 'archived') must(out.primary === 'pa.bringBack' && !out.secondary.length, `${tag}: put away must show only Bring back (got ${all})`);
      else {
        // job_done with a takedown open: the inline row's Save is the next step (tested in validate:admin-takedown-inline).
        must(Boolean(out.primary), `${tag}: no primary button`);
        // Calm cards (owner, 18 Oct 2026): Put away only on Finished/Void, at most 3 secondary
        // buttons visible (the rest under Show details), never a money button in the row.
        must(!all.includes('card.archive'), `${tag}: Done — put away shows on a card that is not Finished or Void`);
        must(out.secondary.length <= K.MAX_SECONDARY && K.MAX_SECONDARY === 3, `${tag}: ${out.secondary.length} secondary buttons visible (max 3)`);
        must(!out.secondary.length || !out.more.length || out.secondary.length === 3, `${tag}: buttons moved under Show details while the row has room`);
        must(![...out.secondary, ...out.more].some((k) => k.startsWith('pay.')), `${tag}: a money button in the secondary row`);
        const decor = services.some((k) => k !== 'rentals');
        must(!decor || (all.includes('card.checklist') && all.includes('card.printChecklist')), `${tag}: porch/party/grazing lacks the walk-through checklist`);
        for (const plan of ['', 'not_sure', 'customer_handles', 'scheduled']) {
          const o2 = K.cardButtons({ services, stage, inv, kinds, sched: booked, takedownPlan: plan });
          must(![o2.primary, ...o2.secondary, ...o2.more].some((k) => DETOUR.test(String(k).split('|')[0])), `${tag}: takedown plan "${plan}" brings back a Schedule takedown / pickup button`);
        }
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
// ---- 1b. ONE big button, time-aware (owner, 18 Oct 2026) ---------------------------------
// "Mark returned" only on/after the pickup date and "Mark job done" only on/after the event date
// (America/Chicago). Before that the primary is the next real step; a booked rental with no
// pickup time yet may lead with "Text about pickup time"; with a time set, nothing big until
// pickup day (the quiet "Next:" line instead). Every live card shows exactly ONE big button
// whenever there is a step to take, and never more than one.
const WHEN = { before: '2026-10-20', on: '2026-10-24', after: '2026-10-27' };
const ALL_SETS = [['porch'], ['party'], ['grazing'], ['rentals'], ['porch', 'rentals'], ['party', 'rentals'], ['party', 'grazing', 'rentals'], ['porch', 'party', 'grazing', 'rentals']];
const LIVE = K.STAGES.filter((x) => !['void', 'finished', 'archived'].includes(x));
let matrix = 0;
for (const services of ALL_SETS) {
  for (const stage of K.STAGES) {
    for (const [when, today] of Object.entries(WHEN)) {
      for (const timeSet of [false, true]) {
        for (const booked of [false, true]) {
          const kinds = booked ? services.map((k) => firstKind[k]) : [];
          const bookings = kinds.map((kind) => ({ kind, date: '2026-10-24', time: kind === 'rental_pickup' && timeSet ? '14:00' : null }));
          const r = { rentals: [], decor: [{ label: 'Event date', value: '2026-10-24' }], other: [] };
          const dates = K.cardDates({ r, services, bookings, today });
          const inv = stage === 'new' ? null : { id: 1, status: stage === 'draft' ? 'draft' : 'sent' };
          const out = K.cardButtons({ services, stage, inv, kinds, sched: booked, jobDoneAt: stage === 'job_done', eventReached: dates.eventReached, pickupReached: dates.pickupReached, pickupTimeSet: dates.pickupTimeSet, canText: true });
          const all = [out.primary, ...out.secondary, ...out.more].filter(Boolean).map((x) => x.split('|')[0]);
          const tag = `${services.join('+')} @ ${stage} ${when}${booked ? ' booked' : ''}${timeSet ? ' time set' : ''}`;
          matrix += 1;
          must(dates.eventReached === (when !== 'before') && dates.pickupReached === (when !== 'before'), `${tag}: the date rule reads the wrong day`);
          if (when === 'before') {
            must(!all.includes('ret.mark'), `${tag}: Mark returned before the pickup date`);
            must(!all.includes('card.jobDone'), `${tag}: Mark job done before the event date`);
          }
          if (!LIVE.includes(stage)) { must(Boolean(out.primary), `${tag}: no primary on a closed card`); continue; }
          const waiting = K.cardWaiting({ services, stage, primary: out.primary, jobDoneAt: stage === 'job_done', dates });
          // Exactly one: a primary, or (only before the day, waiting on it) the quiet Next: line.
          must(Boolean(out.primary) !== Boolean(waiting), `${tag}: ${out.primary ? 'a primary AND a waiting line' : 'no primary and no waiting line'}`);
          must(!waiting || when === 'before', `${tag}: waiting for a day that has come`);
          if (when !== 'before' && (stage === 'scheduled' || (stage === 'deposit_paid' && booked))) {
            const decor = services.some((k) => k !== 'rentals');
            must(out.primary === (decor ? 'card.jobDone' : 'ret.mark'), `${tag}: on/after the day the primary is not ${decor ? 'Mark job done' : 'Mark returned'} (got ${out.primary})`);
          }
          if (when === 'before' && stage === 'scheduled' && services.includes('rentals') && booked) {
            must(out.primary === (timeSet ? '' : 'msg.pickupText'), `${tag}: before pickup day the primary is "${out.primary}" (want ${timeSet ? 'nothing big' : 'Text about pickup time'})`);
          }
          if (out.primary === 'msg.pickupText') must(services.includes('rentals') && !dates.pickupTimeSet && !dates.pickupReached, `${tag}: Text about pickup time is primary with a time set or on pickup day`);
        }
      }
    }
  }
}
must(matrix === ALL_SETS.length * K.STAGES.length * 3 * 2 * 2, `the one-primary matrix ran ${matrix} cases`);
// A rental with a pickup time but no way to text (no mobile on file) still never shows Mark returned early.
must(!K.cardButtons({ services: ['rentals'], stage: 'scheduled', inv: { id: 1, status: 'deposit_paid' }, sched: true, kinds: ['rental_pickup'], pickupReached: false, canText: false }).primary, 'no-mobile rental before pickup day has a primary');
must(K.cardButtons({ services: ['rentals'], stage: 'scheduled', inv: { id: 1, status: 'deposit_paid' }, sched: true, kinds: ['rental_pickup'], pickupReached: true }).primary === 'ret.mark', 'rental on pickup day: primary is not Mark returned');
// Test Renter (decor + rentals, invoice sent, deposit not paid, booked): no Mark returned today.
{ const o = K.cardButtons({ services: ['party', 'rentals'], stage: 'invoiced', inv: { id: 1, status: 'sent' }, sched: true, kinds: ['party_setup', 'rental_pickup'], eventReached: false, pickupReached: false });
  must(o.primary === 'pay.deposit' && ![...o.secondary, ...o.more].includes('ret.mark'), `Test Renter shape: Mark returned before the pickup date (${o.secondary})`); }
// cardDates reads the bookings first, then the form, in America/Chicago.
must(K.cardDates({ r: { rentals: [{ label: 'Pickup date', value: '10/30/2026' }], decor: [], other: [] }, services: ['rentals'], bookings: [], today: '2026-10-29' }).pickupReached === false
  && K.cardDates({ r: { rentals: [{ label: 'Pickup date', value: '10/30/2026' }], decor: [], other: [] }, services: ['rentals'], bookings: [], today: '2026-10-30' }).pickupReached === true, 'cardDates does not read the form pickup date (MM/DD/YYYY)');
must(K.cardDates({ r: { rentals: [], decor: [], other: [] }, services: ['rentals'], bookings: [{ kind: 'rental_pickup', date: '2026-11-01', time: '' }], today: '2026-10-31' }).pickupTimeSet === false, 'an empty time counts as a pickup time');

// The Payment box by money state: no invoice = no money buttons; ONE button at most; never
// the same button as the primary; undo only once something is paid; Void never in the box.
const CP = (inv, extra = {}) => K.cardPayment({ inv, ...extra });
must(K.payState({ inv: null }) === 'none' && CP(null).button === '' && !CP(null).undo, 'no invoice: the Payment box offers a money button');
must(CP(null, { status: 'scheduled' }).button === '' && CP({ status: 'draft' }).button === '' && CP({ status: 'draft' }).state === 'draft', 'no invoice sent: the Payment box offers a money button');
must(CP({ status: 'sent' }).button === 'pay.deposit' && CP({ status: 'sent' }, { plan: 'full' }).button === 'pay.paid' && !CP({ status: 'sent' }).undo, 'invoice sent: not ONE Mark deposit received (Mark paid in full on a full plan)');
must(CP({ status: 'deposit_paid' }).button === 'pay.paid' && CP({ status: 'deposit_paid' }).undo, 'deposit paid: not ONE Mark paid in full + the undo link');
must(CP({ status: 'paid' }).button === '' && CP({ status: 'paid' }).undo, 'paid in full: a money button still shows, or no undo link');
must(CP({ status: 'sent' }, { primary: 'pay.deposit' }).button === '' && CP({ status: 'deposit_paid' }, { primary: 'pay.paid' }).button === '', 'the Payment box repeats the primary button');
for (const st of ['draft', 'sent', 'deposit_paid', 'paid']) for (const plan of ['half', 'full']) must(!['pay.void', 'pay.unvoid'].includes(CP({ status: st }, { plan }).button), `Void in the Payment box (${st})`);
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
must(/<details class="disclose more" data-details><summary[^>]*>More: answers, history, other buttons<\/summary>[\s\S]*Location/.test(pc) && !/Location/.test(pc.slice(0, pc.indexOf('data-details'))), 'answers are not behind More: answers, history, other buttons (or show above it)');
must(!/More: answers, history, other buttons[\s\S]*class="btn primary"/.test(pc), 'an action is hidden behind More');
// Calm card render: no invoice -> one quiet line and no money buttons; Void a small link under
// Show details, never a big button; at most 3 secondary buttons; at most one helper line.
const beforeDetails = (c) => c.slice(0, c.indexOf('data-details'));
must(/<p class="payline muted" data-payment data-pay-state="none" data-pay-words>No invoice yet\.<\/p>/.test(pc), 'no-invoice card lacks the single quiet "No invoice yet." line');
must(!/data-help="pay\.(deposit|paid|unpaid|void)"/.test(beforeDetails(pc)), 'no-invoice card shows a payment button');
must(/data-void-link>[\s\S]*<summary class="linkbtn danger" data-help="pay\.void"[^>]*>Void this request…<\/summary>[\s\S]*Yes, void it/.test(pc.slice(pc.indexOf('data-details'))), 'Void is not a small danger link (with its confirm) under Show details');
must(!/Done — put away/.test(pc), 'Done — put away shows on a New card');
const gc = card(html, 'Gia Graze');
must(/data-grazing-facts>Guests: 15–40 · Food estimate: \$180–\$720</.test(gc), `grazing card lacks guest count + food estimate (${(gc.match(/data-grazing-facts>[^<]*/) || [''])[0]})`);
const rc = card(html, 'Rae Rent');
must(/Pickup Fri 23 Oct/.test(rc) && /Pickup at Mt\. Moriah Station/.test(rc), 'rental key facts do not read the pickup day and place');
for (const word of ['checklist', 'Schedule takedown', 'Schedule install', 'Mark job done']) must(!new RegExp(word, 'i').test(rc.replace(/<[^>]+>/g, ' ')) && !new RegExp(`data-help="(card\\.checklist|card\\.printChecklist|card\\.sched(Install|Takedown)|card\\.jobDone)"`).test(rc), `rental card shows "${word}"`);
must(/data-pay-words>Invoice sent · owes \$500\.00/.test(rc) && !/data-owes|chip sched|data-paid-early/.test(rc), 'rental card with a sent unpaid invoice does not say what is owed in the Payment box (or a duplicate status pill is back)');
must(/data-pay-state="sent"><p class="words" data-pay-words>Invoice sent · owes \$500\.00</.test(rc), 'sent card does not say "Invoice sent · owes $X"');
must((rc.match(/<summary[^>]*data-help="pay\.deposit"/g) || []).length === 1 && !/data-help="pay\.paid"/.test(rc), 'sent card does not show exactly ONE Mark deposit received');
// Deposit in / paid in full renders.
const depInv = { ...owing, id: 10, status: 'deposit_paid', balance: { ...owing.balance, paid: 25000, owed: 25000, remaining: 25000 } };
const paidInv = { ...owing, id: 11, status: 'paid', balance: { ...owing.balance, paid: 50000, owed: 0, remaining: 0 } };
const html2 = V.dashboardPage({ requests: reqs, statuses: { y: { status: 'deposit_paid', invoice_id: 10 }, g: { status: 'paid', invoice_id: 11 }, r: { status: 'invoiced', invoice_id: 9 } }, invoices: { 9: owing, 10: depInv, 11: paidInv }, folderUrl: 'x', sheetError: '', flash: '', missingPayment: [], foodPerHead: { low: 12, high: 18 } });
const yc = card(html2, 'Pia Party');
must(/data-pay-state="deposit"><p class="words" data-pay-words>Deposit in · still owes \$250\.00</.test(yc), 'deposit card does not say "Deposit in · still owes $X"');
must((yc.match(/data-help="pay\.paid"/g) || []).length === 1 && !/data-help="pay\.deposit"/.test(yc) && /<summary class="linkbtn" data-help="pay\.unpaid"[^>]*>That was a mistake: mark as not paid</.test(yc), 'deposit card lacks ONE Mark paid in full + the small undo link');
const gc2 = card(html2, 'Gia Graze');
// Paid in full (owner, 18 Oct 2026): no Payment box at all (the progress line says it); the
// undo is ONE small link on the progress line.
// Step cards (19 Oct 2026): "Paid in full" is a ticked step; its ONE undo (beside the last ✓)
// never deletes money: it explains, and links to the invoice where "mark as not paid" lives.
must(!/data-payment/.test(gc2) && /<li class="d" data-step="paid" data-step-done><span class="ck" aria-hidden="true">✓<\/span><span class="t">Paid in full/.test(gc2) && !/data-help="pay\.(deposit|paid)"/.test(beforeDetails(gc2))
  && (gc2.match(/data-undo=/g) || []).length === 1 && /data-step="paid"[^>]*>(?:(?!<\/li>)[\s\S])*data-undo="paid" data-undo-kind="explain"(?:(?!<\/li>)[\s\S])*href="\/admin\/invoices\/11"/.test(gc2) && !/data-undo-kind="form"[^>]*>[\s\S]*?action="[^"]*(status|payment)/.test(gc2), 'paid card still has a Payment box, or its one undo (beside Paid in full) is not the explain-and-link kind');
for (const [nm, c] of [...['Pat Porch', 'Pia Party', 'Gia Graze', 'Rae Rent'].map((n) => [n, card(html, n)]), ['Pia Party (deposit)', yc], ['Gia Graze (paid)', gc2]]) {
  must(!/<summary class="btn danger"/.test(c) && !/<summary class="btn[^"]*"[^>]*data-help="pay\.void"/.test(c), `${nm}: a big danger button on the card (Void must be a small link)`);
  must(!/data-help="pay\.void"/.test(beforeDetails(c)), `${nm}: Void outside Show details`);
  const row = c.match(/data-secondary>([\s\S]*?)<\/div>\s*(?:<section|<p class="payline|<details)/);
  must(!row || (row[1].match(/class="btn /g) || []).length <= 3, `${nm}: more than 3 secondary buttons visible`);
  must((beforeDetails(c).match(/class="hint"/g) || []).length <= 1, `${nm}: more than one helper line on the card`);
  must(!/Done — put away/.test(c), `${nm}: Done — put away on a live card`);
}
// The rendered card: every service set x money/job state x before/on/after the day x pickup
// time set or not, with the message links on. Exactly ONE big button, or none and the quiet
// "Next:" line while it waits for the day; Mark returned / Mark job done never before the day;
// the messages (confirmation, pickup time) are small links, never big.
{
  const VM = await mod('functions/_lib/views-messages.mjs');
  const sms = (b) => ({ href: `sms:9015550100?&body=${b}` });
  const msgs = { confirm: { sms: sms('ok'), canEmail: true }, pickup: { sms: sms('time'), canEmail: true } };
  const bal = (status, paid) => ({ id: 1, number: 'PNP-1', status, total_cents: 20000, deposit_due_cents: 10000, pay_plan: 'half', balance: { total: 20000, charges: 20000, paid, owed: 20000 - paid, remaining: 20000 - paid, refundable: 0, void: false } });
  const STATES = [
    ['new', { status: 'new' }, null, false, null, false],
    ['draft', { status: 'new' }, bal('draft', 0), false, null, false],
    ['sent', { status: 'invoiced' }, bal('sent', 0), false, null, false],
    ['sent+booked', { status: 'invoiced' }, bal('sent', 0), true, null, false],
    ['deposit', { status: 'deposit_paid' }, bal('deposit_paid', 10000), false, null, false],
    ['scheduled', { status: 'scheduled' }, bal('deposit_paid', 10000), true, null, false],
    ['job done', { status: 'job_done', job_done_at: '2026-10-24 12:00:00' }, bal('deposit_paid', 10000), true, { returned_at: '2026-10-25 12:00:00' }, false],
    ['paid', { status: 'paid', job_done_at: '2026-10-24 12:00:00' }, bal('paid', 20000), true, { returned_at: '2026-10-25 12:00:00' }, false],
    ['void', { status: 'void', void: 1 }, null, false, null, false],
    ['put away', { status: 'paid', archived_at: '2026-10-26 00:00:00' }, bal('paid', 20000), true, { returned_at: '2026-10-25 12:00:00' }, true],
  ];
  const seen = new Set();
  let rendered = 0;
  for (const services of ALL_SETS) {
    const r = { ...mk(`m-${services.join('-')}`, 'Mo Matrix', services, [{ label: 'Event date', value: '2026-10-24' }], services.includes('rentals') ? [{ label: 'Pickup date', value: '2026-10-24' }] : []) };
    for (const [name, st, inv, booked, ret, archived] of STATES) {
      for (const [when, today] of Object.entries(WHEN)) {
        for (const timeSet of [false, true]) {
          const kinds = booked ? services.map((k) => firstKind[k]) : [];
          const bookings = kinds.map((kind) => ({ kind, date: '2026-10-24', time: kind === 'rental_pickup' && timeSet ? '14:00' : null }));
          const c = V.requestCard(r, { st, inv, sched: booked ? { date: '2026-10-24' } : null, ret, kinds, bookings, today, archived, msgs, takedownPlan: 'scheduled' });
          const stage = (c.match(/data-stage="([^"]+)"/) || [])[1];
          seen.add(stage);
          rendered += 1;
          const tag = `rendered ${services.join('+')} ${name} (${stage}) ${when}${timeSet ? ' time set' : ''}`;
          const top = c.slice(0, c.indexOf('data-details'));
          const wait = /data-next-wait=/.test(top);
          const big = bigButtons(top);
          must(wait ? big === 0 : big === 1, `${tag}: ${big} big buttons${wait ? ' while waiting for the day' : ''} (want exactly one)`);
          must(bigButtons(c.slice(c.indexOf('data-details'))) === 0, `${tag}: a big button under Show details`);
          if (when === 'before') must(!/>Mark returned<|>Mark job done</.test(c) && !/data-help="(ret\.mark|card\.jobDone)"[^>]*class="btn|class="btn[^"]*"[^>]*data-help="(ret\.mark|card\.jobDone)"/.test(c), `${tag}: Mark returned / Mark job done before the day`);
          must(!/class="btn[^"]*"[^>]*data-msg-tap="confirmation"/.test(c) && !/<button class="btn[^"]*" type="submit" data-help="(conf|msg)\.(email|pickupEmail)"/.test(c), `${tag}: a message button is big`);
          // Step cards (19 Oct 2026): the small message links live under More, never above it.
          if (!['void', 'finished', 'archived'].includes(stage) && services.includes('rentals') && !ret) must(/data-messages>[\s\S]*data-msg="pickupTime"/.test(c.slice(c.indexOf('data-details'))) && !/data-messages>/.test(top), `${tag}: no small pickup-time message line under More (or it sits above More)`);
        }
      }
    }
  }
  must(rendered === ALL_SETS.length * STATES.length * 6, `rendered matrix ran ${rendered} cards`);
  for (const stg of K.STAGES) if (stg !== 'job_done') must(seen.has(stg), `rendered matrix never reached stage ${stg} (saw ${[...seen]})`);
  // The Weekend Renter shape (rental, deposit in, booked, pickup in 12 days): before, three big
  // buttons (Text about pickup time, Email them, Mark returned). Now one, or none with a time set.
  const wr = { ...mk('wr', 'Wendy Weekend', ['rentals'], [], [{ label: 'Pickup date', value: '2026-10-30' }]) };
  const wrCard = (timeSet, today) => V.requestCard(wr, { st: { status: 'scheduled' }, inv: bal('deposit_paid', 10000), sched: { date: '2026-10-30' }, kinds: ['rental_pickup', 'rental_return'], bookings: [{ kind: 'rental_pickup', date: '2026-10-30', time: timeSet ? '15:00' : null }], today, msgs });
  // Step cards (19 Oct 2026): the next step is "Picked up". Before pickup day nothing is big:
  // the quiet "Next:" line, plus the small "Text about pickup time" in the box while no time is
  // set; the confirmation + pickup pair are small links under More. On the day, "Mark picked up"
  // is the one big button (Mark returned only after it).
  const more = (c) => c.slice(c.indexOf('data-details'));
  const box = (c) => c.slice(c.indexOf('data-next-step'), c.indexOf('data-details'));
  const w1 = wrCard(false, '2026-10-18');
  must(bigButtons(w1) === 0 && /data-next-step="picked"/.test(w1) && /data-primary-wait data-next-wait="step\.picked"[^>]*>Next: Mark picked up, on pickup day \(Fri 30 Oct\)</.test(w1)
    && /<a class="btn ghost" href="sms:[^"]*" data-msg-tap="pickupTime"[^>]*>Text about pickup time</.test(box(w1)) && !/Mark returned</.test(w1), 'Weekend Renter (no pickup time): not the quiet Next: Mark picked up line with ONE small Text about pickup time (or something big / Mark returned shows)');
  must(/data-messages><span class="mlabel">Messages<\/span><span class="msgpair" data-msg="confirmation"><a class="msglink"[^>]*>Text them it(&#39;|')s confirmed<\/a>/.test(more(w1)) && /data-msg="pickupTime">[^]*?>Email it</.test(more(w1)) && !/data-messages>/.test(w1.slice(0, w1.indexOf('data-details'))), 'Weekend Renter: the confirmation + pickup email are not one small Messages line under More');
  const w2 = wrCard(true, '2026-10-18');
  must(bigButtons(w2) === 0 && /data-primary-wait data-next-wait="step\.picked"[^>]*>Next: Mark picked up, on pickup day \(Fri 30 Oct\)</.test(w2) && !/data-msg-tap="pickupTime"/.test(box(w2)) && /data-msg="pickupTime"><a class="msglink"[^>]*>Text about pickup time<\/a>[^]*?>Email it</.test(more(w2)), 'Weekend Renter (pickup time set): something big before pickup day, or no quiet Next: line / small pickup pair under More');
  const w3 = wrCard(true, '2026-10-30');
  must(bigButtons(w3) === 1 && /data-primary>[\s\S]*data-help="step\.picked"[^>]*>Mark picked up</.test(box(w3)) && !/>Mark returned</.test(box(w3)), 'Weekend Renter on pickup day: Mark picked up is not the one primary (or Mark returned comes first)');
  // Hold controls and the thank-you box on a card carry no big button of their own.
  const hc = VM.holdControls({ name: 'H', untilMs: Date.now() + 7200000, items: 'Giant Uno', phone: '901-555-0100' }, { rk: 'x', sms: sms('r'), canEmail: true, depositTarget: null, compact: true });
  must(bigButtons(hc) === 0 && /data-msg="holdEnding"><a class="msglink"[^>]*>Text a reminder</.test(hc), 'hold controls on a card carry a big button (or lose Text a reminder)');
  // "Wait for the deposit" on a held rental (owner-approved sample, 20 Oct 2026): "Games reserved
  // until Fri 23 Oct, 11:59 PM" + the Reserve their games longer control; reserved by hand (no end
  // date) shows that and the same control (Save sets now + N days). Never "Hold longer".
  {
    const end = Date.parse('2026-10-24T04:59:00Z');
    const dep = (hold) => V.requestCard(wr, { st: { status: 'invoiced' }, inv: bal('sent', 0), kinds: ['rental_pickup', 'rental_return'], bookings: [{ kind: 'rental_pickup', date: '2026-10-30', time: null }], today: '2026-10-20', msgs, hold });
    const t = dep({ state: 'held', by_hand: 0, untilMs: end });
    const nb = (t.match(/<section class="nextbox" data-next-step="deposit">[\s\S]*?<\/section>/) || [''])[0];
    must(/<p class="holdline" data-hold-line>Games reserved until Fri 23 Oct, 11:59 PM<\/p>/.test(nb) && /data-reserve-longer data-until-ms="\d+"><summary class="btn ghost ressum"[^>]*><b>Reserve their games longer<\/b><span class="ressub">Give more time to pay<\/span><\/summary>/.test(nb)
      && nb.includes('data-res-current>Held until Fri 23 Oct, 11:59 PM</p>') && nb.includes(`data-res-new>New date: <b>${VM.reservedWords(VM.reserveNewEnd(end, 3))}</b>`) && /name="days" value="3"[\s\S]*>more days<\/label>[\s\S]*>Save<\/button>[\s\S]*>Cancel<\/button>/.test(nb)
      && !/Hold longer|[Gg]ames held until/.test(t), 'the Wait for the deposit step does not say "Games reserved until Fri 23 Oct, 11:59 PM" with the Reserve their games longer control (or still says Hold longer / Games held until)');
    must(VM.reservedWords(end) === 'Fri 23 Oct, 11:59 PM' && VM.reservedWords(Date.parse('2026-10-27T04:59:00Z')) === 'Mon 26 Oct, 11:59 PM', 'reserved-until dates are not written like "Fri 23 Oct, 11:59 PM" in Memphis time');
    const bh = dep({ state: 'held', by_hand: 1, untilMs: NaN });
    const nb2 = (bh.match(/<section class="nextbox" data-next-step="deposit">[\s\S]*?<\/section>/) || [''])[0];
    must(/<p class="holdline" data-hold-line>Reserved by hand \(no end date\)<\/p>/.test(nb2) && /data-reserve-longer data-until-ms="">/.test(nb2) && nb2.includes('data-res-current>Reserved by hand (no end date)</p>') && /data-res-new>New date: <b>/.test(nb2), 'a hold reserved by hand (no end date) does not say so on the deposit step, or has no Reserve their games longer control');
    must(!/id="(hd[^"]*)"[\s\S]*id="\1"/.test(t), 'two Reserve their games longer boxes on one card share an id');
  }
  must(bigButtons(VM.thankYouBox({ thankyouEmailedAt: '' }, { rk: 'x', sms: sms('t'), canEmail: true })) === 0, 'the thank-you box carries a big button');
}
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
// Calm Money (19 Oct 2026): the big numbers first, then Not paid yet straight under them, before
// every list (jobs, tips, expenses, more numbers).
{
  const at = (m) => money.indexOf(m);
  must(at('data-money-summary') > -1 && at('data-not-paid-box') > at('data-money-summary') && ['data-jobs', 'data-tips', 'data-expenses', 'data-more-numbers', 'data-steps-panel'].every((m) => at(m) > at('data-not-paid-box')), 'Not paid yet is not right under the big numbers, above every list on Money');
  must(!money.slice(at('data-money-summary'), at('data-not-paid-box')).includes('<section class="sect"'), 'a list sits between the big numbers and Not paid yet');
}
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
must(/data-takedown-row="open"/.test(pc2) && /name="date" value="2030-10-25"/.test(pc2) && /name="go" value="save"[^>]*>Save</.test(pc2) && />Not sure yet</.test(pc2) && />Customer will handle it</.test(pc2) && !/href="\/admin\/calendar\/new[^"]*kind=porch_takedown/.test(pc2), 'an undecided booked porch does not show the inline Takedown row (day after the install, Save · Not sure yet · Customer will handle it), or still detours to the booking page');
await s.post('/admin/requests/takedown', { r: prk, plan: 'not_sure', note: 'after Halloween maybe' });
const pamRow = await s.one('SELECT takedown_plan, takedown_note FROM requests WHERE request_key = ?1', porchReq.row.request_key);
must(pamRow.takedown_plan === 'not_sure' && pamRow.takedown_note === 'after Halloween maybe', 'Not sure yet + note was not stored');
pc2 = await pamCard();
must(/class="tdrow amber" data-takedown-row="not_sure">[\s\S]*<span class="tdpill">Not decided yet<\/span> <em data-takedown-note>after Halloween maybe<\/em>/.test(pc2) && /name="go" value="save"/.test(pc2), 'not_sure is not shown in amber with its note, on the row that can still Save it');
// Time-aware: no Mark job done before the event day (only the quiet "Next:" line); on the day
// it is the one primary, and it prompts (once) about the undecided takedown.
// Step cards (19 Oct 2026): before the day the next step is the money (no invoice yet: Create
// invoice); on the day the install itself comes first, even with the invoice still open.
must(!/data-help="card\.jobDone"/.test(pc2) && !/>Mark (install|job|setup) done</.test(pc2) && /data-next-step="invoiced"/.test(pc2), 'Mark install done shows before the event day (or the next step is not the invoice)');
await s.db.prepare("UPDATE bookings SET date = ?2 WHERE request_key = ?1 AND kind = 'porch_install'").bind(porchReq.row.request_key, TODAY).run();
pc2 = await pamCard();
must(/data-next-step="setup"/.test(pc2) && /<summary class="btn primary" data-help="card\.jobDone"[^>]*>Mark install done<\/summary>/.test(pc2) && (pc2.match(/The takedown is not decided yet for Pam Porch\. Mark the job done anyway\?/g) || []).length === 1 && (bigButtons(pc2) === 1), 'Install done (on the event day) does not prompt (once) about the undecided takedown as the one primary');
const cal = (await s.get('/admin/calendar')).text;
must(/id="still-to-decide"[\s\S]*Pam Porch[\s\S]*after Halloween maybe[\s\S]*kind=porch_takedown/.test(cal), 'Still to decide on Calendar & Bookings does not list the undecided takedown');
const jd = await s.post('/admin/requests/jobdone', { r: prk });
must(jd.status === 303 && (await s.one('SELECT job_done_at FROM request_status WHERE request_key = ?1', porchReq.row.request_key)).job_done_at, 'Job done is blocked by an undecided takedown');
await s.post('/admin/requests/jobdone', { r: prk, undo: '1' });
await s.post('/admin/requests/takedown', { r: prk, plan: 'customer_handles', note: 'their nephew' });
pc2 = await pamCard();
must(/data-takedown-row="customer_handles"><span class="tdl">Takedown:<\/span> <span>The customer will handle it \(their nephew\)\.<\/span>/.test(pc2) && !/Schedule takedown|data-takedown-row="open"|name="go" value="save"/.test(pc2), 'customer_handles still nags or offers the takedown');
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

function cardNames(h) { return [...h.matchAll(/<article class="card[^"]*" data-card=[\s\S]*?<h3 class="who">([^<]*)<\/h3>/g)].map((m) => m[1]); }

if (checks < 150) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: admin cards (${errors.length} of ${checks})`); for (const e of [...new Set(errors)].slice(0, 40)) console.error(`- ${e}`); process.exit(1); }
console.log(`validate_admin_cards: OK (${checks} checks: rules table ${SINGLE.length} service sets x ${K.STAGES.length} stages, colours, key facts, filters, Put away section, Not paid yet math + Money + reminders, contextual scheduling)`);
