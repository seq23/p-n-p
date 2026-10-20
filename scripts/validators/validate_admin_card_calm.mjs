#!/usr/bin/env node
/**
 * The calm request card + business delivery in Step 1 + one money wording (owner-approved
 * mock-up of 20 Oct 2026, panels 5 and 6). Fails when:
 *  A. above "More" (always visible, even collapsed) the card lacks, in order: the name, Call /
 *     Text, the when-line, the 🚚 Business delivery tag (when set), the Latest note (newest note in
 *     full + its day) with "+ Add a note" right there, then the next-step box;
 *  B. "More" is not "More about <first name>" with four groups (What they booked (the only one
 *     open), Money, Their details and ID, Notes and history) then the quiet row (Edit · Print
 *     checklist · Put away · Cancel this job…); ANY item the old "More: answers, history, other
 *     buttons" rendered is missing (each pinned by its data- attribute / help key); a removed
 *     duplicate is back (second Call, the games list twice, the pickup date twice, "What they
 *     picked", the old facts line); a raw ISO date or UTC timestamp shows in the words; the
 *     history is not newest first with 5 shown + "Show all (N)";
 *  C. "How do they get the games?" in Step 1 does not save the same answers Edit → Customer
 *     details writes, log a request event, add ONE "Delivery fee" line at the services.json price
 *     to an unsent draft (and take it off again on pickup), or it touches a SENT invoice; a
 *     Delivery fee line with no business delivery does not prompt for the name and address; the
 *     pickup / return steps, the day list text and the 7 AM to-do email do not say Delivery /
 *     Collect for these jobs;
 *  D. an amount due with a refundable deposit is not "$180 due ($130 + $50 refundable deposit)"
 *     on the card (Money line and next step), the invoice page, Money's Not paid yet, the edit
 *     page and the day list, or the ledger numbers changed (balance.owed still excludes the deposit).
 * Rule 0: fewer than 90 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const V = await mod('functions/_lib/views.mjs');
const L = await mod('functions/_lib/ledger.mjs');
const C = await mod('functions/_lib/calendar.mjs');
const TE = await mod('functions/_lib/todo-email.mjs');
const DL = await mod('functions/_lib/delivery.mjs');
const SERVICES = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8'));
const FEE = Math.round(Number(SERVICES.invoiceQuickAdds.deliveryFee) * 100);
const text = (h) => String(h).replace(/<style>[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const at = (h, x) => h.indexOf(x);
const top = (c) => c.slice(0, at(c, 'data-details'));
const more = (c) => c.slice(at(c, 'data-details'));
const count = (h, re) => (h.match(re) || []).length;

// ---- fixtures: a rental (deposit due, held, sent invoice with a refundable deposit) ----------
const base = { source: 'site', rentals: [], decor: [], other: [], phone: '901-555-0100', email: 'denise@example.com', dob: '1990-02-03', heard: 'Other', social1: 'instagram.com/denise', social2: '',
  agreedAt: '2026-10-19 14:37:00', rulesVersion: '3', robotCheck: 'no-js', referredBy: 'REF1', idObject: 'ids/x.jpg', sortTime: Date.UTC(2026, 9, 19, 21, 37) };
const rentalAnswers = [{ label: 'Which games?', value: 'Giant Connect Four, Giant Uno' }, { label: 'What date is your event?', value: '2026-10-30' }, { label: 'How long?', value: 'One day' },
  { label: 'When do you pick up the games?', value: 'The day before' }, { label: 'When do you bring them back?', value: 'The day after' }, { label: "What's the occasion?", value: 'Movie night by the pool' },
  { label: 'Pickup date', value: '2026-10-29' }, { label: 'Return date', value: '2026-10-31' }];
const den = { ...base, key: 'site|den', name: 'Denise Carter', services: ['rentals'], wantsRentals: true, wantsDecor: false, gamesAnswer: 'Giant Connect Four, Giant Uno', durationAnswer: 'One day', need: 'rentals',
  rentals: rentalAnswers, other: [{ label: 'Second date they asked about', value: '2026-11-02' }] };
const withDelivery = (r) => ({ ...r, rentals: [...r.rentals, { label: 'Business delivery', value: 'Yes' }, { label: 'Business name', value: 'Acme Offices' }, { label: 'Delivery address', value: '100 Main St, Memphis' }] });
const lines = [{ description: 'Giant Connect Four', qty: 1, unit_cents: 6500 }, { description: 'Giant Uno', qty: 1, unit_cents: 6500 }, { description: 'Damage deposit (refundable)', qty: 1, unit_cents: 5000, refundable: 1 }];
const bal0 = L.balanceOf({ status: 'sent' }, lines, 0);
const sentInv = { id: 4, number: 'PP-4', status: 'sent', sent_at: '2026-10-19 22:00:00', total_cents: 18000, deposit_due_cents: 9000, pay_plan: 'half', lines, balance: bal0 };
const notes = [{ id: 1, body: 'Older note', created_at: '2026-10-19 15:00:00' }, { id: 2, body: 'THIS CLIENT IS GETTING DELIVERY TO HER BUSINESS ON OCT 30 AND WILL NEED PICKUP FROM HER BUSINESS OCT 31', created_at: '2026-10-20 15:00:00' }];
const events = [
  { at: '2026-10-19 21:37:10', what: 'Confirmation email sent' }, { at: '2026-10-19 21:38:00', what: 'New-request email sent to Valerie' },
  { at: '2026-10-19 21:40:00', what: 'Games reserved until 2026-10-21 02:37:53 UTC (48 hours)' }, { at: '2026-10-19 23:00:00', what: 'Valerie held the games by hand' },
  { at: '2026-10-20 01:00:00', what: 'Invoice PP-4 sent' }, { at: '2026-10-20 14:00:00', what: 'Hold extended to 2026-10-24 04:59:00 UTC by Valerie' }, { at: '2026-10-20 15:00:00', what: 'Reserved until Fri 23 Oct, 11:59 PM' },
];
const hold = { state: 'held', untilMs: Date.parse('2026-10-24T04:59:00Z'), by_hand: 0, name: 'Denise Carter', items: 'Giant Connect Four, Giant Uno', phone: '901-555-0100' };
const VM = await mod('functions/_lib/views-messages.mjs');
const holdHtml = VM.holdControls(hold, { rk: 'x', sms: { href: 'sms:9015550100?&body=r' }, canEmail: true, compact: true });
const msgs = { confirm: { sms: { href: 'sms:9015550100?&body=ok' }, canEmail: true }, pickup: { sms: { href: 'sms:9015550100?&body=time' }, canEmail: true } };
const cardOpts = { st: { status: 'invoiced', invoice_id: 4 }, inv: sentInv, kinds: ['rental_pickup', 'rental_return'], bookings: [{ kind: 'rental_pickup', date: '2026-10-29', time: null }, { kind: 'rental_return', date: '2026-10-31', time: null }],
  sched: { date: '2026-10-29' }, today: '2026-10-20', notes, events, hold, holdHtml, msgs, extras: '<p class="money ok" data-confirm-sent>Confirmation email sent ✓</p>', referrers: { REF1: 'Ada A.' } };
const c1 = V.requestCard(den, cardOpts);

// ---- A. always visible -------------------------------------------------------------------
{
  const t = top(c1);
  const order = ['<h3 class="who">Denise Carter</h3>', 'data-when', 'data-latest-note', 'data-next-step', 'data-details'].map((x) => at(c1, x));
  must(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), `A: the card is not name, when-line, Latest note, next step, then More (${order})`);
  must(/data-quick-contact>[\s\S]*data-card-call[\s\S]*data-card-text/.test(t), 'A: Call / Text are not on the card top');
  must(/data-latest-note><p class="lnh"><b>Latest note<\/b> <span class="muted" data-latest-note-day>Tue 20 Oct<\/span><\/p><p class="lnb" data-latest-note-body>THIS CLIENT IS GETTING DELIVERY TO HER BUSINESS ON OCT 30 AND WILL NEED PICKUP FROM HER BUSINESS OCT 31<\/p>/.test(t), 'A: the Latest note is not the newest note in full with its day');
  must(!/Older note/.test(t), 'A: an older note shows as the latest');
  must(/data-add-note><summary data-help="card\.addNote"[^>]*>\+ Add a note<\/summary><form class="noteform" method="post" action="\/admin\/requests\/note">/.test(t) && !/data-add-note/.test(more(c1)), 'A: "+ Add a note" is not right at the Latest note (or is still under More)');
  must(!/data-business-delivery/.test(c1), 'A: a pickup rental shows the Business delivery tag');
  const c2 = V.requestCard(withDelivery(den), cardOpts);
  must(/data-business-delivery><span class="biztag">🚚 Business delivery<\/span> Acme Offices, 100 Main St, Memphis</.test(top(c2)) && at(c2, 'data-business-delivery') < at(c2, 'data-latest-note'), 'A: the 🚚 Business delivery tag is not on the top of a delivery card, before the note');
  const c3 = V.requestCard(den, { ...cardOpts, notes: [] });
  must(/data-latest-note>[\s\S]*\+ Add a note/.test(top(c3)) && !/Latest note/.test(c3), 'A: a card with no notes lacks "+ Add a note" (or says Latest note)');
}

// ---- B. More about <first name> ------------------------------------------------------------
{
  const m = more(c1);
  must(/<details class="disclose more" data-details><summary data-help="card\.details"[^>]*>More about Denise<\/summary>/.test(c1) && !/More: answers, history, other buttons/.test(c1), 'B: the toggle is not "More about Denise"');
  const groups = [['booked', 'What they booked'], ['money', 'Money'], ['details', 'Their details and ID'], ['history', 'Notes and history']];
  let last = -1;
  for (const [k, title] of groups) {
    const i = at(m, `data-more-group="${k}"`);
    must(i > last && new RegExp(`data-more-group="${k}"( open)?><summary data-help="card\\.grp${k[0].toUpperCase()}${k.slice(1)}"[^>]*>${title}`).test(m), `B: group ${title} missing or out of order`);
    last = i;
  }
  must(at(m, 'data-more-row') > last, 'B: the quiet row is not after the four groups');
  must(count(m, /<details class="grp"[^>]*\sopen>/g) === 1 && /data-more-group="booked" open>/.test(m), 'B: only What they booked opens by itself');
  // Every item the old More rendered, still reachable (by its data- attribute or help key).
  const ITEMS = {
    'games (old want line)': 'data-booked-games', 'event day + length + occasion': 'data-booked-event', 'pickup day/choice/place': 'data-booked-pickup', 'return day': 'data-booked-return',
    'See it on the calendar': 'data-see-cal', 'Payment box': 'data-payment', 'payment words': 'data-pay-words', 'Mark deposit button / money buttons': 'data-help="card.openInvoice"',
    'Messages line (confirmation + pickup time)': 'data-messages', 'confirmation text': 'data-msg="confirmation"', 'pickup-time message': 'data-msg="pickupTime"', 'hold controls': 'data-hold=',
    'Text a reminder': 'data-msg="holdEnding"', 'Release the games now': 'data-help="hold.release"', 'Reserve their games longer (not the deposit step)': '', 'extras (Confirmation sent)': 'data-confirm-sent',
    'phone': 'data-detail-phone', 'email': 'data-detail-email', 'date of birth': '<dt>Date of birth</dt><dd>3 Feb 1990</dd>', 'social media': 'data-help="card.social"', 'found us through': '<dt>Found us through</dt><dd>Other</dd>',
    'referred by': '<dt>Referred by</dt><dd>Ada A.</dd>', 'asked at': 'data-asked>Asked ', 'rules agreement': 'data-rules>✓ Agreed to the rules, Mon 19 Oct (version 3)', 'robot check': 'data-robot-check>⚠ Sent without the robot check',
    'Open ID photo': 'data-id-open', 'ID cell': 'data-id-cell', 'Delete this ID…': 'data-help="card.idDelete"', 'other answers': 'data-other-answers', 'notes': 'data-notes', 'history': 'data-history',
    'Show all history': 'data-history-all', 'Edit': 'data-edit-link', 'Put away': 'data-archive', 'Cancel this job… (was Void this request…)': 'data-void-link',
  };
  for (const [what, attr] of Object.entries(ITEMS)) if (attr) must(m.includes(attr), `B: "${what}" is no longer under More (${attr})`);
  must(/data-more-group="money"[\s\S]*data-hold=[\s\S]*data-more-group="details"/.test(m) && /data-more-group="money"[\s\S]*data-messages[\s\S]*data-more-group="details"/.test(m), 'B: the hold controls / messages are not under Money');
  must(/data-more-group="details"[\s\S]*data-id-open[\s\S]*data-more-group="history"/.test(m), 'B: the ID is not under Their details and ID');
  must(/data-more-row>[\s\S]*data-edit-link[\s\S]*data-archive[\s\S]*data-void-link>[\s\S]*data-help="card\.cancelJob"[^>]*>Cancel this job…<\/summary>[\s\S]*action="\/admin\/invoices\/4\/status"[\s\S]*name="action" value="void"[\s\S]*Yes, void it/.test(m) && !/Void this request/.test(c1), 'B: the quiet row is not Edit · Put away · "Cancel this job…" (the same Void action, still with its confirm)');
  // A decor card: the takedown row, checklist state, Print checklist, porch line, where, grazing facts.
  const porch = { ...base, key: 'site|pp', name: 'Pat Porch', services: ['porch', 'grazing'], wantsDecor: true, wantsRentals: false, gamesAnswer: '', porchLine: 'Fall · picturing a full porch', porchAddOns: 'Pumpkins',
    decor: [{ label: 'Event date', value: '2026-10-24' }, { label: 'Location (hotel name, address or neighborhood)', value: 'Germantown' }, { label: 'How many guests?', value: '15–40' }, { label: 'Should we source the food?', value: 'Yes' }, { label: 'Budget', value: '$500–$1,000' }] };
  const pc = V.requestCard(porch, { st: { status: 'scheduled' }, sched: { date: '2026-10-24' }, kinds: ['porch_install', 'grazing_setup'], bookings: [{ kind: 'porch_install', date: '2026-10-24' }, { kind: 'grazing_setup', date: '2026-10-24' }], today: '2026-10-20', cl: 'started', foodPerHead: { low: 12, high: 18 }, bottom: '<div data-thankyou>ty</div>' });
  const pm = more(pc);
  for (const [what, attr] of Object.entries({ 'porch line': 'data-booked-porch><b>Porch:</b> Fall · picturing a full porch. Add-ons: Pumpkins', where: 'data-booked-where><b>Where:</b> Germantown', 'grazing facts': 'data-grazing-facts',
    'takedown row': 'data-takedown-row', 'checklist state': 'data-checklist-state>Checklist started', 'Print checklist': 'data-help="card.printChecklist"', 'thank-you (bottom)': 'data-thankyou', 'budget (other answer)': '<dt>Budget</dt>' })) {
    must(pm.includes(attr), `B: decor card: "${what}" is no longer under More (${attr})`);
  }
  must(at(pm, 'data-thankyou') > 0 && at(pm, 'data-thankyou') < at(pm, 'data-more-row'), 'B: the thank-you is not above the quiet row');
  // A phone booking: the optional ID upload and "not asked" rules.
  const ph = V.requestCard({ ...den, source: 'phone', idObject: '', agreedAt: '', robotCheck: '' }, { ...cardOpts, hold: null, holdHtml: '' });
  must(/data-id-phone>Not collected \(phone booking\)/.test(more(ph)) && /data-id-upload/.test(more(ph)) && /data-rules>Rules: not asked \(phone booking\)/.test(more(ph)), 'B: a phone booking lost the ID upload / "not asked" rules line');
  // A void card: Bring back stays the one action; put away from the quiet row.
  const vc = V.requestCard(den, { ...cardOpts, st: { status: 'void' }, inv: { ...sentInv, status: 'void', balance: { ...bal0, void: true } }, hold: null, holdHtml: '' });
  must(/data-more-row>[\s\S]*data-help="card\.archive"/.test(more(vc)) && !/data-void-link/.test(vc), 'B: a void card lost Done — put away in the quiet row (or still offers Cancel this job)');
  // Duplicates gone.
  must(!/data-facts|What they picked/.test(c1), 'B: the old facts line / "What they picked" row is back');
  must(!/>(?:&#128222; )?Call</.test(m), 'B: a second Call is under More');
  must(count(text(c1), /Giant Connect Four/g) === 1, `B: the game list shows ${count(text(c1), /Giant Connect Four/g)} times on the card (once)`);
  must(count(text(m), /Thu 29 Oct/g) === 1, `B: the pickup date shows ${count(text(m), /Thu 29 Oct/g)} times under More (once)`);
  must(/data-booked-pickup><b>Pickup:<\/b> Thu 29 Oct, the day before · Mt\. Moriah Station</.test(m) && /data-booked-return><b>Back:<\/b> Sat 31 Oct, the day after</.test(m) && /data-booked-event><b>Event:<\/b> Fri 30 Oct · 2 days · Movie night by the pool</.test(m), `B: What they booked does not read the event, pickup and back days (${(m.match(/data-booked-event>[^]*?<\/p>/) || [''])[0]})`);
  // Raw dates and UTC stamps read as words (display only).
  must(!/\d{4}-\d{2}-\d{2}/.test(text(c1)) && !/\bUTC\b/.test(text(c1)), `B: a raw date or UTC timestamp shows on the card: ${(text(c1).match(/.{0,40}(\d{4}-\d{2}-\d{2}|UTC).{0,20}/) || [''])[0]}`);
  must(/<dt>Second date they asked about<\/dt><dd>Mon 2 Nov<\/dd>/.test(m), 'B: an ISO answer is not "Mon 2 Nov"');
  must(V.plainHistory('Games reserved until 2026-10-21 02:37:53 UTC (48 hours)') === 'Games reserved until Tue 20 Oct, 9:37 PM (48 hours)' && V.plainHistory('Hold extended to 2026-12-01 18:00:00 UTC by Valerie') === 'Hold extended to Tue 1 Dec, 12:00 PM by Valerie' && V.plainHistory('Booked Fri 30 Oct') === 'Booked Fri 30 Oct', 'B: plainHistory does not turn UTC stamps into Memphis words (CDT and CST)');
  must(events[2].what.includes('2026-10-21 02:37:53 UTC'), 'B: the stored history line was rewritten (display only)');
  // History: notes first, then newest first, 5 shown, Show all (7).
  const hist = m.slice(at(m, 'data-more-group="history"'));
  const firstLi = (hist.match(/<ul data-history><li>([\s\S]*?)<\/li>/) || [])[1] || '';
  must(at(hist, 'data-notes') < at(hist, 'data-history') && /data-notes><li data-note><span class="muted">Tue 20 Oct<\/span> THIS CLIENT/.test(hist) && /Older note/.test(hist), 'B: notes are not first, all of them, newest first');
  must(/Reserved until Fri 23 Oct/.test(firstLi), `B: history is not newest first (${firstLi})`);
  must(count((hist.match(/<ul data-history>([\s\S]*?)<\/ul>/) || ['', ''])[1], /<li>/g) === V.HISTORY_SHOWN && V.HISTORY_SHOWN === 5 && /data-history-all><summary data-help="card\.historyAll"[^>]*>Show all \(7\)<\/summary><ul><li>/.test(hist), 'B: history does not show the newest 5 + "Show all (7)"');
  // Money group: hold info without a second Call / games / Reserve longer (the deposit step has it).
  const mg = m.slice(at(m, 'data-more-group="money"'), at(m, 'data-more-group="details"'));
  must(!/data-help="hold\.call"/.test(mg) && !/data-help="hold\.longer|reslonger/.test(mg) && /Release the games now/.test(mg), 'B: the card hold controls repeat Call / Reserve longer, or Release is not "Release the games now"');
  must(/class="reslonger/.test(top(c1)), 'B: Reserve their games longer is not in the deposit step');
  const c4 = V.requestCard(den, { ...cardOpts, st: { status: 'new' }, inv: null, hold, holdHtml });
  must(/data-more-group="money"[\s\S]*class="reslonger[\s\S]*data-more-group="details"/.test(more(c4)) && !/class="reslonger/.test(top(c4)), 'B: a held rental not at the deposit step lost Reserve their games longer (under Money)');
}

// ---- C. business delivery -------------------------------------------------------------------
{
  const s = await session();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const form = { service: 'rentals', games: ['giant-uno'], duration: 'day', rental_date: plus(14), pickup_when: 'morning', return_when: 'after' };
  const a = await s.siteRequest({ ...form, name: 'Dina Draft', email: 'dina.draft@example.com', phone: '901-555-0501' });
  const b = await s.siteRequest({ ...form, rental_date: plus(16), name: 'Sam Sent', email: 'sam.sent@example.com', phone: '901-555-0502' });
  must(a.status === 303 && b.status === 303 && a.row && b.row, `C: the fixture requests were refused (${a.status}/${b.status})`);
  const cardOf = (html, key) => { const i = html.indexOf(`id="c-${s.rk(key)}"`); return i < 0 ? '' : html.slice(html.lastIndexOf('<article', i), html.indexOf('</article>', i)); };
  let ca = cardOf((await s.get('/admin/')).text, a.row.request_key);
  const box = ca.slice(at(ca, 'data-next-step'), at(ca, 'data-details'));
  must(/data-next-step="called"/.test(ca) && /data-delivery-step>[\s\S]*data-delivery-form/.test(box), 'C: Step 1 "Talk to them" has no "How do they get the games?" form');
  must(/How do they get the games\?/.test(box) && /value="pickup" checked[^>]*> <span>They pick up at Mt\. Moriah Station<\/span>/.test(box) && new RegExp(`value="delivery"[^>]*> <span><b>Business delivery</b> \\(\\+\\$${FEE / 100} on the invoice\\)</span>`).test(box)
    && /name="delivery_name"/.test(box) && /name="delivery_address"/.test(box) && /data-help="step\.deliverySave"/.test(box) && !/class="btn( primary)?" type="submit" data-help="step\.deliverySave"/.test(box), 'C: the Step-1 form lacks the two choices (fee from services.json), the two fields or its small Save');
  const reqA = () => s.requests.length >= 0 && s.one('SELECT * FROM requests WHERE request_key = ?1', a.row.request_key);
  const ia = await s.invoiceFor((await (await mod('functions/_lib/requests.mjs')).loadRequests(s.env, { fresh: true })).find((r) => r.key === a.row.request_key));
  const linesOf = async (id) => s.all('SELECT description, qty, unit_cents, refundable, position FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position', id);
  const draft0 = await s.one('SELECT * FROM invoices WHERE id = ?1', ia.id);
  must(draft0 && draft0.status === 'draft' && !draft0.sent_at, `C: the fixture invoice is not an unsent draft (${draft0 && draft0.status})`);
  // No address: refused, nothing changed.
  let r = await s.post('/admin/requests/delivery', { r: s.rk(a.row.request_key), how: 'delivery', delivery_name: 'Acme', delivery_address: '' });
  must(/e=/.test(r.location) && !(await linesOf(ia.id)).some((l) => /delivery fee/i.test(l.description)), 'C: delivery with no address was saved');
  r = await s.post('/admin/requests/delivery', { r: s.rk(a.row.request_key), how: 'delivery', delivery_name: 'Acme Offices', delivery_address: '100 Main St, Memphis' });
  must([302, 303].includes(r.status) && /m=Saved/.test(r.location) && r.location.endsWith(`#c-${s.rk(a.row.request_key)}`), `C: Save did not come back to the card (${r.location})`);
  const rowA = await reqA();
  const edits = JSON.parse(rowA.details_edits || '{}');
  must(edits.delivery_name === 'Acme Offices' && edits.delivery_address === '100 Main St, Memphis', `C: not saved to the same answers Edit → Customer details writes (${rowA.details_edits})`);
  const editPage = (await s.get(`/admin/requests/edit?r=${s.rk(a.row.request_key)}`)).text;
  must(/name="delivery_name" value="Acme Offices"/.test(editPage) && /name="delivery_address" value="100 Main St, Memphis"/.test(editPage), 'C: Edit → Customer details does not show what Step 1 saved');
  const evA = await s.all('SELECT what FROM request_events WHERE request_key = ?1', a.row.request_key);
  must(evA.some((e) => /business delivery to Acme Offices, 100 Main St, Memphis/.test(e.what)) && evA.some((e) => /Delivery fee added to the draft invoice/.test(e.what)), 'C: no request event for the choice / the fee');
  let la = await linesOf(ia.id);
  must(la.filter((l) => /^delivery fee$/i.test(l.description)).length === 1 && la.find((l) => /^delivery fee$/i.test(l.description)).unit_cents === FEE, `C: the draft does not get ONE Delivery fee line at $${FEE / 100} (${JSON.stringify(la)})`);
  const fi = la.findIndex((l) => /^delivery fee$/i.test(l.description)); const di = la.findIndex((l) => l.refundable);
  must(di < 0 || fi < di, 'C: the Delivery fee line sits after the refundable deposit');
  const draft1 = await s.one('SELECT * FROM invoices WHERE id = ?1', ia.id);
  const tot = la.reduce((x, l) => x + Math.round(l.qty * l.unit_cents), 0);
  must(draft1.status === 'draft' && draft1.deposit_due_cents === Math.round(tot / 2), `C: the draft's deposit did not follow the new total (${draft1.deposit_due_cents} vs ${tot})`);
  const bkA = await s.all("SELECT place FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return')", a.row.request_key);
  must(bkA.every((x) => x.place === '100 Main St, Memphis'), `C: the pickup / return bookings did not move to the business (${JSON.stringify(bkA)})`);
  r = await s.post('/admin/requests/delivery', { r: s.rk(a.row.request_key), how: 'delivery', delivery_name: 'Acme Offices', delivery_address: '100 Main St, Memphis' });
  must(/Nothing%20changed/.test(r.location) && (await linesOf(ia.id)).filter((l) => /^delivery fee$/i.test(l.description)).length === 1, 'C: saving again added a second Delivery fee');
  ca = cardOf((await s.get('/admin/')).text, a.row.request_key);
  must(/data-business-delivery><span class="biztag">🚚 Business delivery<\/span> Acme Offices, 100 Main St, Memphis</.test(top(ca)) && /value="delivery" checked/.test(ca), 'C: the card does not show the tag / the form does not keep the choice');
  // Back to pickup: the unsent draft's fee comes off, the answers clear.
  r = await s.post('/admin/requests/delivery', { r: s.rk(a.row.request_key), how: 'pickup' });
  la = await linesOf(ia.id);
  must(!la.some((l) => /delivery fee/i.test(l.description)) && !/delivery_address":"1/.test((await reqA()).details_edits || '') && (await s.all("SELECT place FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", a.row.request_key)).every((x) => x.place === 'Mt. Moriah Station'), 'C: pickup did not take the fee off the draft / clear the address / move the bookings back');
  // A SENT invoice is never touched.
  const ib = await s.invoiceFor((await (await mod('functions/_lib/requests.mjs')).loadRequests(s.env, { fresh: true })).find((x) => x.key === b.row.request_key));
  await s.post(`/admin/invoices/${ib.id}/status`, { action: 'texted' });
  const snap = async () => JSON.stringify([await s.one('SELECT status, sent_at, deposit_due_cents, notes, pay_plan FROM invoices WHERE id = ?1', ib.id), await linesOf(ib.id), await s.all('SELECT * FROM payments WHERE invoice_id = ?1', ib.id)]);
  const before = await snap();
  must(/"status":"sent"/.test(before), `C: the second fixture invoice is not sent (${before.slice(0, 80)})`);
  await s.post('/admin/requests/delivery', { r: s.rk(b.row.request_key), how: 'delivery', delivery_name: 'Bee Co', delivery_address: '5 Elm St' });
  must(await snap() === before, 'C: choosing delivery changed a SENT invoice (lines, totals, status or payments)');
  must(!(await s.all('SELECT what FROM request_events WHERE request_key = ?1', b.row.request_key)).some((e) => /Delivery fee/.test(e.what)), 'C: a sent invoice logged a Delivery fee change');
  await s.post('/admin/requests/delivery', { r: s.rk(b.row.request_key), how: 'pickup' });
  must(await snap() === before, 'C: choosing pickup changed a SENT invoice');
  // Reverse: a Delivery fee line but no business delivery -> the prompt with the same form.
  must(DL.linesForChoice([{ description: 'Giant Uno', qty: 1, unit_cents: 6500, refundable: 0 }, { description: 'Damage deposit', qty: 1, unit_cents: 5000, refundable: 1 }], { delivery: true, feeCents: FEE }).lines.map((l) => l.description).join('|') === 'Giant Uno|Delivery fee|Damage deposit', 'C: linesForChoice does not put the fee before the deposit');
  must(DL.unsentDraft({ status: 'draft', sent_at: null }) && !DL.unsentDraft({ status: 'draft', sent_at: '2026-10-19 10:00:00' }) && !DL.unsentDraft({ status: 'sent' }), 'C: unsentDraft lets a once-sent invoice through');
  const feeInv = { ...sentInv, lines: [...lines.slice(0, 2), { description: 'Delivery fee', qty: 1, unit_cents: FEE }, lines[2]] };
  const pr = V.requestCard(den, { ...cardOpts, inv: feeInv });
  must(/data-delivery-prompt><summary data-help="card\.deliveryPrompt"[^>]*>🚚 Business delivery: add the business name and address<\/summary><form class="dlform" method="post" action="\/admin\/requests\/delivery" data-delivery-form>[\s\S]*value="delivery" checked/.test(top(pr)), 'C: a Delivery fee line with no business delivery does not prompt for the name and address');
  must(!/data-delivery-prompt/.test(V.requestCard(withDelivery(den), { ...cardOpts, inv: feeInv })) && !/data-delivery-prompt/.test(c1), 'C: the prompt shows with delivery set, or without a fee line');
  // Pickup / return steps on a delivery rental.
  const dd = withDelivery(den);
  const paidInv = { ...sentInv, status: 'deposit_paid', balance: L.balanceOf({ status: 'deposit_paid' }, lines, 9000) };
  const onDay = V.requestCard(dd, { ...cardOpts, st: { status: 'deposit_paid', invoice_id: 4 }, inv: paidInv, hold: null, holdHtml: '', today: '2026-10-29', bookings: [{ id: 5, kind: 'rental_pickup', date: '2026-10-29', time: '10:00' }, { id: 6, kind: 'rental_return', date: '2026-10-31', time: null }] });
  const pbox = onDay.slice(at(onDay, 'data-next-step'), at(onDay, 'data-details'));
  must(/data-next-step="picked"/.test(onDay) && /data-next-biz>🚚 Business delivery</.test(pbox) && /data-next-what>Delivery: Thu 29 Oct</.test(pbox) && /Deliver to Acme Offices, 100 Main St, Memphis\./.test(pbox) && />Mark delivered</.test(pbox), `C: the pickup step does not read "🚚 Business delivery · Delivery: <date> · Deliver to <business>, <address> · Mark delivered" (${text(pbox).slice(0, 200)})`);
  must(/data-booked-pickup><b>Delivery:<\/b> Thu 29 Oct, the day before · Deliver to Acme Offices, 100 Main St, Memphis</.test(more(onDay)) && /data-booked-return><b>Collect:<\/b> Sat 31 Oct/.test(more(onDay)), 'C: What they booked does not say Delivery / Collect');
  const retCard = V.requestCard(dd, { ...cardOpts, st: { status: 'paid', invoice_id: 4 }, inv: { ...sentInv, status: 'paid', balance: L.balanceOf({ status: 'paid' }, lines, 18000) }, hold: null, holdHtml: '', today: '2026-10-31', bookings: [{ id: 5, kind: 'rental_pickup', date: '2026-10-29', time: '10:00', done_at: '2026-10-29 15:00:00' }, { id: 6, kind: 'rental_return', date: '2026-10-31', time: null }], stored: { picked: true } });
  must(!/data-next-step="returned"/.test(retCard) || /data-next-what>Collect: Sat 31 Oct</.test(retCard), 'C: the return step on a delivery rental does not read "Collect: <date>"');
  // Day list text and the to-do email.
  const dayText = C.daySheetText('2026-10-29', [{ kind: 'rental_pickup', customer_name: 'Denise Carter', timeLabel: '10:00 AM', delivery: true, owed: 13000, dueWords: L.dueWords(bal0) }, { kind: 'rental_return', customer_name: 'Hal Home', timeLabel: '', delivery: false, owed: 0 }], { max: 10000 });
  must(/10:00 AM Delivery - Denise Carter/.test(dayText) && /collect \$180 \(\$130 \+ \$50 refundable deposit\)/.test(dayText) && /Game return - Hal Home|Games? return - Hal Home|Return - Hal Home/i.test(dayText) && !/Delivery - Hal|Collect - Hal/.test(dayText), `C/D: the day list text does not say Delivery / collect $X (...) for a delivery job only (${dayText.slice(0, 240)})`);
  // The 7 AM email: book the delivery rental (Yes, book it on Step 1) and read the email for the pickup day and the day before.
  await s.post('/admin/requests/delivery', { r: s.rk(a.row.request_key), how: 'delivery', delivery_name: 'Acme Offices', delivery_address: '100 Main St, Memphis' });
  const pick = plus(13); const back = plus(15);
  await s.post('/admin/requests/talked', { r: s.rk(a.row.request_key), go: 'yes', date: pick, return_date: back });
  const bks = await s.all("SELECT kind, date, place FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return') ORDER BY kind", a.row.request_key);
  must(bks.length === 2 && bks.every((x) => x.place === '100 Main St, Memphis'), `C: the booked delivery rental is not at the business (${JSON.stringify(bks)})`);
  const td1 = await TE.todoData(s.db, pick);
  const td0 = await TE.todoData(s.db, plus(12));
  const tdR = await TE.todoData(s.db, back);
  must(td1.sections[1].some((j) => / · Dina D\. · delivery$/.test(j.t)) && !td1.sections[1].some((j) => /Dina D\. · games pickup/.test(j.t)), `C: the to-do email's Today's jobs does not say "delivery" (${JSON.stringify(td1.sections[1].map((j) => j.t))})`);
  must(td0.tomorrowJobs.some((j) => /Dina D\. · delivery$/.test(j.t)), `C: the to-do email's Tomorrow does not say "delivery" (${JSON.stringify(td0.tomorrowJobs)})`);
  must(tdR.sections[1].some((j) => /Dina D\. · collect$/.test(j.t)), `C: the to-do email's return day does not say "collect" (${JSON.stringify(tdR.sections[1].map((j) => j.t))})`);
  must(TE.DELIVERY_JOB_WORDS.rental_pickup === 'delivery' && TE.DELIVERY_JOB_WORDS.rental_return === 'collect' && TE.JOB_WORDS.rental_pickup === 'games pickup', 'C: the to-do email job words changed for pickup rentals');
  const calTd = (await s.get(`/admin/day/${pick}`)).text;
  must(/Delivery · Dina|Delivery: Dina|>Delivery</.test(calTd), 'C: the Day sheet does not say Delivery for the business rental');

  // ---- D. money words on the invoice page, Money, edit page (local test database only) ------
  const sentB = await s.one('SELECT * FROM invoices WHERE id = ?1', ib.id);
  const bB = L.balanceOf(sentB, await linesOf(ib.id), 0);
  const want = L.dueWords(bB);
  must(bB.refundable > 0 ? /^\$\d+ due \(\$\d+ \+ \$\d+ refundable deposit\)$/.test(want) : /^\$\d+ due$/.test(want), `D: the sent fixture's due words are "${want}"`);
  must(bB.owed === bB.charges && bB.depositOwed === bB.refundable, 'D: the ledger changed: balance.owed must still exclude the refundable deposit');
  const esc = (x) => x.replace(/[$()+.]/g, (ch) => `\\${ch}`);
  must(new RegExp(esc(want)).test((await s.get(`/admin/invoices/${ib.id}`)).text), `D: the invoice page does not say "${want}"`);
  must(new RegExp(`data-owed>${esc(want)}<`).test((await s.get('/admin/money')).text), `D: Money's Not paid yet does not say "${want}"`);
  must(new RegExp(`data-due-words>${esc(want)}<`).test((await s.get(`/admin/requests/edit?r=${s.rk(b.row.request_key)}`)).text), `D: the edit page does not say "${want}"`);
}

// ---- D. the card ------------------------------------------------------------------------------
{
  must(/data-pay-words>Invoice sent · \$180 due \(\$130 \+ \$50 refundable deposit\)</.test(c1), `D: the card's Money line is not "Invoice sent · $180 due ($130 + $50 refundable deposit)" (${(c1.match(/data-pay-words>[^<]*/) || [''])[0]})`);
  must(/data-next-money>Invoice sent · \$180 due \(\$130 \+ \$50 refundable deposit\)</.test(top(c1)), 'D: the next step does not say the amount due in the one form');
  must(/data-more-group="money"><summary[^>]*>Money <small>\$180 due \(\$130 \+ \$50 refundable deposit\)<\/small>/.test(c1), 'D: the Money group summary does not say the amount due');
  must(!/\bowes\b|still owed/i.test(text(c1)), 'D: the card still says "owes" / "still owed"');
  const noDep = [lines[0], lines[1]];
  const c5 = V.requestCard(den, { ...cardOpts, inv: { ...sentInv, lines: noDep, total_cents: 13000, balance: L.balanceOf({ status: 'sent' }, noDep, 0) } });
  must(/data-pay-words>Invoice sent · \$130 due</.test(c5) && !/refundable deposit\)/.test(c5), 'D: with no refundable deposit the card does not say "$130 due"');
  const depIn = L.balanceOf({ status: 'deposit_paid' }, lines, 9000);
  const c6 = V.requestCard(den, { ...cardOpts, st: { status: 'deposit_paid', invoice_id: 4 }, inv: { ...sentInv, status: 'deposit_paid', balance: depIn }, hold: null, holdHtml: '' });
  must(/data-pay-words>Deposit in · \$90 due \(\$40 \+ \$50 refundable deposit\)</.test(c6), `D: deposit-in card words (${(c6.match(/data-pay-words>[^<]*/) || [''])[0]})`);
  const VC = await mod('functions/_lib/views-calendar.mjs');
  must(/data-collect>Collect at pickup: \$180 \(\$130 \+ \$50 refundable deposit\)</.test(VC.statusBits({ kind: 'rental_pickup' }, { bal: bal0 })) && /data-collect>Collect at delivery: /.test(VC.statusBits({ kind: 'rental_pickup' }, { bal: bal0, delivery: true })), 'D/C: the calendar booking line does not say "Collect at pickup / delivery: $180 (...)"');
}

if (checks < 90) errors.push(`Rule 0: only ${checks} checks ran (want 90+)`);
if (errors.length) { console.error(`card calm: FAIL (${errors.length} of ${checks})`); for (const e of errors) console.error(`- ${e}`); process.exit(1); }
console.log(`card calm: OK (${checks} checks: card top always visible, More about <first name> in 4 groups with every old item reachable, Step-1 business delivery + draft-only fee, Delivery / Collect in steps, day list and 7 AM email, one money wording)`);
