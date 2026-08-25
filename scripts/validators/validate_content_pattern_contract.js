#!/usr/bin/env node
'use strict';
// Enforce the blocks the external review agent keeps asking for.
//
// Across ~2,750 recommendations audited on two sibling sites, the agent asks for
// the same small set of things over and over. 27% of distinct defects were
// re-reported on later runs despite being marked released - the same page
// missing the same block, found again. This checks for those blocks before
// publish instead of after audit.
//
// Derived from the recommendations themselves (.clarity/content-pattern-spec.json):
//
//   1 checklist / numbered protocol      730 occurrences (36.4%)
//   2 comparison / decision / cost table 529 (26.4%)
//   3 direct-answer block                512 (25.5%)
//   5 concrete numbers                   365 (18.2%)
//   6 named primary sources              288 (14.3%)
//   7 query present in a heading         261 (13.0%)
//   9 FAQ block                          136 (6.8%)
//  10 structured data                     70 (3.5%)
//
// Severity is split. The blocks that decide whether a page can be quoted at all
// block the release; the rest report as gaps so they can be worked without
// stopping a release.
//
// Same scan decisions and evidence location as the instruction-leak and
// empty-cell guards: published HTML in place, evidence under reports/validation
// so no new top-level directory appears (tree hygiene hard-fails on those).

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'reports/validation/content-pattern-contract.json');
const ENFORCEMENT = 'block'; // 'block' | 'report'
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'data', 'artifacts', 'reports', 'staging', 'templates',
  'distribution_scripts', 'docs', 'scripts',
]);
// Legal and transactional surfaces. The quote form answers no search query, and
// holding a privacy policy to a direct-answer contract measures nothing.
const SKIP_FILES = new Set([
  // Not an answer surface: it exists so Cloudflare Pages returns a real 404
  // instead of falling back to index.html under a 200.
  '404.html',
  'contact.html', 'privacy-policy.html', 'terms-and-conditions.html',
]);

const text = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Two shapes count as a direct answer here, because the repo emits two.
// The guides, areas, faq, local, seasonal, events and hub families label the
// block with an <h2>Quick answer</h2>. The answers/ family instead renders the
// record's own `direct_answer` field (data/answers/answers-index.json) as the
// paragraph immediately under the h1, which is the same block without the
// label. Both are self-contained above the fold; a stub of a few words is not,
// so the unlabelled form has to carry a real sentence.
const LABELLED_ANSWER = /<h2[^>]*>\s*(?:Quick|Direct|Short)\s+answer\s*<\/h2>/i;
const MIN_LEAD_CHARS = 80;
const leadLength = (html) => {
  const m = html.match(/<h1[^>]*>[\s\S]*?<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/i);
  return m ? text(m[1]).length : 0;
};

// The one conversion destination: the quote request. /contact.html carries the
// Google Form the business actually takes requests through, plus the direct
// address. Service and pricing pages are hubs, not the request surface.
const CONVERSION = /href="\/contact\.html|forms\.gle\/|mailto:hello@porchandparty901\.com/i;

// forms.gle is the conversion destination and fonts are assets - neither is a
// cited source, so neither may satisfy the named-source check.
const EXTERNAL_SOURCE = /<a[^>]+href="https?:\/\/(?!(?:www\.)?porchandparty901\.com)(?!forms\.gle)(?!fonts\.(?:googleapis|gstatic)\.com)/i;

const CHECKS = [
  { id: 'direct_answer', blocking: true,
    test: (h) => LABELLED_ANSWER.test(h) || leadLength(h) >= MIN_LEAD_CHARS,
    why: 'no direct-answer block - nothing here is quotable without surrounding context' },
  { id: 'query_in_heading', blocking: true,
    test: (h) => { const m = h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i); return Boolean(m && text(m[1]).length > 10); },
    why: 'h1 missing or too short to carry the searcher phrasing' },
  { id: 'no_empty_table_cells', blocking: true,
    test: (h) => !/<t[dh][^>]*>\s*<\/t[dh]>/i.test(h),
    why: 'table ships empty cells - the agent calls these impossible to cite' },
  { id: 'conversion_path', blocking: true,
    test: (h) => CONVERSION.test(h),
    why: 'no conversion path - an answer-engine citation lands with nowhere to go' },
  { id: 'checklist', blocking: false,
    test: (h) => /<ol[\s>]|<ul[\s>]/i.test(h),
    why: 'no checklist or numbered protocol (agent request #1, 730 occurrences)' },
  { id: 'comparison_table', blocking: false,
    test: (h) => /<table[\s>]/i.test(h),
    why: 'no comparison or cost table (agent request #2, 529 occurrences)' },
  { id: 'concrete_numbers', blocking: false,
    test: (h) => /\$\s?\d|\d+\s?(?:days?|weeks?|months?|years?|hours?|minutes?)\b/i.test(text(h)),
    why: 'no concrete cost or timeline figures (agent request #5, 365 occurrences)' },
  { id: 'named_sources', blocking: false,
    test: (h) => /data-source|Primary sources|Sources?:/i.test(h) || EXTERNAL_SOURCE.test(h),
    why: 'no named primary source (agent request #6, 288 occurrences)' },
  { id: 'faq', blocking: false,
    test: (h) => /FAQPage|data-faq|class="[^"]*faq/i.test(h),
    why: 'no FAQ block or FAQPage schema (agent request #9)' },
  { id: 'structured_data', blocking: false,
    test: (h) => /application\/ld\+json/i.test(h),
    why: 'no JSON-LD structured data (agent request #10)' },
];

const pages = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(abs); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const rel = path.relative(ROOT, abs);
    if (SKIP_FILES.has(rel)) continue;
    pages.push(rel);
  }
})(ROOT);
pages.sort();

const blockingFailures = [];
const gaps = {};
for (const check of CHECKS) gaps[check.id] = [];

for (const rel of pages) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const check of CHECKS) {
    if (check.test(html)) continue;
    if (check.blocking) blockingFailures.push({ path: rel, check: check.id, why: check.why });
    else gaps[check.id].push(rel);
  }
}

const summary = CHECKS.map((check) => {
  const missing = check.blocking
    ? blockingFailures.filter((f) => f.check === check.id).length
    : gaps[check.id].length;
  return {
    id: check.id,
    blocking: check.blocking,
    pages_missing: missing,
    coverage_pct: Number((100 * (1 - missing / Math.max(pages.length, 1))).toFixed(1)),
    why: check.why,
  };
});

fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, `${JSON.stringify({
  schema_version: '1.0',
  validator: 'content-pattern-contract',
  spec: '.clarity/content-pattern-spec.json',
  generated_at: new Date().toISOString(),
  enforcement: ENFORCEMENT,
  pages_checked: pages.length,
  status: blockingFailures.length ? (ENFORCEMENT === 'block' ? 'FAIL' : 'REPORTED') : 'PASS',
  blocking_failures: blockingFailures.length,
  summary,
  worst_gaps: Object.fromEntries(Object.entries(gaps).map(([k, v]) => [k, v.slice(0, 25)])),
  blocking_backlog: blockingFailures.slice(0, 200),
}, null, 2)}\n`);

console.log(`CONTENT PATTERN CONTRACT: ${pages.length} pages checked (enforcement: ${ENFORCEMENT})`);
for (const s of summary) {
  const tag = s.blocking ? 'BLOCKING' : 'gap     ';
  console.log(`  ${tag} ${s.id.padEnd(22)} coverage ${String(s.coverage_pct).padStart(5)}%  missing on ${s.pages_missing}`);
}
if (blockingFailures.length) {
  const log = ENFORCEMENT === 'block' ? console.error : console.warn;
  log(`\nCONTENT PATTERN CONTRACT: ${blockingFailures.length} blocking gap(s)`);
  for (const f of blockingFailures.slice(0, 15)) log(`  ${f.path} :: ${f.why}`);
  if (blockingFailures.length > 15) log(`  ...and ${blockingFailures.length - 15} more`);
  if (ENFORCEMENT === 'block') process.exit(1);
  console.warn('  reported, not blocking, while the backlog above is worked.');
  process.exit(0);
}
console.log('\nCONTENT PATTERN CONTRACT PASS');
