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
  `<p class="muted" ${MARK.footer}><a href="${C.telHref}">${CALL_LABEL}</a><br><a href="${C.googleBusinessProfileUrl}" rel="noopener" target="_blank">${GBP_LABEL}</a></p>`;

const contactDirect = () =>
  `<div class="contact-direct" ${MARK.direct}><p><strong>Prefer to talk it through?</strong> <a href="${C.telHref}">Call ${C.telephoneDisplay}</a> or <a href="${C.smsHref}">text ${C.telephoneDisplay}</a>.</p><p><a href="${C.googleBusinessProfileUrl}" rel="noopener" target="_blank">${GBP_LABEL}</a>: see Porch and Party on Google Maps.</p></div>`;

// Owner-approved 2026-10-14: the renter-safety line sits next to the quote
// form link on contact.html. Text lives in data/offers/services.json renterSafety.
const SAFETY = offers.renterSafety;
const renterSafety = () => `<p class="muted" ${MARK.safety}>${SAFETY.line}</p>`;
const SAFETY_BLOCK = /<p class="muted" data-contact="renter-safety">[\s\S]*?<\/p>/;

const popularQuestions = () =>
  `<section class="section section-soft" ${MARK.popular}><div class="container"><div class="answer-block"><span class="eyebrow">Popular questions</span><h2>What Memphis hosts ask most</h2></div><ul class="footer-list">${priority.pages.map((p) => `<li><a href="${p.href}">${p.label}</a></li>`).join('')}</ul><p class="muted"><a href="${C.telHref}">${CALL_LABEL}</a> for a quick answer on your date.</p></div></section>`;

/** Fields every LocalBusiness node carries. */
function businessContactFields() {
  return { telephone: C.telephone, hasMap: C.googleBusinessProfileUrl, sameAs: [C.googleBusinessProfileUrl], additionalType: T.additionalType.slice() };
}

function patchNode(node) {
  if (Array.isArray(node)) { node.forEach(patchNode); return; }
  if (!node || typeof node !== 'object') return;
  const types = [].concat(node['@type'] || []);
  if (types.includes('LocalBusiness')) {
    node.telephone = C.telephone;
    node.hasMap = C.googleBusinessProfileUrl;
    const same = [].concat(node.sameAs || []);
    if (!same.includes(C.googleBusinessProfileUrl)) same.push(C.googleBusinessProfileUrl);
    node.sameAs = same;
    // Party planner + decorator classes; schema.org has neither type.
    const types = [].concat(node.additionalType || []);
    for (const t of T.additionalType) if (!types.includes(t)) types.push(t);
    node.additionalType = types;
  }
  for (const v of Object.values(node)) patchNode(v);
}

const JSONLD = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g;

function patchJsonLd(html) {
  return html.replace(JSONLD, (whole, open, body, close) => {
    if (!body.includes('LocalBusiness')) return whole;
    const data = JSON.parse(body);
    patchNode(data);
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
    const form = out.indexOf(`href="${offers.quoteUrl}"`);
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
  businessContactFields, patchJsonLd, applyContactSurface
};
