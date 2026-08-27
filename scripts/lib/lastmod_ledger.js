'use strict';
/**
 * Per-URL lastmod ledger: a freshness date that survives a shallow clone.
 *
 * Root cause it replaces. scripts/generators/update_sitemap.js derived
 * <lastmod> from `git log -1 --format=%cs -- <file>`. That is the right idea -
 * the date should follow content, not build time - but it depends on the repo
 * having the commit history for each file, and it does not in CI.
 * .github/workflows/monthly-audit.yml and .github/workflows/deploy-distribution.yml
 * both use actions/checkout@v7 at its default depth of 1 and then run
 * `npm run build:sitemap`. In a depth-1 checkout there is exactly one commit,
 * so every file's "last commit" is that commit and every URL gets the CI run's
 * date. Verified by cloning this repo with --depth 1: index.html and
 * pricing.html report 2026-08-25 with full history and 2026-08-26 - the tip -
 * when shallow. That is the date-bump pattern scripts/cadence_gate.js flags as
 * uniform_lastmod, produced silently by the deploy path rather than locally.
 *
 * The same call also returns nothing when git is unavailable, and
 * update_sitemap.js then emitted <url> with no <lastmod> at all - which
 * data/cadence/policy.json treats as a blocking no_freshness_signal, and which
 * leaves a crawler no way to tell what changed. Recency is the strongest single
 * correlate of whether an answer engine cites a page.
 *
 * How this fixes it. The ledger stores {url: {hash, lastmod}} in
 * data/cadence/lastmod_ledger.json, beside the known_urls.json the cadence gate
 * already keeps, and follows that file's conventions rather than adding a
 * parallel system. The hash is taken over the rendered page, so a URL whose
 * content is unchanged keeps the date it already had no matter how the repo was
 * checked out, and only genuinely changed content advances. Git history is
 * still used, but only to seed a URL the ledger has never seen, and only when
 * the clone actually has the history to answer the question.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const SCHEMA = 'lastmod-ledger-v1';
const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_PATH = path.join(ROOT, 'data', 'cadence', 'lastmod_ledger.json');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const NOTE =
  'Per-URL content hash and the date that content last changed. lastmod only advances ' +
  'for a URL whose hash changed; see scripts/lib/lastmod_ledger.js. A URL the ledger has ' +
  'not seen before is seeded from its last commit date when the clone has full history, ' +
  'and from the build date otherwise. No dates are reconstructed or estimated.';

function buildDate() {
  const override = String(process.env.BUILD_DATE || '').trim();
  if (DATE.test(override)) return override;
  return new Date().toISOString().slice(0, 10);
}

/**
 * The chrome the hash ignores: <head>, <script>, <style>, <nav>, <footer>,
 * <svg>. Same list scripts/template_share.js strips before counting shingles,
 * for the same reason - none of it is what the page says.
 */
const CHROME = /<(script|style|nav|footer|head|svg)\b[\s\S]*?<\/\1>/gi;
const TAG = /<[^>]+>/g;

/**
 * What a reader actually sees on the page, normalised for comparison.
 *
 * Hashing the raw bytes made every mechanical edit look like new content.
 * Adding a related-pages nav to all 109 pages would have advanced all 109
 * lastmod values to the same build day - the uniform_lastmod pattern
 * scripts/cadence_gate.js flags and the exact date-bump this module was written
 * to remove, just arriving from the repo instead of from CI. Site chrome is not
 * the page's content and must not move its freshness date; a prose edit still
 * does, because prose is what is left after the strip.
 */
function visibleText(payload) {
  const text = String(payload instanceof Buffer ? payload.toString('utf8') : payload)
    .replace(CHROME, ' ')
    .replace(TAG, ' ');
  return text.split(/\s+/).filter(Boolean).join(' ');
}

function contentHash(payload) {
  return crypto.createHash('sha256').update(visibleText(payload), 'utf8').digest('hex');
}

/**
 * True only when this clone can actually answer "when did this file last
 * change". A shallow clone answers "at the tip" for every file, which is the
 * defect this module exists to remove - so it must never be trusted for dates.
 */
function hasFullHistory() {
  try {
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return shallow === 'false';
  } catch {
    return false;
  }
}

function lastCommitDate(rel) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', rel], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return DATE.test(out) ? out : '';
  } catch {
    return '';
  }
}

function load(ledgerPath = DEFAULT_PATH) {
  if (!fs.existsSync(ledgerPath)) return { schema: SCHEMA, note: NOTE, seeded_on: null, entries: {} };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  } catch {
    // A corrupt ledger must not silently degrade to "everything changed today".
    throw new Error(`lastmod ledger is not valid JSON: ${ledgerPath}`);
  }
  if (!data.entries || typeof data.entries !== 'object') data.entries = {};
  return data;
}

/**
 * Map {url: {hash, file}} to {url: lastmod}. Pure: reads, never writes.
 *
 * `file` is the repo-relative path backing the URL, used only to seed a URL the
 * ledger has never recorded.
 */
function resolve(pages, ledger, today, opts = {}) {
  const day = today || buildDate();
  const entries = (ledger && ledger.entries) || {};
  const trustGit = opts.trustGit === undefined ? hasFullHistory() : opts.trustGit;
  const out = {};
  for (const [url, page] of Object.entries(pages)) {
    const prev = entries[url];
    if (prev && prev.hash === page.hash && DATE.test(String(prev.lastmod))) {
      out[url] = prev.lastmod;
    } else if (!prev && trustGit) {
      // First sighting. A commit date is a recorded fact about when this file's
      // content changed, so it is evidence, not a guess - but only in a clone
      // that has the history. Otherwise fall back to today.
      out[url] = lastCommitDate(page.file) || day;
    } else {
      out[url] = day;
    }
  }
  return out;
}

/** The ledger to persist. `prune` drops URLs the run did not see. */
function rebuilt(pages, ledger, today, opts = {}) {
  const day = today || buildDate();
  const resolved = resolve(pages, ledger, day, opts);
  const entries = opts.prune ? {} : Object.assign({}, (ledger && ledger.entries) || {});
  for (const [url, page] of Object.entries(pages)) {
    entries[url] = { hash: page.hash, lastmod: resolved[url] };
  }
  const sorted = {};
  for (const url of Object.keys(entries).sort()) sorted[url] = entries[url];
  return {
    schema: SCHEMA,
    note: NOTE,
    seeded_on: (ledger && ledger.seeded_on) || day,
    entries: sorted
  };
}

function save(ledger, ledgerPath = DEFAULT_PATH) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const tmp = `${ledgerPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, ledgerPath);
}

module.exports = { SCHEMA, DEFAULT_PATH, buildDate, visibleText, contentHash, hasFullHistory, lastCommitDate, load, resolve, rebuilt, save };
