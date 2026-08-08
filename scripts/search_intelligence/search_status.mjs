#!/usr/bin/env node
// Plain-English status surface for the search-intelligence lane.
//
// Deliberately loud about provider state: a clean contract check is NOT a green
// search result. If the providers were not reachable, this says so first.

import { loadContract, readJson, PROVIDER_OK, PROVIDER_UNAVAILABLE } from './lib/si_core.mjs';

const contract = loadContract();
const targets = readJson('data/search_intelligence/target_query_set.json', null);
const observations = readJson('data/search_intelligence/live_search_observations.json', null);
const competitors = readJson('data/search_intelligence/competitor_comparison.json', null);
const truth = readJson('data/search_intelligence/gsc_truth.json', null);
const diagnosis = readJson('data/search_intelligence/search_diagnosis.json', null);
const repairs = readJson('data/search_intelligence/repair_candidates.json', null);
const snapshots = readJson('data/search_intelligence/retest_snapshots.json', { snapshots: [] });
const beforeAfter = readJson('data/search_intelligence/before_after_evidence.json', null);
const feedback = readJson('data/search_intelligence/authority_feedback_receipt.json', null);

const grounded = observations?.provider_state ?? 'NOT_RUN';
const gsc = truth?.provider_state ?? 'NOT_RUN';
const anyProviderTruth = grounded === PROVIDER_OK || gsc === PROVIDER_OK;

const lines = [];
lines.push('PORCH & PARTY — SEARCH INTELLIGENCE STATUS');
lines.push('='.repeat(60));
lines.push('');
lines.push('PROVIDER TRUTH');
lines.push(`  Grounded search observation : ${grounded}`);
lines.push(`  Google Search Console       : ${gsc}`);
lines.push('');

if (!anyProviderTruth) {
  lines.push('  >> NO PROVIDER TRUTH WAS OBTAINED IN THIS RUN.');
  lines.push('  >> Nothing below is evidence of ranking, surfacing, indexing, or citation.');
  lines.push('  >> This state is UNAVAILABLE. It is not a clean or healthy search result.');
  lines.push('');
  if (observations?.provider_states?.[0]?.evidence) {
    lines.push(`  Grounded search reason: ${observations.provider_states[0].reason}`);
    lines.push(`    ${observations.provider_states[0].evidence}`);
  }
  if (truth?.provider_states?.[0]?.evidence) {
    lines.push(`  Search Console reason : ${truth.provider_states[0].reason}`);
    lines.push(`    ${truth.provider_states[0].evidence}`);
  }
  lines.push('');
}

lines.push('LOOP STAGES');
lines.push(`  1. Target query set        : ${targets ? `${targets.target_count} queries (${targets.anchored_to_admitted_route_count} anchored to admitted routes)` : 'NOT RUN'}`);
lines.push(
  `  2. Live search observation : ${observations ? `${observations.overall_status} — ${observations.observed_count ?? 0} observed of ${observations.budget?.calls_attempted ?? 0} attempted, cost mode ${observations.allowance?.cost_mode}` : 'NOT RUN'}`
);
lines.push(
  `  3. Competitor comparison   : ${competitors ? `${competitors.overall_status} — ${competitors.competitor_count} domains across ${competitors.observed_query_count} observed queries` : 'NOT RUN'}`
);
lines.push(
  `  4. Provider truth (GSC)    : ${truth ? `${truth.overall_status} — ${truth.targets_with_gsc_rows} of ${truth.target_count} targets have real GSC rows` : 'NOT RUN'}`
);
lines.push(
  `  5. Diagnosis               : ${diagnosis ? `${diagnosis.overall_status} — ${diagnosis.evidence_backed_count} evidence-backed, ${diagnosis.partial_evidence_count} partial, ${diagnosis.insufficient_evidence_count} insufficient` : 'NOT RUN'}`
);
lines.push(
  `  6. Bounded repair prep     : ${repairs ? `${repairs.overall_status} — ${repairs.candidate_count} candidates, mode ${repairs.mode}` : 'NOT RUN'}`
);
lines.push(
  `  7. Same-query retest       : ${snapshots.snapshots?.length ? snapshots.snapshots.map((s) => `${s.label}(${s.evidence_backed_measurement_count}/${s.measurement_count} evidence-backed)`).join(', ') : 'NO SNAPSHOTS'}`
);
lines.push(
  `  8. Before/after evidence   : ${beforeAfter ? `${beforeAfter.overall_status} — ${beforeAfter.comparable_target_count} comparable, ${beforeAfter.improved_count} improved, ${beforeAfter.regressed_count} regressed` : 'NOT RUN'}`
);
lines.push(
  `  9. Authority feedback      : ${feedback ? `${feedback.mode} — ${feedback.surfacing_ledger.new_events} surfacing + ${feedback.yield_ledger.new_events} yield events, ${feedback.verified_citations_created} verified citations` : 'NOT RUN'}`
);
lines.push('');

lines.push('PUBLISHING CADENCE (unchanged by this lane)');
lines.push(`  Repair preparation publishes      : ${repairs ? repairs.publishes : 'n/a'}`);
lines.push(`  Repair prep mutates cadence       : ${repairs ? repairs.mutates_publishing_cadence : 'n/a'}`);
lines.push(`  Existing daily new-URL ceiling    : ${repairs?.current_publishing_ceiling_per_day ?? 'n/a'}`);
lines.push(`  Existing velocity decision        : ${repairs?.current_velocity_decision ?? 'n/a'}`);
lines.push('');

lines.push('TRUTH BOUNDARIES');
for (const boundary of contract.truth_boundaries) lines.push(`  - ${boundary}`);
lines.push('');

if (!anyProviderTruth) {
  lines.push('TO OBTAIN REAL PROVIDER TRUTH');
  lines.push('  Google Search Console (authoritative for own-site Google performance):');
  lines.push(`    python3 ${contract.providers.search_console.collector} <service-account.json> "$GSC_SITE_URL" <start> <end> ${contract.providers.search_console.export_path}`);
  lines.push('    then: npm run search:truth');
  lines.push('  Grounded search observation (free-allowance governed):');
  lines.push(`    export ${contract.providers.grounded_search.credential_env}=...  &&  npm run search:observe`);
  lines.push('  Or dispatch .github/workflows/search-intelligence.yml, which already has the GSC secrets.');
  lines.push('');
}

console.log(lines.join('\n'));
