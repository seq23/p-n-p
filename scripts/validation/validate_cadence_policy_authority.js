#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * The cadence policy is the only source of the cadence rates.
 *
 * scripts/cadence_gate.js carried a DEFAULT_POLICY of new_pages_per_week: 2 and
 * refresh_capacity_per_week: 25. Those were this repo's rates before the cadence
 * was throttled to 1 and 8, and they were merged UNDER the policy file:
 *
 *     { ...DEFAULT_POLICY, ...JSON.parse(policyFile) }
 *
 * so with the policy present nothing looked wrong, and with it absent - deleted,
 * renamed, or missed by a mistyped `--policy` path - the gate did not fail. It
 * printed `CADENCE GATE CLEAR ... ceiling 325` and exited 0, having quietly
 * replaced a cap of 1 page/week with 2 and a maintainable ceiling of 104 with
 * 325. Reproduced by moving data/cadence/policy.json aside and running the gate.
 *
 * A guard whose failure mode is to permit three times the declared rate while
 * reporting success is worse than no guard, because the report is believed.
 *
 * This asserts three things:
 *   1. the policy file exists and declares every rate the gate enforces;
 *   2. the gate source contains no fallback rate literal - the numbers live in
 *      the policy and nowhere else, so a future throttle cannot leave a stale
 *      copy of the old rate behind;
 *   3. behaviourally, that the gate EXITS NON-ZERO with the policy absent. Read
 *      from the running program rather than from its source, because a comment
 *      saying it hard-fails is not evidence that it does.
 *
 * The derived number - the maintainable ceiling - is deliberately not asserted
 * as a literal anywhere. It is refresh_capacity_per_week x whole weeks in
 * refresh_window_days, computed at runtime, so changing either rate moves it.
 *
 * Hard-fails if it checks zero rates.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const POLICY = 'data/cadence/policy.json';
const GATE = 'scripts/cadence_gate.js';

// Every rate the gate enforces. A rate absent here is a rate nothing guards.
const REQUIRED_RATES = [
  'refresh_window_days',
  'high_value_window_days',
  'stale_tolerance_pct',
  'new_pages_per_week',
  'refresh_capacity_per_week',
  'require_lastmod',
];

const errors = [];

// ---------------------------------------------------------------- 1. the policy
const policyAbs = path.join(ROOT, POLICY);
if (!fs.existsSync(policyAbs)) {
  console.error(`validate:cadence-policy-authority FAILED: ${POLICY} is missing. It is the only declared source of this repo's publication cadence.`);
  process.exit(1);
}
let policy;
try {
  policy = JSON.parse(fs.readFileSync(policyAbs, 'utf8'));
} catch (err) {
  console.error(`validate:cadence-policy-authority FAILED: ${POLICY} is not valid JSON (${err.message}).`);
  process.exit(1);
}
for (const key of REQUIRED_RATES) {
  if (policy[key] === undefined || policy[key] === null) {
    errors.push(`${POLICY} does not declare \`${key}\`, which ${GATE} enforces.`);
  }
}

// --------------------------------------------------- 2. no fallback rate literal
const gateAbs = path.join(ROOT, GATE);
if (!fs.existsSync(gateAbs)) {
  console.error(`validate:cadence-policy-authority FAILED: ${GATE} is missing. There is no gate to check.`);
  process.exit(1);
}
const gateSrc = fs.readFileSync(gateAbs, 'utf8');
// Strip comments before looking for literals: the file explains the rates it no
// longer hardcodes, and prose about a number is not a fallback for it.
const gateCode = gateSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n');

let ratesChecked = 0;
for (const key of REQUIRED_RATES) {
  ratesChecked += 1;
  // `new_pages_per_week: 2` in code is a fallback. `policy.new_pages_per_week`
  // is a read, and `'new_pages_per_week'` in a required-keys list is a name.
  const assigned = new RegExp(`(^|[^.\\w'"\`])${key}\\s*:\\s*(\\d|true|false)`, 'm');
  if (assigned.test(gateCode)) {
    errors.push(
      `${GATE} assigns a literal value to \`${key}\`. The cadence rates must come from ${POLICY} and nowhere else - `
      + 'a second copy in the gate is how a throttled cadence silently reverts to the rate it was throttled from.',
    );
  }
}
if (!ratesChecked) {
  console.error('validate:cadence-policy-authority FAILED: checked zero rates. The scan is broken, not the repo.');
  process.exit(1);
}

// ------------------------------------------ 3. the gate really stops without it
// Behavioural, not textual. A missing policy must be a hard stop, and the only
// way to know that is to run it that way. Points --policy at a path that does
// not exist, so nothing on disk is touched or moved.
const probe = spawnSync(
  process.execPath,
  [GATE, '--policy', 'data/cadence/__no_such_policy_for_validation__.json'],
  { cwd: ROOT, encoding: 'utf8' },
);
if (probe.status === 0) {
  errors.push(
    `${GATE} exited 0 when pointed at a policy file that does not exist. With no policy it must refuse to run, `
    + 'not substitute a cap of its own. Output was: '
    + `${`${probe.stdout || ''}${probe.stderr || ''}`.trim().split('\n').slice(-2).join(' / ') || '(none)'}`,
  );
}

if (errors.length) {
  console.error(`validate:cadence-policy-authority FAILED: ${errors.length} finding(s).`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const ceiling = policy.refresh_capacity_per_week * Math.floor(policy.refresh_window_days / 7);
console.log(
  `Cadence policy authority OK (${ratesChecked} rate(s) declared in ${POLICY} and none restated in ${GATE}; `
  + `gate exits ${probe.status} with the policy absent; derived ceiling ${ceiling} = `
  + `${policy.refresh_capacity_per_week}/wk x ${Math.floor(policy.refresh_window_days / 7)} weeks, computed not stored)`,
);
