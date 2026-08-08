#!/usr/bin/env node
// Stage 7 — same-query retest.
//
// Captures the current observation + GSC truth for exactly the queries that a
// repair candidate targeted, so before/after comparison is like-for-like.
// It snapshots whatever the current artifacts hold; it does not call providers
// itself. Run the observation and truth stages first to refresh them.
//
// Usage:
//   node scripts/search_intelligence/retest_queries.mjs baseline
//   node scripts/search_intelligence/retest_queries.mjs after-repair

import {
  loadContract,
  readJson,
  writeJson,
  runStamp,
  stableSort,
  printStageSummary,
  PROVIDER_OK,
  PROVIDER_UNAVAILABLE
} from './lib/si_core.mjs';

const contract = loadContract();
const label = (process.argv[2] || process.env.SEARCH_INTELLIGENCE_RETEST_LABEL || 'baseline').trim();
const snapshotsPath = 'data/search_intelligence/retest_snapshots.json';

const observations = readJson('data/search_intelligence/live_search_observations.json', {
  observations: [],
  provider_state: PROVIDER_UNAVAILABLE
});
const truth = readJson('data/search_intelligence/gsc_truth.json', {
  per_target: [],
  provider_state: PROVIDER_UNAVAILABLE
});
const repairs = readJson('data/search_intelligence/repair_candidates.json', { candidates: [] });
const diagnosis = readJson('data/search_intelligence/search_diagnosis.json', { diagnoses: [] });

const obsByTarget = new Map((observations.observations || []).map((o) => [o.target_id, o]));
const truthByTarget = new Map((truth.per_target || []).map((t) => [t.target_id, t]));
const diagByTarget = new Map((diagnosis.diagnoses || []).map((d) => [d.target_id, d]));

// Retest exactly the repair-candidate queries. If none exist yet, snapshot the
// full diagnosed set so a baseline is still available for a later comparison.
const explicit = (process.env.SEARCH_INTELLIGENCE_RETEST_TARGET_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const targetIds = explicit.length
  ? explicit
  : (repairs.candidates || []).length
    ? (repairs.candidates || []).map((c) => c.retest_target_id)
    : (diagnosis.diagnoses || []).map((d) => d.target_id);

const measurements = [...new Set(targetIds)].map((targetId) => {
  const obs = obsByTarget.get(targetId) || null;
  const gsc = truthByTarget.get(targetId) || null;
  const diag = diagByTarget.get(targetId) || null;
  return {
    target_id: targetId,
    query: diag?.query || obs?.query || gsc?.query || null,
    grounded_observation_state: obs ? obs.status : 'NOT_OBSERVED',
    grounded_own_domain_referenced: obs && obs.status === 'OBSERVED' ? obs.own_domain_referenced : null,
    grounded_referenced_domain_count: obs && obs.status === 'OBSERVED' ? (obs.referenced_domains || []).length : null,
    grounded_evidence_ref: obs ? obs.evidence_ref : null,
    gsc_truth_state: gsc ? gsc.truth_state : 'GSC_TRUTH_UNAVAILABLE',
    gsc_impressions: gsc?.query_metrics?.impressions ?? null,
    gsc_clicks: gsc?.query_metrics?.clicks ?? null,
    gsc_ctr: gsc?.query_metrics?.ctr ?? null,
    gsc_average_position: gsc?.query_metrics?.gsc_average_position ?? null,
    measurement_is_evidence_backed: Boolean(
      (obs && obs.status === 'OBSERVED') || (gsc && gsc.truth_state === 'GSC_ROW_PRESENT')
    )
  };
});

const providerState =
  observations.provider_state === PROVIDER_OK || truth.provider_state === PROVIDER_OK
    ? observations.provider_state === PROVIDER_OK && truth.provider_state === PROVIDER_OK
      ? PROVIDER_OK
      : 'DEGRADED'
    : PROVIDER_UNAVAILABLE;

const snapshot = {
  label,
  captured_at: runStamp(),
  provider_states: {
    grounded_search: observations.provider_state || PROVIDER_UNAVAILABLE,
    search_console: truth.provider_state || PROVIDER_UNAVAILABLE
  },
  provider_state: providerState,
  overall_status: providerState,
  status_is_healthy: providerState === PROVIDER_OK,
  retest_basis: explicit.length ? 'explicit_target_ids' : repairs.candidates?.length ? 'repair_candidates' : 'all_diagnosed_targets',
  measurement_count: measurements.length,
  evidence_backed_measurement_count: measurements.filter((m) => m.measurement_is_evidence_backed).length,
  unavailable_note:
    providerState === PROVIDER_OK
      ? null
      : `Retest snapshot captured while providers were ${providerState}. A snapshot with no provider evidence cannot demonstrate improvement or regression.`,
  measurements: stableSort(measurements, (m) => m.target_id)
};

const existing = readJson(snapshotsPath, {
  schema_version: '1.0',
  contract: contract.contract,
  stage: 'same_query_retest',
  snapshots: []
});

const snapshots = (existing.snapshots || []).filter((s) => s.label !== label);
snapshots.push(snapshot);

writeJson(snapshotsPath, {
  schema_version: '1.0',
  contract: contract.contract,
  stage: 'same_query_retest',
  generated_at: runStamp(),
  snapshot_labels: stableSort([...snapshots], (s) => s.label).map((s) => s.label),
  truth_boundary:
    'A retest snapshot records the same queries under the same measurement definitions. It proves change only when both snapshots are evidence-backed.',
  snapshots: stableSort(snapshots, (s) => s.label)
});

printStageSummary('same_query_retest', {
  label,
  measurements: snapshot.measurement_count,
  evidence_backed: snapshot.evidence_backed_measurement_count,
  overall_status: providerState
});
