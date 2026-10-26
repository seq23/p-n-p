#!/usr/bin/env node
'use strict';
/**
 * The complete social-card head on every published page: og:site_name, and
 * og:image:width / og:image:height measured from the image file itself.
 *
 * WHY
 * ---
 * Her Search Readiness Checklist item b6 wants og:title, og:description,
 * og:type, og:url, og:site_name, an og:image on our own host with its width and
 * height, and twitter:card summary_large_image on every page. The 26 Oct 2026
 * audit found all 141 published pages missing og:image:width and
 * og:image:height, and 27 of them missing og:site_name: three generators wrote
 * og:image but none of them wrote its size, so every scraper had to fetch the
 * picture to find out how to frame it, and 27 answer pages told the scraper
 * nothing about whose site it was.
 *
 * The width and height are never typed in. scripts/lib/social_image.js reads the
 * file's own header, so the pair cannot drift from the picture; a page whose
 * og:image is not on this host, is not in the repository, or is smaller than a
 * large summary card needs, fails loudly here instead of rendering a thumbnail.
 *
 * Scope: the published set (sitemap.xml). 404.html is deliberately out - it is
 * not in the sitemap, carries no canonical and is never a shared URL.
 *
 * Idempotent: a second run writes nothing. Runs last in build:all, after the
 * generators and the other install passes, so nothing re-renders over it.
 * Guarded by npm run validate:social-tags.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const S = require(path.join(ROOT, 'scripts/lib/social_image.js'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const DOMAIN = offers.domain;
const SITE_NAME = offers.brandName;

const esc = (s) => String(s).replace(/&(?!#?[a-z0-9]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The published set, as rendered files. */
function publishedFiles() {
  const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const out = [];
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const bare = m[1].trim().replace(DOMAIN, '').replace(/^\/|\/$/g, '') || 'index';
    const rel = [`${bare}.html`, `${bare}/index.html`].find((c) => fs.existsSync(path.join(ROOT, c)));
    if (!rel) throw new Error(`sitemap advertises ${m[1]}, which resolves to no file`);
    out.push(rel);
  }
  if (!out.length) throw new Error('sitemap.xml advertises no page; there is nothing to install social tags on');
  return out;
}

/** The content of a meta tag, in either attribute order. */
function meta(html, attr, key) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!new RegExp(`\\b${attr}="${key}"`, 'i').test(tag)) continue;
    const c = /\bcontent="([^"]*)"/i.exec(tag);
    if (c) return c[1];
  }
  return null;
}

const hasMeta = (html, attr, key) => new RegExp(`<meta\\b[^>]*\\b${attr}="${key}"`, 'i').test(html)
  || new RegExp(`<meta\\b[^>]*\\bcontent="[^"]*"[^>]*\\b${attr}="${key}"`, 'i').test(html);

/** The repository path an og:image URL points at, or null when it is off-host. */
function localPath(url) {
  if (!url) return null;
  if (url.startsWith(`${DOMAIN}/`)) return url.slice(DOMAIN.length + 1);
  if (url.startsWith('/')) return url.slice(1);
  return null;
}

/** Put a tag immediately after the og:image tag, so the three stay together. */
function insertAfterOgImage(html, tags) {
  const m = /<meta\b[^>]*\bproperty="og:image"[^>]*>|<meta\b[^>]*\bcontent="[^"]*"[^>]*\bproperty="og:image"[^>]*>/i.exec(html);
  if (!m) return null;
  const at = m.index + m[0].length;
  return html.slice(0, at) + tags + html.slice(at);
}

const files = publishedFiles();
let updated = 0;
let current = 0;
const problems = [];

for (const rel of files) {
  const abs = path.join(ROOT, rel);
  let html = fs.readFileSync(abs, 'utf8');
  const before = html;

  const url = meta(html, 'property', 'og:image');
  const local = localPath(url);
  if (!url) { problems.push(`${rel}: no og:image`); continue; }
  if (!local) { problems.push(`${rel}: og:image ${url} is not on ${DOMAIN}; a share card must not depend on another host`); continue; }
  if (!fs.existsSync(path.join(ROOT, local))) { problems.push(`${rel}: og:image ${url} is not in the repository (${local})`); continue; }

  let size;
  try { size = S.measure(path.join(ROOT, local)); } catch (e) { problems.push(`${rel}: ${e.message}`); continue; }

  // og:image:width / og:image:height - written from the file, corrected if wrong.
  // Height first, then width: each insert goes immediately after the og:image
  // tag, so this leaves them in width-then-height order on the page.
  for (const [key, value] of [['og:image:height', size.height], ['og:image:width', size.width]]) {
    if (hasMeta(html, 'property', key)) {
      html = html.replace(new RegExp(`(<meta\\b[^>]*\\bproperty="${key}"[^>]*\\bcontent=")[^"]*(")`, 'i'), `$1${value}$2`)
                 .replace(new RegExp(`(<meta\\b[^>]*\\bcontent=")[^"]*("[^>]*\\bproperty="${key}")`, 'i'), `$1${value}$2`);
    } else {
      const next = insertAfterOgImage(html, `\n<meta property="${key}" content="${value}" />`);
      if (next === null) { problems.push(`${rel}: og:image present but its tag could not be located to put ${key} after`); break; }
      html = next;
    }
  }

  if (!hasMeta(html, 'property', 'og:site_name')) {
    const next = insertAfterOgImage(html, `\n<meta property="og:site_name" content="${esc(SITE_NAME)}" />`);
    if (next === null) problems.push(`${rel}: could not place og:site_name`);
    else html = next;
  }

  if (html === before) { current += 1; continue; }
  fs.writeFileSync(abs, html);
  updated += 1;
}

if (problems.length) {
  console.error(`social-tags FAILED: ${problems.length} page(s)`);
  for (const p of problems.slice(0, 30)) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`social-tags: ${files.length} published page(s) checked, ${updated} updated, ${current} already current`);
