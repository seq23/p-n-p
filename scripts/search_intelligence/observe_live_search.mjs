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

async function groundedObserve(target, model, apiKey) {
  const endpoint = `${providerCfg.endpoint}/${model}:generateContent`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text:
              `Search the web for: "${target.query}". ` +
              'List the businesses or pages a searcher would actually be pointed to for this query, with their source links. ' +
              'Do not guess. Only report what the search results support.'
          }
        ]
      }
    ],
    tools: [{ google_search: {} }]
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    const err = new Error(`provider_http_${response.status}`);
    err.detail = text.slice(0, 500);
    throw err;
  }

  const payload = await response.json();
  const candidate = (payload.candidates || [])[0] || {};
  const grounding = candidate.groundingMetadata || {};
  const chunks = grounding.groundingChunks || [];

  const references = [];
  for (const chunk of chunks) {
    const web = chunk.web || {};
    const domain = domainOf(web.domain) || domainOf(web.title) || domainOf(web.uri);
    if (!domain) continue;
    references.push({ domain, title: web.title || null, uri: web.uri || null });
  }

  const answerText = (candidate.content?.parts || []).map((p) => p.text || '').join('\n');
  return {
    references,
    web_search_queries: grounding.webSearchQueries || [],
    answer_text: answerText,
    raw_hash: sha256(payload)
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
const effectiveState =
  providerState.state === PROVIDER_OK && callFailures > 0 ? PROVIDER_DEGRADED : providerState.state;

const providerStates = [
  {
    ...providerState,
    state: effectiveState,
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
    budget_disposition: !providerRan
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
