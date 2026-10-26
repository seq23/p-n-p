#!/usr/bin/env node
'use strict';
/**
 * The published and updated dates, shown on the page, taken from the page's own
 * JSON-LD so the two can never disagree.
 *
 * WHY
 * ---
 * Her Search Readiness Checklist item d4: "Published and updated dates visible;
 * content refreshed when the facts change, not on a timer." The 26 Oct 2026
 * audit found 120 of the 121 published pages that state a datePublished or
 * dateModified in their structured data showing that date nowhere a reader or an
 * answer engine could see it. A date only a crawler can read is a freshness
 * claim with nothing behind it; a date on the page is the same claim a person
 * can check.
 *
 * The dates are NEVER invented or advanced here. This pass reads datePublished
 * and dateModified out of the page's existing Article/WebPage JSON-LD - written
 * by scripts/lib/article_schema.js from data/cadence/lastmod_ledger.json, which
 * only moves when the content actually changed - and prints them. A page with no
 * schema date gets no date line, and running this on a timer changes nothing.
 *
 * The line is a <p class="page-dates" data-page-dates> carrying a
 * <time datetime="..."> per date, so the machine-readable value and the printed
 * one are the same string.
 *
 * WHERE IT GOES, AND WHY NOT STRAIGHT AFTER THE h1
 * ------------------------------------------------
 * It goes after the LEAD paragraph - the first <p> under the <h1>. On the
 * answers/ family that paragraph is the record's own direct_answer, the
 * self-contained sentence an engine quotes, and
 * scripts/validators/validate_content_pattern_contract.js measures it by reading
 * the first <p> after the </h1> (leadLength, MIN_LEAD_CHARS). Putting a short
 * date line there instead made 66 answer pages read as having no direct answer.
 * A page with no lead paragraph at all gets the line straight after the </h1>.
 *
 * Idempotent: a second run writes nothing; an existing line whose dates moved is
 * rewritten in place. Runs in build:all after the generators and install passes.
 * Guarded by npm run validate:page-dates.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOMAIN = require(path.join(ROOT, 'data/offers/services.json')).domain;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** "April 29, 2026" from "2026-04-29" - built from the string, never from a local Date. */
function human(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d || m > 12) throw new Error(`${iso} is not a YYYY-MM-DD date`);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

// Matches the block and nothing around it, so replacing it is byte-for-byte idempotent.
const BLOCK_RE = /<p class="page-dates" data-page-dates>[\s\S]*?<\/p>/;

/** datePublished / dateModified as they stand in this page's JSON-LD. */
function schemaDates(html) {
  let published = null;
  let modified = null;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if (typeof n.datePublished === 'string' && !published) published = n.datePublished.slice(0, 10);
      if (typeof n.dateModified === 'string' && !modified) modified = n.dateModified.slice(0, 10);
      Object.values(n).forEach(walk);
    };
    try { walk(JSON.parse(m[1])); } catch { /* validate:structured-data owns unparseable JSON-LD */ }
  }
  return { published, modified };
}

function lineFor({ published, modified }) {
  const parts = [];
  if (published) parts.push(`Published <time datetime="${published}">${human(published)}</time>`);
  if (modified && modified !== published) parts.push(`Updated <time datetime="${modified}">${human(modified)}</time>`);
  else if (modified && !published) parts.push(`Updated <time datetime="${modified}">${human(modified)}</time>`);
  if (!parts.length) return null;
  return `<p class="page-dates" data-page-dates>${parts.join(' &middot; ')}</p>`;
}

function publishedFiles() {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const out = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const bare = m[1].trim().replace(DOMAIN, '').replace(/^\/|\/$/g, '') || 'index';
    const rel = [`${bare}.html`, `${bare}/index.html`].find((c) => fs.existsSync(path.join(ROOT, c)));
    if (!rel) throw new Error(`sitemap advertises ${m[1]}, which resolves to no file`);
    out.push(rel);
  }
  if (!out.length) throw new Error('sitemap.xml advertises no page; there are no dates to install');
  return out;
}

const files = publishedFiles();
let updated = 0;
let current = 0;
let noDate = 0;
const problems = [];

for (const rel of files) {
  const abs = path.join(ROOT, rel);
  let html = fs.readFileSync(abs, 'utf8');
  const before = html;
  const line = lineFor(schemaDates(html));

  // Always strip an existing block and re-insert, so a line whose dates moved OR
  // whose position was wrong is corrected, and a second run is byte-identical.
  html = html.replace(BLOCK_RE, '');
  if (!line) {
    if (html === before) { noDate += 1; continue; }
  } else {
    const h1 = /<h1[^>]*>[\s\S]*?<\/h1>/i.exec(html);
    if (!h1) { problems.push(`${rel}: states a schema date but has no <h1> to put the date line after`); continue; }
    const afterH1 = h1.index + h1[0].length;
    // after the lead paragraph, if the h1 is immediately followed by one
    const lead = /^\s*<p[^>]*>[\s\S]*?<\/p>/i.exec(html.slice(afterH1));
    const at = afterH1 + (lead ? lead[0].length : 0);
    html = html.slice(0, at) + line + html.slice(at);
  }

  if (html === before) { current += 1; continue; }
  fs.writeFileSync(abs, html);
  updated += 1;
}

if (problems.length) {
  console.error(`page-dates FAILED: ${problems.length} page(s)`);
  for (const p of problems.slice(0, 30)) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`page-dates: ${files.length} published page(s) checked, ${updated} updated, ${current} already current, ${noDate} state no date`);
