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

const ROOT = path.join(__dirname, '..', '..');
// Guard the SOURCE as well as the derived atlas. Migrating only the atlas leaves the
// builder regenerating it from a source that still carries `volume`, which is exactly
// how this defect survived its first fix.
const FILES = [
  path.join(ROOT, 'data', 'authority_scale', 'query_atlas.json'),
  path.join(ROOT, 'data', 'queries', 'evidence', 'evidence_queries.json'),
];
const failures = [];

let rowCount = 0;
for (const file of FILES) {
  if (!fs.existsSync(file)) continue;
  const rel = path.relative(ROOT, file);
  const rows = (JSON.parse(fs.readFileSync(file, 'utf8')).queries) || [];
  rowCount += rows.length;
  for (const r of rows) {
    const where = `${rel}: `;
    const q = where + (r.query || '(unnamed)');

  if (Object.hasOwn(r, 'volume')) {
    failures.push(`${q}: has a \`volume\` key. It held two different units and must never be written again.`);
  }

  const hasSearch = r.search_volume != null;
  const hasImpr = r.impressions_90d != null;

  if (r.source_type === 'gsc_search_analytics' && hasSearch && r.demand_basis !== undefined && r.demand_basis !== 'search_volume') {
    failures.push(`${q}: GSC-sourced row carries search_volume without demand_basis=search_volume — a joined volume must be declared.`);
  }

  const expected = hasSearch ? 'search_volume' : hasImpr ? 'impressions_90d' : 'none';
    // demand_basis and rank_band are atlas-level assertions; raw evidence rows carry
    // the measurements only. What BOTH files must obey is the unit rule: no `volume`.
  if (r.demand_basis !== undefined && r.demand_basis !== expected) {
    failures.push(`${q}: demand_basis="${r.demand_basis}" disagrees with populated fields (expected "${expected}").`);
  }

  const band = hasSearch ? 'measured_search_volume' : hasImpr ? 'own_impressions' : 'none';
  if (r.rank_band !== undefined && r.rank_band !== band) {
    failures.push(`${q}: rank_band="${r.rank_band}" disagrees with populated fields (expected "${band}").`);
  }
  }
}

if (failures.length) {
  console.log('ATLAS UNIT CONTRACT: FAIL');
  for (const f of failures) console.log(`  HARD_FAIL ${f}`);
  process.exit(1);
}
console.log(`ATLAS UNIT CONTRACT: PASS (${rowCount} row(s) across ${FILES.length} file(s); no \`volume\` key, units explicit and self-consistent)`);
