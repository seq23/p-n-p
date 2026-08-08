#!/usr/bin/env node
// Stage 8 — before/after evidence comparison.
//
// Compares two retest snapshots for the same queries. A delta is only reported
// as real when BOTH sides of the comparison are evidence-backed. Missing
// evidence produces NOT_COMPARABLE, never "no change" and never an improvement
// claim (Hard Rule 4).
//
// Usage:
//   node scripts/search_intelligence/compare_before_after.mjs baseline after-repair

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
const beforeLabel = process.argv[2] || 'baseline';
const afterLabel = process.argv[3] || 'after-repair';
const outputPath = 'data/search_intelligence/before_after_evidence.json';

const snapshotFile = readJson('data/search_intelligence/retest_snapshots.json', { snapshots: [] });
const byLabel = new Map((snapshotFile.snapshots || []).map((s) => [s.label, s]));
const before = byLabel.get(beforeLabel) || null;
const after = byLabel.get(afterLabel) || null;

function delta(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return Number((b - a).toFixed(4));
}

const comparisons = [];

if (before && after) {
  const beforeByTarget = new Map(before.measurements.map((m) => [m.target_id, m]));
  const afterByTarget = new Map(after.measurements.map((m) => [m.target_id, m]));
  const allTargets = [...new Set([...beforeByTarget.keys(), ...afterByTarget.keys()])];

  for (const targetId of allTargets) {
    const b = beforeByTarget.get(targetId) || null;
    const a = afterByTarget.get(targetId) || null;
    const comparable = Boolean(b?.measurement_is_evidence_backed && a?.measurement_is_evidence_backed);

    let verdict = 'NOT_COMPARABLE';
    let verdictReason = 'One or both snapshots lack provider evidence for this query.';

    if (comparable) {
      const impressionDelta = delta(b.gsc_impressions, a.gsc_impressions);
      const clickDelta = delta(b.gsc_clicks, a.gsc_clicks);
      // Lower average position is better in Google's metric.
      const positionDelta = delta(b.gsc_average_position, a.gsc_average_position);
      const groundedGained = b.grounded_own_domain_referenced === false && a.grounded_own_domain_referenced === true;
      const groundedLost = b.grounded_own_domain_referenced === true && a.grounded_own_domain_referenced === false;

      const improved =
        groundedGained ||
        (clickDelta !== null && clickDelta > 0) ||
        (impressionDelta !== null && impressionDelta > 0) ||
        (positionDelta !== null && positionDelta < 0);
      const regressed =
        groundedLost ||
        (clickDelta !== null && clickDelta < 0) ||
        (impressionDelta !== null && impressionDelta < 0) ||
        (positionDelta !== null && positionDelta > 0);

      if (improved && !regressed) {
        verdict = 'IMPROVED';
        verdictReason = 'At least one evidence-backed metric improved and none regressed.';
      } else if (regressed && !improved) {
        verdict = 'REGRESSED';
        verdictReason = 'At least one evidence-backed metric regressed and none improved.';
      } else if (improved && regressed) {
        verdict = 'MIXED';
        verdictReason = 'Evidence-backed metrics moved in both directions.';
      } else {
        verdict = 'NO_MEASURED_CHANGE';
        verdictReason = 'Both snapshots were evidence-backed and no metric changed.';
      }
    }

    comparisons.push({
      target_id: targetId,
      query: a?.query || b?.query || null,
      comparable,
      verdict,
      verdict_reason: verdictReason,
      before: b,
      after: a,
      deltas: comparable
        ? {
            gsc_impressions: delta(b.gsc_impressions, a.gsc_impressions),
            gsc_clicks: delta(b.gsc_clicks, a.gsc_clicks),
            gsc_ctr: delta(b.gsc_ctr, a.gsc_ctr),
            gsc_average_position: delta(b.gsc_average_position, a.gsc_average_position),
            grounded_own_domain_referenced_changed:
              b.grounded_own_domain_referenced !== a.grounded_own_domain_referenced
          }
        : null,
      truth_boundary:
        'Deltas are only meaningful when both snapshots are evidence-backed. gsc_average_position comes from Google Search Console; grounded reference changes are surfacing observations, not rank.'
    });
  }
}

const comparable = comparisons.filter((c) => c.comparable);
const missingSnapshots = [!before ? beforeLabel : null, !after ? afterLabel : null].filter(Boolean);
const overall = !before || !after ? PROVIDER_UNAVAILABLE : comparable.length ? PROVIDER_OK : 'DEGRADED';

const out = {
  schema_version: '1.0',
  contract: contract.contract,
  stage: 'before_after_evidence_comparison',
  generated_at: runStamp(),
  before_label: beforeLabel,
  after_label: afterLabel,
  before_snapshot_present: Boolean(before),
  after_snapshot_present: Boolean(after),
  missing_snapshots: missingSnapshots,
  provider_state: overall,
  overall_status: overall,
  status_is_healthy: overall === PROVIDER_OK,
  compared_target_count: comparisons.length,
  comparable_target_count: comparable.length,
  improved_count: comparable.filter((c) => c.verdict === 'IMPROVED').length,
  regressed_count: comparable.filter((c) => c.verdict === 'REGRESSED').length,
  mixed_count: comparable.filter((c) => c.verdict === 'MIXED').length,
  no_measured_change_count: comparable.filter((c) => c.verdict === 'NO_MEASURED_CHANGE').length,
  not_comparable_count: comparisons.length - comparable.length,
  unavailable_note:
    overall === PROVIDER_OK
      ? null
      : missingSnapshots.length
        ? `Missing retest snapshot(s): ${missingSnapshots.join(', ')}. Capture both before and after snapshots with an available provider before claiming any change.`
        : 'No target had evidence on both sides, so no before/after change can be claimed.',
  truth_boundary:
    'This comparison can only demonstrate change between two evidence-backed measurements of the same queries. Absence of evidence is never reported as improvement or as no change.',
  comparisons: stableSort(comparisons, (c) => c.target_id)
};

writeJson(outputPath, out);
printStageSummary('before_after_evidence_comparison', {
  overall_status: overall,
  compared: out.compared_target_count,
  comparable: out.comparable_target_count,
  improved: out.improved_count,
  regressed: out.regressed_count
});
