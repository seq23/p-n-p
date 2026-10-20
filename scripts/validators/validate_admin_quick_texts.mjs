#!/usr/bin/env node
/**
 * Quick texts behind "💬 Text ▾" on every request card (owner-approved mock-up, 20 Oct 2026;
 * docs/admin-console.md "Quick texts"). Fails unless:
 *  1. the words are the approved mock-up's, word for word (pinned HERE, not read from the code),
 *     and every text ends with a new line "— Valerie at Porch & Party"; the blank text is
 *     "Hi <first>! " + that sign-off;
 *  2. a value that is not on file is written "__" ("$__" for money), never "undefined" or empty;
 *  3. the option list per job type: a rental shows Game rentals, Any job, Booking and money (no
 *     porch texts); a porch, party or grazing job shows Porch, party and grazing, Any job, Booking
 *     and money (no rental texts, no games-held reminder); games + decor shows both; the best 3
 *     are not repeated under All texts, and together they are every text the job offers;
 *  4. the stage -> best 3 mapping: games out -> Set return time, Return is today, I'm here; porch
 *     up -> Set takedown time, We're here, Running late; every step of every plan has 3;
 *  5. the sms: link carries the words IN THE BOX at tap time, encoded (the page script runs the
 *     same smsHref, reading the textarea when Open in Messages is tapped), and the script parses;
 *  6. the rendered Requests cards: a card with a phone has the menu (Blank text, Best right now,
 *     All texts for this job ▾, ✕ Close, ← Back to texts, Open in Messages to send, the laptop
 *     "Open in Messages (Mac linked to iPhone)", Copy text) filled in from the request, with no
 *     ready-made sms: body in the page;
 *  7. Open in Messages logs ONE history line "Texted: <title>" on that card (an unknown text logs
 *     nothing), and It's confirmed also ticks the older "texted" column, once.
 * Rule 0: fewer than 60 checks is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const Q = await mod('functions/_lib/quick-texts.mjs');
const VQ = await mod('functions/_lib/views-quick-texts.mjs');
const SIGN = '\n— Valerie at Porch & Party';

// ---- 1. The approved words (made-up customer) ------------------------------------------------
const c = { first: 'Jordan', day: 'Sat 24 Oct', setupDay: 'Sat 24 Oct', returnDay: 'Sun 25 Oct', takedownDay: 'Sat 7 Nov', amount: '$65', deposit: '$50', dueNow: '$115', invoiceNumber: 'PNP-2026-0099', items: 'Giant Jenga and Connect 4', holdEnds: 'Thu 22 Oct, 5:00 PM' };
const WORDS = {
  pickup: ['Set pickup time', "Hi Jordan! What time works for your game pickup on Sat 24 Oct at Mt. Moriah Station? Text me here and I'll meet you there."],
  ret: ['Set return (drop-off) time', "Hi Jordan! What time works to bring the games back on Sun 25 Oct at Mt. Moriah Station? Text me here and I'll meet you there."],
  here: ["I'm here. How far away are you?", "Hi Jordan! I'm here at Mt. Moriah Station (2602 Mt. Moriah Rd). How far away are you?"],
  bal: ['Bring the balance', 'Hi Jordan! See you Sat 24 Oct. Please have the rest, $65, ready by Zelle or Cash App at pickup.'],
  today: ['Return is today', "Hi Jordan! Friendly reminder: the games are due back today. Text me when you're on your way."],
  depback: ['Deposit coming back', 'Hi Jordan! Everything came back complete. Thank you! Your $50 deposit is on its way back to you.'],
  setup: ['Set setup time', 'Hi Jordan! What time works for us to set up on Sat 24 Oct?'],
  takedown: ['Set takedown time', 'Hi Jordan! What time works for us to come take everything down on Sat 7 Nov?'],
  photos: ['Send address and photos', 'Hi Jordan! Could you text me the address and a couple of photos of the space? It helps me plan your setup.'],
  omw: ['On our way', "Hi Jordan! We're on our way, about __ minutes out."],
  werehere: ["We're here", "Hi Jordan! We're here!"],
  got: ['Got your message', "Hi Jordan! Got your message. I'll get back to you shortly."],
  late: ['Running late', "Hi Jordan! I'm running about __ minutes behind. So sorry, see you soon!"],
  callme: ['Call me back', 'Hi Jordan! I just tried to call you. Give me a call back at 901-355-1518 when you can.'],
  conf: ["It's confirmed", "Hi Jordan! Your deposit came in, so you're booked. See you soon!"],
  hold: ['Reminder: games held until…', 'Hi Jordan! Friendly reminder: your games (Giant Jenga and Connect 4) are held for you until Thu 22 Oct, 5:00 PM. Pay the deposit of $115 by Zelle or Cash App from your invoice to keep them.'],
  pay: ['Payment reminder', 'Hi Jordan! Friendly reminder: $65 is still due on invoice PNP-2026-0099. You can pay by Zelle or Cash App as shown on the invoice.'],
  thanks: ['Thank you', 'Hi Jordan! Thank you for choosing Porch & Party. It was a pleasure!'],
};
must(Q.QUICK_TEXTS.length === Object.keys(WORDS).length, `there are ${Q.QUICK_TEXTS.length} quick texts, the mock-up has ${Object.keys(WORDS).length}`);
for (const [id, [title, body]] of Object.entries(WORDS)) {
  const q = Q.QUICK_BY_ID[id];
  must(Boolean(q), `no quick text "${id}"`);
  if (!q) continue;
  must(q.t === title, `${id}: title "${q.t}", approved "${title}"`);
  must(Q.fullText(q, c) === body + SIGN, `${id}: words differ from the approved mock-up: ${JSON.stringify(Q.fullText(q, c))}`);
}
for (const q of Q.QUICK_TEXTS) must(Q.fullText(q, c).endsWith('\n— Valerie at Porch & Party'), `${q.id}: not signed "— Valerie at Porch & Party" on a new line`);
must(Q.fullText(null, c) === 'Hi Jordan! \n— Valerie at Porch & Party', `the blank text is ${JSON.stringify(Q.fullText(null, c))}`);
must(Q.SIGN_OFF === '— Valerie at Porch & Party', 'the sign-off changed');

// ---- 2. "__" for anything not on file -------------------------------------------------------
const empty = Q.quickCtx({ r: { name: 'Jordan Test', phone: '9015550101' } });
must(empty.first === 'Jordan', `first name is "${empty.first}"`);
const t = (id) => Q.fullText(Q.QUICK_BY_ID[id], empty);
must(t('ret').includes('back on __ at Mt. Moriah'), `missing return day: ${t('ret')}`);
must(t('pickup').includes('pickup on __ at'), `missing pickup day: ${t('pickup')}`);
must(t('bal').includes('See you __. Please have the rest, $__,'), `missing balance: ${t('bal')}`);
must(t('pay').includes('$__ is still due on invoice __.'), `missing amount / invoice: ${t('pay')}`);
must(t('hold').includes('until __. Pay the deposit of $__ by'), `missing hold end / deposit: ${t('hold')}`);
must(t('depback').includes('Your $__ deposit'), `missing deposit: ${t('depback')}`);
must(t('setup').includes('set up on __?') && t('takedown').includes('down on __?'), 'missing setup / takedown day is not "__"');
for (const q of Q.QUICK_TEXTS) must(!/undefined|null|NaN| {2}|\$ /.test(Q.fullText(q, empty)), `${q.id} with nothing on file: ${Q.fullText(q, empty)}`);
must(Q.fullText(null, Q.quickCtx({ r: { name: '' } })) === 'Hi there! \n— Valerie at Porch & Party', 'no name is not "Hi there!"');
// Filled from the card's facts.
const filled = Q.quickCtx({
  r: { name: 'Jordan Test', phone: '(901) 555-0101' },
  bookings: [{ kind: 'rental_pickup', date: '2026-10-24', items: 'Giant Jenga, Connect 4' }, { kind: 'rental_return', date: '2026-10-25' }],
  inv: { number: 'PNP-2026-0099', deposit_due_cents: 11500, balance: { remaining: 6500, refundable: 5000, void: false } },
  hold: { untilMs: Date.UTC(2026, 9, 22, 22, 0), by_hand: false },
  dates: { pickup: '2026-10-24', ret: '2026-10-25' },
});
for (const [k, v] of Object.entries({ day: 'Sat 24 Oct', returnDay: 'Sun 25 Oct', amount: '$65', deposit: '$50', dueNow: '$115', invoiceNumber: 'PNP-2026-0099', items: 'Giant Jenga and Connect 4', holdEnds: 'Thu 22 Oct, 5:00 PM' })) must(filled[k] === v, `filled ${k} is "${filled[k]}", expected "${v}"`);
const porchF = Q.quickCtx({ r: { name: 'Kai Porch' }, bookings: [{ kind: 'porch_install', date: '2026-10-03' }, { kind: 'porch_takedown', date: '2026-11-07' }] });
must(porchF.setupDay === 'Sat 3 Oct' && porchF.takedownDay === 'Sat 7 Nov', `porch days: ${porchF.setupDay} / ${porchF.takedownDay}`);
must(Q.quickCtx({ r: { name: 'A' }, inv: { balance: { remaining: 900, void: true } } }).amount === '', 'a void invoice still fills an amount');

// ---- 3 + 4. Options per job type, best 3 per step -------------------------------------------
const ids = (items) => items.map((q) => q.id);
const offered = (m) => [...ids(m.best.items), ...m.groups.flatMap((g) => ids(g.items))];
const byGroup = (g) => Q.QUICK_TEXTS.filter((q) => q.g === g).map((q) => q.id);
const rent = Q.menuFor({ services: ['rentals'], current: 'returned' });
must(rent.best.words === 'games are out' && ids(rent.best.items).join() === 'ret,today,here', `rental, games out: best is ${rent.best.words} / ${ids(rent.best.items)}`);
must(rent.groups.map((g) => g.name).join('|') === 'Game rentals|Any job|Booking and money', `rental groups: ${rent.groups.map((g) => g.name)}`);
must(offered(rent).sort().join() === [...byGroup('rent'), ...byGroup('any'), ...byGroup('money')].sort().join(), `a rental offers ${offered(rent)}`);
must(!offered(rent).some((id) => byGroup('job').includes(id)), 'a rental offers porch / party texts');
const porch = Q.menuFor({ services: ['porch'], current: 'takedown' });
must(porch.best.words === 'porch is up' && ids(porch.best.items).join() === 'takedown,werehere,late', `porch up: best is ${porch.best.words} / ${ids(porch.best.items)}`);
must(porch.groups.map((g) => g.name).join('|') === 'Porch, party and grazing|Any job|Booking and money', `porch groups: ${porch.groups.map((g) => g.name)}`);
must(!offered(porch).some((id) => byGroup('rent').includes(id)) && !offered(porch).includes('hold'), `a porch job offers rental texts: ${offered(porch)}`);
must(offered(porch).sort().join() === [...byGroup('job'), ...byGroup('any'), ...byGroup('money').filter((x) => x !== 'hold')].sort().join(), `a porch job offers ${offered(porch)}`);
must(ids(porch.groups.find((g) => g.key === 'money').items).join() === 'conf,pay,thanks', 'Booking and money on a porch job is not confirmed, payment reminder, thank you');
must(ids(rent.groups.find((g) => g.key === 'money').items).join() === 'conf,hold,pay,thanks', 'Booking and money on a rental is not the 4 texts');
for (const m of [rent, porch]) { const o = offered(m); must(new Set(o).size === o.length, 'a text is listed twice (best 3 repeated under All texts)'); }
const both = Q.menuFor({ services: ['party', 'rentals'], current: 'picked' });
must(both.groups.map((g) => g.key).join() === 'rent,job,any,money' && ids(both.best.items).join() === 'pickup,bal,here', `games + party: ${both.groups.map((g) => g.key)} / ${ids(both.best.items)}`);
must(Q.menuFor({ services: ['party'], current: 'setup' }).best.words === 'booked, setup next' && Q.menuFor({ services: ['porch'], current: 'setup' }).best.words === 'booked, install next', 'setup stage words');
const ST = await mod('functions/_lib/steps.mjs');
for (const svc of [['rentals'], ['porch'], ['party'], ['grazing'], ['porch', 'rentals'], ['rentals', 'grazing']]) {
  for (const cur of [...ST.stepPlan(svc, { extraPaid: true }), 'finished', 'void']) {
    const m = Q.menuFor({ services: svc, current: cur });
    must(m.best.items.length === 3 && m.best.words, `${svc.join('+')} at ${cur}: ${m.best.items.length} best texts`);
  }
}

// ---- 5. The sms: link is the words in the box at tap time -----------------------------------
const edited = 'Hi Jordan! Changed it: 5 & 10% off? no — just "hi"\n— Valerie at Porch & Party';
must(Q.smsHref('(901) 555-0101', edited) === `sms:9015550101?&body=${encodeURIComponent(edited)}`, `smsHref: ${Q.smsHref('(901) 555-0101', edited)}`);
must(Q.smsHref('+1 901 555 0101', 'x') === 'sms:9015550101?&body=x' && Q.smsHref('', 'x') === '', 'smsHref number rule');
let parsed = true; try { new Function(VQ.QT_JS); } catch { parsed = false; }
must(parsed, 'the quick-texts page script does not parse');
const fnSrc = (VQ.QT_JS.match(/var smsHref=(function[\s\S]*?\n\})/) || [])[1];
must(Boolean(fnSrc), 'the page script does not carry the tested smsHref');
if (fnSrc) { const live = new Function(`return (${fnSrc});`)(); must(live('(901) 555-0101', edited) === Q.smsHref('(901) 555-0101', edited), 'the page smsHref differs from the tested one'); }
must(/data-qt-send[\s\S]{0,80}smsHref\(o\.box\.getAttribute\('data-qt-phone'\),o\.ta\.value\)[\s\S]{0,60}setAttribute\('href',href\)/.test(VQ.QT_JS), 'Open in Messages does not build the link from the textarea at tap time');
must(/f\.append\('quick',o\.pick\)/.test(VQ.QT_JS) && /\/admin\/msg\/tapped/.test(VQ.QT_JS), 'Open in Messages does not log the tap');
must(!/location\.(href|hash)\s*=|scrollTo\(|scrollIntoView/.test(VQ.QT_JS), 'the quick texts move the page (she must stay on the same card)');
must(/Fill in the blank before you send\./.test(VQ.QT_JS), 'no "Fill in the blank before you send." hint');

// ---- 6. The rendered cards ------------------------------------------------------------------
const s = await session();
const dash = await s.get('/admin/');
must(dash.status === 200, `/admin/ answered ${dash.status}`);
must(dash.text.includes(VQ.QT_JS) && dash.text.includes('.qtshade{'), 'Requests lacks the quick-texts script / styles');
const cards = dash.text.split('<article').slice(1).map((a) => a.slice(0, a.indexOf('</article>'))).filter((x) => /data-reqcard/.test(x));
let menus = 0;
for (const card of cards) {
  const rk = (card.match(/ id="c-([^"]+)"/) || [])[1];
  const req = s.requests.find((r) => s.rk(r.key) === rk);
  if (!req || String(req.phone || '').replace(/\D/g, '').length < 7) continue;
  menus += 1;
  const tpl = (card.match(/<template data-qt-menu>([\s\S]*?)<\/template>/) || [])[1] || '';
  const first = String(req.name || '').trim().split(/\s+/)[0] || 'there';
  for (const bit of [`Text ${first}`, '✕ Close', '✏️ Blank text', `Write your own message to ${first}`, 'Best right now (', 'All texts for this job ▾', '← Back to texts', 'Open in Messages to send', 'Open in Messages (Mac linked to iPhone)', 'Copy text', 'Booking and money', 'Any job', '<textarea data-qt-ta']) must(tpl.includes(bit.replace(/&/g, '&amp;')), `card ${req.name}: the menu lacks "${bit}"`);
  must((tpl.match(/class="qtopt best"/g) || []).length === 3, `card ${req.name}: not 3 best texts`);
  must(tpl.includes(`Hi ${first}! \n— Valerie at Porch &amp; Party`), `card ${req.name}: blank text not filled with the first name`);
  must(!/sms:[^"]*body=/.test(tpl), `card ${req.name}: the menu carries a ready-made sms: body (it must be built at tap time)`);
}
must(menus >= 2, `only ${menus} cards with a menu checked`);

// ---- 7. Open in Messages logs "Texted: <title>" ---------------------------------------------
const req = s.requests.find((r) => String(r.phone || '').replace(/\D/g, '').length >= 7);
const key = req.key;
const count = async () => (await s.one("SELECT COUNT(*) AS n FROM request_events WHERE request_key = ?1 AND what LIKE 'Texted:%'", key)).n;
const before = await count();
await s.post('/admin/msg/tapped', { r: s.rk(key), quick: 'ret' }, { headers: { 'X-Pnp-Fetch': '1' } });
const ev = await s.one("SELECT what, who FROM request_events WHERE request_key = ?1 AND what LIKE 'Texted:%' ORDER BY id DESC", key);
must(ev && ev.what === 'Texted: Set return (drop-off) time' && ev.who === 'Valerie', `the tap logged ${JSON.stringify(ev)}`);
must((await count()) === before + 1, 'the tap did not log exactly one line');
await s.post('/admin/msg/tapped', { r: s.rk(key), quick: 'blank' }, { headers: { 'X-Pnp-Fetch': '1' } });
must((await s.one("SELECT what FROM request_events WHERE request_key = ?1 ORDER BY id DESC", key)).what === 'Texted: Blank text', 'the blank text is not logged "Texted: Blank text"');
const n2 = await count();
await s.post('/admin/msg/tapped', { r: s.rk(key), quick: 'nope<script>' }, { headers: { 'X-Pnp-Fetch': '1' } });
must((await count()) === n2, 'an unknown quick text logged a line');
await s.post('/admin/msg/tapped', { r: s.rk(key), quick: 'conf' }, { headers: { 'X-Pnp-Fetch': '1' } });
const c1 = (await s.one('SELECT confirmed_texted_at AS t FROM requests WHERE request_key = ?1', key)).t;
must(Boolean(c1), "It's confirmed from the menu does not tick the confirmation-texted column");
await s.post('/admin/msg/tapped', { r: s.rk(key), quick: 'conf' }, { headers: { 'X-Pnp-Fetch': '1' } });
must((await s.one('SELECT confirmed_texted_at AS t FROM requests WHERE request_key = ?1', key)).t === c1, 'a second tap moved the confirmation-texted time');
const page = await s.get('/admin/');
must(page.text.includes('Texted: Set return (drop-off) time'), 'the card history does not show "Texted: <title>"');
// The older message taps still work as before.
await s.post('/admin/msg/tapped', { r: s.rk(key), template: 'thankyou' }, { headers: { 'X-Pnp-Fetch': '1' } });
must(Boolean((await s.one('SELECT thankyou_texted_at AS t FROM requests WHERE request_key = ?1', key)).t), 'the old thank-you tap stopped ticking its column');

if (checks < 60) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) {
  console.error(`VALIDATION FAIL: admin quick texts (${errors.length})`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`admin quick texts: OK (${checks} checks: approved words + sign-off, "__" when missing, options per job type, best 3 per step, sms: body from the box, menus on cards with a phone, "Texted: <title>" logged)`);
