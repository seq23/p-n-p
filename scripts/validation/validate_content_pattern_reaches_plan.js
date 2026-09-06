#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * The measured content-block gaps must reach the work queue.
 *
 * This guards a link, not a file. Both components on either side of it were
 * individually correct and had been for weeks, which is exactly why nobody
 * noticed:
 *
 *   - scripts/validators/validate_content_pattern_contract.js measured every
 *     page against .clarity/content-pattern-spec.json on every run and wrote
 *     reports/validation/content-pattern-contract.json.
 *   - scripts/authority_scale/build_improvement_plan.mjs built the only artifact
 *     in this repo that says what to actually do to a page, from its own
 *     hardcoded suggestion() regexes.
 *
 * Neither read the other. So `source_block` missing on 109 of 109 pages, and
 * `prompt_template` at 0% with no emitter anywhere in the repo, were measured,
 * printed, committed to evidence - and assigned to nobody, every single run. A
 * validator that reports a gap into a CI log and no further has not found the
 * defect; it has become one.
 *
 * What this asserts:
 *
 *   1. The plan carries a content_block_gaps section covering EVERY block in the
 *      spec. A block that quietly stops being reported is a block that stops
 *      being worked.
 *   2. Every route the contract measured as missing a block names that block in
 *      its recommended_improvements. This is the actual join - break it and the
 *      plan silently reverts to its own hardcoded list.
 *   3. A block retired with applies_to_repo:false is lane `named_stop`, carries
 *      its written reason, and is queued against NO route. A named stop is a
 *      decision that has been made, not work; queueing it would be busywork and
 *      dropping its reason would be a silenced check.
 *   4. A block whose emitter exists but which no data ever reaches is lane
 *      `starved_needs_data`, so the plan distinguishes work that needs an
 *      engineer from work that needs content.
 *
 * Rule 0: this hard-fails when it examines zero blocks or zero joined routes.
 * A link check that joined nothing has proved nothing, and reporting success on
 * an empty loop is the failure mode this whole file exists to prevent.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SPEC_PATH = '.clarity/content-pattern-spec.json';
const CONTRACT_PATH = 'reports/validation/content-pattern-contract.json';
const PLAN_PATH = 'data/authority_scale/page_improvement_plan.json';

const errors = [];
const read = (rel) => {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.error(`validate:content-pattern-reaches-plan FAILED: ${rel} is missing. `
      + 'The link between the measurement and the work queue cannot be checked without it.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
};

const spec = read(SPEC_PATH);
const contract = read(CONTRACT_PATH);
const plan = read(PLAN_PATH);

const specBlocks = spec.blocks || [];
if (!specBlocks.length) {
  console.error(`validate:content-pattern-reaches-plan FAILED: ${SPEC_PATH} declares zero blocks. `
    + 'An empty spec would let every assertion below pass on an empty loop.');
  process.exit(1);
}

const gaps = plan.content_block_gaps;
if (!gaps || !Array.isArray(gaps.blocks) || !gaps.blocks.length) {
  console.error(`validate:content-pattern-reaches-plan FAILED: ${PLAN_PATH} carries no content_block_gaps section. `
    + 'The improvement plan is back to its own hardcoded suggestion list and the measured gaps reach no queue. '
    + 'Rebuild it with `npm run authority:improvements:build` after `npm run validate:content-pattern`.');
  process.exit(1);
}

// ---- 1. every spec block is represented in the plan
const planBlockIds = new Set(gaps.blocks.map((b) => b.id));
for (const b of specBlocks) {
  if (!planBlockIds.has(b.id)) {
    errors.push(`spec block "${b.id}" is absent from the plan's content_block_gaps. `
      + 'A block that stops being reported stops being worked.');
  }
}

// ---- 3/4. named stops and starved lanes are classified, not silently dropped
const retired = new Set();
for (const b of specBlocks) {
  const entry = gaps.blocks.find((x) => x.id === b.id);
  if (!entry) continue;
  if (b.applies_to_repo === false) {
    retired.add(b.id);
    if (entry.lane !== 'named_stop') {
      errors.push(`spec block "${b.id}" is retired with applies_to_repo:false but the plan lanes it as "${entry.lane}". `
        + 'A named stop must be visible as one.');
    }
    if (!String(entry.named_stop || '').trim()) {
      errors.push(`spec block "${b.id}" is retired but the plan carries no reason for it. `
        + 'A stop nobody can read the reason for is a silenced check.');
    }
  } else if (entry.lane === 'named_stop') {
    errors.push(`spec block "${b.id}" applies to this repo but the plan lanes it as a named stop.`);
  }
}

const starvedIds = new Set(((contract.spec_producer_parity || {}).starved_blocks || []).map((b) => b.id));
for (const id of starvedIds) {
  const entry = gaps.blocks.find((x) => x.id === id);
  if (entry && entry.lane !== 'starved_needs_data') {
    errors.push(`block "${id}" has an emitter that no data reaches, but the plan lanes it as "${entry.lane}". `
      + 'Work that needs content must not be filed as work that needs code.');
  }
}

// ---- 2. the join itself: measured gaps appear against the routes they apply to
const gapsFull = contract.gaps_full || {};
const missingByRoute = new Map();
for (const [blockId, routes] of Object.entries(gapsFull)) {
  if (retired.has(blockId)) continue;
  for (const rel of routes) {
    const route = rel.startsWith('/') ? rel : `/${rel}`;
    if (!missingByRoute.has(route)) missingByRoute.set(route, new Set());
    missingByRoute.get(route).add(blockId);
  }
}

let joined = 0;
let assertions = 0;
for (const p of plan.plans || []) {
  const expected = missingByRoute.get(p.route);
  // A route the contract never measured - published after the last contract run -
  // is not a failure. A route it DID measure and the plan ignored is.
  if (!expected) continue;
  joined += 1;
  const named = JSON.stringify(p.recommended_improvements || []);
  for (const blockId of expected) {
    assertions += 1;
    if (!named.includes(blockId)) {
      errors.push(`route ${p.route} is measured as missing "${blockId}" but its plan never names it. `
        + 'The measurement is not reaching the work queue for this route.');
    }
  }
  // A retired block must never be queued as work.
  for (const blockId of retired) {
    if (named.includes(blockId)) {
      errors.push(`route ${p.route} queues retired block "${blockId}" as work. `
        + 'A named stop is a decision already made, not a task.');
    }
  }
}

// ---- Rule 0: an empty loop is a failure, not a pass.
if (!joined || !assertions) {
  console.error('validate:content-pattern-reaches-plan FAILED: examined '
    + `${joined} joined route(s) and ${assertions} block assertion(s). `
    + 'Nothing was checked, so nothing was proved. Either the plan and the contract no longer share a route '
    + 'spelling, or one of them is empty - both are the defect this validator exists to catch, not a clean run.');
  process.exit(1);
}

if (errors.length) {
  console.error(`validate:content-pattern-reaches-plan FAILED: ${errors.length} broken link(s) between the `
    + 'content-pattern measurement and the improvement plan.');
  for (const e of errors.slice(0, 25)) console.error(`  - ${e}`);
  if (errors.length > 25) console.error(`  ...and ${errors.length - 25} more`);
  process.exit(1);
}

const laneCount = gaps.blocks.reduce((acc, b) => { acc[b.lane] = (acc[b.lane] || 0) + 1; return acc; }, {});
console.log('Content-pattern gaps reach the improvement plan OK '
  + `(${specBlocks.length} spec block(s) all represented; ${joined} route(s) joined; `
  + `${assertions} route/block assertion(s) held; lanes ${JSON.stringify(laneCount)}).`);
for (const b of gaps.blocks.filter((x) => x.lane === 'named_stop')) {
  console.log(`  NAMED STOP ${b.id}: ${String(b.named_stop).split('.')[0]}.`);
}
