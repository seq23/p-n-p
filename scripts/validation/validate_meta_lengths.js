#!/usr/bin/env node
'use strict';
/**
 * Every published page has a <title> and a meta description, and no two
 * published pages share either. Every query-universe entry carries both.
 *
 * Character-length bounds (the Search Readiness Checklist b1/b2) are not a
 * build blocker: lengths are copy, set at the generators and data files, and
 * audited by the weekly checklist (test cleanup, 1 Nov 2026). This file keeps
 * the behaviour a crawler punishes: a missing or duplicated title/description.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DOMAIN = 'https://porchandparty901.com';
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
    if (!title.trim()) fail(`${rel}: empty <title>`);
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push(rel);
  }

  const d = metaDescription(html);
  if (d === null) fail(`${rel}: no <meta name="description">`);
  else {
    const desc = decode(d);
    if (!desc.trim()) fail(`${rel}: empty meta description`);
    if (!byDesc.has(desc)) byDesc.set(desc, []);
    byDesc.get(desc).push(rel);
  }
}

for (const [title, rels] of byTitle) if (rels.length > 1) fail(`duplicate title on ${rels.join(', ')}: "${title}"`);
for (const [desc, rels] of byDesc) if (rels.length > 1) fail(`duplicate meta description on ${rels.join(', ')}: "${desc}"`);

// The data source for generated pages, including drafts not yet published.
const universe = require(path.join(ROOT, 'data/queries/query_universe.json'));
for (const e of universe) {
  const qTitle = decode(e.title || '');
  if (!qTitle.trim()) fail(`data/queries/query_universe.json ${e.folder}/${e.slug}: no title`);
  const desc = decode(e.description || '');
  if (!desc.trim()) fail(`data/queries/query_universe.json ${e.folder}/${e.slug}: no description`);
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

console.log(`Meta OK: ${pages} published page(s), every title and meta description present and unique; `
  + `${universe.length} query-universe entr(ies) carry both.`);
