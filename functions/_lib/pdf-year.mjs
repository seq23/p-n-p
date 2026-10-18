// Year-end summary for the tax preparer as a plain, printable PDF (pdf-lib, like invoices).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { winAnsi } from './pdf.mjs';
import { CATEGORY_KEYS, CATEGORY_LABELS, METHOD_LABELS, FOOTER } from './money.mjs';

const usd = (c) => `$${(Math.round(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function renderYearPdf(sum, { business = 'Porch & Party', legal = 'Kerseta LLC' } = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${business} year-end summary ${sum.year}`);
  doc.setAuthor(business);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612; const H = 792; const M = 54;
  let page = doc.addPage([W, H]); let y = H - M;
  const ink = rgb(0.17, 0.14, 0.12);
  const line = (text, { font = sans, size = 10.5, x = M, right = null } = {}) => {
    if (y < M + 40) { page = doc.addPage([W, H]); y = H - M; }
    page.drawText(winAnsi(String(text)).slice(0, 110), { x, y, size, font, color: ink });
    if (right !== null) { const t = winAnsi(String(right)); page.drawText(t, { x: W - M - font.widthOfTextAtSize(t, size), y, size, font, color: ink }); }
    y -= size + 5;
  };
  const gap = (n = 6) => { y -= n; };
  const t = sum.total;
  line(`${business} — year-end summary ${sum.year}`, { font: bold, size: 16 });
  line(`Legal entity: ${legal}`, { size: 11 });
  gap(8);
  line('Money in', { font: bold, size: 12 });
  line('Gross money received', { right: usd(t.received) });
  line('   of which charges (income)', { right: usd(t.revenue) });
  line('   of which damage deposits taken (not income)', { right: usd(t.depositsIn) });
  line('Damage deposits kept for damage (income)', { right: usd(t.kept) });
  line('Refunds issued (incl. damage-deposit refunds)', { right: usd(t.refunds) });
  line('Damage deposits held at year end (owed back, not income)', { right: usd(sum.depositsHeld) });
  line('Number of jobs', { right: String(t.jobs) });
  gap();
  line('Income by category', { font: bold, size: 12 });
  for (const k of CATEGORY_KEYS) line(CATEGORY_LABELS[k], { right: usd(t.byCategory[k] || 0) });
  gap();
  line('Money received by payment method', { font: bold, size: 12 });
  for (const [k, v] of Object.entries(t.byMethod)) line(METHOD_LABELS[k] || k, { right: usd(v) });
  gap();
  line('By month (received / jobs / expenses)', { font: bold, size: 12 });
  for (const m of sum.months) line(m.month, { right: `${usd(m.received)}   ${m.jobs} jobs   ${usd(m.expenses)}` });
  gap();
  line('Expenses', { font: bold, size: 12 });
  line('Total expenses', { right: usd(t.expenses) });
  for (const [k, v] of Object.entries(t.expenseByCategory)) line(`   ${k}`, { right: usd(v) });
  gap();
  line('Invoices (number, date, customer — total / paid)', { font: bold, size: 12 });
  for (const i of sum.list) line(`${i.number}  ${i.date}  ${i.customer}`, { size: 9.5, right: `${usd(i.total)} / ${usd(i.paid)}` });
  if (sum.voided.length) {
    gap();
    line('Voided invoices (for the record, $0)', { font: bold, size: 12 });
    for (const v of sum.voided) line(`${v.number}  ${v.date}  ${v.customer}`, { size: 9.5, right: '$0.00' });
  }
  if (t.expenseList.length) {
    gap();
    line('Expense list (receipt saved in admin)', { font: bold, size: 12 });
    for (const e of t.expenseList) line(`${e.date}  ${e.vendor}  ${e.category}`, { size: 9.5, right: `${usd(e.total_cents)} (tax ${usd(e.tax_cents)})` });
  }
  for (const p of doc.getPages()) p.drawText(winAnsi(FOOTER), { x: M, y: M - 20, size: 8.5, font: sans, color: rgb(0.37, 0.32, 0.28) });
  return doc.save();
}
