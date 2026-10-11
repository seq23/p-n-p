#!/usr/bin/env node
'use strict';
/**
 * Re-key the lastmod ledger onto the content hash without moving a single date.
 *
 * Why this is needed exactly once. `scripts/lib/lastmod_ledger.js` used to hash
 * the raw bytes of a rendered page; it now hashes the page's visible text, with
 * <head>, <script>, <style>, <nav>, <footer> and <svg> stripped, so that site
 * chrome cannot advance a freshness date. Every hash already stored in
 * data/cadence/lastmod_ledger.json was taken under the old scheme, so on the
 * next `npm run build:sitemap` every URL would fail its hash comparison and be
 * stamped with the build date - which is the uniform_lastmod date-bump the
 * ledger exists to prevent, arriving through the fix rather than the defect.
 *
 * What this does. For every URL the ledger already records, it recomputes the
 * hash under the new scheme from the file on disk and writes that hash back
 * beside the lastmod the ledger already held. No date is read, changed,
 * estimated or reconstructed: the `lastmod` field is copied through untouched.
 * A URL whose backing file is missing is left exactly as it was.
 *
 * Run it before injecting navigation, or after - the answer is the same either
 * way, because navigation is not part of the visible text the new hash covers.
 *
 * Usage: node scripts/rekey_lastmod_ledger.js [--check] [--restore-from <rev>]
 *   --check exits 1 if any entry is still keyed under the old scheme.
 *   --restore-from <rev> repairs dates that a hash-scheme defect already
 *     advanced. For each URL it hashes the page as it stood at <rev> and as it
 *     stands now, both under the CURRENT scheme; when the two are identical the
 *     page's content did not change between them, so the lastmod the ledger
 *     held at <rev> is restored. Any page whose content did change keeps the
 *     date it has now. Dates are only ever copied from a committed ledger,
 *     never estimated. Used once on 2026-10-10 with <rev> = acc2886, the last
 *     ledger before PR #25 moved every hash (see scripts/lib/lastmod_ledger.js).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ledgerLib = require('./lib/lastmod_ledger');

const CHECK = process.argv.includes('--check');
const restoreAt = process.argv.indexOf('--restore-from');
const RESTORE_REV = restoreAt >= 0 ? process.argv[restoreAt + 1] : null;
if (restoreAt >= 0 && !RESTORE_REV) throw new Error('--restore-from needs a git revision');
const { execFileSync } = require('child_process');
const gitShow = (rev, rel) => {
  try {
    return execFileSync('git', ['show', `${rev}:${rel}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
};
const revLedger = RESTORE_REV ? JSON.parse(String(gitShow(RESTORE_REV, path.relative(ROOT, ledgerLib.DEFAULT_PATH)) || '{}')).entries || {} : {};
const DOMAIN = 'https://porchandparty901.com';

function fileFor(url) {
  const rel = url.startsWith(DOMAIN) ? url.slice(DOMAIN.length) : url;
  // Section indexes are served at the directory (/answers/), so the trailing
  // slash is stripped and only a FILE is accepted - `answers/` is a directory.
  const clean = rel.replace(/^\//, '').replace(/\/$/, '') || 'index.html';
  for (const candidate of [clean, `${clean}.html`, path.join(clean, 'index.html')]) {
    const abs = path.join(ROOT, candidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return candidate;
  }
  return null;
}

const ledger = ledgerLib.load();
const entries = ledger.entries || {};
let rekeyed = 0;
let missing = 0;
let unchanged = 0;
let restored = 0;

for (const [url, entry] of Object.entries(entries)) {
  const rel = fileFor(url);
  if (!rel) {
    missing += 1;
    continue;
  }
  const hash = ledgerLib.contentHash(fs.readFileSync(path.join(ROOT, rel)));
  if (RESTORE_REV) {
    const then = gitShow(RESTORE_REV, rel);
    const prior = revLedger[url];
    if (then && prior && /^\d{4}-\d{2}-\d{2}$/.test(String(prior.lastmod)) && ledgerLib.contentHash(then) === hash) {
      if (entry.lastmod !== prior.lastmod) restored += 1;
      entries[url] = { hash, lastmod: prior.lastmod };
      continue;
    }
  }
  if (hash === entry.hash) {
    unchanged += 1;
    continue;
  }
  // The date is copied, not recomputed. This is a change of fingerprint, not a
  // statement that the page changed.
  entries[url] = { hash, lastmod: entry.lastmod };
  rekeyed += 1;
}

const receipt = {
  ledger: path.relative(ROOT, ledgerLib.DEFAULT_PATH),
  urls: Object.keys(entries).length,
  rekeyed,
  already_current: unchanged,
  file_missing: missing,
  restored_from: RESTORE_REV,
  dates_restored: restored
};

if (CHECK) {
  console.log(JSON.stringify(receipt, null, 2));
  process.exit(rekeyed ? 1 : 0);
}

if (rekeyed || restored) ledgerLib.save(Object.assign({}, ledger, { entries }));
console.log(JSON.stringify(receipt, null, 2));
