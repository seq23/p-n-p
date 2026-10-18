// Invoice price logic for the /admin console. Pure: every number comes from the
// table argument, and the table is built only from data/rentals/games.json and
// data/offers/services.json (functions/_lib/prices.mjs). validate:admin-prices
// runs this module against the data files AND against a perturbed copy, so a
// price typed into this file instead of read from the table fails the build.
//
// Rentals v3 (owner-approved 2026-10-15): no delivery line, ever. Pickup and
// return at Mt. Moriah Station; items with availableNow:false are not in the
// table, so the prefill cannot price a hidden item.
//
// Porch packages (owner-approved 18 Oct 2026): the table carries
// data/offers/porch_packages.json, and a porch request starts at its tier's minimum
// for the season (scripts/lib/porch_packages.js invoiceLines, the same module the
// public grid renders from), with the fall + Christmas bundle line when both are booked.
import PP from '../../scripts/lib/porch_packages.js';

export function buildPriceTable(games, services, porchPackages = null) {
  const takedown = services && services.addOns && services.addOns.takedown;
  const cents = (d) => Math.round(d * 100);
  const items = [
    ...(games.games || []).filter((g) => g.availableNow).map((g) => ({
      slug: g.slug, name: g.name, choice: g.formChoice, kind: 'game', quantity: g.quantity || 1, dayCents: cents(games.rates.day), weekendCents: cents(games.rates.weekend),
    })),
    ...(games.extras || []).filter((x) => x.availableNow).map((x) => ({
      slug: x.slug, name: x.name, choice: x.formChoice, kind: 'extra', quantity: x.quantity || 1, dayCents: cents(x.dayPrice), weekendCents: cents(x.weekendPrice),
    })),
  ];
  const pickup = games.pickup || {};
  return {
    dayCents: cents(games.rates.day),
    weekendCents: cents(games.rates.weekend),
    items,
    bundles: (games.bundles || []).map((b) => ({
      slug: b.slug, name: b.name, choice: b.formChoice, games: b.games, items: b.items || [],
      dayCents: cents(b.dayPrice), weekendCents: b.weekendPrice == null ? null : cents(b.weekendPrice),
    })),
    damageDepositCents: cents(games.damageDeposit),
    takedownCents: cents(takedown.fromPrice),
    pickupLine: `Pay the rest at pickup. Text or call ${pickup.phone} to set your pickup time at ${String(pickup.place || '').split(',')[0]}.`,
    pickupPlace: String(pickup.place || '').split(',')[0],
    gameNames: items.filter((i) => i.kind === 'game').map((i) => i.name),
    porchPackages,
  };
}

// The calendar's item list (Calendar & Bookings, games out, availability, the booking form):
// every priced item plus games.json "adminItems" ({ slug, name, quantity, admin_only: true }),
// which no public generator reads. Same object otherwise, so prices never come from here.
export function buildTrackTable(table, games) {
  const extra = (games.adminItems || []).filter((x) => x.admin_only && x.availableNow !== false)
    .map((x) => ({ slug: x.slug, name: x.name, choice: x.name, kind: 'admin', quantity: x.quantity || 1, dayCents: 0, weekendCents: 0, adminOnly: true }));
  return { ...table, items: [...table.items, ...extra.filter((x) => !table.items.some((i) => i.slug === x.slug))] };
}

const norm = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\bsets?\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// What the "Which games?" answer asked for: bundle choices first (their strings
// carry commas, so the answer is never split on commas), then single items by
// their form choice or their name.
export function matchAnswer(answer, table) {
  let text = String(answer || '').toLowerCase();
  const bundles = [];
  for (const b of table.bundles) {
    const c = String(b.choice || '').toLowerCase();
    if (c && text.includes(c)) { bundles.push(b); text = text.split(c).join(' | '); }
  }
  const hay = ` ${norm(text)} `;
  const items = table.items.filter((i) => [i.choice, i.name].some((n) => n && hay.includes(` ${norm(n)} `)));
  return { items, bundles };
}

// "No games" answers an old form row can carry in the rentals questions (Aashish Ali's
// decor-only request had "n/a" there, 18 Oct 2026). Case- and space-insensitive.
// isNoAnswer: blank, "n/a", "na", "none", "-", "not needed" (never shown on a card).
// isNoGames: those plus "no" / "nope" / "nothing" (a "no" is a real answer elsewhere, e.g.
// "Grazing table? No", so it only means "no games" in the games question).
export const NO_ANSWER = /^\s*(n\s*\/?\s*a|none|-+|not needed|not applicable)?\s*\.?\s*$/i;
const NO_GAMES = /^\s*(no|nope|nothing|no games?|no thanks?)\s*\.?\s*$/i;
export function isNoAnswer(value) {
  return NO_ANSWER.test(String(value == null ? '' : value));
}
export function isNoGames(value) {
  return isNoAnswer(value) || NO_GAMES.test(String(value == null ? '' : value));
}

// THE rental classifier: a request rents games only when its games answer names at least one
// real item or bundle from data/rentals/games.json (formChoice or name). Never inferred from
// "How long?" or from a "Game rentals" tick alone. Returns the cleaned answer ('' for none).
export function realGamesAnswer(answer, table) {
  if (isNoGames(answer)) return '';
  const { items, bundles } = matchAnswer(answer, table);
  return items.length || bundles.length ? String(answer).trim() : '';
}

export function matchGames(answer, table) {
  return matchAnswer(answer, table).items.map((i) => i.name);
}

export function isWeekend(answer) {
  return /weekend/i.test(String(answer || ''));
}

export function saidYes(answer) {
  return /^\s*(yes|y|yeah|yep|please|sure)\b/i.test(String(answer || ''));
}

// Cheapest way to price `games` games plus the extras in `extras` (slugs) with
// singles and bundles. A bundle with no price for the mode (weekend) is skipped.
export function cheapestPlan(games, extras, table, weekend) {
  const extraItems = table.items.filter((i) => i.kind === 'extra');
  const bit = (slug) => 1 << extraItems.findIndex((x) => x.slug === slug);
  const price = (o) => (weekend ? o.weekendCents : o.dayCents);
  const gamePrice = weekend ? table.weekendCents : table.dayCents;
  const usable = table.bundles.filter((b) => price(b) != null && b.items.every((s) => extraItems.some((x) => x.slug === s)))
    .map((b) => ({ b, mask: b.items.reduce((m, s) => m | bit(s), 0) }));
  const memo = new Map();
  function best(g, mask) {
    if (!g && !mask) return { cents: 0, picks: [] };
    const key = `${g}|${mask}`;
    if (memo.has(key)) return memo.get(key);
    let out = null;
    const tryPick = (cost, rest, pick) => { if (!rest) return; const c = cost + rest.cents; if (!out || c < out.cents) out = { cents: c, picks: [pick, ...rest.picks] }; };
    if (g > 0) tryPick(gamePrice, best(g - 1, mask), { game: true });
    extraItems.forEach((x, i) => { if (mask & (1 << i)) tryPick(price(x), best(g, mask & ~(1 << i)), { extra: x }); });
    for (const u of usable) if (u.b.games <= g && (mask & u.mask) === u.mask) tryPick(price(u.b), best(g - u.b.games, mask & ~u.mask), { bundle: u.b });
    memo.set(key, out);
    return out;
  }
  const mask = extras.reduce((m, s) => m | bit(s), 0);
  return best(games, mask);
}

// Kept for callers that only price games: cheapest one-day plan for n games.
export function cheapestDayPlan(n, table) {
  const plan = cheapestPlan(n, [], table, false);
  return { bundles: plan.picks.filter((p) => p.bundle).map((p) => p.bundle), singles: plan.picks.filter((p) => p.game).length, totalCents: plan.cents };
}

function gameList(named, slots, table) {
  // Named games fill the slots first; a slot nobody named is "of your choice",
  // except when the slots are every game (Whole Yard, The Whole Party).
  const out = named.slice(0, slots);
  if (slots >= table.gameNames.length) for (const n of table.gameNames) if (out.length < slots && !out.includes(n)) out.push(n);
  return out;
}

// Lines for a new invoice, prefilled from one form request. Every line stays editable.
// A $0 line is "price needed" (the decor line before Valerie prices it).
export function prefillLines(request, table) {
  const lines = [];
  const { items, bundles: picked } = matchAnswer(request.gamesAnswer, table);
  if (request.wantsRentals || items.length || picked.length) {
    const weekend = isWeekend(request.durationAnswer);
    const span = weekend ? 'weekend' : '1 day';
    let named = items.filter((i) => i.kind === 'game').map((i) => i.name);
    const extras = new Set(items.filter((i) => i.kind === 'extra').map((i) => i.slug));
    // A ticked bundle asks for its slots: its extras, and enough games to fill it.
    let wanted = 0;
    for (const b of picked) { b.items.forEach((s) => extras.add(s)); wanted += b.games; }
    const slots = Math.max(named.length, Math.min(wanted, table.gameNames.length));
    if (slots > named.length) named = gameList(named, slots, table);
    const open = Math.max(0, slots - named.length);
    if (!named.length && !open && !extras.size) {
      lines.push({ description: `Game rental (${span})`, qty: 1, unit_cents: weekend ? table.weekendCents : table.dayCents, note: '', refundable: 0 });
    } else {
      const plan = cheapestPlan(named.length + open, [...extras], table, weekend);
      const queue = [...named, ...Array(open).fill(null)];
      const take = (n) => {
        const got = queue.splice(0, n);
        const real = got.filter(Boolean); const choice = got.length - real.length;
        return [...real, ...(choice ? [`${choice} ${choice === 1 ? 'game' : 'games'} of your choice`] : [])];
      };
      const byName = (slug) => table.items.find((i) => i.slug === slug).name;
      for (const p of plan.picks.filter((x) => x.bundle)) {
        const b = p.bundle;
        const what = [...b.items.map(byName), ...take(b.games)];
        lines.push({ description: `${b.name} bundle, ${span}: ${what.join(', ')}`, qty: 1, unit_cents: weekend ? b.weekendCents : b.dayCents, note: '', refundable: 0 });
      }
      for (const p of plan.picks.filter((x) => x.game)) {
        const [name] = take(1);
        lines.push({ description: `${/of your choice/.test(name) ? 'Game of your choice' : name} (${span})`, qty: 1, unit_cents: weekend ? table.weekendCents : table.dayCents, note: '', refundable: 0 });
      }
      for (const p of plan.picks.filter((x) => x.extra)) {
        lines.push({ description: `${p.extra.name} (${span})`, qty: 1, unit_cents: weekend ? p.extra.weekendCents : p.extra.dayCents, note: '', refundable: 0 });
      }
    }
    lines.push({ description: 'Damage deposit (refundable)', qty: 1, unit_cents: table.damageDepositCents, note: 'Refunded at return if everything comes back undamaged', refundable: 1 });
  }
  const porch = porchPrefill(request, table);
  lines.push(...porch.lines);
  // The decor line for party / grazing (and old form rows); a site porch-only request is
  // fully covered by its package lines.
  const otherDecor = (request.services || []).some((k) => k === 'party' || k === 'grazing');
  if (request.wantsDecor && (!porch.lines.length || otherDecor)) {
    const what = request.eventType && !porch.lines.length ? `Decor: ${request.eventType}` : 'Decor setup';
    lines.push({ description: what, qty: 1, unit_cents: 0, note: '', refundable: 0 }); // $0 = price needed; the send screen asks for it
    if (saidYes(request.takedownAnswer)) {
      lines.push({ description: 'Takedown', qty: 1, unit_cents: table.takedownCents, note: '', refundable: 0 });
    }
  }
  return lines;
}

// The porch package lines (and any warnings) for a request; empty without a package season.
export function porchPrefill(request, table) {
  if (!table.porchPackages || !request || !request.porchSeason) return { lines: [], warnings: [] };
  return PP.invoiceLines(table.porchPackages, { season: request.porchSeason, decor: request.porchDecor, both: request.porchBoth });
}

// A rental invoice is one with any line from the rentals price table: an item,
// a bundle, the "Game rental" fallback or the rentals damage deposit. Derived
// from the saved lines, so an invoice edited later is judged as it stands.
export function isRentalInvoice(lines, table) {
  const starts = [...table.items.map((i) => i.name), ...table.bundles.map((b) => `${b.name} bundle`), 'Game rental', 'Game of your choice', 'Damage deposit']
    .map((s) => s.toLowerCase());
  return (lines || []).some((l) => starts.some((s) => String(l.description || '').toLowerCase().startsWith(s)));
}

// The line rental invoices carry under the pay box (email, PDF, text, invoice page).
export function pickupNote(lines, table) {
  return isRentalInvoice(lines, table) ? table.pickupLine : '';
}
