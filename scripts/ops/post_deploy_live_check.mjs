#!/usr/bin/env node
/**
 * Post-deploy live check: fetch the deployed site and prove the edge is serving
 * what the repository committed.
 *
 * WHY
 * ---
 * Her Search Readiness Checklist item h4: "The build can pass and the edge can
 * still serve the wrong thing (a Worker that 301'd robots.txt did)." Every check
 * in this repository until now read files on disk. Nothing ever fetched the
 * deployed site, so a Cloudflare Pages deploy that half-published, a redirect
 * rule that shadowed a real page, or an asset that never uploaded would have
 * passed every gate and been found by an external audit weeks later.
 *
 * WHAT IT CHECKS, all against the live host:
 *   1. robots.txt answers 200, is not a redirect, and names the sitemap;
 *   2. sitemap.xml answers 200 and advertises exactly the URLs the committed
 *      sitemap.xml does - a deploy that dropped pages is caught here;
 *   3. the IndexNow key file answers 200 and its body is the key (ownership);
 *   4. llms.txt answers 200 (the AI-answer surface this site is built around);
 *   5. every icon in scripts/lib/site_icons.js ICON_FILES answers 200;
 *   6. every distinct og:image in the committed pages answers 200 on this host -
 *      a share card pointing at a missing file is a silent failure;
 *   7. a sample of published pages answers 200 with NO redirect, and each one
 *      still carries, live: the business JSON-LD @id, og:image:width,
 *      og:site_name, twitter:card and its visible date line where the committed
 *      file has one;
 *   8. every destination in _redirects answers 200 after following the hop, and
 *      every source actually redirects rather than serving a page.
 *
 * Rule 0: it hard-fails on zero checks, and it hard-fails if the committed
 * sitemap is empty, so "nothing looked" can never read as "nothing wrong".
 *
 * The deployed state can lag a push by a minute or two, so each request is
 * retried (RETRIES x RETRY_DELAY_MS) before it is called a failure.
 *
 * Usage: node scripts/ops/post_deploy_live_check.mjs [--host porchandparty901.com] [--sample 12] [--wait-for-deploy 900]
 * Exits 0 when everything answered, 1 naming every URL that did not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const siteIcons = require(path.join(ROOT, 'scripts/lib/site_icons.js'));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const HOST = arg('host', offers.domain.replace(/^https?:\/\//, ''));
const BASE = `https://${HOST}`;
const SAMPLE = Number(arg('sample', '12'));
const RETRIES = 4;
const RETRY_DELAY_MS = 20_000;
const UA = 'Mozilla/5.0 (compatible; PorchAndPartyLiveCheck/1.0; +https://porchandparty901.com/)';

const failures = [];
let checks = 0;
const fail = (m) => failures.push(m);
const check = (cond, m) => { checks += 1; if (!cond) fail(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET with retries. Returns { status, finalUrl, redirected, text }. */
async function get(url, { text = false } = {}) {
  let last = null;
  for (let i = 0; i < RETRIES; i += 1) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA } });
      const out = { status: res.status, finalUrl: res.url, redirected: res.url.replace(/\/$/, '') !== url.replace(/\/$/, ''), text: text ? await res.text() : '' };
      if (res.status === 200) return out;
      last = out;
    } catch (e) { last = { status: 0, finalUrl: url, redirected: false, text: '', why: e.message }; }
    if (i < RETRIES - 1) await sleep(RETRY_DELAY_MS);
  }
  return last;
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const meta = (html, attr, key) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!new RegExp(`\\b${attr}="${key}"`, 'i').test(tag)) continue;
    const c = /\bcontent="([^"]*)"/i.exec(tag);
    if (c) return c[1];
  }
  return null;
};

// --- the committed truth to compare the edge against ------------------------

const committedSitemap = read('sitemap.xml');
const committedLocs = [...committedSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
if (!committedLocs.length) {
  console.error('POST-DEPLOY LIVE CHECK FAILED: the committed sitemap.xml advertises no URL, so there is nothing to verify.');
  process.exit(1);
}
const relFor = (loc) => {
  const bare = loc.replace(offers.domain, '').replace(/^\/|\/$/g, '') || 'index';
  return [`${bare}.html`, `${bare}/index.html`].find((c) => fs.existsSync(path.join(ROOT, c))) ?? null;
};

const keyFiles = fs.readdirSync(ROOT).filter((f) => /^[0-9a-fA-F-]{32,64}\.txt$/.test(f));
const ogImages = new Set();
for (const loc of committedLocs) {
  const rel = relFor(loc);
  if (!rel) continue;
  const url = meta(read(rel), 'property', 'og:image');
  if (url) ogImages.add(url);
}

console.log(`post-deploy live check: ${BASE} (${committedLocs.length} committed URLs, ${ogImages.size} og:images, sample ${SAMPLE})`);

// --- 0. wait for THIS commit to be the one the edge serves ------------------
//
// On a push the workflow used to sleep a fixed 90 s and compare. Pages does not always finish
// in 90 s, and an old deploy answers every URL with a 200, so the per-request retries above never
// fire: on 26 Oct 2026 (#149, 76 URLs folded into hubs) the check compared the commit against the
// previous deploy and reported 81 "failures" that a rerun two minutes later passed. So, with
// --wait-for-deploy <seconds>, poll until the live sitemap.xml and llms.txt are byte-identical
// to the committed ones before comparing anything, and fail by name if they never are.
const WAIT_S = Number(arg('wait-for-deploy', '0'));
if (WAIT_S > 0) {
  const committedLlms = read('llms.txt');
  const started = Date.now();
  let served = false;
  for (;;) {
    try {
      const [sm, ll] = await Promise.all([`${BASE}/sitemap.xml`, `${BASE}/llms.txt`].map((u) => fetch(`${u}?live-check=${Date.now()}`, { headers: { 'user-agent': UA } }).then((r) => r.text())));
      if (sm === committedSitemap && ll === committedLlms) { served = true; break; }
    } catch { /* not up yet; keep waiting */ }
    if (Date.now() - started > WAIT_S * 1000) break;
    await sleep(15_000);
  }
  if (!served) {
    console.error(`POST-DEPLOY LIVE CHECK FAILED: after ${WAIT_S}s ${BASE} still does not serve this commit's sitemap.xml and llms.txt - the Pages deploy of this push never reached the edge (or failed). Check the Cloudflare Pages build for this commit.`);
    process.exit(1);
  }
  console.log(`deploy of this commit is live (sitemap.xml and llms.txt match) after ${Math.round((Date.now() - started) / 1000)}s`);
}

// --- 1. robots.txt ----------------------------------------------------------

{
  const r = await get(`${BASE}/robots.txt`, { text: true });
  check(r.status === 200, `robots.txt answered ${r.status}`);
  check(!r.redirected, `robots.txt redirected to ${r.finalUrl}; a crawler following a hop for robots is the defect this check exists for`);
  check(/Sitemap:\s*\S+sitemap\.xml/i.test(r.text || ''), 'live robots.txt does not name sitemap.xml');
}

// --- 2. sitemap.xml, URL for URL -------------------------------------------

{
  const r = await get(`${BASE}/sitemap.xml`, { text: true });
  check(r.status === 200, `sitemap.xml answered ${r.status}`);
  if (r.status === 200) {
    const live = new Set([...(r.text || '').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()));
    const missing = committedLocs.filter((l) => !live.has(l));
    const extra = [...live].filter((l) => !committedLocs.includes(l));
    check(!missing.length, `the live sitemap is missing ${missing.length} committed URL(s): ${missing.slice(0, 5).join(', ')}`);
    check(!extra.length, `the live sitemap advertises ${extra.length} URL(s) this commit does not: ${extra.slice(0, 5).join(', ')}`);
  }
}

// --- 3. the IndexNow key ----------------------------------------------------

check(keyFiles.length === 1, `${keyFiles.length} IndexNow key file(s) in the repository root; exactly 1 expected`);
for (const f of keyFiles) {
  const key = f.replace(/\.txt$/, '');
  const r = await get(`${BASE}/${f}`, { text: true });
  check(r.status === 200, `/${f} answered ${r.status}; IndexNow cannot verify ownership`);
  if (r.status === 200) check((r.text || '').trim() === key, `/${f} does not serve its own key`);
}

// --- 4. llms.txt ------------------------------------------------------------

{
  const r = await get(`${BASE}/llms.txt`);
  check(r.status === 200, `llms.txt answered ${r.status}`);
}

// --- 5. icons ---------------------------------------------------------------

for (const f of siteIcons.ICON_FILES) {
  const r = await get(`${BASE}/${f}`);
  check(r.status === 200, `/${f} answered ${r.status}`);
}

// --- 6. og images -----------------------------------------------------------

for (const url of ogImages) {
  check(url.startsWith(`${offers.domain}/`), `og:image ${url} is not on ${offers.domain}`);
  const r = await get(url);
  check(r.status === 200, `og:image ${url} answered ${r.status}`);
}

// --- 7. a sample of pages, live ---------------------------------------------

/** The homepage, /about, and an even spread across the rest. */
const must = [`${offers.domain}/`, `${offers.domain}/about`].filter((u) => committedLocs.includes(u));
const rest = committedLocs.filter((u) => !must.includes(u));
const step = Math.max(1, Math.ceil(rest.length / Math.max(1, SAMPLE - must.length)));
const sample = [...must, ...rest.filter((_, i) => i % step === 0)].slice(0, Math.max(SAMPLE, must.length));

for (const loc of sample) {
  const rel = relFor(loc);
  if (!rel) { fail(`the committed sitemap advertises ${loc}, which resolves to no file`); continue; }
  const committed = read(rel);
  const r = await get(loc, { text: true });
  check(r.status === 200, `${loc} answered ${r.status}`);
  check(!r.redirected, `${loc} redirected to ${r.finalUrl}; a sitemap URL must be the final URL`);
  if (r.status !== 200) continue;
  const live = r.text || '';
  check(live.includes(offers.contact.entity.id), `${loc} serves no business JSON-LD @id`);
  for (const [attr, key] of [['property', 'og:image:width'], ['property', 'og:site_name'], ['name', 'twitter:card']]) {
    check(meta(live, attr, key) !== null, `${loc} serves no ${key}`);
  }
  const dates = /<p class="page-dates" data-page-dates>[\s\S]*?<\/p>/.exec(committed);
  if (dates) check(live.includes(dates[0]), `${loc} does not serve the published/updated date line the commit has`);
}

// --- 8. _redirects ----------------------------------------------------------

for (const line of read('_redirects').split('\n')) {
  const m = /^\s*(\/\S*)\s+(\/\S*)\s+(\d{3})\s*$/.exec(line);
  if (!m) continue;
  const [, from, to] = m;
  const r = await get(`${BASE}${from}`);
  check(r.status === 200, `_redirects source ${from} answered ${r.status}`);
  check(r.redirected, `_redirects declares ${from} -> ${to} but the live host served ${from} without a hop`);
  const dest = await get(`${BASE}${to}`);
  check(dest.status === 200, `_redirects destination ${to} answered ${dest.status}`);
}

// --- verdict ----------------------------------------------------------------

if (!checks) {
  console.error('POST-DEPLOY LIVE CHECK FAILED: 0 checks ran. The check is broken, not the site.');
  process.exit(1);
}
if (failures.length) {
  console.error(`POST-DEPLOY LIVE CHECK FAILED: ${failures.length} of ${checks} check(s) against ${BASE}`);
  for (const f of failures.slice(0, 40)) console.error(`  - ${f}`);
  if (failures.length > 40) console.error(`  ...and ${failures.length - 40} more`);
  process.exit(1);
}
console.log(`POST-DEPLOY LIVE CHECK PASS: ${checks} checks against ${BASE} - robots, sitemap (${committedLocs.length} URLs), the IndexNow key, llms.txt, ${siteIcons.ICON_FILES.length} icons, ${ogImages.size} og:images, ${sample.length} sampled pages and every _redirects rule.`);
