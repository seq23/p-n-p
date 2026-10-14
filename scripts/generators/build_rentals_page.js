#!/usr/bin/env node
'use strict';
/**
 * Renders /rentals/ (rentals/index.html), the party game rentals page.
 *
 * Every rate, bundle, zone and image on the page comes from
 * data/rentals/games.json, so the page, its Product/Offer JSON-LD and the
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
const contactSurface = require(path.join(ROOT, 'scripts/lib/contact_surface.js'));
const siteIcons = require(path.join(ROOT, 'scripts/lib/site_icons.js'));
const data = require(path.join(ROOT, 'data/rentals/games.json'));

const OUT = path.join(ROOT, 'rentals', 'index.html');
const DOMAIN = offers.domain;
const URL = `${DOMAIN}/rentals/`;
const C = offers.contact;
const FORM_URL = 'https://forms.gle/vHjfKtRRAnGV3HxFA';
const MAILTO = 'mailto:hello@porchandparty901.com?subject=Party%20game%20rental%20inquiry';
const TITLE = 'Party Game Rentals in Memphis | Porch and Party';
const DESCRIPTION = 'Giant yard game rentals for birthdays and backyard parties in Memphis, Olive Branch and Southaven, from $25 a day, delivered and set up.';
const H1 = 'Giant yard game rentals for Memphis parties, delivered and set up';
const AREAS = ['Memphis, TN', 'Olive Branch, MS', 'Southaven, MS'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const weekend = (n) => Math.round(n * data.weekendMultiplier * 100) / 100;
const useLabel = (u) => (u === 'outdoor' ? 'Outdoor only' : 'Indoor or outdoor');

// The shared shell blocks. Rentals is in the canonical nav and footer
// (scripts/lib/site_chrome.js), so the page needs no local additions.
const header = nav('/rentals/');
const foot = footer();

const FAQ = [
  ['Where do you deliver party game rentals?',
    `We deliver in Memphis, Olive Branch and Southaven only. Zone 1 is Memphis city limits (ZIP codes 38103 to 38141) for a $25 delivery fee, free on orders of $150 or more. Zone 2 is Olive Branch and Southaven, MS for $40. Rentals are delivery only; there is no customer pickup.`],
  ['What happens if it rains?',
    'If rain or a storm is forecast for your date, we reschedule the rental free within 30 days. Every game except Giant Yard Pong also works indoors, so many hosts simply move the games inside.'],
  ['Can we use the games indoors?',
    'Yes. Every game works indoors except Giant Yard Pong, which is outdoor only. Indoors you need flat floor space; the Giant Connect Four stands 4 ft tall and the Giant Tumble Tower stacks to about 5 ft.'],
  ['How far ahead should I book?',
    'Two to three weeks ahead is safest for Saturdays and holiday weekends, because each game is limited to one or two units. Weekday and short-notice requests are fine to send; we confirm what is open for your date.'],
  ['How much is the deposit?',
    '50% holds your date and the balance is due at delivery. Cancel 48 hours or more before delivery for a full refund.'],
  ['How long does setup take?',
    'We deliver by noon and set the games up on flat ground where you want them, usually in about 15 to 30 minutes depending on how many games you booked. We pick everything up the next day, or on Monday for a weekend rental.'],
  ['Are the games safe for kids, and who can rent?',
    'The renter must be 18 or older and an adult should supervise play. Giant Color Stack is made for ages 6 and up, and every other game suits older kids, teens and adults. Games are wiped down between rentals.']
];

const STEPS = [
  ['Send an inquiry', 'Tell us your date, ZIP code and the games or bundle you want, through the quote form, email or a call or text.'],
  ['We confirm date and games', 'We confirm what is open, the delivery zone fee and the total. 50% holds the date.'],
  ['We deliver and set up', 'Delivered by noon and set up on flat ground, indoors or out. The balance is due at delivery.'],
  ['We pick up', 'We collect the games the next day, or Monday for a weekend rental, and check every piece.']
];

const TERMS = [
  '<strong>Rental period:</strong> 24 hours. Delivered by noon, picked up the next day.',
  '<strong>Weekend rental:</strong> Friday delivery, Monday pickup, at 1.5 times the day rate.',
  '<strong>Deposit:</strong> 50% holds the date; the balance is due at delivery.',
  '<strong>Cancellation:</strong> full refund if you cancel 48 hours or more before delivery.',
  '<strong>Weather:</strong> rain or storms reschedule free within 30 days.',
  '<strong>Pieces:</strong> games are checked at pickup. A missing bag, block, ring or ball is $5 each; a broken board or frame is charged at replacement cost.',
  '<strong>Renter:</strong> 18 or older. Set up on flat ground. No water, paint or glitter on the games. Games are wiped down between rentals.',
  '<strong>Indoors:</strong> fine for every game except Giant Yard Pong.'
];

function gameCard(g) {
  const avail = g.availableNow ? 'Available now' : 'Coming this month';
  const qty = g.quantity > 1 ? ` ${g.quantity} available.` : '';
  return `<article class="card" id="${g.slug}"><div class="card-media"><img src="/assets/rentals/${g.slug}.webp" alt="${esc(g.alt)}" width="1200" height="900" loading="lazy" decoding="async"/></div><div class="card-body"><h3>${esc(g.name)}</h3><p>${esc(g.blurb)}</p><ul><li><strong>Size:</strong> ${esc(g.size)}</li><li><strong>Use:</strong> ${useLabel(g.use)}</li><li><strong>Day rate:</strong> ${money(g.dayRate)} &middot; weekend ${money(weekend(g.dayRate))}</li></ul><p class="muted">${avail}.${qty}</p></div></article>`;
}

function bundleCard(b) {
  const wk = b.weekendPrice || weekend(b.dayPrice);
  const what = b.games === data.games.length ? `All ${b.games} games` : `Any ${b.games} games`;
  return `<div class="pricing-card"><h3>${b.name}</h3><span class="price">${money(b.dayPrice)}</span><p>${what} for one day, set up by us.</p><p class="muted">Weekend (Friday to Monday): ${money(wk)}.</p></div>`;
}

function jsonLd() {
  const provider = { '@type': 'LocalBusiness', name: offers.brandName, url: `${DOMAIN}/`, email: 'hello@porchandparty901.com', ...contactSurface.businessContactFields() };
  const blocks = [
    { '@context': 'https://schema.org', '@type': 'WebPage', name: TITLE, description: DESCRIPTION, url: URL,
      primaryImageOfPage: `${DOMAIN}${data.hero.file}` },
    { '@context': 'https://schema.org', '@type': 'Service', name: 'Party game rentals', serviceType: 'Party equipment rental',
      description: 'Giant yard game rentals delivered and set up for backyard parties, birthdays, reunions, church and school events, indoors or outdoors.',
      url: URL, provider, areaServed: AREAS,
      offers: data.bundles.map((b) => ({ '@type': 'Offer', name: `${b.name} bundle`, price: b.dayPrice, priceCurrency: 'USD',
        priceSpecification: { '@type': 'UnitPriceSpecification', price: b.dayPrice, priceCurrency: 'USD', unitCode: 'DAY', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'DAY' } } })) },
    { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Party games for rent in Memphis', numberOfItems: data.games.length,
      itemListElement: data.games.map((g, i) => ({ '@type': 'ListItem', position: i + 1,
        item: { '@type': 'Product', name: `${g.name} rental`, description: `${g.blurb} Size: ${g.size}. ${useLabel(g.use)}.`,
          image: `${DOMAIN}/assets/rentals/${g.slug}.webp`, url: `${URL}#${g.slug}`, brand: { '@type': 'Brand', name: offers.brandName },
          offers: { '@type': 'Offer', price: g.dayRate, priceCurrency: 'USD', url: `${URL}#${g.slug}`,
            availability: g.availableNow ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder',
            priceSpecification: { '@type': 'UnitPriceSpecification', price: g.dayRate, priceCurrency: 'USD', unitCode: 'DAY', referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'DAY' } },
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
  const z1 = data.zones[0]; const z2 = data.zones[1];
  const featured = data.games.map(gameCard).join('');
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
          <p id="what-are-porch-and-party-rentals">Porch &amp; Party rents giant yard games for backyard parties, birthdays, family reunions, church and school events in Memphis, Olive Branch and Southaven. We deliver by noon, set the games up indoors or outdoors, and pick them up the next day. Games start at $25 a day, or pick 3 for $99.</p>
          <div class="btn-row hero-centered-cta"><a href="/contact" class="btn-primary" data-quote-cta="rentals-top">Check My Date</a><a href="#games" class="btn-secondary">See the Games</a></div>
          <p class="muted" style="margin-top: 14px;"><a href="${C.telHref}">Call or text ${C.telephoneDisplay}</a></p>
        </div>
        <div class="card-media" style="margin-top: 28px; border-radius: 22px; overflow: hidden;"><img src="${data.hero.file}" alt="${esc(data.hero.alt)}" width="1600" height="900" fetchpriority="high" decoding="async" style="width: 100%; height: auto; display: block;"/></div>
      </div>
    </section>

    <section class="section section-soft" id="games">
      <div class="container">
        <div class="answer-block"><span class="eyebrow">The Games</span><h2>${data.games.length} giant games for rent, priced per day</h2><p>Every rental is delivered and set up by us. The weekend rate (Friday delivery, Monday pickup) is 1.5 times the day rate.</p></div>
        <div class="cards-grid">${featured}</div>
      </div>
    </section>

    <section class="section" id="bundles">
      <div class="container">
        <div class="answer-block"><span class="eyebrow">Bundles</span><h2>Bundle the games and save</h2><p>Mix any games you like. The whole yard is every game on this page.</p></div>
        <div class="pricing-grid">${data.bundles.map(bundleCard).join('')}</div>
        <p class="pricing-note muted">Delivery, setup and next-day pickup come with every rental. The delivery fee depends on your zone, below.</p>
      </div>
    </section>

    <section class="section section-soft" id="delivery">
      <div class="container">
        <div class="answer-block"><span class="eyebrow">Delivery Area</span><h2>We deliver in Memphis, Olive Branch and Southaven only.</h2><p>Rentals are delivery only: there is no customer pickup, and we do not deliver outside these two zones.</p></div>
        <div class="pricing-grid">
          <div class="pricing-card"><h3>${z1.name}: Memphis</h3><span class="price">${money(z1.fee)}</span><p>${esc(z1.area)}.</p><p class="muted">Free delivery on orders of ${money(z1.freeOver)} or more.</p></div>
          <div class="pricing-card"><h3>${z2.name}: Olive Branch &amp; Southaven</h3><span class="price">${money(z2.fee)}</span><p>${esc(z2.area)}.</p><p class="muted">Delivered by noon, picked up the next day.</p></div>
        </div>
      </div>
    </section>

    <section class="section" id="how-booking-works">
      <div class="container">
        <div class="answer-block"><span class="eyebrow">How Booking Works</span><h2>Four steps from inquiry to pickup</h2></div>
        <div class="steps">${STEPS.map(([h, p], i) => `<div class="step"><div class="step-number">${i + 1}</div><h3>${h}</h3><p>${p}</p></div>`).join('')}</div>
        <div class="btn-row centered-cta-row"><a href="/contact" class="btn-primary" data-quote-cta="rentals-steps">Request Game Rentals</a></div>
      </div>
    </section>

    <section class="section section-soft" id="terms">
      <div class="container">
        <div class="info-panel"><h2>Rental terms</h2><ul>${TERMS.map((t) => `<li>${t}</li>`).join('')}</ul></div>
      </div>
    </section>

    <section class="section" id="faq">
      <div class="container">
        <div class="answer-block"><span class="eyebrow">FAQ</span><h2>Party game rental questions</h2></div>
        <div class="faq-list">${FAQ.map(([q, a]) => `<div class="faq-item"><h3>${esc(q)}</h3><p>${esc(a)}</p></div>`).join('')}</div>
      </div>
    </section>

    <section class="section cta-band">
      <div class="container">
        <span class="eyebrow">Book Party Games</span>
        <h2>Check your date for party game rentals</h2>
        <p>Use the Porch &amp; Party quote form and choose "Party game rentals": share your date, ZIP code and the games or bundle you want. We confirm availability, your delivery zone and the total.</p>
        <div class="btn-row hero-centered-cta"><a href="${FORM_URL}" class="btn-primary" rel="noopener" target="_blank" data-quote-cta="rentals-form">Start Your Rental Request</a><a href="${MAILTO}" class="btn-secondary">Email Us</a></div>
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

module.exports = { finalHtml, data, OUT };

if (require.main === module) {
  const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  const html = finalHtml(before);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (before !== html) fs.writeFileSync(OUT, html);
  console.log(`rentals page: ${before === html ? 'unchanged' : 'written'} (${data.games.length} games)`);
}
