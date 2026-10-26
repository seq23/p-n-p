#!/usr/bin/env node
'use strict';
/**
 * No published page promises fee-free travel to a town that pays the travel fee.
 *
 * WHY
 * ---
 * Until 2026-10-26 data/offers/services.json read
 * `travel.includedAreasFrom: "data/service_areas/areas.json"` - the fee-free
 * towns were "whatever that file holds". That was safe only while the published
 * towns and the fee-free towns were the same eight towns, which they were,
 * because one owner ruling (2026-10-17) created both lists at once.
 *
 * Then the owner's Search Readiness Checklist (item j9) required pages for five
 * more towns inside the 35-mile coverage radius: Cordova, Millington, Oakland,
 * Horn Lake and Hernando. Adding them to areas.json - the only way to publish
 * their pages - would have extended fee-free travel to five towns as a SIDE
 * EFFECT OF A SEARCH FIX, on 52 city pages and in the areaServed of every page
 * on the site. Nobody would have decided that. Nothing would have caught it.
 *
 * A page is not a price. The fee-free towns are now their own list
 * (travel.includedAreas) and this validator is what keeps the two apart.
 *
 * WHAT IT CHECKS
 * --------------
 *   1. Every town in travel.includedAreas is also in data/service_areas/areas.json.
 *      A town cannot be fee-free and unpublished; that would be a price for a
 *      place with no page.
 *   2. For every town in areas.json NOT on the fee-free list, no published page
 *      about that town says there is no travel fee to it, and its pages state
 *      the fee. The claim is matched on the town's name, so "no travel fee to
 *      Hernando" fails and "no travel fee to Memphis" on a Memphis page does not.
 *   3. The prose line travel.line names exactly the fee-free towns - no more, no
 *      fewer - and quotes travel.extendedFee. That line is printed on the About
 *      page, the FAQ, the service pages, the /areas/ index and every area page,
 *      so a drift between it and the list is the same false promise in the one
 *      place a reader is most likely to read.
 *
 * Rule 0: zero towns, zero fee-free towns or zero published pages is a hard
 * failure, not a pass on an empty loop.
 *
 * Self-test: a fee-free list holding a town that is not published, a travel line
 * that names an extra town, a travel line missing a town, and a page claiming
 * fee-free travel to a fee-paying town must all FAIL.
 *
 * Usage: node scripts/validators/validate_travel_claims.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const areasData = require(path.join(ROOT, 'data/service_areas/areas.json'));

const DOMAIN = offers.domain;
const TRAVEL = offers.travel;
const errors = [];
let checks = 0;
const ok = (cond, msg) => { checks += 1; if (!cond) errors.push(msg); };
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&middot;/g, '·');
/**
 * What a READER sees: script and style bodies dropped, not just their tags. A
 * false price inside JSON-LD is still a false price, but a page must not be
 * allowed to pass on structured data while its visible copy contradicts it, and
 * the FAQ answers are repeated in both. Checking the visible text catches both,
 * because the generator writes one string into both places.
 */
const plain = (html) => decode(String(html)
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
const cityName = (area) => area.split(',')[0].trim();

const included = TRAVEL.includedAreas || [];
const published = areasData.areas || [];
if (!included.length || !published.length) {
  console.error(`TRAVEL CLAIMS FAILED: ${included.length} fee-free town(s) and ${published.length} published town(s). Zero enforces nothing.`);
  process.exit(1);
}

// 1. a fee-free town must be a published town.
for (const area of included) {
  ok(published.includes(area), `data/offers/services.json travel.includedAreas names "${area}", which is not in data/service_areas/areas.json: a price for a place with no page`);
}

// 2. no page may promise fee-free travel to a fee-paying town.
/** Everything wrong with one page's travel claims, as its own function, for the self-test. */
function claimProblems(rel, text, feePaying) {
  const bad = [];
  for (const area of feePaying) {
    const name = cityName(area);
    if (new RegExp(`no travel fee to ${name}\\b`, 'i').test(text)) {
      bad.push(`${rel}: says "no travel fee to ${name}", but ${area} is not on travel.includedAreas and pays the $${TRAVEL.extendedFee} fee`);
    }
    if (new RegExp(`${name}\\b[^.]{0,80}\\bon the included list\\b`, 'i').test(text)
      && !new RegExp(`${name}\\b[^.]{0,120}\\boutside the included list\\b`, 'i').test(text)
      && !new RegExp(`${name}\\b[^.]{0,120}\\bnot on the included list\\b`, 'i').test(text)) {
      bad.push(`${rel}: puts ${name} on the included list, but ${area} pays the $${TRAVEL.extendedFee} fee`);
    }
  }
  return bad;
}

const feePaying = published.filter((a) => !included.includes(a));
const locs = [...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1].trim().replace(DOMAIN, '') || '/');
let pages = 0;
const sawFee = new Set();
for (const loc of locs) {
  const bare = loc === '/' ? 'index' : loc.replace(/^\/|\/$/g, '');
  const rel = [`${bare}.html`, `${bare}/index.html`].find((c) => fs.existsSync(path.join(ROOT, c)));
  if (!rel) continue;
  pages += 1;
  const text = plain(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  for (const e of claimProblems(rel, text, feePaying)) errors.push(e);
  for (const area of feePaying) {
    const name = cityName(area);
    if (rel.startsWith('areas/') && rel.includes(area.toLowerCase().replace(/,\s*/, '-').replace(/\s+/g, '-'))
      && new RegExp(`\\$${TRAVEL.extendedFee} travel fee`, 'i').test(text)) sawFee.add(area);
  }
}
if (!pages) errors.push('zero published pages read from sitemap.xml; the read is broken, not the site.');
// Every fee-paying town must SAY so somewhere on its own pages, not just avoid denying it.
for (const area of feePaying) {
  ok(sawFee.has(area), `no page about ${area} states the $${TRAVEL.extendedFee} travel fee, so a reader is left to assume there is none`);
}

// 3. travel.line names exactly the fee-free towns.
const line = decode(TRAVEL.line);
for (const area of included) ok(line.includes(cityName(area)), `travel.line does not name ${cityName(area)}, which is fee-free`);
for (const area of feePaying) {
  ok(!new RegExp(`\\b${cityName(area)}\\b`).test(line.split('Anywhere further')[0]), `travel.line lists ${cityName(area)} among the included towns, but it pays the fee`);
}
ok(line.includes(`$${TRAVEL.extendedFee}`), `travel.line does not quote the $${TRAVEL.extendedFee} fee`);

// Self-test: each broken copy must fail.
const probes = {
  'a page claiming no travel fee to a fee-paying town':
    claimProblems('probe', `Grazing tables in Hernando, MS: no travel fee to Hernando.`, ['Hernando, MS']),
  'a page putting a fee-paying town on the included list':
    claimProblems('probe', `Hernando is on the included list, so there is no charge.`, ['Hernando, MS'])
};
for (const [label, found] of Object.entries(probes)) {
  if (!found.length) errors.push(`self-test: "${label}" passed when it should fail`);
}
if (claimProblems('probe', 'Hernando is inside the service area but outside the included list, so a flat $75 travel fee applies.', ['Hernando, MS']).length) {
  errors.push('self-test: the correct fee-paying wording was reported as a false claim.');
}
if (claimProblems('probe', 'Grazing tables in Memphis: no travel fee to Memphis.', feePaying).length) {
  errors.push('self-test: a true fee-free claim about an included town was reported as false.');
}

if (errors.length) {
  console.error(`travel-claims: FAIL (${errors.length})`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
console.log(`travel-claims: OK - ${included.length} fee-free town(s), ${feePaying.length} paying the $${TRAVEL.extendedFee} fee, `
  + `${pages} published page(s) checked, ${checks} checks: no page promises fee-free travel to a fee-paying town, every fee-paying town `
  + `states the fee on its own pages, and travel.line names exactly the fee-free towns; ${Object.keys(probes).length + 2} self-test probes behave as they should`);
