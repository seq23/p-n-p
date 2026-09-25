#!/usr/bin/env node
'use strict';
/**
 * Every published page is reachable, and every link on it survives the edge.
 *
 * WHAT THIS GUARDS, AND WHY IT IS NOT validate:internal-links
 * -----------------------------------------------------------
 * `validate:internal-links` asks one question: does each href resolve to a file
 * in this repository? That question was green on 2026-09-17 while Ahrefs was
 * reporting 115 errors against porchandparty901.com, because neither of the two
 * real defects is visible from inside a single file.
 *
 *   1. LINKS TO A BROKEN PAGE - 112 URLs, one destination.
 *      Cloudflare Email Address Obfuscation rewrites every
 *      `<a href="mailto:hello@porchandparty901.com">` at the edge into
 *      `/cdn-cgi/l/email-protection#<hex>`, which answers 404 to any client
 *      that does not run its JavaScript. Verified live: that URL returns 404.
 *      The address is in the footer, so the rewrite lands on every page. In the
 *      repository the href is a clean, valid `mailto:` and nothing looks wrong;
 *      the breakage is created between the origin and the crawler.
 *      Guarded here by asserting the shape the edge leaves alone: every mailto:
 *      anchor inside Cloudflare's `<!--email_off-->` opt-out.
 *
 *   2. ORPHAN PAGES - 3 URLs.
 *      A page with no inbound internal link is advertised by the sitemap and
 *      reachable by nobody. That is a property of the link graph, so no
 *      per-file check can see it. Guarded here by building the graph over the
 *      published set and requiring at least one inbound link per page.
 *
 * Both were caused by a pass that ran and did nothing:
 * `scripts/build_related_navigation.js` read `<loc>` as a repository path after
 * #12 made the sitemap extensionless, resolved one page out of 112, and printed
 * "status": "PASS" on every run for eight days. This validator is deliberately
 * written so the same failure cannot hide in it: examining zero pages, zero
 * links or fewer pages than the sitemap advertises is a hard failure, never a
 * pass on an empty loop.
 *
 * THE PUBLISHED SET
 * -----------------
 * sitemap.xml is the set of pages this site claims to publish. `404.html` is
 * deliberately not in it: an error document is served by status code, is not
 * linked from anywhere by design, and is not an orphan.
 *
 * Usage: node scripts/validation/validate_link_reachability.js
 */
const fs = require('fs');
const path = require('path');
const { isRedirectingForm, internalHref } = require('../lib/site_url');

const ROOT = path.resolve(__dirname, '..', '..');
const DOMAIN = 'https://porchandparty901.com';
const EMAIL_OFF_OPEN = '<!--email_off-->';
const EMAIL_OFF_CLOSE = '<!--/email_off-->';
const MIN_PUBLISHED = 20;

const failures = [];
const fail = (msg) => failures.push(msg);

// --- the published set ------------------------------------------------------

const sitemapPath = path.join(ROOT, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) {
  console.error('LINK REACHABILITY FAILED: sitemap.xml is missing, so there is no published set to check.');
  process.exit(1);
}
const locs = [...fs.readFileSync(sitemapPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1].replace(DOMAIN, ''));

/** The file Cloudflare Pages serves for a URL: literal, then .html, then /index.html. */
function relForServedPath(p) {
  const clean = (p === '/' ? '/index' : p).replace(/\/$/, '');
  const bare = clean.replace(/^\//, '');
  for (const candidate of [bare, `${bare}.html`, `${bare}/index.html`]) {
    if (candidate.endsWith('.html') && fs.existsSync(path.join(ROOT, candidate))) return candidate;
  }
  return null;
}

/** The URL the origin answers 200 for, for a file. The graph's canonical key. */
function servedPath(rel) {
  let p = `/${rel}`.replace(/\.html$/, '');
  if (p.endsWith('/index')) p = p.slice(0, -'/index'.length) || '/';
  return p;
}

const pages = new Map(); // servedPath -> rel
for (const loc of locs) {
  const rel = relForServedPath(loc);
  if (!rel) fail(`sitemap advertises ${loc}, which resolves to no file in this repository`);
  else pages.set(servedPath(rel), rel);
}

// Rule 0. A scan that saw nothing has not checked anything.
if (!locs.length) {
  console.error('LINK REACHABILITY FAILED: sitemap.xml carries zero <loc> entries. The scan is broken, not the site.');
  process.exit(1);
}
if (pages.size < MIN_PUBLISHED) {
  console.error(`LINK REACHABILITY FAILED: resolved only ${pages.size} of ${locs.length} sitemap URL(s) to files, `
    + `below the floor of ${MIN_PUBLISHED}. The read is broken, not the site.`);
  process.exit(1);
}

// --- the link graph ---------------------------------------------------------

const redirectSources = new Set(
  fs.existsSync(path.join(ROOT, '_redirects'))
    ? fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      .map((l) => l.split(/\s+/)[0])
    : []
);

const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();

/** Resolve an href to a published servedPath, or null when it is not one. */
function targetOf(fromRel, href) {
  let h = href;
  if (h.startsWith(DOMAIN)) h = h.slice(DOMAIN.length) || '/';
  else if (/^(https?:)?\/\//i.test(h)) return null;      // another origin
  if (/^(mailto:|tel:|javascript:|data:|#)/i.test(h)) return null;
  let clean = h.split('#')[0].split('?')[0];
  if (!clean) return null;
  if (!clean.startsWith('/')) {
    clean = `/${path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, fromRel)), clean))}`;
  }
  clean = clean.replace(/\.html$/, '');
  if (clean.endsWith('/index')) clean = clean.slice(0, -'/index'.length) || '/';
  if (clean.length > 1 && clean.endsWith('/')) clean = clean.slice(0, -1);
  return clean || '/';
}

const inbound = new Map([...pages.keys()].map((k) => [k, 0]));
let hrefsChecked = 0;
let mailtoAnchors = 0;
const unresolved = [];
const unprotected = [];
// (4) An internal link that the origin answers with a 3xx. Bing's crawl on
// 2026-09-25 found 136 of them - /answers, /services, /areas, /local, /events
// and /faq, each 308ing to its trailing-slash URL - on pages that passed every
// check here, because a link that "has a target" was treated as a good link
// whether the target answered 200 or 308. A link that spends a redirect costs
// crawl budget on every page it sits on and is reported as an error, so it
// fails here: the redirecting form (bare directory, `.html`, stray slash, as
// decided by scripts/lib/site_url.js) and any href that names a _redirects
// source instead of that rule's destination.
const redirecting = [];
let internalHrefs = 0;

const ANCHOR_HREF = /href=["']([^"']+)["']/g;
const MAILTO_ANCHOR = /<a\b[^>]*\bhref=(["'])mailto:[^"']*\1[^>]*>[\s\S]*?<\/a>/gi;

for (const [selfUrl, rel] of pages) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');

  // (1) every mailto: anchor must be opted out of the edge rewriter
  MAILTO_ANCHOR.lastIndex = 0;
  let a;
  while ((a = MAILTO_ANCHOR.exec(html))) {
    mailtoAnchors += 1;
    const before = html.slice(Math.max(0, a.index - EMAIL_OFF_OPEN.length), a.index);
    const after = html.slice(a.index + a[0].length, a.index + a[0].length + EMAIL_OFF_CLOSE.length);
    if (before !== EMAIL_OFF_OPEN || after !== EMAIL_OFF_CLOSE) {
      unprotected.push(`${rel}: ${a[0].slice(0, 80)}`);
    }
  }

  // (2) every internal href must have a target, and (3) feeds the link graph
  ANCHOR_HREF.lastIndex = 0;
  const seen = new Set();
  let m;
  while ((m = ANCHOR_HREF.exec(html))) {
    hrefsChecked += 1;
    const target = targetOf(rel, m[1]);
    if (target === null) continue;
    internalHrefs += 1;
    if (isRedirectingForm(m[1])) {
      redirecting.push(`${rel} -> ${m[1]} (the origin redirects it; link ${internalHref(m[1])} instead)`);
    } else if (redirectSources.has(target) && !pages.has(target)) {
      redirecting.push(`${rel} -> ${m[1]} (a _redirects source; link the rule's destination instead)`);
    }
    // A file on disk is checked before _redirects, not after. Counting a link
    // as "satisfied by a redirect rule" when the page it names actually exists
    // is how a real page stops being counted as linked: /services has both a
    // published index and a legacy redirect, and reading the rule first made
    // the index look like an orphan while 112 pages linked straight at it.
    const base = path.join(ROOT, target);
    if (!(isFile(base) || isFile(`${base}.html`) || isFile(path.join(base, 'index.html')))) {
      if (!redirectSources.has(target)) unresolved.push(`${rel} -> ${m[1]}`);
      continue;
    }
    if (target !== selfUrl) seen.add(target);
  }
  for (const t of seen) if (inbound.has(t)) inbound.set(t, inbound.get(t) + 1);
}

// Rule 0 again: a page set with no links in it is a broken read.
if (!hrefsChecked) {
  console.error(`LINK REACHABILITY FAILED: ${pages.size} published page(s) carried zero href attributes between them. `
    + 'The scan is broken, not the site.');
  process.exit(1);
}
if (!mailtoAnchors) {
  console.error('LINK REACHABILITY FAILED: found zero mailto: anchors across the published set. '
    + 'This site publishes hello@porchandparty901.com in its footer, so either the contact fallback has been removed '
    + 'from every page or this check is no longer looking at the pages it thinks it is.');
  process.exit(1);
}

// A _redirects source that names a page this site publishes is a rule that
// shadows the page: the origin answers the link with a 302 to somewhere else
// and the real page is never served at its own URL. /services carried exactly
// that - a rule written before services/index.html existed, left in place after
// it was published - so every internal /services link spent a redirect and
// landed on one service page instead of the section index.
for (const src of redirectSources) {
  const key = src.length > 1 && src.endsWith('/') ? src.slice(0, -1) : src;
  if (pages.has(key)) {
    fail(`_redirects sends ${src} elsewhere, but ${pages.get(key)} is a published page at that URL. `
      + 'The rule shadows the page: remove the rule or unpublish the page.');
  }
}

// Rule 0 for check (4): zero internal hrefs examined means the scan is broken.
if (!internalHrefs) {
  console.error(`LINK REACHABILITY FAILED: ${pages.size} published page(s) carried zero internal hrefs between them. `
    + 'The redirecting-link scan examined nothing, so it proved nothing.');
  process.exit(1);
}

// A _redirects destination must be a page this site publishes. A rule that
// lands on a 404, or on another redirect, turns a recovered URL back into an
// error. /authority and /hubs (Bing W404, 2026-09-25) are recovered this way.
let redirectRules = 0;
if (fs.existsSync(path.join(ROOT, '_redirects'))) {
  for (const line of fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [from, to] = t.split(/\s+/);
    redirectRules += 1;
    if (!to) { fail(`_redirects rule for ${from} names no destination`); continue; }
    if (isRedirectingForm(to)) fail(`_redirects: ${from} -> ${to}, a URL the origin itself redirects; name ${internalHref(to)}`);
    const dest = targetOf('index.html', to);
    if (dest !== null && !pages.has(dest)) fail(`_redirects: ${from} -> ${to}, which is not a page in sitemap.xml`);
  }
}

const orphans = [...inbound].filter(([, n]) => n === 0).map(([url]) => url);

for (const u of unresolved) fail(`internal link with no target: ${u}`);
for (const u of redirecting) fail(`internal link that redirects: ${u}`);
for (const u of unprotected) fail(`mailto: anchor outside <!--email_off-->, so Cloudflare will rewrite it into a 404 /cdn-cgi/l/email-protection link: ${u}`);
for (const o of orphans) fail(`orphan page, published in sitemap.xml with zero inbound internal links: ${o} (${pages.get(o)})`);

if (failures.length) {
  console.error(`LINK REACHABILITY FAILED: ${failures.length} problem(s) across ${pages.size} published page(s).`);
  for (const f of failures.slice(0, 50)) console.error(`- ${f}`);
  if (failures.length > 50) console.error(`  ...and ${failures.length - 50} more`);
  process.exit(1);
}

console.log(`Link reachability OK: ${pages.size} published page(s), ${hrefsChecked} href(s) checked, `
  + `${mailtoAnchors} mailto: anchor(s) all inside <!--email_off-->, 0 internal links without a target, `
  + `${internalHrefs} internal href(s) with 0 redirecting, ${redirectRules} _redirects rule(s) all landing on a published page, 0 orphan pages.`);
