#!/usr/bin/env node
/**
 * Itemized invoices (owner, 25 Oct 2026; functions/_lib/invoice-view.mjs, views.mjs, email.mjs,
 * pdf.mjs, sent-copies.mjs, migration 0024). Made-up names and fixtures only (public repo).
 *
 * Fails when:
 *  1. "📋 Paste a list" does not turn the owner's five-row list (and its tab, " - ", "…", no-$ and
 *     comma variants) into five lines totalling $400 with the Total row left out; "$1,250.00",
 *     "300" and "$300" do not read as prices; a mismatch is not caught;
 *  2. the editor lacks the full-width paste box, its preview, "Your list said $X. The lines add up
 *     to $Y ✓", the calm yellow mismatch words, Save these lines / Cancel, or the browser runs a
 *     different parser than the server (the page must embed invoice-view.mjs's own source, and
 *     that embedded code must give the same five lines);
 *  3. a line's note or the invoice's note loses its line breaks on save, or the line-note field
 *     is a one-line input, or the invoice note is not a full-width, always-visible box;
 *  4. a line note (with "item<TAB>$price" rows) or the invoice note is missing, or run together,
 *     on ANY of the five surfaces: the /admin invoice page, the HTML email, the plain-text email,
 *     the PDF and the text message; the text message drops the lines or the notes, or puts them
 *     out of the invoice page's order (lines, total, payments, pickup, note);
 *  5. a renderer keeps its own list of invoice fields instead of reading invoiceView();
 *  6. the PDF does not wrap a long description inside its column with the price on the right, or
 *     a priced note row's price is not on the same row as its item;
 *  7. a real send does not keep its exact copy (HTML, text, PDF, from/to/time) in the private
 *     bucket, "What we sent ✉ <date time>" is not on the invoice, the copy page does not show
 *     that exact email, a TEST send keeps a copy, or the Bcc is not exactly ownerCopy's hello@;
 *  8. migration 0024 is not additive only, or anything new names valeriektaylor13.
 * Rule 0: fewer than 80 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pdfStreams } from './lib/pdf_streams.mjs';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const nq = (h) => String(h).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const IV = await mod('functions/_lib/invoice-view.mjs');
const V = await mod('functions/_lib/views.mjs');
const E = await mod('functions/_lib/email.mjs');
const PDF = await mod('functions/_lib/pdf.mjs');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- 1. The owner's list and its variants --------------------------------------------------
const LIST = [
  'Basic room setup (15 ceiling balloons, banner, petal walkway, bed design, 8–12 LED tea lights)    $300',
  'Upgrade to purple foil "Feliz Cumpleaños" balloon banner    $25',
  'Two oversized purple foil number balloons — "28"    $25',
  'Small purple, blue, and silver balloon base/display supporting the "28"    $35',
  'Additional faux rose-petal detailing    $15',
  'Total    $400',
].join('\n');
const WANT = [30000, 2500, 2500, 3500, 1500];
const variants = {
  'spaces': LIST,
  'tabs': LIST.replace(/ {4}/g, '\t'),
  '" - "': LIST.replace(/ {4}/g, ' - '),
  'no $': LIST.replace(/ {4}\$/g, '    '),
  'commas and cents, no $': LIST.replace(/ {4}\$(\d+)/g, (m, n) => `\t${Number(n).toLocaleString('en-US')}.00`),
  '"…"': LIST.replace(/ {4}/g, ' … '),
  'Windows line ends + blank rows': `\r\n${LIST.replace(/\n/g, '\r\n\r\n')}\r\n`,
  'Subtotal row': LIST.replace('Total', 'Subtotal'),
};
for (const [name, text] of Object.entries(variants)) {
  const r = IV.parsePriceList(text);
  must(r.lines.length === 5, `${name}: ${r.lines.length} lines, not 5`);
  must(JSON.stringify(r.lines.map((l) => l.cents)) === JSON.stringify(WANT), `${name}: prices read ${r.lines.map((l) => l.cents).join(',')}`);
  must(r.sum === 40000 && r.total && r.total.cents === 40000 && r.match === true, `${name}: sum ${r.sum}, total ${JSON.stringify(r.total)}, match ${r.match}`);
  must(!r.lines.some((l) => /total/i.test(l.description)) && r.skipped.length === 0, `${name}: the Total row became a line or a row was skipped (${r.skipped.join(' | ')})`);
  must(r.lines[0] && r.lines[2] && r.lines[0].description.startsWith('Basic room setup (15 ceiling balloons') && r.lines[0].description.endsWith('8–12 LED tea lights)') && r.lines[2].description === 'Two oversized purple foil number balloons — "28"', `${name}: descriptions read ${JSON.stringify(r.lines.map((l) => l.description))}`);
}
must(IV.parseRow('Big tent\t$1,250.00').cents === 125000 && IV.parseRow('Big tent  300').cents === 30000 && IV.parseRow('Big tent $300').cents === 30000 && IV.parseRow('Big tent - 1,250').cents === 125000, '"$1,250.00", "300" and "$300" do not all read as prices');
must(IV.parseRow('Two balloons "28"') === null && IV.parseRow('Call me at 5') === null && IV.parseRow('') === null, 'a row with no price separator read as a priced row');
// A note saved before line breaks were kept: its tabbed rows ran together with spaces (shape of
// PNP-2026-0010's line note, made-up words). It shows as its rows again, without changing data.
const flat = IV.noteRows('Room setup (balloons, 8–12 tea lights)\t$300 Foil banner\t$25 Number balloons "28"\t$25 Total\t$350');
must(flat.length === 4 && flat[0].item === 'Room setup (balloons, 8–12 tea lights)' && flat[0].price === '$300' && flat[2].item === 'Number balloons "28"' && flat[3].item === 'Total' && flat[3].price === '$350', `a run-together tabbed note does not split back into rows: ${JSON.stringify(flat)}`);
must(IV.noteRows('Pick up at 5 pm sharp').length === 1 && IV.noteRows('Gate code 1234 then left').length === 1, 'a plain note row was split');
const off = IV.parsePriceList(LIST.replace('Total    $400', 'Total    $410'));
must(off.match === false && off.sum === 40000 && off.total.cents === 41000, `a $410 total over $400 of lines is not a mismatch: ${JSON.stringify(off)}`);
const noTotal = IV.parsePriceList(LIST.split('\n').slice(0, 5).join('\n'));
must(noTotal.match === null && noTotal.sum === 40000 && noTotal.lines.length === 5, 'a list with no Total row does not still add up');
const mixed = IV.parsePriceList('Balloon arch    $300\nPlease use purple\nTotal $300');
must(mixed.lines.length === 1 && mixed.skipped.length === 1 && mixed.skipped[0] === 'Please use purple' && mixed.match === true, 'a row with no price is not listed apart as left out');

// ---- 2. The editor's paste box ---------------------------------------------------------------
const s = await session();
const ed = (await s.get('/admin/invoices/new')).text;
const edq = nq(ed);
must(/<details class="paste" data-paste>/.test(ed) && edq.includes('📋 Paste a list'), 'the editor has no "📋 Paste a list" box');
must(/<textarea id="paste-text" rows="8" data-paste-text/.test(ed) && /\.paste textarea\{min-height:170px/.test(ed), 'the paste box is not a big multi-line textarea');
must(/textarea\{width:100%/.test(ed), 'textareas are not full width');
must(edq.includes('Save these lines') && edq.includes('data-paste-cancel') && edq.includes('>Cancel</button>') && edq.includes('data-paste-preview hidden'), 'the paste preview lacks Save these lines / Cancel');
must(edq.includes("'Your list said '+dol(r.total.cents)+'. The lines add up to '+dol(r.sum)+' ✓'") && edq.includes("tot.className='notice warn'") && ed.includes('These don\u2019t match. Check the prices before you save.'), 'the paste preview lacks "Your list said $X. The lines add up to $Y ✓" or the calm yellow mismatch');
must(edq.includes("form.requestSubmit(sv)") && edq.includes("button[name=go][value=save]"), 'Save these lines does not save the invoice through Save draft (back to the same invoice)');
must(ed.includes(IV.parseRow.toString()) && ed.includes(IV.parsePriceList.toString()), 'the editor does not embed invoice-view.mjs parseRow / parsePriceList unchanged (two parsers would drift)');
// Run the page's own embedded parser and compare with the server's.
const script = (ed.match(/<script>([\s\S]*?)<\/script>/g) || []).map((x) => x.slice(8, -9)).find((x) => x.includes('function parsePriceList')) || '';
const fnSrc = (name) => { const i = script.indexOf(`function ${name}(`); if (i < 0) return ''; let depth = 0; for (let j = script.indexOf('{', i); j < script.length; j += 1) { if (script[j] === '{') depth += 1; else if (script[j] === '}') { depth -= 1; if (!depth) return script.slice(i, j + 1); } } return ''; };
const ctx = {}; vm.createContext(ctx);
try { vm.runInContext(`${fnSrc('parseRow')}\n${fnSrc('parsePriceList')}\nthis.out = JSON.stringify(parsePriceList(${JSON.stringify(variants.tabs)}));`, ctx); } catch (e) { ctx.out = `threw ${e.message}`; }
must(ctx.out === JSON.stringify(IV.parsePriceList(variants.tabs)), `the page's parser reads the list differently from the server: ${String(ctx.out).slice(0, 160)}`);

// ---- 3. Line breaks survive saving; the fields --------------------------------------------
must(/<textarea name="line_note" rows="3" data-line-note-input>/.test(ed) && !/<input name="line_note"/.test(ed), 'the line note is still a one-line input (it drops line breaks)');
must(/<section class="card note ivnote" data-ed-note>/.test(ed) && /<textarea id="nt" name="notes" rows="6"/.test(ed) && !/<details class="card note"/.test(ed), 'the invoice note is not a full-width, always-visible multi-line box');
must(/\.lsum \[data-l-note\]\{white-space:pre-line\}/.test(ed), "a line's note loses its line breaks in the editor's line summary");
const LINE_NOTE = 'Includes:\r\nBalloon garland\t$120\r\nBanner\t$25\r\n\r\nSet up by 3 pm';
const INV_NOTE = 'Thank you, Robin!\r\nPlease park on the street.\r\nGate code 1234';
const created = await s.post('/admin/invoices', {
  customer_name: 'Robin Example', customer_email: 'robin.example@example.com', customer_phone: '901-555-0142', issue_date: '2026-10-25', due_date: '2026-10-30',
  pay_plan: 'half', deposit: '', notes: INV_NOTE, go: 'save',
  line_desc: ['Party decor: Birthday with a very long description that has to wrap across more than one row on a phone and in the PDF without being cut off anywhere at all', 'Damage deposit (refundable)'],
  line_qty: ['1', '1'], line_price: ['300.00', '50.00'], line_note: [LINE_NOTE, ''], line_refundable: ['0', '1'],
});
const invId = Number((created.location.match(/\/admin\/invoices\/(\d+)/) || [])[1]);
must(created.status === 303 && invId > 0, `saving a test invoice answered ${created.status} ${created.location}`);
const savedInv = await s.one('SELECT * FROM invoices WHERE id = ?1', invId);
const savedLines = await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position', invId);
must(savedInv && savedInv.notes === INV_NOTE.replace(/\r\n/g, '\n'), `the invoice note lost its line breaks on save: ${JSON.stringify(savedInv && savedInv.notes)}`);
must(savedLines[0] && savedLines[0].note === LINE_NOTE.replace(/\r\n/g, '\n'), `the line note lost its line breaks on save: ${JSON.stringify(savedLines[0] && savedLines[0].note)}`);

// ---- 4. Five surfaces -----------------------------------------------------------------------
const view = IV.invoiceView({ invoice: savedInv, lines: savedLines });
must(view.rows.length === 2 && view.rows[0].note.length === 5 && view.rows[0].note[1].item === 'Balloon garland' && view.rows[0].note[1].price === '$120' && view.rows[0].note[3].text === '' && view.notes.length === 3, `the view model reads ${JSON.stringify(view.rows[0].note)} / ${JSON.stringify(view.notes)}`);
const page = (await s.get(`/admin/invoices/${invId}`)).text;
must(/<div data-line-note><div class="nrows"><div class="nrow"><span>Includes:<\/span><\/div><div class="nrow"><span>Balloon garland<\/span><span class="p">\$120<\/span><\/div><div class="nrow"><span>Banner<\/span><span class="p">\$25<\/span><\/div><div class="ngap"><\/div><div class="nrow"><span>Set up by 3 pm<\/span><\/div><\/div><\/div>/.test(page), 'invoice page: the line note is not shown row by row with its prices on the right');
must(/data-invoice-notes><h3[^>]*>Message to Robin<\/h3><div class="nrows"><div class="nrow"><span>Thank you, Robin!<\/span><\/div><div class="nrow"><span>Please park on the street.<\/span><\/div><div class="nrow"><span>Gate code 1234<\/span><\/div>/.test(page), 'invoice page: the invoice note is missing or run together');
must(/\.sumlines td:first-child\{overflow-wrap:anywhere/.test(page) && /\.nrow \.p\{white-space:nowrap\}/.test(page) && /\.sumlines \.amt\{text-align:right;white-space:nowrap/.test(page), 'invoice page: long descriptions do not wrap with the price kept on the right');
must(page.includes('Party decor: Birthday with a very long description that has to wrap across more than one row on a phone and in the PDF without being cut off anywhere at all</td>') || page.includes('without being cut off anywhere at all<div'), 'invoice page: the long description is cut');
const mail = E.renderInvoiceEmail({ invoice: savedInv, lines: savedLines, settings: {}, contact: {}, qrSrc: null });
must(/data-line-note>(?:<table[^>]*><tr><td[^>]*>Balloon garland<\/td><td align="right"[^>]*white-space:nowrap[^>]*>\$120<\/td>|<div[^>]*>Includes:<\/div><table[^>]*><tr><td[^>]*>Balloon garland<\/td><td align="right"[^>]*white-space:nowrap[^>]*>\$120<\/td>)/.test(mail.html), 'HTML email: the line note rows are not item left, price right');
must(mail.html.includes('>Set up by 3 pm</div>') && mail.html.includes('height:8px'), 'HTML email: the line note lost its blank line or last row');
must(/data-invoice-notes><div[^>]*>Thank you, Robin!<\/div><div[^>]*>Please park on the street\.<\/div><div[^>]*>Gate code 1234<\/div><\/div>/.test(mail.html), 'HTML email: the invoice note lost its line breaks');
must(/data-line-desc[^>]*>/.test(mail.html) && /vertical-align:top;word-break:break-word;overflow-wrap:anywhere;" data-line-desc/.test(mail.html), 'HTML email: long descriptions do not wrap');
must(mail.text.includes('cut off anywhere at all: $300.00\n  Includes:\n  Balloon garland: $120\n  Banner: $25\n\n  Set up by 3 pm\n'), `plain-text email: the line note is missing or run together:\n${mail.text}`);
must(mail.text.includes('\nThank you, Robin!\nPlease park on the street.\nGate code 1234\n'), 'plain-text email: the invoice note lost its line breaks');
must(mail.text.includes('Damage deposit (refundable) (given back after the event): $50.00'), 'plain-text email: the damage deposit line changed');
const sms = PDF.textMessage({ invoice: savedInv, lines: savedLines, settings: { zelle: '901-555-0100' } });
const at = (t) => sms.indexOf(t);
must(at('cut off anywhere at all: $300.00') > 0 && at('  Balloon garland: $120') > at('cut off anywhere at all: $300.00') && at('  Banner: $25') > at('  Balloon garland: $120') && at('  Set up by 3 pm') > at('  Banner: $25'), `text message: the lines and the line note are missing or out of order:\n${sms}`);
must(at('Damage deposit (refundable) (refundable): $50.00') > at('  Set up by 3 pm') && at('Total: $350.00') > at('Damage deposit'), 'text message: the lines are not before the total');
must(at('Thank you, Robin!\nPlease park on the street.\nGate code 1234') > at('Pay by Zelle') && at('Thank you, Robin!') < at('Thank you!\nPorch & Party'), `text message: the invoice note is missing, run together or out of the page's order:\n${sms}`);
// Through the router, the page's own share text and "Copy the message" carry the same.
must(nq(page).includes('  Balloon garland: $120\n  Banner: $25') && nq(page).includes('Thank you, Robin!\nPlease park on the street.'), 'the invoice page\'s text message (Copy the message / Text the invoice) lacks the line note or the invoice note');

// PDF text (decoded from its content streams), with positions.
async function pdfItems(bytes) {
  const out = [];
  for (const txt of pdfStreams(bytes)) {
    let x = 0; let y = 0;
    for (const t of txt.matchAll(/([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) Tm|<([0-9A-Fa-f]*)> Tj/g)) {
      if (t[1] !== undefined) { x = Number(t[5]); y = Number(t[6]); } else out.push({ x, y, s: Buffer.from(t[7], 'hex').toString('latin1') });
    }
  }
  return out;
}
const pdf = await pdfItems(await PDF.renderInvoicePdf({ invoice: savedInv, lines: savedLines, settings: {}, contact: {} }));
must(pdf.length > 10, `Rule 0: the PDF decoder read only ${pdf.length} text items`);
const item = (str) => pdf.find((p) => p.s === str);
const g = item('Balloon garland'); const g$ = pdf.find((p) => p.s === '$120');
must(g && g$ && Math.abs(g.y - g$.y) < 0.5 && g$.x > g.x + 150, `PDF: the note row "Balloon garland … $120" is not one row with the price to the right (${JSON.stringify([g, g$])})`);
const inc = item('Includes:'); const ban = item('Banner'); const setup = item('Set up by 3 pm');
must(inc && ban && setup && inc.y > g.y && g.y > ban.y && ban.y - setup.y > 14, 'PDF: the line note lost its order or its blank line');
const descRows = pdf.filter((p) => /^(Party decor|.*cut off anywhere at all$)/.test(p.s) || p.s.includes('wrap across'));
must(descRows.length >= 2 && descRows.every((p) => p.x === 48), `PDF: the long description is not wrapped in its column (${JSON.stringify(descRows)})`);
const amt = pdf.find((p) => p.s === '$300.00');
must(amt && descRows[0] && Math.abs(amt.y - descRows[0].y) < 0.5 && amt.x > 450, 'PDF: the line amount is not on the right of the first description row');
const n1 = item('Thank you, Robin!'); const n2 = item('Please park on the street.'); const n3 = item('Gate code 1234');
must(n1 && n2 && n3 && n1.y > n2.y && n2.y > n3.y && n1.x === n2.x, 'PDF: the invoice note lost its line breaks');
const longWord = await pdfItems(await PDF.renderInvoicePdf({ invoice: { ...savedInv, notes: 'x'.repeat(400) }, lines: savedLines, settings: {}, contact: {} }));
must(longWord.filter((p) => /^x+$/.test(p.s)).length >= 4, 'PDF: a very long word is not broken to fit the page');

// ---- 5. One view model ----------------------------------------------------------------------
const emailSrc = read('functions/_lib/email.mjs'); const pdfSrc = read('functions/_lib/pdf.mjs'); const viewsSrc = read('functions/_lib/views.mjs');
must(/import \{ invoiceView, linesText, noteRowsText \} from '\.\/invoice-view\.mjs'/.test(emailSrc) && /import \{ invoiceView, linesText, noteRowsText \} from '\.\/invoice-view\.mjs'/.test(pdfSrc) && /import \{ invoiceView, parseRow, parsePriceList \} from '\.\/invoice-view\.mjs'/.test(viewsSrc), 'a surface does not import the one invoice view model');
must(!/lines\.map\(\(l\)/.test(emailSrc) && !/for \(const l of lines\)/.test(pdfSrc) && !/invoice\.notes/.test(emailSrc) && !/invoice\.notes/.test(pdfSrc), 'email.mjs or pdf.mjs still reads the lines or the note itself');
const ivSrc = viewsSrc.slice(viewsSrc.indexOf('export function invoiceViewPage'), viewsSrc.indexOf('// Damage deposit after the event'));
must(ivSrc.includes('view.rows.map(') && !/lines\.map\(\(l\)/.test(ivSrc) && ivSrc.includes('view.notes'), 'the invoice page does not read the view model');
must(/const view = invoiceView\(\{ invoice, lines \}\);[\s\S]*linesText\(view[\s\S]*noteRowsText\(view\.notes\)/.test(pdfSrc.slice(pdfSrc.indexOf('export function textMessage'), pdfSrc.indexOf('function dayShort'))), 'the text message does not read the lines and the note from the view model');

// ---- 7. What we sent ------------------------------------------------------------------------
const before = s.env.sent.length;
await s.post(`/admin/invoices/${invId}/send`, { test: '1' });
must(s.env.sent.length === before + 1 && (await s.all('SELECT * FROM invoice_sent_copies WHERE invoice_id = ?1', invId)).length === 0, 'a TEST send kept a "What we sent" copy');
const sent = await s.post(`/admin/invoices/${invId}/send`, {});
const payload = s.env.sent[s.env.sent.length - 1];
must(sent.status === 303 && /Sent/.test(decodeURIComponent(sent.location)) && payload.to === 'robin.example@example.com', `the real send did not go out: ${sent.location}`);
must(payload.bcc === 'hello@porchandparty901.com' && !JSON.stringify(payload).includes('valeriektaylor13'), `the invoice Bcc is not exactly hello@: ${payload.bcc}`);
const copies = await s.all('SELECT * FROM invoice_sent_copies WHERE invoice_id = ?1', invId);
must(copies.length === 1 && copies[0].from_email === 'Porch & Party <hello@porchandparty901.com>' && copies[0].to_email === payload.to && copies[0].bcc === payload.bcc && copies[0].subject === payload.subject && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(copies[0].sent_at), `the sent copy row is wrong: ${JSON.stringify(copies)}`);
const pre = copies[0] ? copies[0].r2_prefix : '';
const obj = (n) => s.env.objects.get(`${pre}/${n}`);
const dec = (o) => (o ? new TextDecoder().decode(o.bytes) : '');
must(pre.startsWith(`sent-invoices/${invId}/`) && dec(obj('email.html')) === payload.html && dec(obj('email.txt')) === payload.text, 'the kept copy is not the exact HTML and text that went out');
must(obj('invoice.pdf') && obj('invoice.pdf').type === 'application/pdf' && dec(obj('invoice.pdf')).startsWith('%PDF'), 'the kept copy has no PDF');
const meta = JSON.parse(dec(obj('meta.json')) || '{}');
must(meta.from === 'Porch & Party <hello@porchandparty901.com>' && meta.to === payload.to && meta.sent_at === copies[0].sent_at, `the kept meta is wrong: ${JSON.stringify(meta)}`);
const page2 = nq((await s.get(`/admin/invoices/${invId}`)).text);
must(new RegExp(`<a href="/admin/invoices/${invId}/sent/${copies[0] && copies[0].id}"[^>]*>What we sent ✉ \\w{3} \\d{1,2} \\w{3}, \\d{1,2}:\\d\\d [AP]M</a>`).test(page2), 'the invoice does not show "What we sent ✉ <date time>"');
const cp = await s.get(`/admin/invoices/${invId}/sent/${copies[0] && copies[0].id}`);
const cpq = nq(cp.text);
must(cp.status === 200 && cpq.includes('From Porch & Party <hello@porchandparty901.com>') && cpq.includes('To robin.example@example.com') && cpq.includes(payload.html.slice(0, 200)) && cpq.includes('Balloon garland'), 'the "What we sent" page does not show that exact email with from / to');
must(/sandbox="allow-same-origin"/.test(cp.text) && cpq.includes('Open the PDF from that day'), 'the "What we sent" page does not sandbox the email or link the PDF');
const cpPdf = await s.get(`/admin/invoices/${invId}/sent/${copies[0] && copies[0].id}/invoice.pdf`);
must(cpPdf.status === 200 && cpPdf.headers.get('Content-Type') === 'application/pdf', 'the kept PDF does not open');
must((await s.get(`/admin/invoices/${invId}/sent/99999`)).status === 404 && (await s.get(`/admin/invoices/${invId}/sent/${copies[0] && copies[0].id}`, { auth: false })).status !== 200, 'a missing copy is not a 404, or a copy opens signed out');

// ---- 8. Additive migration; no new mail to Valerie's own address -----------------------------
const mig = read('migrations/0024_invoice_sent_copies.sql').replace(/--.*$/gm, '');
const stmts = mig.split(';').map((x) => x.trim()).filter(Boolean);
must(stmts.length === 2 && /^CREATE TABLE IF NOT EXISTS invoice_sent_copies \(/.test(stmts[0]) && /^CREATE INDEX IF NOT EXISTS invoice_sent_copies_invoice ON invoice_sent_copies/.test(stmts[1]), `migration 0024 is not additive only: ${stmts.join(' / ')}`);
for (const f of ['functions/_lib/invoice-view.mjs', 'functions/_lib/sent-copies.mjs', 'migrations/0024_invoice_sent_copies.sql']) must(!read(f).includes('valeriektaylor13'), `${f} names valeriektaylor13`);

if (checks < 80) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: itemized invoices (${errors.length} of ${checks})\n - ${errors.join('\n - ')}`); process.exit(1); }
console.log(`itemized invoices: OK (${checks} checks: paste a list → 5 lines / $400 in 8 variants, Total row ignored, mismatch warned, page runs the server's parser, line breaks kept on save, line note + invoice note on the invoice page, HTML email, text email, PDF and text message in order, one view model, PDF wraps with prices right, What we sent ✉ copy, additive migration)`);
