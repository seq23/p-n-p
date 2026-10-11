#!/usr/bin/env node
/**
 * data/search_intelligence/index_coverage.json is a measurement, so it has to be
 * current and it has to account for every URL the sitemap submits.
 *
 * Hard-fails when:
 *   - the file is missing, or collected_at is more than MAX_AGE_DAYS old (the
 *     daily cycle writes it; two missed days means the step stopped running);
 *   - its coverage-state counts, its bucket counts and its URL rows do not all
 *     sum to its sitemap_url_count;
 *   - a URL in today's sitemap.xml is absent from the file, unless that URL's
 *     lastmod is on or after the collection date (added since; the next run
 *     inspects it).
 * A NAMED_STOP state passes and is printed with its owner step: the stop is the
 * visible outcome, and every URL it could not reach is counted as NOT_INSPECTED.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const REL = 'data/search_intelligence/index_coverage.json';
const MAX_AGE_DAYS = 2;
const errors = [];
const fail = (m) => errors.push(m);

const file = path.join(ROOT, REL);
if (!fs.existsSync(file)) {
  console.error(`index-coverage: FAIL - ${REL} is missing; the daily cycle step "Measure index coverage" writes it`);
  process.exit(1);
}
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const now = process.env.INDEX_COVERAGE_NOW ? Date.parse(process.env.INDEX_COVERAGE_NOW) : Date.now();
const collected = Date.parse(doc.collected_at);
if (!Number.isFinite(collected)) fail(`collected_at ${JSON.stringify(doc.collected_at)} is not a timestamp`);
else if ((now - collected) / 86400000 > MAX_AGE_DAYS) fail(`collected_at ${doc.collected_at} is older than ${MAX_AGE_DAYS} days`);

const n = Number(doc.sitemap_url_count);
const sum = (o) => Object.values(o || {}).reduce((a, v) => a + Number(v || 0), 0);
const rows = doc.urls || [];
if (!(n > 0)) fail('sitemap_url_count is not a positive number');
if (sum(doc.summary?.by_coverage_state) !== n) fail(`by_coverage_state sums to ${sum(doc.summary?.by_coverage_state)}, not sitemap_url_count ${n}`);
if (sum(doc.summary?.buckets) !== n) fail(`buckets sum to ${sum(doc.summary?.buckets)}, not sitemap_url_count ${n}`);
if (rows.length !== n) fail(`${rows.length} URL rows for sitemap_url_count ${n}`);
if (new Set(rows.map((r) => r.url)).size !== rows.length) fail('duplicate URL rows');
for (const r of rows) if (!r.url || !r.coverageState) fail(`row without url/coverageState: ${JSON.stringify(r).slice(0, 120)}`);

const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const day = Number.isFinite(collected) ? new Date(collected).toISOString().slice(0, 10) : '9999-12-31';
const inFile = new Set(rows.map((r) => r.url));
for (const m of xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?<\/url>/g)) {
  if (!inFile.has(m[1]) && !(m[2] && m[2] >= day)) fail(`${m[1]} is in sitemap.xml but not in ${REL}, and was not added after ${day}`);
}

if (errors.length) {
  console.error(`index-coverage: FAIL (${errors.length})`);
  errors.slice(0, 15).forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
const b = doc.summary.buckets;
console.log(`index-coverage: OK - ${doc.state} at ${doc.collected_at}; ${n} URLs: indexed ${b.indexed}, crawled-not-indexed ${b.crawled_not_indexed}, discovered-not-indexed ${b.discovered_not_indexed}, other ${b.other}, not inspected ${b.not_inspected}`);
if (doc.named_stop) console.log(`  ${doc.named_stop}`);
