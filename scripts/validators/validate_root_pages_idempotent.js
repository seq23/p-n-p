#!/usr/bin/env node
'use strict';
/**
 * The root-page pipeline reproduces the committed pages exactly.
 *
 * The defect (fixed 2026-10-18): scripts/retrofit_root_pages.js stripped its
 * blocks and re-appended them at </head> and </main>, after the blocks later
 * passes had added there, and emitted a business node in a shape
 * scripts/lib/contact_surface.js then rewrote. A fresh run moved JSON-LD and
 * the FAQ section on contact.html, how-it-works.html, pricing.html,
 * privacy-policy.html and terms-and-conditions.html, so nobody could re-run
 * the pipeline without a conflict against scripts/install_brand_surfaces.js
 * and the contact-surface pass.
 *
 * This copies the repo to a temp dir, runs the whole chain there (the
 * retrofit, then every pass that writes those pages, in build:all order),
 * and fails on any byte of difference against the working tree. It also
 * fails if the chain wrote zero pages' worth of checks (an inert run) or if
 * the retrofit no longer covers its five root pages.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const CHAIN = [
  'scripts/retrofit_root_pages.js',
  'scripts/install_brand_surfaces.js',
  'scripts/install_porch_packages.js',
  'scripts/install_clarity.js',
  'scripts/install_site_icons.js',
  'scripts/install_contact_surface.js',
  'scripts/install_site_chrome.js',
  'scripts/normalize_public_urls.js',
  // The last two passes in build:all (added 2026-10-25 for her Search Readiness
  // Checklist items b6 and d4): the social-card tags and the visible
  // published/updated line. They are part of the pipeline, so a page that is
  // idempotent without them and not with them is still a page the next build
  // rewrites.
  'scripts/install_social_tags.js',
  'scripts/install_page_dates.js'
];
const SKIP = new Set(['node_modules', '.git', '.pages-output', '.wrangler', '.claude']);
const errors = [];

const { PAGES } = require('../retrofit_root_pages');
const pages = Object.keys(PAGES);
if (pages.length < 5) errors.push(`retrofit_root_pages covers ${pages.length} page(s), expected the 5 root pages`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-root-idem-'));
try {
  fs.cpSync(ROOT, tmp, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) || src === ROOT });
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'));
  for (const s of CHAIN) execFileSync(process.execPath, [path.join(tmp, s)], { cwd: tmp, stdio: 'pipe' });

  let compared = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name) || e.name === 'reports') continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!/\.(html|txt|webmanifest|json)$/.test(e.name)) continue;
      const rel = path.relative(tmp, abs);
      const orig = path.join(ROOT, rel);
      compared += 1;
      if (!fs.existsSync(orig)) { errors.push(`${rel}: created by the pipeline, not in the working tree`); continue; }
      if (!fs.readFileSync(orig).equals(fs.readFileSync(abs))) errors.push(`${rel}: the pipeline rewrites it (run the chain and commit, or fix the owning script)`);
    }
  };
  walk(tmp);
  if (compared < 100) errors.push(`compared only ${compared} file(s); the temp copy is broken`);
  if (!errors.length) console.log(`root-pages-idempotent: ${CHAIN.length} scripts run on a temp copy, ${compared} files compared, zero diff`);
} catch (e) {
  errors.push(`pipeline failed: ${(e.stderr || e.message).toString().slice(0, 400)}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (errors.length) {
  console.error(`root-pages-idempotent: FAIL\n- ${errors.slice(0, 20).join('\n- ')}`);
  process.exit(1);
}
