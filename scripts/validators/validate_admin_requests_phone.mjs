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
 *     or a phone-call request, or a request already in D1 before migration 0016, wears it.
 * Rule 0: fewer than 25 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT } from './lib/admin_harness.mjs';
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
must(RN.isNewRequest(site, { st: { status: 'invoiced' } }) === false && RN.isNewRequest(site, { st: { status: 'new', invoice_id: 3 } }) === false && RN.isNewRequest(site, { st: { status: 'new', archived_at: 'x' } }) === false, 'a request acted on (status, invoice, put away) is still NEW');
must(RN.isNewRequest(site, { events: [{ who: 'website form' }] }) === true && RN.isNewRequest(site, { events: [{ who: 'Valerie' }] }) === false, 'history from Valerie does not clear NEW, or the form\'s own history does');

// Migration 0016: additive, backfills every existing request as opened.
const mig = fs.readFileSync(path.join(ROOT, 'migrations/0016_request_opened.sql'), 'utf8');
must(/CREATE TABLE IF NOT EXISTS request_opened/.test(mig) && /INSERT OR IGNORE INTO request_opened[\s\S]*FROM requests/.test(mig) && !/DROP|DELETE|UPDATE requests/i.test(mig), 'migration 0016 is not additive with a backfill');

const s = await session();
const env = s.env;
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
const old = s.requests.find((r) => r.source !== 'phone');
must(!old || !cardOf(dash, s.rk(old.key)).includes('data-new-badge') || !(await s.one('SELECT 1 AS x FROM requests WHERE request_key = ?1', old.key)), 'a request stored before the badge wears NEW');
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
// A phone request never.
const ph = await s.db.prepare("INSERT INTO requests (request_key, source, submitted_at, services, name, email, phone, answers) VALUES ('phone|2026-10-19|9015550100', 'phone', datetime('now'), '[\"party\"]', 'Phone Caller', '', '9015550100', '[]')").run();
must(ph && !cardOf((await s.get('/admin/')).text, s.rk('phone|2026-10-19|9015550100')).includes('data-new-badge'), 'a phone-call request wears NEW');
// Help entries exist for the new controls.
const H = await mod('functions/_lib/helptext.mjs');
must(H.HELP['req.new'] && H.HELP['req.reminders'], 'the NEW badge or the reminders line has no help entry');

if (checks < 25) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`requests on a phone: FAIL (${errors.length} of ${checks})\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`requests on a phone: OK (${checks} checks)`);
