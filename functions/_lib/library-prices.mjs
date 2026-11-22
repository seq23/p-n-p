// The Design Library's porch prices, from data/offers/porch_packages.json (21 Nov 2026).
//
// The library is copied from a research build (scripts/admin/library_sync.mjs) that still carried
// the retired 17 Oct porch tiers (Standard, Large, Grand Holiday) and the fall Stoop price on
// Christmas designs. Valerie quotes from /designs, so every porch
// package named in the library is rendered here, at serve time, from the one price file: a re-sync
// cannot bring a typed price back, and a price change in the data moves the library with it.
//
//   porchFits(design)  the "Fits:" line of a porch design, from its season and its lo/hi range
//   pricedLibrary(lib) the library with every porch-package line rendered from the data
import PK from '../../data/offers/porch_packages.json';

const money = (n) => `$${Number(n).toLocaleString('en-US')}`;

/** Christmas pricing for a winter or Christmas design, fall pricing (the site's floor) for the rest. */
export function seasonOf(design, pk = PK) {
  const christmas = /christmas|winter|holiday/i.test(`${design.g || ''} ${(design.occ || []).join(' ')}`);
  return pk.seasons.find((s) => s.key === (christmas ? 'christmas' : 'fall'));
}

function tiersOf(season, pk) {
  return pk.tierOrder.map((k) => ({ key: k, name: pk.tiers[k].name, from: season.tiers[k].from }));
}

/** "<Season> <Tier> (from $N)"; fall designs say "Fall", other occasions use the fall grid unnamed. */
function label(design, season, tier) {
  const named = season.key === 'christmas' || /fall|halloween|thanksgiving/i.test(design.g || '');
  return `${named ? `${season.short} ` : ''}${tier.name} (from ${money(tier.from)})`;
}

export function porchFits(design, pk = PK) {
  const season = seasonOf(design, pk);
  const tiers = tiersOf(season, pk);
  const lo = Number(design.lo) || 0;
  const hi = Number(design.hi) || lo;
  if (hi < tiers[0].from) return `Add-on or mini: below the ${label(design, season, tiers[0])} minimum; sell on top of any porch package`;
  let at = 0;
  tiers.forEach((t, i) => { if (t.from <= Math.max(lo, tiers[0].from)) at = i; });
  const next = tiers[at + 1];
  return next && hi >= next.from
    ? `${label(design, season, tiers[at])}, or ${label(design, season, next)} for the fuller version`
    : label(design, season, tiers[at]);
}

/** Grand from-prices for both seasons, for a balloon piece sized against a porch. */
function grandBoth(pk) {
  const g = pk.tierOrder.find((k) => k === 'grand') || pk.tierOrder[pk.tierOrder.length - 2];
  return `${pk.tiers[g].name} porch (from ${pk.seasons.map((s) => `${money(s.tiers[g].from)} ${s.short}`).join(', ')})`;
}

export function pricedLibrary(lib, pk = PK) {
  const designs = lib.designs.map((d) => {
    if (d.sec === 'porches') return { ...d, pkg: porchFits(d, pk) };
    if (d.sec === 'balloons' && /Grand Porch/.test(d.pkg || '')) return { ...d, pkg: d.pkg.replace(/the \$[\d,]+ Grand Porch/g, `the ${grandBoth(pk)}`) };
    return d;
  });
  const packages = pk.seasons.map((s) => `${s.short} ${tiersOf(s, pk).map((t) => `${t.name.toLowerCase()} ${money(t.from)}`).join(' / ')}`).join('; ');
  const porchRules = (lib.porchRules || []).map((r) => (/^P&P |P&P stoop/.test(r.how || '')
    ? { ...r, how: r.how.replace(/P&P stoop[^.]*\./, `P&P porch packages (${packages}) sit inside that range.`) }
    : r));
  return { ...lib, designs, porchRules };
}
