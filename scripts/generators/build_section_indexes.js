#!/usr/bin/env node
'use strict';
/**
 * Section index pages, built from the section directories that already exist.
 *
 * Why this exists. A page is indexed roughly when it has inbound internal
 * links; a sitemap entry is a hint, not a link. Measured with
 * scripts/analysis/link_graph.js, this tree had 12 pages with zero inbound
 * internal links and 14 pages unreachable by any click path from "/", because
 * whole section directories - services/ most of all - had no index and were
 * only reachable through whichever individual page some other page happened to
 * mention.
 *
 * The hierarchy was already asserted and simply had nothing behind it: the
 * BreadcrumbList JSON-LD emitted by templates/page-shell.js declares
 * https://porchandparty901.com/services/, /faq/, /local/ and /events/ as the
 * position-2 parent of 26 published pages, and none of those four URLs existed.
 * This builds them, so the breadcrumb resolves and the section is navigable.
 *
 * Nothing here is invented. Sections come from the directories on disk. Every
 * link label is the target page's own <h1>, and every blurb is that page's own
 * lead paragraph, read out of the published file at build time. Service
 * grouping uses the three offer families already defined in
 * data/offers/services.json; area grouping uses the cities already defined in
 * data/service_areas/areas.json.
 *
 * Only sections with four or more published pages get an index. A two-page
 * directory does not need a navigation surface, and publishing one would add a
 * thin page for no reachability gain.
 *
 * Usage: node scripts/generators/build_section_indexes.js [--check]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const brand = require(path.join(ROOT, 'scripts/lib/brand.js'));
const areasData = require(path.join(ROOT, 'data/service_areas/areas.json'));
const faqContent = require(path.join(ROOT, 'scripts/lib/faq_content.js'));
const rentalRates = require(path.join(ROOT, 'data/rentals/games.json')).rates;
const { nav, footer } = require(path.join(ROOT, 'templates/page-shell.js'));
// Owner ruling 2026-10-15: every quote CTA opens the quote form directly, in a new tab.
const { QUOTE, QUOTE_ATTRS } = require(path.join(ROOT, 'scripts/lib/site_chrome.js'));
const QUOTE_LINK = `href="${QUOTE.href}"${QUOTE_ATTRS}`;

const DOMAIN = offers.domain;
const CHECK = process.argv.includes('--check');

// --- reading the real pages -------------------------------------------------

const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
// Bare ampersands are already present in the published pages ("Porch & Party");
// re-escaping only the ones that are not already an entity keeps the output
// valid without rewriting the source text.
const esc = (s) => s.replace(/&(?!#?[a-z0-9]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/&(?:mdash|ndash);/g, '-');

/** The page's own h1 and the paragraph directly beneath it. No rewriting. */
function readPage(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const lead = html.match(/<h1[^>]*>[\s\S]*?<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/i);
  if (!h1) throw new Error(`${rel} has no <h1> to take a link label from`);
  return { rel, url: `/${rel}`, h1: stripTags(h1[1]), lead: lead ? stripTags(lead[1]) : '' };
}

const pagesIn = (dir) => fs.readdirSync(path.join(ROOT, dir))
  .filter((f) => f.endsWith('.html') && f !== 'index.html')
  .sort()
  .map((f) => readPage(`${dir}/${f}`));

// --- grouping ---------------------------------------------------------------

/**
 * Services group under the three offer families in data/offers/services.json.
 * The assignment is the one each page states about itself: the porch pages
 * quote the $350+ porch floor, the celebration pages quote $300+, and the
 * grazing pages quote $250+ for styling only.
 */
const SERVICE_FAMILIES = [
  { key: 'porch', slugs: [
    'porch-decorating', 'fall-porch-decorating', 'christmas-porch-decorating',
    'small-porch-decorating', 'front-door-styling'] },
  { key: 'celebration', slugs: [
    'celebration-setups', 'celebration-setups-memphis', 'party-decor-memphis',
    'birthday-party-planner-memphis', 'birthday-party-decor-memphis', 'hotel-room-decor-memphis', 'baby-shower-decor-memphis',
    'bridal-shower-decor-memphis', 'luxury-party-decor-memphis', 'budget-party-decor-memphis'] },
  { key: 'grazing', slugs: ['grazing-and-event-styling', 'grazing-tables-memphis'] }
];

function groupServices(pages) {
  const bySlug = new Map(pages.map((p) => [path.basename(p.rel, '.html'), p]));
  const groups = SERVICE_FAMILIES.map(({ key, slugs }) => {
    const offer = offers.services[key];
    return {
      heading: `${offer.name} - from ${offer.price}`,
      blurb: offer.summary,
      pages: slugs.map((s) => {
        const page = bySlug.get(s);
        if (!page) throw new Error(`services/${s}.html is listed in a family but not on disk`);
        bySlug.delete(s);
        return page;
      })
    };
  });
  if (bySlug.size) throw new Error(`services pages not assigned to an offer family: ${[...bySlug.keys()].join(', ')}`);
  // Party game rentals (owner-approved 2026-10-13) are a service line whose
  // page lives at /rentals/ rather than under services/, so it is read by path
  // here. Missing file is a hard error, never a silently shorter index.
  groups.push({
    heading: `Party Game Rentals - from $${rentalRates.day} a game per day`,
    blurb: 'Giant yard games, an inflatable movie screen and a card table for Memphis parties, picked up and returned at Mt. Moriah Station.',
    pages: [readPage('rentals/index.html')]
  });
  return groups;
}

/**
 * Area pages group by city. The city is taken from the slug, which encodes it
 * ahead of the -tn-/-ms- state marker, and East Memphis is a Memphis
 * neighbourhood rather than a separate city in data/service_areas/areas.json.
 */
function groupAreas(pages) {
  const cityKey = (slug) => {
    const m = slug.match(/^(.*?)-(tn|ms)-/);
    const key = m ? m[1] : slug;
    return key === 'east-memphis' ? 'memphis' : key;
  };
  const order = areasData.areas.map((a) => ({
    label: a,
    key: a.split(',')[0].trim().toLowerCase().replace(/\s+/g, '-')
  }));
  const groups = order.map(({ label, key }) => ({
    heading: label,
    blurb: '',
    pages: pages.filter((p) => cityKey(path.basename(p.rel, '.html')) === key)
  })).filter((g) => g.pages.length);
  const placed = new Set(groups.flatMap((g) => g.pages.map((p) => p.rel)));
  const missed = pages.filter((p) => !placed.has(p.rel));
  if (missed.length) throw new Error(`area pages outside the served city list: ${missed.map((p) => p.rel).join(', ')}`);
  return groups;
}

// --- the sections -----------------------------------------------------------

const CITY_LIST = areasData.areas.map((a) => a.split(',')[0]).join(', ');

const SECTIONS = [
  {
    dir: 'services',
    eyebrow: 'Services',
    crumb: 'Services',
    h1: 'Porch &amp; Party services in the Memphis metro area',
    // Owner-approved 2026-10-18: the four services (scripts/lib/brand.js) in the title and description.
    title: 'Memphis Porch, Party, Grazing &amp; Game Rentals | Porch &amp; Party',
    description: `Porch & Party services in Memphis: ${brand.SERVICES[0].label} from $${brand.PRICES.porch}, ${brand.SERVICES[1].label} from $${brand.PRICES.party}, ${brand.SERVICES[2].label} from $${brand.PRICES.grazing}, and ${brand.SERVICES[3].label} from $${brand.PRICES.gameDay}.`,
    lead: `Porch &amp; Party offers four services: ${offers.services.porch.name} from ${offers.services.porch.price}, ${offers.services.celebration.name} from ${offers.services.celebration.price}, ${esc(offers.services.grazing.name)} from ${offers.services.grazing.price}, and party game rentals from $${rentalRates.day} a game per day. Every styling page below sits inside one of the first three, so start with the family that matches the setup you need and open the page that names it. Party game rentals are listed last.`,
    summary: 'Pick the service family first - porch, celebration, or grazing - then open the page for the specific setup. Starting prices are published on each page and the exact quote depends on scope, date, location, and materials.',
    group: groupServices,
    faq: [
      ['Which service family covers the setup I need?',
        `Front-entry and seasonal work sits under ${offers.services.porch.name} from ${offers.services.porch.price}. Anything styled inside a home or hotel room sits under ${offers.services.celebration.name} from ${offers.services.celebration.price}. Table presentation for showers, corporate gatherings, and small events sits under ${offers.services.grazing.name} from ${offers.services.grazing.price}.`],
      ['Do the starting prices include take-down or food?',
        `No. ${offers.services.porch.notes[0]} ${offers.services.grazing.notes[0]} ${offers.services.grazing.notes[1]}`]
    ],
    related: ['/faq/index.html', '/areas/index.html', '/local/index.html', '/events/index.html', '/pricing.html']
  },
  {
    dir: 'areas',
    eyebrow: 'Service Areas',
    crumb: 'Service Areas',
    h1: 'Porch &amp; Party service areas across the Memphis metro',
    title: 'Porch &amp; Party Service Areas | Memphis Metro Party &amp; Porch Decor',
    description: 'Porch & Party service areas: party decor, hotel-room decor, grazing tables, and porch decorating in Memphis, Germantown, Collierville, and nearby cities.',
    lead: `Porch &amp; Party serves ${CITY_LIST} and the greater Memphis metro area. Each city below has its own page: a party decor page covering hotel-room decor and grazing tables, a porch decorating page covering seasonal front-entry installs, or both where both are published.`,
    summary: `Open the page for your city. Party decor and celebration setups start at ${offers.services.celebration.price}, grazing-table styling at ${offers.services.grazing.price}, and seasonal porch decorating at ${offers.services.porch.price}, with travel and access affecting the final quote.`,
    group: groupAreas,
    faq: [
      ['Which cities does Porch &amp; Party serve?',
        `${CITY_LIST} and the greater Memphis metro area.`],
      ['Why do some cities have two pages?',
        'Party decor and porch decorating are separate services with separate scope and separate starting prices, so each city page covers one of them. Cities where both are published have both listed above.']
    ],
    related: ['/services/index.html', '/local/index.html', '/faq/index.html', '/contact.html']
  },
  {
    dir: 'faq',
    eyebrow: 'Common Questions',
    crumb: 'FAQ',
    h1: 'Porch &amp; Party frequently asked questions',
    heroH1: 'Frequently asked questions',
    title: 'Porch &amp; Party FAQ | Pricing, Setup Time &amp; Booking Questions',
    description: 'Questions asked most before booking Porch & Party: what setups cost, how long they take, how far ahead to book, and what grazing-table pricing covers.',
    lead: 'Every question we get, in one place, sectioned by service: booking and payment, porch decor, party and room decor, grazing tables and party game rentals. The grazing estimator and the porch-size pictures give you a starting price before you ask.',
    heroNote: 'Use the estimator below for a starting price before you ask.',
    summary: 'Jump to your service below. Setup and styling prices are firm starting points from our price list; food for grazing tables is always a separate rough estimate until the menu is confirmed.',
    group: (pages) => [{ heading: 'Longer answers', blurb: 'Each of these is a full page with the pricing detail behind one question.', pages }],
    groups: faqContent.SECTIONS,
    faq: faqContent.flat(),
    related: ['/answers/index.html', '/pricing.html', '/services/index.html', '/how-it-works.html']
  },
  {
    dir: 'local',
    eyebrow: 'Memphis Pages',
    crumb: 'Local',
    h1: 'Porch &amp; Party local setup pages for Memphis',
    title: 'Memphis Local Setups | Hotel, Birthday &amp; Grazing | Porch &amp; Party',
    description: 'Memphis Porch & Party pages for hotel room, at-home birthday, grazing table, and romantic room decorations, each with local scope and starting pricing.',
    lead: 'These pages cover the four Porch &amp; Party setups requested most often inside Memphis itself: hotel room decorations, birthday decorations at home, grazing tables, and romantic room decorations. Each one explains what the setup covers locally and where the starting price begins.',
    summary: 'Use these pages when the setup is in Memphis and you already know the occasion. For a city outside Memphis, start from the service area pages instead.',
    group: (pages) => [{ heading: 'Memphis setups', blurb: '', pages }],
    faq: [
      ['What do these Memphis setups start at?',
        `Hotel-room, at-home birthday, and romantic room setups are ${offers.services.celebration.name.toLowerCase()} and start at ${offers.services.celebration.price}. Grazing-table styling starts at ${offers.services.grazing.price} and covers styling only.`],
      ['Are these pages only for Memphis?',
        `Yes. These four cover setups inside Memphis itself. For ${areasData.areas.slice(1).map((a) => a.split(',')[0]).join(', ')}, use the service area pages instead.`]
    ],
    related: ['/areas/index.html', '/services/index.html', '/events/index.html', '/pricing.html']
  },
  {
    dir: 'events',
    eyebrow: 'Occasions',
    crumb: 'Events',
    h1: 'Porch &amp; Party decor by occasion',
    title: 'Decor by Occasion in Memphis | Showers &amp; Proposals | Porch &amp; Party',
    description: 'Porch & Party occasion pages for baby showers, bridal showers, proposal room setups, and anniversary room decorations in the Memphis metro area.',
    lead: 'Some setups are defined by the occasion rather than the room. These pages cover the four occasions Porch &amp; Party is asked for most - baby showers, bridal showers, proposals, and anniversaries - and what changes about the styling for each one.',
    summary: 'Start from the occasion when the event is the fixed part and the venue is not. Celebration setups start at $300+ regardless of occasion; the occasion drives the styling direction, not the floor price.',
    group: (pages) => [{ heading: 'Setups by occasion', blurb: '', pages }],
    faq: [
      ['Does the occasion change the starting price?',
        `No. ${offers.services.celebration.name} start at ${offers.services.celebration.price} whatever the occasion. The occasion drives the styling direction and which areas get styled, not the floor price.`],
      ['Can an occasion setup happen in a hotel room?',
        'Yes. Proposal, anniversary, and shower setups are styled in hotel rooms, private homes, and event spaces across the Memphis metro area, depending on access and timing.']
    ],
    related: ['/services/index.html', '/local/index.html', '/answers/index.html', '/contact.html']
  }
];

const MIN_PAGES = 4;

// --- rendering --------------------------------------------------------------

const RELATED_LABELS = {
  '/services/index.html': 'Porch & Party services in the Memphis metro area',
  '/areas/index.html': 'Porch & Party service areas across the Memphis metro',
  '/faq/index.html': 'Porch & Party frequently asked questions',
  '/local/index.html': 'Porch & Party local setup pages for Memphis',
  '/events/index.html': 'Porch & Party decor by occasion',
  '/answers/index.html': 'Porch & Party Answer Index',
  '/pricing.html': 'Memphis Event Decor Pricing',
  '/contact.html': 'Request a Memphis Event Decor Quote',
  '/how-it-works.html': 'How Porch & Party Works'
};

const SOCIAL = {
  services: ['/assets/img/porch/memphis-fall-front-porch-decorating-germantown.jpg',
    'Memphis fall front porch decorating with pumpkins and layered seasonal styling'],
  areas: ['/assets/img/porch/collierville-christmas-porch-decorating-front-door.jpg',
    'Collierville Christmas porch decorating with wreaths, garland, and front door holiday styling'],
  faq: ['/assets/img/celebrations/romantic-bedroom-experience.jpg',
    'Celebration setup in a hotel room with balloons and candles'],
  local: ['/assets/img/party/memphis-party-decor-hotel-room-birthday-setup.jpg',
    'Memphis hotel room birthday party decor setup'],
  events: ['/assets/img/grazing/grazing-table-corporate.jpg',
    'Styled grazing table setup for an event in the Memphis area']
};

const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

// --- the consolidated FAQ (owner ruling 2026-10-17) -------------------------
// Sections by service with anchors and jump links; the grazing estimator and the
// porch-size picker read their numbers from the same data the answers quote.
const money = faqContent.money;

function porchPickerHtml() {
  const tiers = faqContent.porchTiers;
  return `
        <div class="faq-tool" id="porch-picker"><div class="porch-tiers" data-estimator="porch">${tiers.map((t) => `
          <article class="card porch-tier"><img src="${t.image}" alt="${esc(t.name)}: ${esc(t.describe)}" loading="lazy" width="1200" height="900" /><div class="card-body"><h3>${esc(t.name)}</h3><p>${esc(t.describe)}</p><p class="price">From ${money(t.from)}</p><p class="muted">Looks like yours? Attach a photo of your porch to your quote request.</p></div></article>`).join('')}
        </div>
        <p class="muted estimator-note" style="text-align:center;margin-top:14px;">${esc(offers.services.porch.notes[1])} ${esc(offers.addOns.takedown.line)}</p></div>`;
}

function grazingEstimatorHtml() {
  const tiers = faqContent.grazingTiers;
  const food = faqContent.food;
  const cfg = JSON.stringify({ tiers, food: { low: food.low, high: food.high } });
  return `
        <div class="info-panel estimator" id="grazing-estimator" data-estimator="grazing" data-config='${cfg.replace(/'/g, '&#39;')}'>
          <h3>How big a grazing table do I need?</h3>
          <form class="estimator-form" onsubmit="return false">
            <label>Guests <input type="number" name="guests" min="1" max="500" value="30" inputmode="numeric"></label>
            <label>Serving as <select name="style"><option value="snack">A snack with drinks</option><option value="meal">The meal</option></select></label>
            <label>Food <select name="food"><option value="us">Sourced by Porch &amp; Party</option><option value="you">Supplied by you</option></select></label>
          </form>
          <div class="estimator-result" aria-live="polite">
            <div><strong data-out="size"></strong></div>
            <div>Setup and styling: <strong data-out="styling"></strong></div>
            <div>Food: <strong data-out="food"></strong></div>
            <p class="muted estimator-note">${esc(food.line)}</p>
          </div>
          <noscript><p class="muted">${tiers.map((t) => `${esc(t.name)}: ${t.feedsSnack[0]} to ${t.feedsSnack[1]} as a snack, ${t.feedsMeal[0]} to ${t.feedsMeal[1]} as the meal, styling from ${money(t.from)}.`).join(' ')}</p></noscript>
        </div>
        <script>(function(){var el=document.querySelector('[data-estimator="grazing"]');if(!el)return;var cfg=JSON.parse(el.getAttribute('data-config'));var f=el.querySelector('form');var out=function(k){return el.querySelector('[data-out="'+k+'"]')};var money=function(n){return '$'+Math.round(n).toLocaleString('en-US')};
function pick(guests,style){var key=style==='meal'?'feedsMeal':'feedsSnack';var main=cfg.tiers.slice(0,3);var extra=cfg.tiers[3];for(var i=0;i<main.length;i++){if(guests<=main[i][key][1])return {tier:main[i],extras:0};}var full=main[2];var more=Math.max(0,Math.ceil((guests-full[key][1])/extra[key][1]));return {tier:full,extras:more};}
function run(){var g=Math.max(1,parseInt(f.guests.value,10)||1);var r=pick(g,f.style.value);var name=r.tier.name+(r.extras?' + '+r.extras+' additional table'+(r.extras>1?'s':''):'');out('size').textContent=name+' for '+g+' guests';out('styling').textContent='from '+money(r.tier.from+r.extras*cfg.tiers[3].from);out('food').textContent=f.food.value==='you'?'$0, you supply the food':'rough estimate '+money(g*cfg.food.low)+' to '+money(g*cfg.food.high)+' ('+money(cfg.food.low)+' to '+money(cfg.food.high)+' a head)';}
f.addEventListener('input',run);f.addEventListener('change',run);run();})();</script>`;
}

// Owner-approved navigation (2026-10-17): a map of the page under the hero, a
// sticky jump nav, native <details> accordions (first open per section), the
// calculator first in its section, one quote button and a back/next row per section.
function faqMapHtml(groups) {
  const card = (href, title, lead, meta, go, tool) => `<a class="faq-map__card${tool ? ' faq-map__card--tool' : ''}" href="${href}">`
    + `<span class="faq-map__title">${esc(title)}</span><span class="faq-map__lead">${esc(lead)}</span>`
    + `<span class="faq-map__meta">${meta}</span><span class="faq-map__go">${go} &rarr;</span></a>`;
  return `
        <nav class="faq-map" aria-label="What is on this page">${groups.map((g) => card(`#${g.id}`, g.title, g.lead, `${g.qa.length} questions`, 'See answers', false)).join('')}${card('#porch-picker', 'Price my porch', 'Pick the porch picture that looks like yours for a starting price.', 'Porch picker', 'Open the picker', true)}${card('#grazing-estimator', 'Estimate my grazing table', 'Enter your guest count for a table size and a starting price.', 'Grazing estimator', 'Open the estimator', true)}</nav>`;
}

const FAQ_NAV_SCRIPT = `<script>(function(){var nav=document.querySelector('.faq-jump');if(!nav||!('IntersectionObserver' in window))return;var links={};Array.prototype.forEach.call(nav.querySelectorAll('a[href^="#"]'),function(a){links[a.getAttribute('href').slice(1)]=a;});var set=function(id){Object.keys(links).forEach(function(k){var a=links[k];if(k===id){a.classList.add('is-active');a.setAttribute('aria-current','true');if(nav.scrollWidth>nav.clientWidth)nav.scrollLeft=Math.max(0,a.offsetLeft-nav.firstElementChild.offsetWidth-24);}else{a.classList.remove('is-active');a.removeAttribute('aria-current');}});};var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)set(e.target.id);});},{rootMargin:'-170px 0px -55% 0px'});Object.keys(links).forEach(function(id){var el=document.getElementById(id);if(el)io.observe(el);});})();</script>`;

function groupedFaqHtml(groups) {
  const jump = `<nav class="faq-jump" aria-label="FAQ sections"><span class="faq-jump__label">Jump to:</span>${groups.map((g) => `<a href="#${g.id}">${esc(g.title)}</a>`).join('')}</nav>`;
  const sections = groups.map((g, i) => {
    const next = groups[i + 1];
    const tool = g.picker === 'porch' ? porchPickerHtml() : g.estimator === 'grazing' ? grazingEstimatorHtml() : '';
    return `
        <section class="faq-section" id="${g.id}">
          <div class="answer-block"><span class="eyebrow">${esc(g.eyebrow)}</span><h2>${esc(g.title)}</h2><p>${esc(g.intro)}</p></div>${tool}
          <div class="faq-list">${g.qa.map(([q, a], j) => `<details class="faq-item"${j === 0 ? ' open' : ''}><summary><h3>${esc(q)}</h3></summary><p>${esc(a)}</p></details>`).join('')}</div>
          <p class="faq-cta"><a ${QUOTE_LINK} class="btn-primary">Request a Quote</a></p>
          <p class="faq-next"><a href="#top">&uarr; Back to top</a>${next ? `<a href="#${next.id}">Next: ${esc(next.title)} &rarr;</a>` : ''}</p>
        </section>`;
  }).join('');
  return `${jump}${sections}
        ${FAQ_NAV_SCRIPT}`;
}

function breadcrumbHtml(crumb) {
  return `<div class="breadcrumb-bar"><div class="container">`
    + `<nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li>`
    + `<li aria-current="page">${crumb}</li></ol></nav></div></div>`;
}

function render(section, groups) {
  const url = `${DOMAIN}/${section.dir}/index.html`;
  const [img, imgAlt] = SOCIAL[section.dir];
  const image = `${DOMAIN}${img}`;
  const plainH1 = unesc(section.h1);

  const cards = groups.map((g) => `<div class="answer-block"><h2>${esc(g.heading)}</h2>`
    + (g.blurb ? `<p>${esc(g.blurb)}</p>` : '')
    + `</div><div class="cards-grid">`
    + g.pages.map((p) => `<article class="card"><div class="card-body">`
      + `<h3><a href="${p.url}">${esc(p.h1)}</a></h3>`
      + (p.lead ? `<p class="muted">${esc(p.lead)}</p>` : '')
      + `</div></article>`).join('')
    + `</div>`).join('\n');

  const listItems = groups.flatMap((g) => g.pages);
  // The publisher node. Organization/LocalBusiness sat on 95% of this site's
  // pages and was absent from exactly these five section indexes, because every
  // other page gets it from templates/page-shell.js and an index is composed
  // here. Same brand name, domain and served area as the LocalBusiness node
  // page-shell.js already emits, read from the same data files, plus the
  // telephone and Google listing from scripts/lib/contact_surface.js; no street address.
  const publisher = require('../lib/contact_surface').canonicalBusiness({ '@context': 'https://schema.org', areaServed: areasData.areas });
  const jsonld = [
    publisher,
    { '@context': 'https://schema.org', '@type': 'CollectionPage', name: plainH1, description: section.description, url, publisher: { '@id': `${DOMAIN}/#business` } },
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${DOMAIN}/` },
        { '@type': 'ListItem', position: 2, name: section.crumb, item: url }
      ]
    },
    {
      '@context': 'https://schema.org', '@type': 'ItemList', name: plainH1, url,
      numberOfItems: listItems.length,
      itemListElement: listItems.map((p, i) => ({
        '@type': 'ListItem', position: i + 1, name: p.h1, url: `${DOMAIN}${p.url}`
      }))
    }
  ];
  if (section.faq && section.faq.length) {
    jsonld.push({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: section.faq.map(([q, a]) => ({
        '@type': 'Question', name: unesc(q),
        acceptedAnswer: { '@type': 'Answer', text: unesc(a) }
      }))
    });
  }
  const jsonldHtml = jsonld.map(ld).join('\n  ');

  const faqHtml = section.groups
    ? groupedFaqHtml(section.groups)
    : section.faq && section.faq.length
    ? `
    <section class="section">
      <div class="container">
        <div class="answer-block"><span class="eyebrow">FAQ</span><h2>Questions about this section</h2></div>
        <div class="faq-list">${section.faq
          .map(([q, a]) => `<article class="faq-item"><h3>${esc(q)}</h3><p>${esc(a)}</p></article>`).join('')}</div>
      </div>
    </section>
`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${section.title}</title>
  <meta name="description" content="${esc(section.description)}" />
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
  <link rel="canonical" href="${url}" />
  <meta property="og:title" content="${section.title}" />
  <meta property="og:description" content="${esc(section.description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${url}" />
  <meta property="og:site_name" content="Porch &amp; Party" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:image" content="${image}" />
  <meta property="og:image:alt" content="${imgAlt}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${section.title}" />
  <meta name="twitter:description" content="${esc(section.description)}" />
  <meta name="twitter:image" content="${image}" />
  <meta name="theme-color" content="#faf7f2" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/styles.css" />
  <link rel="stylesheet" href="/assets/css/site-nav.css" data-site-chrome="css" />
  ${jsonldHtml}
</head>
<body>
  ${nav()}
  <main>
    ${breadcrumbHtml(section.crumb)}
    <section class="section${section.groups ? ' faq-hero' : ''}">
      <div class="container">
${section.groups ? `        <div class="page-intro" id="top">
          <span class="eyebrow">${section.eyebrow}</span>
          <h1>${section.heroH1}</h1>
          <p>${section.lead}</p>
          <p class="faq-hero-note">${esc(section.heroNote)}</p>
          <div class="btn-row hero-centered-cta"><a href="${QUOTE.href}" class="btn-primary"${QUOTE_ATTRS}>Request a Quote</a></div>
        </div>${faqMapHtml(section.groups)}
` : `        <div class="page-intro">
          <span class="eyebrow">${section.eyebrow}</span>
          <h1>${section.h1}</h1>
          <p>${section.lead}</p>
          <div class="btn-row hero-centered-cta"><a href="${QUOTE.href}" class="btn-primary"${QUOTE_ATTRS}>Request a Quote</a><a href="/pricing.html" class="btn-secondary">See Pricing</a></div>
        </div>
        <div class="info-panel recommendation-summary" data-content-block="recommendation_summary" id="recommendation-summary">
          <h2>What this page recommends</h2>
          <p class="recommendation-summary__answer">${esc(section.summary)}</p>
          <ul class="recommendation-summary__points">
            <li><strong>Pages in this section:</strong> ${listItems.length}</li>
            <li><strong>Service area:</strong> ${CITY_LIST} and the greater Memphis metro area.</li>
            <li><strong>Next step:</strong> <a ${QUOTE_LINK}>Request a Quote</a></li>
          </ul>
        </div>
`}      </div>
    </section>

    <section class="section section-soft${section.groups ? ' faq-body' : ''}">
      <div class="container">
${section.groups ? faqHtml : cards}
      </div>
    </section>

${section.groups ? `    <section class="section faq-longer-section">
      <div class="container">
${groups.map((g) => `<div class="answer-block"><h2>${esc(g.heading)}</h2>${g.blurb ? `<p>${esc(g.blurb)}</p>` : ''}</div>`
  + `<ul class="faq-longer">${g.pages.map((p) => `<li><a href="${p.url}">${esc(p.h1)}</a></li>`).join('')}</ul>`).join('\n')}
      </div>
    </section>
` : faqHtml}
    <section class="section section-soft">
      <div class="container">
        <div class="info-panel"><h2>Related pages</h2><ul>${section.related
          .map((r) => `<li><a ${r === '/contact.html' ? QUOTE_LINK : `href="${r}"`}>${esc(RELATED_LABELS[r] || r)}</a></li>`).join('')}</ul></div>
      </div>
    </section>
${section.groups ? '' : `
    <section class="section cta-band">
      <div class="container">
        <span class="eyebrow">Request a Quote</span>
        <h2>Ready to plan your setup?</h2>
        <p>Share the occasion, city, date, location type, budget range, and any inspiration notes so Porch &amp; Party can confirm fit and quote direction.</p>
        <div class="btn-row hero-centered-cta"><a href="${QUOTE.href}" class="btn-primary"${QUOTE_ATTRS}>Start Your Request</a></div>
        <p class="muted" style="margin-top: 14px;"><a href="mailto:hello@porchandparty901.com">hello@porchandparty901.com</a></p>
      </div>
    </section>`}
  </main>
  ${footer()}
</body>
</html>
`;
}

// --- run --------------------------------------------------------------------

const written = [];
const skipped = [];
const routes = [];
for (const section of SECTIONS) {
  const pages = pagesIn(section.dir);
  if (pages.length < MIN_PAGES) { skipped.push(`${section.dir} (${pages.length} pages)`); continue; }
  routes.push(`/${section.dir}/index.html`);
  const html = render(section, section.group(pages));
  const out = path.join(ROOT, section.dir, 'index.html');
  const before = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
  if (before === html) { written.push(`${section.dir}/index.html (unchanged, ${pages.length} pages)`); continue; }
  if (CHECK) { console.error(`would rewrite ${section.dir}/index.html`); process.exitCode = 1; continue; }
  fs.writeFileSync(out, html);
  written.push(`${section.dir}/index.html (${pages.length} pages)`);
}

// The HTML sitemap (/sitemap, linked from every footer, owner-approved
// 2026-10-18) is the index of these indexes: its link lists are regenerated
// here from the routes just built, so it can never list a section that is not
// on disk or miss one that is. Only the page's <div class="content-wrap"> is
// written; the rest of the page (head, chrome, related nav) belongs to the
// passes that own it. It is recorded below as a section index for the same
// reason the indexes are: it introduces no subject matter of its own.
const HTML_SITEMAP = 'sitemap.html';
const siteChrome = require(path.join(ROOT, 'scripts/lib/site_chrome.js'));
function htmlSitemapBody(indexRoutes) {
  const ul = (items) => `<ul>${items.map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join('')}</ul>`;
  const extra = ['answers/index.html'].filter((rel) => fs.existsSync(path.join(ROOT, rel))).map((rel) => `/${rel}`);
  const indexes = [...new Set([...indexRoutes, ...extra])].filter((r) => r !== '/services/index.html' && r !== '/faq/index.html').sort()
    .map((r) => [r.replace(/index\.html$/, ''), esc(readPage(r.slice(1)).h1)]);
  return '<span class="eyebrow">Sitemap</span><h1>Sitemap</h1>'
    + '<p>Every section of the Porch &amp; Party website in one place.</p>'
    + '<h2>Services and booking</h2>' + ul([['/', 'Home'], ['/services/', 'Services'], ['/rentals/', 'Party Game Rentals'], ['/pricing', 'Pricing'],
      ['/faq/', 'Frequently asked questions'], ['/how-it-works', 'How It Works'], ['/contact', 'Contact']])
    + '<h2>Guides and answers</h2>' + ul(indexes)
    + '<h2>Legal</h2>' + ul(siteChrome.LEGAL_LINKS.filter((l) => l.href !== '/sitemap').map((l) => [l.href, l.label]))
    + '<p class="muted">For search engines: <a href="/sitemap.xml">sitemap.xml</a>.</p>';
}
if (!CHECK) {
  const abs = path.join(ROOT, HTML_SITEMAP);
  if (!fs.existsSync(abs)) throw new Error(`${HTML_SITEMAP} is missing: the footer links /sitemap`);
  const before = fs.readFileSync(abs, 'utf8');
  const re = /(<div class="content-wrap">)[\s\S]*?(<\/div><\/div><\/section>)/;
  if (!re.test(before)) throw new Error(`${HTML_SITEMAP} has no content-wrap to write the link lists into`);
  const after = before.replace(re, (w, a, b) => a + htmlSitemapBody(routes) + b);
  if (after !== before) fs.writeFileSync(abs, after);
  routes.push(`/${HTML_SITEMAP.replace(/\.html$/, '')}`); // the served path; the sitemap.xml loc is /sitemap
}

// Record which routes are section indexes rather than publications, so
// scripts/cadence_gate.js can tell the two apart. The generator is the only
// thing that knows, and writing it here keeps the list from drifting away from
// what was actually built.
if (!CHECK) {
  const registry = path.join(ROOT, 'data/cadence/section_indexes.json');
  fs.mkdirSync(path.dirname(registry), { recursive: true });
  fs.writeFileSync(registry, JSON.stringify({
    _why: 'Routes emitted by scripts/generators/build_section_indexes.js. A section index is regenerated from the pages it lists, so it consumes none of the refresh capacity the publication cap protects. It is still counted in library size, staleness and the ceiling.',
    generated_by: 'scripts/generators/build_section_indexes.js',
    routes: routes.slice().sort(),
  }, null, 2) + '\n');
}

console.log(`Section indexes: ${written.length} built`);
for (const w of written) console.log(`  ${w}`);
if (skipped.length) console.log(`  skipped (fewer than ${MIN_PAGES} pages): ${skipped.join(', ')}`);
