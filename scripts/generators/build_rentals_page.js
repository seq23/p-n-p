#!/usr/bin/env node
'use strict';
/**
 * Renders /rentals/ (rentals/index.html), the party game rentals page.
 *
 * Every rate, bundle, pickup rule and image on the page comes from
 * data/rentals/games.json (rentals v3, owner-approved 2026-10-15: no delivery,
 * pickup and return at Mt. Moriah Station; availableNow:false items hidden), so the page, its Product/Offer JSON-LD and the
 * Facebook Marketplace copy in docs/listings/ cannot quote two different
 * prices. Header and footer come from templates/page-shell.js like every
 * generated page, with the Rentals link added, and the phone and quote path
 * come from data/offers/services.json through scripts/lib/contact_surface.js.
 *
 * Deterministic: no dates, no randomness, so a re-render of unchanged data is
 * byte-identical and the sitemap lastmod ledger does not advance.
 * scripts/validators/validate_rentals_page.js asserts the file on disk equals
 * a fresh render.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { nav, footer, quoteEventScript } = require(path.join(ROOT, 'templates/page-shell.js'));
const { normalizeHtmlUrls } = require(path.join(ROOT, 'scripts/lib/site_url.js'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const BD = require(path.join(ROOT, 'scripts/lib/business_delivery.js'));
const BDL = BD.businessDeliveryLine(offers); // business delivery, priced from services.json (19 Oct 2026)
const contactSurface = require(path.join(ROOT, 'scripts/lib/contact_surface.js'));
const siteIcons = require(path.join(ROOT, 'scripts/lib/site_icons.js'));
const INV = require(path.join(ROOT, 'scripts/lib/inventory.js'));
const SP = require(path.join(ROOT, 'scripts/lib/service_pages.js'));
const LAWN = SP.PAGES.find((p) => p.key === 'rentals').sections().find((x) => x.id === 'giant-lawn-games');
// Resolved (scripts/lib/inventory.js): the all-games bundles carry every available public game at
// its quantity and say "All games (available now: N)"; a bundle whose items are removed is off.
const RAW_TEXT = fs.readFileSync(path.join(ROOT, 'data/rentals/games.json'), 'utf8');
const data = INV.resolve(JSON.parse(RAW_TEXT));
// The inventory version the admin waits for before it says "Live ✓" (functions/_lib/inventory.mjs).
const INVENTORY_VERSION = INV.hash(JSON.stringify(INV.inventoryOf(data)));

const OUT = path.join(ROOT, 'rentals', 'index.html');
const DOMAIN = offers.domain;
const URL = `${DOMAIN}/rentals/`;
const C = offers.contact;
// The site's request form, opened on its rentals path (a booking, not a quote).
const FORM_URL = '/request?service=rentals';
const MAILTO = 'mailto:hello@porchandparty901.com?subject=Party%20game%20rental%20inquiry';
const TITLE = 'Party Game Rentals in Memphis | Porch and Party';
const money = (n) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const RATE = data.rates;
const PICK = data.pickup;
const PLACE = PICK.place.split(',')[0];
// Hidden items (availableNow:false) keep their data in games.json for later but
// never reach the page, its schema, the invoice prefill or the listings.
const GAMES = data.games.filter((g) => g.availableNow);
const EXTRAS = (data.extras || []).filter((x) => x.availableNow);
const ITEMS = [...GAMES.map((g) => ({ ...g, dayPrice: RATE.day, weekendPrice: RATE.weekend })), ...EXTRAS].map((i) => ({ ...i, deposit: INV.depositOf(data, i) }));
const bySlug = Object.fromEntries(ITEMS.map((i) => [i.slug, i]));
const BUNDLES = INV.offeredBundles(data);
const has = (slug) => ITEMS.some((i) => i.slug === slug);
const bySlugAny = (slug) => ITEMS.find((i) => i.slug === slug);
// Some items ask for a bigger (or smaller) deposit than the usual one.
const ODD_DEPOSIT = ITEMS.some((i) => i.deposit !== data.damageDeposit);
// "Giant Color Stack is made for ages 6 and up, Giant Uno for 7 and up and Grab the Mic for 8 and up"
const AGES = GAMES_FOR_AGES();
function GAMES_FOR_AGES() {
  const aged = data.games.filter((g) => g.availableNow).map((g) => ({ name: g.name, age: Number((String(g.size).match(/ages (\d+)\+/) || [])[1]) })).filter((g) => g.age).sort((a, b) => a.age - b.age);
  if (!aged.length) return '';
  return `${INV.joinAnd(aged.map((g, k) => (k === 0 ? `${g.name} is made for ages ${g.age} and up` : `${g.name} for ${g.age} and up`)))}; every other game suits older kids, teens and adults.`;
}
const MAX_UNITS = Math.max(...ITEMS.map((i) => i.quantity || 1));
const UNITS_WORDS = MAX_UNITS <= 1 ? 'one unit' : MAX_UNITS === 2 ? 'one or two units' : `one to ${INV.words(MAX_UNITS)} units`;
// The bundle that is every item on the page (The Whole Party), if it is on offer.
const EVERYTHING = BUNDLES.find((b) => b.allGames && EXTRAS.every((x) => (b.items || []).includes(x.slug)));
const PICK3 = BUNDLES.find((b) => b.slug === 'pick-3');
const INDOOR_GAME = data.games.find((g) => g.availableNow && g.use === 'indoor');
const cheapestBundle = Math.min(...BUNDLES.map((b) => b.dayPrice));
const DESCRIPTION = `${INV.rentalsPhrase(data, { short: true, games: 'Giant yard games' })} for rent in Memphis, ${money(RATE.day)} a game per day, bundles from ${money(cheapestBundle)}. Pick up and return at ${PLACE}.`;
const H1 = 'Giant yard game rentals for Memphis parties, picked up and returned in Memphis';
const AREAS = ['Memphis, TN', 'Olive Branch, MS', 'Southaven, MS'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const useLabel = (u) => (u === 'outdoor' ? 'Outdoor only' : u === 'indoor' ? 'Indoor tabletop' : 'Indoor or outdoor');

// What a bundle saves against the same items at day (or weekend) prices.
function bundleValue(b, span) {
  const gameRate = span === 'weekend' ? RATE.weekend : RATE.day;
  const items = b.items.map((s) => bySlug[s]);
  const list = b.games * gameRate + items.reduce((t, i) => t + (span === 'weekend' ? i.weekendPrice : i.dayPrice), 0);
  const price = span === 'weekend' ? b.weekendPrice : b.dayPrice;
  return { list, price, save: list - price };
}

// The shared shell blocks. Rentals is in the canonical nav and footer
// (scripts/lib/site_chrome.js), so the page needs no local additions.
const header = nav('/rentals/');
const foot = footer();

const PICKUP_RULES = [
  ['Where', `Pick up and return at ${PICK.place}, ${PICK.address}, a safe exchange zone. Home and personal rentals are picked up and returned there. ${BDL}`],
  ['When', `After payment, text or call ${PICK.phone} to set your pickup time. One day: pick up the day before your event or that morning, and bring everything back the day after or 2 days after. The entire weekend (Friday, Saturday and Sunday): pick up Thursday or Friday, and bring everything back Monday or Tuesday.`],
  ['Pay', `${money(data.damageDeposit)} refundable damage deposit + ${data.holdPercent}% of the rental holds your date, by Zelle or Cash App from your invoice. The rest is paid at pickup by Zelle or Cash App on the spot (never cash). The deposit is refunded at return.`],
  ['Bring', `Your government photo ID (the name must match the invoice) and a car. Every game fits an SUV or a sedan with the seats down${has('inflatable-movie-screen') ? '; the movie screen fits a trunk' : ''}.`]
];

const FAQ = [
  ['Where do I pick up?',
    `At ${PICK.place}, ${PICK.address}. It is a safe exchange zone, and you return the rentals there too. After payment, text or call ${PICK.phone} to set your pickup time. ${BDL}`],
  ['How do I pay?',
    `A ${money(data.damageDeposit)} refundable damage deposit plus ${data.holdPercent}% of the rental fee holds your date, paid by Zelle or Cash App from your invoice. The rest is paid at pickup by Zelle or Cash App on the spot; we do not take cash. The damage deposit is refunded when you return everything.`],
  ['What do I need to bring?',
    `Your government photo ID, with the same name as the invoice, and a car. Every game fits an SUV or a sedan with the seats down${has('inflatable-movie-screen') ? ', and the movie screen fits a trunk' : ''}.`],
  ['How much do the games cost?',
    `Every game is ${money(RATE.day)} a day or ${money(RATE.weekend)} for a weekend. ${EXTRAS.map((x) => `The ${x.name.toLowerCase()} is ${money(x.dayPrice)} a day or ${money(x.weekendPrice)} for a weekend.`).join(' ')} Bundles: ${BUNDLES.map((b) => `${b.name} ${money(b.dayPrice)}${b.weekendPrice ? ` (${money(b.weekendPrice)} for a weekend)` : ''}`).join(', ')}. There is no minimum order.`],
  ['How long is a rental?',
    'One day: pick up the day before your event or that morning, and bring everything back the day after or 2 days after. The entire weekend (Friday, Saturday and Sunday): pick up Thursday or Friday, and bring everything back Monday or Tuesday. The price is the same whichever days you pick.'],
  ['What happens if it rains?',
    `If rain or a storm is forecast for your date, we reschedule the rental free within 30 days. Every game also works indoors, so many hosts simply move the games inside${INDOOR_GAME ? `, and ${INDOOR_GAME.name} is a tabletop game made for an indoor party` : ''}.`],
  ['Can we use the games indoors?',
    `Yes. Every game works indoors on flat floor space${has('giant-connect-four') ? '; the Giant Connect Four stands 4 ft tall' : ''}.${EXTRAS.filter((x) => x.use === 'outdoor').map((x) => ` The ${x.name.toLowerCase()} is outdoor only${x.slug === 'inflatable-movie-screen' ? ' and needs a plug within 50 ft' : ''}.`).join('')}`],
  ...(has('inflatable-movie-screen') && (data.adminItems || []).some((x) => x.slug === 'projector' && x.availableNow !== false) ? [['Do you have a projector?',
    "Yes, we can include one with the movie screen. Just ask when you book; it's one projector, so ask early."]] : []),
  ['How far ahead should I book?',
    `Two to three weeks ahead is safest for Saturdays and holiday weekends, because each item is limited to ${UNITS_WORDS}. Weekday and short-notice requests are fine to send; we confirm what is open for your date.`],
  ['Can I cancel?',
    'Yes. Cancel 48 hours or more before your pickup time for a full refund.'],
  ['Are the games safe for kids, and who can rent?',
    `The renter must be 18 or older and an adult should supervise play. ${AGES ? `${AGES} ` : ''}Games are wiped down between rentals.`]
];

const STEPS = [
  ['Book your games', 'Pick your games, your event date and your pickup and return days on our booking form: it shows what is free and your exact total. Add your photo ID.'],
  ['Hold your date', `Your games are held for ${offers.rentalHolds.defaultHours} hours. ${money(data.damageDeposit)} damage deposit + ${data.holdPercent}% by Zelle or Cash App from your invoice confirms them.`],
  ['Pick up', `Text or call ${PICK.phone} to set a time, then meet us at ${PLACE}. We check your ID and you pay the rest on the spot.`],
  ['Return', 'Bring everything back on the day you picked: the day after or 2 days after your event, or Monday or Tuesday after a weekend. We check every piece and refund the deposit.']
];

const TERMS = [
  `<strong>Rental period:</strong> One day: pick up the day before your event or that morning, and bring everything back the day after or 2 days after. The entire weekend (Friday, Saturday and Sunday): pick up Thursday or Friday, and bring everything back Monday or Tuesday. The price is the same whichever days you pick.`,
  `<strong>Price:</strong> ${money(RATE.day)} per game per day, ${money(RATE.weekend)} per game for a weekend; no minimum order.`,
  `<strong>Pickup and return:</strong> ${esc(PICK.place)}, ${esc(PICK.address)}. Pickup time is set by text or call to ${PICK.phone} after payment. ${esc(BDL)}`,
  `<strong>Holding the date:</strong> ${money(data.damageDeposit)} refundable damage deposit + ${data.holdPercent}% of the rental, by Zelle or Cash App from the invoice.`,
  '<strong>The rest:</strong> paid at pickup by Zelle or Cash App on the spot. No cash.',
  `<strong>Damage deposit:</strong> ${money(data.damageDeposit)}, refunded at return.`,
  '<strong>ID:</strong> government photo ID on the request form, checked at hand-off against the name on the invoice.',
  '<strong>Cancellation:</strong> full refund if you cancel 48 hours or more before pickup.',
  '<strong>Weather:</strong> rain or storms reschedule free within 30 days.',
  '<strong>Pieces:</strong> everything is checked at return. A missing bag, ring, card or piece is $5 each; a broken board, frame or screen is charged at replacement cost.',
  '<strong>Renter:</strong> 18 or older. No water, paint or glitter on the games. Games are wiped down between rentals.'
];

function itemCard(i) {
  const qty = i.quantity > 1 ? ` ${i.quantity} available.` : '';
  return `<article class="card" id="${i.slug}"><div class="card-media"><img src="/assets/rentals/${i.slug}.webp" alt="${esc(i.alt)}" width="1200" height="900" loading="lazy" decoding="async"/></div><div class="card-body"><h3>${esc(i.name)}</h3><p>${esc(i.blurb)}</p><ul><li><strong>Size:</strong> ${esc(i.size)}</li><li><strong>Use:</strong> ${useLabel(i.use)}</li><li><strong>Price:</strong> ${money(i.dayPrice)} a day &middot; ${money(i.weekendPrice)} a weekend</li>${i.deposit !== data.damageDeposit ? `<li><strong>Refundable deposit:</strong> ${money(i.deposit)}</li>` : ''}</ul><p class="muted">Available now.${qty}</p><p><a href="${FORM_URL}" data-quote-cta="rentals-item-${i.slug}">Book the ${esc(i.name)}</a></p></div></article>`;
}

function bundleCard(b) {
  const day = bundleValue(b, 'day');
  const wk = b.weekendPrice ? bundleValue(b, 'weekend') : null;
  const price = wk ? `${money(b.dayPrice)} a day` : money(b.dayPrice);
  const weekend = wk ? `<p><strong>${money(b.weekendPrice)} for a weekend.</strong></p>` : '';
  const save = `Saves ${money(day.save)} on day prices (${money(day.list)} separately).${wk ? ` A weekend saves ${money(wk.save)} (${money(wk.list)} separately).` : ''}`;
  const img = `<div class="card-media" style="margin: -26px -26px 16px;"><img src="${b.image}" alt="${esc(b.alt)}" width="1200" height="1200" loading="lazy" decoding="async" style="aspect-ratio: 1 / 1;"/></div>`;
  return `<div class="pricing-card" id="bundle-${b.slug}">${img}<h3>${esc(b.name)}</h3><span class="price">${price}</span><p>${esc(b.includes)}${wk ? '' : ', for one day'}.</p>${weekend}<p class="muted">${save}</p></div>`;
}

function jsonLd() {
  const provider = { '@type': 'LocalBusiness', name: offers.brandName, url: `${DOMAIN}/`, email: 'hello@porchandparty901.com', ...contactSurface.businessContactFields() };
  const daySpec = (price) => ({ '@type': 'UnitPriceSpecification', price, priceCurrency: 'USD', unitCode: 'DAY', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'DAY' } });
  const blocks = [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: TITLE, description: DESCRIPTION, url: URL,
      primaryImageOfPage: `${DOMAIN}${data.hero.file}` },
    { '@context': 'https://schema.org', '@type': 'Service', name: 'Party game rentals', serviceType: 'Party equipment rental',
      description: `${INV.joinAnd(['Giant yard game', ...EXTRAS.map((x) => INV.extraPhrase(x).replace(/^(a|an) /, ''))])} rentals for backyard parties, birthdays, reunions, church and school events. Pickup and return at ${PICK.place}, ${PICK.address}.`,
      url: URL, provider, areaServed: AREAS,
      offers: BUNDLES.map((b) => ({ '@type': 'Offer', name: `${b.name} bundle`, description: b.includes, price: b.dayPrice, priceCurrency: 'USD', url: `${URL}#bundle-${b.slug}`,
        priceSpecification: b.weekendPrice
          ? [daySpec(b.dayPrice), { '@type': 'UnitPriceSpecification', name: 'Weekend (Friday pickup, Monday return)', price: b.weekendPrice, priceCurrency: 'USD' }]
          : daySpec(b.dayPrice) })) },
    { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Party rentals in Memphis', numberOfItems: ITEMS.length,
      itemListElement: ITEMS.map((g, i) => ({ '@type': 'ListItem', position: i + 1,
        item: { '@type': 'Product', name: `${g.name} rental`, description: `${g.blurb} Size: ${g.size}. ${useLabel(g.use)}.`,
          image: `${DOMAIN}/assets/rentals/${g.slug}.webp`, url: `${URL}#${g.slug}`, brand: { '@type': 'Brand', name: offers.brandName },
          offers: { '@type': 'Offer', price: g.dayPrice, priceCurrency: 'USD', url: `${URL}#${g.slug}`,
            availability: 'https://schema.org/InStock',
            priceSpecification: daySpec(g.dayPrice),
            seller: { '@type': 'LocalBusiness', name: offers.brandName, url: `${DOMAIN}/`, ...contactSurface.businessContactFields() }, areaServed: AREAS } } })) },
    { '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${DOMAIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Party Game Rentals', item: URL }] }
  ];
  return blocks.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n  ');
}

function render() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${TITLE}</title>
  <meta name="description" content="${esc(DESCRIPTION)}" />
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
  <link rel="canonical" href="${URL}" />
  <meta property="og:title" content="${TITLE}" />
  <meta property="og:description" content="${esc(DESCRIPTION)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${URL}" />
  <meta property="og:site_name" content="Porch &amp; Party" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:image" content="${DOMAIN}${data.hero.file}" />
  <meta property="og:image:alt" content="${esc(data.hero.alt)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${TITLE}" />
  <meta name="twitter:description" content="${esc(DESCRIPTION)}" />
  <meta name="twitter:image" content="${DOMAIN}${data.hero.file}" />
  <meta name="theme-color" content="#faf7f2" />
  <meta name="pnp-inventory" content="${INVENTORY_VERSION}" />
  ${siteIcons.HEAD_ICON_LINKS}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/styles.css" />
  <link rel="stylesheet" href="/assets/css/site-nav.css" data-site-chrome="css" />
  ${jsonLd()}
</head>
<body>
  ${header}
  <main>
    <section class="section">
      <div class="container">
        <div class="page-intro">
          <span class="eyebrow">Party Game Rentals in Memphis</span>
          <h1>${H1}</h1>
          <p id="what-are-porch-and-party-rentals">Porch &amp; Party rents ${esc(INV.rentalsPhrase(data))} for backyard parties, birthdays, family reunions, church and school events in Memphis, Olive Branch and Southaven. You pick up and return at ${esc(PICK.place)}, a safe exchange zone. Every game is ${money(RATE.day)} a day${PICK3 ? `, or pick 3 for ${money(PICK3.dayPrice)}` : ''}, with no minimum order.</p>
          <div class="btn-row hero-centered-cta"><a href="${FORM_URL}" class="btn-primary btn-book" data-quote-cta="rentals-top" data-book-online="hero">Book online</a><a href="#games" class="btn-secondary">See the Rentals</a></div>
          <p class="muted book-online-line" data-book-online-line>Book your games: pick your games and dates on the booking form; it shows what is free and your exact total.</p>
          <p class="muted" style="margin-top: 14px;"><a href="${C.telHref}">Call or text ${C.telephoneDisplay}</a></p>
        </div>
        <div class="card-media" style="margin-top: 28px; border-radius: 22px; overflow: hidden;"><img src="${data.hero.file}" alt="${esc(data.hero.alt)}" width="1600" height="900" fetchpriority="high" decoding="async" style="width: 100%; height: auto; display: block;"/></div>
      </div>
    </section>

    <section class="section section-soft" id="games">
      <div class="container">
        <div class="answer-block"><span class="eyebrow">The Rentals</span><h2>${ITEMS.length} party rentals: ${GAMES.length} ${GAMES.length === 1 ? 'game' : 'games'} at ${money(RATE.day)} a day${EXTRAS.length ? `, plus ${INV.joinAnd(EXTRAS.map(INV.extraShort))}` : ''}</h2><p>The entire weekend (Friday, Saturday and Sunday) is ${money(RATE.weekend)} a game. Tap any item to book it.</p></div>
        <div class="cards-grid">${ITEMS.map(itemCard).join('')}</div>
      </div>
    </section>

    <!--service-page--><section class="section" id="giant-lawn-games" data-service-page="rentals">
      <div class="container">
        <div class="answer-block"><span class="eyebrow">Giant Yard Games</span><h2>${LAWN.h2}</h2>${LAWN.body}</div>
        ${SP.gallery('rentals')}
      </div>
    </section><!--/service-page-->

    <section class="section" id="bundles">
      <div class="container">
        <div class="answer-block"><span class="eyebrow">Bundles</span><h2>${BUNDLES.length} bundles that save on day prices</h2><p>Mix any games you like.${EVERYTHING ? ` ${esc(EVERYTHING.name)} is every item on this page${BUNDLES.filter((b) => b.weekendPrice).length === 1 ? ', and the only bundle with a weekend price' : ''}.` : ''}</p></div>
        <div class="pricing-grid">${BUNDLES.map(bundleCard).join('')}</div>
        <p class="pricing-note muted">Every rental adds a ${money(data.damageDeposit)} damage deposit, refunded at return.${ODD_DEPOSIT ? ' Some items have their own deposit; their cards say so, and an order pays the biggest one.' : ''}</p>
        <div class="btn-row centered-cta-row"><a href="${FORM_URL}" class="btn-primary" data-quote-cta="rentals-bundles">Book your games</a></div>
      </div>
    </section>

    <section class="section section-soft" id="pickup">
      <div class="container">
        <div class="answer-block"><span class="eyebrow">How Pickup Works</span><h2>Pick up and return at ${esc(PLACE)}</h2><p>${esc(PICK.place)}, ${esc(PICK.address)}: a safe exchange zone. ${esc(BDL)}</p></div>
        <div class="steps">${PICKUP_RULES.map(([h, p]) => `<div class="step"><h3>${h}</h3><p>${esc(p)}</p></div>`).join('')}</div>
      </div>
    </section>

    <section class="section" id="how-booking-works">
      <div class="container">
        <div class="answer-block"><span class="eyebrow">How Booking Works</span><h2>Four steps from request to return</h2></div>
        <div class="steps">${STEPS.map(([h, p], i) => `<div class="step"><div class="step-number">${i + 1}</div><h3>${h}</h3><p>${p}</p></div>`).join('')}</div>
        <p class="muted" style="text-align: center; margin-top: 16px;" data-rentals="renter-safety">${offers.renterSafety.line} ${offers.renterSafety.rentalFormNote}</p>
        <div class="btn-row centered-cta-row"><a href="${FORM_URL}" class="btn-primary" data-quote-cta="rentals-steps">Book your games</a></div>
      </div>
    </section>

    <section class="section section-soft" id="terms">
      <div class="container">
        <div class="info-panel"><h2>Rental terms</h2><ul>${TERMS.map((t) => `<li>${t}</li>`).join('')}</ul></div>
      </div>
    </section>

    <section class="section" id="faq">
      <div class="container">
        <div class="answer-block"><span class="eyebrow">FAQ</span><h2>Party game rental questions</h2><p>Every question for every service, with the grazing and porch estimators, is on the <a href="/faq/#rentals">FAQ page</a>.</p></div>
        <div class="faq-list">${FAQ.map(([q, a]) => `<div class="faq-item"><h3>${esc(q)}</h3><p>${esc(a)}</p></div>`).join('')}</div>
        <div class="btn-row centered-cta-row"><a href="${FORM_URL}" class="btn-primary btn-book" data-quote-cta="rentals-faq" data-book-online="after-faq">Book online</a><a href="/pricing" class="btn-secondary">See Pricing</a></div>
      </div>
    </section>

    <section class="section cta-band">
      <div class="container">
        <span class="eyebrow">Book Party Games</span>
        <h2>Book party game rentals</h2>
        <p>Pick your games and pickup date on the Porch &amp; Party booking form: it greys out what is already booked and shows your exact total. Your games are held for ${offers.rentalHolds.defaultHours} hours while you pay the deposit.</p>
        <div class="btn-row hero-centered-cta"><a href="${FORM_URL}" class="btn-primary" data-quote-cta="rentals-form">Book your games</a><a href="${MAILTO}" class="btn-secondary">Email Us</a></div>
        <p class="muted" style="margin-top: 14px;"><a href="${C.telHref}">Call ${C.telephoneDisplay}</a> or <a href="${C.smsHref}">text ${C.telephoneDisplay}</a> &middot; <a href="mailto:hello@porchandparty901.com">hello@porchandparty901.com</a></p>
      </div>
    </section>
  </main>
  ${foot}
  ${quoteEventScript()}
</body>
</html>
`;
}

function finalHtml(before) {
  // The retrofit passes that run after every producer (README, "Read this
  // before running build:all") are applied here too, so a fresh render is
  // already in their output form and the passes are a no-op on it. Clarity's
  // loader is owned by scripts/install_clarity.js, which exports nothing, so the
  // block it wrote is carried over from disk rather than dropped: losing it is
  // the silent analytics blackout the README describes.
  const CLARITY = /<script data-clarity-loader>[\s\S]*?<\/script>/;
  let html = contactSurface.applyContactSurface(normalizeHtmlUrls(render()), 'rentals/index.html');
  if (typeof html !== 'string') html = html.html;
  const loader = before && before.match(CLARITY);
  if (loader) html = html.replace('</head>', `${loader[0]}\n</head>`);
  // Same for the related-pages block scripts/build_related_navigation.js owns.
  const RELATED = /<section[^>]+data-nav="related-pages"[\s\S]*?<\/section>/i;
  const related = before && before.match(RELATED);
  if (related) html = html.replace('</main>', () => `${related[0]}</main>`);
  return html;
}

module.exports = { finalHtml, data, OUT, ITEMS, GAMES, EXTRAS, BUNDLES, bundleValue, FAQ, INVENTORY_VERSION };

if (require.main === module) {
  const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  const html = finalHtml(before);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (before !== html) fs.writeFileSync(OUT, html);
  console.log(`rentals page: ${before === html ? 'unchanged' : 'written'} (${ITEMS.length} items, ${BUNDLES.length} bundles)`);
}
