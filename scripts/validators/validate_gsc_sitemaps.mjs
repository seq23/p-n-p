#!/usr/bin/env node
/**
 * data/search_intelligence/gsc_sitemaps.json is the daily cycle's record of
 * Search Console sitemaps.list (before and after any submit). Hard-fails when the
 * file is missing, older than MAX_AGE_DAYS, or does not show the sitemap listed
 * in the recorded list_after response. A NAMED_STOP passes and is printed with
 * its owner step.
 */
import fs from 'node:fs';

const REL = 'data/search_intelligence/gsc_sitemaps.json';
const MAX_AGE_DAYS = 2;
if (!fs.existsSync(REL)) { console.error(`gsc-sitemaps: FAIL - ${REL} is missing; the daily cycle step "Measure index coverage" writes it`); process.exit(1); }
const doc = JSON.parse(fs.readFileSync(REL, 'utf8'));
const errors = [];
const now = process.env.GSC_SITEMAPS_NOW ? Date.parse(process.env.GSC_SITEMAPS_NOW) : Date.now();
const at = Date.parse(doc.collected_at);
if (!Number.isFinite(at)) errors.push(`collected_at ${JSON.stringify(doc.collected_at)} is not a timestamp`);
else if ((now - at) / 86400000 > MAX_AGE_DAYS) errors.push(`collected_at ${doc.collected_at} is older than ${MAX_AGE_DAYS} days`);
const robots = fs.readFileSync('robots.txt', 'utf8');
if (!robots.includes(`Sitemap: ${doc.sitemap_url}`)) errors.push(`robots.txt does not declare ${doc.sitemap_url}`);
if (doc.state === 'NAMED_STOP') {
  if (errors.length) { console.error(`gsc-sitemaps: FAIL`); errors.forEach((e) => console.error(`  - ${e}`)); process.exit(1); }
  console.log(`gsc-sitemaps: ${doc.stop}`);
  process.exit(0);
}
const entry = (doc.list_after?.sitemap || []).find((s) => s.path === doc.sitemap_url);
if (doc.state !== 'REGISTERED') errors.push(`state is ${doc.state}, not REGISTERED`);
if (!entry) errors.push(`${doc.sitemap_url} is not in the recorded sitemaps.list response`);
if (errors.length) { console.error(`gsc-sitemaps: FAIL (${errors.length})`); errors.forEach((e) => console.error(`  - ${e}`)); process.exit(1); }
console.log(`gsc-sitemaps: OK - ${doc.sitemap_url} registered on ${doc.site} at ${doc.collected_at}; lastDownloaded ${entry.lastDownloaded || 'never'}, errors ${entry.errors ?? 0}`);
