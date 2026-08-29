#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Workflow lane integrity.
 *
 * Two lane-level defects that no per-script validator can see, because in both
 * cases every individual script is correct and it is the wiring between them
 * that is wrong. Both were live in this repo.
 *
 * 1. A DRY RUN THAT KILLS THE REAL RUN.
 *    self-heal.yml ran `npm run selfheal:dry` as an ordinary step and then
 *    `npm run selfheal` after it. Those are the same binary; the dry variant
 *    exits 1 whenever the tree is not clean, which is exactly the state in which
 *    the lane has work to do. So the reporting step aborted the job and the
 *    repair step never executed: the only day self-healing could go green was a
 *    day it had nothing to heal. Reproduced by deleting one <url> from
 *    sitemap.xml - `npm run selfheal:dry` prints "would repair sitemap-coverage"
 *    and exits 1.
 *
 *    Rule: if a workflow runs a dry-run command AND later runs its real
 *    counterpart, the dry step must be marked continue-on-error.
 *
 * 2. A COMMITTING LANE WITH NO PATH TO THE LANE THAT PUBLISHES ITS WORK.
 *    A push made by a workflow using the default GITHUB_TOKEN raises no `push`
 *    event. deploy-distribution.yml triggered only on `push`, so none of the bot
 *    commits from authority-daily.yml or self-heal.yml ever reached it, and
 *    deploy_distribution.sh - the sole caller of IndexNow submission, sitemap
 *    submission and GSC URL inspection - never ran for an automated publication.
 *    Confirmed against the API rather than reasoned: `gh run list --commit <sha>`
 *    returned an empty list for all four bot commits on main.
 *
 *    Rule: every workflow that pushes must be named in the distribution lane's
 *    workflow_run trigger, so the link is declared in the repo rather than
 *    assumed to exist.
 *
 * Hard-fails when it examines zero workflows: a scan that finds nothing because
 * it looked nowhere must not report success.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const WF_DIR = path.join(ROOT, '.github/workflows');
const DISTRIBUTION_LANE = 'deploy-distribution.yml';

// ------------------------------------------------------ rule 0: it must parse
// A workflow file that GitHub cannot parse does not fail a step. It produces a
// run with an EMPTY JOB LIST and no log at all, which reads as an ordinary red
// X and cannot be diagnosed from the Actions UI - the only way to see the
// reason is `gh workflow run`, which answers
// `HTTP 422: failed to parse workflow: (Line: N, Col: M)`.
//
// This repo has hit that twice. First when removing the last key from an `env:`
// mapping left the key with only a comment under it, and an empty mapping key
// is invalid YAML (run 33196058541, `"jobs": []`). Then again while fixing the
// distribution trigger in this very change, when an edit left `workflow_run:`
// declared twice in the same `on:` block (run 33274799002, also 0s, also empty).
//
// The lane checks below are regex-based and neither of those defects tripped
// them, because both files still CONTAINED all the right strings. So the two
// structural faults that actually produce a 0s startup failure are checked
// directly. This is not a YAML parser - it is the two specific shapes that have
// cost this repo a red main, caught locally instead of in CI.
function structuralFaults(lines) {
  const found = [];
  // Strip comments and blanks, but keep original line numbers for the message.
  const sig = lines
    .map((raw, i) => ({ n: i + 1, raw }))
    .filter(({ raw }) => raw.trim() !== '' && !/^\s*#/.test(raw));

  const seen = new Map(); // scope -> Map(key -> first line seen)
  const stack = []; // { indent, key }
  const seqCount = new Map();

  for (let i = 0; i < sig.length; i += 1) {
    const { n, raw } = sig[i];

    // Sequence items open their own key namespace. Two steps in a list both
    // saying `uses:` are siblings, not a redefinition, so without this every
    // multi-step workflow reads as hundreds of duplicates.
    const seq = raw.match(/^(\s*)-\s+(.*)$/);
    let indent;
    let content;
    if (seq) {
      indent = seq[1].length;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const ck = `${indent} ${stack.map((x) => x.key).join('.')}`;
      const idx = (seqCount.get(ck) || 0) + 1;
      seqCount.set(ck, idx);
      stack.push({ indent, key: `[${idx}]` });
      content = seq[2];
      indent += 2; // the key sits where the text after "- " begins
    } else {
      indent = raw.search(/\S/);
      content = raw.slice(indent);
    }

    const m = content.match(/^([A-Za-z_][\w.-]*)\s*:(.*)$/);
    if (!m) continue;
    const key = m[1];
    const rest = m[2].trim();

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parentPath = stack.map((x) => x.key).join('.');
    const scope = `${indent} ${parentPath}`;
    if (!seen.has(scope)) seen.set(scope, new Map());
    const inScope = seen.get(scope);
    if (inScope.has(key)) {
      found.push(
        `line ${n}: \`${key}\` is already defined at line ${inScope.get(key)} in the same block`
        + `${parentPath ? ` (under \`${parentPath}\`)` : ''}. GitHub rejects the whole file, producing a 0s run with an empty job list.`,
      );
    } else {
      inScope.set(key, n);
    }

    // A mapping key with no inline value must have at least one more-indented
    // line under it. `env:` followed only by a comment is the empty-mapping case.
    if (rest === '') {
      const next = sig[i + 1];
      const childIndent = next ? next.raw.search(/\S/) : -1;
      if (!next || childIndent <= indent) {
        // Keys that are legitimately empty in Actions: an event name with no
        // filters (`workflow_dispatch:`), and a step key like `with:` never is.
        const EMPTY_OK = new Set(['workflow_dispatch', 'push', 'pull_request', 'schedule', 'release', 'issues', 'fork', 'watch']);
        if (!EMPTY_OK.has(key)) {
          found.push(
            `line ${n}: \`${key}:\` opens a mapping with nothing under it${next ? '' : ' (end of file)'}. `
            + 'An empty mapping key is invalid YAML and makes the entire workflow a startup failure with no readable log. '
            + 'Delete the key, or give it content.',
          );
        }
      }
    }
    if (rest === '') stack.push({ indent, key });
  }
  return found;
}

const errors = [];

if (!fs.existsSync(WF_DIR)) {
  console.error(`validate:workflow-lane-integrity FAILED: no ${path.relative(ROOT, WF_DIR)} directory. The scan is broken, not the repo.`);
  process.exit(1);
}

const files = fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
if (!files.length) {
  console.error('validate:workflow-lane-integrity FAILED: examined zero workflow files. The scan is broken, not the repo.');
  process.exit(1);
}

const wf = new Map();
for (const f of files) {
  const text = fs.readFileSync(path.join(WF_DIR, f), 'utf8');
  const lines = text.split('\n');
  const nameLine = lines.find((l) => /^name:\s*\S/.test(l));
  const name = nameLine ? nameLine.replace(/^name:\s*/, '').trim().replace(/^["']|["']$/g, '') : null;
  wf.set(f, { text, lines, name });
}

// ---------------------------------------------------------------- step model
// Steps are `- name: ...` entries. A step owns every line up to the next list
// item at the same indentation, which is enough structure for both rules here
// without taking a YAML parser dependency this repo does not have.
function steps(lines) {
  const out = [];
  let cur = null;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\s*)-\s+(name|uses|run):/);
    if (m) {
      if (cur) out.push(cur);
      cur = { indent: m[1].length, start: i, body: [lines[i]] };
      continue;
    }
    if (cur) {
      const indented = /^\s*$/.test(lines[i]) || (lines[i].search(/\S/) > cur.indent);
      if (indented) cur.body.push(lines[i]);
      else { out.push(cur); cur = null; }
    }
  }
  if (cur) out.push(cur);
  return out.map((s) => ({ ...s, text: s.body.join('\n') }));
}

// A dry-run invocation and the real command it shadows.
const DRY_PATTERNS = [
  { dry: /npm run (\S+):dry\b/g, real: (m) => `npm run ${m[1]}` },
  { dry: /(npm run \S+|node \S+)[^\n]*--dry-run\b/g, real: (m) => m[1] },
];

let dryStepsChecked = 0;
let pushingLanes = 0;
let branchOps = 0;

let structuralChecked = 0;

for (const [file, { text, lines }] of wf) {
  const all = steps(lines);

  // Rule 0 - the file must be parseable at all.
  structuralChecked += 1;
  for (const f of structuralFaults(lines)) errors.push(`${file}: ${f}`);

  // Rule 1 - a fail-fast dry run ahead of the real command.
  for (const step of all) {
    for (const { dry, real } of DRY_PATTERNS) {
      dry.lastIndex = 0;
      let m;
      while ((m = dry.exec(step.text)) !== null) {
        const realCmd = real(m);
        // Only a problem when the real counterpart actually runs later in the
        // same workflow. A lane that ONLY reports is entitled to fail on its
        // report, because the report is the whole point of that lane.
        const laterRuns = all.some((s) => s.start > step.start && s.text.includes(realCmd) && !/--dry-run|:dry\b/.test(s.text));
        if (!laterRuns) continue;
        dryStepsChecked += 1;
        if (!/continue-on-error:\s*true/.test(step.text)) {
          errors.push(
            `${file}: the step running \`${m[0].trim()}\` is a fail-fast step, and \`${realCmd}\` runs after it. `
            + 'The dry variant exits non-zero whenever there is work to do, so this step aborts the job in exactly '
            + 'the case the lane exists for and the real command never runs. Mark the dry step continue-on-error: true.',
          );
        }
      }
    }
  }

  // Rule 3 - no lane may hardcode the branch it rebases onto or pushes to.
  //
  // self-heal.yml said `git pull --rebase origin main` and `git push origin
  // main` literally, so the lane was correct only on its schedule. Dispatched
  // on any other ref it rebased that branch onto main and pushed the result
  // BACK to main - a lane nobody watches, silently writing branch content to
  // the default branch. The observed failure (run 33275050208, four conflicting
  // report files) was the lucky outcome; a clean rebase was the dangerous one.
  //
  // A workflow must operate on the ref it was invoked on.
  for (const step of steps(lines)) {
    const m = step.text.match(/git\s+(?:pull|push)[^\n]*\borigin\s+["']?(main|master)\b/);
    if (m) {
      branchOps += 1;
      errors.push(
        `${file}: \`${m[0].trim()}\` hardcodes the branch "${m[1]}". A workflow dispatched on any other ref would `
        + `then rebase onto, or push to, ${m[1]} regardless of where it was run. Use the ref it is running on `
        + '($GITHUB_REF_NAME, or HEAD:$GITHUB_REF_NAME to push).',
      );
    }
  }

  // Rule 2 - a lane that pushes must be reachable by the distribution lane.
  if (/^\s*git push\b/m.test(text) || /\bgit push origin\b/.test(text)) {
    pushingLanes += 1;
    const name = wf.get(file).name;
    if (file !== DISTRIBUTION_LANE) {
      const dist = wf.get(DISTRIBUTION_LANE);
      if (!dist) {
        errors.push(`${file} pushes commits, but ${DISTRIBUTION_LANE} does not exist, so nothing distributes what it publishes.`);
      } else if (!name) {
        errors.push(`${file} pushes commits but declares no top-level \`name:\`, so it cannot be named in a workflow_run trigger.`);
      } else {
        const trig = dist.text.match(/workflow_run:[\s\S]*?workflows:\s*\[([^\]]*)\]/);
        const listed = trig
          ? trig[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
          : [];
        if (!listed.includes(name)) {
          errors.push(
            `${file} ("${name}") pushes commits with the default GITHUB_TOKEN, which raises no \`push\` event, `
            + `but it is not named in ${DISTRIBUTION_LANE}'s workflow_run trigger (currently: ${listed.length ? listed.join(', ') : 'none'}). `
            + 'Everything it commits would be published and then never distributed. Add it to that trigger.',
          );
        }
      }
    }
  }
}

if (errors.length) {
  console.error(`validate:workflow-lane-integrity FAILED: ${errors.length} lane defect(s).`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  `Workflow lane integrity OK (${files.length} workflow(s) scanned; ${structuralChecked} checked for the duplicate-key and empty-mapping faults that cause a 0s startup failure; `
  + `${dryStepsChecked} dry-run step(s) shadowing a real command, all continue-on-error; `
  + `${pushingLanes} pushing lane(s), each reachable from ${DISTRIBUTION_LANE}; ${branchOps} hardcoded-branch git operation(s))`,
);
