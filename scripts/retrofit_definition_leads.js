#!/usr/bin/env node
'use strict';
/**
 * The definition lead, installed into the pages that have no generator.
 *
 * WHY
 * ---
 * Her Search Readiness Checklist item b4 (a 40-60 word "X is ..." definition
 * under the h1) and item d1 (the answer to the page's own question inside the
 * first 100 words). The weekly quality sample on 3 Nov 2026 failed 87 of the 99
 * published pages on b4 and named it on all five pages it sampled - 25, 28, 28,
 * 38 and 50 words, each of them naming services rather than defining one.
 *
 * WHY A DATA FILE AND NOT A GENERATOR
 * -----------------------------------
 * Every page a generator renders was fixed in that generator: the 52 city x
 * service pages in build_area_pages.js, the 12 place pages in
 * build_place_pages.js, the two focused pages in lib/focus_pages.js. These
 * fifteen are the ones data/content/page_admission_registry.json records as
 * `source: legacy_public_authority_baseline` - published by the April and May
 * 2026 baseline, frozen, and re-rendered by nothing in this repository. For them
 * the page IS the source, so the lead is authored once per page in
 * data/content/definition_leads.json and installed here, which is the same
 * shape scripts/retrofit_thin_pages.js and scripts/retrofit_answer_cards.js
 * already use on these same pages.
 *
 * NO PRICE IS TYPED IN THE DATA FILE. A lead names a price with a token
 * ({celebFrom}, {grazeFrom}, {fallFrom}, {christmasFrom}, {porchFrom},
 * {rentalDay}, {rentalWeekend}) resolved here from data/offers/services.json,
 * data/offers/porch_packages.json and data/rentals/games.json - the only places
 * prices live (CLAUDE.md). A price that moves in the data moves on the next
 * build and cannot drift out of a page.
 *
 * WHAT IT WRITES
 * --------------
 * Authored definitions replace the old opening copy; repeated template text is
 * removed, headings become reader questions, and published business terms are
 * linked as sources. Prices resolve from the existing offer data. There is no
 * blocking wording validator. Missing files or an empty source are errors.
 *
 * Runs in build:finish, before install_page_dates. Copy is authored here; no blocking wording validator.
 *
 *   node scripts/retrofit_definition_leads.js [--check]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHAPE = require(path.join(ROOT, 'scripts/lib/page_shape.js'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const PK = require(path.join(ROOT, 'data/offers/porch_packages.json'));
const INV = require(path.join(ROOT, 'scripts/lib/inventory.js'));
const RENTALS = INV.resolve(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rentals/games.json'), 'utf8')));
const DATA = path.join(ROOT, 'data/content/definition_leads.json');

const HC = require('./lib/hub_consolidation');
const CHECK = process.argv.includes('--check');
const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
const seasonFrom = (short) => {
  const s = PK.seasons.find((x) => (x.short || x.name || '').toLowerCase().startsWith(short));
  if (!s) throw new Error(`data/offers/porch_packages.json has no "${short}" season to price a lead from`);
  return Math.min(...Object.values(s.tiers).map((t) => t.from));
};

/** The only prices a lead may name, each read from the file that owns it. */
function prices() {
  const porchFrom = Math.min(...PK.seasons.flatMap((s) => Object.values(s.tiers).map((t) => t.from)));
  return {
    porchFrom: money(porchFrom),
    fallFrom: money(seasonFrom('fall')),
    christmasFrom: money(seasonFrom('christmas')),
    celebFrom: money(Number(String(offers.services.celebration.price).replace(/[^0-9]/g, ''))),
    grazeFrom: money(Math.min(...offers.services.grazing.tiers.map((t) => t.from))),
    rentalDay: money(RENTALS.rates.day),
    rentalWeekend: money(RENTALS.rates.weekend),
  };
}

function resolve(text, P, rel) {
  return String(text).replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in P)) throw new Error(`${rel}: lead names {${k}}, which is not a price this repo publishes (${Object.keys(P).join(', ')})`);
    return P[k];
  });
}

// The first paragraph under the h1 that is not one of the provenance lines
// (data-page-dates, data-page-byline, scripts/lib/page_provenance.js).
const LEAD_RE = /(<\/h1>\s*)(<p(?![^>]*\bdata-page-)[^>]*>)([\s\S]*?)(<\/p>)/i;

/**
 * A lead entry is a string (a service page: the lead, the shared heading map and
 * the business-sources line) or an object for a page that is not a service page
 * (a legal, contact or utility page), which takes only what it names:
 *   { lead, headings: { "Old h2": "Question?" }, replace: [[oldHtml, newHtml]] }
 * `replace` says a repeated sentence once (the weekly sample's template filler);
 * an old string with a non-empty replacement must be on the page or already replaced.
 */
function entryOf(value) {
  return typeof value === 'string' ? { lead: value, service: true, headings: {}, replace: [] } : { service: false, headings: {}, replace: [], ...value };
}

function applyReplace(html, replace, rel) {
  let out = html;
  for (const [from, to] of replace || []) {
    if (out.includes(from)) out = out.split(from).join(to);
    else if (to && !out.includes(to)) throw new Error(`${rel}: replace target is on neither side of the page: ${from.slice(0, 80)}`);
  }
  return out;
}

function installPlain(html, entry, rel) {
  if (!LEAD_RE.test(html)) throw new Error(`${rel}: no paragraph under the h1 to put the definition in`);
  let out = html.replace(LEAD_RE, (_, afterH1) => `${afterH1}<p>${entry.lead}</p>`);
  out = out.replace(/<h2([^>]*)>([^<]+)<\/h2>/g, (whole, attrs, title) => (entry.headings[title] ? `<h2${attrs}>${entry.headings[title]}</h2>` : whole));
  return applyReplace(out, entry.replace, rel);
}

function install(html, lead, rel) {
  if (typeof lead === 'object' && !lead.service) return installPlain(html, lead, rel);
  if (typeof lead === 'object') return applyReplace(install(html, lead.lead, rel), lead.replace, rel);
  const m = LEAD_RE.exec(html);
  if (!m) throw new Error(`${rel}: no paragraph under the h1 to put the definition in`);
  let out = html.replace(LEAD_RE, (_, afterH1) => `${afterH1}<p>${lead}</p>`);
  out = out.replace(/<p data-definition-kept>[\s\S]*?<\/p>/g, '');
  // Historical boilerplate, repeated above the actual service description.
  out = out.replace(/<p>Porch &amp; Party is a Memphis-based seasonal porch decorating company specializing in front porch styling, holiday porch decorating, and luxury seasonal porch installations\.<\/p>/g, '');
  const headings = {
    'What this page recommends': 'What should you know before booking?',
    'Quick answer': 'What does this service cover?',
    'What this can include': 'What can the setup include?',
    'What is included': 'What is included in the setup?',
    'Starting pricing': 'What is the starting price?',
    'Pricing context': 'What affects the quote?',
    'Service area': 'Where is this service available?',
    'Related pages': 'Where can you find more details?',
    'Common questions': 'What else should you confirm?',
    'Common questions before booking': 'What should you confirm before booking?'
  };
  out = out.replace(/<h2>([^<]+)<\/h2>/g, (whole, title) => headings[title] ? `<h2>${headings[title]}</h2>` : whole);
  if (!out.includes('data-business-sources')) out = out.replace('</main>', '<p class="muted" data-business-sources>Source: <a href="/pricing">Porch &amp; Party published starting prices</a> and <a href="/rules">setup and rental responsibilities</a>. Your request receives a quote for the actual scope.</p></main>');
  return out;
}

function main() {
  const { leads } = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const rels = Object.keys(leads).filter(rel => !HC.isRetiredFile(rel));
  if (!rels.length) {
    console.error(`definition-leads FAILED: data/content/definition_leads.json holds ${rels.length} lead(s). The read is broken, not the site.`);
    process.exit(1);
  }
  const P = prices();
  const written = [];
  const stale = [];
  let checked = 0;
  for (const rel of rels) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      console.error(`definition-leads FAILED: ${rel} is listed but not published`);
      process.exit(1);
    }
    const entry = entryOf(leads[rel]);
    const lead = SHAPE.assertLead(resolve(entry.lead, P, rel), `${rel} lead (data/content/definition_leads.json)`);
    checked += 1;
    const before = fs.readFileSync(abs, 'utf8');
    const after = install(before, { ...entry, lead }, rel);
    if (after === before) continue;
    if (CHECK) { stale.push(rel); continue; }
    fs.writeFileSync(abs, after);
    written.push(rel);
  }
  if (!checked) { console.error('definition-leads FAILED: zero leads measured'); process.exit(1); }
  if (stale.length) {
    console.error(`definition-leads: ${stale.length} page(s) do not carry their lead: ${stale.join(', ')}`);
    console.error('  repair: node scripts/retrofit_definition_leads.js');
    process.exit(1);
  }
  console.log(`definition leads: ${checked} authored lead(s), ${written.length} page(s) written`);
}

module.exports = { install, entryOf, prices, resolve, LEAD_RE };
if (require.main === module) main();
