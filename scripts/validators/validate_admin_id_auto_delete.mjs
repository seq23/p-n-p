#!/usr/bin/env node
/**
 * IDs delete themselves after 90 days (owner decision and approved mock-up "ID Auto Delete",
 * 20 Oct 2026; functions/_lib/id-auto.mjs, docs/admin-console.md, migration 0022). Fails when:
 *  1. the ONE ready test drifts: paid in full (rentals: games back) or cancelled (void) is ready;
 *     money owed or games out is not;
 *  2. the day drifts: 90 days after the Memphis day it became ready, a later "kept until" wins, kept
 *     forever and Google-form (Drive) IDs never delete themselves; the row words drift ("Deletes
 *     itself on <day> (in N days)", ⏳ within 7 days only, "🔒 Kept until <day>, then deletes
 *     itself", the Drive sentence);
 *  3. on the real routes (in-memory database): the main page box does not list exactly the ready
 *     IDs with Delete now / Keep this ID longer (Change how long when kept) / the keep choices /
 *     ✕ Close, change nothing, or the Drive row lacks Open ID folder + I deleted it; the clock does
 *     not start on first sight, or the cron does not stop it when a job stops being ready;
 *  4. switch-on deletes anything (IDs already ready start their 90 days that day), the cron deletes
 *     before day 90, a kept or kept-forever ID, a Google-form ID, or an ID no longer ready; or a due
 *     ID is not deleted through the manual path (R2 object gone, id_deleted_at, id_object NULL,
 *     id_deleted_auto, the history line); the card does not then say "ID: deleted automatically on";
 *  5. "Keep it longer" from the email changes anything on GET, or the keep POST does not save,
 *     log and land back on the box;
 *  6. the 7 AM email's last box ("🪪 IDs that delete themselves this week") is missing, red, in the
 *     subject, not after Tomorrow and Tidy up, lists an ID more than 7 days away or a Drive ID, or
 *     the plain text lacks it; the All clear email drops it;
 *  7. the mailer cron does not run it (or lacks the IDS binding), the migration is not additive
 *     only, the help entries are missing, or any file still says IDs are never deleted by themselves.
 * Rule 0: fewer than 90 checks, or zero rows / zero deletions where some are expected, is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const IA = await mod('functions/_lib/id-auto.mjs');
const V = await mod('functions/_lib/views.mjs');
const H = await mod('functions/_lib/helptext.mjs');
const TE = await mod('functions/_lib/todo-email.mjs');
const R = await mod('functions/_lib/reminders.mjs');
const { addDays } = await mod('functions/_lib/calendar.mjs');
const DAY = 86400000;

// ---- 1. the one ready test ---------------------------------------------------------------------
const bal = (o = {}) => ({ total: 11000, remaining: 0, void: false, ...o });
const porch = { wantsRentals: false }; const rent = { wantsRentals: true };
must(IA.readyToDeleteId(porch, { status: 'paid' }, { balance: bal() }, null) === true, 'paid in full is not ready');
must(IA.readyToDeleteId(porch, { status: 'deposit_paid' }, { balance: bal({ remaining: 5000 }) }, null) === false, 'money owed is ready');
must(IA.readyToDeleteId(rent, { status: 'paid' }, { balance: bal() }, null) === false, 'a rental with the games out is ready');
must(IA.readyToDeleteId(rent, { status: 'paid' }, { balance: bal() }, { returned_at: '2026-10-01 12:00:00' }) === true, 'a paid rental with the games back is not ready');
must(IA.readyToDeleteId(porch, { status: 'void' }, { balance: bal({ remaining: 5000 }) }, null) === true, 'a cancelled (void) job is not ready');
must(IA.readyToDeleteId(rent, { status: 'invoiced' }, { balance: bal({ void: true, remaining: 0 }) }, null) === true, 'a voided invoice is not ready');
must(IA.readyToDeleteId(porch, { status: 'paid' }, null, null) === true && IA.readyToDeleteId(porch, { status: 'new' }, null, null) === false, 'no invoice: only status paid is ready');
must(IA.readyToDeleteId(porch, { status: 'paid' }, { balance: bal({ total: 0 }) }, null) === false, 'a $0 invoice is ready');
const A = await mod('functions/_lib/admin.mjs');
must(A.readyToDeleteId === IA.readyToDeleteId, 'admin.mjs keeps its own ready test (two lists)');

// ---- 2. the day and the words ------------------------------------------------------------------
const T = '2026-10-20';
const site = (o = {}) => ({ source: 'site', idObject: 'ids/a.jpg', idReadySince: '2026-10-19 17:00:00', idKeepUntil: '', idKeepForever: false, ...o });
must(IA.ID_AUTO_DAYS === 90 && IA.ID_WARN_DAYS === 7, 'the 90 / 7 days drifted');
must(IA.deleteDay(site(), T) === addDays('2026-10-19', 90), `deleteDay is not 90 days after the ready day (${IA.deleteDay(site(), T)})`);
must(IA.deleteDay(site({ idReadySince: '2026-10-20 03:00:00' }), T) === addDays('2026-10-19', 90), 'deleteDay does not use the Memphis day (03:00 UTC is the day before in Memphis)');
must(IA.deleteDay(site({ idReadySince: '' }), T) === addDays(T, 90), 'an ID not clocked yet does not read as ready today');
must(IA.deleteDay(site({ idKeepUntil: '2027-03-01' }), T) === '2027-03-01' && IA.deleteDay(site({ idKeepUntil: '2026-11-01' }), T) === addDays('2026-10-19', 90), 'kept until: the later day does not win');
must(IA.deleteDay(site({ idKeepForever: true }), T) === '' && IA.deleteDay(site({ source: 'google_form' }), T) === '', 'kept forever / a Drive ID has a delete day');
must(IA.deleteDay(site({ source: 'phone' }), T) !== '', 'a phone-added ID (private storage) never deletes itself');
const w89 = IA.idRowState(site(), T);
must(w89.kind === 'due' && w89.days === 89 && w89.words === `Deletes itself on ${R.dayWords(addDays('2026-10-19', 90))} (in 89 days)` && !w89.soon, `the row words drifted: "${w89.words}"`);
const soonR = site({ idReadySince: `${addDays(T, -84)} 17:00:00` }); const w6 = IA.idRowState(soonR, T);
must(w6.soon && w6.days === 6 && w6.words === `⏳ Deletes itself on ${R.dayWords(addDays(T, 6))} (in 6 days)`, `within 7 days is not ⏳: "${w6.words}"`);
const w7 = IA.idRowState(site({ idReadySince: `${addDays(T, -83)} 17:00:00` }), T); const w8 = IA.idRowState(site({ idReadySince: `${addDays(T, -82)} 17:00:00` }), T);
must(w7.soon && !w8.soon && w8.days === 8, '⏳ is not exactly 7 days or fewer');
must(IA.idRowState(site({ idReadySince: `${addDays(T, -89)} 17:00:00` }), T).words.endsWith('(in 1 day)') && IA.idRowState(site({ idReadySince: `${addDays(T, -90)} 17:00:00` }), T).words.endsWith('(today)'), '1 day / today words drifted');
const wk = IA.idRowState(site({ idKeepUntil: '2027-02-15' }), T);
must(wk.kind === 'kept' && wk.words === `🔒 Kept until ${R.dayWords('2027-02-15')}, then deletes itself`, `kept words drifted: "${wk.words}"`);
must(IA.idRowState(site({ idKeepForever: true }), T).words === '🔒 Kept until you delete it yourself', 'kept-forever words drifted');
must(IA.idRowState(site({ source: 'google_form' }), T).words === "📁 This one is in your Google Drive ID folder. It can't delete itself.", 'the Drive words drifted');

// ---- 3-5. real routes ---------------------------------------------------------------------------
const s = await session();
const env = s.env;
const plus = (n) => addDays(R.chicagoDate(), n);
const mkReq = async (n, fields) => {
  const r = await s.siteRequest({ name: `Ida Auto${n}`, phone: `901-555-07${10 + n}`, email: `ida${n}@example.com`, heard: 'Google', rules_version: '2026-10-19', ...fields });
  must(r.row && r.row.id_object && env.idObjects.has(r.row.id_object), `request ${n}: the site ID photo was not stored`);
  return r.row;
};
const porchF = (n) => ({ service: 'porch', porch_season: 'Fall / Halloween', porch_takedown: 'not_sure', event_date: plus(20 + n), location: 'Germantown' });
const payInFull = async (row) => {
  const st = await s.one('SELECT invoice_id FROM request_status WHERE request_key = ?1', row.request_key);
  const id = st && st.invoice_id ? st.invoice_id : (await s.one('SELECT id FROM invoices WHERE request_key = ?1 ORDER BY id DESC', row.request_key) || {}).id;
  must(Boolean(id), `${row.name}: no invoice to pay`);
  // The auto draft has no price yet (porch packages are priced at the walk-through): give it one.
  await s.db.prepare('UPDATE invoice_lines SET unit_cents = 25000 WHERE invoice_id = ?1 AND unit_cents = 0').bind(id).run();
  await s.post(`/admin/invoices/${id}/status`, { action: 'texted' });
  await s.post(`/admin/invoices/${id}/status`, { action: 'paid', method: 'zelle' });
  return id;
};
const rA = await mkReq(1, porchF(1)); // paid in full -> ready
const rB = await mkReq(2, porchF(2)); // owes -> not ready
const rC = await mkReq(3, porchF(3)); // cancelled -> ready, then not cancelled after all
const rE = await mkReq(4, porchF(4)); // paid in full, then 90 days pass -> deleted by itself
await payInFull(rA); await payInFull(rE);
await s.post('/admin/requests/cancel', { r: s.rk(rC.request_key) });
// The Google-form fixture request, cancelled: ready, but it lives in Drive.
const gf = await s.one("SELECT request_key, id_file FROM requests WHERE source = 'google_form' LIMIT 1");
must(Boolean(gf && gf.id_file), 'Rule 0: no Google-form request with a Drive ID in the fixture, so the Drive row goes untested');
await s.db.prepare("INSERT INTO request_status (request_key, status, updated_at) VALUES (?1, 'void', datetime('now')) ON CONFLICT(request_key) DO UPDATE SET status = 'void'").bind(gf.request_key).run();
const readyCol = async (k) => (await s.one('SELECT id_ready_since AS t FROM requests WHERE request_key = ?1', k)).t;
must(!(await readyCol(rA.request_key)), 'the clock started before anything saw the ID ready');

let dash = await s.get('/admin/');
const box = (html) => { const i = html.indexOf('data-ids-ready'); return i < 0 ? '' : html.slice(i, html.indexOf('</section>', i)); };
let b = box(dash.text);
must(b.length > 0 && /id="ids-ready"/.test(dash.text), 'the main page has no "IDs ready to delete" box (#ids-ready)');
// Owner, 24 Oct 2026: the box is a closed accordion, "Delete customer ID photos (N ready)", that
// #ids-ready (where every button lands) opens again; deleting still asks first (below).
must(/<details class="fold idsfold" id="ids-fold" data-ids-fold><summary data-help="ids\.fold"[^>]*><span>Delete customer ID photos <small class="muted">\(\d+ ready\)<\/small>/.test(b) && !/<details class="fold idsfold"[^>]* open/.test(b) && b.includes('Tap to open ▾'), 'the ID photos box is not a closed "Delete customer ID photos (N ready) · Tap to open ▾" accordion');
must(/if\(location\.hash==='#ids-ready'\)\{var d=document\.getElementById\('ids-fold'\);if\(d\)d\.open=true;\}/.test(dash.text) && /addEventListener\('hashchange',ids\)/.test(dash.text), 'landing on #ids-ready does not open the ID photos accordion');
const rowOf = (html, name) => { const i = html.indexOf(`<strong>${name}`); return i < 0 ? '' : html.slice(i, (html.indexOf('data-id-ready', i) + 1 || html.length + 1) - 1); };
const rows = (b.match(/data-id-ready/g) || []).length;
must(rows >= 3, `Rule 0: the box has ${rows} rows, expected the paid, the cancelled and the Drive one`);
must(b.includes('Ida Auto1') && b.includes('Ida Auto3') && b.includes('Ida Auto4') && !b.includes('Ida Auto2'), 'the box does not list exactly the ready IDs (paid in full, cancelled; not the one still owing)');
must(b.includes('Each one deletes itself 90 days after it lands here. You can delete sooner or keep one longer.'), 'the box lacks its one-line explanation');
const day90 = addDays(R.chicagoDate(), 90);
const ra = rowOf(b, 'Ida Auto1');
must(ra.includes(`Deletes itself on <b>${R.dayWords(day90)}</b> (in 90 days)`) && /data-id-when="due"/.test(ra), `the paid row does not say its day in words: ${ra.slice(0, 300)}`);
must(/<summary class="btn ghost"[^>]*data-help="ids.deleteNow"[^>]*>Delete now<\/summary>/.test(ra) && ra.includes('Delete Ida&#39;s ID for good?') && ra.includes('The photo is gone forever. This can&#39;t be undone.') && ra.includes('>Yes, delete it for good<') && ra.includes('>✕ No, go back<'), 'Delete now does not ask first with the approved words');
must(/<input type="hidden" name="from" value="ids">/.test(ra) && ra.includes('action="/admin/requests/id/delete"'), 'Delete now does not land back on the box');
must(/>Keep this ID longer<\/summary>/.test(ra) && ra.includes('Keep Ida&#39;s ID longer?') && ra.includes('For example, if there is a damage question still open.'), 'Keep this ID longer is missing or lacks its question');
for (const [how, words] of IA.KEEP_CHOICES) must(ra.includes(`name="how" value="${how}"`) && ra.includes(`>${words}<`), `the keep choice "${words}" is missing`);
must(IA.KEEP_CHOICES.map(([, w]) => w).join('|') === 'Keep 30 more days|Keep 90 more days|Keep until I delete it myself' && ra.includes('>✕ Close, change nothing<'), 'the keep choices are not the approved four');
const rg = b.slice(b.indexOf('data-id-kind="drive"'));
must(b.includes('data-id-kind="drive"') && rg.includes("📁 This one is in your Google Drive ID folder. It can&#39;t delete itself.") && />Open ID folder<\/a>/.test(rg) && />I deleted it<\/summary>/.test(rg) && !/Deletes itself on/.test(rg.slice(0, rg.indexOf('</div></div>'))), 'the Drive row is not the approved one (sentence, Open ID folder, I deleted it, no day)');
must(!/#b42318|#8f3427;border|class="[^"]*\bred\b/.test(b.replace(/class="btn danger"/g, '')), 'the box uses red outside the confirm Yes button');
const tA = await readyCol(rA.request_key); const tC = await readyCol(rC.request_key);
must(Boolean(tA && tC), 'the main page did not start the clock on the ready IDs');
must(!(await readyCol(rB.request_key)) && !(await readyCol(gf.request_key)), 'the clock started on an ID still owing or a Drive ID');

// 4. switch-on: IDs already ready start today -> nothing deleted now, nothing at day 89.
const now0 = Date.now();
const objsBefore = env.idObjects.size;
const first = await IA.autoDeleteIds(env, { now: now0 });
must(first.ok && first.deleted === 0 && env.idObjects.size === objsBefore, `switch-on deleted something: ${JSON.stringify(first)}`);
must((await IA.autoDeleteIds(env, { now: now0 + 89 * DAY, dryRun: true })).wouldDelete === 0, 'something would delete before day 90');
const at90 = await IA.autoDeleteIds(env, { now: now0 + 90 * DAY + DAY / 2, dryRun: true });
must(at90.wouldDelete >= 3, `Rule 0: on day 90 the dry run would delete ${at90.wouldDelete}, expected the paid two and the cancelled one`);
must((await s.one('SELECT COUNT(*) AS n FROM requests WHERE id_deleted_at IS NOT NULL')).n === 0, 'a dry run deleted something');

// 5. Keep it longer: GET is a confirm screen, POST saves.
const snap = async (k) => JSON.stringify(await s.one('SELECT id_keep_until, id_keep_forever, id_ready_since, id_object FROM requests WHERE request_key = ?1', k));
const before = await snap(rA.request_key);
const kp = await s.get(`/admin/requests/id/keep?r=${s.rk(rA.request_key)}`);
must(kp.status === 200 && kp.text.includes('Keep Ida&#39;s ID longer?') && (kp.text.match(/action="\/admin\/requests\/id\/keep"/g) || []).length === 3 && kp.text.includes('✕ Close, change nothing') && kp.text.includes('href="/admin/#ids-ready"'), 'the email keep screen is not the confirm screen (3 choices + Close)');
must((await snap(rA.request_key)) === before, 'opening Keep it longer (GET) changed something');
must((await s.get(`/admin/requests/id/keep?r=${s.rk(rA.request_key)}`, { auth: false })).status === 303, 'the keep screen is reachable signed out');
must((await s.get(`/admin/requests/id/keep?r=${s.rk(gf.request_key)}`)).status === 404, 'a Drive ID can be kept longer (it never deletes itself)');
const bad = await s.post('/admin/requests/id/keep', { r: s.rk(rA.request_key), how: '9999' });
must(/#ids-ready$/.test(bad.location) && (await snap(rA.request_key)) === before, 'a made-up keep choice changed something');
const k30 = await s.post('/admin/requests/id/keep', { r: s.rk(rA.request_key), how: '30', from: 'ids' });
const keptRow = await s.one('SELECT id_keep_until FROM requests WHERE request_key = ?1', rA.request_key);
must(k30.status === 303 && /#ids-ready$/.test(k30.location) && keptRow.id_keep_until === addDays(day90, 30), `Keep 30 more days did not save day 90 + 30 and land on the box (${keptRow.id_keep_until}, ${k30.location})`);
must(decodeURIComponent(k30.location).includes(`Kept ✓ It now deletes itself on ${R.dayWords(addDays(day90, 30))}.`), 'Keep 30 more days does not say the new day');
must(Boolean(await s.one('SELECT 1 AS x FROM request_events WHERE request_key = ?1 AND what LIKE ?2', rA.request_key, 'ID kept 30 more days%')), 'keeping an ID is not in its history');
dash = await s.get('/admin/'); b = box(dash.text);
const rak = rowOf(b, 'Ida Auto1');
must(rak.includes(`🔒 Kept until <b>${R.dayWords(addDays(day90, 30))}</b>, then deletes itself`) && />Change how long<\/summary>/.test(rak) && /data-id-when="kept"/.test(rak), 'a kept row does not say "🔒 Kept until <day>, then deletes itself" with Change how long');
const k90 = await s.post('/admin/requests/id/keep', { r: s.rk(rA.request_key), how: '90' });
must(k90.status === 303 && (await s.one('SELECT id_keep_until FROM requests WHERE request_key = ?1', rA.request_key)).id_keep_until === addDays(day90, 120), 'Keep 90 more days does not add to the kept day');

// The cron stops the clock when a job stops being ready (not cancelled after all).
await s.post('/admin/requests/uncancel', { r: s.rk(rC.request_key) });
const r2 = await IA.autoDeleteIds(env, { now: now0 });
must(r2.clockCleared >= 1 && !(await readyCol(rC.request_key)), `the cron did not stop the clock of a job no longer ready (${JSON.stringify(r2)})`);
must(Boolean(await readyCol(rA.request_key)) && (await readyCol(rA.request_key)) === tA, 'the cron moved the clock of an ID still ready');
must(!box((await s.get('/admin/')).text).includes('Ida Auto3'), 'a job no longer ready is still in the box');

// Day 91: the paid E deletes itself; A (kept), C (not ready), B (owes) and the Drive ID do not.
await s.db.prepare("UPDATE requests SET id_ready_since = datetime('now', '-100 days') WHERE source = 'google_form'").run();
const eObj = (await s.one('SELECT id_object FROM requests WHERE request_key = ?1', rE.request_key)).id_object;
const r91 = await IA.autoDeleteIds(env, { now: now0 + 91 * DAY });
must(r91.ok && r91.deleted === 1, `Rule 0: on day 91 the cron deleted ${r91.deleted}, expected exactly the paid, not-kept one (${JSON.stringify(r91)})`);
const eRow = await s.one('SELECT id_object, id_deleted_at, id_deleted_auto FROM requests WHERE request_key = ?1', rE.request_key);
must(!env.idObjects.has(eObj) && eRow.id_object === null && eRow.id_deleted_at && eRow.id_deleted_auto === 1, `the due ID was not deleted the manual way (R2, id_deleted_at, id_object NULL, auto): ${JSON.stringify(eRow)}`);
must(Boolean(await s.one('SELECT 1 AS x FROM request_events WHERE request_key = ?1 AND what = ?2', rE.request_key, 'ID photo deleted for good automatically (90 days after it was ready)')), 'the automatic delete is not in the history with the approved words');
for (const [k, why] of [[rA.request_key, 'kept'], [rB.request_key, 'still owing'], [rC.request_key, 'no longer ready']]) {
  const row = await s.one('SELECT id_object, id_deleted_at FROM requests WHERE request_key = ?1', k);
  must(row.id_object && !row.id_deleted_at && env.idObjects.has(row.id_object), `the cron deleted an ID that is ${why}`);
}
const gRow = await s.one('SELECT id_file, id_deleted_at FROM requests WHERE request_key = ?1', gf.request_key);
must(gRow.id_file === gf.id_file && !gRow.id_deleted_at, 'the cron touched a Google-form (Drive) ID');
await s.post('/admin/requests/id/keep', { r: s.rk(rA.request_key), how: 'forever' });
must((await s.one('SELECT id_keep_forever AS f FROM requests WHERE request_key = ?1', rA.request_key)).f === 1, 'Keep until I delete it myself did not save');
must((await IA.autoDeleteIds(env, { now: now0 + 2000 * DAY, dryRun: true })).wouldDelete === 0, 'a kept-forever ID would delete itself');
must((await IA.autoDeleteIds({ ...env, IDS: undefined }, { now: now0 + 2000 * DAY })).ok === false, 'no IDS binding is not a named stop');

// The card afterwards, and the Edit page.
dash = await s.get('/admin/');
must(!box(dash.text).includes('Ida Auto4'), 'a deleted ID is still in the box');
const delDay = R.dayWords(R.chicagoDate(new Date(now0 + 91 * DAY)));
const cardE = dash.text.slice(dash.text.indexOf(`id="c-${s.rk(rE.request_key)}"`));
must(cardE.slice(0, 40000).includes(`<b>ID:</b> <span data-id-auto-deleted>deleted automatically on ${delDay}</span>`), 'the card does not say "ID: deleted automatically on <date>"');
const ed = await s.get(`/admin/requests/edit?r=${s.rk(rE.request_key)}`);
must(ed.text.includes(`ID: deleted automatically on ${delDay}.`), 'the Edit page does not say "ID: deleted automatically on <date>."');
const ended = V.dashboardPage({ requests: [{ ...(s.requests[0]), key: 'end|x', name: 'Riley Ended', services: ['porch'], idDeletedAt: '2026-10-26 15:00:00', idDeletedAuto: true, idObject: '', idFile: '' }], statuses: { 'end|x': { status: 'paid', done_at: '2026-10-20 15:00:00' } }, invoices: {}, checklists: {}, returns: {}, folderUrl: '', sheetError: '', flash: '', missingPayment: [], today: '2026-10-27' });
must(ended.includes(`data-id-auto-deleted>ID: <b>deleted automatically on ${R.dayWords('2026-10-26')}</b>`), 'a Done card does not say "ID: deleted automatically on <date>"');
// A new photo on a deleted ID starts fresh (no clock, no keep, not automatic).
must(V.idDeletedWords({ idDeletedAt: '2026-10-19 15:00:00' }).startsWith('ID photo deleted on'), 'the manual delete words changed');

// ---- 6. the 7 AM email -------------------------------------------------------------------------
const today = R.chicagoDate();
await s.db.prepare("UPDATE requests SET id_ready_since = datetime('now', '-85 days'), id_keep_until = NULL, id_keep_forever = 0 WHERE request_key = ?1").bind(rA.request_key).run();
const rF = await mkReq(5, porchF(5)); await payInFull(rF);
await s.db.prepare("UPDATE requests SET id_ready_since = datetime('now', '-80 days') WHERE request_key = ?1").bind(rF.request_key).run(); // 10 days away
const due = await IA.idsDueSoon(s.db, today);
if (!due.length) due.push({ r: { key: '' }, day: today });
must(due.length === 1 && due[0].r.key === rA.request_key, `Rule 0: idsDueSoon is not exactly the ID within 7 days (${due.map((x) => x.r.name)})`);
const d = await TE.todoData(s.db, today, Date.now());
const msg = TE.renderTodo(d);
const ib = msg.html.slice(msg.html.indexOf('data-ids-week'));
must(msg.html.includes('data-ids-week') && ib.includes('🪪 IDs that delete themselves this week') && ib.includes("Nothing to do if that&#39;s fine. It happens by itself."), 'the email lacks the IDs box with its title and its calm line');
must(ib.includes(`Ida A. — ${R.dayWords(due[0].day)}`) && !ib.includes('Ida A. — ' + R.dayWords(addDays(today, 10))), 'the email item is not "<First L.> — <day>" for exactly the ID within 7 days');
must(ib.includes(`href="https://porchandparty901.com/admin/requests/id/keep?r=${s.rk(rA.request_key)}"`) && ib.includes('>Keep it longer<') && ib.includes(`href="https://porchandparty901.com/admin/#c-${s.rk(rA.request_key)}"`) && ib.includes('>Open card<'), 'the email item lacks Keep it longer (the confirm screen) and Open card');
const pos = (k) => msg.html.indexOf(k);
must(pos('data-ids-week') > pos('data-tomorrow') && (pos('data-tidy') < 0 || pos('data-ids-week') > pos('data-tidy')) && pos('data-ids-week') < pos('This email comes every day'), 'the IDs box is not the last box (after Tomorrow and Tidy up, before the footer)');
must(!/#b42318|#fdecea/.test(ib.slice(0, ib.indexOf('</div></div>') + 12)) && !/IDs/.test(msg.subject), 'the IDs box is red or in the subject');
must(msg.text.includes('🪪 IDS THAT DELETE THEMSELVES THIS WEEK') && msg.text.includes(`- Ida A. — ${R.dayWords(due[0].day)}`) && msg.text.includes(`  Keep it longer: https://porchandparty901.com/admin/requests/id/keep?r=${s.rk(rA.request_key)}`) && msg.text.includes("Nothing to do if that's fine. It happens by itself."), 'the plain text lacks the IDs box');
const clear = TE.renderTodo({ today, tomorrow: addDays(today, 1), missed: [], tidy: [], sections: { 1: [], 2: [], 3: [], 4: [], 5: [] }, tomorrowJobs: [], week: null, ids: d.ids });
must(clear.html.includes('All clear today') && clear.html.includes('data-ids-week') && clear.text.includes('🪪 IDS THAT DELETE THEMSELVES THIS WEEK'), 'an All clear day drops the IDs box');
const none = TE.renderTodo({ ...d, ids: [] });
must(!none.html.includes('data-ids-week') && !none.text.includes('DELETE THEMSELVES'), 'the IDs box shows with nothing in it');

// ---- 7. wiring, migration, help, words ----------------------------------------------------------
const W = await mod('workers/pnp-mailer/src/index.js');
const sentMail = [];
const run = await W.runReminders({ ...env, EMAIL: { send: async (m) => { sentMail.push(m); return { messageId: 'x' }; } } }, new Date(Date.UTC(2026, 9, 21, 3, 0)));
must(run.ids && run.ids.ok === true && Number.isInteger(run.ids.deleted), `the mailer hourly run does not run the ID delete (${JSON.stringify(run.ids)})`);
const toml = fs.readFileSync(path.join(ROOT, 'workers/pnp-mailer/wrangler.toml'), 'utf8').replace(/#.*$/gm, '');
must(/\[\[r2_buckets\]\]\s*binding = "IDS"\s*bucket_name = "pnp-ids"/.test(toml) && /crons = \["0 \* \* \* \*"\]/.test(toml), 'the mailer lacks the IDS (pnp-ids) binding or its hourly cron');
const MIG = fs.readFileSync(path.join(ROOT, 'migrations/0022_id_auto_delete.sql'), 'utf8').replace(/--.*$/gm, '');
must(/ADD COLUMN id_ready_since TEXT;/.test(MIG) && /ADD COLUMN id_keep_until TEXT;/.test(MIG) && /ADD COLUMN id_keep_forever INTEGER NOT NULL DEFAULT 0;/.test(MIG) && /ADD COLUMN id_deleted_auto INTEGER NOT NULL DEFAULT 0;/.test(MIG)
  && (MIG.match(/ALTER TABLE requests ADD COLUMN/g) || []).length === 4 && !/\b(UPDATE|DELETE|DROP|INSERT|CREATE)\b/i.test(MIG), 'migration 0022 is not additive only (four requests columns)');
for (const k of ['ids.deleteNow', 'ids.deleteNowYes', 'ids.keep', 'ids.keep30', 'ids.keep90', 'ids.keepForever', 'ids.keepClose', 'ids.folder', 'ids.driveDone', 'ids.driveDoneYes']) must(Boolean(H.HELP[k] && H.HELP[k].title), `help entry ${k} is missing`);
must(/deletes itself 90 days/.test(H.HELP['card.idDelete'].more) && !/Nothing ever deletes an ID by itself/.test(H.HELP['card.idDelete'].more), 'the Delete this ID help still says nothing deletes an ID by itself');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = [...walk(path.join(ROOT, 'functions')), ...walk(path.join(ROOT, 'workers/pnp-mailer')), ...walk(path.join(ROOT, 'docs')).filter((f) => /\.(md|html|txt)$/.test(f)), path.join(ROOT, 'wrangler.toml')];
must(files.length > 50, 'Rule 0: the word scan read too few files');
const STALE = [/never automatic/i, /Nothing ever deletes an ID/i, /nothing deletes one (by itself|except)/i, /Nothing is ever deleted by itself/i, /is the only way an ID is ever deleted/i, /Nothing ever deletes an ID by itself/i];
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  for (const re of STALE) must(!re.test(t), `${path.relative(ROOT, f)} still says IDs are never deleted by themselves (${re})`);
}
const doc = fs.readFileSync(path.join(ROOT, 'docs/admin-console.md'), 'utf8');
must(doc.includes('## IDs delete themselves after 90 days') && doc.includes('validate:admin-id-auto-delete') && doc.includes('never deleted by the cron'), 'docs/admin-console.md lacks the IDs-delete-themselves section');

if (checks < 90) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`admin id auto delete: FAIL (${errors.length} of ${checks})`); for (const e of errors) console.error(`- ${e}`); process.exit(1); }
console.log(`admin id auto delete: OK (${checks} checks: one ready test incl. cancelled, 90-day clock from first sight, nothing deleted at switch-on, kept / kept forever / Drive never deleted, due ID deleted the manual way by the hourly cron with history, card words, keep screen and choices, the 7 AM email's last calm box, mailer IDS binding, additive migration)`);
