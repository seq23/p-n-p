#!/usr/bin/env node
'use strict';
/**
 * Structured data is valid schema.org on every published page, and every page
 * that declares itself an article carries a complete Article node.
 *
 * Why (Ahrefs Site Audit, 20 Oct 2026): "Structured data has schema.org
 * validation error" on 122 pages and "Article page missing Article schema" on
 * 25. validator.schema.org named one error, on every page: INVALID_ITEMTYPE
 * "EventPlanner" (the business node's second @type; schema.org has no such type).
 *
 * Hard-fails when, on any published page:
 *   - a JSON-LD block does not parse;
 *   - any @type is not a schema.org type (data/seo/schemaorg_vocab.json, the
 *     vocabulary schema.org itself publishes);
 *   - any property is not a schema.org property, or is not defined for the
 *     node's type or any of its supertypes (what validator.schema.org reports);
 *   - the page says og:type article but has no Article/BlogPosting node, more
 *     than one, or one missing headline (<= 110 chars), description, url equal
 *     to the canonical, image, datePublished/dateModified (YYYY-MM-DD,
 *     published <= modified), or author/publisher other than the #business node.
 * Also fails on zero pages, zero nodes or zero article pages examined.
 */
const fs = require('fs');
const path = require('path');
const { publishedPages } = require('../install_contact_surface');
const A = require('../lib/article_schema');

const ROOT = path.resolve(__dirname, '../..');
const VOCAB = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/seo/schemaorg_vocab.json'), 'utf8'));
const errors = [];
const fail = (m) => errors.push(m);

const ancestors = new Map();
function lineage(t) {
  if (ancestors.has(t)) return ancestors.get(t);
  const out = new Set([t]);
  ancestors.set(t, out);
  for (const p of VOCAB.types[t] || []) for (const x of lineage(p)) out.add(x);
  return out;
}
const strip = (t) => String(t).replace(/^(https?:\/\/schema\.org\/|schema:)/, '');

let nodes = 0;
function check(rel, node, where) {
  if (Array.isArray(node)) { node.forEach((n, i) => check(rel, n, `${where}[${i}]`)); return; }
  if (!node || typeof node !== 'object') return;
  const types = A.typesOf(node).map(strip);
  if (types.length) nodes += 1;
  for (const t of types) if (!VOCAB.types[t]) fail(`${rel}: ${where} @type "${t}" is not a schema.org type`);
  const known = types.filter((t) => VOCAB.types[t]);
  const allowed = new Set(known.flatMap((t) => [...lineage(t)]));
  for (const [k, v] of Object.entries(node)) {
    if (k === '@graph') { check(rel, v, `${where}.@graph`); continue; }
    if (k.startsWith('@')) continue;
    const domains = VOCAB.properties[k];
    if (!domains) fail(`${rel}: ${where} property "${k}" is not a schema.org property`);
    else if (known.length && !domains.some((d) => allowed.has(d))) fail(`${rel}: ${where} property "${k}" is not defined for ${known.join('+')}`);
    check(rel, v, `${where}.${k}`);
  }
}

function collectArticles(node, acc) {
  if (Array.isArray(node)) { node.forEach((n) => collectArticles(n, acc)); return; }
  if (!node || typeof node !== 'object') return;
  if (A.isArticle(node)) acc.push(node);
  Object.values(node).forEach((v) => collectArticles(v, acc));
}

const pages = publishedPages();
if (!pages.length) fail('found 0 published pages');
let articlePages = 0;
for (const rel of pages) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const parsed = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { parsed.push(JSON.parse(m[1])); } catch (e) { fail(`${rel}: unparseable JSON-LD (${e.message})`); }
  }
  parsed.forEach((p, i) => check(rel, p, `block${i}`));
  if (!A.declaresArticle(html)) continue;
  articlePages += 1;
  const arts = [];
  collectArticles(parsed, arts);
  if (arts.length !== 1) { fail(`${rel}: og:type article but ${arts.length} Article node(s) (exactly one required)`); continue; }
  const a = arts[0];
  const canon = A.canonicalOf(html);
  if (!a.headline || String(a.headline).length > A.HEADLINE_MAX) fail(`${rel}: Article headline missing or over ${A.HEADLINE_MAX} chars`);
  if (!a.description) fail(`${rel}: Article has no description`);
  if (!a.image) fail(`${rel}: Article has no image`);
  if (!canon || a.url !== canon) fail(`${rel}: Article url ${a.url} is not the canonical ${canon}`);
  if (!A.DATE.test(String(a.datePublished)) || !A.DATE.test(String(a.dateModified))) fail(`${rel}: Article datePublished/dateModified missing or not YYYY-MM-DD`);
  else if (a.datePublished > a.dateModified) fail(`${rel}: Article datePublished ${a.datePublished} is after dateModified ${a.dateModified}`);
  for (const k of ['author', 'publisher']) if (!a[k] || a[k]['@id'] !== A.BUSINESS_ID) fail(`${rel}: Article ${k} is not {"@id": "${A.BUSINESS_ID}"}`);
}
if (!nodes) fail('found 0 typed JSON-LD nodes');
if (!articlePages) fail('found 0 og:type article pages; the article rule governs nothing');

if (errors.length) {
  console.error(`structured-data: ${errors.length} problem(s)`);
  for (const e of (process.env.STRUCTURED_DATA_ALL ? errors : errors.slice(0, 40))) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`structured-data: ${pages.length} page(s), ${nodes} typed node(s) valid against schema.org ${Object.keys(VOCAB.types).length}-type vocabulary, ${articlePages} article page(s) each with one complete Article`);
