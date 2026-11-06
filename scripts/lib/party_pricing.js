'use strict';
/**
 * Party and hotel-room decor guidance (owner, 5 Nov 2026): the ONE definition both the request
 * form (functions/_lib/request-form.mjs re-exports these names) and the /pricing block
 * (scripts/lib/price_tools.js) read, so the two can never drift. CommonJS, like porch_packages.js,
 * so the form (ESM, bundled for Pages Functions) and the build scripts both import it.
 */
// Where-is-it help on the form, and the hotel line on /pricing.
const HOTEL_WINDOW = 'Hotel rooms: we generally need to be there from 3 to 6 PM, around check-in time.';
const LOCATION_LATER = 'No hotel booked yet? Leave this blank and text us the hotel when you have it.';
// For a business booking party & hotel decor (owner, 5 Nov 2026).
const LOBBY_CHOICES = [['lobby', 'Just the lobby'], ['lobby_room', 'The lobby and an event room or space'], ['room', 'An event room or space, not the lobby'], ['not_sure', 'Not sure yet']];
// What each budget buys: the lowest is simple decor, $1,000+ is very heavy decor that fills the
// whole room. The hint is on the form only; the saved answer stays the plain range.
const BUDGET_HELP = 'The lower budget is simple decor. $1,000 and up is very heavy decor that fills the whole room.';
const PARTY_BUDGETS = [['$300–$500', '$300–$500 (simple decor)'], ['$500–$1,000', '$500–$1,000 (fuller decor)'], ['$1,000+', '$1,000+ (very heavy decor, the full room)'], ['Not sure yet', 'Not sure yet']];

module.exports = { HOTEL_WINDOW, LOCATION_LATER, LOBBY_CHOICES, BUDGET_HELP, PARTY_BUDGETS };
