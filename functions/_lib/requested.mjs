// "Requested" chips (owner, 18 Oct 2026): every live request whose asked-for day has no booking
// of that kind yet shows on Calendar & Bookings (month, day page, Today's list) as an OUTLINED
// chip (border only, no fill) in its service colour with the word "Requested". Filled = booked,
// outlined = asked for, not booked yet. They are NOT bookings: never in the Google Calendar
// feed, the Sheet's Bookings tab, games out or availability. A rental's asked-for games are
// counted apart ("N games asked for"). A held rental already has its bookings (filled, "Held");
// when the hold expires its bookings come off and the request shows here again, outlined.
import { servicesOf, SCHEDULE_FIRST } from './cards.mjs';
import { parseFormDate, returnDateFor, expandItems, addDays } from './calendar.mjs';
import { serviceInfo } from './kinds.mjs';

const answerOf = (r, re) => {
  const hit = [...(r.rentals || []), ...(r.decor || []), ...(r.other || [])].find((x) => re.test(x.label));
  return hit ? String(hit.value || '') : '';
};

// "Ada Example" -> "Ada E."
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'No name';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

// The day a request asked for, per service: rentals the pickup date, the rest the event date.
export function askedDate(r, service) {
  if (service === 'rentals') return parseFormDate(answerOf(r, /pickup date|delivery date/i)) || parseFormDate(answerOf(r, /event date/i));
  return parseFormDate(answerOf(r, /event date/i));
}

// requests: fromRow objects; statuses: { key: request_status }; bookings: every booking row.
// -> [{ key, name, service, kind, date, color, games, returnDate }]
export function requestedChips(requests, statuses = {}, bookings = [], table = null) {
  const kindsBy = {};
  for (const b of bookings || []) if (b.request_key) (kindsBy[b.request_key] = kindsBy[b.request_key] || new Set()).add(b.kind);
  const out = [];
  for (const r of requests || []) {
    const st = statuses[r.key];
    if (r.isTest || (st && (st.archived_at || st.status === 'void'))) continue;
    for (const service of servicesOf(r)) {
      const kind = SCHEDULE_FIRST[service][1];
      if (kindsBy[r.key] && kindsBy[r.key].has(kind)) continue;
      const date = askedDate(r, service);
      if (!date) continue;
      const chip = { key: r.key, name: shortName(r.name), service, kind, date, color: serviceInfo(kind).bar, games: 0, returnDate: '' };
      if (service === 'rentals') {
        const ex = table ? expandItems(r.gamesAnswer || answerOf(r, /which games/i), table) : { names: [], unnamed: 0 };
        chip.games = ex.names.reduce((n, name) => n + ((ex.counts && ex.counts[name]) || 1), 0) + ex.unnamed;
        chip.returnDate = returnDateFor(date, r.durationAnswer) || addDays(date, 1);
      }
      out.push(chip);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

// Games asked for (not booked) on one day: every requested rental whose asked window covers it.
// Never added to "games out".
export function gamesAskedOn(chips, day) {
  return (chips || []).filter((c) => c.service === 'rentals' && c.date <= day && day <= (c.returnDate || c.date)).reduce((n, c) => n + c.games, 0);
}
