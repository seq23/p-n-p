#!/usr/bin/env node
/**
 * The invoice pay plan: half now (default), full amount, or a typed deposit; a due date;
 * a calculation that shows total, deposit asked for now and the rest; and a preview of
 * the email before sending. This validator renders the editor, the invoice page and the
 * email for each plan and checks the money adds up and the right words appear.
 * Rule 0: zero plans rendered is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const util = await mod('functions/_lib/util.mjs');
const views = await mod('functions/_lib/views.mjs');
const email = await mod('functions/_lib/email.mjs');
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

const settings = { zelle: 'hello@porchandparty901.com', cashapp: '$porchandparty', business_name: 'Porch & Party', business_address: '' };
const plans = { half: 8500, full: 17000, custom: 3000 };
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
  if (plan === 'full') {
    must(mail.text.includes('Amount due: $170.00') && !/Deposit due now/.test(mail.text), `${plan}: email should ask for the whole total, no deposit`);
    must(page.includes('Full amount due by') && !page.includes('Deposit received'), `${plan}: invoice page still shows deposit rows or the deposit button`);
  } else {
    const rest = total - now;
    must(mail.text.includes(`Deposit due now: ${util.money(now)}`), `${plan}: email does not ask for the deposit now`);
    must(mail.text.includes(`The rest, ${util.money(rest)}, is due by October 22, 2026`), `${plan}: email lacks total minus deposit with its due date`);
    must(page.includes('Rest after the deposit') && page.includes(util.money(rest)) && page.includes('Deposit received'), `${plan}: invoice page lacks the rest-after-deposit row or the deposit button`);
  }
  must(page.includes('srcdoc=') && page.includes('The email the customer gets'), `${plan}: invoice page has no inline email preview`);
  must(page.includes('What goes into the total') || editor.includes('What goes into the total'), `${plan}: no "what goes into the total" section`);
  must(editor.includes(`value="${plan}" checked`), `${plan}: editor does not preselect the stored plan`);
  must(editor.includes('name="due_date"') && editor.includes('value="preview"') && editor.includes('See it before sending'), `${plan}: editor lacks due date or the preview button`);
  for (const v of ['half', 'full', 'custom']) must(editor.includes(`name="pay_plan" value="${v}"`), `${plan}: editor lacks the ${v} choice`);
}
must(rendered === 3, 'fewer than three plans rendered');

const migration = path.join(ROOT, 'migrations/0003_pay_plan.sql');
must(fs.existsSync(migration) && /ADD COLUMN pay_plan/.test(fs.readFileSync(migration, 'utf8')), 'migration 0003 does not add pay_plan');
const admin = fs.readFileSync(path.join(ROOT, 'functions/_lib/admin.mjs'), 'utf8');
must(/INSERT INTO invoices \([^)]*pay_plan/.test(admin) && /pay_plan=\?\d/.test(admin), 'admin.mjs does not store pay_plan on create and update');

if (errors.length) { console.error(`validate_admin_pay_plan: FAIL\n - ${errors.join('\n - ')}`); process.exit(1); }
console.log(`validate_admin_pay_plan: OK (${rendered} plans rendered, email + editor + invoice page checked)`);
