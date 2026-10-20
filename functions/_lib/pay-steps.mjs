// "How <first name> pays" (owner-approved mock-up "Invoices: total and deposit broken out",
// 20 Oct 2026): the money on an invoice said as numbered payments that add up to the total, in
// the SAME words on the invoice page, the customer's email, the PDF and its text message, the
// card's Payment box and the 7 AM to-do email. ONE function works out the numbers (payStepsOf);
// the renderers below only word them per place.
//
//   with a deposit  ① Deposit · now · holds the date   $50.00
//                   ② The rest · by Wed 28 Oct          $150.00
//                   $50 + $150 = $200 total
//   All now         ① All of it · now                   $200.00
//   No deposit      No deposit. Nothing to pay now.
//                   ① All of it · by Wed 28 Oct         $200.00
//   damage deposit  the total also reads "$80 rental + $50 refundable damage deposit"
//   paid            the step turns green "✓ paid Tue 20 Oct"; "Still owed $150.00" shows the rest
//
// The numbers are the ones every invoice has always shown: the amount now is the stored
// deposit_due_cents (the whole total for All now, nothing for No deposit), the rest is the total
// minus that. Nothing is saved here.
import { esc, money, invoiceTotal, lineTotal, payPlanOf, shortDate } from './util.mjs';

export const dollars = (c) => money(c).replace(/\.00$/, '');
const CIRCLED = ['', '①', '②', '③'];
export const circled = (n) => CIRCLED[n] || `${n}.`;

// paid: cents received (non-voided payments); payments: [{ cents, on }] oldest first, for dates.
export function payStepsOf(invoice, lines, { paid = 0, payments = [] } = {}) {
  const total = invoiceTotal(lines || []);
  const refundable = (lines || []).filter((l) => l.refundable).reduce((s, l) => s + lineTotal(l), 0);
  const plan = payPlanOf(invoice || {}, total);
  const due = (invoice && invoice.due_date) || '';
  const byDate = due ? `by ${shortDate(due)}` : 'by the due date';
  let now = plan === 'full' ? total : (plan === 'none' ? 0 : Math.max(0, Math.min(total, Math.round(Number(invoice && invoice.deposit_due_cents) || 0))));
  if (total <= 0) now = 0;
  const steps = [];
  if (now >= total && total > 0) steps.push({ n: 1, what: 'All of it', when: 'now', why: '', cents: total });
  else if (now <= 0) steps.push({ n: 1, what: 'All of it', when: byDate, why: '', cents: total });
  else steps.push({ n: 1, what: 'Deposit', when: 'now', why: 'holds the date', cents: now }, { n: 2, what: 'The rest', when: byDate, why: '', cents: total - now });
  const got = Math.max(0, Math.round(paid || (payments || []).reduce((s, p) => s + (p.cents || 0), 0)));
  let need = 0;
  for (const s of steps) {
    need += s.cents;
    s.paid = s.cents > 0 && got >= need;
    if (s.paid) {
      let run = 0; const hit = (payments || []).find((p) => { run += p.cents || 0; return run >= need; });
      s.paidOn = hit && hit.on ? shortDate(hit.on) : '';
    }
  }
  const noDeposit = total > 0 && now <= 0;
  return {
    plan, total, refundable, charges: total - refundable, now, rest: total - now, steps, noDeposit,
    paid: got, stillOwed: Math.max(0, total - got), dueDay: due ? shortDate(due) : '',
    sumWords: steps.length > 1 ? `${steps.map((s) => dollars(s.cents)).join(' + ')} = ${dollars(total)} total` : '',
    totalWords: refundable > 0 ? `${dollars(total - refundable)} rental + ${dollars(refundable)} refundable damage deposit` : '',
  };
}

const stepWords = (s) => [s.what, s.when, s.why].filter(Boolean).join(' · ');
const paidWords = (s) => `✓ paid${s.paidOn ? ` ${s.paidOn}` : ''}`;

// The admin box (invoice page; compact on the card). who: the customer's first name.
export const PAY_STEPS_CSS = `.paysteps{background:#eef4fb;border:1.5px solid #b9cfe8;border-radius:12px;padding:12px 14px;margin:10px 0}
.paysteps h3{font:700 1.05rem Inter,Arial,sans-serif;margin:0 0 6px;color:#1f3b5c}.paysteps .none{margin:0 0 6px;font-weight:600}
.paysteps .ps{display:flex;justify-content:space-between;gap:10px;align-items:baseline;padding:4px 0}.paysteps .ps .n{font-weight:700;margin-right:4px}
.paysteps .ps strong{white-space:nowrap}.paysteps .ps.ok{color:#2f5a2b}.paysteps .ps .pd{display:block;font-size:.92rem;font-weight:700;color:#2f5a2b}
.paysteps .sum{margin:6px 0 0;color:#3d4f63;font-size:.95rem}.paysteps .owed{margin:6px 0 0;font-weight:700}
.paysteps.compact{padding:8px 10px;margin:6px 0}.paysteps.compact h3{font-size:.98rem;margin-bottom:2px}`;
export function payStepsHtml(ps, { who = '', compact = false } = {}) {
  if (!ps || ps.total <= 0) return '';
  const rows = ps.steps.map((s) => `<div class="ps${s.paid ? ' ok' : ''}" data-pay-step="${s.n}"${s.paid ? ' data-step-paid' : ''}><span><span class="n">${circled(s.n)}</span>${esc(stepWords(s))}${s.paid ? `<span class="pd">${esc(paidWords(s))}</span>` : ''}</span><strong>${esc(money(s.cents))}</strong></div>`).join('');
  return `<section class="paysteps${compact ? ' compact' : ''}" data-pay-steps data-plan="${esc(ps.plan)}"><h3>How ${esc(who || 'they')} ${who ? 'pays' : 'pay'}</h3>
    ${ps.noDeposit ? '<p class="none" data-no-deposit>No deposit. Nothing to pay now.</p>' : ''}${rows}
    ${ps.sumWords ? `<p class="sum" data-pay-sum>${esc(ps.sumWords)}</p>` : ''}
    ${ps.paid > 0 && ps.stillOwed > 0 ? `<p class="owed" data-still-owed>Still owed ${esc(money(ps.stillOwed))}</p>` : ''}</section>`;
}

// One line of plain words (the card's Payment box words, the 7 AM email, a text message):
// "① Deposit · now · holds the date $50 ✓ paid Tue 20 Oct · ② The rest · by Wed 28 Oct $150".
export function payStepsLine(ps, fmt = dollars) {
  if (!ps || ps.total <= 0) return '';
  const head = ps.noDeposit ? 'No deposit. ' : '';
  return head + ps.steps.map((s) => `${circled(s.n)} ${stepWords(s)} ${fmt(s.cents)}${s.paid ? ` ${paidWords(s)}` : ''}`).join(' · ');
}

// The customer's words (email, PDF, text): "How you pay", "① Deposit now (holds your date)",
// "② The rest, by Wed 28 Oct", "① All of it, now" / "① All of it, by Wed 28 Oct".
export function customerSteps(ps) {
  if (!ps || ps.total <= 0) return { head: '', rows: [], sum: '', totalWords: '' };
  const rows = ps.steps.map((s) => ({ n: s.n, mark: circled(s.n), words: s.what === 'Deposit' ? 'Deposit now (holds your date)' : `${s.what}, ${s.when}`, cents: s.cents, paid: s.paid, paidOn: s.paidOn || '' }));
  return { head: ps.noDeposit ? 'Nothing to pay now.' : '', rows, sum: ps.sumWords, totalWords: ps.totalWords };
}
