#!/usr/bin/env node
'use strict';
/**
 * Asserts the direct-contact surface on every published page (owner-approved
 * 2026-10-10; see scripts/lib/contact_surface.js for why it exists):
 *
 *   - every page: footer carries the tel: link and the Google Business Profile
 *     link; every page with a site header carries the header call link;
 *   - every page: the footer links the primary route; the header never does
 *     (owner ruling 2026-10-13);
 *   - every LocalBusiness JSON-LD node, nested ones included: telephone,
 *     hasMap = the GBP link, sameAs containing the GBP link;
 *   - contact.html: tel:, sms: and the GBP link in the page body;
 *   - index.html and contact.html link every page in data/ops/priority_pages.json,
 *     and each of those pages exists and carries the tel: link;
 *   - the data itself: the GBP link is the decimal cid of the listing's Maps
 *     feature id, and tel:/sms: carry the same digits as the telephone.
 *   - contact.html: the renter-safety line (owner-approved 2026-10-14, text in
 *     services.json renterSafety) sits right after the quote-form note;
 *   - the takedown add-on (owner-approved 2026-10-14, $75, services.json
 *     addOns.takedown): every page and llms file that quotes porch or event
 *     decor takedown quotes the priced line, the FAQ data carries it, no page
 *     keeps the unpriced "available for an additional fee" wording, and the
 *     rentals page never offers it (rental pickup is included).
 *
 * Hard-fails on zero pages or zero LocalBusiness nodes, so it cannot pass by
 * having checked nothing. Repair: npm run contact:install.
 */
const fs = require('fs');
const path = require('path');
const { CONTACT: C, MARK, PRIORITY_PAGES, BUSINESS_TYPES, PRIMARY_ROUTE } = require('../lib/contact_surface');
const { publishedPages } = require('../install_contact_surface');

const ROOT = path.resolve(__dirname, '../..');
const FEATURE_ID = '0x13f19dc04f9ce33a';
const errors = [];
const fail = (m) => errors.push(m);

const digits = (s) => String(s).replace(/\D/g, '');
const expectedGbp = `https://maps.google.com/?cid=${BigInt(FEATURE_ID).toString()}`;
if (C.googleBusinessProfileUrl !== expectedGbp) fail(`services.json contact.googleBusinessProfileUrl is ${C.googleBusinessProfileUrl}, expected ${expectedGbp} (cid of Maps feature ${FEATURE_ID})`);
if (digits(C.telephone) !== '19013551518') fail(`services.json contact.telephone ${C.telephone} is not +1-901-355-1518`);
for (const k of ['telHref', 'smsHref']) if (digits(C[k]) !== digits(C.telephone)) fail(`services.json contact.${k} ${C[k]} does not match telephone ${C.telephone}`);

const TEL = `href="${C.telHref}"`;
const SMS = `href="${C.smsHref}"`;
const GBP = `href="${C.googleBusinessProfileUrl}"`;

const pages = publishedPages();
if (!pages.length) fail('found 0 published pages');
let lbNodes = 0;

function walk(node, rel) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, rel));
  if (!node || typeof node !== 'object') return;
  if ([].concat(node['@type'] || []).includes('LocalBusiness')) {
    lbNodes += 1;
    if (node.telephone !== C.telephone) fail(`${rel}: LocalBusiness telephone is ${JSON.stringify(node.telephone)}`);
    if (node.hasMap !== C.googleBusinessProfileUrl) fail(`${rel}: LocalBusiness hasMap is ${JSON.stringify(node.hasMap)}`);
    if (![].concat(node.sameAs || []).includes(C.googleBusinessProfileUrl)) fail(`${rel}: LocalBusiness sameAs lacks the Google listing`);
    for (const t of BUSINESS_TYPES) if (![].concat(node.additionalType || []).includes(t)) fail(`${rel}: LocalBusiness additionalType lacks ${t}`);
  }
  Object.values(node).forEach((v) => walk(v, rel));
}

for (const rel of pages) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const footer = html.slice(html.indexOf('<footer'));
  if (html.indexOf('<footer') < 0 || !footer.includes(MARK.footer) || !footer.includes(TEL) || !footer.includes(GBP)) fail(`${rel}: footer lacks the tel: link or the Google listing link`);
  const header = (html.match(/<header[\s\S]*?<\/header>/) || [''])[0];
  if (header && !(header.includes(MARK.header) && header.includes(TEL))) fail(`${rel}: header lacks the call/text link`);
  const routeHref = `href="${PRIMARY_ROUTE.href}"`;
  const siteNav = (html.match(/<nav\b[^>]*class="site-nav[^"]*"[^>]*>[\s\S]*?<\/nav>/) || [''])[0];
  // Owner ruling 2026-10-13: the planner page is a footer link, never a header
  // nav item; the whole header (desktop row and mobile panel) must not carry it.
  if (header && (header.includes(routeHref) || header.includes('data-nav-link="primary-route"'))) fail(`${rel}: header still links ${PRIMARY_ROUTE.href} (Party Planning was removed from the nav 2026-10-13)`);
  if (header && !siteNav) fail(`${rel}: header has no primary site-nav`);
  if (!(footer.includes(MARK.footerRoute) && footer.includes(routeHref))) fail(`${rel}: footer lacks the ${PRIMARY_ROUTE.footerLabel} link`);
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { walk(JSON.parse(m[1]), rel); } catch (e) { fail(`${rel}: unparseable JSON-LD (${e.message})`); }
  }
}
if (!lbNodes) fail('found 0 LocalBusiness JSON-LD nodes');

const read = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), 'utf8') : '');
const contact = read('contact.html');
const main = contact.slice(contact.indexOf('<main'), contact.indexOf('</main>'));
for (const [what, needle] of [['tel:', TEL], ['sms:', SMS], ['Google listing', GBP]]) if (!main.includes(needle)) fail(`contact.html: page body lacks the ${what} link`);

if (!PRIORITY_PAGES.length) fail('data/ops/priority_pages.json lists 0 pages');
for (const p of PRIORITY_PAGES) {
  for (const from of ['index.html', 'contact.html']) if (!read(from).includes(`href="${p.href}"`)) fail(`${from}: no link to priority page ${p.href}`);
  const html = read(`${p.href.replace(/^\//, '')}.html`);
  if (!html) fail(`priority page ${p.href} has no published file`);
  else if (!html.includes(TEL)) fail(`priority page ${p.href} lacks the tel: link`);
}

// Renter-safety line on contact.html, next to the quote form.
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const SAFE = (offers.renterSafety || {}).line || '';
if (!/government photo ID/.test(SAFE) || !/social media link/.test(SAFE)) fail('services.json renterSafety.line does not ask for a government photo ID and a social media link');
{
  const c = read('contact.html') || '';
  const at = c.indexOf(`<p class="muted" ${MARK.safety}>${SAFE}</p>`);
  const form = c.indexOf(`href="${offers.quoteUrl}"`);
  if (at < 0) fail('contact.html lacks the renter-safety line from services.json renterSafety');
  else if (form < 0 || at < form || at - form > 600) fail('contact.html renter-safety line is not next to the quote form link');
}

// Takedown add-on: one price, one line, everywhere it is quoted.
const TD = (offers.addOns || {}).takedown || {};
const TD_PRICE = 75; // owner-approved 2026-10-14 (corrected from $95 the same day); change with services.json, never alone
if (TD.fromPrice !== TD_PRICE || TD.line !== `Takedown starts at $${TD_PRICE}, quoted with your setup.`) fail(`services.json addOns.takedown is not the owner-approved $${TD_PRICE} line`);
if (JSON.stringify(TD.appliesTo) !== JSON.stringify(['porch', 'celebration'])) fail('services.json addOns.takedown.appliesTo is not porch + celebration (rentals include pickup)');
if (offers.services.porch.notes[0] !== TD.line) fail('services.json porch notes[0] is not the takedown line');
const faqTd = require(path.join(ROOT, 'data/faqs/faqs.json')).find((q) => /take-?down/i.test(q.question));
if (!faqTd || !faqTd.answer.includes(TD.line)) fail('data/faqs/faqs.json takedown answer does not quote the takedown line');
const TD_PAGES = ['pricing.html', 'how-it-works.html', 'contact.html', 'index.html', 'terms-and-conditions.html', 'services/index.html',
  'services/porch-decorating.html', 'services/christmas-porch-decorating.html', 'services/fall-porch-decorating.html',
  'services/small-porch-decorating.html', 'services/front-door-styling.html',
  'llms.txt', 'llms-full.txt', 'llms-services.txt', 'llms-answers.txt'];
const TD_QUOTE = new RegExp(`(Takedown starts at|takedown, from|takedown for seasonal porch installs and event decor starts at) \\$${TD_PRICE}\\b`);
for (const rel of TD_PAGES) {
  const t = read(rel);
  if (!t) { fail(`${rel} is missing`); continue; }
  if (!TD_QUOTE.test(t)) fail(`${rel} does not quote takedown from $${TD_PRICE}`);
}
for (const rel of ['pricing.html', 'how-it-works.html']) if (!(read(rel) || '').includes(TD.line)) fail(`${rel} lacks the exact takedown line`);
const UNPRICED = /take-?down (service )?(is )?available for an additional fee|take-?down when quoted separately|take-?down for seasonal porch installs is available/i;
let tdScanned = 0;
for (const rel of [...pages, 'llms.txt', 'llms-full.txt', 'llms-services.txt', 'llms-answers.txt']) {
  const t = read(rel);
  if (!t) continue;
  tdScanned += 1;
  if (UNPRICED.test(t)) fail(`${rel} still quotes takedown without the $${TD_PRICE} price`);
}
if (!tdScanned) fail('takedown scan read 0 files');
if (/takedown starts/i.test(read('rentals/index.html') || '')) fail('rentals/index.html offers the takedown add-on; rental pickup is included');

if (!read(`${PRIMARY_ROUTE.href.replace(/^\//, '')}.html`)) fail(`primary route ${PRIMARY_ROUTE.href} has no published file`);
if (errors.length) {
  console.error(`contact-surface: FAIL (${errors.length})`);
  errors.slice(0, 25).forEach((e) => console.error(`  - ${e}`));
  console.error('  repair: npm run contact:install');
  process.exit(1);
}
console.log(`contact-surface: OK - ${pages.length} pages carry tel: + Google listing + the ${PRIMARY_ROUTE.href} footer link (absent from every header); ${lbNodes} LocalBusiness nodes carry telephone/hasMap/sameAs/additionalType; ${PRIORITY_PAGES.length} priority pages linked from home and contact; renter-safety line on contact; takedown $${TD_PRICE} quoted on ${TD_PAGES.length} surfaces, unpriced wording absent from ${tdScanned} files`);
