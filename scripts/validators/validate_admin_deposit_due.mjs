#!/usr/bin/env node
/**
 * "Deposit due by" (owner, 25 Oct 2026; migration 0025, admin.mjs depositDueFromForm, pay-steps.mjs
 * payStepsOf / depositDueDate, notpaid.mjs nextDue). Made-up names only (public repo).
 *
 * Fails when:
 *  1. migration 0025 is not one additive ALTER TABLE ... ADD COLUMN, or an existing invoice does
 *     not read NULL (= due now) after it;
 *  2. the editor lacks a labelled date input "Deposit due by" inside the Other deposit box (shown
 *     only with Other deposit), defaulting to today, with its plain words; the editor script does
 *     not parse;
 *  3. saving does not store a later day; today, a stale past day, or another plan does not store
 *     NULL; a saved past day is lost on a re-save;
 *  4. with a day, any surface still says the deposit is due now: the /admin invoice page, the card,
 *     the HTML email, the plain-text email, the PDF and the text message all say "due by <day>",
 *     and the rest stays due by the due date;
 *  5. with NULL, any surface changes from "Deposit now (holds your date)" / "Deposit · now";
 *  6. Not paid yet (feeds Money, the 7 AM email and reminders) marks an unpaid deposit late (red)
 *     before its day, does not mark it late after, or NULL / a paid deposit changes the old
 *     due-date behaviour.
 * Rule 0: fewer than 40 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const nq = (h) => String(h).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const s = await session();
const A = await mod('functions/_lib/admin.mjs');
const PS = await mod('functions/_lib/pay-steps.mjs');
const N = await mod('functions/_lib/notpaid.mjs');
const E = await mod('functions/_lib/email.mjs');
const PDF = await mod('functions/_lib/pdf.mjs');
const R = await mod('functions/_lib/reminders.mjs');
const { shortDate } = s.util;
const today = R.chicagoDate();
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const DEP = plus(5); const DUE = plus(12); const PAST = plus(-3);

// ---- 1. Migration -------------------------------------------------------------------------------
const mig = fs.readFileSync(path.join(ROOT, 'migrations/0025_invoice_deposit_due_date.sql'), 'utf8').replace(/--.*$/gm, '').trim();
must(/^ALTER TABLE invoices ADD COLUMN deposit_due_date TEXT;$/.test(mig), `migration 0025 is not one additive column: ${mig}`);
const party = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', party_guests: 'Just the two of us', party_budget: '$300–$500', party_takedown: 'no', event_date: plus(20), location: 'Memphis', name: 'Dee Example', phone: '901-555-0795', email: 'dee.example@example.com' });
const auto = party.row ? await s.one('SELECT * FROM invoices WHERE request_key = ?1', party.row.request_key) : null;
must(auto && auto.deposit_due_date === null, `an invoice made as before does not read NULL: ${auto && auto.deposit_due_date}`);

// ---- 3a. The save rule ------------------------------------------------------------------------
must(A.depositDueFromForm('custom', DEP, { today }) === DEP, 'a later day is not kept');
must(A.depositDueFromForm('custom', today, { today }) === null, 'today (the default) is not NULL = due now');
must(A.depositDueFromForm('custom', PAST, { today }) === null, 'a stale past day from an old form is stored');
must(A.depositDueFromForm('custom', PAST, { today, saved: PAST }) === PAST, 'a saved past day is lost on a re-save');
must(A.depositDueFromForm('half', DEP, { today }) === null && A.depositDueFromForm('full', DEP, { today }) === null && A.depositDueFromForm('none', DEP, { today }) === null, 'a plan other than Other deposit stores a deposit day');
must(A.depositDueFromForm('custom', 'soon', { today }) === null && A.depositDueFromForm('custom', '', { today }) === null, 'a non-date is stored');

// ---- 3b. Through the editor's save ------------------------------------------------------------
const form = (over) => ({ customer_name: 'Dee Example', customer_email: 'dee.example@example.com', customer_phone: '901-555-0795', issue_date: today, due_date: DUE, pay_plan: 'custom', deposit: '100.00', deposit_due_date: DEP, notes: '', go: 'save',
  line_desc: ['Party decor: Birthday'], line_qty: ['1'], line_price: ['300.00'], line_note: [''], line_refundable: ['0'], line_auto: [''], ...over });
const created = await s.post('/admin/invoices', form({}));
const id = Number((created.location.match(/\/admin\/invoices\/(\d+)/) || [])[1]);
must(created.status === 303 && id > 0, `saving the invoice answered ${created.status} ${created.location}`);
let inv = await s.one('SELECT * FROM invoices WHERE id = ?1', id);
must(inv && inv.deposit_due_date === DEP && inv.deposit_due_cents === 10000 && inv.pay_plan === 'custom', `the saved invoice is ${JSON.stringify(inv && { d: inv.deposit_due_date, c: inv.deposit_due_cents, p: inv.pay_plan })}`);

// ---- 2. The editor ------------------------------------------------------------------------------
const ed = (await s.get(`/admin/invoices/${id}/edit`)).text;
const wrap = (ed.match(/<div id="custom-wrap"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || '';
must(/<label for="ddd"><span[^>]*>Deposit due by<\/span><\/label><input id="ddd" name="deposit_due_date" type="date"/.test(wrap), 'the Other deposit box has no labelled "Deposit due by" date input');
must(wrap.includes(`value="${DEP}"`) && wrap.includes(`The deposit is due by ${shortDate(DEP)}.`), 'the editor does not show the saved deposit day in the input and in words');
must(new RegExp(`min="${today}"`).test(wrap), 'the date input lets her pick a day before today');
must(/<div id="custom-wrap">/.test(ed), 'the Other deposit box is not open on an Other deposit invoice');
const edHalf = (await s.get(`/admin/invoices/${auto.id}/edit`)).text;
const wrapHalf = (edHalf.match(/<div id="custom-wrap"[^>]*>/) || [''])[0];
must(/hidden/.test(wrapHalf) && edHalf.includes(`value="${today}"`) && edHalf.includes('Today means the deposit is due now.'), 'on a Half now invoice the deposit day is not hidden, defaulting to today with "due now" words');
const script = (ed.match(/<script>([\s\S]*?)<\/script>/g) || []).map((x) => x.slice(8, -9)).find((x) => x.includes('dd2Val')) || '';
let parses = true; try { new vm.Script(script); } catch { parses = false; }
must(script && parses && script.includes("'Deposit · '+(dv?'by '+day(dv):'now')+' · holds the date'"), 'the editor script does not parse or does not word the live deposit step by its day');

// ---- 4. Every surface says the day ------------------------------------------------------------
const lines = await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id', id);
const day = shortDate(DEP); const dueDay = shortDate(DUE);
const surfaces = async (invoice) => {
  const page = nq((await s.get(`/admin/invoices/${invoice.id}`)).text);
  const mail = E.renderInvoiceEmail({ invoice, lines, settings: {}, contact: {}, qrSrc: null });
  const sms = PDF.textMessage({ invoice, lines, settings: { zelle: '901-555-0100' } });
  const raw = Buffer.from(await PDF.renderInvoicePdf({ invoice, lines, settings: {}, contact: {} })).toString('latin1');
  const items = []; for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) { let t = ''; try { t = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; } for (const x of t.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) items.push(Buffer.from(x[1], 'hex').toString('latin1')); }
  return { page, html: nq(mail.html), text: mail.text, sms, pdf: items.join(' '), pdfN: items.length };
};
const ps = PS.payStepsOf(inv, lines);
must(ps.steps[0].when === `by ${day}` && ps.steps[1].when === `by ${dueDay}` && ps.depositDueDate === DEP, `the view model says ${JSON.stringify(ps.steps.map((x) => x.when))}`);
must(PS.customerSteps(ps).rows[0].words === `Deposit, due by ${day} (holds your date)` && PS.customerSteps(ps).rows[1].words === `The rest, by ${dueDay}`, `the customer words are ${JSON.stringify(PS.customerSteps(ps).rows.map((r) => r.words))}`);
must(PS.payStepsLine(ps).includes(`① Deposit · by ${day} · holds the date $100`), `the one-line words are ${PS.payStepsLine(ps)}`);
let sf = await surfaces(inv);
must(sf.pdfN > 10, `Rule 0: the PDF decoder read only ${sf.pdfN} items`);
must(sf.page.includes(`Deposit · by ${day} · holds the date`) && !sf.page.includes('Deposit · now'), 'the /admin invoice page does not say the deposit day');
must(sf.html.includes(`Deposit, due by ${day} (holds your date)`) && !sf.html.includes('Deposit now'), 'the HTML email does not say the deposit day');
must(sf.text.includes(`① Deposit, due by ${day} (holds your date): $100.00`) && sf.text.includes(`② The rest, by ${dueDay}: $200.00`), `the plain-text email does not say the deposit day:\n${sf.text}`);
must(sf.sms.includes(`Deposit, due by ${day} (holds your date)`) && sf.sms.includes(`The rest, by ${dueDay}`), `the text message does not say the deposit day:\n${sf.sms}`);
must(sf.pdf.includes(`Deposit, due by ${day}`) && !sf.pdf.includes('Deposit now'), `the PDF does not say the deposit day: ${sf.pdf.slice(0, 400)}`);
must(sf.page.includes(`Deposit, due by ${day} (holds your date)`), "the invoice page's text message copy does not say the deposit day");

// The card's "Wait for the deposit" box, once sent.
await s.db.prepare("UPDATE invoices SET status = 'sent', sent_at = datetime('now') WHERE id = ?1").bind(id).run();
await s.db.prepare(`INSERT INTO request_status (request_key, status, invoice_id, updated_at) VALUES (?1, 'invoiced', ?2, datetime('now'))
  ON CONFLICT(request_key) DO UPDATE SET invoice_id = ?2, status = 'invoiced'`).bind(party.row.request_key, id).run();
const home = nq((await s.get('/admin/')).text);
must(home.includes(`deposit comes in. It is due by ${day}.`), 'the card does not say when the deposit is due');

// ---- 6. Not paid yet: never late before the day ------------------------------------------------
const rowOf = async (t) => (await N.notPaidYet(s.db, [], t)).owed.find((r) => r.id === id);
let row = await rowOf(today);
must(row && row.due === DEP && row.tone !== 'late' && row.words === `Deposit due ${new Date(`${DEP}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}`, `before the deposit day the row reads ${JSON.stringify(row && { due: row.due, tone: row.tone, words: row.words })}`);
row = await rowOf(plus(4));
must(row && row.tone === 'soon' && row.words === 'Deposit due tomorrow', `the day before, the row reads ${JSON.stringify(row && { tone: row.tone, words: row.words })}`);
row = await rowOf(plus(7));
must(row && row.tone === 'late' && row.words === 'Deposit 2 days late' && row.due === DEP, `after the deposit day the row reads ${JSON.stringify(row && { tone: row.tone, words: row.words })}`);
const np = await N.notPaidYet(s.db, [], today);
must(N.nextDue({ ...inv, deposit_due_date: null }, 0, plus(7)).due === DUE && N.nextDue({ ...inv, deposit_due_date: null }, 0, plus(7)).tone === '' && !N.nextDue({ ...inv, deposit_due_date: null }, 0, plus(7)).depositNext, 'NULL changed the old due-date behaviour');
must(N.nextDue(inv, 10000, plus(7)).due === DUE && N.nextDue(inv, 10000, plus(7)).tone === '', 'a paid deposit still reads late by its deposit day');
must(N.nextDue({ ...inv, pay_plan: 'half' }, 0, plus(7)).due === DUE, 'a Half now invoice with a stray day reads it');
must(np.count >= 1, 'Rule 0: Not paid yet listed nothing');

// ---- 3c / 5. Back to today: NULL, and every surface as before ----------------------------------
await s.db.prepare("UPDATE invoices SET status = 'draft', sent_at = NULL WHERE id = ?1").bind(id).run();
await s.post(`/admin/invoices/${id}`, form({ deposit_due_date: today }));
inv = await s.one('SELECT * FROM invoices WHERE id = ?1', id);
must(inv.deposit_due_date === null, `saving today did not store NULL: ${inv.deposit_due_date}`);
sf = await surfaces(inv);
must(sf.page.includes('Deposit · now · holds the date') && !sf.page.includes(`by ${day} · holds`), 'NULL: the invoice page changed from "Deposit · now"');
must(sf.html.includes('Deposit now (holds your date)') && sf.text.includes('① Deposit now (holds your date): $100.00') && sf.sms.includes('Deposit now (holds your date)') && sf.pdf.includes('Deposit now'), 'NULL: an email, the PDF or the text changed from "Deposit now (holds your date)"');
await s.post(`/admin/invoices/${id}`, form({ deposit_due_date: DEP, pay_plan: 'half' }));
must((await s.one('SELECT deposit_due_date FROM invoices WHERE id = ?1', id)).deposit_due_date === null, 'Half now stored a deposit day');
// A saved past day survives a re-save (the deposit is late, it stays late).
await s.db.prepare("UPDATE invoices SET pay_plan = 'custom', deposit_due_date = ?2 WHERE id = ?1").bind(id, PAST).run();
const edPast = (await s.get(`/admin/invoices/${id}/edit`)).text;
must(edPast.includes(`value="${PAST}"`) && edPast.includes(`min="${PAST}"`) && edPast.includes(`data-saved="${PAST}"`), 'a saved past day is not shown (or cannot be submitted) in the editor');
await s.post(`/admin/invoices/${id}`, form({ deposit_due_date: PAST }));
must((await s.one('SELECT deposit_due_date FROM invoices WHERE id = ?1', id)).deposit_due_date === PAST, 'a saved past day was lost on a re-save');
must(!s.env.sent.some((m) => /invoice/i.test(String(m.subject || ''))), 'an invoice email went out');

if (checks < 40) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`Deposit due by FAILED (${errors.length}):\n - ${errors.join('\n - ')}`); process.exit(1); }
console.log(`Deposit due by OK: ${checks} checks; additive column (NULL = due now); picker in Other deposit only, default today; the day on the invoice page, card, HTML + text email, PDF and text message; Not paid yet never late before it; NULL unchanged.`);
