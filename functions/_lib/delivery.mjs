// Business delivery chosen in Step 1 "Talk to them" (owner-approved mock-up, 20 Oct 2026, panel 5):
// "How do they get the games?"  They pick up at Mt. Moriah Station / Business delivery (+$20 on
// the invoice) with Business name + Delivery address. Rentals only.
//
// It writes the SAME answers Edit -> Customer details writes (requests.details_edits
// delivery_name / delivery_address, laid over the form by requests.mjs applyEdits, read by
// calendar.mjs deliveryAddress, invoice-note.mjs businessDelivery and the card), moves the rental
// pickup / return bookings to the business (or back to the safe exchange zone) exactly like
// admin-edit.mjs saveCustomer, and logs one request event.
//
// The invoice: choosing delivery adds ONE "Delivery fee" line (the invoice editor's quick-add
// price, data/offers/services.json invoiceQuickAdds.deliveryFee) ONLY while the request's invoice
// is still a draft that was never sent and has no Delivery fee line yet; choosing pickup takes an
// unsent draft's Delivery fee line off again. A sent invoice is never touched (the owner's
// live-data rule): Valerie changes a sent invoice herself in the editor.
import { deliveryOf } from './requests.mjs';
import { DELIVERY_LINE } from './invoice-note.mjs';
import { TRACK_TABLE } from './prices.mjs';
import { saveLines } from './ledger.mjs';
import { invoiceTotal, amountDueNow, payPlanOf } from './util.mjs';
import SERVICES_DATA from '../../data/offers/services.json';

export const DELIVERY_FEE_LABEL = 'Delivery fee';
export const deliveryFeeCents = () => Math.round(Number((SERVICES_DATA.invoiceQuickAdds || {}).deliveryFee || 0) * 100);

// An invoice the Step-1 choice may change: a draft that was never sent.
export const unsentDraft = (inv) => Boolean(inv && inv.status === 'draft' && !inv.sent_at);

// Pure: the draft's lines after the choice. -> { lines, changed, words }.
export function linesForChoice(lines, { delivery, feeCents = deliveryFeeCents() }) {
  const has = (lines || []).some((l) => DELIVERY_LINE.test(String(l.description || '')));
  if (delivery && !has && feeCents > 0) {
    const fee = { description: DELIVERY_FEE_LABEL, qty: 1, unit_cents: feeCents, note: '', refundable: 0 };
    const at = lines.findIndex((l) => l.refundable);
    const next = at < 0 ? [...lines, fee] : [...lines.slice(0, at), fee, ...lines.slice(at)];
    return { lines: next, changed: true, words: 'Delivery fee added to the draft invoice' };
  }
  if (!delivery && has) return { lines: lines.filter((l) => !DELIVERY_LINE.test(String(l.description || ''))), changed: true, words: 'Delivery fee taken off the draft invoice' };
  return { lines, changed: false, words: '' };
}

// The request's live invoice: the one on its status row, else its newest non-void one.
async function invoiceOf(db, key) {
  const st = await db.prepare('SELECT invoice_id FROM request_status WHERE request_key = ?1').bind(key).first();
  if (st && st.invoice_id) {
    const inv = await db.prepare("SELECT * FROM invoices WHERE id = ?1 AND status <> 'void'").bind(st.invoice_id).first();
    if (inv) return inv;
  }
  return db.prepare("SELECT * FROM invoices WHERE request_key = ?1 AND status <> 'void' ORDER BY id DESC LIMIT 1").bind(key).first();
}

// next: { name, address } ('' address = they pick up). -> { changed, words: [..] }.
export async function setDelivery(db, req, next, { who = 'Valerie' } = {}) {
  const key = req.key;
  const was = deliveryOf(req);
  const wasAddr = String(was.address || '').trim();
  const name = String(next.name || '').trim().slice(0, 500);
  const address = String(next.address || '').trim().slice(0, 500);
  const words = [];
  if (name !== String(was.name || '').trim() || address !== wasAddr) {
    const edits = { ...(req.detailsEdits || {}), delivery_name: address ? name : '', delivery_address: address };
    await db.prepare('UPDATE requests SET details_edits = ?2 WHERE request_key = ?1').bind(key, JSON.stringify(edits)).run();
    if (address !== wasAddr) {
      await db.prepare(`UPDATE bookings SET place = ?3, updated_at = datetime('now') WHERE request_key = ?1 AND kind IN ('rental_pickup', 'rental_return') AND (place = ?2 OR place = '' OR place = ?4)`)
        .bind(key, wasAddr || TRACK_TABLE.pickupPlace, address || TRACK_TABLE.pickupPlace, TRACK_TABLE.pickupPlace).run();
    }
    words.push(address ? `How they get the games: business delivery to ${[name, address].filter(Boolean).join(', ')}` : `How they get the games: they pick up at ${TRACK_TABLE.pickupPlace}`);
  }
  const inv = await invoiceOf(db, key);
  if (unsentDraft(inv)) {
    const { results } = await db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id').bind(inv.id).all();
    const lines = (results || []).map((l) => ({ description: l.description, qty: l.qty, unit_cents: l.unit_cents, note: l.note || '', refundable: l.refundable ? 1 : 0 }));
    const out = linesForChoice(lines, { delivery: Boolean(address) });
    if (out.changed) {
      const plan = payPlanOf(inv, invoiceTotal(lines));
      await saveLines(db, inv.id, out.lines);
      await db.prepare("UPDATE invoices SET deposit_due_cents = ?2, updated_at = datetime('now') WHERE id = ?1 AND status = 'draft' AND sent_at IS NULL")
        .bind(inv.id, amountDueNow(plan, invoiceTotal(out.lines), inv.deposit_due_cents || 0)).run();
      words.push(`${out.words} ${inv.number || ''}`.trim());
    }
  }
  for (const w of words) await db.prepare('INSERT INTO request_events (request_key, who, what) VALUES (?1, ?2, ?3)').bind(key, who, `${w} (by ${who}, Step 1)`).run();
  return { changed: words.length > 0, words };
}
