'use strict';
/**
 * The one definition of how a visitor reaches Porch & Party directly: the
 * phone (call or text) and the Google Business Profile listing.
 *
 * Why this exists (owner-approved 2026-10-10): Clarity measured 28 human
 * sessions in 90 days and the only contact surfaces were an email address and
 * a Google Form. No page carried a phone number or the Google listing, and no
 * LocalBusiness node carried a telephone, so a visitor ready to book had no
 * one-tap route and Google had no NAP signal tying the site to the listing.
 *
 * Every value comes from data/offers/services.json `contact`. The page
 * template (templates/page-shell.js), the root/answer/section-index producers
 * and the retrofit pass (scripts/install_contact_surface.js) all render from
 * here, and scripts/validators/validate_contact_surface.js asserts the result
 * on every published page. Each inserted block carries a data-contact marker
 * so the pass is idempotent and the generator's marker guard can see it.
 */
const path = require('path');
const offers = require(path.join(__dirname, '../../data/offers/services.json'));
const priority = require(path.join(__dirname, '../../data/ops/priority_pages.json'));

const C = offers.contact;
if (!C || !C.telephone || !C.telHref || !C.smsHref || !C.googleBusinessProfileUrl) {
  throw new Error('data/offers/services.json is missing contact.telephone/telHref/smsHref/googleBusinessProfileUrl');
}

const T = offers.businessTypes;
const R = offers.primaryRoute;
if (!T || !Array.isArray(T.additionalType) || !T.additionalType.length) throw new Error('data/offers/services.json is missing businessTypes.additionalType');
if (!R || !R.href || !R.footerLabel) throw new Error('data/offers/services.json is missing primaryRoute.href/footerLabel');

const CALL_LABEL = `Call or text ${C.telephoneDisplay}`;
const GBP_LABEL = 'Find us on Google';
const MAPS_LABEL = 'Find us on Google Maps';
const FB_LABEL = 'Porch & Party on Facebook';

const MARK = {
  header: 'data-contact="header-call"',
  footer: 'data-contact="footer"',
  direct: 'data-contact="direct"',
  popular: 'data-contact="popular"',
  footerRoute: 'data-footer-link="primary-route"',
  safety: 'data-contact="renter-safety"'
};

/**
 * The page Search Console shows demand for (party-planner queries, 2026-10-10),
 * linked from the footer of every page. Owner ruling 2026-10-13 took it out of
 * the header nav (scripts/lib/site_chrome.js owns the header); the footer link
 * and its links from the services index and hubs stay.
 */
const footerRouteLink = () => `<a href="${R.href}" ${MARK.footerRoute}>${R.footerLabel}</a>`;

const headerCall = () =>
  `<a href="${C.telHref}" class="header-call" ${MARK.header}>${CALL_LABEL}</a>`;

const footerContact = () =>
  `<p class="muted" ${MARK.footer}><a href="${C.telHref}">${CALL_LABEL}</a><br><a href="${C.googleBusinessProfileUrl}" rel="noopener" target="_blank">${MAPS_LABEL}</a><br><a href="${C.facebookPageUrl}" rel="noopener" target="_blank">${FB_LABEL.replace('&', '&amp;')}</a></p>`;

const contactDirect = () =>
  `<div class="contact-direct" ${MARK.direct}><p><strong>Prefer to talk it through?</strong> <a href="${C.telHref}">Call ${C.telephoneDisplay}</a> or <a href="${C.smsHref}">text ${C.telephoneDisplay}</a>.</p><p><a href="${C.googleBusinessProfileUrl}" rel="noopener" target="_blank">${GBP_LABEL}</a>: see Porch and Party on Google Maps.</p></div>`;

// Owner-approved 2026-10-14: the renter-safety line sits next to the quote
// form link on contact.html. Text lives in data/offers/services.json renterSafety.
const SAFETY = offers.renterSafety;
const renterSafety = () => `<p class="muted" ${MARK.safety}>${SAFETY.line}</p>`;
const SAFETY_BLOCK = /<p class="muted" data-contact="renter-safety">[\s\S]*?<\/p>/;

const popularQuestions = () =>
  `<section class="section section-soft" ${MARK.popular}><div class="container"><div class="answer-block"><span class="eyebrow">Popular questions</span><h2>What Memphis hosts ask most</h2></div><ul class="footer-list">${priority.pages.map((p) => `<li><a href="${p.href}">${p.label}</a></li>`).join('')}</ul><p class="muted"><a href="${C.telHref}">${CALL_LABEL}</a> for a quick answer on your date.</p></div></section>`;

/**
 * One business entity (owner-approved 2026-10-16): the site, the Google
 * Business Profile and the Facebook Page are the same business. Every page
 * carries exactly ONE full business node with the stable @id
 * https://porchandparty901.com/#business, whose sameAs names the Facebook Page
 * and the Maps cid; every other node that would describe the business
 * (a nested Service.provider, Article.about/publisher/author, Offer.seller)
 * is reduced to {"@id": ...}. Values come from data/offers/services.json
 * contact.entity. Guarded by scripts/validators/validate_business_entity.js.
 */
const ENTITY = C.entity;
if (!ENTITY || !ENTITY.id || !Array.isArray(ENTITY.type) || !ENTITY.type.includes('LocalBusiness') || !C.facebookPageUrl) {
  throw new Error('data/offers/services.json is missing contact.entity (id, type incl. LocalBusiness) or contact.facebookPageUrl');
}
const BUSINESS_ID = ENTITY.id;
const SAME_AS = [C.facebookPageUrl, C.googleBusinessProfileUrl];
const AREAS = require(path.join(__dirname, '../../data/service_areas/areas.json')).areas;

const businessRef = () => ({ '@id': BUSINESS_ID });

/** Fields every business node carries (spread into generator output; the page pass then dedupes). */
function businessContactFields() {
  return { '@id': BUSINESS_ID, telephone: C.telephone, email: 'hello@porchandparty901.com', hasMap: C.googleBusinessProfileUrl, sameAs: SAME_AS.slice(), additionalType: T.additionalType.slice() };
}

const typesOf = (n) => [].concat((n && n['@type']) || []);
function isBusinessNode(n) {
  if (!n || typeof n !== 'object' || Array.isArray(n)) return false;
  const t = typesOf(n);
  if (t.includes('LocalBusiness')) return true;
  if (t.includes('Organization') && n.name === offers.brandName) return true;
  return n['@id'] === BUSINESS_ID && Object.keys(n).length > 1;
}

const union = (a, b) => {
  const out = [];
  const seen = new Set();
  for (const v of [].concat(a || [], b || [])) { const k = JSON.stringify(v); if (!seen.has(k)) { seen.add(k); out.push(v); } }
  return out;
};

/** The one full business node, keeping any page-specific extras (description, makesOffer...). */
function canonicalBusiness(existing = {}) {
  const { '@context': ctx, '@type': _t, '@id': _i, name: _n, url: _u, ...rest } = existing;
  const node = {
    ...(ctx ? { '@context': ctx } : {}),
    '@type': ENTITY.type.slice(),
    '@id': BUSINESS_ID,
    name: offers.brandName,
    url: `${offers.domain}/`,
    ...rest,
    telephone: C.telephone,
    email: 'hello@porchandparty901.com',
    logo: ENTITY.logo,
    image: existing.image || ENTITY.image,
    priceRange: ENTITY.priceRange,
    areaServed: union(existing.areaServed, AREAS),
    hasMap: C.googleBusinessProfileUrl,
    sameAs: union(SAME_AS, existing.sameAs),
    additionalType: union(existing.additionalType, T.additionalType)
  };
  return node;
}

function unifyNodes(roots) {
  let placed = false;
  const visit = (node) => {
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== 'object') return node;
    if (isBusinessNode(node)) {
      if (placed) return businessRef();
      placed = true;
      const full = canonicalBusiness(node);
      for (const k of Object.keys(full)) if (!['@context', '@type', '@id'].includes(k)) full[k] = visit(full[k]);
      return full;
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = visit(v);
    return out;
  };
  // A top-level business node is the preferred home for the full node.
  const top = roots.findIndex((r) => isBusinessNode(r));
  const order = top >= 0 ? [top, ...roots.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...roots.keys()];
  const result = new Array(roots.length);
  for (const i of order) result[i] = visit(roots[i]);
  if (placed) {
    for (const r of result) {
      if (r && !Array.isArray(r) && ['WebSite', 'WebPage', 'CollectionPage'].some((t) => typesOf(r).includes(t)) && !r.publisher) r.publisher = businessRef();
    }
  }
  return result;
}

const JSONLD = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g;

/** Page-level pass: exactly one full business node, everything else references it. Idempotent. */
function patchJsonLd(html) {
  const blocks = [...html.matchAll(JSONLD)];
  if (!blocks.length) return html;
  const parsed = blocks.map((m) => JSON.parse(m[2]));
  if (!JSON.stringify(parsed).match(/LocalBusiness|#business"|"Organization"/)) return html;
  const unified = unifyNodes(parsed);
  let i = 0;
  return html.replace(JSONLD, (whole, open, body, close) => {
    const data = unified[i++];
    const lead = body.match(/^\s*/)[0];
    const trail = body.match(/\s*$/)[0];
    const pretty = /^\{\s*\n(\s+)"/.exec(body.trim());
    const out = pretty ? JSON.stringify(data, null, pretty[1].length) : JSON.stringify(data);
    return `${open}${lead}${out}${trail}${close}`;
  });
}

const FOOTER_EMAIL = /(<a href="mailto:hello@porchandparty901\.com">hello@porchandparty901\.com<\/a>(?:<!--\/email_off-->)?<\/p>)/;

/**
 * Applies the contact surface to one page. Idempotent. Throws when a page has
 * no place for a block, so a new page shape is a loud failure, never a page
 * silently left without the phone.
 */
function applyContactSurface(html, rel) {
  let out = patchJsonLd(html);
  if (!out.includes(MARK.header)) {
    const end = out.indexOf('</header>');
    // A page with no site header (none today) still gets the footer phone below.
    if (end >= 0) {
    const navEnd = out.lastIndexOf('</nav>', end);
    const at = navEnd >= 0 ? navEnd + '</nav>'.length : out.lastIndexOf('</div>', end);
    out = out.slice(0, at) + headerCall() + out.slice(at);
    }
  }
  // Re-render an existing footer contact line so a change here reaches every page.
  out = out.replace(/<p class="muted" data-contact="footer">[\s\S]*?<\/p>/, () => footerContact());
  if (!out.includes(MARK.footer)) {
    const f = out.indexOf('<footer');
    if (f < 0) throw new Error(`${rel}: no <footer>`);
    const tail = out.slice(f);
    if (!FOOTER_EMAIL.test(tail)) throw new Error(`${rel}: footer has no hello@ paragraph to anchor the phone`);
    out = out.slice(0, f) + tail.replace(FOOTER_EMAIL, (m) => m + footerContact());
  }
  if (!out.includes(MARK.footerRoute)) {
    const f = out.indexOf('<footer');
    const pricing = f >= 0 ? out.indexOf('<a href="/pricing', f) : -1;
    if (pricing < 0) throw new Error(`${rel}: footer has no Pricing link to anchor the ${R.footerLabel} link`);
    out = out.slice(0, pricing) + footerRouteLink() + out.slice(pricing);
  }
  const isContact = rel === 'contact.html';
  const isHome = rel === 'index.html';
  if (isContact && !out.includes(MARK.direct)) {
    const m = out.indexOf('<main');
    const tail = out.slice(m);
    if (m < 0 || !FOOTER_EMAIL.test(tail)) throw new Error(`${rel}: no hello@ paragraph in <main> to anchor the call/text block`);
    out = out.slice(0, m) + tail.replace(FOOTER_EMAIL, (x) => x + contactDirect());
  }
  if (isContact && out.includes(MARK.safety)) out = out.replace(SAFETY_BLOCK, () => renterSafety());
  if (isContact && !out.includes(MARK.safety)) {
    // The page body's form button, not the header's Request a Quote (which also opens the form).
    const form = out.indexOf(`href="${offers.quoteUrl}"`, Math.max(0, out.indexOf('<main')));
    const end = form < 0 ? -1 : out.indexOf('</p>', out.indexOf('</div>', form));
    if (end < 0) throw new Error(`${rel}: no quote-form link and note to anchor the renter-safety line`);
    out = out.slice(0, end + 4) + renterSafety() + out.slice(end + 4);
  }
  if ((isContact || isHome) && out.includes(MARK.popular)) {
    // Re-render, so a page added to data/ops/priority_pages.json reaches the
    // block on the next pass instead of only on a page that never had one.
    out = out.replace(/<section class="section section-soft" data-contact="popular">[\s\S]*?<\/section>/, () => popularQuestions());
  }
  if ((isContact || isHome) && !out.includes(MARK.popular)) {
    const anchor = out.indexOf('<section class="section section-soft" data-nav="related-pages">');
    const at = anchor >= 0 ? anchor : out.indexOf('</main>');
    if (at < 0) throw new Error(`${rel}: no </main> for the popular-questions block`);
    out = out.slice(0, at) + popularQuestions() + out.slice(at);
  }
  return out;
}

module.exports = {
  CONTACT: C, CALL_LABEL, GBP_LABEL, MARK, PRIORITY_PAGES: priority.pages,
  BUSINESS_TYPES: T.additionalType, PRIMARY_ROUTE: R,
  headerCall, footerContact, footerRouteLink, contactDirect, popularQuestions, renterSafety, SAFETY,
  businessContactFields, businessRef, canonicalBusiness, isBusinessNode, BUSINESS_ID, SAME_AS, MAPS_LABEL, FB_LABEL,
  patchJsonLd, applyContactSurface
};
