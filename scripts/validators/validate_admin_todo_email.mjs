#!/usr/bin/env node
/**
 * Valerie's daily 7 AM to-do email (owner-approved mock, 19 Oct 2026; functions/_lib/todo-email.mjs).
 *  1. Timing: only the hourly cron run that is 7 AM America/Chicago sends (12:00 UTC in daylight
 *     time, 13:00 UTC in standard time), every day of the week.
 *  2. Each section's inclusion rules, its order inside, the highlight thresholds (call back 2+ days,
 *     no time within 2 days), sections shown only when non-empty and always in the order 1-5, each
 *     with its "why" sentence from the mock.
 *  3. Money: due today or late only; the refundable damage deposit is never owed; every unpaid
 *     rental hold is "Waiting for deposit · Games reserved until <time>" with the invoice's amount due
 *     and "Reserve their games longer" (never "Hold longer") as its link.
 *  2b. The sections SHOWN are numbered 1, 2, 3 ... with no gap (owner, 20 Oct 2026): an empty
 *     middle section does not leave 1, 2, 3, 5 in the HTML marks or the plain text.
 *  3a. A job TODAY with no time appears ONCE (owner, 20 Oct 2026): in Today's jobs with the
 *     set-time prompt "No time yet · Text them to pick one" on its own line and Call / Text (sms:),
 *     never in Set a time; Set a time is tomorrow onward; an unconfirmed job today gets no prompt.
 *  3b. Set a time is CONFIRMED jobs only (owner, 20 Oct 2026): an invoiced-unpaid held rental is
 *     NOT in it (it is in Money); a deposit-paid rental with no time IS; an unconfirmed party job
 *     is not, the same job after "Yes, book it" is.
 *  4. All clear: nothing in 1-5 and nothing tomorrow -> only "All clear today", subject unchanged.
 *  5. Monday: ONE email (the to-do list + Your week); the old separate weekly email is never sent;
 *     the weekly_summary switch decides whether Your week is in it.
 *  6. Idempotent per Memphis day; a failed send releases the claim; off switch; Send now.
 *  7. No PII: first name + last initial; a phone only inside tel:/sms: links; no email address.
 * Rule 0: fewer than 60 checks is a failure.
 */
import fs from 'node:fs';
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const T = await mod('functions/_lib/todo-email.mjs');
const mailer = await mod('workers/pnp-mailer/src/index.js');
const { b64urlText } = await mod('functions/_lib/util.mjs');
const { markCalled, undoCalled } = await mod('functions/_lib/steps.mjs');
const { confirmHold } = await mod('functions/_lib/holds.mjs');
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const titles = (sec) => sec.map((x) => x.t);
const card = (key) => `/admin/#c-${b64urlText(key)}`;

// ---- 1. timing -------------------------------------------------------------------------------
must(T.isTodoHour(new Date('2026-10-20T12:00:00Z')), 'Tue 12:00 UTC in daylight time (7 AM Memphis) is not the to-do hour');
must(!T.isTodoHour(new Date('2026-10-20T13:00:00Z')), 'Tue 13:00 UTC in daylight time (8 AM Memphis) is the to-do hour');
must(T.isTodoHour(new Date('2026-11-03T13:00:00Z')), 'Tue 13:00 UTC in standard time (7 AM Memphis) is not the to-do hour');
must(!T.isTodoHour(new Date('2026-11-03T12:00:00Z')), 'Tue 12:00 UTC in standard time (6 AM Memphis) is the to-do hour');
must(['2026-10-18', '2026-10-19', '2026-10-21', '2026-10-24'].every((d) => T.isTodoHour(new Date(`${d}T12:00:00Z`))), 'the to-do hour is not every day');
const toml = fs.readFileSync(new URL('../../workers/pnp-mailer/wrangler.toml', import.meta.url), 'utf8');
must(/crons = \["0 \* \* \* \*"\]/.test(toml) && /daily to-do email[\s\S]{0,120}7 AM America\/Chicago:\s*\n#\s*12:00 UTC \(CDT\) or 13:00 UTC \(CST\)/.test(toml), 'wrangler.toml does not keep the hourly cron with the 7 AM UTC mapping documented');

// ---- a busy Tuesday, 20 Oct 2026 ---------------------------------------------------------------
const s = await session();
const db = s.db;
const TODAY = '2026-10-20';
const NOW = Date.parse(`${TODAY}T12:00:00Z`);
const reqA = s.requests.find((r) => r.email === 'test.renter@example.com');   // in 14 Oct, party + rentals
const reqB = s.requests.find((r) => r.email === 'weekend.renter@example.com'); // in 12 Oct, rentals
const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
// Hand-typed customers (no request) with full names and phones that must never show.
await run(`INSERT INTO invoices (number, customer_name, customer_phone, customer_email, issue_date, due_date, status) VALUES
  ('PNP-T-1', 'Alex Smithfield', '901-555-0201', 'alex@example.com', '2026-10-01', '2026-10-20', 'sent'),
  ('PNP-T-2', 'Sam Returnson', '901-555-0202', 'sam@example.com', '2026-10-01', '2026-10-15', 'sent'),
  ('PNP-T-3', 'Dee Depositonly', '901-555-0203', 'dee@example.com', '2026-10-01', '2026-10-10', 'sent'),
  ('PNP-T-4', 'Fay Futuredue', '901-555-0204', 'fay@example.com', '2026-10-01', '2026-10-21', 'sent'),
  ('PNP-T-5', 'Lou Latepayer', '901-555-0205', 'lou@example.com', '2026-10-01', '2026-10-17', 'sent')`);
const inv = Object.fromEntries((await s.all("SELECT id, number FROM invoices WHERE number LIKE 'PNP-T-%'")).map((r) => [r.number, r.id]));
await db.prepare(`INSERT INTO invoice_lines (invoice_id, description, qty, unit_cents, refundable) VALUES
  (?1, 'Party takedown', 1, 18000, 0),
  (?2, 'Movie Night bundle', 1, 11000, 0), (?2, 'Refundable damage deposit', 1, 5000, 1),
  (?3, 'Pick 3 bundle', 1, 11000, 0), (?3, 'Refundable damage deposit', 1, 5000, 1),
  (?4, 'Porch package', 1, 30000, 0),
  (?5, 'Grazing table', 1, 9000, 0)`).bind(inv['PNP-T-1'], inv['PNP-T-2'], inv['PNP-T-3'], inv['PNP-T-4'], inv['PNP-T-5']).run();
// Sam paid everything incl. the deposit; Dee paid the charges but not the deposit (deposit only "owed").
await run("INSERT INTO payments (invoice_id, amount_cents, received_on, method, note, kind) VALUES (?1, 16000, '2026-10-12', 'zelle', '', 'payment'), (?2, 11000, '2026-10-05', 'zelle', '', 'payment')", inv['PNP-T-2'], inv['PNP-T-3']);
await db.prepare(`INSERT INTO bookings (kind, date, time, customer_name, phone, place, items, invoice_id) VALUES
  ('party_takedown', ?1, '10:00', 'Alex Smithfield', '901-555-0201', 'Germantown', 'the ladder and 2 bins', ?2),
  ('porch_install', ?1, '13:00', 'Ivy Installer', '901-555-0213', 'Bartlett', 'fall urns', NULL),
  ('rental_return', ?1, '17:00', 'Sam Returnson', '901-555-0202', '', 'Giant Uno, Grab the Mic', ?3),
  ('porch_install', ?1, NULL, 'Una Untimed', '901-555-0206', 'Cordova', '', NULL),
  ('party_setup', ?1, '08:30', 'Don Donealready', '901-555-0207', '', '', NULL),
  ('rental_pickup', '2026-10-22', NULL, 'Danesha Moorehead', '901-555-0208', '', 'Giant Uno', NULL),
  ('porch_takedown', '2026-10-23', NULL, 'Kim Porcher', '901-555-0209', '', '', NULL),
  ('grazing_setup', '2026-10-21', '15:00', 'Tia Tomorrowby', '901-555-0210', '', '', NULL),
  ('rental_pickup', '2026-10-19', NULL, 'Pat Pastday', '901-555-0211', '', '', NULL),
  ('rental_return', '2026-10-18', NULL, 'Ollie Overdue', '901-555-0212', '', 'Cornhole set', NULL)`).bind(TODAY, inv['PNP-T-1'], inv['PNP-T-2']).run();
await run("UPDATE bookings SET done_at = datetime('now') WHERE customer_name = 'Don Donealready'");
// A hold ending today (3 PM Memphis = 20:00 UTC) on reqB, and one ending tomorrow (must not show).
await run("INSERT INTO holds (request_key, state, until, by_hand) VALUES (?1, 'held', '2026-10-20 20:00:00', 0)", reqB.key);

let d = await T.todoData(db, TODAY, NOW);
const S = d.sections;
// 1. Today's jobs: by time, open only, place / bring / collect / deposit back, card or day link.
must((S[1].find((x) => /Ivy I/.test(x.t)) || {}).d === 'Bartlett · bring fall urns', 'an install does not say what to bring');
must(JSON.stringify(titles(S[1])) === JSON.stringify(['10 AM · Alex S. · party takedown', '1 PM · Ivy I. · porch install', '5 PM · Sam R. · games return', 'time not set · Una U. · porch install']), `Today's jobs are ${JSON.stringify(titles(S[1]))}`);
must(S[1][0].d === 'Germantown · load the ladder and 2 bins · collect $180', `the takedown line is "${S[1][0].d}" (place, what to bring, what to collect)`);
must((S[1].find((x) => /Sam R/.test(x.t)) || {}).d === 'Mt. Moriah Station · Giant Uno, Grab the Mic · give back $50 deposit', `the return line is "${(S[1].find((x) => /Sam R/.test(x.t)) || {}).d}" (place, games, deposit to give back)`);
must(!titles(S[1]).some((t) => /Don D/.test(t)), 'a job already marked done is in Today\'s jobs');
must(S[1].every((x) => x.btns.some((b) => b.label === 'Open card' && b.href.startsWith('/admin/'))), 'a job has no Open card link into /admin');
// 2. Call these people back: oldest first, words, highlight.
must(JSON.stringify(S[2].map((x) => x.key)) === JSON.stringify([reqB.key, reqA.key]), 'Call these people back is not oldest first');
must(S[2][0].d === 'Waiting 8 days' && S[2][0].hi && S[2][1].d === 'Waiting 6 days', `call-back words: ${S[2].map((x) => x.d)}`);
must(S[2].every((x) => x.btns.map((b) => b.label).join() === 'Call,Text,Open card' && /^tel:\d+$/.test(x.btns[0].href) && /^sms:\d+$/.test(x.btns[1].href) && x.btns[2].href === card(x.key)), 'a call back lacks Call (tel:), Text (sms:) and Open card');
for (const [day, words, hi] of [['2026-10-14', 'Waiting 2 days', true], ['2026-10-13', 'Waiting since yesterday', false], ['2026-10-12', 'Came in today', false]]) {
  const x = (await T.todoData(db, day, Date.parse(`${day}T12:00:00Z`))).sections[2].find((c) => c.key === reqB.key);
  must(x && x.d === words && x.hi === hi, `on ${day} the 12 Oct request reads ${x && x.d} / highlight ${x && x.hi} (want ${words} / ${hi})`);
}
must(T.CALLBACK_HIGHLIGHT_DAYS === 2 && T.SET_TIME_HIGHLIGHT_DAYS === 2, 'the highlight thresholds are not 2 days');
// 3. Set a time: every CONFIRMED open booking from TOMORROW on with no time, soonest first, highlight
// within 2 days (Una's porch install today is asked in Today's jobs instead, see 3a). Hand-typed bookings (no request) are Valerie's own, so confirmed. reqA is not
// confirmed (not called, no "Yes, book it", no money), so its party takedown Sun 25 Oct is NOT here.
must(JSON.stringify(titles(S[3])) === JSON.stringify(['Danesha M. · games pickup Thu 22 Oct', 'Kim P. · porch takedown Fri 23 Oct']), `Set a time is ${JSON.stringify(titles(S[3]))}`);
must(S[3].every((x) => x.date > TODAY), 'Set a time lists a job dated today');
must(!S[3].some((x) => x.key === reqA.key), 'Set a time asks an UNCONFIRMED party request for a time');
must(!titles(S[3]).some((t) => /Pat P|Ollie O|Alex S|Tia T|Una U/.test(t)), 'Set a time lists a past day, today, or a booking that has a time');
const hiOf = (re) => (S[3].find((x) => re.test(x.t)) || {}).hi;
must(hiOf(/Danesha M/) === true && hiOf(/Kim P/) === false, 'Set a time highlight is not "within 2 days"');
const sms = (S[3].find((x) => /Danesha/.test(x.t)) || { btns: [] }).btns.find((b) => b.label === 'Text');
must(sms && decodeURIComponent(sms.href.split('body=')[1] || '') === "Hi Danesha, it's Porch & Party. What time works for your games pickup on Thu 22 Oct?", `the Set a time text is "${sms && decodeURIComponent(sms.href.split('body=')[1] || '')}"`);
// ---- 3a. a job TODAY with no time: once, in Today's jobs with the prompt (owner, 20 Oct 2026) -----
{
  const una = S[1].filter((x) => /Una U/.test(x.t));
  must(una.length === 1 && una[0].t === 'time not set · Una U. · porch install' && una[0].p === T.TODAY_SET_TIME_PROMPT && T.TODAY_SET_TIME_PROMPT === 'No time yet · Text them to pick one', `today's untimed job lacks the set-time prompt: ${JSON.stringify(una)}`);
  must(una[0].btns.map((b) => b.label).join() === 'Call,Text,Open card' && /^tel:\d+$/.test(una[0].btns[0].href) && /^sms:/.test(una[0].btns[1].href)
    && decodeURIComponent(una[0].btns[1].href.split('body=')[1] || '') === "Hi Una, it's Porch & Party. What time works for your porch install on Tue 20 Oct?", `today's untimed job lacks Call / Text (prefilled): ${JSON.stringify(una[0].btns)}`);
  must(S[1].filter((x) => x.p).length === 1 && S[1].filter((x) => !/^time not set/.test(x.t)).every((x) => !x.p && !x.btns.some((b) => /^(tel|sms):/.test(b.href))), 'a job with a time carries the set-time prompt');
  const ids1 = new Set(S[1].map((x) => x.id));
  must(!S[3].some((x) => ids1.has(x.id)), 'a job appears in both Today\'s jobs and Set a time');
  const um = T.renderTodo(d);
  must((um.html.match(/No time yet · Text them to pick one/g) || []).length === 1 && /time not set · Una U\. · porch install<\/div>[\s\S]{0,400}?<div data-set-time[^>]*>No time yet · Text them to pick one<\/div>[\s\S]{0,800}?>Call<\/a>[\s\S]{0,800}?>Text<\/a>/.test(um.html), 'the rendered Today\'s jobs line lacks the prompt on its own line with Call and Text');
  must(/\n- time not set · Una U\. · porch install[^\n]*\n  No time yet · Text them to pick one\n/.test(um.text) && (um.text.match(/Una U\./g) || []).length === 1, 'the plain text does not show Una once, with the prompt under her job');
  // An UNCONFIRMED job today with no time (reqA: not called, no "Yes, book it", no money) is in
  // Today's jobs as "time not set" but never gets the prompt (#100).
  const tmp = await run("INSERT INTO bookings (kind, date, time, customer_name, request_key) VALUES ('party_setup', ?1, NULL, 'Test Renter', ?2)", TODAY, reqA.key);
  const ud = await T.todoData(db, TODAY, NOW);
  const un = ud.sections[1].find((x) => x.key === reqA.key);
  must(un && /^time not set · /.test(un.t) && !un.p && !un.btns.some((b) => /^(tel|sms):/.test(b.href)) && !ud.sections[3].some((x) => x.key === reqA.key && x.date === TODAY), `an UNCONFIRMED job today gets the set-time prompt: ${JSON.stringify(un)}`);
  await run('DELETE FROM bookings WHERE id = ?1', tmp.meta.last_row_id);
  // A FUTURE job with no time is in Set a time, not Today's jobs.
  must(S[3].some((x) => /Danesha M/.test(x.t) && x.d === 'No time yet') && !S[1].some((x) => /Danesha M/.test(x.t)), 'a future job with no time is not in Set a time');
  // The 20 Oct shape: today's jobs (both untimed, both prompted), call backs, money; no Set a time,
  // numbered 1, 2, 3 with no gap.
  const oct20 = T.renderTodo({ ...d, sections: { 1: [{ ...una[0], t: 'time not set · Ali H. · party takedown' }, { ...una[0], t: 'time not set · Tamaira T. · games return' }], 2: d.sections[2].slice(0, 1), 3: [], 4: [], 5: d.sections[5].slice(0, 1) } });
  const m20 = [...oct20.html.matchAll(/data-section="(\d)" data-num="(\d)"><div[^>]*><span[^>]*>(\d)<\/span>/g)].map((x) => `${x[1]}:${x[2]}:${x[3]}`);
  must(m20.join() === '1:1:1,2:2:2,5:3:3' && /\n1\. TODAY'S JOBS\n[\s\S]*\n2\. CALL THESE PEOPLE BACK\n[\s\S]*\n3\. MONEY\n/.test(oct20.text) && !/SET A TIME/.test(oct20.text) && (oct20.text.match(/No time yet · Text them to pick one/g) || []).length === 2, `the 20 Oct shape renders ${m20} (want Today's jobs 1, Call back 2, Money 3, no Set a time)`);
}

// 5. Money.
const m5 = S[5];
must(m5.some((x) => x.type === 'owed' && x.t === 'Alex S. · $180 due' && x.d === 'Due today, at the takedown'), `Money lacks "Alex S. · $180 due / Due today, at the takedown": ${JSON.stringify(titles(m5))}`);
must(m5.some((x) => x.type === 'owed' && x.t === 'Lou L. · $90 due' && /3 days late/.test(x.d)), 'Money lacks the late balance');
must(!m5.some((x) => /Fay F/.test(x.t)), 'Money lists a balance due tomorrow');
must(!m5.some((x) => /Dee D|Sam R/.test(x.t)), 'Money lists a damage deposit as owed (deposits are never owed)');
const owedRow = m5.find((x) => /Alex S/.test(x.t));
must(owedRow && owedRow.btns.some((b) => b.label === 'Text a reminder' && /^sms:/.test(b.href)) && owedRow.btns.some((b) => b.label === 'Mark paid' && b.href === `/admin/invoices/${inv['PNP-T-1']}`), 'the owed line lacks Text a reminder / Mark paid');
must(m5.some((x) => x.type === 'hold' && x.t === 'Weekend R. · Waiting for deposit · Games reserved until today 3 PM' && x.d === 'Invoice not sent yet' && x.btns.map((b) => b.label).join() === 'Reserve their games longer,Open card' && x.btns[0].solid && x.btns.every((b) => b.href === card(reqB.key))), `Money lacks the hold ending today: ${JSON.stringify(titles(m5))}`);
// A late return is RED (missed.mjs tiers, owner-approved 20 Oct 2026): a question in the red box
// above section 1, never also in Money. Pat P.'s pickup not ticked is YELLOW: only on Tidy up.
must(!m5.some((x) => x.type === 'overdue' || /Ollie O/.test(x.t)) && d.missed.filter((m) => /Ollie O/.test(m.t)).length === 1
  && d.missed.some((m) => m.t === "Are Ollie O.'s games back?" && m.d === 'Due back Sun 18 Oct · not marked back yet'), `the overdue return is not in the red box exactly once (and out of Money): ${JSON.stringify(d.missed.map((m) => m.t))}`);
must(d.missed.length === 1 && !d.missed.some((m) => /Pat P/.test(m.t)) && JSON.stringify(d.tidy.map((x) => x.t)) === JSON.stringify(["Pat P.'s pickup"]), `Pat P.'s unticked pickup is not ONLY on the Tidy up line: red ${JSON.stringify(d.missed.map((m) => m.t))}, tidy ${JSON.stringify(d.tidy)}`);
{
  // The rendered email with that hold in it: the new words, the new link text, nothing old.
  const hm = T.renderTodo(await T.todoData(db, TODAY, NOW));
  must(/Weekend R\. · Waiting for deposit · Games reserved until today 3 PM<\/div>[\s\S]*?>Reserve their games longer<\/a>/.test(hm.html) && hm.text.includes('- Weekend R. · Waiting for deposit · Games reserved until today 3 PM (Invoice not sent yet): https://porchandparty901.com/admin/')
    && !/Hold longer|[Hh]eld until|held by hand/.test(hm.html) && !/Hold longer|[Hh]eld until|held by hand/.test(hm.text), 'the rendered email still says "Hold longer" / "held until", or the hold line lacks its Reserve their games longer link');
}
must(m5.findIndex((x) => x.type === 'owed') > -1 && m5.findIndex((x) => x.type === 'owed') < m5.findIndex((x) => x.type === 'hold') && m5.every((x) => ['owed', 'hold'].includes(x.type)), 'Money is not balances, then holds (a late return is in Missed, never Money)');
// Every unpaid hold is in Money (owner, 20 Oct 2026), not only one ending today: a later end
// time says its day; a hold kept by hand says so.
await run("UPDATE holds SET until = '2026-10-21 20:00:00' WHERE request_key = ?1", reqB.key);
must((await T.todoData(db, TODAY, NOW)).sections[5].filter((x) => x.type === 'hold' && x.t === 'Weekend R. · Waiting for deposit · Games reserved until Wed 21 Oct 3 PM').length === 1, 'a hold ending tomorrow is not in Money as waiting for deposit (with its day)');
await run("UPDATE holds SET by_hand = 1, until = NULL WHERE request_key = ?1", reqB.key);
must((await T.todoData(db, TODAY, NOW)).sections[5].some((x) => x.type === 'hold' && x.t === 'Weekend R. · Waiting for deposit · Reserved by hand (no end date)'), 'a hold kept by hand is not in Money as waiting for deposit');
await run("UPDATE holds SET until = '2026-10-20 20:00:00', by_hand = 0 WHERE request_key = ?1", reqB.key);

// ---- 3b. Set a time is CONFIRMED jobs only (owner, 20 Oct 2026; the Denisha C. email) ------------
// reqB: games held Fri 30 Oct pickup / Sat 31 Oct return, invoiced $160 ($110 + $50 deposit), NOT
// paid, and even "Yes, book it" ticked: still only a hold, so never asked for a time.
const stBefore = await db.prepare('SELECT * FROM request_status WHERE request_key = ?1').bind(reqB.key).first();
await run("INSERT INTO invoices (number, customer_name, customer_phone, issue_date, due_date, status, request_key) VALUES ('PNP-T-6', 'Weekend Renter', '901-555-0101', '2026-10-19', '2026-10-29', 'sent', ?1)", reqB.key);
const inv6 = (await db.prepare("SELECT id FROM invoices WHERE number = 'PNP-T-6'").first()).id;
await run("INSERT INTO invoice_lines (invoice_id, description, qty, unit_cents, refundable) VALUES (?1, 'Pick 3 bundle', 1, 11000, 0), (?1, 'Refundable damage deposit', 1, 5000, 1)", inv6);
await run("INSERT INTO request_status (request_key, status, invoice_id) VALUES (?1, 'invoiced', ?2) ON CONFLICT(request_key) DO UPDATE SET status = 'invoiced', invoice_id = ?2", reqB.key, inv6);
await run("INSERT INTO bookings (request_key, kind, date, customer_name, phone) VALUES (?1, 'rental_pickup', '2026-10-30', 'Weekend Renter', '901-555-0101'), (?1, 'rental_return', '2026-10-31', 'Weekend Renter', '901-555-0101')", reqB.key);
await markCalled(db, reqB.key, { confirm: true, how: 'test' });
let h3 = (await T.todoData(db, TODAY, NOW)).sections;
must(!h3[3].some((x) => x.key === reqB.key), `an invoiced-unpaid HELD rental is in Set a time: ${JSON.stringify(titles(h3[3]))}`);
const wait = h3[5].filter((x) => x.type === 'hold' && x.key === reqB.key);
must(wait.length === 1 && wait[0].t === 'Weekend R. · Waiting for deposit · Games reserved until today 3 PM' && wait[0].d === '$160 due ($110 + $50 refundable deposit) on the invoice' && wait[0].due === 16000 && wait[0].btns.map((b) => b.label).join() === 'Reserve their games longer,Open card', `an invoiced-unpaid held rental is not in Money as waiting for deposit with its amount due: ${JSON.stringify(wait)}`);
// Already in Money (its invoice is due today): listed once, as owed, never twice.
await run("UPDATE invoices SET due_date = ?2 WHERE id = ?1", inv6, TODAY);
h3 = (await T.todoData(db, TODAY, NOW)).sections;
must(h3[5].filter((x) => x.key === reqB.key).length === 1 && h3[5].some((x) => x.key === reqB.key && x.type === 'owed'), `a held rental already listed in Money is listed twice: ${JSON.stringify(titles(h3[5]))}`);
await run("UPDATE invoices SET due_date = '2026-10-29' WHERE id = ?1", inv6);
// Deposit paid ("Mark deposit received": the payment, deposit_paid, the hold confirmed): now booked,
// and with no time it IS in Set a time, and no longer waiting in Money.
await run("INSERT INTO payments (invoice_id, amount_cents, received_on, method, note, kind) VALUES (?1, 8000, '2026-10-20', 'zelle', 'deposit', 'payment')", inv6);
await run("UPDATE invoices SET status = 'deposit_paid' WHERE id = ?1", inv6);
await run("UPDATE request_status SET status = 'deposit_paid' WHERE request_key = ?1", reqB.key);
must(await confirmHold(db, reqB.key, 'test'), 'confirmHold did not confirm the held rental');
h3 = (await T.todoData(db, TODAY, NOW)).sections;
must(JSON.stringify(h3[3].filter((x) => x.key === reqB.key).map((x) => x.t)) === JSON.stringify(['Weekend R. · games pickup Fri 30 Oct', 'Weekend R. · games return Sat 31 Oct']), `a deposit-paid rental with no time is not in Set a time: ${JSON.stringify(titles(h3[3]))}`);
must(!h3[5].some((x) => x.type === 'hold' && x.key === reqB.key), 'a deposit-paid rental still waits for its deposit in Money');
// Paid but the hold row still says held (money in, hold not yet confirmed): still a hold, not asked.
await run("UPDATE holds SET state = 'held' WHERE request_key = ?1", reqB.key);
must(!(await T.todoData(db, TODAY, NOW)).sections[3].some((x) => x.key === reqB.key), 'a rental whose hold is still current is in Set a time');
// Party: reqA's takedown (Sun 25 Oct, no time) is out until "Yes, book it", then in.
await markCalled(db, reqA.key, { confirm: true, how: 'test' });
must((await T.todoData(db, TODAY, NOW)).sections[3].some((x) => x.key === reqA.key && x.t === 'Test R. · party takedown Sun 25 Oct'), 'a CONFIRMED party job with no time is not in Set a time');
await undoCalled(db, reqA.key);
must(!(await T.todoData(db, TODAY, NOW)).sections[3].some((x) => x.key === reqA.key), 'a party job whose "Yes, book it" was taken back is still in Set a time');
// Restore reqB for the sections below.
await undoCalled(db, reqB.key);
await run("DELETE FROM bookings WHERE request_key = ?1", reqB.key);
await run("DELETE FROM payments WHERE invoice_id = ?1", inv6);
await run("DELETE FROM invoice_lines WHERE invoice_id = ?1", inv6);
await run("DELETE FROM invoices WHERE id = ?1", inv6);
await run("DELETE FROM request_status WHERE request_key = ?1", reqB.key);
if (stBefore) await run('INSERT INTO request_status (request_key, status, invoice_id, archived_at, prev_status, job_done_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)', stBefore.request_key, stBefore.status, stBefore.invoice_id, stBefore.archived_at, stBefore.prev_status, stBefore.job_done_at);
await run("UPDATE holds SET state = 'held', until = '2026-10-20 20:00:00', by_hand = 0 WHERE request_key = ?1", reqB.key);
// Tomorrow.
must(JSON.stringify(titles(d.tomorrowJobs)) === JSON.stringify(['3 PM · Tia T. · grazing setup']), `Tomorrow is ${JSON.stringify(titles(d.tomorrowJobs))}`);
must(d.week === null, 'a Tuesday email carries Your week');

// ---- 4. Book it or decide ------------------------------------------------------------------------
await markCalled(db, reqB.key, { how: 'test' });
await run("DELETE FROM holds WHERE request_key = ?1", reqB.key);
await run("DELETE FROM bookings WHERE request_key = ?1", reqB.key);
d = await T.todoData(db, TODAY, NOW);
must(!d.sections[2].some((x) => x.key === reqB.key), 'a request whose Called back is ticked is still in Call these people back');
const book = d.sections[4].find((x) => x.type === 'book' && x.key === reqB.key);
must(book && book.t === 'Weekend R. · Rentals · asked for Fri 30 Oct' && book.d === 'Not booked yet' && book.btns[0].label === 'Yes, book it' && book.btns[0].solid && book.btns[0].href === card(reqB.key), `Book it or decide lacks the called-not-booked request: ${JSON.stringify(book)}`);
await run("INSERT INTO bookings (request_key, kind, date, customer_name, phone) VALUES (?1, 'rental_pickup', '2026-10-30', 'Weekend Renter', '901-555-0101')", reqB.key);
must(!(await T.todoData(db, TODAY, NOW)).sections[4].some((x) => x.type === 'book' && x.key === reqB.key), 'a called request that is now on the calendar is still in Book it or decide');
await run("DELETE FROM bookings WHERE request_key = ?1", reqB.key);
// A takedown with no day: Schedule takedown / Not needed.
await run("DELETE FROM bookings WHERE request_key = ?1 AND kind = 'party_takedown'", reqA.key);
await run("UPDATE requests SET takedown_plan = 'not_sure' WHERE request_key = ?1", reqA.key);
must(!(await T.todoData(db, TODAY, NOW)).sections[4].some((x) => x.key === reqA.key), 'a takedown to decide shows before she has called them back (it belongs to the call)');
await markCalled(db, reqA.key, { how: 'test' });
d = await T.todoData(db, TODAY, NOW);
const td = d.sections[4].find((x) => x.type === 'takedown' && x.key === reqA.key);
must(td && td.t === 'Test R. · party takedown' && td.d === 'Not decided yet' && td.btns.map((b) => b.label).join() === 'Schedule takedown,Not needed' && td.btns.every((b) => b.href === card(reqA.key)), `Book it or decide lacks the undecided takedown: ${JSON.stringify(td)}`);
await run("UPDATE requests SET takedown_plan = 'scheduled', takedown_date = '' WHERE request_key = ?1", reqA.key);
const td2 = (await T.todoData(db, TODAY, NOW)).sections[4].find((x) => x.type === 'takedown' && x.key === reqA.key);
must(td2 && td2.d === 'No takedown day yet', `a wanted takedown with no day reads "${td2 && td2.d}"`);
await undoCalled(db, reqA.key);
// Phone requests and put-away requests are never in Call these people back.
await run("UPDATE requests SET source = 'phone' WHERE request_key = ?1", reqA.key);
must(!(await T.todoData(db, TODAY, NOW)).sections[2].some((x) => x.key === reqA.key), 'a phone-call request is in Call these people back');
await run("UPDATE requests SET source = 'google_form' WHERE request_key = ?1", reqA.key);
await run("INSERT INTO request_status (request_key, status, archived_at) VALUES (?1, 'new', datetime('now')) ON CONFLICT(request_key) DO UPDATE SET archived_at = datetime('now')", reqA.key);
d = await T.todoData(db, TODAY, NOW);
must(!Object.values(d.sections).flat().some((x) => x.key === reqA.key), 'a put-away request still shows in the email');
await run("UPDATE request_status SET archived_at = NULL WHERE request_key = ?1", reqA.key);

// ---- the rendered email -------------------------------------------------------------------------
d = await T.todoData(db, TODAY, NOW);
let msg = T.renderTodo(d);
// Ollie O.'s return (Sun 18 Oct, not back) is red: the subject; Pat P.'s pickup (Mon 19 Oct, not
// ticked) is yellow: one quiet line at the very bottom, never in the subject.
must(msg.subject === '⚠ 1 not back yet · Your to-do list for Tue 20 Oct · Porch & Party', `subject is "${msg.subject}"`);
must(/data-tidy[^>]*>Tidy up: 1 step to tick off \(Pat P\.&#39;s pickup\)\. <a href="https:\/\/porchandparty901\.com\/admin\/"[^>]*>Open admin<\/a>/.test(msg.html.replace(/&#x27;/g, '&#39;').replace(/'/g, '&#39;'))
  && msg.html.indexOf('data-tidy') > msg.html.indexOf('data-tomorrow') && msg.html.indexOf('data-tidy') < msg.html.indexOf('This email comes every day'), 'the Tidy up line is not at the very bottom, above the footer');
must(msg.text.includes("\nTidy up: 1 step to tick off (Pat P.'s pickup). Open admin: https://porchandparty901.com/admin/"), 'the plain text lacks the Tidy up line');
const order = [...msg.html.matchAll(/data-section="(\d)"/g)].map((x) => x[1]);
must(order.join() === [1, 2, 3, 4, 5].filter((n) => d.sections[n].length).map(String).join() && order.length === 5, `sections in the email: ${order} (all five in order 1-5)`);
for (const n of [2, 3, 4]) must(msg.html.includes(T.SECTION_WHY[n]) && msg.text.includes(T.SECTION_WHY[n]), `section ${n} lacks its why sentence`);
must(T.SECTION_WHY[2] === 'They sent a request and have not heard from you yet.' && T.SECTION_WHY[3] === 'These are booked for a day, but no time is set. Text them to pick one.' && T.SECTION_WHY[4] === 'You talked to them, but nothing is on the calendar yet.', 'the why sentences differ from the approved sample');
must(/Good morning, Valerie/.test(msg.html) && /Here is what needs you today, in order\./.test(msg.html), 'the greeting differs from the sample');
must(/data-tomorrow[\s\S]*Tomorrow, Wed 21 Oct[\s\S]*3 PM · Tia T\. · grazing setup/.test(msg.html), 'the Tomorrow box is missing');
must(/Open the admin<\/a> · This email comes every day at 7 AM\./.test(msg.html) && msg.text.includes('This email comes every day at 7 AM.'), 'the footer differs from the sample');
must((msg.html.match(/data-hi/g) || []).length === d.sections[2].filter((x) => x.hi).length + d.sections[3].filter((x) => x.hi).length, 'highlighted items in the HTML do not match the highlight rules');
must(/max-width:600px/.test(msg.html) && !/<table/.test(msg.html), 'the email is not one 600px column without tables (outside Monday)');
must(msg.text.length > 200 && /1\. TODAY'S JOBS[\s\S]*2\. CALL THESE PEOPLE BACK[\s\S]*3\. SET A TIME[\s\S]*4\. BOOK IT OR DECIDE[\s\S]*5\. MONEY[\s\S]*TOMORROW, WED 21 OCT/.test(msg.text), 'the plain text alternative lacks the sections in order');
must([...msg.html.matchAll(/data-num="(\d)"/g)].map((x) => x[1]).join() === '1,2,3,4,5' && /data-section="5" data-num="5"><div[^>]*><span[^>]*>5<\/span>/.test(msg.html), 'with all five sections the marks are not 1-5');
// ---- 2b. an empty middle section leaves no gap in the numbers (owner, 20 Oct 2026) -------------
{
  const gap = T.renderTodo({ ...d, sections: { ...d.sections, 4: [] } });
  const marks = [...gap.html.matchAll(/data-section="(\d)" data-num="(\d)"><div[^>]*><span[^>]*>(\d)<\/span>/g)].map((x) => `${x[1]}:${x[2]}:${x[3]}`);
  must(marks.join() === '1:1:1,2:2:2,3:3:3,5:4:4', `with section 4 empty the HTML marks read ${marks} (want 1, 2, 3, 4 with Money as 4)`);
  must(/1\. TODAY'S JOBS[\s\S]*2\. CALL THESE PEOPLE BACK[\s\S]*3\. SET A TIME[\s\S]*\n4\. MONEY\n/.test(gap.text) && !/^5\. /m.test(gap.text) && !/BOOK IT OR DECIDE/.test(gap.text), 'with section 4 empty the plain text is not numbered 1, 2, 3, 4 (MONEY as 4)');
  const two = T.renderTodo({ ...d, sections: { ...d.sections, 1: [], 3: [] } });
  must([...two.html.matchAll(/data-num="(\d)"/g)].map((x) => x[1]).join() === '1,2,3' && /\n1\. CALL THESE PEOPLE BACK\n[\s\S]*\n2\. BOOK IT OR DECIDE\n[\s\S]*\n3\. MONEY\n/.test(two.text), 'with sections 1 and 3 empty the shown sections are not numbered 1, 2, 3');
}
must([...msg.html.matchAll(/href="([^"]+)"/g)].every((x) => /^(tel:|sms:|https:\/\/porchandparty901\.com\/admin\/)/.test(x[1].replace(/&amp;/g, '&'))), 'a link goes somewhere other than /admin, tel: or sms:');
// ---- 7. no PII -------------------------------------------------------------------------------------
const visible = msg.html.replace(/<a [^>]*href="[^"]*"/g, '<a').replace(/<[^>]+>/g, ' ');
const people = [...s.requests, ...(await s.all('SELECT customer_name AS name, phone, email FROM bookings')), ...(await s.all('SELECT customer_name AS name, customer_phone AS phone, customer_email AS email FROM invoices'))];
for (const p of people) {
  const parts = String(p.name || '').split(/\s+/).filter(Boolean);
  if (parts.length > 1) must(!visible.includes(parts.slice(1).join(' ')) && !msg.text.includes(parts.slice(1).join(' ')) && !msg.subject.includes(parts.slice(1).join(' ')), `the email shows ${p.name}'s full surname`);
  if (p.email) must(!msg.html.includes(p.email) && !msg.text.includes(p.email), `the email shows ${p.name}'s email`);
  const digits = String(p.phone || '').replace(/\D/g, '');
  // The plain text may carry the number ONLY as a red-box "  📞 Call: tel:<digits>" line (the Call link).
  if (digits) must(!visible.replace(/\D/g, ' ').includes(digits.slice(-7)) && !msg.text.replace(/^  📞 Call: tel:\d+$/gm, '').replace(/\D/g, '').includes(digits.slice(-7)) && !visible.includes(p.phone), `the email shows ${p.name}'s phone outside a Call/Text link`);
}

// ---- 4. all clear ------------------------------------------------------------------------------------
{
  const c = await session();
  for (const r of c.requests) await c.db.prepare("INSERT INTO request_status (request_key, status, archived_at) VALUES (?1, 'new', datetime('now'))").bind(r.key).run();
  await c.db.prepare("DELETE FROM bookings").run();
  const cd = await T.todoData(c.db, '2026-10-21', Date.parse('2026-10-21T12:00:00Z'));
  const cm = T.renderTodo(cd);
  must(T.isAllClear(cd) && cm.text === 'All clear today' && /data-all-clear[^>]*>All clear today</.test(cm.html) && !/data-section|data-tomorrow|Good morning|Open the admin/.test(cm.html), `the quiet day is not ONLY "All clear today": ${cm.text}`);
  must(cm.subject === 'Your to-do list for Wed 21 Oct · Porch & Party', 'the all-clear subject changed');
  await c.db.prepare("INSERT INTO bookings (kind, date, time, customer_name) VALUES ('party_setup', '2026-10-22', '09:00', 'Quinn Quietly')").run();
  const cm2 = T.renderTodo(await T.todoData(c.db, '2026-10-21', Date.parse('2026-10-21T12:00:00Z')));
  must(!/data-all-clear/.test(cm2.html) && /Tomorrow, Thu 22 Oct[\s\S]*9 AM · Quinn Q\. · party setup/.test(cm2.html) && !/data-section/.test(cm2.html), 'a day with only a job tomorrow is "All clear" or shows empty sections');
  const quiet = T.renderTodo({ ...cd, tomorrowJobs: [], sections: { ...cd.sections, 5: [{ svc: 'rentals', t: 'X Y. · games not returned yet', d: 'Due back Mon 19 Oct', btns: [] }] } });
  must(/data-section="5" data-num="1"><div[^>]*><span[^>]*>1<\/span>/.test(quiet.html) && /\n1\. MONEY\n/.test(quiet.text) && !/5\. MONEY/.test(quiet.text), 'Money alone is not numbered 1');
  must(/Nothing booked\./.test(quiet.html) && /data-section="5"/.test(quiet.html) && !/data-section="[1-4]"/.test(quiet.html), 'an empty Tomorrow does not read "Nothing booked." or empty sections show');
  must(!/<hr/.test(quiet.html.split('data-section="5"')[0].split('</h1>')[1] || ''), 'a divider sits above the first section shown');
}

// ---- 5 + 6. the cron: Monday merge, once a day, failure, off switch, send now ----------------------
const sent = [];
let failNext = false;
const env = { ...s.env, EMAIL: { send: async (m) => { if (failNext) { failNext = false; throw new Error('mailer down'); } sent.push(m); return { messageId: 'x' }; } } };
const todos = () => sent.filter((m) => /^(⚠ [1-9]\d* (not back yet|to check) · )?Your to-do list for /.test(m.subject));
const subjectFor = async (day, words) => { const n = (await T.todoData(db, day, Date.parse(`${day}T12:00:00Z`))).missed.length; return `${n ? `⚠ ${n} not back yet · ` : ''}Your to-do list for ${words} · Porch & Party`; };
const r1 = await mailer.runReminders(env, new Date('2026-10-20T12:00:00Z'));
must(r1.todo && r1.todo.ok && todos().length === 1 && todos()[0].subject === '⚠ 1 not back yet · Your to-do list for Tue 20 Oct · Porch & Party' && todos()[0].text && todos()[0].html, `the 7 AM cron did not send the to-do email (${JSON.stringify(r1.todo)})`);
must(todos()[0].to === 'hello@porchandparty901.com', 'the to-do email did not go to the day-list email (default hello@)');
const r2 = await mailer.runReminders(env, new Date('2026-10-20T12:00:00Z'));
must(todos().length === 1 && /already sent/.test(r2.todo && r2.todo.skipped), 'a retried 7 AM run sent the to-do email twice');
await mailer.runReminders(env, new Date('2026-10-20T13:00:00Z'));
await mailer.runReminders(env, new Date('2026-10-20T23:00:00Z'));
must(todos().length === 1, 'another hour of the same day sent the to-do email');
failNext = true;
const rf = await mailer.runReminders(env, new Date('2026-10-21T12:00:00Z'));
must(rf.todo && !rf.todo.ok && !(await s.one("SELECT value FROM settings WHERE key = 'todo_email_day' AND value = '2026-10-21'")), 'a failed send did not release the day\'s claim');
await mailer.runReminders(env, new Date('2026-10-21T12:00:00Z'));
must(todos().length === 2 && /Wed 21 Oct/.test(todos()[1].subject), 'the retry after a failed send did not send');
await db.prepare("INSERT INTO settings (key, value) VALUES ('day_list_email', 'val@example.com') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
const mon = await mailer.runReminders(env, new Date('2026-10-26T12:00:00Z'));
const monMails = sent.filter((m) => /Mon 26 Oct|Your week at/.test(m.subject));
must(monMails.length === 1 && monMails[0].subject === await subjectFor('2026-10-26', 'Mon 26 Oct') && monMails[0].to === 'val@example.com', `Monday is not ONE to-do email to the day-list address: ${monMails.map((m) => m.subject)}`);
must(!sent.some((m) => /Your week at Porch & Party/.test(m.subject)) && !('weekly' in mon), 'the separate Monday weekly email was sent');
must(/data-week[\s\S]*Your week \(Monday summary\)[\s\S]*New requests last week[\s\S]*Jobs done last week[\s\S]*Money in last week[\s\S]*Tips[\s\S]*Expenses[\s\S]*Jobs in the next 14 days/.test(monMails[0].html) && /YOUR WEEK \(MONDAY SUMMARY\)/.test(monMails[0].text), 'the Monday email lacks the Your week box with its six figures');
must(monMails[0].html.indexOf('data-tomorrow') < monMails[0].html.indexOf('data-week') && monMails[0].html.indexOf('data-week') < monMails[0].html.indexOf('Open the admin'), 'Your week is not between Tomorrow and the footer');
must(!/data-week/.test(todos()[0].html), 'a Tuesday email has Your week');
const wd = await T.todoData(db, '2026-10-26', Date.parse('2026-10-26T12:00:00Z'));
const W = await mod('functions/_lib/weekly.mjs');
const wk = await W.weeklyData(db, '2026-10-26', Date.parse('2026-10-26T12:00:00Z'));
must(wd.week && wd.week.newRequests === wk.last.total && wd.week.moneyIn === wk.last.received && wd.week.tips === wk.last.tips && wd.week.expenses === wk.last.expenses && wd.week.jobsDone === wk.last.jobsDone && wd.week.next14 === wk.upcomingJobs, 'Your week does not show the weekly summary\'s figures');
await s.post('/admin/settings/weekly', { weekly_summary: '0' });
must(!(await T.todoData(db, '2026-10-26', Date.parse('2026-10-26T12:00:00Z'))).week, 'with the Monday summary switched off the Monday email still has Your week');
await s.post('/admin/settings/weekly', { weekly_summary: '1' });
// Off switch and Send now.
const off = await s.post('/admin/settings/todo', { todo_email: '0' });
must(off.status === 303 && (await s.one("SELECT value FROM settings WHERE key = 'todo_email'")).value === '0', 'the Settings switch did not turn the to-do email off');
const n0 = todos().length;
const r3 = await mailer.runReminders(env, new Date('2026-10-27T12:00:00Z'));
must(/switched off/.test(r3.todo && r3.todo.skipped) && todos().length === n0, 'the to-do email was sent while switched off');
const settingsPage = (await s.get('/admin/settings')).text;
must(/data-todo-settings[\s\S]*Daily to-do email[\s\S]*It is <strong>off<\/strong>[\s\S]*Turn the daily to-do email on[\s\S]*Send me today(&#39;|')s list now/.test(settingsPage), 'Settings lacks the Daily to-do email switch and "Send me today\'s list now"');
must(/data-weekly-settings[\s\S]*Your week, on Mondays/.test(settingsPage) && !/weekly-now/.test(settingsPage), 'Settings still offers the separate weekly email');
const before = s.env.sent.length;
const now = await s.post('/admin/settings/todo-now', {});
must(now.status === 303 && /on%20its%20way/.test(now.location) && s.env.sent.length === before + 1 && s.env.sent.at(-1).to === 'val@example.com' && /^(⚠ [1-9]\d* (not back yet|to check) · )?Your to-do list for /.test(s.env.sent.at(-1).subject) && s.env.sent.at(-1).text, 'Send me today\'s list now did not send to the day-list email');
await s.post('/admin/settings/todo', { todo_email: '1' });
must((await s.one("SELECT value FROM settings WHERE key = 'todo_email'")).value === '1', 'the switch did not turn the to-do email back on');
must(!(await (await session()).one("SELECT value FROM settings WHERE key = 'todo_email'")), 'the to-do setting is not absent (= on) on a fresh database');
// The old weekly sender is gone (one email on Mondays, never two).
const mailerSrc = fs.readFileSync(new URL('../../workers/pnp-mailer/src/index.js', import.meta.url), 'utf8');
must(!/sendWeeklySummary|isSummaryHour/.test(mailerSrc) && !('sendWeeklySummary' in W) && !('renderSummary' in W), 'the separate weekly email can still be sent');

if (checks < 60) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: daily to-do email (${errors.length} of ${checks})`); for (const e of errors) console.error(`- ${e}`); process.exit(1); }
console.log(`validate_admin_todo_email: OK (${checks} checks: 7 AM Memphis in CDT and CST, five sections' rules + order + highlights, deposits never owed, all clear, Monday = one email with Your week, once a day, failure release, off switch, send now, no PII)`);
