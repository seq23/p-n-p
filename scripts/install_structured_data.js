#!/usr/bin/env node
'use strict';
/**
 * Structured-data pass: every page that declares og:type article gets its one
 * complete Article node (scripts/lib/article_schema.js). Chained by
 * `npm run build:sitemap` right after the lastmod ledger is written, so
 * dateModified always equals the sitemap <lastmod>.
 *
 * Frozen pages (data/release/frozen_output_registry.json) may change here only
 * inside their JSON-LD; the pass scopes them, refreezes, and restores the scope
 * file it found, the same way scripts/install_site_chrome.js does for chrome.
 * Idempotent. Exits non-zero on zero pages or a non-JSON-LD change to a frozen page.
 *
 *   node scripts/install_structured_data.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { applyArticleSchema, savePublished } = require('./lib/article_schema');
const { publishedPages } = require('./install_contact_surface');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/release/accepted_output_freeze_contract.json'), 'utf8'));
const REGISTRY = path.join(ROOT, CONTRACT.frozen_registry);
const SCOPE = path.join(ROOT, CONTRACT.active_mutation_scope);
const withoutJsonLd = (html) => html.replace(/\n?<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');

function frozenByFile() {
  if (!fs.existsSync(REGISTRY)) return new Map();
  return new Map((JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).pages || []).map((p) => [p.rendered_file, p.route]));
}

function main() {
  const pages = publishedPages();
  if (!pages.length) { console.error('structured-data: found 0 published pages'); process.exit(1); }
  const frozen = frozenByFile();
  const changed = [];
  const refused = [];
  for (const rel of pages) {
    const abs = path.join(ROOT, rel);
    const html = fs.readFileSync(abs, 'utf8');
    const out = applyArticleSchema(html, rel);
    if (out === html) continue;
    if (frozen.has(rel) && withoutJsonLd(out) !== withoutJsonLd(html)) { refused.push(rel); continue; }
    fs.writeFileSync(abs, out);
    changed.push(rel);
  }
  if (refused.length) {
    console.error(`structured-data: REFUSED ${refused.length} frozen page(s) whose change is not JSON-LD only: ${refused.slice(0, 10).join(', ')}`);
    process.exit(1);
  }
  const recorded = savePublished();
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
  console.log(`structured-data: ${pages.length} page(s) checked, ${changed.length} updated (${thaw.length} frozen, JSON-LD only, refrozen)${recorded ? ', new datePublished recorded' : ''}`);
}

if (require.main === module) main();
