#!/usr/bin/env node
// Hard-fail validator for the search-intelligence lane.
//
// Enforces the five governing rules from
// data/search_intelligence/search_intelligence_contract.json:
//
//   R1  a zero-incremental-cost observation lane exists and is allowance-governed
//   R2  grounded observation is never represented as literal Google SERP rank
//   R3  Google Search Console is the authority for own-site Google performance
//   R4  degraded/unavailable providers never produce a green/OK artifact
//   R5  the search lane never changes the existing publishing cadence
//
// This validator inspects only. It never contacts a provider and never writes
// repo state. Passing it does NOT mean any provider was reachable — check
// provider_state in each artifact for that.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadContract, readJson } from './lib/si_core.mjs';

const errors = [];
const warnings = [];

const contract = loadContract();

const STAGE_ARTIFACTS = [
  'data/search_intelligence/target_query_set.json',
  'data/search_intelligence/live_search_observations.json',
  'data/search_intelligence/competitor_comparison.json',
  'data/search_intelligence/gsc_truth.json',
  'data/search_intelligence/search_diagnosis.json',
  'data/search_intelligence/repair_candidates.json'
];

const STATEFUL_ARTIFACTS = STAGE_ARTIFACTS.filter((p) => !p.endsWith('target_query_set.json'));

const HEALTHY = new Set(contract.overall_statuses.healthy);
const NOT_HEALTHY = new Set(contract.overall_statuses.not_healthy);

// ---------------------------------------------------------------- structure
for (const rel of STAGE_ARTIFACTS) {
  if (!fs.existsSync(path.join(ROOT, rel))) errors.push(`missing_stage_artifact:${rel}`);
}

for (const rule of ['R1_ZERO_COST_OBSERVATION_LANE', 'R2_NO_RANK_CONFLATION', 'R3_GSC_IS_OWN_SITE_AUTHORITY', 'R4_NO_SILENT_GREEN', 'R5_NO_CADENCE_CHANGE']) {
  if (!contract.hard_rules?.[rule]) errors.push(`contract_missing_hard_rule:${rule}`);
}

// ------------------------------------------------- R1 zero-cost observation lane
const observations = readJson('data/search_intelligence/live_search_observations.json', null);
if (!observations) {
  errors.push('r1_no_observation_artifact');
} else {
  const allowance = observations.allowance || {};
  const budget = observations.budget || {};
  const declared = Number(contract.providers.grounded_search.allowance.free_tier_daily_call_budget || 0);

  if (!allowance.mode) errors.push('r1_observation_missing_allowance_mode');
  if (!Number.isFinite(Number(allowance.effective_daily_call_budget))) {
    errors.push('r1_observation_missing_effective_budget');
  }
  if (!allowance.paid_spend_opted_in && Number(allowance.effective_daily_call_budget) > declared) {
    errors.push(
      `r1_budget_exceeds_free_allowance_without_opt_in:${allowance.effective_daily_call_budget}>${declared}`
    );
  }
  if (!allowance.paid_spend_opted_in && allowance.cost_mode !== 'ZERO_INCREMENTAL_COST') {
    errors.push(`r1_cost_mode_not_zero_incremental_without_opt_in:${allowance.cost_mode}`);
  }
  if (Number(budget.calls_made || 0) > Number(allowance.effective_daily_call_budget || 0)) {
    errors.push(`r1_calls_made_exceeded_budget:${budget.calls_made}>${allowance.effective_daily_call_budget}`);
  }
  if (!budget.budget_disposition) errors.push('r1_missing_budget_disposition');
}

// ------------------------------------------------------- R2 no rank conflation
const RANK_FIELDS = ['rank', 'position', 'serp_rank', 'serp_position', 'average_position'];

if (observations) {
  if (observations.is_literal_serp_rank !== false) errors.push('r2_observation_artifact_missing_is_literal_serp_rank_false');
  if (observations.observation_kind !== 'grounded_search_observation') {
    errors.push(`r2_wrong_observation_kind:${observations.observation_kind}`);
  }
  for (const obs of observations.observations || []) {
    if (obs.is_literal_serp_rank !== false) errors.push(`r2_observation_missing_flag:${obs.observation_id}`);
    if (obs.observation_kind !== 'grounded_search_observation') {
      errors.push(`r2_observation_wrong_kind:${obs.observation_id}`);
    }
    for (const field of RANK_FIELDS) {
      if (field in obs) errors.push(`r2_grounded_observation_carries_rank_field:${obs.observation_id}:${field}`);
    }
  }
}

// A rank/position field is only legitimate when it came from Google Search Console.
function scanForRankFields(node, artifactPath, trail, gscScoped) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((child, i) => scanForRankFields(child, artifactPath, `${trail}[${i}]`, gscScoped));
    return;
  }
  const isGscRecord =
    gscScoped ||
    node.truth_source === 'google_search_console' ||
    node.surface_provider === 'google_search_console' ||
    node.provider === 'google_search_console' ||
    node.own_site_performance_basis === 'google_search_console';

  for (const [key, value] of Object.entries(node)) {
    if (RANK_FIELDS.includes(key) && value !== null && value !== undefined) {
      const gscNamed = key === 'gsc_average_position';
      if (!isGscRecord && !gscNamed) {
        errors.push(`r2_rank_field_outside_gsc_record:${artifactPath}:${trail}.${key}`);
      }
    }
    scanForRankFields(value, artifactPath, `${trail}.${key}`, isGscRecord);
  }
}

for (const rel of ['data/search_intelligence/competitor_comparison.json', 'data/search_intelligence/search_diagnosis.json']) {
  const doc = readJson(rel, null);
  if (doc) scanForRankFields(doc, rel, '$', false);
}

// --------------------------------------------------------- R3 GSC is authority
if (contract.own_site_google_performance_authority !== 'google_search_console') {
  errors.push('r3_contract_authority_is_not_google_search_console');
}

const gscTruth = readJson('data/search_intelligence/gsc_truth.json', null);
if (!gscTruth) {
  errors.push('r3_no_provider_truth_artifact');
} else {
  if (gscTruth.own_site_google_performance_authority !== 'google_search_console') {
    errors.push('r3_truth_artifact_authority_mismatch');
  }
  for (const t of gscTruth.per_target || []) {
    const hasMetrics = Boolean(t.query_metrics || t.page_metrics);
    if (hasMetrics && t.own_site_performance_basis !== 'google_search_console') {
      errors.push(`r3_own_site_metrics_without_gsc_basis:${t.target_id}`);
    }
    if (hasMetrics && t.truth_source !== 'google_search_console') {
      errors.push(`r3_own_site_metrics_wrong_truth_source:${t.target_id}`);
    }
  }
}

const diagnosis = readJson('data/search_intelligence/search_diagnosis.json', null);
if (diagnosis) {
  for (const d of diagnosis.diagnoses || []) {
    const assertsOwnPerformance = Boolean(d.gsc_query_metrics || d.gsc_page_metrics);
    if (assertsOwnPerformance && d.own_site_performance_basis !== 'google_search_console') {
      errors.push(`r3_diagnosis_asserts_own_performance_without_gsc:${d.target_id}`);
    }
    for (const finding of d.findings || []) {
      if (/^GSC_/.test(finding.code) && finding.basis !== 'google_search_console') {
        errors.push(`r3_gsc_finding_wrong_basis:${d.target_id}:${finding.code}`);
      }
    }
  }
}

// ------------------------------------------------------------ R4 no silent green
for (const rel of STATEFUL_ARTIFACTS) {
  const doc = readJson(rel, null);
  if (!doc) continue;

  if (!('provider_state' in doc)) errors.push(`r4_artifact_missing_provider_state:${rel}`);
  if (!('overall_status' in doc)) errors.push(`r4_artifact_missing_overall_status:${rel}`);
  if (!('status_is_healthy' in doc)) errors.push(`r4_artifact_missing_status_is_healthy:${rel}`);

  const states = []
    .concat(doc.provider_state ? [doc.provider_state] : [])
    .concat((doc.provider_states || []).map((p) => (typeof p === 'string' ? p : p.state)))
    .concat(Object.values(doc.provider_states || {}).filter((v) => typeof v === 'string'))
    .filter(Boolean);

  const anyDegraded = states.some((s) => NOT_HEALTHY.has(s));

  if (anyDegraded && HEALTHY.has(doc.overall_status)) {
    errors.push(`r4_green_overall_status_while_provider_degraded:${rel}:${doc.overall_status}`);
  }
  if (anyDegraded && doc.status_is_healthy === true) {
    errors.push(`r4_status_is_healthy_true_while_provider_degraded:${rel}`);
  }
  if (HEALTHY.has(doc.overall_status) !== (doc.status_is_healthy === true)) {
    errors.push(`r4_status_is_healthy_disagrees_with_overall_status:${rel}`);
  }
  if (anyDegraded && !doc.unavailable_note) {
    errors.push(`r4_degraded_artifact_missing_unavailable_note:${rel}`);
  }
}

// -------------------------------------------------------- R5 no cadence change
const laneDir = path.join(ROOT, 'scripts/search_intelligence');
const laneFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.mjs')) laneFiles.push(full);
  }
})(laneDir);

const protectedPaths = contract.protected_publishing_paths || [];
const feedbackWritable = new Set(contract.authority_feedback_writable_paths || []);

// Declared, visible scan exclusions. Only hostile-fixture self-tests may be
// excluded, they must be named selftest_*.mjs, and they must actually exist —
// so this list cannot silently grow to hide a real writer.
const declaredExclusions = contract.r5_scan_exclusions?.files || [];
for (const excluded of declaredExclusions) {
  if (!/(^|\/)selftest_[^/]+\.mjs$/.test(excluded)) {
    errors.push(`r5_illegal_scan_exclusion_not_a_selftest:${excluded}`);
  }
  if (!fs.existsSync(path.join(ROOT, excluded))) {
    errors.push(`r5_stale_scan_exclusion:${excluded}`);
  }
}
const excludedSet = new Set(declaredExclusions);

for (const file of laneFiles) {
  const rel = path.relative(ROOT, file);
  if (excludedSet.has(rel)) continue;
  const body = fs.readFileSync(file, 'utf8');
  // Strip comments so documentation of protected paths is not mistaken for a write.
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const protectedPath of protectedPaths) {
    if (feedbackWritable.has(protectedPath)) continue;
    const writePattern = new RegExp(`writeJson\\(\\s*['"\`]${protectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const fsWritePattern = new RegExp(
      `(writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync)\\([^)\\n]*${protectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
    );
    if (writePattern.test(code) || fsWritePattern.test(code)) {
      errors.push(`r5_search_lane_writes_protected_publishing_path:${rel}:${protectedPath}`);
    }
  }
}

// The search lane must not be wired into the publishing cadence command.
const pkg = readJson('package.json', { scripts: {} });
const authorityCycle = pkg.scripts?.['authority:cycle'] || '';
if (/search:/.test(authorityCycle) || /search_intelligence/.test(authorityCycle)) {
  errors.push('r5_search_lane_wired_into_authority_cycle');
}

const repairs = readJson('data/search_intelligence/repair_candidates.json', null);
if (repairs) {
  if (repairs.mode !== 'PREPARE_ONLY') errors.push(`r5_repair_mode_not_prepare_only:${repairs.mode}`);
  if (repairs.publishes !== false) errors.push('r5_repair_artifact_claims_publishing');
  if (repairs.mutates_publishing_cadence !== false) errors.push('r5_repair_artifact_claims_cadence_mutation');
  for (const c of repairs.candidates || []) {
    if (c.state !== 'PREPARED_NOT_APPLIED') errors.push(`r5_repair_candidate_wrong_state:${c.repair_candidate_id}`);
    if (c.publishes !== false) errors.push(`r5_repair_candidate_claims_publishing:${c.repair_candidate_id}`);
    if (c.requires_existing_approval_and_publishing_rules !== true) {
      errors.push(`r5_repair_candidate_bypasses_existing_rules:${c.repair_candidate_id}`);
    }
  }
}

// -------------------------------------------- evidence discipline for feedback
const feedbackReceipt = readJson('data/search_intelligence/authority_feedback_receipt.json', null);
if (feedbackReceipt && feedbackReceipt.verified_citations_created !== 0) {
  errors.push('feedback_stage_created_verified_citations');
}

const surfacingLedger = readJson('data/authority_scale/observed_surfacing_ledger.json', { events: [] });
for (const [i, event] of (surfacingLedger.events || []).entries()) {
  if (event.source_stage && String(event.source_stage).startsWith('search_intelligence:')) {
    for (const field of ['observed_at', 'surface_provider', 'url', 'evidence']) {
      if (!event[field]) errors.push(`feedback_event_${i}_missing_${field}`);
    }
    if (event.metric === 'verified_citation') errors.push(`feedback_event_${i}_illegally_marked_verified_citation`);
  }
}

// ------------------------------------------------------------------ reporting
const providerSummary = {
  grounded_search: observations?.provider_state ?? 'NOT_RUN',
  search_console: gscTruth?.provider_state ?? 'NOT_RUN'
};

const result = {
  ok: errors.length === 0,
  contract: contract.contract,
  rules_checked: ['R1', 'R2', 'R3', 'R4', 'R5'],
  provider_state: providerSummary,
  provider_truth_available:
    providerSummary.grounded_search === 'OK' || providerSummary.search_console === 'OK',
  r5_scan_exclusions: declaredExclusions,
  structural_validation_note:
    'This validator proves contract compliance only. It does not prove any provider was reachable. Read provider_state above.',
  errors,
  warnings
};

console.log(JSON.stringify(result, null, 2));
if (errors.length) {
  console.error('VALIDATION FAIL: search-intelligence contract violated');
  process.exit(1);
}
