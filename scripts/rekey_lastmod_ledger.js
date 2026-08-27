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
 * Usage: node scripts/rekey_lastmod_ledger.js [--check]
 *   --check exits 1 if any entry is still keyed under the old scheme.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ledgerLib = require('./lib/lastmod_ledger');

const CHECK = process.argv.includes('--check');
const DOMAIN = 'https://porchandparty901.com';

function fileFor(url) {
  const rel = url.startsWith(DOMAIN) ? url.slice(DOMAIN.length) : url;
  const clean = rel.replace(/^\//, '') || 'index.html';
  for (const candidate of [clean, `${clean}.html`, path.join(clean, 'index.html')]) {
    if (fs.existsSync(path.join(ROOT, candidate))) return candidate;
  }
  return null;
}

const ledger = ledgerLib.load();
const entries = ledger.entries || {};
let rekeyed = 0;
let missing = 0;
let unchanged = 0;

for (const [url, entry] of Object.entries(entries)) {
  const rel = fileFor(url);
  if (!rel) {
    missing += 1;
    continue;
  }
  const hash = ledgerLib.contentHash(fs.readFileSync(path.join(ROOT, rel)));
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
  dates_changed: 0
};

if (CHECK) {
  console.log(JSON.stringify(receipt, null, 2));
  process.exit(rekeyed ? 1 : 0);
}

if (rekeyed) ledgerLib.save(Object.assign({}, ledger, { entries }));
console.log(JSON.stringify(receipt, null, 2));
