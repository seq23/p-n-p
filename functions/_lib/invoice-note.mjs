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
// Business delivery (the request's "deliver to us" tick, or a Delivery fee line): "at delivery"
// and "Text or call P to set your delivery time unless otherwise agreed upon." (no PLACE).
// R never counts the refundable damage deposit (it is never owed). The phone and the place come
// from data/rentals/games.json pickup (pricing.mjs table.pickupPhone / pickupPlace), never typed.
// A note Valerie typed herself (invoice.notes) wins: the automatic note is then left out.
import { balanceOf } from './ledger.mjs';
import { amountDueNow, payPlanOf, money } from './util.mjs';
import { isRentalInvoice } from './pricing.mjs';

// The website's old automatic draft note: not hers, so it never counts as hand-typed.
export const LEGACY_DRAFT_NOTE = 'Pay the deposit to confirm your games. The rest is paid at pickup.';
export const DELIVERY_LINE = /^delivery fee\b/i;

export function handTyped(invoice) {
  const n = String((invoice && invoice.notes) || '').trim();
  return Boolean(n) && n !== LEGACY_DRAFT_NOTE;
}

// The request's own "This is for a business — deliver to us" tick (the /request rentals path).
export function businessDelivery(r) {
  const all = r ? [...(r.rentals || []), ...(r.decor || []), ...(r.other || [])] : [];
  return all.some((x) => /^business delivery$/i.test(String(x.label || '')) && /^yes/i.test(String(x.value || '')));
}

export function isDelivery(lines = [], { delivery = false } = {}) {
  return Boolean(delivery) || (lines || []).some((l) => DELIVERY_LINE.test(String(l.description || '')));
}

// -> { state: 'rest' | 'upfront' | 'paid', rest, words } or null (not a rental, or her own note).
export function rentalNote({ invoice = {}, lines = [], paidCents = 0, table, delivery = false, view = false }) {
  if (!table || !isRentalInvoice(lines, table)) return null;
  if (handTyped(invoice)) return null;
  const bal = balanceOf(invoice, lines, paidCents);
  const plan = payPlanOf(invoice, bal.total);
  const dueNow = amountDueNow(plan, bal.total, invoice.deposit_due_cents || 0);
  // What is left after the amount due now (or what was paid, if more): the same "rest" the
  // invoice's pay box states. The amount due now takes the refundable damage deposit first, so a
  // deposit it does not cover is left out: the deposit is never "owed".
  const x = Math.max(bal.paid, dueNow);
  const rest = Math.max(0, bal.total - x - Math.max(0, bal.refundable - x));
  const paidUp = bal.charges > 0 && bal.owed === 0 && bal.paid > 0;
  const state = paidUp && view ? 'paid' : (rest > 0 ? 'rest' : 'upfront');
  const del = isDelivery(lines, { delivery });
  const where = del ? 'at delivery' : 'at pickup';
  const tail = del ? `Text or call ${table.pickupPhone} to set your delivery time unless otherwise agreed upon.`
    : `Text or call ${table.pickupPhone} to set your pickup time at ${table.pickupPlace} unless otherwise agreed upon.`;
  const head = state === 'paid' ? 'Paid in full. Thank you!' : (state === 'upfront' ? `This covers everything. Nothing more to pay ${where}.` : `Pay the rest (${money(rest)}) ${where}.`);
  return { state, rest, delivery: del, words: `${head} ${tail}` };
}

// The words under the pay box, or '' (decor-only invoice, or her own note).
export function pickupNote(lines, table, opts = {}) {
  const n = rentalNote({ lines, table, ...opts });
  return n ? n.words : '';
}
