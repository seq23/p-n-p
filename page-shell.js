const fs = require('fs');
const path = require('path');
const offers = require('../data/offers/services.json');
const areas = require('../data/service_areas/areas.json');

function nav(){
  return `<header class="site-header"><div class="container header-inner"><a href="/" aria-label="Porch and Party home"><span class="brand-script">Porch &amp; Party</span></a><nav class="site-nav" aria-label="Primary navigation"><a href="/services/porch-decorating.html">Porch</a><a href="/services/celebration-setups.html">Celebrations</a><a href="/services/grazing-and-event-styling.html">Grazing &amp; Events</a><a href="/pricing.html">Pricing</a><a href="/how-it-works.html">How It Works</a><a href="/contact.html" class="btn-primary">Request a Quote</a></nav></div></header>`;
}

function footer(){
  return `<footer class="site-footer"><div class="container"><div class="footer-grid"><div><div class="footer-title">Porch &amp; Party</div><p class="muted">Seasonal porch decorating, celebration setups, and styled event decor in the Memphis metro area.</p></div><div><div class="footer-title">Explore</div><div class="footer-list"><a href="/services/porch-decorating.html">Seasonal Porch Decorating</a><a href="/services/celebration-setups.html">Celebration Setups</a><a href="/services/grazing-and-event-styling.html">Grazing &amp; Styled Events</a><a href="/pricing.html">Pricing</a><a href="/contact.html">Contact</a></div></div><div><div class="footer-title">Service Area</div><div class="footer-list">${areas.areas.map(a=>`<span>${a.split(',')[0]}</span>`).join('')}</div></div></div><div class="legal">Porch &amp; Party is a brand operated by Kerseta LLC.</div></div></footer>`;
}

function pageJsonLd(url,title,description,faqQuestion,faqAnswer){
  const base = [{
    '@context':'https://schema.org',
    '@type':'WebPage',
    name:title,
    description,
    url
  }];
  if(faqQuestion && faqAnswer){
    base.push({
      '@context':'https://schema.org',
      '@type':'FAQPage',
      mainEntity:[{ '@type':'Question', name:faqQuestion, acceptedAnswer:{ '@type':'Answer', text:faqAnswer } }]
    });
  }
  return base.map(obj=>`<script type="application/ld+json">${JSON.stringify(obj)}</script>`).join('\n');
}

function relatedLinks(rels){
  const label = {
    '/services/porch-decorating.html':'Seasonal Porch Decorating',
    '/services/celebration-setups.html':'Celebration Setups',
    '/services/grazing-and-event-styling.html':'Grazing Tables & Styled Events',
    '/contact.html':'Request a Quote',
    '/pricing.html':'Pricing',
    '/how-it-works.html':'How It Works',
    '/local/hotel-room-decorations-memphis.html':'Hotel Room Decorations in Memphis',
    '/local/birthday-decorations-at-home-memphis.html':'Birthday Decorations at Home in Memphis',
    '/local/grazing-tables-memphis.html':'Grazing Tables in Memphis',
    '/faq/how-much-does-hotel-room-decor-cost-in-memphis.html':'Hotel Room Decor Cost in Memphis',
    '/faq/do-party-decorators-come-to-your-house.html':'Do Party Decorators Come to Your House?',
    '/faq/do-grazing-tables-include-food.html':'Do Grazing Tables Include Food?',
    '/seasonal/halloween-porch-decorating-memphis.html':'Halloween Porch Decorating in Memphis',
    '/seasonal/christmas-porch-decorating-memphis.html':'Christmas Porch Decorating in Memphis',
    '/hubs/memphis-celebration-setups.html':'Memphis Celebration Setups'
  };
  return `<div class="info-panel"><h3>Related pages</h3><ul>${rels.map(r=>`<li><a href="${r}">${label[r]||r}</a></li>`).join('')}</ul></div>`;
}

function renderPage(entry){
  const service = offers.services[entry.serviceKey];
  const pathUrl = `/${entry.folder}/${entry.slug}.html`;
  const fullUrl = `${offers.domain}${pathUrl}`;
  const cityList = entry.cities.join(', ');
  const topCta = `<div class="btn-row"><a href="/contact.html" class="btn-primary">Request a Quote</a><a href="${service.slug}" class="btn-secondary">View ${service.name}</a></div>`;
  const midCta = `<div class="btn-row"><a href="/contact.html" class="btn-primary">Request a Quote</a></div>`;
  const bottomCta = `<section class="section cta-band"><div class="container"><span class="eyebrow">Request a Quote</span><h2>Planning something in the Memphis metro area?</h2><p>${service.name} requests can be reviewed with your date, city, event type, and setup notes.</p><div class="btn-row hero-centered-cta"><a href="/contact.html" class="btn-primary">Request a Quote</a></div></div></section>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${entry.title}</title>
  <meta name="description" content="${entry.description}" />
  <meta name="robots" content="index,follow" />
  <link rel="canonical" href="${fullUrl}" />
  <meta property="og:title" content="${entry.title}" />
  <meta property="og:description" content="${entry.description}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${fullUrl}" />
  <meta name="theme-color" content="#faf7f2" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/styles.css" />
  ${pageJsonLd(fullUrl, entry.h1, entry.description, entry.faqQuestion, entry.faqAnswer)}
</head>
<body>
  ${nav()}
  <main>
    <section class="section">
      <div class="container">
        <div class="page-intro">
          <span class="eyebrow">${service.name}</span>
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
          <div class="info-panel">
            <h2>Quick answer</h2>
            <p>${entry.quickAnswer}</p>
          </div>
          <div class="info-panel">
            <h2>Who this is for</h2>
            <p>${entry.forWho}</p>
          </div>
          <div class="info-panel">
            <h2>What this includes</h2>
            <ul>${entry.includes.map(i=>`<li>${i}</li>`).join('')}</ul>
            <p class="muted" style="margin-top:16px;">${service.name} starts at ${service.price}. ${service.notes.join(' ')}</p>
          </div>
          ${relatedLinks(entry.related)}
          ${midCta}
        </div>
        <div class="content-stack">
          <div class="info-card">
            <h3>Memphis-area context</h3>
            <p>Porch &amp; Party serves ${cityList}. The quote path stays the same whether the setup is happening in Memphis proper or elsewhere in the surrounding service area.</p>
          </div>
          <div class="info-card">
            <h3>${entry.faqQuestion}</h3>
            <p>${entry.faqAnswer}</p>
          </div>
          <div class="info-card">
            <h3>What to do next</h3>
            <p>Use the quote form to share your event type, city, date, budget range, and setup notes. That gives Porch &amp; Party enough detail to respond with scope and pricing direction.</p>
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

module.exports = { renderPage };
