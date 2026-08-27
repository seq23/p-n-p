const offers = require('../data/offers/services.json');
const areas = require('../data/service_areas/areas.json');

const fs = require('fs');
const path = require('path');

function nav() {
  return `<header class="site-header"><div class="container header-inner"><a href="/" aria-label="Porch and Party home"><span class="brand-script">Porch &amp; Party</span></a><nav class="site-nav" aria-label="Primary navigation"><a href="/services/porch-decorating.html">Porch</a><a href="/services/celebration-setups.html">Celebrations</a><a href="/services/grazing-and-event-styling.html">Grazing &amp; Events</a><a href="/pricing.html">Pricing</a><a href="/how-it-works.html">How It Works</a><a href="/contact.html" class="btn-primary">Request a Quote</a></nav></div></header>`;
}

function footer() {
  return `<footer class="site-footer"><div class="container"><div class="footer-grid"><div><div class="footer-title">Porch &amp; Party</div><p class="muted">Memphis-based seasonal porch decorating, front porch styling, holiday porch decorating, and selective celebration setups.</p><p class="muted"><a href="mailto:hello@porchandparty901.com">hello@porchandparty901.com</a></p></div><div><div class="footer-title">Explore</div><div class="footer-list"><a href="/services/porch-decorating.html">Seasonal Porch Decorating</a><a href="/services/celebration-setups.html">Celebration Setups</a><a href="/services/grazing-and-event-styling.html">Grazing &amp; Styled Events</a><a href="/pricing.html">Pricing</a><a href="/contact.html">Contact</a><a href="/privacy-policy.html">Privacy Policy</a><a href="/terms-and-conditions.html">Terms &amp; Conditions</a></div></div><div><div class="footer-title">Service Area</div><div class="footer-list">${areas.areas.map(a => `<span>${a.split(',')[0]}</span>`).join('')}</div></div></div><div class="legal">© 2026 Porch &amp; Party. All rights reserved.<br>Porch &amp; Party is a brand operated by Kerseta LLC.</div></div></footer>`;
}

function pickSocialImage(pathUrl, serviceKey) {
  if (serviceKey === 'porch' || pathUrl.includes('/seasonal/')) {
    return {
      url: `${offers.domain}/assets/img/porch/memphis-fall-front-porch-decorating-germantown.jpg`,
      alt: 'Memphis fall front porch decorating with pumpkins and layered seasonal styling'
    };
  }
  if (serviceKey === 'grazing' || pathUrl.includes('/grazing') || pathUrl.includes('/corporate/')) {
    return {
      url: `${offers.domain}/assets/img/grazing/grazing-table-corporate.jpg`,
      alt: 'Styled grazing table setup for an event in the Memphis area'
    };
  }
  return {
    url: `${offers.domain}/assets/img/celebrations/romantic-bedroom-experience.png`,
    alt: 'Celebration setup in a hotel room with balloons and candles'
  };
}

function breadcrumbJsonLd(pathUrl, title) {
  const parts = pathUrl.replace(/^\//, '').replace(/\.html$/, '').split('/');
  const items = [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: `${offers.domain}/`
    }
  ];
  if (parts.length === 2) {
    const sectionMap = {
      authority: 'Authority',
      faq: 'FAQ',
      local: 'Local',
      seasonal: 'Seasonal',
      guides: 'Guides',
      comparisons: 'Comparisons',
      events: 'Events',
      corporate: 'Corporate',
      hubs: 'Hubs',
      services: 'Services'
    };
    // A section is only a real parent when it has an index page. Six sections -
    // authority, comparisons, corporate, guides, hubs, seasonal - hold fewer
    // than the four pages build_section_indexes.js requires before it publishes
    // an index, so `${domain}/<section>/` answers 404 for them. Naming a 404 as
    // position 2 of a BreadcrumbList is a claim about the site's shape that the
    // site contradicts, so those pages get Home > This page instead.
    const sectionName = fs.existsSync(path.join(__dirname, '..', parts[0], 'index.html'))
      ? sectionMap[parts[0]]
      : null;
    if (sectionName) {
      items.push({
        '@type': 'ListItem',
        position: items.length + 1,
        name: sectionName,
        item: `${offers.domain}/${parts[0]}/`
      });
    }
    // The page itself is always the last crumb, whether or not its section has
    // an index. Emitting it only in the branch that also emitted the section
    // left the pages without one asserting a trail of just "Home".
    items.push({
      '@type': 'ListItem',
      position: items.length + 1,
      name: title,
      item: `${offers.domain}${pathUrl}`
    });
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items
  };
}

// The families that are genuinely written articles rather than service or
// answer surfaces: how-to guides, head-to-head comparisons, and the seasonal
// explainers. The rest of the tree is deliberately excluded - /faq/, /local/,
// /answers/ and the porch idea pages are question-and-answer surfaces, where
// FAQPage is the correct type and Article would misdescribe them, and
// /authority/, /services/, /areas/, /events/, /corporate/ and /hubs/ are
// service pages carrying Service and LocalBusiness.
const ARTICLE_FOLDERS = new Set(['guides', 'comparisons', 'seasonal']);

/**
 * No datePublished or dateModified. Neither exists as a recorded fact anywhere
 * in this repo for these pages, and the one date that does exist - the per-URL
 * entry in data/cadence/lastmod_ledger.json - cannot be read from here: the
 * ledger is keyed on the hash of the rendered page, so embedding it in the page
 * would change the hash, advance the ledger, and change the page again on every
 * single build. An Article with no date is honest; an Article with a
 * self-perpetuating date is not.
 */
function articleJsonLd(url, headline, description, image, pathUrl) {
  const folder = pathUrl.replace(/^\//, '').split('/')[0];
  if (!ARTICLE_FOLDERS.has(folder)) return null;
  const publisher = { '@type': 'Organization', name: offers.brandName, url: offers.domain };
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline,
    description,
    url,
    image,
    inLanguage: 'en-US',
    articleSection: folder.charAt(0).toUpperCase() + folder.slice(1),
    author: publisher,
    publisher,
    isPartOf: { '@type': 'WebSite', name: offers.brandName, url: `${offers.domain}/` },
    about: { '@type': 'LocalBusiness', name: offers.brandName, url: `${offers.domain}/`, areaServed: areas.areas }
  };
}

function pageJsonLd(url, title, description, faqQuestion, faqAnswer, pathUrl, image) {
  const blocks = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title,
      description,
      url
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: title,
      serviceType: title,
      provider: { '@type': 'LocalBusiness', name: offers.brandName, url: offers.domain },
      areaServed: areas.areas,
      offers: { '@type': 'Offer', priceCurrency: 'USD', description: 'Porch & Party publishes starting prices; exact quotes depend on scope, date, location, and materials.' }
    },
    breadcrumbJsonLd(pathUrl, title)
  ];
  if (faqQuestion && faqAnswer) {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: faqQuestion,
          acceptedAnswer: { '@type': 'Answer', text: faqAnswer }
        }
      ]
    });
  }
  const article = articleJsonLd(url, title, description, image, pathUrl);
  if (article) blocks.push(article);
  return blocks.map(obj => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`).join('\n');
}

const labels = {
  '/services/porch-decorating.html': 'Seasonal Porch Decorating',
  '/services/celebration-setups.html': 'Celebration Setups',
  '/services/grazing-and-event-styling.html': 'Grazing Tables & Styled Events',
  '/contact.html': 'Request a Quote',
  '/pricing.html': 'Pricing',
  '/how-it-works.html': 'How It Works',
  '/faq/how-much-does-hotel-room-decor-cost-in-memphis.html': 'How Much Does Hotel Room Decor Cost in Memphis?',
  '/faq/how-much-does-birthday-decoration-at-home-cost.html': 'How Much Does Birthday Decoration at Home Cost in Memphis?',
  '/faq/how-much-does-grazing-tables-cost.html': 'How Much Do Grazing Tables Cost in Memphis?',
  '/faq/do-party-decorators-come-to-your-house.html': 'Do Party Decorators Come to Your House?',
  '/faq/do-grazing-tables-include-food.html': 'Do Grazing Tables Include Food?',
  '/faq/how-far-in-advance-should-i-book-party-decor.html': 'How Far in Advance Should I Book Party Decor in Memphis?',
  '/faq/how-long-does-it-take-to-set-up-party-decor.html': 'How Long Does Party Decor Setup Take in Memphis?',
  '/local/hotel-room-decorations-memphis.html': 'Hotel Room Decorations in Memphis',
  '/local/birthday-decorations-at-home-memphis.html': 'Birthday Decorations at Home in Memphis',
  '/local/grazing-tables-memphis.html': 'Grazing Tables in Memphis',
  '/local/romantic-room-decorations-memphis.html': 'Romantic Room Decorations in Memphis',
  '/authority/party-planner-memphis.html': 'Party Planner in Memphis',
  '/authority/event-decorator-memphis.html': 'Event Decorator in Memphis',
  '/comparisons/diy-vs-hiring-party-decorator.html': 'DIY vs Hiring a Party Decorator',
  '/comparisons/balloon-garland-vs-full-birthday-setup.html': 'Balloon Garland vs Full Birthday Setup',
  '/guides/last-minute-birthday-setup-ideas-memphis.html': 'Last-Minute Birthday Setup Ideas in Memphis',
  '/guides/how-to-decorate-a-hotel-room-for-a-romantic-surprise.html': 'How to Decorate a Hotel Room for a Romantic Surprise',
  '/seasonal/halloween-porch-decorating-memphis.html': 'Halloween Porch Decorating in Memphis',
  '/seasonal/christmas-porch-decorating-memphis.html': 'Christmas Porch Decorating in Memphis',
  '/events/baby-shower-decorations-memphis.html': 'Baby Shower Decorations in Memphis',
  '/events/bridal-shower-decorations-memphis.html': 'Bridal Shower Decorations in Memphis',
  '/events/proposal-room-setup-memphis.html': 'Proposal Room Setup in Memphis',
  '/events/anniversary-room-decorations-memphis.html': 'Anniversary Room Decorations in Memphis',
  '/corporate/corporate-event-decor-memphis.html': 'Corporate Event Decor in Memphis',
  '/corporate/corporate-grazing-tables-memphis.html': 'Corporate Grazing Tables in Memphis',
  '/hubs/memphis-celebration-setups.html': 'Memphis Celebration Setups'
};

function relatedLinks(rels) {
  return `<div class="info-panel"><h2>Related pages</h2><ul>${rels.map(r => `<li><a href="${r}">${labels[r] || r}</a></li>`).join('')}</ul></div>`;
}

function renderPage(entry) {
  const service = offers.services[entry.serviceKey];
  const pathUrl = `/${entry.folder}/${entry.slug}.html`;
  const fullUrl = `${offers.domain}${pathUrl}`;
  const cityList = entry.cities.join(', ');
  const socialImage = pickSocialImage(pathUrl, entry.serviceKey);
  const topCta = `<div class="btn-row"><a href="/contact.html" class="btn-primary">Request a Quote</a><a href="${service.slug}" class="btn-secondary">View ${service.name}</a></div>`;
  const midCta = `<div class="btn-row"><a href="/contact.html" class="btn-primary">Request a Quote</a></div>`;
  const bottomCta = `<section class="section cta-band"><div class="container"><span class="eyebrow">Request a Quote</span><h2>Need a clearer next step for this setup?</h2><p>Use the Porch &amp; Party quote form to share your date, city, budget range, and setup notes. That makes it easier to respond with scope, pricing direction, and availability.</p><div class="btn-row hero-centered-cta"><a href="/contact.html" class="btn-primary">Request a Quote</a></div><p class="muted" style="margin-top: 14px;"><a href="mailto:hello@porchandparty901.com">hello@porchandparty901.com</a></p></div></section>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${entry.title}</title>
  <meta name="description" content="${entry.description}" />
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
  <link rel="canonical" href="${fullUrl}" />
  <meta property="og:title" content="${entry.title}" />
  <meta property="og:description" content="${entry.description}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${fullUrl}" />
  <meta property="og:site_name" content="Porch &amp; Party" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:image" content="${socialImage.url}" />
  <meta property="og:image:alt" content="${socialImage.alt}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${entry.title}" />
  <meta name="twitter:description" content="${entry.description}" />
  <meta name="twitter:image" content="${socialImage.url}" />
  <meta name="theme-color" content="#faf7f2" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/styles.css" />
  ${pageJsonLd(fullUrl, entry.h1, entry.description, entry.faqQuestion, entry.faqAnswer, pathUrl, socialImage.url)}
</head>
<body>
  ${nav()}
  <main>
    <section class="section">
      <div class="container">
        <div class="page-intro">
          <span class="eyebrow">${entry.eyebrow || service.name}</span>
          <h1>${entry.h1}</h1>
          <p>${entry.intro}</p>
          <p class="muted">Service area focus: ${cityList} and the greater Memphis metro area.</p>
          ${topCta}
        </div>
      </div>
    </section>

    <section class="section section-soft">
      <div class="container content-grid">
        <div class="content-stack">
          <!-- recommendation_summary is the most-requested block in the agent
               data: asked for on every recommendation, on every run. It folds
               the former "Quick answer" and "Who this is for" panels into one
               extractable block rather than adding a third - a summary that
               repeats what sits directly beneath it is duplication, not a
               summary. Placed first so it falls inside the opening third of the
               page, where most AI Overview citations are drawn from. -->
          <div class="info-panel recommendation-summary" data-content-block="recommendation_summary" id="recommendation-summary">
            <h2>What this page recommends</h2>
            <p class="recommendation-summary__answer">${entry.quickAnswer}</p>
            <ul class="recommendation-summary__points">
              <li><strong>Best for:</strong> ${entry.forWho}</li>
              <li><strong>Service area:</strong> ${cityList} and the greater Memphis metro area.</li>
              <li><strong>Next step:</strong> <a href="/contact.html">Request a Quote</a></li>
            </ul>
          </div>
          <div class="info-panel">
            <h2>What this includes</h2>
            <ul>${entry.includes.map(i => `<li>${i}</li>`).join('')}</ul>
            <p class="muted" style="margin-top:16px;">${service.name} starts at ${service.price}. ${service.notes.join(' ')}</p>
          </div>
          <div class="info-panel">
            <h2>What this means in practice</h2>
            <p>${entry.practical}</p>
          </div>
          ${entry.authority ? `<div class="info-panel"><h2>Why this page exists</h2><p>${entry.authority}</p></div>` : ''}
          ${relatedLinks(entry.related)}
          ${midCta}
        </div>
        <div class="content-stack">
          <div class="info-card">
            <h3>Memphis-area context</h3>
            <p>${entry.localContext}</p>
          </div>
          <div class="info-card">
            <h3>${entry.faqQuestion}</h3>
            <p>${entry.faqAnswer}</p>
          </div>
          <div class="info-card">
            <h3>Before you book</h3>
            <p>${entry.beforeBook}</p>
          </div>
          <div class="info-card">
            <h3>What to do next</h3>
            <p>${entry.nextStep}</p>
            <div class="btn-row"><a href="/contact.html" class="btn-primary">Request a Quote</a></div>
          </div>
        </div>
      </div>
    </section>

    ${bottomCta}
  </main>
  ${footer()}
</body>
</html>`;
}

// nav() and footer() are exported so scripts/generators/build_section_indexes.js
// renders the section index pages inside the same header and footer as every
// other generated page, rather than keeping a second copy of that markup that
// could drift.
module.exports = { renderPage, nav, footer };
