#!/usr/bin/env node
// Stage 1 — target query set.
//
// Deterministically derives the queries the search-intelligence loop will test,
// from existing repo sources only. It invents no geography and no new intent:
// every target is anchored to a real published route or to an existing governed
// backlog candidate whose geography already passed the service-area truth gate.

import { loadContract, readJson, writeJson, runStamp, shortId, stableSort, printStageSummary } from './lib/si_core.mjs';

const contract = loadContract();
const cfg = contract.target_query_set;

const queryUniverse = readJson('data/queries/query_universe.json', []);
const backlog = readJson('data/authority_scale/candidate_backlog.json', { candidates: [] });
const admissions = readJson('data/content/page_admission_registry.json', { admissions: [] }).admissions || [];
const areas = readJson(cfg.geography_truth_source, { areas: [] }).areas || [];

const admittedRoutes = new Set(admissions.filter((a) => a.status === 'admitted').map((a) => a.route));
const domain = contract.primary_domain;
const truthfulGeographies = new Set(areas.map((a) => a.replace(',', '')));

function urlFor(route) {
  return `https://${domain}${route}.html`;
}

function normalizeQuery(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .replace(/\?+$/, '')
    .trim();
}

const targets = new Map();

function addTarget(record) {
  const query = normalizeQuery(record.query);
  if (!query || query.length < 8) return;
  const key = query.toLowerCase();
  const existing = targets.get(key);
  if (existing) {
    // Keep the strongest provenance; a route-anchored target beats a backlog-only one.
    if (existing.expected_owned_url || !record.expected_owned_url) return;
  }
  targets.set(key, { target_id: shortId('pnp_sq', key), ...record, query });
}

// Source A — published authority routes. These are real head/intent queries and
// each one has an owned URL that GSC can be asked about directly.
for (const entry of queryUniverse) {
  const route = `/${entry.folder}/${entry.slug}`;
  const owned = admittedRoutes.has(route) ? urlFor(route) : null;
  if (entry.h1) {
    addTarget({
      query: entry.h1,
      intent_class: entry.intent || 'informational',
      query_kind: 'head_intent',
      source: 'data/queries/query_universe.json',
      expected_owned_route: route,
      expected_owned_url: owned,
      owned_route_is_admitted: Boolean(owned),
      service_key: entry.serviceKey || null
    });
  }
  if (entry.faqQuestion) {
    addTarget({
      query: entry.faqQuestion,
      intent_class: 'question',
      query_kind: 'question_intent',
      source: 'data/queries/query_universe.json',
      expected_owned_route: route,
      expected_owned_url: owned,
      owned_route_is_admitted: Boolean(owned),
      service_key: entry.serviceKey || null
    });
  }
}

// Source B — governed backlog. The fanout corpus stores long deterministic
// planning strings, not queries a person types. Reduce each to its testable
// topic + truthful geography core so live observation tests something real.
for (const candidate of backlog.candidates || []) {
  if (!truthfulGeographies.has(candidate.geography)) continue;
  const topic = normalizeQuery(candidate.topic || '');
  if (!topic) continue;
  const query = `${topic} ${candidate.geography}`;
  const route = candidate.best_existing_route ? candidate.best_existing_route.replace(/\.html$/, '') : null;
  const owned = route && admittedRoutes.has(route) ? urlFor(route) : null;
  addTarget({
    query,
    intent_class: candidate.buyer_stage || 'unclassified',
    query_kind: 'backlog_topic_intent',
    source: 'data/authority_scale/candidate_backlog.json',
    expected_owned_route: route,
    expected_owned_url: owned,
    owned_route_is_admitted: Boolean(owned),
    semantic_cluster: candidate.semantic_cluster || null,
    recommended_disposition: candidate.recommended_disposition || null,
    priority_score: candidate.priority_score || 0
  });
}

const kindWeight = { head_intent: 0, question_intent: 1, backlog_topic_intent: 2 };
const ordered = stableSort([...targets.values()], (t) => `${kindWeight[t.query_kind]}|${t.query.toLowerCase()}`).slice(
  0,
  cfg.max_targets
);

const out = {
  schema_version: '1.0',
  contract: contract.contract,
  generated_at: runStamp(),
  sources: cfg.sources,
  geography_truth_source: cfg.geography_truth_source,
  max_targets: cfg.max_targets,
  target_count: ordered.length,
  anchored_to_admitted_route_count: ordered.filter((t) => t.owned_route_is_admitted).length,
  truth_boundary:
    'A target query is something this loop intends to observe. It is not evidence of ranking, indexing, surfacing, or citation.',
  targets: ordered
};

writeJson('data/search_intelligence/target_query_set.json', out);
printStageSummary('target_query_set', {
  targets: out.target_count,
  anchored_to_admitted_route: out.anchored_to_admitted_route_count
});
