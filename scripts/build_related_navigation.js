#!/usr/bin/env node
'use strict';
/**
 * A related-pages block on every published page.
 *
 * The defect. Measured over the 109 URLs in sitemap.xml, the median page linked
 * out to 12 internal pages and the weakest linked to 9 - and almost all of those
 * links were the same ones: the header nav, the footer "Explore" list, and the
 * quote CTA. Once those are set aside, most pages linked to nothing that was
 * about the same subject. The property in this estate that measurably earns
 * AI-assistant citations, uscisexam.com, sustains a median of 17 internal links
 * out with no dead ends (local-guides-generator/docs/strategy/cited-property-
 * profile.md), and every property in that comparison sitting at zero citations
 * is one whose pages are barely linked to each other.
 *
 * What this writes. One <nav> per page listing pages that share a topic
 * territory with it, plus the index of its own section. Nothing is invented:
 *
 *   - the topic territories, and the patterns that assign a page to one, are the
 *     ones already used by scripts/authority_scale/build_territory_health.mjs,
 *     now shared through scripts/lib/topics.js;
 *   - every link label is the target page's own <h1>, read out of the published
 *     file, the same convention scripts/generators/build_section_indexes.js
 *     already follows;
 *   - ordering is deterministic - same-subject pages in other sections first,
 *     then the rest of the territory - so a rerun writes byte-identical output.
 *
 * Two constraints the markup obeys.
 *
 * 1. Links are extensionless. Cloudflare Pages answers /foo.html with a 308 to
 *    /foo; verified live against porchandparty901.com. Linking the .html form
 *    would spend a redirect on every one of these links.
 *
 * 2. The block sits inside <nav>, which scripts/lib/lastmod_ledger.js strips
 *    before hashing and scripts/template_share.js strips before counting
 *    shingles. Adding navigation to 109 pages therefore advances no lastmod and
 *    inflates no template-share measurement.
 *
 * A page may only gain links. The pass asserts that per file and aborts rather
 * than write a page that would lose a link target.
 *
 * Usage: node scripts/build_related_navigation.js [--write] [--check]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const topics = require('./lib/topics');

const DOMAIN = 'https://porchandparty901.com';
const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');
const MAX_RELATED = 8;

const MARKER = 'data-nav="related-pages"';
const BLOCK_RE = /<section[^>]+data-nav="related-pages"[\s\S]*?<\/section>/i;
const ANCHOR_RE = /<a\b[^>]*?\bhref="([^"]+)"/gi;

const stripTags = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/&(?!#?[a-z0-9]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The URL Cloudflare Pages serves 200 for: no .html, no /index. */
function servedPath(rel) {
  let p = `/${rel}`.replace(/\.html$/, '');
  if (p.endsWith('/index')) p = p.slice(0, -'/index'.length) || '/';
  return p;
}

function h1Of(rel, html) {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!m) throw new Error(`${rel} has no <h1> to take a link label from`);
  return stripTags(m[1]);
}

function linkTargets(html) {
  const out = new Set();
  let m;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(html))) out.add(m[1]);
  return out;
}

// --- the page set -----------------------------------------------------------
// The sitemap is the published set. A file on disk that the sitemap does not
// name is not a page this site claims to publish, and is left alone.
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const published = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1].replace(DOMAIN, ''))
  .map((p) => (p === '/' ? 'index.html' : p.replace(/^\//, ''))));

// The section directories plus the pages at the repository root - the home
// page, the quote form, pricing, how-it-works and the two policy pages - which
// are published, are in the sitemap, and were the six weakest-linked pages on
// the site.
const rootPages = fs.readdirSync(ROOT)
  .filter((n) => n.endsWith('.html') && published.has(n))
  .sort()
  .map((n) => {
    const html = fs.readFileSync(path.join(ROOT, n), 'utf8');
    return { rel: n, dir: '', html, territories: topics.territoriesFor(topics.classifiableText(n, html)) };
  });

// A page whose own title, heading, description and URL name none of the four
// territories still has a service family recorded for it in the repo -
// "party planner", "event decorator" and "corporate event decor" are all filed
// under Celebration Setups. The three offer families in
// data/offers/services.json are the same three subjects three of the
// territories describe, so that recorded serviceKey is used as the fallback
// classification. It is a fallback, not a merge: a page the patterns do
// classify keeps exactly the territories the patterns give it, so
// data/authority_scale/territory_health.json is unaffected.
const SERVICE_TERRITORY = {
  porch: 'seasonal_porch_decorating',
  celebration: 'party_decor',
  grazing: 'grazing_table_styling'
};
const recordedService = new Map();
for (const entry of require(path.join(ROOT, 'data/queries/query_universe.json'))) {
  recordedService.set(`${entry.folder}/${entry.slug}.html`, entry.serviceKey);
}
for (const card of require(path.join(ROOT, 'data/answers/answers-index.json'))) {
  for (const route of [card.answer_page, card.canonical_page]) {
    if (route) recordedService.set(route.replace(/^\//, ''), card.service_key);
  }
}

const pages = [...topics.classifiedPages(ROOT), ...rootPages]
  .filter((p) => published.has(p.rel))
  .map((p) => {
    let territories = p.territories;
    if (!territories.length) {
      const fallback = SERVICE_TERRITORY[recordedService.get(p.rel)];
      if (fallback) territories = [fallback];
    }
    return {
      rel: p.rel,
      dir: p.dir,
      url: servedPath(p.rel),
      territories,
      title: h1Of(p.rel, p.html),
      slug: path.basename(p.rel, '.html')
    };
  });

const byRel = new Map(pages.map((p) => [p.rel, p]));
const sectionIndex = new Map();
for (const p of pages) if (p.slug === 'index') sectionIndex.set(p.dir, p);

// Section order puts the pages that answer a question ahead of the pages that
// sell a service, because a reader on an answer page is still deciding.
const DIR_RANK = ['answers', 'faq', 'guides', 'comparisons', 'local', 'events',
  'seasonal', 'corporate', 'authority', 'hubs', 'services', 'areas'];
const rank = (dir) => {
  const i = DIR_RANK.indexOf(dir);
  return i === -1 ? DIR_RANK.length : i;
};

/**
 * The pages related to `page`, best first.
 *
 * Same slug in another section is the strongest relation this repo records: the
 * same subject written at a different depth, which is how answers/, local/ and
 * services/ already mirror each other. After that, the rest of the territory.
 */
function relatedTo(page) {
  if (page.slug === 'index') return [];
  const shared = (other) => other.territories.filter((t) => page.territories.includes(t)).length;
  const pool = pages.filter((o) => o.rel !== page.rel && o.slug !== 'index' && shared(o) > 0);
  const sameSubject = pool.filter((o) => o.slug === page.slug);
  const rest = pool.filter((o) => o.slug !== page.slug)
    .sort((a, b) => (shared(b) - shared(a))
      || (rank(a.dir) - rank(b.dir))
      || a.title.localeCompare(b.title));
  const sameSection = rest.filter((o) => o.dir === page.dir);
  const otherSections = rest.filter((o) => o.dir !== page.dir);
  const ordered = [...sameSubject, ...otherSections, ...sameSection];
  const seen = new Set();
  return ordered.filter((o) => !seen.has(o.rel) && seen.add(o.rel)).slice(0, MAX_RELATED);
}

/**
 * Pages with no topic territory - the quote form, pricing, the policy pages -
 * get the site's own structure instead of a topical list. Naming section
 * indexes and the three service families on a policy page is honest navigation;
 * inventing a topical relationship for it would not be.
 */
function structureFor(page) {
  // The six section indexes, the celebration hub and the two authority pages:
  // the site's own entry points, and specifically the ones the header nav and
  // the footer "Explore" list do not already carry. Repeating the three service
  // links that are already in the header would look like nine links and be two.
  const wanted = ['services/index.html', 'answers/index.html', 'areas/index.html',
    'local/index.html', 'events/index.html', 'faq/index.html',
    'hubs/memphis-celebration-setups.html', 'authority/event-decorator-memphis.html',
    'authority/party-planner-memphis.html'];
  return wanted.map((rel) => byRel.get(rel)).filter((p) => p && p.rel !== page.rel);
}

function block(page) {
  const related = relatedTo(page);
  const items = related.length ? related : structureFor(page);
  if (!items.length) return '';

  const heading = related.length
    ? `More on ${topics.TERRITORIES[page.territories[0]].label}`
    : 'More from Porch &amp; Party';
  const parent = sectionIndex.get(page.dir);
  const tail = parent && parent.rel !== page.rel
    ? `<p><a href="${parent.url}">${esc(parent.title)}</a></p>`
    : '';
  const list = items.map((p) => `<li><a href="${p.url}">${esc(p.title)}</a></li>`).join('');

  return `<section class="section section-soft" ${MARKER}><div class="container">`
    + `<nav class="related-pages" aria-label="Related pages"><h2>${heading}</h2>`
    + `<ul>${list}</ul>${tail}</nav></div></section>`;
}

// --- apply ------------------------------------------------------------------
const changed = [];
const problems = [];
let linksAdded = 0;

for (const page of pages) {
  const abs = path.join(ROOT, page.rel);
  const before = fs.readFileSync(abs, 'utf8');
  const html = block(page);
  let after;
  if (BLOCK_RE.test(before)) {
    after = before.replace(BLOCK_RE, () => html);
  } else if (html) {
    after = before.replace(/<\/main>/i, () => `${html}</main>`);
  } else {
    after = before;
  }

  // The baseline is the page with this block removed - the links the page owns
  // rather than the ones a previous run of this script gave it. Comparing
  // against the file as found would freeze the first set of related links that
  // was ever written and refuse every later revision of it.
  const owned = linkTargets(before.replace(BLOCK_RE, ' '));
  const now = linkTargets(after);
  const lost = [...owned].filter((h) => !now.has(h));
  if (lost.length) {
    problems.push(`${page.rel}: would lose ${lost.length} link target(s), first ${lost[0]}`);
    continue;
  }
  linksAdded += now.size - owned.size;
  if (after !== before) {
    changed.push(page.rel);
    if (WRITE) fs.writeFileSync(abs, after, 'utf8');
  }
}

const unclassified = pages.filter((p) => p.slug !== 'index' && !p.territories.length)
  .map((p) => p.rel);

const receipt = {
  status: problems.length ? 'FAIL' : 'PASS',
  written: WRITE,
  published_pages: pages.length,
  files_changed: changed.length,
  new_link_targets: linksAdded,
  pages_without_a_topic_territory: unclassified,
  problems
};
console.log(JSON.stringify(receipt, null, 2));
if (problems.length) process.exit(1);
if (CHECK && changed.length) process.exit(1);
