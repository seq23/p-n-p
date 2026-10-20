// "+ Extra game" on a rental invoice (owner-approved 19 Oct 2026). Valerie picks a game that is
// FREE for the rental's whole pickup -> return span (a booked one shows as unavailable); it is
// priced from data/offers/services.json invoiceQuickAdds (never typed in code), or ticked
// "Complimentary (no charge)": a $0 line (note 'free', hidden from the customer) plus the invoice
// note "Complimentary 3rd game: <game>". Paid or complimentary, the game is RESERVED for the
// span: it is written onto the rental's pickup and return bookings as "<game> (extra game)", which
// is what availability, the calendar, the Day sheet and the clash checks all read
// (calendar.mjs rentalWindows -> expandItems). Removing the line takes it back off.
import * as C from './calendar.mjs';

export const EXTRA_PREFIX = 'Extra game: ';
export const EXTRA_TAG = ' (extra game)';
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
export const ordinal = (n) => ORD[n] || `${n}th`;

// The extra games an invoice's lines name, in order.
export function extraGamesOf(lines = [], table) {
  return (lines || []).map((l) => String(l.description || '')).filter((d) => d.startsWith(EXTRA_PREFIX))
    .map((d) => d.slice(EXTRA_PREFIX.length).trim())
    .map((n) => (table ? (table.items.find((i) => i.name.toLowerCase() === n.toLowerCase()) || {}).name || n : n))
    .filter(Boolean);
}

export function complimentaryNote(n, name) {
  return `Complimentary ${ordinal(n)} game: ${name}`;
}

// The games the picker offers: every bookable public game, free = at least one left for every
// day of [pickup, ret] counting every OTHER rental, and not already in this rental.
export function freeGamesFor({ windows = [], pickup = '', ret = '', today = '', table, key = '', ownItems = '' }) {
  const own = new Set(C.expandItems(ownItems, table).names);
  const left = C.availability(windows, pickup, ret || pickup, today, table, key);
  return table.items.filter((i) => i.kind === 'game' && !i.removed && !i.adminOnly)
    .map((i) => ({ name: i.name, free: !own.has(i.name) && (left[i.name] === undefined ? true : left[i.name] > 0), mine: own.has(i.name) }));
}

// Writes the invoice's extra games onto the request's rental bookings (adds what is missing,
// removes "(extra game)" entries whose line is gone). Returns the number of bookings changed.
export async function syncExtraGames(db, key, table = null) {
  if (!key) return 0;
  const T = table || (await import('./prices.mjs')).TRACK_TABLE;
  const st = await db.prepare('SELECT invoice_id FROM request_status WHERE request_key = ?1').bind(key).first();
  let lines = [];
  if (st && st.invoice_id) {
    const inv = await db.prepare('SELECT status FROM invoices WHERE id = ?1').bind(st.invoice_id).first();
    if (inv && inv.status !== 'void') ({ results: lines } = await db.prepare('SELECT description FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id').bind(st.invoice_id).all());
  }
  const want = extraGamesOf(lines || [], T);
  const { results: bk } = await db.prepare("SELECT id, items FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return')").bind(key).all();
  let changed = 0;
  for (const b of bk || []) {
    const parts = String(b.items || '').split(/,\s*/).filter(Boolean);
    const kept = parts.filter((p) => !p.endsWith(EXTRA_TAG) || want.includes(p.slice(0, -EXTRA_TAG.length)));
    const have = new Set(C.expandItems(kept.join(', '), T).names);
    for (const n of want) if (!have.has(n)) kept.push(`${n}${EXTRA_TAG}`);
    const next = kept.join(', ');
    if (next !== String(b.items || '')) {
      await db.prepare("UPDATE bookings SET items = ?2, updated_at = datetime('now') WHERE id = ?1").bind(b.id, next).run();
      changed += 1;
    }
  }
  return changed;
}
