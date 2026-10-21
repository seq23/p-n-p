#!/usr/bin/env node
'use strict';
/**
 * City x service pages under areas/ (owner-approved 21 Oct 2026: "a page for each suburb for
 * every service", to match competitors that publish one page per suburb).
 *
 * Every city in data/service_areas/areas.json gets four pages, one per service:
 *   areas/<city>-<st>-porch-decorating.html
 *   areas/<city>-<st>-party-decor.html
 *   areas/<city>-<st>-grazing-tables.html
 *   areas/<city>-<st>-party-game-rentals.html
 *
 * Fourteen of those (party decor for all 8 cities, porch decorating for 6) were published by
 * the 29 Apr 2026 baseline and are frozen (data/release/frozen_output_registry.json). This
 * generator does not re-render them (LEGACY below); it only stamps the sibling-services block
 * into them. Every other city x service page is rendered here, from data only:
 *   - prices and games: data/rentals/games.json (availableNow items only, via scripts/lib/inventory.js),
 *     data/offers/services.json (grazing tiers, travel, renter photo ID line, takedown),
 *     data/offers/porch_packages.json (porch packages, via scripts/lib/porch_packages.js);
 *   - city facts: data/service_areas/city_profiles.json (county, state, which side of Memphis,
 *     the pickup direction, and pages this repo already publishes for the city).
 * No reviews, ratings, counts, testimonials, "insured" claims or review asks: none exist on record.
 *
 * Every city page (legacy and generated) carries the <!--area-siblings--> block: links to the
 * other three services in the same city, back to /areas/, to /request and to /pricing.
 *
 * Re-rendering keeps the related-pages block scripts/build_related_navigation.js wrote (it is
 * not in build:all), so build:all never strips it. The other post-generation passes
 * (clarity, icons, contact surface, chrome, URL normalisation) run after this in build:all.
 * It also writes the "Service area pages" section of llms.txt and llms-services.txt.
 *
 * Usage: node scripts/generators/build_area_pages.js
 * Re-running it and then the build:all passes is byte-identical (checked 21 Oct 2026).
 * Guarded by npm run validate:area-pages.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const areasData = require(path.join(ROOT, 'data/service_areas/areas.json'));
const profiles = require(path.join(ROOT, 'data/service_areas/city_profiles.json'));
const INV = require(path.join(ROOT, 'scripts/lib/inventory.js'));
const PP = require(path.join(ROOT, 'scripts/lib/porch_packages.js'));
const siteIcons = require(path.join(ROOT, 'scripts/lib/site_icons.js'));
const siteChrome = require(path.join(ROOT, 'scripts/lib/site_chrome.js'));
const contactSurface = require(path.join(ROOT, 'scripts/lib/contact_surface.js'));
const { normalizeHtmlUrls } = require(path.join(ROOT, 'scripts/lib/site_url.js'));
const { nav, footer } = require(path.join(ROOT, 'templates/page-shell.js'));
const BO = require(path.join(ROOT, 'scripts/lib/book_online.js'));

const DOMAIN = offers.domain;
const RENTALS = INV.resolve(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rentals/games.json'), 'utf8')));
const PK = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/porch_packages.json'), 'utf8'));
const money = INV.money;

const SERVICE_KEYS = ['porch-decorating', 'party-decor', 'grazing-tables', 'party-game-rentals'];
/** The baseline pages this generator does not render (frozen; it only stamps siblings into them). */
const LEGACY = new Set([
  ...['memphis-tn', 'germantown-tn', 'collierville-tn', 'bartlett-tn', 'lakeland-tn', 'arlington-tn', 'southaven-ms', 'olive-branch-ms'].map((c) => `${c}-party-decor`),
  ...['memphis-tn', 'germantown-tn', 'collierville-tn', 'bartlett-tn', 'lakeland-tn', 'arlington-tn'].map((c) => `${c}-porch-decorating`),
]);

const esc = (s) => String(s).replace(/&(?!#?[a-z0-9]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const QUOTE = siteChrome.QUOTE.href;
const QA = siteChrome.QUOTE_ATTRS;

// --- data, read once ----------------------------------------------------------

const games = INV.publicGames(RENTALS);
const extras = INV.publicExtras(RENTALS);
const bundles = INV.offeredBundles(RENTALS);
const RATE = RENTALS.rates;
const PICK = RENTALS.pickup;
const GRAZE = offers.services.grazing;
const PORCH = offers.services.porch;
const CELEB = offers.services.celebration;
const TRAVEL = offers.travel;
const SAFETY = offers.renterSafety.line;
const TAKEDOWN = offers.addOns.takedown.line;
const porchFrom = Math.min(...PK.seasons.flatMap((s) => Object.values(s.tiers).map((t) => t.from)));
const grazeFrom = Math.min(...GRAZE.tiers.map((t) => t.from));
const bundleFrom = Math.min(...bundles.map((b) => b.dayPrice));

/** The /request ?service= key per area service (Book online preselects it; owner ruling 21 Oct 2026). */
const REQUEST_KEY = { 'porch-decorating': 'porch', 'party-decor': 'party', 'grazing-tables': 'grazing', 'party-game-rentals': 'rentals' };
/** The one service page per service (scripts/lib/service_pages.js), plus its named sub-section. */
const SERVICE_PAGE = {
  'porch-decorating': { href: '/services/porch-decorating', label: 'Porch decorating' },
  'party-decor': { href: '/services/celebration-setups', label: 'Party planning and decor', sub: { href: '/services/celebration-setups#hotel-room-setups', label: 'Hotel Room Setups' } },
  'grazing-tables': { href: '/services/grazing-and-event-styling', label: 'Grazing tables' },
  'party-game-rentals': { href: '/rentals/', label: 'Party game rentals', sub: { href: '/rentals/#giant-lawn-games', label: 'Giant Lawn Games' } },
};

/** "From" price per service, as the sibling block and validate:area-pages state it. */
const FROM = {
  'porch-decorating': `from ${money(porchFrom)}`,
  'party-decor': `from ${CELEB.price.replace('+', '')}`,
  'grazing-tables': `from ${money(grazeFrom)}`,
  'party-game-rentals': `${money(RATE.day)} a game per day`,
};

function cities() {
  const list = profiles.cities;
  const want = areasData.areas;
  if (list.length !== want.length || list.some((c, i) => c.area !== want[i])) {
    throw new Error(`data/service_areas/city_profiles.json cities (${list.map((c) => c.area).join('; ')}) must match data/service_areas/areas.json areas (${want.join('; ')}) in the same order`);
  }
  return list;
}

const slugOf = (city, svc) => `${city.slug}-${svc}`;
const relOf = (city, svc) => `areas/${slugOf(city, svc)}.html`;
const urlOf = (city, svc) => `/areas/${slugOf(city, svc)}`;

// --- shared blocks --------------------------------------------------------------

/** Links to the other services in the same city, back to /areas/, /request and /pricing. */
function siblingsBlock(city, current) {
  const items = SERVICE_KEYS.map((svc) => {
    const label = `${profiles.services[svc].label} in ${esc(city.name)}`;
    const price = esc(FROM[svc]);
    return svc === current
      ? `<li aria-current="page"><strong>${label}</strong> <span class="muted">(${price}, this page)</span></li>`
      : `<li><a href="${urlOf(city, svc)}">${label}</a> <span class="muted">(${price})</span></li>`;
  }).join('');
  const pages = SERVICE_KEYS.map((svc) => { const sp = SERVICE_PAGE[svc]; return `<a href="${sp.href}" data-service-page-link="${svc}">${sp.label}</a>${sp.sub ? ` (<a href="${sp.sub.href}">${sp.sub.label}</a>)` : ''}`; }).join(' &middot; ');
  return `<!--area-siblings--><section class="section" data-area-siblings="${city.slug}"><div class="container"><div class="answer-block"><span class="eyebrow">More in ${esc(city.name)}</span><h2>Every Porch &amp; Party service in ${esc(city.name)}, ${city.state}</h2></div><ul class="area-siblings">${items}</ul><p class="area-service-pages">Our four services: ${pages}</p><p><a href="/areas/">All service areas</a> &middot; <a href="${QUOTE}"${QA}>Request a Quote</a> &middot; <a href="/pricing">Pricing</a></p></div></section><!--/area-siblings-->`;
}

const SIBLINGS_RE = /<!--area-siblings-->[\s\S]*?<!--\/area-siblings-->/;
const CTA_BAND = '<section class="section cta-band">';
const RELATED_RE = /<section[^>]+data-nav="related-pages"[\s\S]*?<\/section>/i;

function stampSiblings(html, city, svc, rel) {
  const block = siblingsBlock(city, svc);
  if (SIBLINGS_RE.test(html)) return html.replace(SIBLINGS_RE, () => block);
  const at = html.indexOf(CTA_BAND);
  if (at < 0) throw new Error(`${rel}: no cta-band to put the sibling-services block before`);
  return html.slice(0, at) + block + '\n' + html.slice(at);
}

const panel = (h, body, attrs = '') => `<div class="info-panel"${attrs}><h2>${h}</h2>${body}</div>`;
const list = (items) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const photoCard = (img, alt, h, p) => `<div class="card"><div class="card-media"><img src="${img}" alt="${esc(alt)}" width="1200" height="900" loading="lazy" decoding="async"/></div><div class="card-body"><h3>${h}</h3><p class="muted">${p}</p></div></div>`;

/** Rotate a list by n, so neighbouring cities do not share one panel order. */
const rotate = (arr, n) => arr.slice(n % arr.length).concat(arr.slice(0, n % arr.length));
const pick = (arr, n) => arr[n % arr.length];

function localLinks(city, svc) {
  return (city.localPages || []).filter((p) => p.for === svc).map((p) => `<a href="${p.href}">${esc(p.label)}</a>`);
}

function travelSentence(city) {
  return `${esc(city.name)} is on the included list, so there is no travel fee. ${esc(TRAVEL.line)}`;
}

// --- per-service content ------------------------------------------------------

function rentalsContent(city, i) {
  const ms = city.state === 'MS';
  const gameNames = games.map((g) => g.name);
  const priceRows = [
    ['One game, one day', money(RATE.day)],
    ['One game, the whole weekend (Fri, Sat and Sun)', money(RATE.weekend)],
    ...extras.map((x) => [esc(x.name), `${money(x.dayPrice)} a day &middot; ${money(x.weekendPrice)} a weekend`]),
    ...bundles.map((b) => [`${esc(b.name)} bundle: ${esc(INV.lcFirst(b.includes))}`, b.weekendPrice != null ? `${money(b.dayPrice)} a day &middot; ${money(b.weekendPrice)} a weekend` : `${money(b.dayPrice)} a day`]),
  ];
  const table = `<div class="table-scroll" style="overflow-x:auto;"><table><caption>Party game rental prices for ${esc(city.name)} hosts</caption><thead><tr><th scope="col">What you rent</th><th scope="col">Price</th></tr></thead><tbody>${priceRows.map(([a, b]) => `<tr><th scope="row">${a}</th><td>${b}</td></tr>`).join('')}</tbody></table></div><p class="muted" style="margin-top:16px;">A ${money(RENTALS.damageDeposit)} refundable damage deposit applies. No minimum order.</p>`;
  const gameCards = `<div class="area-games" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">${games.map((g) => `<div class="card"><div class="card-media"><img src="/assets/rentals/${g.slug}.webp" alt="${esc(g.alt)}" width="1200" height="900" loading="lazy" decoding="async"/></div><div class="card-body"><h3>${esc(g.name)}</h3><p>${esc(g.blurb)}</p><p class="muted">${esc(g.size)}</p></div></div>`).join('')}</div>`;
  const panels = [
    panel(`Prices for ${esc(city.name)} renters`, table, ' data-area-prices="party-game-rentals"'),
    panel('Games available now', gameCards),
    panel(`Pickup and return for ${esc(city.name)}`, `<p>No delivery: every rental is picked up and returned at ${esc(PICK.place)}, ${esc(PICK.address)}, a police safe exchange zone. ${esc(city.pickupNote)} The pickup time is set by text or call after payment.</p><p>${esc(SAFETY)}</p>`),
  ];
  const intro = pick([
    `${esc(city.name)} is ${esc(city.where)}. Porch &amp; Party rents ${esc(INV.rentalsPhrase(RENTALS))} to ${esc(city.name)} hosts for backyard birthdays, family reunions, church and school events.`,
    `Hosting in ${esc(city.name)}, ${city.state}? Porch &amp; Party rents ${esc(INV.rentalsPhrase(RENTALS))} for ${esc(city.county)} parties, picked up in Memphis and played in your own yard.`,
    `Giant yard games for ${esc(city.name)} parties: ${esc(gameNames.join(', '))}, each ${money(RATE.day)} a day or ${money(RATE.weekend)} for the weekend.`,
  ], i);
  const faqs = [
    [`Do you deliver party games to ${city.name}?`, `No. Party game rentals are pickup only: you pick up and return at ${PICK.place}, ${PICK.address}. ${city.pickupNote}`],
    ['How much does a party game rental cost?', `Every game is ${money(RATE.day)} for one day or ${money(RATE.weekend)} for the whole weekend (Friday, Saturday and Sunday). Bundles start at ${money(bundleFrom)}.`],
    ['Do I need ID to rent?', SAFETY],
  ];
  if (ms) faqs.push([`Can I rent from ${city.name}, Mississippi?`, `Yes. ${city.name} is in ${city.county}, ${city.stateName}, and the prices are the same as in Memphis. Pickup and return are in Memphis, Tennessee, at ${PICK.place}.`]);
  else faqs.push([`Which games can ${city.name} hosts rent right now?`, `${INV.joinAnd(gameNames)}${extras.length ? `, plus ${INV.joinAnd(extras.map((x) => x.phrase))}` : ''}. Only games available now are listed.`]);
  return {
    eyebrow: 'Party Game Rentals',
    h1: pick([`Party game rentals in ${city.name}, ${city.state}`, `${city.name} party game rentals`, `Giant yard game rentals for ${city.name}, ${city.state}`], i),
    title: `${city.name}, ${city.state} Party Game Rentals | Porch & Party`,
    description: `${city.name} party game rentals: ${games.length} giant yard games at ${money(RATE.day)} a game per day or ${money(RATE.weekend)} a weekend, picked up at Mt. Moriah Station in Memphis.`,
    lead: intro,
    second: `Prices come straight from the rentals list: ${money(RATE.day)} a game per day, ${money(RATE.weekend)} a game for the weekend, bundles from ${money(bundleFrom)}.`,
    primary: { href: '/request?service=rentals', label: 'Book your games' },
    secondary: { href: '/rentals/', label: 'See every game' },
    panels: rotate(panels, i),
    aside: [photoCard(RENTALS.hero.file, `${RENTALS.hero.alt}`, `${money(RATE.day)} a game per day`, `Pickup and return at ${esc(PICK.place)}. ${esc(city.name)} renters drive in, load up and play at home.`)],
    image: RENTALS.hero.file,
    imageAlt: RENTALS.hero.alt,
    faqs,
    serviceName: `Party game rentals in ${city.area}`,
    offers: [
      { '@type': 'Offer', name: 'One party game, one day', price: RATE.day, priceCurrency: 'USD' },
      { '@type': 'Offer', name: 'One party game, the whole weekend', price: RATE.weekend, priceCurrency: 'USD' },
    ],
    ctaH: `Booking games for a ${city.name} party?`,
    ctaP: 'Tell us the date and the games you want. We confirm availability and the pickup time by text or call.',
  };
}

function grazingContent(city, i) {
  const rows = GRAZE.tiers.map((t) => [esc(t.name), `${money(t.from)}`, `${t.feedsSnack[0]}${t.feedsSnack[1] !== t.feedsSnack[0] ? `&ndash;${t.feedsSnack[1]}` : ''} guests`, `${t.feedsMeal[0]}${t.feedsMeal[1] !== t.feedsMeal[0] ? `&ndash;${t.feedsMeal[1]}` : ''} guests`]);
  const table = `<div class="table-scroll" style="overflow-x:auto;"><table><caption>Grazing table styling prices for ${esc(city.name)}</caption><thead><tr><th scope="col">Size</th><th scope="col">Styling from</th><th scope="col">Feeds as a snack</th><th scope="col">Feeds as a meal</th></tr></thead><tbody>${rows.map((r) => `<tr><th scope="row">${r[0]}</th>${r.slice(1).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="muted" style="margin-top:16px;">${esc(GRAZE.notes.join(' '))} Food runs about ${money(GRAZE.foodPerHead.low)}&ndash;${money(GRAZE.foodPerHead.high)} a guest. ${esc(GRAZE.foodPerHead.line)}</p>`;
  const local = localLinks(city, 'grazing-tables');
  const panels = [
    panel(`Grazing table prices in ${esc(city.name)}`, table, ' data-area-prices="grazing-tables"'),
    panel('What the styling covers', list(GRAZE.includes.map(esc))),
    panel(`Travel to ${esc(city.name)}`, `<p>${travelSentence(city)}</p>`),
  ];
  return {
    eyebrow: 'Grazing Tables',
    h1: pick([`Grazing tables in ${city.name}, ${city.state}`, `${city.name} grazing tables and styled boards`, `Grazing table styling for ${city.name}, ${city.state}`], i),
    title: `${city.name}, ${city.state} Grazing Tables | From ${money(grazeFrom)} | Porch & Party`,
    description: `Grazing tables in ${city.name}, ${city.state}: styled boards from ${money(grazeFrom)} and full tables from ${money(GRAZE.tiers[2].from)}, food quoted separately, no travel fee to ${city.name}.`,
    lead: pick([
      `${esc(city.name)} is ${esc(city.where)}. Porch &amp; Party styles grazing boards and tables there for showers, birthdays, office gatherings and small events, starting at ${money(grazeFrom)} for a board.`,
      `A grazing table for a ${esc(city.name)} shower, birthday or office lunch starts at ${money(grazeFrom)} for a board and ${money(GRAZE.tiers[1].from)} for a small table, styled on site.`,
      `Porch &amp; Party brings grazing-table styling to ${esc(city.name)}, ${esc(city.stateName)}: boards, small tables and full tables, priced by size, with food quoted on its own.`,
    ], i),
    second: `${esc(GRAZE.notes[0])} ${esc(GRAZE.notes[1])}${local.length ? ` In Memphis, see also ${local.join(' and ')}.` : ''}`,
    primary: { href: '/request?service=grazing', label: 'Request a Quote' },
    secondary: { href: '/pricing', label: 'View Pricing' },
    panels: rotate(panels, i + 1),
    aside: [photoCard('/assets/img/grazing/grazing-table-corporate.jpg', `Styled grazing table setup for a ${city.name} event`, `Boards from ${money(grazeFrom)}`, `Small tables from ${money(GRAZE.tiers[1].from)}, full tables from ${money(GRAZE.tiers[2].from)}, each additional table ${money(GRAZE.tiers[3].from)}.`)],
    image: '/assets/img/grazing/grazing-table-corporate.jpg',
    imageAlt: `Styled grazing table setup for a ${city.name} event`,
    faqs: [
      [`Do you set up grazing tables in ${city.name}?`, `Yes. ${city.name} is one of the eight included cities, so there is no travel fee. Anywhere further is a flat ${money(TRAVEL.extendedFee)}.`],
      ['Is food included in the grazing table price?', `${GRAZE.notes[0]} ${GRAZE.notes[1]} Food is estimated at about ${money(GRAZE.foodPerHead.low)}–${money(GRAZE.foodPerHead.high)} a guest and quoted once the menu and headcount are set.`],
      ['How many guests does a board feed?', `A board feeds ${GRAZE.tiers[0].feedsSnack[0]}–${GRAZE.tiers[0].feedsSnack[1]} guests as a snack or ${GRAZE.tiers[0].feedsMeal[0]}–${GRAZE.tiers[0].feedsMeal[1]} as a meal. A full table feeds ${GRAZE.tiers[2].feedsSnack[0]}–${GRAZE.tiers[2].feedsSnack[1]} as a snack.`],
    ],
    serviceName: `Grazing tables in ${city.area}`,
    offers: GRAZE.tiers.map((t) => ({ '@type': 'Offer', name: `${t.name} grazing styling`, price: t.from, priceCurrency: 'USD' })),
    ctaH: `Planning a ${city.name} grazing table?`,
    ctaP: 'Share the date, headcount, venue or home, and whether you want food sourced, so we can quote the styling and the food separately.',
  };
}

function porchContent(city, i) {
  const grid = `<style>${PP.GRID_CSS}</style>${PP.gridHtml(PK, { links: true, heading: 'h3' })}`;
  const panels = [
    panel(`Porch packages for ${esc(city.name)} homes`, grid, ' data-area-prices="porch-decorating"'),
    panel('What can be styled', list(PORCH.includes.map(esc))),
    panel(`Travel and takedown in ${esc(city.name)}`, `<p>${travelSentence(city)}</p><p>${esc(TAKEDOWN)}</p>`),
  ];
  return {
    eyebrow: 'Porch Decorating',
    h1: pick([`${city.name} porch decorating and seasonal front-entry styling`, `Porch decorating in ${city.name}, ${city.state}`], i),
    title: `${city.name}, ${city.state} Porch Decorating | From ${money(porchFrom)} | Porch & Party`,
    description: `${city.name}, ${city.state} porch decorating for fall and Christmas: Stoop, Classic, Grand and Showstopper packages from ${money(porchFrom)}, no travel fee to ${city.name}.`,
    lead: `${esc(city.name)} is ${esc(city.where)}. Porch &amp; Party decorates ${esc(city.name)} front porches for fall, Halloween, Thanksgiving and Christmas, from a simple stoop to the works: porch, steps and walkway.`,
    second: `Packages start at ${money(porchFrom)}. ${esc(PK.estimateLine)}`,
    primary: { href: '/request?service=porch#request-form', label: 'Request a porch quote' },
    secondary: { href: '/pricing', label: 'View Pricing' },
    panels: rotate(panels, i),
    aside: [photoCard(pick(['/assets/img/porch/seasonal-exterior-fall.jpg', '/assets/img/porch/collierville-christmas-porch-decorating-front-door.jpg'], i), `Seasonal front porch decorating for a ${city.name} home`, `Packages from ${money(porchFrom)}`, esc(PK.finalQuoteLine))],
    image: pick(['/assets/img/porch/seasonal-exterior-fall.jpg', '/assets/img/porch/collierville-christmas-porch-decorating-front-door.jpg'], i),
    imageAlt: `Seasonal front porch decorating for a ${city.name} home`,
    faqs: [
      [`Does Porch & Party decorate porches in ${city.name}?`, `Yes. ${city.name} is in ${city.county}, ${city.stateName}, one of the eight included cities, so there is no travel fee.`],
      ['How much does porch decorating cost?', `Fall and Christmas packages start at ${money(porchFrom)} for the Stoop package. ${PK.finalQuoteLine}`],
      ['Is takedown included?', TAKEDOWN],
      ['Is there a discount for booking fall and Christmas?', PK.bundle.line],
    ],
    serviceName: `Porch decorating in ${city.area}`,
    offers: PK.seasons.flatMap((s) => Object.entries(s.tiers).map(([k, t]) => ({ '@type': 'Offer', name: `${PK.tiers[k].name} ${s.short} porch package`, price: t.from, priceCurrency: 'USD' }))),
    ctaH: `Ready to plan a ${city.name} porch?`,
    ctaP: 'Share the season, your porch size and a photo if you have one, so we can recommend the right package.',
  };
}

const CONTENT = {
  'porch-decorating': porchContent,
  'grazing-tables': grazingContent,
  'party-game-rentals': rentalsContent,
};

// --- the page ---------------------------------------------------------------------

function jsonLd(city, svc, c, url) {
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${DOMAIN}/` },
    { '@type': 'ListItem', position: 2, name: 'Service Areas', item: `${DOMAIN}/areas/` },
    { '@type': 'ListItem', position: 3, name: c.h1, item: url },
  ] };
  const blocks = [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: c.title, description: c.description, url },
    { '@context': 'https://schema.org', '@type': 'Service', name: c.serviceName, serviceType: profiles.services[svc].label,
      provider: { '@type': 'LocalBusiness', name: offers.brandName, url: DOMAIN, ...contactSurface.businessContactFields() },
      areaServed: { '@type': 'City', name: city.area },
      offers: c.offers },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: c.faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    { '@context': 'https://schema.org', '@type': 'ImageObject', contentUrl: `${DOMAIN}${c.image}`, caption: c.imageAlt },
    crumbs,
  ];
  return contactSurface.patchJsonLd(blocks.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join('\n'));
}

function renderPage(city, svc, i) {
  const c = CONTENT[svc](city, i);
  const pathUrl = `/areas/${slugOf(city, svc)}.html`;
  const url = `${DOMAIN}${urlOf(city, svc)}`;
  const t = esc(c.title);
  const d = esc(c.description);
  if (c.title.length < 30 || c.title.length > 70) throw new Error(`${pathUrl}: title is ${c.title.length} characters (30-70): ${c.title}`);
  if (c.description.length < 110 || c.description.length > 160) throw new Error(`${pathUrl}: description is ${c.description.length} characters (110-160): ${c.description}`);
  const faqHtml = c.faqs.map(([q, a]) => `<div class="faq-item"><h3>${esc(q)}</h3><p>${esc(a)}</p></div>`).join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${t}</title>
<meta name="description" content="${d}" />
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
<link rel="canonical" href="${url}" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:type" content="article" />
<meta property="og:url" content="${url}" />
<meta property="og:site_name" content="Porch &amp; Party" />
<meta property="og:locale" content="en_US" />
<meta property="og:image" content="${DOMAIN}${c.image}" />
<meta property="og:image:alt" content="${esc(c.imageAlt)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
<meta name="twitter:image" content="${DOMAIN}${c.image}" />
<meta name="theme-color" content="#faf7f2" />
${siteIcons.HEAD_ICON_LINKS}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/styles.css" />
${siteChrome.cssLink()}
${jsonLd(city, svc, c, url)}
</head>
<body>
${nav(pathUrl)}
<main>
<div class="breadcrumb-bar"><div class="container"><nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/areas/">Service Areas</a></li><li aria-current="page">${esc(c.h1)}</li></ol></nav></div></div>
<section class="section"><div class="container"><div class="page-intro"><span class="eyebrow">${c.eyebrow}</span><h1>${esc(c.h1)}</h1><p>${c.lead}</p><p>${c.second}</p><div class="btn-row hero-centered-cta"><a href="${c.primary.href}" class="btn-primary" data-quote-cta="area-${svc}">${c.primary.label}</a><a href="${c.secondary.href}" class="btn-secondary">${c.secondary.label}</a></div></div></div></section>
<section class="section section-soft"><div class="container content-grid"><div class="content-stack">${c.panels.join('')}</div><div class="content-stack">${c.aside.join('')}</div></div></section>
${siblingsBlock(city, svc)}
<section class="section"><div class="container"><div class="answer-block"><span class="eyebrow">FAQ</span><h2>Common questions</h2></div><div class="faq-list">${faqHtml}</div></div></section>
<section class="section cta-band"><div class="container"><span class="eyebrow">Request a Quote</span><h2>${esc(c.ctaH)}</h2><p>${esc(c.ctaP)}</p><div class="btn-row hero-centered-cta"><a href="${c.primary.href}" class="btn-primary" data-quote-cta="area-${svc}-bottom">${c.primary.label}</a></div></div></section>
</main>
${footer()}
</body>
</html>
`;
  return BO.applyBookOnline(normalizeHtmlUrls(html), REQUEST_KEY[svc], pathUrl);
}

// --- llms section -------------------------------------------------------------------

const LLMS_FILES = ['llms.txt', 'llms-services.txt'];
const LLMS_RE = /<!-- area-pages -->[\s\S]*?<!-- \/area-pages -->\n?/;
function llmsSection() {
  const lines = ['<!-- area-pages -->', '## Service area pages', '',
    `Every service has a page for each served city (${areasData.areas.join('; ')}). Index: ${DOMAIN}/areas/`, ''];
  for (const city of cities()) {
    lines.push(`- ${city.area}: ${SERVICE_KEYS.map((svc) => `${profiles.services[svc].label} ${DOMAIN}${urlOf(city, svc)}`).join('; ')}`);
  }
  lines.push('<!-- /area-pages -->', '');
  return lines.join('\n');
}

// --- main ----------------------------------------------------------------------------

function plan() {
  const out = [];
  cities().forEach((city, i) => {
    for (const svc of SERVICE_KEYS) {
      const rel = relOf(city, svc);
      const abs = path.join(ROOT, rel);
      const onDisk = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      let html;
      if (LEGACY.has(slugOf(city, svc))) {
        if (onDisk == null) throw new Error(`${rel} is a baseline page and is missing`);
        html = BO.applyBookOnline(stampSiblings(onDisk, city, svc, rel), REQUEST_KEY[svc], rel);
      } else {
        if (!CONTENT[svc]) throw new Error(`${rel}: no generator for service ${svc}`);
        html = renderPage(city, svc, i);
        const related = onDisk && onDisk.match(RELATED_RE);
        if (related) html = html.replace('</main>', `${related[0]}</main>`);
      }
      out.push({ rel, abs, before: onDisk, after: html });
    }
  });
  for (const f of LLMS_FILES) {
    const abs = path.join(ROOT, f);
    const before = fs.readFileSync(abs, 'utf8');
    const section = llmsSection();
    const after = LLMS_RE.test(before) ? before.replace(LLMS_RE, () => section) : `${before.replace(/\n*$/, '\n\n')}${section}`;
    out.push({ rel: f, abs, before, after });
  }
  return out;
}

if (require.main === module) {
  const work = plan();
  const changed = work.filter((w) => w.before !== w.after);
  for (const w of changed) fs.writeFileSync(w.abs, w.after);
  console.log(`area pages: ${work.length - LLMS_FILES.length} city x service pages (${LEGACY.size} baseline, ${work.length - LLMS_FILES.length - LEGACY.size} generated), ${changed.length} file(s) written`);
}

module.exports = { SERVICE_KEYS, REQUEST_KEY, SERVICE_PAGE, LEGACY, FROM, cities, slugOf, relOf, urlOf, siblingsBlock, plan, games, bundles, RATE, GRAZE, porchFrom, grazeFrom, PICK, SAFETY };
