// ONE invoice view model (owner, 25 Oct 2026). Every place an invoice is shown reads this:
// the /admin invoice page, the HTML and plain-text email (email.mjs), the PDF and the text
// message (pdf.mjs). A line's note and the invoice's own note keep their line breaks, and a note
// row shaped "item<TAB>$price" (or several spaces / " - " / "…" before the price) is shown as an
// item with its price on the right. Before this, each surface kept its own list of fields: the
// text message and the PDF left line notes out, so an itemized list typed into a line's note
// never reached the customer's text (invoice PNP-2026-0010, 25 Oct 2026).
// scripts/validators/validate_admin_invoice_lists.mjs pins every surface to this file.
//
// parseRow and parsePriceList have no imports and no outside names: the invoice editor's
// "📋 Paste a list" box runs these same two functions in the browser (views.mjs embeds their
// source), so the preview and the saved lines can never disagree.
import { money, lineTotal, needsPrice } from './util.mjs';

// "Balloon arch\t$300" / "Balloon arch    300" / "Balloon arch - $1,250.00" / "Banner … $25"
// -> { item, price, cents }; anything else -> null. One plain space is enough only before a "$".
export function parseRow(raw) {
  const s = String(raw == null ? '' : raw).replace(/ /g, ' ').replace(/\s+$/, '');
  const m = s.match(/^(.*?\S)(\t+\s*|\s{2,}|\s+[-–—:]\s*|\s*(?:…|\.{3,})\s*|\s+(?=\$)|:(?=\s*\$))(-?\s*\$\s?-?\d[\d,]*(?:\.\d{1,2})?|-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|-?\d+(?:\.\d{1,2})?)$/);
  if (!m) return null;
  const item = m[1].replace(/^\s*(?:[-•*·]|\d+[.)])\s+/, '').replace(/[\s:.…\-–—]+$/, '').trim();
  const num = m[3].replace(/[$,\s]/g, '');
  if (!item || !/^-?\d+(\.\d{1,2})?$/.test(num)) return null;
  return { item, price: m[3].replace(/\s+/g, ''), cents: Math.round(Number(num) * 100) };
}

// A pasted list -> { lines: [{ description, cents }], total: { cents, label } | null, sum,
// match: true | false | null (no total row), skipped: [rows that had no price] }.
// A "Total" or "Subtotal" row is never a line; it is only compared with the sum.
export function parsePriceList(text) {
  const rows = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  const lines = []; const skipped = []; let total = null; let subtotal = null;
  for (const raw of rows) {
    if (!raw.trim()) continue;
    const r = parseRow(raw);
    if (!r) { skipped.push(raw.trim()); continue; }
    if (/^(grand\s+)?total\b/i.test(r.item)) { total = { cents: r.cents, label: r.item }; continue; }
    if (/^sub\s*-?\s*total\b/i.test(r.item)) { subtotal = { cents: r.cents, label: r.item }; continue; }
    lines.push({ description: r.item, cents: r.cents });
  }
  const said = total || subtotal;
  const sum = lines.reduce((a, l) => a + l.cents, 0);
  return { lines, total: said, sum, match: said ? said.cents === sum : null, skipped };
}

// A note -> its rows, line breaks kept: { item, price } for a priced row, { text } otherwise
// ({ text: '' } is a blank line between paragraphs). Leading and trailing blank rows are dropped.
export function noteRows(note) {
  const rows = String(note == null ? '' : note).replace(/\r\n?/g, '\n').split('\n').map((raw) => {
    const r = parseRow(raw);
    return r ? { item: r.item, price: r.price } : { text: raw.trim() };
  });
  while (rows.length && rows[0].text === '') rows.shift();
  while (rows.length && rows[rows.length - 1].text === '') rows.pop();
  return rows.filter((r, i) => !(r.text === '' && rows[i - 1] && rows[i - 1].text === ''));
}

// Rows as plain text (email text part, text message): "item: $price" or the row itself.
export function noteRowsText(rows, indent = '') {
  return rows.map((r) => (r.item ? `${indent}${r.item}: ${r.price}` : (r.text ? `${indent}${r.text}` : ''))).join('\n');
}

// The view model. rows: one per invoice line, in the invoice's order.
//   label        "Pick 3 bundle × 2" (qty shown when it is not 1); labelPlain uses " x "
//   amount       "$300.00" / "Free" / "Price needed"
//   refundable   true for a damage deposit ("Given back after the event")
//   note         the line's note rows (a 'free' marker is not a note)
// notes: the invoice's own note rows (the message to the customer).
export function invoiceView({ invoice = {}, lines = [] }) {
  const rows = (lines || []).map((l) => {
    const qty = Number(l.qty) !== 1 ? String(l.qty) : '';
    const t = lineTotal(l);
    return {
      label: `${l.description}${qty ? ` × ${qty}` : ''}`,
      labelPlain: `${l.description}${qty ? ` x ${qty}` : ''}`,
      description: l.description, qty,
      cents: t, needsPrice: needsPrice(l),
      amount: needsPrice(l) ? 'Price needed' : (t === 0 ? 'Free' : money(t)),
      refundable: Boolean(l.refundable),
      note: l.note && l.note !== 'free' ? noteRows(l.note) : [],
    };
  });
  return { rows, notes: noteRows(invoice && invoice.notes) };
}

// The line rows as plain text, notes indented under their line (email text part, text message).
export function linesText(view, { refundableWords = '' } = {}) {
  const out = [];
  for (const r of view.rows) {
    out.push(`${r.labelPlain}${r.refundable && refundableWords ? ` ${refundableWords}` : ''}: ${r.amount}`);
    if (r.note.length) out.push(noteRowsText(r.note, '  '));
  }
  return out.join('\n');
}
