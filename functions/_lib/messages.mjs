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

const SERVICE_JOB = { porch: 'porch install', party: 'party setup', grazing: 'grazing table setup', rentals: 'games' };
const viaEmail = (text) => text.replace(/Text me here/g, `Reply to this email or text me at ${BUSINESS_PHONE}`);

// One line each; the email twin swaps "Text me here" for "Reply to this email".
Object.assign(TEMPLATES, {
  // Deposit received (hold -> booking, or a quote job confirmed).
  confirmation: (ctx) => {
    const lead = `Hi ${first(ctx.name)}, this is Valerie with Porch & Party. Your deposit came in, so `;
    const body = ctx.service === 'rentals'
      ? `your games are booked: ${ctx.items || 'your games'}, pickup ${ctx.day} at Mt. Moriah Station.${ctx.rest ? ` The rest (${ctx.rest}) is due at pickup.` : ''} Text me here to set your pickup time. Thank you!`
      : `your ${SERVICE_JOB[ctx.service] || 'booking'}${ctx.day ? ` on ${ctx.day}` : ''} is confirmed.${ctx.rest ? ` The rest (${ctx.rest}) is due when we arrive to set up.` : ''} Text me here if anything changes. Thank you!`;
    return { subject: 'You are booked — Porch & Party', lines: [lead + body] };
  },
  // The hold is about to end (Valerie's one-tap text, and the automatic email).
  holdEnding: (ctx) => ({ subject: 'Your games are held until ' + ctx.holdEnds + ' — Porch & Party', lines: [`Hi ${first(ctx.name)}, this is Valerie with Porch & Party. Friendly reminder: your games (${ctx.items || 'your games'}) are held for you until ${ctx.holdEnds}.${ctx.dueNow ? ` Pay the deposit of ${ctx.dueNow}` : ' Pay the deposit'} by Zelle or Cash App from your invoice to keep them. Text me here with any questions!`] }),
  // Setting the pickup time once the games are booked.
  pickupTime: (ctx) => ({ subject: 'Your game pickup time — Porch & Party', lines: [`Hi ${first(ctx.name)}, this is Valerie with Porch & Party. What time works for your game pickup on ${ctx.day} at Mt. Moriah Station? Text me here and I will meet you there.`] }),
  // The day-before reminder (its wording lives in reminders.mjs REMINDER_TEMPLATES).
  reminder: (ctx) => ({ subject: `Reminder from Porch & Party: tomorrow, ${ctx.dayShort || ''}`.trim(), lines: [ctx.reminderText || `Hi ${first(ctx.name)}, this is Valerie with Porch & Party. Reminder: we have you booked for tomorrow. Text me here if anything changes.`] }),
  // After the job (owner: no review ask, no discount, ever).
  thankyou: (ctx) => {
    const name = first(ctx.name);
    const line = {
      rentals: `Hi ${name}, thank you for renting with Porch & Party! We hope the party was a blast.${ctx.depositBack ? ` Your ${ctx.depositBack} damage deposit is on its way back to you.` : ''} We'd love to help with your next one. — Valerie`,
      porch: `Hi ${name}, thank you for letting us decorate your porch! We'll reach out before the next season. — Valerie`,
      party: `Hi ${name}, thank you for celebrating with Porch & Party! We hope it was everything you pictured. We'd love to help with your next one. — Valerie`,
      grazing: `Hi ${name}, thank you for having our grazing table at your event! We hope your guests loved it. We'd love to help with your next one. — Valerie`,
    }[ctx.service] || `Hi ${name}, thank you for choosing Porch & Party! We'd love to help with your next one. — Valerie`;
    return { subject: 'Thank you from Porch & Party', lines: [line] };
  },
});

// The referral block in the thank-you email (owner, 18 Oct 2026; no reward, no discount).
export const REFERRAL_SERVICES = [
  { key: 'porch', label: 'Porch decorating', line: 'Seasonal and holiday porches, styled and installed.', img: '/assets/img/porch/east-memphis-luxury-porch-installation.jpg', type: 'image/jpeg' },
  { key: 'party', label: 'Party planning & decor', line: 'Hotel-room surprises, home celebrations, showers and event spaces.', img: '/assets/img/party/memphis-party-decor-hotel-room-birthday-setup.jpg', type: 'image/jpeg' },
  { key: 'grazing', label: 'Grazing tables', line: 'Styled grazing tables and boards for any size of party.', img: '/assets/img/party/lakeland-small-party-grazing-table-setup.jpg', type: 'image/jpeg' },
  { key: 'rentals', label: 'Party game rentals', line: 'Giant yard games, a movie screen and a card table.', img: '/assets/rentals/giant-uno.webp', type: 'image/webp' },
];
export function referralText(ctx) {
  return `I used Porch & Party for my ${ctx.occasion || 'party'} and loved it. They do porch decorating, party planning & decor, grazing tables and game rentals in Memphis: ${ctx.referralUrl}`;
}
function referralHtml(ctx) {
  const share = referralText(ctx);
  const btn = (href, label) => `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 4px 0;padding:10px 14px;border-radius:8px;background:${C.accent};color:#fff;text-decoration:none;font-family:${SANS};font-size:15px;">${esc(label)}</a>`;
  const cells = REFERRAL_SERVICES.map((sv) => `<tr><td width="76" style="padding:6px 10px 6px 0;vertical-align:top;"><img src="cid:svc-${sv.key}" width="64" height="64" alt="${esc(sv.label)}" style="display:block;width:64px;height:64px;border-radius:8px;object-fit:cover;border:0;"></td>
    <td style="padding:6px 0;font-family:${SANS};font-size:15px;color:${C.ink};vertical-align:top;"><strong>${esc(sv.label)}</strong><br><span style="color:${C.muted};">${esc(sv.line)}</span></td></tr>`).join('');
  return `<div style="margin-top:18px;padding-top:14px;border-top:1px solid ${C.line};">
  <div style="font-family:${SERIF};font-size:22px;font-weight:600;color:${C.ink};margin-bottom:6px;">Know someone planning something?</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${cells}</table>
  <p style="margin:8px 0 0;font-family:${SANS};font-size:15px;color:${C.ink};">Your link to share: <a href="https://${esc(ctx.referralUrl)}" style="color:${C.accent};">${esc(ctx.referralUrl)}</a></p>
  <div style="margin-top:10px;">${btn(`sms:?&body=${encodeURIComponent(share)}`, 'Text a friend')}${btn(`mailto:?subject=${encodeURIComponent('Porch & Party in Memphis')}&body=${encodeURIComponent(share)}`, 'Email a friend')}${btn(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(`https://${ctx.referralUrl}`)}`, 'Share on Facebook')}</div></div>`;
}

export function render(template, ctx) {
  const t = TEMPLATES[template];
  if (!t) throw new Error(`messages: no template ${template}`);
  const { subject, lines } = t(ctx);
  const text = lines.join('\n\n');
  if (template === 'thankyou' && ctx.referralUrl) {
    const plain = `${viaEmail(text)}\n\nKnow someone planning something? Porch & Party does porch decorating, party planning & decor, grazing tables and party game rentals in Memphis. Share this link with them: ${ctx.referralUrl}`;
    return { subject, text, emailText: plain, html: wrapEmail({ title: subject, paragraphs: lines, extraHtml: referralHtml(ctx) }), images: REFERRAL_SERVICES.map((sv) => ({ cid: `svc-${sv.key}`, path: sv.img, type: sv.type })) };
  }
  return { subject, text, emailText: viaEmail(text), html: wrapEmail({ title: subject, paragraphs: lines.map(viaEmail) }), images: [] };
}

// Inline CID images for an email (Gmail renders CID images; it strips data: URIs). Fetched
// from the site; an image that cannot be fetched is dropped from the email, never fatal.
export async function attachImages(msg, origin = 'https://porchandparty901.com', fetchImpl = fetch) {
  const attachments = [];
  let html = msg.html;
  for (const im of msg.images || []) {
    let ok = false;
    try {
      const res = await fetchImpl(`${origin}${im.path}`);
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length > 0 && buf.length <= 250000) {
          let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
          attachments.push({ contentBase64: btoa(bin), filename: im.path.split('/').pop(), type: im.type, disposition: 'inline', contentId: im.cid });
          ok = true;
        }
      }
    } catch { ok = false; }
    if (!ok) html = html.replace(new RegExp(`<img src="cid:${im.cid}"[^>]*>`), '');
  }
  return { ...msg, html, attachments };
}

// THE seam. channel 'sms' -> { ok, href } (an sms: link to tap; free, from her phone);
// channel 'email' -> sends now through the mailer -> { ok, error? }.
export async function sendMessage(env, channel, template, ctx, { to = ctx.email, phone = ctx.phone } = {}) {
  const msg = render(template, ctx);
  if (channel === 'sms') {
    // Free: Valerie's own phone sends it. A paid provider would plug in here, not in the buttons.
    const href = smsLink(phone, msg.text);
    return href ? { ok: true, href, text: msg.text } : { ok: false, error: 'No mobile number on file.' };
  }
  if (channel !== 'email') return { ok: false, error: `unknown channel ${channel}` };
  if (!hasEmail(to)) return { ok: false, error: 'No working email on file.' };
  if (!env.MAILER) return { ok: false, error: 'Email is not connected on this copy of the site.' };
  try {
    const full = msg.images && msg.images.length ? await attachImages(msg, env.SITE_ORIGIN || 'https://porchandparty901.com', env.FETCH || fetch) : { ...msg, attachments: [] };
    const res = await env.MAILER.fetch('https://pnp-mailer.internal/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, bcc: FROM_EMAIL, replyTo: FROM_EMAIL, subject: full.subject, html: full.html, text: full.emailText || full.text, attachments: full.attachments }),
    });
    const out = await res.json().catch(() => ({ ok: false }));
    return res.ok && out.ok ? { ok: true } : { ok: false, error: out.error || `mailer answered ${res.status}` };
  } catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
}
