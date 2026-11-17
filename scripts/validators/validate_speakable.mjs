#!/usr/bin/env node
/**
 * Speakable (search-readiness checklist item c4). Fails when:
 *
 *  1. a published page that renders an answer or FAQ block (scripts/lib/speakable.js
 *     CANDIDATES) carries no SpeakableSpecification in its JSON-LD;
 *  2. a SpeakableSpecification names a #id / .class selector that is not on the page;
 *  3. any guide page (/guides/) has no speakable at all: the weekly page-quality
 *     sample fails every guide without one (17 Nov 2026,
 *     /guides/graduation-party-decorations-at-home-memphis);
 *  4. templates/page-shell.js or the focus-page generator stops emitting speakable
 *     for a fresh render.
 * Self-test: each check runs against a broken input and must fail.
 * Rule 0: zero published pages, or zero guide pages, is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const SPEAK = require(path.join(ROOT, 'scripts/lib/speakable.js'));
const { publishedPages } = require(path.join(ROOT, 'scripts/install_contact_surface.js'));
const { renderPage } = require(path.join(ROOT, 'templates/page-shell.js'));

function speakableSelectors(html) {
  const out = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const walk = (n) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      if ([].concat(n['@type'] || []).includes('SpeakableSpecification')) out.push([].concat(n.cssSelector || []));
      Object.values(n).forEach(walk);
    };
    walk(JSON.parse(m[1]));
  }
  return out;
}

/** Problems on one page; [] when it is fine. */
function checkPage(html, rel) {
  const specs = speakableSelectors(html);
  const problems = [];
  const isGuide = /^guides\//.test(rel);
  if (!specs.length) {
    if (isGuide || SPEAK.selectorsFor(html).length) problems.push(`${rel}: no SpeakableSpecification${isGuide ? ' on a guide page' : ''}`);
    return problems;
  }
  for (const sel of specs.flat()) if (!SPEAK.resolves(html, sel)) problems.push(`${rel}: speakable ${sel} is not on the page`);
  return problems;
}

const failures = [];
const pages = publishedPages();
let guides = 0;
for (const rel of pages) {
  if (/^guides\//.test(rel)) guides++;
  failures.push(...checkPage(fs.readFileSync(path.join(ROOT, rel), 'utf8'), rel));
}
if (!pages.length) failures.push('RULE_ZERO: 0 published pages read');
if (!guides) failures.push('RULE_ZERO: 0 guide pages read');

// 4. Fresh renders carry it.
const universe = require(path.join(ROOT, 'data/queries/query_universe.json'));
const plain = universe.find((e) => e.speakable === undefined && !e.porchPackages);
if (!plain) failures.push('RULE_ZERO: no query-universe entry without its own speakable to render');
else failures.push(...checkPage(renderPage(plain), 'guides/fresh-shell-render').map((p) => `page-shell: ${p}`));
const focusSrc = fs.readFileSync(path.join(ROOT, 'scripts/generators/build_focus_pages.js'), 'utf8');
if (!/speakable: \{ '@type': 'SpeakableSpecification', cssSelector: SPEAKABLE\.FOCUS_DEFAULT \}/.test(focusSrc)) failures.push('build_focus_pages.js: WebPage node no longer carries speakable');

// Self-test: every check must fail on a broken input.
const guideRel = pages.find((r) => /^guides\//.test(r));
const guideHtml = fs.readFileSync(path.join(ROOT, guideRel), 'utf8');
const stripped = guideHtml.replace(/,"speakable":\{"@type":"SpeakableSpecification","cssSelector":\[[^\]]*\]\}/, '');
const probes = [
  ['a guide page with its speakable removed', () => checkPage(stripped, guideRel)],
  ['a speakable selector that is not on the page', () => checkPage(guideHtml.replace(/"cssSelector":\["[^"]+"/, '"cssSelector":["#no-such-block"'), guideRel)],
  ['an answer page with no speakable', () => checkPage('<div id="recommendation-summary"></div><script type="application/ld+json">{"@type":"WebPage"}</script>', 'faq/probe.html')],
  ['the structured-data pass not restoring a stripped page', () => (SPEAK.applySpeakable(stripped, guideRel) === stripped ? ['not restored'] : checkPage(SPEAK.applySpeakable(stripped, guideRel), guideRel))],
];
if (stripped === guideHtml) failures.push(`self-test: could not strip speakable from ${guideRel}`);
for (const [name, run] of probes) {
  const got = run();
  const shouldPass = name.startsWith('the structured-data pass');
  if (shouldPass ? got.length : !got.length) failures.push(`self-test: ${name} was not ${shouldPass ? 'repaired' : 'caught'}`);
}

if (failures.length) {
  console.error(`validate:speakable FAILED (${failures.length})`);
  for (const f of failures.slice(0, 40)) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`validate:speakable OK: ${pages.length} published pages, ${guides} guide pages, ${probes.length} self-test probes caught`);
