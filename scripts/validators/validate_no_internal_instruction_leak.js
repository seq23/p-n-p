#!/usr/bin/env node
'use strict';
// No published page may contain internal build instructions.
//
// The external review agent sends recommendations as build directives shaped like
//   "FILEPATH: x || CURRENT: ... || MISSING: ... || EDIT: ..."
// In a sibling repo two generator paths rendered those as reader-facing copy: a
// fallback "acceptance checklist" card, and target.answer via
// "Citation-ready update: ". 163 published pages carried the first and 100 the
// second - the second inside the direct-answer block, which is the exact text an
// answer engine extracts.
//
// It also explains a reported symptom: the agent kept re-flagging pages marked
// released, because it was reading its own instruction back off the page instead
// of the content it asked for.
//
// This repo publishes the same way (scripts/generators/build_pages.js renders
// queued entries whose fields are written by the search-intelligence and
// improvement-plan lanes), so the same defect is possible here.
//
// data/** and reports/** are exempt: repair candidates, improvement plans and
// diagnosis output live there and are supposed to contain this text. They are
// not part of the published surface. .build/ is the deploy mirror and is rebuilt
// from the scanned source.
//
// Evidence lands in reports/validation/ rather than artifacts/: scripts/validation/
// validate_tree_hygiene.js allows only a fixed set of root directories and
// artifacts/ is not one of them.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, 'reports/validation/internal-instruction-leak.json');
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'data', 'artifacts', 'reports', 'staging', 'templates',
  'distribution_scripts',
]);

const PATTERNS = [
  [/FILEPATH:/, 'raw agent recommendation (FILEPATH:)'],
  [/\|\|\s*(CURRENT|MISSING|EDIT)\s*:/i, 'raw agent recommendation field separator'],
  [/Citation-ready update:/i, 'instruction appended to the answer block'],
  [/Marker-only framework cards/i, 'build policy text rendered as page copy'],
  [/Required semantic acceptance:/i, 'build policy text rendered as page copy'],
];

const offenders = [];
let scanned = 0;
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(abs);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;
    scanned += 1;
    const html = fs.readFileSync(abs, 'utf8');
    for (const [re, why] of PATTERNS) {
      if (re.test(html)) { offenders.push({ path: rel, reason: why }); break; }
    }
  }
})(ROOT);

fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
fs.writeFileSync(EVIDENCE, `${JSON.stringify({
  schema_version: '1.0',
  validator: 'no-internal-instruction-leak',
  generated_at: new Date().toISOString(),
  status: offenders.length ? 'FAIL' : 'PASS',
  files_scanned: scanned,
  offender_count: offenders.length,
  offenders: offenders.slice(0, 200),
}, null, 2)}\n`);

if (offenders.length) {
  console.error(`VALIDATION FAIL: ${offenders.length} published page(s) contain internal build instructions`);
  for (const o of offenders.slice(0, 15)) console.error(`- ${o.path} :: ${o.reason}`);
  if (offenders.length > 15) console.error(`- ...and ${offenders.length - 15} more`);
  console.error('- remedy: the generator must render the requested content, never the recommendation text that asked for it');
  process.exit(1);
}
console.log(`No internal instruction leak OK: ${scanned} published pages contain no build directives.`);
