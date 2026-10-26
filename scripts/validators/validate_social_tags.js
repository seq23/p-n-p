#!/usr/bin/env node
'use strict';
/**
 * validate:social-tags - every published page carries the full social-card head,
 * and its og:image:width / og:image:height are the image's real pixel size.
 *
 * Checked per page in sitemap.xml:
 *   - og:title, og:description, og:type, og:url, og:site_name, og:image,
 *     og:image:width, og:image:height and twitter:card are all present;
 *   - twitter:card is summary_large_image;
 *   - og:site_name is the brand name from data/offers/services.json;
 *   - og:url is this page's own canonical URL (not another page's);
 *   - og:image is on this site's own host and the file is in the repository;
 *   - og:image:width and og:image:height equal what scripts/lib/social_image.js
 *     measures from that file's header - a typed-in pair that drifted from the
 *     picture fails here;
 *   - og:title equals <title> and og:description equals the meta description, so
 *     a share card can never contradict the search result. The homepage is the
 *     one exception and is pinned harder than the rule: its og:title must be
 *     exactly scripts/install_brand_surfaces.js HOME.socialTitle, the registered
 *     social headline, and nothing else.
 *
 * WHY
 * ---
 * Her Search Readiness Checklist item b6. On 26 Oct 2026 all 141 published pages
 * were missing og:image:width and og:image:height and 27 were missing
 * og:site_name; scripts/install_social_tags.js writes them and this reads them
 * back. Rule 0: zero pages or zero tags examined is a hard failure.
 *
 * Usage: node scripts/validators/validate_social_tags.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const S = require(path.join(ROOT, 'scripts/lib/social_image.js'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));
// The homepage's registered social headline, deliberately different from its
// <title> (which names all four services for the result line).
const HOME_SOCIAL_TITLE = require(path.join(ROOT, 'scripts/install_brand_surfaces.js')).HOME.socialTitle;
const DOMAIN = offers.domain;
const MIN_PUBLISHED = 20;

const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

const failures = [];
const fail = (m) => failures.push(m);

function meta(html, attr, key) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!new RegExp(`\\b${attr}="${key}"`, 'i').test(tag)) continue;
    const c = /\bcontent="([^"]*)"/i.exec(tag);
    if (c) return c[1];
  }
  return null;
}

const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

const REQUIRED = [['og:title', 'property'], ['og:description', 'property'], ['og:type', 'property'],
  ['og:url', 'property'], ['og:site_name', 'property'], ['og:image', 'property'],
  ['og:image:width', 'property'], ['og:image:height', 'property'], ['twitter:card', 'name']];

let pages = 0;
let tags = 0;

for (const loc of locs) {
  const bare = loc.replace(DOMAIN, '').replace(/^\/|\/$/g, '') || 'index';
  const rel = [`${bare}.html`, `${bare}/index.html`].find((c) => fs.existsSync(path.join(ROOT, c)));
  if (!rel) { fail(`sitemap advertises ${loc}, which resolves to no file`); continue; }
  pages += 1;
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');

  const got = {};
  for (const [key, attr] of REQUIRED) {
    const v = meta(html, attr, key);
    if (v === null || v === '') { fail(`${rel}: no ${key}`); continue; }
    got[key] = v;
    tags += 1;
  }
  if (Object.keys(got).length !== REQUIRED.length) continue;

  if (got['twitter:card'] !== 'summary_large_image') fail(`${rel}: twitter:card is "${got['twitter:card']}", must be summary_large_image`);
  if (decode(got['og:site_name']) !== offers.brandName) fail(`${rel}: og:site_name is "${decode(got['og:site_name'])}", must be "${offers.brandName}"`);

  const canonical = /<link\b[^>]*\brel="canonical"[^>]*\bhref="([^"]*)"/i.exec(html);
  if (canonical && got['og:url'] !== canonical[1]) fail(`${rel}: og:url ${got['og:url']} is not this page's canonical ${canonical[1]}`);

  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (rel === 'index.html') {
    if (decode(got['og:title']) !== HOME_SOCIAL_TITLE) fail(`${rel}: og:title is "${decode(got['og:title'])}"; the homepage's social headline is pinned to HOME.socialTitle "${HOME_SOCIAL_TITLE}"`);
  } else if (t && decode(got['og:title']) !== decode(t[1])) {
    fail(`${rel}: og:title and <title> disagree; a share card must not contradict the result line`);
  }
  const d = meta(html, 'name', 'description');
  if (d !== null && decode(got['og:description']) !== decode(d)) fail(`${rel}: og:description and the meta description disagree`);

  const url = got['og:image'];
  const local = url.startsWith(`${DOMAIN}/`) ? url.slice(DOMAIN.length + 1) : (url.startsWith('/') ? url.slice(1) : null);
  if (!local) { fail(`${rel}: og:image ${url} is not on ${DOMAIN}`); continue; }
  if (!fs.existsSync(path.join(ROOT, local))) { fail(`${rel}: og:image ${url} is not in the repository`); continue; }
  let size;
  try { size = S.measure(path.join(ROOT, local)); } catch (e) { fail(`${rel}: ${e.message}`); continue; }
  if (Number(got['og:image:width']) !== size.width || Number(got['og:image:height']) !== size.height) {
    fail(`${rel}: og:image:width/height say ${got['og:image:width']}x${got['og:image:height']} but ${local} is ${size.width}x${size.height}`);
  }
}

if (!locs.length || pages < MIN_PUBLISHED || !tags) {
  console.error(`SOCIAL TAGS FAILED: examined ${pages} page(s) and ${tags} tag(s) from ${locs.length} sitemap URL(s). The read is broken, not the site.`);
  process.exit(1);
}

if (failures.length) {
  console.error(`SOCIAL TAGS FAILED: ${failures.length} problem(s) across ${pages} published page(s).`);
  for (const f of failures.slice(0, 40)) console.error(`- ${f}`);
  if (failures.length > 40) console.error(`  ...and ${failures.length - 40} more`);
  process.exit(1);
}

console.log(`Social tags OK: ${pages} published page(s), ${tags} tag(s); every og:image on ${DOMAIN} with its measured width and height, twitter:card summary_large_image throughout.`);
