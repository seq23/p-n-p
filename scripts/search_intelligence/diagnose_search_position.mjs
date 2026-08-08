#!/usr/bin/env node
// Stage 5 — diagnosis.
//
// Joins target set + grounded observation + competitor comparison + GSC truth
// into a per-query diagnosis. Every diagnosis states which evidence it used and
// carries a confidence level. With no provider evidence the confidence is
// INSUFFICIENT_EVIDENCE and no finding may be treated as actionable truth.

import {
  loadContract,
  readJson,
  writeJson,
  runStamp,
  stableSort,
  deriveOverallStatus,
  printStageSummary,
  PROVIDER_OK,
  PROVIDER_UNAVAILABLE
} from './lib/si_core.mjs';

const contract = loadContract();
const outputPath = process.env.SEARCH_INTELLIGENCE_DIAGNOSIS_OUT || 'data/search_intelligence/search_diagnosis.json';

const targetSet = readJson('data/search_intelligence/target_query_set.json', { targets: [] });
const observations = readJson(
  process.env.SEARCH_INTELLIGENCE_OBSERVATION_IN || 'data/search_intelligence/live_search_observations.json',
  { observations: [], provider_state: PROVIDER_UNAVAILABLE }
);
const competitors = readJson('data/search_intelligence/competitor_comparison.json', { per_query: [] });
const truth = readJson(
  process.env.SEARCH_INTELLIGENCE_TRUTH_IN || 'data/search_intelligence/gsc_truth.json',
  { per_target: [], provider_state: PROVIDER_UNAVAILABLE }
);
const improvementPlan = readJson('data/authority_scale/page_improvement_plan.json', { plans: [] });

const obsByTarget = new Map((observations.observations || []).map((o) => [o.target_id, o]));
const cmpByTarget = new Map((competitors.per_query || []).map((c) => [c.target_id, c]));
const truthByTarget = new Map((truth.per_target || []).map((t) => [t.target_id, t]));
const planByRoute = new Map((improvementPlan.plans || []).map((p) => [p.route, p]));

const groundedAvailable = observations.provider_state === PROVIDER_OK;
const gscAvailable = truth.provider_state === PROVIDER_OK;

/**
 * Findings are ordered most-actionable first. Each finding names the evidence
 * that produced it so nothing can be read as a conclusion the data cannot support.
 */
function diagnose(target) {
  const obs = obsByTarget.get(target.target_id) || null;
  const cmp = cmpByTarget.get(target.target_id) || null;
  const gsc = truthByTarget.get(target.target_id) || null;

  const evidenceUsed = [];
  if (obs && obs.status === 'OBSERVED') evidenceUsed.push('grounded_search_observation');
  if (cmp) evidenceUsed.push('competitor_comparison');
  if (gsc && gsc.truth_state === 'GSC_ROW_PRESENT') evidenceUsed.push('google_search_console');

  const findings = [];

  if (gsc && gsc.truth_state === 'GSC_ROW_PRESENT') {
    const q = gsc.query_metrics;
    const p = gsc.page_metrics;
    if (q && q.impressions > 0 && q.clicks === 0) {
      findings.push({
        code: 'GSC_IMPRESSIONS_WITHOUT_CLICKS',
        basis: 'google_search_console',
        detail: `Google reports ${q.impressions} impressions and 0 clicks for this query.`
      });
    }
    if (q && q.gsc_average_position !== null && q.gsc_average_position > 10) {
      findings.push({
        code: 'GSC_AVERAGE_POSITION_BEYOND_FIRST_PAGE',
        basis: 'google_search_console',
        detail: `Google average position is ${q.gsc_average_position} for this query.`
      });
    }
    if (!p && target.expected_owned_url) {
      findings.push({
        code: 'GSC_NO_ROWS_FOR_EXPECTED_OWNED_URL',
        basis: 'google_search_console',
        detail: `Google reports no rows for the intended page ${target.expected_owned_url}.`
      });
    }
  } else if (gscAvailable) {
    findings.push({
      code: 'GSC_NO_ROW_FOR_TARGET',
      basis: 'google_search_console',
      detail: 'Google Search Console returned no row for this query in the collected window.'
    });
  }

  if (obs && obs.status === 'OBSERVED') {
    if (obs.own_domain_referenced === false && (cmp?.competitor_domain_count || 0) > 0) {
      findings.push({
        code: 'GROUNDED_ANSWER_REFERENCES_COMPETITORS_NOT_OWN_DOMAIN',
        basis: 'grounded_search_observation',
        detail: `A grounded search answer referenced ${cmp.competitor_domain_count} other domain(s) and did not reference ${contract.primary_domain}.`
      });
    } else if (obs.own_domain_referenced === true) {
      findings.push({
        code: 'GROUNDED_ANSWER_REFERENCES_OWN_DOMAIN',
        basis: 'grounded_search_observation',
        detail: 'A grounded search answer referenced the own domain. This is surfacing observation, not rank.'
      });
    }
  }

  if (!groundedAvailable && !gscAvailable) {
    findings.push({
      code: 'NO_PROVIDER_EVIDENCE_AVAILABLE',
      basis: 'provider_state',
      detail: `Grounded search is ${observations.provider_state} and Google Search Console is ${truth.provider_state}. No search conclusion can be drawn.`
    });
  }

  const hasGsc = evidenceUsed.includes('google_search_console');
  const hasGrounded = evidenceUsed.includes('grounded_search_observation');
  const confidence = hasGsc && hasGrounded ? 'EVIDENCE_BACKED' : hasGsc || hasGrounded ? 'PARTIAL_EVIDENCE' : 'INSUFFICIENT_EVIDENCE';

  const route = target.expected_owned_route ? `${target.expected_owned_route}.html` : null;
  const existingPlan = route ? planByRoute.get(route) || null : null;

  return {
    target_id: target.target_id,
    query: target.query,
    query_kind: target.query_kind,
    expected_owned_route: target.expected_owned_route || null,
    expected_owned_url: target.expected_owned_url || null,
    evidence_used: evidenceUsed,
    own_site_performance_basis: hasGsc ? contract.own_site_google_performance_authority : null,
    grounded_observation_state: obs ? obs.status : 'NOT_OBSERVED',
    grounded_own_domain_referenced: obs && obs.status === 'OBSERVED' ? obs.own_domain_referenced : null,
    competitor_domain_count: cmp ? cmp.competitor_domain_count : null,
    gsc_truth_state: gsc ? gsc.truth_state : 'GSC_TRUTH_UNAVAILABLE',
    gsc_query_metrics: gsc ? gsc.query_metrics : null,
    gsc_page_metrics: gsc ? gsc.page_metrics : null,
    finding_count: findings.length,
    findings,
    confidence,
    actionable: confidence !== 'INSUFFICIENT_EVIDENCE' && findings.some((f) => f.code !== 'GROUNDED_ANSWER_REFERENCES_OWN_DOMAIN'),
    existing_improvement_plan_route: existingPlan ? existingPlan.route : null,
    truth_boundary:
      'Diagnosis is derived only from the evidence named in evidence_used. Grounded observation is not SERP rank; only Google Search Console states own-site Google performance.'
  };
}

const diagnoses = targetSet.targets.map(diagnose);

const providerStates = [
  { provider: 'grounded_search', state: observations.provider_state || PROVIDER_UNAVAILABLE },
  { provider: 'search_console', state: truth.provider_state || PROVIDER_UNAVAILABLE }
];
const overall = deriveOverallStatus(providerStates, { requiredProviders: ['grounded_search', 'search_console'] });

const out = {
  schema_version: '1.0',
  contract: contract.contract,
  stage: 'diagnosis',
  generated_at: runStamp(),
  provider_states: providerStates,
  provider_state: overall,
  overall_status: overall,
  status_is_healthy: overall === PROVIDER_OK,
  own_site_google_performance_authority: contract.own_site_google_performance_authority,
  diagnosis_count: diagnoses.length,
  actionable_count: diagnoses.filter((d) => d.actionable).length,
  evidence_backed_count: diagnoses.filter((d) => d.confidence === 'EVIDENCE_BACKED').length,
  partial_evidence_count: diagnoses.filter((d) => d.confidence === 'PARTIAL_EVIDENCE').length,
  insufficient_evidence_count: diagnoses.filter((d) => d.confidence === 'INSUFFICIENT_EVIDENCE').length,
  unavailable_note:
    overall === PROVIDER_OK
      ? null
      : `Diagnosis ran with degraded or unavailable provider truth (grounded_search=${observations.provider_state}, search_console=${truth.provider_state}). No finding here may be treated as confirmed search performance.`,
  truth_boundaries: contract.truth_boundaries,
  diagnoses: stableSort(diagnoses, (d) => d.target_id)
};

writeJson(outputPath, out);
printStageSummary('diagnosis', {
  overall_status: overall,
  diagnoses: out.diagnosis_count,
  actionable: out.actionable_count,
  evidence_backed: out.evidence_backed_count,
  insufficient: out.insufficient_evidence_count
});
