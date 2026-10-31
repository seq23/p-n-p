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
 *    The node ships areaServed + email + makesOffer, plus telephone, hasMap
 *    and sameAs from scripts/lib/contact_surface.js (owner-supplied
 *    2026-10-10). No street address exists in this repo, so none is emitted.
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
 * One owner per block (fixed 2026-10-18; a fresh run used to move every block
 * it owns, so the pipeline could never be re-run against committed pages):
 *   - this script owns the root pages' FAQPage node, the site-Q&A section
 *     (data-retrofit="root-faq") and the scope panel (data-retrofit="root-scope");
 *   - the business node's SHAPE is owned by scripts/lib/contact_surface.js
 *     (canonicalBusiness); this script only supplies the page extras
 *     (description, makesOffer, brand, parentOrganization) and emits the node
 *     already in that shape, so install_contact_surface.js finds nothing to do;
 *   - 404.html is owned by scripts/build_404.js (noindex, exempt from the
 *     business-entity rule), so it is not on this list;
 *   - meta descriptions and the WebPage description belong to
 *     scripts/install_brand_surfaces.js; this script never touches them.
 * Every block is rewritten where it already sits; only a page that lacks one
 * gets it at the default anchor (JSON-LD before </head>, sections before the
 * contact-surface "popular" block or the related-pages block, else </main>).
 * scripts/validators/validate_root_pages_idempotent.js runs the whole chain on
 * a temp copy and fails on any diff.
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
  'terms-and-conditions.html': { faq: false, scope: false }
};
const { canonicalBusiness, isBusinessNode, businessContactFields } = require('./lib/contact_surface');

/** Page extras only; canonicalBusiness adds telephone, map, sameAs, logo, image and the rest. */
function localBusinessNode() {
  return canonicalBusiness({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: offers.brandName,
    url: `${DOMAIN}/`,
    description: require('./lib/brand').IDENTITY_SENTENCE,
    areaServed: areas.areas,
    email: 'hello@porchandparty901.com',
    brand: { '@type': 'Brand', name: offers.brandName },
    parentOrganization: { ...require('../config/entity.json').parentOrganization },
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
    })),
    ...businessContactFields()
  });
}

const faqSection = () => '<section class="section section-soft" data-retrofit="root-faq">'
  + '<div class="container"><div class="answer-block"><span class="eyebrow">FAQ</span>'
  + '<h2>Common questions before requesting a quote</h2></div><div class="faq-list">'
  + siteFaqs.map((f) => `<div class="faq-item"><h3>${esc(f.question)}</h3><p>${esc(f.answer)}</p></div>`).join('')
  + '</div></div></section>\n';

/** A service's notes plus the takedown add-on line where it applies (services.json addOns.takedown). */
const TAKEDOWN = (offers.addOns || {}).takedown;
const scopeNotes = (key, s) => (TAKEDOWN && TAKEDOWN.appliesTo.includes(key) && !s.notes.includes(TAKEDOWN.line)
  ? [...s.notes, TAKEDOWN.line] : s.notes);

const scopeSection = () => '<section class="section" data-retrofit="root-scope">'
  + '<div class="container"><div class="answer-block"><span class="eyebrow">Scope</span>'
  + '<h2>What each service covers and where the price starts</h2></div>'
  + '<div class="content-grid">'
  + Object.entries(offers.services).map(([key, s]) => '<div class="info-panel">'
    + `<h3><a href="${s.slug}">${esc(s.name)}</a> &mdash; from ${esc(s.price)}</h3>`
    + `<p>${esc(s.summary)}</p><ul>${s.includes.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    + `<p class="muted">${esc(scopeNotes(key, s).join(' '))}</p></div>`).join('')
  + '</div></div></section>\n';

const MARK = '\u0000retrofit-slot\u0000';
const LD = /<script type="application\/ld\+json">([\s\S]*?)<\/script>(\n?)/g;
const SECTION = /<section class="section[^"]*" data-retrofit="root-(?:faq|scope)">[\s\S]*?<\/section>(\n?)/g;

/** Replaces every match the predicate claims with '', the first with MARK; returns [html, found]. */
function claim(html, re, mine) {
  let found = false;
  const out = html.replace(re, (whole, ...rest) => {
    if (!mine(whole, ...rest)) return whole;
    if (found) return '';
    found = true;
    return MARK;
  });
  return [out, found];
}

const ownedLd = (whole, body) => {
  let n;
  try { n = JSON.parse(body); } catch { return false; }
  return isBusinessNode(n) || [].concat(n['@type'] || []).includes('FAQPage');
};

/** The page with this script's blocks rebuilt in place. Pure, so the idempotence check can call it. */
function retrofit(html, rel, cfg = PAGES[rel]) {
  const nodes = [localBusinessNode()];
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
  const ldBlock = `${nodes.map(ld).join('\n')}\n`;
  let [out, hadLd] = claim(html, LD, ownedLd);
  if (hadLd) out = out.replace(MARK, () => ldBlock);
  else {
    if (!/<\/head>/.test(out)) throw new Error(`${rel}: no </head>`);
    out = out.replace(/(<\/head>)/, `${rp(ldBlock)}$1`);
  }

  const add = `${cfg.scope ? scopeSection() : ''}${cfg.faq ? faqSection() : ''}`;
  let hadSection;
  [out, hadSection] = claim(out, SECTION, () => true);
  if (hadSection) out = out.replace(MARK, () => add);
  else if (add) {
    const anchors = ['<section class="section section-soft" data-contact="popular">', '<section class="section section-soft" data-nav="related-pages">', '</main>'];
    const a = anchors.find((x) => out.includes(x));
    if (!a) throw new Error(`${rel}: no </main> anchor`);
    const at = out.indexOf(a);
    out = out.slice(0, at) + add + out.slice(at);
  }
  return out;
}

if (require.main === module) {
  const apply = !process.argv.includes('--check');
  const report = [];
  for (const [rel, cfg] of Object.entries(PAGES)) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) throw new Error(`missing page ${rel}`);
    const html = retrofit(fs.readFileSync(abs, 'utf8'), rel, cfg);
    if (apply) fs.writeFileSync(abs, html);
    report.push({ page: rel, localBusiness: true, faqPage: cfg.faq, scopePanel: cfg.scope });
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'check', pages: report.length, report }, null, 2));
}

module.exports = { PAGES, retrofit };
