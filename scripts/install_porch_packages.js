#!/usr/bin/env node
'use strict';
/**
 * Retrofit pass (owner-approved 18 Oct 2026): stamps the full porch package grid and its
 * Offer / PriceSpecification JSON-LD into every page listed in
 * data/offers/porch_packages.json `pages` (the porch service pages, /pricing and the porch
 * articles) and into every published porch price article listed in `articles`. Markup and
 * schema come only from scripts/lib/porch_packages.js reading that data file, so a price
 * change is one edit there plus this pass.
 *
 *   <!--porch-packages--> ... <!--/porch-packages-->   right before the page's cta-band
 *   <!--porch-articles--> ... <!--/porch-articles-->   right after it: links to the
 *                                                     published porch price articles
 *   <script type="application/ld+json" data-porch-packages>  right before </head>
 *
 * The FAQ porch section (faq/index.html) gets the same article links right after the
 * "Price my porch" calculator.
 *
 * Articles publish one a week through scripts/authority_scale/publish_governed_queue.mjs
 * (the cadence gate); an article not yet published is skipped here only while its publish
 * queue item is still `queued`. The publisher re-runs this pass when it publishes one, so
 * the new article is linked from every porch page the same day.
 *
 * Idempotent (a second run changes nothing). Exits non-zero when a listed page is
 * missing, has no cta-band or </head> to anchor to, or the list is empty, so it can never
 * succeed having done nothing. npm run validate:porch-packages fails when a page is stale.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PP = require('./lib/porch_packages');

const BLOCK_RE = /<!--porch-packages-->[\s\S]*?<!--\/porch-packages-->/;
const LINKS_RE = /<!--porch-articles-->[\s\S]*?<!--\/porch-articles-->/;
const LD_RE = /<script type="application\/ld\+json" data-porch-packages>[\s\S]*?<\/script>/;
const CTA = '<section class="section cta-band">';
const FAQ_REL = 'faq/index.html';

function canonicalOf(html, domain, rel) {
  const m = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"|<link[^>]*href="([^"]+)"[^>]*rel="canonical"/);
  return m ? (m[1] || m[2]) : `${domain}/${rel.replace(/\.html$/, '')}`;
}

/** Put the article-links markers right after `anchor` (or refresh them where they are). */
function stampLinks(html, rel, links, anchor) {
  if (LINKS_RE.test(html)) return html.replace(LINKS_RE, () => links);
  const at = html.indexOf(anchor);
  if (at < 0) throw new Error(`${rel}: nowhere to put the porch article links`);
  return html.slice(0, at + anchor.length) + links + html.slice(at + anchor.length);
}

/**
 * The page with the current block and schema; throws when it has nowhere to put them.
 * With `publishedRels` it also stamps the porch article links after the block.
 */
function applyPorchPackages(html, rel, pk, domain, publishedRels) {
  const block = PP.pageBlockHtml(pk);
  const ld = `<script type="application/ld+json" data-porch-packages>${JSON.stringify(PP.schemaNode(pk, { domain, url: canonicalOf(html, domain, rel) }))}</script>`;
  let out = html;
  if (BLOCK_RE.test(out)) out = out.replace(BLOCK_RE, () => block);
  else if (out.includes(CTA)) out = out.replace(CTA, () => `${block}\n${CTA}`);
  else throw new Error(`${rel}: no "${CTA}" to put the porch packages before`);
  if (LD_RE.test(out)) out = out.replace(LD_RE, () => ld);
  else if (out.includes('</head>')) out = out.replace('</head>', () => `${ld}\n</head>`);
  else throw new Error(`${rel}: no </head> for the porch packages schema`);
  if (publishedRels) out = stampLinks(out, rel, PP.articleLinksHtml(pk, publishedRels, rel), '<!--/porch-packages-->');
  return out;
}

/** faq/index.html with the article links right after the calculator. */
function applyFaqLinks(html, pk, publishedRels) {
  const calc = PP.calculatorHtml(pk);
  if (!html.includes(calc) && !LINKS_RE.test(html)) throw new Error(`${FAQ_REL}: the Price my porch calculator is missing or stale; run the section index generator first`);
  return stampLinks(html, FAQ_REL, PP.articleLinksHtml(pk, publishedRels, FAQ_REL, { wrap: false }), calc);
}

/** Queue status by "folder/slug.html". */
function queueStatus() {
  const q = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/publish_queue/publish_queue.json'), 'utf8'));
  return new Map(q.map((x) => [`${x.folder}/${x.slug}.html`, x.status]));
}

/** Which listed articles are published; throws on one that is neither published nor queued. */
function publishedArticles(pk, root = ROOT) {
  const status = queueStatus();
  const out = [];
  for (const a of pk.articles || []) {
    if (fs.existsSync(path.join(root, a.path))) { out.push(a.path); continue; }
    if (status.get(a.path) !== 'queued') throw new Error(`porch-packages: article ${a.path} is not published and not queued in data/publish_queue/publish_queue.json`);
  }
  return out;
}

/** Every page this pass writes: pk.pages, then each published article not already listed. */
const targetPages = (pk, published) => [...pk.pages, ...published.filter((p) => !pk.pages.includes(p))];

function main() {
  const pk = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/porch_packages.json'), 'utf8'));
  const { domain } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8'));
  if (!Array.isArray(pk.pages) || !pk.pages.length) { console.error('porch-packages: data/offers/porch_packages.json lists no pages'); process.exit(1); }
  const published = publishedArticles(pk);
  const pages = targetPages(pk, published);
  let changed = 0;
  for (const rel of pages) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { console.error(`porch-packages: ${rel} is listed but missing`); process.exit(1); }
    const html = fs.readFileSync(abs, 'utf8');
    const out = applyPorchPackages(html, rel, pk, domain, published);
    if (out !== html) { fs.writeFileSync(abs, out); changed += 1; }
  }
  const faqAbs = path.join(ROOT, FAQ_REL);
  const faq = fs.readFileSync(faqAbs, 'utf8');
  const faqOut = applyFaqLinks(faq, pk, published);
  if (faqOut !== faq) { fs.writeFileSync(faqAbs, faqOut); changed += 1; }
  const queued = (pk.articles || []).length - published.length;
  console.log(`porch-packages: ${pages.length} page(s) + /faq/ checked, ${changed} updated; ${published.length} porch article(s) published and linked, ${queued} still queued under the cadence gate`);
}

if (require.main === module) main();
module.exports = { applyPorchPackages, applyFaqLinks, publishedArticles, targetPages, BLOCK_RE, LINKS_RE, LD_RE, FAQ_REL };
