#!/usr/bin/env node
'use strict';
/**
 * Asserts the site navigation is identical on EVERY published page (owner
 * ruling 2026-10-13), frozen authority pages included:
 *
 *   - each page has exactly one site header, byte-identical to
 *     scripts/lib/site_chrome.js header() for that page (only aria-current
 *     differs between pages, and only on the item that names the page);
 *   - independently of that module, the desktop nav and the mobile panel each
 *     list exactly the ruled items in the ruled order (spelled out below, so
 *     editing the module cannot quietly change the nav), followed by the
 *     Request a Quote button and the Call or text tel: link;
 *   - owner rulings 2026-10-15 / 2026-10-18: the header Request a Quote (desktop
 *     row AND mobile panel) opens the site's own request form, /request, in the
 *     same tab; on every page no quote CTA links /contact - the only link to
 *     /contact anywhere is one labelled "Contact" - no link to /request opens a
 *     new tab, and nothing links the retired Google Form (forms.gle or its
 *     docs.google.com/forms address) any more;
 *   - no header links the party-planner page ("Party Planning" was removed);
 *   - the hamburger is a <button> with aria-expanded + aria-controls="site-menu",
 *     the panel #site-menu exists, and the no-JS :target fallback link exists;
 *   - every page links /assets/css/site-nav.css, and that file exists;
 *   - every footer Explore list carries exactly one Rentals link (/rentals/).
 *
 * Self-test first: a page with Rentals dropped from the nav, a page with Party
 * Planning added back, a page without the footer Rentals link, a header quote
 * button back on /contact, an in-body quote CTA on /contact and a form link
 * without a new tab must each FAIL, so the check cannot pass vacuously. Hard-fails on zero pages.
 * Repair: npm run chrome:install.
 */
const fs = require('fs');
const path = require('path');
const chrome = require('../lib/site_chrome');
const { publishedPages } = require('../install_contact_surface');

const ROOT = path.resolve(__dirname, '../..');

// The owner's ruling, written out here on purpose rather than imported.
const RULED = [
  ['/services/porch-decorating', 'Porch'],
  ['/services/celebration-setups', 'Celebrations'],
  ['/services/grazing-and-event-styling', 'Grazing Tables'],
  ['/rentals/', 'Rentals'],
  ['/pricing', 'Pricing'],
  ['/how-it-works', 'How It Works'],
  ['/faq/', 'FAQ']
];
const TEL = 'tel:+19013551518';
// Written out on purpose (not read from services.json or the chrome module).
const FORM = '/request';
const RETIRED = /forms\.gle\/|docs\.google\.com\/forms\//;
const CONTACT_RE = /^\/contact(?:\.html)?\/?(?:[?#].*)?$/;
const newTab = (attrs) => / target="_blank"/.test(` ${attrs}`);
const isForm = (href) => href === FORM || /^\/request\?service=[a-z]+$/.test(href || '');
const PLANNER = '/services/birthday-party-planner-memphis';

const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const links = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
  href: (m[1].match(/href="([^"]*)"/) || [])[1], attrs: m[1], label: text(m[2])
}));

function checkPage(html, rel) {
  const errs = [];
  const headers = html.match(/<header\b[\s\S]*?<\/header>/g) || [];
  if (headers.length !== 1) return [`${rel}: ${headers.length} <header> elements (want exactly 1)`];
  const h = headers[0];
  const want = chrome.header(chrome.sitePathOf(rel));
  if (h !== want) errs.push(`${rel}: header differs from the canonical site chrome`);
  const sections = [
    ['desktop nav', (h.match(/<nav class="site-nav[^"]*"[^>]*>([\s\S]*?)<\/nav>/) || [])[1]],
    ['mobile panel', (h.match(/<nav class="pnp-panel-nav"[^>]*>([\s\S]*?)<\/nav>/) || [])[1]]
  ];
  for (const [name, inner] of sections) {
    if (inner == null) { errs.push(`${rel}: header has no ${name}`); continue; }
    const got = links(inner).map((l) => [l.href, l.label]);
    if (JSON.stringify(got) !== JSON.stringify(RULED)) errs.push(`${rel}: ${name} is [${got.map((g) => g[1]).join(' · ')}], ruled [${RULED.map((r) => r[1]).join(' · ')}]`);
    const current = links(inner).filter((l) => / aria-current="page"/.test(` ${l.attrs}`));
    const here = chrome.sitePathOf(rel);
    for (const c of current) if (!chrome.isCurrent(c.href, here)) errs.push(`${rel}: ${name} marks ${c.href} current on ${here}`);
    const expected = RULED.filter(([href]) => chrome.isCurrent(href, here)).length;
    if (current.length !== expected) errs.push(`${rel}: ${name} has ${current.length} aria-current item(s), expected ${expected}`);
  }
  const actions = (h.match(/<div class="pnp-actions">([\s\S]*?)<\/div>/) || [])[1] || '';
  const act = links(actions);
  if (!(act.length === 2 && act[0].href === FORM && !newTab(act[0].attrs) && act[0].label === 'Book online' && act[1].href === TEL && act[1].label === 'Call or text 901-355-1518')) errs.push(`${rel}: header actions are not [Book online (${FORM}, same tab), Call or text 901-355-1518 (tel:)]`);
  const panel = (h.match(/<div class="pnp-panel" id="site-menu">([\s\S]*?)<\/div>/) || [])[1];
  if (!panel) errs.push(`${rel}: no mobile panel #site-menu`);
  else {
    const after = links(panel.replace(/<nav[\s\S]*?<\/nav>/, ''));
    if (!after.some((l) => l.href === FORM && !newTab(l.attrs) && l.label === 'Book online')) errs.push(`${rel}: mobile panel lacks Book online opening ${FORM}`);
    if (!after.some((l) => l.href === TEL && l.label === 'Call or text 901-355-1518')) errs.push(`${rel}: mobile panel lacks the phone line`);
  }
  // Owner ruling 2026-10-21: Book online is visible on phones too, in the header row itself.
  {
    const row = (h.match(/<div class="pnp-header-inner">([\s\S]*?)<div class="pnp-panel"/) || [])[1] || '';
    const phone = links(row.replace(/<nav[\s\S]*?<\/nav>/, '').replace(/<div class="pnp-actions">[\s\S]*?<\/div>/, '')).filter((l) => l.href === FORM && l.label === 'Book online' && /class="pnp-book-m"/.test(l.attrs));
    if (phone.length !== 1) errs.push(`${rel}: header row has ${phone.length} phone-width Book online button(s), want exactly 1`);
  }
  if (!/<button type="button" class="pnp-toggle" aria-expanded="false" aria-controls="site-menu"/.test(h)) errs.push(`${rel}: hamburger <button> lacks aria-expanded/aria-controls`);
  if (!/<a href="#site-menu" class="pnp-toggle"/.test(h)) errs.push(`${rel}: no no-JS :target fallback for the menu`);
  if (/Party Planning/.test(h) || h.includes(`href="${PLANNER}"`)) errs.push(`${rel}: header still carries Party Planning`);
  // Every link on the page, not only the header: /contact is linked only as
  // "Contact"; any other label there is a quote CTA that must open the form.
  for (const l of links(html)) {
    if (CONTACT_RE.test(l.href || '') && l.label !== 'Contact') errs.push(`${rel}: "${l.label}" links ${l.href} - quote CTAs open ${FORM} directly (owner ruling 2026-10-15)`);
    if (isForm(l.href) && newTab(l.attrs)) errs.push(`${rel}: "${l.label}" opens the request form in a new tab (it is the site's own page)`);
    if (RETIRED.test(l.href || '')) errs.push(`${rel}: "${l.label}" links the retired Google Form (${l.href}); every quote link goes to ${FORM}`);
  }
  if (RETIRED.test(html)) errs.push(`${rel}: the retired Google Form address appears on the page`);
  const head = html.slice(0, html.indexOf('</head>'));
  if (!head.includes(`href="${chrome.CSS_HREF}"`)) errs.push(`${rel}: <head> does not link ${chrome.CSS_HREF}`);
  if (!/fonts\.googleapis\.com\/css2\?family=Cormorant/.test(head)) errs.push(`${rel}: <head> does not load the site fonts (Inter, Cormorant Garamond, Great Vibes)`);
  const ex = chrome.EXPLORE_RE.exec(html);
  if (!ex) errs.push(`${rel}: footer has no Explore list`);
  else {
    const r = links(ex[2]).filter((l) => l.href === '/rentals/');
    if (r.length !== 1 || !r[0].attrs.includes(chrome.MARK.footerRentals)) errs.push(`${rel}: footer Explore list has ${r.length} canonical Rentals link(s), want 1`);
    const fq = links(ex[2]).filter((l) => /^\/faq\/?(?:index\.html)?$/.test(l.href || ''));
    if (fq.length !== 1 || !fq[0].attrs.includes(chrome.MARK.footerFaq) || fq[0].label !== 'FAQ') errs.push(`${rel}: footer Explore list has ${fq.length} FAQ link(s), want exactly one labelled FAQ (owner ruling 2026-10-17)`);
  }
  return errs;
}

const errors = [];
// ---- self-test: three broken pages must fail
const sample = fs.readFileSync(path.join(ROOT, 'pricing.html'), 'utf8');
const broken = {
  'nav without Rentals': sample.replace(/(<nav class="site-nav[^>]*>[\s\S]*?)<a href="\/rentals\/">Rentals<\/a>/, '$1'),
  'Party Planning back in the nav': sample.replace(/(<nav class="site-nav[^>]*>)/, `$1<a href="${PLANNER}">Party Planning</a>`),
  'footer without Rentals': sample.replace(chrome.RENTALS_FOOTER, ''),
  'footer without FAQ': sample.replace(chrome.FAQ_FOOTER, ''),
  'nav without FAQ': sample.replace(/(<nav class="site-nav[^>]*>[\s\S]*?)<a href="\/faq\/">FAQ<\/a>/, '$1'),
  'header quote back on /contact': sample.replace(`<a href="${FORM}" class="btn-primary pnp-quote">`, '<a href="/contact" class="btn-primary pnp-quote">'),
  'an in-body quote CTA on /contact': sample.replace('</main>', '<a href="/contact.html" class="btn-primary">Request a Quote</a></main>'),
  'a link to the retired Google Form': sample.replace('</main>', '<a href="https://forms.gle/vHjfKtRRAnGV3HxFA" class="btn-primary">Check My Date</a></main>'),
  'no phone-width Book online': sample.replace(`<a href="${FORM}" class="pnp-book-m">Book online</a>`, ''),
  'the request form opening a new tab': sample.replace('</main>', `<a href="${FORM}" class="btn-primary" target="_blank" rel="noopener">Request a Quote</a></main>`)
};
for (const [what, html] of Object.entries(broken)) {
  if (html === sample) errors.push(`self-test: could not build the "${what}" fixture (pricing.html shape changed)`);
  else if (!checkPage(html, 'pricing.html').length) errors.push(`self-test: a page with ${what} PASSED`);
}

// ---- every published page
if (!fs.existsSync(path.join(ROOT, chrome.CSS_HREF.replace(/^\//, '')))) errors.push(`${chrome.CSS_HREF} does not exist`);
else {
  // The phone-width Book online button is shown below 1024px and hidden only from 1024px up.
  const css = fs.readFileSync(path.join(ROOT, chrome.CSS_HREF.replace(/^\//, '')), 'utf8');
  const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '');
  if (!/\.pnp-header \.pnp-book-m \{[^}]*display: inline-flex/.test(base)) errors.push(`${chrome.CSS_HREF}: .pnp-book-m is not displayed at phone width (owner ruling 2026-10-21)`);
  if (/\.pnp-book-m[^{]*\{[^}]*display: none/.test(base)) errors.push(`${chrome.CSS_HREF}: .pnp-book-m is hidden outside a desktop media query`);
}
const pages = publishedPages();
if (!pages.length) errors.push('found 0 published pages');
for (const rel of pages) errors.push(...checkPage(fs.readFileSync(path.join(ROOT, rel), 'utf8'), rel));

if (errors.length) {
  console.error(`site-chrome: FAIL (${errors.length})`);
  errors.slice(0, 25).forEach((e) => console.error(`  - ${e}`));
  console.error('  repair: npm run chrome:install');
  process.exit(1);
}
console.log(`site-chrome: OK - ${pages.length} pages carry the identical header (${RULED.map((r) => r[1]).join(' · ')} + Book online -> ${FORM} (phone width too) + Call or text), the mobile menu, ${chrome.CSS_HREF}, and the footer Rentals link; no quote CTA links /contact, every form link opens in a new tab; self-test rejected ${Object.keys(broken).length} broken fixtures`);
