#!/usr/bin/env node
/**
 * Missed jobs (owner-approved mock-up, panel 7, 20 Oct 2026; functions/_lib/missed.mjs). Before
 * this, a booking not marked done vanished from the 7 AM email the next day; only a late rental
 * return was caught, quietly, under Money.
 *  1. Detection per kind: any live booking before today that is not done and not Not needed
 *     (setup / install: job done on the card; pickup: picked up or games back; return: checked in;
 *     takedown / grazing pickup: done or Not needed; other: done). Today / later never; put away,
 *     void, test and void-invoice bookings never. Oldest first. Clears when done / moved / not needed.
 *  2. Email: subject "⚠ N missed job(s) · " + the usual subject; the red "⚠ MISSED · CALL THEM
 *     FIRST" box above section 1 (HTML + plain text), each "<who> · <job>", "Was due <day> · N
 *     day(s) late · not marked done", solid "📞 Call now" (tel:), Text (sms:), Open card; a late
 *     return is in the box and never in Money; never "All clear today" while anything is missed;
 *     sections still numbered 1.. with no gap; no phone number outside a tel:/sms: link.
 *  3. /admin Requests: ONE thin red strip on top (one missed: one line; several: a <details> of
 *     thin rows, oldest first) with Call and Card ↓ (#c-<key>); the old Overdue returns box is not
 *     shown too. The card does not move: red border, "⚠ MISSED · N day(s) late", next step "Call
 *     <first name> and set a new <job> day" with Pick a new day, Mark done (it happened), Not needed.
 *  4. ✕ hides the strip until the next Memphis day on every device (a settings row), never the
 *     card tag or the email; a job missed after the ✕ shows the strip again.
 *  5. Calendar: a missed booking's chip is red on its day.
 * Rule 0: fewer than 60 checks is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const MS = await mod('functions/_lib/missed.mjs');
const T = await mod('functions/_lib/todo-email.mjs');
const { chicagoDate, dayWords } = await mod('functions/_lib/reminders.mjs');
const { addDays } = await mod('functions/_lib/calendar.mjs');
const { b64urlText } = await mod('functions/_lib/util.mjs');
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

// ---- 1. detection per kind (pure) ----------------------------------------------------------------
{
  const today = '2026-10-21';
  const B = (id, kind, date, extra = {}) => ({ id, kind, date, time: null, done_at: null, request_key: null, customer_name: `Person${id} Last`, phone: '', ...extra });
  const bookings = [
    B(1, 'party_takedown', '2026-10-20', { request_key: 'k1' }),
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
  const reqBy = { k8: { request_key: 'k8', takedown_plan: 'customer_handles', name: 'Gina Grazer' }, k14: { request_key: 'k14', takedown_plan: 'scheduled', name: 'Pia Porch' } };
  const returns = { k5: { returned_at: '2026-10-19 18:00:00' }, k7: { returned_at: '2026-10-20 18:00:00' } };
  const m = MS.missedFrom({ bookings, returns, today, statuses, reqBy });
  const ids = m.map((x) => x.id);
  must(JSON.stringify(ids) === JSON.stringify([15, 14, 13, 10, 4, 2, 1, 6]), `missed ids (oldest first) are ${JSON.stringify(ids)}`);
  must(ids.includes(1), 'a party takedown before today not marked done is not missed');
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

// ---- 2. the email --------------------------------------------------------------------------------
{
  const s = await session();
  const db = s.db;
  for (const r of s.requests) await db.prepare("INSERT INTO request_status (request_key, status, archived_at) VALUES (?1, 'new', datetime('now')) ON CONFLICT(request_key) DO UPDATE SET archived_at = datetime('now')").bind(r.key).run();
  await db.prepare('DELETE FROM bookings').run();
  const TODAY = '2026-10-21';
  const NOW = Date.parse(`${TODAY}T12:00:00Z`);
  // Quiet day with ONE missed job: never "All clear today".
  await db.prepare("INSERT INTO bookings (kind, date, time, customer_name, phone) VALUES ('party_takedown', '2026-10-20', '10:00', 'Ali Hassan', '901-555-0301')").run();
  let d = await T.todoData(db, TODAY, NOW);
  let msg = T.renderTodo(d);
  must(d.missed.length === 1 && !T.isAllClear(d), 'one missed job on a quiet day still counts as All clear');
  must(msg.subject === '⚠ 1 missed job · Your to-do list for Wed 21 Oct · Porch & Party', `the one-missed subject is "${msg.subject}"`);
  must(!/All clear today/.test(msg.html) && !/All clear today/.test(msg.text) && !/data-all-clear/.test(msg.html), 'the email says All clear today while a job is missed');
  must(/data-missed[\s\S]*⚠ MISSED · CALL THEM FIRST[\s\S]*Ali H\. · party takedown[\s\S]*Was due Tue 20 Oct · 1 day late · not marked done/.test(msg.html), 'the red box lacks the title / the job / its late line');
  must(/<h1[\s\S]*<\/h1>[\s\S]*data-missed/.test(msg.html) && (msg.html.indexOf('data-missed') < msg.html.indexOf('data-tomorrow')), 'the red box is not at the top, above the sections');
  must(msg.text.includes('⚠ MISSED · CALL THEM FIRST\n- Ali H. · party takedown (Was due Tue 20 Oct · 1 day late · not marked done): https://porchandparty901.com/admin/day/2026-10-20'), `the plain text lacks the missed block: ${msg.text}`);
  const it = d.missed[0];
  must(it.btns.map((b) => b.label).join() === '📞 Call now,Text,Open card' && it.btns[0].solid && it.btns[0].href === 'tel:9015550301' && it.btns[1].href === 'sms:9015550301' && it.btns[2].href === '/admin/day/2026-10-20', `the missed buttons are ${JSON.stringify(it.btns)}`);
  must(/background:#b42318;color:#ffffff;[^"]*"[^>]*>📞 Call now</.test(msg.html.replace(/href="[^"]*" /g, '')) || /href="tel:9015550301" style="[^"]*background:#b42318;color:#ffffff;/.test(msg.html), 'Call now is not a solid red button');
  must(!msg.text.replace(/\D/g, ' ').includes('5550301') && !msg.html.replace(/href="[^"]*"/g, '').includes('555-0301') && !/Hassan/.test(msg.html + msg.text), 'the missed box shows a phone number or the full surname');
  // Several, oldest first; a late return in the box and never in Money; numbering 1.. with no gap.
  await db.prepare("INSERT INTO bookings (kind, date, time, customer_name, phone, items) VALUES ('rental_return', '2026-10-18', NULL, 'Tamaira Tee', '901-555-0302', 'Giant Uno'), ('porch_install', ?1, '09:00', 'Ivy Today', '', '')").bind(TODAY).run();
  d = await T.todoData(db, TODAY, NOW);
  msg = T.renderTodo(d);
  must(JSON.stringify(d.missed.map((x) => x.t)) === JSON.stringify(['Tamaira T. · games not returned', 'Ali H. · party takedown']), `missed in the email: ${JSON.stringify(d.missed.map((x) => x.t))}`);
  must(d.missed[0].d === 'Was due Sun 18 Oct · 3 days late · not marked done', `the return late line is "${d.missed[0].d}"`);
  must(!d.sections[5].some((x) => /Tamaira/.test(x.t)) && (msg.html.match(/Tamaira T\./g) || []).length === 1 && (msg.text.match(/Tamaira T\./g) || []).length === 1, 'the late return is listed twice (Missed and Money)');
  must(msg.subject === '⚠ 2 missed jobs · Your to-do list for Wed 21 Oct · Porch & Party', `the two-missed subject is "${msg.subject}"`);
  const nums = [...msg.html.matchAll(/data-section="(\d)" data-num="(\d)"/g)].map((x) => x[2]);
  must(nums.length >= 1 && nums.every((n, i) => Number(n) === i + 1) && /\n1\. TODAY'S JOBS\n/.test(msg.text), `section numbers after the box are ${nums} (want 1..N, no gap)`);
  must(msg.text.indexOf('⚠ MISSED · CALL THEM FIRST') < msg.text.indexOf('1. TODAY\'S JOBS'), 'the plain-text box is not above section 1');
  // Clears: marked done / moved to today.
  await db.prepare("UPDATE bookings SET done_at = datetime('now') WHERE customer_name = 'Ali Hassan'").run();
  await db.prepare("UPDATE bookings SET date = ?1 WHERE customer_name = 'Tamaira Tee'").bind(TODAY).run();
  d = await T.todoData(db, TODAY, NOW);
  msg = T.renderTodo(d);
  must(!d.missed.length && !/data-missed|⚠/.test(msg.html) && /^Your to-do list for Wed 21 Oct · Porch & Party$/.test(msg.subject), 'a job marked done / moved to today is still in the missed box or subject');
}

// ---- 3-5. /admin strip, card, dismissal, calendar (real Memphis today) -----------------------------
{
  const s = await session();
  const db = s.db;
  await db.prepare('DELETE FROM bookings').run();
  await db.prepare('DELETE FROM rental_returns').run();
  const today = chicagoDate();
  const y1 = addDays(today, -1);
  const y3 = addDays(today, -3);
  const reqA = s.requests.find((r) => r.email === 'test.renter@example.com');
  const rkA = b64urlText(reqA.key);
  const cardsOrder = (html) => [...html.matchAll(/data-card="([^"]+)"/g)].map((x) => x[1]);
  const before = cardsOrder((await s.get('/admin/')).text);
  must(before.includes(rkA), 'the fixture request has no card on /admin');
  // The card may already have booked its takedown from the request's answers: that booking, moved to yesterday.
  await db.prepare(`INSERT INTO bookings (kind, date, time, customer_name, phone, request_key) VALUES ('party_takedown', ?1, NULL, ?2, '901-555-0401', ?3)
    ON CONFLICT(request_key, kind) DO UPDATE SET date = excluded.date, time = NULL, phone = excluded.phone, done_at = NULL`).bind(y1, reqA.name, reqA.key).run();
  const idA = (await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind = 'party_takedown'", reqA.key)).id;
  must((await s.all('SELECT id FROM bookings WHERE date < ?1', today)).length === 1, 'the /admin scenario has another booking before today');
  let html = (await s.get('/admin/')).text;
  const who = MS.missedFrom({ bookings: [{ id: idA, kind: 'party_takedown', date: y1, customer_name: reqA.name }], today })[0].who;
  const first = String(reqA.name).split(/\s+/)[0];
  must((html.match(/data-missed-strip/g) || []).length === 1 && /class="mstrip1"[^>]*data-missed-count="1"/.test(html), 'one missed job does not give ONE single-line strip');
  must(html.includes(`⚠ <b>Missed:</b> ${who} takedown, ${dayWords(y1)}</span>`), `the single strip does not read "⚠ Missed: ${who} takedown, ${dayWords(y1)}"`);
  must(new RegExp(`data-missed-strip[\\s\\S]*?<a href="tel:9015550401"[^>]*>Call</a><a href="#c-${rkA}" data-missed-card[^>]*>Card ↓</a><form method="post" action="/admin/missed/dismiss"[^>]*><input type="hidden" name="ids" value="${idA}"><button type="submit" class="sx"`).test(html), 'the strip lacks Call, Card ↓ (#c-<key>) and ✕');
  must(html.indexOf('data-missed-strip') < html.indexOf('<h1>Requests</h1>'), 'the strip is not at the top of Requests');
  must(/\.mstrip1[^{]*\{[^}]*min-height:40px/.test(html) && !/class="mstrip1 card|class="card[^"]*mstrip/.test(html), 'the strip is not a thin ~40px line (or is a card)');
  must(JSON.stringify(cardsOrder(html)) === JSON.stringify(before), 'a missed job moved the card');
  const cardOf = (h) => { const i = h.indexOf(`id="c-${rkA}"`); return i < 0 ? '' : h.slice(h.lastIndexOf('<article', i), h.indexOf('</article>', i)); };
  let card = cardOf(html);
  must(/class="card stepcard miss"/.test(card) && new RegExp(`data-missed="${idA}"`).test(card), 'the missed card has no red border class');
  must(card.includes('<span class="mchip" data-missed-tag>⚠ MISSED · 1 day late</span>'), 'the card lacks the "⚠ MISSED · 1 day late" tag');
  must(card.includes(`>Call ${first} and set a new takedown day</p>`) && /data-next-step="missed"[\s\S]*Next step · overdue/.test(card), 'the next step is not "Call <first> and set a new takedown day"');
  must(new RegExp(`href="/admin/calendar/bookings/${idA}/edit" data-missed-new-day[^>]*>Pick a new day</a>`).test(card), 'Pick a new day does not open the booking edit page');
  must(new RegExp(`<form method="post" action="/admin/calendar/bookings/${idA}/done" data-missed-done>[\\s\\S]*?Mark done \\(it happened\\)</button>`).test(card), 'Mark done (it happened) does not post the booking done route');
  must(/action="\/admin\/requests\/takedown"><input type="hidden" name="r" value="[^"]+"><input type="hidden" name="plan" value="customer_handles">[\s\S]*?>Not needed</.test(card.split('data-next-step="missed"')[1] || ''), 'the missed takedown has no Not needed');
  must((await s.get(`/admin/calendar/bookings/${idA}/edit`)).status === 200, 'the Pick a new day page does not open');
  // Several: a <details> of thin rows, oldest first; no-request Card ↓ = the Day sheet; no Overdue returns box too.
  const insB = await db.prepare("INSERT INTO bookings (kind, date, time, customer_name, phone, items) VALUES ('rental_return', ?1, NULL, 'Tamaira Tee', '901-555-0402', 'Giant Uno')").bind(y3).run();
  const idB = insB.meta.last_row_id;
  html = (await s.get('/admin/')).text;
  must(/<details class="mstrip"[^>]*data-missed-count="2"><summary[^>]*><span class="st">⚠ <b>2 missed jobs<\/b><\/span><span class="see">See them ▾<\/span>/.test(html), 'two missed jobs are not "⚠ 2 missed jobs · See them ▾"');
  const rows = [...html.matchAll(/data-missed-row="(\d+)"><span class="st">([^<]*)<\/span>/g)].map((x) => [Number(x[1]), x[2]]);
  must(JSON.stringify(rows) === JSON.stringify([[idB, `Tamaira T. · games not back · ${dayWords(y3)}`], [idA, `${who} · takedown · ${dayWords(y1)}`]]), `the strip rows are ${JSON.stringify(rows)}`);
  must(html.includes(`<a href="/admin/day/${y3}" data-missed-card`) && html.includes(`<a href="#c-${rkA}" data-missed-card`), 'Card ↓ does not go to the card (or the Day sheet with no request)');
  must(!/data-overdue-box/.test(html) && (html.match(/Tamaira/g) || []).length === 1, 'the late return shows twice on Requests (strip and the old Overdue returns box)');
  must(/name="ids" value="(\d+,\d+)"/.test(html) && html.match(/name="ids" value="([\d,]+)"/)[1] === `${idB},${idA}`, 'the ✕ does not carry every shown job');
  // ✕: hidden until tomorrow morning, on every device (server-side), never the card tag or email.
  const r = await s.post('/admin/missed/dismiss', { ids: `${idB},${idA}` });
  must(r.status === 303 && /\/admin\/\?m=/.test(r.location), `the ✕ did not redirect back: ${r.status} ${r.location}`);
  const row = await s.one("SELECT value FROM settings WHERE key = 'missed_strip_dismissed'");
  must(row && JSON.stringify(JSON.parse(row.value)) === JSON.stringify({ day: today, ids: [idB, idA] }), `the dismissal is not stored server-side for today: ${row && row.value}`);
  html = (await s.get('/admin/')).text;
  must(!/data-missed-strip/.test(html), 'the strip still shows after ✕');
  must(cardOf(html).includes('data-missed-tag'), 'the ✕ hid the card tag');
  must((await T.todoData(db, today, Date.now())).missed.length === 2, 'the ✕ hid the jobs from the email');
  await db.prepare("UPDATE settings SET value = ?1 WHERE key = 'missed_strip_dismissed'").bind(JSON.stringify({ day: y1, ids: [idB, idA] })).run();
  must(/data-missed-strip/.test((await s.get('/admin/')).text), 'a ✕ from yesterday still hides the strip this morning');
  await s.post('/admin/missed/dismiss', { ids: `${idB},${idA}` });
  const insC = await db.prepare("INSERT INTO bookings (kind, date, time, customer_name, phone) VALUES ('porch_install', ?1, '09:00', 'Nia Newmiss', '')").bind(y1).run();
  html = (await s.get('/admin/')).text;
  must(/data-missed-count="3"/.test(html) && html.includes(`data-missed-row="${insC.meta.last_row_id}"`), 'a job missed after the ✕ does not show the strip again');
  // Calendar: the missed chip is red on its day; a booking not missed is not.
  await db.prepare("INSERT INTO bookings (kind, date, time, customer_name) VALUES ('party_setup', ?1, '11:00', 'Fran Future')").bind(addDays(today, 2)).run();
  const cal = (await s.get(`/admin/calendar?month=${y1.slice(0, 7)}`)).text;
  must(new RegExp(`class="k party_takedown[^"]* missed" data-missed-chip draggable="true" data-drag data-booking="${idA}"`).test(cal), 'the missed takedown chip is not red on the calendar');
  must(new RegExp(`class="k party_takedown[^"]* missed" data-missed-chip data-list-booking="${idA}"`).test(cal), 'the missed takedown is not red in the phone day list');
  must(/\.k\.missed\{background:#c0392b/.test(cal), 'the calendar has no red style for a missed chip');
  const futureId = (await s.one("SELECT id FROM bookings WHERE customer_name = 'Fran Future'")).id;
  if (addDays(today, 2).slice(0, 7) === y1.slice(0, 7)) must(!new RegExp(`missed" data-missed-chip draggable="true" data-drag data-booking="${futureId}"`).test(cal), 'a future booking is red on the calendar');
  else must(true, 'month boundary');
  // Clears by itself: Mark done (it happened) -> no tag, no row.
  const done = await s.post(`/admin/calendar/bookings/${idA}/done`, { r: rkA });
  must(done.status === 303, 'Mark done (it happened) failed');
  html = (await s.get('/admin/')).text;
  must(!cardOf(html).includes('data-missed-tag') && !cardOf(html).includes('class="card stepcard miss"') && !html.includes(`data-missed-row="${idA}"`), 'a job marked done still shows MISSED');
  // An "other" booking is marked done through the same route.
  const insO = await db.prepare("INSERT INTO bookings (kind, date, customer_name) VALUES ('other', ?1, 'Oscar Other')").bind(y1).run();
  await s.post(`/admin/calendar/bookings/${insO.meta.last_row_id}/done`, {});
  must(Boolean((await s.one('SELECT done_at FROM bookings WHERE id = ?1', insO.meta.last_row_id)).done_at), 'an "other" booking cannot be marked done');
}

if (checks < 60) errors.push(`only ${checks} checks ran (Rule 0: at least 60)`);
if (errors.length) {
  console.error(`VALIDATION FAIL: missed jobs (${errors.length} of ${checks})`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`VALIDATION PASS: missed jobs (${checks} checks)`);
