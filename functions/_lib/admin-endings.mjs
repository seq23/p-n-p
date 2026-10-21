// Three ways a job ends (owner-approved mock-up "Done Cards", 20 Oct 2026; docs/admin-console.md):
//   POST /admin/requests/done      "✓ Mark as done" on a Finished card. With a refundable damage
//        deposit still held (ledger.mjs depositHeldCents) it needs deposit=returned|kept, which
//        records the refund / kept row first (kind 'refund' / 'deposit_kept', tagged DONE_TAG).
//        Then request_status.done_at is set and the card moves to the Done group. at=<card id> is
//        the card she was looking at (the next one down), so the page does not jump.
//   POST /admin/requests/undone    "Not done after all (undo)": clears done_at and voids the rows
//        that Done recorded, so the card is back exactly as it was.
//   POST /admin/requests/cancel    "Cancel this job…" (the existing Void): with money in, how=
//        refund|keep|part (+ amount) records it first (tagged CANCEL_TAG), then the invoice is
//        voided and its bookings come off the calendar, exactly as Void always did.
//   POST /admin/requests/uncancel  "Not cancelled after all (undo)": the existing Bring back (undo
//        Void): the invoice comes back as a draft, the request back to its step, and the rows
//        Cancel recorded are voided.
// Nothing here deletes a row, and nothing changes an invoice's lines or an earlier payment.
import { redirect, b64urlText, fromB64urlText, toCents } from './util.mjs';
import { logEvent } from './requests.mjs';
import { balanceOf, paidByInvoice, depositHeld, depositHeldCents, cancelHeldCents, recordDepositOutcome, recordCancelMoney, voidTagged, DONE_TAG, CANCEL_TAG, dollars } from './ledger.mjs';
import { removeInvoiceBookings } from './calendar.mjs';

const decodeKey = (v) => { try { return fromB64urlText(String(v || '')); } catch { return ''; } };
const anchorOf = (v) => (/^c-[A-Za-z0-9_-]{1,400}$/.test(String(v || '')) ? `#${v}` : '');
const toPage = (params, hash) => redirect(`/admin/?${Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}${hash}`);

async function load(db, key) {
  const st = await db.prepare('SELECT * FROM request_status WHERE request_key = ?1').bind(key).first();
  let inv = null; let lines = [];
  if (st && st.invoice_id) inv = await db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(st.invoice_id).first();
  if (!inv) inv = await db.prepare("SELECT * FROM invoices WHERE request_key = ?1 ORDER BY id DESC LIMIT 1").bind(key).first();
  if (inv) lines = (await db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?1').bind(inv.id).all()).results || [];
  const bal = inv ? balanceOf(inv, lines, (await paidByInvoice(db, [inv.id]))[inv.id] || 0) : null;
  const out = inv ? await depositHeld(db, inv.id) : { refunded: 0, kept: 0 };
  return { st, inv, lines, bal, out };
}

export async function markDone(env, request) {
  const form = await request.formData();
  const key = decodeKey(form.get('r'));
  if (!key) return redirect('/admin/');
  const rk = b64urlText(key);
  const { st, inv, lines, bal, out } = await load(env.DB, key);
  const back = (e) => toPage({ e }, `#c-${rk}`);
  if (!st || st.archived_at) return back('This card is put away. Bring it back first.');
  if (st.status === 'void' || (inv && inv.status === 'void')) return back('This job is cancelled, so it cannot be marked done.');
  if (st.done_at) return toPage({ m: 'Already done ✓' }, `#c-${rk}`);
  if (bal && bal.remaining > 0) return back('There is still money to pay, so it is not finished yet.');
  const held = depositHeldCents(bal, out);
  const dep = String(form.get('deposit') || '');
  if (held > 0 && dep !== 'returned' && dep !== 'kept') return back(`The ${dollars(held)} refundable deposit is still held. Tap ✓ Mark as done and say if you returned it or kept it.`);
  if (held > 0) await recordDepositOutcome(env.DB, inv, lines, dep === 'returned' ? 'refund' : 'deposit_kept', held, '', DONE_TAG);
  await env.DB.prepare("UPDATE request_status SET done_at = datetime('now'), updated_at = datetime('now') WHERE request_key = ?1").bind(key).run();
  await logEvent(env.DB, key, `Marked as done${held > 0 ? ` (${dollars(held)} deposit ${dep === 'returned' ? 'returned' : 'kept'})` : ''}. Moved to the Done group.`, 'Valerie');
  const at = anchorOf(form.get('at')).slice(1);
  return toPage({ doneok: rk, ...(at ? { at } : {}) }, '#done-banner');
}

export async function markUndone(env, request) {
  const form = await request.formData();
  const key = decodeKey(form.get('r'));
  if (!key) return redirect('/admin/');
  const { st, inv } = await load(env.DB, key);
  if (st && st.done_at) {
    if (inv) await voidTagged(env.DB, inv.id, DONE_TAG);
    await env.DB.prepare("UPDATE request_status SET done_at = NULL, updated_at = datetime('now') WHERE request_key = ?1").bind(key).run();
    await logEvent(env.DB, key, 'Not done after all: back with the active cards.', 'Valerie');
  }
  return toPage({ m: 'Back with the active cards ✓' }, `#c-${b64urlText(key)}`);
}

export async function cancelJob(env, request) {
  const form = await request.formData();
  const key = decodeKey(form.get('r'));
  if (!key) return redirect('/admin/');
  const rk = b64urlText(key);
  const { st, inv, bal, out } = await load(env.DB, key);
  if ((st && st.status === 'void') || (inv && inv.status === 'void')) return toPage({ m: 'Already cancelled.', cx: rk }, `#c-${rk}`);
  const held = inv ? cancelHeldCents(bal, out) : 0;
  const how = String(form.get('how') || '');
  if (held > 0 && !['refund', 'keep', 'part'].includes(how)) return toPage({ e: `They paid ${dollars(held)}. Tap Cancel this job… and say what happens to it.` }, `#c-${rk}`);
  let moneyWords = '';
  if (held > 0) {
    const part = how === 'part' ? toCents(form.get('amount')) : 0;
    if (how === 'part' && !(part > 0 && part <= held)) return toPage({ e: `Type how much you refunded (up to ${dollars(held)}).` }, `#c-${rk}`);
    const rec = await recordCancelMoney(env.DB, inv.id, how, part);
    moneyWords = [rec.refunded ? `${dollars(rec.refunded)} refunded` : '', rec.kept ? `${dollars(rec.kept)} kept` : ''].filter(Boolean).join(', ');
  }
  // The existing Void, step for step (admin.mjs changeStatus / the request Payment box).
  if (inv) {
    await env.DB.prepare("UPDATE invoices SET status = 'void', updated_at = datetime('now') WHERE id = ?1").bind(inv.id).run();
    await removeInvoiceBookings(env.DB, inv.id);
  }
  await env.DB.prepare(`INSERT INTO request_status (request_key, status, invoice_id, cancelled_at, updated_at) VALUES (?1, 'void', ?2, datetime('now'), datetime('now'))
    ON CONFLICT(request_key) DO UPDATE SET status = 'void', invoice_id = COALESCE(excluded.invoice_id, request_status.invoice_id), cancelled_at = datetime('now'), updated_at = datetime('now')`)
    .bind(key, inv ? inv.id : null).run();
  await logEvent(env.DB, key, `Job cancelled${inv ? ` (invoice ${inv.number} voided)` : ''}${moneyWords ? `: ${moneyWords}` : ''}. Moved to the Cancelled group.`, 'Valerie');
  return toPage({ m: `Cancelled. Nothing is owed${moneyWords ? ` (${moneyWords})` : ''}. It is in the Cancelled group.`, cx: rk }, `#c-${rk}`);
}

export async function uncancelJob(env, request) {
  const form = await request.formData();
  const key = decodeKey(form.get('r'));
  if (!key) return redirect('/admin/');
  const { st, inv } = await load(env.DB, key);
  if (inv && inv.status === 'void') {
    await env.DB.prepare("UPDATE invoices SET status = 'draft', updated_at = datetime('now') WHERE id = ?1").bind(inv.id).run();
    await voidTagged(env.DB, inv.id, CANCEL_TAG);
  }
  if (st && st.status === 'void') {
    await env.DB.prepare("UPDATE request_status SET status = 'new', cancelled_at = NULL, updated_at = datetime('now') WHERE request_key = ?1").bind(key).run();
    await logEvent(env.DB, key, `Not cancelled after all${inv ? ` (invoice ${inv.number} is a draft again)` : ''}.`, 'Valerie');
  }
  return toPage({ m: inv ? 'Not cancelled ✓ The invoice is back as a draft. Send it again to put it back on the calendar.' : 'Not cancelled ✓' }, `#c-${b64urlText(key)}`);
}
