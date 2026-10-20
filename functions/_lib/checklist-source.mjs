// The checklist file, bundled into the Functions as text (never served as a static file).
import source from './assets/walkthrough-checklist.html.txt';
import INV from '../../scripts/lib/inventory.js';
import { GAMES } from './prices.mjs';

// The owner-approved wording, as printed for the seed inventory.
export const CHECKLIST_SOURCE = source;

// Page 4 ("Game rentals") follows Settings -> Inventory (18 Oct 2026): the item list, the bundle
// prices, the game and extra prices and the deposit come from the live inventory. With the seed
// inventory this returns the approved file byte for byte (validate:admin-inventory proves it); an
// item keeps its checkbox id (its words), so a saved checklist keeps its ticks.
const SEED_EXTRA_WORDS = { 'inflatable-movie-screen': 'screen', 'card-table': 'card table' };
const money = (n) => `$${n}`;

export function liveChecklistSource(data = GAMES, src = source) {
  const g = INV.resolve(data);
  const [head, page4] = [src.split('<!-- PAGE 4')[0], src.split('<!-- PAGE 4')[1]];
  if (page4 === undefined) return src;
  let p = page4;
  const bundles = INV.offeredBundles(g).map((b) => `${b.name.replace(/^The /, '')} ${money(b.dayPrice)}${b.weekendPrice != null ? ` / ${money(b.weekendPrice)} weekend` : ''}`);
  p = p.replace(/(<h2>Game rentals <small>blank if none)[^<]*(<\/small><\/h2>)/, (m, a, b) => `${a}${bundles.map((x) => ` · ${x}`).join('')}${b}`);
  // The item list: the approved order for items it already names, new ones after, in data order.
  p = p.replace(/(<h2>Game rentals[\s\S]*?<ul class="ck" style="columns:4">)([\s\S]*?)(\n  <\/ul>)/, (m, a, list, z) => {
    const label = (i, section) => {
      const base = String(i.formChoice || i.name).replace(/ set$/i, '');
      return section === 'games' && i.quantity > 1 ? `${base} (${INV.countWords(i.quantity, INV.perSetOf(i))})` : base;
    };
    const want = [...INV.publicGames(g).map((i) => label(i, 'games')), ...INV.publicExtras(g).map((i) => label(i, 'extras'))];
    const esc = (s) => s.replace(/&/g, '&amp;');
    const old = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => x[1]);
    const ordered = [...old.filter((o) => want.map(esc).includes(o)), ...want.map(esc).filter((w) => !old.includes(w))];
    return `${a}${ordered.map((o) => `\n    <li>${o}</li>`).join('')}${z}`;
  });
  p = p.replace(/Day \(\$\d+ each\) or weekend \(\$\d+ each\)/, `Day (${money(g.rates.day)} each) or weekend (${money(g.rates.weekend)} each)`);
  const extras = INV.publicExtras(g).map((x) => `${SEED_EXTRA_WORDS[x.slug] || x.short || x.name.toLowerCase()} ${money(x.dayPrice)} / ${money(x.weekendPrice)}`);
  p = p.replace(/<td>Rentals \(×\$\d+ day \/ ×\$\d+ weekend[^)]*\)<\/td>/, `<td>Rentals (×${money(g.rates.day)} day / ×${money(g.rates.weekend)} weekend${extras.map((e) => `; ${e}`).join('')})</td>`);
  p = p.replace(/\$\d+ damage deposit \+ \d+% holds the date/, `${money(g.damageDeposit)} damage deposit + ${g.holdPercent}% holds the date`);
  return `${head}<!-- PAGE 4${p}`;
}
