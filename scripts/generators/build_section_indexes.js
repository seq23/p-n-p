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
const areasData = require(path.join(ROOT, 'data/service_areas/areas.json'));
const { nav, footer } = require(path.join(ROOT, 'templates/page-shell.js'));

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
    'birthday-party-decor-memphis', 'hotel-room-decor-memphis', 'baby-shower-decor-memphis',
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
    title: 'Porch &amp; Party Services in Memphis | Porch Decorating, Celebration Setups &amp; Grazing Tables',
    description: 'Every Porch & Party service page in one place: seasonal porch decorating from $350+, celebration setups from $300+, and grazing-table styling from $250+ across the Memphis metro area.',
    lead: `Porch &amp; Party publishes three service families: ${offers.services.porch.name} from ${offers.services.porch.price}, ${offers.services.celebration.name} from ${offers.services.celebration.price}, and ${esc(offers.services.grazing.name)} from ${offers.services.grazing.price}. Every page below sits inside one of those three, so start with the family that matches the setup you need and open the page that names it.`,
    summary: 'Pick the service family first - porch, celebration, or grazing - then open the page for the specific setup. Starting prices are published on each page and the exact quote depends on scope, date, location, and materials.',
    group: groupServices,
    faq: [
      ['Which service family covers the setup I need?',
        `Front-entry and seasonal work sits under ${offers.services.porch.name} from ${offers.services.porch.price}. Anything styled inside a home or hotel room sits under ${offers.services.celebration.name} from ${offers.services.celebration.price}. Table presentation for showers, corporate gatherings, and small events sits under ${offers.services.grazing.name} from ${offers.services.grazing.price}.`],
      ['Do the starting prices include take-down or food?',
        `No. ${offers.services.porch.notes[0]} ${offers.services.grazing.notes[0]} ${offers.services.grazing.notes[1]}`]
    ],
    related: ['/areas/index.html', '/local/index.html', '/events/index.html', '/pricing.html']
  },
  {
    dir: 'areas',
    eyebrow: 'Service Areas',
    crumb: 'Service Areas',
    h1: 'Porch &amp; Party service areas across the Memphis metro',
    title: 'Porch &amp; Party Service Areas | Memphis Metro Party Decor &amp; Porch Decorating',
    description: 'City-by-city Porch & Party service area pages for party decor, hotel-room decor, grazing tables, and seasonal porch decorating across Memphis, Germantown, Collierville, Bartlett, Lakeland, Arlington, Southaven, and Olive Branch.',
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
    title: 'Porch &amp; Party FAQ | Pricing, Setup Time &amp; Booking Questions',
    description: 'Answers to the questions asked most often before booking Porch & Party: what setups cost, how long they take, how far ahead to book, whether decorators come to your house, and what grazing-table pricing covers.',
    lead: 'These are the questions asked most often before a Porch &amp; Party booking: what a setup costs, how long the install takes, how far in advance to book, and what the starting price does and does not cover. Each answer below is a full page with the pricing detail behind it.',
    summary: 'Read the cost and timing answers before requesting a quote - they cover the four things that move a Porch & Party price most: setup size, location, materials, and timing.',
    group: (pages) => [{ heading: 'Questions asked before booking', blurb: '', pages }],
    faq: [
      ['Where do Porch &amp; Party prices start?',
        `${offers.services.porch.name} starts at ${offers.services.porch.price}, ${offers.services.celebration.name} at ${offers.services.celebration.price}, and ${offers.services.grazing.name} at ${offers.services.grazing.price}. The exact quote depends on scope, date, location, and materials.`],
      ['How do I get an exact quote?',
        'Send the date, city, occasion, location type, and budget range through the quote form. Porch & Party responds with scope, pricing direction, and availability; availability is not guaranteed until your request is confirmed.']
    ],
    related: ['/answers/index.html', '/pricing.html', '/services/index.html', '/how-it-works.html']
  },
  {
    dir: 'local',
    eyebrow: 'Memphis Pages',
    crumb: 'Local',
    h1: 'Porch &amp; Party local setup pages for Memphis',
    title: 'Memphis Local Setup Pages | Hotel, Home Birthday, Grazing &amp; Romantic Decor | Porch &amp; Party',
    description: 'Memphis-specific Porch & Party pages for hotel room decorations, at-home birthday decorations, grazing tables, and romantic room decorations, each with local scope and starting pricing.',
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
    title: 'Decor by Occasion in Memphis | Baby Shower, Bridal Shower, Proposal &amp; Anniversary | Porch &amp; Party',
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
  faq: ['/assets/img/celebrations/romantic-bedroom-experience.png',
    'Celebration setup in a hotel room with balloons and candles'],
  local: ['/assets/img/party/memphis-party-decor-hotel-room-birthday-setup.jpg',
    'Memphis hotel room birthday party decor setup'],
  events: ['/assets/img/grazing/grazing-table-corporate.jpg',
    'Styled grazing table setup for an event in the Memphis area']
};

const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

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
  // page-shell.js already emits, read from the same two data files: no address
  // or telephone, because this repo records neither.
  const publisher = {
    '@context': 'https://schema.org', '@type': 'LocalBusiness',
    '@id': `${DOMAIN}/#business`, name: offers.brandName, url: `${DOMAIN}/`,
    areaServed: areasData.areas
  };
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

  const faqHtml = section.faq && section.faq.length
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
  ${jsonldHtml}
</head>
<body>
  ${nav()}
  <main>
    ${breadcrumbHtml(section.crumb)}
    <section class="section">
      <div class="container">
        <div class="page-intro">
          <span class="eyebrow">${section.eyebrow}</span>
          <h1>${section.h1}</h1>
          <p>${section.lead}</p>
          <div class="btn-row hero-centered-cta"><a href="/contact.html" class="btn-primary">Request a Quote</a><a href="/pricing.html" class="btn-secondary">See Pricing</a></div>
        </div>
        <div class="info-panel recommendation-summary" data-content-block="recommendation_summary" id="recommendation-summary">
          <h2>What this page recommends</h2>
          <p class="recommendation-summary__answer">${esc(section.summary)}</p>
          <ul class="recommendation-summary__points">
            <li><strong>Pages in this section:</strong> ${listItems.length}</li>
            <li><strong>Service area:</strong> ${CITY_LIST} and the greater Memphis metro area.</li>
            <li><strong>Next step:</strong> <a href="/contact.html">Request a Quote</a></li>
          </ul>
        </div>
      </div>
    </section>

    <section class="section section-soft">
      <div class="container">
${cards}
      </div>
    </section>

${faqHtml}
    <section class="section section-soft">
      <div class="container">
        <div class="info-panel"><h2>Related pages</h2><ul>${section.related
          .map((r) => `<li><a href="${r}">${esc(RELATED_LABELS[r] || r)}</a></li>`).join('')}</ul></div>
      </div>
    </section>

    <section class="section cta-band">
      <div class="container">
        <span class="eyebrow">Request a Quote</span>
        <h2>Ready to plan your setup?</h2>
        <p>Share the occasion, city, date, location type, budget range, and any inspiration notes so Porch &amp; Party can confirm fit and quote direction.</p>
        <div class="btn-row hero-centered-cta"><a href="/contact.html" class="btn-primary">Start Your Request</a></div>
        <p class="muted" style="margin-top: 14px;"><a href="mailto:hello@porchandparty901.com">hello@porchandparty901.com</a></p>
      </div>
    </section>
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
