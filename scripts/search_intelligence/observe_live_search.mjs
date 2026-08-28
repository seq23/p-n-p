#!/usr/bin/env node
// Stage 2 — live search observation.
//
// Hard Rule 1: this lane runs at zero incremental cost while the declared free
// allowance permits. It refuses to spend past the allowance rather than billing.
//
// Hard Rule 2: what this stage produces is a GROUNDED SEARCH OBSERVATION. It is
// never a literal Google SERP rank and may never carry rank/position fields.
//
// Hard Rule 4: with no credential, this writes UNAVAILABLE. It never writes green.

import {
  loadContract,
  readJson,
  writeJson,
  runStamp,
  sha256,
  resolveProviderState,
  resolveAllowance,
  deriveOverallStatus,
  assertNoRankFields,
  printStageSummary,
  PROVIDER_OK,
  PROVIDER_DEGRADED,
  PROVIDER_UNAVAILABLE
} from './lib/si_core.mjs';
import { openRouterWebSearch, OPENROUTER_DEFAULT_MAX_RESULTS } from '../lib/openrouter_web_search.mjs';

const contract = loadContract();
const providerCfg = contract.providers.grounded_search;
const outputPath = process.env.SEARCH_INTELLIGENCE_OBSERVATION_OUT || 'data/search_intelligence/live_search_observations.json';

const targetSet = readJson('data/search_intelligence/target_query_set.json', { targets: [] });
const providerState = resolveProviderState(providerCfg, { name: 'grounded_search' });
const allowance = resolveAllowance(providerCfg);
const ownDomain = contract.primary_domain;

const requestedLimit = Number(process.env.SEARCH_INTELLIGENCE_MAX_QUERIES || allowance.effective_daily_call_budget);
const callBudget = Math.max(0, Math.min(allowance.effective_daily_call_budget, requestedLimit));
const only = (process.env.SEARCH_INTELLIGENCE_TARGET_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const selectable = only.length ? targetSet.targets.filter((t) => only.includes(t.target_id)) : targetSet.targets;
const selected = selectable.slice(0, callBudget);
// The web plugin bills per result, so the result count is an explicit cost dial.
const MAX_RESULTS = Math.max(1, Number(
  process.env[providerCfg.max_results_env || 'SEARCH_INTELLIGENCE_WEB_MAX_RESULTS'] ||
  providerCfg.default_max_results || OPENROUTER_DEFAULT_MAX_RESULTS
));

function domainOf(value) {
  if (!value) return null;
  const raw = String(value).trim();
  try {
    return new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    // Grounding chunk titles are frequently a bare hostname.
    const match = raw.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/i);
    return match ? match[1].replace(/^www\./, '').toLowerCase() : null;
  }
}

// This lane used to call Google's grounded-search endpoint. That path is hard-blocked
// on this project's key - plain generateContent returns 200, the same request carrying
// tools:[{google_search:{}}] returns 429 RESOURCE_EXHAUSTED, across every model tried -
// so the only observation this stage could ever produce was a failure. The workflow
// that runs it has never completed a single run.
//
// It now calls OpenRouter's web plugin through the same module the citation probe uses,
// so the two lanes cannot drift and one live run proves both.
async function groundedObserve(target, model, apiKey) {
  const result = await openRouterWebSearch(
    `Search the web for: "${target.query}". ` +
    'List the businesses or pages a searcher would actually be pointed to for this query, with their source links. ' +
    'Do not guess. Only report what the search results support.',
    { apiKey, model, maxResults: MAX_RESULTS }
  );

  const references = [];
  for (const annotation of result.annotations) {
    const citation = annotation?.url_citation || {};
    const domain = domainOf(citation.url);
    if (!domain) continue;
    references.push({ domain, title: citation.title || null, uri: citation.url || null });
  }

  return {
    references,
    // The web plugin does not expose the sub-queries it issued. Reporting an empty
    // list is honest; inventing the target query back would fabricate provider detail.
    web_search_queries: [],
    answer_text: result.answer,
    raw_hash: sha256(result.raw)
  };
}

const observations = [];
let callsMade = 0;
let callFailures = 0;
let lastFailure = null;

if (providerState.state === PROVIDER_OK && callBudget > 0) {
  const apiKey = process.env[providerCfg.credential_env];
  const model = process.env[providerCfg.model_env] || providerCfg.default_model;

  for (const target of selected) {
    try {
      const result = await groundedObserve(target, model, apiKey);
      callsMade += 1;
      const domains = [...new Set(result.references.map((r) => r.domain))].sort();
      const ownUrls = result.references.filter((r) => r.domain === ownDomain).map((r) => r.uri).filter(Boolean);
      observations.push(
        assertNoRankFields(
          {
            observation_id: `pnp_obs_${sha256(`${target.target_id}|${runStamp()}`).slice(0, 12)}`,
            target_id: target.target_id,
            query: target.query,
            observation_kind: 'grounded_search_observation',
            is_literal_serp_rank: false,
            truth_source: providerCfg.provider_id,
            model,
            status: 'OBSERVED',
            observed_at: new Date().toISOString(),
            expected_owned_url: target.expected_owned_url || null,
            own_domain_referenced: domains.includes(ownDomain),
            own_urls_referenced: [...new Set(ownUrls)].sort(),
            referenced_domains: domains,
            reference_count: result.references.length,
            provider_web_search_queries: result.web_search_queries,
            answer_excerpt: result.answer_text.slice(0, 600),
            evidence_ref: `grounded_response_sha256:${result.raw_hash}`,
            truth_boundary:
              'Grounded search observation only. This is not a Google SERP position and is not proof of indexation or citation.'
          },
          target.target_id
        )
      );
    } catch (err) {
      callFailures += 1;
      lastFailure = { target_id: target.target_id, error: err.message, detail: err.detail || null };
      observations.push({
        observation_id: `pnp_obs_${sha256(`${target.target_id}|${runStamp()}|failed`).slice(0, 12)}`,
        target_id: target.target_id,
        query: target.query,
        observation_kind: 'grounded_search_observation',
        is_literal_serp_rank: false,
        truth_source: providerCfg.provider_id,
        status: 'FAILED',
        failure_reason: err.message,
        own_domain_referenced: null,
        referenced_domains: [],
        evidence_ref: null,
        truth_boundary: 'Observation failed. No conclusion about surfacing may be drawn from this record.'
      });
    }
  }
}

const providerRan = providerState.state === PROVIDER_OK && callBudget > 0;
const callsAttempted = providerRan ? selected.length : 0;
const skippedForBudget = providerRan ? Math.max(0, selectable.length - selected.length) : 0;

// A credential with no call budget produced zero observations while the provider
// still reported OK, and OK with zero observations is exactly the silent green R4
// forbids. Now that this provider has no free allowance, that state is the DEFAULT
// one, so it has to be named rather than passed off as healthy.
const noBudget = providerState.state === PROVIDER_OK && callBudget <= 0;
const effectiveState = noBudget
  ? PROVIDER_DEGRADED
  : (providerState.state === PROVIDER_OK && callFailures > 0 ? PROVIDER_DEGRADED : providerState.state);

const providerStates = [
  {
    ...providerState,
    state: effectiveState,
    ...(noBudget
      ? {
        reason: 'NO_CALL_BUDGET_PAID_SPEND_NOT_OPTED_IN',
        evidence: `${providerCfg.credential_env} is present but the effective daily call budget is 0. ${providerCfg.provider_id} has no free allowance (declared free_tier_daily_call_budget=${allowance.declared_free_tier_daily_call_budget}), so observations require ${providerCfg.allowance.opt_in_env}=true and ${providerCfg.allowance.budget_env} set. Zero observations were taken; this is DEGRADED, not OK.`
      }
      : {}),
    ...(callFailures > 0 ? { reason: 'PROVIDER_CALL_FAILURES', evidence: JSON.stringify(lastFailure) } : {})
  }
];

const overall = deriveOverallStatus(providerStates, { requiredProviders: ['grounded_search'] });

const out = {
  schema_version: '1.0',
  contract: contract.contract,
  stage: 'live_search_observation',
  generated_at: runStamp(),
  provider_state: effectiveState,
  provider_states: providerStates,
  overall_status: overall,
  status_is_healthy: overall === PROVIDER_OK,
  observation_kind: 'grounded_search_observation',
  is_literal_serp_rank: false,
  allowance,
  budget: {
    effective_daily_call_budget: callBudget,
    eligible_targets: selectable.length,
    calls_attempted: callsAttempted,
    calls_made: callsMade,
    call_failures: callFailures,
    skipped_for_budget: skippedForBudget,
    budget_disposition: noBudget
      ? 'NOT_RUN_NO_CALL_BUDGET'
      : !providerRan
        ? 'NOT_RUN_PROVIDER_UNAVAILABLE'
        : skippedForBudget > 0
          ? 'SKIPPED_BUDGET_EXHAUSTED'
          : 'WITHIN_ALLOWANCE',
    cost_mode: allowance.cost_mode
  },
  observation_count: observations.length,
  observed_count: observations.filter((o) => o.status === 'OBSERVED').length,
  own_domain_referenced_count: observations.filter((o) => o.own_domain_referenced === true).length,
  unavailable_note:
    effectiveState === PROVIDER_UNAVAILABLE
      ? `No grounded-search credential (${providerCfg.credential_env}) was present. Zero observations were produced. This is UNAVAILABLE, not OK.`
      : noBudget
        ? `${providerCfg.credential_env} was present but no call budget was authorised, so zero observations were produced. Set ${providerCfg.allowance.opt_in_env}=true and ${providerCfg.allowance.budget_env}=N to observe. This is DEGRADED, not OK.`
        : null,
  truth_boundaries: contract.truth_boundaries,
  observations
};

writeJson(outputPath, out);
printStageSummary('live_search_observation', {
  provider_state: effectiveState,
  overall_status: overall,
  calls_made: callsMade,
  observations: observations.length,
  cost_mode: allowance.cost_mode,
  output: outputPath
});
