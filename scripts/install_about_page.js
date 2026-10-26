#!/usr/bin/env node
'use strict';
/**
 * /about - who is behind this site, written from the data this repository
 * already holds and nothing else.
 *
 * WHY
 * ---
 * Her Search Readiness Checklist item c6: "Author and publisher are real,
 * consistent, and have an About page; E-E-A-T signals (credentials, sources,
 * dates) visible. AI engines weight who is speaking. An unnamed page with no
 * About is the last thing they cite." The 26 Oct 2026 audit found no /about on
 * this site at all, so every answer engine reading it had the four services, the
 * prices and the phone number but nothing saying whose business it is.
 *
 * EVERY CLAIM COMES FROM A DATA FILE, never from this script:
 *   - what the business is and the four services: scripts/lib/brand.js
 *     (IDENTITY_SENTENCE, SERVICES, SERVICE_LIST, CITY_LINE);
 *   - starting prices: data/offers/services.json and data/rentals/games.json
 *     (through brand.PRICES), so the About page can never quote a stale price;
 *   - the phone, the email, the Google Business Profile and the Facebook Page:
 *     data/offers/services.json contact / contact.entity;
 *   - the served cities and the travel rule: data/service_areas/areas.json and
 *     offers.travel;
 *   - takedown and rental pickup: offers.addOns.takedown and games.pickup.
 *
 * THE LEGAL ENTITY IS NOT NAMED HERE. Owner-approved 2026-10-18: Kerseta LLC
 * appears only in the Terms and the Privacy Policy, never anywhere else, and
 * scripts/validation/validate.js fails any other page that prints it. The
 * publisher this page names is Porch & Party, the trading name every other
 * surface uses, and it links to the two documents that do carry the entity - so
 * "who is speaking" is consistent and checkable without breaking that rule.
 *
 * NOT written here either, because the repository holds no record of them: any
 * person's name (no owner name is published anywhere on this site), years in business,
 * job counts, reviews, ratings, awards, certifications and insurance. An About
 * page that invents a credential is worse than no About page.
 *
 * Idempotent: a second run writes nothing. The head is deliberately minimal -
 * the install passes that run after it in build:all (icons, chrome, contact
 * surface, clarity, structured data, social tags) complete it like any other
 * page, and update_sitemap.js publishes it.
 *
 * Guarded by npm run validate:about-page.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const brand = require(path.join(ROOT, 'scripts/lib/brand.js'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const areasData = require(path.join(ROOT, 'data/service_areas/areas.json'));
const INV = require(path.join(ROOT, 'scripts/lib/inventory.js'));
const siteChrome = require(path.join(ROOT, 'scripts/lib/site_chrome.js'));
const contactSurface = require(path.join(ROOT, 'scripts/lib/contact_surface.js'));
const { nav, footer } = require(path.join(ROOT, 'templates/page-shell.js'));
const games = INV.resolve(require(path.join(ROOT, 'data/rentals/games.json')));

const REL = 'about.html';
const DOMAIN = offers.domain;
const URL = `${DOMAIN}/about`;
const C = offers.contact;
const E = C.entity;
const esc = brand.esc;
const P = brand.PRICES;
const QUOTE = siteChrome.QUOTE.href;
const QA = siteChrome.QUOTE_ATTRS;

const TITLE = 'About Porch & Party | Memphis Decor and Rentals';
const DESCRIPTION = `Who Porch & Party is: the Memphis decor and party-rental business behind this site, what its four services start at, where it works and how to check it.`;

if (TITLE.length < 30 || TITLE.length > 65) throw new Error(`about.html title is ${TITLE.length} characters (30-65): ${TITLE}`);
if (DESCRIPTION.length < 120 || DESCRIPTION.length > 160) throw new Error(`about.html description is ${DESCRIPTION.length} characters (120-160): ${DESCRIPTION}`);

const CITIES = areasData.areas;
const SERVICE_ROWS = [
  ['Porch decorating', `from $${P.porch}`, '/services/porch-decorating'],
  ['Party planning &amp; decor', `from $${P.party}`, '/services/celebration-setups'],
  ['Grazing tables', `from $${P.grazing}`, '/services/grazing-and-event-styling'],
  ['Party game rentals', `$${P.gameDay} a game per day`, '/rentals/'],
];

const panel = (h, body) => `<div class="info-panel"><h2>${h}</h2>${body}</div>`;

/**
 * AboutPage + the one business node + breadcrumbs. The business node is built by
 * scripts/lib/contact_surface.js, so this page states exactly the same entity,
 * phone, address, map and profiles as every other page - which is the point of
 * an About page an answer engine can trust.
 */
function jsonLd() {
  const blocks = [
    { '@context': 'https://schema.org', '@type': 'AboutPage', name: TITLE, description: DESCRIPTION, url: URL,
      publisher: { '@id': E.id },
      mainEntity: { '@type': 'LocalBusiness', name: offers.brandName, url: `${DOMAIN}/`, description: brand.IDENTITY_SENTENCE,
        ...contactSurface.businessContactFields() } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${DOMAIN}/` },
      { '@type': 'ListItem', position: 2, name: 'About', item: URL },
    ] },
  ];
  return contactSurface.patchJsonLd(blocks.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join('\n'));
}

function html() {
  const rows = SERVICE_ROWS.map(([name, price, href]) => `<tr><th scope="row"><a href="${href}">${name}</a></th><td>${esc(price)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(TITLE)}</title>
<meta name="description" content="${esc(DESCRIPTION)}" />
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
<link rel="canonical" href="${URL}" />
<meta property="og:title" content="${esc(TITLE)}" />
<meta property="og:description" content="${esc(DESCRIPTION)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${URL}" />
<meta property="og:site_name" content="${esc(offers.brandName)}" />
<meta property="og:locale" content="en_US" />
<meta property="og:image" content="${E.image}" />
<meta property="og:image:alt" content="Seasonal front porch decorating by Porch &amp; Party in the Memphis metro area" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(TITLE)}" />
<meta name="twitter:description" content="${esc(DESCRIPTION)}" />
<meta name="twitter:image" content="${E.image}" />
<meta name="theme-color" content="#faf7f2" />
<link rel="stylesheet" href="/assets/css/styles.css" />
${jsonLd()}
</head>
<body>
${nav('/about.html')}
<main>
<div class="breadcrumb-bar"><div class="container"><nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">About</li></ol></nav></div></div>
<section class="section"><div class="container"><div class="page-intro"><span class="eyebrow">About</span><h1>About Porch &amp; Party</h1><p>${esc(brand.IDENTITY_SENTENCE)} Porch &amp; Party is the publisher of every page on this site and the business you book; the company behind the name, and the terms you book under, are set out in our <a href="/terms-and-conditions">Terms &amp; Conditions</a> and <a href="/privacy-policy">Privacy Policy</a>.</p><p>${esc(brand.CITY_LINE)}. There is no shop to visit: every job is quoted, scheduled and set up at your home, your hotel room or your venue, and party game rentals are picked up in person at ${esc(games.pickup.place)}.</p><div class="btn-row hero-centered-cta"><a href="${QUOTE}" class="btn-primary"${QA}>Request a Quote</a><a href="/how-it-works" class="btn-secondary">How it works</a></div></div></div></section>
<section class="section section-soft"><div class="container content-grid"><div class="content-stack">
${panel('What we do, and what it starts at', `<div class="table-scroll" style="overflow-x:auto;"><table><caption>Porch &amp; Party services and starting prices</caption><thead><tr><th scope="col">Service</th><th scope="col">Starts at</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted" style="margin-top:16px;">Every price here is a starting price and the full quote depends on the setup; see <a href="/pricing">Pricing</a> for what changes it. ${esc(offers.addOns.takedown.line)}</p>`)}
${panel('Where we work', `<p>${esc(offers.travel.line)}</p><p>Each city has its own pages: <a href="/areas/">all service areas</a>.</p>`)}
${panel('How a job runs', `<p>You send the date, the place and what you want through <a href="${QUOTE}"${QA}>the quote form</a>, by phone or by email. We confirm whether the date is open and quote it. Nothing is booked until we confirm it in writing, and the deposit and payment terms are set out in the <a href="/terms-and-conditions#rental-cancellation">Rental &amp; Cancellation Policy</a>.</p><p>${esc(offers.renterSafety.line)}</p>`)}
${panel('How to check us, and reach us', `<ul><li>Google Business Profile: <a href="${C.googleBusinessProfileUrl}" rel="noopener" target="_blank">${esc(C.googleBusinessProfileName)} on Google Maps</a></li><li>Facebook Page: <a href="${C.facebookPageUrl}" rel="noopener" target="_blank">facebook.com/porchandparty901</a></li><li>Phone or text: <a href="${C.telHref}">${esc(C.telephoneDisplay)}</a></li><li>Email: <!--email_off--><a href="mailto:hello@porchandparty901.com">hello@porchandparty901.com</a><!--/email_off--></li></ul><p class="muted">Those two profiles and this site are the same business; the structured data on every page says so.</p>`)}
${panel('What is on these pages, and what is not', `<p>Everything published here is a fact we hold: what each service costs to start, which cities carry no travel fee, what a setup includes, and how a date is held. Nothing else is implied. If what you need is not on the page, ask us rather than assume it.</p>`)}
</div><div class="content-stack">
<div class="card"><div class="card-media"><img src="${E.image.replace(DOMAIN, '')}" alt="Seasonal front porch decorating by Porch &amp; Party in the Memphis metro area" width="1400" height="1050" loading="lazy" decoding="async"/></div><div class="card-body"><h3>${esc(offers.brandName)}</h3><p class="muted">${esc(brand.SERVICE_SENTENCE)}</p><p class="muted">${esc(brand.CITY_LINE)}</p></div></div>
</div></div></section>
<section class="section cta-band"><div class="container"><span class="eyebrow">Request a Quote</span><h2>Tell us about your date</h2><p>Send the date, the place and what you have in mind. We answer with what is open and what it costs.</p><div class="btn-row hero-centered-cta"><a href="${QUOTE}" class="btn-primary"${QA}>Request a Quote</a></div></div></section>
</main>
${footer()}
</body>
</html>
`;
}

// scripts/validators/validate_about_page.js reads these to pin the strings this
// generator owns, so requiring the module must not write anything.
module.exports = { TITLE, DESCRIPTION, REL, html };

if (require.main === module) {
  const abs = path.join(ROOT, REL);
  const next = html();
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (before === next) console.log('about-page: already current');
  else {
    fs.writeFileSync(abs, next);
    console.log(`about-page: ${before === null ? 'created' : 'updated'} ${REL}`);
  }
}
