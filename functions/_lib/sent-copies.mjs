// A copy of every invoice email that went out (owner, 25 Oct 2026), so she can always check what a
// customer got: the exact HTML and text the mailer was handed, the PDF as it read at that moment,
// and who it was from / to / Bcc and when. Files: private R2 bucket pnp-receipts (binding
// RECEIPTS) under sent-invoices/<invoice id>/<stamp>/; the list: D1 invoice_sent_copies
// (migration 0024). Test copies to hello@ are not kept. Keeping the copy never blocks the send:
// a failure is logged and the invoice page simply has no copy for that send.
export const SENT_PREFIX = 'sent-invoices';
export const FROM_ADDRESS = 'Porch & Party <hello@porchandparty901.com>'; // workers/pnp-mailer FROM

const enc = new TextEncoder();

export async function keepSentCopy(env, { invoiceId, payload, pdfBytes, now = new Date() }) {
  if (!env.RECEIPTS || !env.DB) return { ok: false, error: 'no bucket' };
  const sentAt = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const prefix = `${SENT_PREFIX}/${invoiceId}/${sentAt.replace(/[-:]/g, '')}`;
  try {
    const meta = { from: FROM_ADDRESS, to: payload.to, copyTo: payload.bcc || '', replyTo: payload.replyTo || '', subject: payload.subject, sent_at: sentAt };
    await env.RECEIPTS.put(`${prefix}/email.html`, enc.encode(payload.html || ''), { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
    await env.RECEIPTS.put(`${prefix}/email.txt`, enc.encode(payload.text || ''), { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
    if (pdfBytes) await env.RECEIPTS.put(`${prefix}/invoice.pdf`, pdfBytes, { httpMetadata: { contentType: 'application/pdf' } });
    await env.RECEIPTS.put(`${prefix}/meta.json`, enc.encode(JSON.stringify(meta)), { httpMetadata: { contentType: 'application/json' } });
    await env.DB.prepare('INSERT INTO invoice_sent_copies (invoice_id, sent_at, from_email, to_email, bcc, subject, r2_prefix) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(invoiceId, sentAt, FROM_ADDRESS, payload.to, payload.bcc || '', payload.subject, prefix).run();
    return { ok: true, prefix };
  } catch (e) {
    console.error('keepSentCopy failed', invoiceId, e && e.message ? e.message : e);
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

// "Sat 25 Oct, 1:43 PM" in Memphis time.
export function sentWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  const day = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Chicago' }).replace(/^(\w+), (\w+) (\d+)$/, '$1 $3 $2');
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
  return `${day}, ${time}`;
}

export async function sentCopies(db, invoiceId) {
  try {
    const { results } = await db.prepare('SELECT * FROM invoice_sent_copies WHERE invoice_id = ?1 ORDER BY id DESC').bind(invoiceId).all();
    return (results || []).map((r) => ({ ...r, when: sentWhen(r.sent_at) }));
  } catch { return []; }
}

export async function sentCopy(env, invoiceId, copyId) {
  const row = await env.DB.prepare('SELECT * FROM invoice_sent_copies WHERE id = ?1 AND invoice_id = ?2').bind(copyId, invoiceId).first();
  return row ? { ...row, when: sentWhen(row.sent_at) } : null;
}

export async function sentFile(env, row, name) {
  if (!['email.html', 'email.txt', 'invoice.pdf'].includes(name)) return null;
  const o = await env.RECEIPTS.get(`${row.r2_prefix}/${name}`);
  return o ? new Uint8Array(await o.arrayBuffer()) : null;
}
