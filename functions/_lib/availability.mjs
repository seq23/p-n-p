// Games left for a rental window, by item slug, from the Calendar & Bookings data (every
// rental booking, held or confirmed, counts as games out; checked-in returns free them).
import { PRICE_TABLE } from './prices.mjs';
import * as C from './calendar.mjs';

export async function availabilityFor(db, start, end, today, ignoreKey = '') {
  const [bookings, returns] = await Promise.all([C.listBookings(db), C.loadReturns(db)]);
  const windows = C.rentalWindows(bookings, returns, PRICE_TABLE);
  const byName = C.availability(windows, start, end, today, PRICE_TABLE, ignoreKey);
  const out = {};
  for (const i of PRICE_TABLE.items) out[i.slug] = byName[i.name];
  return out;
}
