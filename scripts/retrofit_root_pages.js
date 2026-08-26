#!/usr/bin/env node
'use strict';
/**
 * Root-page retrofit.
 *
 * Two separate defects, so two separate treatments.
 *
 * 1. Publisher identity. Every root page carried a WebPage node and nothing
 *    that says who publishes the site, while every page under services/ and
 *    areas/ already carried LocalBusiness. That is the entity-clarity gap: the
 *    six highest-authority URLs on the domain were the six that never named the
 *    business. All six get the LocalBusiness node, 404.html included - it is
 *    still a page of this site, and a site-wide publisher node is the standard
 *    shape.
 *
 *    No NAP is emitted. There is no street address and no telephone number
 *    anywhere in this repository, so the node ships areaServed + email +
 *    makesOffer and omits address and telephone rather than inventing them.
 *
 * 2. Thin content, but only where thin is actually a defect. pricing.html and
 *    how-it-works.html are answer surfaces that were missing material they
 *    should always have carried: the site's own Q&A (data/faqs/faqs.json), and
 *    on how-it-works the scope and price floor of each service
 *    (data/offers/services.json), which is what "how it works" means.
 *
 *    contact.html, privacy-policy.html, terms-and-conditions.html and 404.html
 *    are NOT expanded past what real material exists. That is not an omission -
 *    it is this repo's own standing position. scripts/validators/
 *    validate_content_pattern_contract.js already lists exactly these four in
 *    SKIP_FILES: "Legal and transactional surfaces. The quote form answers no
 *    search query, and holding a privacy policy to a direct-answer contract
 *    measures nothing." The privacy policy and the terms are complete documents
 *    that happen to be short; there is no further real material for them, and
 *    padding a legal page is worse than leaving it. contact.html does get the
 *    site Q&A, because those questions are genuinely what a person asks on the
 *    quote form - it stays under 300 words afterwards and is left there.
 *
 * Idempotent: retrofitted blocks are marked and stripped before being rebuilt.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const areas = require(path.join(ROOT, 'data/service_areas/areas.json'));
const siteFaqs = require(path.join(ROOT, 'data/faqs/faqs.json'));

const DOMAIN = offers.domain;
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rp = (s) => String(s).replace(/\$/g, '$$$$');
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

// faq: add the site Q&A block and a FAQPage node.
// scope: add the per-service scope-and-price panel (how-it-works only).
const PAGES = {
  'pricing.html': { faq: true, scope: false },
  'how-it-works.html': { faq: true, scope: true },
  'contact.html': { faq: true, scope: false },
  'privacy-policy.html': { faq: false, scope: false },
  'terms-and-conditions.html': { faq: false, scope: false },
  '404.html': { faq: false, scope: false }
};

function localBusinessNode(image) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: offers.brandName,
    url: `${DOMAIN}/`,
    ...(image ? { image } : {}),
    description: offers.primaryIdentity,
    areaServed: areas.areas,
    email: 'hello@porchandparty901.com',
    brand: { '@type': 'Brand', name: offers.brandName },
    parentOrganization: { '@type': 'Organization', name: 'Kerseta LLC' },
    makesOffer: Object.values(offers.services).map((s) => ({
      '@type': 'Offer',
      name: s.name,
      url: `${DOMAIN}${s.slug}`,
      description: s.summary,
      priceSpecification: {
        '@type': 'PriceSpecification',
        priceCurrency: 'USD',
        minPrice: Number(String(s.price).replace(/[^0-9]/g, '')),
        valueAddedTaxIncluded: false
      }
    }))
  };
}

const faqSection = () => '<section class="section section-soft" data-retrofit="root-faq">'
  + '<div class="container"><div class="answer-block"><span class="eyebrow">FAQ</span>'
  + '<h2>Common questions before requesting a quote</h2></div><div class="faq-list">'
  + siteFaqs.map((f) => `<div class="faq-item"><h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p></div>`).join('')
  + '</div></div></section>\n';

const scopeSection = () => '<section class="section" data-retrofit="root-scope">'
  + '<div class="container"><div class="answer-block"><span class="eyebrow">Scope</span>'
  + '<h2>What each service covers and where the price starts</h2></div>'
  + '<div class="content-grid">'
  + Object.values(offers.services).map((s) => '<div class="info-panel">'
    + `<h3><a href="${s.slug}">${esc(s.name)}</a> &mdash; from ${esc(s.price)}</h3>`
    + `<p>${esc(s.summary)}</p><ul>${s.includes.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    + `<p class="muted">${esc(s.notes.join(' '))}</p></div>`).join('')
  + '</div></div></section>\n';

const apply = !process.argv.includes('--check');
const report = [];

for (const [rel, cfg] of Object.entries(PAGES)) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`missing page ${rel}`);
  let html = fs.readFileSync(abs, 'utf8');

  html = html.replace(/<section class="section[^"]*" data-retrofit="root-(?:faq|scope)">[\s\S]*?<\/section>\n?/g, '');
  html = html.replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"(?:LocalBusiness|FAQPage)"[\s\S]*?<\/script>\n?/g, '');

  const image = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
  const nodes = [localBusinessNode(image)];
  if (cfg.faq) {
    nodes.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: siteFaqs.map((f) => ({
        '@type': 'Question', name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer }
      }))
    });
  }
  if (!/<\/head>/.test(html)) throw new Error(`${rel}: no </head>`);
  html = html.replace(/(<\/head>)/, `${rp(nodes.map(ld).join('\n'))}\n$1`);

  if (cfg.scope || cfg.faq) {
    if (!/<\/main>/.test(html)) throw new Error(`${rel}: no </main> anchor`);
    const add = `${cfg.scope ? scopeSection() : ''}${cfg.faq ? faqSection() : ''}`;
    html = html.replace(/(<\/main>)/, `${rp(add)}$1`);
  }

  if (apply) fs.writeFileSync(abs, html);
  report.push({ page: rel, localBusiness: true, faqPage: cfg.faq, scopePanel: cfg.scope });
}

console.log(JSON.stringify({ mode: apply ? 'apply' : 'check', pages: report.length, report }, null, 2));
