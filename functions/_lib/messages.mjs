// The central templates map for messages to customers (owner, 18 Oct 2026). Texts stay free
// (an sms: link from Valerie's phone, 901-355-1518); email goes from hello@ through the
// pnp-mailer Worker. Every customer message is built here and sent through ONE seam,
// sendMessage(channel, template, ctx), so a paid SMS provider could be switched on later
// without changing a single button. No template ever asks for a review or offers a discount.
import { esc, FROM_EMAIL } from './util.mjs';
import { smsLink, hasEmail, BUSINESS_PHONE } from './reminders.mjs';

const first = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';
const C = { cream: '#faf7f2', ink: '#3b302a', accent: '#b85f40', line: '#e8dfd4', muted: '#5f5148' };
const SANS = "Inter, 'Helvetica Neue', Arial, sans-serif";
const SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";

// A plain, Gmail-safe HTML email around paragraphs of text (and optional extra HTML).
export function wrapEmail({ title, paragraphs, extraHtml = '' }) {
  const body = paragraphs.map((p) => `<p style="margin:12px 0;">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.cream};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid ${C.line};border-radius:12px;">
<tr><td style="padding:24px 24px 4px;font-family:${SERIF};font-size:28px;font-weight:600;color:${C.ink};">Porch &amp; Party</td></tr>
<tr><td style="padding:4px 24px 20px;font-family:${SANS};font-size:16px;line-height:1.55;color:${C.ink};">${body}${extraHtml}</td></tr>
<tr><td style="padding:14px 24px 22px;border-top:1px solid ${C.line};font-family:${SANS};font-size:12px;color:${C.muted};">Porch &amp; Party, Memphis. Questions? Reply to this email or call or text ${BUSINESS_PHONE}.</td></tr>
</table></td></tr></table></body></html>`;
}

// ctx for requestReceived: { name, services:[...], rentals: { items, pickup, returnDate, holdEnds, total, damage, dueNow, atPickup } | null, pay: { zelle, cashapp } }
export const TEMPLATES = {
  requestReceived: (ctx) => {
    const lines = [`Hi ${first(ctx.name)}, thank you for your request. It came through, and Valerie will look at it shortly.`];
    if (ctx.rentals) {
      const r = ctx.rentals;
      lines.push(`Your games are held for you until ${r.holdEnds}: ${r.items}. Pickup ${r.pickup}, return ${r.returnDate}, at Mt. Moriah Station.`);
      lines.push(`Your total is ${r.total}: the rental plus a ${r.damage} refundable damage deposit. Due now to confirm: ${r.dueNow} (the damage deposit plus half of the rental). The rest, ${r.atPickup}, is paid at pickup. The damage deposit comes back when everything is returned complete.`);
      lines.push(`Valerie will send your invoice with the payment details${ctx.pay && (ctx.pay.zelle || ctx.pay.cashapp) ? ` (${[ctx.pay.zelle ? `Zelle: ${ctx.pay.zelle}` : '', ctx.pay.cashapp ? `Cash App: $${String(ctx.pay.cashapp).replace(/^\$/, '')}` : ''].filter(Boolean).join(', ')})` : ''}. Pay the deposit by the hold time and your games are booked. Then text or call ${BUSINESS_PHONE} to set your pickup time.`);
    }
    if (ctx.services.some((s) => s !== 'rentals')) {
      lines.push('We will text you a quote, usually within a day. Your date is held once the 50% deposit is paid by Zelle or Cash App, and the rest is due when we arrive to set up.');
    }
    lines.push(`You agreed to our Rules & Responsibilities when you sent this request: porchandparty901.com/rules`);
    lines.push(`Questions? Text ${BUSINESS_PHONE}. Thank you! — Valerie, Porch & Party`);
    return { subject: ctx.rentals ? 'Your games are held — Porch & Party' : 'We got your request — Porch & Party', lines };
  },
};

export function render(template, ctx) {
  const t = TEMPLATES[template];
  if (!t) throw new Error(`messages: no template ${template}`);
  const { subject, lines } = t(ctx);
  return { subject, text: lines.join('\n\n'), html: wrapEmail({ title: subject, paragraphs: lines }) };
}

// THE seam. channel 'sms' -> { ok, href } (an sms: link to tap; free, from her phone);
// channel 'email' -> sends now through the mailer -> { ok, error? }.
export async function sendMessage(env, channel, template, ctx, { to = ctx.email, phone = ctx.phone } = {}) {
  const msg = render(template, ctx);
  if (channel === 'sms') {
    const href = smsLink(phone, msg.text);
    return href ? { ok: true, href, text: msg.text } : { ok: false, error: 'No mobile number on file.' };
  }
  if (channel !== 'email') return { ok: false, error: `unknown channel ${channel}` };
  if (!hasEmail(to)) return { ok: false, error: 'No working email on file.' };
  if (!env.MAILER) return { ok: false, error: 'Email is not connected on this copy of the site.' };
  try {
    const res = await env.MAILER.fetch('https://pnp-mailer.internal/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, bcc: FROM_EMAIL, replyTo: FROM_EMAIL, subject: msg.subject, html: msg.html, text: msg.text }),
    });
    const out = await res.json().catch(() => ({ ok: false }));
    return res.ok && out.ok ? { ok: true } : { ok: false, error: out.error || `mailer answered ${res.status}` };
  } catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
}
