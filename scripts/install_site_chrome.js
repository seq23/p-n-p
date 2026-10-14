#!/usr/bin/env node
'use strict';
/**
 * Sitewide chrome pass: puts the canonical header (desktop row + mobile menu),
 * the nav stylesheet link and the footer Rentals link on every published page,
 * from scripts/lib/site_chrome.js.
 *
 * Frozen pages included. 110 authority routes are frozen in
 * data/release/frozen_output_registry.json and are never re-rendered, which is
 * how the old nav came to differ page to page. This pass is the mechanism that
 * reaches them: for each frozen route it changed, it proves the change is
 * chrome-only (the page minus everything site_chrome owns is byte-identical
 * before and after), then thaws exactly those routes in the active mutation
 * scope, refreezes, and restores the scope it found. A frozen page whose
 * change is not chrome-only is refused and the pass exits non-zero.
 *
 * Idempotent: a second run changes nothing and refreezes nothing. Exits
 * non-zero on zero pages, so it can never succeed having done nothing.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { applySiteChrome, withoutChrome } = require('./lib/site_chrome');
const { publishedPages } = require('./install_contact_surface');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/release/accepted_output_freeze_contract.json'), 'utf8'));
const REGISTRY = path.join(ROOT, CONTRACT.frozen_registry);
const SCOPE = path.join(ROOT, CONTRACT.active_mutation_scope);

function frozenByFile() {
  if (!fs.existsSync(REGISTRY)) return new Map();
  return new Map((JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).pages || []).map((p) => [p.rendered_file, p.route]));
}

function main() {
  const pages = publishedPages();
  if (!pages.length) { console.error('site-chrome: found 0 published pages'); process.exit(1); }
  const frozen = frozenByFile();
  const changed = [];
  const refused = [];
  for (const rel of pages) {
    const abs = path.join(ROOT, rel);
    const html = fs.readFileSync(abs, 'utf8');
    const out = applySiteChrome(html, rel);
    if (out === html) continue;
    if (frozen.has(rel) && withoutChrome(out) !== withoutChrome(html)) { refused.push(rel); continue; }
    fs.writeFileSync(abs, out);
    changed.push(rel);
  }
  if (refused.length) {
    console.error(`site-chrome: REFUSED ${refused.length} frozen page(s) whose change is not chrome-only: ${refused.slice(0, 10).join(', ')}`);
    process.exit(1);
  }
  const thaw = changed.filter((rel) => frozen.has(rel)).map((rel) => frozen.get(rel));
  if (thaw.length) {
    const before = fs.existsSync(SCOPE) ? fs.readFileSync(SCOPE, 'utf8') : null;
    const existing = before ? JSON.parse(before).routes || [] : [];
    fs.writeFileSync(SCOPE, JSON.stringify({ schema_version: '1.0', routes: [...new Set([...existing, ...thaw])] }, null, 2) + '\n');
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts/authority_scale/frozen_outputs.mjs'), 'freeze'], { cwd: ROOT, stdio: 'inherit' });
    } finally {
      if (before === null) fs.rmSync(SCOPE, { force: true }); else fs.writeFileSync(SCOPE, before);
    }
  }
  console.log(`site-chrome: ${pages.length} page(s) checked, ${changed.length} updated (${thaw.length} frozen, chrome-only, refrozen), ${pages.length - changed.length} already current`);
}

if (require.main === module) main();
