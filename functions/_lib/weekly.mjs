// The Monday figures for Valerie (owner-approved 18 Oct 2026, JOB B). Since 19 Oct 2026 there is
// no separate Monday email: the daily 7 AM to-do email (todo-email.mjs) carries a "Your week" box
// on Mondays with last week's new requests, jobs done, money in, tips, expenses and the jobs in
// the next 14 days, read from weeklyData here. Settings -> weekly_summary (default ON) now means
// "include Your week on Mondays". Customers appear as first name + last initial only.
import { fromRow, weekCounts, idOnFile } from './requests.mjs';
import { notPaidYet } from './notpaid.mjs';
import { listBookings, loadReturns, rentalWindows, usageOn, overdueReturns, addDays, outBetween } from './calendar.mjs';
import { KIND_LABELS } from './kinds.mjs';
import { currentHolds, endingSoon } from './holds.mjs';
import { balances } from './ledger.mjs';
import { loadTakedownFacts, takedownsToSchedule } from './takedown.mjs';
import { unconfirmedKeys, loadStored } from './steps.mjs';
import { getSettings } from './util.mjs';
import { TRACK_TABLE as PRICE_TABLE } from './prices.mjs';

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
  // Tips (tips table, migration 0019): their own figure, never part of money received.
  const tips = await db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS c FROM tips WHERE removed_at IS NULL AND date BETWEEN ?1 AND ?2').bind(lastMon, lastSun).first().then((r) => r.c).catch(() => 0);
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
  // Unconfirmed requests (owner, 19 Oct 2026): the same list Calendar & Bookings shows.
  const unconf = unconfirmedKeys({ requests: requests.filter(live), statuses, invoices: bals, returns, stored: await loadStored(db) });
  const unconfirmed = requests.filter((r) => unconf.has(r.key));
  return {
    week: { start: thisMon, end: thisSun }, upcoming: { start: thisMon, end: lastDay }, lastWeek: { start: lastMon, end: lastSun },
    // Jobs in the next 14 days (the "Your week" box): every live booking in the window.
    upcomingJobs: week.length,
    last: { byService: wk.lastByService, total: wk.lastWeek.length, jobsDone, received, tips, expenses },
    this: { days, toCollect: toCollect.reduce((s, r) => s + r.remaining, 0), toCollectCount: toCollect.length },
    needs: {
      holds: holds.map((h) => shortName(h.name)), overdue: overdue.map((b) => shortName(b.customer_name)), damage: damage.map((r) => shortName(r.name)),
      takedowns: notDecided.map((r) => shortName(r.name)), takedownsToSchedule: toSchedule.map((t) => `${shortName(t.name)}${t.date ? ` ${dayWord(t.date)}` : ''}`), noReply: noReply.map((r) => shortName(r.name)), idsReady: idsReady.map((r) => shortName(r.name)),
      receipts, notPaid: { count: np.count, total: np.total }, unconfirmed: unconfirmed.map((r) => shortName(r.name)),
    },
  };
}
