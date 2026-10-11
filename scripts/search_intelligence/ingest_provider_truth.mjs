#!/usr/bin/env node
// Stage 4 — real provider truth.
//
// Hard Rule 3: Google Search Console is the authority for actual own-site Google
// performance. This stage normalizes a real GSC Search Analytics export produced
// by distribution_scripts/gsc_search_analytics.py and joins it to the target set.
//
// Hard Rule 4: if the export is absent, stale, or malformed, this reports
// UNAVAILABLE/DEGRADED with evidence. It never invents rows and never goes green.

import fs from 'node:fs';
import path from 'node:path';
import {
  loadContract,
  readJson,
  writeJson,
  runStamp,
  resolveProviderState,
  deriveOverallStatus,
  stableSort,
  printStageSummary,
  ROOT,
  PROVIDER_OK,
  PROVIDER_DEGRADED,
  PROVIDER_UNAVAILABLE
} from './lib/si_core.mjs';

const contract = loadContract();
const gscCfg = contract.providers.search_console;
const exportPath = process.env.SEARCH_INTELLIGENCE_GSC_EXPORT || gscCfg.export_path;
const outputPath = process.env.SEARCH_INTELLIGENCE_TRUTH_OUT || 'data/search_intelligence/gsc_truth.json';

const targetSet = readJson('data/search_intelligence/target_query_set.json', { targets: [] });
const credentialState = resolveProviderState(gscCfg, { name: 'search_console' });

let exportFile = null;
let exportProblem = null;
if (fs.existsSync(path.join(ROOT, exportPath))) {
  try {
    exportFile = JSON.parse(fs.readFileSync(path.join(ROOT, exportPath), 'utf8'));
    if (exportFile.truth_source !== 'google_search_console') {
      exportProblem = 'EXPORT_TRUTH_SOURCE_IS_NOT_GOOGLE_SEARCH_CONSOLE';
      exportFile = null;
    } else if (!Array.isArray(exportFile.by_query)) {
      exportProblem = 'EXPORT_MISSING_BY_QUERY_ROWS';
      exportFile = null;
    }
  } catch (err) {
    exportProblem = `EXPORT_UNPARSEABLE: ${err.message}`;
  }
} else {
  exportProblem = 'EXPORT_NOT_PRESENT';
}

let providerState;
if (exportFile) {
  providerState = {
    provider: 'search_console',
    provider_id: gscCfg.provider_id,
    state: PROVIDER_OK,
    reason: 'REAL_EXPORT_INGESTED',
    evidence: `${exportPath} collected_at=${exportFile.collected_at} rows=${JSON.stringify(exportFile.counts || {})}`
  };
} else if (credentialState.state === PROVIDER_OK) {
  providerState = {
    ...credentialState,
    state: PROVIDER_DEGRADED,
    reason: `CREDENTIAL_PRESENT_BUT_${exportProblem}`,
    evidence: `Credentials resolved but no usable export at ${exportPath}. Run ${gscCfg.collector} to collect real rows.`
  };
} else {
  providerState = {
    ...credentialState,
    reason: `${credentialState.reason}_AND_${exportProblem}`,
    evidence: `${credentialState.evidence} No usable export at ${exportPath}.`
  };
}

// Google reports pages under whichever host it indexed (www. or apex) and the
// targets name the apex canonical, so a page is keyed by host-without-www + path.
function normalizePageKey(value) {
  try {
    const u = new URL(String(value || ''));
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = u.pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/';
    return `${host}${pathname}`;
  } catch {
    return '';
  }
}

function sumRows(rows, field) {
  return (rows || []).reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
}

function normalizeQueryKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const byQuery = new Map();
const byPage = new Map();

if (exportFile) {
  for (const row of exportFile.by_query || []) {
    const key = normalizeQueryKey((row.keys || [])[0]);
    if (!key) continue;
    byQuery.set(key, {
      gsc_query: (row.keys || [])[0],
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      gsc_average_position: row.position ?? null
    });
  }
  for (const row of exportFile.by_page || []) {
    const url = (row.keys || [])[0];
    const key = normalizePageKey(url);
    if (!key) continue;
    byPage.set(key, {
      url,
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      gsc_average_position: row.position ?? null
    });
  }
}

const perTarget = targetSet.targets.map((target) => {
  const queryRow = byQuery.get(normalizeQueryKey(target.query)) || null;
  const pageRow = target.expected_owned_url ? byPage.get(normalizePageKey(target.expected_owned_url)) || null : null;
  return {
    target_id: target.target_id,
    query: target.query,
    expected_owned_url: target.expected_owned_url || null,
    truth_source: exportFile ? gscCfg.provider_id : null,
    truth_state: exportFile ? (queryRow || pageRow ? 'GSC_ROW_PRESENT' : 'GSC_NO_ROW_FOR_TARGET') : 'GSC_TRUTH_UNAVAILABLE',
    query_metrics: queryRow,
    page_metrics: pageRow,
    own_site_performance_basis: exportFile ? gscCfg.provider_id : null,
    truth_boundary: exportFile
      ? 'Real Google Search Console metrics for the verified property. gsc_average_position is Google averaged position, not a single observed SERP rank.'
      : 'No Google Search Console truth was available for this target. No own-site Google performance may be asserted.'
  };
});

const overall = deriveOverallStatus([providerState], { requiredProviders: ['search_console'] });
const withRows = perTarget.filter((t) => t.truth_state === 'GSC_ROW_PRESENT');

// Site totals come from the export itself, never from the target join: on
// 2026-10-11 Google returned 22 real queries / 66 impressions while
// total_impressions read 0, because it summed only the 120 long-tail targets
// (none of which Google has shown yet). by_page is the complete total; by_query
// omits anonymised queries, so its sum is reported separately.
const siteTotals = exportFile
  ? {
      basis: 'by_page rows of the Search Console export (complete; by_query omits anonymised queries)',
      clicks: sumRows(exportFile.by_page, 'clicks'),
      impressions: sumRows(exportFile.by_page, 'impressions'),
      pages_with_impressions: (exportFile.by_page || []).filter((r) => (r.impressions || 0) > 0).length,
      queries_with_impressions: (exportFile.by_query || []).filter((r) => (r.impressions || 0) > 0).length,
      query_row_impressions: sumRows(exportFile.by_query, 'impressions'),
      query_row_clicks: sumRows(exportFile.by_query, 'clicks'),
      top_queries: [...(exportFile.by_query || [])]
        .sort((a, b) => (b.impressions || 0) - (a.impressions || 0) || String(a.keys?.[0]).localeCompare(String(b.keys?.[0])))
        .slice(0, 10)
        .map((r) => ({
          query: (r.keys || [])[0],
          impressions: r.impressions ?? 0,
          clicks: r.clicks ?? 0,
          gsc_average_position: r.position ?? null
        }))
    }
  : null;

// A run stamp is the env-pinned run date; without one, the export's own
// collected_at (deterministic for a given input). Never the 1970 epoch for real data.
const EPOCH = '1970-01-01T00:00:00.000Z';
const stamp = runStamp() !== EPOCH ? runStamp() : exportFile?.collected_at ? new Date(exportFile.collected_at).toISOString() : EPOCH;

const out = {
  schema_version: '1.0',
  contract: contract.contract,
  stage: 'provider_truth',
  generated_at: stamp,
  own_site_google_performance_authority: contract.own_site_google_performance_authority,
  provider_state: providerState.state,
  provider_states: [providerState],
  overall_status: overall,
  status_is_healthy: overall === PROVIDER_OK,
  export_path: exportPath,
  export_problem: exportFile ? null : exportProblem,
  export_window: exportFile ? { start_date: exportFile.start_date, end_date: exportFile.end_date } : null,
  export_collected_at: exportFile ? exportFile.collected_at : null,
  export_counts: exportFile ? exportFile.counts || {} : null,
  requested_for_date: stamp.slice(0, 10),
  target_count: perTarget.length,
  targets_with_gsc_rows: withRows.length,
  total_impressions: siteTotals ? siteTotals.impressions : 0,
  total_clicks: siteTotals ? siteTotals.clicks : 0,
  site_totals: siteTotals,
  target_impressions: withRows.reduce((sum, t) => sum + (t.query_metrics?.impressions || t.page_metrics?.impressions || 0), 0),
  target_clicks: withRows.reduce((sum, t) => sum + (t.query_metrics?.clicks || t.page_metrics?.clicks || 0), 0),
  unavailable_note: exportFile
    ? null
    : `Google Search Console truth is ${providerState.state}. Reason: ${providerState.reason}. Collect real rows with: python3 ${gscCfg.collector} <service-account.json> "$GSC_SITE_URL" <startDate> <endDate> ${exportPath}`,
  truth_boundary:
    'Google Search Console is the only authority for own-site Google impressions, clicks, CTR, average position, and indexation in this repo.',
  per_target: stableSort(perTarget, (t) => t.target_id)
};

writeJson(outputPath, out);
printStageSummary('provider_truth', {
  provider_state: providerState.state,
  overall_status: overall,
  targets_with_gsc_rows: withRows.length,
  export_problem: out.export_problem
});
