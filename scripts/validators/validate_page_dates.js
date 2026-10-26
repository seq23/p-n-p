#!/usr/bin/env node
'use strict';
/**
 * validate:page-dates - a page that claims a date in its structured data shows
 * that same date to a reader, and shows no date it does not claim.
 *
 * Per published page:
 *   - if its JSON-LD states datePublished or dateModified, the page carries one
 *     <p class="page-dates" data-page-dates> line;
 *   - every <time datetime> in that line is a date the JSON-LD states, and every
 *     date the JSON-LD states appears there (so the visible line can neither
 *     omit a date nor invent one);
 *   - each <time>'s printed text is that same date written out, so the machine
 *     value and the words agree;
 *   - a page with no schema date carries no date line - a freshness claim with
 *     nothing behind it is the defect, not the absence of one;
 *   - the date line never displaces the lead paragraph: on a page whose <h1> is
 *     followed by one, the first <p> after the </h1> is still that paragraph and
 *     not the dates (validate:content-pattern-contract reads it as the page's
 *     direct answer).
 *
 * WHY
 * ---
 * Her Search Readiness Checklist item d4. On 26 Oct 2026, 120 of the 121
 * published pages stating a date in their structured data showed it nowhere a
 * person could see; the audit reads the visible text, and so does an answer
 * engine deciding whether a page is current. The dates themselves come from
 * data/cadence/lastmod_ledger.json through scripts/lib/article_schema.js and
 * only move when the content moved, which is what keeps this honest rather than
 * a timer. Rule 0: zero pages or zero dates examined is a hard failure.
 *
 * Usage: node scripts/validators/validate_page_dates.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DOMAIN = require(path.join(ROOT, 'data/offers/services.json')).domain;
const MIN_PUBLISHED = 20;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const human = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };

const failures = [];
const fail = (m) => failures.push(m);

function schemaDates(html) {
  const out = new Set();
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      for (const k of ['datePublished', 'dateModified']) if (typeof n[k] === 'string') out.add(n[k].slice(0, 10));
      Object.values(n).forEach(walk);
    };
    try { walk(JSON.parse(m[1])); } catch { /* validate:structured-data owns unparseable JSON-LD */ }
  }
  return out;
}

const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

let pages = 0;
let dated = 0;
let datesChecked = 0;

for (const loc of locs) {
  const bare = loc.replace(DOMAIN, '').replace(/^\/|\/$/g, '') || 'index';
  const rel = [`${bare}.html`, `${bare}/index.html`].find((c) => fs.existsSync(path.join(ROOT, c)));
  if (!rel) { fail(`sitemap advertises ${loc}, which resolves to no file`); continue; }
  pages += 1;
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const claimed = schemaDates(html);
  const block = /<p class="page-dates" data-page-dates>([\s\S]*?)<\/p>/.exec(html);

  if (!claimed.size) {
    if (block) fail(`${rel}: shows a date line but its structured data states no date`);
    continue;
  }
  if (!block) { fail(`${rel}: structured data states ${[...claimed].join(', ')} but the page shows no date`); continue; }
  dated += 1;

  // the lead paragraph, not the dates, is still the first <p> under the h1
  const lead = /<h1[^>]*>[\s\S]*?<\/h1>\s*<p[^>]*>/i.exec(html);
  if (lead && /data-page-dates/.test(lead[0])) {
    fail(`${rel}: the date line is the first paragraph under the h1, displacing the page's direct answer`);
  }

  const shown = new Set();
  for (const t of block[1].matchAll(/<time datetime="([^"]+)">([^<]*)<\/time>/g)) {
    const iso = t[1].slice(0, 10);
    shown.add(iso);
    datesChecked += 1;
    if (!claimed.has(iso)) fail(`${rel}: the page shows ${iso}, which its structured data does not state`);
    if (t[2].trim() !== human(iso)) fail(`${rel}: <time datetime="${iso}"> prints "${t[2].trim()}", expected "${human(iso)}"`);
  }
  for (const iso of claimed) if (!shown.has(iso)) fail(`${rel}: structured data states ${iso} but the page does not show it`);
}

if (!locs.length || pages < MIN_PUBLISHED || !dated || !datesChecked) {
  console.error(`PAGE DATES FAILED: examined ${pages} page(s), ${dated} with a date and ${datesChecked} date(s) from ${locs.length} sitemap URL(s). The read is broken, not the site.`);
  process.exit(1);
}

if (failures.length) {
  console.error(`PAGE DATES FAILED: ${failures.length} problem(s) across ${pages} published page(s).`);
  for (const f of failures.slice(0, 40)) console.error(`- ${f}`);
  if (failures.length > 40) console.error(`  ...and ${failures.length - 40} more`);
  process.exit(1);
}

console.log(`Page dates OK: ${pages} published page(s), ${dated} stating a date, ${datesChecked} visible <time> value(s), every one a date its own structured data states.`);
