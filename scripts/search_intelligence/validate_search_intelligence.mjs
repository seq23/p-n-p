#!/usr/bin/env node
import fs from 'node:fs';

const errors = [];
const snapshotPath = 'data/search_intelligence/search_intelligence_snapshot.json';
const providerPath = 'data/search_intelligence/provider_truth_snapshot.json';

for (const file of [snapshotPath, providerPath, 'scripts/search_intelligence/build_search_intelligence_snapshot.mjs']) {
  if (!fs.existsSync(file)) errors.push(`missing:${file}`);
}

const snapshot = fs.existsSync(snapshotPath) ? JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) : {};
const provider = fs.existsSync(providerPath) ? JSON.parse(fs.readFileSync(providerPath, 'utf8')) : {};

if (snapshot.repo_id !== 'p-n-p') errors.push('repo_id');
if (snapshot.hard_rules?.grounded_search_not_literal_google_rank !== true) errors.push('grounding_rank_boundary_missing');
if (snapshot.hard_rules?.gsc_authority_for_google_own_site_performance !== true) errors.push('gsc_authority_missing');
if (snapshot.hard_rules?.degraded_provider_never_green !== true) errors.push('provider_truth_rule_missing');
if (snapshot.hard_rules?.publishing_cadence_change !== false) errors.push('publishing_cadence_changed');
if (!Array.isArray(snapshot.target_query_set) || snapshot.target_query_set.length < 10) errors.push('target_query_set_too_small');
if (!Array.isArray(snapshot.observations) || snapshot.observations.length !== snapshot.target_query_set?.length) errors.push('observation_target_mismatch');

const allowedProviderStates = new Set(['AVAILABLE', 'DEGRADED', 'UNAVAILABLE']);
for (const [name, state] of Object.entries(provider.providers || {})) {
  if (!allowedProviderStates.has(state.status)) errors.push(`invalid_provider_state:${name}:${state.status}`);
  if (state.status !== 'AVAILABLE' && !state.evidence && !state.truth_boundary) errors.push(`unexplained_provider_state:${name}`);
}

for (const [i, observation] of (snapshot.observations || []).entries()) {
  if (observation.observation_type !== 'live_search_observation_not_google_rank') errors.push(`observation_${i}_rank_boundary`);
  if (/literal_google_serp_rank_claim/i.test(JSON.stringify(observation))) errors.push(`observation_${i}_google_rank_claim`);
  if (observation.bounded_repair_candidate?.publishing_cadence_change !== false) errors.push(`observation_${i}_cadence_change`);
  if (observation.bing_status === 'AVAILABLE' && !Array.isArray(observation.competitor_comparison)) errors.push(`observation_${i}_competitors`);
}

if (!/same-query retest/i.test(snapshot.repair_loop || '')) errors.push('same_query_retest_missing');
for (const field of ['source_quality', 'claim_level_citations', 'authority_gap_analysis', 'citation_footprint', 'entity_source_coverage']) {
  if (!snapshot.authority_feedback_fields?.includes(field)) errors.push(`missing_authority_feedback:${field}`);
}

console.log(JSON.stringify({
  ok: errors.length === 0,
  target_queries: snapshot.target_query_set?.length || 0,
  provider_states: Object.fromEntries(Object.entries(provider.providers || {}).map(([k, v]) => [k, v.status])),
  publishing_cadence_change: snapshot.hard_rules?.publishing_cadence_change,
  errors
}, null, 2));
if (errors.length) process.exit(1);
