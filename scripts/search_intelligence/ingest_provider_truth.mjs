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
  runDate,
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
    if (!url) continue;
    byPage.set(url, {
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
  const pageRow = target.expected_owned_url ? byPage.get(target.expected_owned_url) || null : null;
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

const out = {
  schema_version: '1.0',
  contract: contract.contract,
  stage: 'provider_truth',
  generated_at: runStamp(),
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
  requested_for_date: runDate(),
  target_count: perTarget.length,
  targets_with_gsc_rows: withRows.length,
  total_impressions: withRows.reduce((sum, t) => sum + (t.query_metrics?.impressions || 0), 0),
  total_clicks: withRows.reduce((sum, t) => sum + (t.query_metrics?.clicks || 0), 0),
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
