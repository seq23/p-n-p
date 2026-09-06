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
// /contact.html 308s to /contact on this origin, so matching only the `.html`
// form meant this contract required the redirecting link. Both forms count as
// the same one conversion destination.
const CONVERSION = /href="\/contact(\.html)?"|forms\.gle\/|mailto:hello@porchandparty901\.com/i;

// forms.gle is the conversion destination and fonts are assets - neither is a
// cited source, so neither may satisfy the named-source check.
const EXTERNAL_SOURCE = /<a[^>]+href="https?:\/\/(?!(?:www\.)?porchandparty901\.com)(?!forms\.gle)(?!fonts\.(?:googleapis|gstatic)\.com)/i;


// The spec was named in this validator's output as its provenance while nothing
// read it, so editing the spec changed nothing. It is now loaded and enforced as
// the contract it claims to be: every block the spec asks for must have a test
// here, and every pattern it forbids must have one too. Adding a block to the
// spec and forgetting to implement it fails loudly instead of passing silently.
const SPEC_PATH = '.clarity/content-pattern-spec.json';
const __specRoot = typeof ROOT !== 'undefined' ? ROOT : process.cwd();
const spec = JSON.parse(fs.readFileSync(path.join(__specRoot, SPEC_PATH), 'utf8'));
const specBlockIds = (spec.blocks || []).map((b) => b.id);

// Forbidden patterns, listed in the spec from the start and never enforced -
// which is how pages came to publish "What to add: n/a" and blocks whose entire
// body was "n/a".
const FORBIDDEN = {
  empty_table_cells: {
    test: (h) => /<t[dh][^>]*>\s*<\/t[dh]>/i.test(h),
    why: 'empty table cell - an extracted table with a hole in it reads as broken' },
  internal_instruction_leak: {
    test: (h) => /FILEPATH:|<strong>What to add:|Direct answer target|Agent recommendation|Source FIX instruction|agent-instruction|What this page should clarify|>\s*n\/a\s*</i.test(h),
    why: 'build instruction or placeholder rendered for readers - an answer engine will quote it' },
  fabricated_statistics: {
    // A statistic with nothing sourcing it is the shape of a fabricated one.
    // Reported rather than blocking, because a real figure can be sourced
    // off-page and a heuristic should not fail a release on its own.
    test: (h) => {
      const body = String(h).replace(/<[^>]+>/g, ' ');
      const stat = /\b\d{1,3}(?:\.\d+)?%|\br\s*=\s*0?\.\d+|\b\d+x\s+(?:more|less|higher|lower)/i;
      if (!stat.test(body)) return false;
      return !/<a[^>]+href="https?:\/\//i.test(h)
        && !/\b(?:source|according to|per the|study|survey|report)\b/i.test(body);
    },
    why: 'statistic presented with no source on the page or beside it' },
};

// Class matching on a bare substring is how `citation-definition` came to
// satisfy the `source_block` check. Splitting the attribute into its whitespace-
// separated tokens and testing each one makes "has class X" mean what it says.
function hasClassToken(html, re) {
  for (const m of String(html).matchAll(/class="([^"]*)"/gi)) {
    for (const token of m[1].split(/\s+/)) if (token && re.test(token)) return true;
  }
  return false;
}

// A breadcrumb trail is an <ol> because the steps are ordered, but it is site
// navigation, not a protocol and not a checklist. Counting it would have moved
// "protocol" coverage from 6.6% to 85.8% the moment breadcrumbs were added to
// 86 pages, reporting 99 pages as having gained ordered steps when none of them
// gained a single instruction. Chrome is stripped before those two tests.
const withoutBreadcrumbs = (h) => String(h)
  .replace(/<nav\b[^>]*class="[^"]*breadcrumb[^"]*"[\s\S]*?<\/nav>/gi, ' ');

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
    test: (h) => /<ol[\s>]|<ul[\s>]/i.test(withoutBreadcrumbs(h)),
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
  // Added from the empirical spec (.clarity/content-pattern-spec.json v2.0), which
  // counts what the review agent actually asked for across 913 accepted
  // recommendations. These three were being missed entirely by the earlier list.
  { id: 'recommendation_summary', blocking: false,
    test: (h) => /data-bhpc-agent-block="recommendation_summary"|class="[^"]*recommendation-summary|<h[23][^>]*>\s*(?:What (?:we|this page) recommends?|Recommendation|Bottom line)/i.test(h),
    why: 'no recommendation summary - asked for on 913 of 913 agent recommendations, the single most requested block' },
  { id: 'definition_callout', blocking: false,
    test: (h) => /class="[^"]*citation-definition|data-bhpc-agent-block="definition_callout"|<(?:p|div)[^>]*>\s*<strong>[^<]{40,}<\/strong>/i.test(h),
    why: 'no definition callout (agent requested 196 times) - this is what an answer engine lifts for "what is X"' },
  { id: 'trust_block', blocking: false,
    test: (h) => /data-bhpc-agent-block="trust_block"|class="[^"]*(?:trust|author|byline)|rel="author"|itemprop="author"/i.test(h),
    why: 'no trust or authorship block (agent requested 215 times) - entity clarity is a citation factor' },

  // Named in the spec and never checked, so coverage silently omitted them.
  // Two substring faults made this report coverage it did not have.
  //
  // `class="[^"]*citation` matched `class="info-panel citation-definition"`,
  // so the three pages carrying a DEFINITION callout were counted as carrying a
  // SOURCES block. Proof it was the definition and nothing else: the
  // source_block and definition_callout gap lists in the evidence file were
  // byte-identical 106-page sets, no page on disk contains `source-block`, and
  // those three pages carry zero absolute links. Reported 2.8%, actual 0%.
  //
  // The second clause counted ANY absolute link - including a link to this
  // site's own pages, the quote form and Google Fonts - as named provenance.
  // That is the opposite of what a sources block asserts, and it is looser than
  // the `named_sources` check twelve lines above, which already excludes all
  // three. Both now use EXTERNAL_SOURCE, so the two source checks cannot
  // disagree about what a source is.
  //
  // Class matching is whole-token, so a block has to actually be a sources
  // block rather than merely contain those letters.
  { id: 'source_block', blocking: false,
    test: (h) => /data-(?:bhpc-)?(?:agent-block|content-block)="source_block"/i.test(h)
      || hasClassToken(h, /^(?:source-block|sources|citations?)$/i)
      || /<h[23][^>]*>\s*(?:Sources?|References?)\b/i.test(h)
      || EXTERNAL_SOURCE.test(h),
    why: 'no sources block - a claim with no visible provenance is the first thing an engine discounts' },
  { id: 'protocol', blocking: false,
    test: (h) => /data-(?:bhpc-)?(?:agent-block|content-block)="protocol"|class="[^"]*protocol|<h[23][^>]*>[^<]*(?:Protocol|Step-by-step|How to)\b/i.test(h) || /<ol[\s>]/i.test(withoutBreadcrumbs(h)),
    why: 'no ordered protocol - ordered steps are what gets lifted for "how do I"' },
  { id: 'cta_callout', blocking: false,
    test: (h) => /data-(?:bhpc-)?(?:agent-block|content-block)="cta_callout"|class="[^"]*(?:cta|next-step)|<h[23][^>]*>\s*Next step/i.test(h),
    why: 'no next-step callout - the conversion link may exist but nothing frames it as the next action' },
  { id: 'prompt_template', blocking: false,
    test: (h) => /data-(?:bhpc-)?(?:agent-block|content-block)="prompt_template"|class="[^"]*(?:copy-paste-prompt|prompt-template)|<pre[^>]*>[\s\S]*?<code/i.test(h),
    why: 'no copy-ready prompt - the artifact this audience actually reuses' },
];

// ------------------------------------------------- the spec must reach a PRODUCER
//
// The guard below this one enforces spec -> validator parity: add a block to the
// spec without a check and it fails loudly. Nothing enforced spec -> GENERATOR
// parity, and that asymmetry is the whole defect. `prompt_template` sat in the
// spec with a detector, no emitter anywhere in the repo, no template partial and
// no data field - so 0% across 109 pages was not a backlog anyone could work
// down, it was unreachable by construction. It printed as a gap on every run for
// weeks and reached no queue, which is "exists but nothing invokes it" wearing a
// coverage number.
//
// The link is made with the block's OWN test predicate, run against generator
// source instead of rendered HTML. If no generator contains anything its own
// detector would recognise, no page can ever carry the block. Using the same
// predicate for both sides is what stops the two from drifting apart again: a
// detector that is changed without an emitter fails here.
//
// Validators are excluded from the producer scan on purpose. They contain every
// marker string by necessity, and counting a detector as an emitter would make
// this guard pass on exactly the defect it exists to catch.
const PRODUCER_DIRS = ['templates', 'scripts'];
const PRODUCER_EXCLUDE = /(^|\/)(validators|validation|node_modules)(\/|$)/;
function producerSources() {
  const out = [];
  const walkSrc = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(ROOT, abs);
      if (PRODUCER_EXCLUDE.test(rel)) continue;
      if (entry.isDirectory()) { walkSrc(abs); continue; }
      if (!/\.(?:js|mjs|cjs)$/.test(entry.name)) continue;
      out.push({ file: rel, src: fs.readFileSync(abs, 'utf8') });
    }
  };
  for (const d of PRODUCER_DIRS) walkSrc(path.join(ROOT, d));
  return out;
}
const PRODUCERS = producerSources();
if (!PRODUCERS.length) {
  console.error('CONTENT PATTERN CONTRACT FAILED: producer scan found zero generator sources under '
    + `${PRODUCER_DIRS.join(', ')}. A scan that examined nothing must not report parity.`);
  process.exit(1);
}

// The spec is the contract. If it asks for a block this validator cannot check,
// the contract is not being enforced and reporting PASS would be false.
const __implemented = new Set(CHECKS.map((c) => c.id));
const __unimplemented = specBlockIds.filter((id) => !__implemented.has(id));
const __unenforced = (spec.forbidden || [])
  .map((f) => (typeof f === 'string' ? f : f && f.id))
  .filter((id) => id && !FORBIDDEN[id]);
if (__unimplemented.length || __unenforced.length) {
  for (const id of __unimplemented) console.log(`  spec block "${id}" has no check - the spec is not enforced`);
  for (const id of __unenforced) console.log(`  spec forbids "${id}" but nothing detects it`);
  console.log('CONTENT PATTERN CONTRACT FAIL: spec is not fully enforced');
  process.exit(1);
}

// ---- spec -> generator parity, plus the named stops that opt a block out.
//
// A block is either PRODUCIBLE (some generator emits something its own detector
// recognises) or explicitly retired with a written reason. There is no third
// state, because the third state is what `prompt_template` was: measured
// forever, produced never, and actionable by nobody.
const CHECK_BY_ID = new Map(CHECKS.map((c) => [c.id, c]));
const SPEC_BY_ID = new Map((spec.blocks || []).map((b) => [b.id, b]));
const applies = (b) => b.applies_to_repo !== false;

const producerFor = (id) => {
  const check = CHECK_BY_ID.get(id);
  if (!check) return null;
  const hit = PRODUCERS.find((f) => check.test(f.src));
  return hit ? hit.file : null;
};

const namedStops = [];
const orphanBlocks = [];
const staleStops = [];

for (const block of spec.blocks || []) {
  const emitter = producerFor(block.id);
  if (!applies(block)) {
    // A retired block must say why, in the spec, where a reviewer reads it.
    if (!String(block.named_stop || '').trim()) {
      staleStops.push(`spec block "${block.id}" sets applies_to_repo false with no named_stop. `
        + 'An opt-out with no stated reason is a silenced check, not a decision.');
      continue;
    }
    // And it must still be absent. The moment a page carries the block, the
    // opt-out is a lie about this repo and has to be reinstated rather than
    // quietly suppressing a block that now exists.
    namedStops.push({ id: block.id, why: block.named_stop, emitter });
    continue;
  }
  if (!emitter) {
    orphanBlocks.push(`spec block "${block.id}" is required of this repo (requested ${block.requested} times) `
      + 'but NO generator under templates/ or scripts/ emits anything its own detector recognises. '
      + 'Its coverage can never rise above 0% by any amount of content work, so reporting it as a gap '
      + 'sends nobody to a fix. Add an emitter, or retire it with applies_to_repo:false and a named_stop.');
  }
}

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

// ---- resolve the parity verdicts now that pages have actually been read.
//
// A retired block that has started appearing means the opt-out is stale: the
// repo changed and the spec did not. That is a hard fail rather than a silent
// pass, so the flag can never become a way to stop looking at something.
for (const stop of namedStops) {
  const present = pages.length - (gaps[stop.id] ? gaps[stop.id].length : pages.length);
  if (present > 0) {
    staleStops.push(`spec block "${stop.id}" is retired with applies_to_repo:false, but ${present} page(s) now carry it. `
      + 'The opt-out is out of date. Set applies_to_repo true and delete the named_stop.');
  }
}

// A STARVED lane: an emitter exists and is wired, and no data ever reaches it.
// source_block is the live example - templates/page-shell.js defines and calls
// sourceBlock(entry.sources), and zero of the 29 entries in
// data/queries/query_universe.json carry a `sources` field, so the call site
// runs on every page and returns an empty string every time. This is the
// difference that decides where the work goes: an orphan block needs an
// engineer, a starved block needs data. Reported, not blocking, because
// supplying real named sources is editorial and a build cannot invent them -
// but it is reported by name, with the count, so it reaches the improvement
// plan instead of dissolving into a coverage percentage.
const starvedBlocks = [];
for (const block of spec.blocks || []) {
  if (!applies(block)) continue;
  const check = CHECK_BY_ID.get(block.id);
  if (!check || check.blocking) continue;
  const missing = gaps[block.id] ? gaps[block.id].length : 0;
  if (missing === pages.length && pages.length > 0 && producerFor(block.id)) {
    starvedBlocks.push({ id: block.id, emitter: producerFor(block.id), pages_missing: missing });
  }
}

// Coverage is not the goal; a page-specific recommendation is. A block that is
// present on every page and says the same thing on most of them scores better
// on coverage than the honest version and is worth less than nothing, so the
// number that would catch that is measured here and printed beside the
// coverage. templates/page-shell.js emits the summary sentence as
// <p class="recommendation-summary__answer">, which is the text an extractor
// would lift, so that is what gets compared.
const RS_ANSWER = /<p class="recommendation-summary__answer">([\s\S]*?)<\/p>/i;
function distinctness() {
  const byText = new Map();
  for (const rel of pages) {
    const m = fs.readFileSync(path.join(ROOT, rel), 'utf8').match(RS_ANSWER);
    if (!m) continue;
    const t = text(m[1]);
    if (!t) continue;
    if (!byText.has(t)) byText.set(t, []);
    byText.get(t).push(rel);
  }
  const total = [...byText.values()].reduce((s, v) => s + v.length, 0);
  const repeated = [...byText.entries()].filter(([, v]) => v.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  return {
    total_blocks: total,
    distinct_texts: byText.size,
    ratio: Number((byText.size / Math.max(total, 1)).toFixed(4)),
    texts_on_more_than_one_page: repeated.length,
    pages_carrying_a_repeated_text: repeated.reduce((s, [, v]) => s + v.length, 0),
    worst: repeated.slice(0, 10).map(([t, files]) => ({ pages: files.length, text: t.slice(0, 120), sample: files.slice(0, 4) })),
  };
}
const RS_DISTINCTNESS = distinctness();

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
  // The parity verdicts are written to evidence, not just printed, because the
  // improvement plan reads this file. A gap that only ever existed in a CI log
  // reached no work queue, which is how prompt_template stayed at 0% for weeks.
  spec_producer_parity: {
    generator_sources_scanned: PRODUCERS.length,
    blocks_in_spec: (spec.blocks || []).length,
    blocks_required_of_this_repo: (spec.blocks || []).filter(applies).length,
    orphan_blocks: orphanBlocks,
    starved_blocks: starvedBlocks,
    named_stops: namedStops.map((n) => ({ id: n.id, why: n.why })),
  },
  recommendation_summary_distinctness: RS_DISTINCTNESS,
  worst_gaps: Object.fromEntries(Object.entries(gaps).map(([k, v]) => [k, v.slice(0, 25)])),
  // The whole gap list, not the first 25. The 25-item slice above is what lets a
  // skip list sit unexamined: nobody can read past the head of it.
  gaps_full: gaps,
  blocking_backlog: blockingFailures.slice(0, 200),
}, null, 2)}\n`);

console.log(`CONTENT PATTERN CONTRACT: ${pages.length} pages checked (enforcement: ${ENFORCEMENT})`);
for (const s of summary) {
  const tag = s.blocking ? 'BLOCKING' : 'gap     ';
  console.log(`  ${tag} ${s.id.padEnd(22)} coverage ${String(s.coverage_pct).padStart(5)}%  missing on ${s.pages_missing}`);
}
for (const n of namedStops) console.log(`  NAMED STOP ${n.id}: ${n.why}`);
for (const b of starvedBlocks) {
  console.log(`  STARVED  ${b.id}: ${b.emitter} emits this block and is called on every page, but no record supplies the data, `
    + `so it renders empty on all ${b.pages_missing}. This needs content, not code.`);
}
const d = RS_DISTINCTNESS;
console.log(`  recommendation_summary: ${d.total_blocks} blocks, ${d.distinct_texts} distinct (ratio ${d.ratio})`);
if (d.texts_on_more_than_one_page) {
  console.log(`  note: ${d.texts_on_more_than_one_page} summary text(s) sit on ${d.pages_carrying_a_repeated_text} pages.`);
  console.log('  Every pair here is one query published under two folders, so this is'
    + ' duplicate page coverage to resolve in data/queries/query_universe.json, not filler.');
  for (const w of d.worst.slice(0, 5)) console.log(`    x${w.pages} ${JSON.stringify(w.text.slice(0, 90))}`);
}
// An orphan block or a stale opt-out is a defect in the contract itself, not in
// a page, so it fails regardless of enforcement mode. A contract that asks for
// something nothing can produce is not a contract anyone can satisfy.
if (orphanBlocks.length || staleStops.length) {
  console.error(`\nCONTENT PATTERN CONTRACT FAILED: ${orphanBlocks.length + staleStops.length} spec/generator parity defect(s).`);
  for (const m of orphanBlocks) console.error(`  ORPHAN     ${m}`);
  for (const m of staleStops) console.error(`  STALE STOP ${m}`);
  process.exit(1);
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
