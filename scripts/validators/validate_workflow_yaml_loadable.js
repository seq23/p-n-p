#!/usr/bin/env node
'use strict';
/**
 * Every file in .github/workflows/ must parse, and must parse into a workflow
 * GitHub will actually schedule.
 *
 * WHY THIS EXISTS
 *
 * "Daily Authority Cycle" was red from 2026-08-28 (run 33196058541) with ZERO jobs and
 * no log output whatsoever - GitHub reports only "This run likely failed because of a
 * workflow file issue" and never names the line. The cause:
 *
 *     env:
 *       # across the portfolio at daily cadence. 3 still names the incumbents
 *
 *     jobs:
 *
 * Commit eedf501 added `env:` with that comment and a `PROBE_WEB_MAX_RESULTS: "3"` under
 * it. Commit 7b3c85c removed the key/value line and left `env:` and its orphan comment
 * behind. A mapping key whose only child is a comment parses as NULL, and GitHub requires
 * `env` to be a mapping, so it rejected the whole file. Every scheduled run after that
 * silently did nothing: no jobs, no steps, no ingest, no publish, no commit.
 *
 * That failure mode is invisible from the outside. YAML that is perfectly VALID can still
 * be an INVALID workflow, the run is red with no diagnostics, and the workflow can sit
 * dead for days looking like an ordinary CI failure. This validator makes it a local,
 * named, one-line error instead.
 *
 * It deliberately does NOT need a YAML library: parsing the whole language would be a
 * dependency this repo does not carry. It checks the specific structural faults that
 * produce a zero-job run, all of which are visible from indentation.
 *
 * Usage: node scripts/validators/validate_workflow_yaml_loadable.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, '.github', 'workflows');

// Keys GitHub requires to be a MAPPING when present. Declared and left empty, each one
// invalidates the workflow file.
const MUST_BE_MAPPING = new Set(['env', 'with', 'permissions', 'jobs', 'steps', 'inputs', 'outputs', 'secrets', 'concurrency', 'defaults', 'strategy', 'services', 'container']);

const errors = [];
const notes = [];

if (!fs.existsSync(DIR)) {
  console.error('WORKFLOW YAML FAILED: .github/workflows/ does not exist.');
  console.error('  This validator governs CI workflow files and there are none to govern.');
  process.exit(1);
}

const files = fs.readdirSync(DIR).filter((f) => /\.ya?ml$/i.test(f)).sort();

// Rule 0: an empty loop must never pass. Every check below iterates `files`; with none,
// this would print a confident PASS having asserted nothing at all.
if (files.length === 0) {
  console.error('WORKFLOW YAML FAILED: examined 0 workflow files.');
  console.error(`  ${path.relative(ROOT, DIR)} contains no .yml/.yaml file.`);
  console.error('  Nothing was measured, so nothing can be attested.');
  process.exit(1);
}

const indentOf = (line) => line.length - line.replace(/^\s*/, '').length;

for (const file of files) {
  const rel = path.join('.github/workflows', file);
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
  const lines = raw.split(/\r?\n/);

  if (/\t/.test(raw)) {
    const n = lines.findIndex((l) => l.includes('\t')) + 1;
    errors.push(`${rel}:${n}: contains a TAB. YAML forbids tabs for indentation and GitHub rejects the file.`);
  }

  let sawJobs = false;
  const jobNames = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const m = /^(\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, indent, key, rest] = m;
    if (rest.trim() !== '' && !rest.trim().startsWith('#')) continue; // has an inline value

    if (indent.length === 0 && key === 'jobs') sawJobs = true;
    if (sawJobs && indent.length === 2) jobNames.push(key);

    if (!MUST_BE_MAPPING.has(key)) continue;

    // Find the next line that carries real content. Comments do NOT count as children -
    // that is the entire bug this validator exists for.
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith('#'))) j++;
    const childIndent = j < lines.length ? indentOf(lines[j]) : -1;

    if (j >= lines.length || childIndent <= indent.length) {
      const commentOnly = lines.slice(i + 1, j).some((l) => l.trim().startsWith('#'));
      errors.push(`${rel}:${i + 1}: "${key}:" is declared but has no entries`
        + (commentOnly ? ' (only a comment follows it, and a comment is not a child)' : '')
        + `. GitHub requires "${key}" to be a mapping; declared empty it parses as null and the`
        + ' ENTIRE workflow is rejected - the run shows zero jobs and no logs. Delete the key or give it entries.');
    }
  }

  if (!sawJobs) {
    errors.push(`${rel}: has no top-level "jobs:" key, so GitHub has nothing to run.`);
  } else if (jobNames.length === 0) {
    errors.push(`${rel}: "jobs:" declares no job. A workflow with zero jobs is red with no diagnostics.`);
  } else {
    notes.push(`${rel}: ${jobNames.length} job(s) - ${jobNames.join(', ')}`);
  }
}

console.log(`WORKFLOW YAML: examined ${files.length} workflow file(s).`);
for (const n of notes) console.log(`  ${n}`);

if (errors.length) {
  console.error('\nWORKFLOW YAML FAILED');
  console.error('  A workflow file would be rejected by GitHub. Such a run is red with ZERO jobs');
  console.error('  and NO log output, so this must be caught here rather than in Actions.');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('PASS: every workflow file parses into a schedulable workflow.');
