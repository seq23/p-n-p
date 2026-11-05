#!/usr/bin/env node
'use strict';
/**
 * /hotels - the owner's guide "Romantic Memphis Hotel Rooms" as a public page.
 *
 * WHY
 * ---
 * Owner, 5 Nov 2026: "we need to add a new landing page porchandparty901.com/hotels
 * and add this guide". She chose to copy her guide word for word (all 15 hotels,
 * every field, prices, booking links, the intro, the "best for" summary and the
 * disclaimer) but with NO third-party photo embedded or hotlinked: the room photos
 * belong to the hotels and booking sites (risk rule R-REPO-04, images only with a
 * licence). Each hotel's photo becomes a "See the room photos" link to the same
 * original URL the guide used, opening in a new tab, and the photo credit is kept.
 *
 * EVERY WORD OF THE GUIDE COMES FROM data/guides/memphis_romantic_hotels.json,
 * never from this script. This script adds only the page frame and the short
 * Porch & Party section at the end (we decorate hotel rooms; the 3 to 6 PM
 * check-in window; we are not affiliated with the hotels, R-REPO-06).
 *
 * The one picture on the page is our own: an owner photo already registered in
 * data/offers/service_ai_images.json.
 *
 * Idempotent: a second run writes nothing. The head is deliberately minimal, like
 * scripts/install_about_page.js: the install passes that run after it complete it.
 *
 * Guarded by scripts/validation/validate.js (npm run validate:all, inside validate:release).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const brand = require(path.join(ROOT, 'scripts/lib/brand.js'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const contactSurface = require(path.join(ROOT, 'scripts/lib/contact_surface.js'));
const siteChrome = require(path.join(ROOT, 'scripts/lib/site_chrome.js'));
const { nav, footer } = require(path.join(ROOT, 'templates/page-shell.js'));
const guide = require(path.join(ROOT, 'data/guides/memphis_romantic_hotels.json'));
const images = require(path.join(ROOT, 'data/offers/service_ai_images.json'));

const REL = 'hotels.html';
const DOMAIN = offers.domain;
const URL = `${DOMAIN}/hotels`;
const E = offers.contact.entity;
const esc = brand.esc;
const QUOTE = siteChrome.QUOTE.href;
const QA = siteChrome.QUOTE_ATTRS;
const HOTEL_SERVICE = '/services/hotel-room-decor-memphis';

const TITLE = 'Romantic Memphis Hotel Rooms: The Porch & Party Guide';
const DESCRIPTION = 'Fifteen romantic Memphis hotel rooms, from the Peabody to Big Cypress Lodge: the room to request, why it works, price guidance and where to book.';

if (TITLE.length < 30 || TITLE.length > 65) throw new Error(`${REL} title is ${TITLE.length} characters (30-65): ${TITLE}`);
if (DESCRIPTION.length < 120 || DESCRIPTION.length > 160) throw new Error(`${REL} description is ${DESCRIPTION.length} characters (120-160): ${DESCRIPTION}`);
if (!Array.isArray(guide.hotels) || guide.hotels.length !== 15) throw new Error(`data/guides/memphis_romantic_hotels.json holds ${guide.hotels && guide.hotels.length} hotels; the owner's guide has 15`);

// The hero is our own photo, never a hotel's: it must be an owner photo in the registry.
const HERO = images.images.find((i) => i.file === 'assets/img/celebrations/owner-romantic-bedroom-homepage.webp');
if (!HERO || HERO.source !== 'owner') throw new Error('hotels hero: owner-romantic-bedroom-homepage.webp is not a registered owner photo');

const L = guide.labels;
// The answer-first line (content-pattern contract: a quotable lead under the h1). Ours, not the
// guide's: it only names what the guide holds, so the guide's own words follow unchanged.
const LEAD = `Porch & Party's guide to ${guide.hotels.length} romantic hotel rooms in Memphis, downtown and nearby neighborhoods first: for each one, the room to request, why it works, price guidance and the official booking page.`;
const NEW_TAB = 'target="_blank" rel="noopener"';
const label = (t) => `<h3 style="font-size:13px;letter-spacing:0.08em;margin:18px 0 4px;">${esc(t)}</h3>`;

function hotelCard(h, i) {
  const n = String(i + 1).padStart(2, '0');
  return `<article class="info-panel" id="hotel-${n}" data-hotel="${n}">
<span class="eyebrow">${esc(h.zone)}</span>
<h2>${esc(h.name)}</h2>
<p class="muted">${esc(h.address)}</p>
<p><strong>${esc(L.bestFor)}:</strong> ${esc(h.bestFor)}</p>
${label(L.roomToRequest)}<p>${esc(h.roomToRequest)}</p>
${label(L.whyItWorks)}<p>${esc(h.whyItWorks)}</p>
${label(L.priceGuidance)}<p>${esc(h.priceGuidance)}</p>
<div class="btn-row" style="margin-top:18px;"><a class="btn-primary" href="${esc(h.bookingUrl)}" ${NEW_TAB} data-hotel-booking>${esc(L.booking)}</a><a class="btn-secondary" href="${esc(h.photoUrl)}" ${NEW_TAB} data-hotel-photo>See the room photos ↗</a></div>
<p class="muted" style="font-size:13px;margin-top:10px;">${esc(h.photoCredit)}</p>
</article>`;
}

function jsonLd() {
  const blocks = [
    { '@context': 'https://schema.org', '@type': 'Article', headline: TITLE, description: DESCRIPTION, url: URL, mainEntityOfPage: URL,
      author: { '@id': E.id }, publisher: { '@id': E.id },
      about: { '@type': 'ItemList', name: 'Romantic Memphis hotel rooms', numberOfItems: guide.hotels.length,
        itemListElement: guide.hotels.map((h, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Hotel', name: h.name, address: h.address.replace(' · ', ', '), url: h.bookingUrl } })) } },
    { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: offers.brandName, url: `${DOMAIN}/`, description: brand.IDENTITY_SENTENCE,
      ...contactSurface.businessContactFields() },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${DOMAIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Romantic Memphis hotel rooms', item: URL },
    ] },
  ];
  return contactSurface.patchJsonLd(blocks.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join('\n'));
}

function html() {
  const best = guide.bestFor.map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${esc(v)}</li>`).join('');
  const heroSrc = `/${HERO.file}`;
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
<meta property="og:type" content="article" />
<meta property="og:url" content="${URL}" />
<meta property="og:site_name" content="${esc(offers.brandName)}" />
<meta property="og:locale" content="en_US" />
<meta property="og:image" content="${DOMAIN}${heroSrc}" />
<meta property="og:image:alt" content="${esc(HERO.alt)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(TITLE)}" />
<meta name="twitter:description" content="${esc(DESCRIPTION)}" />
<meta name="twitter:image" content="${DOMAIN}${heroSrc}" />
<meta name="theme-color" content="#faf7f2" />
<link rel="stylesheet" href="/assets/css/styles.css" />
${jsonLd()}
</head>
<body>
${nav('/hotels.html')}
<main>
<div class="breadcrumb-bar"><div class="container"><nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">Romantic Memphis hotel rooms</li></ol></nav></div></div>
<section class="section" data-hotels-guide><div class="container"><div class="page-intro">
<span class="eyebrow">${esc(guide.eyebrow)}</span>
<h1>${esc(guide.headline)}</h1>
<p class="service-answer">${esc(LEAD)}</p>
<p>${esc(guide.subhead)}</p>
<p class="eyebrow" style="margin-top:12px;">${esc(guide.areas)}</p>
<div class="btn-row hero-centered-cta"><a href="#hotel-01" class="btn-primary">See the 15 hotels</a><a href="${HOTEL_SERVICE}" class="btn-secondary">Hotel room decor</a></div>
</div>
<div class="card-media" style="border-radius:16px;overflow:hidden;max-width:520px;margin:28px auto 0;"><img src="${heroSrc}" alt="${esc(HERO.alt)}" width="${HERO.width}" height="${HERO.height}" decoding="async" style="width:100%;height:auto;display:block;"/></div>
<p class="muted" style="text-align:center;font-size:13px;margin-top:8px;">A room set up by Porch &amp; Party.</p>
</div></section>
<section class="section section-soft"><div class="container"><div class="content-stack">
<div class="info-panel" id="find-your-kind-of-romantic"><h2>${esc(guide.introHeading)}</h2><p>${esc(guide.intro)}</p><ul>${best}</ul><p class="muted">${esc(guide.disclaimer)}</p></div>
${guide.hotels.map(hotelCard).join('\n')}
</div></div></section>
<section class="section cta-band" id="hotel-room-decor"><div class="container"><span class="eyebrow">Porch &amp; Party</span><h2>Want the room decorated before you arrive?</h2><p>We decorate hotel rooms in Memphis: rose petals, candles, balloons and a bouquet for an anniversary, a proposal or a birthday. See <a href="${HOTEL_SERVICE}">hotel room decor</a> for what a setup includes.</p><p>Hotel rooms: we generally need to be there from 3 to 6 PM, around check-in time.</p><p class="muted">Porch &amp; Party is not affiliated with any hotel on this page. You book your own room; permission to decorate it is yours to arrange with the hotel.</p><div class="btn-row hero-centered-cta"><a href="${QUOTE}" class="btn-primary"${QA}>Request a Quote</a><a href="${HOTEL_SERVICE}" class="btn-secondary">Hotel room decor</a></div></div></section>
</main>
${footer()}
</body>
</html>
`;
}

module.exports = { TITLE, DESCRIPTION, REL, URL, html, guide };

if (require.main === module) {
  const abs = path.join(ROOT, REL);
  const next = html();
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (before === next) console.log('hotels-page: already current');
  else {
    fs.writeFileSync(abs, next);
    console.log(`hotels-page: ${before === null ? 'created' : 'updated'} ${REL}`);
  }
}
