#!/usr/bin/env node
/**
 * Normalize every public URL this site emits about itself to the form the
 * origin actually serves with a 200.
 *
 * WHY THIS IS A BUILD PASS AND NOT A ONE-OFF EDIT
 * ----------------------------------------------
 * Ten different scripts in this repo write a URL or an href into a published
 * page: `templates/page-shell.js`, the section-index builder, the related-nav
 * retrofit, three thin/root/answer-card retrofits, the 404 builder, and the
 * sitemap generator. Chasing the `.html` form out of each of them individually
 * leaves ten independent lists that have to stay in agreement, which is the
 * failure mode this repo has already been bitten by. Instead every emitter is
 * allowed to write whatever it likes and this pass — the last writer before a
 * page is published, alongside `install_clarity.js` and
 * `build_related_navigation.js` — decides the public form, from the single
 * definition in `scripts/lib/site_url.js`.
 *
 * `npm run validate:canonical-resolves` then asserts the result independently,
 * so this pass is guarded rather than trusted.
 *
 * It is idempotent: running it twice changes nothing the second time, which is
 * what makes it safe to leave at the end of `build:all`.
 *
 * It never removes markup, so it cannot strip the Clarity tag or the
 * related-pages block that `validate:retrofit-integrity` protects.
 *
 * Usage:
 *   node scripts/normalize_public_urls.js            # rewrite in place
 *   node scripts/normalize_public_urls.js --check    # report only, exit 1 if work remains
 */

const fs = require('fs');
const path = require('path');
const { normalizeHtmlUrls } = require('./lib/site_url');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', '.pages-output', '.build', 'dist', '.clarity']);
const CHECK_ONLY = process.argv.includes('--check');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
if (!files.length) {
  console.error('NORMALIZE PUBLIC URLS FAILED: walked the tree and found zero HTML files. The scan is broken, not the site.');
  process.exit(1);
}

const changed = [];
for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  const after = normalizeHtmlUrls(before);
  if (after === before) continue;
  changed.push(path.relative(ROOT, file));
  if (!CHECK_ONLY) fs.writeFileSync(file, after);
}

if (CHECK_ONLY) {
  if (changed.length) {
    console.error(`PUBLIC URL FORM: ${changed.length} of ${files.length} page(s) still emit a redirecting URL form:`);
    for (const rel of changed.slice(0, 25)) console.error(`- ${rel}`);
    process.exit(1);
  }
  console.log(`PUBLIC URL FORM: OK (${files.length} page(s) already emit only URLs the origin serves directly)`);
} else {
  console.log(`PUBLIC URL FORM: normalized ${changed.length} of ${files.length} page(s) to the 200-serving URL form`);
}
