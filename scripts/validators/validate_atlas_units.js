#!/usr/bin/env node
/**
 * Two quantities must never share one field again.
 *
 * `ingest_gsc_evidence.py` used to write `"volume": impressions` on T1 rows while
 * T2b rows carried a modelled monthly search volume under the same key -- and the
 * atlas ranked on it. A 6-impression row and a 1,300/mo row sorted as peers. In a
 * sibling repo this put "17/mo" on the public web: 17 of that property's own
 * impressions rendered as market search volume.
 *
 * HARD FAIL. Runs against data/authority_scale/query_atlas.json.
 */
const fs = require('node:fs');
const path = require('node:path');

const ATLAS = path.join(__dirname, '..', '..', 'data', 'authority_scale', 'query_atlas.json');
const failures = [];

const doc = JSON.parse(fs.readFileSync(ATLAS, 'utf8'));
const rows = doc.queries || [];

for (const r of rows) {
  const q = r.query || '(unnamed)';

  if (Object.hasOwn(r, 'volume')) {
    failures.push(`${q}: has a \`volume\` key. It held two different units and must never be written again.`);
  }

  const hasSearch = r.search_volume != null;
  const hasImpr = r.impressions_90d != null;

  if (r.source_type === 'gsc_search_analytics' && hasSearch && r.demand_basis !== 'search_volume') {
    failures.push(`${q}: GSC-sourced row carries search_volume without demand_basis=search_volume — a joined volume must be declared.`);
  }

  const expected = hasSearch ? 'search_volume' : hasImpr ? 'impressions_90d' : 'none';
  if (r.demand_basis !== expected) {
    failures.push(`${q}: demand_basis="${r.demand_basis}" disagrees with populated fields (expected "${expected}").`);
  }

  const band = hasSearch ? 'measured_search_volume' : hasImpr ? 'own_impressions' : 'none';
  if (r.rank_band && r.rank_band !== band) {
    failures.push(`${q}: rank_band="${r.rank_band}" disagrees with populated fields (expected "${band}").`);
  }
}

if (failures.length) {
  console.log('ATLAS UNIT CONTRACT: FAIL');
  for (const f of failures) console.log(`  HARD_FAIL ${f}`);
  process.exit(1);
}
console.log(`ATLAS UNIT CONTRACT: PASS (${rows.length} row(s); no \`volume\` key, units explicit and self-consistent)`);
