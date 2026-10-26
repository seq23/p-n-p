#!/usr/bin/env node
'use strict';
/**
 * Renders the folded pages into their hubs (26 Oct 2026, data/search_intelligence/hub_consolidation.json).
 *
 * For each of the twelve hubs, one section before the closing call-to-action band:
 *
 *   <!--hub-folds--><section ... id="more-questions"> ... <!--/hub-folds-->
 *
 * holding the questions, answers and prices that used to sit on the hub's thin satellite pages,
 * read from data/content/hub_folds.json (text only, one copy of each question per hub). The first
 * question from each folded page carries that page's basename as its id, which is where
 * scripts/lib/site_url.js now sends every link that used to point at the folded page.
 *
 * Also writes the generated 301 block in _redirects (scripts/lib/hub_consolidation.js
 * redirectsBlock), so the redirect list and the fold list are one list.
 *
 * Idempotent. Hard-fails when the plan names zero hubs, a hub file is missing, or a hub has no
 * anchor to insert before. --check exits 1 when any file would change.
 * Guarded by npm run validate:hub-consolidation.
 */
const fs = require('fs');
const path = require('path');
const HC = require('./lib/hub_consolidation');

const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');
const BLOCK_RE = /<!--hub-folds-->[\s\S]*?<!--\/hub-folds-->/;
const CTA = '<section class="section cta-band">';
const FOCUS_END = '<!--/focus-page-->';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function block(items) {
  const ids = new Set();
  const faq = items.map((item) => {
    const id = path.basename(item.from);
    const idAttr = ids.has(id) ? '' : ` id="${id}"`;
    ids.add(id);
    return `<div class="faq-item"${idAttr}><h3>${esc(item.q)}</h3><p>${esc(item.a)}</p></div>`;
  }).join('');
  return `<!--hub-folds--><section class="section" id="${HC.SECTION_ID}" data-hub-folds="${items.length}"><div class="container"><div class="answer-block"><span class="eyebrow">More answers</span><h2>More questions, answered</h2></div><div class="faq-list hub-folds">${faq}</div></div></section><!--/hub-folds-->`;
}

function render(html, items, rel) {
  const b = block(items);
  if (BLOCK_RE.test(html)) return html.replace(BLOCK_RE, b);
  if (html.includes(CTA)) return html.replace(CTA, () => `${b}${CTA}`);
  // A focused page (scripts/generators/build_focus_pages.js) has no cta-band; its body ends at
  // <!--/focus-page-->, and that generator carries this block over after the same marker.
  if (html.includes(FOCUS_END)) return html.replace(FOCUS_END, () => `${FOCUS_END}${b}`);
  throw new Error(`${rel}: no "${CTA}" or "${FOCUS_END}" to place the folded questions at`);
}

function redirects(text) {
  const open = text.indexOf(HC.REDIRECTS_OPEN);
  const close = text.indexOf(HC.REDIRECTS_CLOSE);
  const blk = HC.redirectsBlock();
  if (open === -1 || close === -1) return `${text.replace(/\n*$/, '\n')}\n${blk}\n`;
  return text.slice(0, open) + blk + text.slice(close + HC.REDIRECTS_CLOSE.length);
}

function main() {
  const hubs = HC.hubs();
  if (!hubs.length) throw new Error('install_hub_folds: the plan names zero hubs');
  const stale = [];
  for (const { file, items } of hubs) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) throw new Error(`install_hub_folds: hub ${file} is missing`);
    if (!items.length) throw new Error(`install_hub_folds: hub ${file} has no folded questions in ${HC.FOLDS_REL}`);
    const before = fs.readFileSync(abs, 'utf8');
    const after = render(before, items, file);
    if (after !== before) { stale.push(file); if (!CHECK) fs.writeFileSync(abs, after); }
  }
  const rAbs = path.join(ROOT, '_redirects');
  const rBefore = fs.readFileSync(rAbs, 'utf8');
  const rAfter = redirects(rBefore);
  if (rAfter !== rBefore) { stale.push('_redirects'); if (!CHECK) fs.writeFileSync(rAbs, rAfter); }
  if (CHECK) {
    if (stale.length) { console.error(`HUB FOLDS: ${stale.length} file(s) stale: ${stale.join(', ')} (run node scripts/install_hub_folds.js)`); process.exit(1); }
    console.log(`HUB FOLDS: OK (${hubs.length} hubs, ${HC.redirectRules().length} redirect rules)`);
  } else {
    console.log(`HUB FOLDS: wrote ${stale.length} file(s); ${hubs.length} hubs, ${hubs.reduce((n, h) => n + h.items.length, 0)} folded questions, ${HC.redirectRules().length} redirect rules`);
  }
}

if (require.main === module) main();
module.exports = { block, render, redirects, BLOCK_RE };
