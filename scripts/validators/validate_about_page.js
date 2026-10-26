#!/usr/bin/env node
'use strict';
/**
 * validate:about-page - /about exists, is published, says who this business is,
 * and the homepage links to it.
 *
 * Checked:
 *   - about.html exists, is in sitemap.xml at /about, and is indexable
 *     (no noindex) - an About page a crawler may not read is not an About page;
 *   - the homepage links to /about, and so does every other published page
 *     (the link lives in the footer Explore list, scripts/lib/site_chrome.js);
 *   - the page names Porch & Party as the publisher and links the Terms and the
 *     Privacy Policy, and links the Google Business Profile and the Facebook
 *     Page, so "who is speaking" is checkable off-site. It must NOT print the
 *     legal entity's name: owner-approved 2026-10-18, Kerseta LLC appears only
 *     in those two documents, and this validator fails if it leaks here;
 *   - it states a starting price for each of the four services and those prices
 *     are the ones in data/offers/services.json and data/rentals/games.json, so
 *     the About page can never quote a stale price;
 *   - it carries no claim this repository has no record of: no review, rating,
 *     star, testimonial, job or client count, years-in-business figure, award,
 *     certification, licence or insurance claim;
 *   - the title and meta description are the ones scripts/install_about_page.js
 *     composes from the data, so a hand edit to either is caught (the rest of
 *     the head is completed by the install passes that run after the generator,
 *     so the file is deliberately NOT compared byte-for-byte to a fresh run).
 *
 * WHY
 * ---
 * Her Search Readiness Checklist item c6: an unnamed page with no About is the
 * last thing an answer engine cites. The 26 Oct 2026 audit found no /about on
 * this site. Rule 0: zero checks run is a hard failure.
 *
 * Usage: node scripts/validators/validate_about_page.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const brand = require(path.join(ROOT, 'scripts/lib/brand.js'));
const DOMAIN = offers.domain;
const REL = 'about.html';

const errors = [];
let checks = 0;
const ok = (cond, msg) => { checks += 1; if (!cond) errors.push(msg); };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

ok(fs.existsSync(path.join(ROOT, REL)), `${REL} does not exist; her checklist item c6 wants a real About page`);
if (errors.length) { console.error(`about-page: ${errors.length} problem(s)\n  - ${errors.join('\n  - ')}`); process.exit(1); }

const html = read(REL);
const plain = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const sitemap = read('sitemap.xml');
ok(sitemap.includes(`<loc>${DOMAIN}/about</loc>`), `sitemap.xml does not publish ${DOMAIN}/about`);
ok(!/content="[^"]*noindex/i.test(html), `${REL} is noindex; an About page a crawler may not read is not an About page`);
ok(html.includes(`<link rel="canonical" href="${DOMAIN}/about" />`), `${REL} has no canonical for ${DOMAIN}/about`);

// the link, on the homepage and on every published page
const linkRe = /<a\b[^>]*href="\/about(?:\.html|\/)?"[^>]*>/;
ok(linkRe.test(read('index.html')), 'the homepage does not link to /about');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
const unlinked = [];
for (const loc of locs) {
  const bare = loc.replace(DOMAIN, '').replace(/^\/|\/$/g, '') || 'index';
  const rel = [`${bare}.html`, `${bare}/index.html`].find((c) => fs.existsSync(path.join(ROOT, c)));
  if (rel && rel !== REL && !linkRe.test(read(rel))) unlinked.push(rel);
}
ok(locs.length > 20, `sitemap advertises ${locs.length} page(s); the read is broken, not the site`);
ok(!unlinked.length, `${unlinked.length} published page(s) do not link to /about (e.g. ${unlinked.slice(0, 5).join(', ')})`);

// who is speaking, checkable off-site
ok(new RegExp(`\\b${offers.brandName.replace('&', '&')}\\b`.replace('&', '&')).test(plain) || plain.includes(offers.brandName),
  `${REL} does not name ${offers.brandName} as the publisher`);
ok(!/\bKerseta\b/i.test(plain), `${REL} prints the legal entity's name; owner-approved 2026-10-18, only the Terms and the Privacy Policy may`);
ok(/href="\/terms-and-conditions"/.test(html), `${REL} does not link the Terms & Conditions, which name the company behind the brand`);
ok(/href="\/privacy-policy"/.test(html), `${REL} does not link the Privacy Policy`);
ok(html.includes(offers.contact.googleBusinessProfileUrl), `${REL} does not link the Google Business Profile`);
ok(html.includes(offers.contact.facebookPageUrl), `${REL} does not link the Facebook Page`);
ok(plain.includes(offers.contact.telephoneDisplay), `${REL} does not show the phone number ${offers.contact.telephoneDisplay}`);

// the prices, from the data
const P = brand.PRICES;
for (const [label, want] of [['porch', `$${P.porch}`], ['party', `$${P.party}`], ['grazing', `$${P.grazing}`], ['game day rate', `$${P.gameDay}`]]) {
  ok(plain.includes(want), `${REL} does not state the ${label} starting price ${want} from the data files`);
}

// nothing the repository has no record of
const BANNED = [
  [/\b\d+\s*(?:star|stars)\b/i, 'a star rating'],
  [/\breviews?\b/i, 'a review claim'],
  [/\btestimonial/i, 'a testimonial'],
  [/\b(?:insured|insurance|fully licensed)\b/i, 'an insurance or licensing claim'],
  [/\b(?:award|awarded|certified|certification|accredited)\b/i, 'an award or certification claim'],
  [/\b\d+\+?\s*(?:years|yrs)\b/i, 'a years-in-business figure'],
  [/\b\d{2,}\+?\s*(?:clients|customers|events|parties|jobs|setups)\b/i, 'a job or client count'],
];
for (const [re, what] of BANNED) ok(!re.test(plain), `${REL} carries ${what}; this repository holds no record of one`);

// the strings the generator owns, so a hand edit to either is caught
const G = require(path.join(ROOT, 'scripts/install_about_page.js'));
ok(html.includes(`<title>${G.TITLE.replace(/&/g, '&amp;')}</title>`), `${REL} <title> is not the generator's "${G.TITLE}"`);
ok(html.includes(`content="${G.DESCRIPTION.replace(/&/g, '&amp;')}"`), `${REL} meta description is not the generator's composed one`);
ok(G.TITLE.length >= 30 && G.TITLE.length <= 65, `the About title is ${G.TITLE.length} characters, must be 30-65`);
ok(G.DESCRIPTION.length >= 120 && G.DESCRIPTION.length <= 160, `the About description is ${G.DESCRIPTION.length} characters, must be 120-160`);

if (!checks) { console.error('ABOUT PAGE FAILED: 0 checks ran.'); process.exit(1); }
if (errors.length) {
  console.error(`about-page: ${errors.length} problem(s) of ${checks} check(s)`);
  for (const e of errors.slice(0, 30)) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`About page OK: ${checks} checks; /about published and indexable, linked from every page, naming ${offers.brandName} as the publisher with the Terms, the Privacy Policy, the Google Business Profile and the Facebook Page linked, the four starting prices from the data, no unsupported claim and no leak of the legal entity's name.`);
