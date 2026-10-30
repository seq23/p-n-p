// Private outreach API (docs/corporate-outreach.md). All gates run here, server-side, before
// the Resend API is called. Sends never go through pnp-mailer (docs/email-setup.md).
import { tokenMatches } from './owner-feed.mjs';
import { esc } from './util.mjs';

export const OUTREACH_FROM = 'sequoia@porchandparty901.com';
export const RESEND_URL = 'https://api.resend.com/emails';
export const LIST_UNSUBSCRIBE = `<mailto:${OUTREACH_FROM}?subject=remove>`;
// Owner, 30 Oct 2026: "add an opt out and a mailing address very small at bottom".
// The mailing address is D1 data (settings.outreach_mailing_address), never code.
export const footerText = (address) => `Porch & Party 901 · ${address} · Don't want these emails? Reply "remove" and we'll stop.`;
export function composeOutreach(text, address) {
  const body = text.replace(/\r\n/g, '\n').trim();
  const foot = footerText(address);
  const paras = body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  return {
    text: `${body}\n\n${foot}`,
    html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222">\n${paras}\n<p style="font-size:11px;color:#888;margin-top:24px">${esc(foot)}</p>\n</body></html>`,
  };
}

export const chicagoDay = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const emailOf = (v) => typeof v === 'string' && /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(v.trim()) ? v.trim().toLowerCase() : '';
export const domainOf = (email) => email.slice(email.lastIndexOf('@') + 1);
const norm = (v) => String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const rows = async (stmt) => (await stmt.all()).results || [];

// Same money truth as depositReceived(): actual, non-voided payments cover the deposit,
// or the whole invoice when the deposit is zero. Count distinct requests, not invoices.
export const CORPORATE_SQL = `SELECT COUNT(*) AS n FROM requests r WHERE r.corporate = 1 AND r.is_test = 0
 AND (EXISTS (SELECT 1 FROM bookings b WHERE b.request_key = r.request_key
   AND b.kind IN ('porch_install','party_setup','grazing_setup','rental_pickup','other') AND b.date >= '2026-11-01' AND b.date < '2027-01-01')
 OR EXISTS (SELECT 1 FROM json_each(r.answers) a WHERE lower(json_extract(a.value,'$.label')) IN ('event date','what date is your event?')
   AND json_extract(a.value,'$.value') >= '2026-11-01' AND json_extract(a.value,'$.value') < '2027-01-01'))
 AND EXISTS (SELECT 1 FROM invoices i WHERE i.request_key = r.request_key AND i.status <> 'void'
   AND (SELECT COALESCE(SUM(p.amount_cents),0) FROM payments p WHERE p.invoice_id = i.id AND p.voided_at IS NULL) > 0
   AND (SELECT COALESCE(SUM(p.amount_cents),0) FROM payments p WHERE p.invoice_id = i.id AND p.voided_at IS NULL)
      >= CASE WHEN i.deposit_due_cents > 0 THEN i.deposit_due_cents ELSE
        (SELECT COALESCE(SUM(ROUND(l.qty * l.unit_cents)),0) FROM invoice_lines l WHERE l.invoice_id = i.id) END)`;
export const stopReason = (day, count) => day > '2026-12-05' ? 'The holiday outreach window has ended.' : count >= 4 ? 'Four corporate jobs have paid their deposits.' : null;

export async function outreachStatus(db, since = '2026-01-01', now = new Date()) {
  const day = chicagoDay(now);
  const count = (await db.prepare(CORPORATE_SQL).first()).n;
  const counts = await rows(db.prepare("SELECT kind, COUNT(*) AS n FROM outreach_messages WHERE day = ? AND state = 'sent' GROUP BY kind").bind(day));
  const blocks = await rows(db.prepare('SELECT address, kind FROM outreach_blocks ORDER BY address'));
  return { sent_today: counts.find((x) => x.kind === 'first')?.n || 0, followups_today: counts.find((x) => x.kind === 'followup')?.n || 0,
    suppressed: blocks.filter((x) => x.kind === 'suppressed').map((x) => x.address), taken_over: blocks.filter((x) => x.kind === 'taken_over').map((x) => x.address),
    replies: await rows(db.prepare('SELECT email, kind, at FROM outreach_inbound WHERE at >= ? ORDER BY at, id').bind(since)), corporate_booked: count, stopped: stopReason(day, count) };
}

export async function sendOutreach(env, input, now = new Date()) {
  const no = (reason) => ({ ok: false, reason });
  const to = emailOf(input?.to);
  if (!to || typeof input.prospect_id !== 'string' || !input.prospect_id.trim() || input.prospect_id.length > 200
    || typeof input.subject !== 'string' || !input.subject.trim() || input.subject.length > 300 || /[\r\n]/.test(input.subject)
    || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 20000 || /<\/?[a-z][^>]*>/i.test(input.text)
    || (input.in_reply_to !== undefined && (typeof input.in_reply_to !== 'string' || !input.in_reply_to || input.in_reply_to.length > 998 || /[\r\n]/.test(input.in_reply_to)))) return no('Please supply a valid recipient, prospect, subject and plain-text message.');
  if (['html','from','replyTo','reply_to','cc','bcc','attachments','headers'].some((k) => Object.hasOwn(input, k))) return no('Only a plain-text outreach message is allowed.');
  const db = env.DB; const day = chicagoDay(now); const domain = domainOf(to);
  const stopped = stopReason(day, (await db.prepare(CORPORATE_SQL).first()).n);
  if (stopped) return no(stopped);
  const blocked = await rows(db.prepare('SELECT address, domain, kind FROM outreach_blocks'));
  if (blocked.some((x) => x.address === to || domain === x.address || domain.endsWith(`.${x.address}`) || (x.kind === 'taken_over' && (domain === x.domain || domain.endsWith(`.${x.domain}`))))) return no('This address or company is suppressed or the owner has taken over.');
  const setting = await db.prepare("SELECT value FROM settings WHERE key = 'outreach_do_not_contact'").first();
  let dnc;
  try { dnc = JSON.parse(setting?.value); } catch { return no('The do-not-contact list is not configured.'); }
  if (!Array.isArray(dnc) || !dnc.every((x) => typeof x === 'string' && x.trim())) return no('The do-not-contact list is not configured.');
  const words = ` ${norm(`${input.prospect_id} ${input.subject} ${input.text} ${domain}`)} `;
  if (dnc.some((s) => { const v = s.trim().toLowerCase(); return domain === v || domain.endsWith(`.${v}`) || words.includes(` ${norm(s)} `); })) return no('This company is on the do-not-contact list.');
  const kind = input.in_reply_to ? 'followup' : 'first';
  if (kind === 'followup') {
    const first = await db.prepare("SELECT * FROM outreach_messages WHERE prospect_id = ? AND email = ? AND kind = 'first' AND state = 'sent' AND message_id = ?").bind(input.prospect_id, to, input.in_reply_to).first();
    if (!first || now.getTime() - Date.parse(first.at) < 5 * 86400000 || input.subject !== `Re: ${first.subject}`) return no('A follow-up needs the original thread and at least five days since the first message.');
  }
  const setAddr = await db.prepare("SELECT value FROM settings WHERE key = 'outreach_mailing_address'").first();
  const address = String(setAddr?.value || '').replace(/\s+/g, ' ').trim();
  if (address.length < 10) return no('The mailing address for the footer is not configured.');
  if (!env.RESEND_OUTREACH_KEY) return no('The outreach sending key is not configured.');
  const id = crypto.randomUUID();
  const messageId = `<outreach-${id}@porchandparty901.com>`;
  // INSERT…SELECT is one serialized SQLite statement: concurrent callers cannot overbook
  // the quota or repeat a prospect. Reserved/uncertain deliveries keep their slot on failure.
  const reserved = await db.prepare(`INSERT INTO outreach_messages (id, prospect_id, email, domain, subject, text, in_reply_to, kind, day, at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM outreach_messages WHERE day = ? AND kind = ?) < 15
    AND (${CORPORATE_SQL}) < 4
    AND NOT EXISTS (SELECT 1 FROM outreach_messages WHERE kind = ? AND (prospect_id = ? OR email = ?))
    AND NOT EXISTS (SELECT 1 FROM outreach_blocks WHERE address = ? OR address = ? OR (kind = 'taken_over' AND domain = ?))`)
    .bind(id, input.prospect_id, to, domain, input.subject, input.text, input.in_reply_to || null, kind, day, now.toISOString(), day, kind, kind, input.prospect_id, to, to, domain, domain).run();
  if (!reserved.meta.changes) return no('The daily limit was reached, this prospect was already contacted, or outreach is stopped.');
  const { text, html } = composeOutreach(input.text, address);
  const headers = { 'Message-ID': messageId, 'List-Unsubscribe': LIST_UNSUBSCRIBE,
    ...(input.in_reply_to ? { 'In-Reply-To': input.in_reply_to, References: input.in_reply_to } : {}) };
  try {
    const response = await fetch(RESEND_URL, { method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_OUTREACH_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': id },
      body: JSON.stringify({ from: `Porch & Party 901 <${OUTREACH_FROM}>`, to: [to], reply_to: OUTREACH_FROM, subject: input.subject, text, html, headers }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) throw new Error('delivery unconfirmed');
    await db.prepare("UPDATE outreach_messages SET state = 'sent', message_id = ? WHERE id = ?").bind(messageId, id).run();
    return { ok: true, message_id: messageId };
  } catch {
    await db.prepare("UPDATE outreach_messages SET state = 'uncertain' WHERE id = ?").bind(id).run();
    return no('Delivery could not be confirmed. The slot is held to prevent a duplicate; ask the owner to check.');
  }
}

export async function handleOutreach({ request, env }, action, now = new Date()) {
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
  const reply = (body, status = 200) => Response.json(body, { status, headers });
  const token = /^Bearer\s+(\S+)\s*$/.exec(request.headers.get('Authorization') || '');
  if (!token || !(await tokenMatches(token[1], env.PNP_OUTREACH_TOKEN))) return reply({ ok: false, reason: 'Unauthorized.' }, 401);
  if (request.method !== (action === 'send' ? 'POST' : 'GET')) return reply({ ok: false, reason: 'Method not allowed.' }, 405);
  try {
    if (action === 'send') {
      let input; try { input = await request.json(); } catch { return reply({ ok: false, reason: 'Please send a JSON message.' }, 400); }
      return reply(await sendOutreach(env, input, now));
    }
    const since = new URL(request.url).searchParams.get('since') || '2026-01-01';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || new Date(`${since}T00:00:00Z`).toISOString().slice(0,10) !== since) return reply({ ok: false, reason: 'since must be a real YYYY-MM-DD date.' }, 400);
    return reply(await outreachStatus(env.DB, since, now));
  } catch { return reply({ ok: false, reason: 'Outreach is unavailable. No retry should be sent until the owner checks.' }, 503); }
}
