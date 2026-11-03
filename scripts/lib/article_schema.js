'use strict';
/**
 * Article structured data for every page that declares itself an article.
 *
 * Why (Ahrefs Site Audit, 20 Oct 2026): "Article page missing Article schema".
 * 120 published pages say <meta property="og:type" content="article">, but
 * only the guides, comparisons and seasonal pages carried an Article node, and
 * those had no datePublished/dateModified. A page that tells social cards it is
 * an article and tells search engines nothing of the kind is the mismatch the
 * audit reports.
 *
 * The rule (one definition, guarded by scripts/validators/validate_structured_data.js):
 * a page with og:type article carries exactly one Article (or BlogPosting)
 * node with headline, description, url (= canonical), mainEntityOfPage, image,
 * datePublished, dateModified, and author + publisher = the one business node
 * (@id https://porchandparty901.com/#business, see scripts/lib/contact_surface.js).
 *
 * Dates are never invented per build:
 *   - datePublished: data/seo/article_published.json (seeded from git; a new
 *     page gets the build date once, then it never moves);
 *   - dateModified: data/cadence/lastmod_ledger.json, the same date the
 *     sitemap publishes, so the two can never disagree. The ledger hashes the
 *     visible text only (<script> stripped), so writing JSON-LD here cannot
 *     move a lastmod.
 * Run by scripts/install_structured_data.js, which `npm run build:sitemap`
 * chains right after the ledger is updated.
 */
const fs = require('fs');
const path = require('path');
const { siteUrlForFile } = require('./site_url');

const ROOT = path.resolve(__dirname, '../..');
const PUBLISHED = path.join(ROOT, 'data/seo/article_published.json');
const LEDGER = path.join(ROOT, 'data/cadence/lastmod_ledger.json');
const BUSINESS_ID = 'https://porchandparty901.com/#business';
const ARTICLE_TYPES = ['Article', 'BlogPosting', 'NewsArticle'];
const HEADLINE_MAX = 110; // Google's documented headline limit.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const JSONLD = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g;

const typesOf = (n) => [].concat((n && n['@type']) || []);
const isArticle = (n) => !!n && typeof n === 'object' && typesOf(n).some((t) => ARTICLE_TYPES.includes(t));

function meta(html, attr, name) {
  const re = new RegExp(`<meta\\s+${attr}="${name}"\\s+content="([^"]*)"`, 'i');
  const m = re.exec(html) || new RegExp(`<meta\\s+content="([^"]*)"\\s+${attr}="${name}"`, 'i').exec(html);
  return m ? decode(m[1]) : '';
}
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const declaresArticle = (html) => meta(html, 'property', 'og:type') === 'article';
// Either attribute order: the shared search engine's pages (questions/) are
// serialised href-first, and a canonical read as '' made every one of them fail.
const canonicalOf = (html) => {
  const tag = /<link\b(?=[^>]*\brel="canonical")[^>]*>/i.exec(html);
  const m = tag && /\bhref="([^"]+)"/i.exec(tag[0]);
  return m ? m[1] : '';
};

function headlineOf(html) {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  let text = h1 ? decode(h1[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
  if (!text) text = meta(html, 'property', 'og:title') || decode((/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '').trim();
  return clampHeadline(text);
}
function clampHeadline(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= HEADLINE_MAX) return t;
  const cut = t.slice(0, HEADLINE_MAX + 1);
  return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : HEADLINE_MAX).replace(/[\s,;:|–-]+$/, '');
}

let publishedCache = null;
function publishedDates() {
  if (!publishedCache) publishedCache = JSON.parse(fs.readFileSync(PUBLISHED, 'utf8'));
  return publishedCache;
}
let ledgerCache = null;
function ledgerDate(url) {
  if (!ledgerCache) ledgerCache = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')).entries || {} : {};
  const e = ledgerCache[url];
  return e && DATE.test(String(e.lastmod)) ? e.lastmod : '';
}
const today = () => new Date().toISOString().slice(0, 10);

/** Dates for one URL. Records a first-seen datePublished (caller persists with savePublished). */
function datesFor(url) {
  const store = publishedDates();
  if (!DATE.test(String(store.dates[url] || ''))) store.dates[url] = ledgerDate(url) || today();
  const published = store.dates[url];
  const lm = ledgerDate(url);
  const modified = lm && lm > published ? lm : published;
  return { datePublished: published, dateModified: modified };
}

function savePublished() {
  if (!publishedCache) return false;
  const sorted = {};
  for (const k of Object.keys(publishedCache.dates).sort()) sorted[k] = publishedCache.dates[k];
  const next = JSON.stringify({ ...publishedCache, dates: sorted }, null, 2) + '\n';
  if (fs.readFileSync(PUBLISHED, 'utf8') === next) return false;
  fs.writeFileSync(PUBLISHED, next);
  return true;
}

/** Build / complete the one Article node for a page. Pure apart from datesFor's first-seen record. */
function articleFields(html, rel, existing = {}) {
  const url = canonicalOf(html) || siteUrlForFile(rel);
  const image = existing.image || meta(html, 'property', 'og:image') || undefined;
  return {
    '@context': 'https://schema.org',
    '@type': typesOf(existing).find((t) => ARTICLE_TYPES.includes(t)) || 'Article',
    ...existing,
    headline: clampHeadline(existing.headline) || headlineOf(html),
    description: existing.description || meta(html, 'name', 'description') || meta(html, 'property', 'og:description'),
    url,
    mainEntityOfPage: url,
    ...(image ? { image } : {}),
    inLanguage: existing.inLanguage || 'en-US',
    author: { '@id': BUSINESS_ID },
    publisher: { '@id': BUSINESS_ID },
    ...datesFor(url),
  };
}

/** Page-level pass. Idempotent. Pages without og:type article are returned unchanged. */
function applyArticleSchema(html, rel) {
  if (!declaresArticle(html)) return html;
  const blocks = [...html.matchAll(JSONLD)];
  let found = false;
  let i = 0;
  let out = html.replace(JSONLD, (whole, open, body, close) => {
    const idx = i++;
    let data;
    try { data = JSON.parse(body); } catch (e) { throw new Error(`${rel}: unparseable JSON-LD block ${idx} (${e.message})`); }
    let touched = false;
    const visit = (n) => {
      if (Array.isArray(n)) return n.map(visit);
      if (!n || typeof n !== 'object') return n;
      if (isArticle(n) && !found) { found = true; touched = true; const { '@context': c, ...rest } = n; const full = articleFields(html, rel, rest); if (!c) delete full['@context']; return full; }
      const o = {};
      for (const [k, v] of Object.entries(n)) o[k] = visit(v);
      return o;
    };
    const next = visit(data);
    if (!touched) return whole;
    const lead = body.match(/^\s*/)[0];
    const trail = body.match(/\s*$/)[0];
    const pretty = /^\{\s*\n(\s+)"/.exec(body.trim());
    return `${open}${lead}${pretty ? JSON.stringify(next, null, pretty[1].length) : JSON.stringify(next)}${trail}${close}`;
  });
  if (!found) {
    const block = `<script type="application/ld+json">${JSON.stringify(articleFields(html, rel))}</script>`;
    const last = blocks[blocks.length - 1];
    if (last) {
      // Directly after the last existing JSON-LD block, so head order stays stable.
      const at = out.indexOf(last[0]) + last[0].length;
      out = out.slice(0, at) + '\n' + block + out.slice(at);
    } else {
      const head = out.indexOf('</head>');
      if (head < 0) throw new Error(`${rel}: no </head> to carry the Article JSON-LD`);
      out = out.slice(0, head) + block + '\n' + out.slice(head);
    }
  }
  return out;
}

// The page's own node, never its FAQ: scripts/install_service_pages.js rewrites
// the FAQPage block from the owner-approved /faq/ answers on every run, so a date
// stamped there is erased on the next install and validate:service-pages reads the
// page as drifted from a fresh install.
const PAGE_TYPES = ['WebPage', 'CollectionPage', 'AboutPage', 'ItemPage', 'ProfilePage'];
const isPageNode = (n) => !!n && typeof n === 'object' && typesOf(n).some((t) => PAGE_TYPES.includes(t));

/** Every datePublished / dateModified this page already claims, anywhere in its JSON-LD. */
function claimedDates(html) {
  const out = new Set();
  for (const m of html.matchAll(JSONLD)) {
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      for (const k of ['datePublished', 'dateModified']) if (typeof n[k] === 'string') out.add(n[k].slice(0, 10));
      Object.values(n).forEach(walk);
    };
    try { walk(JSON.parse(m[2])); } catch { /* validate:structured-data owns unparseable JSON-LD */ }
  }
  return out;
}

/**
 * Dates for a page that is not an article.
 *
 * WHY: checklist item d4 wants a visible published/updated date on every content
 * page, and scripts/install_page_dates.js prints only dates the page's own
 * structured data states - so a page with no Article node showed no date at all.
 * On 3 Nov 2026 that was 18 of the 99 published pages (/pricing, /about,
 * /how-it-works, /services/, /rentals/ and the two focus pages among them).
 * Those pages are not articles and must not pretend to be; a WebPage,
 * CollectionPage or AboutPage node carries datePublished and dateModified in
 * schema.org just as an Article does, so the date goes there.
 *
 * The dates are the same two this module gives an article - datePublished from
 * data/seo/article_published.json (first seen, then never moved) and
 * dateModified from data/cadence/lastmod_ledger.json - so nothing is invented
 * and a build on a timer moves neither. A page that already claims a date is
 * returned untouched, and so is one with no WebPage-family node to date.
 * Idempotent.
 */
function applyPageDates(html, rel) {
  if (declaresArticle(html)) return html;
  if (claimedDates(html).size) return html;
  const url = canonicalOf(html) || siteUrlForFile(rel);
  const dates = datesFor(url);
  let done = false;
  const out = html.replace(JSONLD, (whole, open, body, close) => {
    if (done) return whole;
    let data;
    try { data = JSON.parse(body); } catch (e) { throw new Error(`${rel}: unparseable JSON-LD block (${e.message})`); }
    let touched = false;
    const visit = (n) => {
      if (Array.isArray(n)) return n.map(visit);
      if (!n || typeof n !== 'object') return n;
      if (isPageNode(n) && !done) { done = true; touched = true; return { ...n, ...dates }; }
      const o = {};
      for (const [k, v] of Object.entries(n)) o[k] = visit(v);
      return o;
    };
    const next = visit(data);
    if (!touched) return whole;
    const lead = body.match(/^\s*/)[0];
    const trail = body.match(/\s*$/)[0];
    const pretty = /^\{\s*\n(\s+)"/.exec(body.trim());
    return `${open}${lead}${pretty ? JSON.stringify(next, null, pretty[1].length) : JSON.stringify(next)}${trail}${close}`;
  });
  if (done) return out;

  // No node on the page can carry a date: the three service pages declare
  // LocalBusiness + Service + BreadcrumbList + FAQPage and nothing that stands
  // for the page itself. Give them the one node that does. A WebPage is what the
  // page IS, so this adds a fact rather than a claim, and isPartOf points at the
  // same single business node every other page already declares.
  // Same shape the focused pages already publish (scripts/lib/focus_pages.js) and
  // the shape scripts/install_contact_surface.js leaves alone: name, url and the
  // one business node as publisher. Anything it would add later has to be here, or
  // the next pipeline run rewrites the page and the idempotency validators fail.
  const node = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: headlineOf(html),
    url,
    publisher: { '@id': BUSINESS_ID },
    ...dates,
  };
  const block = `<script type="application/ld+json">${JSON.stringify(node)}</script>`;
  const blocks = [...html.matchAll(JSONLD)];
  const last = blocks[blocks.length - 1];
  if (last) {
    const at = html.indexOf(last[0]) + last[0].length;
    return html.slice(0, at) + '\n' + block + html.slice(at);
  }
  const head = html.indexOf('</head>');
  if (head < 0) throw new Error(`${rel}: no </head> to carry the WebPage JSON-LD`);
  return html.slice(0, head) + block + '\n' + html.slice(head);
}

module.exports = {
  applyArticleSchema, savePublished, declaresArticle, canonicalOf, isArticle, typesOf,
  applyPageDates, claimedDates, isPageNode, PAGE_TYPES,
  ARTICLE_TYPES, HEADLINE_MAX, BUSINESS_ID, DATE, JSONLD,
};
