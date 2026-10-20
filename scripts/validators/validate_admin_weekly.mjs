#!/usr/bin/env node
/**
 * The Monday summary (JOB B, owner-approved 18 Oct 2026), since 19 Oct 2026 the "Your week" box
 * of the daily 7 AM to-do email (todo-email.mjs): Monday is ONE email.
 *  1. Timing: the Monday 7 AM America/Chicago run (12:00 UTC in daylight time, 13:00 UTC in
 *     standard time) carries Your week; no other day does; no separate weekly email ever goes.
 *  2. Window: "last week" is the Memphis Mon-Sun before this Monday; nothing outside it counts.
 *  3. Once per Monday (a retried cron never sends twice); the next Monday sends again; the
 *     Settings switch off leaves Your week out of the Monday email (the to-do list still goes).
 *  4. No PII: first name + last initial only, never a phone number, email or full surname.
 *  5. Every figure of the box is there and matches weeklyData; the data keeps every line.
 * Rule 0: fewer than 30 checks is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const W = await mod('functions/_lib/weekly.mjs');
const T = await mod('functions/_lib/todo-email.mjs');
const mailer = await mod('workers/pnp-mailer/src/index.js');
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

// ---- 1. timing ----------------------------------------------------------------------------
must(T.isTodoHour(new Date('2026-10-19T12:00:00Z')) && T.isMondayIso('2026-10-19'), 'Monday 12:00 UTC in daylight time (7 AM Memphis) is not the Monday email hour');
must(!T.isTodoHour(new Date('2026-10-19T13:00:00Z')), 'Monday 13:00 UTC in daylight time (8 AM Memphis) sends');
must(T.isTodoHour(new Date('2026-11-02T13:00:00Z')) && T.isMondayIso('2026-11-02'), 'Monday 13:00 UTC in standard time (7 AM Memphis) is not the Monday email hour');
must(!T.isTodoHour(new Date('2026-11-02T12:00:00Z')), 'Monday 12:00 UTC in standard time (6 AM Memphis) sends');
must(!T.isMondayIso('2026-10-18') && !T.isMondayIso('2026-10-20'), 'a day other than Monday counts as Monday');
must(W.shortName('Jane Q. Doe') === 'Jane D.' && W.shortName('Cher') === 'Cher' && W.shortName('') === 'No name', 'shortName is not first name + last initial');
must(W.mondayOfIso('2026-10-25') === '2026-10-19' && W.mondayOfIso('2026-10-19') === '2026-10-19', 'mondayOfIso is wrong');

// ---- a console with something in every box -------------------------------------------------
const s = await session();
const db = s.db;
const reqA = s.requests.find((r) => r.email === 'test.renter@example.com');   // asked 14 Oct
const reqB = s.requests.find((r) => r.email === 'weekend.renter@example.com'); // asked 12 Oct
const inv = await s.invoiceFor(reqA, { go: 'send' });
await db.prepare("INSERT INTO payments (invoice_id, amount_cents, received_on, method, note, kind) VALUES (?1, 12300, '2026-10-15', 'zelle', 'deposit', 'payment'), (?1, 200, '2026-10-19', 'zelle', 'later', 'payment'), (?1, 300, '2026-10-11', 'zelle', 'earlier', 'payment')").bind(inv.id).run();
await db.prepare("INSERT INTO expenses (vendor, date, total_cents, category, status) VALUES ('Party City', '2026-10-13', 4217, 'Supplies & decor', 'saved'), ('Old', '2026-10-05', 99999, 'Supplies & decor', 'saved'), ('Needs', '2026-10-14', 100, 'Supplies & decor', 'needs_check')").run();
await db.prepare("INSERT INTO bookings (kind, date, customer_name, phone, items) VALUES ('porch_install', '2026-10-21', 'Paula Porchington', '901-555-0777', 'Porch'), ('rental_pickup', '2026-10-23', 'Gary Gameson', '901-555-0778', 'Giant Uno'), ('rental_return', '2026-10-26', 'Gary Gameson', '901-555-0778', 'Giant Uno'), ('porch_install', '2026-11-02', 'Late Lateman', '901-555-0779', 'Porch')").run();
await db.prepare("UPDATE requests SET takedown_plan = 'not_sure' WHERE request_key = ?1").bind(reqB.key).run();
const d = await W.weeklyData(db, '2026-10-19', Date.parse('2026-10-19T12:00:00Z'));
must(d.lastWeek.start === '2026-10-12' && d.lastWeek.end === '2026-10-18' && d.week.start === '2026-10-19' && d.week.end === '2026-10-25', `windows wrong: ${JSON.stringify([d.lastWeek, d.week])}`);
must(d.last.total === 2, `new requests last week: ${d.last.total} (expected the two fixture requests of 12 and 14 Oct)`);
must(d.last.received === 12300, `money received last week ${d.last.received} (only the 15 Oct payment is in the window)`);
must(d.last.expenses === 4217, `expenses last week ${d.last.expenses} (only saved, only in the window)`);
must(d.this.days.some((x) => x.date === '2026-10-21' && x.bookings.some((b) => b.who === 'Paula P.')), 'this week does not list the porch install by date');
must(d.this.days.some((x) => x.date === '2026-10-23' && x.games >= 1), 'games out per day missing');
must(d.upcoming.start === '2026-10-19' && d.upcoming.end === '2026-11-01', `the next-14-days window is wrong: ${JSON.stringify(d.upcoming)}`);
must(d.this.days.some((x) => x.date === '2026-10-26' && x.bookings.some((b) => b.who === 'Gary G.')), 'a booking in the second week is missing from the next 14 days');
must(!d.this.days.some((x) => x.date === '2026-11-02'), 'a booking after the 14th day is in the list');
must(d.needs.takedowns.includes('Weekend R.'), 'takedowns not decided missing');
must(d.needs.noReply.includes('Weekend R.'), 'requests with no reply after 2 days missing');
must(d.needs.receipts === 1, 'receipts needing checking missing');
must(d.needs.notPaid.count >= 1 && d.needs.notPaid.total > 0, 'not paid yet missing');
must(d.upcomingJobs === d.this.days.reduce((n, x) => n + x.bookings.filter((b) => b.kind !== 'Rental out').length, 0), `jobs in the next 14 days ${d.upcomingJobs} disagrees with the 14-day list`);
const td = await T.todoData(db, '2026-10-19', Date.parse('2026-10-19T12:00:00Z'));
const msg = T.renderTodo(td);
must(td.week && td.week.newRequests === 2 && td.week.moneyIn === 12300 && td.week.expenses === 4217 && td.week.next14 === d.upcomingJobs && td.week.jobsDone === d.last.jobsDone, `Your week figures ${JSON.stringify(td.week)} differ from weeklyData`);
for (const line of ['New requests last week: 2', 'Jobs done last week: ', 'Money in last week: $123', 'Tips: $0', 'Expenses: $42.17', `Jobs in the next 14 days: ${d.upcomingJobs}`]) must(msg.text.includes(line), `the Monday email lacks "${line}"`);
must(/data-week[\s\S]*Your week \(Monday summary\)[\s\S]*Money in last week<\/td><td[^>]*>\$123</.test(msg.html), 'the Monday email has no Your week box');
must(msg.subject === 'Your to-do list for Mon 19 Oct · Porch & Party', `the Monday subject is "${msg.subject}"`);
// ---- 4. no PII ---------------------------------------------------------------------------------
const people = [...s.requests, { name: 'Paula Porchington', phone: '901-555-0777' }, { name: 'Gary Gameson', phone: '901-555-0778' }];
for (const p of people) {
  const parts = String(p.name || '').split(/\s+/);
  if (parts.length > 1) must(!msg.text.includes(parts.slice(1).join(' ')) && !msg.html.includes(parts.slice(1).join(' ')), `the summary shows ${p.name}'s full surname`);
  if (p.email) must(!msg.text.includes(p.email) && !msg.html.includes(p.email), `the summary shows ${p.name}'s email`);
  if (p.phone) must(!msg.text.includes(String(p.phone).replace(/\D/g, '').slice(-7)) && !msg.text.includes(p.phone), `the summary shows ${p.name}'s phone`);
}

// ---- 3. once per Monday, off switch -------------------------------------------------------------
const sent = [];
const env = { ...s.env, EMAIL: { send: async (m) => { sent.push(m); return { messageId: 'x' }; } } };
// A Monday with a red item starts "⚠ N not back yet · " / "⚠ N to check · " (missed.mjs
// subjectWarning); a yellow step never touches the subject; the rest is unchanged.
const mondays = () => sent.filter((m) => /^(⚠ [1-9]\d* (not back yet|to check) · )?Your to-do list for Mon /.test(m.subject));
const r1 = await mailer.runReminders(env, new Date('2026-10-19T12:00:00Z'));
must(r1.todo && r1.todo.ok && sent.length === 1 && mondays().length === 1 && /data-week/.test(sent[0].html), `the Monday 7 AM cron did not send ONE email with Your week (${JSON.stringify(r1.todo)})`);
must(!sent.some((m) => /Your week at Porch & Party/.test(m.subject)), 'the separate weekly summary email was sent');
must(sent[0].to === 'hello@porchandparty901.com', 'the Monday email did not go to the day-list email (default hello@)');
const r2 = await mailer.runReminders(env, new Date('2026-10-19T12:00:00Z'));
must(sent.length === 1 && /already sent/.test(r2.todo && r2.todo.skipped), 'a retried Monday run sent twice');
await mailer.runReminders(env, new Date('2026-10-19T15:00:00Z'));
must(sent.length === 1, 'a later Monday run sent again');
await mailer.runReminders(env, new Date('2026-10-20T12:00:00Z'));
must(sent.length === 2 && !/data-week/.test(sent[1].html), 'the Tuesday email has Your week');
await mailer.runReminders(env, new Date('2026-10-26T12:00:00Z'));
must(mondays().length === 2 && /data-week/.test(mondays()[1].html), 'the next Monday did not send Your week');
await db.prepare("INSERT INTO settings (key, value) VALUES ('day_list_email', 'val@example.com') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
const off = await s.post('/admin/settings/weekly', { weekly_summary: '0' });
must(off.status === 303 && (await s.one("SELECT value FROM settings WHERE key = 'weekly_summary'")).value === '0', 'the Settings switch did not turn the summary off');
await mailer.runReminders(env, new Date('2026-11-02T13:00:00Z'));
must(mondays().length === 3 && !/data-week/.test(mondays()[2].html) && mondays()[2].to === 'val@example.com', 'with the summary off the Monday email still has Your week (or did not go)');
const settingsPage = (await s.get('/admin/settings')).text;
must(/data-weekly-settings[\s\S]*It is <strong>off<\/strong>[\s\S]*Turn the Monday summary on/.test(settingsPage) && !/weekly-now/.test(settingsPage), 'Settings lacks the Monday summary switch (or still offers a separate weekly send)');
await s.post('/admin/settings/weekly', { weekly_summary: '1' });
must((await s.one("SELECT value FROM settings WHERE key = 'weekly_summary'")).value === '1', 'the switch did not turn the summary back on');
// Default ON: a fresh database with no setting sends.
must(!(await (await session()).one("SELECT value FROM settings WHERE key = 'weekly_summary'")), 'the summary setting is not absent (= on) on a fresh database');
// The cron is registered hourly and documented with the UTC hours.
const fs = await import('node:fs');
const toml = fs.readFileSync(new URL('../../workers/pnp-mailer/wrangler.toml', import.meta.url), 'utf8');
must(/crons = \["0 \* \* \* \*"\]/.test(toml) && /"Your week"\) goes in the run that is 7 AM America\/Chicago:\s*\n#\s*12:00 UTC \(CDT\) or 13:00 UTC \(CST\)/.test(toml), 'wrangler.toml does not keep the hourly cron with the Monday 7 AM UTC hours documented');

if (checks < 30) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: weekly summary (${errors.length} of ${checks})`); for (const e of errors) console.error(`- ${e}`); process.exit(1); }
console.log(`validate_admin_weekly: OK (${checks} checks: Monday 7 AM Memphis in CDT and CST, one Monday email with Your week, windows, once per Monday, off switch, no PII, figures match)`);
