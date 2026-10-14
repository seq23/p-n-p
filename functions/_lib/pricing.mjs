// Invoice price logic for the /admin console. Pure: every number comes from the
// table argument, and the table is built only from data/rentals/games.json and
// data/offers/services.json (functions/_lib/prices.mjs). validate:admin-prices
// runs this module against the data files AND against a perturbed copy, so a
// price typed into this file instead of read from the table fails the build.

export function buildPriceTable(games, services) {
  const takedown = services && services.addOns && services.addOns.takedown;
  return {
    dayCents: Math.round(games.rates.day * 100),
    weekendCents: Math.round(games.rates.weekend * 100),
    bundles: (games.bundles || []).map((b) => ({ name: b.name, games: b.games, dayCents: Math.round(b.dayPrice * 100) })),
    deliveryCents: Math.round(games.delivery.fee * 100),
    freeDeliveryFromCents: Math.round(games.delivery.freeOver * 100),
    damageDepositCents: Math.round(games.damageDeposit * 100),
    takedownCents: Math.round(takedown.fromPrice * 100),
    gameNames: (games.games || []).map((g) => g.name),
  };
}

function dollars(cents) {
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

// Cheapest way to price n one-day games with singles and bundles. Bundles are
// "pick N", so any N of the chosen games fill one.
export function cheapestDayPlan(n, table) {
  const cost = [0]; const choice = [null];
  for (let k = 1; k <= n; k += 1) {
    cost[k] = cost[k - 1] + table.dayCents; choice[k] = null;
    for (const b of table.bundles) {
      if (b.games <= k && cost[k - b.games] + b.dayCents < cost[k]) { cost[k] = cost[k - b.games] + b.dayCents; choice[k] = b; }
    }
  }
  const bundles = []; let k = n; let singles = 0;
  while (k > 0) {
    const b = choice[k];
    if (b) { bundles.push(b); k -= b.games; } else { singles += 1; k -= 1; }
  }
  return { bundles, singles, totalCents: cost[n] };
}

export function matchGames(answer, table) {
  const text = String(answer || '').toLowerCase();
  if (!text) return [];
  const norm = (s) => s.toLowerCase().replace(/\bset\b/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const hay = ` ${norm(text)} `;
  return table.gameNames.filter((name) => hay.includes(` ${norm(name)} `));
}

export function isWeekend(answer) {
  return /weekend/i.test(String(answer || ''));
}

export function saidYes(answer) {
  return /^\s*(yes|y|yeah|yep|please|sure)\b/i.test(String(answer || ''));
}

// Lines for a new invoice, prefilled from one form request. Every line stays editable.
// A $0 line is "price needed" unless its note is 'free' (the free-delivery line).
export function prefillLines(request, table) {
  const lines = [];
  const games = matchGames(request.gamesAnswer, table);
  if (request.wantsRentals || games.length) {
    let gamesCents = 0;
    if (games.length && isWeekend(request.durationAnswer)) {
      for (const name of games) {
        lines.push({ description: `${name} (weekend)`, qty: 1, unit_cents: table.weekendCents, note: '', refundable: 0 });
        gamesCents += table.weekendCents;
      }
    } else if (games.length) {
      const plan = cheapestDayPlan(games.length, table);
      let i = 0;
      for (const b of plan.bundles) {
        const picked = games.slice(i, i + b.games); i += b.games;
        lines.push({ description: `${b.name} bundle, 1 day: ${picked.join(', ')}`, qty: 1, unit_cents: b.dayCents, note: '', refundable: 0 });
      }
      for (const name of games.slice(i)) {
        lines.push({ description: `${name} (1 day)`, qty: 1, unit_cents: table.dayCents, note: '', refundable: 0 });
      }
      gamesCents = plan.totalCents;
    } else {
      lines.push({ description: 'Game rental (1 day)', qty: 1, unit_cents: table.dayCents, note: '', refundable: 0 });
      gamesCents = table.dayCents;
    }
    if (gamesCents >= table.freeDeliveryFromCents) {
      lines.push({ description: `Delivery and pickup (free on orders of ${dollars(table.freeDeliveryFromCents)}+)`, qty: 1, unit_cents: 0, note: 'free', refundable: 0 });
    } else {
      lines.push({ description: 'Delivery and pickup', qty: 1, unit_cents: table.deliveryCents, note: '', refundable: 0 });
    }
    lines.push({ description: 'Damage deposit (refundable)', qty: 1, unit_cents: table.damageDepositCents, note: 'Refunded after pickup if everything comes back undamaged', refundable: 1 });
  }
  if (request.wantsDecor) {
    const what = request.eventType ? `Decor: ${request.eventType}` : 'Decor setup';
    lines.push({ description: what, qty: 1, unit_cents: 0, note: '', refundable: 0 }); // $0 = price needed; the send screen asks for it
    if (saidYes(request.takedownAnswer)) {
      lines.push({ description: 'Takedown', qty: 1, unit_cents: table.takedownCents, note: '', refundable: 0 });
    }
  }
  return lines;
}
