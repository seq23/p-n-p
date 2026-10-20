#!/usr/bin/env node
/**
 * Requests on a phone (owner, 19 Oct 2026). Drives the real router over a fresh local database.
 * Fails when:
 *  1. anything but the setup banner, the heading, overdue returns, the one-line week card and the
 *     holds ending soon comes before the request list (the three-step panel must sit under the
 *     list on a phone, CSS order, and stay on top from 900 px);
 *  2. tomorrow's reminders are not ONE collapsed tappable line ("N reminders", a <details>) AFTER
 *     the list, or the Calendar loses its open reminders box;
 *  3. a new website request does not wear NEW on its card and in the week card's collapsed line,
 *     or keeps it after the badge is tapped, after Edit is opened, or once acted on (an invoice);
 *     or a phone-call request, or a request already in D1 before migration 0016, wears it;
 *  4. (19 Oct 2026 repair) a website RENTAL request, which gets a draft invoice at submit, does not
 *     wear NEW; or a system history line (hold expired, mailer, auto-booked takedown) clears NEW;
 *     or status past New / put away does not clear it; or migration 0017 fails to un-open the 0016
 *     backfill for recent still-New website requests, or touches anything else.
 * Rule 0: fewer than 25 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT, applyMigration } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const RN = await mod('functions/_lib/request-new.mjs');
const R = await mod('functions/_lib/reminders.mjs');
const F = await mod('functions/_lib/request-form.mjs');

// Unit: the rule.
const site = { key: 'k', source: 'site' };
must(RN.isNewRequest(site, {}) === true, 'a fresh website request is not NEW');
must(RN.isNewRequest(site, { opened: true }) === false, 'an opened request is still NEW');
must(RN.isNewRequest({ ...site, source: 'phone' }, {}) === false, 'a phone-call request is NEW');
must(RN.isNewRequest(site, { st: { status: 'invoiced' } }) === false && RN.isNewRequest(site, { st: { status: 'deposit_paid', invoice_id: 3 } }) === false, 'a request past New is still NEW');
must(RN.isNewRequest(site, { st: { status: 'new', archived_at: 'x' } }) === false && RN.isNewRequest(site, { st: { status: 'new', invoice_id: 3, archived_at: 'x' } }) === false, 'a request put away is still NEW');
must(RN.isNewRequest(site, { st: { status: 'new', invoice_id: 3 } }) === true, 'a website rental with its automatic draft invoice (status still New) is not NEW');
must(RN.isNewRequest(site, { st: { status: 'new', invoice_id: 3 }, opened: true }) === false, 'an opened rental is still NEW');
must(RN.isNewRequest({ ...site, source: 'phone' }, { st: { status: 'new' } }) === false && RN.isNewRequest({ ...site, source: 'phone' }, { st: null }) === false, 'a phone-call request with status New is NEW');
must(RN.isNewRequest(site, { st: { status: 'new' }, events: [{ who: 'automatic' }, { who: 'admin' }, { who: 'mailer' }] }) === true, 'system history lines clear NEW');

// Migration 0016: additive, backfills every existing request as opened.
const mig = fs.readFileSync(path.join(ROOT, 'migrations/0016_request_opened.sql'), 'utf8');
must(/CREATE TABLE IF NOT EXISTS request_opened/.test(mig) && /INSERT OR IGNORE INTO request_opened[\s\S]*FROM requests/.test(mig) && !/DROP|DELETE|UPDATE requests/i.test(mig), 'migration 0016 is not additive with a backfill');

const s = await session();
const env = s.env;
// Production order: the fixture requests were in D1 when 0016 backfilled them, then 0017 repaired
// the backfill. Re-running both here (0016 is idempotent) puts this DB where production is.
applyMigration(s.db, 16);
applyMigration(s.db, 17);
const before = await s.all("SELECT r.request_key, r.submitted_at, o.how FROM requests r LEFT JOIN request_opened o ON o.request_key = r.request_key WHERE r.source <> 'phone'");
must(before.length > 0 && before.every((r) => r.submitted_at < '2026-10-16' && r.how === 'before the NEW badge'), `the fixture requests are not all pre-16-Oct and backfilled as opened: ${JSON.stringify(before.map((r) => [r.submitted_at, r.how]))}`);
const today = F.chicagoToday();
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const tomorrow = (() => { const d = new Date(`${R.chicagoDate()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
for (const n of ['Avery Rem', 'Blake Rem', 'Casey Rem']) await s.db.prepare("INSERT INTO bookings (kind, date, customer_name, phone, items) VALUES ('rental_pickup', ?1, ?2, '9015550123', 'Giant Uno')").bind(tomorrow, n).run();
const a = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', event_date: plus(12), location: 'Bartlett', name: 'Nora Newone', phone: '(901) 555-0161', email: 'nora.new@example.com' });
const b = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', event_date: plus(13), location: 'Bartlett', name: 'Olive Other', phone: '(901) 555-0162', email: 'olive.other@example.com' });
must(a.status === 303 && b.status === 303, 'the test requests were refused');
const rkA = s.rk(a.row.request_key); const rkB = s.rk(b.row.request_key);
const cardOf = (html, rk) => { const i = html.indexOf(`id="c-${rk}"`); return i < 0 ? '' : html.slice(html.lastIndexOf('<article', i), html.indexOf('</article>', i)); };

let dash = (await s.get('/admin/')).text;
// 1. Order.
const at = (needle) => dash.indexOf(needle);
must(at('data-request-list') > 0, 'no request list on Requests');
must(at('data-week-counts') > 0 && at('data-week-counts') < at('data-request-list'), 'the week card is not above the list');
must(at('data-reminders-line') > at('data-request-list') && at("Tomorrow's reminders") > at('data-request-list'), 'tomorrow\'s reminders still sit above the request list');
const rqpanel = at('class="rqpanel"');
must(rqpanel > 0 && /\.rqmain\{order:1\}\.rqpanel\{order:2/.test(dash) && /@media\(min-width:900px\)\{\.rqpanel\{order:0/.test(dash), 'the three-step panel is not under the list on a phone and on top on a wide screen');
must(at('class="rqmain"') > rqpanel && !dash.slice(at('class="rqmain"'), at('data-request-list')).includes('data-reminders'), 'something besides the week card / alerts sits between the heading and the list');
// 2. Reminders line.
const line = dash.slice(at('data-reminders-line') - 40, at('data-reminders-line') + 600);
must(/<details class="card remline" data-reminders data-reminders-line>/.test(dash) && !/<details class="card remline"[^>]* open/.test(dash), 'the reminders are not one collapsed <details> line');
must(/<span class="remcount">3 reminders<\/span>/.test(line) && line.includes('▸'), `the reminders line does not read "3 reminders ▸": ${line.slice(0, 300)}`);
must((dash.match(/data-reminder="/g) || []).length === 3, 'the reminders are not all inside the line');
const cal = (await s.get('/admin/calendar')).text;
must(/<section class="card" data-reminders>/.test(cal) && !cal.includes('data-reminders-line'), 'the Calendar lost its open reminders box');
// 3. NEW.
must(/data-reqcard data-new/.test(cardOf(dash, rkA)) && /data-new-badge[^>]*>NEW</.test(cardOf(dash, rkA)), 'a new website request does not wear NEW');
must(/data-new-badge[^>]*>NEW</.test(cardOf(dash, rkB)), 'the second new request does not wear NEW');
const week = dash.slice(at('data-week-counts'), dash.indexOf('</section>', at('data-week-counts')));
const summary = week.slice(week.indexOf('<summary'), week.indexOf('</summary>'));
must(/Latest: Olive Other/.test(summary) && /data-new-count>2 NEW</.test(summary), `the week card's collapsed line does not name the latest and show "2 NEW": ${summary}`);
must((week.match(/data-new-count>NEW</g) || []).length === 2, 'the week list does not mark each new request NEW');
must(/requests\/opened/.test(dash) && /location\.hash/.test(dash), 'the page does not clear NEW when a card is opened or reached from the email link');
must(before.every((r) => dash.includes(`id="c-${s.rk(r.request_key)}"`) && !cardOf(dash, s.rk(r.request_key)).includes('data-new-badge')), 'a request stored (and backfilled) before 16 Oct wears NEW, or is missing from the list');
// Badge tap.
const tap = await s.post('/admin/requests/opened', { r: rkA, how: 'badge' });
must(tap.status === 200 && JSON.parse(tap.text).recorded === true, 'tapping the badge did not record it');
must(JSON.parse((await s.post('/admin/requests/opened', { r: rkA })).text).recorded === false, 'opening twice records twice');
dash = (await s.get('/admin/')).text;
must(!cardOf(dash, rkA).includes('data-new-badge') && cardOf(dash, rkB).includes('data-new-badge'), 'NEW did not clear on the tapped card only');
must(/data-new-count>NEW</.test(dash.slice(dash.indexOf('<summary', dash.indexOf('data-week-counts')), dash.indexOf('</summary>', dash.indexOf('data-week-counts')))), 'the week line does not drop to one NEW');
// Edit opens it.
await s.get(`/admin/requests/edit?r=${rkB}`);
dash = (await s.get('/admin/')).text;
must(!cardOf(dash, rkB).includes('data-new-badge') && !/data-new-count/.test(dash.slice(dash.indexOf('data-week-counts'), dash.indexOf('</section>', dash.indexOf('data-week-counts')))), 'opening Edit did not clear NEW');
// Acted on: an invoice clears it with no tap.
const c = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', event_date: plus(14), location: 'Bartlett', name: 'Pia Paid', phone: '(901) 555-0163', email: 'pia.paid@example.com' });
const reqs = await (await mod('functions/_lib/requests.mjs')).loadRequests(env, { fresh: true });
const pia = reqs.find((r) => r.key === c.row.request_key);
must(cardOf((await s.get('/admin/')).text, s.rk(pia.key)).includes('data-new-badge'), 'the third request is not NEW before it is acted on');
await s.invoiceFor(pia, { go: 'send' });
must(!cardOf((await s.get('/admin/')).text, s.rk(pia.key)).includes('data-new-badge'), 'sending an invoice did not clear NEW');
// A website RENTAL: the draft invoice made at submit must not clear NEW (19 Oct 2026 repair).
const rent = await s.siteRequest({ service: 'rentals', games: ['giant-uno'], duration: 'day', rental_date: plus(21), pickup_when: 'morning', return_when: 'after', name: 'Rhea Rental', phone: '(901) 555-0164', email: 'rhea.rental@example.com' });
const rentSt = rent.row && await s.one('SELECT status, invoice_id FROM request_status WHERE request_key = ?1', rent.row.request_key);
must(rent.status === 303 && rentSt && rentSt.status === 'new' && rentSt.invoice_id, `the rental test request did not get its automatic draft invoice: ${JSON.stringify(rentSt)}`);
const rkR = s.rk(rent.row.request_key);
must(cardOf((await s.get('/admin/')).text, rkR).includes('data-new-badge'), 'a website rental request with its automatic draft invoice does not wear NEW');
// System history lines (hold expired, mailer, auto-booked takedown) must not clear it.
for (const who of ['automatic', 'admin', 'mailer', 'website form']) await s.db.prepare('INSERT INTO request_events (request_key, who, what) VALUES (?1, ?2, ?3)').bind(rent.row.request_key, who, `system line by ${who}`).run();
must(cardOf((await s.get('/admin/')).text, rkR).includes('data-new-badge'), 'a system history line cleared NEW on the rental');
// Status past New clears it with no tap; putting it back to New restores it; put away clears it.
await s.db.prepare("UPDATE request_status SET status = 'deposit_paid' WHERE request_key = ?1").bind(rent.row.request_key).run();
must(!cardOf((await s.get('/admin/')).text, rkR).includes('data-new-badge'), 'a status past New did not clear NEW');
await s.db.prepare("UPDATE request_status SET status = 'new', archived_at = datetime('now') WHERE request_key = ?1").bind(rent.row.request_key).run();
must(!cardOf((await s.get('/admin/')).text, rkR).includes('data-new-badge'), 'a put-away request wears NEW');
await s.db.prepare('UPDATE request_status SET archived_at = NULL WHERE request_key = ?1').bind(rent.row.request_key).run();
must(cardOf((await s.get('/admin/')).text, rkR).includes('data-new-badge'), 'the rental did not wear NEW again once back to New and not put away');
// Opened clears it.
await s.post('/admin/requests/opened', { r: rkR, how: 'card' });
must(!cardOf((await s.get('/admin/')).text, rkR).includes('data-new-badge'), 'opening the rental card did not clear NEW');
// Migration 0017: un-opens only the 0016 backfill, only for recent still-New website requests.
const mig17 = fs.readFileSync(path.join(ROOT, 'migrations/0017_request_opened_repair.sql'), 'utf8');
must(/DELETE FROM request_opened/.test(mig17) && /how = 'before the NEW badge'/.test(mig17) && !/DROP|UPDATE|INSERT/i.test(mig17.replace(/^--.*$/gm, '')), 'migration 0017 is not a narrow delete of the 0016 backfill');
const seed = [['m17|recent', 'site', '2026-10-19 16:00:00', null, 'before the NEW badge'], ['m17|recentnew', 'site', '2026-10-17 09:00:00', 'new', 'before the NEW badge'],
  ['m17|old', 'site', '2026-10-10 09:00:00', null, 'before the NEW badge'], ['m17|paid', 'site', '2026-10-18 09:00:00', 'paid', 'before the NEW badge'],
  ['m17|phone', 'phone', '2026-10-18 09:00:00', null, 'before the NEW badge'], ['m17|away', 'site', '2026-10-18 09:00:00', 'new', 'before the NEW badge'],
  ['m17|real', 'site', '2026-10-19 10:00:00', null, 'badge']];
for (const [k, src, at, st, how] of seed) {
  await s.db.prepare("INSERT INTO requests (request_key, source, submitted_at, services, name, email, phone, answers) VALUES (?1, ?2, ?3, '[\"party\"]', 'M Seventeen', '', '9015550199', '[]')").bind(k, src, at).run();
  if (st) await s.db.prepare('INSERT INTO request_status (request_key, status, archived_at) VALUES (?1, ?2, ?3)').bind(k, st, k === 'm17|away' ? '2026-10-19' : null).run();
  await s.db.prepare('INSERT INTO request_opened (request_key, how) VALUES (?1, ?2)').bind(k, how).run();
}
await s.db.exec(mig17.replace(/^--.*$/gm, '').replace(/\s+/g, ' ').trim());
const left = new Set((await s.all("SELECT request_key FROM request_opened WHERE request_key LIKE 'm17|%'")).map((r) => r.request_key));
must(!left.has('m17|recent') && !left.has('m17|recentnew'), 'migration 0017 left the backfill on a recent still-New website request');
must(['m17|old', 'm17|paid', 'm17|phone', 'm17|away', 'm17|real'].every((k) => left.has(k)), `migration 0017 removed a row it must keep: kept ${[...left].join(',')}`);
// A phone request never.
const ph = await s.db.prepare("INSERT INTO requests (request_key, source, submitted_at, services, name, email, phone, answers) VALUES ('phone|2026-10-19|9015550100', 'phone', datetime('now'), '[\"party\"]', 'Phone Caller', '', '9015550100', '[]')").run();
must(ph && !cardOf((await s.get('/admin/')).text, s.rk('phone|2026-10-19|9015550100')).includes('data-new-badge'), 'a phone-call request wears NEW');
// Help entries exist for the new controls.
const H = await mod('functions/_lib/helptext.mjs');
must(H.HELP['req.new'] && H.HELP['req.reminders'], 'the NEW badge or the reminders line has no help entry');

if (checks < 25) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`requests on a phone: FAIL (${errors.length} of ${checks})\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`requests on a phone: OK (${checks} checks)`);
