#!/usr/bin/env node
// Stage 6 — smallest bounded repair candidate preparation.
//
// Hard Rule 5: PREPARE ONLY. This stage does not publish, does not touch the
// publish queue, published manifest, admission registry, freeze registry,
// velocity governor, or sitemap, and it is not part of `authority:cycle`.
// Everything it emits is routed back through the repo's existing approval and
// publishing rules (improve-before-new-URL, evidence-gated daily ceiling).
//
// A repair candidate is only produced from a diagnosis that actually has
// provider evidence. INSUFFICIENT_EVIDENCE never becomes a repair instruction.

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
const repairCfg = contract.repair_preparation;
const outputPath = process.env.SEARCH_INTELLIGENCE_REPAIR_OUT || 'data/search_intelligence/repair_candidates.json';

const diagnosis = readJson(
  process.env.SEARCH_INTELLIGENCE_DIAGNOSIS_IN || 'data/search_intelligence/search_diagnosis.json',
  { diagnoses: [], provider_state: PROVIDER_UNAVAILABLE }
);
const improvementPlan = readJson('data/authority_scale/page_improvement_plan.json', { plans: [] });
const velocityDecision = readJson('data/authority_scale/velocity_decision.json', {});
const planByRoute = new Map((improvementPlan.plans || []).map((p) => [p.route, p]));

// Smallest bounded repair for each finding code. Deliberately narrow: one
// specific, checkable change to one existing route wherever possible.
const REPAIR_BY_FINDING = {
  GSC_IMPRESSIONS_WITHOUT_CLICKS: {
    repair_kind: 'IMPROVE_EXISTING_ROUTE',
    bounded_change: 'Rewrite the title and meta description of the existing route to match the exact query intent Google is already showing it for.',
    scope: 'metadata_only',
    expected_signal: 'Higher CTR on the same impressions in the next Google Search Console window.'
  },
  GSC_AVERAGE_POSITION_BEYOND_FIRST_PAGE: {
    repair_kind: 'IMPROVE_EXISTING_ROUTE',
    bounded_change: 'Add one answer-first opening and one exact-intent heading for this query to the existing route. Do not create a new URL.',
    scope: 'single_route_content',
    expected_signal: 'Improved Google average position for the same query in a later window.'
  },
  GSC_NO_ROWS_FOR_EXPECTED_OWNED_URL: {
    repair_kind: 'CHECK_DISCOVERABILITY',
    bounded_change: 'Confirm the intended page is in the sitemap and internally linked, then re-check indexation through the existing distribution lane.',
    scope: 'discoverability_check',
    expected_signal: 'Google Search Console begins reporting rows for the intended URL.'
  },
  GSC_NO_ROW_FOR_TARGET: {
    repair_kind: 'IMPROVE_EXISTING_ROUTE',
    bounded_change: 'Add an extractable direct answer for this query to the best intent-matched existing route before considering any new URL.',
    scope: 'single_route_content',
    expected_signal: 'Google Search Console begins reporting impressions for this query.'
  },
  GROUNDED_ANSWER_REFERENCES_COMPETITORS_NOT_OWN_DOMAIN: {
    repair_kind: 'IMPROVE_EXISTING_ROUTE',
    bounded_change: 'Make the answer to this query extractable near the top of the intent-matched existing route: one direct answer plus one structured list or comparison.',
    scope: 'single_route_content',
    expected_signal: 'The own domain appears among referenced sources on a same-query grounded retest.'
  }
};

const NON_ACTIONABLE = new Set(['GROUNDED_ANSWER_REFERENCES_OWN_DOMAIN', 'NO_PROVIDER_EVIDENCE_AVAILABLE']);

const candidates = [];

for (const d of diagnosis.diagnoses || []) {
  if (d.confidence === 'INSUFFICIENT_EVIDENCE') continue;
  if (!d.actionable) continue;

  const actionableFindings = (d.findings || []).filter((f) => !NON_ACTIONABLE.has(f.code) && REPAIR_BY_FINDING[f.code]);
  if (!actionableFindings.length) continue;

  // Smallest bounded repair: take the single highest-signal finding, not all of them.
  const primary = actionableFindings[0];
  const template = REPAIR_BY_FINDING[primary.code];
  const route = d.expected_owned_route ? `${d.expected_owned_route}.html` : null;
  const existingPlan = route ? planByRoute.get(route) : null;

  candidates.push({
    repair_candidate_id: `pnp_rc_${d.target_id.replace(/^pnp_sq_/, '')}`,
    target_id: d.target_id,
    query: d.query,
    target_route: d.expected_owned_route || null,
    target_url: d.expected_owned_url || null,
    diagnosis_confidence: d.confidence,
    driving_finding: primary,
    supporting_finding_codes: actionableFindings.slice(1).map((f) => f.code),
    ...template,
    prefers_existing_route_over_new_url: true,
    evidence_basis: d.evidence_used,
    own_site_performance_basis: d.own_site_performance_basis,
    routes_through_existing_rules: repairCfg.routes_through,
    existing_improvement_plan_route: existingPlan ? existingPlan.route : null,
    existing_plan_recommendations: existingPlan ? existingPlan.recommended_improvements : [],
    state: 'PREPARED_NOT_APPLIED',
    publishes: false,
    mutates_publish_queue: false,
    requires_existing_approval_and_publishing_rules: true,
    retest_query: d.query,
    retest_target_id: d.target_id
  });
}

const ordered = stableSort(candidates, (c) => c.repair_candidate_id).slice(0, repairCfg.max_repair_candidates_per_run);
const truncated = Math.max(0, candidates.length - ordered.length);

const overall = diagnosis.overall_status || PROVIDER_UNAVAILABLE;

const out = {
  schema_version: '1.0',
  contract: contract.contract,
  stage: 'bounded_repair_preparation',
  generated_at: runStamp(),
  mode: repairCfg.mode,
  provider_state: overall,
  overall_status: overall,
  status_is_healthy: overall === PROVIDER_OK,
  publishes: false,
  mutates_publishing_cadence: false,
  cadence_note:
    'This stage prepares candidates only. Publication remains governed by the existing evidence-gated daily ceiling and approval rules. The search lane is not part of authority:cycle.',
  current_publishing_ceiling_per_day: velocityDecision.current_new_url_ceiling_per_day ?? null,
  current_velocity_decision: velocityDecision.decision ?? null,
  eligible_diagnoses: (diagnosis.diagnoses || []).filter((d) => d.actionable).length,
  candidate_count: ordered.length,
  truncated_candidates: truncated,
  truncation_note:
    truncated > 0
      ? `${truncated} additional evidence-backed candidates were withheld by max_repair_candidates_per_run=${repairCfg.max_repair_candidates_per_run}.`
      : null,
  unavailable_note:
    overall === PROVIDER_OK
      ? null
      : `Provider truth was ${overall} for this run, so evidence-backed repair candidates could not be produced from live provider data. An empty candidate list here does not mean the site is healthy.`,
  bounded_repair_rule: repairCfg.bounded_repair_rule,
  candidates: ordered
};

writeJson(outputPath, out);
printStageSummary('bounded_repair_preparation', {
  overall_status: overall,
  candidates: ordered.length,
  truncated,
  publishes: false
});
