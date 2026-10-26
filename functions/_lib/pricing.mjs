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
import INV from '../../scripts/lib/inventory.js';
import { rentalLength, rentalSpanWords, isPhone } from './phone-requests.mjs';

export function buildPriceTable(source, services, porchPackages = null) {
  // Resolved first (scripts/lib/inventory.js): the all-games bundles take every available public
  // game at its quantity, and a bundle whose items are removed is not offered (owner, 18 Oct 2026).
  const games = INV.resolve(source);
  const takedown = services && services.addOns && services.addOns.takedown;
  const cents = (d) => Math.round(d * 100);
  const deposit = (i) => cents(INV.depositOf(games, i));
  const items = [
    ...(games.games || []).filter((g) => g.availableNow).map((g) => ({
      slug: g.slug, name: g.name, choice: g.formChoice, kind: 'game', quantity: g.quantity || 1, sets: INV.setsOf(g), perSet: INV.perSetOf(g), dayCents: cents(games.rates.day), weekendCents: cents(games.rates.weekend), depositCents: deposit(g),
    })),
    ...(games.extras || []).filter((x) => x.availableNow).map((x) => ({
      slug: x.slug, name: x.name, choice: x.formChoice, kind: 'extra', quantity: x.quantity || 1, dayCents: cents(x.dayPrice), weekendCents: cents(x.weekendPrice), depositCents: deposit(x),
    })),
  ];
  const pickup = games.pickup || {};
  // The website's "from" prices (services.json "$300+"): the auto draft's starting line for party
  // & decor and for grazing styling (owner-approved 20 Oct 2026), never typed here.
  const fromOf = (k) => { const v = services && services.services && services.services[k]; const n = Number(String((v && v.price) || '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? cents(n) : 0; };
  return {
    celebrationFromCents: fromOf('celebration'),
    // The room setup presets (owner-approved 25 Oct 2026): services.json
    // services.celebration.roomSetupPresets, the one definition of their words, prices and notes.
    // Each note entry is its own row of the line note. The first (Basic, one line) is the auto
    // draft's room setup starting line, roomSetup.
    roomSetupPresets: roomPresetsOf(services, cents),
    roomSetup: (() => { const b = roomPresetsOf(services, cents)[0]; return b && b.lines.length === 1 ? { description: b.lines[0].description, cents: b.lines[0].unit_cents } : null; })(),
    grazingFromCents: fromOf('grazing'),
    dayCents: cents(games.rates.day),
    weekendCents: cents(games.rates.weekend),
    items,
    bundles: INV.offeredBundles(games).map((b) => ({
      slug: b.slug, name: b.name, choice: b.formChoice, games: b.games, items: b.items || [],
      dayCents: cents(b.dayPrice), weekendCents: b.weekendPrice == null ? null : cents(b.weekendPrice),
    })),
    damageDepositCents: cents(games.damageDeposit),
    takedownCents: cents(takedown.fromPrice),
    // The rental invoice note's phone (invoice-note.mjs rentalNote words it per invoice).
    pickupPhone: String(pickup.phone || ''),
    pickupPlace: String(pickup.place || '').split(',')[0],
    // The invoice text message names the police station in full (owner, 24 Oct 2026), from the
    // same games.json pickup the site and FAQ read: "Mt. Moriah Station, Memphis Police
    // Department, 2602 Mt. Moriah Rd, Memphis, TN 38115".
    pickupWhere: [pickup.place, pickup.address].filter(Boolean).join(', '),
    gameNames: items.filter((i) => i.kind === 'game').map((i) => i.name),
    // The games an all-games bundle counts (owner, 18 Oct 2026: "the 6 games" are both Giant
    // Color Stack sets + four others), so a game with bundleSets 2 fills two of its slots.
    gameSlots: items.filter((i) => i.kind === 'game').reduce((n, i) => n + i.sets, 0),
    porchPackages,
  };
}

// The calendar's item list (Calendar & Bookings, games out, availability, the booking form):
// every priced item plus games.json "adminItems" ({ slug, name, quantity, admin_only: true }),
// which no public generator reads. Same object otherwise, so prices never come from here.
export function buildTrackTable(table, games) {
  const extra = (games.adminItems || []).filter((x) => x.admin_only && x.availableNow !== false)
    .map((x) => ({ slug: x.slug, name: x.name, choice: x.name, kind: 'admin', quantity: x.quantity || 1, dayCents: 0, weekendCents: 0, adminOnly: true }));
  // Removed items (availableNow false, Settings -> Inventory "Remove") stay tracked so a booking
  // made before the removal still lists them on its Day sheet and check-in; removed: true keeps
  // them out of every picker, every bundle and the public pages.
  const KIND = { games: 'game', extras: 'extra', adminItems: 'admin' };
  const gone = ['games', 'extras', 'adminItems'].flatMap((s) => (games[s] || []).filter((x) => x.availableNow === false)
    .map((x) => ({ slug: x.slug, name: x.name, choice: x.formChoice || x.name, kind: KIND[s], quantity: x.quantity || 1, dayCents: 0, weekendCents: 0, removed: true, ...(s === 'adminItems' ? { adminOnly: true } : {}) })));
  const items = [...table.items, ...extra.filter((x) => !table.items.some((i) => i.slug === x.slug))];
  return { ...table, items: [...items, ...gone.filter((x) => !items.some((i) => i.slug === x.slug))] };
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
    // Booked pickup + return days that span 2 or more days (not the weekend) say so on the
    // line: "pickup Sun 18 Oct, back Tue 20 Oct (2 days)" (owner, 18 Oct 2026). The price stays
    // the day price; she changes it if she charges more.
    const booked = request.rentalPickup && request.rentalReturn ? rentalLength(request.rentalPickup, request.rentalReturn) : null;
    const span = booked && booked.days >= 2 && !booked.weekend ? rentalSpanWords(request.rentalPickup, request.rentalReturn) : (weekend ? 'weekend' : '1 day');
    let named = items.filter((i) => i.kind === 'game').map((i) => i.name);
    const extras = new Set(items.filter((i) => i.kind === 'extra').map((i) => i.slug));
    // A ticked bundle asks for its slots: its extras, and enough games to fill it.
    let wanted = 0;
    for (const b of picked) { b.items.forEach((s) => extras.add(s)); wanted += b.games; }
    const slots = Math.max(named.length, Math.min(wanted, table.gameNames.length));
    if (slots > named.length) named = gameList(named, slots, table);
    const open = Math.max(0, slots - named.length);
    if (!named.length && !open && !extras.size) {
      lines.push({ description: `Game rental (${span})`, qty: 1, unit_cents: weekend ? table.weekendCents : table.dayCents, note: '', refundable: 0, auto: 'rental' });
    } else {
      let plan = cheapestPlan(named.length + open, [...extras], table, weekend);
      const queue = [...named, ...Array(open).fill(null)];
      // Every game named: an all-games bundle (Whole Yard, The Whole Party) also carries the
      // second set of a multi-set game. Used when it was asked for or costs no more.
      const units = table.gameSlots || table.gameNames.length;
      if (units > queue.length && named.length >= table.gameNames.length) {
        const all = cheapestPlan(units, [...extras], table, weekend);
        if (all && (wanted >= units || all.cents <= plan.cents)) {
          plan = all;
          for (const i of table.items.filter((x) => x.kind === 'game' && x.sets > 1)) for (let k = 1; k < i.sets; k += 1) queue.push(i.name);
        }
      }
      const sets = (list) => list.filter((n, k) => list.indexOf(n) === k).map((n) => { const c = list.filter((x) => x === n).length; return c > 1 ? `${n} (${INV.countWords(c, (table.items.find((i) => i.name === n) || {}).perSet)})` : n; });
      const take = (n) => {
        const got = queue.splice(0, n);
        const real = got.filter(Boolean); const choice = got.length - real.length;
        return [...real, ...(choice ? [`${choice} ${choice === 1 ? 'game' : 'games'} of your choice`] : [])];
      };
      const byName = (slug) => table.items.find((i) => i.slug === slug).name;
      for (const p of plan.picks.filter((x) => x.bundle)) {
        const b = p.bundle;
        const what = [...b.items.map(byName), ...sets(take(b.games))];
        lines.push({ description: `${b.name} bundle, ${span}: ${what.join(', ')}`, qty: 1, unit_cents: weekend ? b.weekendCents : b.dayCents, note: '', refundable: 0, auto: 'rental' });
      }
      for (const p of plan.picks.filter((x) => x.game)) {
        const [name] = take(1);
        lines.push({ description: `${/of your choice/.test(name) ? 'Game of your choice' : name} (${span})`, qty: 1, unit_cents: weekend ? table.weekendCents : table.dayCents, note: '', refundable: 0, auto: 'rental' });
      }
      for (const p of plan.picks.filter((x) => x.extra)) {
        lines.push({ description: `${p.extra.name} (${span})`, qty: 1, unit_cents: weekend ? p.extra.weekendCents : p.extra.dayCents, note: '', refundable: 0, auto: 'rental' });
      }
    }
    lines.push({ description: 'Damage deposit (refundable)', qty: 1, unit_cents: orderDepositCents(lines, table), note: 'Refunded at return if everything comes back undamaged', refundable: 1, auto: 'deposit' });
  }
  const porch = porchPrefill(request, table);
  lines.push(...porch.lines.map((l) => ({ ...l, auto: 'porch' })));
  // Party & decor and grazing (owner-approved mock-up, 20 Oct 2026): a starting line at the
  // website's "from" price ("Starting price from your price list") with their answers in the note,
  // and for grazing a "Food (at cost)" line, price needed, when they asked us to source the food.
  // An old form row with no service ticks keeps the one $0 decor line; a porch-only request is
  // fully covered by its package lines.
  const svc = request.services || [];
  const party = svc.includes('party'); const grazing = svc.includes('grazing');
  if (request.wantsDecor && (!porch.lines.length || party || grazing)) {
    if (party || grazing) {
      const a = serviceAnswers(request);
      const note = (x) => [x.where, x.guests ? `${x.guests} guests` : '', x.budget ? `budget ${x.budget}` : ''].filter(Boolean).join(' · ');
      // A room setup (hotel room, suite, Airbnb, bedroom; owner, 25 Oct 2026) starts at the basic
      // room setup line from the price table instead of the "Party decor" line.
      if (party && table.roomSetup && isRoomSetup(request, a)) lines.push({ description: table.roomSetup.description, qty: 1, unit_cents: table.roomSetup.cents, note: note(a.party), refundable: 0, auto: 'start' });
      else if (party) lines.push({ description: `Party decor${a.party.event ? `: ${a.party.event}` : ''}`, qty: 1, unit_cents: table.celebrationFromCents || 0, note: note(a.party), refundable: 0, auto: 'start' });
      if (grazing) {
        lines.push({ description: `Grazing table styling${a.grazing.event ? `: ${a.grazing.event}` : ''}`, qty: 1, unit_cents: table.grazingFromCents || 0, note: note(a.grazing), refundable: 0, auto: 'start' });
        if (/^yes/i.test(a.grazing.food)) lines.push({ description: 'Food (at cost)', qty: 1, unit_cents: 0, note: '', refundable: 0, auto: 'food' }); // $0 = price needed
      }
    } else {
      const what = request.eventType && !porch.lines.length ? `Decor: ${request.eventType}` : 'Decor setup';
      lines.push({ description: what, qty: 1, unit_cents: 0, note: '', refundable: 0 }); // $0 = price needed; the send screen asks for it
    }
    // Takedown when they said yes (a phone booking with its takedown on the calendar said yes too).
    if ((party || !grazing) && (saidYes(request.takedownAnswer) || (isPhone(request) && request.takedownPlan === 'scheduled'))) {
      lines.push({ description: 'Takedown', qty: 1, unit_cents: table.takedownCents, note: '', refundable: 0, auto: 'takedown' });
    }
  }
  return lines;
}

function roomPresetsOf(services, cents) {
  const list = services && services.services && services.services.celebration && services.services.celebration.roomSetupPresets;
  return (Array.isArray(list) ? list : []).map((p) => {
    const lines = (p.lines || []).map((l) => ({ description: String(l.description), qty: 1, unit_cents: cents(Number(l.price) || 0), note: (Array.isArray(l.note) ? l.note : [l.note || '']).filter(Boolean).join('\n'), refundable: 0 }));
    return { key: String(p.key), name: String(p.name), includesTakedown: Boolean(p.includesTakedown), declaredCents: cents(Number(p.total) || 0), totalCents: lines.reduce((t, l) => t + l.unit_cents, 0), lines };
  }).filter((p) => p.lines.length);
}

// "Room setup presets" on the unsent invoice editor (owner, 25 Oct 2026). Pure and written in
// plain ES5 so the editor runs this exact source in the browser (views.mjs EDITOR_JS): given the
// descriptions of the lines on the invoice, which ones a preset takes out (every room setup preset
// line; a separate Takedown line too when the preset includes takedown) and where its lines go
// (where the first room setup line was, else at the top). Every other line stays.
export function roomPresetPlan(descs, presets, key) {
  var p = null; var room = {}; var i; var j;
  for (i = 0; i < presets.length; i += 1) { if (presets[i].key === key) p = presets[i]; for (j = 0; j < presets[i].lines.length; j += 1) room[String(presets[i].lines[j].description).trim().toLowerCase()] = 1; }
  if (!p) return null;
  var remove = []; var takedown = []; var at = -1; var kept = 0;
  for (i = 0; i < descs.length; i += 1) {
    var d = String(descs[i] || '').trim().toLowerCase();
    if (room[d]) { if (at < 0) at = kept; remove.push(i); } else if (p.includesTakedown && (d === 'takedown' || d === 'setup / takedown fee')) { remove.push(i); takedown.push(i); } else kept += 1;
  }
  return { remove: remove, takedown: takedown, at: at < 0 ? 0 : at, add: p.lines, totalCents: p.totalCents, name: p.name };
}

// The same plan on saved lines -> the invoice's new lines (the preset's lines are ordinary hand
// lines: a later rebuild keeps them, reconcileRoomPreset).
export function applyRoomPreset(lines, presets, key) {
  const plan = roomPresetPlan(lines.map((l) => l.description), presets, key);
  if (!plan) return lines;
  const kept = lines.filter((l, i) => !plan.remove.includes(i));
  return [...kept.slice(0, plan.at), ...plan.add.map((l) => ({ ...l })), ...kept.slice(plan.at)];
}

// rebuildAutoDraft: when the lines kept by hand already carry a room setup preset, the fresh
// prefill does not add the Basic line again, nor a Takedown the kept preset already includes.
export function reconcileRoomPreset(fresh, kept, presets) {
  const of = (l) => String(l.description || '').trim().toLowerCase();
  const room = new Map(); for (const p of presets || []) for (const l of p.lines) room.set(of(l), p);
  const held = kept.map((l) => room.get(of(l))).filter(Boolean);
  if (!held.length) return fresh;
  const takedown = held.some((p) => p.includesTakedown);
  return fresh.filter((l) => !room.has(of(l)) && !(takedown && (of(l) === 'takedown' || of(l) === 'setup / takedown fee')));
}

// A party request for a room setup: its "Where is it?" names a hotel, motel, Airbnb, suite, bedroom
// or a room (not a living / dining / ball / party / event room, a home or a venue, even in a hotel), or its
// event type says "hotel room" or "room setup". Porches, grazing and rentals never reach this.
const ROOM_WHERE = /\b(hotels?|motels?|airbnbs?|air bnb|suites?|bedrooms?|rooms?)\b/i;
const NOT_A_ROOM = /\b(living|dining|family|ball|banquet|conference|meeting|party|event|community|game|rec|recreation|board|break|club|show|class)\s?rooms?\b/i;
const ROOM_EVENT = /\bhotel\s+room\b|\broom\s+set\s?-?up\b/i;
export function isRoomSetup(request, answers = serviceAnswers(request)) {
  const where = String((answers && answers.party && answers.party.where) || '');
  const event = [answers && answers.party && answers.party.event, request && request.eventType].filter(Boolean).join(' ');
  if (ROOM_EVENT.test(event)) return true;
  return ROOM_WHERE.test(where) && !NOT_A_ROOM.test(where);
}

// The party and grazing answers of one request, apart (both ask "How many guests?" and "Budget",
// party first, as the form lists them): { party: { event, where, guests, budget }, grazing:
// { event, guests, food, budget } }. "Not sure yet" says nothing, so it is left out.
export function serviceAnswers(request) {
  const out = { party: { event: '', where: '', guests: '', budget: '' }, grazing: { event: '', guests: '', food: '', budget: '' } };
  const svc = request.services || [];
  let cur = svc.includes('party') ? 'party' : (svc.includes('grazing') ? 'grazing' : '');
  let seenEvent = false;
  for (const x of request.decor || []) {
    const label = String(x.label || ''); const value = String(x.value || '').trim();
    if (/event type/i.test(label)) { if (seenEvent && cur === 'party' && svc.includes('grazing')) cur = 'grazing'; seenEvent = true; }
    if (!cur || !value || /^not sure/i.test(value)) continue;
    const o = out[cur];
    if (/event type/i.test(label)) o.event = o.event || value;
    else if (/^where is it/i.test(label) && cur === 'party') o.where = value;
    else if (/^how many guests/i.test(label)) o.guests = value;
    else if (/^budget$/i.test(label)) o.budget = value;
    else if (/source the food/i.test(label) && cur === 'grazing') o.food = value;
  }
  if (!out.party.event && svc.includes('party') && request.eventType) out.party.event = request.eventType;
  if (!out.grazing.event && svc.includes('grazing') && !svc.includes('party') && request.eventType) out.grazing.event = request.eventType;
  return out;
}

// One refundable deposit per order: the biggest deposit among the items its lines name (an item
// carries the standard damageDeposit unless Settings -> Inventory gave it its own). A line naming
// no item ("Game of your choice", "Game rental") counts at the standard deposit.
export function orderDepositCents(lines, table) {
  let best = 0; let unnamed = false; let found = false;
  for (const l of lines || []) {
    if (l.refundable) continue;
    const d = String(l.description || '').toLowerCase();
    const hits = table.items.filter((i) => d.includes(i.name.toLowerCase()));
    if (!hits.length || /of your choice|game rental/.test(d)) unnamed = true;
    for (const i of hits) { found = true; best = Math.max(best, i.depositCents == null ? table.damageDepositCents : i.depositCents); }
  }
  if (unnamed || !found) best = Math.max(best, table.damageDepositCents);
  return best;
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

// The line rental invoices carry under the pay box (email, PDF, text, invoice page) is worded per
// invoice in functions/_lib/invoice-note.mjs (rentalNote).
