// Website rental holds (owner, 19 Oct 2026): 48 hours from the request by default, and "Hold
// longer" adds 3 days unless she types another number. The one source is
// data/offers/services.json rentalHolds (the public rentals copy reads the same numbers);
// Settings can still change the hold length (holds.mjs holdSettings reads it).
import services from '../../data/offers/services.json';

const H = services.rentalHolds || {};
export const HOLD_DEFAULT_HOURS = Number(H.defaultHours);
export const HOLD_EXTEND_DAYS = Number(H.extendDays);
export const HOLD_EXTEND_MAX_DAYS = Number(H.maxExtendDays);
