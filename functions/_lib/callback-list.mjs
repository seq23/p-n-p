// The requests waiting for Valerie's call back (owner, 19 Oct 2026): every open request whose
// step 1, Called back, is not ticked (steps.mjs: not called, nothing later done), oldest first,
// with "Waiting N days" in Memphis calendar days (steps.mjs waitingDays / waitingWords). Never a
// phone-call request (she typed it in herself), never put away / void / test. A pure list for
// the daily email the owner will have built later with Valerie's other emails (not sent here).
import { loadRequestsFromDb } from './requests.mjs';
import { servicesOf } from './cards.mjs';
import { askedDate, shortName } from './requested.mjs';
import { deriveProgress } from './progress.mjs';
import { deriveSteps, loadStored, waitingDays, waitingWords, WAIT_HIGHLIGHT_DAYS } from './steps.mjs';
export { WAIT_HIGHLIGHT_DAYS };
import { takedownState } from './takedown.mjs';
import { balances } from './ledger.mjs';
import { loadReturns } from './calendar.mjs';


const WORDS = { porch: 'Porch', party: 'Party & decor', grazing: 'Grazing', rentals: 'Rentals' };

export async function callbackRows(db, today) {
  const [requests, stored, bals, returns] = await Promise.all([loadRequestsFromDb(db), loadStored(db), balances(db), loadReturns(db)]);
  const { results: st } = await db.prepare('SELECT * FROM request_status').all();
  const statuses = Object.fromEntries((st || []).map((x) => [x.request_key, x]));
  const { results: bk } = await db.prepare('SELECT request_key, kind, date, time, done_at FROM bookings WHERE request_key IS NOT NULL').all();
  const bookingsBy = {};
  for (const b of bk || []) (bookingsBy[b.request_key] = bookingsBy[b.request_key] || []).push(b);
  const out = [];
  for (const r of requests) {
    const s0 = statuses[r.key] || { status: 'new' };
    if (r.isTest || r.source === 'phone' || s0.archived_at || s0.status === 'void') continue;
    const services = servicesOf(r);
    const inv = s0.invoice_id && bals[s0.invoice_id] ? { ...bals[s0.invoice_id].invoice, balance: bals[s0.invoice_id] } : null;
    const bookings = bookingsBy[r.key] || [];
    const tdS = takedownState({ services, takedownPlan: r.takedownPlan, takedownDate: r.takedownDate, bookings, today });
    const pr = deriveProgress({ st: s0, inv, scheduled: bookings.length > 0, ret: returns[r.key], rental: services.length === 1 && services[0] === 'rentals', takedown: tdS });
    const s = deriveSteps({ r, services, pr, inv, st: s0, bookings, ret: returns[r.key], tdS, stored: stored[r.key] || null, today });
    if (s.called || pr.void) continue;
    const days = waitingDays(r.sortTime, today);
    const asked = services[0] ? askedDate(r, services[0]) : '';
    out.push({ key: r.key, name: shortName(r.name), phone: String(r.phone || '').replace(/[^\d+]/g, ''), service: services.map((k) => WORDS[k]).join(' + ') || 'Request', asked, days, words: waitingWords(days), sortTime: r.sortTime || 0 });
  }
  return out.sort((a, b) => a.sortTime - b.sortTime);
}
