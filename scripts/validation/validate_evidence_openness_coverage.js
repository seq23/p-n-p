#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Every observed query carries an openness and lead-intent reading.
 *
 * scripts/queries/score_discovery_gap.mjs derives, from grounded citation
 * observations the repo already holds on disk, whether an answer is winnable
 * (occupancy) and whether the searcher is near the quote form (lead intent). It
 * was invoked by no workflow and no other script. The result: 19 of 22 evidence
 * rows sat with no reading at all, while the observation data they would be
 * derived FROM was sitting in the same repo. Two components, each keeping its
 * own list, with nothing linking them.
 *
 * The second half of the same defect was in the ingest.
 * scripts/queries/ingest_gsc_evidence.py rebuilt each row from scratch, so any
 * row Search Console returned again lost its annotation on the next run - a
 * reading that cannot be recovered from GSC, destroyed rather than refreshed.
 * Both halves are fixed: the ingest carries unknown prior fields forward, and
 * authority-daily.yml runs the scorer immediately after the ingest so fresh rows
 * are annotated in the job that measured them.
 *
 * This validator is what keeps the scorer's output load-bearing. Before it, the
 * fields it writes were read by nothing, so the scorer could have stopped
 * working and no run would have noticed.
 *
 * UNMEASURED is an accepted verdict and is NOT treated as a failure. The probe
 * is credential-gated and a query it has not answered for genuinely has no
 * reading; recording that honestly is the correct outcome and is what the
 * scorer's own method note demands. What is rejected is a row carrying no
 * reading at all, which is silence rather than a measurement.
 *
 * Hard-fails on zero rows examined.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = 'data/queries/evidence/evidence_queries.json';

const VERDICTS = new Set(['HELD_BY_US', 'OPEN', 'CONTESTED', 'HELD', 'UNMEASURED']);
// Set by the regex classifier on every row, so a missing one means the scorer
// did not run over this row at all.
const REQUIRED_FIELDS = ['lead_intent_tier', 'lead_intent_method', 'occupancy'];

const abs = path.join(ROOT, EVIDENCE);
if (!fs.existsSync(abs)) {
  console.error(`validate:evidence-openness FAILED: ${EVIDENCE} is missing.`);
  process.exit(1);
}

let doc;
try {
  doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
} catch (err) {
  console.error(`validate:evidence-openness FAILED: ${EVIDENCE} is not valid JSON (${err.message}).`);
  process.exit(1);
}

const rows = Array.isArray(doc.queries) ? doc.queries : [];
if (!rows.length) {
  console.error(`validate:evidence-openness FAILED: examined zero query rows in ${EVIDENCE}. The scan is broken, or the evidence has been emptied.`);
  process.exit(1);
}

const errors = [];
const verdictCounts = {};

for (const row of rows) {
  const q = row.query || '(unnamed row)';
  const missing = REQUIRED_FIELDS.filter((f) => row[f] === undefined || row[f] === null);
  if (missing.length) {
    errors.push(`"${q}": no reading (missing ${missing.join(', ')}). Run \`npm run queries:score-discovery-gap\`.`);
    continue;
  }
  const occ = row.occupancy;
  if (typeof occ !== 'object' || Array.isArray(occ)) {
    errors.push(`"${q}": occupancy is not an object.`);
    continue;
  }
  if (!VERDICTS.has(occ.verdict)) {
    errors.push(`"${q}": occupancy.verdict is ${JSON.stringify(occ.verdict)}, not one of ${[...VERDICTS].join(', ')}.`);
    continue;
  }
  verdictCounts[occ.verdict] = (verdictCounts[occ.verdict] || 0) + 1;

  // A measured verdict must carry the number it was derived from, and an
  // unmeasured one must NOT carry a score - a null openness is not a zero, and
  // writing 0 for "we did not look" is the exact misreading the method forbids.
  if (occ.verdict === 'UNMEASURED') {
    if (occ.openness_score !== null && occ.openness_score !== undefined) {
      errors.push(`"${q}": verdict UNMEASURED but openness_score is ${occ.openness_score}. An unmeasured query has no score; it must be null, never 0.`);
    }
    if (!occ.reason) errors.push(`"${q}": verdict UNMEASURED with no reason. An unmeasured row must name why it was not measured.`);
  } else if (typeof occ.openness_score !== 'number' || occ.openness_score < 0 || occ.openness_score > 1) {
    errors.push(`"${q}": verdict ${occ.verdict} but openness_score is ${JSON.stringify(occ.openness_score)}; a measured verdict requires a score in [0,1].`);
  }
}

if (!doc.discovery_gap_pass || !doc.discovery_gap_pass.by) {
  errors.push(`${EVIDENCE} has no discovery_gap_pass receipt naming the script that scored it.`);
}

if (errors.length) {
  console.error(`validate:evidence-openness FAILED: ${errors.length} of ${rows.length} evidence row(s) are unscored or inconsistent.`);
  for (const e of errors.slice(0, 40)) console.error(`  - ${e}`);
  if (errors.length > 40) console.error(`  ... and ${errors.length - 40} more`);
  process.exit(1);
}

const summary = Object.entries(verdictCounts).sort().map(([k, v]) => `${k}=${v}`).join(' ');
console.log(`Evidence openness coverage OK (${rows.length} evidence row(s), every one carrying a lead-intent tier and an occupancy verdict; ${summary})`);
