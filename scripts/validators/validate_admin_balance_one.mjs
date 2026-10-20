#!/usr/bin/env node
/**
 * One balance everywhere (20 Oct 2026; functions/_lib/ledger.mjs balanceOf is the one source of
 * "paid / still owed / the rest"; pay-steps.mjs payStepsOf and invoice-note.mjs rentalNote read
 * it). Renders EVERY surface through the real router and renderers for a matrix of rental
 * invoices and fails when any surface disagrees with the truth (total - paid) or with another:
 *
 *   page    the invoice page: "How <name> pays" steps + "Still owed", the balance line, the
 *           rental note (online wording)
 *   email   the customer email (preview on the page, and as sent): steps, "Still owed", note
 *   text    the text message that goes with the PDF
 *   pdf     the PDF's pay box words (pdf.mjs payLines) and the PDF route itself
 *   card    the request card's Payment box words and its numbered box
 *   money   the Money tab job row (Total - Paid = Still owed, deposits left out and counted) and
 *           Not paid yet
 *   todo    the 7 AM to-do email: today's pickup "collect $X" and the Money line
 *   day     the Day sheet's "Collect at pickup: $X"
 *
 * Cases: deposit paid (the bug: rental charges paid, damage deposit not -> "Paid in full"), the
 * website's damage deposit + 50% paid, part paid (less than the damage deposit), paid in full,
 * no damage deposit (half paid / paid in full), deposit smaller than the damage deposit (unpaid
 * and paid), No deposit, All now (unpaid and paid), paid more than the deposit.
 * Rules: nobody who has paid less than the total is told "Paid in full" anywhere; every number
 * still owed is total - paid; the rental note's rest is step ② (or "Still owed" once more than the
 * deposit is in) and adds up, the damage deposit said in words inside the sum.
 * Rule 0: fewer than 300 checks is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const s = await session();
const L = await mod('functions/_lib/ledger.mjs');
const PS = await mod('functions/_lib/pay-steps.mjs');
const PDF = await mod('functions/_lib/pdf.mjs');
const TODO = await mod('functions/_lib/todo-email.mjs');
const { chicagoDate } = await mod('functions/_lib/reminders.mjs');
const { todayISO } = s.util;
const today = chicagoDate();
const nq = (h) => String(h).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const usd = (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dol = (c) => usd(c).replace(/\.00$/, '');
const cardOf = (html, key) => { const i = html.indexOf(`id="c-${s.rk(key)}"`); return i < 0 ? '' : html.slice(html.lastIndexOf('<article', i), html.indexOf('</article>', i)); };
const tag = (html, attr) => { const m = html.match(new RegExp(`<[^>]*${attr}[^>]*>([^<]*)`)); return m ? m[1] : ''; };

// [label, first name, rental charges, damage deposit (0 = none), plan, deposit asked, paid]
const CASES = [
  ['deposit paid (charges covered, damage deposit not)', 'Abe', 8000, 2000, 'custom', 8000, 8000],
  ['website deposit (damage deposit + 50%) paid', 'Bea', 10000, 5000, 'custom', 10000, 10000],
  ['part paid, less than the damage deposit', 'Cal', 10000, 5000, 'custom', 7500, 3000],
  ['paid in full with a damage deposit', 'Dot', 10000, 5000, 'custom', 7500, 15000],
  ['no damage deposit, half paid', 'Eli', 20000, 0, 'half', 10000, 10000],
  ['no damage deposit, paid in full', 'Fay', 20000, 0, 'half', 10000, 20000],
  ['deposit smaller than the damage deposit, nothing paid', 'Gus', 10000, 5000, 'custom', 3000, 0],
  ['deposit smaller than the damage deposit, deposit paid', 'Hal', 10000, 5000, 'custom', 3000, 3000],
  ['No deposit, nothing paid', 'Ivy', 10000, 5000, 'none', 0, 0],
  ['All now, nothing paid', 'Jo', 13000, 5000, 'full', 18000, 0],
  ['All now, paid', 'Kit', 13000, 5000, 'full', 18000, 18000],
  ['paid more than the deposit, not all', 'Lu', 10000, 5000, 'custom', 6000, 9000],
];

const made = [];
let n = 0;
for (const [label, first, charges, dmg, plan, ask, paid] of CASES) {
  n += 1;
  const email = `${first.toLowerCase()}.balance@example.com`;
  const req = await s.siteRequest({ service: 'rentals', games: ['giant-uno'], duration: 'day', rental_date: todayISO(20 + n * 3), pickup_when: 'morning', return_when: 'after', name: `${first} Balancecase`, phone: `901-555-07${String(n).padStart(2, '0')}`, email });
  must(req.status === 303 && req.row, `${label}: the rental request did not go through`);
  if (!req.row) continue;
  const key = req.row.request_key;
  const inv = await s.one('SELECT * FROM invoices WHERE request_key = ?1', key);
  must(Boolean(inv), `${label}: no draft invoice`);
  if (!inv) continue;
  const ls = await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id', inv.id);
  const rental = ls.find((l) => !l.refundable);
  const dep = ls.find((l) => l.refundable);
  await s.db.prepare('UPDATE invoice_lines SET unit_cents = ?2, qty = 1 WHERE id = ?1').bind(rental.id, charges).run();
  await s.db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?1 AND id NOT IN (?2, ?3)').bind(inv.id, rental.id, dep ? dep.id : 0).run();
  if (dep && dmg) await s.db.prepare('UPDATE invoice_lines SET unit_cents = ?2, qty = 1 WHERE id = ?1').bind(dep.id, dmg).run();
  else if (dep) await s.db.prepare('DELETE FROM invoice_lines WHERE id = ?1').bind(dep.id).run();
  await s.db.prepare("UPDATE invoices SET status = 'sent', sent_at = datetime('now'), pay_plan = ?2, deposit_due_cents = ?3, due_date = ?4, notes = '' WHERE id = ?1").bind(inv.id, plan, ask, today).run();
  await s.db.prepare("INSERT INTO request_status (request_key, status, invoice_id) VALUES (?1, 'invoiced', ?2) ON CONFLICT(request_key) DO UPDATE SET status = 'invoiced', invoice_id = ?2").bind(key, inv.id).run();
  if (paid) await s.db.prepare("INSERT INTO payments (invoice_id, amount_cents, received_on, method, note, kind) VALUES (?1, ?2, ?3, 'zelle', '', 'payment')").bind(inv.id, paid, today).run();
  await L.syncMoneyStatus(s.db, inv.id);
  // Booked ("Yes, book it"), so Money lists it as a job with Total / Paid / Still owed.
  await s.db.prepare("INSERT INTO request_steps (request_key, called_at, confirmed_at, how) VALUES (?1, datetime('now'), datetime('now'), 'call') ON CONFLICT(request_key) DO UPDATE SET confirmed_at = datetime('now')").bind(key).run();
  // Today's pickup, so the Day sheet and the 7 AM email carry it.
  await s.db.prepare("UPDATE bookings SET date = ?2 WHERE request_key = ?1 AND kind = 'rental_pickup'").bind(key, today).run();
  await s.db.prepare("DELETE FROM holds WHERE request_key = ?1").bind(key).run();
  const total = charges + dmg;
  const now = plan === 'full' ? total : (plan === 'none' ? 0 : ask);
  const rest = total - Math.max(paid, now);
  made.push({ label, first, key, id: inv.id, number: inv.number, total, charges, dmg, plan, now, paid, owed: Math.max(0, total - paid), rest, restDep: Math.min(rest, Math.max(0, dmg - Math.max(paid, now))) });
}
must(made.length === CASES.length, `only ${made.length} of ${CASES.length} cases were set up`);

// Every surface's claim per invoice: { paidInFull, owed } (owed = what it says is still to pay).
const dash = nq((await s.get('/admin/')).text);
const moneyOut = nq((await s.get('/admin/money?view=all')).text);
const moneyIn = nq((await s.get('/admin/money?view=all&deposits=in')).text);
const day = nq((await s.get(`/admin/day/${today}`)).text);
const todo = TODO.renderTodo(await TODO.todoData(s.db, today));
const todoLines = todo.text.split('\n');
const settings = {};

for (const c of made) {
  const L_ = `${c.label} (${c.first})`;
  const claims = {};
  const restWords = c.restDep > 0 ? (c.rest - c.restDep > 0 ? `${usd(c.rest - c.restDep)} + ${usd(c.restDep)} refundable deposit = ${usd(c.rest)}` : `${usd(c.rest)} refundable deposit`) : usd(c.rest);
  const dueWords = c.owed <= 0 ? '' : (c.dmg > 0 && Math.max(0, c.dmg - c.paid) > 0 ? `${dol(c.owed)} due (${dol(c.owed - Math.max(0, c.dmg - c.paid))} + ${dol(Math.max(0, c.dmg - c.paid))} refundable deposit)`.replace('($0 + ', '(') : `${dol(c.owed)} due`);

  // page
  const raw = (await s.get(`/admin/invoices/${c.id}`)).text;
  const page = nq(raw);
  const box = page.slice(page.indexOf('data-pay-steps'), page.indexOf('</section>', page.indexOf('data-pay-steps')));
  const stepCents = [...box.matchAll(/data-pay-step="\d"[^>]*>.*?<strong>\$([\d,.]+)<\/strong>/g)].map((m) => Math.round(Number(m[1].replace(/,/g, '')) * 100));
  must(stepCents.reduce((a, b) => a + b, 0) === c.total, `${L_}: page steps ${JSON.stringify(stepCents)} do not add up to ${c.total}`);
  const pageOwed = (box.match(/data-still-owed>Still owed \$([\d,.]+)/) || [])[1];
  claims.pageBox = { owed: pageOwed ? Math.round(Number(pageOwed.replace(/,/g, '')) * 100) : (c.paid > 0 ? 0 : c.total), paidInFull: !pageOwed && c.paid >= c.total };
  const allPaidSteps = (box.match(/data-step-paid/g) || []).length === stepCents.length;
  must(allPaidSteps === (c.owed === 0), `${L_}: page steps say ${allPaidSteps ? 'all paid' : 'not all paid'} with ${c.owed} still owed`);
  const balLine = (page.match(/Paid in full ✓|\$[\d,]+(?:\.\d\d)? due[^·<]*/) || [''])[0];
  claims.pageLine = { paidInFull: /Paid in full/.test(balLine), owed: /Paid in full/.test(balLine) ? 0 : Math.round(Number((balLine.match(/^\$([\d,.]+)/) || [0, 'NaN'])[1].replace(/,/g, '')) * 100) };
  must(balLine.trim() === (c.owed ? dueWords : 'Paid in full ✓'), `${L_}: page balance line "${balLine.trim()}" want "${c.owed ? dueWords : 'Paid in full ✓'}"`);
  const note = tag(page, 'data-pickup-line') || (page.match(/(Pay the rest[^<]*|This covers everything[^<]*|Paid in full\. Thank you![^<]*)/) || [''])[0];
  const wantNote = c.owed === 0 ? 'Paid in full. Thank you!' : (c.rest > 0 ? `Pay the rest (${restWords}) at pickup.` : 'This covers everything. Nothing more to pay at pickup.');
  must(note.startsWith(wantNote), `${L_}: page note "${note.slice(0, 90)}" want "${wantNote}"`);
  claims.pageNote = { paidInFull: /Paid in full/.test(note) };
  // email preview (srcdoc) and the sent email
  const src = nq(nq((raw.match(/srcdoc="([^"]*)"/) || [0, ''])[1]));
  const emailOwed = (src.match(/data-still-owed>Still owed \$([\d,.]+)/) || [])[1];
  claims.email = { owed: emailOwed ? Math.round(Number(emailOwed.replace(/,/g, '')) * 100) : (c.paid > 0 ? 0 : c.total), paidInFull: /Paid in full/.test(src) };
  const emailNote = (src.match(/data-pickup-line>([^<]*)/) || [0, ''])[1];
  const wantMailNote = c.rest > 0 ? `Pay the rest (${restWords}) at pickup.` : 'This covers everything. Nothing more to pay at pickup.';
  must(emailNote.startsWith(wantMailNote), `${L_}: email note "${emailNote.slice(0, 90)}" want "${wantMailNote}"`);
  must((src.match(/data-step-paid/g) || []).length === stepCents.filter((_, i) => c.paid >= stepCents.slice(0, i + 1).reduce((a, b) => a + b, 0)).length, `${L_}: the email's "✓ paid" steps differ from the page`);
  // text message (the PDF's text)
  const sms = nq((raw.match(/data-text="([^"]*)"/) || [0, ''])[1]);
  const smsOwed = (sms.match(/Still owed \$([\d,.]+)/) || [])[1];
  claims.text = { owed: smsOwed ? Math.round(Number(smsOwed.replace(/,/g, '')) * 100) : (c.paid > 0 ? 0 : c.total), paidInFull: /Paid in full/.test(sms) && !/Pay the rest/.test(sms) };
  must(sms.includes(c.owed === 0 ? 'Paid in full. Thank you!' : (c.rest > 0 ? `Pay the rest (${restWords})` : 'This covers everything')), `${L_}: text message note wrong: "${sms.slice(-260)}"`);
  // PDF: the route renders, and its pay box words (same inputs the route passes)
  const pdfRes = await s.get(`/admin/invoices/${c.id}/invoice.pdf`);
  must(pdfRes.status === 200, `${L_}: the PDF does not render`);
  const invRow = await s.one('SELECT * FROM invoices WHERE id = ?1', c.id);
  const invLines = await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id', c.id);
  const pl = PDF.payLines({ invoice: invRow, lines: invLines, paid: c.paid, payments: [{ cents: c.paid, on: today }] });
  claims.pdf = { owed: pl.owed ? Math.round(Number(pl.owed.replace(/[^\d.]/g, '')) * 100) : (c.paid > 0 ? 0 : c.total), paidInFull: false };
  must(pl.rows.reduce((a, r) => a + r.cents, 0) === c.total, `${L_}: PDF steps do not add up`);
  // card
  const card = cardOf(dash, c.key);
  must(Boolean(card), `${L_}: no card`);
  const words = tag(card, 'data-pay-words');
  claims.card = { paidInFull: !words && /Paid in full/.test(card) || /Paid in full ✓/.test(words), owed: words ? (() => { const m = words.match(/\$([\d,.]+) due/); return m ? Math.round(Number(m[1].replace(/,/g, '')) * 100) : 0; })() : 0 };
  if (c.owed > 0) must(words.includes(dueWords) && !/Paid in full/.test(words), `${L_}: card Payment box "${words}" want "${dueWords}"`);
  else must(!/data-pay-words>[^<]*due/.test(card), `${L_}: a paid card still says something is due`);
  const cardBoxOwed = (card.match(/data-still-owed>Still owed \$([\d,.]+)/) || [])[1];
  if (c.owed > 0 && c.paid > 0) must(cardBoxOwed && Math.round(Number(cardBoxOwed.replace(/,/g, '')) * 100) === c.owed, `${L_}: card "Still owed" ${cardBoxOwed} want ${c.owed}`);
  // Money: job row adds up both ways; Not paid yet lists it iff money is left
  for (const [html, dep] of [[moneyOut, false], [moneyIn, true]]) {
    const i = html.indexOf(`href="/admin/invoices/${c.id}" data-help="mon.jobOpen"`);
    const row = i < 0 ? '' : html.slice(html.lastIndexOf('<li class="job', i), html.indexOf('</li>', i));
    const num = (re) => { const m = row.match(re); return m ? Math.round(Number(m[1].replace(/,/g, '')) * 100) : NaN; };
    const t = num(/data-job-total>\$([\d,.]+)/); const p = num(/<dt>Paid<\/dt><dd[^>]*>\$([\d,.]+)/); const o = num(/<dt>Still owed<\/dt><dd[^>]*>\$([\d,.]+)/);
    must(row && t - p === o, `${L_}: Money row (deposits ${dep ? 'in' : 'out'}) ${t} - ${p} != ${o}`);
    if (dep) { must(t === c.total && o === c.owed, `${L_}: Money row with deposits counted ${t}/${o} want ${c.total}/${c.owed}`); claims.money = { owed: o, paidInFull: o === 0 }; }
  }
  const np = moneyOut.slice(moneyOut.indexOf('data-not-paid'), moneyOut.indexOf('data-not-paid-total') > 0 ? moneyOut.indexOf('data-not-paid-total') : moneyOut.length);
  const npHit = np.includes(`/admin/invoices/${c.id}"`) || np.includes(c.number);
  must(npHit === (c.owed > 0), `${L_}: Not paid yet ${npHit ? 'lists' : 'leaves out'} an invoice with ${c.owed} still owed`);
  // 7 AM email: today's pickup line and Money line
  const jobLine = todoLines.find((x) => x.includes(`${c.first} B.`) && /games pickup|pickup/.test(x) && !/^- .* · \$/.test(x)) || '';
  const col = (jobLine.match(/collect (\$.*?)\)(?::|$)/) || [0, ''])[1].trim();
  const wantCol = dueWords.replace(' due', '');
  must(col === wantCol, `${L_}: 7 AM pickup line collects "${col}" want "${wantCol}" (${jobLine})`);
  const moneyLine = todoLines.find((x) => x.startsWith(`- ${c.first} B. · $`)) || '';
  must(Boolean(moneyLine) === (c.owed > 0) && (!moneyLine || moneyLine.includes(dueWords)), `${L_}: 7 AM Money line "${moneyLine}" want "${dueWords}"`);
  claims.todo = { owed: col ? Math.round(Number(col.match(/^\$([\d,.]+)/)[1].replace(/,/g, '')) * 100) : 0, paidInFull: !col };
  // Day sheet
  const sheet = day.slice(day.indexOf('data-day-sheet'));
  const dayAt = sheet.indexOf(`Game pickup · ${c.first}</div>`);
  const dayBit = dayAt < 0 ? '' : sheet.slice(dayAt, sheet.indexOf('data-sheet-row', dayAt + 10) > 0 ? sheet.indexOf('data-sheet-row', dayAt + 10) : dayAt + 600);
  must(dayAt >= 0, `${L_}: not on the Day sheet`);
  const collect = (dayBit.match(/data-still-owed>([^<]*)/) || [0, ''])[1].replace(' due', '');
  must(collect === wantCol, `${L_}: Day sheet collect "${collect}" want "${wantCol}"`);
  claims.day = { owed: collect ? Math.round(Number(collect.match(/^\$([\d,.]+)/)[1].replace(/,/g, '')) * 100) : 0, paidInFull: !collect };

  // No two surfaces disagree, and none disagrees with the truth.
  for (const [where, cl] of Object.entries(claims)) {
    if ('owed' in cl) must(cl.owed === c.owed, `${L_}: ${where} says ${cl.owed} still owed, the truth is ${c.owed}`);
    must(!(cl.paidInFull && c.owed > 0), `${L_}: ${where} says "Paid in full" with ${c.owed} still owed`);
  }
  const owedSet = new Set(Object.values(claims).filter((x) => 'owed' in x).map((x) => x.owed));
  must(owedSet.size === 1, `${L_}: surfaces disagree on what is still owed: ${JSON.stringify(Object.fromEntries(Object.entries(claims).map(([k, v]) => [k, v.owed])))}`);
  // The ledger itself (the one source) says the same.
  const bal = L.balanceOf(invRow, invLines, c.paid);
  const ps = PS.payStepsOf(invRow, invLines, { paid: c.paid });
  must(bal.remaining === c.owed && ps.stillOwed === c.owed && bal.paidInFull === (c.owed === 0) && ps.paidInFull === bal.paidInFull && L.dueCents(bal) === c.owed, `${L_}: balanceOf / payStepsOf disagree (${bal.remaining}/${ps.stillOwed}/${bal.paidInFull})`);
  must(bal.owed + bal.depositOwed === bal.remaining && bal.paidCharges + bal.paidDeposit === Math.min(c.paid, c.total), `${L_}: the split does not add up`);
}
void settings;

// The negative must exist: the bug case is in the matrix.
must(made.some((c) => c.paid === c.charges && c.dmg > 0 && c.owed > 0), 'the matrix lost the "charges paid, damage deposit not" case');
if (checks < 300) errors.push(`Rule 0: only ${checks} checks ran (want at least 300)`);
if (errors.length) {
  console.error(`validate_admin_balance_one: FAIL (${errors.length} of ${checks} checks)`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`validate_admin_balance_one: OK (${checks} checks: ${made.length} rental invoices x invoice page, email, text, PDF, card, Money both ways, Not paid yet, 7 AM email, Day sheet agree with total - paid; never "Paid in full" with money left)`);
