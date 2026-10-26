#!/usr/bin/env node
/**
 * The calm Calendar & Bookings (owner-approved clickable mock-up, 19 Oct 2026). Drives the real
 * router over a fresh local database. Fails when:
 *  1. on a computer the month is not first: the calendar must render before the numbered steps,
 *     steps 1-4 in the right margin column and Step 5 (next 14 days) under the month, with the
 *     two-column layout from 900 px;
 *  2. the five steps are not 1-5 with the owner's words (titles and lines), or Step 1 has no
 *     "Find a customer" box that submits to the existing /admin/search;
 *  3. the phone has no small month with one dot per job (hollow = not confirmed), no panel per day
 *     (exactly one shown), or a job there does not open to time, where, games / what to bring,
 *     what is left to collect (or Paid in full ✓) and the deposit, with Call, Text and Open their
 *     card, and Yes, book it on an unconfirmed one;
 *  4. "Yes, book it" on the calendar is not the Requests card's own form (same action, same fields,
 *     one builder), or booking from it does not land back on the calendar with "✓ Booked", turn the
 *     dashed "? " chip solid and take the request off Unconfirmed requests; a foreign back= is
 *     followed;
 *  5. a not-confirmed chip is not dashed with "? ", or a confirmed one is not solid;
 *  6. "Schedule takedown -> Book takedown" and "Not needed" in Step 2 do not use the card's own
 *     takedown actions, or do not come back to the calendar;
 *  7. anything the page had before is missing: Every booking list (with past bookings), drag on a
 *     computer (bookings and Unconfirmed requests, drop on a day, Move form), Add a booking, Day
 *     sheet links (grid days, phone days, Upcoming), Today's list, Link my Google Calendar, Held
 *     view, month arrows, colour key + legend, Still to decide, Takedowns to schedule, reminders;
 *  8. a new control has no help text in the map.
 * Rule 0: fewer than 70 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const H = await mod('functions/_lib/helptext.mjs');
const F = await mod('functions/_lib/request-form.mjs');
const { esc } = await mod('functions/_lib/util.mjs');

const s = await session();
const today = F.chicagoToday();
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const cellOf = (html, d) => { const i = html.indexOf(`data-day="${d}"`); return i < 0 ? '' : html.slice(i, html.indexOf('</a>', i)); };
const phoneDayOf = (html, d) => { const i = html.indexOf(`data-month-day="${d}"`); return i < 0 ? '' : html.slice(i, html.indexOf('</section>', i)); };
const stepOf = (html, n) => { const i = html.indexOf(`id="calstep-${n}"`); return i < 0 ? '' : html.slice(i, html.indexOf(n === 1 ? '</section>\n' : '</details><', i) + 12); };
const at = (html, x) => html.indexOf(x);
const cal = async (day) => (await s.get(`/admin/calendar?month=${day.slice(0, 7)}`)).text;

// Scenario: a party request (unconfirmed), a rental (held, unconfirmed), a porch with a takedown
// to schedule, and a booking with an invoice and a deposit.
const party = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', event_date: plus(6), location: 'Bartlett', name: 'Cara Calmparty', phone: '901-555-0611', email: 'cara.calm@example.com' });
const rent = await s.siteRequest({ service: 'rentals', games: ['giant-uno'], duration: 'day', rental_date: plus(7), pickup_when: 'morning', return_when: 'after', name: 'Reid Calmrent', phone: '901-555-0612', email: 'reid.calm@example.com' });
const porch = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'yes', event_date: plus(2), location: 'Germantown', name: 'Tess Calmporch', phone: '901-555-0613', email: 'tess.calm@example.com' });
const porch2 = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'yes', event_date: plus(3), location: 'Cordova', name: 'Nia Notneeded', phone: '901-555-0614', email: 'nia.calm@example.com' });
const porch3 = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'yes', event_date: plus(3), location: 'Bartlett', name: 'Ned Notneeded', phone: '901-555-0615', email: 'ned.calm@example.com' });
for (const [n, r] of [['party', party], ['rental', rent], ['porch', porch], ['porch 2', porch2], ['porch 3', porch3]]) must(r.status === 303 && r.row, `${n} request refused: ${r.text.slice(0, 160)}`);
const tdDay = plus(4);
// Tess's takedown books itself on Yes, book it (no day of its own yet, so it is not on the list);
// Nia and Ned asked for a takedown day that is not booked: "Takedowns to schedule".
await s.db.prepare('UPDATE requests SET takedown_date = ?2 WHERE request_key = ?1').bind(porch2.row.request_key, tdDay).run();
await s.db.prepare('UPDATE requests SET takedown_date = ?2 WHERE request_key = ?1').bind(porch3.row.request_key, plus(5)).run();
const pk = await s.one("SELECT date FROM bookings WHERE request_key = ?1 AND kind = 'rental_pickup'", rent.row.request_key);
must(Boolean(pk && pk.date), 'the rental request did not put its pickup on the calendar (held)');
const rentDay = pk ? pk.date : plus(7);
// A confirmed porch install with an invoice: Collect + Paid in full.
await s.post('/admin/requests/talked', { r: s.rk(porch.row.request_key), go: 'yes', date: plus(2) });
const porchReq = (await (await mod('functions/_lib/requests.mjs')).loadRequests(s.env)).find((r) => r.key === porch.row.request_key);
// The website request's auto draft (auto-draft.mjs, 20 Oct 2026) is its invoice: unsent, it is owed
// by nobody, so the job says "Invoice not sent yet"; once sent it says what is left to collect.
const inv = (await s.one("SELECT id FROM invoices WHERE request_key = ?1 AND auto_draft = 1 AND status = 'draft'", porch.row.request_key)) || await s.invoiceFor(porchReq);
must(inv.id > 0 && porchReq, 'no invoice for the porch');
{
  const html = phoneDayOf(await s.get(`/admin/calendar?month=${plus(2).slice(0, 7)}`).then((r) => r.text), plus(2));
  const j = (html.match(/<details class="pj"[^>]*data-pjob="\d+">[^]*?<\/details>/) || [])[0] || '';
  must(/<dt>Collect<\/dt><dd>Invoice not sent yet<\/dd>/.test(j) && !/still to collect/.test(j), `an unsent draft is counted as money to collect (${j.slice(0, 300)})`);
}
await s.post(`/admin/invoices/${inv.id}/status`, { action: 'texted' });

// ---- 1. Computer: the month first, steps in the margin ---------------------------------------
const day0 = plus(6);
let html = await cal(day0);
const css = (html.match(/<style>([^]*?)<\/style>/g) || []).join('\n');
must(at(html, '<section class="calcal" data-calendar>') > 0, 'no calendar section');
must(at(html, '<section class="calcal" data-calendar>') < at(html, 'id="calstep-1"') && at(html, '<section class="calcal" data-calendar>') < at(html, 'id="calstep-5"'), 'the calendar does not render before the steps');
must(at(html, '<div class="calmain">') < at(html, '<section class="calcal" data-calendar>') && at(html, 'id="calstep-5"') < at(html, '<aside class="calside">'), 'Step 5 is not under the month in the main column');
must([1, 2, 3, 4].every((n) => at(html, `id="calstep-${n}"`) > at(html, '<aside class="calside">')) && [1, 2, 3].every((n) => at(html, `id="calstep-${n}"`) < at(html, `id="calstep-${n + 1}"`)), 'steps 1-4 are not in order in the right margin column');
must(/@media\(min-width:900px\)\{\.calm\{grid-template-columns:minmax\(0,1fr\) 320px/.test(css), 'from 900 px the page is not month + a 320 px margin column');
must(/\.month\{display:grid;grid-template-columns:repeat\(7,minmax\(0,1fr\)\);gap:3px\}/.test(css), 'the computer month grid changed');
must(!/data-steps-panel>[\s\S]{0,40}<ol class="topsteps/.test(html) && !/<ol class="topsteps/.test(html), 'the old steps bar above the calendar is still there');

// ---- 2. The owner's words; Find a customer in Step 1 -----------------------------------------
const TITLES = ["See what's coming up.", 'Put a request on the calendar.', 'Plan your day.', "Check tomorrow's reminders.", 'Look over the next 14 days.'];
const LINES = ['Every booking for all four services, by month or as a list.', 'Drag one from Unconfirmed requests onto a day on a computer, or tap Book it — or add one that came by phone:', 'Open a day to see who is coming, what to load and what to collect.'];
TITLES.forEach((t, i) => {
  const st = stepOf(html, i + 1);
  must(new RegExp(`<span class="n">${i + 1}</span><span class="spt">${esc(t).replace(/[.?()]/g, '\\$&')}</span>`).test(st), `step ${i + 1} is not "${t}"`);
  if (LINES[i]) must(st.includes(`<p class="spl">${esc(LINES[i])}</p>`), `step ${i + 1}'s line is not the owner's: "${LINES[i]}"`);
  must(i === 0 ? /^id="calstep-1" data-calstep="1"><h2/.test(st) : new RegExp(`^id="calstep-${i + 1}" data-calstep="${i + 1}" open><summary class="csh" data-help="cal.stepRow"`).test(st), `step ${i + 1} is not ${i === 0 ? 'a fixed section' : 'a numbered row that folds on a phone'}`);
});
must(JSON.stringify(H.STEPS.calendar) === JSON.stringify(TITLES) && H.PANELS.calendar.length === 5, 'helptext STEPS / PANELS for the calendar are not the five steps');
const s1 = stepOf(html, 1);
must(/<form class="findbar" method="get" action="\/admin\/search" role="search" data-search>/.test(s1) && /<input id="find" name="q" type="search"[^>]*placeholder="Find a customer: name, phone or email"[^>]*data-help="find.box"/.test(s1) && /<button class="btn ghost" type="submit" data-help="find.go"/.test(s1) && s1.includes('id="find-results"'), 'Step 1 has no Find a customer box that submits to /admin/search (with live results)');
must((html.match(/data-search>/g) || []).length === 1, 'more than one search box on the page');
const found = await s.get('/admin/search?q=Calmparty');
must(found.status === 200 && /Cara Calmparty/.test(found.text), 'the search Step 1 submits to does not find the customer');

// ---- 5. Dashed vs solid --------------------------------------------------------------------
const pCell = cellOf(html, day0);
must(/<span class="k req party_setup" style="border-color:#[0-9a-f]{6}" data-requested="party"[^>]*>\? Party: Cara C\.<\/span>/.test(pCell), `the unconfirmed party is not a dashed "? Party: Cara C." chip (${pCell.slice(0, 260)})`);
must(/\.k\.req\{background:transparent!important;border-style:dashed;border-width:2px/.test(css) && /\.k\.req\.tent\{border-style:dashed/.test(css), 'not-confirmed chips are not dashed outlines');
const rentHtml = await cal(rentDay);
must(/<span class="k rental_pickup req tent"[^>]*data-tentative style="border-color:#[0-9a-f]{6}"[^>]*>\? \(games held\) Rental pickup: Reid Calmrent</.test(cellOf(rentHtml, rentDay)), 'the held, unconfirmed rental is not a dashed "? " chip');
const porchHtml = await cal(plus(2));
must(/<span class="k porch_install" draggable="true" data-drag data-booking="\d+"[^>]*data-help="cal.booking"[^>]*>Porch install: Tess Calmporch</.test(cellOf(porchHtml, plus(2))), 'the confirmed porch install is not a solid chip (no "?", no dashed class)');
must(/data-fill-legend[^>]*>[\s\S]*Filled = booked \(you said yes\) · Outlined = requested, not confirmed yet/.test(html) && /data-service-key/.test(html), 'the colour key or the legend line is missing');

// ---- 3. Phone: month with dots, tapped day, job details ---------------------------------------
must(/<div class="pmonth" data-phone-month>/.test(html) && /@media\(max-width:899px\)\{[^]*?\.pmonth\{display:grid;grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/.test(css), 'no 7-column phone month under 900 px');
const pd = (d) => (html.match(new RegExp(`<a class="pd[^"]*" href="#d-${d}" data-pday="${d}"[^>]*>[^]*?</a>`)) || [])[0] || '';
must(/data-help="cal.pday"/.test(pd(day0)) && /<i class="tent" style="border-color:#7e22ce;background:#7e22ce"><\/i>/.test(pd(day0)), `the phone month has no hollow purple dot on the party's day (${pd(day0).slice(0, 200)})`);
must(/\.pmonth \.dots i\.tent\{background:transparent!important\}/.test(css), 'a not-confirmed dot is not hollow');
const nDays = (html.match(/data-month-day="(\d{4}-\d{2}-\d{2})"/g) || []).length;
const monthDays = new Date(Date.UTC(Number(day0.slice(0, 4)), Number(day0.slice(5, 7)), 0)).getUTCDate();
must(nDays === monthDays && (html.match(/class="mday[^"]* sel"/g) || []).length === 1, `the phone day panels are not one per day with exactly one shown (${nDays} of ${monthDays})`);
must(/\.monthlist \.mday\{display:none\}\.monthlist \.mday\.sel\{display:grid\}/.test(css), 'more than the tapped day shows on a phone');
must(/addEventListener\('click',function\(e\)\{if\(pick\(a\.getAttribute\('data-pday'\)\)\)e\.preventDefault\(\);\}\)/.test(html), 'tapping a phone day does not show that day under the month');
const pAsked = phoneDayOf(html, day0);
must(/<details class="pj tent"[^>]*data-pjob-asked=[^>]*data-tentative><summary data-help="cal.pjob"/.test(pAsked) && /Requested · not confirmed · Party: Cara C\./.test(pAsked), 'the phone day has no unconfirmed party row that opens');
must(/href="tel:9015550611"[^>]*data-help="day.call"[^>]*>Call</.test(pAsked) && /href="sms:9015550611"[^>]*data-help="cal.jobText"[^>]*>Text</.test(pAsked) && /href="\/admin\/#c-[A-Za-z0-9_-]+"[^>]*data-help="cal.openCard"[^>]*>Open their card</.test(pAsked), 'the unconfirmed phone job lacks Call / Text / Open their card');
must(/<details class="yes" data-yes-book><summary class="btn primary" data-help="cal.yesOpen"[^>]*>Yes, book it<\/summary><form method="post" action="\/admin\/requests\/talked" data-talk-yes>/.test(pAsked), 'the unconfirmed phone job has no Yes, book it');
const pPorch = phoneDayOf(porchHtml, plus(2));
const job = (pPorch.match(/<details class="pj"[^>]*data-pjob="\d+">[^]*?<\/details>/) || [])[0] || '';
must(/<summary data-help="cal.pjob"[^>]*><span class="k porch_install"[^>]*>Porch install: Tess Calmporch<\/span><span class="pjw">Booked · tap for more<\/span>/.test(job), 'the confirmed phone job does not read solid "Booked"');
for (const k of ['Time', 'Where', 'Bring', 'Collect']) must(new RegExp(`<dt>${k}</dt><dd>[^<]+</dd>`).test(job), `the phone job has no ${k}`);
must(/<dt>Collect<\/dt><dd>\$[\d,.]+ still to collect<\/dd>/.test(job), `the phone job does not say what is left to collect (${job.slice(0, 400)})`);
must(!/data-yes-book/.test(job), 'a confirmed job offers Yes, book it');
await s.post(`/admin/invoices/${inv.id}/status`, { action: 'paid', method: 'cash' });
const paidJob = (phoneDayOf(await cal(plus(2)), plus(2)).match(/<details class="pj"[^>]*data-pjob="\d+">[^]*?<\/details>/) || [])[0] || '';
must(/<dt>Collect<\/dt><dd>Paid in full ✓<\/dd>/.test(paidJob), 'a paid job does not say Paid in full ✓');
const rentJob = (phoneDayOf(rentHtml, rentDay).match(/<details class="pj tent"[^>]*data-pjob="\d+"[^>]*>[^]*?<\/details>/) || [])[0] || '';
must(/<dt>Games<\/dt><dd>[^<]*Giant Uno/i.test(rentJob) && /<dt>Reserved<\/dt><dd>(Games reserved until \w{3} \d{1,2} \w{3}, \d{1,2}:\d{2} (AM|PM)|Reserved by hand \(no end date\)), waiting for the deposit<\/dd>/.test(rentJob) && !/<dt>Hold<\/dt>|Games held/.test(rentJob) && /data-yes-book/.test(rentJob), `the held rental's phone job lacks Games / Reserved ("Games reserved until <date>, waiting for the deposit") / Yes, book it (${rentJob.slice(0, 300)})`);
must(/<a href="\/admin\/day\/[0-9-]+" data-help="cal.daySheet"[^>]*>Open the day sheet<\/a>/.test(pPorch), 'the phone day has no Open the day sheet link');
// Deposit line: a refundable damage deposit on an invoice shows on the job.
{
  const rq = (await (await mod('functions/_lib/requests.mjs')).loadRequests(s.env)).find((r) => r.key === rent.row.request_key);
  await s.invoiceFor(rq);
  const j = (phoneDayOf(await cal(rentDay), rentDay).match(/<details class="pj[^"]*"[^>]*data-pjob="\d+"[^>]*>[^]*?<\/details>/) || [])[0] || '';
  must(/<dt>Deposit<\/dt><dd>Damage deposit \$[\d,.]+, refundable/.test(j), `the rental job has no Deposit line (${j.slice(0, 500)})`);
}

// ---- 4. Yes, book it = the Requests card's own action ----------------------------------------
html = await cal(day0);
const s2 = stepOf(html, 2);
const row = (s2.match(/<div class="u" draggable="true" data-drag data-rk="[^"]+" data-unconfirmed-row[^>]*><strong>Cara Calmparty<\/strong>[^]*?<\/div>/) || [])[0] || '';
const calForm = (row.match(/<form method="post" action="\/admin\/requests\/talked" data-talk-yes>[^]*?<\/form>/) || [])[0] || '';
const cardHtml = (await s.get('/admin/')).text;
const cardForm = (cardHtml.slice(cardHtml.indexOf(`id="c-${s.rk(party.row.request_key)}"`)).match(/<form method="post" action="\/admin\/requests\/talked" data-talk-yes>[^]*?<\/form>/) || [])[0] || '';
const names = (f) => [...f.matchAll(/name="([a-z_]+)"/g)].map((m) => m[1]).filter((n) => n !== 'back').join(',');
must(Boolean(calForm) && Boolean(cardForm), 'no Yes, book it form on the calendar row or on the card');
must(names(calForm) === names(cardForm) && names(calForm) === 'r,go,date,time' && /<input type="time"[^>]*name="time"/.test(calForm), `the calendar's Yes, book it (with its ready-by time) does not send the card's fields (${names(calForm)} vs ${names(cardForm)})`);
must(new RegExp(`name="date" value="${day0}"`).test(calForm), 'the calendar date box is not prefilled with the requested day');
must(/<input type="hidden" name="back" value="\/admin\/calendar\?month=\d{4}-\d{2}">/.test(calForm) && /data-help="cal.bookYes"[^>]*>Book it<\/button>/.test(calForm), 'the calendar form does not come back to the calendar with a Book it button');
const vc = fs.readFileSync(path.join(ROOT, 'functions/_lib/views-calendar.mjs'), 'utf8');
const vv = fs.readFileSync(path.join(ROOT, 'functions/_lib/views.mjs'), 'utf8');
must(!/action="\/admin\/requests\/talked"/.test(vc) && /bookYesForm\(/.test(vc) && (vv.match(/action="\/admin\/requests\/talked" data-talk-yes/g) || []).length === 1 && /const yes = bookYesForm\(r, x\);/.test(vv), 'Yes, book it is built in more than one place (one builder: views.mjs bookYesForm)');
const moved = plus(8);
const res = await s.post('/admin/requests/talked', { r: s.rk(party.row.request_key), go: 'yes', date: moved, back: `/admin/calendar?month=${moved.slice(0, 7)}` });
must(/^\/admin\/calendar\?month=\d{4}-\d{2}&m=/.test(res.location) && /✓ Booked Cara Calmparty/.test(decodeURIComponent(res.location)), `Book it did not land back on the calendar with "✓ Booked" (${res.location})`);
const after = (await s.get(res.location)).text;
must(/data-cal-flash>✓ Booked Cara Calmparty/.test(after), 'the calendar does not show "✓ Booked …"');
must(/<span class="k party_setup" draggable="true"[^>]*data-help="cal.booking"[^>]*>Party setup: Cara Calmparty</.test(cellOf(after, moved)), 'the chip did not turn solid on the booked day');
must(!/Cara C/.test(cellOf(after, day0)), 'the old asked-for day still shows the request');
must(!/data-unconfirmed-row[^>]*><strong>Cara Calmparty/.test(after), 'the request did not leave Unconfirmed requests');
const st = await s.one('SELECT confirmed_at FROM request_steps WHERE request_key = ?1', party.row.request_key);
must(Boolean(st && st.confirmed_at), 'Book it on the calendar did not confirm the request the way the card does');
// A foreign back= is never followed.
for (const bad of ['https://evil.example/', '//evil.example/admin/calendar', '/admin/money', '/admin/calendar?month=x']) {
  const r2 = await s.post('/admin/requests/talked', { r: s.rk(rent.row.request_key), go: 'yes', date: '', back: bad });
  must(/^\/admin\/\?e=/.test(r2.location), `back=${bad} was followed (${r2.location})`);
}

// ---- 6. Takedowns: Schedule takedown -> Book takedown; Not needed ----------------------------
html = await cal(today);
const box = html.slice(at(html, 'data-takedowns-to-schedule'), html.indexOf('</section>', at(html, 'data-takedowns-to-schedule')));
must(at(html, 'data-takedowns-to-schedule') > at(html, 'id="calstep-2"') && at(html, 'data-takedowns-to-schedule') < at(html, 'id="calstep-3"'), 'Takedowns to schedule is not in Step 2');
must(/Nia Notneeded/.test(box) && /Ned Notneeded/.test(box) && /<summary class="btn primary" data-help="cal.tdOpen"[^>]*>Schedule takedown<\/summary>/.test(box) && new RegExp(`action="/admin/requests/takedown-inline" data-td-book>[^]*?name="kind" value="porch_takedown"[^]*?name="go" value="save"[^]*?name="date" value="${tdDay}"[^]*?>Book takedown</button>`).test(box), 'Takedowns to schedule has no Schedule takedown -> date -> Book takedown');
must(/action="\/admin\/requests\/takedown" data-td-not-needed>[^]*?name="plan" value="customer_handles"[^]*?>Not needed<\/button>/.test(box), 'Takedowns to schedule has no Not needed');
const tdRes = await s.post('/admin/requests/takedown-inline', { r: s.rk(porch2.row.request_key), kind: 'porch_takedown', go: 'save', date: tdDay, back: `/admin/calendar?month=${today.slice(0, 7)}#takedowns-to-schedule` });
must(/^\/admin\/calendar\?month=\d{4}-\d{2}&m=[^#]*#takedowns-to-schedule$/.test(tdRes.location) && /✓ Takedown on the calendar/.test(decodeURIComponent(tdRes.location)), `Book takedown did not come back to the calendar (${tdRes.location})`);
must(Boolean(await s.one("SELECT id FROM bookings WHERE request_key = ?1 AND kind = 'porch_takedown' AND date = ?2", porch2.row.request_key, tdDay)), 'Book takedown did not book the takedown');
const nn = await s.post('/admin/requests/takedown', { r: s.rk(porch3.row.request_key), plan: 'customer_handles', back: `/admin/calendar?month=${today.slice(0, 7)}#takedowns-to-schedule` });
must(/^\/admin\/calendar\?month=\d{4}-\d{2}&m=/.test(nn.location) && (await s.one('SELECT takedown_plan FROM requests WHERE request_key = ?1', porch3.row.request_key)).takedown_plan === 'customer_handles', `Not needed did not save "customer handles it" and come back (${nn.location})`);
html = await cal(today);
const after2 = html.slice(at(html, 'data-takedowns-to-schedule'), html.indexOf('</section>', at(html, 'data-takedowns-to-schedule')));
must(after2.includes('Takedowns to schedule (0)') && !/Nia Notneeded|Ned Notneeded/.test(after2), 'a booked / not-needed takedown is still in Takedowns to schedule');

// ---- 7. Nothing that was there is missing --------------------------------------------------
html = await cal(rentDay);
const has = [
  ['Every booking list at the bottom', /<details class="card evb" id="every-booking" data-every-booking><summary data-help="cal.everyBooking"[^>]*>Every booking \(\d+\)/.test(html) && at(html, 'id="every-booking"') > at(html, '<aside class="calside">') && /data-list-view><h2>Every booking<\/h2>/.test(html) && /data-show-past/.test(html)],
  ['List jumps to Every booking', /data-view="list"[^>]*data-help="cal.viewList"/.test(html) && /if\(v==='list'\)\{if\(every\)\{every\.open=true/.test(html) && /href="#every-booking" data-show-list/.test(html)],
  ['drag a booking', /<span class="k [a-z_ ]+" draggable="true" data-drag data-booking="\d+"/.test(html)],
  ['drag an Unconfirmed request', /<div class="u" draggable="true" data-drag data-rk="/.test(html)],
  ['drop on a day + Move', /c\.addEventListener\('drop'/.test(html) && /<form id="move-form" method="post" action="" hidden>/.test(html) && /\/admin\/calendar\/new\?r='\+encodeURIComponent\(d\.rk\)\+'&date='\+day/.test(html)],
  ['Add a booking', /<a class="btn" href="\/admin\/calendar\/new" data-help="cal.add"[^>]*>Add a booking<\/a>/.test(stepOf(html, 2))],
  ['Day sheet from a grid day', /<a class="day[^"]*" href="\/admin\/day\/\d{4}-\d{2}-\d{2}" data-day=/.test(html)],
  ['Day sheet from a phone day', /<a class="mdh" href="\/admin\/day\/\d{4}-\d{2}-\d{2}" data-help="cal.day"/.test(html)],
  ['Upcoming in Step 5', /<section class="upcoming" data-upcoming>/.test(stepOf(html, 5)) && /<a class="item" href="\/admin\/day\//.test(stepOf(html, 5))],
  ["Today's list", /href="\/admin\/day\/today" data-help="sub.today"[^>]*>Today&#39;s list<|href="\/admin\/day\/today" data-help="sub.today"[^>]*>Today's list</.test(stepOf(html, 3))],
  ['Link my Google Calendar', /href="\/admin\/calendar\/link" data-help="cal.link"/.test(html)],
  ['Held view', /data-view="held"/.test(html) && /<div data-pane="held" hidden>/.test(html)],
  ['month arrows', /data-help="cal.prev"/.test(html) && /data-help="cal.next"/.test(html) && /data-help="cal.today"/.test(html)],
  ['Unconfirmed requests in Step 2', /<section class="sub unsched" data-unconfirmed><h3>Unconfirmed requests \(\d+\)<\/h3>/.test(stepOf(html, 2))],
  ['Still to decide in Step 2', /id="still-to-decide" data-still-to-decide><h3>Still to decide \(\d+\)/.test(stepOf(html, 2))],
  ['Takedowns to schedule in Step 2', /data-takedowns-to-schedule><h3>Takedowns to schedule \(\d+\)/.test(stepOf(html, 2))],
  ['reminders in Step 4', /<section data-reminders>/.test(stepOf(html, 4))],
  ['More choices (full booking screen)', /href="\/admin\/calendar\/new\?r=[^"]+" data-help="cal.schedule"[^>]*>More choices</.test(stepOf(html, 2))],
];
for (const [what, ok] of has) must(ok, `missing on Calendar & Bookings: ${what}`);
must(/\.wrap\.wide\{max-width:1180px\}/.test(css), 'the wide computer page width changed');

// ---- 8. Help text for every new control -----------------------------------------------------
for (const k of ['cal.stepRow', 'cal.pday', 'cal.pjob', 'cal.jobText', 'cal.daySheet', 'cal.yesOpen', 'cal.bookYes', 'cal.tdOpen', 'cal.tdBook', 'cal.tdNotNeeded', 'cal.everyBooking']) {
  must(Boolean(H.HELP[k] && H.HELP[k].title && H.HELP[k].label && H.HELP[k].screen === 'calendar'), `help: ${k} is not in the map for Calendar & Bookings`);
}
const help = (await s.get('/admin/help')).text;
must(['cal.yesOpen', 'cal.bookYes', 'cal.pday', 'cal.pjob'].every((k) => help.includes(`data-help-entry="${k}"`)), 'the help page does not list the new calendar controls');
const doc = fs.readFileSync(path.join(ROOT, 'docs/admin-console.md'), 'utf8');
must(/Calm calendar/.test(doc) && /validate:admin-calm-calendar/.test(doc), 'docs/admin-console.md does not describe the calm calendar and its proof');

if (checks < 70) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) {
  console.error(`calm calendar: FAIL (${errors.length} of ${checks})`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`calm calendar: OK (${checks} checks: month first + steps 1-5 in the owner's words, Find a customer in Step 1, phone dots + tapped day + job details, Yes, book it = the card's form and lands back solid, dashed vs solid, takedown Book / Not needed, nothing missing, help text)`);
