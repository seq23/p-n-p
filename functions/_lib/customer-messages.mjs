// Who gets which customer message, and when (owner, 18 Oct 2026). The words live in
// messages.mjs; this file fills them from the request, its bookings and its invoice, and
// keeps every "send once" promise with a claim-before-send timestamp on the request.
//   confirmation  automatic email the moment a deposit is marked received (once; never for a
//                 phone request, source 'phone': they were confirmed on the call);
//                 "Text them it's confirmed" is Valerie's one tap (sms:, free).
//   holdEnding    automatic email reminderHours before a hold ends (once per end time);
//                 "Text a reminder" is her one tap.
//   thankyou      automatic email the morning after Job done / Returned (10 AM Memphis cron),
//                 once, never for void, no email, or "Don't send a thank-you"; undoing Job
//                 done before then cancels it. "Text a thank-you" stays optional and manual.
import { sendMessage, render } from './messages.mjs';
import { fromRow } from './requests.mjs';
import { balances } from './ledger.mjs';
import { hasEmail, chicagoDate } from './reminders.mjs';
import { chicagoDayOf } from './calendar.mjs';
import { shortDate as shortDateOf } from './util.mjs';
import { getHold, fromSql, dueHoldReminders, claimHoldReminder, releaseHoldReminderClaim, holdSettings } from './holds.mjs';
import { getSettings } from './util.mjs';

const money = (c) => `$${(Math.round(c) / 100).toFixed(2).replace(/\.00$/, '')}`;
const START = ['rental_pickup', 'porch_install', 'party_setup', 'grazing_setup'];
const SERVICE_OF_KIND = { rental_pickup: 'rentals', porch_install: 'porch', party_setup: 'party', grazing_setup: 'grazing' };

export function chicagoWords(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Chicago' }).replace(/^(\w+), (\w+) (\d+)$/, '$1 $3 $2');
  return `${day}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })}`;
}

// Everything a template needs for one request. null when the request is not in D1.
export async function messageCtx(db, key, { origin = 'https://porchandparty901.com' } = {}) {
  const row = await db.prepare('SELECT * FROM requests WHERE request_key = ?1').bind(key).first();
  if (!row) return null;
  const r = fromRow(row);
  const { results: bk } = await db.prepare('SELECT * FROM bookings WHERE request_key = ?1 ORDER BY date, id').bind(key).all();
  const bookings = bk || [];
  const start = bookings.find((b) => START.includes(b.kind));
  const st = await db.prepare('SELECT * FROM request_status WHERE request_key = ?1').bind(key).first();
  const bal = st && st.invoice_id ? (await balances(db))[st.invoice_id] : null;
  const services = r.services && r.services.length ? r.services : (r.wantsRentals ? ['rentals'] : ['party']);
  const service = start ? SERVICE_OF_KIND[start.kind] : services[0];
  const hold = await getHold(db, key);
  const ret = await db.prepare('SELECT * FROM rental_returns WHERE request_key = ?1').bind(key).first();
  const answers = [...(r.rentals || []), ...(r.decor || []), ...(r.other || [])];
  const eventDay = (answers.find((a) => /^(event date|pickup date)$/i.test(a.label)) || {}).value || '';
  const occasion = (answers.find((a) => /occasion|event type|season/i.test(a.label)) || {}).value || r.eventType || '';
  const owed = bal && !bal.void ? bal.remaining : 0;
  return {
    key, name: r.name, email: r.email, phone: r.phone, services, service,
    items: start ? String(start.items || '').replace(/, ([^,]*)$/, ' and $1') : '',
    day: start ? shortDateOf(start.date) : (eventDay ? shortDateOf(eventDay) : ''),
    rest: owed > 0 ? money(owed) : '',
    dueNow: bal && bal.invoice ? money(bal.invoice.deposit_due_cents) : '',
    holdEnds: hold && hold.until ? chicagoWords(fromSql(hold.until)) : '',
    depositBack: service === 'rentals' && ret && ret.returned_at && !ret.damaged && bal && bal.refundable ? money(bal.refundable) : '',
    referralUrl: row.referral_code ? `${origin.replace(/^https?:\/\//, '')}/r/${row.referral_code}` : `${origin.replace(/^https?:\/\//, '')}`,
    occasion: String(occasion).toLowerCase().replace(/ or other$/, ''),
    row,
  };
}

// The automatic confirmation email when a deposit is marked received. Once per request.
export async function autoConfirm(env, key) {
  const ctx = await messageCtx(env.DB, key);
  // A phone request (phone-requests.mjs) was confirmed on the call: never an automatic email.
  if (!ctx || ctx.row.source === 'phone' || ctx.row.confirm_emailed_at || ctx.row.is_test || !hasEmail(ctx.email)) return { sent: false };
  const claim = await env.DB.prepare("UPDATE requests SET confirm_emailed_at = datetime('now') WHERE request_key = ?1 AND confirm_emailed_at IS NULL").bind(key).run();
  if (!(claim && claim.meta && claim.meta.changes)) return { sent: false };
  const out = await sendMessage(env, 'email', 'confirmation', ctx);
  if (!out.ok) await env.DB.prepare('UPDATE requests SET confirm_emailed_at = NULL WHERE request_key = ?1').bind(key).run();
  return { sent: out.ok, error: out.error };
}

// The pnp-mailer cron's thank-you run (10 AM Memphis): jobs marked done before today.
export async function sendThankYous(env, now = new Date()) {
  const today = chicagoDate(now);
  const { results } = await env.DB.prepare(`SELECT r.request_key, rs.job_done_at FROM requests r JOIN request_status rs ON rs.request_key = r.request_key
    WHERE rs.job_done_at IS NOT NULL AND rs.status <> 'void' AND r.thankyou_emailed_at IS NULL AND r.thankyou_skip = 0 AND r.is_test = 0`).all();
  const out = { due: 0, sent: 0, skipped: 0, failed: 0 };
  for (const row of results || []) {
    if (!(chicagoDayOf(row.job_done_at) < today)) { out.skipped += 1; continue; } // marked today: it goes out tomorrow morning
    const ctx = await messageCtx(env.DB, row.request_key);
    if (!ctx || !hasEmail(ctx.email)) { out.skipped += 1; continue; }
    out.due += 1;
    const claim = await env.DB.prepare("UPDATE requests SET thankyou_emailed_at = datetime('now') WHERE request_key = ?1 AND thankyou_emailed_at IS NULL").bind(row.request_key).run();
    if (!(claim && claim.meta && claim.meta.changes)) { out.skipped += 1; continue; }
    const r = await sendMessage(env, 'email', 'thankyou', ctx);
    if (r.ok) out.sent += 1;
    else { out.failed += 1; await env.DB.prepare('UPDATE requests SET thankyou_emailed_at = NULL WHERE request_key = ?1').bind(row.request_key).run(); }
  }
  return out;
}

// The hourly hold reminder emails.
export async function sendHoldReminders(env, now = Date.now()) {
  const settings = await getSettings(env.DB);
  const due = await dueHoldReminders(env.DB, now, settings);
  const out = { due: due.length, sent: 0, failed: 0, skipped: 0 };
  for (const h of due) {
    if (!hasEmail(h.email)) { out.skipped += 1; continue; }
    if (!(await claimHoldReminder(env.DB, h.request_key, h.until))) { out.skipped += 1; continue; }
    const ctx = await messageCtx(env.DB, h.request_key);
    const r = await sendMessage(env, 'email', 'holdEnding', ctx);
    if (r.ok) out.sent += 1; else { out.failed += 1; await releaseHoldReminderClaim(env.DB, h.request_key); }
  }
  return { ...out, reminderHours: holdSettings(settings).reminderHours };
}

// The sms: link + the words, for a button (null when there is no mobile number).
export function smsFor(template, ctx) {
  if (!ctx) return null;
  const msg = render(template, ctx);
  const digits = String(ctx.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return digits.length >= 10 ? { href: `sms:${digits}?&body=${encodeURIComponent(msg.text)}`, text: msg.text } : null;
}
