#!/usr/bin/env node
/**
 * Three ways a job ends (owner-approved mock-up "Done Cards", 20 Oct 2026; docs/admin-console.md).
 * Fails when:
 *  1. the rules table drifts: a Finished card is not ONE big "✓ Mark as done" + a small Put away; a
 *     Done card is not Put away + "Not done after all (undo)"; a Cancelled (void) card is not Put away
 *     + "Not cancelled after all (undo)"; groupOf / the filters (Everything (active + done), Active
 *     only, Done only, Cancelled only) read anything else;
 *  2. the money words drift ("Paid $110 · $50 deposit returned", "Nothing owed · invoice voided"), or
 *     the deposit held is not ledger balanceOf (paidDeposit) less what was refunded or kept;
 *  3. the main page is not Active, then "✓ Done (N)" (open, newest finished first, Hide done ▴ /
 *     Show done ▾, remembered with try/catch storage), then "✕ Cancelled (N)" (folded), then Put
 *     away (with the owner's wording); a Done card is not greyed with a green ✓ watermark and
 *     "✓ DONE · <date>", Call / Text, its money in words and its two small buttons; a Cancelled card
 *     uses red anywhere, or lacks the grey ✕ and "✕ CANCELLED · <date>"; a filter shows the wrong groups;
 *  4. the real routes (in-memory database) do not: refuse Done while a refundable deposit is held and
 *     no answer is given; record the refund / kept row (kind 'refund' / 'deposit_kept') and set
 *     done_at; land on the card she was looking at with the thin green "✓ <First> is done" banner and
 *     its Show me ↓; undo exactly (done_at cleared, the recorded row voided); Cancel with money in ask
 *     first and record refunded / kept / part; Not cancelled after all bring the invoice back as a
 *     draft and void the rows Cancel recorded; Put away + Bring back return a card to its group;
 *     never touch an existing payment row;
 *  5. a Done or Cancelled request still reaches the 7 AM to-do email, the callback list, the
 *     reminders or the missed-job alarms (one test, util.mjs isEnded, read by every one of them);
 *  6. "filing only" or "Done — put away" is anywhere in functions/ or docs/, or the Put away help
 *     lacks the owner's words.
 * Rule 0: fewer than 120 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const K = await mod('functions/_lib/cards.mjs');
const L = await mod('functions/_lib/ledger.mjs');
const V = await mod('functions/_lib/views.mjs');
const U = await mod('functions/_lib/util.mjs');
const H = await mod('functions/_lib/helptext.mjs');
const MS = await mod('functions/_lib/missed.mjs');
const E = await mod('functions/_lib/admin-endings.mjs');
const OWNER_PUT_AWAY = 'Put Away (these are cards we want to move out of the way and can be put back at any time)';

// ---- 1. rules table, groups, filters -----------------------------------------------------------
for (const services of [['porch'], ['party'], ['grazing'], ['rentals'], ['porch', 'rentals']]) {
  const b = (stage) => K.cardButtons({ services, stage, inv: { id: 1, status: 'paid' } });
  const t = services.join('+');
  const f = b('finished'); must(f.primary === 'card.markDone' && f.secondary.join() === 'card.archive' && !f.more.length, `${t}: Finished is not ✓ Mark as done + Put away (${JSON.stringify(f)})`);
  const d = b('done'); must(d.primary === '' && d.secondary.join() === 'card.archive,card.undone' && !d.more.length, `${t}: Done is not Put away + Not done after all (${JSON.stringify(d)})`);
  const v = b('void'); must(v.primary === '' && v.secondary.join() === 'card.archive,card.uncancel' && !v.more.length, `${t}: Cancelled is not Put away + Not cancelled after all (${JSON.stringify(v)})`);
  must(K.inlineRowKind({ services, stage: 'done' }) === '', `${t}: a Done card shows the takedown row`);
}
must(K.cardStage({ pr: { void: false, finished: true, steps: [] }, done: true }) === 'done' && K.cardStage({ pr: { void: true, steps: [] }, done: true }) === 'void'
  && K.cardStage({ pr: { void: false, steps: [] }, done: true, archived: true }) === 'archived', 'cardStage: Put away > Cancelled > Done order is wrong');
must(K.STAGES.includes('done'), 'STAGES lacks done');
must(K.groupOf({ status: 'void' }) === 'cancelled' && K.groupOf({ status: 'paid' }, { status: 'void' }) === 'cancelled' && K.groupOf({ status: 'paid', done_at: 'x' }) === 'done'
  && K.groupOf({ status: 'void', done_at: 'x' }) === 'cancelled' && K.groupOf({ status: 'paid' }) === 'active' && K.groupOf({}) === 'active', 'groupOf reads the wrong group');
must(K.FILTERS.map(([k, l]) => `${k}=${l}`).slice(0, 4).join('|') === 'all=Everything (active + done)|active=Active only|done=Done only|cancelled=Cancelled only', `filters do not start Everything (active + done), Active only, Done only, Cancelled only: ${K.FILTERS.slice(0, 4)}`);
for (const [f, g, want] of [['all', 'done', true], ['all', 'cancelled', true], ['active', 'active', true], ['active', 'done', false], ['done', 'done', true], ['done', 'active', false], ['cancelled', 'cancelled', true], ['cancelled', 'done', false], ['porch', 'done', true]]) {
  must(K.matchesFilter(f, { services: ['porch'], inv: null, group: g }) === want, `filter ${f} on a ${g} card reads ${!want}`);
}

// ---- 2. money words + the deposit held ---------------------------------------------------------
const bal = (o = {}) => ({ total: 16000, charges: 11000, refundable: 5000, paid: 16000, paidCharges: 11000, paidDeposit: 5000, owed: 0, depositOwed: 0, remaining: 0, void: false, paidInFull: true, ...o });
must(L.depositHeldCents(bal(), null) === 5000 && L.depositHeldCents(bal(), { refunded: 5000, kept: 0 }) === 0 && L.depositHeldCents(bal(), { refunded: 2000, kept: 1000 }) === 2000 && L.depositHeldCents(bal({ void: true }), null) === 0, 'depositHeldCents is not paidDeposit less refunded and kept');
must(L.cancelHeldCents(bal({ paid: 15000 }), { refunded: 5000, kept: 0 }) === 10000 && L.cancelHeldCents(null) === 0, 'cancelHeldCents is not paid less refunded and kept');
const real = L.balanceOf({ status: 'paid' }, [{ qty: 1, unit_cents: 11000, refundable: 0 }, { qty: 1, unit_cents: 5000, refundable: 1 }], 16000);
must(L.depositHeldCents(real, null) === 5000 && real.paidCharges === 11000, 'balanceOf does not feed the held deposit (the one source)');
for (const [o, want] of [
  [{ refunded: 5000 }, 'Paid $110 · $50 deposit returned'], [{ kept: 5000 }, 'Paid $110 · $50 deposit kept'], [null, 'Paid $110 · $50 deposit still held'],
  [{ refunded: 3000, kept: 2000 }, 'Paid $110 · $30 deposit returned · $20 deposit kept']]) {
  const w = K.endedMoneyWords('done', { bal: bal(), out: o }); must(w === want, `done words: "${w}", want "${want}"`);
}
must(K.endedMoneyWords('done', { bal: bal({ refundable: 0, total: 11000, paid: 11000, paidDeposit: 0 }) }) === 'Paid $110', 'done words without a deposit');
must(K.endedMoneyWords('done', { bal: null, status: 'paid' }) === 'Paid in full (no invoice)', 'done words with no invoice');
must(K.endedMoneyWords('cancelled', { bal: bal({ void: true }) }) === 'Nothing owed · invoice voided', 'cancelled words');
must(K.endedMoneyWords('cancelled', { bal: bal({ void: true }), out: { refunded: 10000, kept: 5000 } }) === 'Nothing owed · invoice voided · $100 refunded · $50 kept', 'cancelled words with money');
must(K.endedMoneyWords('cancelled', { bal: null }) === 'Nothing owed', 'cancelled words with no invoice');

// ---- 3. the rendered main page -----------------------------------------------------------------
const mk = (key, name, services = ['porch'], extra = {}) => ({ key, name, services, phone: '901-555-0100', rentals: [], decor: [{ label: 'Event date', value: '2026-10-18' }], other: [], source: 'site', takedownPlan: 'customer_handles', sortTime: Date.parse('2026-10-10'), ...extra });
const lines = [{ description: 'Porch package', qty: 1, unit_cents: 11000, refundable: 0 }, { description: 'Damage deposit', qty: 1, unit_cents: 5000, refundable: 1 }];
const inv = (id, status, b = bal()) => ({ id, status, number: `PNP-T-${id}`, total_cents: 16000, deposit_due_cents: 5000, pay_plan: 'full', lines, balance: b, payments: [{ cents: 16000, on: '2026-10-18' }] });
const reqs = [mk('a|1', 'Ada Active', ['porch'], { sortTime: 1 }), mk('f|1', 'Fay Finished', ['porch'], { sortTime: 2 }), mk('d|1', 'Dot Donelate', ['porch'], { sortTime: 3 }), mk('d|2', 'Dee Doneearly', ['porch'], { sortTime: 4 }),
  mk('c|1', 'Cy Cancelled', ['porch'], { sortTime: 5 }), mk('r|1', 'Rae Rental', ['rentals'], { sortTime: 6 })];
const statuses = {
  'a|1': { status: 'scheduled' },
  'f|1': { status: 'paid', invoice_id: 2, job_done_at: '2026-10-18 12:00:00' },
  'd|1': { status: 'paid', invoice_id: 3, job_done_at: '2026-10-18 12:00:00', done_at: '2026-10-20 17:00:00' },
  'd|2': { status: 'paid', invoice_id: 4, job_done_at: '2026-10-17 12:00:00', done_at: '2026-10-19 15:00:00' },
  'c|1': { status: 'void', invoice_id: 5, cancelled_at: '2026-10-20 15:00:00' },
  'r|1': { status: 'paid', invoice_id: 6, job_done_at: '2026-10-18 12:00:00', done_at: '2026-10-18 13:00:00', archived_at: '2026-10-19 10:00:00' },
};
const invoices = { 2: inv(2, 'paid'), 3: inv(3, 'paid'), 4: inv(4, 'paid'), 5: inv(5, 'void', bal({ void: true, paid: 0, paidCharges: 0, paidDeposit: 0 })), 6: inv(6, 'paid') };
const depositOut = { 3: { refunded: 5000, kept: 0 }, 4: { refunded: 0, kept: 5000 }, 6: { refunded: 5000, kept: 0 } };
const doneBookings = (k) => ({ [k]: [{ id: 1, kind: 'porch_install', date: '2026-10-18', done_at: '2026-10-18 12:00:00' }] });
const page = (o = {}) => V.dashboardPage({ requests: reqs.filter((r) => !(o.statuses || statuses)[r.key].archived_at), archived: reqs.filter((r) => (o.statuses || statuses)[r.key].archived_at), statuses, invoices, depositOut, folderUrl: 'x', today: '2026-10-20',
  bookings: { ...doneBookings('f|1'), ...doneBookings('d|1'), ...doneBookings('d|2') }, kinds: { 'f|1': ['porch_install'], 'd|1': ['porch_install'], 'd|2': ['porch_install'] }, schedule: { 'a|1': { date: '2026-10-24' }, 'f|1': { date: '2026-10-18' } },
  stored: Object.fromEntries(reqs.map((r) => [r.key, { called_at: 'x', confirmed_at: 'x' }])), ...o });
const rk = (k) => U.b64urlText(k);
const cardOf = (html, k) => { const i = html.indexOf(`id="c-${rk(k)}"`); if (i < 0) return ''; const s = html.lastIndexOf('<article', i); return html.slice(s, html.indexOf('</article>', i)); };
const pos = (html, s) => html.indexOf(s);
const home = page();
const iDone = pos(home, 'data-done-group'); const iCx = pos(home, 'data-cancelled-group'); const iPut = pos(home, 'id="put-away-section"');
must(pos(home, 'data-request-list') > 0 && pos(home, 'data-request-list') < iDone && iDone < iCx && iCx < iPut, 'the main page is not Active, Done, Cancelled, Put away in that order');
const list = home.slice(pos(home, 'data-request-list'), iDone);
must(list.includes(`id="c-${rk('a|1')}"`) && list.includes(`id="c-${rk('f|1')}"`) && !list.includes(`id="c-${rk('d|1')}"`) && !list.includes(`id="c-${rk('c|1')}"`), 'the active list holds a done / cancelled card, or lost an active one');
const doneSec = home.slice(iDone, iCx);
must(/<details class="endd" id="done-list" data-remember="done" open><summary data-help="req\.doneToggle"[^>]*><span class="eh">✓ Done \(2\)<\/span><span class="tog"><span class="t-open">Hide done ▴<\/span><span class="t-shut">Show done ▾<\/span><\/span><\/summary>/.test(doneSec), 'the Done group is not "✓ Done (2)" open with Hide done ▴ / Show done ▾');
must(pos(doneSec, `c-${rk('d|1')}`) > 0 && pos(doneSec, `c-${rk('d|1')}`) < pos(doneSec, `c-${rk('d|2')}`), 'Done is not newest finished first');
const cxSec = home.slice(iCx, iPut);
must(/<details class="endd" id="cancelled-list" data-remember="cancelled"><summary data-help="req\.cancelledToggle"[^>]*><span class="eh">✕ Cancelled \(1\)<\/span><span class="tog"><span class="t-open">Hide cancelled ▴<\/span><span class="t-shut">Show cancelled ▾<\/span><\/span><\/summary>/.test(cxSec), 'the Cancelled group is not "✕ Cancelled (1)", folded, with Show cancelled ▾');
const dc = cardOf(home, 'd|1');
must(/^<article class="card stepcard ended isdone" data-card="[^"]+" id="c-[^"]+" data-reqcard data-ended="done" data-stage="done"/.test(dc), 'a Done card is not the greyed ended card');
must(dc.includes('<span class="wm" aria-hidden="true">✓</span>') && /article\.isdone \.wm\{color:rgba\(47,107,53,\.13\)\}/.test(home), 'a Done card lacks its large faint green ✓ watermark');
must(dc.includes('<p class="endlbl ok" data-ended-label>✓ DONE · 20 Oct</p>') && /\.endlbl\.ok\{color:#2f6b35\}/.test(home), `a Done card's label is not the green "✓ DONE · 20 Oct" (${(dc.match(/data-ended-label>[^<]*/) || [''])[0]})`);
must(dc.includes('<p class="endmoney" data-ended-money>Paid $110 · $50 deposit returned</p>'), 'a Done card does not say "Paid $110 · $50 deposit returned"');
must(cardOf(home, 'd|2').includes('data-ended-money>Paid $110 · $50 deposit kept<') && cardOf(home, 'd|2').includes('✓ DONE · 19 Oct'), 'the kept-deposit Done card reads wrong');
must(/data-quick-contact><a href="tel:9015550100"[^>]*>&#128222; Call<\/a><a href="sms:9015550100"[^>]*>&#128172; Text ▾<\/a>/.test(dc) && pos(dc, 'data-quick-contact') < pos(dc, 'data-ended-label'), 'a Done card lost Call / Text top right');
must(!/data-step=|data-next-step|class="btn primary"|data-steps/.test(dc), 'a Done card still shows step dots, a next step or a big button');
must(/data-ended-buttons>[\s\S]*?data-help="card\.archive"[^>]*>Put away<\/button>[\s\S]*?action="\/admin\/requests\/undone"[\s\S]*?data-help="card\.undone"[^>]*>Not done after all \(undo\)<\/button><\/div><\/form><\/div>/.test(dc), 'a Done card lacks its small Put away + Not done after all (undo), or they are not the only two');
const cc = cardOf(home, 'c|1');
must(cc.includes('<span class="wm" aria-hidden="true">✕</span>') && cc.includes('<p class="endlbl grey" data-ended-label>✕ CANCELLED · 20 Oct</p>') && /\.endlbl\.grey\{color:#6b6460\}/.test(home), 'a Cancelled card lacks the grey ✕ and "✕ CANCELLED · 20 Oct"');
must(cc.includes('data-ended-money>Nothing owed · invoice voided<'), 'a Cancelled card does not say "Nothing owed · invoice voided"');
must(/data-ended-buttons>[\s\S]*?data-help="card\.archive"[^>]*>Put away<\/button><\/div><\/form><\/div>\s*<details class="disclose more"/.test(cc) && /data-uncancel[^>]*>↩ Not cancelled after all<\/button>/.test(cc) && !/data-void-link|class="btn primary"|class="btn danger"|linkbtn danger|\bmiss\b|#8f3427|#b91c1c|red/i.test(cc.replace(/data-help="[^"]*"|title="[^"]*"/g, '')), 'a Cancelled card is red somewhere, offers Cancel again, or lacks Put away + ↩ Not cancelled after all');
must(!/\.(iscancelled|cxgrp|endlbl\.grey)[^{]*\{[^}]*(#8f3427|#b91c1c|#dc2626|red)/i.test(V.ENDED_CSS), 'the Cancelled styles use red');
must(/<h2>Put away \(1\) <small class="panote" data-put-away-note>\(these are cards we want to move out of the way and can be put back at any time\)<\/small><\/h2>/.test(home), 'Put away lacks the owner\'s words under its heading');
const pa = cardOf(home, 'r|1');
must(/data-archived=/.test(pa) && /data-help="pa\.bringBack"/.test(pa) && !/data-ended=/.test(pa), 'a put-away Done card is not in Put away with Bring back');
// The Finished card: ONE big "✓ Mark as done", the deposit question, a small Put away.
const fc = cardOf(home, 'f|1');
must(/data-stage="finished"/.test(fc) && (fc.match(/class="btn primary"/g) || []).length === 2 && /<summary class="btn primary" data-help="card\.markDone"[^>]*>✓ Mark as done<\/summary>/.test(fc), 'the Finished card is not ONE big ✓ Mark as done (with its deposit question)');
must(/Did you return Fay&#39;s \$50 deposit\?/.test(fc) && /The card still shows the \$50 refundable deposit as held\./.test(fc), 'the deposit question does not read "Did you return Fay\'s $50 deposit?"');
must(/name="deposit" value="returned"><button class="btn primary" type="submit" data-help="card\.doneReturned"[^>]*>Yes, I returned \$50 \(record it and mark done\)<\/button>/.test(fc)
  && /name="deposit" value="kept"><button class="btn ghost" type="submit" data-help="card\.doneKept"[^>]*>I kept it \(record that, and mark done\)<\/button>/.test(fc)
  && /data-help="card\.doneNotYet"[^>]*>✕ Not yet, go back<\/button>/.test(fc), 'the deposit question lacks its three answers');
must((fc.match(/data-help="card\.archive"/g) || []).length === 1 && /data-finished-putaway>[\s\S]*?>Put away<\/button>/.test(fc) && !/Done — put away/.test(fc), 'the Finished card lacks ONE small Put away (or shows it twice)');
// With the deposit already back: the button goes straight to Done.
const fc2 = cardOf(page({ depositOut: { ...depositOut, 2: { refunded: 5000, kept: 0 } } }), 'f|1');
must(/<form method="post" action="\/admin\/requests\/done" data-done-form><input type="hidden" name="r" value="[^"]+"><input type="hidden" name="at" value=""><div class="act"><button class="btn primary" type="submit" data-help="card\.markDone"[^>]*>✓ Mark as done<\/button>/.test(fc2) && !/data-deposit-check/.test(fc2)
  && /data-finished-facts>Paid, job done, deposit returned\.</.test(fc2), 'with the deposit back, ✓ Mark as done does not go straight to Done (or the facts line is wrong)');
// Cancel with money in asks first; without, the plain confirm.
const ac = cardOf(page({ statuses: { ...statuses, 'a|1': { status: 'deposit_paid', invoice_id: 7 } }, invoices: { ...invoices, 7: inv(7, 'deposit_paid', bal({ paid: 15000, paidCharges: 10000, owed: 1000, remaining: 1000, paidInFull: false })) } }), 'a|1');
must(/<summary class="cxbtn" data-help="card\.cancelJob"[^>]*>✕ Cancel this job<\/summary>[\s\S]*They paid \$150\. What happens to it\?<\/strong><\/p><p class="muted">Pick one and the job is cancelled\. Your Money page stays right\. Ada is not told\.<\/p>/.test(ac)
  && /value="refund"><button class="btn" type="submit" data-help="card\.cancelRefund"[^>]*>I refunded the \$150 \(record it and cancel\)/.test(ac)
  && /value="keep"><button class="btn ghost" type="submit" data-help="card\.cancelKeep"[^>]*>I&#39;m keeping the \$150 \(record it and cancel\)/.test(ac)
  && /data-help="card\.cancelPart"[^>]*>I refunded part of it…<\/summary>[\s\S]*name="amount" type="number"[^>]*max="150\.00"/.test(ac) && /data-help="card\.cancelNotYet"[^>]*>No, keep the job</.test(ac), 'Cancel with $150 in does not ask refunded / keeping / part / No, keep the job');
// "✕ Cancel this job" on EVERY card face that is not cancelled (owner, 21 Oct 2026: "all jobs should be
// able to be cancelled with 2 taps"; Carmen's put-away card had none): its own row right under Show
// more, never inside it, once; a cancelled card has "↩ Not cancelled after all" there instead.
const moreSplit = (c) => {
  const s0 = c.indexOf('<details class="disclose more"'); if (s0 < 0) return { more: '', after: '' };
  const re = /<details\b|<\/details>/g; re.lastIndex = s0; let d = 0; let m;
  while ((m = re.exec(c))) { d += m[0] === '</details>' ? -1 : 1; if (d === 0) return { more: c.slice(s0, m.index), after: c.slice(m.index) }; }
  return { more: '', after: '' };
};
const CANCEL_WORDS = /data-cancel-job|✕ Cancel this job|Cancel this job…|data-void-link|action="\/admin\/requests\/cancel"/;
const cancelFace = (c0, label, undo = false) => {
  const c = c0.replace(/ title="[^"]*"/g, ''); // tooltips may name the button; the markup may not
  const { more, after } = moreSplit(c);
  must(c.length > 0 && more.length > 0 && after.length > 0, `Rule 0: ${label}: no card / no Show more group to look past`);
  must((c.match(/data-cancel-row=/g) || []).length === 1, `${label}: the cancel / undo row is not on the card exactly once`);
  must(!/data-cancel-row|data-uncancel|↩ Not cancelled/.test(more) && !CANCEL_WORDS.test(more), `${label}: Cancel (or its undo) sits inside Show more (it belongs on the card face)`);
  must(!/data-more-row[\s\S]*(data-cancel|Cancel this job)/.test(c.replace(after, '')), `${label}: Cancel is in the quiet More row`);
  if (undo) {
    must(/^<\/details>\s*<div class="cardfoot" data-card-foot>(?:<p class="footinv" data-draft-ready>[\s\S]*?<\/p>)?<div class="cxrow" data-cancel-row="undo"><form method="post" action="\/admin\/requests\/uncancel"><input type="hidden" name="r" value="[^"]+"><button class="cxbtn" type="submit" data-uncancel data-help="card\.uncancel"[^>]*>↩ Not cancelled after all<\/button><\/form><\/div>/.test(after), `${label}: a cancelled card lacks "↩ Not cancelled after all" in the bottom spot`);
    must(!CANCEL_WORDS.test(c), `${label}: a cancelled card still offers ✕ Cancel this job`);
  } else {
    must(/^<\/details>\s*<div class="cardfoot" data-card-foot>(?:<p class="footinv" data-draft-ready>[\s\S]*?<\/p>)?<div class="cxrow" data-cancel-row="cancel"><details class="confirm cxconfirm" data-cancel-job><summary class="cxbtn" data-help="card\.cancelJob"[^>]*>✕ Cancel this job<\/summary>\s*<div class="confirmbox cxbox">/.test(after), `${label}: "✕ Cancel this job" is not the grey button in its own row at the bottom of the card face`);
    must((c.match(/data-cancel-job/g) || []).length === 1 && !/data-uncancel/.test(c), `${label}: Cancel shows twice, or the undo shows on a card that is not cancelled`);
    must((after.match(/class="btn danger" type="submit" data-help="card\.cancelYes"|data-help="card\.cancel(Refund|Keep|PartSave)"/g) || []).length >= 1 && /data-help="card\.cancelNotYet"[^>]*>No, keep (it|the job)</.test(after), `${label}: tap 2 (Yes / the money answers) or "No, keep…" is missing from the confirm`);
  }
};
const nothingPaid = (c, who, num) => /<p><strong>Cancel (\w+)'s job\?<\/strong><\/p><p class="muted">([^<]*)<\/p>[\s\S]*?<button class="btn danger" type="submit" data-help="card\.cancelYes"[^>]*>Yes, cancel (\w+)'s job<\/button><\/form>\s*<button type="button" class="btn ghost" onclick="this\.closest\('details'\)\.open=false" data-help="card\.cancelNotYet"[^>]*>No, keep it<\/button>/.exec(c);
cancelFace(ac, 'active card with $150 in');
const st2 = (o) => ({ ...statuses, ...o });
const NEW = page({ statuses: st2({ 'a|1': { status: 'new' } }), schedule: {} });
const nc = cardOf(NEW, 'a|1');
must(/data-stage="new"/.test(nc), `Rule 0: the New fixture is not a New card (${(nc.match(/data-stage="[^"]*"/) || [''])[0]})`);
cancelFace(nc, 'New card');
const np = nothingPaid(nc);
must(np && np[1] === 'Ada' && np[3] === 'Ada' && np[2] === 'Nothing is owed. Ada is not told. You can undo this.', `the nothing-paid confirm is not "Cancel Ada's job?" / "Nothing is owed. Ada is not told. You can undo this." / "Yes, cancel Ada's job" / "No, keep it" (${np && np.slice(1).join(' | ')})`);
const DR = page({ statuses: st2({ 'a|1': { status: 'new', invoice_id: 8 } }), invoices: { ...invoices, 8: inv(8, 'draft', bal({ paid: 0, paidCharges: 0, paidDeposit: 0, owed: 16000, remaining: 16000, paidInFull: false })) }, schedule: {} });
const dp = nothingPaid(cardOf(DR, 'a|1'));
must(dp && dp[2] === 'Invoice PNP-T-8 is voided, so nothing is owed. Ada is not told. You can undo this.', `the nothing-paid confirm with an invoice does not name it (${dp && dp[2]})`);
cancelFace(cardOf(home, 'a|1'), 'active (on the calendar) card');
cancelFace(fc, 'Finished card');
cancelFace(dc, 'Done card');
must(/They paid \$110\. What happens to it\?/.test(dc), 'a Done card ($160 in, $50 returned) does not ask what happens to the $110');
cancelFace(pa, 'put-away Done card');
const PUT = page({ statuses: st2({ 'a|1': { status: 'scheduled', archived_at: '2026-10-20 09:00:00' } }), openPutAway: true });
const pac = cardOf(PUT, 'a|1');
must(/data-archived=/.test(pac) && pos(PUT, `id="c-${rk('a|1')}"`) > pos(PUT, 'id="put-away-section"'), 'Rule 0: the put-away active fixture is not under Put away');
cancelFace(pac, 'put-away active card (Carmen\'s case)');
cancelFace(cc, 'Cancelled card', true);
const PCX = page({ statuses: st2({ 'c|1': { status: 'void', invoice_id: 5, cancelled_at: '2026-10-20 15:00:00', archived_at: '2026-10-20 16:00:00' } }), openPutAway: true });
cancelFace(cardOf(PCX, 'c|1'), 'put-away Cancelled card', true);
// Grey, never red; phone-sized (48px tall).
const cxCss = (V.CARD_CSS.match(/\.cxbtn\{[^}]*\}/) || [''])[0];
must(/border:2px solid #7b7169/.test(cxCss) && /color:#5f5650/.test(cxCss) && /min-height:48px/.test(cxCss) && !/#8f3427|#b91c1c|#dc2626|\bred\b|danger/i.test(cxCss) && home.includes(cxCss), `the Cancel button is not the grey outlined 48px button on the page (${cxCss})`);
must(!/class="cxbtn[^"]*(danger|primary)/.test(home + PUT + PCX), 'the Cancel button carries a red / primary class');
// Filters.
const only = (f) => { const h = page({ filter: f }); return { h, done: /data-done-group/.test(h), cx: /data-cancelled-group/.test(h), act: h.slice(pos(h, 'data-request-list'), pos(h, 'data-request-list') + 400).includes(`id="c-${rk('a|1')}"`) }; };
const fa = only('active'); must(fa.act && !fa.done && !fa.cx, 'Active only still shows the Done or Cancelled group');
const fd = only('done'); must(!fd.act && fd.done && !fd.cx && /id="done-list" data-remember="done" open data-forced/.test(fd.h), 'Done only does not show just the Done group, open');
const fx = only('cancelled'); must(!fx.act && !fx.done && fx.cx && /id="cancelled-list" data-remember="cancelled" open data-forced/.test(fx.h), 'Cancelled only does not show just the Cancelled group, open');
must(/<option value="all" data-href="\/admin\/" selected>Everything \(active \+ done\) \(4\)<\/option><option value="active"[^>]*>Active only \(2\)<\/option><option value="done"[^>]*>Done only \(2\)<\/option><option value="cancelled"[^>]*>Cancelled only \(1\)<\/option>/.test(home), 'the pull-down counts are not Everything 4 / Active 2 / Done 2 / Cancelled 1');
must(/id="cancelled-list" data-remember="cancelled" open data-forced/.test(page({ openCancelled: true })), 'after Cancel the Cancelled group is not opened');
// The banner and the remembered toggle.
const at = `c-${rk('a|1')}`;
const bh = page({ doneOk: rk('d|1'), doneAt: at });
must(/<div class="donebanner" id="done-banner" data-done-banner role="status"><span>✓ <b>Dot is done\.<\/b> Dot moved to the Done group\.<\/span> <a href="#c-[^"]+" data-show-me data-help="req\.showMe"[^>]*>Show me ↓<\/a><button type="button" class="dbx" data-done-close data-help="req\.doneClose"[^>]*>✕ Close<\/button><\/div>/.test(bh), 'the "✓ Dot is done. Dot moved to the Done group. Show me ↓" banner is wrong');
must(pos(bh, 'data-done-banner') < pos(bh, `id="${at}"`) && pos(bh, 'data-done-banner') > pos(bh, 'data-request-list') && bh.slice(pos(bh, 'data-done-banner'), pos(bh, `id="${at}"`)).split('<article').length === 2, 'the banner is not right above the card she was looking at');
must(bh.includes(`href="#c-${rk('d|1')}" data-show-me`), 'Show me ↓ does not go to the Done card');
must(/try\{var v=localStorage\.getItem\(key\(d\)\)[\s\S]*?\}catch\(e\)\{\}/.test(V.ENDED_JS) && /try\{localStorage\.setItem\(key\(d\),d\.open\?'1':'0'\);\}catch\(e\)\{\}/.test(V.ENDED_JS) && /classList\.add\('glow'\)/.test(V.ENDED_JS) && bh.includes(V.ENDED_JS), 'the remembered toggle / Show me glow script is missing or uses storage without try/catch');
must(!/id="done-banner"/.test(home), 'the done banner shows without a Done');

// ---- 4. the real routes ------------------------------------------------------------------------
const s = await session();
const today = (await mod('functions/_lib/reminders.mjs')).chicagoDate();
const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
let invN = 900;
async function fixture(name, email, { paid = 16000, refundable = 5000, jobDone = true, booking = addDays(today, -2) } = {}) {
  const sr = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'yes', event_date: '2030-10-24', location: 'Germantown', name, phone: '901-555-0177', email });
  const key = sr.row.request_key;
  await s.db.prepare("UPDATE requests SET takedown_plan = 'customer_handles' WHERE request_key = ?1").bind(key).run();
  invN += 1;
  const { meta } = await s.db.prepare("INSERT INTO invoices (number, request_key, customer_name, issue_date, due_date, deposit_due_cents, status, sent_at) VALUES (?1, ?2, ?3, '2026-10-01', '2026-10-05', 5000, ?4, datetime('now'))")
    .bind(`PNP-T-${invN}`, key, name, paid >= 11000 + refundable ? 'paid' : 'deposit_paid').run();
  const id = meta.last_row_id;
  await s.db.prepare("INSERT INTO invoice_lines (invoice_id, position, description, qty, unit_cents, refundable) VALUES (?1, 0, 'Porch package', 1, 11000, 0)").bind(id).run();
  if (refundable) await s.db.prepare("INSERT INTO invoice_lines (invoice_id, position, description, qty, unit_cents, refundable) VALUES (?1, 1, 'Damage deposit', 1, ?2, 1)").bind(id, refundable).run();
  if (paid) await s.db.prepare("INSERT INTO payments (invoice_id, amount_cents, received_on, method, note, kind) VALUES (?1, ?2, '2026-10-02', 'zelle', 'paid', 'payment')").bind(id, paid).run();
  await s.db.prepare(`INSERT INTO request_status (request_key, status, invoice_id, job_done_at, updated_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))
    ON CONFLICT(request_key) DO UPDATE SET status = excluded.status, invoice_id = excluded.invoice_id, job_done_at = excluded.job_done_at`).bind(key, paid >= 11000 + refundable ? 'paid' : 'deposit_paid', id, jobDone ? `${addDays(today, -2)} 12:00:00` : null).run();
  await s.db.prepare("INSERT INTO request_steps (request_key, called_at, confirmed_at, how) VALUES (?1, datetime('now'), datetime('now'), 'test') ON CONFLICT(request_key) DO UPDATE SET called_at = excluded.called_at, confirmed_at = excluded.confirmed_at").bind(key).run();
  await s.db.prepare("INSERT INTO bookings (request_key, kind, date, customer_name, invoice_id, edited_by_hand, done_at) VALUES (?1, 'porch_install', ?2, ?3, ?4, 1, ?5)").bind(key, booking, name, id, jobDone ? `${booking} 12:00:00` : null).run();
  return { key, rk: s.rk(key), id };
}
const A = await fixture('Ann Example', 'ann.example@example.com');
const B = await fixture('Ben Sample', 'ben.sample@example.com');
const before = JSON.stringify(await s.all("SELECT id, invoice_id, amount_cents, received_on, method, note, kind, voided_at FROM payments WHERE kind = 'payment' ORDER BY id"));
must(JSON.parse(before).length === 2, 'Rule 0: the route fixtures have no payments');
let pg = await s.get('/admin/');
must(/data-stage="finished"/.test(cardOf(pg.text, A.key)) && /data-deposit-check/.test(cardOf(pg.text, A.key)), 'Ann (paid, job done, deposit held) is not a Finished card asking about the deposit');
// Done without an answer is refused.
let res = await s.post('/admin/requests/done', { r: A.rk, at: '' });
must(res.status === 303 && /[?&]e=/.test(res.location) && !(await s.one('SELECT done_at FROM request_status WHERE request_key = ?1', A.key)).done_at, 'Done with a deposit held and no answer was not refused');
// Returned: the refund row, done_at, and the landing.
res = await s.post('/admin/requests/done', { r: A.rk, at: `c-${B.rk}`, deposit: 'returned' });
const aSt = await s.one('SELECT done_at FROM request_status WHERE request_key = ?1', A.key);
const aRef = await s.all('SELECT amount_cents, kind, note, voided_at FROM payments WHERE invoice_id = ?1 AND kind <> \'payment\'', A.id);
must(Boolean(aSt.done_at), 'Done did not set done_at');
must(aRef.length === 1 && aRef[0].kind === 'refund' && aRef[0].amount_cents === 5000 && aRef[0].note.endsWith(L.DONE_TAG) && !aRef[0].voided_at, `Done did not record the $50 refund (${JSON.stringify(aRef)})`);
must(res.location === `/admin/?doneok=${encodeURIComponent(A.rk)}&at=${encodeURIComponent(`c-${B.rk}`)}#done-banner`, `Done did not land on the next card with the banner (${res.location})`);
pg = await s.get(res.location.replace('#done-banner', ''));
must(/✓ <b>Ann is done\.<\/b> Ann moved to the Done group\./.test(pg.text) && pos(pg.text, 'data-done-banner') < pos(pg.text, `id="c-${B.rk}"`), 'after Done the banner is not above Ben\'s card');
const aCard = cardOf(pg.text, A.key);
must(/data-ended="done"/.test(aCard) && aCard.includes(`✓ DONE · ${V.endedDay(aSt.done_at)}`) && aCard.includes('data-ended-money>Paid $110 · $50 deposit returned<') && pos(pg.text, `id="c-${A.rk}"`) > pos(pg.text, 'data-done-group'), 'Ann is not in the Done group reading "Paid $110 · $50 deposit returned"');
// Kept.
res = await s.post('/admin/requests/done', { r: B.rk, at: '', deposit: 'kept' });
must((await s.all("SELECT 1 FROM payments WHERE invoice_id = ?1 AND kind = 'deposit_kept' AND amount_cents = 5000 AND voided_at IS NULL", B.id)).length === 1 && res.location.endsWith('#done-banner'), 'Done (kept) did not record the $50 kept');
// Undo: exactly as it was.
await s.post('/admin/requests/undone', { r: B.rk });
must(!(await s.one('SELECT done_at FROM request_status WHERE request_key = ?1', B.key)).done_at && (await s.all("SELECT 1 FROM payments WHERE invoice_id = ?1 AND kind = 'deposit_kept' AND voided_at IS NULL", B.id)).length === 0, 'Not done after all did not clear done_at and take the kept row off');
pg = await s.get('/admin/');
must(/data-stage="finished"/.test(cardOf(pg.text, B.key)) && /data-deposit-check/.test(cardOf(pg.text, B.key)) && pos(pg.text, `id="c-${B.rk}"`) < pos(pg.text, 'data-done-group'), 'after the undo Ben is not back with the active cards, asking about the deposit again');
// Put away a Done card, then Bring back: it returns to Done.
await s.post('/admin/requests/archive', { r: A.rk });
pg = await s.get('/admin/?pa=1');
must(pos(pg.text, `id="c-${A.rk}"`) > pos(pg.text, 'id="put-away-section"') && /data-archived=/.test(cardOf(pg.text, A.key)), 'a put-away Done card is not under Put away');
await s.post('/admin/requests/unarchive', { r: A.rk });
pg = await s.get('/admin/');
must(pos(pg.text, `id="c-${A.rk}"`) > pos(pg.text, 'data-done-group') && pos(pg.text, `id="c-${A.rk}"`) < pos(pg.text, 'data-cancelled-group') && /data-ended="done"/.test(cardOf(pg.text, A.key)), 'Bring back did not return the Done card to Done');
// Cancel with $150 in: asks first, then part = $100 refunded, $50 kept.
const C1 = await fixture('Cal Cancel', 'cal.cancel@example.com', { paid: 15000, jobDone: false, booking: addDays(today, 5) });
res = await s.post('/admin/requests/cancel', { r: C1.rk });
must(/[?&]e=/.test(res.location) && (await s.one('SELECT status FROM invoices WHERE id = ?1', C1.id)).status !== 'void', 'Cancel with money in and no answer was not refused');
res = await s.post('/admin/requests/cancel', { r: C1.rk, how: 'part', amount: '999' });
must(/[?&]e=/.test(res.location) && (await s.one('SELECT status FROM invoices WHERE id = ?1', C1.id)).status !== 'void', 'Cancel with a part refund over what they paid was not refused');
res = await s.post('/admin/requests/cancel', { r: C1.rk, how: 'part', amount: '100' });
const cRows = await s.all("SELECT kind, amount_cents, note FROM payments WHERE invoice_id = ?1 AND kind <> 'payment' AND voided_at IS NULL ORDER BY id", C1.id);
const cSt = await s.one('SELECT status, cancelled_at FROM request_status WHERE request_key = ?1', C1.key);
must(JSON.stringify(cRows.map((x) => [x.kind, x.amount_cents])) === '[["refund",10000],["deposit_kept",5000]]' && cRows.every((x) => x.note.endsWith(L.CANCEL_TAG)), `Cancel (part) did not record $100 refunded + $50 kept (${JSON.stringify(cRows)})`);
must((await s.one('SELECT status FROM invoices WHERE id = ?1', C1.id)).status === 'void' && cSt.status === 'void' && Boolean(cSt.cancelled_at), 'Cancel did not void the invoice and the request (with its day)');
must((await s.all('SELECT 1 FROM bookings WHERE invoice_id = ?1', C1.id)).length === 0, 'Cancel left the booking on the invoice (Void takes it off the calendar)');
must(/[?&]cx=/.test(res.location) && res.location.endsWith(`#c-${C1.rk}`), `Cancel did not land on the card in an opened Cancelled group (${res.location})`);
pg = await s.get(res.location.split('#')[0]);
const cCard = cardOf(pg.text, C1.key);
must(/id="cancelled-list" data-remember="cancelled" open data-forced/.test(pg.text) && /data-ended="cancelled"/.test(cCard) && cCard.includes('data-ended-money>Nothing owed · invoice voided · $100 refunded · $50 kept<') && cCard.includes(`✕ CANCELLED · ${V.endedDay(cSt.cancelled_at)}`), 'the cancelled card does not read "Nothing owed · invoice voided · $100 refunded · $50 kept"');
// Not cancelled after all.
await s.post('/admin/requests/uncancel', { r: C1.rk });
const uSt = await s.one('SELECT status, cancelled_at FROM request_status WHERE request_key = ?1', C1.key);
must((await s.one('SELECT status FROM invoices WHERE id = ?1', C1.id)).status === 'draft' && uSt.status !== 'void' && !uSt.cancelled_at
  && (await s.all("SELECT 1 FROM payments WHERE invoice_id = ?1 AND kind <> 'payment' AND voided_at IS NULL", C1.id)).length === 0, 'Not cancelled after all did not bring the invoice back as a draft and take the cancel rows off');
// The existing Void (invoice page) also stamps and clears the cancelled day, and its undo voids Cancel's rows.
await s.post(`/admin/invoices/${C1.id}/status`, { action: 'void', back: '/admin/' });
must(Boolean((await s.one('SELECT cancelled_at FROM request_status WHERE request_key = ?1', C1.key)).cancelled_at), 'the invoice page Void does not stamp the cancelled day');
await s.post(`/admin/invoices/${C1.id}/status`, { action: 'unvoid', back: '/admin/' });
must(!(await s.one('SELECT cancelled_at FROM request_status WHERE request_key = ?1', C1.key)).cancelled_at, 'Bring back (undo Void) does not clear the cancelled day');
// Cancel a put-away card (Carmen's case): it stays put away, lands on the same card with Put away
// open, and "↩ Not cancelled after all" puts the status back exactly as it was.
{
  const P = await fixture('Pia Putaway', 'pia.putaway@example.com', { paid: 0, jobDone: false, booking: addDays(today, 6) });
  await s.db.prepare("UPDATE request_status SET status = 'invoiced' WHERE request_key = ?1").bind(P.key).run();
  await s.post('/admin/requests/archive', { r: P.rk });
  must(Boolean((await s.one('SELECT archived_at FROM request_status WHERE request_key = ?1', P.key)).archived_at), 'Rule 0: the put-away fixture is not put away');
  res = await s.post('/admin/requests/cancel', { r: P.rk });
  const pSt = await s.one('SELECT status, prev_status, archived_at, cancelled_at FROM request_status WHERE request_key = ?1', P.key);
  must(pSt.status === 'void' && pSt.prev_status === 'invoiced' && Boolean(pSt.archived_at) && Boolean(pSt.cancelled_at) && (await s.one('SELECT status FROM invoices WHERE id = ?1', P.id)).status === 'void', `Cancel on a put-away card was refused or lost where it was (${JSON.stringify(pSt)})`);
  must(/[?&]pa=1/.test(res.location) && !/[?&]cx=/.test(res.location) && res.location.endsWith(`#c-${P.rk}`), `Cancel on a put-away card does not land on it with Put away open (${res.location})`);
  pg = await s.get(res.location.split('#')[0]);
  const pc2 = cardOf(pg.text, P.key);
  must(/id="put-away" open/.test(pg.text) && pos(pg.text, `id="c-${P.rk}"`) > pos(pg.text, 'id="put-away-section"'), 'a cancelled put-away card left Put away (or Put away is not open)');
  cancelFace(pc2, 'put-away card after Cancel (real route)', true);
  res = await s.post('/admin/requests/uncancel', { r: P.rk });
  const pU = await s.one('SELECT status, prev_status, archived_at, cancelled_at FROM request_status WHERE request_key = ?1', P.key);
  must(pU.status === 'invoiced' && !pU.prev_status && Boolean(pU.archived_at) && !pU.cancelled_at && /[?&]pa=1/.test(res.location) && res.location.endsWith(`#c-${P.rk}`), `Not cancelled after all did not put the put-away card back exactly (${JSON.stringify(pU)}, ${res.location})`);
  pg = await s.get(res.location.split('#')[0]);
  cancelFace(cardOf(pg.text, P.key), 'put-away card after the undo (real route)');
}
// Cancel a Done card (Ann: $160 in, $50 returned on Done): asks about the $110, stays Done
// underneath, and the undo puts it back in Done.
{
  pg = await s.get('/admin/');
  must(/data-ended="done"/.test(cardOf(pg.text, A.key)), 'Rule 0: Ann is not a Done card before the cancel');
  cancelFace(cardOf(pg.text, A.key), 'Done card (real route)');
  res = await s.post('/admin/requests/cancel', { r: A.rk });
  must(/[?&]e=/.test(res.location) && res.location.endsWith(`#c-${A.rk}`), `Cancel on a Done card with money in did not ask first, on the card (${res.location})`);
  res = await s.post('/admin/requests/cancel', { r: A.rk, how: 'keep' });
  const aC = await s.one('SELECT status, prev_status, done_at FROM request_status WHERE request_key = ?1', A.key);
  must(aC.status === 'void' && aC.prev_status === 'paid' && Boolean(aC.done_at) && /[?&]cx=/.test(res.location) && res.location.endsWith(`#c-${A.rk}`), `Cancel on a Done card was refused or lands wrong (${JSON.stringify(aC)}, ${res.location})`);
  must((await s.all("SELECT 1 FROM payments WHERE invoice_id = ?1 AND kind = 'deposit_kept' AND amount_cents = 11000 AND voided_at IS NULL", A.id)).length === 1, 'Cancel on a Done card did not record the $110 kept');
  pg = await s.get('/admin/');
  must(/data-ended="cancelled"/.test(cardOf(pg.text, A.key)) && pos(pg.text, `id="c-${A.rk}"`) > pos(pg.text, 'data-cancelled-group'), 'a cancelled Done card is not in the Cancelled group');
  await s.post('/admin/requests/uncancel', { r: A.rk });
  const aU = await s.one('SELECT status, prev_status, done_at FROM request_status WHERE request_key = ?1', A.key);
  pg = await s.get('/admin/');
  must(aU.status === 'paid' && !aU.prev_status && Boolean(aU.done_at) && /data-ended="done"/.test(cardOf(pg.text, A.key)) && pos(pg.text, `id="c-${A.rk}"`) < pos(pg.text, 'data-cancelled-group'), `Not cancelled after all did not put the Done card back in Done (${JSON.stringify(aU)})`);
  must((await s.all("SELECT 1 FROM payments WHERE invoice_id = ?1 AND kind = 'deposit_kept' AND voided_at IS NULL", A.id)).length === 0, 'Not cancelled after all left the $110 kept row on the Done card');
}
must(E.restoredStatus('scheduled', true) === 'new' && E.restoredStatus('scheduled', false) === 'scheduled' && E.restoredStatus('paid', true) === 'paid' && E.restoredStatus(null, true) === 'new' && E.restoredStatus('void', false) === 'new', 'restoredStatus does not put the status back (scheduled with an invoice -> new)');
// No existing payment row was touched by any ending.
must(JSON.stringify(await s.all("SELECT id, invoice_id, amount_cents, received_on, method, note, kind, voided_at FROM payments WHERE kind = 'payment' AND invoice_id IN (?1, ?2) ORDER BY id", A.id, B.id)) === before, 'an ending changed an existing payment row');

// ---- 5. Done and Cancelled stay quiet -----------------------------------------------------------
const UTIL_SRC = fs.readFileSync(path.join(ROOT, 'functions/_lib/util.mjs'), 'utf8');
must(/export const isEnded = \(st\) => Boolean\(st && \(st\.archived_at \|\| st\.status === 'void' \|\| st\.done_at\)\);/.test(UTIL_SRC), 'util.mjs isEnded is not put away || void || done');
for (const f of ['callback-list', 'missed', 'todo-email', 'reminders', 'steps', 'requested', 'calendar', 'takedown', 'admin-calendar']) {
  const src = fs.readFileSync(path.join(ROOT, `functions/_lib/${f}.mjs`), 'utf8');
  must(/isEnded\(/.test(src) && /import \{[^}]*\bisEnded\b[^}]*\} from '\.\/util\.mjs';/.test(src), `${f}.mjs does not read the one isEnded test`);
  must(!/archived_at \|\| [\w.[\]]*status === 'void'\)/.test(src), `${f}.mjs keeps its own "put away or void" list (it must read isEnded)`);
}
must(MS.isLiveBooking({ request_key: 'k' }, { statuses: { k: { status: 'paid', done_at: 'x' } } }) === false && MS.isLiveBooking({ request_key: 'k' }, { statuses: { k: { status: 'paid' } } }) === true, 'isLiveBooking counts a Done request');
{
  // A live job with a missed booking, a callback to make and a booking tomorrow: in every list;
  // once Done, in none; once Cancelled, in none.
  const T = await mod('functions/_lib/todo-email.mjs');
  const CB = await mod('functions/_lib/callback-list.mjs');
  const R = await mod('functions/_lib/reminders.mjs');
  const Q = await fixture('Quinn Quiet', 'quinn.quiet@example.com', { paid: 5000, jobDone: false, booking: addDays(today, -1) });
  await s.db.prepare('DELETE FROM request_steps WHERE request_key = ?1').bind(Q.key).run();
  await s.db.prepare("INSERT INTO bookings (request_key, kind, date, customer_name, invoice_id, edited_by_hand) VALUES (?1, 'porch_takedown', ?2, 'Quinn Quiet', ?3, 1)").bind(Q.key, addDays(today, 1), Q.id).run();
  // The callback list holds requests not called back yet: a bare website request (no invoice).
  const cbReq = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'yes', event_date: '2030-10-24', location: 'Germantown', name: 'Cora Callback', phone: '901-555-0178', email: 'cora.callback@example.com' });
  const cbKey = cbReq.row.request_key;
  const tomorrow = new Date(Date.parse(`${today}T18:00:00Z`));
  const where = async () => {
    const d = await T.todoData(s.db, today, Date.parse(`${today}T12:00:00Z`));
    const blob = JSON.stringify(d);
    return { email: /Quinn/.test(blob), callback: (await CB.callbackRows(s.db, today)).some((x) => /Cora/.test(JSON.stringify(x))),
      reminders: (await R.tomorrowsBookings(s.db, tomorrow)).some((b) => b.request_key === Q.key), missed: (await MS.loadMissed(s.db, today)).some((m) => m.key === Q.key) };
  };
  const live = await where();
  must(live.email && live.callback && live.reminders && live.missed, `Rule 0: the live job is not in every list first (${JSON.stringify(live)}), so the quiet check proves nothing`);
  await s.db.prepare("UPDATE request_status SET done_at = datetime('now') WHERE request_key = ?1").bind(Q.key).run();
  await s.db.prepare("INSERT INTO request_status (request_key, status, done_at) VALUES (?1, 'new', datetime('now')) ON CONFLICT(request_key) DO UPDATE SET done_at = datetime('now')").bind(cbKey).run();
  const done = await where();
  for (const [k, v] of Object.entries(done)) must(!v, `a Done request is still in the ${k} list`);
  await s.db.prepare("UPDATE request_status SET done_at = NULL, status = 'void' WHERE request_key IN (?1, ?2)").bind(Q.key, cbKey).run();
  await s.db.prepare("UPDATE invoices SET status = 'void' WHERE id = ?1").bind(Q.id).run();
  const cx = await where();
  for (const [k, v] of Object.entries(cx)) must(!v, `a Cancelled request is still in the ${k} list`);
}

// ---- 6. words ----------------------------------------------------------------------------------
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = [...walk(path.join(ROOT, 'functions')), ...walk(path.join(ROOT, 'docs')).filter((f) => /\.(md|html|txt)$/.test(f))];
must(files.length > 50, 'Rule 0: the word scan read too few files');
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  must(!/filing only/i.test(t) && !/Done — put away/.test(t), `${path.relative(ROOT, f)} still says "filing only" or "Done — put away"`);
}
must(H.HELP['card.archive'].title.startsWith(OWNER_PUT_AWAY) && H.HELP['card.putAway'].title.startsWith(OWNER_PUT_AWAY) && H.HELP['card.archive'].label === 'Put away', 'the Put away help lacks the owner\'s words');
for (const k of ['card.markDone', 'card.doneReturned', 'card.doneKept', 'card.doneNotYet', 'card.undone', 'card.uncancel', 'card.cancelYes', 'card.cancelRefund', 'card.cancelKeep', 'card.cancelPart', 'card.cancelPartSave', 'card.cancelNotYet', 'req.doneToggle', 'req.cancelledToggle', 'req.showMe', 'req.doneClose']) must(Boolean(H.HELP[k] && H.HELP[k].title), `help entry ${k} is missing`);
const MIG = fs.readFileSync(path.join(ROOT, 'migrations/0021_request_done.sql'), 'utf8').replace(/--.*$/gm, '');
must(/ALTER TABLE request_status ADD COLUMN done_at TEXT;/.test(MIG) && /ALTER TABLE request_status ADD COLUMN cancelled_at TEXT;/.test(MIG) && !/\b(UPDATE|DELETE|DROP|INSERT)\b/i.test(MIG), 'migration 0021 is not additive only (done_at, cancelled_at)');

if (checks < 200) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`admin endings: FAIL (${errors.length} of ${checks})`); for (const e of errors) console.error(`- ${e}`); process.exit(1); }
console.log(`admin endings: OK (${checks} checks: Finished -> ✓ Mark as done with the deposit question, Done / Cancelled groups in order, greyed cards with ✓ / ✕, money in words, filters, banner, real routes with exact undo, quiet lists, owner words)`);
