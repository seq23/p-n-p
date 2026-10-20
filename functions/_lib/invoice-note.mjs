// The rental invoice note (owner's final wording, 19 Oct 2026). ONE function picks the words from
// the invoice's own numbers at the moment it is shown or sent (the online invoice page shows the
// current state; an emailed / texted / PDF copy is what was true when it went out):
//   money left after the amount due now   "Pay the rest ($R) at pickup. Text or call P to set your
//                                          pickup time at PLACE unless otherwise agreed upon."
//   nothing left after the amount due now "This covers everything. Nothing more to pay at pickup.
//                                          Text or call P to set ... unless otherwise agreed upon."
//   already paid in full                  "Paid in full. Thank you! Text or call P to set your
//                                          pickup time at PLACE unless otherwise agreed upon."
//                                          (the ONLINE invoice page only, view: true; no email or
//                                          extra invoice is ever sent for it: elsewhere a paid
//                                          invoice reads as "This covers everything.")
// Business delivery (set by Valerie on the request, or a Delivery fee line): "at delivery"
// and "Text or call P to set your delivery time unless otherwise agreed upon." (no PLACE).
// R is the same "rest" the invoice's "How <name> pays" box states (pay-steps.mjs payStepsOf,
// which reads ledger.mjs balanceOf): the total minus the amount due now (or what was paid, if
// more), so the note, step ② / "Still owed", the card and every email add up to the same total.
// The owner's 19 Oct 2026 rule "the refundable damage deposit is never owed" is kept in words,
// not by dropping it from the sum (20 Oct 2026): money received takes the damage deposit first,
// so it is only still to pay when the amount due now is smaller than it, and then the note says
// so: "Pay the rest ($20.00 + $50.00 refundable deposit = $70.00) at pickup."
// "Paid in full" only when the whole total is in (balance.paidInFull), never with money left.
// The phone and the place come
// from data/rentals/games.json pickup (pricing.mjs table.pickupPhone / pickupPlace), never typed.
// A note Valerie typed herself (invoice.notes) wins: the automatic note is then left out.
import { money } from './util.mjs';
import { payStepsOf } from './pay-steps.mjs';
import { isRentalInvoice } from './pricing.mjs';

// The website's old automatic draft note: not hers, so it never counts as hand-typed.
export const LEGACY_DRAFT_NOTE = 'Pay the deposit to confirm your games. The rest is paid at pickup.';
export const DELIVERY_LINE = /^delivery fee\b/i;

export function handTyped(invoice) {
  const n = String((invoice && invoice.notes) || '').trim();
  return Boolean(n) && n !== LEGACY_DRAFT_NOTE;
}

// The request's "Business delivery: Yes" answer (Valerie's Customer details edit, or an older form tick).
export function businessDelivery(r) {
  const all = r ? [...(r.rentals || []), ...(r.decor || []), ...(r.other || [])] : [];
  return all.some((x) => /^business delivery$/i.test(String(x.label || '')) && /^yes/i.test(String(x.value || '')));
}

export function isDelivery(lines = [], { delivery = false } = {}) {
  return Boolean(delivery) || (lines || []).some((l) => DELIVERY_LINE.test(String(l.description || '')));
}

// "$70.00" / "$20.00 + $50.00 refundable deposit = $70.00" / "$50.00 refundable deposit".
export function restWords(rest, restDeposit = 0) {
  if (!(restDeposit > 0)) return money(rest);
  if (rest - restDeposit <= 0) return `${money(rest)} refundable deposit`;
  return `${money(rest - restDeposit)} + ${money(restDeposit)} refundable deposit = ${money(rest)}`;
}

// -> { state: 'rest' | 'upfront' | 'paid', rest, words } or null (not a rental, or her own note).
export function rentalNote({ invoice = {}, lines = [], paidCents = 0, table, delivery = false, view = false }) {
  if (!table || !isRentalInvoice(lines, table)) return null;
  if (handTyped(invoice)) return null;
  const ps = payStepsOf(invoice, lines, { paid: paidCents });
  // What is left after the amount due now (or what was paid, if more): step ② of the pay box
  // before anything past the deposit is in, its "Still owed" after.
  const x = Math.max(ps.paid, ps.now);
  const rest = Math.max(0, ps.total - x);
  // The part of it that is the refundable damage deposit (the deposit is taken first).
  const restDeposit = Math.min(rest, Math.max(0, ps.refundable - x));
  const state = ps.paidInFull && view ? 'paid' : (rest > 0 ? 'rest' : 'upfront');
  const del = isDelivery(lines, { delivery });
  const where = del ? 'at delivery' : 'at pickup';
  const tail = del ? `Text or call ${table.pickupPhone} to set your delivery time unless otherwise agreed upon.`
    : `Text or call ${table.pickupPhone} to set your pickup time at ${table.pickupPlace} unless otherwise agreed upon.`;
  const head = state === 'paid' ? 'Paid in full. Thank you!' : (state === 'upfront' ? `This covers everything. Nothing more to pay ${where}.` : `Pay the rest (${restWords(rest, restDeposit)}) ${where}.`);
  return { state, rest, restDeposit, delivery: del, words: `${head} ${tail}` };
}

// The words under the pay box, or '' (decor-only invoice, or her own note).
export function pickupNote(lines, table, opts = {}) {
  const n = rentalNote({ lines, table, ...opts });
  return n ? n.words : '';
}
