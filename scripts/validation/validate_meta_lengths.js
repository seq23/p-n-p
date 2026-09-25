#!/usr/bin/env node
'use strict';
/**
 * Every published page has a title of at least 30 characters and a meta
 * description of 110-160 characters, and no two published pages share either.
 *
 * WHY
 * ---
 * Bing Webmaster and a live crawl on 2026-09-25 flagged eight published pages
 * with meta descriptions of 57-95 characters (seven /areas/*-porch-decorating
 * city pages and services/baby-shower-decor-memphis). Measured across the whole
 * published set the same day, 22 of 112 pages were outside 110-160: fifteen too
 * short, seven too long enough to be cut off in results. Nothing checked it, so
 * nothing stopped it. Bing's own thresholds flag titles of 3-19 characters and
 * descriptions of 41-98; the bounds here sit above both with room to spare.
 *
 * SOURCES THIS GUARDS
 * -------------------
 * The rendered pages are what a crawler reads, so they are what is measured.
 * The descriptions come from three places, and a failure names the page, so
 * whoever fixes it edits the right one:
 *   - data/queries/query_universe.json (`description`), rendered by
 *     templates/page-shell.js - also checked here directly, including queued
 *     drafts, so a short description fails before it is ever published;
 *   - scripts/generators/build_section_indexes.js (the SECTIONS descriptions);
 *   - the hand-maintained pages under areas/, services/, answers/ and the root,
 *     which no generator writes and whose HTML is their source.
 *
 * Length is counted on the decoded text ("&amp;" is one character), which is
 * what a search engine displays.
 *
 * Rule 0: zero pages, zero titles or zero query-universe entries examined is a
 * hard failure, not a pass on an empty loop.
 *
 * Usage: node scripts/validation/validate_meta_lengths.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DOMAIN = 'https://porchandparty901.com';
const TITLE_MIN = 30;
const DESC_MIN = 110;
const DESC_MAX = 160;
const MIN_PUBLISHED = 20;

const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&(?:mdash|ndash);/g, '-')
  .replace(/\s+/g, ' ').trim();

const failures = [];
const fail = (m) => failures.push(m);

const sitemapPath = path.join(ROOT, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) {
  console.error('META LENGTHS FAILED: sitemap.xml is missing, so there is no published set to check.');
  process.exit(1);
}
const locs = [...fs.readFileSync(sitemapPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1].trim().replace(DOMAIN, '') || '/');

function relFor(p) {
  const bare = (p === '/' ? 'index' : p.replace(/^\/|\/$/g, ''));
  for (const c of [`${bare}.html`, `${bare}/index.html`]) {
    if (fs.existsSync(path.join(ROOT, c))) return c;
  }
  return null;
}

/** The content of <meta name="description">, in either attribute order. */
function metaDescription(html) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!/\bname=["']description["']/i.test(tag)) continue;
    const c = /\bcontent="([^"]*)"/i.exec(tag) || /\bcontent='([^']*)'/i.exec(tag);
    if (c) return c[1];
  }
  return null;
}

const byTitle = new Map();
const byDesc = new Map();
let pages = 0;
let titles = 0;

for (const loc of locs) {
  const rel = relFor(loc);
  if (!rel) { fail(`sitemap advertises ${loc}, which resolves to no file`); continue; }
  pages += 1;
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');

  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!t) fail(`${rel}: no <title>`);
  else {
    titles += 1;
    const title = decode(t[1]);
    if (title.length < TITLE_MIN) fail(`${rel}: title is ${title.length} characters, minimum ${TITLE_MIN}: "${title}"`);
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push(rel);
  }

  const d = metaDescription(html);
  if (d === null) fail(`${rel}: no <meta name="description">`);
  else {
    const desc = decode(d);
    if (desc.length < DESC_MIN || desc.length > DESC_MAX) {
      fail(`${rel}: meta description is ${desc.length} characters, must be ${DESC_MIN}-${DESC_MAX}: "${desc}"`);
    }
    if (!byDesc.has(desc)) byDesc.set(desc, []);
    byDesc.get(desc).push(rel);
  }
}

for (const [title, rels] of byTitle) if (rels.length > 1) fail(`duplicate title on ${rels.join(', ')}: "${title}"`);
for (const [desc, rels] of byDesc) if (rels.length > 1) fail(`duplicate meta description on ${rels.join(', ')}: "${desc}"`);

// The data source for generated pages, including drafts not yet published.
const universe = require(path.join(ROOT, 'data/queries/query_universe.json'));
for (const e of universe) {
  const desc = decode(e.description || '');
  if (desc.length < DESC_MIN || desc.length > DESC_MAX) {
    fail(`data/queries/query_universe.json ${e.folder}/${e.slug}: description is ${desc.length} characters, must be ${DESC_MIN}-${DESC_MAX}`);
  }
}

if (!locs.length || pages < MIN_PUBLISHED || !titles || !universe.length) {
  console.error(`META LENGTHS FAILED: examined ${pages} page(s), ${titles} title(s) and ${universe.length} `
    + `query-universe entr(ies) from ${locs.length} sitemap URL(s). The read is broken, not the site.`);
  process.exit(1);
}

if (failures.length) {
  console.error(`META LENGTHS FAILED: ${failures.length} problem(s) across ${pages} published page(s).`);
  for (const f of failures.slice(0, 50)) console.error(`- ${f}`);
  if (failures.length > 50) console.error(`  ...and ${failures.length - 50} more`);
  process.exit(1);
}

console.log(`Meta lengths OK: ${pages} published page(s), every title >= ${TITLE_MIN} and every meta description `
  + `${DESC_MIN}-${DESC_MAX} characters, all unique; ${universe.length} query-universe description(s) in range.`);
