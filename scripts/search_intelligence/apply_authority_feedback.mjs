#!/usr/bin/env node
// Stage 9 — authority / citation / entity / content feedback.
//
// Feeds evidence-backed search observations into the repo's EXISTING authority
// ledgers rather than building a parallel scoreboard:
//   data/authority_scale/observed_surfacing_ledger.json  (KPI truth ledger)
//   data/authority_scale/citation_yield_observations.json (yield ledger)
//
// Authority Scale Addendum §6 KPI Truth Law is enforced here: search visibility,
// LLM surfacing, indexation, external reference, and verified citation stay
// distinct. Nothing is ever promoted to "verified citation" by this stage.
//
// An event is written ONLY when it carries provider, timestamp, URL, and
// evidence. With no provider evidence, this stage writes nothing at all.
//
// Pass --write to apply. Default is a dry run.

import {
  loadContract,
  readJson,
  writeJson,
  runStamp,
  sha256,
  stableSort,
  printStageSummary,
  PROVIDER_OK,
  PROVIDER_UNAVAILABLE
} from './lib/si_core.mjs';

const contract = loadContract();
const apply = process.argv.includes('--write');

const SURFACING_LEDGER = 'data/authority_scale/observed_surfacing_ledger.json';
const YIELD_LEDGER = 'data/authority_scale/citation_yield_observations.json';

const observations = readJson('data/search_intelligence/live_search_observations.json', {
  observations: [],
  provider_state: PROVIDER_UNAVAILABLE
});
const truth = readJson('data/search_intelligence/gsc_truth.json', {
  per_target: [],
  provider_state: PROVIDER_UNAVAILABLE,
  export_collected_at: null,
  export_window: null
});

const surfacingEvents = [];
const yieldEvents = [];

function eventId(parts) {
  return `pnp_si_${sha256(parts.join('|')).slice(0, 16)}`;
}

// --- Grounded search observation -> llm_surfacing (never search rank) ---
if (observations.provider_state === PROVIDER_OK) {
  for (const obs of observations.observations || []) {
    if (obs.status !== 'OBSERVED') continue;
    if (obs.own_domain_referenced !== true) continue;
    const url = (obs.own_urls_referenced || [])[0] || obs.expected_owned_url;
    if (!url || !obs.observed_at || !obs.evidence_ref) continue;

    surfacingEvents.push({
      event_id: eventId(['llm_surfacing', obs.target_id, obs.evidence_ref]),
      metric: 'llm_surfacing',
      observed_at: obs.observed_at,
      surface_provider: obs.truth_source,
      url,
      evidence: obs.evidence_ref,
      query_or_prompt: obs.query,
      source_stage: 'search_intelligence:live_search_observation',
      truth_note:
        'Grounded search response referenced this URL. This is LLM/answer surfacing, not a Google SERP rank and not a verified citation.'
    });

    // A referenced own URL is a linked surface; a bare domain mention is not.
    const linked = (obs.own_urls_referenced || []).length > 0;
    yieldEvents.push({
      event_id: eventId(['yield_llm', obs.target_id, obs.evidence_ref]),
      event_type: linked ? 'llm_linked_citation' : 'llm_mention_without_citation',
      provider: obs.truth_source,
      observed_at: obs.observed_at,
      surfaced_url: url,
      query_or_prompt: obs.query,
      evidence_ref: obs.evidence_ref,
      source_stage: 'search_intelligence:live_search_observation'
    });
  }
}

// --- Google Search Console -> search_visibility / indexed_page (authoritative) ---
if (truth.provider_state === PROVIDER_OK) {
  const collectedAt = truth.export_collected_at;
  const evidenceBase = `gsc_export:${truth.export_path}@${truth.export_window?.start_date}..${truth.export_window?.end_date}`;

  for (const t of truth.per_target || []) {
    if (t.truth_state !== 'GSC_ROW_PRESENT') continue;
    const q = t.query_metrics;
    const p = t.page_metrics;
    const url = t.expected_owned_url || p?.url;
    if (!url || !collectedAt) continue;

    if (q && q.impressions > 0) {
      surfacingEvents.push({
        event_id: eventId(['search_visibility', t.target_id, evidenceBase]),
        metric: 'search_visibility',
        observed_at: collectedAt,
        surface_provider: 'google_search_console',
        url,
        evidence: `${evidenceBase}#query=${q.gsc_query}`,
        query_or_prompt: t.query,
        impressions: q.impressions,
        clicks: q.clicks,
        gsc_average_position: q.gsc_average_position,
        source_stage: 'search_intelligence:provider_truth',
        truth_note:
          'Real Google Search Console visibility for the verified property. Impressions are not clicks, rank, or citations.'
      });

      yieldEvents.push({
        event_id: eventId(['yield_visibility', t.target_id, evidenceBase]),
        event_type: 'search_visibility',
        provider: 'google_search_console',
        observed_at: collectedAt,
        surfaced_url: url,
        query_or_prompt: t.query,
        evidence_ref: `${evidenceBase}#query=${q.gsc_query}`,
        source_stage: 'search_intelligence:provider_truth'
      });

      if (q.clicks > 0) {
        yieldEvents.push({
          event_id: eventId(['yield_click', t.target_id, evidenceBase]),
          event_type: 'search_click',
          provider: 'google_search_console',
          observed_at: collectedAt,
          surfaced_url: url,
          query_or_prompt: t.query,
          evidence_ref: `${evidenceBase}#query=${q.gsc_query}&clicks=${q.clicks}`,
          source_stage: 'search_intelligence:provider_truth'
        });
      }
    }

    if (p && p.impressions > 0) {
      surfacingEvents.push({
        event_id: eventId(['indexed_page', t.target_id, evidenceBase]),
        metric: 'indexed_page',
        observed_at: collectedAt,
        surface_provider: 'google_search_console',
        url: p.url,
        evidence: `${evidenceBase}#page=${p.url}`,
        source_stage: 'search_intelligence:provider_truth',
        truth_note:
          'Google Search Console reported performance rows for this URL, which is direct indexation evidence from the provider.'
      });
    }
  }
}

function mergeLedger(path, existingKey, newEvents) {
  const ledger = readJson(path, { schema_version: '1.0', repo_id: contract.repo_id, events: [] });
  const existing = ledger.events || [];
  const seen = new Set(existing.map((e) => e.event_id).filter(Boolean));
  const added = newEvents.filter((e) => !seen.has(e.event_id));
  const merged = stableSort([...existing, ...added], (e) => `${e.observed_at || ''}|${e.event_id || ''}`);
  return { ledger: { ...ledger, events: merged }, added, existingCount: existing.length, key: existingKey };
}

const surfacing = mergeLedger(SURFACING_LEDGER, 'metric', surfacingEvents);
const yieldMerge = mergeLedger(YIELD_LEDGER, 'event_type', yieldEvents);

if (apply && (surfacing.added.length || yieldMerge.added.length)) {
  if (surfacing.added.length) writeJson(SURFACING_LEDGER, surfacing.ledger);
  if (yieldMerge.added.length) writeJson(YIELD_LEDGER, yieldMerge.ledger);
}

const providerState =
  observations.provider_state === PROVIDER_OK || truth.provider_state === PROVIDER_OK
    ? observations.provider_state === PROVIDER_OK && truth.provider_state === PROVIDER_OK
      ? PROVIDER_OK
      : 'DEGRADED'
    : PROVIDER_UNAVAILABLE;

const receipt = {
  schema_version: '1.0',
  contract: contract.contract,
  stage: 'authority_feedback',
  generated_at: runStamp(),
  mode: apply ? 'WRITE' : 'DRY_RUN',
  provider_states: {
    grounded_search: observations.provider_state || PROVIDER_UNAVAILABLE,
    search_console: truth.provider_state || PROVIDER_UNAVAILABLE
  },
  provider_state: providerState,
  overall_status: providerState,
  status_is_healthy: providerState === PROVIDER_OK,
  kpi_mapping: contract.kpi_mapping,
  surfacing_ledger: {
    path: SURFACING_LEDGER,
    existing_events: surfacing.existingCount,
    new_events: surfacing.added.length,
    new_event_metrics: [...new Set(surfacing.added.map((e) => e.metric))].sort()
  },
  yield_ledger: {
    path: YIELD_LEDGER,
    existing_events: yieldMerge.existingCount,
    new_events: yieldMerge.added.length,
    new_event_types: [...new Set(yieldMerge.added.map((e) => e.event_type))].sort()
  },
  verified_citations_created: 0,
  verified_citation_note:
    'This stage never creates verified_external_citation or verified_citation events. Those require independent external evidence.',
  unavailable_note:
    providerState === PROVIDER_OK
      ? null
      : `No provider was fully available (grounded_search=${observations.provider_state}, search_console=${truth.provider_state}). Zero events were written. An empty ledger is not evidence of zero surfacing.`,
  next_command_after_write: 'npm run authority:yield:build && npm run validate:kpi-truth && npm run validate:yield'
};

writeJson('data/search_intelligence/authority_feedback_receipt.json', receipt);
printStageSummary('authority_feedback', {
  mode: receipt.mode,
  overall_status: providerState,
  surfacing_events_added: surfacing.added.length,
  yield_events_added: yieldMerge.added.length,
  verified_citations_created: 0
});
