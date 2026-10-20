#!/usr/bin/env node
/**
 * Valerie's daily 7 AM to-do email (owner-approved mock, 19 Oct 2026; functions/_lib/todo-email.mjs).
 *  1. Timing: only the hourly cron run that is 7 AM America/Chicago sends (12:00 UTC in daylight
 *     time, 13:00 UTC in standard time), every day of the week.
 *  2. Each section's inclusion rules, its order inside, the highlight thresholds (call back 2+ days,
 *     no time within 2 days), sections shown only when non-empty and always in the order 1-5, each
 *     with its "why" sentence from the mock.
 *  3. Money: due today or late only; the refundable damage deposit is never owed.
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
const { markCalled } = await mod('functions/_lib/steps.mjs');
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
must(JSON.stringify(titles(S[1])) === JSON.stringify(['10 AM · Alex S. · party takedown', '5 PM · Sam R. · games return', 'time not set · Una U. · porch install']), `Today's jobs are ${JSON.stringify(titles(S[1]))}`);
must(S[1][0].d === 'Germantown · bring the ladder and 2 bins · collect $180', `the takedown line is "${S[1][0].d}" (place, what to bring, what to collect)`);
must(S[1][1].d === 'Mt. Moriah Station · Giant Uno, Grab the Mic · give back $50 deposit', `the return line is "${S[1][1].d}" (place, games, deposit to give back)`);
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
// 3. Set a time: every open booking from today on with no time, soonest first, highlight within 2 days.
must(JSON.stringify(titles(S[3])) === JSON.stringify(['Una U. · porch install Tue 20 Oct', 'Danesha M. · games pickup Thu 22 Oct', 'Kim P. · porch takedown Fri 23 Oct', 'Test R. · party takedown Sun 25 Oct']), `Set a time is ${JSON.stringify(titles(S[3]))}`);
must(!titles(S[3]).some((t) => /Pat P|Ollie O|Alex S|Tia T/.test(t)), 'Set a time lists a past day or a booking that has a time');
const hiOf = (re) => (S[3].find((x) => re.test(x.t)) || {}).hi;
must(hiOf(/Una U/) === true && hiOf(/Danesha M/) === true && hiOf(/Kim P/) === false, 'Set a time highlight is not "within 2 days"');
const sms = (S[3].find((x) => /Danesha/.test(x.t)) || { btns: [] }).btns.find((b) => b.label === 'Text');
must(sms && decodeURIComponent(sms.href.split('body=')[1] || '') === "Hi Danesha, it's Porch & Party. What time works for your games pickup on Thu 22 Oct?", `the Set a time text is "${sms && decodeURIComponent(sms.href.split('body=')[1] || '')}"`);
// 5. Money.
const m5 = S[5];
must(m5.some((x) => x.type === 'owed' && x.t === 'Alex S. · $180 still owed' && x.d === 'Due today, at the takedown'), `Money lacks "Alex S. · $180 still owed / Due today, at the takedown": ${JSON.stringify(titles(m5))}`);
must(m5.some((x) => x.type === 'owed' && x.t === 'Lou L. · $90 still owed' && /3 days late/.test(x.d)), 'Money lacks the late balance');
must(!m5.some((x) => /Fay F/.test(x.t)), 'Money lists a balance due tomorrow');
must(!m5.some((x) => /Dee D|Sam R/.test(x.t)), 'Money lists a damage deposit as owed (deposits are never owed)');
const owedRow = m5.find((x) => /Alex S/.test(x.t));
must(owedRow && owedRow.btns.some((b) => b.label === 'Text a reminder' && /^sms:/.test(b.href)) && owedRow.btns.some((b) => b.label === 'Mark paid' && b.href === `/admin/invoices/${inv['PNP-T-1']}`), 'the owed line lacks Text a reminder / Mark paid');
must(m5.some((x) => x.type === 'hold' && x.t === 'Weekend R. · games held until today 3 PM' && x.d === 'Deposit not paid yet' && x.btns[0].label === 'Hold longer' && x.btns[0].href === card(reqB.key)), `Money lacks the hold ending today: ${JSON.stringify(titles(m5))}`);
must(m5.some((x) => x.type === 'overdue' && /^Ollie O\. · games not returned yet$/.test(x.t)), 'Money lacks the overdue return');
must(m5.findIndex((x) => x.type === 'owed') < m5.findIndex((x) => x.type === 'hold') && m5.findIndex((x) => x.type === 'hold') < m5.findIndex((x) => x.type === 'overdue'), 'Money is not balances, then holds, then returns');
await run("UPDATE holds SET until = '2026-10-21 20:00:00' WHERE request_key = ?1", reqB.key);
must(!(await T.todoData(db, TODAY, NOW)).sections[5].some((x) => x.type === 'hold'), 'a hold ending tomorrow is in Money');
await run("UPDATE holds SET until = '2026-10-20 20:00:00' WHERE request_key = ?1", reqB.key);
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
d = await T.todoData(db, TODAY, NOW);
const td = d.sections[4].find((x) => x.type === 'takedown' && x.key === reqA.key);
must(td && td.t === 'Test R. · party takedown' && td.d === 'Not decided yet' && td.btns.map((b) => b.label).join() === 'Schedule takedown,Not needed' && td.btns.every((b) => b.href === card(reqA.key)), `Book it or decide lacks the undecided takedown: ${JSON.stringify(td)}`);
await run("UPDATE requests SET takedown_plan = 'scheduled', takedown_date = '' WHERE request_key = ?1", reqA.key);
const td2 = (await T.todoData(db, TODAY, NOW)).sections[4].find((x) => x.type === 'takedown' && x.key === reqA.key);
must(td2 && td2.d === 'No takedown day yet', `a wanted takedown with no day reads "${td2 && td2.d}"`);
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
must(msg.subject === 'Your to-do list for Tue 20 Oct · Porch & Party', `subject is "${msg.subject}"`);
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
must([...msg.html.matchAll(/href="([^"]+)"/g)].every((x) => /^(tel:|sms:|https:\/\/porchandparty901\.com\/admin\/)/.test(x[1].replace(/&amp;/g, '&'))), 'a link goes somewhere other than /admin, tel: or sms:');
// ---- 7. no PII -------------------------------------------------------------------------------------
const visible = msg.html.replace(/<a [^>]*href="[^"]*"/g, '<a').replace(/<[^>]+>/g, ' ');
const people = [...s.requests, ...(await s.all('SELECT customer_name AS name, phone, email FROM bookings')), ...(await s.all('SELECT customer_name AS name, customer_phone AS phone, customer_email AS email FROM invoices'))];
for (const p of people) {
  const parts = String(p.name || '').split(/\s+/).filter(Boolean);
  if (parts.length > 1) must(!visible.includes(parts.slice(1).join(' ')) && !msg.text.includes(parts.slice(1).join(' ')) && !msg.subject.includes(parts.slice(1).join(' ')), `the email shows ${p.name}'s full surname`);
  if (p.email) must(!msg.html.includes(p.email) && !msg.text.includes(p.email), `the email shows ${p.name}'s email`);
  const digits = String(p.phone || '').replace(/\D/g, '');
  if (digits) must(!visible.replace(/\D/g, ' ').includes(digits.slice(-7)) && !msg.text.replace(/\D/g, '').includes(digits.slice(-7)) && !visible.includes(p.phone), `the email shows ${p.name}'s phone outside a Call/Text link`);
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
  must(/Nothing booked\./.test(quiet.html) && /data-section="5"/.test(quiet.html) && !/data-section="[1-4]"/.test(quiet.html), 'an empty Tomorrow does not read "Nothing booked." or empty sections show');
  must(!/<hr/.test(quiet.html.split('data-section="5"')[0].split('</h1>')[1] || ''), 'a divider sits above the first section shown');
}

// ---- 5 + 6. the cron: Monday merge, once a day, failure, off switch, send now ----------------------
const sent = [];
let failNext = false;
const env = { ...s.env, EMAIL: { send: async (m) => { if (failNext) { failNext = false; throw new Error('mailer down'); } sent.push(m); return { messageId: 'x' }; } } };
const todos = () => sent.filter((m) => /^Your to-do list for /.test(m.subject));
const r1 = await mailer.runReminders(env, new Date('2026-10-20T12:00:00Z'));
must(r1.todo && r1.todo.ok && todos().length === 1 && todos()[0].subject === 'Your to-do list for Tue 20 Oct · Porch & Party' && todos()[0].text && todos()[0].html, `the 7 AM cron did not send the to-do email (${JSON.stringify(r1.todo)})`);
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
must(monMails.length === 1 && monMails[0].subject === 'Your to-do list for Mon 26 Oct · Porch & Party' && monMails[0].to === 'val@example.com', `Monday is not ONE to-do email to the day-list address: ${monMails.map((m) => m.subject)}`);
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
must(now.status === 303 && /on%20its%20way/.test(now.location) && s.env.sent.length === before + 1 && s.env.sent.at(-1).to === 'val@example.com' && /^Your to-do list for /.test(s.env.sent.at(-1).subject) && s.env.sent.at(-1).text, 'Send me today\'s list now did not send to the day-list email');
await s.post('/admin/settings/todo', { todo_email: '1' });
must((await s.one("SELECT value FROM settings WHERE key = 'todo_email'")).value === '1', 'the switch did not turn the to-do email back on');
must(!(await (await session()).one("SELECT value FROM settings WHERE key = 'todo_email'")), 'the to-do setting is not absent (= on) on a fresh database');
// The old weekly sender is gone (one email on Mondays, never two).
const mailerSrc = fs.readFileSync(new URL('../../workers/pnp-mailer/src/index.js', import.meta.url), 'utf8');
must(!/sendWeeklySummary|isSummaryHour/.test(mailerSrc) && !('sendWeeklySummary' in W) && !('renderSummary' in W), 'the separate weekly email can still be sent');

if (checks < 60) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: daily to-do email (${errors.length} of ${checks})`); for (const e of errors) console.error(`- ${e}`); process.exit(1); }
console.log(`validate_admin_todo_email: OK (${checks} checks: 7 AM Memphis in CDT and CST, five sections' rules + order + highlights, deposits never owed, all clear, Monday = one email with Your week, once a day, failure release, off switch, send now, no PII)`);
