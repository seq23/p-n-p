#!/usr/bin/env node
// End-to-end evidence proof for the search-intelligence loop.
//
// "Exists is not works" (Repo Work OS Pass 13.2 §3.3). The lane reporting
// UNAVAILABLE with no credentials proves honesty, not function. This self-test
// drives the whole closed loop with FIXTURE provider evidence in an isolated OS
// temp sandbox and asserts the loop actually diagnoses, prepares bounded
// repairs, retests the same queries, detects before/after change, and emits
// authority-feedback events that satisfy the repo's EXISTING KPI truth validator.
//
// The fixture never touches the real repo and is never presented as real data.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-si-loop-'));

const COPY = [
  'package.json',
  'scripts/search_intelligence',
  'scripts/authority_scale/validate_kpi_truth.mjs',
  'data/search_intelligence/search_intelligence_contract.json',
  'data/queries/query_universe.json',
  'data/authority_scale/candidate_backlog.json',
  'data/authority_scale/page_improvement_plan.json',
  'data/authority_scale/velocity_decision.json',
  'data/authority_scale/observed_surfacing_ledger.json',
  'data/authority_scale/citation_yield_observations.json',
  'data/authority_scale/kpi_truth_contract.json',
  'data/authority_scale/citation_yield_contract.json',
  'data/content/page_admission_registry.json',
  'data/service_areas/areas.json'
];

for (const rel of COPY) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) throw new Error(`self-test cannot run: missing ${rel}`);
  const dest = path.join(SANDBOX, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

const ENV = { ...process.env, AUTHORITY_RUN_DATE: '2026-08-07' };

function run(script, args = []) {
  return execFileSync(process.execPath, [`scripts/search_intelligence/${script}`, ...args], {
    cwd: SANDBOX,
    encoding: 'utf8',
    env: ENV,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function runRaw(scriptPath, args = []) {
  try {
    return { exitCode: 0, out: execFileSync(process.execPath, [scriptPath, ...args], { cwd: SANDBOX, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { exitCode: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const readSandbox = (rel) => JSON.parse(fs.readFileSync(path.join(SANDBOX, rel), 'utf8'));
const writeSandbox = (rel, doc) => {
  const full = path.join(SANDBOX, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(doc, null, 2) + '\n');
};

const checks = [];
const assert = (name, condition, detail) => checks.push({ check: name, passed: Boolean(condition), detail });

// ---------------------------------------------------------------- stage 1
run('build_target_query_set.mjs');
const targets = readSandbox('data/search_intelligence/target_query_set.json');
assert('target_query_set_built', targets.target_count > 0, `${targets.target_count} targets`);

const sample = targets.targets.slice(0, 6);
const OWN = 'porchandparty901.com';

const CONTRACT = JSON.parse(fs.readFileSync(
  path.join(SANDBOX, 'data/search_intelligence/search_intelligence_contract.json'), 'utf8'));
const GROUNDED_CFG = CONTRACT.providers.grounded_search;
const GROUNDED_PROVIDER_ID = GROUNDED_CFG.provider_id;
const DECLARED_FREE_BUDGET = Number(GROUNDED_CFG.allowance.free_tier_daily_call_budget || 0);
// A provider with no free allowance can only make calls under an explicit paid opt-in,
// so a fixture that made calls has to declare that opt-in. Where the provider does have
// a free allowance big enough for the sample, the fixture stays on the free lane.
const FIXTURE_PAID = DECLARED_FREE_BUDGET < sample.length;
const FIXTURE_ALLOWANCE = {
  mode: GROUNDED_CFG.allowance.mode,
  declared_free_tier_daily_call_budget: DECLARED_FREE_BUDGET,
  effective_daily_call_budget: FIXTURE_PAID ? sample.length : DECLARED_FREE_BUDGET,
  paid_spend_opted_in: FIXTURE_PAID,
  cost_mode: FIXTURE_PAID ? 'PAID_SPEND_OPTED_IN' : 'ZERO_INCREMENTAL_COST'
};

// -------------------------------------------- fixture grounded observations
// Three queries reference the own domain; three reference only competitors.
function buildObservations() {
  return {
    schema_version: '1.0',
    contract: 'PNP_SEARCH_INTELLIGENCE_CONTRACT',
    stage: 'live_search_observation',
    generated_at: '2026-08-07T00:00:00.000Z',
    provider_state: 'OK',
    provider_states: [{ provider: 'grounded_search', provider_id: GROUNDED_PROVIDER_ID, state: 'OK', reason: 'FIXTURE' }],
    overall_status: 'OK',
    status_is_healthy: true,
    observation_kind: 'grounded_search_observation',
    is_literal_serp_rank: false,
    fixture: true,
    // The fixture is a run that ACTUALLY OBSERVED, so its allowance has to be one the
    // real provider could have produced. The grounded provider's allowance is read from
    // the contract rather than hard-coded, because a hard-coded 40 is precisely what
    // silently diverged when the provider changed: the fixture kept asserting a free
    // allowance the configured provider no longer had.
    allowance: FIXTURE_ALLOWANCE,
    budget: {
      effective_daily_call_budget: FIXTURE_ALLOWANCE.effective_daily_call_budget,
      eligible_targets: sample.length,
      calls_attempted: sample.length,
      calls_made: sample.length,
      call_failures: 0,
      skipped_for_budget: 0,
      budget_disposition: 'WITHIN_ALLOWANCE',
      cost_mode: FIXTURE_ALLOWANCE.cost_mode
    },
    observation_count: sample.length,
    observed_count: sample.length,
    own_domain_referenced_count: 3,
    unavailable_note: null,
    observations: sample.map((t, i) => {
      const ownReferenced = i < 3;
      return {
        observation_id: `fixture_obs_${i}`,
        target_id: t.target_id,
        query: t.query,
        observation_kind: 'grounded_search_observation',
        is_literal_serp_rank: false,
        truth_source: 'google_genai_grounded_search',
        model: 'fixture',
        status: 'OBSERVED',
        observed_at: '2026-08-07T00:00:00.000Z',
        expected_owned_url: t.expected_owned_url,
        own_domain_referenced: ownReferenced,
        own_urls_referenced: ownReferenced ? [t.expected_owned_url] : [],
        referenced_domains: ownReferenced ? [OWN, 'competitor-a.com'] : ['competitor-a.com', 'competitor-b.com'],
        reference_count: 2,
        provider_web_search_queries: [t.query],
        answer_excerpt: 'fixture',
        evidence_ref: `grounded_response_sha256:fixture${i}`,
        truth_boundary: 'Grounded search observation only.'
      };
    })
  };
}

// ------------------------------------------------- fixture GSC export
function buildGscExport(boost) {
  const rows = sample.map((t, i) => ({
    keys: [t.query],
    clicks: boost ? i + 2 : 0,
    impressions: boost ? 200 + i * 10 : 100 + i * 10,
    ctr: boost ? 0.02 : 0,
    position: boost ? 6.5 : 18.4
  }));
  const pageRows = sample.slice(0, 4).map((t) => ({
    keys: [t.expected_owned_url],
    clicks: boost ? 3 : 0,
    impressions: boost ? 220 : 120,
    ctr: boost ? 0.014 : 0,
    position: boost ? 6.9 : 19.1
  }));
  return {
    schema_version: '1.0',
    truth_source: 'google_search_console',
    authoritative_for: ['impressions', 'clicks', 'ctr', 'average_position'],
    site_url: 'sc-domain:porchandparty901.com',
    start_date: '2026-07-01',
    end_date: '2026-07-28',
    collected_at: '2026-08-07T00:00:00.000Z',
    row_limit: 5000,
    provider_state: 'OK',
    fixture: true,
    by_query: rows,
    by_page: pageRows,
    by_query_page: [],
    counts: { by_query: rows.length, by_page: pageRows.length, by_query_page: 0 }
  };
}

// ------------------------------------------------------- BEFORE measurement
writeSandbox('data/search_intelligence/live_search_observations.json', buildObservations());
writeSandbox('data/search_intelligence/gsc_search_analytics_export.json', buildGscExport(false));

run('compare_competitors.mjs');
run('ingest_provider_truth.mjs');
run('diagnose_search_position.mjs');
run('prepare_repair_candidates.mjs');

const competitors = readSandbox('data/search_intelligence/competitor_comparison.json');
assert(
  'competitor_comparison_found_competitors',
  competitors.competitor_count >= 2 && competitors.queries_with_only_competitors_referenced === 3,
  `${competitors.competitor_count} domains, ${competitors.queries_with_only_competitors_referenced} own-absent queries`
);

const truth = readSandbox('data/search_intelligence/gsc_truth.json');
// At least the sampled queries resolve. Additional targets may also resolve when
// they share an owned URL that has real page rows, which is correct behaviour.
assert(
  'gsc_truth_ingested',
  truth.provider_state === 'OK' && truth.targets_with_gsc_rows >= sample.length,
  `${truth.targets_with_gsc_rows} targets with rows (>= ${sample.length} sampled queries)`
);
assert('gsc_is_own_site_authority', truth.own_site_google_performance_authority === 'google_search_console', truth.own_site_google_performance_authority);

const diagnosis = readSandbox('data/search_intelligence/search_diagnosis.json');
assert('diagnosis_is_evidence_backed', diagnosis.evidence_backed_count >= sample.length, `${diagnosis.evidence_backed_count} evidence-backed`);
assert('diagnosis_found_actionable_findings', diagnosis.actionable_count > 0, `${diagnosis.actionable_count} actionable`);

const diagCodes = new Set(diagnosis.diagnoses.flatMap((d) => d.findings.map((f) => f.code)));
assert('diagnosis_detected_position_problem', diagCodes.has('GSC_AVERAGE_POSITION_BEYOND_FIRST_PAGE'), [...diagCodes].join(','));
assert('diagnosis_detected_competitor_gap', diagCodes.has('GROUNDED_ANSWER_REFERENCES_COMPETITORS_NOT_OWN_DOMAIN'), [...diagCodes].join(','));

const repairs = readSandbox('data/search_intelligence/repair_candidates.json');
assert('bounded_repairs_prepared', repairs.candidate_count > 0, `${repairs.candidate_count} candidates`);
assert('repairs_prepare_only', repairs.mode === 'PREPARE_ONLY' && repairs.publishes === false, repairs.mode);
assert(
  'repairs_prefer_existing_route',
  repairs.candidates.every((c) => c.prefers_existing_route_over_new_url === true),
  'all candidates prefer existing route'
);
assert(
  'repairs_are_bounded_single_finding',
  repairs.candidates.every((c) => c.driving_finding && c.scope),
  'each candidate has one driving finding and a bounded scope'
);

run('retest_queries.mjs', ['baseline']);
const baseline = readSandbox('data/search_intelligence/retest_snapshots.json').snapshots.find((s) => s.label === 'baseline');
assert('baseline_snapshot_is_evidence_backed', baseline.evidence_backed_measurement_count > 0, `${baseline.evidence_backed_measurement_count} evidence-backed`);

// -------------------------------------------------------- AFTER measurement
// Simulate the outcome of an applied repair: Google reports better position and
// real clicks, and the grounded answer now references the own domain.
const improvedObs = buildObservations();
for (const obs of improvedObs.observations) {
  obs.own_domain_referenced = true;
  obs.own_urls_referenced = [obs.expected_owned_url];
  obs.referenced_domains = [OWN, 'competitor-a.com'];
  obs.evidence_ref = `${obs.evidence_ref}_after`;
}
writeSandbox('data/search_intelligence/live_search_observations.json', improvedObs);
writeSandbox('data/search_intelligence/gsc_search_analytics_export.json', buildGscExport(true));

run('ingest_provider_truth.mjs');
run('retest_queries.mjs', ['after-repair']);
run('compare_before_after.mjs', ['baseline', 'after-repair']);

const beforeAfter = readSandbox('data/search_intelligence/before_after_evidence.json');
assert('before_after_is_comparable', beforeAfter.comparable_target_count > 0, `${beforeAfter.comparable_target_count} comparable`);
assert('before_after_detected_improvement', beforeAfter.improved_count > 0, `${beforeAfter.improved_count} improved, ${beforeAfter.regressed_count} regressed`);
assert('before_after_no_false_regression', beforeAfter.regressed_count === 0, `${beforeAfter.regressed_count} regressed`);

// ------------------------------------------------------- authority feedback
run('apply_authority_feedback.mjs', ['--write']);
const feedback = readSandbox('data/search_intelligence/authority_feedback_receipt.json');
assert('feedback_wrote_surfacing_events', feedback.surfacing_ledger.new_events > 0, `${feedback.surfacing_ledger.new_events} events`);
assert('feedback_wrote_yield_events', feedback.yield_ledger.new_events > 0, `${feedback.yield_ledger.new_events} events`);
assert('feedback_created_no_verified_citations', feedback.verified_citations_created === 0, 'zero verified citations');

const surfacing = readSandbox('data/authority_scale/observed_surfacing_ledger.json');
const metrics = new Set(surfacing.events.map((e) => e.metric));
assert('feedback_separates_llm_surfacing_from_search_visibility', metrics.has('llm_surfacing') && metrics.has('search_visibility'), [...metrics].join(','));
assert('feedback_never_wrote_verified_citation', !metrics.has('verified_citation'), [...metrics].join(','));

// The repo's EXISTING KPI truth validator must accept what the new lane wrote.
const kpi = runRaw('scripts/authority_scale/validate_kpi_truth.mjs');
assert('existing_kpi_truth_validator_accepts_feedback', kpi.exitCode === 0, kpi.out.trim().slice(0, 300));

// Idempotency: re-running feedback must not duplicate events.
run('apply_authority_feedback.mjs', ['--write']);
const surfacingAgain = readSandbox('data/authority_scale/observed_surfacing_ledger.json');
assert('feedback_is_idempotent', surfacingAgain.events.length === surfacing.events.length, `${surfacing.events.length} -> ${surfacingAgain.events.length}`);

// Contract validator must still pass with real-shaped evidence present.
const contractCheck = runRaw('scripts/search_intelligence/validate_search_intelligence.mjs');
assert('contract_validator_passes_with_evidence', contractCheck.exitCode === 0, contractCheck.out.trim().slice(0, 400));

fs.rmSync(SANDBOX, { recursive: true, force: true });

const failed = checks.filter((c) => !c.passed);
const summary = {
  ok: failed.length === 0,
  suite: 'search_intelligence_end_to_end_loop',
  fixture_note:
    'Driven by FIXTURE provider evidence in an isolated temp sandbox. This proves the loop functions. It is not evidence of real Porch & Party search performance.',
  check_count: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  checks
};

console.log(JSON.stringify(summary, null, 2));
if (failed.length) {
  console.error('SELF-TEST FAIL: search-intelligence loop did not function end to end');
  process.exit(1);
}
