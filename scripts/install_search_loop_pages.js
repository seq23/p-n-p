#!/usr/bin/env node
'use strict';
/**
 * Fits the shared search engine's pages (seq23/search-loop, owner ruling 1 Nov 2026:
 * new question pages publish straight away) into this site's one-business entity
 * graph. The engine writes a generic Article whose author/publisher is an
 * Organization; every published page here must carry the ONE full business node
 * (validate:business-entity), so a page under the engine's output dir that has
 * none gets the canonical node from scripts/lib/contact_surface.js. The later
 * passes (contact surface, structured data) then unify the Article's
 * author/publisher onto it. Idempotent: a page that already has the node is left
 * alone. The output dir is read from search-loop.config.json, never repeated here.
 *
 * Run by .github/scripts/search_loop_post_build.sh, before `npm run build:sitemap`
 * and `npm run build:finish`.
 */
const fs = require('fs');
const path = require('path');
const { canonicalBusiness, isBusinessNode } = require('./lib/contact_surface');

const ROOT = path.resolve(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'search-loop.config.json'), 'utf8'));
const dir = path.join(ROOT, cfg.output.dir);
const JSONLD = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

// A business node counts only at the top level (a root or an @graph member): the
// Article's author/publisher Organization is rewritten to a bare @id reference by
// scripts/lib/article_schema.js, so it can never be the page's one full node.
function hasBusinessNode(html) {
  for (const m of html.matchAll(JSONLD)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; /* validate:structured-data owns bad JSON */ }
    const roots = [].concat(data).flatMap((r) => (r && Array.isArray(r['@graph']) ? r['@graph'] : [r]));
    if (roots.some((n) => isBusinessNode(n))) return true;
  }
  return false;
}

let pages = 0;
let added = 0;
for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  // index.html is the section index build_section_indexes.js writes, not an engine page.
  if (!name.endsWith('.html') || name === 'index.html') continue;
  const file = path.join(dir, name);
  const html = fs.readFileSync(file, 'utf8');
  pages += 1;
  // The engine's own visible date line gives way to the site's one date line
  // (scripts/install_page_dates.js, data-page-dates), which build:finish inserts
  // from the same structured-data dates; two date lines would disagree in format.
  const own = html.replace(/<p class="page-dates">[\s\S]*?<\/p>/, '');
  if (own !== html) fs.writeFileSync(file, own);
  if (hasBusinessNode(own)) continue;
  if (!own.includes('</head>')) throw new Error(`${cfg.output.dir}/${name}: no </head> to add the business node to`);
  const node = canonicalBusiness({ '@context': 'https://schema.org' });
  fs.writeFileSync(file, own.replace('</head>', `<script type="application/ld+json">${JSON.stringify(node)}</script>\n</head>`));
  added += 1;
}
// Rule 0: this runs only after the engine published, so no page here is a broken read.
if (!pages) { console.error(`NAMED STOP [NO_ENGINE_PAGES] /${cfg.output.dir}/ holds no engine page, yet the engine reported pages published`); process.exit(1); }
console.log(`search-loop pages: ${pages} under /${cfg.output.dir}/, business node added to ${added}`);
