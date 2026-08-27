#!/usr/bin/env node
/**
 * Deliberate acceptance of published pages into the cadence baseline.
 *
 * The cadence gate blocks when more publication URLs appear than the weekly cap
 * allows. There are only two honest answers to that block:
 *
 *   1. Do not publish them. This is the answer the cap exists to force, and it
 *      is the right one while the pages are still unpublished.
 *   2. Accept that they are already live, record that you accepted them, and
 *      say why. Pages already published cannot be un-published by a red build,
 *      and a gate that stays red over a past action is one people route around.
 *
 * What is NOT an answer is the third thing that used to happen by accident:
 * cadence_gate.js advanced the ledger itself, every run, so the block cleared on
 * the next invocation with no decision, no record and nobody's name on it. That
 * is why this file exists and why the gate no longer writes the ledger.
 *
 * Acceptance requires a reason, appends to an auditable log, and is never run by
 * CI - so the cap keeps applying to everything published from here on.
 *
 * Usage:
 *   node scripts/cadence_accept.js --reason "why these pages are being accepted"
 *   node scripts/cadence_accept.js --reason "..." --dry-run
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = process.cwd();
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ACCEPTANCES_REL = 'data/cadence/acceptances.json';
const MIN_REASON = 20;

const ri = args.indexOf('--reason');
const reason = (ri >= 0 ? args[ri + 1] || '' : '').trim();
if (!reason || reason.startsWith('--')) {
  console.error('cadence:accept requires a reason.');
  console.error('  npm run cadence:accept -- --reason "why this backlog is being accepted"');
  process.exit(2);
}
if (reason.length < MIN_REASON) {
  console.error(`cadence:accept reason must be at least ${MIN_REASON} characters. A reason that does not explain anything is the same as no record at all.`);
  process.exit(2);
}

// Read the gate's own receipt rather than recomputing its verdict, so what is
// accepted is by construction what the gate blocked on.
const { sitemapUrls, LEDGER_REL } = require('./cadence/sitemap_urls.js');
let report;
try {
  report = JSON.parse(execFileSync('node', ['scripts/cadence_gate.js', '--json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
} catch (err) {
  if (typeof err.status !== 'number') throw err;
  report = JSON.parse(err.stdout);
}

const urls = sitemapUrls(ROOT);
const ledgerPath = path.join(ROOT, LEDGER_REL);
let known = new Set();
if (fs.existsSync(ledgerPath)) {
  try { known = new Set(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).urls || []); } catch { /* treated as empty */ }
}
const newUrls = [...urls.keys()].filter((u) => !known.has(u));
if (!newUrls.length) {
  console.log('Nothing to accept: no URLs are new since the ledger was last accepted.');
  process.exit(0);
}

const today = process.env.CADENCE_TODAY || new Date().toISOString().slice(0, 10);
const newPublications = report.new_publications_since_last_run;
const newSectionIndexes = report.new_section_indexes_since_last_run || [];
const cap = report.policy.new_pages_per_week;
const entry = {
  accepted_at: today,
  reason,
  urls_total_after: urls.size,
  accepted_count: newUrls.length,
  accepted_publications: newPublications,
  accepted_section_indexes: newSectionIndexes.length,
  weekly_cap: cap,
  over_cap_by: Math.max(0, (newPublications || 0) - cap),
  maintainable_ceiling: report.maintainable_ceiling,
  library_over_ceiling_by: Math.max(0, urls.size - report.maintainable_ceiling),
  accepted_urls: [...newUrls].sort(),
};

console.log(`Accepting ${newUrls.length} URLs into the cadence baseline (${newPublications} publications, ${newSectionIndexes.length} section indexes).`);
console.log(`  weekly cap is ${cap}; this acceptance is ${entry.over_cap_by} publications over it.`);
if (entry.library_over_ceiling_by > 0) {
  console.log(`  library is ${entry.library_over_ceiling_by} pages above the maintainable ceiling of ${entry.maintainable_ceiling}. Accepting the count does not resolve that.`);
}
console.log(`  reason: ${reason}`);
if (DRY) { console.log('\n--dry-run: nothing written.'); process.exit(0); }

fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
fs.writeFileSync(ledgerPath, JSON.stringify({ generated_at: today, urls: [...urls.keys()].sort() }, null, 2) + '\n');

const accPath = path.join(ROOT, ACCEPTANCES_REL);
let log = { acceptances: [] };
if (fs.existsSync(accPath)) { try { log = JSON.parse(fs.readFileSync(accPath, 'utf8')); } catch { /* rewritten below */ } }
if (!Array.isArray(log.acceptances)) log.acceptances = [];
log.acceptances.push(entry);
fs.writeFileSync(accPath, JSON.stringify(log, null, 2) + '\n');

console.log(`\nLedger advanced: ${LEDGER_REL}`);
console.log(`Acceptance recorded: ${ACCEPTANCES_REL} (${log.acceptances.length} total)`);
console.log('Commit both, with the reason in the commit message.');
