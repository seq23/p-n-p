// Valerie's daily to-do email (owner-approved mock, 19 Oct 2026). Every day at 7:00 AM
// America/Chicago from the pnp-mailer hourly cron: 12:00 UTC in daylight time (CDT, UTC-5),
// 13:00 UTC in standard time (CST, UTC-6); only the run whose Memphis hour is 7 sends, so daylight
// saving needs no change. To the Settings day-list email. Idempotent per Memphis day: the run
// claims settings.todo_email_day = <today> before sending and releases it if the send fails.
//
// Sections, each shown ONLY when it has something in it, in this order (the ones shown are
// numbered 1, 2, 3 ... with no gaps):
//   1 Today's jobs          today's bookings: time, who, job, place, what to bring, money; a
//                           CONFIRMED job today with no time carries the set-time prompt on its own
//                           line ("No time yet · Text them to pick one", Call + Text) and is never
//                           repeated in 3 (owner, 20 Oct 2026)
//   2 Call these people back open requests whose Called back step is not ticked (callback-list.mjs)
//   3 Set a time            every CONFIRMED booking from TOMORROW on with a day but no time (owner,
//                           20 Oct 2026): a rental only once its deposit is paid (steps.mjs depositIn,
//                           and no current hold in holds.mjs), a porch / party / grazing job only once
//                           confirmed (steps.mjs isConfirmed: "Yes, book it", phone, money in); a
//                           booking Valerie typed on the calendar with no request is hers, so it counts
//   4 Book it or decide     called back but nothing on the calendar; takedowns / pickups with no day
//   5 Money                 balances due today or late (the damage deposit is never owed), every
//                           unpaid rental hold ("Waiting for deposit · Games reserved until ..."), games not returned
// then "Tomorrow, <day>" and, on Mondays, "Your week" (weekly.mjs figures; the Settings switch
// weekly_summary = include it). Nothing in 1-5 and nothing tomorrow: the email says only
// "All clear today". Customers appear as first name + last initial only; a phone number is only
// ever inside a Call (tel:) / Text (sms:) link, never shown. Every other link goes into /admin.
import { requestFacts, callbackRows, serviceWords } from './callback-list.mjs';
import { waitingWords, depositOutcomes } from './steps.mjs';
import { shortName, askedDate } from './requested.mjs';
import { listBookings, loadReturns, overdueReturns, addDays, daySort } from './calendar.mjs';
import { serviceOfKind } from './kinds.mjs';
import { currentHolds } from './holds.mjs';
import { balances, linesByInvoice } from './ledger.mjs';
import { notPaidRows } from './notpaid.mjs';
import { chicagoDate, chicagoHour, dayWords, timeWords, smsLink, normalizePhone } from './reminders.mjs';
import { render as renderMessage } from './messages.mjs';
import { weeklyData } from './weekly.mjs';
import { getSettings, money, esc, b64urlText, FROM_EMAIL } from './util.mjs';
import { useInventory } from './inventory.mjs';

const SITE = 'https://porchandparty901.com';
export const TODO_HOUR = 7;
// Highlighted (the approved sample): a call back waiting 2+ days, a missing time within 2 days.
export const CALLBACK_HIGHLIGHT_DAYS = 2;
export const SET_TIME_HIGHLIGHT_DAYS = 2;
export const SECTION_TITLES = { 1: "Today's jobs", 2: 'Call these people back', 3: 'Set a time', 4: 'Book it or decide', 5: 'Money' };
export const SECTION_WHY = {
  1: '',
  2: 'They sent a request and have not heard from you yet.',
  3: 'These are booked for a day, but no time is set. Text them to pick one.',
  4: 'You talked to them, but nothing is on the calendar yet.',
  5: '',
};
// The job in her words ("party takedown", "games return").
export const JOB_WORDS = {
  rental_pickup: 'games pickup', rental_return: 'games return', porch_install: 'porch install', porch_takedown: 'porch takedown',
  party_setup: 'party setup', party_takedown: 'party takedown', grazing_setup: 'grazing setup', grazing_pickup: 'grazing pickup', other: 'job',
};
const RENTAL_PLACE = 'Mt. Moriah Station';
const usd = (c) => money(c).replace(/\.00$/, '');

export const isTodoHour = (now = new Date()) => chicagoHour(now) === TODO_HOUR;
export const isMondayIso = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay() === 1;
const cardHref = (key) => `/admin/#c-${b64urlText(key)}`;
const bookingHref = (b) => (b.request_key ? cardHref(b.request_key) : `/admin/day/${b.date}`);
const telHref = (phone) => { const d = normalizePhone(phone); return d ? `tel:${d}` : ''; };
const callText = (phone, body = '') => {
  const tel = telHref(phone);
  if (!tel) return [];
  return [{ label: 'Call', href: tel }, { label: 'Text', href: body ? smsLink(phone, body) : `sms:${normalizePhone(phone)}` }];
};
// The set-time prompt on a job today with no time (owner, 20 Oct 2026).
export const TODAY_SET_TIME_PROMPT = 'No time yet · Text them to pick one';
const hasTime = (b) => /^\d{2}:\d{2}$/.test(String(b.time || ''));
const memphisTime = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)).replace(':00', '');

// Everything the email says, from D1. today = the Memphis date of the email.
export async function todoData(db, today, nowMs = Date.now(), { includeWeek = null } = {}) {
  const settings = await getSettings(db);
  const tomorrow = addDays(today, 1);
  const [facts, all, returns, bals, outcomes, linesBy, holds] = await Promise.all([
    requestFacts(db, today), listBookings(db), loadReturns(db), balances(db), depositOutcomes(db), linesByInvoice(db), currentHolds(db),
  ]);
  const { results: stRows } = await db.prepare('SELECT * FROM request_status').all();
  const statuses = Object.fromEntries((stRows || []).map((s) => [s.request_key, s]));
  const { results: reqRows } = await db.prepare('SELECT request_key, name, phone, is_test FROM requests').all();
  const reqBy = Object.fromEntries((reqRows || []).map((x) => [x.request_key, x]));
  const invoiceOf = (b) => b.invoice_id || (b.request_key && statuses[b.request_key] && statuses[b.request_key].invoice_id) || null;
  // A booking counts unless its request is put away / void / a test or its invoice is void.
  const live = (b) => {
    const st = b.request_key ? statuses[b.request_key] : null;
    if (st && (st.archived_at || st.status === 'void')) return false;
    if (b.request_key && reqBy[b.request_key] && reqBy[b.request_key].is_test) return false;
    const inv = invoiceOf(b);
    return !(inv && bals[inv] && bals[inv].void);
  };
  const bookings = all.filter(live);
  const open = bookings.filter((b) => !b.done_at);
  const who = (b) => shortName(b.customer_name || (reqBy[b.request_key] && reqBy[b.request_key].name));
  const phoneOf = (b) => b.phone || (reqBy[b.request_key] && reqBy[b.request_key].phone) || '';
  const timeOr = (b) => timeWords(b.time) || 'time not set';
  // Confirmed (reuses steps.mjs and holds.mjs; no new definition): a rental needs its deposit paid
  // and no current hold; any other job needs its request confirmed. No request = Valerie's own.
  const factsBy = Object.fromEntries(facts.map((f) => [f.r.key, f]));
  const heldKeys = new Set(holds.map((h) => h.request_key));
  const confirmedJob = (b) => {
    if (!b.request_key) return true;
    const f = factsBy[b.request_key];
    if (!f) return false;
    if (serviceOfKind(b.kind) === 'rentals') return Boolean(f.s.depositIn) && !heldKeys.has(b.request_key);
    return Boolean(f.s.confirmed);
  };
  // The set-time Call / Text (Text prefilled from the setTime message template).
  const setTimeBtns = (b) => {
    const job = JOB_WORDS[b.kind] || 'job';
    const body = renderMessage('setTime', { name: b.customer_name || (reqBy[b.request_key] && reqBy[b.request_key].name), job, day: dayWords(b.date) }).text;
    return callText(phoneOf(b), body);
  };
  // A CONFIRMED open job with a day but no time is asked for one: today's in section 1, the rest in 3.
  const needsTime = (b) => !hasTime(b) && confirmedJob(b);

  // 1. Today's jobs.
  const jobs = open.filter((b) => b.date === today).sort(daySort).map((b) => {
    const svc = serviceOfKind(b.kind);
    const bal = invoiceOf(b) ? bals[invoiceOf(b)] : null;
    const bits = [b.place || (svc === 'rentals' ? RENTAL_PLACE : '')];
    const items = String(b.items || '').trim().replace(/\s+/g, ' ').slice(0, 160);
    // What to bring to a setup / install, what to load at a takedown / pickup; rentals: the games.
    if (items) bits.push(svc === 'rentals' ? items : `${/takedown|pickup/.test(b.kind) ? 'load' : 'bring'} ${items}`);
    if (bal && bal.owed > 0 && b.kind !== 'rental_return') bits.push(`collect ${usd(bal.owed)}`);
    if (bal && b.kind === 'rental_return') {
      const out = outcomes[invoiceOf(b)] || { refunded: 0, kept: 0 };
      const held = Math.max(0, bal.refundable - bal.depositOwed - (out.refunded || 0) - (out.kept || 0));
      if (held > 0) bits.push(`give back ${usd(held)} deposit`);
    }
    const ask = needsTime(b);
    return { svc, t: `${timeOr(b)} · ${who(b)} · ${JOB_WORDS[b.kind] || 'job'}`, d: bits.filter(Boolean).join(' · '), p: ask ? TODAY_SET_TIME_PROMPT : '', btns: [...(ask ? setTimeBtns(b) : []), { label: 'Open card', href: bookingHref(b) }], key: b.request_key || '', id: b.id, invoice: invoiceOf(b), job: JOB_WORDS[b.kind] || 'job' };
  });

  // 2. Call these people back (oldest first).
  const callbacks = (await callbackRows(db, today, facts)).map((c) => ({
    svc: (c.services || [])[0] || 'other', key: c.key,
    t: `${c.name} · ${c.service}${c.asked ? ` · ${dayWords(c.asked)}` : ''}`,
    d: c.days <= 0 ? 'Came in today' : waitingWords(c.days), days: c.days, hi: c.days >= CALLBACK_HIGHLIGHT_DAYS,
    btns: [...callText(c.phone), { label: 'Open card', href: cardHref(c.key) }],
  }));

  // 3. Set a time: every CONFIRMED open booking from TOMORROW on with no time, soonest first (a job
  // today is asked in section 1, never twice). An unpaid rental hold (invoiced or not) is never
  // asked for a time: it is in Money instead.
  const soon = addDays(today, SET_TIME_HIGHLIGHT_DAYS);
  const setTime = open.filter((b) => b.date > today && needsTime(b))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || daySort(a, b)).map((b) => {
      const job = JOB_WORDS[b.kind] || 'job';
      return { svc: serviceOfKind(b.kind), t: `${who(b)} · ${job} ${dayWords(b.date)}`, d: 'No time yet', hi: b.date <= soon, date: b.date, key: b.request_key || '', id: b.id, btns: setTimeBtns(b) };
    });

  // 4. Book it or decide.
  const decide = [];
  const byAge = [...facts].sort((a, b) => (a.r.sortTime || 0) - (b.r.sortTime || 0));
  for (const f of byAge) {
    if (!f.s.called || f.s.jobDone || f.s.finished || f.bookings.length) continue;
    const asked = f.services[0] ? askedDate(f.r, f.services[0]) : '';
    decide.push({ type: 'book', svc: f.services[0] || 'other', key: f.r.key, t: `${shortName(f.r.name)} · ${serviceWords(f.services)}${asked ? ` · asked for ${dayWords(asked)}` : ''}`, d: 'Not booked yet', btns: [{ label: 'Yes, book it', href: cardHref(f.r.key), solid: true }, { label: 'Open card', href: cardHref(f.r.key) }] });
  }
  // Takedowns / pickups with no day: only once she has talked to them (before that the request is
  // in "Call these people back", and the takedown is part of that call).
  for (const f of byAge) {
    if (!f.s.called) continue;
    const td = f.tdS || {};
    const name = shortName(f.r.name);
    if (td.status === 'to_schedule' || td.status === 'not_sure') {
      const job = JOB_WORDS[td.kind] || 'takedown';
      const d = td.status === 'not_sure' ? 'Not decided yet' : (td.date ? `Asked for ${dayWords(td.date)}, not booked yet` : 'No takedown day yet');
      decide.push({ type: 'takedown', svc: serviceOfKind(td.kind), key: f.r.key, t: `${name} · ${job}`, d, btns: [{ label: 'Schedule takedown', href: cardHref(f.r.key), solid: true }, { label: 'Not needed', href: cardHref(f.r.key) }] });
    }
    // A grazing table that was set up (or is booked) with no pickup day and no "not needed".
    const setup = f.bookings.find((b) => b.kind === 'grazing_setup');
    const pickupStep = f.s.steps.find((x) => x.key === 'pickup');
    if (f.services.includes('grazing') && setup && !f.s.grazingPickup && pickupStep && !pickupStep.done) {
      decide.push({ type: 'pickup', svc: 'grazing', key: f.r.key, t: `${name} · grazing pickup`, d: 'No pickup day yet', btns: [{ label: 'Schedule pickup', href: cardHref(f.r.key), solid: true }, { label: 'Not needed', href: cardHref(f.r.key) }] });
    }
  }

  // 5. Money.
  const moneyItems = [];
  const requestsByKey = Object.fromEntries(facts.map((f) => [f.r.key, { ...f.r, services: f.services }]));
  const np = notPaidRows(bals, linesBy, requestsByKey, today);
  for (const row of np.owed.filter((x) => Number.isFinite(x.days) && x.days <= 0)) {
    const job = jobs.find((j) => j.invoice === row.id || (j.key && j.key === row.requestKey));
    const body = renderMessage('paymentReminder', { name: row.name, amount: usd(row.owed), due: row.due ? dayWords(row.due) : '', late: row.tone === 'late', number: row.number }).text;
    const sms = smsLink(row.phone, body);
    moneyItems.push({ type: 'owed', svc: row.services[0] || 'other', key: row.requestKey, owed: row.owed, t: `${shortName(row.name)} · ${usd(row.owed)} still owed`, d: `${row.words}${job ? `, at the ${job.job.split(' ').pop()}` : ''}`,
      btns: [...(sms ? [{ label: 'Text a reminder', href: sms }] : []), { label: 'Mark paid', href: `/admin/invoices/${row.id}` }] });
  }
  // Every unpaid rental hold (owner, 20 Oct 2026): waiting for its deposit, with the invoice's
  // amount due, unless Money already lists that request.
  for (const h of holds) {
    if (statuses[h.request_key] && (statuses[h.request_key].archived_at || statuses[h.request_key].status === 'void')) continue;
    if (reqBy[h.request_key] && reqBy[h.request_key].is_test) continue;
    if (moneyItems.some((x) => x.key && x.key === h.request_key)) continue;
    const timed = !h.by_hand && Number.isFinite(h.untilMs);
    const endDay = timed ? chicagoDate(new Date(h.untilMs)) : '';
    const until = !timed ? 'Reserved by hand (no end date)' : `Games reserved until ${endDay === today ? 'today' : dayWords(endDay)} ${memphisTime(h.untilMs)}`;
    const bal = h.invoice_id ? bals[h.invoice_id] : null;
    const due = bal && !bal.void ? bal.owed + bal.depositOwed : 0;
    const d = bal && !bal.void ? (due > 0 ? `${usd(due)} due on the invoice` : 'Deposit not paid yet') : 'Invoice not sent yet';
    moneyItems.push({ type: 'hold', svc: 'rentals', key: h.request_key, due, t: `${shortName(h.name)} · Waiting for deposit · ${until}`, d, btns: [{ label: 'Reserve their games longer', href: cardHref(h.request_key), solid: true }, { label: 'Open card', href: cardHref(h.request_key) }] });
  }
  for (const b of overdueReturns(bookings, returns, today)) {
    moneyItems.push({ type: 'overdue', svc: 'rentals', key: b.request_key || '', t: `${who(b)} · games not returned yet`, d: `Due back ${dayWords(b.date)}`, btns: [...callText(phoneOf(b)), { label: 'Open card', href: bookingHref(b) }] });
  }

  const tomorrowJobs = open.filter((b) => b.date === tomorrow).sort(daySort).map((b) => ({ svc: serviceOfKind(b.kind), t: `${timeOr(b)} · ${who(b)} · ${JOB_WORDS[b.kind] || 'job'}` }));
  const monday = isMondayIso(today);
  const withWeek = includeWeek === null ? monday && settings.weekly_summary !== '0' : includeWeek;
  let week = null;
  if (withWeek) {
    const w = await weeklyData(db, today, nowMs);
    week = { newRequests: w.last.total, jobsDone: w.last.jobsDone, moneyIn: w.last.received, tips: w.last.tips || 0, expenses: w.last.expenses, next14: w.upcomingJobs };
  }
  return { today, tomorrow, monday, sections: { 1: jobs, 2: callbacks, 3: setTime, 4: decide, 5: moneyItems }, tomorrowJobs, week };
}

export const isAllClear = (d) => [1, 2, 3, 4, 5].every((n) => !d.sections[n].length) && !d.tomorrowJobs.length;

// ---- the email: subject, html, text (the approved mock: one calm 600px column) --------------
const C = { bg: '#eef0f2', mail: '#ffffff', fg: '#2c2520', muted: '#6f6359', line: '#ece4da', accent: '#b65f3e', soft: '#faf6f0', hi: '#fdf0e6', ok: '#2f7a46' };
const BAR = { porch: '#c8641e', party: '#7a3fa8', grazing: '#2f7a46', rentals: '#2456c9', other: '#ece4da' };
const SANS = "'Source Sans 3', 'Helvetica Neue', Arial, sans-serif";
const SERIF = "Fraunces, Georgia, 'Times New Roman', serif";
const abs = (h) => (/^(tel|sms):/.test(h) ? h : `${SITE}${h}`);
function btnHtml(b) {
  const fill = b.solid ? `background:${C.accent};color:#ffffff;` : `background:${C.mail};color:${C.accent};`;
  return `<a href="${esc(abs(b.href))}" style="display:inline-block;margin:0 8px 6px 0;font-size:14px;font-weight:700;${fill}border:1.5px solid ${C.accent};border-radius:8px;padding:4px 12px;text-decoration:none;">${esc(b.label)}</a>`;
}
function itemHtml(it) {
  const hi = it.hi ? `background:${C.hi};border-radius:0 8px 8px 0;` : '';
  return `<div data-item${it.hi ? ' data-hi' : ''} style="border-left:4px solid ${BAR[it.svc] || BAR.other};${hi}padding:6px 8px 6px 12px;margin:0 0 8px 38px;">`
    + `<div style="font-weight:700;">${esc(it.t)}</div>${it.d ? `<div style="color:${C.muted};font-size:15px;">${esc(it.d)}</div>` : ''}`
    + `${it.p ? `<div data-set-time style="color:${C.accent};font-size:15px;font-weight:700;">${esc(it.p)}</div>` : ''}`
    + `${it.btns && it.btns.length ? `<div style="margin-top:6px;">${it.btns.map(btnHtml).join('')}</div>` : ''}</div>`;
}
function headHtml(mark, title, markBg = C.accent) {
  return `<div style="margin:0 0 8px;"><span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:14px;background:${markBg};color:#ffffff;text-align:center;font-weight:700;margin-right:10px;vertical-align:middle;">${esc(mark)}</span><span style="font-size:18px;font-weight:700;vertical-align:middle;">${esc(title)}</span></div>`;
}
const HR = `<hr style="border:0;border-top:1px solid ${C.line};margin:20px 0;">`;
const page = (inner) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your to-do list</title></head>
<body style="margin:0;padding:0;background:${C.bg};"><div style="max-width:600px;margin:0 auto;padding:20px 12px;">
<div style="background:${C.mail};border:1px solid ${C.line};border-radius:12px;padding:24px 20px;font-family:${SANS};font-size:17px;line-height:1.5;color:${C.fg};">${inner}</div></div></body></html>`;
const WEEK_ROWS = (w) => [['New requests last week', String(w.newRequests)], ['Jobs done last week', String(w.jobsDone)], ['Money in last week', usd(w.moneyIn)], ['Tips', usd(w.tips)], ['Expenses', usd(w.expenses)], ['Jobs in the next 14 days', String(w.next14)]];
function weekHtml(w) {
  const rows = WEEK_ROWS(w).map(([k, v]) => `<tr><td style="padding:4px 0;border-bottom:1px solid ${C.line};">${esc(k)}</td><td style="padding:4px 0;border-bottom:1px solid ${C.line};text-align:right;font-weight:700;">${esc(v)}</td></tr>`).join('');
  return `<div data-week>${headHtml('★', 'Your week (Monday summary)', C.muted)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-left:38px;width:calc(100% - 38px);font-size:15px;">${rows}</table></div>`;
}

export function renderTodo(d) {
  const subject = `Your to-do list for ${dayWords(d.today)} · Porch & Party`;
  const footHtml = `<p style="margin:20px 0 0;font-size:14px;color:${C.muted};text-align:center;"><a href="${SITE}/admin/" style="color:${C.accent};">Open the admin</a> · This email comes every day at 7 AM.</p>`;
  const T = [];
  const weekText = (w) => ['', 'YOUR WEEK (MONDAY SUMMARY)', ...WEEK_ROWS(w).map(([k, v]) => `- ${k}: ${v}`)];
  if (isAllClear(d)) {
    const html = page(`<div data-all-clear style="text-align:center;padding:30px 0;font-family:${SERIF};font-size:28px;font-weight:600;color:${C.ok};">All clear today</div>${d.week ? `${HR}${weekHtml(d.week)}` : ''}`);
    return { subject, html, text: ['All clear today', ...(d.week ? weekText(d.week) : [])].join('\n') };
  }
  const H = [`<h1 style="font-family:${SERIF};font-size:26px;line-height:1.2;font-weight:600;margin:0 0 6px;">Good morning, Valerie</h1><p style="margin:0 0 20px;color:${C.muted};">Here is what needs you today, in order.</p>`];
  T.push('Good morning, Valerie', 'Here is what needs you today, in order.');
  // The sections SHOWN are numbered 1, 2, 3 ... in order (owner, 20 Oct 2026): an empty section
  // leaves no gap in the numbers. data-section stays the section's fixed key.
  let first = true;
  let shown = 0;
  for (const n of [1, 2, 3, 4, 5]) {
    const items = d.sections[n];
    if (!items.length) continue;
    shown += 1;
    H.push(`${first ? '' : HR}<div data-section="${n}" data-num="${shown}">${headHtml(String(shown), SECTION_TITLES[n])}${SECTION_WHY[n] ? `<p style="margin:0 0 10px 38px;color:${C.muted};font-size:15px;">${esc(SECTION_WHY[n])}</p>` : ''}${items.map(itemHtml).join('')}</div>`);
    first = false;
    T.push('', `${shown}. ${SECTION_TITLES[n].toUpperCase()}`);
    if (SECTION_WHY[n]) T.push(SECTION_WHY[n]);
    for (const it of items) {
      const link = (it.btns || []).find((b) => b.href.startsWith('/admin'));
      T.push(`- ${it.t}${it.d ? ` (${it.d})` : ''}${link ? `: ${SITE}${link.href}` : ''}`);
      if (it.p) T.push(`  ${it.p}`);
    }
  }
  const tom = d.tomorrowJobs.length ? d.tomorrowJobs.map((j) => `<div>${esc(j.t)}</div>`).join('') : '<div>Nothing booked.</div>';
  H.push(`<div data-tomorrow style="background:${C.soft};border-radius:10px;padding:12px 14px;margin:20px 0 0;font-size:15px;"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};font-weight:700;">Tomorrow, ${esc(dayWords(d.tomorrow))}</div>${tom}</div>`);
  T.push('', `TOMORROW, ${dayWords(d.tomorrow).toUpperCase()}`, ...(d.tomorrowJobs.length ? d.tomorrowJobs.map((j) => `- ${j.t}`) : ['Nothing booked.']));
  if (d.week) { H.push(`${HR}${weekHtml(d.week)}`); T.push(...weekText(d.week)); }
  H.push(footHtml);
  T.push('', `Open the admin: ${SITE}/admin/ · This email comes every day at 7 AM.`);
  return { subject, html: page(H.join('')), text: T.join('\n') };
}

// Build today's email without sending it (the Settings preview and the read-only render).
export async function buildTodoEmail(env, now = new Date()) {
  await useInventory(env); // the weekly figures follow Settings -> Inventory
  const today = chicagoDate(now);
  return { today, ...renderTodo(await todoData(env.DB, today, now.getTime())) };
}

// Send it. force: "Send me today's list now" in Settings (sends even if today's already went or
// the switch is off, and never claims the day). The cron: switched off in Settings (todo_email
// = '0') it sends nothing. Returns { ok, skipped?, error?, to, day }.
export async function sendTodoEmail(env, { now = new Date(), force = false, send } = {}) {
  const db = env.DB;
  const settings = await getSettings(db);
  if (!force && settings.todo_email === '0') return { ok: true, skipped: 'switched off in Settings' };
  const day = chicagoDate(now);
  if (!force) {
    const claim = await db.prepare(`INSERT INTO settings (key, value) VALUES ('todo_email_day', ?1)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value <> excluded.value`).bind(day).run();
    if (!(claim && claim.meta && claim.meta.changes)) return { ok: true, skipped: `already sent for ${day}` };
  }
  const to = settings.day_list_email || FROM_EMAIL;
  try {
    const msg = await buildTodoEmail(env, now);
    const ok = await send({ to, subject: msg.subject, html: msg.html, text: msg.text });
    if (!ok) throw new Error('the mailer did not accept it');
    return { ok: true, to, day };
  } catch (e) {
    if (!force) await db.prepare("DELETE FROM settings WHERE key = 'todo_email_day' AND value = ?1").bind(day).run();
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
