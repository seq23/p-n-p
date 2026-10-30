#!/usr/bin/env node
/**
 * Read-only owner feed for Boss OS (owner-approved 22 Oct 2026; functions/_lib/owner-feed.mjs,
 * functions/api/owner-feed.js). Fails when:
 *  1. ONE list drifts: for the same fixture (a busy Tuesday), the feed's items are not exactly the
 *     7 AM email's items, in the email's order (red box, sections 1-5, Tomorrow, Tidy up, IDs), or
 *     owner-feed.mjs computes its own list instead of mapping todoData() from todo-email.mjs;
 *  2. the shape drifts: anything but {generated_at, range, items[{kind, title, detail, due, link, optional actions}]},
 *     a kind outside deadline|money|renewal|id_delete|mark_done|post|other, a due that is not ISO
 *     or null, a link that is not an https URL or null;
 *  3. range=week lacks the "Your week" figures the Monday email shows (same rows), the jobs of the
 *     next 7 days, or the Marketplace renewal day; range=day shows a renewal on a non-renew day;
 *  4. auth drifts: no header, a wrong token, a token with the secret unset, or a Basic header gets
 *     anything but 401; the compare is not constant-time (hashed + XOR); any CORS header is sent;
 *     POST / OPTIONS are not 405; a bad range is not 400; the feed writes to the database;
 *  5. the route file is missing or does not use the handler.
 * Rule 0: fewer than 40 checks, or an empty part in the fixture, is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const T = await mod('functions/_lib/todo-email.mjs');
const OF = await mod('functions/_lib/owner-feed.mjs');
const { addDays } = await mod('functions/_lib/calendar.mjs');

// ---- the busy Tuesday fixture (the same shape validate:admin-todo-email uses) ------------------
const s = await session();
const db = s.db;
const TODAY = '2026-10-20';
const NOW = new Date(`${TODAY}T12:00:00Z`);
const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
const reqB = s.requests.find((r) => r.email === 'weekend.renter@example.com');
await run(`INSERT INTO invoices (number, customer_name, customer_phone, customer_email, issue_date, due_date, status) VALUES
  ('PNP-F-1', 'Alex Smithfield', '901-555-0201', 'alex@example.com', '2026-10-01', '2026-10-20', 'sent'),
  ('PNP-F-5', 'Lou Latepayer', '901-555-0205', 'lou@example.com', '2026-10-01', '2026-10-17', 'sent')`);
const inv = Object.fromEntries((await s.all("SELECT id, number FROM invoices WHERE number LIKE 'PNP-F-%'")).map((r) => [r.number, r.id]));
await run("INSERT INTO invoice_lines (invoice_id, description, qty, unit_cents, refundable) VALUES (?1, 'Party takedown', 1, 18000, 0), (?2, 'Grazing table', 1, 9000, 0)", inv['PNP-F-1'], inv['PNP-F-5']);
await db.prepare(`INSERT INTO bookings (kind, date, time, customer_name, phone, place, items, invoice_id) VALUES
  ('party_takedown', ?1, '10:00', 'Alex Smithfield', '901-555-0201', 'Germantown', 'the ladder', ?2),
  ('porch_install', ?1, NULL, 'Una Untimed', '901-555-0206', 'Cordova', '', NULL),
  ('rental_pickup', '2026-10-22', NULL, 'Dana Pickupday', '901-555-0208', '', 'Giant Uno', NULL),
  ('grazing_setup', '2026-10-21', '15:00', 'Tia Tomorrowby', '901-555-0210', '', '', NULL),
  ('porch_install', '2026-10-24', '11:00', 'Wes Weekahead', '901-555-0214', 'Collierville', '', NULL),
  ('rental_pickup', '2026-10-19', NULL, 'Pat Pastday', '901-555-0211', '', '', NULL),
  ('rental_return', '2026-10-18', NULL, 'Ollie Overdue', '901-555-0212', '', 'Cornhole set', NULL)`).bind(TODAY, inv['PNP-F-1']).run();
await run("INSERT INTO holds (request_key, state, until, by_hand) VALUES (?1, 'held', '2026-10-20 20:00:00', 0)", reqB.key);
// Called back but not booked (Book it or decide).
const reqA = s.requests.find((r) => r.email === 'test.renter@example.com');
await (await mod('functions/_lib/steps.mjs')).markCalled(db, reqA.key, { how: 'test' });
await run('DELETE FROM bookings WHERE request_key = ?1', reqA.key); // the fixture's own takedown booking
// An ID that deletes itself within 7 days: a paid, porch-only website request ready 85 days ago.
const ID_KEY = 'site|2026-07-20 17:00:00|feed.id@example.com';
await run(`INSERT INTO requests (request_key, source, submitted_at, services, name, email, phone, answers, id_object, id_type, id_size, id_ready_since)
  VALUES (?1, 'site', '2026-07-20 17:00:00', '["porch"]', 'Iris Idready', 'feed.id@example.com', '901-555-0215', '[]', 'ids/feed-test.jpg', 'image/jpeg', 10, ?2)`, ID_KEY, `${addDays(TODAY, -85)} 17:00:00`);
await run("INSERT INTO request_status (request_key, status, done_at) VALUES (?1, 'paid', datetime('now'))", ID_KEY);

// ---- 1. one list: the feed is the email's list, in order ---------------------------------------
const d = await T.todoData(db, TODAY, NOW.getTime());
const mail = T.renderTodo(d).text;
const env = { ...s.env, OWNER_FEED_TOKEN: 'f'.repeat(16) + 'a'.repeat(48) };
const before = JSON.stringify(await s.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"));
const counts = async () => JSON.stringify(await Promise.all(['requests', 'request_status', 'invoices', 'invoice_lines', 'payments', 'bookings', 'holds', 'settings', 'request_events'].map(async (t) => (await s.one(`SELECT COUNT(*) AS n FROM ${t}`)).n)));
const countsBefore = await counts();
const feed = await OF.buildOwnerFeed(env, 'day', NOW);
const parts = { missed: d.missed.length, s1: d.sections[1].length, s2: d.sections[2].length, s3: d.sections[3].length, s4: d.sections[4].length, s5: d.sections[5].length, tomorrow: d.tomorrowJobs.length, tidy: d.tidy.length, ids: d.ids.length };
for (const [k, n] of Object.entries(parts)) must(n > 0, `Rule 0: the fixture has no "${k}" items, so the parity check cannot see that part (${JSON.stringify(parts)})`);
const listed = feed.items.filter((x) => x.kind !== 'renewal');
const tidyTitles = new Set(d.tidy.map((t) => t.t));
const dashLines = mail.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
const nonTidy = listed.filter((x) => !(x.kind === 'mark_done' && tidyTitles.has(x.title)));
must(nonTidy.length === dashLines.length, `the feed lists ${nonTidy.length} items, the 7 AM email ${dashLines.length}`);
must(nonTidy.every((x, i) => dashLines[i] && dashLines[i].startsWith(x.title)), `the feed and the 7 AM email differ in items or order:\n  feed: ${JSON.stringify(nonTidy.map((x) => x.title))}\n  mail: ${JSON.stringify(dashLines)}`);
const tidyLine = mail.split('\n').find((l) => l.startsWith(`${T.TIDY_WORDS}:`)) || '';
must(d.tidy.length > 0 && d.tidy.every((t) => tidyLine.includes(t.t)) && listed.filter((x) => tidyTitles.has(x.title)).length === d.tidy.length, 'the Tidy up steps are not each a feed item and on the email\'s Tidy up line');
must(listed.length === Object.values(parts).reduce((a, b) => a + b, 0), `the feed has ${listed.length} items for ${JSON.stringify(parts)}`);
must(JSON.stringify(OF.feedItemsFromTodo(d)) === JSON.stringify(listed), 'buildOwnerFeed(day) is not feedItemsFromTodo(todoData()) (a second list)');
// Kinds per part.
const kindsOf = (pred) => [...new Set(listed.filter(pred).map((x) => x.kind))].join();
must(kindsOf((x) => d.sections[5].some((m) => m.t === x.title)) === 'money', 'Money items are not kind money');
must(kindsOf((x) => d.ids.some((m) => m.t === x.title)) === 'id_delete', 'ID items are not kind id_delete');
must(kindsOf((x) => tidyTitles.has(x.title)) === 'mark_done', 'Tidy up items are not kind mark_done');
must(listed.some((x) => x.kind === 'mark_done' && d.missed.some((m) => m.t === x.title)), 'a "not back yet" item is not kind mark_done');
must(kindsOf((x) => d.sections[1].some((m) => m.t === x.title) || d.sections[3].some((m) => m.t === x.title)) === 'deadline', "Today's jobs / Set a time are not kind deadline");
must(listed.filter((x) => d.sections[1].some((m) => m.t === x.title)).every((x) => x.due === TODAY), "Today's jobs are not due today");
must(listed.filter((x) => d.tomorrowJobs.some((m) => m.t === x.title)).every((x) => x.due === addDays(TODAY, 1)), 'Tomorrow is not due tomorrow');
const hold = listed.find((x) => /Waiting for deposit/.test(x.title));
must(hold && hold.due === '2026-10-20T20:00:00.000Z', `the hold's due is not its end time (${hold && hold.due})`);
must(feed.items.filter((x) => x.kind === 'renewal').length === 0, 'range=day shows a Marketplace renewal on a non-renew day');
// Static: owner-feed.mjs maps todoData, never its own queries.
const ofSrc = fs.readFileSync(path.join(ROOT, 'functions/_lib/owner-feed.mjs'), 'utf8');
must(/import \{ todoData, WEEK_ROWS \} from '\.\/todo-email\.mjs'/.test(ofSrc) && !/\.prepare\(|SELECT |INSERT |UPDATE |DELETE /.test(ofSrc), 'owner-feed.mjs queries the database itself instead of mapping todoData() (two lists)');

// ---- 2. shape ----------------------------------------------------------------------------------
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/;
must(JSON.stringify(Object.keys(feed)) === '["generated_at","range","items"]' && feed.range === 'day' && feed.generated_at === NOW.toISOString(), `the feed keys are ${JSON.stringify(Object.keys(feed))}`);
must(feed.items.every((x) => JSON.stringify(Object.keys(x)) === (x.actions ? '["kind","title","detail","due","link","actions"]' : '["kind","title","detail","due","link"]')), 'item keys drifted');
must(feed.items.filter((x) => x.actions).length > 0 && feed.items.filter((x) => x.actions).every((x) => x.actions[0].label === '✓ They paid the deposit' && x.actions[0].href === x.link && x.actions.every((a) => JSON.stringify(Object.keys(a)) === '["label","href"]' && /^https:\/\/porchandparty901\.com\/admin\//.test(a.href))), 'payment actions are missing, malformed or not first');
must(feed.items.every((x) => OF.FEED_KINDS.includes(x.kind)) && OF.FEED_KINDS.join() === 'deadline,money,renewal,id_delete,mark_done,post,other', 'a kind is outside the contract');
must(feed.items.every((x) => typeof x.title === 'string' && x.title && typeof x.detail === 'string'), 'a title is empty or a detail is not a string');
must(feed.items.every((x) => x.due === null || ISO.test(x.due)), `a due is not ISO or null: ${JSON.stringify(feed.items.map((x) => x.due))}`);
must(feed.items.every((x) => x.link === null || /^https:\/\/\S+$/.test(x.link)), 'a link is not an https URL or null');
must(feed.items.every((x) => !/tel:|sms:|901-555/.test(JSON.stringify(x))), 'a phone number is in the feed');

// ---- 3. week ------------------------------------------------------------------------------------
const wk = await OF.buildOwnerFeed(env, 'week', NOW);
must(wk.range === 'week', 'range=week does not say week');
const yw = wk.items.find((x) => x.title === 'Your week');
const dw = await T.todoData(db, TODAY, NOW.getTime(), { includeWeek: true });
must(yw && yw.detail === T.WEEK_ROWS(dw.week).map(([k, v]) => `${k}: ${v}`).join(' · '), 'range=week lacks the "Your week" figures (the Monday box rows)');
const mon = T.renderTodo(await T.todoData(db, '2026-10-26', Date.parse('2026-10-26T12:00:00Z')));
must(T.WEEK_ROWS(dw.week).every(([k]) => mon.text.includes(`- ${k}: `)), 'the Monday email does not carry the same Your week rows');
must(wk.items.some((x) => x.kind === 'deadline' && /Wes W\./.test(x.title) && x.due === '2026-10-24'), 'range=week lacks a job 4 days ahead');
must(wk.items.filter((x) => /Tia T\./.test(x.title)).length === 1, 'range=week lists tomorrow\'s job twice');
must(wk.items.filter((x) => x.kind === 'renewal').length === 1 && wk.items.find((x) => x.kind === 'renewal').due === '2026-10-23', 'range=week lacks the 23 Oct Marketplace renewal');
must(JSON.stringify(wk.items.slice(0, listed.length)) === JSON.stringify(listed), 'range=week does not start with the day list');
const fri = await OF.buildOwnerFeed(env, 'day', new Date('2026-10-23T12:00:00Z'));
must(fri.items.some((x) => x.kind === 'renewal' && x.due === '2026-10-23' && /facebook\.com\/marketplace/.test(x.link)), 'range=day on a renew day lacks the renewal');
must(await counts() === countsBefore && JSON.stringify(await s.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")) === before, 'building the feed changed the database');

// ---- 4. auth and the route ---------------------------------------------------------------------
const route = fs.readFileSync(path.join(ROOT, 'functions/api/owner-feed.js'), 'utf8');
must(/import \{ handleOwnerFeed \} from '\.\.\/_lib\/owner-feed\.mjs'/.test(route) && /onRequest = \(context\) => handleOwnerFeed\(context\)/.test(route), 'functions/api/owner-feed.js does not route to handleOwnerFeed');
const hit = async (method, q, headers = {}, e = env) => OF.handleOwnerFeed({ request: new Request(`https://porchandparty901.com/api/owner-feed${q}`, { method, headers: { Origin: 'https://evil.example', ...headers } }), env: e });
const good = { Authorization: `Bearer ${env.OWNER_FEED_TOKEN}` };
const r401 = [await hit('GET', '?range=day'), await hit('GET', '?range=day', { Authorization: 'Bearer wrong' }), await hit('GET', '?range=day', { Authorization: `Bearer ${env.OWNER_FEED_TOKEN}x` }),
  await hit('GET', '?range=day', { Authorization: `Basic ${env.OWNER_FEED_TOKEN}` }), await hit('GET', '?range=day', good, { ...env, OWNER_FEED_TOKEN: '' }), await hit('GET', '?range=day', { Authorization: 'Bearer ' }, { ...env, OWNER_FEED_TOKEN: undefined })];
must(r401.every((r) => r.status === 401), `a bad or missing token is not 401: ${r401.map((r) => r.status)}`);
const ok = await hit('GET', '?range=week', good);
const okJson = await ok.json();
must(ok.status === 200 && okJson.range === 'week' && Array.isArray(okJson.items) && okJson.items.length > 0, `the right token is not 200 with the week feed (${ok.status})`);
must((await hit('GET', '', good)).status === 200 && (await (await hit('GET', '', good)).json()).range === 'day', 'no range is not the day feed');
must((await hit('GET', '?range=month', good)).status === 400, 'a bad range is not 400');
must((await hit('POST', '?range=day', good)).status === 405 && (await hit('OPTIONS', '?range=day', good)).status === 405, 'POST / OPTIONS are not 405');
const hd = await hit('HEAD', '?range=day', good);
must(hd.status === 200 && !(await hd.text()), 'HEAD is not 200 with no body');
must([...r401, ok].every((r) => ![...r.headers.keys()].some((k) => k.startsWith('access-control-'))), 'the feed sends a CORS header');
must(/no-store/.test(ok.headers.get('Cache-Control') || '') && /noindex/.test(ok.headers.get('X-Robots-Tag') || '') && /application\/json/.test(ok.headers.get('Content-Type') || ''), 'the feed is cacheable, indexable or not JSON');
must(await OF.tokenMatches('a'.repeat(40), 'a'.repeat(40)) && !(await OF.tokenMatches('a'.repeat(40), 'a'.repeat(39) + 'b')) && !(await OF.tokenMatches('short', 'short')), 'tokenMatches is wrong (or accepts a secret under 32 characters)');
must(/crypto\.subtle\.digest\('SHA-256'/.test(ofSrc) && /diff \|= x\[i\] \^ y\[i\]/.test(ofSrc) && !/given === expected|=== expected/.test(ofSrc), 'the token compare is not constant-time (hash both, XOR every byte)');
must(!/Access-Control/i.test(ofSrc), 'owner-feed.mjs mentions a CORS header');
const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
must(!fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').includes('owner-feed') && robots.length > 0, 'the owner feed is in the sitemap');

if (checks < 40) errors.push(`Rule 0: only ${checks} checks ran (want >= 40)`);
if (errors.length) {
  console.error(`VALIDATION FAIL: owner feed (${errors.length} of ${checks} checks)`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`validate_owner_feed: OK (${checks} checks: the feed is the 7 AM email's list in order for one fixture, exact shape, week = Your week + next 7 days + renewal, 401 without the token, constant-time compare, no CORS, read-only)`);
