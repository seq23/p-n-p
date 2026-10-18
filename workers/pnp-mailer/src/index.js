// pnp-mailer: sends one email through Cloudflare Email Service on behalf of the
// p-n-p Pages Functions (service binding MAILER). Reachable only through that binding.
// Its cron runs every hour (UTC, on the hour):
//   every hour   expire unpaid rental holds whose end time has passed, and email each
//                customer whose hold ends within the Settings reminder window (once per
//                end time) - functions/_lib/holds.mjs + customer-messages.mjs;
//   10 AM Memphis (15:00 UTC in daylight time, 16:00 UTC in standard time: only the run whose
//                Memphis hour is 10 does it) - the day-before booking reminders
//                (reminders.mjs), the thank-you emails for jobs marked done before today
//                (customer-messages.mjs sendThankYous) and the daily Google Sheet resync;
//   Monday 7 AM Memphis (12:00 UTC in daylight time, 13:00 UTC in standard time: only the run
//                whose Memphis weekday is Monday and hour is 7) - Valerie's weekly summary
//                (functions/_lib/weekly.mjs), claimed per week so it never sends twice.
import { sendEmailReminders, chicagoHour } from '../../../functions/_lib/reminders.mjs';
import { expireHolds } from '../../../functions/_lib/holds.mjs';
import { sendThankYous, sendHoldReminders } from '../../../functions/_lib/customer-messages.mjs';
import { sendWeeklySummary, isSummaryHour } from '../../../functions/_lib/weekly.mjs';

const FROM = { email: 'hello@porchandparty901.com', name: 'Porch & Party' };

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function sendOne(env, msg) {
  await env.EMAIL.send({ to: msg.to, ...(msg.bcc ? { bcc: msg.bcc } : {}), from: FROM, replyTo: msg.replyTo || FROM.email, subject: msg.subject, html: msg.html, text: msg.text || '' });
  return true;
}

// The site's messages go out through this Worker's own /send (same code path as the site).
const mailEnv = (env) => ({ ...env, MAILER: { fetch: (url, init) => worker.fetch(new Request(url, init), env) } });

export async function runReminders(env, now = new Date()) {
  const hourly = { expiredHolds: await expireHolds(env.DB, now.getTime()), holdReminders: await sendHoldReminders(mailEnv(env), now.getTime()) };
  if (isSummaryHour(now)) hourly.weekly = await sendWeeklySummary(env, { now, send: (m) => sendOne(env, m) });
  if (chicagoHour(now) !== 10) return { ...hourly, daily: `not 10 AM in Memphis (hour ${chicagoHour(now)})` };
  const reminders = await sendEmailReminders(env.DB, (m) => sendOne(env, m), now, FROM.email);
  const thankYous = await sendThankYous(mailEnv(env), now);
  return { ...hourly, reminders, thankYous, sheet: await askForSheetResync(env) };
}

// Daily full Google Sheet resync: the site holds the Google key, so the cron just asks it,
// with the token both read from the same D1 settings table (migration 0005).
async function askForSheetResync(env, site = 'https://porchandparty901.com') {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'sync_token'").first();
  if (!row || !/^[a-f0-9]{64}$/.test(row.value)) return { skipped: 'no sync_token in settings' };
  try {
    const res = await fetch(`${site}/api/sync/${row.value}`, { method: 'POST' });
    return { status: res.status, body: (await res.text()).slice(0, 300) };
  } catch (e) { return { error: String(e && e.message ? e.message : e) }; }
}

const worker = {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env, new Date(event.scheduledTime)).then((r) => console.log(`reminders: ${JSON.stringify(r)}`)));
  },
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    let msg;
    try { msg = await request.json(); } catch { return Response.json({ ok: false, error: 'bad json' }, { status: 400 }); }
    if (!msg || !msg.to || !msg.subject || !msg.html) {
      return Response.json({ ok: false, error: 'to, subject and html are required' }, { status: 400 });
    }
    const attachments = (msg.attachments || []).map((a) => ({
      content: b64ToBytes(a.contentBase64),
      filename: a.filename,
      type: a.type,
      disposition: a.disposition || 'attachment',
      ...(a.contentId ? { contentId: a.contentId } : {}),
    }));
    try {
      const res = await env.EMAIL.send({
        to: msg.to,
        ...(msg.cc ? { cc: msg.cc } : {}),
        ...(msg.bcc ? { bcc: msg.bcc } : {}),
        from: FROM,
        replyTo: msg.replyTo || FROM.email,
        subject: msg.subject,
        html: msg.html,
        text: msg.text || '',
        ...(attachments.length ? { attachments } : {}),
      });
      return Response.json({ ok: true, messageId: res && res.messageId ? res.messageId : null });
    } catch (err) {
      return Response.json({ ok: false, error: String(err && err.message ? err.message : err) }, { status: 502 });
    }
  },
};

export default worker;
