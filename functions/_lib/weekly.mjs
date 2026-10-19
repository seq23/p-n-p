// The Monday summary email to Valerie (owner-approved 18 Oct 2026, JOB B). Automatic every
// Monday at 7:00 AM America/Chicago from the pnp-mailer hourly cron (12:00 UTC in daylight time,
// 13:00 UTC in standard time: only the run whose Memphis weekday is Monday and hour is 7 sends),
// to the Settings day-list email, switchable in Settings (default ON), and on demand from
// Settings ("Send me this week's summary now"). Idempotent per week: the run claims
// settings.weekly_summary_week = <Monday ISO> before sending, so a retried cron never sends twice.
// Customers appear as first name + last initial only; every line links into /admin.
import { fromRow, weekCounts, SERVICE_KEYS, SERVICE_WORDS, idOnFile } from './requests.mjs';
import { notPaidYet } from './notpaid.mjs';
import { listBookings, loadReturns, rentalWindows, usageOn, overdueReturns, addDays, outBetween } from './calendar.mjs';
import { KIND_LABELS } from './kinds.mjs';
import { currentHolds, endingSoon } from './holds.mjs';
import { chicagoDate, chicagoHour } from './reminders.mjs';
import { balances } from './ledger.mjs';
import { loadTakedownFacts, takedownsToSchedule } from './takedown.mjs';
import { getSettings, money, esc, FROM_EMAIL } from './util.mjs';
import { useInventory } from './inventory.mjs';
import { TRACK_TABLE as PRICE_TABLE } from './prices.mjs';

const SITE = 'https://porchandparty901.com';
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function mondayOfIso(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
const dayWord = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}`; };

// "Jane Doe" -> "Jane D." (never a full surname, phone or email in the summary).
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'No name';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

// Is `now` the Monday 7 AM Memphis run?
export function isSummaryHour(now = new Date()) {
  const today = chicagoDate(now);
  return new Date(`${today}T12:00:00Z`).getUTCDay() === 1 && chicagoHour(now) === 7;
}

// Everything the summary says, from D1. today = a Memphis date in the week being summarised.
export async function weeklyData(db, today, nowMs = Date.now()) {
  const thisMon = mondayOfIso(today);
  const lastMon = addDays(thisMon, -7);
  const lastSun = addDays(thisMon, -1);
  const thisSun = addDays(thisMon, 6);
  // The bookings list covers the next 14 days (owner, 18 Oct 2026), like the calendar's Upcoming box.
  const lastDay = addDays(thisMon, 13);
  const { results: rows } = await db.prepare('SELECT * FROM requests ORDER BY submitted_at DESC').all();
  const requests = (rows || []).map(fromRow).filter(Boolean);
  const { results: stRows } = await db.prepare('SELECT * FROM request_status').all();
  const statuses = Object.fromEntries((stRows || []).map((s) => [s.request_key, s]));
  const live = (r) => { const st = statuses[r.key]; return !(st && (st.archived_at || st.status === 'void')); };
  const wk = weekCounts(requests, thisMon);
  // Last week.
  const { results: done } = await db.prepare("SELECT request_key FROM request_status WHERE job_done_at IS NOT NULL AND date(job_done_at, '-6 hours') BETWEEN ?1 AND ?2").bind(lastMon, lastSun).all();
  const returns = await loadReturns(db);
  const returnedLastWeek = Object.values(returns).filter((r) => r.returned_at && String(r.returned_at).slice(0, 10) >= lastMon && String(r.returned_at).slice(0, 10) <= lastSun).length;
  const jobsDone = new Set((done || []).map((d) => d.request_key)).size + returnedLastWeek;
  const received = (await db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM payments WHERE voided_at IS NULL AND kind = 'payment' AND received_on BETWEEN ?1 AND ?2").bind(lastMon, lastSun).first()).c;
  const expenses = (await db.prepare("SELECT COALESCE(SUM(total_cents), 0) AS c FROM expenses WHERE status = 'saved' AND date BETWEEN ?1 AND ?2").bind(lastMon, lastSun).first()).c;
  // The next 14 days.
  const all = await listBookings(db);
  const voidKeys = new Set(Object.values(statuses).filter((s) => s.status === 'void').map((s) => s.request_key));
  const bookings = all.filter((b) => !(b.request_key && voidKeys.has(b.request_key)));
  const week = bookings.filter((b) => b.date >= thisMon && b.date <= lastDay);
  const windows = rentalWindows(bookings, returns, PRICE_TABLE);
  const days = [];
  for (let i = 0; i < 14; i += 1) {
    const d = addDays(thisMon, i);
    const list = week.filter((b) => b.date === d);
    const games = usageOn(windows, d, today, PRICE_TABLE).count;
    // Between a rental's pickup and its return the games are out: "Rental out" each day (19 Oct 2026).
    const outs = outBetween(windows, d, today).map((w) => ({ kind: 'Rental out', who: shortName(w.name), time: '' }));
    if (list.length || games || outs.length) days.push({ date: d, bookings: [...list.map((b) => ({ kind: KIND_LABELS[b.kind] || b.kind, who: shortName(b.customer_name), time: b.time || '' })), ...outs], games });
  }
  const np = await notPaidYet(db, requests, today);
  const weekKeys = new Set(week.map((b) => b.request_key).filter(Boolean));
  const weekInvoiceIds = new Set(week.map((b) => b.invoice_id).filter(Boolean));
  const toCollect = np.owed.filter((r) => weekKeys.has(r.requestKey) || weekInvoiceIds.has(r.id));
  // Needs you.
  const settings = await getSettings(db);
  const holds = endingSoon(await currentHolds(db), nowMs, settings);
  const overdue = overdueReturns(bookings, returns, today);
  const bals = await balances(db);
  const { results: depRows } = await db.prepare("SELECT DISTINCT invoice_id FROM payments WHERE voided_at IS NULL AND kind IN ('refund','deposit_kept')").all();
  const decided = new Set((depRows || []).map((x) => x.invoice_id));
  const damage = requests.filter((r) => returns[r.key] && returns[r.key].returned_at && returns[r.key].damaged && statuses[r.key] && statuses[r.key].invoice_id && !decided.has(statuses[r.key].invoice_id));
  const notDecided = requests.filter((r) => live(r) && r.takedownPlan === 'not_sure');
  const toSchedule = takedownsToSchedule(requests.filter(live), statuses, await loadTakedownFacts(db), today);
  const twoDaysAgo = addDays(today, -2);
  const noReply = requests.filter((r) => live(r) && !r.isTest && (!statuses[r.key] || (statuses[r.key].status === 'new' && !statuses[r.key].invoice_id)) && r.sortTime && new Date(r.sortTime).toISOString().slice(0, 10) <= twoDaysAgo);
  const idsReady = requests.filter((r) => {
    if (!idOnFile(r)) return false;
    const st = statuses[r.key];
    const b = st && st.invoice_id ? bals[st.invoice_id] : null;
    const paid = b ? (!b.void && b.total > 0 && b.remaining === 0) : Boolean(st && st.status === 'paid');
    return paid && (!r.wantsRentals || Boolean(returns[r.key] && returns[r.key].returned_at));
  });
  const receipts = (await db.prepare("SELECT COUNT(*) AS n FROM expenses WHERE status = 'needs_check'").first()).n;
  return {
    week: { start: thisMon, end: thisSun }, upcoming: { start: thisMon, end: lastDay }, lastWeek: { start: lastMon, end: lastSun },
    last: { byService: wk.lastByService, total: wk.lastWeek.length, jobsDone, received, expenses },
    this: { days, toCollect: toCollect.reduce((s, r) => s + r.owed, 0), toCollectCount: toCollect.length },
    needs: {
      holds: holds.map((h) => shortName(h.name)), overdue: overdue.map((b) => shortName(b.customer_name)), damage: damage.map((r) => shortName(r.name)),
      takedowns: notDecided.map((r) => shortName(r.name)), takedownsToSchedule: toSchedule.map((t) => `${shortName(t.name)}${t.date ? ` ${dayWord(t.date)}` : ''}`), noReply: noReply.map((r) => shortName(r.name)), idsReady: idsReady.map((r) => shortName(r.name)),
      receipts, notPaid: { count: np.count, total: np.total },
    },
  };
}

// The email: subject, html, text. Plain words, links into /admin.
export function renderSummary(d) {
  const L = [];
  const H = [];
  const sec = (title) => { L.push('', title.toUpperCase()); H.push(`<h2 style="font-family:Georgia,serif;font-size:22px;margin:22px 0 6px;">${esc(title)}</h2>`); };
  const line = (text, href = '') => { L.push(`- ${text}${href ? ` (${SITE}${href})` : ''}`); H.push(`<p style="margin:4px 0;">${href ? `<a href="${SITE}${esc(href)}" style="color:#b85f40;">${esc(text)}</a>` : esc(text)}</p>`); };
  const svc = SERVICE_KEYS.filter((k) => d.last.byService[k]).map((k) => `${d.last.byService[k]} ${SERVICE_WORDS[k]}`).join(', ');
  sec(`Last week (${dayWord(d.lastWeek.start)} – ${dayWord(d.lastWeek.end)})`);
  line(`New requests: ${d.last.total}${svc ? ` (${svc})` : ''}`, '/admin/');
  line(`Jobs done: ${d.last.jobsDone}`, '/admin/calendar');
  line(`Money received: ${money(d.last.received)}`, '/admin/money');
  line(`Expenses: ${money(d.last.expenses)}`, '/admin/money');
  sec(`Next 14 days (${dayWord(d.upcoming.start)} – ${dayWord(d.upcoming.end)})`);
  if (!d.this.days.length) line('Nothing booked in the next 14 days.', '/admin/calendar');
  for (const day of d.this.days) {
    const what = day.bookings.map((b) => `${b.kind}: ${b.who}${b.time ? ` at ${b.time}` : ''}`).join('; ');
    line(`${dayWord(day.date)}: ${what || 'no bookings'}${day.games ? ` · ${day.games} ${day.games === 1 ? 'game' : 'games'} out` : ''}`, `/admin/day/${day.date}`);
  }
  line(`Still to collect from these customers: ${money(d.this.toCollect)}${d.this.toCollectCount ? ` (${d.this.toCollectCount})` : ''}`, '/admin/money#not-paid');
  sec('Needs you');
  const n = d.needs;
  const list = (label, names, href) => { if (names.length) line(`${label}: ${names.length} (${names.join(', ')})`, href); };
  list('Holds ending soon', n.holds, '/admin/calendar');
  list('Games not returned yet', n.overdue, '/admin/calendar');
  list('Damage to decide (refund or keep the deposit)', n.damage, '/admin/');
  list('Takedowns to schedule', n.takedownsToSchedule || [], '/admin/calendar#takedowns-to-schedule');
  list('Takedowns not decided', n.takedowns, '/admin/calendar#still-to-decide');
  list('No reply after 2 days', n.noReply, '/admin/');
  list('IDs ready to delete', n.idsReady, '/admin/');
  if (n.receipts) line(`Receipts needing checking: ${n.receipts}`, '/admin/money');
  if (n.notPaid.count) line(`Not paid yet: ${n.notPaid.count} ${n.notPaid.count === 1 ? 'customer owes' : 'customers owe'} ${money(n.notPaid.total)}`, '/admin/money#not-paid');
  if (L[L.length - 1] === 'NEEDS YOU') line('Nothing needs you this week.');
  const subject = `Your week at Porch & Party: ${dayWord(d.week.start)}`;
  const text = [`Good morning Valerie, here is your week.`, ...L, '', `Open the console: ${SITE}/admin/`].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#faf7f2;"><div style="max-width:600px;margin:0 auto;padding:20px;font-family:Inter,Arial,sans-serif;font-size:16px;color:#3b302a;">
<div style="font-family:Georgia,serif;font-size:28px;">Porch &amp; Party</div><p>Good morning Valerie, here is your week.</p>${H.join('')}
<p style="margin-top:22px;"><a href="${SITE}/admin/" style="color:#b85f40;font-weight:600;">Open the console</a></p></div></body></html>`;
  return { subject, text, html };
}

// Send it. force: the Settings button (sends even if this week's already went, and does not
// claim the week). Returns { ok, skipped?, error? }.
export async function sendWeeklySummary(env, { now = new Date(), force = false, send } = {}) {
  const db = env.DB;
  await useInventory(env); // the games counts follow Settings -> Inventory
  const settings = await getSettings(db);
  if (!force && settings.weekly_summary === '0') return { ok: true, skipped: 'switched off in Settings' };
  const today = chicagoDate(now);
  const week = mondayOfIso(today);
  if (!force) {
    const claim = await db.prepare(`INSERT INTO settings (key, value) VALUES ('weekly_summary_week', ?1)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value <> excluded.value`).bind(week).run();
    if (!(claim && claim.meta && claim.meta.changes)) return { ok: true, skipped: `already sent for the week of ${week}` };
  }
  const msg = renderSummary(await weeklyData(db, today, now.getTime()));
  const to = settings.day_list_email || FROM_EMAIL;
  try {
    const ok = await send({ to, subject: msg.subject, html: msg.html, text: msg.text });
    if (!ok) throw new Error('the mailer did not accept it');
    return { ok: true, to, week };
  } catch (e) {
    if (!force) await db.prepare("DELETE FROM settings WHERE key = 'weekly_summary_week' AND value = ?1").bind(week).run();
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
