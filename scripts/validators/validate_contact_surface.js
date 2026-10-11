#!/usr/bin/env node
'use strict';
/**
 * Asserts the direct-contact surface on every published page (owner-approved
 * 2026-10-10; see scripts/lib/contact_surface.js for why it exists):
 *
 *   - every page: footer carries the tel: link and the Google Business Profile
 *     link; every page with a site header carries the header call link;
 *   - every LocalBusiness JSON-LD node, nested ones included: telephone,
 *     hasMap = the GBP link, sameAs containing the GBP link;
 *   - contact.html: tel:, sms: and the GBP link in the page body;
 *   - index.html and contact.html link every page in data/ops/priority_pages.json,
 *     and each of those pages exists and carries the tel: link;
 *   - the data itself: the GBP link is the decimal cid of the listing's Maps
 *     feature id, and tel:/sms: carry the same digits as the telephone.
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
  const siteNav = (html.match(/<nav\b[^>]*class="site-nav"[^>]*>[\s\S]*?<\/nav>/) || [''])[0];
  if (header && !(siteNav.includes(MARK.navRoute) && siteNav.includes(routeHref))) fail(`${rel}: primary nav lacks the ${PRIMARY_ROUTE.navLabel} link`);
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

if (!read(`${PRIMARY_ROUTE.href.replace(/^\//, '')}.html`)) fail(`primary route ${PRIMARY_ROUTE.href} has no published file`);
if (errors.length) {
  console.error(`contact-surface: FAIL (${errors.length})`);
  errors.slice(0, 25).forEach((e) => console.error(`  - ${e}`));
  console.error('  repair: npm run contact:install');
  process.exit(1);
}
console.log(`contact-surface: OK - ${pages.length} pages carry tel: + Google listing + the ${PRIMARY_ROUTE.href} nav/footer link; ${lbNodes} LocalBusiness nodes carry telephone/hasMap/sameAs/additionalType; ${PRIORITY_PAGES.length} priority pages linked from home and contact`);
