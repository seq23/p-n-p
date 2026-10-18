'use strict';
/**
 * Porch packages (owner-approved 18 Oct 2026): every word and number comes from
 * data/offers/porch_packages.json, passed in as `pk`. Pure, no requires, so the
 * Node generators (require) and the Pages Functions (import, bundled by
 * wrangler/esbuild) render the SAME markup:
 *
 *   gridHtml        the full price grid (both seasons, inclusions, custom-design
 *                   line, unpriced add-ons, bundle, rough-estimate line). The
 *                   porch service pages, /pricing and the porch articles carry it
 *                   (scripts/install_porch_packages.js); the admin Porch packages
 *                   screen renders the same function.
 *   calculatorHtml  the FAQ "Price my porch" calculator (faq/#porch-picker): a
 *                   season toggle, the grid, the size hint, "Request this package".
 *   schemaNode      Service + OfferCatalog with a PriceSpecification minPrice per
 *                   tier and season (JSON-LD).
 *   formRangeLines  the ONLY prices the /request form shows: the from-price and
 *                   the range per season, never a tier price.
 *   cardLine / invoiceLines  the admin card sentence and the invoice prefill.
 *
 * npm run validate:porch-packages renders all of these from the data file and from
 * a perturbed copy, so a price typed anywhere else fails.
 */

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => `$${Number(n).toLocaleString('en-US')}`;

const tierKeys = (pk) => pk.tierOrder.slice();
const seasonOf = (pk, key) => pk.seasons.find((s) => s.key === key) || null;
const priceOf = (pk, seasonKey, tierKey) => {
  const s = seasonOf(pk, seasonKey);
  return s && s.tiers[tierKey] ? s.tiers[tierKey].from : null;
};
const lowHigh = (season, pk) => {
  const prices = tierKeys(pk).map((t) => season.tiers[t].from);
  return [Math.min(...prices), Math.max(...prices)];
};

/** "from $LOW (most fall porches $LOW–$HIGH)" */
function rangeLine(pk, seasonKey) {
  const s = seasonOf(pk, seasonKey);
  const [lo, hi] = lowHigh(s, pk);
  return `from ${money(lo)} (most ${s.rangeNoun} ${money(lo)}–${money(hi)})`;
}
/** ["Fall / Halloween: from $LOW (most fall porches $LOW–$HIGH)", ...] */
const formRangeLines = (pk) => pk.seasons.map((s) => `${s.name}: ${rangeLine(pk, s.key)}`);

/** The form's decor answers: [[value, label], ...] in tier order, then "Not sure". */
const decorChoices = (pk) => [...tierKeys(pk).map((t) => [t, pk.tiers[t].formAnswer]), ['not_sure', pk.form.notSure]];

/** The tier a stored answer names ('' for "Not sure" or nothing). */
function tierFromAnswer(pk, answer) {
  const a = String(answer || '').trim();
  if (!a) return '';
  for (const t of tierKeys(pk)) {
    if (a === t || a === pk.tiers[t].formAnswer) return t;
    if (new RegExp(`\\bour ${pk.tiers[t].name} package\\b`, 'i').test(a)) return t;
  }
  return '';
}
/** The package season a season answer names ('' for spring, birthday, other). */
function seasonFromAnswer(pk, answer) {
  const a = String(answer || '').trim();
  if (!a) return '';
  for (const s of pk.seasons) if (a === s.key || a === s.formChoice || a === s.name) return s.key;
  if (/christmas|holiday|winter/i.test(a)) return 'christmas';
  if (/fall|halloween|thanksgiving|autumn/i.test(a)) return 'fall';
  return '';
}
const otherSeason = (pk, key) => (pk.seasons.find((s) => s.key !== key) || {}).key || '';

/**
 * The admin card sentence, e.g. "Fall · picturing a full porch (Classic, from $N)".
 * `both` adds the bundle. Returns '' when the request names no package season.
 */
function cardLine(pk, { season: seasonAnswer, decor: decorAnswer, both } = {}) {
  const sk = seasonFromAnswer(pk, seasonAnswer);
  const tk = tierFromAnswer(pk, decorAnswer);
  const label = sk ? seasonOf(pk, sk).short : String(seasonAnswer || '').trim();
  if (!label) return '';
  let out = label;
  if (tk) {
    const from = sk ? `, from ${money(priceOf(pk, sk, tk))}` : '';
    out += ` · picturing ${pk.tiers[tk].picturing} (${pk.tiers[tk].name}${from})`;
  } else if (decorAnswer) out += ' · not sure yet how much decor';
  if (both) out += ` · ${pk.bundle.checkbox.toLowerCase()}: ${pk.bundle.percentOff}% off the ${seasonOf(pk, pk.bundle.appliesTo).short} package`;
  return out;
}

/**
 * Invoice lines for a porch request: the chosen tier at its minimum for the season;
 * with "Book both seasons", the other season's package too and the bundle discount on
 * the Christmas package. Every line stays editable. Returns { lines, warnings }.
 */
function invoiceLines(pk, { season: seasonAnswer, decor: decorAnswer, both } = {}) {
  const sk = seasonFromAnswer(pk, seasonAnswer);
  const tk = tierFromAnswer(pk, decorAnswer);
  const lines = [];
  const warnings = [];
  if (!sk) return { lines, warnings };
  const seasonsWanted = both ? [sk, otherSeason(pk, sk)].filter(Boolean) : [sk];
  for (const key of seasonsWanted) {
    const s = seasonOf(pk, key);
    lines.push({
      description: tk ? `${s.short} porch: ${pk.tiers[tk].name} package` : `${s.short} porch package`,
      qty: 1,
      unit_cents: tk ? Math.round(s.tiers[tk].from * 100) : 0,
      note: tk ? `Starts at the ${pk.tiers[tk].name} minimum. Change it after the walk-through.` : '',
      refundable: 0,
    });
  }
  if (both) {
    const applies = pk.bundle.appliesTo;
    if (tk && priceOf(pk, applies, tk) != null) {
      lines.push({ description: pk.bundle.invoiceLine, qty: 1, unit_cents: -Math.round(priceOf(pk, applies, tk) * pk.bundle.percentOff), note: `${pk.bundle.percentOff}% of the ${seasonOf(pk, applies).short} package. Change it if the package price changes.`, refundable: 0 });
    } else {
      warnings.push(`They want both seasons: take ${pk.bundle.percentOff}% off the ${seasonOf(pk, applies).short} package (add a "${pk.bundle.invoiceLine}" line once you know its price).`);
    }
  }
  if (!tk) warnings.push('They are not sure how much decor yet. Type the package price after the walk-through.');
  return { lines, warnings };
}

// ---- Markup -------------------------------------------------------------------------

const GRID_CSS = `.pkg-grid{margin:18px 0}.pkg-season{margin:0 0 22px}.pkg-season h3{margin:0 0 4px}.pkg-covers{margin:0 0 12px;color:#6b5c52}
.pkg-tiers{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}@media(max-width:900px){.pkg-tiers{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){.pkg-tiers{grid-template-columns:1fr}}
.pkg-tier{background:#fff;border:1px solid #e8dfd4;border-top:4px solid #c2410c;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:6px}.pkg-tier h4{margin:0;font-size:1.2rem}
.pkg-price{margin:0;font-size:1.5rem;font-weight:700;color:#9a3412}.pkg-incl{margin:0;flex:1}.pkg-request{display:inline-block;margin-top:6px;font-weight:600;color:#9a3412}
.pkg-custom,.pkg-addons,.pkg-bundle,.pkg-estimate,.pkg-size{margin:8px 0}.pkg-bundle{font-weight:700}.pkg-estimate{color:#6b5c52}
.pkg-toggle{display:flex;flex-wrap:wrap;gap:8px;border:0;padding:0;margin:0 0 12px}.pkg-toggle legend{font-weight:600;margin-bottom:6px}.pkg-toggle label{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:8px 14px;border:1px solid #c9b8a8;border-radius:999px;cursor:pointer;background:#fff}
.pkg-toggle input{accent-color:#c2410c;width:20px;height:20px}`;

/** The request link for one tier and season (the form preselects both). */
const requestHref = (pk, seasonKey, tierKey) => `/request?service=porch&season=${seasonKey}&decor=${tierKey}#request-form`;

/** One season's four tiers. Identical on public pages, the calculator and admin (links aside). */
function seasonHtml(pk, seasonKey, { links = false, heading = 'h3' } = {}) {
  const s = seasonOf(pk, seasonKey);
  const H = heading; const T = heading === 'h2' ? 'h3' : 'h4';
  const tiers = tierKeys(pk).map((t) => `<article class="pkg-tier" data-tier="${t}"><${T}>${esc(pk.tiers[t].name)}</${T}><p class="pkg-price">${esc(money(s.tiers[t].from))}+</p><p class="pkg-incl">${esc(s.tiers[t].includes)}</p>${links ? `<a class="pkg-request" href="${requestHref(pk, s.key, t)}" data-quote-cta="porch-package">Request this package</a>` : ''}</article>`).join('');
  return `<div class="pkg-season" data-season="${s.key}"><${H}>${esc(s.name)} porch packages</${H}><p class="pkg-covers">${esc(s.covers)}. Prices are from-prices.</p><div class="pkg-tiers">${tiers}</div><p class="pkg-custom">${esc(s.customLine)}</p></div>`;
}

/** The lines under the seasons, the same everywhere. */
const footLines = (pk) => `<p class="pkg-addons">${esc(pk.addOns.line)}</p><p class="pkg-bundle">${esc(pk.bundle.line)}</p><p class="pkg-estimate">${esc(pk.estimateLine)} ${esc(pk.finalQuoteLine)}</p>`;

/** The full grid: both seasons + the shared lines. */
function gridHtml(pk, { links = false, heading = 'h3' } = {}) {
  return `<div class="pkg-grid" data-porch-grid>${pk.seasons.map((s) => seasonHtml(pk, s.key, { links, heading })).join('')}${footLines(pk)}</div>`;
}

/** The block the installer stamps into porch pages, /pricing and porch articles. */
function pageBlockHtml(pk) {
  return `<!--porch-packages--><section class="section" data-porch-packages><div class="container"><style>${GRID_CSS}</style><div class="answer-block"><span class="eyebrow">Porch packages</span><h2>Porch decorating packages and prices</h2><p>Four packages for each season: ${tierKeys(pk).map((t) => pk.tiers[t].name).join(', ')}. Pick the look closest to what you want; every package is customized to your porch. <a href="${pk.form.examplesHref}">Price my porch</a>.</p></div>${gridHtml(pk, { links: true })}<p class="btn-row"><a class="btn-primary" href="/request?service=porch#request-form" data-quote-cta="porch-packages">Request a porch quote</a></p></div></section><!--/porch-packages-->`;
}

/** The FAQ "Price my porch" calculator (first block of /faq/#porch). */
function calculatorHtml(pk) {
  const toggle = `<fieldset class="pkg-toggle" data-pkg-toggle><legend>Which season?</legend>${pk.seasons.map((s, i) => `<label><input type="radio" name="pkg-season" value="${s.key}"${i === 0 ? ' checked' : ''}> ${esc(s.name)}</label>`).join('')}</fieldset>`;
  const js = `<script>(function(){var box=document.getElementById('porch-picker');if(!box)return;var t=box.querySelector('[data-pkg-toggle]');function show(){var r=t.querySelector('input:checked');var k=r?r.value:'';[].slice.call(box.querySelectorAll('[data-season]')).forEach(function(s){s.hidden=s.getAttribute('data-season')!==k;});}t.addEventListener('change',show);show();})();</script>`;
  return `<div class="faq-tool" id="porch-picker"><style>${GRID_CSS}</style><h3>Price my porch</h3>${toggle}<p class="pkg-size">${esc(pk.sizeHint)}</p>${gridHtml(pk, { links: true, heading: 'h3' })}${js}</div>`;
}

/** Service + OfferCatalog JSON-LD: one Offer per season and tier, minPrice from the data. */
function schemaNode(pk, { domain, url }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${domain}/#porch-packages`,
    name: 'Porch decorating packages',
    serviceType: 'Seasonal porch decorating',
    provider: { '@id': `${domain}/#business` },
    url,
    description: `${pk.seasons.map((s) => `${s.name}: ${rangeLine(pk, s.key)}`).join('. ')}. ${pk.bundle.line}`,
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Porch decorating packages',
      itemListElement: pk.seasons.map((s) => ({
        '@type': 'OfferCatalog',
        name: `${s.name} porch packages`,
        itemListElement: tierKeys(pk).map((t) => ({
          '@type': 'Offer',
          name: `${s.short} ${pk.tiers[t].name} porch package`,
          description: s.tiers[t].includes,
          url: `${domain}${requestHref(pk, s.key, t).replace(/#.*$/, '')}`,
          priceCurrency: pk.currency,
          priceSpecification: { '@type': 'PriceSpecification', minPrice: s.tiers[t].from, priceCurrency: pk.currency },
        })),
      })),
    },
  };
}

/** Every tier price as the site prints it ("$550"), for the no-tier-price checks. */
const tierPriceStrings = (pk) => [...new Set(pk.seasons.flatMap((s) => tierKeys(pk).map((t) => money(s.tiers[t].from))))];

// ---- Porch price articles (owner-approved 18 Oct 2026) ------------------------------
// Article drafts in data/queries/query_universe.json never type a price. They carry
// {{tokens}} filled from this data file at render time (templates/page-shell.js), so a
// price change is still one edit in data/offers/porch_packages.json.
//   {{from:fall.classic}} "$N" (the tier price)   {{includes:fall.classic}}   {{request:fall.classic}} the preselecting link
//   {{low:fall}} {{high:fall}}     {{range:fall}} "from $LOW (most fall porches $LOW–$HIGH)"
//   {{custom:fall}} {{season:fall}} {{covers:fall}} {{tier:classic}}
//   {{bundle}} {{bundlePct}} {{addOns}} {{estimate}} {{finalQuote}} {{sizeHint}}
// An unknown or malformed token throws: a page never ships with a raw {{...}} in it.
function fillTokens(str, pk) {
  return String(str).replace(/\{\{([a-zA-Z]+)(?::([a-z]+)(?:\.([a-z]+))?)?\}\}/g, (all, name, a, b) => {
    const s = a ? seasonOf(pk, a) : null;
    const tierOk = (k) => Boolean(k && pk.tiers[k]);
    switch (name) {
      case 'from': if (s && tierOk(b)) return money(s.tiers[b].from); break;
      case 'includes': if (s && tierOk(b)) return s.tiers[b].includes; break;
      case 'request': if (s && tierOk(b)) return requestHref(pk, s.key, b); break;
      case 'low': if (s && !b) return money(lowHigh(s, pk)[0]); break;
      case 'high': if (s && !b) return money(lowHigh(s, pk)[1]); break;
      case 'range': if (s && !b) return rangeLine(pk, s.key); break;
      case 'custom': if (s && !b) return s.customLine; break;
      case 'season': if (s && !b) return s.name; break;
      case 'covers': if (s && !b) return s.covers; break;
      case 'tier': if (tierOk(a) && !b) return pk.tiers[a].name; break;
      case 'bundle': if (!a) return pk.bundle.line; break;
      case 'bundlePct': if (!a) return `${pk.bundle.percentOff}%`; break;
      case 'addOns': if (!a) return pk.addOns.line; break;
      case 'estimate': if (!a) return pk.estimateLine; break;
      case 'finalQuote': if (!a) return pk.finalQuoteLine; break;
      case 'sizeHint': if (!a) return pk.sizeHint; break;
      default: break;
    }
    throw new Error(`porch_packages: unknown or malformed token ${all}`);
  });
}

/** A whole query-universe entry with every string's tokens filled (arrays and objects too). */
function fillEntry(entry, pk) {
  const walk = (v) => {
    if (typeof v === 'string') return fillTokens(v, pk);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(entry);
}

/** The package comparison table (the costTable shape templates/page-shell.js renders), from the data. */
function comparisonTable(pk) {
  const [first, second] = pk.seasons;
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  return {
    title: 'Porch packages compared',
    caption: `Porch &amp; Party porch packages by size of look and season. From-prices in USD. ${esc(pk.bundle.line)}`,
    columns: ['Package', 'What you are picturing', `${esc(first.name)} from`, `${esc(second.name)} from`, 'Usually fits'],
    rows: tierKeys(pk).map((t) => [esc(pk.tiers[t].name), esc(cap(pk.tiers[t].picturing)), `${money(first.tiers[t].from)}+`, `${money(second.tiers[t].from)}+`, esc(pk.tiers[t].sizeHint ? `A ${pk.tiers[t].sizeHint.charAt(0).toLowerCase()}${pk.tiers[t].sizeHint.slice(1)}` : 'A porch with steps and a walkway')]),
    note: `${esc(pk.estimateLine)} ${esc(pk.addOns.line)}`,
  };
}

/**
 * The "Porch price guides" line: every article in porch_packages.json `articles` that is
 * published (its file exists), minus the page itself. Empty markers when none is.
 */
function articleLinksHtml(pk, publishedRels, selfRel, { wrap = true } = {}) {
  const items = (pk.articles || []).filter((a) => publishedRels.includes(a.path) && a.path !== selfRel);
  const line = `<p class="pkg-articles"><strong>Porch price guides:</strong> ${items.map((a) => `<a href="/${a.path.replace(/\.html$/, '')}">${esc(a.title)}</a>`).join(' · ')}</p>`;
  const inner = !items.length ? '' : wrap ? `<div class="container">${line}</div>` : line;
  return `<!--porch-articles-->${inner}<!--/porch-articles-->`;
}

module.exports = {
  esc, money, tierKeys, seasonOf, priceOf, rangeLine, formRangeLines, decorChoices, tierFromAnswer, seasonFromAnswer,
  cardLine, invoiceLines, seasonHtml, gridHtml, pageBlockHtml, calculatorHtml, schemaNode, requestHref, tierPriceStrings, GRID_CSS,
  fillTokens, fillEntry, comparisonTable, articleLinksHtml,
};
