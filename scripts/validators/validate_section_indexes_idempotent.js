#!/usr/bin/env node
'use strict';
/**
 * Rebuilding the section indexes reproduces the committed pages exactly, related-pages block included.
 *
 * The defect (fixed 2026-10-21): scripts/generators/build_section_indexes.js rendered each section
 * index from its template and wrote it over the file on disk, dropping the
 * <section data-nav="related-pages"> block that scripts/build_related_navigation.js owns. build:all
 * never runs that script, so every rebuild stripped the related-pages links from the section
 * indexes; PR #124 rebuilt them and had to restore four by hand.
 *
 * This copies the repo to a temp dir, runs the generator and every pass build:all runs after it, in
 * build:all order, and fails on any byte of difference against the working tree. It also fails if any
 * section index (data/cadence/section_indexes.json) lacks the related-pages block, before or after the
 * rebuild, and hard-fails when it finds zero section indexes to check.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const CHAIN = [
  'scripts/generators/build_section_indexes.js',
  'scripts/install_brand_surfaces.js',
  'scripts/install_porch_packages.js',
  'scripts/generators/update_sitemap.js',
  'scripts/install_clarity.js',
  'scripts/install_site_icons.js',
  'scripts/install_contact_surface.js',
  'scripts/install_site_chrome.js',
  'scripts/normalize_public_urls.js'
];
const MARKER = 'data-nav="related-pages"';
const SKIP = new Set(['node_modules', '.git', '.pages-output', '.wrangler', '.claude', '.build']);
const errors = [];

const build = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
for (const s of CHAIN) if (!build.includes(`node ${s}`)) errors.push(`${s} is no longer in build:all; update this chain to match it`);

const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/cadence/section_indexes.json'), 'utf8'));
const indexes = (registry.routes || []).filter((r) => r.endsWith('/index.html')).map((r) => r.slice(1));
if (indexes.length < 5) errors.push(`data/cadence/section_indexes.json lists ${indexes.length} section index page(s), expected at least 5`);
for (const rel of indexes) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  if (!html.includes(MARKER)) errors.push(`${rel}: committed page has no related-pages block`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-section-idem-'));
let compared = 0;
try {
  fs.cpSync(ROOT, tmp, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) || src === ROOT });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'));
  for (const s of CHAIN) execFileSync(process.execPath, [path.join(tmp, s)], { cwd: tmp, stdio: 'pipe' });

  for (const rel of indexes) {
    if (!fs.readFileSync(path.join(tmp, rel), 'utf8').includes(MARKER)) errors.push(`${rel}: the rebuild drops the related-pages block`);
  }
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name) || e.name === 'reports') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(html|txt|xml|webmanifest|json)$/.test(e.name)) continue;
      const rel = path.relative(tmp, abs);
      const orig = path.join(ROOT, rel);
      compared += 1;
      if (!fs.existsSync(orig)) { errors.push(`${rel}: created by the rebuild, not in the working tree`); continue; }
      if (!fs.readFileSync(orig).equals(fs.readFileSync(abs))) errors.push(`${rel}: the rebuild rewrites it (run the chain and commit, or fix the owning script)`);
    }
  };
  walk(tmp);
  if (compared < 100) errors.push(`compared only ${compared} file(s); the temp copy is broken`);
} catch (e) {
  errors.push(`rebuild failed: ${(e.stderr || e.message).toString().slice(0, 400)}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (errors.length) {
  console.error(`section-indexes-idempotent: FAIL\n- ${errors.slice(0, 20).join('\n- ')}`);
  process.exit(1);
}
console.log(`section-indexes-idempotent: ${CHAIN.length} scripts run on a temp copy, ${indexes.length} section indexes carry related-pages, ${compared} files compared, zero diff`);
