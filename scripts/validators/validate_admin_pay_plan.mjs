#!/usr/bin/env node
/**
 * The invoice pay plan: half now (default), all now, a typed deposit, or no deposit (owner-approved
 * 20 Oct 2026); a due date; the money said as numbered payments that add up to the total, the SAME
 * words on the invoice page, the email, the PDF and the text ("How Jane pays": ① Deposit · now ·
 * holds the date, ② The rest · by Thu 22 Oct, "$85 + $85 = $170 total"; pay-steps.mjs), the old
 * one-number "due now" band gone; and a preview of the email before sending. This validator renders the editor, the invoice page and the
 * email for each plan and checks the money adds up and the right words appear.
 * Rule 0: zero plans rendered is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Through the admin harness loader: functions/_lib reads data files as JSON modules.
const { mod } = await import(pathToFileURL(path.join(ROOT, 'scripts/validators/lib/admin_harness.mjs')).href);
const util = await mod('functions/_lib/util.mjs');
const views = await mod('functions/_lib/views.mjs');
const email = await mod('functions/_lib/email.mjs');
const pdf = await mod('functions/_lib/pdf.mjs');
const { PDFDocument } = await import('pdf-lib');
// 1x1 PNG so the QR embed path runs.
const QR = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const errors = [];
const must = (cond, msg) => { if (!cond) errors.push(msg); };

const lines = [
  { description: 'Giant Connect Four (1 day)', qty: 1, unit_cents: 4000, note: '', refundable: 0 },
  { description: 'Cornhole (1 day)', qty: 2, unit_cents: 4000, note: '', refundable: 0 },
  { description: 'Damage deposit (refundable)', qty: 1, unit_cents: 5000, note: '', refundable: 1 },
];
const total = util.invoiceTotal(lines);
must(total === 17000, `fixture total is ${total}, expected 17000`);
must(util.amountDueNow('half', total) === 8500, 'half plan is not half the total');
must(util.amountDueNow('full', total) === 17000, 'full plan is not the whole total');
must(util.amountDueNow('custom', total, 3000) === 3000, 'custom plan ignores the typed deposit');
must(util.amountDueNow('custom', total, 99999) === total, 'custom deposit can exceed the total');
must(util.payPlanOf({ deposit_due_cents: 17000 }, total) === 'full', 'an old row paid in full is not read as full');
must(util.payPlanOf({ deposit_due_cents: 8500 }, total) === 'half', 'an old half-deposit row is not read as half');
must(util.payPlanOf({ deposit_due_cents: 3000 }, total) === 'custom', 'an old custom row is not read as custom');
must(util.payPlanOf({ pay_plan: 'full', deposit_due_cents: 0 }, total) === 'full', 'a stored pay_plan is ignored');
must(util.PAY_PLANS.join(',') === 'half,full,custom,none', `the plans are ${util.PAY_PLANS.join(',')}, not half,full,custom,none`);
must(util.amountDueNow('none', total, 3000) === 0, 'No deposit asks for something now');
must(util.payPlanOf({ pay_plan: 'none', deposit_due_cents: 0 }, total) === 'none', 'a stored No deposit plan is not read back');
must(util.payPlanOf({ deposit_due_cents: 0 }, total) === 'custom', 'an old row with no plan and $0 now is no longer read as custom (existing invoices must keep their plan)');
must(util.singlePayment('full') && util.singlePayment('none') && !util.singlePayment('half') && !util.singlePayment('custom'), 'singlePayment is wrong');

const settings = { zelle: 'hello@porchandparty901.com', cashapp: '$porchandparty', business_name: 'Porch & Party', business_address: '', qr_png: QR, qr_type: 'image/png' };
const plans = { half: 8500, full: 17000, custom: 3000, none: 0 };
const nq = (h) => h.replace(/&amp;/g, '&').replace(/&#39;/g, "'");
let rendered = 0;
for (const [plan, now] of Object.entries(plans)) {
  const invoice = { id: 7, number: 'PNP-2026-0007', customer_name: 'Jane Doe', customer_email: 'jane@example.com', customer_phone: '',
    issue_date: '2026-10-15', due_date: '2026-10-22', deposit_due_cents: now, pay_plan: plan, notes: '', status: 'sent' };
  const mail = email.renderInvoiceEmail({ invoice, lines, settings, contact: { phone: '' }, qrSrc: null });
  const editor = views.invoiceEditorPage({ invoice, lines, request: null, action: '/admin/invoices/7', title: 't', pay: { complete: true, missing: [] }, mode: 'edit' });
  const page = views.invoiceViewPage({ invoice, lines, pay: { complete: true, missing: [] }, flash: '', error: '', emailHtml: mail.html });
  const draft = views.invoiceViewPage({ invoice: { ...invoice, status: 'draft' }, lines, pay: { complete: true, missing: [] }, flash: '', error: '', emailHtml: mail.html });
  must(draft.indexOf('The email the customer gets') < draft.indexOf('Send invoice to'), `${plan}: draft page does not show the email above the Send button`);
  rendered += 1;
  must(mail.text.includes('Total: $170.00'), `${plan}: email text lacks the total`);
  must(mail.text.includes('Due October 22, 2026'), `${plan}: email lacks the due date`);
  // The one-number "due now" band is gone everywhere.
  must(!/Deposit due now|Amount due:/.test(mail.text + mail.html) && !/Deposit asked for now|Rest after the deposit|Full amount due by|class="now"/.test(page) && !/Due now|sum-deposit|Rest after that/.test(editor), `${plan}: the old "due now" band is still on the email, the invoice page or the editor`);
  // The total says what the refundable damage deposit is.
  for (const [where, h] of [['email html', mail.html], ['email text', mail.text], ['invoice page', page], ['editor', editor]]) must(nq(h).includes('$120 rental + $50 refundable damage deposit'), `${plan}: ${where} lacks "$120 rental + $50 refundable damage deposit"`);
  must(mail.html.includes('Given back after the event') && !/>Refundable</.test(mail.html), `${plan}: the email does not say the damage deposit is given back after the event`);
  must(nq(page).includes('How Jane pays') && nq(editor).includes('How Jane pays') && mail.text.includes('How you pay') && mail.html.includes('How you pay'), `${plan}: "How Jane pays" / "How you pay" missing`);
  const stepsOn = (h) => (nq(h).match(/data-pay-step="\d"/g) || []).length;
  if (plan === 'full') {
    must(mail.text.includes('① All of it, now: $170.00') && !mail.text.includes('②'), `${plan}: email should ask for the whole total now, one payment`);
    must(nq(page).includes('All of it · now') && stepsOn(page) === 1 && !page.includes('Mark deposit received'), `${plan}: invoice page should show one payment "All of it · now" and no deposit button`);
    must(page.includes('Mark paid in full') && page.includes('Only do this after the money is in your account.'), `${plan}: Payment box lacks Mark paid in full with its confirmation`);
  } else if (plan === 'none') {
    must(mail.text.includes('Nothing to pay now.') && mail.text.includes('① All of it, by Thu 22 Oct: $170.00') && !mail.text.includes('②'), `${plan}: email does not say "Nothing to pay now." and "① All of it, by Thu 22 Oct"`);
    must(nq(page).includes('No deposit. Nothing to pay now.') && nq(page).includes('All of it · by Thu 22 Oct') && stepsOn(page) === 1 && !page.includes('Mark deposit received') && page.includes('Mark paid in full'), `${plan}: invoice page lacks "No deposit. Nothing to pay now." / "All of it · by Thu 22 Oct", or still offers the deposit button`);
    must(nq(mail.html).includes('Nothing to pay now.') && !/\$0\.00/.test(mail.html), `${plan}: the email shows a $0.00 deposit`);
  } else {
    const rest = total - now;
    const sum = `${util.money(now).replace(/\.00$/, '')} + ${util.money(rest).replace(/\.00$/, '')} = $170 total`;
    must(mail.text.includes(`① Deposit now (holds your date): ${util.money(now)}`), `${plan}: email does not ask for the deposit now`);
    must(mail.text.includes(`② The rest, by Thu 22 Oct: ${util.money(rest)}`) && mail.text.includes(sum) && nq(mail.html).includes(sum), `${plan}: email lacks the rest with its due date or "${sum}"`);
    must(nq(page).includes('Deposit · now · holds the date') && nq(page).includes('The rest · by Thu 22 Oct') && stepsOn(page) === 2 && nq(page).includes(sum) && page.includes(util.money(rest)) && page.includes('Mark deposit received') && page.includes(`Mark Jane Doe&#39;s deposit as received? Only do this after the money is in your account.`), `${plan}: invoice page lacks ① Deposit / ② The rest / the sum, or the deposit button with its confirmation`);
  }
  must(page.includes('srcdoc=') && page.includes('The email the customer gets'), `${plan}: invoice page has no inline email preview`);
  must(nq(editor).includes('What Jane is paying for'), `${plan}: no "What Jane is paying for" section`);
  must(editor.includes(`value="${plan}" checked`), `${plan}: editor does not preselect the stored plan`);
  must(editor.includes('name="due_date"') && editor.includes('value="preview"') && editor.includes('See it before sending'), `${plan}: editor lacks due date or the preview button`);
  for (const v of ['half', 'full', 'custom', 'none']) must(editor.includes(`name="pay_plan" value="${v}"`), `${plan}: editor lacks the ${v} choice`);
  // Grey live amounts under each plan (the editor's JS keeps them current; these are the first paint).
  for (const [id, words] of [['plan-amt-half', '$85 now · $85 by the due date'], ['plan-amt-full', '$170 now'], ['plan-amt-none', 'Nothing now · all $170 by the due date']]) must(nq(editor).includes(`id="${id}">${words}<`), `${plan}: editor lacks the grey "${words}" under its plan`);
  must(/<strong>No deposit<\/strong>/.test(editor) && editor.indexOf('value="custom"') < editor.indexOf('value="none"'), `${plan}: "No deposit" is not the fourth choice`);

  // The PDF for customers reached by text, and the buttons that share it.
  const bytes = await pdf.renderInvoicePdf({ invoice, lines, settings, contact: { telephoneDisplay: '901-355-1518' } });
  must(bytes.length > 1500 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-', `${plan}: invoice.pdf is not a PDF`);
  const loadedPdf = await PDFDocument.load(bytes);
  must(loadedPdf.getPageCount() === 1 && loadedPdf.getTitle() === 'Invoice PNP-2026-0007 from Porch & Party', `${plan}: PDF is not one titled page`);
  const sms = pdf.textMessage({ invoice, lines, settings });
  must(sms.includes('PNP-2026-0007') && sms.includes('$170.00') && sms.includes('How you pay: ') && (plan === 'full' ? sms.includes('① All of it, now: $170.00') : (plan === 'none' ? sms.includes('Nothing to pay now. ① All of it, by Thu 22 Oct: $170.00') : sms.includes(`① Deposit now (holds your date): ${util.money(now)}`))), `${plan}: text message lacks the number, total or the numbered payments`);
  const pl = pdf.payLines({ invoice, lines });
  must(pl.rows.length === (plan === 'full' || plan === 'none' ? 1 : 2) && pl.rows.reduce((t, r) => t + r.cents, 0) === total && pl.totalWords === '$120 rental + $50 refundable damage deposit', `${plan}: the PDF's How you pay rows do not add up to the total`);
  must(page.includes('Text the invoice (PDF)') && page.includes('/invoice.pdf') && page.includes('data-copy="sms"'), `${plan}: invoice page lacks the text/PDF buttons or the copyable message`);
  const noEmail = views.invoiceViewPage({ invoice: { ...invoice, status: 'draft', customer_email: '' }, lines, pay: { complete: true, missing: [] }, flash: '', error: '', emailHtml: mail.html, smsText: sms });
  must(noEmail.includes('btn primary" data-share-pdf') && noEmail.includes('value="texted"') && !noEmail.includes('Send invoice to'), `${plan}: a draft with no email should lead with Text the invoice (PDF) and Mark as sent by text`);
}
must(rendered === 4, 'fewer than four plans rendered');

// Rentals v3 (2026-10-15): a rental invoice says where and how the rest is paid, in every
// surface the customer sees; a decor-only invoice does not. admin.mjs passes the line from
// invoice-note.mjs pickupNote() to all four, worded from the invoice's own numbers (owner's final
// wording, 19 Oct 2026): $170 with the $50 refundable deposit, half now ($85, the deposit first),
// so the rest is $85, the same rest the pay box states.
const PICKUP = 'Pay the rest ($85.00) at pickup. Text or call 901-355-1518 to set your pickup time at Mt. Moriah Station unless otherwise agreed upon.';
{
  const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  const { buildPriceTable } = await mod('functions/_lib/pricing.mjs');
  const NOTE = await mod('functions/_lib/invoice-note.mjs');
  const table = buildPriceTable(read('data/rentals/games.json'), read('data/offers/services.json'), read('data/offers/porch_packages.json'));
  const got = NOTE.pickupNote(lines, table, { invoice: { deposit_due_cents: 8500, pay_plan: 'half', notes: '' }, paidCents: 0 });
  must(got === PICKUP, `the rental note for the fixture reads "${got}"`);
}
{
  const invoice = { id: 8, number: 'PNP-2026-0008', customer_name: 'Jane Doe', customer_email: 'jane@example.com', customer_phone: '',
    issue_date: '2026-10-15', due_date: '2026-10-22', deposit_due_cents: 8500, pay_plan: 'half', notes: '', status: 'sent' };
  for (const [kind, pickup] of [['rental', PICKUP], ['decor', '']]) {
    const mail = email.renderInvoiceEmail({ invoice, lines, settings, contact: { phone: '' }, qrSrc: null, pickup });
    const sms = pdf.textMessage({ invoice, lines, settings, pickup });
    const page = views.invoiceViewPage({ invoice, lines, pay: { complete: true, missing: [] }, flash: '', error: '', emailHtml: mail.html, smsText: sms, pickup });
    const pay = pdf.payLines({ invoice, lines, pickup });
    const has = { 'email html': mail.html.includes(PICKUP), 'email text': mail.text.includes(PICKUP), 'text message': sms.includes(PICKUP),
      'invoice page': page.includes(PICKUP.replace(/\./g, '.')), 'PDF pay box': pay.pickup === PICKUP };
    for (const [where, yes] of Object.entries(has)) must(yes === (kind === 'rental'), `${kind} invoice: ${where} ${yes ? 'carries' : 'lacks'} the pickup line`);
    must(mail.text.includes('② The rest, by Thu 22 Oct: $85.00'), `${kind} invoice: "② The rest, by Thu 22 Oct" wording changed`);
  }
  must(/pickupRows/.test(fs.readFileSync(path.join(ROOT, 'functions/_lib/pdf.mjs'), 'utf8')), 'pdf.mjs no longer draws the pickup line in the pay box');
  const adminSrc = fs.readFileSync(path.join(ROOT, 'functions/_lib/admin.mjs'), 'utf8');
  must((adminSrc.match(/await noteFor\(env, /g) || []).length >= 3 && /pickup: await noteFor\(env, invoice, lines\)/.test(adminSrc) && /textMessage\(\{[^}]*pickup \}\)/.test(adminSrc) && /invoiceViewPage\(\{[^}]*pickup,/.test(adminSrc) && !/pickupLine/.test(adminSrc),
    'admin.mjs does not pass the pickup line to the email, PDF, text message and invoice page');
}

const migration = path.join(ROOT, 'migrations/0003_pay_plan.sql');
must(fs.existsSync(migration) && /ADD COLUMN pay_plan/.test(fs.readFileSync(migration, 'utf8')), 'migration 0003 does not add pay_plan');
const admin = fs.readFileSync(path.join(ROOT, 'functions/_lib/admin.mjs'), 'utf8');
must(/INSERT INTO invoices \([^)]*pay_plan/.test(admin) && /pay_plan=\?\d/.test(admin), 'admin.mjs does not store pay_plan on create and update');
must(/segs\[2\] === 'invoice\.pdf'/.test(admin) && /texted: 'sent'/.test(admin), 'admin.mjs does not serve invoice.pdf or accept the texted status');

if (errors.length) { console.error(`validate_admin_pay_plan: FAIL\n - ${errors.join('\n - ')}`); process.exit(1); }
console.log(`validate_admin_pay_plan: OK (${rendered} plans rendered: email, editor, invoice page, PDF and text message checked)`);
