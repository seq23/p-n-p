#!/usr/bin/env node
// Validate -> repair -> re-validate, until clean or out of attempts.
//
// Before this existed, `npm run validate:release` was validate-only: it chained
// sixteen leaf validators behind `&&`, stopped at the first red one, and told a
// human about it. That is fine for authored defects, but most of this repo's
// validators guard DERIVED artifacts - the sitemap, the IndexNow batch, the
// improvement plan, the territory health snapshot, the yield scoreboard, the
// query atlas - and for each of those the repo already shipped the command that
// regenerates exactly that artifact. The regenerator was simply never wired to
// the validator that detects its staleness.
//
// This runs every validator in the profile (all of them, not up to the first
// failure), reads which ones failed, runs the repair each failing validator
// declares in _repo_validation_registry.json (`repair_command`), and
// re-validates. It stops early when clean, and stops when a pass produces no
// repairable failures - looping again would just repeat the same result.
//
//   node scripts/selfheal/heal_until_clean.mjs [--profile release] [--max 3] [--dry-run]
//
// Exit 0 means the chain is green and it is safe to push. Non-zero means it is
// not, and the report names what could not be healed and why.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const PROFILE = arg('--profile', 'release');
const MAX = Math.max(1, Math.min(5, Number(arg('--max', '3')) || 3));
const DRY = argv.includes('--dry-run');

const REPORT_DIR = path.join(ROOT, 'reports/validation');
// Contracts live under data/ops/ in this repo - validate_tree_hygiene.js keeps
// the repo root to public static files and the handful of named contracts, and
// this registry is not one of them.
const registryPath = path.join(ROOT, 'data/ops/repo_validation_registry.json');
if (!fs.existsSync(registryPath)) {
  console.error(`[self-heal] missing ${path.relative(ROOT, registryPath)} - nothing to drive`);
  process.exit(1);
}
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

const validators = (registry.validators || []).filter((v) => (v.profiles || []).includes(PROFILE));
if (!validators.length) {
  console.error(`[self-heal] no validators registered for profile "${PROFILE}"`);
  process.exit(1);
}
const repairFor = new Map(validators.filter((v) => v.repair_command).map((v) => [v.id, v.repair_command]));

const run = (cmd) => {
  const started = Date.now();
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8' });
  return { cmd, code: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}`, ms: Date.now() - started };
};

// Run every validator, never stopping at the first red one. `validate:release`
// short-circuits on `&&`, which hides how much is actually broken and therefore
// how much could have been repaired in a single pass.
function validateAll() {
  const results = [];
  for (const v of validators) {
    const r = run(v.command);
    const status = r.code === 0 ? 'PASS' : 'FAIL';
    results.push({
      id: v.id,
      command: v.command,
      status,
      exit_code: r.code,
      duration_ms: r.ms,
      repair_command: v.repair_command || null,
      // Only the tail is kept: these validators print whole JSON reports on success.
      output_tail: status === 'FAIL' ? r.out.trim().split('\n').slice(-25).join('\n') : null,
    });
    console.log(`  ${status === 'PASS' ? 'PASS' : 'FAIL'}  ${v.id}`);
  }
  const summary = {
    schema_version: '1.0',
    profile: PROFILE,
    generated_at: new Date().toISOString(),
    total: results.length,
    failed: results.filter((r) => r.status === 'FAIL').length,
    results,
  };
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, `validation-summary-${PROFILE}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

const attempts = [];
let clean = false;
let lastSummary = null;

for (let attempt = 1; attempt <= MAX; attempt += 1) {
  console.log(`[self-heal] attempt ${attempt}/${MAX} (profile ${PROFILE})`);
  const summary = validateAll();
  lastSummary = summary;
  const failed = summary.results.filter((r) => r.status === 'FAIL').map((r) => r.id);

  if (!failed.length) {
    attempts.push({ attempt, failed: [], repaired: [], result: 'CLEAN' });
    clean = true;
    console.log(`[self-heal] clean on attempt ${attempt}`);
    break;
  }

  const repairable = failed.filter((id) => repairFor.has(id));
  const unrepairable = failed.filter((id) => !repairFor.has(id));
  console.log(`[self-heal] ${failed.length} failing (${repairable.length} repairable)`);
  for (const id of unrepairable) {
    const v = validators.find((x) => x.id === id);
    console.log(`  no registered repair: ${id}${v?.no_repair_reason ? ` - ${v.no_repair_reason}` : ''}`);
  }

  if (!repairable.length) {
    // Nothing to change, so another pass would fail identically. Stop and say so
    // rather than burning attempts to reach the same place.
    attempts.push({ attempt, failed, repaired: [], result: 'NO_REPAIR_AVAILABLE' });
    break;
  }

  const repaired = [];
  const alreadyRun = new Set();
  for (const id of repairable) {
    const cmd = repairFor.get(id);
    if (alreadyRun.has(cmd)) { repaired.push({ id, cmd, code: 0, skipped: 'already_run_this_attempt' }); continue; }
    alreadyRun.add(cmd);
    if (DRY) { console.log(`  would repair ${id}: ${cmd}`); repaired.push({ id, cmd, code: 0, dry: true }); continue; }
    console.log(`  repairing ${id}: ${cmd}`);
    const r = run(cmd);
    if (r.code !== 0) console.log(`  repair FAILED for ${id} (exit ${r.code})`);
    repaired.push({ id, cmd, code: r.code });
  }
  attempts.push({ attempt, failed, repaired, result: DRY ? 'DRY_RUN_WOULD_REPAIR' : 'REPAIRED_RETRYING' });
  if (DRY) break;
}

const report = {
  schema_version: '1.0',
  repo_id: registry.repo_id || 'p-n-p',
  profile: PROFILE,
  max_attempts: MAX,
  dry_run: DRY,
  generated_at: new Date().toISOString(),
  status: clean ? 'CLEAN' : 'NOT_CLEAN',
  safe_to_push: clean,
  validators_run: validators.length,
  repairs_declared: repairFor.size,
  attempts,
  final_failures: (lastSummary?.results || []).filter((r) => r.status === 'FAIL').map((r) => ({
    id: r.id,
    repair_command: r.repair_command,
    output_tail: r.output_tail,
  })),
};
fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.writeFileSync(path.join(REPORT_DIR, 'self-heal-loop.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`[self-heal] report: reports/validation/self-heal-loop.json`);

if (!clean) {
  console.error(`[self-heal] NOT CLEAN after ${attempts.length} attempt(s) - refusing to declare the tree publishable.`);
  process.exit(1);
}
console.log('[self-heal] safe to push');
