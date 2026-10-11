#!/usr/bin/env node
// Stage 1 — target query set, from MEASURED demand only.
//
// Until 2026-10-10 this stage derived 120 targets from the page generator's own
// phrasing (query_universe h1/faq strings and fan-out backlog topics). Search
// Console then showed 66 impressions for 22 real queries over 11 Sep-8 Oct 2026,
// and none of the 120 targets was among them; data/demand/measured_demand.json
// measured 0 searches a month for them. A target list nobody searches for steers
// every later stage at nothing.
//
// A target now exists only when something measured it:
//   - source "gsc_export": a query row in the Search Console export, with its
//     28-day impressions (the export's own window), clicks and position;
//   - source "measured_demand": a record in data/demand/measured_demand.json that
//     is not rejected and carries a measured monthly search volume.
// A candidate with no number is DROPPED and listed under `dropped` with the
// reason, never kept with a null. validate_search_intelligence.mjs fails the set
// if any target lacks a source or a positive number.
//
// Each target names the page that should answer it (expected_owned_route), so
// GSC truth and diagnosis can ask about that page directly.

import { loadContract, readJson, writeJson, runStamp, shortId, stableSort, printStageSummary } from './lib/si_core.mjs';

const contract = loadContract();
const cfg = contract.target_query_set;
const domain = contract.primary_domain;
const exportPath = contract.providers.search_console.export_path;
const DEMAND = 'data/demand/measured_demand.json';

const gsc = readJson(exportPath, null);
const demand = readJson(DEMAND, { records: [] });

// Route each measured query to the page built to answer it. Ordered: first match wins.
const ROUTES = [
  { test: /\bbachelorette\b/, route: '/services/party-decor-memphis' },
  { test: /\bcorporate\b/, route: '/corporate/corporate-event-decor-memphis' },
  { test: /\bballoon\b/, route: '/faq/how-much-does-a-balloon-garland-cost-in-memphis' },
  { test: /\bhotel\b/, route: '/services/hotel-room-decor-memphis' },
  { test: /planner|planning|event management|event planner|birthday party/, route: '/services/birthday-party-planner-memphis' }
];
const PARTY_PLANNER_FAMILY = /planner|planning|event management/;
const routeFor = (q) => (ROUTES.find((r) => r.test.test(q)) || { route: '/' }).route;
const urlFor = (route) => `https://${domain}${route === '/' ? '/' : route}`;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

const targets = new Map();
const dropped = [];

function add(t) {
  const key = norm(t.query);
  if (!key) return;
  const prev = targets.get(key);
  // One target per query; a second measurement of the same query is kept beside it.
  if (prev) { prev.other_measurements = [...(prev.other_measurements || []), t.measurement]; return; }
  targets.set(key, { target_id: shortId('pnp_sq', key), ...t });
}

if (gsc && Array.isArray(gsc.by_query)) {
  for (const row of gsc.by_query) {
    const query = String((row.keys || [])[0] || '').trim();
    const impressions = Number(row.impressions) || 0;
    if (!query) continue;
    if (impressions <= 0) { dropped.push({ query, source: 'gsc_export', reason: 'zero impressions in the export window' }); continue; }
    const route = routeFor(norm(query));
    add({
      query,
      source: 'gsc_export',
      family: PARTY_PLANNER_FAMILY.test(norm(query)) ? 'party_planner' : 'other_measured',
      impressions,
      clicks: Number(row.clicks) || 0,
      average_position: Number(row.position) || null,
      measurement: { metric: 'impressions_28d', value: impressions, window: `${gsc.start_date}..${gsc.end_date}`, collected_at: gsc.collected_at },
      intent_class: 'commercial',
      query_kind: 'measured_gsc_query',
      expected_owned_route: route,
      expected_owned_url: urlFor(route),
      owned_route_is_admitted: true
    });
  }
}

// Accepted records and the validated backlog are both demand candidates; each still
// needs a measured volume to become a target.
for (const r of [...(demand.records || []), ...(demand.backlog_validated_not_yet_built || [])]) {
  if (r.disposition === 'REJECTED_WRONG_BUSINESS') continue;
  const volume = Number(r.volume);
  if (!(volume > 0)) {
    dropped.push({ query: r.query, source: 'measured_demand', reason: `no measured volume (source_type ${r.source_type}; autocomplete proves the string is searched, not how often)` });
    continue;
  }
  const covered = r.covered_by || (r.build && r.build.covered_by);
  const route = covered ? String(covered).replace(/\.html$/, '') : routeFor(norm(r.query));
  add({
    query: r.query,
    source: 'measured_demand',
    family: PARTY_PLANNER_FAMILY.test(norm(r.query)) ? 'party_planner' : 'other_measured',
    volume,
    measurement: { metric: 'search_volume_monthly', value: volume, source_type: r.source_type, observed_at: r.observed_at || null },
    intent_class: r.intent || 'commercial',
    query_kind: 'measured_demand_record',
    expected_owned_route: route,
    expected_owned_url: urlFor(route),
    owned_route_is_admitted: true
  });
}

const ordered = stableSort([...targets.values()], (t) => `${String(1e6 - t.measurement.value).padStart(7, '0')}|${t.query.toLowerCase()}`).slice(0, cfg.max_targets);
const bySource = ordered.reduce((a, t) => ({ ...a, [t.source]: (a[t.source] || 0) + 1 }), {});

const out = {
  schema_version: '2.0',
  contract: contract.contract,
  generated_at: runStamp(),
  sources: cfg.sources,
  max_targets: cfg.max_targets,
  measurement_rule: 'Every target carries a source (gsc_export | measured_demand) and a positive measured number. Anything unmeasured is dropped, not kept with a null.',
  gsc_window: gsc ? { start_date: gsc.start_date, end_date: gsc.end_date, collected_at: gsc.collected_at } : null,
  target_count: ordered.length,
  targets_by_source: bySource,
  party_planner_family_count: ordered.filter((t) => t.family === 'party_planner').length,
  anchored_to_admitted_route_count: ordered.filter((t) => t.owned_route_is_admitted).length,
  truth_boundary:
    'A target query is something this loop intends to observe. Its number is the measurement that admitted it, not evidence of ranking, indexing, surfacing, or citation.',
  dropped_count: dropped.length,
  dropped,
  targets: ordered
};

if (!ordered.length) {
  console.error(`[search:targets] FAILED: 0 measured targets. ${exportPath} ${gsc ? 'has no query rows with impressions' : 'is missing'} and ${DEMAND} has no measured volume.`);
  process.exit(1);
}
writeJson('data/search_intelligence/target_query_set.json', out);
printStageSummary('target_query_set', { targets: out.target_count, by_source: JSON.stringify(bySource), party_planner_family: out.party_planner_family_count, dropped: out.dropped_count });
