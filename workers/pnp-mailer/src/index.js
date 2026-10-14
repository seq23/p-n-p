// pnp-mailer: sends one email through Cloudflare Email Service on behalf of the
// p-n-p Pages Functions (service binding MAILER). Reachable only through that binding.
const FROM = { email: 'hello@porchandparty901.com', name: 'Porch & Party' };

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export default {
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
