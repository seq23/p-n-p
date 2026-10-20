// The invoice email: a clean, table-based HTML message in the site's brand
// (cream #faf7f2, ink #3b302a, accent #c46e4e; Cormorant Garamond / Inter with
// safe fallbacks) plus a plain-text twin. The QR code rides as an inline CID
// attachment: Gmail strips data: URIs from <img>, CID images render.
import { esc, money, lineTotal, invoiceTotal, prettyDate, payPlanOf, FROM_EMAIL } from './util.mjs';

const C = { cream: '#faf7f2', ink: '#3b302a', accent: '#c46e4e', line: '#e8dfd4', muted: '#7a6b60' };
const SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
const SANS = "Inter, 'Helvetica Neue', Arial, sans-serif";

export function paymentStatus(settings) {
  const missing = [];
  if (!settings.zelle) missing.push('Zelle');
  if (!settings.cashapp) missing.push('Cash App name');
  if (!settings.qr_png) missing.push('QR code');
  return { complete: missing.length === 0, missing };
}

function cashtag(value) {
  const t = String(value || '').trim().replace(/^\$/, '');
  return t ? `$${t}` : '';
}

// pickup: the rentals pickup line (invoice-note.mjs pickupNote, worded per invoice), '' on a decor-only invoice.
export function renderInvoiceEmail({ invoice, lines, settings, contact, qrSrc, pickup = '' }) {
  const total = invoiceTotal(lines);
  const refundable = lines.filter((l) => l.refundable).reduce((s, l) => s + lineTotal(l), 0);
  const plan = payPlanOf(invoice, total);
  const now = plan === 'full' ? total : invoice.deposit_due_cents;
  const rest = total - now;
  const payBox = plan === 'full'
    ? { big: `Amount due: ${money(total)}`, small: `Please pay by ${prettyDate(invoice.due_date)}.` }
    : { big: `Deposit due now: ${money(now)}`, small: `This holds your date. The rest, ${money(rest)}, is due by ${prettyDate(invoice.due_date)}.` };
  const pay = paymentStatus(settings);
  const business = settings.business_name || 'Porch & Party';
  const footerLine = settings.business_address || 'Memphis, Tennessee';
  const phone = contact && contact.telephoneDisplay ? contact.telephoneDisplay : '';
  const tag = cashtag(settings.cashapp);

  const rows = lines.map((l) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:15px;color:${C.ink};">
          ${esc(l.description)}${Number(l.qty) !== 1 ? ` <span style="color:${C.muted};">&times; ${esc(l.qty)}</span>` : ''}
          ${l.refundable ? `<div style="font-size:12px;color:${C.accent};margin-top:2px;">Refundable</div>` : ''}
          ${l.note && l.note !== 'free' ? `<div style="font-size:12px;color:${C.muted};margin-top:2px;">${esc(l.note)}</div>` : ''}
        </td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:15px;color:${C.ink};white-space:nowrap;">${lineTotal(l) === 0 ? 'Free' : money(lineTotal(l))}</td>
      </tr>`).join('');

  const payItems = [];
  if (settings.zelle) payItems.push(`<div style="margin:0 0 6px;"><strong>Zelle:</strong> ${esc(settings.zelle)}</div>`);
  if (tag) payItems.push(`<div style="margin:0 0 6px;"><strong>Cash App:</strong> <a href="https://cash.app/${esc(tag)}" style="color:${C.accent};">${esc(tag)}</a></div>`);
  const qr = settings.qr_png && qrSrc ? `<div style="margin-top:12px;"><img src="${esc(qrSrc)}" width="160" height="160" alt="Payment QR code" style="display:block;width:160px;height:160px;border:0;"></div>` : '';
  const coming = pay.complete ? '' : `<div style="margin:6px 0 0;color:${C.muted};">Payment details coming. We will follow up with how to pay.</div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<title>Invoice ${esc(invoice.number)}</title></head>
<body style="margin:0;padding:0;background:${C.cream};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${C.line};border-radius:12px;">
  <tr><td style="padding:28px 24px 8px;">
    <div style="font-family:${SERIF};font-size:30px;font-weight:600;color:${C.ink};">${esc(business)}</div>
    <div style="font-family:${SANS};font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${C.accent};margin-top:4px;">Invoice ${esc(invoice.number)}</div>
  </td></tr>
  <tr><td style="padding:8px 24px 0;font-family:${SANS};font-size:15px;line-height:1.5;color:${C.ink};">
    <p style="margin:12px 0;">Hi ${esc((invoice.customer_name || '').split(' ')[0] || 'there')},</p>
    <p style="margin:12px 0;">Thank you for booking with ${esc(business)}. Here is your invoice.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="font-family:${SANS};font-size:14px;color:${C.muted};margin:8px 0 4px;">
      <tr><td style="padding:2px 16px 2px 0;">Issued</td><td style="color:${C.ink};">${esc(prettyDate(invoice.issue_date))}</td></tr>
      <tr><td style="padding:2px 16px 2px 0;">Due</td><td style="color:${C.ink};">${esc(prettyDate(invoice.due_date))}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:8px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
      <tr><td style="padding:14px 0 4px;font-family:${SERIF};font-size:22px;font-weight:600;color:${C.ink};">Total</td>
          <td align="right" style="padding:14px 0 4px;font-family:${SERIF};font-size:22px;font-weight:600;color:${C.ink};">${money(total)}</td></tr>
      ${refundable ? `<tr><td colspan="2" style="font-family:${SANS};font-size:13px;color:${C.muted};padding-bottom:4px;">Includes ${money(refundable)} refundable deposit.</td></tr>` : ''}
    </table>
  </td></tr>
  <tr><td style="padding:8px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream};border-radius:10px;">
      <tr><td style="padding:16px;font-family:${SANS};font-size:15px;color:${C.ink};">
        <div style="font-family:${SERIF};font-size:20px;font-weight:600;margin-bottom:4px;">${esc(payBox.big)}</div>
        <div style="color:${C.muted};font-size:14px;">${esc(payBox.small)}</div>
        ${pickup ? `<div style="color:${C.ink};font-size:14px;margin-top:8px;" data-pickup-line>${esc(pickup)}</div>` : ''}
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:8px 24px 16px;font-family:${SANS};font-size:15px;line-height:1.5;color:${C.ink};">
    <div style="font-family:${SERIF};font-size:20px;font-weight:600;margin:8px 0;">How to pay</div>
    ${payItems.join('')}${qr}${coming}
    <div style="margin-top:10px;font-size:13px;color:${C.muted};">Please put ${esc(invoice.number)} in the payment note.</div>
    ${invoice.notes ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid ${C.line};">${esc(invoice.notes).replace(/\n/g, '<br>')}</div>` : ''}
  </td></tr>
  <tr><td style="padding:16px 24px 24px;border-top:1px solid ${C.line};font-family:${SANS};font-size:12px;color:${C.muted};line-height:1.6;">
    ${esc(business)} &middot; ${esc(footerLine)}<br>
    Questions? Reply to this email or write ${esc(FROM_EMAIL)}${phone ? ` &middot; call or text ${esc(phone)}` : ''}.
  </td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `${business} - Invoice ${invoice.number}`,
    `Issued ${prettyDate(invoice.issue_date)} - Due ${prettyDate(invoice.due_date)}`,
    '',
    ...lines.map((l) => `${l.description}${Number(l.qty) !== 1 ? ` x ${l.qty}` : ''}${l.refundable ? ' (refundable)' : ''}: ${lineTotal(l) === 0 ? 'Free' : money(lineTotal(l))}`),
    '',
    `Total: ${money(total)}`,
    payBox.big,
    payBox.small,
    ...(pickup ? [pickup] : []),
    '',
    'How to pay:',
    ...(settings.zelle ? [`Zelle: ${settings.zelle}`] : []),
    ...(tag ? [`Cash App: ${tag}`] : []),
    ...(pay.complete ? [] : ['Payment details coming. We will follow up with how to pay.']),
    `Please put ${invoice.number} in the payment note.`,
    ...(invoice.notes ? ['', invoice.notes] : []),
    '',
    `${business} - ${footerLine}`,
    `Questions? Reply to this email or write ${FROM_EMAIL}.`,
  ].join('\n');

  return { html, text, subject: `Invoice ${invoice.number} from ${business}` };
}
