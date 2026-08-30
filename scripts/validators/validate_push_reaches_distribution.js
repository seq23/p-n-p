#!/usr/bin/env node
'use strict';
/**
 * A workflow that pushes to main must make sure the push-triggered workflows
 * actually run.
 *
 * WHY THIS EXISTS
 *
 * deploy-distribution.yml runs distribution_scripts/deploy_distribution.sh - the only
 * place this repo submits anything to Google Search Console - and it triggers on
 * `push: branches: [main]`.
 *
 * authority-daily.yml publishes pages, commits them and pushes with the default
 * GITHUB_TOKEN. GitHub does not start workflows from pushes made with that token. So
 * every governed cycle committed its pages and stopped: the pages were in the repo and
 * had been submitted nowhere. Nothing was red. The cycle reported success, the
 * distribution simply never happened - "runs but inert", visible only by noticing that
 * Deploy Distribution had no runs behind the bot commits.
 *
 * WHAT THIS ASSERTS
 *
 * For every workflow that pushes with the default token, at least one of:
 *   - it checks out with a non-default token (a PAT, which does raise push events), or
 *   - it explicitly dispatches each workflow that triggers on push to main.
 *
 * Usage: node scripts/validators/validate_push_reaches_distribution.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DIR = path.join(ROOT, '.github', 'workflows');

if (!fs.existsSync(DIR)) {
  console.error('PUSH REACHES DISTRIBUTION FAILED: .github/workflows/ does not exist.');
  process.exit(1);
}
const files = fs.readdirSync(DIR).filter((f) => /\.ya?ml$/i.test(f)).sort();

const workflows = files.map((f) => ({ file: f, rel: `.github/workflows/${f}`, text: fs.readFileSync(path.join(DIR, f), 'utf8') }));

// Workflows that only run because someone pushed to main.
const pushTriggered = workflows.filter((w) => /^on:/m.test(w.text) && /^\s{2}push:/m.test(w.text) && /branches:\s*\[[^\]]*main/.test(w.text));
// Workflows that push to main themselves.
const pushers = workflows.filter((w) => /^\s*git push\b/m.test(w.text));

// ---------------------------------------------------------------------------
// Rule 0: an empty loop must never pass. If nothing pushes, or nothing is
// push-triggered, this validator has no pair to check and must say so rather than
// print a confident PASS over an empty relation.
// ---------------------------------------------------------------------------
if (files.length === 0 || pushers.length === 0 || pushTriggered.length === 0) {
  console.error('PUSH REACHES DISTRIBUTION FAILED: examined 0 workflow pairs.');
  console.error(`  workflow files: ${files.length}`);
  console.error(`  workflows that git push: ${pushers.length} (${pushers.map((w) => w.file).join(', ') || 'none'})`);
  console.error(`  workflows triggered by push to main: ${pushTriggered.length} (${pushTriggered.map((w) => w.file).join(', ') || 'none'})`);
  console.error('  With no pair to relate, nothing can be attested. If this repo genuinely no longer');
  console.error('  pushes from CI, retire this validator deliberately rather than letting it pass empty.');
  process.exit(1);
}

const errors = [];
const exemptions = [];
let checked = 0;
for (const pusher of pushers) {
  // A checkout given an explicit non-default token pushes as a real user, which does
  // raise push events. That is a legitimate alternative to dispatching.
  //
  // Line-scanned, NOT a multi-line regex. The first version of this was
  //   /actions\/checkout@[^\n]*\n(?:\s+[^\n]*\n)*?\s+token:\s*\$\{\{\s*secrets\.(?!GITHUB_TOKEN)/
  // whose nested quantifiers backtrack catastrophically: on a workflow with no `token:`
  // it never terminated. A validator that hangs is a validator someone disables.
  const usesPat = pusher.text.split('\n').some((line) => {
    const m = /^\s*token:\s*\$\{\{\s*secrets\.([A-Za-z0-9_]+)/.exec(line);
    return Boolean(m) && m[1] !== 'GITHUB_TOKEN';
  });
  // A workflow that commits only evidence has nothing to distribute. That exemption has
  // to be DECLARED IN THE WORKFLOW ITSELF, with a reason, rather than kept as a list in
  // this file - an allowlist here would drift out of sight, and the point is that whoever
  // edits the workflow sees why it is exempt. Bare marker with no reason does not count.
  const exemptionLine = pusher.text.split('\n').find((l) => l.includes('NO-DISTRIBUTION-NEEDED:'));
  const exempt = Boolean(exemptionLine && exemptionLine.split('NO-DISTRIBUTION-NEEDED:')[1].trim().length >= 20);
  if (exemptionLine && !exempt) {
    errors.push(`${pusher.rel}: declares NO-DISTRIBUTION-NEEDED without a reason after the colon. `
      + 'An exemption a reader cannot evaluate is not an exemption.');
  }
  if (exempt) { exemptions.push(`${pusher.file}: ${exemptionLine.split('NO-DISTRIBUTION-NEEDED:')[1].trim().slice(0, 90)}`); continue; }

  for (const target of pushTriggered) {
    if (target.file === pusher.file) continue;
    checked++;
    const dispatches = new RegExp(`gh workflow run\\s+${target.file.replace(/\./g, '\\.')}`).test(pusher.text);
    if (usesPat || dispatches) continue;
    errors.push(`${pusher.rel} pushes to main with the default GITHUB_TOKEN, but ${target.rel} only runs on `
      + `push to main. GitHub raises no push event for a GITHUB_TOKEN push, so ${target.file} never runs after `
      + `${pusher.file} publishes - the work is committed and then submitted nowhere, with nothing turning red. `
      + `Either check out with a PAT, or add a step: gh workflow run ${target.file} --ref main`);
  }
}

console.log(`PUSH REACHES DISTRIBUTION: examined ${checked} pusher/push-triggered pair(s).`);
console.log(`  pushers: ${pushers.map((w) => w.file).join(', ')}`);
console.log(`  push-triggered: ${pushTriggered.map((w) => w.file).join(', ')}`);
for (const e of exemptions) console.log(`  declared exempt - ${e}`);

if (errors.length) {
  console.error('\nPUSH REACHES DISTRIBUTION FAILED');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('PASS: every CI push reaches the workflows that depend on it.');
