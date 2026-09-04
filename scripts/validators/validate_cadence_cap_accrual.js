#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * The publication cap is a RATE, and the gate must enforce it as one.
 *
 * WHAT WENT WRONG
 * ---------------
 * `data/cadence/policy.json` declares `new_pages_per_week`. `scripts/cadence_gate.js`
 * enforced it with:
 *
 *     newPublications.length > policy.new_pages_per_week
 *
 * There is no time term on either side. The left-hand side accumulates from the
 * last `cadence:accept` with no window at all - the ledger's `generated_at` was
 * read by nothing - while the right-hand side is one week's worth. Two
 * denominators, one comparison.
 *
 * Reproduced on 2026-09-04 against the live tree: a ledger baseline eight weeks
 * old with four pages published since - four against a declared allowance of
 * 1/week x 8 weeks = 8, i.e. comfortably inside cadence - printed
 *
 *     BLOCK  weekly_cap: 4 URLs are new since the last run, cap is 1 per week
 *
 * and exited 1. `Deploy Distribution` runs on push to main, so that is a red
 * main for publishing at exactly the permitted rate, clearable only by a human
 * running `cadence:accept`, which CI never runs. This is the surviving half of
 * the defect behind run 33709958800; the other half - a page's identity being
 * the spelling of its URL - is guarded by `validate:cadence-ledger-identity`.
 *
 * WHAT THIS ASSERTS
 * -----------------
 * Behaviourally, by running the real gate against fixture repositories with
 * `CADENCE_TODAY` pinned. Reading the source would only prove that a comment
 * exists.
 *
 *   1. The allowance ACCRUES: rate x whole weeks since the baseline is allowed.
 *   2. It still has TEETH: one page past the accrued allowance blocks.
 *   3. A baseline accepted TODAY grants one week's worth, never zero.
 *   4. Accrual is BOUNDED by the refresh window: publication credit cannot be
 *      banked for a year and spent at once, or the cap stops protecting the
 *      refresh capacity it exists for.
 *   5. A ledger with no usable `generated_at` is a HARD STOP, not an unbounded
 *      allowance granted while reporting success.
 *   6. The ORIGINAL regression stays blocked: 105 publications against a
 *      one-week-old baseline still exits 1, so the accrual fix demonstrably did
 *      not mask the bug it sits next to.
 *   7. The verdict is DATE- AND TIMEZONE-PINNED: identical under UTC, UTC+14 and
 *      UTC-11, and the week boundary falls on the day it should rather than on
 *      the day the validator happens to run.
 *
 * Every rate comes from `data/cadence/policy.json`. Nothing here restates one,
 * so re-throttling the cadence moves the fixtures with it instead of leaving a
 * stale expectation behind.
 *
 * Hard-fails when it runs zero cases: an empty case list would pass silently and
 * prove nothing, which is the failure mode this repo keeps finding.
 *
 * Usage: node scripts/validators/validate_cadence_cap_accrual.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const GATE = path.join(ROOT, 'scripts/cadence_gate.js');
const POLICY_REL = 'data/cadence/policy.json';
const DOMAIN = 'https://porchandparty901.com';

// The date every case is pinned to. Explicit, so the boundary arithmetic below
// is the same on every machine and at every hour - a cadence guard that drifts
// with the wall clock is the defect class it is here to catch.
const PINNED_TODAY = '2026-09-04';
// Offsets deliberately spanning the international date line in both directions.
const TIMEZONES = ['UTC', 'Pacific/Kiritimati', 'Pacific/Midway'];

const policy = JSON.parse(fs.readFileSync(path.join(ROOT, POLICY_REL), 'utf8'));
const CAP = policy.new_pages_per_week;
const MAX_WEEKS = Math.floor(policy.refresh_window_days / 7);

const failures = [];
let casesRun = 0;

function daysBefore(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
}

/**
 * A throwaway repository containing only what the gate reads: the real policy,
 * a ledger with a chosen baseline date, and a sitemap holding the ledger's URLs
 * plus `newPages` freshly published ones. Nothing else exists in it, so no
 * section-index registry exempts anything and only the cap can block.
 */
function fixtureRepo({ baseline, ledgerPages, newPages, lastmod, omitBaseline }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-cadence-'));
  fs.mkdirSync(path.join(dir, 'data/cadence'), { recursive: true });
  fs.writeFileSync(path.join(dir, POLICY_REL), JSON.stringify(policy, null, 2));

  const known = Array.from({ length: ledgerPages }, (_, i) => `${DOMAIN}/answers/known-${i}`);
  const fresh = Array.from({ length: newPages }, (_, i) => `${DOMAIN}/answers/published-${i}`);
  const ledger = omitBaseline ? { urls: known } : { generated_at: baseline, urls: known };
  fs.writeFileSync(path.join(dir, 'data/cadence/known_urls.json'), JSON.stringify(ledger, null, 2));

  const entries = [...known, ...fresh]
    .map((u) => `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join('\n');
  fs.writeFileSync(path.join(dir, 'sitemap.xml'), `<urlset>\n${entries}\n</urlset>\n`);
  return dir;
}

function runGate(dir, tz = 'UTC') {
  const r = spawnSync(process.execPath, [GATE, '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CADENCE_TODAY: PINNED_TODAY, TZ: tz },
  });
  let report = null;
  try { report = JSON.parse(r.stdout); } catch { /* a hard stop prints prose on stderr */ }
  return { status: r.status, report, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

/**
 * @param expect 'CLEAR' | 'BLOCKED' | 'HARD_STOP'
 */
function check(name, fixture, expect, tz = 'UTC') {
  casesRun += 1;
  const dir = fixtureRepo(fixture);
  try {
    const { status, report, out } = runGate(dir, tz);
    const capBlocked = !!(report && report.blocking || []).length
      && report.blocking.some((b) => b.startsWith('weekly_cap:'));
    const tail = out.split('\n').slice(-2).join(' / ') || '(no output)';

    if (expect === 'HARD_STOP') {
      if (status === 0) failures.push(`${name}: gate exited 0 where it must refuse to run. Output: ${tail}`);
      else if (report) failures.push(`${name}: gate produced a verdict where it must refuse to run. Output: ${tail}`);
      return;
    }
    if (!report) {
      failures.push(`${name}: gate produced no JSON report (exit ${status}). Output: ${tail}`);
      return;
    }
    if (expect === 'CLEAR' && capBlocked) {
      failures.push(`${name}: weekly_cap blocked publishing that is inside the accrued allowance. `
        + `${report.new_publications_since_last_run} publication(s), baseline ${report.ledger_baseline_date} `
        + `(${report.accrual_weeks} week(s) accrued), allowance ${report.publication_allowance}.`);
    }
    if (expect === 'BLOCKED' && !capBlocked) {
      failures.push(`${name}: weekly_cap did NOT block publishing past the accrued allowance. `
        + `${report.new_publications_since_last_run} publication(s) against an allowance of ${report.publication_allowance}. `
        + 'A cap that accrues without a bound is not a cap.');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BASE = { ledgerPages: 6, lastmod: PINNED_TODAY };

// --- 1 & 2: the allowance accrues, and the accrued allowance still has teeth --
const eightWeeks = { ...BASE, baseline: daysBefore(PINNED_TODAY, 56) };
check(`accrues: ${CAP * 8} publication(s) after 8 weeks`, { ...eightWeeks, newPages: CAP * 8 }, 'CLEAR');
check(`teeth: ${CAP * 8 + 1} publication(s) after 8 weeks`, { ...eightWeeks, newPages: CAP * 8 + 1 }, 'BLOCKED');

// --- 3: a baseline accepted today grants one week's worth, not zero ----------
const sameDay = { ...BASE, baseline: PINNED_TODAY };
check(`fresh baseline permits the declared rate (${CAP})`, { ...sameDay, newPages: CAP }, 'CLEAR');
check(`fresh baseline blocks past the declared rate (${CAP + 1})`, { ...sameDay, newPages: CAP + 1 }, 'BLOCKED');

// --- 4: accrual is bounded by the refresh window -----------------------------
const ancient = { ...BASE, baseline: daysBefore(PINNED_TODAY, 371) }; // 53 weeks
check(`bounded: ${CAP * MAX_WEEKS} publication(s) after 53 weeks (window is ${MAX_WEEKS})`,
  { ...ancient, newPages: CAP * MAX_WEEKS }, 'CLEAR');
check(`bounded: ${CAP * MAX_WEEKS + 1} publication(s) cannot be banked past the ${MAX_WEEKS}-week window`,
  { ...ancient, newPages: CAP * MAX_WEEKS + 1 }, 'BLOCKED');

// --- 5: no baseline date is a hard stop, not an unbounded allowance ----------
check('a ledger with no generated_at refuses to run',
  { ...BASE, baseline: null, omitBaseline: true, newPages: CAP * MAX_WEEKS + 5 }, 'HARD_STOP');

// --- 6: the original 33709958800 regression is still blocked ----------------
// 105 publications against a one-week-old baseline. If accrual had been written
// loosely enough to clear this, the fix would have masked the bug beside it.
check('the 105-page spree behind run 33709958800 still blocks',
  { ...BASE, baseline: daysBefore(PINNED_TODAY, 7), newPages: 105 }, 'BLOCKED');

// --- 7: the week boundary falls on the day, and does not move with timezone --
// 55 days is 7 whole weeks, 56 days is 8. The case that is one page over a
// 7-week allowance must block, and the same page count must clear at 8 weeks -
// which cases 1 and 2 above already pin from the other side.
check(`boundary: ${CAP * 8} publication(s) at 55 days is still ${CAP * 7} of allowance`,
  { ...BASE, baseline: daysBefore(PINNED_TODAY, 55), newPages: CAP * 7 + 1 }, 'BLOCKED');
for (const tz of TIMEZONES) {
  check(`timezone ${tz}: 8 weeks accrued clears ${CAP * 8}`,
    { ...eightWeeks, newPages: CAP * 8 }, 'CLEAR', tz);
  check(`timezone ${tz}: 8 weeks accrued blocks ${CAP * 8 + 1}`,
    { ...eightWeeks, newPages: CAP * 8 + 1 }, 'BLOCKED', tz);
}

// --- Rule 0 -----------------------------------------------------------------
if (!casesRun) {
  console.error('validate:cadence-cap-accrual FAILED: ran zero cases. Nothing was checked, so nothing was proved.');
  process.exit(1);
}

if (failures.length) {
  console.error(`validate:cadence-cap-accrual FAILED: ${failures.length} of ${casesRun} case(s).`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `Cadence cap accrual OK (${casesRun} behavioural case(s) against the real gate, `
  + `pinned to ${PINNED_TODAY} across ${TIMEZONES.join(', ')}; `
  + `cap ${CAP}/week accrues to a maximum of ${CAP * MAX_WEEKS} over the ${MAX_WEEKS}-week refresh window, `
  + 'no baseline date is a hard stop, and the 105-page spree behind run 33709958800 still blocks)',
);
