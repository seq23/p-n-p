#!/usr/bin/env node
/**
 * The Monday summary email (JOB B, owner-approved 18 Oct 2026).
 *  1. Timing: only the hourly cron run that is Monday 7 AM America/Chicago sends (12:00 UTC in
 *     daylight time, 13:00 UTC in standard time), so daylight saving needs no change.
 *  2. Window: "last week" is the Memphis Mon-Sun before this Monday; nothing outside it counts.
 *  3. Idempotent per week (a retried cron never sends twice); the next week sends again;
 *     switched off in Settings it never sends; "Send me this week's summary now" always sends.
 *  4. No PII: first name + last initial only, never a phone number, email or full surname.
 *  5. Every section and line is there, with links into /admin.
 * Rule 0: fewer than 30 checks is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const W = await mod('functions/_lib/weekly.mjs');
const mailer = await mod('workers/pnp-mailer/src/index.js');
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

// ---- 1. timing ----------------------------------------------------------------------------
must(W.isSummaryHour(new Date('2026-10-19T12:00:00Z')), 'Monday 12:00 UTC in daylight time (7 AM Memphis) is not the summary hour');
must(!W.isSummaryHour(new Date('2026-10-19T13:00:00Z')), 'Monday 13:00 UTC in daylight time (8 AM Memphis) sends');
must(W.isSummaryHour(new Date('2026-11-02T13:00:00Z')), 'Monday 13:00 UTC in standard time (7 AM Memphis) is not the summary hour');
must(!W.isSummaryHour(new Date('2026-11-02T12:00:00Z')), 'Monday 12:00 UTC in standard time (6 AM Memphis) sends');
must(!W.isSummaryHour(new Date('2026-10-18T12:00:00Z')) && !W.isSummaryHour(new Date('2026-10-20T12:00:00Z')), 'a day other than Monday sends');
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
const msg = W.renderSummary(d);
for (const h of ['LAST WEEK', 'NEXT 14 DAYS', 'NEEDS YOU']) must(msg.text.includes(h), `the summary has no "${h}" section`);
for (const line of ['New requests: 2', 'Jobs done:', 'Money received: $123.00', 'Expenses: $42.17', 'Still to collect', 'Takedowns not decided: 1 (Weekend R.)', 'No reply after 2 days', 'Receipts needing checking: 1', 'Not paid yet:']) must(msg.text.includes(line), `the summary lacks "${line}"`);
must(/https:\/\/porchandparty901\.com\/admin\/day\/2026-10-21/.test(msg.text) && /href="https:\/\/porchandparty901\.com\/admin\/money#not-paid"/.test(msg.html), 'the summary does not link into /admin');
// ---- 4. no PII ---------------------------------------------------------------------------------
const people = [...s.requests, { name: 'Paula Porchington', phone: '901-555-0777' }, { name: 'Gary Gameson', phone: '901-555-0778' }];
for (const p of people) {
  const parts = String(p.name || '').split(/\s+/);
  if (parts.length > 1) must(!msg.text.includes(parts.slice(1).join(' ')) && !msg.html.includes(parts.slice(1).join(' ')), `the summary shows ${p.name}'s full surname`);
  if (p.email) must(!msg.text.includes(p.email) && !msg.html.includes(p.email), `the summary shows ${p.name}'s email`);
  if (p.phone) must(!msg.text.includes(String(p.phone).replace(/\D/g, '').slice(-7)) && !msg.text.includes(p.phone), `the summary shows ${p.name}'s phone`);
}

// ---- 3. idempotent per week, off switch, send now ------------------------------------------
const sent = [];
const env = { ...s.env, EMAIL: { send: async (m) => { sent.push(m); return { messageId: 'x' }; } } };
const r1 = await mailer.runReminders(env, new Date('2026-10-19T12:00:00Z'));
must(r1.weekly && r1.weekly.ok && sent.length === 1 && /Your week at Porch & Party/.test(sent[0].subject), `the Monday 7 AM cron did not send the summary (${JSON.stringify(r1.weekly)})`);
must(sent[0].to === 'hello@porchandparty901.com', 'the summary did not go to the day-list email (default hello@)');
const r2 = await mailer.runReminders(env, new Date('2026-10-19T12:00:00Z'));
must(sent.length === 1 && /already sent/.test(r2.weekly && r2.weekly.skipped), 'a retried Monday run sent the summary twice');
await mailer.runReminders(env, new Date('2026-10-19T15:00:00Z'));
must(sent.filter((m) => /Your week/.test(m.subject)).length === 1, 'a later Monday run sent the summary again');
await mailer.runReminders(env, new Date('2026-10-26T12:00:00Z'));
must(sent.filter((m) => /Your week/.test(m.subject)).length === 2, 'the next Monday did not send');
await db.prepare("INSERT INTO settings (key, value) VALUES ('day_list_email', 'val@example.com') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
const off = await s.post('/admin/settings/weekly', { weekly_summary: '0' });
must(off.status === 303 && (await s.one("SELECT value FROM settings WHERE key = 'weekly_summary'")).value === '0', 'the Settings switch did not turn the summary off');
const r3 = await mailer.runReminders(env, new Date('2026-11-02T13:00:00Z'));
must(/switched off/.test(r3.weekly && r3.weekly.skipped) && sent.filter((m) => /Your week/.test(m.subject)).length === 2, 'the summary was sent while switched off');
const settingsPage = (await s.get('/admin/settings')).text;
must(/data-weekly-settings[\s\S]*It is <strong>off<\/strong>[\s\S]*Turn the Monday summary on[\s\S]*Send me this week&#39;s summary now|data-weekly-settings[\s\S]*It is <strong>off<\/strong>[\s\S]*Turn the Monday summary on[\s\S]*Send me this week's summary now/.test(settingsPage), 'Settings lacks the on/off switch and "Send me this week\'s summary now"');
const before = s.env.sent.length;
const now = await s.post('/admin/settings/weekly-now', {});
must(now.status === 303 && /on%20its%20way/.test(now.location) && s.env.sent.length === before + 1 && s.env.sent.at(-1).to === 'val@example.com' && /Your week/.test(s.env.sent.at(-1).subject), 'Send me this week\'s summary now did not send to the day-list email');
await s.post('/admin/settings/weekly', { weekly_summary: '1' });
must((await s.one("SELECT value FROM settings WHERE key = 'weekly_summary'")).value === '1', 'the switch did not turn the summary back on');
// Default ON: a fresh database with no setting sends.
must(!(await (await session()).one("SELECT value FROM settings WHERE key = 'weekly_summary'")), 'the summary setting is not absent (= on) on a fresh database');
// The cron is registered hourly and documented with the UTC hours.
const fs = await import('node:fs');
const toml = fs.readFileSync(new URL('../../workers/pnp-mailer/wrangler.toml', import.meta.url), 'utf8');
must(/crons = \["0 \* \* \* \*"\]/.test(toml) && /12:00 UTC \(CDT\) or\s*\n?#?\s*13:00 UTC \(CST\)/.test(toml), 'wrangler.toml does not keep the hourly cron with the Monday 7 AM UTC hours documented');

if (checks < 30) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: weekly summary (${errors.length} of ${checks})`); for (const e of errors) console.error(`- ${e}`); process.exit(1); }
console.log(`validate_admin_weekly: OK (${checks} checks: Monday 7 AM Memphis in CDT and CST, windows, idempotent per week, off switch, send now, no PII, sections and links)`);
