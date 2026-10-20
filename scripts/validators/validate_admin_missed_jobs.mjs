#!/usr/bin/env node
/**
 * Past steps not ticked, in two tiers (functions/_lib/missed.mjs; PR #106 "missed jobs", then the
 * owner-approved mock-up "Did this happen? (yellow) vs Real problem (red)", 20 Oct 2026: Tamaira
 * picked up Sun 18 Oct but nobody ticked it, and she showed red).
 *  1. Detection per kind (unchanged from #106): any live booking before today that is not done
 *     and not Not needed. Today / later never; put away, void, test, void-invoice never. Oldest first.
 *  2. Tiers (classify, the ONE definition): RED = our things still out (rental return / collect,
 *     porch / party takedown, grazing pickup) from the DAY AFTER the due day, worded as questions
 *     ("Are <Name>'s games back?", "Is <Name>'s takedown done?"), and a hand-over answered ✗ No
 *     ("<Name> did not pick up on <day>"); YELLOW = hand-overs (pickup, delivery, setup, install,
 *     grazing drop-off, other): "Did this happen?". The strip, the card, the calendar and the email
 *     all call classify / tiers from missed.mjs (source check).
 *  3. Auto-tick: a later step marked done ticks the earlier open steps of the same job (return /
 *     collect => pickup / delivery; takedown => setup / install; grazing pickup => grazing setup),
 *     one history line each, at the moment it is marked (never retroactively).
 *  4. Email: the subject warns ONLY for red ("⚠ N not back yet · ", "⚠ N to check · " with a ✗ No);
 *     red box "⚠ CHECK THESE FIRST" with the questions, ✓ Yes (-> /admin/confirm-done), 📞 Call,
 *     Open card; yellow only on one quiet "Tidy up: N step(s) to tick off (...). Open admin" line at
 *     the very bottom; a yellow-only day still sends (just the Tidy up line), never "All clear".
 *  5. /admin Requests: a red strip (questions, ✓ Yes, Call, Card ↓, ✕ until tomorrow on every
 *     device) and a thin yellow strip ("Did this happen? · N step(s) to tick off", rows with
 *     ✓ Yes, it happened / ✗ No). Card: red border + "⚠ Not back yet · N day(s) late" for red, a
 *     yellow tag "Did this happen? <Job> <day>" (no red border) for yellow, the question as the
 *     next step. ✗ No turns it red everywhere. Calendar chip red for red, yellow for yellow.
 *  6. Confirm screen: GET /admin/confirm-done changes nothing; the POST marks it (+ auto-tick),
 *     the inventory shows it IN, back to the card with "✓ Marked: <Name>'s games are back.";
 *     already done -> "Already marked back ✓", no change; "Anything damaged or missing?" routes to
 *     deposit back (No, all fine) or "Returned — check damage" (Yes).
 * Rule 0: fewer than 150 checks is a failure.
 */
import { readFileSync } from 'node:fs';
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const MS = await mod('functions/_lib/missed.mjs');
const T = await mod('functions/_lib/todo-email.mjs');
const INV = await mod('functions/_lib/inventory.mjs');
const { chicagoDate, dayWords } = await mod('functions/_lib/reminders.mjs');
const { addDays } = await mod('functions/_lib/calendar.mjs');
const { b64urlText } = await mod('functions/_lib/util.mjs');
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const unesc = (h) => String(h).replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&');

// ---- 1. detection per kind (pure) ----------------------------------------------------------------
{
  const today = '2026-10-21';
  const B = (id, kind, date, extra = {}) => ({ id, kind, date, time: null, done_at: null, request_key: null, customer_name: `Person${id} Last`, phone: '', ...extra });
  const bookings = [
    B(1, 'party_takedown', '2026-10-20', { request_key: 'k1', phone: '+1 901.555.0101' }),
    B(2, 'porch_install', '2026-10-19', { request_key: 'k2' }),
    B(3, 'party_setup', '2026-10-19', { request_key: 'k3' }),
    B(4, 'rental_pickup', '2026-10-18'),
    B(5, 'rental_pickup', '2026-10-18', { request_key: 'k5' }),
    B(6, 'rental_return', '2026-10-20', { request_key: 'k6' }),
    B(7, 'rental_return', '2026-10-20', { request_key: 'k7' }),
    B(8, 'grazing_pickup', '2026-10-17', { request_key: 'k8' }),
    B(9, 'porch_takedown', '2026-10-16', { done_at: '2026-10-16 20:00:00' }),
    B(10, 'other', '2026-10-15'),
    B(11, 'grazing_setup', today),
    B(12, 'party_takedown', '2026-10-22'),
    B(13, 'grazing_setup', '2026-10-14'),
    B(14, 'porch_takedown', '2026-10-13', { request_key: 'k14' }),
    B(15, 'rental_return', '2026-10-12', { done_at: '2026-10-12 20:00:00' }),
  ];
  const statuses = { k3: { request_key: 'k3', status: 'job_done', job_done_at: '2026-10-19 22:00:00' } };
  const reqBy = { k8: { request_key: 'k8', takedown_plan: 'customer_handles', name: 'Gina Grazer' }, k14: { request_key: 'k14', takedown_plan: 'scheduled', name: 'Pia Porch', phone: '(901) 555-0414' } };
  const returns = { k5: { returned_at: '2026-10-19 18:00:00' }, k7: { returned_at: '2026-10-20 18:00:00' } };
  const m = MS.missedFrom({ bookings, returns, today, statuses, reqBy });
  const ids = m.map((x) => x.id);
  must(JSON.stringify(ids) === JSON.stringify([15, 14, 13, 10, 4, 2, 1, 6]), `missed ids (oldest first) are ${JSON.stringify(ids)}`);
  must(ids.includes(1), 'a party takedown before today not marked done is not missed');
  // The phone rides through missedFrom and tiers: the booking's own, else the request's (both formats she stores).
  const redBy = Object.fromEntries(MS.tiers(m).red.map((x) => [x.id, x]));
  must(redBy[1] && redBy[1].phone === '+1 901.555.0101' && redBy[14] && redBy[14].phone === '(901) 555-0414', `a red item lost its booking / request phone: ${JSON.stringify([redBy[1] && redBy[1].phone, redBy[14] && redBy[14].phone])}`);
  must(ids.includes(2), 'a porch install before today (job not done) is not missed');
  must(!ids.includes(3), 'a setup whose job is marked done on the card is missed');
  must(ids.includes(4), 'a rental pickup before today not marked picked up is not missed');
  must(!ids.includes(5), 'a rental pickup whose games are already back is missed');
  must(ids.includes(6) && !ids.includes(7), 'a late return not checked in is not missed, or a checked-in return is');
  must(ids.includes(15), 'a late return marked done on the calendar but never checked in is not missed (overdueReturns is the definition)');
  must(!ids.includes(8), 'a grazing pickup marked Not needed is missed');
  must(!ids.includes(9), 'a takedown marked done is missed');
  must(ids.includes(10), 'an "other" booking before today is not missed');
  must(!ids.includes(11) && !ids.includes(12), 'a booking today or later is missed');
  must(ids.includes(13), 'a grazing setup before today is not missed');
  must(ids.includes(14) && m.find((x) => x.id === 14).who === 'Person14 L.', 'a takedown with no Not needed is not missed');
  const one = m.find((x) => x.id === 1);
  must(one.days === 1 && one.job === 'party takedown' && one.short === 'takedown' && one.strip === 'takedown' && one.first === 'Person1' && one.key === 'k1', `the takedown entry is ${JSON.stringify(one)}`);
  must(m.find((x) => x.id === 13).days === 7 && MS.lateWords(7) === '7 days late' && MS.lateWords(1) === '1 day late', 'days late is wrong');
  must(m.find((x) => x.id === 6).strip === 'games not back' && m.find((x) => x.id === 6).short === 'return', 'a late return is not "games not back"');
  must(m.find((x) => x.id === 4).job === 'games pickup' && m.find((x) => x.id === 2).short === 'install' && m.find((x) => x.id === 10).short === 'job', 'the job words are wrong');
  const dl = MS.missedFrom({ bookings: [B(20, 'rental_pickup', '2026-10-20', { request_key: 'kd' }), B(21, 'rental_return', '2026-10-20', { request_key: 'kd' })], returns: {}, today, delivered: (b) => b.request_key === 'kd' });
  must(dl[0].job === 'games delivery' && dl[0].short === 'delivery' && dl[1].strip === 'games not collected' && dl[1].short === 'collect', `business delivery words: ${JSON.stringify(dl.map((x) => [x.job, x.short, x.strip]))}`);
  // Clears by itself: done / moved to today or later / Not needed.
  const clear = (b, extra = {}) => !MS.missedFrom({ bookings: [b], returns: {}, today, ...extra }).length;
  must(clear(B(1, 'party_takedown', '2026-10-20', { done_at: 'x' })), 'a done takedown stays missed');
  must(clear(B(1, 'party_takedown', today)) && clear(B(1, 'party_takedown', '2026-10-25')), 'a takedown moved to today or later stays missed');
  must(clear(B(1, 'party_takedown', '2026-10-20', { request_key: 'k1' }), { reqBy: { k1: { takedown_plan: 'customer_handles' } } }), 'a takedown marked Not needed stays missed');
  // Live only.
  const L = (b, ctx) => MS.isLiveBooking(b, ctx);
  must(L(B(1, 'other', '2026-10-20'), {}) && !L(B(1, 'other', '2026-10-20', { request_key: 'a' }), { statuses: { a: { archived_at: 'x' } } })
    && !L(B(1, 'other', '2026-10-20', { request_key: 'a' }), { statuses: { a: { status: 'void' } } })
    && !L(B(1, 'other', '2026-10-20', { request_key: 'a' }), { reqBy: { a: { is_test: 1 } } })
    && !L(B(1, 'other', '2026-10-20', { invoice_id: 9 }), { bals: { 9: { void: true } } }), 'a put-away / void / test / void-invoice booking counts as live');
  // The ✕: today only, and only while every missed job was in the dismissed list.
  const v = JSON.stringify({ day: today, ids: [1, 2] });
  must(MS.stripHidden([{ id: 1 }, { id: 2 }], v, today), 'a dismissed strip shows again the same day');
  must(!MS.stripHidden([{ id: 1 }, { id: 2 }], v, '2026-10-22'), 'a dismissed strip stays hidden the next morning');
  must(!MS.stripHidden([{ id: 1 }, { id: 2 }, { id: 3 }], v, today), 'a job missed after the ✕ does not show the strip again');
  must(!MS.stripHidden([{ id: 1 }], '', today) && !MS.stripHidden([{ id: 1 }], 'not json', today), 'no / bad dismissal hides the strip');
}


// ---- 2. tiers (pure): per kind, the day-after rule, the words, ✗ No, one source ----------------------
{
  const today = '2026-10-21';
  const B = (id, kind, date, extra = {}) => ({ id, kind, date, time: null, done_at: null, request_key: null, customer_name: 'Tamaira Tee', phone: '', ...extra });
  const WANT = { rental_return: 'red', porch_takedown: 'red', party_takedown: 'red', grazing_pickup: 'red', rental_pickup: 'yellow', porch_install: 'yellow', party_setup: 'yellow', grazing_setup: 'yellow', other: 'yellow' };
  for (const [kind, tier] of Object.entries(WANT)) {
    must(!MS.missedFrom({ bookings: [B(1, kind, today)], returns: {}, today }).length, `${kind} on its own due day is flagged (the due day is normal)`);
    const m = MS.missedFrom({ bookings: [B(1, kind, addDays(today, -1))], returns: {}, today });
    must(m.length === 1 && MS.classify(m[0]).tier === tier, `${kind} the day after its due day is ${m[0] && MS.classify(m[0]).tier}, want ${tier}`);
    if (tier === 'yellow') {
      const nh = MS.missedFrom({ bookings: [B(1, kind, addDays(today, -1))], returns: {}, today, notHappened: new Set([`1@${addDays(today, -1)}`]) });
      must(MS.classify(nh[0]).tier === 'red' && MS.classify(nh[0]).reason === 'not_happened', `${kind} answered ✗ No is not red`);
    }
  }
  must(JSON.stringify([...MS.RED_KINDS].sort()) === JSON.stringify(['grazing_pickup', 'party_takedown', 'porch_takedown', 'rental_return']), `the red kinds are ${[...MS.RED_KINDS]}`);
  const list = MS.missedFrom({
    bookings: [B(1, 'rental_pickup', '2026-10-18'), B(2, 'rental_return', '2026-10-20'), B(3, 'party_takedown', '2026-10-20', { customer_name: 'Ali Hassan' }), B(4, 'rental_pickup', '2026-10-17', { request_key: 'kd' }), B(5, 'porch_install', '2026-10-19', { customer_name: 'Pia Porch' })],
    returns: {}, today, delivered: (b) => b.request_key === 'kd',
  });
  const { red, yellow } = MS.tiers(list);
  must(JSON.stringify(red.map((x) => x.id)) === '[2,3]' && JSON.stringify(yellow.map((x) => x.id)) === '[4,1,5]', `tiers split: red ${red.map((x) => x.id)}, yellow ${yellow.map((x) => x.id)}`);
  const ret = red[0]; const td = red[1];
  must(ret.question === "Are Tamaira T.'s games back?" && ret.due === 'Due back Tue 20 Oct' && ret.yes === "✓ Yes, they're back" && ret.notYet === 'not marked back yet' && ret.tag === 'Not back yet · 1 day late', `the return words: ${JSON.stringify(ret)}`);
  must(td.question === "Is Ali H.'s takedown done?" && td.due === 'Due Tue 20 Oct' && td.yes === "✓ Yes, it's done" && td.notYet === 'not marked done yet' && td.tag === 'Not done yet · 1 day late', `the takedown words: ${JSON.stringify(td)}`);
  const pk = yellow.find((x) => x.id === 1);
  must(Boolean(pk) && pk.question === 'Did Tamaira pick up the games on Sun 18 Oct?' && pk.tag === 'Did this happen? Games pickup Sun 18 Oct' && pk.row === 'Tamaira T. · games pickup · Sun 18 Oct' && pk.tidy === "Tamaira T.'s pickup" && pk.yes === '✓ Yes, it happened' && pk.no === '✗ No', `the pickup words: ${JSON.stringify(pk)}`);
  must(yellow.find((x) => x.id === 4).question === 'Did Tamaira get the delivery on Sat 17 Oct?' && yellow.find((x) => x.id === 4).tidy === "Tamaira T.'s delivery", 'a business delivery is not "Did <name> get the delivery"');
  must(yellow.find((x) => x.id === 5).question === 'Did Pia get the porch install on Mon 19 Oct?' && yellow.find((x) => x.id === 5).tag === 'Did this happen? Porch install Mon 19 Oct', 'the install words are wrong');
  const gp = MS.classify(MS.missedFrom({ bookings: [B(9, 'grazing_pickup', '2026-10-20')], returns: {}, today })[0]);
  must(gp.question === "Is Tamaira T.'s grazing pickup done?", `grazing pickup question: ${gp.question}`);
  const nh = MS.tiers(MS.missedFrom({ bookings: [B(1, 'rental_pickup', '2026-10-18')], returns: {}, today, notHappened: new Set(['1@2026-10-18']) })).red[0];
  must(nh && nh.question === 'Tamaira T. did not pick up on Sun 18 Oct' && nh.tag === 'Did not happen · Sun 18 Oct', `the ✗ No words: ${JSON.stringify(nh)}`);
  must(MS.tiers(MS.missedFrom({ bookings: [B(1, 'rental_pickup', '2026-10-19')], returns: {}, today, notHappened: new Set(['1@2026-10-18']) })).yellow.length === 1, 'a ✗ No for an old day still turns the moved booking red');
  must(MS.classify(MS.missedFrom({ bookings: [B(2, 'rental_return', '2026-10-20')], returns: {}, today, notHappened: new Set(['2@2026-10-20']) })[0]).reason === 'out', 'a red item answered ✗ No changes reason');
  must(MS.subjectWarning([]) === '' && MS.subjectWarning(red) === '⚠ 2 not back yet · ' && MS.subjectWarning([...red, nh]) === '⚠ 3 to check · ' && MS.subjectWarning([nh]) === '⚠ 1 to check · ', 'the subject warning is wrong');
  must(yellow.every((m) => m.tier === 'yellow' && !/⚠/.test(m.tag + m.question)) && red.every((m) => m.tier === 'red'), 'a yellow item carries a ⚠ (or a red one is not red)');
  must(MS.stepWords(1) === '1 step to tick off' && MS.stepWords(2) === '2 steps to tick off', 'step words are wrong');
  // ONE source: the strip, the card, the calendar and the email each call tiers / classify from missed.mjs.
  const src = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
  const fnBody = (text, name) => { const i = text.indexOf(name); return i < 0 ? '' : text.slice(i, text.indexOf('\nexport ', i + 10) > 0 ? text.indexOf('\nexport ', i + 10) : undefined); };
  const views = src('functions/_lib/views.mjs');
  must(/import \{[^}]*\btiers\b[^}]*\} from '\.\/missed\.mjs'/.test(views), 'views.mjs does not import tiers from missed.mjs');
  must(/tiers\(missed\)/.test(fnBody(views, 'export function missedStrip')), 'the Requests strip does not call tiers()');
  must(/tiers\(missed\)/.test(fnBody(views, 'export function requestCard')), 'the card does not call tiers()');
  const cal = src('functions/_lib/admin-calendar.mjs');
  must(/MS\.tiers\(await MS\.loadMissed/.test(fnBody(cal, 'export async function calendarPage')), 'the calendar does not call tiers()');
  const mail = src('functions/_lib/todo-email.mjs');
  must(/import \{[^}]*\btiers\b[^}]*\} from '\.\/missed\.mjs'/.test(mail) && /= tiers\(missedFrom\(/.test(mail), 'the 7 AM email does not call tiers()');
  for (const [f, t] of [['views.mjs', views], ['admin-calendar.mjs', cal], ['todo-email.mjs', mail], ['admin.mjs', src('functions/_lib/admin.mjs')], ['views-calendar.mjs', src('functions/_lib/views-calendar.mjs')]]) {
    must(!/RED_KINDS\s*=|'rental_return',\s*'porch_takedown'|tier\s*[:=]\s*'(red|yellow)'/.test(t), `${f} keeps its own tier list (missed.mjs classify is the one definition)`);
  }
  must(JSON.stringify(MS.EARLIER) === JSON.stringify({ rental_return: ['rental_pickup'], porch_takedown: ['porch_install'], party_takedown: ['party_setup'], grazing_pickup: ['grazing_setup'] }), `the auto-tick map is ${JSON.stringify(MS.EARLIER)}`);
  must(MS.autoTickWords('rental_pickup', 'rental_return') === 'Pickup ticked off automatically (games came back)' && MS.autoTickWords('rental_pickup', 'rental_return', true) === 'Delivery ticked off automatically (games collected)'
    && MS.autoTickWords('party_setup', 'party_takedown') === 'Setup ticked off automatically (takedown done)' && MS.autoTickWords('porch_install', 'porch_takedown') === 'Install ticked off automatically (takedown done)', 'the auto-tick history words are wrong');
}

// ---- 3. the email: Wed 21 Oct (red + yellow), Tue 20 Oct (yellow only), ✗ No, tidy only, all clear --
{
  const s = await session();
  const db = s.db;
  for (const r of s.requests) await db.prepare("INSERT INTO request_status (request_key, status, archived_at) VALUES (?1, 'new', datetime('now')) ON CONFLICT(request_key) DO UPDATE SET archived_at = datetime('now')").bind(r.key).run();
  await db.prepare('DELETE FROM bookings').run();
  const ins = async (kind, date, name, phone = '', time = null) => (await db.prepare('INSERT INTO bookings (kind, date, time, customer_name, phone, items) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(kind, date, time, name, phone, kind.startsWith('rental') ? 'Giant Uno' : '').run()).meta.last_row_id;
  const pick = await ins('rental_pickup', '2026-10-18', 'Tamaira Tee', '901-555-0302');
  const ret = await ins('rental_return', '2026-10-20', 'Tamaira Tee', '901-555-0302');
  const td = await ins('party_takedown', '2026-10-20', 'Ali Hassan', '901-555-0301', '10:00');
  const WED = '2026-10-21';
  let d = await T.todoData(db, WED, Date.parse(`${WED}T12:00:00Z`));
  let msg = T.renderTodo(d);
  const html = unesc(msg.html);
  must(msg.subject === '⚠ 2 not back yet · Your to-do list for Wed 21 Oct · Porch & Party', `the Wed subject is "${msg.subject}"`);
  must(!T.isAllClear(d) && !/data-all-clear/.test(msg.html), 'Wed with red items says All clear today');
  must(JSON.stringify(d.missed.map((x) => [x.id, x.t, x.d])) === JSON.stringify([[ret, "Are Tamaira T.'s games back?", 'Due back Tue 20 Oct · not marked back yet'], [td, "Is Ali H.'s takedown done?", 'Due Tue 20 Oct · not marked done yet']]), `the red box items: ${JSON.stringify(d.missed.map((x) => [x.t, x.d]))}`);
  must(JSON.stringify(d.missed[0].btns) === JSON.stringify([{ label: "✓ Yes, they're back", href: `/admin/confirm-done?b=${ret}&r=`, solid: true }, { label: '📞 Call', href: 'tel:9015550302', solid: false }, { label: 'Open card', href: '/admin/day/2026-10-20' }]), `the return's buttons: ${JSON.stringify(d.missed[0].btns)}`);
  must(d.missed[1].btns[0].label === "✓ Yes, it's done" && d.missed[1].btns[0].href === `/admin/confirm-done?b=${td}&r=` && d.missed[1].btns[0].solid, 'the takedown ✓ Yes does not open the confirm screen');
  must(/data-missed[^>]*>[\s\S]*?⚠ CHECK THESE FIRST[\s\S]*Are Tamaira T\.'s games back\?[\s\S]*Due back Tue 20 Oct · not marked back yet[\s\S]*✓ Yes, they're back[\s\S]*📞 Call[\s\S]*Open card[\s\S]*Is Ali H\.'s takedown done\?/.test(html), 'the red box lacks its title / questions / buttons in order');
  must(/href="https:\/\/porchandparty901\.com\/admin\/confirm-done\?b=\d+&r=" style="[^"]*background:#b42318;color:#ffffff;/.test(html), '✓ Yes is not a solid red button linking into /admin/confirm-done');
  const box = html.slice(html.indexOf('data-missed'), html.indexOf('</div></div></div>', html.indexOf('data-missed')) + 1);
  must(!/pickup/i.test(box.split('data-tomorrow')[0].replace(/takedown/g, '')) || !/Tamaira T\.'s pickup|games pickup/.test(box), 'the yellow pickup is in the red box');
  must(d.tidy.length === 1 && d.tidy[0].id === pick && /data-tidy[^>]*>Tidy up: 1 step to tick off \(Tamaira T\.'s pickup\)\. <a href="https:\/\/porchandparty901\.com\/admin\/"[^>]*>Open admin<\/a>/.test(html), 'the Tidy up line is missing or worded differently');
  must(html.indexOf('data-tidy') > html.indexOf('data-tomorrow') && html.indexOf('data-tidy') < html.indexOf('This email comes every day'), 'the Tidy up line is not at the very bottom');
  must(msg.text.includes("⚠ CHECK THESE FIRST\n- Are Tamaira T.'s games back? (Due back Tue 20 Oct · not marked back yet)\n  ✓ Yes, they're back: https://porchandparty901.com/admin/confirm-done?b=") && msg.text.includes("\nTidy up: 1 step to tick off (Tamaira T.'s pickup). Open admin: https://porchandparty901.com/admin/"), `the plain text lacks the red box or Tidy up: ${msg.text}`);
  must(!/MISSED|missed job/.test(msg.html + msg.text + msg.subject), 'the old MISSED words are still in the email');
  // A red item whose booking or request has a phone shows 📞 Call with its tel: link, in the HTML
  // AND the plain text (the text dropped it, 20 Oct 2026: only /admin buttons were printed).
  must(d.missed.length === 2 && d.missed.every((x) => x.btns.some((b) => b.label === '📞 Call' && /^tel:\d{10}$/.test(b.href))), `a red item with a phone has no 📞 Call: ${JSON.stringify(d.missed.map((x) => x.btns))}`);
  for (const x of d.missed) {
    const item = html.slice(html.indexOf(`data-missed-item="${x.id}"`), html.indexOf('</div></div>', html.indexOf(`data-missed-item="${x.id}"`)));
    must(/<a href="tel:\d{10}"[^>]*>📞 Call<\/a>/.test(item), `the red box item ${x.id} has no 📞 Call tel: link in the HTML`);
  }
  must(new RegExp(`- Are Tamaira T\\.'s games back\\? \\(Due back Tue 20 Oct · not marked back yet\\)\\n  ✓ Yes, they're back: https://porchandparty901\\.com/admin/confirm-done\\?b=${ret}&r=\\n  📞 Call: tel:9015550302\\n  Open card: https://porchandparty901\\.com/admin/day/2026-10-20\\n- Is Ali H\\.'s takedown done\\? \\(Due Tue 20 Oct · not marked done yet\\)\\n  ✓ Yes, it's done: https://porchandparty901\\.com/admin/confirm-done\\?b=${td}&r=\\n  📞 Call: tel:9015550301\\n  Open card: `).test(msg.text), `the plain-text red box lacks ✓ Yes / 📞 Call tel: / Open card per item: ${msg.text.slice(0, 700)}`);
  // No phone number outside a tel: link, in either part.
  must(!msg.text.replace(/^  📞 Call: tel:\d+$/gm, '').replace(/\D/g, ' ').includes('5550301') && !msg.html.replace(/href="[^"]*"/g, '').includes('555-03') && !/Hassan|Tee\b/.test(msg.html + msg.text), 'the email shows a phone number or a full surname');
  // Tue 20 Oct: the return and takedown are due TODAY (normal: section 1), the pickup is yellow.
  const TUE = '2026-10-20';
  d = await T.todoData(db, TUE, Date.parse(`${TUE}T12:00:00Z`));
  msg = T.renderTodo(d);
  must(msg.subject === 'Your to-do list for Tue 20 Oct · Porch & Party' && !d.missed.length && !/data-missed/.test(msg.html), `Tue (due day) is red: "${msg.subject}"`);
  must(d.sections[1].length === 2 && d.tidy.length === 1 && /data-tidy[^>]*>Tidy up: 1 step to tick off/.test(msg.html), 'Tue lacks its jobs today or the Tidy up line');
  // ✗ No on the pickup: red ("did not pick up"), the subject says "to check", no Tidy up line.
  await MS.recordNotHappened(db, { id: pick, date: '2026-10-18', request_key: null }, { question: 'Tamaira T. did not pick up on Sun 18 Oct' });
  d = await T.todoData(db, WED, Date.parse(`${WED}T12:00:00Z`));
  msg = T.renderTodo(d);
  must(msg.subject === '⚠ 3 to check · Your to-do list for Wed 21 Oct · Porch & Party', `the ✗ No subject is "${msg.subject}"`);
  must(d.missed.some((x) => x.id === pick && x.t === 'Tamaira T. did not pick up on Sun 18 Oct' && x.btns.map((b) => b.label).join() === '📞 Call,Open card' && x.btns[0].solid) && !d.tidy.length && !/data-tidy/.test(msg.html), 'the ✗ No pickup is not red in the box (Call + Open card) or still on Tidy up');
  // Yellow only: the email still goes, with just the Tidy up line (never "All clear today").
  await db.prepare("DELETE FROM request_events WHERE who LIKE 'not-happened:%'").run();
  await db.prepare('DELETE FROM bookings WHERE id IN (?1, ?2)').bind(ret, td).run();
  d = await T.todoData(db, WED, Date.parse(`${WED}T12:00:00Z`));
  msg = T.renderTodo(d);
  must(T.isTidyOnly(d) && !T.isAllClear(d) && !/data-all-clear|All clear today/.test(msg.html + msg.text), 'a yellow-only day is "All clear today"');
  must(/data-tidy[^>]*>Tidy up: 1 step to tick off \(Tamaira T\.(&#39;|')s pickup\)/.test(msg.html) && msg.subject === 'Your to-do list for Wed 21 Oct · Porch & Party' && !/data-section|data-missed|data-tomorrow/.test(msg.html), `the yellow-only email is not just the Tidy up line: ${msg.text}`);
  // Ticked: nothing left -> All clear today.
  await db.prepare("UPDATE bookings SET done_at = datetime('now') WHERE id = ?1").bind(pick).run();
  d = await T.todoData(db, WED, Date.parse(`${WED}T12:00:00Z`));
  must(T.isAllClear(d) && T.renderTodo(d).text === 'All clear today', 'a day with everything ticked is not All clear');
}

// ---- 4. /admin: strips, cards, ✕, ✗ No, calendar, auto-tick, confirm screen (real Memphis today) --
{
  const s = await session();
  const db = s.db;
  await db.prepare('DELETE FROM bookings').run();
  await db.prepare('DELETE FROM rental_returns').run();
  const today = chicagoDate();
  const y1 = addDays(today, -1);
  const y3 = addDays(today, -3);
  const reqA = s.requests.find((r) => r.email === 'test.renter@example.com');
  const reqB = s.requests.find((r) => r.email === 'weekend.renter@example.com');
  const rkA = b64urlText(reqA.key);
  const rkB = b64urlText(reqB.key);
  const cardsOrder = (html) => [...html.matchAll(/data-card="([^"]+)"/g)].map((x) => x[1]);
  const before = cardsOrder((await s.get('/admin/')).text);
  must(before.includes(rkA) && before.includes(rkB), 'the fixture requests have no cards on /admin');
  const book = async (kind, date, key, name, phone = '', items = '') => {
    await db.prepare(`INSERT INTO bookings (kind, date, time, customer_name, phone, request_key, items) VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6)
      ON CONFLICT(request_key, kind) DO UPDATE SET date = excluded.date, time = NULL, phone = excluded.phone, done_at = NULL, items = excluded.items`).bind(kind, date, name, phone, key, items).run();
    return (await s.one('SELECT id FROM bookings WHERE request_key = ?1 AND kind = ?2', key, kind)).id;
  };
  const free = async (kind, date, name, phone = '') => (await db.prepare('INSERT INTO bookings (kind, date, customer_name, phone) VALUES (?1, ?2, ?3, ?4)').bind(kind, date, name, phone).run()).meta.last_row_id;
  const idA = await book('party_takedown', y1, reqA.key, reqA.name, '901-555-0401');
  const setupA = await book('party_setup', y3, reqA.key, reqA.name);
  const games = 'Giant Checkers, Grab the Mic, Inflatable movie screen';
  const pickB = await book('rental_pickup', y3, reqB.key, reqB.name, '901-555-0403', games);
  const retB = await book('rental_return', today, reqB.key, reqB.name, '901-555-0403', games);
  const whoA = MS.missedFrom({ bookings: [{ id: idA, kind: 'party_takedown', date: y1, customer_name: reqA.name }], today })[0].who;
  const whoB = MS.missedFrom({ bookings: [{ id: pickB, kind: 'rental_pickup', date: y3, customer_name: reqB.name }], today })[0].who;
  const firstB = String(reqB.name).split(/\s+/)[0];
  let html = unesc((await s.get('/admin/')).text);
  // Red strip: one row, the question, ✓ Yes (posts the done route), Call, Card ↓, ✕.
  must((html.match(/data-missed-strip/g) || []).length === 1 && /<details class="mstrip" open role="alert" data-missed-strip data-missed-count="1">/.test(html), 'one red item does not give ONE open red strip');
  must(html.includes('<span class="st">⚠ <b>Not back yet</b> · 1 to check</span>'), 'the red strip title is not "⚠ Not back yet · 1 to check"');
  must(new RegExp(`data-missed-row="${idA}" data-red-reason="out"><span class="st">Is ${whoA.replace('.', '\\.')}'s takedown done\\? Due ${dayWords(y1)}</span><form method="post" action="/admin/calendar/bookings/${idA}/done" data-tidy-yes="${idA}"><input type="hidden" name="r" value="${rkA}"><button class="tap yes" type="submit"[^>]*>✓ Yes, it's done</button></form><a href="tel:9015550401"[^>]*>Call</a><a href="#c-${rkA}" data-missed-card`).test(html), 'the red row lacks "Is <who>\'s takedown done? Due <day>", ✓ Yes, it\'s done, Call, Card ↓');
  must(new RegExp(`<form method="post" action="/admin/missed/dismiss" data-missed-dismiss><input type="hidden" name="ids" value="${idA}"><button type="submit" class="sx"`).test(html), 'the red strip lacks ✕ with the red ids');
  must(html.indexOf('data-missed-strip') < html.indexOf('<h1>Requests</h1>') && /\.mstrip>summary,\.ystrip>summary\{[^}]*min-height:40px/.test(html), 'the strip is not a thin line at the top of Requests');
  // Yellow strip: "Did this happen? · 2 steps to tick off", rows with ✓ Yes, it happened / ✗ No.
  must(/<details class="ystrip" data-tidy-strip data-tidy-count="2"><summary[^>]*><span class="st">Did this happen\? · <b>2 steps to tick off<\/b><\/span>/.test(html), 'the yellow strip is not "Did this happen? · 2 steps to tick off"');
  const yrows = [...html.matchAll(/data-tidy-row="(\d+)"><span class="st">([^<]*)<\/span>/g)].map((x) => [Number(x[1]), x[2]]);
  must(JSON.stringify(yrows.map((x) => x[0]).sort((a, b) => a - b)) === JSON.stringify([setupA, pickB].sort((a, b) => a - b)) && JSON.stringify(yrows.map((x) => x[1]).sort()) === JSON.stringify([`${whoA} · party setup · ${dayWords(y3)}`, `${whoB} · games pickup · ${dayWords(y3)}`].sort()), `the yellow rows are ${JSON.stringify(yrows)}`);
  must(new RegExp(`data-tidy-row="${pickB}">[\\s\\S]*?<form method="post" action="/admin/calendar/bookings/${pickB}/done" data-tidy-yes="${pickB}">[\\s\\S]*?✓ Yes, it happened</button></form><form method="post" action="/admin/missed/not-happened" data-tidy-no="${pickB}"><input type="hidden" name="b" value="${pickB}">[\\s\\S]*?✗ No</button>`).test(html), 'a yellow row lacks ✓ Yes, it happened / ✗ No');
  must(!html.includes(`data-missed-row="${pickB}"`) && !html.includes(`data-missed-row="${setupA}"`), 'a yellow item is in the red strip');
  must(!/MISSED/.test(html.replace(/data-missed[\w-]*/g, '')), 'the old MISSED words are still on Requests');
  must(JSON.stringify(cardsOrder(html)) === JSON.stringify(before), 'a tag moved a card');
  const cardOf = (h, rk) => { const i = h.indexOf(`id="c-${rk}"`); return i < 0 ? '' : h.slice(h.lastIndexOf('<article', i), h.indexOf('</article>', i)); };
  // Red card (reqA: takedown not done, setup not ticked -> red first).
  let card = cardOf(html, rkA);
  must(/class="card stepcard miss"/.test(card) && new RegExp(`data-missed="${idA}"`).test(card), 'the red card has no red border');
  must(card.includes('<span class="mchip" data-missed-tag>⚠ Not done yet · 1 day late</span>'), 'the red card lacks "⚠ Not done yet · 1 day late"');
  must(card.includes(`>Is ${whoA}'s takedown done?</p>`) && /data-next-step="missed"[^>]*data-red-reason="out"><p class="lbl">Next step · check this/.test(card), 'the red next step is not the question');
  must(new RegExp(`<form method="post" action="/admin/calendar/bookings/${idA}/done" data-tidy-yes="${idA}">[\\s\\S]*?✓ Yes, it's done</button>`).test(card) && new RegExp(`href="/admin/calendar/bookings/${idA}/edit" data-missed-new-day`).test(card) && /href="tel:9015550401"[^>]*>Call</.test(card), 'the red next step lacks ✓ Yes, Call, Pick a new day');
  must(/action="\/admin\/requests\/takedown"><input type="hidden" name="r" value="[^"]+"><input type="hidden" name="plan" value="customer_handles">[\s\S]*?>Not needed</.test(card.split('data-next-step="missed"')[1] || ''), 'the red takedown has no Not needed');
  // Yellow card (reqB: pickup not ticked, the return is today = normal): a yellow tag, no red border.
  card = cardOf(html, rkB);
  must(/class="card stepcard tidy"/.test(card) && !/stepcard miss/.test(card) && new RegExp(`data-tidy="${pickB}"`).test(card) && !/data-missed=/.test(card), 'the yellow card has a red border (or no yellow marker)');
  must(card.includes(`<span class="ychip" data-tidy-tag>Did this happen? Games pickup ${dayWords(y3)}</span>`) && !/data-missed-tag/.test(card), 'the yellow card lacks "Did this happen? Games pickup <day>"');
  must(card.includes(`>Did ${firstB} pick up the games on ${dayWords(y3)}?</p>`) && /data-next-step="tidy"/.test(card), 'the yellow next step is not "Did <first> pick up the games on <day>?"');
  must(new RegExp(`action="/admin/calendar/bookings/${pickB}/done"[\\s\\S]*?✓ Yes, it happened[\\s\\S]*?action="/admin/missed/not-happened"[\\s\\S]*?✗ No`).test(card), 'the yellow next step lacks ✓ Yes, it happened / ✗ No');
  // Calendar: red chip for red, yellow chip for yellow, plain for today.
  let cal = (await s.get(`/admin/calendar?month=${y1.slice(0, 7)}`)).text;
  must(new RegExp(`class="k party_takedown[^"]* missed" data-missed-chip draggable="true" data-drag data-booking="${idA}"`).test(cal) && new RegExp(`class="k party_takedown[^"]* missed" data-missed-chip data-list-booking="${idA}"`).test(cal), 'the red takedown chip is not red');
  if (y3.slice(0, 7) === y1.slice(0, 7)) must(new RegExp(`class="k rental_pickup[^"]* tidy" data-tidy-chip draggable="true" data-drag data-booking="${pickB}"`).test(cal) && !new RegExp(`missed" data-missed-chip draggable="true" data-drag data-booking="${pickB}"`).test(cal), 'the yellow pickup chip is not yellow (or is red)');
  else must(true, 'month boundary');
  must(/\.k\.missed\{background:#c0392b/.test(cal) && /\.k\.tidy\{background:#fdf3d0/.test(cal), 'the calendar lacks the red / yellow chip styles');
  if (today.slice(0, 7) === y1.slice(0, 7)) must(!new RegExp(`(missed|tidy)" data-(missed|tidy)-chip draggable="true" data-drag data-booking="${retB}"`).test(cal), 'a return due today is coloured');
  else must(true, 'month boundary');
  // ✕ hides only the RED strip, until tomorrow, on every device; never the yellow strip, card or email.
  const r = await s.post('/admin/missed/dismiss', { ids: String(idA) });
  must(r.status === 303 && /\/admin\/\?m=/.test(r.location), `the ✕ did not redirect back: ${r.status} ${r.location}`);
  must(JSON.stringify(JSON.parse((await s.one("SELECT value FROM settings WHERE key = 'missed_strip_dismissed'")).value)) === JSON.stringify({ day: today, ids: [idA] }), 'the dismissal is not stored server-side for today');
  html = unesc((await s.get('/admin/')).text);
  must(!/data-missed-strip/.test(html) && /data-tidy-strip/.test(html) && cardOf(html, rkA).includes('data-missed-tag'), 'the ✕ did not hide just the red strip (or hid the card tag / yellow strip)');
  must((await T.todoData(db, today, Date.now())).missed.length === 1, 'the ✕ hid the item from the email');
  await db.prepare("UPDATE settings SET value = ?1 WHERE key = 'missed_strip_dismissed'").bind(JSON.stringify({ day: y1, ids: [idA] })).run();
  must(/data-missed-strip/.test((await s.get('/admin/')).text), 'a ✕ from yesterday still hides the strip this morning');
  await s.post('/admin/missed/dismiss', { ids: String(idA) });
  const newRed = await free('porch_takedown', y1, 'Nia Newmiss');
  html = unesc((await s.get('/admin/')).text);
  must(/data-missed-count="2"/.test(html) && html.includes(`data-missed-row="${newRed}"`), 'a red item after the ✕ does not show the strip again');
  must(html.includes(`<a href="/admin/day/${y1}" data-missed-card`), 'Card ↓ with no request does not go to the Day sheet');
  // ✗ No on a yellow item: one history line, the item turns red everywhere.
  const evBefore = (await s.all('SELECT id FROM request_events')).length;
  const no = await s.post('/admin/missed/not-happened', { b: String(pickB), r: rkB });
  must(no.status === 303 && decodeURIComponent(no.location).includes(`Moved to red: ${whoB} did not pick up on ${dayWords(y3)}. Call them.`) && no.location.endsWith(`#c-${rkB}`), `✗ No did not come back to the card: ${no.location}`);
  const ev = await s.one("SELECT request_key, who, what FROM request_events WHERE who LIKE 'not-happened:%' ORDER BY id DESC");
  must(ev && ev.request_key === reqB.key && ev.who === `not-happened:${pickB}@${y3}` && ev.what === `Did not happen: ${whoB} did not pick up on ${dayWords(y3)}. Call them.` && (await s.all('SELECT id FROM request_events')).length === evBefore + 1, `✗ No did not record ONE history line: ${JSON.stringify(ev)}`);
  html = unesc((await s.get('/admin/')).text);
  must(new RegExp(`data-missed-row="${pickB}" data-red-reason="not_happened"><span class="st">${whoB.replace('.', '\\.')} did not pick up on ${dayWords(y3)}</span><a href="tel:9015550403"`).test(html) && /⚠ <b>Check these<\/b> · 3/.test(html), 'the ✗ No item is not a red row "<who> did not pick up on <day> · Call" (title "Check these")');
  must(!html.includes(`data-tidy-row="${pickB}"`), 'the ✗ No item is still on the yellow strip');
  card = cardOf(html, rkB);
  must(/class="card stepcard miss"/.test(card) && card.includes(`<span class="mchip" data-missed-tag>⚠ Did not happen · ${dayWords(y3)}</span>`) && card.includes(`>${whoB} did not pick up on ${dayWords(y3)}</p>`), 'the ✗ No card is not red with "Did not happen"');
  if (y3.slice(0, 7) === today.slice(0, 7)) must(new RegExp(`missed" data-missed-chip draggable="true" data-drag data-booking="${pickB}"`).test((await s.get(`/admin/calendar?month=${y3.slice(0, 7)}`)).text), 'the ✗ No chip is not red');
  else must(true, 'month boundary');
  must((await T.todoData(db, today, Date.now())).missed.some((m) => m.id === pickB && m.reason === 'not_happened'), 'the ✗ No item is not red in the email');
  const bad = await s.post('/admin/missed/not-happened', { b: String(idA) });
  must(/\?e=/.test(bad.location) && (await s.all("SELECT id FROM request_events WHERE who = ?1", `not-happened:${idA}@${y1}`)).length === 0, '✗ No on a red item was recorded');
  // Auto-tick: the takedown marked done ticks the setup (booking + Setup done on the card), one line.
  const done = await s.post(`/admin/calendar/bookings/${idA}/done`, { r: rkA });
  must(done.status === 303 && /Setup ticked off too/.test(decodeURIComponent(done.location)), `the takedown done did not say the setup was ticked: ${done.location}`);
  must(Boolean((await s.one('SELECT done_at FROM bookings WHERE id = ?1', setupA)).done_at) && Boolean((await s.one('SELECT job_done_at FROM request_status WHERE request_key = ?1', reqA.key)).job_done_at), 'the setup was not ticked when the takedown was marked done');
  must((await s.all("SELECT id FROM request_events WHERE request_key = ?1 AND what = 'Setup ticked off automatically (takedown done)'", reqA.key)).length === 1, 'the auto-tick history line is missing (or twice)');
  html = unesc((await s.get('/admin/')).text);
  must(!cardOf(html, rkA).includes('data-missed-tag') && !cardOf(html, rkA).includes('data-tidy-tag') && !html.includes(`data-tidy-row="${setupA}"`) && !html.includes(`data-missed-row="${idA}"`), 'the takedown + auto-ticked setup still show');
  // Never retroactive: a takedown already done with its setup open stays as it is on every read.
  const oldTd = await free('porch_takedown', y3, 'Olga Old');
  await db.prepare("UPDATE bookings SET done_at = datetime('now'), request_key = 'old|olga' WHERE id = ?1").bind(oldTd).run();
  const oldSet = await free('porch_install', addDays(today, -5), 'Olga Old');
  await db.prepare("UPDATE bookings SET request_key = 'old|olga' WHERE id = ?1").bind(oldSet).run();
  await s.get('/admin/'); await s.get(`/admin/calendar?month=${y1.slice(0, 7)}`); await T.todoData(db, today, Date.now());
  must(!(await s.one('SELECT done_at FROM bookings WHERE id = ?1', oldSet)).done_at, 'a page read ticked an old setup (auto-tick must only run when a step is marked)');
  // ✓ Yes, it happened on a setup (yellow): its booking done.
  const fs = await free('party_setup', y1, 'Fran Setup');
  must((await s.post(`/admin/calendar/bookings/${fs}/done`, {})).status === 303 && Boolean((await s.one('SELECT done_at FROM bookings WHERE id = ?1', fs)).done_at), 'a setup cannot be ticked from "Did this happen?"');
  const insO = await free('other', y1, 'Oscar Other');
  await s.post(`/admin/calendar/bookings/${insO}/done`, {});
  must(Boolean((await s.one('SELECT done_at FROM bookings WHERE id = ?1', insO)).done_at), 'an "other" booking cannot be marked done');

  // ---- 5. the confirm screen (the email's ✓ Yes) ---------------------------------------------------
  await db.prepare("DELETE FROM request_events WHERE who LIKE 'not-happened:%'").run();
  await db.prepare('UPDATE bookings SET date = ?1 WHERE id = ?2').bind(y1, retB).run();
  const mailItem = (await T.todoData(db, today, Date.now())).missed.find((m) => m.id === retB);
  must(mailItem && mailItem.btns[0].href === `/admin/confirm-done?b=${retB}&r=${rkB}`, `the email's ✓ Yes for the return is ${mailItem && mailItem.btns[0].href}`);
  const snap = async () => JSON.stringify([await s.all('SELECT id, done_at, date FROM bookings ORDER BY id'), await s.all('SELECT * FROM rental_returns'), (await s.all('SELECT id FROM request_events')).length, await s.all('SELECT request_key, status, job_done_at FROM request_status ORDER BY request_key')]);
  const outTile = async () => Number(((await s.get('/admin/inventory')).text.match(/data-inv-total-out>(\d+)</) || [])[1]);
  const out0 = await outTile();
  const s0 = await snap();
  const g = await s.get(mailItem.btns[0].href);
  const gt = unesc(g.text);
  must(g.status === 200 && gt.includes(`<h1 data-confirm-title>Mark ${whoB}'s games back?</h1>`) && gt.includes(`Due back ${dayWords(y1)}`), `the confirm screen does not ask "Mark <who>'s games back?" with the due day: ${g.status}`);
  must(/data-confirm-items><li>Grab the Mic<\/li><li>Inflatable Movie Screen<\/li><li>Giant Checkers<\/li>/.test(gt), 'the confirm screen does not list the items');
  must(/Anything damaged or missing\?[\s\S]*<input type="radio" name="damage" value="no" checked> No, all fine[\s\S]*<input type="radio" name="damage" value="yes"> Yes, something is damaged or missing/.test(gt) && /name="damaged" value="Giant Checkers"/.test(gt), 'the confirm screen lacks "Anything damaged or missing?" (default No, all fine) with the items');
  must(new RegExp(`<form method="post" action="/admin/confirm-done" data-confirm-form><input type="hidden" name="b" value="${retB}"><input type="hidden" name="r" value="${rkB}">`).test(gt) && /<button class="btn primary" type="submit"[^>]*>✓ Yes, they're back<\/button>/.test(gt) && new RegExp(`<a class="btn ghost" href="/admin/#c-${rkB}" data-confirm-cancel[^>]*>Cancel</a>`).test(gt), 'the confirm screen lacks the POST form, ✓ Yes, they\'re back and Cancel');
  await s.get(mailItem.btns[0].href); await s.get(`${mailItem.btns[0].href}&damage=yes`);
  must((await snap()) === s0 && (await outTile()) === out0, 'opening the confirm link (GET) changed something');
  const anon = await s.get(mailItem.btns[0].href, { auth: false });
  must(anon.status !== 200 && !/Mark .*games back/.test(anon.text), `the confirm screen opens without signing in: ${anon.status}`);
  const xs = await s.post('/admin/confirm-done', { b: String(retB), r: rkB, damage: 'no' }, { headers: { Origin: 'https://evil.example' } });
  must(xs.status === 403 && (await snap()) === s0, `a cross-site POST to confirm-done was accepted: ${xs.status}`);
  must(out0 > 0, `the games are not OUT before the confirm (${out0})`);
  const p = await s.post('/admin/confirm-done', { b: String(retB), r: rkB, damage: 'no' });
  must(p.status === 303 && decodeURIComponent(p.location) === `/admin/?m=✓ Marked: ${whoB}'s games are back. Pickup ticked off too.#c-${rkB}`, `the confirm POST did not go back to the card with the flash: ${decodeURIComponent(p.location)}`);
  const rr = await s.one('SELECT returned_at, damaged FROM rental_returns WHERE return_key = ?1', reqB.key);
  must(rr && rr.returned_at && rr.damaged === 0, `the return was not marked back, all fine: ${JSON.stringify(rr)}`);
  must(Boolean((await s.one('SELECT done_at FROM bookings WHERE id = ?1', pickB)).done_at) && (await s.all("SELECT id FROM request_events WHERE request_key = ?1 AND what = 'Pickup ticked off automatically (games came back)'", reqB.key)).length === 1, 'games back did not tick the pickup (with one history line)');
  must((await outTile()) === 0, `the inventory does not show the games IN after the confirm (OUT ${out0} -> ${await outTile()})`);
  html = unesc((await s.get(p.location.split('#')[0])).text);
  must(html.includes(`✓ Marked: ${whoB}'s games are back.`) && /class="notice ok"/.test(html) && !cardOf(html, rkB).includes('data-missed-tag') && !cardOf(html, rkB).includes('data-tidy-tag') && !cardOf(html, rkB).includes('data-returned-damage'), 'after the confirm the card still shows red / yellow, damage, or no green flash');
  const s1 = await snap();
  const again = await s.get(mailItem.btns[0].href);
  must(again.status === 200 && /<h1 data-confirm-done>Already marked back ✓<\/h1>/.test(again.text) && !/data-confirm-form/.test(again.text), 'an already-back return does not say "Already marked back ✓" (or still offers the form)');
  const p2 = await s.post('/admin/confirm-done', { b: String(retB), r: rkB, damage: 'yes' });
  must(decodeURIComponent(p2.location) === `/admin/?m=Already marked back ✓#c-${rkB}` && (await snap()) === s1, 'confirming an already-back return changed something');
  // "Yes, something is damaged or missing": Returned — check damage on the card (keep some for damage).
  const pickA = await book('rental_pickup', y3, reqA.key, reqA.name, '', 'Giant Uno, Cornhole');
  const retA = await book('rental_return', y1, reqA.key, reqA.name, '', 'Giant Uno, Cornhole');
  await db.prepare('DELETE FROM rental_returns WHERE return_key = ?1').bind(reqA.key).run();
  const pd = await s.post('/admin/confirm-done', { b: String(retA), r: rkA, damage: 'yes', damaged: 'Giant Uno', notes: 'cracked' });
  must(/Something is damaged or missing: check the deposit/.test(decodeURIComponent(pd.location)), `the damaged confirm did not say so: ${decodeURIComponent(pd.location)}`);
  const ra = await s.one('SELECT damaged, items, notes FROM rental_returns WHERE return_key = ?1', reqA.key);
  must(ra && ra.damaged === 1 && JSON.parse(ra.items).find((i) => i.name === 'Giant Uno').damaged && ra.notes === 'cracked' && Boolean((await s.one('SELECT done_at FROM bookings WHERE id = ?1', pickA)).done_at), `the damage answer was not saved on the check-in: ${JSON.stringify(ra)}`);
  must(/data-returned-damage>Returned — check damage/.test(cardOf((await s.get('/admin/')).text, rkA)), 'a damaged return does not route the card to "Returned — check damage"');
  const pn = await s.post('/admin/confirm-done', { b: String(retA), r: rkA, damage: 'no' });
  must(/Already marked back/.test(decodeURIComponent(pn.location)) && (await s.one('SELECT damaged FROM rental_returns WHERE return_key = ?1', reqA.key)).damaged === 1, 'a second confirm overwrote the damage answer');
  // A takedown from the email: "Mark <who>'s takedown done?", no damage question, then the Day sheet.
  const tdx = await free('party_takedown', y1, 'Ali Hassan');
  const gx = unesc((await s.get(`/admin/confirm-done?b=${tdx}&r=`)).text);
  must(gx.includes("<h1 data-confirm-title>Mark Ali H.'s takedown done?</h1>") && gx.includes(`Due ${dayWords(y1)}`) && !/data-confirm-damage/.test(gx) && /✓ Yes, it's done<\/button>/.test(gx), 'the takedown confirm screen is wrong');
  const px = await s.post('/admin/confirm-done', { b: String(tdx), r: '' });
  must(decodeURIComponent(px.location) === `/admin/day/${y1}?m=✓ Marked: Ali H.'s takedown is done.` && Boolean((await s.one('SELECT done_at FROM bookings WHERE id = ?1', tdx)).done_at), `the takedown confirm POST: ${decodeURIComponent(px.location)}`);
  must(/Already marked done ✓/.test((await s.get(`/admin/confirm-done?b=${tdx}&r=`)).text), 'an already-done takedown does not say "Already marked done ✓"');
  must(/\?e=/.test((await s.get('/admin/confirm-done?b=999999&r=')).location), 'an unknown booking on the confirm screen is not refused');
  // The check-in page (Mark returned) ticks the pickup too.
  const pickC = await free('rental_pickup', y3, 'Cara Check');
  await db.prepare("UPDATE bookings SET request_key = 'chk|cara' WHERE id = ?1").bind(pickC).run();
  const retC = await free('rental_return', y1, 'Cara Check');
  await db.prepare("UPDATE bookings SET request_key = 'chk|cara' WHERE id = ?1").bind(retC).run();
  await s.post(`/admin/returns?k=${b64urlText('chk|cara')}`, { notes: '' });
  must(Boolean((await s.one('SELECT done_at FROM bookings WHERE id = ?1', pickC)).done_at) && (await s.all("SELECT id FROM request_events WHERE request_key = 'chk|cara' AND what = 'Pickup ticked off automatically (games came back)'")).length === 1, 'Mark returned on the check-in page did not tick the pickup');
}

if (checks < 150) errors.push(`only ${checks} checks ran (Rule 0: at least 150)`);
if (errors.length) {
  console.error(`VALIDATION FAIL: missed jobs (${errors.length} of ${checks})`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`VALIDATION PASS: missed jobs, two tiers (${checks} checks)`);
