#!/usr/bin/env node
'use strict';
/**
 * Renders the two site pages of the request form (owner-approved 2026-10-18):
 *
 *   request.html  porchandparty901.com/request, the quote request and game booking form.
 *                 Public and indexable (it is the quote page). The form block between
 *                 <!--request-form--> markers is rendered by functions/_lib/request-form.mjs,
 *                 the same module the Pages Function renders it with (it adds the signed
 *                 render time, the Turnstile widget and, after an error, the answers).
 *   rules.html    porchandparty901.com/rules, the Rules & Responsibilities the form's
 *                 checkbox agrees to. Versioned (RULES_VERSION in request-form.mjs), plain
 *                 English, drawn only from facts already in terms-and-conditions.html and
 *                 the data files: no fee here that the Terms do not already state.
 *
 * Header and footer come from templates/page-shell.js like every generated page; the
 * contact-surface pass is applied here, and the Clarity loader and related-pages block are
 * carried over from disk, so the later passes are a no-op on a fresh render (as
 * scripts/generators/build_rentals_page.js does). Deterministic.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '../..');
const { nav, footer, quoteEventScript } = require(path.join(ROOT, 'templates/page-shell.js'));
const { normalizeHtmlUrls } = require(path.join(ROOT, 'scripts/lib/site_url.js'));
const contactSurface = require(path.join(ROOT, 'scripts/lib/contact_surface.js'));
const siteIcons = require(path.join(ROOT, 'scripts/lib/site_icons.js'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const games = require(path.join(ROOT, 'data/rentals/games.json'));
const brand = require(path.join(ROOT, 'scripts/lib/brand.js'));

const DOMAIN = offers.domain;
const esc = brand.esc;
const C = offers.contact;
const PLACE = `${games.pickup.place}, ${games.pickup.address}`;

function head({ title, description, url, image, imageAlt, ld }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
  <link rel="canonical" href="${url}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${url}" />
  <meta property="og:site_name" content="Porch &amp; Party" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:image" content="${DOMAIN}${image}" />
  <meta property="og:image:alt" content="${esc(imageAlt)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${DOMAIN}${image}" />
  <meta name="theme-color" content="#faf7f2" />
  ${siteIcons.HEAD_ICON_LINKS}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/styles.css" />
  <link rel="stylesheet" href="/assets/css/site-nav.css" data-site-chrome="css" />
  ${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n  ')}
</head>`;
}

const business = () => ({ '@context': 'https://schema.org', '@type': 'LocalBusiness', name: offers.brandName, url: `${DOMAIN}/`, ...contactSurface.businessContactFields() });
const crumbs = (name, url) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
  { '@type': 'ListItem', position: 1, name: 'Home', item: `${DOMAIN}/` }, { '@type': 'ListItem', position: 2, name, item: url }] });

async function renderRequest(F, table) {
  const url = `${DOMAIN}/request`;
  const title = 'Request a Quote or Book Party Games | Porch & Party';
  const description = 'Request a Memphis quote for porch decorating, party planning & decor and grazing tables, or book party game rentals. About 3 minutes, no account.';
  const form = F.renderForm({ offers, table, values: {}, errors: {}, ts: '', sitekey: '', referral: '', today: '' });
  return `${head({ title, description, url, image: '/assets/img/celebrations/romantic-bedroom-experience.jpg', imageAlt: 'Celebration setup in a hotel room with balloons and candles',
    ld: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Request a quote or book party games', description, url, publisher: { '@id': contactSurface.BUSINESS_ID } }, business(), crumbs('Request a quote', url)] })}
<body>
  ${nav('/request')}
  <main>
    <section class="section">
      <div class="container">
        <div class="page-intro">
          <span class="eyebrow">Request a Quote</span>
          <h1>Tell us what you're planning.</h1>
          <p id="what-this-form-does">Porch &amp; Party does ${esc(brand.SERVICE_LIST)} in Memphis. Pick what you need below: we text you a quote for decor and grazing tables, usually within a day, and game rentals are booked right here with your exact total. Prefer to talk? <a href="${C.telHref}">Call or text ${C.telephoneDisplay}</a>.</p>
        </div>
        ${form}
      </div>
    </section>
  </main>
  ${footer()}
  ${quoteEventScript()}
</body>
</html>
`;
}

function renderRules(F, table) {
  const url = `${DOMAIN}/rules`;
  const title = 'Rules & Responsibilities | Porch & Party';
  const description = 'The plain-English rules for Porch & Party bookings: deposits, cancellation, weather, game rental pickup and return, damage, and how we handle your photo ID.';
  const td = offers.addOns.takedown;
  const d = (n) => `$${n}`;
  const sections = [
    ['everyone', 'For everyone', [
      'A booking is confirmed only when we confirm it and your deposit is paid. Quotes are custom and can change with the scope, materials, food, guest count, location and timing.',
      `Porch, party and room decor and grazing dates are held by ${offers.payment.decorHold}; the rest is due ${offers.payment.decorBalanceDue}. Game rentals are held by a ${d(games.damageDeposit)} refundable damage deposit plus ${games.holdPercent}% of the rental; the rest is paid at pickup.`,
      `You pay by ${offers.payment.methods} from your invoice. We do not take cash.`,
      `Cancel ${offers.payment.cancelFreeHours} hours or more before your setup or pickup time and your deposit is refunded in full. Inside ${offers.payment.cancelFreeHours} hours the deposit is kept.`,
      `Weather: if rain or a storm is forecast for your date, we move your setup or rental to a new date free within ${offers.payment.weatherRescheduleDays} days.`,
      'Give us correct details for your date, place and what you want. Hotel rooms and venues may need us to coordinate with the property first.',
    ]],
    ['rentals', 'Party game rentals', [
      `Pickup and return are at ${PLACE}, a safe exchange zone. We do not bring rentals to you. The pickup time is set by text or call to ${C.telephoneDisplay} after payment.`,
      'A rental booked on our request form is held for 24 hours while you pay the deposit. If the deposit has not come in by then, the hold ends and the games are offered to others.',
      'A day rental comes back within 24 hours of pickup. A weekend rental is picked up Friday and returned Monday. A late return is charged as quoted with your booking.',
      'An adult watches over children playing with the giant games. Set them up on flat ground and use them for what they are made for.',
      `Everything is checked at return. A missing bag, ring, card or piece is $5 each; a broken board, frame or screen is charged at replacement cost. The ${d(games.damageDeposit)} damage deposit is refunded when everything comes back complete.`,
      'We check the photo ID on your request against the name on the invoice at hand-off. Party game rentals have no takedown: you return them yourself.',
    ]],
    ['porch', 'Porch decorating', [
      `Takedown is optional and starts at ${d(td.fromPrice)}, quoted with your setup.`,
      'The decor, props and stands we bring stay Porch & Party\'s until takedown, unless your quote says a piece is yours to keep. Please leave them in place until we take them down or collect them.',
    ]],
    ['party', 'Party planning & decor', [
      `Takedown is optional and starts at ${d(td.fromPrice)}, quoted with your setup.`,
      'The decor, props and stands we bring stay Porch & Party\'s until takedown, unless your quote says a piece is yours to keep.',
      'For a hotel room or venue, check that the property allows the setup; we coordinate with them where needed.',
    ]],
    ['grazing', 'Grazing tables', [
      'Food is not included in grazing-table styling unless it is quoted and confirmed. When you ask us to source it, it is added to your quote.',
      'The boards and stands stay Porch & Party\'s; we collect them after your event when your quote includes it.',
    ]],
    ['photo-id', 'Your photo ID', [
      F.ID_NOTE,
      'We ask every customer for a government photo ID on the request form. Only Porch & Party sees it. It is kept in private storage that is not on the public internet, and we delete it by hand after your final payment (for a rental, once the games are back).',
    ]],
  ];
  return `${head({ title, description, url, image: games.hero.file, imageAlt: games.hero.alt,
    ld: [{ '@context': 'https://schema.org', '@type': 'WebPage', name: 'Rules & Responsibilities', description, url, dateModified: F.RULES_VERSION, publisher: { '@id': contactSurface.BUSINESS_ID } }, business(), crumbs('Rules & Responsibilities', url)] })}
<body>
  ${nav('/rules')}
  <main>
    <section class="section">
      <div class="container">
        <div class="content-wrap" data-rules-version="${F.RULES_VERSION}">
          <span class="eyebrow">Rules</span>
          <h1>Rules &amp; Responsibilities</h1>
          <p class="muted">Version ${F.RULES_VERSION}. When you send a request, you agree to these rules and to our <a href="/terms-and-conditions">Terms &amp; Conditions</a>, which say the same things in full.</p>
          ${sections.map(([id, h, items]) => `<h2 id="${id}">${esc(h)}</h2><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`).join('\n          ')}
          <h2 id="questions">Questions</h2>
          <p>Call or text <a href="${C.telHref}">${C.telephoneDisplay}</a> or email <a href="mailto:hello@porchandparty901.com">hello@porchandparty901.com</a>. Ready? <a href="/request">Request a quote or book games</a>.</p>
        </div>
      </div>
    </section>
  </main>
  ${footer()}
</body>
</html>
`;
}

function finalHtml(html, rel, before) {
  let out = contactSurface.applyContactSurface(normalizeHtmlUrls(html), rel);
  if (typeof out !== 'string') out = out.html;
  const CLARITY = /<script data-clarity-loader>[\s\S]*?<\/script>/;
  const loader = before && before.match(CLARITY);
  if (loader) out = out.replace('</head>', `${loader[0]}</head>`);
  const RELATED = /<section[^>]+data-nav="related-pages"[\s\S]*?<\/section>/i;
  const related = before && before.match(RELATED);
  if (related) out = out.replace('</main>', () => `${related[0]}</main>`);
  return out;
}

async function build() {
  const F = await import(pathToFileURL(path.join(ROOT, 'functions/_lib/request-form.mjs')).href);
  const { buildPriceTable } = await import(pathToFileURL(path.join(ROOT, 'functions/_lib/pricing.mjs')).href);
  const table = buildPriceTable(games, offers, require(path.join(ROOT, 'data/offers/porch_packages.json')));
  return { 'request.html': await renderRequest(F, table), 'rules.html': renderRules(F, table) };
}

module.exports = { build, finalHtml };

if (require.main === module) {
  build().then((pages) => {
    for (const [rel, html] of Object.entries(pages)) {
      const abs = path.join(ROOT, rel);
      const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
      const out = finalHtml(html, rel, before);
      if (out !== before) fs.writeFileSync(abs, out);
      console.log(`${rel}: ${out === before ? 'unchanged' : 'written'}`);
    }
  }).catch((e) => { console.error(e); process.exit(1); });
}
