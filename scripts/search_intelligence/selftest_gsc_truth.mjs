#!/usr/bin/env node
// Fixture test for the GSC truth builder (ingest_provider_truth.mjs).
//
// 2026-10-11: the daily cycle collected a real export (22 queries, 66
// impressions) and gsc_truth.json still read 0 impressions, 0 clicks and a
// 1970-01-01 stamp: totals were summed over the long-tail target join only, the
// stamp fell back to the epoch when no run date was pinned, and page rows under
// www. never met the apex target URLs. This feeds a small synthetic export
// through the real builder and asserts real totals, the target-match count and
// a real timestamp. Output goes to a temp file; the repo is never mutated.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-gsc-truth-'));
const targets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/search_intelligence/target_query_set.json'), 'utf8')).targets;
const pageTarget = targets.find((t) => t.expected_owned_url);
const queryTarget = targets.find((t) => t !== pageTarget && t.query);

const collectedAt = '2026-10-11T02:40:15.118585+00:00';
const fixture = {
  schema_version: '1.0',
  truth_source: 'google_search_console',
  site_url: 'sc-domain:porchandparty901.com',
  start_date: '2026-09-11',
  end_date: '2026-10-08',
  collected_at: collectedAt,
  // Mixed case + punctuation: matching must normalise, not compare exact strings.
  by_query: [
    { keys: [`  ${queryTarget.query.toUpperCase()}!! `], clicks: 2, impressions: 9, ctr: 0.22, position: 4.5 },
    { keys: ['party planner near me'], clicks: 0, impressions: 6, ctr: 0, position: 34 }
  ],
  // Google reports the www. host; the target names the apex canonical.
  by_page: [
    { keys: [pageTarget.expected_owned_url.replace('://', '://www.')], clicks: 1, impressions: 11, ctr: 0.09, position: 12 },
    { keys: ['https://www.porchandparty901.com/'], clicks: 1, impressions: 8, ctr: 0.12, position: 20 }
  ],
  by_query_page: [],
  counts: { by_query: 2, by_page: 2, by_query_page: 0 }
};
const exportPath = path.join(tmp, 'export.json');
const outPath = path.join(tmp, 'truth.json');
fs.writeFileSync(exportPath, JSON.stringify(fixture));

const env = { ...process.env, SEARCH_INTELLIGENCE_GSC_EXPORT: path.relative(ROOT, exportPath), SEARCH_INTELLIGENCE_TRUTH_OUT: path.relative(ROOT, outPath) };
for (const k of ['SEARCH_INTELLIGENCE_RUN_AT', 'AUTHORITY_RUN_AT', 'SEARCH_INTELLIGENCE_RUN_DATE', 'AUTHORITY_RUN_DATE']) delete env[k];
execFileSync(process.execPath, ['scripts/search_intelligence/ingest_provider_truth.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'ignore', 'inherit'] });
const truth = JSON.parse(fs.readFileSync(outPath, 'utf8'));
fs.rmSync(tmp, { recursive: true, force: true });

// Several targets can share one owned URL; each carries the page row. The
// fixture also has a homepage row, so targets now assigned to / match it too.
const norm = (q) => String(q || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const expectedMatches = targets.filter(
  (t) => [pageTarget.expected_owned_url, 'https://porchandparty901.com/'].includes(t.expected_owned_url) || norm(t.query) === norm(queryTarget.query) || norm(t.query) === 'party planner near me'
).length;
const byId = new Map(truth.per_target.map((t) => [t.target_id, t]));
const checks = [
  ['provider_state OK', truth.provider_state === 'OK'],
  ['total_impressions = by_page sum (19)', truth.total_impressions === 19],
  ['total_clicks = by_page sum (2)', truth.total_clicks === 2],
  ['pages_with_impressions = 2', truth.site_totals?.pages_with_impressions === 2],
  ['queries_with_impressions = 2', truth.site_totals?.queries_with_impressions === 2],
  ['top query is the 9-impression row', truth.site_totals?.top_queries?.[0]?.impressions === 9],
  ['query target matched despite case/punctuation', byId.get(queryTarget.target_id)?.query_metrics?.impressions === 9],
  ['www. page row matched the apex target URL', byId.get(pageTarget.target_id)?.page_metrics?.impressions === 11],
  [`targets_with_gsc_rows = ${expectedMatches} (>= 2)`, expectedMatches >= 2 && truth.targets_with_gsc_rows === expectedMatches],
  ['generated_at is a real timestamp, not 1970', truth.generated_at === new Date(collectedAt).toISOString()],
  ['requested_for_date is not 1970', truth.requested_for_date === '2026-10-11']
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
if (failed.length || checks.length === 0) {
  console.error(`selftest_gsc_truth: ${failed.length} of ${checks.length} checks failed`);
  process.exit(1);
}
console.log(`selftest_gsc_truth: ${checks.length}/${checks.length} checks passed`);
