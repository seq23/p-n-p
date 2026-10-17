'use strict';
/**
 * The one definition of the site header (desktop row + mobile menu panel), the
 * footer Rentals link and the nav stylesheet link, for every published page.
 *
 * Owner ruling 2026-10-13: the nav is Porch · Celebrations · Grazing & Events ·
 * Rentals · Pricing · How It Works · FAQ (FAQ added by owner ruling 2026-10-17), then "Request a Quote" and
 * "Call or text 901-355-1518", identical on EVERY page, frozen ones included.
 *
 * Owner ruling 2026-10-15: every quote call-to-action opens the quote form
 * (services.json quoteUrl, a Google Form) directly, in a new tab - the header
 * button and every in-body "Request a Quote" / "Start Your Request" / "Check
 * My Date" link. /contact stays (email, phone, the form button) and is linked
 * only as "Contact". retargetQuoteCtas() moves any quote CTA still pointing at
 * /contact onto the form; it runs inside applySiteChrome(), so it reaches the
 * frozen pages the same chrome-only way the header does.
 * "Party Planning" is not in the header; the planner page keeps its footer link
 * (scripts/lib/contact_surface.js) and its links from the services index/hubs.
 *
 * Who uses it:
 *   - templates/page-shell.js (and through it the section indexes and the
 *     rentals page) renders header() natively, so a fresh render already
 *     carries the canonical chrome;
 *   - scripts/install_site_chrome.js applies applySiteChrome() to every
 *     published page (root pages, retrofitted pages and the 110 frozen
 *     authority pages that are never re-rendered), then refreezes only the
 *     frozen routes whose change is chrome-only;
 *   - scripts/validators/validate_site_chrome.js fails when any page's header
 *     or footer differs from what this module renders.
 *
 * No JS: the hamburger is an <a href="#site-menu"> and the panel opens with
 * :target; the inline script swaps in a real <button> (aria-expanded,
 * aria-controls) and adds Esc / backdrop close and the body scroll lock.
 */
const path = require('path');
const offers = require(path.join(__dirname, '../../data/offers/services.json'));

const C = offers.contact;

const NAV_ITEMS = Object.freeze([
  { href: '/services/porch-decorating', label: 'Porch' },
  { href: '/services/celebration-setups', label: 'Celebrations' },
  { href: '/services/grazing-and-event-styling', label: 'Grazing &amp; Events' },
  { href: '/rentals/', label: 'Rentals' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/faq/', label: 'FAQ' }
]);
const QUOTE = Object.freeze({ href: offers.quoteUrl, label: 'Request a Quote', attrs: 'target="_blank" rel="noopener"' });
const CONTACT_HREF_RE = /^\/contact(?:\.html)?\/?(?:[?#].*)?$/;
// A link whose words ask for a quote, a request or a date check is a quote CTA.
const QUOTE_CTA_LABEL_RE = /\b(?:quote|request|check my date|book)\b/i;
const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
const anchorText = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const hrefOf = (attrs) => (attrs.match(/\bhref="([^"]*)"/) || [])[1];
const CALL_LABEL = `Call or text ${C.telephoneDisplay}`;

const MARK = Object.freeze({
  header: 'data-site-chrome="header"',
  css: 'data-site-chrome="css"',
  fonts: 'data-site-chrome="fonts"',
  footerRentals: 'data-footer-link="rentals"',
  footerFaq: 'data-footer-link="faq"'
});

const CSS_HREF = '/assets/css/site-nav.css';
const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap';
const RENTALS_FOOTER = `<a href="/rentals/" ${MARK.footerRentals}>Party Game Rentals</a>`;
// Owner ruling 2026-10-17: the consolidated FAQ page is in the header and the footer of every page.
const FAQ_FOOTER = `<a href="/faq/" ${MARK.footerFaq}>FAQ</a>`;

const PHONE_SVG = '<svg class="pnp-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/></svg>';
const BURGER_SVG = '<svg class="pnp-burger" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path class="pnp-burger-open" d="M4 7h16M4 12h16M4 17h16"/><path class="pnp-burger-close" d="M6 6l12 12M18 6L6 18"/></svg>';

// Kept small and dependency-free; it ships inside <header>, so the chrome pass
// carries it to every page exactly as it carries the markup.
const SCRIPT = '(function(){var h=document.currentScript&&document.currentScript.parentNode;if(!h)return;'
  + 'var b=h.querySelector("button.pnp-toggle"),a=h.querySelector("a.pnp-toggle"),p=h.querySelector("#site-menu"),k=h.querySelector(".pnp-backdrop"),r=document.documentElement;'
  + 'if(!b||!p)return;b.hidden=false;if(a)a.parentNode.removeChild(a);h.classList.add("pnp-js");'
  + 'function s(o){h.classList.toggle("is-open",o);r.classList.toggle("pnp-lock",o);b.setAttribute("aria-expanded",o?"true":"false");b.setAttribute("aria-label",o?"Close menu":"Open menu");}'
  + 'b.addEventListener("click",function(){s(b.getAttribute("aria-expanded")!=="true");});'
  + 'if(k)k.addEventListener("click",function(){s(false);});'
  + 'p.addEventListener("click",function(e){if(e.target.closest&&e.target.closest("a"))s(false);});'
  + 'document.addEventListener("keydown",function(e){if(e.key==="Escape"&&h.classList.contains("is-open")){s(false);b.focus();}});'
  + 'if(window.matchMedia){var m=window.matchMedia("(min-width: 1024px)");var f=function(){if(m.matches)s(false);};if(m.addEventListener)m.addEventListener("change",f);else if(m.addListener)m.addListener(f);}'
  + '})();';

const norm = (href) => String(href || '').replace(/\.html$/, '').replace(/\/index$/, '/').replace(/(.)\/$/, '$1');

/** The nav item (or the quote button) that names the page at `currentPath`. */
function isCurrent(href, currentPath) {
  return currentPath != null && currentPath !== '' && norm(href) === norm(currentPath);
}

const cur = (href, currentPath) => (isCurrent(href, currentPath) ? ' aria-current="page"' : '');

function header(currentPath) {
  const items = NAV_ITEMS.map((i) => `<a href="${i.href}"${cur(i.href, currentPath)}>${i.label}</a>`).join('');
  const quote = (cls) => `<a href="${QUOTE.href}" class="${cls}" ${QUOTE.attrs}>${QUOTE.label}</a>`;
  return `<header class="site-header pnp-header" ${MARK.header}><div class="pnp-header-inner">`
    + `<a class="pnp-logo" href="/" aria-label="Porch and Party home"><span class="brand-script">Porch &amp; Party</span></a>`
    + `<nav class="site-nav pnp-nav" aria-label="Primary navigation">${items}</nav>`
    + `<div class="pnp-actions">${quote('btn-primary pnp-quote')}`
    + `<a href="${C.telHref}" class="header-call pnp-call" data-contact="header-call">${PHONE_SVG}<span class="pnp-call-lead">Call or text </span><span class="pnp-call-num">${C.telephoneDisplay}</span></a></div>`
    + `<a href="${C.telHref}" class="pnp-icon-call" aria-label="${CALL_LABEL}">${PHONE_SVG}</a>`
    + `<a href="#site-menu" class="pnp-toggle" aria-controls="site-menu" aria-label="Open menu">${BURGER_SVG}</a>`
    + `<button type="button" class="pnp-toggle" aria-expanded="false" aria-controls="site-menu" aria-label="Open menu" hidden>${BURGER_SVG}</button>`
    + `</div>`
    + `<div class="pnp-panel" id="site-menu"><nav class="pnp-panel-nav" aria-label="Menu">${items}</nav>`
    + `${quote('btn-primary pnp-panel-quote')}`
    + `<a href="${C.telHref}" class="pnp-panel-call">${PHONE_SVG}${CALL_LABEL}</a>`
    + `<a href="#" class="pnp-panel-close">Close menu</a></div>`
    + `<div class="pnp-backdrop" aria-hidden="true"></div>`
    + `<script>${SCRIPT}</script></header>`;
}

const cssLink = () => `<link rel="stylesheet" href="${CSS_HREF}" ${MARK.css} />`;
const fontsLink = () => `<link href="${FONTS_HREF.replace(/&/g, '&amp;')}" rel="stylesheet" ${MARK.fonts} />`;

/** The site path a published file serves at: index.html -> /, rentals/index.html -> /rentals/. */
function sitePathOf(rel) {
  const r = rel.replace(/\\/g, '/');
  if (r === 'index.html') return '/';
  if (r.endsWith('/index.html')) return `/${r.slice(0, -'index.html'.length)}`;
  return `/${r.replace(/\.html$/, '')}`;
}

const HEADER_RE = /<header\b[^>]*class="site-header[^"]*"[^>]*>[\s\S]*?<\/header>/;
const EXPLORE_RE = /(<div class="footer-title">Explore<\/div>\s*<div class="footer-list">)([\s\S]*?)(<\/div>)/;
const RENTALS_ANY_RE = /<a\b[^>]*href="\/rentals\/?"[^>]*>[^<]*<\/a>/g;
const FAQ_ANY_RE = /<a\b[^>]*href="\/faq\/?(?:index\.html)?"[^>]*>[^<]*<\/a>/g;

/** True when an anchor (its attribute string and inner HTML) is a quote call-to-action. */
function isQuoteCta(attrs, inner) {
  const href = hrefOf(attrs);
  if (href !== QUOTE.href && !CONTACT_HREF_RE.test(href || '')) return false;
  return QUOTE_CTA_LABEL_RE.test(anchorText(inner));
}

/**
 * Points every quote CTA that still links /contact at the quote form, in a new
 * tab. Keeps every other attribute (class, data-quote-cta) where it was; any
 * old target/rel is replaced. Idempotent.
 */
function retargetQuoteCtas(html) {
  return html.replace(ANCHOR_RE, (whole, attrs, inner) => {
    if (!CONTACT_HREF_RE.test(hrefOf(attrs) || '') || !isQuoteCta(attrs, inner)) return whole;
    const rest = attrs.replace(/\s+(?:target|rel)="[^"]*"/g, '').replace(/\bhref="[^"]*"/, `href="${QUOTE.href}"`);
    return `<a${rest} ${QUOTE.attrs}>${inner}</a>`;
  });
}

/**
 * Applies the canonical chrome to one page. Idempotent; throws when a page has
 * no place for a block, so a new page shape fails loudly.
 */
function applySiteChrome(html, rel) {
  let out = retargetQuoteCtas(html);
  const want = header(sitePathOf(rel));
  if (HEADER_RE.test(out)) out = out.replace(HEADER_RE, () => want);
  else {
    const body = /<body\b[^>]*>/.exec(out);
    if (!body) throw new Error(`${rel}: no <body> to carry the site header`);
    out = out.slice(0, body.index + body[0].length) + want + out.slice(body.index + body[0].length);
  }
  const headEnd = out.indexOf('</head>');
  if (headEnd < 0) throw new Error(`${rel}: no </head>`);
  if (!out.includes(MARK.css)) {
    const add = (/fonts\.googleapis\.com\/css2\?family=Cormorant/.test(out.slice(0, headEnd)) || out.includes(MARK.fonts) ? '' : fontsLink()) + cssLink();
    out = out.slice(0, headEnd) + add + out.slice(headEnd);
  }
  const ex = EXPLORE_RE.exec(out);
  if (!ex) throw new Error(`${rel}: footer has no Explore list for the Rentals link`);
  const list = ex[2];
  if (!list.includes(RENTALS_FOOTER) || (list.match(RENTALS_ANY_RE) || []).length !== 1) {
    let next = list.replace(RENTALS_ANY_RE, '');
    const anchor = /<a\b[^>]*href="\/pricing"[^>]*>/.exec(next);
    if (!anchor) throw new Error(`${rel}: footer Explore list has no Pricing link to anchor Rentals`);
    next = next.slice(0, anchor.index) + RENTALS_FOOTER + next.slice(anchor.index);
    out = out.slice(0, ex.index) + ex[1] + next + ex[3] + out.slice(ex.index + ex[0].length);
  }
  const ex2 = EXPLORE_RE.exec(out);
  const list2 = ex2[2];
  if (!list2.includes(FAQ_FOOTER) || (list2.match(FAQ_ANY_RE) || []).length !== 1) {
    let next = list2.replace(FAQ_ANY_RE, '');
    const pricing = /<a\b[^>]*href="\/pricing"[^>]*>[^<]*<\/a>/.exec(next);
    if (!pricing) throw new Error(`${rel}: footer Explore list has no Pricing link to anchor FAQ`);
    const at = pricing.index + pricing[0].length;
    next = next.slice(0, at) + FAQ_FOOTER + next.slice(at);
    out = out.slice(0, ex2.index) + ex2[1] + next + ex2[3] + out.slice(ex2.index + ex2[0].length);
  }
  return out;
}

/** Strips everything this module owns, so a validator can prove a change was chrome-only. */
function withoutChrome(html) {
  return html
    .replace(HEADER_RE, '')
    .replace(/<link\b[^>]*data-site-chrome="(?:css|fonts)"[^>]*>/g, '')
    .replace(RENTALS_ANY_RE, '')
    .replace(FAQ_ANY_RE, '')
    .replace(ANCHOR_RE, (whole, attrs, inner) => (isQuoteCta(attrs, inner)
      ? `<a${attrs.replace(/\s+(?:href|target|rel)="[^"]*"/g, '')} data-quote-target>${inner}</a>` : whole));
}

module.exports = {
  NAV_ITEMS, QUOTE, CALL_LABEL, MARK, CSS_HREF, RENTALS_FOOTER, FAQ_FOOTER, HEADER_RE, EXPLORE_RE,
  header, cssLink, fontsLink, sitePathOf, isCurrent, applySiteChrome, withoutChrome,
  isQuoteCta, retargetQuoteCtas
};
