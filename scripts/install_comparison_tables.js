#!/usr/bin/env node
'use strict';
/**
 * Stamps the comparison table into every published page whose title says "vs".
 *
 * WHY
 * ---
 * A list or table snippet is extracted from a literal <ol> or <table>, never
 * from prose. The owner's Search Readiness Checklist (item d2, 25 Oct 2026)
 * samples this site every Monday and fails any page whose title contains "vs"
 * or "versus" and whose HTML has no <table>. On 2026-10-26 it reported
 * /answers/party-decor-vs-event-planning-memphis, and a sweep of the whole
 * published set found five such pages, not one:
 *
 *   answers/party-decor-vs-event-planning-memphis.html
 *   answers/diy-vs-hiring-party-decorator.html
 *   answers/balloon-garland-vs-full-birthday-setup.html
 *   comparisons/diy-vs-hiring-party-decorator.html
 *   comparisons/balloon-garland-vs-full-birthday-setup.html
 *
 * Two of those slugs are published twice, once under /answers/ and once under
 * /comparisons/. Writing the table into each file by hand would have put the
 * same comparison in four places free to drift apart, so the tables live in
 * data/content/comparison_tables.json keyed by SLUG and this pass stamps them.
 *
 * WHERE IT RUNS IN THE ORDER
 * --------------------------
 * After the page generator, like install_clarity.js and install_site_chrome.js:
 * two of the five files are rendered from data/queries/query_universe.json and
 * a re-render would strip anything stamped before it. `data-comparison-table`
 * is registered in scripts/generators/build_pages.js RETROFIT_MARKERS, so that
 * generator refuses to revert a page carrying one rather than silently dropping
 * the table.
 *
 * The markup is byte-identical to templates/page-shell.js costTable(), so the
 * sixth comparison page (grazing-table-vs-charcuterie-board, whose table comes
 * from query_universe costTable and is rendered by the generator) and these
 * five look and behave the same. A page that already has a <table> is left
 * exactly as it is - this pass never competes with the generator.
 *
 * Rule 0: a run that stamps nothing AND finds nothing already in place is a
 * hard failure, not a quiet success on an empty loop. Same for a page whose
 * insertion anchor is missing: it exits non-zero naming the file, rather than
 * writing nothing and reporting OK.
 *
 * Usage: node scripts/install_comparison_tables.js
 * Guarded by npm run validate:comparison-tables.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOMAIN = 'https://porchandparty901.com';
const DATA = path.join(ROOT, 'data/content/comparison_tables.json');
/**
 * The table goes immediately before the first of these that the page carries.
 * Three candidates because the published comparison pages are not one shape:
 * the generated /comparisons/ pages and /answers/party-decor-vs-event-planning-
 * memphis end with a call-to-action band, while the two older /answers/ cards go
 * straight from their body to the related-pages block. The footer is the last
 * resort and is on every page, so the table lands after the page's own content
 * and before its navigation, whatever the shape.
 */
const ANCHORS = Object.freeze([
  '<section class="section cta-band">',
  '<section class="section section-soft" data-nav="related-pages">',
  '<footer class="site-footer">'
]);

const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

/** A page is a comparison when its own title says so. Same test the checklist uses. */
const IS_COMPARISON = /\bvs\.?\b|\bversus\b/i;
const titleOf = (html) => decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
const hasTable = (html) => /<table\b/i.test(html);

/**
 * The same markup templates/page-shell.js costTable() produces, wrapped in the
 * section this pass owns so it can be found, re-stamped and validated.
 */
function tableSection(slug, t) {
  const head = t.columns.map((c) => `<th scope="col">${c}</th>`).join('');
  const body = t.rows.map((r) => `<tr>${r.map((cell, i) => (i === 0
    ? `<th scope="row">${cell}</th>`
    : `<td>${cell}</td>`)).join('')}</tr>`).join('');
  const panel = `<div class="info-panel"><h2>${t.title}</h2><div class="table-scroll" style="overflow-x:auto;">`
    + `<table><caption>${t.caption}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
    + (t.note ? `<p class="muted" style="margin-top:16px;">${t.note}</p>` : '')
    + `</div>`;
  return `<section class="section" data-comparison-table="${slug}"><div class="container">${panel}</div></section>`;
}

/**
 * The exact span of the <section data-comparison-table="slug"> block, found by
 * counting nested <section> opens and closes from its start tag.
 */
function ownedSpan(html, slug) {
  const open = `<section class="section" data-comparison-table="${slug}">`;
  const start = html.indexOf(open);
  if (start < 0) return null;
  let depth = 0;
  const re = /<section\b|<\/section>/gi;
  re.lastIndex = start;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].toLowerCase() === '</section>' ? -1 : 1;
    if (depth === 0) return { start, end: m.index + m[0].length };
  }
  return null;
}

/** Every published page, from the sitemap, as { rel, slug, html }. */
function publishedPages() {
  const sitemap = path.join(ROOT, 'sitemap.xml');
  if (!fs.existsSync(sitemap)) throw new Error('sitemap.xml is missing, so there is no published set to stamp.');
  const out = [];
  for (const m of fs.readFileSync(sitemap, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const loc = m[1].trim().replace(DOMAIN, '') || '/';
    const bare = loc === '/' ? 'index' : loc.replace(/^\/|\/$/g, '');
    const rel = [`${bare}.html`, `${bare}/index.html`].find((c) => fs.existsSync(path.join(ROOT, c)));
    if (!rel) continue;
    out.push({ rel, slug: bare.split('/').pop(), html: fs.readFileSync(path.join(ROOT, rel), 'utf8') });
  }
  return out;
}

function run() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const tables = data.tables || {};
  const pages = publishedPages();
  if (!pages.length) throw new Error('zero published pages read from sitemap.xml; the read is broken, not the site.');

  const errors = [];
  const stamped = [];
  const already = [];
  let comparisons = 0;
  const used = new Set();

  for (const p of pages) {
    if (!IS_COMPARISON.test(titleOf(p.html))) continue;
    comparisons += 1;
    const owned = p.html.includes('data-comparison-table=');
    if (hasTable(p.html) && !owned) { already.push(p.rel); continue; }

    const t = tables[p.slug];
    if (!t) { errors.push(`${p.rel}: title says "vs" but data/content/comparison_tables.json has no table for slug "${p.slug}"`); continue; }
    used.add(p.slug);
    const section = tableSection(p.slug, t);

    let html = p.html;
    if (owned) {
      // Re-stamp in place, so a change to the data file reaches every copy.
      // Found by counting nested <section> tags, not by a lazy regex: the block
      // contains a <section>-free panel today, and a regex that assumes that
      // would silently mangle the page the day it does not.
      const span = ownedSpan(html, p.slug);
      if (!span) { errors.push(`${p.rel}: carries data-comparison-table="${p.slug}" but its <section> does not close`); continue; }
      html = html.slice(0, span.start) + section + html.slice(span.end);
    } else {
      const anchor = ANCHORS.find((a) => html.includes(a));
      if (!anchor) { errors.push(`${p.rel}: none of the insertion anchors (${ANCHORS.join(', ')}) is present, so the table has nowhere to go`); continue; }
      html = html.replace(anchor, `${section}${anchor}`);
    }
    // An insert that changes nothing is a broken anchor. A re-stamp that changes
    // nothing is correct: the page already matches the data file. Re-running this
    // pass is byte-identical, which is what build:all depends on.
    if (!owned && html === p.html) { errors.push(`${p.rel}: the insert changed nothing`); continue; }
    if (html !== p.html) fs.writeFileSync(path.join(ROOT, p.rel), html);
    stamped.push(p.rel);
  }

  for (const slug of Object.keys(tables)) {
    if (!used.has(slug)) errors.push(`data/content/comparison_tables.json has a table for "${slug}", which no published comparison page uses`);
  }
  if (!comparisons) errors.push('zero published comparison pages found; the title test is broken, not the site.');
  if (!stamped.length && !already.length) errors.push('nothing stamped and nothing already in place: this pass did nothing.');

  if (errors.length) {
    console.error(`comparison-tables: FAIL (${errors.length})`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log(`comparison-tables: ${stamped.length} page(s) stamped, ${already.length} with a generator-rendered table left alone, `
    + `${comparisons} published comparison page(s) in all`);
}

module.exports = { tableSection, ownedSpan, IS_COMPARISON, titleOf, hasTable, publishedPages, DATA };
if (require.main === module) run();
