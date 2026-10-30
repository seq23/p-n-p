// Day-before reminders (owner-approved 18 Oct 2026, $0: no SMS provider). Shared by the
// admin console (the "Tomorrow's reminders" box: an sms: link Valerie taps) and the
// pnp-mailer Worker's daily cron (an email to each customer with an address on file).
// Every reminder is transactional, about one booking, as the Text messages clause in
// terms-and-conditions.html allows: no offers, no marketing. The wording lives ONLY here.

import { ownerCopy, isEnded } from './util.mjs';

export const BUSINESS_PHONE = '901-355-1518';
export const TZ = 'America/Chicago';

// The calendar date in Memphis for an instant ("2026-10-24"), whatever the server's zone.
export function chicagoDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function chicagoHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(now));
}

export function tomorrowChicago(now = new Date()) {
  const d = new Date(`${chicagoDate(now)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function dayWords(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()} ${d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}`;
}

export function timeWords(hhmm) {
  const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
  if (!m) return '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}${m[2] === '00' ? '' : `:${m[2]}`} ${h < 12 ? 'AM' : 'PM'}`;
}

// Digits only; a leading US country code 1 on an 11-digit number is dropped. '' if too short.
export function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length >= 7 ? digits : '';
}

const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

// One template per booking kind. {around} is ", around 10 AM" when a time is set.
export const REMINDER_TEMPLATES = {
  rental_pickup: ({ name, day, around, place }) => `Hi ${name}, this is Valerie with Porch & Party. Reminder: your game rental pickup is tomorrow, ${day}${around}, at ${place || 'Mt. Moriah Station'}. Text me at ${BUSINESS_PHONE} to set your pickup time. See you then!`,
  rental_return: ({ name, day, around, place }) => `Hi ${name}, this is Valerie with Porch & Party. Reminder: your game rental is due back tomorrow, ${day}${around}, at ${place || 'Mt. Moriah Station'}. Text me at ${BUSINESS_PHONE} if you need a different time. Thank you!`,
  porch_install: ({ name, day, around }) => `Hi ${name}, this is Valerie with Porch & Party. Reminder: your porch decorating install is tomorrow, ${day}${around}. Reply here if anything changes.`,
  porch_takedown: ({ name, day, around }) => `Hi ${name}, this is Valerie with Porch & Party. Reminder: we are coming to take down your porch decor tomorrow, ${day}${around}. Reply here if anything changes.`,
  party_setup: ({ name, day, around }) => `Hi ${name}, this is Valerie with Porch & Party. Reminder: your party setup is tomorrow, ${day}${around}. Reply here if anything changes.`,
  party_takedown: ({ name, day, around }) => `Hi ${name}, this is Valerie with Porch & Party. Reminder: we are coming to take down your party decor tomorrow, ${day}${around}. Reply here if anything changes.`,
  grazing_setup: ({ name, day, around, place }) => `Hi ${name}, this is Valerie with Porch & Party. Reminder: your grazing table setup is tomorrow, ${day}${around}${place ? ` at ${place}` : ''}. Reply here if your guest count or time changes.`,
  grazing_pickup: ({ name, day, around }) => `Hi ${name}, this is Valerie with Porch & Party. Reminder: we are coming to collect the grazing table boards and stands tomorrow, ${day}${around}. Reply here if anything changes.`,
  other: ({ name, day, around }) => `Hi ${name}, this is Valerie with Porch & Party. Reminder: we have you booked for tomorrow, ${day}${around}. Reply here if anything changes.`,
};

export function reminderText(b) {
  const tpl = REMINDER_TEMPLATES[b.kind] || REMINDER_TEMPLATES.other;
  const t = timeWords(b.time);
  return tpl({ name: first(b.customer_name), day: dayWords(b.date), around: t ? `, around ${t}` : '', place: b.place });
}

// sms:<digits>?&body=... is the one form both iPhone (Messages) and Android open with the
// text filled in. '' when there is no usable phone.
export function smsLink(phone, body) {
  const digits = normalizePhone(phone);
  return digits ? `sms:${digits}?&body=${encodeURIComponent(body)}` : '';
}

export function hasEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || '').trim());
}

// Tomorrow's bookings (Memphis date), skipping a void request or invoice and a request
// that was put away. The email fields come from the booking or, failing that, its invoice.
export async function tomorrowsBookings(db, now = new Date()) {
  const { results } = await db.prepare(`SELECT b.*, COALESCE(NULLIF(b.email, ''), i.customer_email, '') AS reminder_email
    FROM bookings b
    LEFT JOIN request_status rs ON rs.request_key = b.request_key
    LEFT JOIN invoices i ON i.id = b.invoice_id
    WHERE b.date = ?1
      AND (rs.status IS NULL OR rs.status <> 'void') AND rs.archived_at IS NULL
      AND (i.status IS NULL OR i.status <> 'void')
    ORDER BY COALESCE(b.time, ''), b.id`).bind(tomorrowChicago(now)).all();
  // A request marked Done (request_status.done_at) is ended too: read through SELECT * so this
  // never names a column the database might not have yet.
  const keys = [...new Set((results || []).map((b) => b.request_key).filter(Boolean))];
  if (!keys.length) return results || [];
  const { results: sts } = await db.prepare(`SELECT * FROM request_status WHERE request_key IN (${keys.map((_, i) => `?${i + 1}`).join(',')})`).bind(...keys).all();
  const ended = new Set((sts || []).filter((st) => isEnded(st)).map((st) => st.request_key));
  return (results || []).filter((b) => !b.request_key || !ended.has(b.request_key));
}

export function reminderEmail(b) {
  const text = reminderText(b);
  const subject = `Reminder from Porch & Party: tomorrow, ${dayWords(b.date)}`;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font:16px/1.5 Arial,sans-serif;color:#3b302a;max-width:560px">${esc(text).replace(/Reply here/, 'Reply to this email')}<p style="color:#5f5148;font-size:13px">Porch &amp; Party 901, Memphis. Questions? Call or text ${BUSINESS_PHONE}.</p></div>`;
  return { subject, html, text: text.replace(/Reply here/, 'Reply to this email') };
}

// The cron's work: email every customer with an address whose booking is tomorrow and who
// has not had this email yet. email_reminded_at is claimed BEFORE sending, so two runs can
// never both send; a failed send releases the claim for the next run.
export async function sendEmailReminders(db, send, now = new Date(), from = 'hello@porchandparty901.com') {
  const rows = await tomorrowsBookings(db, now);
  const out = { due: rows.length, sent: 0, skipped: 0, failed: 0 };
  for (const b of rows) {
    if (b.email_reminded_at || !hasEmail(b.reminder_email)) { out.skipped += 1; continue; }
    const claim = await db.prepare("UPDATE bookings SET email_reminded_at = datetime('now') WHERE id = ?1 AND email_reminded_at IS NULL").bind(b.id).run();
    if (claim && claim.meta && claim.meta.changes === 0) { out.skipped += 1; continue; }
    const mail = reminderEmail(b);
    let ok = false;
    try { ok = Boolean(await send({ to: b.reminder_email, ...ownerCopy('reminder'), replyTo: from, ...mail })); } catch { ok = false; }
    if (ok) out.sent += 1;
    else { out.failed += 1; await db.prepare('UPDATE bookings SET email_reminded_at = NULL WHERE id = ?1').bind(b.id).run(); }
  }
  return out;
}
