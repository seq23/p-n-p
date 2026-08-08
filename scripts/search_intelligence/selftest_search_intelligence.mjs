#!/usr/bin/env node
// Hostile fixture self-test for the search-intelligence validator.
//
// Repo Work OS Pass 13.2 §19.29 requires adversarial fixtures proving a control
// actually fails when it should. A validator that only ever passes is not proof.
//
// Each case copies the lane into an isolated sandbox under the OS temp dir,
// injects one specific violation, and asserts the validator hard-fails with the
// expected error code. The real repo is never mutated.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const SANDBOX_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-si-selftest-'));

const COPY = [
  'package.json',
  'scripts/search_intelligence',
  'data/search_intelligence',
  'data/authority_scale/observed_surfacing_ledger.json',
  'data/authority_scale/citation_yield_observations.json',
  'data/authority_scale/page_improvement_plan.json',
  'data/authority_scale/velocity_decision.json'
];

function makeSandbox(name) {
  const dir = path.join(SANDBOX_ROOT, name);
  for (const rel of COPY) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
  }
  return dir;
}

function runValidator(dir) {
  try {
    const stdout = execFileSync(process.execPath, ['scripts/search_intelligence/validate_search_intelligence.mjs'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { exitCode: 0, stdout };
  } catch (err) {
    return { exitCode: err.status ?? 1, stdout: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function patch(dir, rel, mutate) {
  const full = path.join(dir, rel);
  const doc = JSON.parse(fs.readFileSync(full, 'utf8'));
  mutate(doc);
  fs.writeFileSync(full, JSON.stringify(doc, null, 2) + '\n');
}

const CASES = [
  {
    name: 'clean_lane_passes',
    expectFail: false,
    mutate: () => {}
  },
  {
    name: 'R1_budget_exceeds_free_allowance_without_opt_in',
    expect: 'r1_budget_exceeds_free_allowance_without_opt_in',
    mutate: (dir) =>
      patch(dir, 'data/search_intelligence/live_search_observations.json', (d) => {
        d.allowance.effective_daily_call_budget = 100000;
        d.allowance.paid_spend_opted_in = false;
      })
  },
  {
    name: 'R1_calls_made_exceeded_budget',
    expect: 'r1_calls_made_exceeded_budget',
    mutate: (dir) =>
      patch(dir, 'data/search_intelligence/live_search_observations.json', (d) => {
        d.budget.calls_made = 999;
      })
  },
  {
    name: 'R2_grounded_observation_claims_serp_rank',
    expect: 'r2_grounded_observation_carries_rank_field',
    mutate: (dir) =>
      patch(dir, 'data/search_intelligence/live_search_observations.json', (d) => {
        d.provider_state = 'OK';
        d.overall_status = 'OK';
        d.status_is_healthy = true;
        d.observations.push({
          observation_id: 'hostile_1',
          target_id: 'hostile',
          observation_kind: 'grounded_search_observation',
          is_literal_serp_rank: false,
          status: 'OBSERVED',
          serp_rank: 3
        });
      })
  },
  {
    name: 'R2_artifact_declares_itself_literal_rank',
    expect: 'r2_observation_artifact_missing_is_literal_serp_rank_false',
    mutate: (dir) =>
      patch(dir, 'data/search_intelligence/live_search_observations.json', (d) => {
        d.is_literal_serp_rank = true;
      })
  },
  {
    name: 'R2_rank_field_outside_gsc_record',
    expect: 'r2_rank_field_outside_gsc_record',
    mutate: (dir) =>
      patch(dir, 'data/search_intelligence/competitor_comparison.json', (d) => {
        d.competitors.push({ domain: 'example.com', position: 1 });
      })
  },
  {
    name: 'R3_own_site_metrics_without_gsc_basis',
    expect: 'r3_own_site_metrics_without_gsc_basis',
    mutate: (dir) =>
      patch(dir, 'data/search_intelligence/gsc_truth.json', (d) => {
        d.per_target[0].query_metrics = { impressions: 100, clicks: 5, ctr: 0.05, gsc_average_position: 8 };
        d.per_target[0].own_site_performance_basis = 'gemini_grounding';
      })
  },
  {
    name: 'R3_contract_authority_replaced',
    expect: 'r3_contract_authority_is_not_google_search_console',
    mutate: (dir) =>
      patch(dir, 'data/search_intelligence/search_intelligence_contract.json', (d) => {
        d.own_site_google_performance_authority = 'google_genai_grounded_search';
      })
  },
  {
    name: 'R4_green_while_provider_unavailable',
    expect: 'r4_green_overall_status_while_provider_degraded',
    mutate: (dir) =>
      patch(dir, 'data/search_intelligence/search_diagnosis.json', (d) => {
        d.overall_status = 'OK';
        d.status_is_healthy = true;
      })
  },
  {
    name: 'R4_degraded_without_unavailable_note',
    expect: 'r4_degraded_artifact_missing_unavailable_note',
    mutate: (dir) =>
      patch(dir, 'data/search_intelligence/gsc_truth.json', (d) => {
        d.unavailable_note = null;
      })
  },
  {
    name: 'R5_repair_candidate_claims_publishing',
    expect: 'r5_repair_artifact_claims_publishing',
    mutate: (dir) =>
      patch(dir, 'data/search_intelligence/repair_candidates.json', (d) => {
        d.publishes = true;
      })
  },
  {
    name: 'R5_search_lane_wired_into_authority_cycle',
    expect: 'r5_search_lane_wired_into_authority_cycle',
    mutate: (dir) =>
      patch(dir, 'package.json', (d) => {
        d.scripts['authority:cycle'] = `${d.scripts['authority:cycle']} && npm run search:cycle`;
      })
  },
  {
    name: 'R5_lane_script_writes_publish_queue',
    expect: 'r5_search_lane_writes_protected_publishing_path',
    mutate: (dir) => {
      const target = path.join(dir, 'scripts/search_intelligence/hostile_writer.mjs');
      fs.writeFileSync(
        target,
        "import { writeJson } from './lib/si_core.mjs';\nwriteJson('data/publish_queue/publish_queue.json', { hostile: true });\n"
      );
    }
  },
  {
    name: 'R5_scan_exclusion_cannot_hide_a_real_writer',
    expect: 'r5_illegal_scan_exclusion_not_a_selftest',
    mutate: (dir) => {
      patch(dir, 'data/search_intelligence/search_intelligence_contract.json', (d) => {
        d.r5_scan_exclusions.files.push('scripts/search_intelligence/hostile_writer.mjs');
      });
      fs.writeFileSync(
        path.join(dir, 'scripts/search_intelligence/hostile_writer.mjs'),
        "import { writeJson } from './lib/si_core.mjs';\nwriteJson('data/publish_queue/publish_queue.json', { hostile: true });\n"
      );
    }
  },
  {
    name: 'feedback_event_marked_verified_citation',
    expect: 'feedback_event_0_illegally_marked_verified_citation',
    mutate: (dir) =>
      patch(dir, 'data/authority_scale/observed_surfacing_ledger.json', (d) => {
        d.events = [
          {
            event_id: 'hostile',
            metric: 'verified_citation',
            observed_at: '2026-08-07T00:00:00.000Z',
            surface_provider: 'google_genai_grounded_search',
            url: 'https://porchandparty901.com/',
            evidence: 'none',
            source_stage: 'search_intelligence:live_search_observation'
          }
        ];
      })
  }
];

const results = [];
let failures = 0;

for (const testCase of CASES) {
  const dir = makeSandbox(testCase.name);
  testCase.mutate(dir);
  const { exitCode, stdout } = runValidator(dir);

  let passed;
  let detail;
  if (testCase.expectFail === false) {
    passed = exitCode === 0;
    detail = passed ? 'validator passed on a clean lane' : `expected exit 0, got ${exitCode}`;
  } else {
    const caught = exitCode === 1 && stdout.includes(testCase.expect);
    passed = caught;
    detail = caught
      ? `validator hard-failed with ${testCase.expect}`
      : `expected exit 1 containing "${testCase.expect}", got exit ${exitCode}`;
  }

  if (!passed) failures += 1;
  results.push({ case: testCase.name, passed, detail });
}

fs.rmSync(SANDBOX_ROOT, { recursive: true, force: true });

const summary = {
  ok: failures === 0,
  suite: 'search_intelligence_hostile_fixtures',
  case_count: results.length,
  passed: results.length - failures,
  failed: failures,
  proves:
    'The search-intelligence validator hard-fails on rank conflation, silent-green status, non-GSC own-site performance claims, allowance breach, cadence capture, and illegal verified-citation promotion.',
  results
};

console.log(JSON.stringify(summary, null, 2));
if (failures) {
  console.error('SELF-TEST FAIL: search-intelligence validator did not catch every hostile fixture');
  process.exit(1);
}
