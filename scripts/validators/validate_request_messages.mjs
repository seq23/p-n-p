#!/usr/bin/env node
/**
 * Rental holds Valerie controls, and every message to customers (owner, 18 Oct 2026). Drives
 * the real public form, admin router, cron functions and mailer Worker over a fresh local
 * database (never production). Fails when:
 *  1. "Reserve their games longer" (owner-approved sample 20 Oct 2026; +N days, a picked Memphis day/time), "Keep holding" and
 *     "Release" do not do exactly that, or are not logged on the request;
 *  2. the hold reminder is not sent once per end time (and again after an extension);
 *  3. "Holds ending soon" (Requests, Calendar, tab badge, Held view, Day sheet) misses a hold,
 *     shows a held-by-hand one as ending, or is not soonest first;
 *  4. "Mark deposit received" on a held rental does not confirm the hold, email the
 *     confirmation exactly once, and open the "Text them it's confirmed" screen with the
 *     items, date and balance filled in; a tap is not recorded;
 *  5. the thank-you email is not sent the morning after Job done / Returned, once, or is sent
 *     for a job marked today, an undone job, a void request, "Don't send", or no email; the
 *     rental deposit line is wrong;
 *  6. the referral block lacks /r/<code>, the text/email/Facebook buttons or the plain-text
 *     part, any template says review / discount / % off, or a paid SMS provider appears;
 *  7. the mailer's hourly cron does not do the daily work at exactly 10 AM Memphis in both
 *     daylight and standard time;
 *  8. "Find a customer" does not say "Sent you N customers".
 * Rule 0: fewer than 50 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

const F = await mod('functions/_lib/request-form.mjs');
const H = await mod('functions/_lib/holds.mjs');
const M = await mod('functions/_lib/messages.mjs');
const CM = await mod('functions/_lib/customer-messages.mjs');
const A = await mod('functions/_lib/admin.mjs');
const C = await mod('functions/_lib/calendar.mjs');
const W = await mod('workers/pnp-mailer/src/index.js');
const VM = await mod('functions/_lib/views-messages.mjs');

const s = await session();
const today = F.chicagoToday();
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ev = async (key) => (await s.all('SELECT what FROM request_events WHERE request_key = ?1', key)).map((e) => e.what);
const rental = async (n, games, extra = {}) => {
  const r = await s.siteRequest({ service: 'rentals', games, duration: 'day', rental_date: plus(10 + n), pickup_when: 'morning', return_when: 'after', name: `Rita Rent${n}`, phone: `901-555-02${String(n).padStart(2, '0')}`, email: `rent${n}@example.com`, ...extra });
  if (r.status !== 303) errors.push(`rental ${n} was refused: ${r.text.slice(r.text.indexOf('rq-summary'), r.text.indexOf('rq-summary') + 300)}`);
  return r.row;
};

// ---- 1. Hold controls ------------------------------------------------------------------
const a = await rental(1, ['giant-uno']);
const h0 = await H.getHold(s.db, a.request_key);
// Owner, 19-20 Oct 2026: the hold is 48 hours from the request by default; "Reserve their games longer" adds 3 days
// (prefilled) on top of the CURRENT end time, or exactly the days she types; repeatable, no limit
// on how many times; every press logged. One source: services.json rentalHolds.
const HR = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8')).rentalHolds;
must(HR.defaultHours === 48 && HR.extendDays === 3, `services.json rentalHolds is not 48 hours / 3 days (${JSON.stringify(HR)})`);
must(Math.abs(H.fromSql(h0.until) - H.fromSql(a.submitted_at) - 48 * 3600000) < 5000, `a new hold is not 48 hours from the request (${a.submitted_at} -> ${h0.until})`);
const DAY = 24 * 3600000;
let r = await s.post('/admin/holds/extend', { r: s.rk(a.request_key), days: '3', back: '/admin/', card: '1' });
let h1 = await H.getHold(s.db, a.request_key);
const saidM = (loc) => { const m = /[?&]m=([^&#]*)/.exec(loc || ''); return m ? decodeURIComponent(m[1]) : ''; };
must(r.status === 303 && saidM(r.location) === `✓ Games reserved until ${VM.reservedWords(H.fromSql(h1.until))}` && /^✓ Games reserved until \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} (AM|PM)$/.test(saidM(r.location)) && /#c-/.test(r.location) && H.fromSql(h1.until) - H.fromSql(h0.until) === 3 * DAY, `Reserve their games longer (3 days, prefilled) did not add 3 days to the current end, or did not answer exactly "✓ Games reserved until <new date>" on the card (${h0.until} -> ${h1.until}, ${r.location})`);
await s.post('/admin/holds/extend', { r: s.rk(a.request_key), days: '3' });
const h2 = await H.getHold(s.db, a.request_key);
must(H.fromSql(h2.until) - H.fromSql(h0.until) === 6 * DAY, `two presses are not +6 days from the original end (${h0.until} -> ${h2.until})`);
await s.post('/admin/holds/extend', { r: s.rk(a.request_key), days: '5' });
const h3 = await H.getHold(s.db, a.request_key);
must(H.fromSql(h3.until) - H.fromSql(h2.until) === 5 * DAY, 'a typed 5 days did not add exactly 5 days on top of the current end');
await s.post('/admin/holds/extend', { r: s.rk(a.request_key) });
const h4 = await H.getHold(s.db, a.request_key);
must(H.fromSql(h4.until) - H.fromSql(h3.until) === 3 * DAY, 'Save with no number did not default to 3 days');
for (const bad of ['0', '-2', '2.5', 'abc']) {
  const x = await s.post('/admin/holds/extend', { r: s.rk(a.request_key), days: bad });
  must(/e=/.test(x.location) && (await H.getHold(s.db, a.request_key)).until === h4.until, `a typed "${bad}" days was accepted`);
}
must((await ev(a.request_key)).filter((e) => /^Hold extended to .* by Valerie$/.test(e)).length === 4, 'each extension is not logged "Hold extended to ... by Valerie"');
{
  // The approved sample: a two-line button, then inline "Held until <end>", [3] more days + Save,
  // a live "New date" line (server-rendered for 3, then the same formatter as she types), Cancel.
  const card = (await s.get('/admin/')).text;
  const one = (card.match(/<details class="reslonger" data-reserve-longer data-until-ms="(\d+)">[\s\S]*?<\/details>/g) || []).find((x) => x.includes(`value="${s.rk(a.request_key)}"`)) || '';
  const end = H.fromSql(h4.until);
  must(one && new RegExp(`data-until-ms="${end}"`).test(one)
    && /<summary class="btn ghost ressum" data-help="hold\.longer"[^>]*><b>Reserve their games longer<\/b><span class="ressub">Give more time to pay<\/span><\/summary>/.test(one)
    && one.includes(`<p class="muted" data-res-current>Held until ${VM.reservedWords(end)}</p>`)
    && /<input id="hdc?-[^"]+" type="number" name="days" value="3" min="1"[^>]*data-res-days[^>]*><label for="hdc?-[^"]+">more days<\/label>/.test(one)
    && /<button class="btn primary ressave" type="submit" data-help="hold\.go"[^>]*>Save<\/button>/.test(one)
    && one.includes(`<p class="resnew" data-res-new>New date: <b>${VM.reservedWords(end + 3 * DAY)}</b></p>`)
    && /<button class="rescancel" type="button" data-res-cancel data-help="hold\.cancel"[^>]*>Cancel<\/button>/.test(one)
    && card.includes('window.__pnpRes'),
  'the card does not carry the approved Reserve their games longer control (two-line button, Held until <end>, 3 more days + Save, live New date for +3 days, Cancel) after four extensions (it must be repeatable)');
  // The quick-texts menus (validate:admin-quick-texts) carry the approved text "Reminder: games held
  // until…" as a text to send; outside those menus the page may never say it.
  const qtMenus = card.match(/<template data-qt-menu>[\s\S]*?<\/template>/g) || [];
  must(qtMenus.length > 0 && qtMenus.every((m) => !/Hold longer|Give them more time|\+24 hours|\+48 hours|Hold until then|Keep holding|>Hold<\/button>|holdlonger|On hold until/.test(m) && (m.match(/[Gg]ames held until/g) || []).length === (m.match(/Reminder: games held until…/g) || []).length && (m.match(/<b>Reminder: games held until…<\/b>/g) || []).length <= 1), 'a quick-texts menu says an old hold wording, or "games held until" outside the one approved quick text');
  must(!/Hold longer|Give them more time|\+24 hours|\+48 hours|Hold until then|Keep holding|>Hold<\/button>|holdlonger|[Gg]ames held until|On hold until/.test(card.replace(/<template data-qt-menu>[\s\S]*?<\/template>/g, '')), 'the Requests page still shows "Hold longer", "Games held until" or an old 24/48 h choice');
  // The live "New date" line formats exactly like the server, across a daylight-saving change.
  const js = VM.RESERVE_JS;
  const fsrc = (/function words\(ms\)\{[\s\S]*?return day\+', '\+t;\}/.exec(js) || [''])[0];
  must(fsrc, 'the live New date script has no date formatter');
  const words = new Function(`${fsrc}; return words;`)();
  for (const ms of [Date.parse('2026-10-24T04:59:00Z'), Date.parse('2026-11-01T06:30:00Z'), Date.parse('2026-11-01T08:00:00Z'), Date.parse('2027-03-14T09:15:00Z'), Date.now()]) must(words(ms) === VM.reservedWords(ms), `the live New date reads "${words(ms)}" where the server says "${VM.reservedWords(ms)}"`);
  must(words(Date.parse('2026-10-24T04:59:00Z')) === 'Fri 23 Oct, 11:59 PM', `the sample date reads "${words(Date.parse('2026-10-24T04:59:00Z'))}", not "Fri 23 Oct, 11:59 PM"`);
  must(/addEventListener\('input'[\s\S]*data-res-days[\s\S]*upd\(box\)/.test(js) && /base\+n\*86400000/.test(js) && /Math\.max\(Date\.now\(\)/.test(js) && /data-res-cancel[\s\S]*box\.open=false/.test(js), 'the New date line does not follow what she types (current end, or now, + N days) or Cancel does not close the box');
  must(VM.reserveNewEnd(end, 5, Date.now()) === end + 5 * DAY && VM.reserveNewEnd(NaN, 3, 1000) === 1000 + 3 * DAY && VM.reserveNewEnd(500, 3, 1000) === 1000 + 3 * DAY, 'the New date is not current end (or now) + N days');
}
// Picked Memphis times: daylight (UTC-5) and standard (UTC-6).
must(A.chicagoLocalToMs('2026-10-26T15:00') === Date.parse('2026-10-26T20:00:00Z') && A.chicagoLocalToMs('2026-12-01T15:00') === Date.parse('2026-12-01T21:00:00Z'), 'a picked day and time is not read as Memphis time');
const future = `${plus(5)}T15:00`;
await s.post('/admin/holds/extend', { r: s.rk(a.request_key), until: future });
must(H.fromSql((await H.getHold(s.db, a.request_key)).until) === A.chicagoLocalToMs(future), 'Hold until then did not set the picked Memphis time');
const past = await s.post('/admin/holds/extend', { r: s.rk(a.request_key), until: '2020-01-01T10:00' });
must(/e=/.test(past.location), 'a hold end in the past was accepted');
r = await s.post('/admin/holds/keep', { r: s.rk(a.request_key) });
const hk = await H.getHold(s.db, a.request_key);
must(hk.by_hand === 1 && hk.until === null && (await H.expireHolds(s.db, Date.now() + 365 * 86400000)) === 0, 'Keep holding did not turn off the end time');
let dash = (await s.get('/admin/')).text;
must(dash.includes('Reserved by hand (no end date)') && dash.includes('Release these games') && !dash.includes('Held by hand (no end time)'), 'a held-by-hand hold does not show "Reserved by hand (no end date)" and Release these games');
{
  // Reserved by hand (no end date): the card still has the control, its current line says so, and
  // Save sets an end of now + N days.
  const one = (dash.match(/<details class="reslonger" data-reserve-longer data-until-ms="">[\s\S]*?<\/details>/g) || []).find((x) => x.includes(`value="${s.rk(a.request_key)}"`)) || '';
  must(one.includes('<p class="muted" data-res-current>Reserved by hand (no end date)</p>') && /name="days" value="3"/.test(one), 'a hold reserved by hand has no Reserve their games longer control on its card');
  const t0 = Date.now();
  const rh = await s.post('/admin/holds/extend', { r: s.rk(a.request_key), days: '4', back: '/admin/', card: '1' });
  const hh = await H.getHold(s.db, a.request_key);
  const got = H.fromSql(hh.until);
  must(hh.by_hand === 0 && got >= t0 + 4 * DAY - 2000 && got <= Date.now() + 4 * DAY + 1000 && saidM(rh.location) === `✓ Games reserved until ${VM.reservedWords(got)}`, `Reserve their games longer on a hold with no end date did not set now + 4 days (${hh.until}, ${rh.location})`);
  await s.post('/admin/holds/keep', { r: s.rk(a.request_key) });
}
must((await ev(a.request_key)).some((e) => /Held by hand/.test(e)), 'Keep holding is not logged');
r = await s.post('/admin/holds/release', { r: s.rk(a.request_key) });
must((await H.getHold(s.db, a.request_key)).state === 'released' && (await s.all('SELECT id FROM bookings WHERE request_key = ?1', a.request_key)).length === 0, 'Release did not free the games');
must((await ev(a.request_key)).some((e) => /released by Valerie/.test(e)), 'Release is not logged');
// An expired hold can be given more time: it comes back with its games on the calendar.
const e1 = await rental(2, ['grab-the-mic']);
await H.expireHolds(s.db, H.fromSql((await H.getHold(s.db, e1.request_key)).until) + 1000);
must((await H.getHold(s.db, e1.request_key)).state === 'expired', 'setup: hold did not expire');
dash = (await s.get('/admin/')).text;
must(dash.includes('data-hold-expired') && dash.includes('Hold expired.'), 'the card does not say "Hold expired"');
{
  const note = (/<div class="notice warn" data-hold-expired>[\s\S]*?<\/details>/.exec(dash) || [''])[0];
  must(note.includes('data-reserve-longer') && note.includes(`value="${s.rk(e1.request_key)}"`) && /<b>Reserve their games longer<\/b><span class="ressub">Give more time to pay<\/span>/.test(note) && /data-res-new>New date: <b>/.test(note) && !/Give them more time/.test(dash), 'the Hold expired notice does not carry the Reserve their games longer control');
}
await s.post('/admin/holds/extend', { r: s.rk(e1.request_key), hours: '24' });
must((await H.getHold(s.db, e1.request_key)).state === 'held' && (await s.all('SELECT kind FROM bookings WHERE request_key = ?1', e1.request_key)).length === 2, 'more time on an expired hold did not put its games back');

// ---- 2. Hold reminder: once per end time --------------------------------------------------
const b = await rental(3, ['cornhole']);
await s.db.prepare("UPDATE holds SET until = ?2 WHERE request_key = ?1").bind(b.request_key, H.sqlTime(Date.now() + 3 * 3600000)).run();
const sentBefore = s.env.sent.length;
let hr = await CM.sendHoldReminders(s.env);
must(hr.sent >= 1 && s.env.sent.slice(sentBefore).some((m) => m.to === 'rent3@example.com' && /held until/.test(m.subject)), 'the hold reminder email did not go out inside the window');
hr = await CM.sendHoldReminders(s.env);
must(!s.env.sent.slice(sentBefore + 1).some((m) => m.to === 'rent3@example.com'), 'the hold reminder went out twice for the same end time');
await s.db.prepare("UPDATE holds SET until = ?2 WHERE request_key = ?1").bind(b.request_key, H.sqlTime(Date.now() + 2 * 3600000)).run();
await CM.sendHoldReminders(s.env);
must(s.env.sent.filter((m) => m.to === 'rent3@example.com' && /held until/.test(m.subject)).length === 2, 'a new end time did not get its own one reminder');
await s.db.prepare("INSERT INTO settings (key, value) VALUES ('hold_reminder', '0')").run();
await s.db.prepare("UPDATE holds SET until = ?2 WHERE request_key = ?1").bind(b.request_key, H.sqlTime(Date.now() + 3.5 * 3600000)).run();
must((await CM.sendHoldReminders(s.env)).due === 0, 'the hold reminder ignores its Settings switch');
await s.db.prepare("DELETE FROM settings WHERE key = 'hold_reminder'").run();

// ---- 3. Holds ending soon, badge, Held view, Day sheet -------------------------------------
const c = await rental(4, ['giant-color-stack']);
await s.db.prepare("UPDATE holds SET until = ?2 WHERE request_key = ?1").bind(c.request_key, H.sqlTime(Date.now() + 30 * 60000)).run();
dash = (await s.get('/admin/')).text;
const box = dash.slice(dash.indexOf('data-holds-soon'), dash.indexOf('</section>', dash.indexOf('data-holds-soon')));
must(box.includes('Rita Rent4') && box.includes('Rita Rent3') && box.indexOf('Rita Rent4') < box.indexOf('Rita Rent3'), 'Holds ending soon is missing a hold or is not soonest first');
must(/ends red/.test(box) && /ends amber/.test(box) && /Ends today|Ends tomorrow/.test(box) && /\(in \d+ (minutes|hours?)\)/.test(box), 'ending-soon rows lack the amber/red end time in words');
must(!box.includes('Rita Rent1') && box.includes('Text a reminder') && box.includes('<b>Reserve their games longer</b>') && box.includes('data-res-new>New date: <b>') && !box.includes('Hold longer') && box.includes('Mark deposit received') && box.includes('Release now'), 'ending-soon rows lack their buttons (Reserve their games longer with its New date line), or list a released hold');
must(/data-holds-badge> \d+ holds ending soon/.test(dash), 'the Requests tab has no "N holds ending soon" badge');
const cal = (await s.get('/admin/calendar')).text;
must(cal.includes('data-holds-soon') && cal.includes('data-held-view') && cal.includes('data-view="held"'), 'Calendar & Bookings lacks the ending-soon box or the Held view');
const held = cal.slice(cal.indexOf('data-held-view'), cal.indexOf('</section>', cal.indexOf('data-held-view')));
must(held.includes('Rita Rent4') && held.includes('<h3>Reserved by hand (no end date)</h3>') && /Games reserved until \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} (AM|PM)/.test(held), 'the Held view does not list timed holds ("Games reserved until ...") and reserved-by-hand apart');
must(!/Hold longer|[Gg]ames held until|Held by hand \(no end time\)/.test(cal), 'Calendar & Bookings still says "Hold longer" / "Games held until" / "Held by hand (no end time)"');
must(/data-held-booking>(Games reserved until \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} (AM|PM)|Reserved by hand \(no end date\)) — waiting for deposit</.test(cal), 'a held rental booking does not read "Games reserved until <date> — waiting for deposit" on the calendar');
const endDay = C.chicagoDayOf((await H.getHold(s.db, c.request_key)).until);
const day = (await s.get(`/admin/day/${endDay}`)).text;
const sheetText = C.daySheetText(endDay, [], { holds: [{ timeLabel: '1:17 PM', name: 'Rita Rent4', items: 'Giant Color Stack', phone: '901-555-0204' }] });
must(day.includes('data-day-holds') && day.slice(day.indexOf('data-day-holds'), day.indexOf('</section>', day.indexOf('data-day-holds'))).includes('Rita Rent4') && /Hold ends 1:17 PM - Rita Rent4 \(Giant Color Stack\): deposit not in yet/.test(sheetText) && /1 hold ending/.test(sheetText), 'the Day sheet and its text list do not include a hold ending that day');

// ---- 4. Deposit received -> confirmed, confirmation once, text screen ----------------------
const inv = await s.one('SELECT invoice_id FROM request_status WHERE request_key = ?1', c.request_key);
const sent0 = s.env.sent.length;
r = await s.post(`/admin/invoices/${inv.invoice_id}/status`, { action: 'deposit_paid', method: 'zelle', back: '/admin/' });
must(/^\/admin\/confirmed\?r=/.test(r.location), 'Mark deposit received does not open the confirmed screen');
must((await H.getHold(s.db, c.request_key)).state === 'confirmed', 'Mark deposit received did not turn the hold into a booking');
const conf = s.env.sent.slice(sent0).filter((m) => m.to === 'rent4@example.com');
must(conf.length === 1 && /You are booked/.test(conf[0].subject) && /Giant Color Stack/.test(conf[0].text) && /The rest \(\$20\) is due at pickup/.test(conf[0].text) && /Reply to this email/.test(conf[0].text), `the confirmation email is missing or wrong: ${conf.map((m) => m.text).join(' | ')}`);
const screen = (await s.get(r.location)).text;
const smsHref = (screen.match(/href="(sms:[^"]+)"/) || [])[1] || '';
const body = decodeURIComponent(smsHref.split('body=')[1] || '');
must(/^sms:9015550204\?&body=/.test(smsHref.replace(/&amp;/g, '&')) && body.startsWith('Hi Rita, this is Valerie with Porch & Party. Your deposit came in, so your games are booked: Giant Color Stack, pickup ') && /The rest \(\$20\) is due at pickup\. Text me here to set your pickup time\. Thank you!$/.test(body), `the confirmation text is not filled in: ${body}`);
must(screen.includes('Text them it&#39;s confirmed') && screen.includes('Confirmation email sent ✓'), 'the confirmed screen lacks the big text button or the email-sent line');
await s.post(`/admin/invoices/${inv.invoice_id}/status`, { action: 'unpaid' });
await s.post(`/admin/invoices/${inv.invoice_id}/status`, { action: 'deposit_paid', method: 'zelle' });
must(s.env.sent.filter((m) => m.to === 'rent4@example.com' && /You are booked/.test(m.subject)).length === 1, 'the confirmation email was sent twice');
await s.post('/admin/msg/tapped', { r: s.rk(c.request_key), template: 'confirmation' });
must((await s.one('SELECT confirmed_texted_at FROM requests WHERE request_key = ?1', c.request_key)).confirmed_texted_at, 'tapping the confirmation text is not recorded');
dash = (await s.get('/admin/')).text;
must(dash.includes('Confirmation sent ✓') && dash.includes('Text about pickup time'), 'the card does not show "Confirmation sent ✓" or the pickup-time text');
// The quote services get it too.
const p1 = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', event_date: plus(20), location: 'Germantown', name: 'Pia Porch', phone: '901-555-0301', email: 'pia@example.com' });
await s.post('/admin/requests/status', { r: s.rk(p1.row.request_key), status: 'deposit_paid' });
must(s.env.sent.some((m) => m.to === 'pia@example.com' && /your porch install on/.test(m.text) && /is confirmed/.test(m.text)), 'a porch deposit does not send "your porch install on ... is confirmed"');

// ---- 5. Thank-you the next morning -------------------------------------------------------
const day0 = new Date();
const tenAm = (offsetDays) => { const d = new Date(`${plus(offsetDays)}T15:00:00Z`); return d; };
await s.post('/admin/requests/jobdone', { r: s.rk(p1.row.request_key) });
dash = (await s.get('/admin/')).text;
{
  // ONE small line at the bottom of the card, just above Show details (owner, 18 Oct 2026).
  const card = dash.slice(dash.lastIndexOf('<article', dash.indexOf('data-thankyou')), dash.indexOf('</article>', dash.indexOf('data-thankyou')));
  const line = (card.match(/<div class="tyline" data-thankyou>[\s\S]*?<\/div>/) || [''])[0];
  must(/Thank-you email goes out tomorrow morning/.test(line) && /Text a thank-you/.test(line) && /Email it now/.test(line) && />Don't send</.test(line) && !/class="btn/.test(line), 'a job marked done does not say, on one small line, the thank-you goes out tomorrow · Text · Email · Don\'t send');
  // Step cards (19 Oct 2026): it is ONE small line under More, after the other buttons and the
  // Payment box, just above Edit / Add a note / Put away; never in the next-step box.
  const moreAt = card.indexOf('data-details');
  must(moreAt > card.indexOf('data-next-step') && card.indexOf('data-thankyou') > moreAt && card.indexOf('data-thankyou') < card.indexOf('data-more-row') && (card.match(/data-thankyou[\s>]/g) || []).length === 1 && !/<section class="paybox" data-thankyou/.test(card), 'the thank-you is not one small line under More, just above Edit / Add a note / Put away');
}
let ty = await CM.sendThankYous(s.env, day0);
must(!s.env.sent.some((m) => m.to === 'pia@example.com' && /Thank you/.test(m.subject)), 'the thank-you went out the same day the job was marked done');
const q1 = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', event_date: plus(21), location: 'Bartlett', name: 'Quinn Undo', phone: '901-555-0302', email: 'quinn@example.com' });
await s.post('/admin/requests/jobdone', { r: s.rk(q1.row.request_key) });
await s.post('/admin/requests/jobdone', { r: s.rk(q1.row.request_key), undo: '1' });
const q2 = await s.siteRequest({ service: 'grazing', grazing_event: 'Graduation', grazing_guests: '15–40', grazing_food: "No, I'll provide the food", event_date: plus(22), location: 'Cordova', name: 'Sky Skip', phone: '901-555-0303', email: 'sky@example.com' });
await s.post('/admin/requests/jobdone', { r: s.rk(q2.row.request_key) });
await s.post('/admin/requests/thankyou-skip', { r: s.rk(q2.row.request_key), skip: '1' });
const q3 = await s.siteRequest({ service: 'party', party_event: 'Anniversary', party_where: 'Hotel room', event_date: plus(23), location: 'Peabody', name: 'Val Void', phone: '901-555-0304', email: 'void@example.com' });
await s.post('/admin/requests/jobdone', { r: s.rk(q3.row.request_key) });
await s.post('/admin/requests/status', { r: s.rk(q3.row.request_key), status: 'void' });
// Move the job-done times to yesterday, then run the 10 AM cron "tomorrow".
await s.db.prepare("UPDATE request_status SET job_done_at = datetime('now', '-1 day') WHERE job_done_at IS NOT NULL").run();
ty = await CM.sendThankYous(s.env, tenAm(1));
const tyMails = s.env.sent.filter((m) => /Thank you from Porch & Party/.test(m.subject));
must(tyMails.some((m) => m.to === 'pia@example.com' && /thank you for letting us decorate your porch!/.test(m.text)), 'the porch thank-you email did not go out the next morning');
must(!tyMails.some((m) => ['quinn@example.com', 'sky@example.com', 'void@example.com'].includes(m.to)), 'a thank-you went to an undone job, a "Don\'t send" request or a void one');
await CM.sendThankYous(s.env, tenAm(2));
must(s.env.sent.filter((m) => m.to === 'pia@example.com' && /Thank you from/.test(m.subject)).length === 1, 'the thank-you email was sent twice');
dash = (await s.get('/admin/')).text;
must(dash.includes('Thank-you email sent ✓'), 'the card does not say "Thank-you email sent ✓"');
// Rentals: the deposit line only when returned with nothing damaged.
const ctxOk = { name: 'Jane Doe', service: 'rentals', depositBack: '$50', referralUrl: 'porchandparty901.com/r/abcdefgh' };
must(M.render('thankyou', ctxOk).text === 'Hi Jane, thank you for renting with Porch & Party! We hope the party was a blast. Your $50 damage deposit is on its way back to you. We\'d love to help with your next one. — Valerie', 'the rentals thank-you wording drifted from the owner\'s');
must(!/damage deposit/.test(M.render('thankyou', { ...ctxOk, depositBack: '' }).text), 'the deposit line shows when no deposit is coming back');
const d1 = await rental(5, ['card-table']);
const dinv = await s.one('SELECT invoice_id FROM request_status WHERE request_key = ?1', d1.request_key);
await s.post(`/admin/invoices/${dinv.invoice_id}/status`, { action: 'deposit_paid', method: 'zelle' });
await s.post(`/admin/returns?k=${s.rk(d1.request_key)}`, { back: ['Card Table with Cup Holders'] });
must((await CM.messageCtx(s.db, d1.request_key)).depositBack === '$50', 'a clean return does not promise the deposit back');
const d2 = await rental(6, ['inflatable-movie-screen']);
await s.post(`/admin/returns?k=${s.rk(d2.request_key)}`, { back: [] });
must((await CM.messageCtx(s.db, d2.request_key)).depositBack === '', 'a return with damage still promises the deposit back');

// ---- 6. Referral block, no review / discount, no paid SMS -------------------------------
const pctx = await CM.messageCtx(s.db, p1.row.request_key);
const tmsg = M.render('thankyou', pctx);
const code = p1.row.referral_code;
must(tmsg.html.includes(`porchandparty901.com/r/${code}`) && tmsg.html.includes('Know someone planning something?'), 'the thank-you email lacks the referral block or link');
must(/href="sms:\?&amp;body=I%20used%20Porch%20%26%20Party%20for%20my%20/.test(tmsg.html) && tmsg.html.includes('href="mailto:?subject=') && tmsg.html.includes('https://www.facebook.com/sharer/sharer.php?u='), 'the referral buttons (text, email, Facebook) are missing');
must(['porch', 'party', 'grazing', 'rentals'].every((k) => tmsg.html.includes(`cid:svc-${k}`)) && tmsg.images.length === 4, 'the referral block lacks the four service pictures');
must(/porchandparty901\.com\/r\//.test(tmsg.emailText) && /Know someone planning something\?/.test(tmsg.emailText), 'the thank-you email has no plain-text referral part');
const att = await M.attachImages(tmsg, 'https://x.test', async () => new Response(new Uint8Array([1, 2, 3])));
must(att.attachments.length === 4 && att.attachments.every((x) => x.disposition === 'inline' && /^svc-/.test(x.contentId)), 'the service pictures are not inline CID attachments');
const noImg = await M.attachImages(tmsg, 'https://x.test', async () => new Response('', { status: 404 }));
must(!/cid:svc-/.test(noImg.html), 'a picture that cannot be fetched leaves a broken image');
const all = Object.keys(M.TEMPLATES).map((t) => M.render(t, { ...pctx, name: 'Jane Doe', reminderText: 'Hi', rentals: null, services: ['porch'], pay: {} }));
must(all.every((m) => !/review|discount|% off|percent off/i.test(`${m.subject} ${m.text} ${m.html} ${m.emailText}`)), 'a customer template mentions a review or a discount');
must(!new RegExp(p1.row.name.split(' ')[0], 'i').test(code) && !/@/.test(code), 'the referral code carries the customer\'s name or email');
const src = fs.readdirSync(path.join(ROOT, 'functions/_lib')).filter((f) => f.endsWith('.mjs')).map((f) => fs.readFileSync(path.join(ROOT, 'functions/_lib', f), 'utf8')).join('\n') + fs.readFileSync(path.join(ROOT, 'workers/pnp-mailer/src/index.js'), 'utf8');
must(!/twilio|vonage|nexmo|messagebird|plivo|sinch|telnyx/i.test(src), 'a paid SMS provider appears in the code');
const smsOut = await M.sendMessage(s.env, 'sms', 'pickupTime', { name: 'Jane', phone: '(901) 555-0100', day: 'Sat 25 Oct' });
must(smsOut.ok && smsOut.href.startsWith('sms:9015550100?&body=') && s.env.sent.length === s.env.sent.length, 'the sendMessage seam does not make a free sms: link');

// ---- 7. The mailer's hourly cron ---------------------------------------------------------
const cronEnv = { DB: s.db, EMAIL: { send: async () => ({ messageId: 'x' }) } };
const at = async (iso) => W.runReminders(cronEnv, new Date(iso));
const oct = await at('2026-10-20T15:00:00Z'); const octOff = await at('2026-10-20T16:00:00Z'); const dec = await at('2026-12-01T16:00:00Z'); const decOff = await at('2026-12-01T15:00:00Z');
must(oct.thankYous && !octOff.thankYous && dec.thankYous && !decOff.thankYous, 'the daily work does not run at exactly 10 AM Memphis in both daylight and standard time');
must(typeof octOff.expiredHolds === 'number' && octOff.holdReminders, 'the hourly run does not expire holds or send hold reminders');

// ---- 8. Find a customer: "Sent you N customers" -------------------------------------------
await s.siteRequest({ service: 'porch', porch_season: 'Other', event_date: plus(30), location: 'Arlington', name: 'Fran Friend', phone: '901-555-0399', email: 'fran@example.com' }, { cookie: `pnp_ref=${code}` });
const found = (await s.get('/admin/search?partial=1&q=pia')).text;
must(found.includes('Sent you 1 customer'), 'Find a customer does not say "Sent you 1 customer"');

if (checks < 50) errors.push(`only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: holds and customer messages (${errors.length} of ${checks} checks)\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`validate_request_messages: OK (${checks} checks: hold 48 h + Reserve their games longer 3 days (approved control, live New date, by hand, expired) / typed N days on the current end + keep/release + logs, reminder once per end time, ending-soon box/badge/Held view/Day sheet, confirmation once + text, thank-you next morning once with every skip rule, referral block, no review/discount, no paid SMS, 10 AM Memphis cron, Sent you N)`);
