'use strict';
/**
 * The one place that knows which pages were folded into which hub (26 Oct 2026).
 *
 * WHY
 * ---
 * On 25 Oct 2026 Search Console had indexed 1 of this site's 141 sitemap URLs for fifteen days
 * running, with the sitemap registered and downloaded. 110 of the 111 thin pages in
 * data/search_intelligence/consolidation_candidates.json had no impressions in 28 days, and most
 * repeat a service hub almost word for word (/answers/grazing-tables-memphis,
 * /local/grazing-tables-memphis and /services/grazing-tables-memphis said the same thing).
 * data/search_intelligence/hub_consolidation.json folds them into twelve hubs: each folded page's
 * questions and answers move into its hub (data/content/hub_folds.json, rendered by
 * scripts/install_hub_folds.js), its URL 301s to the hub, and nothing on the site links it,
 * lists it or submits it again.
 *
 * Every consumer reads this module, never the JSON directly, so the generators, the link
 * normalizer (scripts/lib/site_url.js), the _redirects block and the guard
 * (scripts/validators/validate_hub_consolidation.js) cannot keep different lists.
 *
 * Dependency-free (Node built-ins only): scripts/lib/site_url.js requires it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PLAN_REL = 'data/search_intelligence/hub_consolidation.json';
const FOLDS_REL = 'data/content/hub_folds.json';
const SECTION_ID = 'more-questions';

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
let cache = null;

/** Strip a trailing `.html` / `/index.html` / `/` so every spelling of a path compares equal. */
function bare(p) {
  return String(p).replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, '') || '/';
}

/**
 * The fragment a folded page's links land on: the id of its first question in the hub (the page's
 * basename; two folded pages with one basename, e.g. answers/ and local/grazing-tables-memphis,
 * share it and land on the first). A page none of whose questions survived de-duplication lands
 * on the section itself (#more-questions).
 */
function anchorsFor(folds) {
  const anchors = new Map();
  for (const items of Object.values(folds.hubs || {})) {
    for (const item of items) if (!anchors.has(item.from)) anchors.set(item.from, path.basename(item.from));
  }
  return anchors;
}

function load() {
  if (cache) return cache;
  const plan = readJson(PLAN_REL);
  const folds = fs.existsSync(path.join(ROOT, FOLDS_REL)) ? readJson(FOLDS_REL) : { hubs: {} };
  const anchors = anchorsFor(folds);
  const targets = new Map();
  for (const f of plan.folds || []) {
    // A page whose own questions were all duplicates lands on its namesake's question in the
    // same hub when there is one (faq/ and answers/ copies of one question), else on the section.
    const namesake = ((folds.hubs || {})[f.to] || []).some((i) => path.basename(i.from) === path.basename(f.from));
    const id = anchors.get(f.from) || (namesake ? path.basename(f.from) : SECTION_ID);
    targets.set(bare(f.from), { to: f.to, hash: `#${id}`, file: f.file, from: f.from });
  }
  for (const s of plan.retired_sections || []) {
    targets.set(bare(s.from), { to: s.to, hash: '', file: s.file, from: s.from });
  }
  cache = { plan, folds, anchors, targets };
  return cache;
}

/**
 * Where a link to `pathPart` should point now, or null when it was not folded.
 * Accepts any spelling (`/answers/x`, `/answers/x.html`, `/answers/`, `/answers/index.html`).
 */
function foldTarget(pathPart) {
  const t = load().targets.get(bare(pathPart));
  return t ? { to: t.to, hash: t.hash } : null;
}

/** Repository-relative files that must no longer exist (folded pages, retired indexes). */
function retiredFiles() {
  return [...load().targets.values()].map((t) => t.file);
}

/** True when a repository-relative file was folded or retired. */
function isRetiredFile(rel) {
  const r = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  return retiredFiles().includes(r);
}

/** True when a URL or path (absolute, rooted, any spelling) names a folded page or retired index. */
function isRetiredUrl(url) {
  const p = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '') || '/';
  return Boolean(foldTarget(p));
}

/** The twelve hubs, each with its folded items in render order. */
function hubs() {
  const { plan, folds } = load();
  const order = [...new Set((plan.folds || []).map((f) => f.to))].sort();
  return order.map((hub) => ({ hub, file: `${hub.replace(/^\//, '')}.html`, items: (folds.hubs || {})[hub] || [] }));
}

/** Every 301 rule, one per spelling a visitor or crawler may hold. */
function redirectRules() {
  const rules = [];
  for (const t of load().targets.values()) {
    const b = bare(t.from);
    const dest = t.to;
    const sources = t.from.endsWith('/') ? [b, `${b}/`, `${b}/index.html`] : [b, `${b}.html`];
    for (const s of sources) rules.push({ from: s, to: dest });
  }
  return rules;
}

const REDIRECTS_OPEN = '# --- hub consolidation (generated by scripts/install_hub_folds.js from data/search_intelligence/hub_consolidation.json; do not edit by hand) ---';
const REDIRECTS_CLOSE = '# --- /hub consolidation ---';

function redirectsBlock() {
  const width = Math.max(...redirectRules().map((r) => r.from.length));
  const lines = redirectRules().map((r) => `${r.from.padEnd(width)}  ${r.to}  301`);
  return [REDIRECTS_OPEN, ...lines, REDIRECTS_CLOSE].join('\n');
}

module.exports = {
  PLAN_REL, FOLDS_REL, SECTION_ID, REDIRECTS_OPEN, REDIRECTS_CLOSE,
  bare, load, foldTarget, retiredFiles, isRetiredFile, isRetiredUrl, hubs, redirectRules, redirectsBlock,
  reset() { cache = null; },
};
