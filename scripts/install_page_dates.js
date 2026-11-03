#!/usr/bin/env node
'use strict';
/**
 * The page's provenance, shown on the page: who stands behind it (the byline)
 * and when it was published and last updated, the dates taken from the page's
 * own JSON-LD so the two can never disagree.
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
 * THE BYLINE
 * ----------
 * Her Search Readiness Checklist item c6: a named author or reviewer is visible.
 * On 3 Nov 2026 the weekly quality sample failed 86 of the 99 published pages on
 * it, and five of five sampled pages carried "no named author or reviewer is
 * visible" - the single most common defect on the site.
 *
 * The name is the business, not a person. config/entity.json records that the
 * business node carries no founder ("no private names in public files"), and the
 * owner's and the operator's names are not ours to publish; the brain's voice
 * rule signs everything off as Porch & Party. So the byline names the business,
 * links to /about with rel="author" (the page that says who we are), and claims
 * nothing more than the truth: these pages are written and checked here.
 *
 * It goes immediately before </main>, after the page's content and its related
 * links - not next to the h1 - for two reasons: the first paragraph under the h1
 * is the page's direct answer (validate:content-pattern-contract measures it),
 * and the quality sample reads the first 100 words of the body for the answer to
 * the page's own question (item d1), which a byline at the top would push out.
 *
 * Like the date line it carries data-page-byline, so scripts/lib/lastmod_ledger.js
 * strips it before hashing: a line identical on every page is not this page's
 * content and must not move its freshness date.
 *
 * Idempotent: a second run writes nothing; an existing line whose dates moved is
 * rewritten in place. Runs in build:all after the generators and install passes.
 * Guarded by npm run validate:page-dates and npm run validate:page-shape.
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
// The byline itself, and where it goes, are defined once in scripts/lib/page_provenance.js,
// which the generators also read so a re-render puts it back instead of stripping it.
const { installByline } = require(path.join(ROOT, 'scripts/lib/page_provenance.js'));

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
    // No schema date, so no date line - but the byline below still goes on.
    noDate += 1;
  } else {
    const h1 = /<h1[^>]*>[\s\S]*?<\/h1>/i.exec(html);
    if (!h1) {
      problems.push(`${rel}: states a schema date but has no <h1> to put the date line after`);
    } else {
      const afterH1 = h1.index + h1[0].length;
      // after the lead paragraph, if the h1 is immediately followed by one
      const lead = /^\s*<p[^>]*>[\s\S]*?<\/p>/i.exec(html.slice(afterH1));
      const at = afterH1 + (lead ? lead[0].length : 0);
      html = html.slice(0, at) + line + html.slice(at);
    }
  }

  // The byline, immediately before </main>: every published page names who
  // stands behind it (checklist item c6).
  const byline = installByline(html);
  html = byline.html;
  if (!byline.ok) problems.push(`${rel}: has no </main> to carry the byline`);

  if (html === before) { current += 1; continue; }
  fs.writeFileSync(abs, html);
  updated += 1;
}

if (problems.length) {
  console.error(`page-dates FAILED: ${problems.length} page(s)`);
  for (const p of problems.slice(0, 30)) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`page provenance: ${files.length} published page(s) checked, ${updated} updated, ${current} already current, ${noDate} state no date`);
