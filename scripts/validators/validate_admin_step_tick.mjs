#!/usr/bin/env node
/**
 * "Doing a later step ticks the earlier ones" (owner, 20 Oct 2026). Step 1 "Call or text <name>
 * back" is the one step only a tap stores (request_steps.called_at); any later fact (invoice sent,
 * a payment recorded, the job put on the calendar by hand, games picked up, Job done) counts it as
 * done by itself. DERIVED (progress.mjs pastFirstCall + bookedByHand, read by steps.mjs), never
 * written back. Fails when:
 *  1. a later fact (pure rules, every service) leaves "called" undone or still the current step,
 *     or the website's own pencilled game bookings (edited_by_hand = 0) or a takedown / return
 *     booked by hand count as her booking;
 *  2. in the real router (party and rentals from the real website form), after each later fact
 *     the card still shows Step 1, the callback list (callback-list.mjs callbackRows) or the 7 AM
 *     to-do email's "Call these people back" (todo-email.mjs section 2) still lists the request;
 *  3. undoing that later fact (void + bring back, "Mark as not paid", remove the moved booking,
 *     Undo job done, undo Picked up) does not bring Step 1 back on the card, the callback list and
 *     the email exactly as before;
 *  4. a "Called back" she tapped is lost when a later fact is undone, or the derived tick wrote a
 *     request_steps row (no stored data is ever changed by the derivation);
 *  5. callback-list.mjs, todo-email.mjs and views.mjs stop reading the one derived s.called, or
 *     steps.mjs stops reading progress.mjs pastFirstCall.
 * Rule 0: fewer than 80 checks is a failure.
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
const TD = await mod('functions/_lib/takedown.mjs');
const CB = await mod('functions/_lib/callback-list.mjs');
const TODO = await mod('functions/_lib/todo-email.mjs');
const F = await mod('functions/_lib/request-form.mjs');

// ---- 1. Pure rules ---------------------------------------------------------------------------
const T = '2026-10-24';
const bal = (paid, charges = 11000) => ({ total: charges, charges, refundable: 0, paid, owed: Math.max(0, charges - paid), depositOwed: 0, remaining: Math.max(0, charges - paid), void: false });
const invOf = (status, paid = 0) => ({ id: 1, status, total_cents: 11000, deposit_due_cents: 5000, balance: bal(paid) });
function derive(services, { st = { status: 'new' }, inv = null, bookings = [], ret = null, stored = null, r = {} } = {}) {
  const rq = { key: 'k', source: 'site', takedownPlan: '', ...r };
  const tdS = TD.takedownState({ services, takedownPlan: '', bookings, today: T });
  const rental = services.length === 1 && services[0] === 'rentals';
  const pr = P.deriveProgress({ st, inv, scheduled: bookings.length > 0, ret, rental, takedown: tdS });
  return ST.deriveSteps({ r: rq, services, pr, inv, st, bookings, ret, tdS, stored, today: T });
}
must(typeof P.pastFirstCall === 'function' && typeof P.bookedByHand === 'function', 'progress.mjs has no pastFirstCall / bookedByHand');
if (typeof P.pastFirstCall === 'function') {
  must(P.pastFirstCall({}) === false, 'pastFirstCall with no later fact is true');
  for (const k of ['sent', 'depositIn', 'jobDone', 'picked', 'booked']) must(P.pastFirstCall({ [k]: true }) === true, `pastFirstCall ignores ${k}`);
}
if (typeof P.bookedByHand === 'function') {
  must(P.bookedByHand({ status: 'scheduled' }, []) === true, 'a Scheduled request is not booked by hand');
  must(P.bookedByHand({ status: 'new' }, [{ kind: 'party_setup', edited_by_hand: 1 }]) === true, 'a setup booked by hand does not count');
  must(P.bookedByHand({ status: 'new' }, [{ kind: 'rental_pickup', edited_by_hand: 1 }]) === true, 'a game pickup moved by hand does not count');
  must(P.bookedByHand({ status: 'new' }, [{ kind: 'rental_pickup', edited_by_hand: 0 }, { kind: 'rental_return', edited_by_hand: 0 }]) === false, 'the website\'s own pencilled game bookings count as her booking');
  for (const k of ['porch_takedown', 'party_takedown', 'grazing_pickup', 'rental_return']) must(P.bookedByHand({ status: 'new' }, [{ kind: k, edited_by_hand: 1 }]) === false, `a ${k} booked by hand counts as booking the job`);
}
const pencil = [{ id: 5, kind: 'rental_pickup', date: '2026-10-30', edited_by_hand: 0 }, { id: 6, kind: 'rental_return', date: '2026-11-01', edited_by_hand: 0 }];
const firstKind = { party: 'party_setup', porch: 'porch_install', grazing: 'grazing_setup', rentals: 'rental_pickup' };
for (const svc of ['party', 'porch', 'grazing', 'rentals']) {
  const base = svc === 'rentals' ? { bookings: pencil } : {};
  const fresh = derive([svc], base);
  must(fresh.current === 'called' && !fresh.called, `${svc}: a fresh request is not on Step 1 (${fresh.current})`);
  const later = {
    'invoice sent': { ...base, inv: invOf('sent'), st: { status: 'invoiced' } },
    'payment on the draft': { ...base, inv: invOf('deposit_paid', 5000), st: { status: 'deposit_paid' } },
    'Scheduled by hand': { ...base, st: { status: 'scheduled' }, bookings: [{ id: 7, kind: firstKind[svc], date: '2026-10-30', edited_by_hand: 1 }, ...(svc === 'rentals' ? [pencil[1]] : [])] },
    'first booking changed by hand': { ...base, bookings: [{ id: 7, kind: firstKind[svc], date: '2026-10-29', edited_by_hand: 1 }, ...(svc === 'rentals' ? [pencil[1]] : [])] },
    ...(svc === 'rentals' ? { 'picked up': { bookings: [{ ...pencil[0], done_at: 'x' }, pencil[1]] }, returned: { bookings: [{ ...pencil[0], done_at: 'x' }, pencil[1]], ret: { returned_at: 'x' } } }
      : { 'job done': { st: { status: 'job_done', job_done_at: 'x' } } }),
  };
  for (const [label, o] of Object.entries(later)) {
    const s = derive([svc], o);
    const one = s.steps.find((x) => x.key === 'called');
    must(s.called && one && one.done && s.current !== 'called' && s.currentN > 1, `${svc} / ${label}: Step 1 still current (current ${s.current}, called ${s.called})`);
    must(one && one.how === 'later', `${svc} / ${label}: the derived tick does not say it came from a later step (how=${one && one.how})`);
    const u = ST.undoFor({ ...s, lastDone: one }, { stored: null });
    must(u && u.kind === 'explain' && /later step/.test(u.words), `${svc} / ${label}: undo of a derived "Called back" is not explained as "a later step is done"`);
  }
  // A "Called back" she tapped is kept when the later fact goes away.
  const tapped = derive([svc], { ...base, stored: { called_at: 'x' } });
  must(tapped.called && tapped.current !== 'called', `${svc}: a tapped "Called back" is lost`);
}
// Draft only (the auto draft) is not a later fact.
must(derive(['party'], { inv: invOf('draft') }).current === 'called', 'an unsent draft invoice ticks Step 1');

// ---- 2-4. The real router --------------------------------------------------------------------
const s = await session();
const today = F.chicagoToday();
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const cardOf = (html, key) => { const i = html.indexOf(`id="c-${s.rk(key)}"`); return i < 0 ? '' : html.slice(html.lastIndexOf('<article', i), html.indexOf('</article>', i)); };
const card = async (key) => cardOf((await s.get('/admin/')).text, key);
const cur = (c) => (c.match(/data-current-step="([^"]+)"/) || [])[1];
const calledDone = (c) => /data-step="called" data-step-done/.test(c);
const inCallback = async (key) => (await CB.callbackRows(s.db, today)).some((x) => x.key === key);
const inEmail = async (key) => ((await TODO.todoData(s.db, today)).sections[2] || []).some((x) => x.key === key);
const stepRows = async () => (await s.one('SELECT COUNT(*) AS n FROM request_steps')).n;

async function expectStep1(key, label) {
  const c = await card(key);
  must(c && cur(c) === 'called' && !calledDone(c) && /Call or text [^<]* back/.test(c) && /data-after-call/.test(c) && /After the call: are you taking this job\?/.test(c), `${label}: the card is not back on Step 1 "Call or text … back" (current ${cur(c)})`);
  must(await inCallback(key), `${label}: not on the callback list`);
  must(await inEmail(key), `${label}: not in the to-do email's "Call these people back"`);
}
async function expectTicked(key, label) {
  const c = await card(key);
  must(c && cur(c) !== 'called' && calledDone(c) && !/Call or text [^<]* back/.test(c) && !/data-after-call|data-step1-checklist|data-questions-text/.test(c), `${label}: the card still shows Step 1 (current ${cur(c)})`);
  must(!(await inCallback(key)), `${label}: still on the callback list`);
  must(!(await inEmail(key)), `${label}: the to-do email still asks her to call them back`);
}

const party = (await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', event_date: plus(15), location: 'Bartlett', name: 'Tess Ticker', phone: '901-555-0601', email: 'tess.tick@example.com' })).row;
const party2 = (await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', event_date: plus(20), location: 'Cordova', name: 'Tia Ticker', phone: '901-555-0603', email: 'tia.tick@example.com' })).row;
const rent = (await s.siteRequest({ service: 'rentals', games: ['giant-uno'], duration: 'day', rental_date: plus(18), pickup_when: 'morning', return_when: 'after', name: 'Ray Ticker', phone: '901-555-0602', email: 'ray.tick@example.com' })).row;
must(party && party2 && rent, 'the test requests were refused by the website form');
if (party && party2 && rent) {
  const steps0 = await stepRows();
  await expectStep1(party.request_key, 'party, new');
  await expectStep1(rent.request_key, 'rentals, new (pencilled pickup and return)');
  const pInv = (await s.one('SELECT invoice_id FROM request_status WHERE request_key = ?1', party.request_key) || {}).invoice_id;
  const p2Inv = (await s.one('SELECT invoice_id FROM request_status WHERE request_key = ?1', party2.request_key) || {}).invoice_id;
  const rInv = (await s.one('SELECT invoice_id FROM request_status WHERE request_key = ?1', rent.request_key) || {}).invoice_id;
  must(pInv && p2Inv && rInv, 'the website requests have no auto draft');

  // Invoice sent (by text) -> ticked; Void -> off every list; Bring back (a draft again) -> Step 1.
  await s.post(`/admin/invoices/${pInv}/status`, { action: 'texted' });
  await expectTicked(party.request_key, 'party, invoice marked sent by text');
  await s.post(`/admin/invoices/${pInv}/status`, { action: 'void' });
  await s.post(`/admin/invoices/${pInv}/status`, { action: 'unvoid' });
  await expectStep1(party.request_key, 'party, invoice voided then brought back (a draft again)');

  // A payment recorded on the never-sent draft -> ticked; "Mark as not paid" -> a draft again, Step 1.
  await s.post(`/admin/invoices/${p2Inv}/status`, { action: 'deposit_paid', method: 'cash' });
  await expectTicked(party2.request_key, 'party 2, deposit recorded on the draft');
  await s.post(`/admin/invoices/${p2Inv}/status`, { action: 'unpaid' });
  const back = await s.one('SELECT status FROM invoices WHERE id = ?1', p2Inv);
  must(back && back.status === 'draft', `"Mark as not paid" on a never-sent draft left it "${back && back.status}", not a draft`);
  await expectStep1(party2.request_key, 'party 2, payment taken back');
  must((await s.one('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ?1', p2Inv)).n >= 1, '"Mark as not paid" deleted the payment row (it must only void it)');

  // Job done -> ticked; Undo job done -> Step 1.
  await s.post('/admin/requests/jobdone', { r: s.rk(party.request_key) });
  await expectTicked(party.request_key, 'party, Job done');
  await s.post('/admin/requests/jobdone', { r: s.rk(party.request_key), undo: '1' });
  await expectStep1(party.request_key, 'party, Job done undone');

  // Rentals: she moves the pencilled pickup to another day (her booking) -> ticked; she removes
  // it -> Step 1 again.
  const pick = await s.one("SELECT id, date FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", rent.request_key);
  await s.post(`/admin/calendar/bookings/${pick.id}/move`, { date: plus(17) });
  must((await s.one('SELECT edited_by_hand FROM bookings WHERE id = ?1', pick.id)).edited_by_hand === 1, 'moving a booking did not mark it hers');
  await expectTicked(rent.request_key, 'rentals, pickup moved by hand');
  await s.post(`/admin/calendar/bookings/${pick.id}/delete`, {});
  await expectStep1(rent.request_key, 'rentals, the moved pickup taken off the calendar');

  // Rentals: invoice sent -> ticked (the second invoice path, the rental's own draft).
  await s.post(`/admin/invoices/${rInv}/status`, { action: 'texted' });
  await expectTicked(rent.request_key, 'rentals, invoice marked sent by text');

  // 4. Nothing was written to request_steps by the derivation; a tapped Called back survives undo.
  must(await stepRows() === steps0, `the derived tick wrote request_steps rows (${steps0} -> ${await stepRows()})`);
  await s.post('/admin/requests/talked', { r: s.rk(party.request_key), go: 'later' });
  await s.post('/admin/requests/jobdone', { r: s.rk(party.request_key) });
  await s.post('/admin/requests/jobdone', { r: s.rk(party.request_key), undo: '1' });
  const kept = await card(party.request_key);
  must(calledDone(kept) && cur(kept) !== 'called' && !(await inCallback(party.request_key)), 'a "Called back" she tapped was lost when Job done was undone');
}

// ---- 5. One derivation, read everywhere -------------------------------------------------------
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
must(/pastFirstCall\(\{[^}]*booked: bookedByHand\(st, bookings\)/.test(src('functions/_lib/steps.mjs')), 'steps.mjs does not read progress.mjs pastFirstCall with bookedByHand');
must(/s\.called\) continue;/.test(src('functions/_lib/callback-list.mjs')), 'callback-list.mjs stops reading the derived s.called');
must((src('functions/_lib/todo-email.mjs').match(/!f\.s\.called/g) || []).length >= 2 && /callbackRows\(db, today, facts\)/.test(src('functions/_lib/todo-email.mjs')), 'todo-email.mjs stops reading the derived s.called / callbackRows');
must(/edited_by_hand FROM bookings WHERE request_key IS NOT NULL/.test(src('functions/_lib/callback-list.mjs')) && /edited_by_hand FROM bookings WHERE request_key IS NOT NULL/.test(src('functions/_lib/takedown.mjs')), 'the card / list bookings no longer carry edited_by_hand (her booking cannot be told apart)');
must(/edited_by_hand: k\.edited_by_hand/.test(src('functions/_lib/admin.mjs')), 'the Requests page bookings no longer carry edited_by_hand');
must(!/\.prepare\(|\bdb\b/.test(src('functions/_lib/progress.mjs')), 'progress.mjs touches the database (the later-step tick must be derived, never stored)');

if (checks < 80) errors.push(`Rule 0: only ${checks} checks ran (want >= 80)`);
if (errors.length) {
  console.error(`validate:admin-step-tick FAILED (${errors.length} of ${checks}):\n- ${errors.slice(0, 40).join('\n- ')}`);
  process.exit(1);
}
console.log(`validate:admin-step-tick ok (${checks} checks)`);
