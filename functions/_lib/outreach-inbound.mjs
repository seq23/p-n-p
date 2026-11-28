import PostalMime from 'postal-mime';
import { emailOf, domainOf, OUTREACH_FROM } from './outreach.mjs';

// Only the new reply is considered. Quoted campaign text or an unsubscribe footer is
// never evidence that the person opted out. Anything more than an unambiguous refusal
// goes to the owner, including a refusal with a question or a suggested alternative.
export function replyText(text) {
  return String(text || '').split(/\r?\n/).filter((line) => !/^\s*>/.test(line)).join('\n')
    .split(/\n(?:On .+wrote:|From:|--\s*$)/im)[0].trim();
}
export function classifyInbound(headers, parsed) {
  const type = headers.get('content-type') || '';
  if (/multipart\/report.*report-type\s*=\s*"?delivery-status|message\/delivery-status/i.test(type)) return 'bounce';
  const text = replyText(parsed.text || '');
  const refusal = /^(?:(?:hi|hello)[,!]?\s*)?(?:no thanks|no thank you|not interested|(?:please )?remove(?: me)?(?: from (?:your|the|this) (?:list|mailing list|emails?))?|(?:please )?unsubscribe(?: me)?|(?:please )?stop(?: emailing(?: me)?)?)[.!\s]*(?:(?:thank you|thanks)[.!\s]*)?$/i;
  if (refusal.test(text)) return 'opt_out';
  // The List-Unsubscribe mailto: subject "remove" with an empty body.
  const subj = String(parsed.subject || headers.get('subject') || '').trim();
  if (!text && /^(?:re:\s*)?(?:remove|unsubscribe|stop)$/i.test(subj)) return 'opt_out';
  // Human questions, interest and mixed refusals override automatic-response labels.
  if (/[?]/.test(text) || /\b(?:price|pricing|quote|interested|send me|call me|could you|can you|no thanks|remove|unsubscribe|stop)\b/i.test(text)) return 'reply';
  const auto = headers.get('auto-submitted');
  if ((auto && /^auto-(replied|generated)$/i.test(auto.trim())) || headers.has('x-autoreply') || headers.has('x-autorespond')) return 'ooo';
  const subject = parsed.subject || headers.get('subject') || '';
  if (/^(?:automatic reply:\s*)?out of office\b/i.test(subject)) return 'ooo';
  if (/^(?:i(?:'m| am) (?:currently )?out of (?:the )?office|out of office)\b/i.test(text)) return 'ooo';
  return 'reply';
}

// WHO REALLY SENT IT (owner, 28 Nov 2026: office replies must reach her, and a forged one must not
// look real). Read from Cloudflare's own verdict on arrival: the FIRST Authentication-Results header,
// which mx.cloudflare.net prepends above everything the sender wrote, so a forged "dmarc=pass" further
// down is never read. 'pass' = DMARC passed, or no DMARC policy and an aligned DKIM pass; 'fail' =
// Cloudflare judged it and it did not pass; 'unknown' = no Cloudflare verdict in the copy. Pure.
export function senderAuth(rawText, fromAddress) {
  const head = String(rawText || '').split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, ' ');
  const first = /^Authentication-Results:[ \t]*([^\r\n]*)$/im.exec(head);
  if (!first || !/^mx\.cloudflare\.net\s*;/i.test(first[1].trim())) return 'unknown';
  const verdict = first[1];
  if (/\bdmarc=pass\b/i.test(verdict)) return 'pass';
  const domain = emailOf(fromAddress) ? domainOf(emailOf(fromAddress)) : '';
  const aligned = (d) => d === domain || domain.endsWith(`.${d}`) || d.endsWith(`.${domain}`);
  const signed = [...verdict.matchAll(/\bdkim=pass\b[^;]*?\bheader\.d=([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
  if (domain && /\bdmarc=none\b/i.test(verdict) && signed.some(aligned)) return 'pass';
  return 'fail';
}

const MAX_REPLY_CHARS = 2000;
const htmlText = (html) => String(html || '').replace(/<(?:style|script|head)[\s\S]*?<\/(?:style|script|head)>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');

// EVERY STORED REPLY, WITH ITS WORDS (owner, 28 Nov 2026: "P&P office replies never arrived").
// Boss OS reads this (GET /api/outreach/replies) and puts each one in her Decide list and morning
// email; the forward stays a spare copy. Read-only: rows and stored copies are never changed. A copy
// that is missing or cannot be read is still returned, with text null and `unread` saying why, so
// no reply is ever dropped on the way. `forward_handed_at` is when Cloudflare accepted the forward,
// never proof that it arrived anywhere.
export async function outreachReplies(env, since = '2026-01-01') {
  const rows = (await env.DB.prepare("SELECT id, email, kind, at, forwarded_at, raw_key FROM outreach_inbound WHERE kind = 'reply' AND at >= ? ORDER BY at, id LIMIT 200").bind(since).all()).results || [];
  const replies = [];
  for (const row of rows) {
    const base = { id: row.id, email: row.email, kind: row.kind, at: row.at, forward_handed_at: row.forwarded_at || null };
    try {
      // Only a stored reply is ever read through this binding, never another object in the bucket.
      const obj = /^outreach\/raw\/[0-9a-f-]{36}\.eml$/.test(String(row.raw_key || '')) ? await env.OUTREACH_RAW.get(row.raw_key) : null;
      if (!obj) { replies.push({ ...base, text: null, subject: null, from_name: null, message_id: null, auth: 'unknown', unread: 'The stored copy is missing.' }); continue; }
      const raw = await obj.arrayBuffer();
      const parsed = await PostalMime.parse(raw);
      const text = replyText(parsed.text || htmlText(parsed.html));
      replies.push({ ...base, subject: String(parsed.subject || '').slice(0, 300), from_name: String(parsed.from?.name || '').slice(0, 120) || null,
        message_id: parsed.messageId || null, text: text.length > MAX_REPLY_CHARS ? `${text.slice(0, MAX_REPLY_CHARS).trimEnd()}…` : text,
        auth: senderAuth(new TextDecoder().decode(raw), parsed.from?.address || row.email) });
    } catch {
      replies.push({ ...base, text: null, subject: null, from_name: null, message_id: null, auth: 'unknown', unread: 'The stored copy could not be read.' });
    }
  }
  return { replies, rows: rows.length };
}

export async function receiveOutreach(message, env, now = new Date()) {
  // The owner's forward address is a Worker secret (PNP_OUTREACH_OWNER), never in this public repo.
  // Without it nothing could be forwarded, so the message is rejected back to the sender (never filed).
  if (!emailOf(env.PNP_OUTREACH_OWNER)) { message.setReject?.('Mailbox temporarily unavailable'); throw new Error('PNP_OUTREACH_OWNER is not configured.'); }
  if (String(message.to || '').toLowerCase() !== OUTREACH_FROM) { await message.forward(env.PNP_OUTREACH_OWNER); return { kind: 'not_outreach', forwarded: true }; }
  const raw = await new Response(message.raw).arrayBuffer();
  const id = crypto.randomUUID(); const at = now.toISOString(); const rawKey = `outreach/raw/${id}.eml`;
  let forwarded = false;
  const forward = async () => { await message.forward(env.PNP_OUTREACH_OWNER); forwarded = true; };
  try {
    await env.OUTREACH_RAW.put(rawKey, raw, { httpMetadata: { contentType: 'message/rfc822' } });
    let parsed;
    try { parsed = await PostalMime.parse(raw); } catch { parsed = {}; }
    let kind = classifyInbound(message.headers, parsed);
    const sender = emailOf(parsed.from?.address) || emailOf(message.from);
    let email = sender;
    if (kind === 'bounce') {
      // Suppress the failed recipient, never the mail server sending the DSN. Only a
      // recipient actually contacted by this campaign can be suppressed by a DSN.
      const dsn = new TextDecoder().decode(raw);
      const failed = [...dsn.matchAll(/(?:Final|Original)-Recipient:\s*rfc822;\s*([^\s;<>]+)/gi)].map((m) => emailOf(m[1])).filter(Boolean);
      const known = [];
      for (const address of new Set(failed)) {
        if (await env.DB.prepare('SELECT id FROM outreach_messages WHERE email = ? LIMIT 1').bind(address).first()) known.push(address);
      }
      if (!known.length) kind = 'reply'; // uncorrelated DSN: the owner should check
      else {
        email = known[0];
        for (const address of known) await block(env.DB, address, 'suppressed', at);
      }
    }
    await env.DB.prepare('INSERT INTO outreach_inbound (id, email, kind, at, raw_key) VALUES (?,?,?,?,?)').bind(id, email, kind, at, rawKey).run();
    if (kind === 'opt_out' && sender) await block(env.DB, sender, 'suppressed', at);
    if (kind === 'reply') {
      // Claim takeover first, including when forwarding subsequently fails. Retry of a
      // failed forward stays safe: the company remains unavailable to the sender.
      if (sender) await block(env.DB, sender, 'taken_over', at);
      const envelope = emailOf(message.from);
      if (envelope && envelope !== sender) await block(env.DB, envelope, 'taken_over', at);
      await forward();
      await env.DB.prepare('UPDATE outreach_inbound SET forwarded_at = ? WHERE id = ?').bind(at, id).run();
    }
    return { kind, forwarded };
  } catch (error) {
    // A storage/parser/database outage must never silently file a real reply.
    if (!forwarded) await forward();
    throw error;
  }
}

async function block(db, address, kind, at) {
  await db.prepare(`INSERT INTO outreach_blocks (address, domain, kind, at) VALUES (?,?,?,?)
    ON CONFLICT(address, kind) DO UPDATE SET at = excluded.at`)
    .bind(address, domainOf(address), kind, at).run();
}
