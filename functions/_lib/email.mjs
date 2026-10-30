// The invoice email: a clean, table-based HTML message in the site's brand
// (cream #faf7f2, ink #3b302a, accent #c46e4e; Cormorant Garamond / Inter with
// safe fallbacks) plus a plain-text twin. The QR code rides as an inline CID
// attachment: Gmail strips data: URIs from <img>, CID images render.
import { esc, money, invoiceTotal, prettyDate, FROM_EMAIL } from './util.mjs';
import { payStepsOf, customerSteps } from './pay-steps.mjs';
import { invoiceView, linesText, noteRowsText } from './invoice-view.mjs';

const C = { cream: '#faf7f2', ink: '#3b302a', accent: '#c46e4e', line: '#e8dfd4', muted: '#7a6b60' };
const SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
const SANS = "Inter, 'Helvetica Neue', Arial, sans-serif";

// Note rows as email HTML: a priced row is a two-cell row (item left, price right, both wrap
// safely); a plain row is its own line; a blank row is a small gap.
function noteHtml(rows) {
  return rows.map((r) => (r.item
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:1px 12px 1px 0;font-family:${SANS};font-size:inherit;color:inherit;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;">${esc(r.item)}</td><td align="right" style="padding:1px 0;font-family:${SANS};font-size:inherit;color:inherit;white-space:nowrap;vertical-align:top;">${esc(r.price)}</td></tr></table>`
    : (r.text ? `<div style="word-break:break-word;overflow-wrap:anywhere;">${esc(r.text)}</div>` : '<div style="height:8px;line-height:8px;">&nbsp;</div>'))).join('');
}

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
// paid / payments: what has come in when it goes out (ledger.mjs), so a paid step reads "✓ paid".
export function renderInvoiceEmail({ invoice, lines, settings, contact, qrSrc, pickup = '', paid = 0, payments = [] }) {
  const total = invoiceTotal(lines);
  // "How you pay" (owner-approved mock-up, 20 Oct 2026; pay-steps.mjs): ① Deposit now (holds your
  // date), ② The rest, by Wed 28 Oct, the sum written out. Replaces the one-number "due now" band.
  const cs = customerSteps(payStepsOf(invoice, lines, { paid, payments }));
  const pay = paymentStatus(settings);
  const business = settings.business_name || 'Porch & Party';
  const signature = business.replace(/^Porch & Party$/, 'Porch & Party 901');
  const footerLine = settings.business_address || 'Memphis, Tennessee';
  const phone = contact && contact.telephoneDisplay ? contact.telephoneDisplay : '';
  const tag = cashtag(settings.cashapp);

  // Lines from the one view model (invoice-view.mjs): long names wrap, the price stays on the
  // right, a line's note keeps its line breaks and its "item  $price" rows line up.
  const view = invoiceView({ invoice, lines });
  const rows = view.rows.map((r) => `
      <tr>
        <td style="padding:12px 12px 12px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:15px;color:${C.ink};vertical-align:top;word-break:break-word;overflow-wrap:anywhere;" data-line-desc>
          ${esc(r.description)}${r.qty ? ` <span style="color:${C.muted};">&times; ${esc(r.qty)}</span>` : ''}
          ${r.refundable ? `<div style="font-size:12px;color:${C.accent};margin-top:2px;">Given back after the event</div>` : ''}
          ${r.note.length ? `<div style="font-size:13px;color:${C.muted};margin-top:4px;" data-line-note>${noteHtml(r.note)}</div>` : ''}
        </td>
        <td align="right" style="padding:12px 0;border-bottom:1px solid ${C.line};font-family:${SANS};font-size:15px;color:${C.ink};white-space:nowrap;vertical-align:top;">${esc(r.amount)}</td>
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
      ${cs.totalWords ? `<tr><td colspan="2" style="font-family:${SANS};font-size:13px;color:${C.muted};padding-bottom:4px;" data-total-split>${esc(cs.totalWords)}</td></tr>` : ''}
    </table>
  </td></tr>
  <tr><td style="padding:8px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4fb;border:1px solid #b9cfe8;border-radius:10px;" data-pay-steps>
      <tr><td style="padding:16px;font-family:${SANS};font-size:15px;color:${C.ink};">
        <div style="font-family:${SERIF};font-size:20px;font-weight:600;margin-bottom:4px;">How you pay</div>
        ${cs.head ? `<div style="font-size:15px;margin-bottom:4px;" data-no-deposit>${esc(cs.head)}</div>` : ''}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cs.rows.map((r) => `<tr data-pay-step="${r.n}"><td style="padding:4px 0;font-family:${SANS};font-size:15px;color:${C.ink};">${r.mark} ${esc(r.words)}${r.tag ? ` <span data-step-paid style="color:#2f5a2b;font-weight:600;">${esc(r.tag)}</span>` : ''}</td><td align="right" style="padding:4px 0;font-family:${SANS};font-size:15px;font-weight:600;color:${C.ink};white-space:nowrap;">${money(r.cents)}</td></tr>`).join('')}</table>
        ${cs.sum ? `<div style="color:${C.muted};font-size:14px;margin-top:4px;" data-pay-sum>${esc(cs.sum)}</div>` : ''}
        ${cs.owed ? `<div style="font-size:15px;font-weight:600;margin-top:4px;" data-still-owed>${esc(cs.owed)}</div>` : ''}
        ${pickup ? `<div style="color:${C.ink};font-size:14px;margin-top:8px;" data-pickup-line>${esc(pickup)}</div>` : ''}
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:8px 24px 16px;font-family:${SANS};font-size:15px;line-height:1.5;color:${C.ink};">
    <div style="font-family:${SERIF};font-size:20px;font-weight:600;margin:8px 0;">How to pay</div>
    ${payItems.join('')}${qr}${coming}
    <div style="margin-top:10px;font-size:13px;color:${C.muted};">Please put ${esc(invoice.number)} in the payment note.</div>
    ${view.notes.length ? `<div style="margin-top:16px;padding-top:12px;border-top:1px solid ${C.line};" data-invoice-notes>${noteHtml(view.notes)}</div>` : ''}
  </td></tr>
  <tr><td style="padding:16px 24px 24px;border-top:1px solid ${C.line};font-family:${SANS};font-size:12px;color:${C.muted};line-height:1.6;">
    ${esc(signature)} &middot; ${esc(footerLine)}<br>
    Questions? Reply to this email or write ${esc(FROM_EMAIL)}${phone ? ` &middot; call or text ${esc(phone)}` : ''}.
  </td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `${business} - Invoice ${invoice.number}`,
    `Issued ${prettyDate(invoice.issue_date)} - Due ${prettyDate(invoice.due_date)}`,
    '',
    linesText(view, { refundableWords: '(given back after the event)' }),
    '',
    `Total: ${money(total)}`,
    ...(cs.totalWords ? [cs.totalWords] : []),
    '',
    'How you pay',
    ...(cs.head ? [cs.head] : []),
    ...cs.rows.map((r) => `${r.mark} ${r.words}: ${money(r.cents)}${r.tag ? ` ${r.tag}` : ''}`),
    ...(cs.sum ? [cs.sum] : []),
    ...(cs.owed ? [cs.owed] : []),
    ...(pickup ? [pickup] : []),
    '',
    'How to pay:',
    ...(settings.zelle ? [`Zelle: ${settings.zelle}`] : []),
    ...(tag ? [`Cash App: ${tag}`] : []),
    ...(pay.complete ? [] : ['Payment details coming. We will follow up with how to pay.']),
    `Please put ${invoice.number} in the payment note.`,
    ...(view.notes.length ? ['', noteRowsText(view.notes)] : []),
    '',
    `${signature} - ${footerLine}`,
    `Questions? Reply to this email or write ${FROM_EMAIL}.`,
  ].join('\n');

  return { html, text, subject: `Invoice ${invoice.number} from ${business}` };
}
