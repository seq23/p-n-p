#!/usr/bin/env node
'use strict';
/**
 * Memphis neighborhood and local-anchor pages under areas/.
 *
 * WHY
 * ---
 * scripts/generators/build_area_pages.js covers city x service: every town in
 * data/service_areas/areas.json gets one page per service. A hyperlocal site
 * needs two more shapes it cannot express, and the owner's Search Readiness
 * Checklist (item j9, 25 Oct 2026) holds the site to both:
 *
 *   a NEIGHBORHOOD is a part of Memphis, not a town. It has no county of its
 *   own, no state line and no travel question of its own - it is Memphis, which
 *   is on the included list - so the city generator's county, pickup-direction
 *   and travel-fee copy would all be wrong on it.
 *
 *   an ANCHOR is a hotel, where the service is a room setup for someone staying
 *   there. The same copy would be wrong again, and there is an honesty question
 *   a town page never raises: Porch & Party has no partnership, affiliation or
 *   preferred-vendor status with any hotel, and the guest, not Porch & Party,
 *   arranges the hotel's permission. Every anchor page says both, in its own
 *   words and in its own FAQ.
 *
 * On 2026-10-26 the checklist reported 32 of 64 coverage pages missing. Twenty
 * were service x town and were fixed by adding five towns to areas.json. These
 * are the other twelve.
 *
 * NOTHING HERE IS INVENTED. The place list is data/service_areas/place_pages.json
 * (each place's name and where it sits, nothing else); every price, inclusion and
 * note is read from data/offers/services.json through templates/page-shell.js,
 * which renders these exactly as it renders the guides and comparisons.
 *
 * Re-rendering: like build_pages.js, this refuses rather than strip the markup
 * the post-generation passes own (Clarity, related-pages, icons, chrome, the
 * contact block). --force overrides and is greppable.
 *
 * Usage: node scripts/generators/build_place_pages.js [--check] [--force]
 * Guarded by npm run validate:place-pages.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { renderPage } = require(path.join(ROOT, 'templates/page-shell'));
const places = require(path.join(ROOT, 'data/service_areas/place_pages.json'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));

const FORCE = process.argv.includes('--force');
const CHECK = process.argv.includes('--check');
const FOLDER = 'areas';
const CELEB = offers.services.celebration;
const PRESET_FROM = Math.min(...(CELEB.roomSetupPresets || []).map((x) => x.total));
const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
/** The same markers scripts/generators/build_pages.js protects. */
const RETROFIT_MARKERS = [
  { marker: 'data-clarity-loader', wrote: 'scripts/install_clarity.js' },
  { marker: 'data-nav="related-pages"', wrote: 'scripts/build_related_navigation.js' },
  { marker: 'data-retrofit=', wrote: 'scripts/retrofit_*.js' },
  { marker: 'data-contact=', wrote: 'scripts/install_contact_surface.js' },
  { marker: 'data-site-chrome=', wrote: 'scripts/install_site_chrome.js' }
];
/** The cities line every page-shell page carries, from the one source. */
const CITIES = require(path.join(ROOT, 'data/service_areas/areas.json')).areas;

/**
 * Titles and descriptions are bounded, and a long hotel name must not blow the
 * bound. The checklist holds every page to a title of 30-65 characters and a
 * meta description of 120-160 (items b1 and b2, enforced here by
 * scripts/validation/validate_meta_lengths.js), and "The Westin Memphis Beale
 * Street" is 32 characters before the page says anything. So each page offers
 * its wording in preference order, longest first, and takes the first that
 * fits. Nothing is silently truncated mid-word, and nothing out of range gets
 * through: no candidate fitting is a hard failure naming the page.
 */
const TITLE = { min: 30, max: 65 };
const DESC = { min: 120, max: 160 };
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
function fit(what, slug, bounds, candidates) {
  const hit = candidates.find((c) => {
    const n = decode(c).length;
    return n >= bounds.min && n <= bounds.max;
  });
  if (!hit) {
    const sizes = candidates.map((c) => decode(c).length).join(', ');
    throw new Error(`${slug}: no ${what} fits ${bounds.min}-${bounds.max} characters (candidates measured ${sizes}). `
      + 'Add a shorter wording to scripts/generators/build_place_pages.js rather than letting one out of range through.');
  }
  return hit;
}

/** A Memphis neighborhood: party decor, inside the city, no travel question. */
function neighborhoodEntry(n) {
  return {
    slug: `${n.slug}-party-decor`,
    folder: FOLDER,
    serviceKey: 'celebration',
    eyebrow: 'Party Decor',
    title: fit('title', `${n.slug}-party-decor`, TITLE, [
      `${n.name} Party Decor, Memphis | Porch & Party`,
      `${n.name} Party Decor | Porch & Party`,
      `Party Decor in ${n.name} | Porch & Party`
    ]),
    h1: `Party decor and celebration setups in ${n.name}, Memphis`,
    description: fit('description', `${n.slug}-party-decor`, DESC, [
      `Party decor in ${n.name}, Memphis: birthday, shower, anniversary and home celebration setups from ${money(PRESET_FROM)}, styled on site, quoted before anything is booked.`,
      `Party decor in ${n.name}, Memphis: birthday, shower and anniversary setups from ${money(PRESET_FROM)}, styled on site and quoted before anything is booked.`,
      `Party decor in ${n.name}, Memphis: birthday and celebration setups from ${money(PRESET_FROM)}, styled on site and quoted up front.`
    ]),
    intro: `${n.name} is ${n.where}. Porch & Party styles celebrations there the same way it does anywhere in Memphis: birthdays, showers, anniversaries, surprise setups and home celebrations, built on site and left ready.`,
    quickAnswer: `${n.name} is part of Memphis, so it is on the included service area and there is no travel fee. Setups start at ${money(PRESET_FROM)} and are quoted on the date, the occasion and how much of the room is being styled.`,
    forWho: `This page is for ${n.name} hosts who want a celebration set up for them rather than assembled on the day.`,
    includes: CELEB.includes.concat([`Setup at a ${n.name} address, inside Memphis, with no travel fee`]),
    practical: `What changes the price is the size of the setup and how much of the room is styled, not which part of Memphis it is in. ${CELEB.notes[0]}`,
    authority: `This page exists because ${n.name} is a named part of the Memphis service area and the site publishes one page per place it serves, rather than one Memphis page standing in for all of them.`,
    localContext: `${n.name} is ${n.where}, so a setup there is a drive inside the city from Porch & Party's own base in Memphis.`,
    beforeBook: `Have the date, the occasion, whether it is a home or a rented space, and roughly how much of the room you want styled. ${CELEB.notes[1]}`,
    nextStep: `Use the quote form with your ${n.name} address and the date, and the setup is priced against what you actually want styled.`,
    faqQuestion: `Do you set up party decor in ${n.name}?`,
    faqAnswer: `Yes. ${n.name} is part of Memphis, which is on the included list, so there is no travel fee. ${CELEB.notes[1]}`,
    faqs: [
      { q: `Is there a travel fee to ${n.name}?`, a: `No. ${n.name} is inside Memphis, and Memphis is on the included list. ${offers.travel.line}` },
      { q: 'How much does a setup cost?', a: `${(CELEB.roomSetupPresets || []).map((x) => `${x.name} is ${money(x.total)}`).join(', ')}. ${CELEB.notes[0]}` },
      { q: 'Can you style a rented space rather than a home?', a: `Yes. Homes, hotel rooms and rented rooms are all settings this service covers. Permission from whoever owns the space is the host's to arrange.` }
    ],
    cities: CITIES,
    related: ['/services/celebration-setups.html', '/areas/memphis-tn-party-decor.html', '/areas/index.html']
  };
}

/**
 * A local anchor: a hotel room setup for a guest staying there.
 * The two honesty lines are not decoration. A page named after a hotel reads as
 * a page the hotel endorses unless it says otherwise, and no hotel has.
 */
function anchorEntry(a) {
  const NOT_AFFILIATED = `Porch & Party is not affiliated with ${a.name} and is not one of its vendors or partners. The room is booked by you, and permission to decorate it is yours to arrange with the hotel.`;
  return {
    slug: `${a.slug}-hotel-room-decor`,
    folder: FOLDER,
    serviceKey: 'celebration',
    eyebrow: 'Hotel Room Setups',
    title: fit('title', `${a.slug}-hotel-room-decor`, TITLE, [
      `${a.name} Room Decor, Memphis | Porch & Party`,
      `${a.name} Room Decor | Porch & Party`,
      `${a.name} Room Setups | Porch & Party`
    ]),
    h1: `Hotel room decor for guests at ${a.name}`,
    description: fit('description', `${a.slug}-hotel-room-decor`, DESC, [
      `Hotel room setups for ${a.name} guests in Memphis: balloons, petals, LED candle styling and signage from ${money(PRESET_FROM)}, set up before you arrive at the room.`,
      `Hotel room setups for ${a.name} guests: balloons, petals, LED candle styling and signage from ${money(PRESET_FROM)}, set up before you reach the room.`,
      `Room setups for ${a.name} guests in Memphis: balloons, petals, LED candles and signage from ${money(PRESET_FROM)}, ready before you arrive.`
    ]),
    intro: `${a.name} is in ${a.where}. Porch & Party styles guest rooms there for birthdays, anniversaries, proposals and surprises: balloons, a petal walkway, LED candle styling, signage and a styled bed, set up in the room you have booked. ${NOT_AFFILIATED}`,
    quickAnswer: `A room setup at ${a.name} starts at ${money(PRESET_FROM)} and is quoted on the date, the occasion and how much of the room is styled. The hotel is in Memphis, which is on the included list, so there is no travel fee. You book the room and clear the decorating with the hotel; Porch & Party styles it.`,
    forWho: `This page is for guests who have booked, or are about to book, a room at ${a.name} and want it styled before they walk in.`,
    includes: CELEB.includes.concat(['Setup inside the guest room you have booked', 'A finish timed to your check-in rather than to our schedule']),
    practical: `Two things decide whether a hotel setup works: how long the room is available before you need it, and what the hotel allows inside it. ${CELEB.notes[0]}`,
    authority: `This page exists because ${a.name} is a named anchor in this site's Memphis coverage and guests search by the hotel's name, not by "hotel room decor". It makes no claim on the hotel's behalf.`,
    localContext: `${a.name} is in ${a.where}, inside Memphis, so there is no travel fee on a setup there.`,
    beforeBook: `Check with ${a.name} what may be brought into the room and when it can be accessed, then share the date, the room's check-in time and the occasion. ${NOT_AFFILIATED}`,
    nextStep: `Send the date, the occasion and the check-in time through the quote form, and the setup is priced against what you want in the room.`,
    faqQuestion: `Can you decorate a room at ${a.name}?`,
    faqAnswer: `Yes, for a room you have booked, with the hotel's permission. ${NOT_AFFILIATED} ${CELEB.notes[1]}`,
    faqs: [
      { q: `Are you partnered with ${a.name}?`, a: NOT_AFFILIATED },
      { q: 'Who asks the hotel for permission?', a: `You do, as the guest whose name the room is in. Hotels differ on what may be brought in and when a room can be accessed, and the answer is theirs to give, not ours.` },
      { q: 'How much does a hotel room setup cost?', a: `${(CELEB.roomSetupPresets || []).map((x) => `${x.name} is ${money(x.total)}`).join(', ')}. ${CELEB.notes[0]}` },
      { q: 'Is there a travel fee to a downtown Memphis hotel?', a: `No. The hotel is in Memphis, which is on the included list. ${offers.travel.line}` }
    ],
    cities: CITIES,
    related: ['/services/hotel-room-decor-memphis.html', '/services/celebration-setups.html', '/areas/index.html']
  };
}

function plan() {
  const entries = [
    ...places.neighborhoods.map(neighborhoodEntry),
    ...places.anchors.map(anchorEntry)
  ];
  return entries.map((entry) => {
    const rel = `${FOLDER}/${entry.slug}.html`;
    const abs = path.join(ROOT, rel);
    const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    let after = renderPage(entry);
    // Keep the related-pages block the navigation pass wrote, exactly as
    // build_area_pages.js does, so build:all never strips it.
    const related = before && before.match(/<section class="section section-soft" data-nav="related-pages">[\s\S]*?<\/section>/);
    if (related && !after.includes('data-nav="related-pages"')) after = after.replace('</main>', `${related[0]}</main>`);
    return { rel, abs, before, after, entry };
  });
}

function run() {
  const items = plan();
  if (!items.length) {
    console.error('PLACE PAGES FAILED: zero places in data/service_areas/place_pages.json. Zero pages covers nothing.');
    process.exit(1);
  }
  const holes = items.filter((x) => /undefined|\[object Object\]/.test(x.after));
  if (holes.length) {
    console.error(`PLACE PAGES FAILED: ${holes.length} page(s) rendered with an unfilled field:`);
    holes.forEach((h) => console.error(`  - ${h.rel}`));
    process.exit(1);
  }
  const wouldLose = [];
  for (const x of items) {
    if (!x.before) continue;
    const lost = RETROFIT_MARKERS.filter((m) => x.before.includes(m.marker) && !x.after.includes(m.marker));
    if (lost.length) wouldLose.push({ rel: x.rel, lost });
  }
  if (wouldLose.length && !FORCE) {
    console.error(`\nbuild_place_pages.js REFUSED: rendering would strip post-generation markup from ${wouldLose.length} page(s).\n`);
    for (const p of wouldLose) for (const l of p.lost) console.error(`  ${p.rel}  loses <${l.marker}>, written by ${l.wrote}`);
    console.error('\n  Re-run the post-generation passes after rendering (see CLAUDE.md "Working here"),');
    console.error('  or use --force if you mean to drop them. Do not delete this check.\n');
    process.exit(1);
  }
  let written = 0;
  for (const x of items) {
    if (x.before === x.after) continue;
    if (CHECK) { console.error(`would write ${x.rel}`); process.exitCode = 1; continue; }
    fs.mkdirSync(path.dirname(x.abs), { recursive: true });
    fs.writeFileSync(x.abs, x.after);
    written += 1;
  }
  console.log(`place pages: ${places.neighborhoods.length} neighborhood + ${places.anchors.length} anchor page(s), ${written} file(s) written`);
}

module.exports = { plan, neighborhoodEntry, anchorEntry, FOLDER, places };
if (require.main === module) run();
