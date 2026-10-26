#!/usr/bin/env node
'use strict';
/**
 * Every Memphis neighborhood and every local anchor has its page, reachable.
 *
 * WHY
 * ---
 * The owner's Search Readiness Checklist (item j9, 25 Oct 2026) holds a
 * hyperlocal site to its own coverage list: "a hyperlocal site that covers
 * three towns out of fifteen loses every search in the other twelve, and nobody
 * notices because nothing lists the twelve." On 2026-10-26 it reported 32 of 64
 * coverage pages missing on this site. Twenty were service x town. The other
 * twelve were the six Memphis neighborhoods and the six hotel anchors, and
 * nothing in this repository knew they were supposed to exist - the only
 * neighborhood page on the site, /areas/east-memphis-tn-porch-styling, was held
 * in place by a single hardcoded line in build_section_indexes.js.
 *
 * So the list is data (data/service_areas/place_pages.json), the pages are
 * generated from it (scripts/generators/build_place_pages.js), and this fails
 * if the two ever disagree.
 *
 * WHAT IT CHECKS, per place:
 *   - the file exists at the URL shape the coverage manifest expects
 *     (/areas/{slug}-party-decor for a neighborhood, /areas/{slug}-hotel-room-decor
 *     for an anchor);
 *   - it is in sitemap.xml at its served URL, and areas/index.html links it, so
 *     it is reachable by a click and not an orphan;
 *   - the parts the generator owns - title, meta description, canonical, H1 and
 *     the page's own opening text - match a fresh generator run, so a hand edit
 *     or a stale page is caught. NOT byte equality: the post-generation passes
 *     (Clarity, related-pages, icons, chrome, social tags, dates) legitimately
 *     add markup the generator knows nothing about, and a byte comparison would
 *     call every correctly built page broken - the trap documented at length in
 *     scripts/generators/build_pages.js;
 *   - AN ANCHOR PAGE SAYS IT IS NOT AFFILIATED WITH THE HOTEL, and says who
 *     arranges the hotel's permission. A page titled with a hotel's name reads
 *     as a page that hotel endorses unless it says otherwise, and no hotel has
 *     endorsed anything. This is the check with real money behind it.
 *
 * Rule 0: zero places, zero neighborhoods or zero anchors is a hard failure.
 *
 * Self-test: broken copies held in memory (an anchor page with the affiliation
 * sentence removed, one with the permission answer removed) must FAIL.
 *
 * Repair: node scripts/generators/build_place_pages.js, then the post-generation
 * passes (see CLAUDE.md "Working here").
 * Usage: node scripts/validators/validate_place_pages.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const G = require(path.join(ROOT, 'scripts/generators/build_place_pages.js'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));

const errors = [];
let checks = 0;
const ok = (cond, msg) => { checks += 1; if (!cond) errors.push(msg); };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/**
 * What a READER sees. The <script> and <style> bodies are dropped first, not
 * just their tags: a page carries the non-affiliation sentence twice over in its
 * FAQPage JSON-LD, so a check that reads script bodies passes on a page whose
 * visible copy says the opposite. Found by the negative proof of this very
 * validator on 2026-10-26 - stripping the visible sentence left it green.
 */
const plain = (html) => String(html)
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ');
const hrefs = (html) => new Set([...html.matchAll(/<a\b[^>]*?\bhref="([^"]+)"/gi)].map((m) => m[1]));

/** The parts of a place page the generator owns outright. */
const OWNED = Object.freeze([
  ['the <title>', /<title>([\s\S]*?)<\/title>/],
  ['the meta description', /<meta name="description" content="([^"]*)"/],
  ['the canonical', /<link rel="canonical" href="([^"]*)"/],
  ['the H1', /<h1>([\s\S]*?)<\/h1>/]
]);

const { neighborhoods, anchors } = G.places;
if (!neighborhoods.length || !anchors.length) {
  console.error(`PLACE PAGES FAILED: ${neighborhoods.length} neighborhood(s) and ${anchors.length} anchor(s). Zero places covers nothing.`);
  process.exit(1);
}

/** The two sentences an anchor page must carry, in its own words. */
function anchorHonesty(name, text) {
  return [
    { what: 'the non-affiliation sentence', present: text.includes(`Porch & Party is not affiliated with ${name}`) },
    { what: 'that it is not one of the hotel\'s vendors or partners', present: text.includes('is not one of its vendors or partners') },
    { what: 'who arranges the hotel\'s permission', present: /permission to decorate it is yours to arrange with the hotel/i.test(text) || /You do, as the guest whose name the room is in/i.test(text) }
  ];
}

const sitemap = read('sitemap.xml');
const indexLinks = hrefs(read('areas/index.html'));
const fresh = new Map(G.plan().map((x) => [x.rel, x.after]));
let pages = 0;

for (const [kind, list] of [['neighborhood', neighborhoods], ['anchor', anchors]]) {
  for (const place of list) {
    const slug = kind === 'neighborhood' ? `${place.slug}-party-decor` : `${place.slug}-hotel-room-decor`;
    const rel = `areas/${slug}.html`;
    const url = `/areas/${slug}`;
    if (!fs.existsSync(path.join(ROOT, rel))) { ok(false, `${rel}: missing (every ${kind} on the coverage list needs its page)`); continue; }
    pages += 1;
    const html = read(rel);
    const text = plain(html);
    ok(sitemap.includes(`<loc>${offers.domain}${url}</loc>`), `${rel}: not in sitemap.xml as ${offers.domain}${url}`);
    ok(indexLinks.has(url) || indexLinks.has(`${url}.html`), `${rel}: areas/index.html does not link ${url}, so the page is an orphan`);
    ok(hrefs(html).has('/areas/') || hrefs(html).has('/areas/index.html'), `${rel}: no link back to /areas/`);
    const expected = fresh.get(rel);
    if (expected == null) ok(false, `${rel}: the generator plans no such page, so it is an orphan file`);
    else {
      for (const [what, re] of OWNED) {
        const want = (expected.match(re) || [])[1];
        const got = (html.match(re) || [])[1];
        ok(want != null && got === want, `${rel}: ${what} differs from a fresh scripts/generators/build_place_pages.js run`
          + `\n      generator: ${String(want).slice(0, 120)}\n      on disk:   ${String(got).slice(0, 120)}`);
      }
      // The page's own opening paragraph, which is where its subject matter is.
      const intro = (expected.match(/<h1>[\s\S]*?<\/h1>\s*<p>([\s\S]*?)<\/p>/) || [])[1];
      ok(intro != null && html.includes(intro), `${rel}: the opening paragraph is not the generator's`);
    }
    if (kind === 'anchor') {
      for (const h of anchorHonesty(place.name, text)) {
        ok(h.present, `${rel}: missing ${h.what}. A page named after a hotel claims the hotel's blessing unless it says otherwise.`);
      }
    }
  }
}
if (!pages) errors.push('zero place pages examined; the read is broken, not the site.');

// Self-test: each broken copy must fail.
const probeName = anchors[0].name;
const soundText = plain(read(`areas/${anchors[0].slug}-hotel-room-decor.html`));
if (anchorHonesty(probeName, soundText).some((h) => !h.present)) {
  errors.push('self-test: the committed anchor page fails its own honesty rule, so the rule is unreachable.');
}
const probes = {
  'an anchor page without the non-affiliation sentence': soundText.split(`Porch & Party is not affiliated with ${probeName}`).join('X'),
  'an anchor page without the vendor/partner denial': soundText.split('is not one of its vendors or partners').join('X'),
  'an anchor page without the permission answer': soundText
    .split('permission to decorate it is yours to arrange with the hotel').join('X')
    .split('You do, as the guest whose name the room is in').join('X')
};
for (const [label, text] of Object.entries(probes)) {
  if (anchorHonesty(probeName, text).every((h) => h.present)) errors.push(`self-test: "${label}" passed when it should fail`);
}

if (errors.length) {
  console.error(`place-pages: FAIL (${errors.length})`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
console.log(`place-pages: OK - ${neighborhoods.length} Memphis neighborhood + ${anchors.length} local anchor page(s), ${checks} checks: `
  + `each in the sitemap, linked from /areas/, its title, description, canonical, H1 and opening paragraph the generator's own, and every anchor page states it is not `
  + `affiliated with the hotel and who arranges permission; ${Object.keys(probes).length} self-test probes fail as they should`);
