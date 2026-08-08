#!/usr/bin/env node
// Stage 3 — competitor comparison.
//
// Derived strictly from real observation records. If nothing was observed, this
// stage reports UNAVAILABLE and produces no competitor claims. It never ranks
// competitors, because grounded observation cannot establish rank (Hard Rule 2).

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
const ownDomain = contract.primary_domain;
const observationPath =
  process.env.SEARCH_INTELLIGENCE_OBSERVATION_IN || 'data/search_intelligence/live_search_observations.json';
const outputPath =
  process.env.SEARCH_INTELLIGENCE_COMPETITOR_OUT || 'data/search_intelligence/competitor_comparison.json';

const obsFile = readJson(observationPath, null);

if (!obsFile) {
  writeJson(outputPath, {
    schema_version: '1.0',
    contract: contract.contract,
    stage: 'competitor_comparison',
    generated_at: runStamp(),
    provider_state: PROVIDER_UNAVAILABLE,
    overall_status: PROVIDER_UNAVAILABLE,
    status_is_healthy: false,
    unavailable_note: `No observation artifact at ${observationPath}. Run the observation stage first.`,
    observed_query_count: 0,
    competitor_count: 0,
    competitors: [],
    per_query: []
  });
  printStageSummary('competitor_comparison', { overall_status: PROVIDER_UNAVAILABLE, competitors: 0 });
  process.exit(0);
}

const observed = (obsFile.observations || []).filter((o) => o.status === 'OBSERVED');

const competitorMap = new Map();
const perQuery = [];

for (const obs of observed) {
  const domains = (obs.referenced_domains || []).filter((d) => d && d !== ownDomain);
  const ownPresent = obs.own_domain_referenced === true;

  for (const domain of domains) {
    if (!competitorMap.has(domain)) {
      competitorMap.set(domain, {
        domain,
        observed_reference_count: 0,
        queries_referenced_on: [],
        queries_where_own_domain_absent: 0
      });
    }
    const entry = competitorMap.get(domain);
    entry.observed_reference_count += 1;
    entry.queries_referenced_on.push(obs.target_id);
    if (!ownPresent) entry.queries_where_own_domain_absent += 1;
  }

  perQuery.push({
    target_id: obs.target_id,
    query: obs.query,
    own_domain_referenced: ownPresent,
    own_urls_referenced: obs.own_urls_referenced || [],
    competitor_domains: [...new Set(domains)].sort(),
    competitor_domain_count: new Set(domains).size,
    comparison_verdict: ownPresent
      ? domains.length
        ? 'OWN_AND_COMPETITORS_REFERENCED'
        : 'ONLY_OWN_REFERENCED'
      : domains.length
        ? 'ONLY_COMPETITORS_REFERENCED'
        : 'NOTHING_REFERENCED',
    evidence_ref: obs.evidence_ref,
    truth_boundary:
      'Describes which domains a grounded search response referenced. It is not a ranking and not a SERP position.'
  });
}

const competitors = stableSort(
  [...competitorMap.values()].map((c) => ({
    ...c,
    queries_referenced_on: [...new Set(c.queries_referenced_on)].sort(),
    query_coverage: new Set(c.queries_referenced_on).size
  })),
  (c) => `${String(1e6 - c.observed_reference_count).padStart(9, '0')}|${c.domain}`
);

const overall = deriveOverallStatus(
  [{ provider: 'grounded_search', state: obsFile.provider_state || PROVIDER_UNAVAILABLE }],
  { requiredProviders: ['grounded_search'] }
);

const out = {
  schema_version: '1.0',
  contract: contract.contract,
  stage: 'competitor_comparison',
  generated_at: runStamp(),
  source_observation_artifact: observationPath,
  provider_state: obsFile.provider_state || PROVIDER_UNAVAILABLE,
  overall_status: overall,
  status_is_healthy: overall === PROVIDER_OK,
  own_domain: ownDomain,
  observed_query_count: observed.length,
  queries_with_own_domain_referenced: perQuery.filter((q) => q.own_domain_referenced).length,
  queries_with_only_competitors_referenced: perQuery.filter((q) => q.comparison_verdict === 'ONLY_COMPETITORS_REFERENCED')
    .length,
  competitor_count: competitors.length,
  unavailable_note:
    observed.length === 0
      ? 'Zero successful observations were available, so no competitor comparison could be produced. This is not a clean competitive result.'
      : null,
  truth_boundary:
    'Competitor comparison reflects domains referenced in grounded search responses. It is not Google SERP rank and not market share.',
  competitors,
  per_query: stableSort(perQuery, (q) => q.target_id)
};

writeJson(outputPath, out);
printStageSummary('competitor_comparison', {
  overall_status: overall,
  observed_queries: observed.length,
  competitors: competitors.length,
  own_referenced: out.queries_with_own_domain_referenced
});
