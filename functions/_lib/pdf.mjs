// The invoice as a one-page PDF (US Letter) for customers reached by text rather than
// email. Same facts as the email (functions/_lib/email.mjs): lines, total, what is asked
// for now under the pay plan, how to pay with the QR code, the note, the footer.
// pdf-lib is pure JavaScript and runs in Pages Functions; standard fonts only, so text
// is reduced to WinAnsi before drawing.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import { money, lineTotal, invoiceTotal, prettyDate, FROM_EMAIL } from './util.mjs';
import { payStepsOf, customerSteps } from './pay-steps.mjs';
import { invoiceView, linesText, noteRowsText } from './invoice-view.mjs';

const INK = rgb(0.23, 0.19, 0.16);
const ACCENT = rgb(0.72, 0.37, 0.25);
const MUTED = rgb(0.37, 0.32, 0.28);
const LINE = rgb(0.89, 0.85, 0.80);
const CREAM = rgb(0.98, 0.97, 0.95);
const PAGE = { w: 612, h: 792, margin: 48 };

const SWAP = { '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ', '✕': 'x', '×': 'x' };
export function winAnsi(text) {
  return String(text == null ? '' : text).replace(/[^\x20-\x7e\xa1-\xff]/g, (c) => SWAP[c] || '');
}

function cashtag(value) {
  const v = String(value || '').trim();
  return v ? (v.startsWith('$') ? v : `$${v}`) : '';
}

// pickup: the rentals pickup line (invoice-note.mjs pickupNote, worded per invoice), '' on a decor-only invoice.
// "How you pay" (owner-approved mock-up, 20 Oct 2026; pay-steps.mjs): the same numbered payments
// as the email. The circled numbers are drawn as "1." / "2." (standard PDF fonts have no ①).
// paid / payments: what has come in (ledger.mjs), so a paid step says so and "Still owed" shows.
export function payLines({ invoice, lines, pickup = '', paid = 0, payments = [] }) {
  const ps = payStepsOf(invoice, lines, { paid, payments });
  const cs = customerSteps(ps);
  return { total: ps.total, plan: ps.plan, now: ps.now, pickup, head: cs.head, rows: cs.rows, sum: cs.sum, totalWords: cs.totalWords, owed: cs.owed,
    words: [cs.head, ...cs.rows.map((r) => `${r.mark} ${r.words}: ${money(r.cents)}${r.tag ? ` ${r.tag}` : ''}`), cs.sum, cs.owed].filter(Boolean).join(' ') };
}

// The short message that goes with the PDF in a text (owner, 24 Oct 2026: short, with line
// breaks, the refundable deposit said in words, the police station named in full). Lines:
// greeting; what it is for + the date; the total with its maths in words; the numbered payments;
// how to pay (Cash App link); the pickup line + "Pickup place: <police station, address>";
// sign-off. meet: PRICE_TABLE.pickupWhere (games.json pickup), only on a pickup (not delivery) note.
// jobDate: the job's first booked day (YYYY-MM-DD), '' when none is booked yet.
export function textMessage({ invoice, lines, settings, pickup = '', paid = 0, payments = [], meet = '', jobDate = '' }) {
  const business = settings.business_name || 'Porch & Party';
  const p = payLines({ invoice, lines, pickup, paid, payments });
  const first = (invoice.customer_name || '').split(' ')[0] || 'there';
  const tag = cashtag(settings.cashapp);
  const how = [settings.zelle ? `Zelle ${settings.zelle}` : '', tag ? `Cash App ${tag} (https://cash.app/${tag})` : ''].filter(Boolean).join(' or ');
  const day = jobDate ? dayShort(jobDate) : '';
  const what = pickup ? 'game rental' : 'booking';
  const atPolice = pickup && meet && /Mt\. Moriah Station/.test(pickup);
  // The lines (with their notes) and the invoice's own note come from the one view model
  // (invoice-view.mjs), in the invoice page's order: lines, total, payments, pickup, note.
  const view = invoiceView({ invoice, lines });
  const groups = [
    [`Hi ${first},`, `Here is your ${business} invoice ${invoice.number} for your ${what}${day ? ` on ${day}` : ''} (PDF attached).`],
    [linesText(view, { refundableWords: '(refundable)' })],
    [`Total: ${money(p.total)}${p.totalWords ? ` (${p.totalWords})` : ''}`, p.head, ...p.rows.map((r) => `${r.mark} ${r.words}: ${money(r.cents)}${r.tag ? ` ${r.tag}` : ''}`), p.sum, p.owed],
    [how ? `Pay by ${how}, with ${invoice.number} in the note.` : ''],
    [p.pickup, atPolice ? `Pickup place: ${meet}.` : ''],
    [noteRowsText(view.notes)],
    ['Thank you!', business],
  ];
  return groups.map((g) => g.filter(Boolean)).filter((g) => g.length).map((g) => g.join('\n')).join('\n\n');
}

// "Sat 24 Oct" (the same day words as the pay steps).
function dayShort(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()} ${d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}`;
}

export async function renderInvoicePdf({ invoice, lines, settings, contact, pickup = '', paid = 0, payments = [] }) {
  const business = settings.business_name || 'Porch & Party';
  const footerLine = settings.business_address || 'Memphis, Tennessee';
  const phone = contact && contact.telephoneDisplay ? contact.telephoneDisplay : '';
  const tag = cashtag(settings.cashapp);
  const pay = payLines({ invoice, lines, pickup, paid, payments });
  const refundable = lines.filter((l) => l.refundable).reduce((s, l) => s + lineTotal(l), 0);

  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${invoice.number} from ${business}`);
  doc.setAuthor(business);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  let page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin;
  const left = PAGE.margin; const right = PAGE.w - PAGE.margin; const width = right - left;

  const text = (s, x, yy, { font = sans, size = 11, color = INK, align = 'left' } = {}) => {
    const t = winAnsi(s); const w = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: align === 'right' ? x - w : x, y: yy, size, font, color });
    return w;
  };
  const wrap = (s, font, size, maxWidth) => {
    const out = []; let line = '';
    const words = [];
    for (const w of winAnsi(s).split(/\s+/).filter(Boolean)) {
      // A word wider than the column (a long link, a run of letters) is cut into pieces that fit.
      let rest = w;
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let n = rest.length - 1; while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > maxWidth) n -= 1;
        words.push(rest.slice(0, n)); rest = rest.slice(n);
      }
      words.push(rest);
    }
    for (const word of words) {
      const probe = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(probe, size) <= maxWidth || !line) line = probe; else { out.push(line); line = word; }
    }
    if (line) out.push(line);
    return out;
  };
  const ensure = (h) => { if (y - h < PAGE.margin + 40) { page = doc.addPage([PAGE.w, PAGE.h]); y = PAGE.h - PAGE.margin; } };
  const rule = (yy, color = LINE) => page.drawLine({ start: { x: left, y: yy }, end: { x: right, y: yy }, thickness: 0.8, color });

  // Header
  text(business, left, y - 22, { font: serifBold, size: 26 });
  text(`INVOICE ${invoice.number}`.toUpperCase(), left, y - 40, { font: sansBold, size: 9.5, color: ACCENT });
  text(`Issued ${prettyDate(invoice.issue_date)}`, right, y - 16, { size: 10, color: MUTED, align: 'right' });
  text(`Due ${prettyDate(invoice.due_date)}`, right, y - 30, { size: 10, color: MUTED, align: 'right' });
  y -= 62; rule(y); y -= 18;

  // Bill to
  text('Bill to', left, y, { font: sansBold, size: 9, color: MUTED });
  y -= 15; text(invoice.customer_name || 'Customer', left, y, { font: sansBold, size: 12 });
  for (const v of [invoice.customer_email, invoice.customer_phone].filter(Boolean)) { y -= 14; text(v, left, y, { size: 10, color: MUTED }); }
  y -= 24;

  // Lines
  text('Description', left, y, { font: sansBold, size: 9, color: MUTED });
  text('Amount', right, y, { font: sansBold, size: 9, color: MUTED, align: 'right' });
  y -= 8; rule(y); y -= 16;
  // Lines from the one view model (invoice-view.mjs). A long name wraps inside its column with
  // the amount on the right of its first row; the line's note follows in grey with its line
  // breaks, a priced note row ("item  $price") with its price lined up at the column's right.
  const view = invoiceView({ invoice, lines });
  const descW = width - 110;
  const noteRowsDraw = (rows, x, colRight, size) => {
    for (const r of rows) {
      if (r.item) {
        const pw = sans.widthOfTextAtSize(winAnsi(r.price), size);
        const parts = wrap(r.item, sans, size, colRight - x - pw - 14);
        parts.forEach((t, i) => { ensure(size + 6); text(t, x, y, { size, color: MUTED }); if (i === 0) text(r.price, colRight, y, { size, color: MUTED, align: 'right' }); y -= size + 3.5; });
      } else if (r.text) {
        for (const t of wrap(r.text, sans, size, colRight - x)) { ensure(size + 6); text(t, x, y, { size, color: MUTED }); y -= size + 3.5; }
      } else y -= 6;
    }
  };
  for (const r of view.rows) {
    const rows = wrap(r.labelPlain, sans, 11, descW);
    ensure(rows.length * 14 + (r.refundable ? 14 : 0) + 10);
    text(r.amount, right, y, { size: 11, align: 'right', font: r.needsPrice ? sansBold : sans, color: r.needsPrice ? ACCENT : INK });
    rows.forEach((t) => { ensure(18); text(t, left, y, { size: 11 }); y -= 14; });
    if (r.refundable) { text('Given back after the event', left, y, { size: 9, color: MUTED }); y -= 14; }
    if (r.note.length) { y -= 1; noteRowsDraw(r.note, left + 10, left + descW, 9.5); }
    y -= 4; rule(y); y -= 16;
  }
  ensure(60);
  text('Total', left, y, { font: serifBold, size: 18 });
  text(money(pay.total), right, y, { font: serifBold, size: 18, align: 'right' });
  y -= 16;
  if (pay.totalWords) { text(pay.totalWords, left, y, { size: 9.5, color: MUTED }); y -= 14; }
  y -= 10;

  // How you pay: the numbered payments (pay-steps.mjs), then the rental pickup line.
  const pickupRows = pay.pickup ? wrap(pay.pickup, sans, 10.5, width - 28) : [];
  const boxH = 34 + (pay.head ? 16 : 0) + pay.rows.length * 18 + (pay.sum ? 16 : 0) + (pay.owed ? 16 : 0) + pickupRows.length * 14 + 6; ensure(boxH + 10);
  page.drawRectangle({ x: left, y: y - boxH, width, height: boxH, color: rgb(0.93, 0.96, 0.98), borderColor: rgb(0.73, 0.81, 0.91), borderWidth: 0.8 });
  let by = y - 22;
  text('How you pay', left + 14, by, { font: serifBold, size: 15 }); by -= 18;
  if (pay.head) { text(pay.head, left + 14, by, { size: 10.5 }); by -= 16; }
  for (const r of pay.rows) { text(`${r.n}. ${r.words}${r.paid ? ' (paid)' : ''}`, left + 14, by, { size: 11 }); text(money(r.cents), right - 14, by, { font: sansBold, size: 11, align: 'right' }); by -= 18; }
  if (pay.sum) { text(pay.sum, left + 14, by, { size: 10, color: MUTED }); by -= 16; }
  if (pay.owed) { text(pay.owed, left + 14, by, { font: sansBold, size: 11 }); by -= 16; }
  pickupRows.forEach((r, i) => text(r, left + 14, by - i * 14, { size: 10.5 }));
  y -= boxH + 22;

  // How to pay (with the QR on the right)
  let qr = null;
  if (settings.qr_png) {
    try {
      const bytes = Uint8Array.from(atob(settings.qr_png), (c) => c.charCodeAt(0));
      qr = settings.qr_type === 'image/jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    } catch (e) { qr = null; }
  }
  const qrSize = qr ? 120 : 0;
  const textWidth = width - (qr ? qrSize + 20 : 0);
  ensure(Math.max(qrSize, 90) + 20);
  const sectionTop = y;
  text('How to pay', left, y, { font: serifBold, size: 16 }); y -= 20;
  const items = [settings.zelle ? `Zelle: ${settings.zelle}` : '', tag ? `Cash App: ${tag}` : ''].filter(Boolean);
  if (!items.length) items.push('Payment details coming. We will follow up with how to pay.');
  for (const it of items) { text(it, left, y, { size: 11.5 }); y -= 16; }
  for (const r of wrap(`Please put ${invoice.number} in the payment note.`, sans, 9.5, textWidth)) { text(r, left, y, { size: 9.5, color: MUTED }); y -= 13; }
  if (qr) {
    page.drawImage(qr, { x: right - qrSize, y: sectionTop - qrSize + 6, width: qrSize, height: qrSize });
    y = Math.min(y, sectionTop - qrSize);
  }
  y -= 14;

  if (view.notes.length) {
    ensure(40); rule(y); y -= 16;
    for (const r of view.notes) {
      if (r.item) {
        const pw = sans.widthOfTextAtSize(winAnsi(r.price), 10.5);
        wrap(r.item, sans, 10.5, width - pw - 16).forEach((t, i) => { ensure(16); text(t, left, y, { size: 10.5 }); if (i === 0) text(r.price, right, y, { size: 10.5, align: 'right' }); y -= 14; });
      } else if (r.text) {
        for (const t of wrap(r.text, sans, 10.5, width)) { ensure(16); text(t, left, y, { size: 10.5 }); y -= 14; }
      } else y -= 8;
    }
  }

  // Footer on the last page
  const fy = PAGE.margin;
  rule(fy + 26);
  text(`${business}  |  ${footerLine}`, left, fy + 12, { size: 8.5, color: MUTED });
  text(`Questions? Write ${FROM_EMAIL}${phone ? ` or call or text ${phone}` : ''}.`, left, fy, { size: 8.5, color: MUTED });

  // A voided invoice keeps its number and gets a large VOID stamp on every page.
  if (invoice.status === 'void') {
    for (const p of doc.getPages()) {
      const size = 150; const w = sansBold.widthOfTextAtSize('VOID', size);
      p.drawText('VOID', { x: (PAGE.w - w * 0.82) / 2, y: PAGE.h / 2 - 120, size, font: sansBold, color: rgb(0.56, 0.2, 0.15), opacity: 0.35, rotate: degrees(30) });
    }
    doc.setSubject('VOID');
  }
  return doc.save();
}
