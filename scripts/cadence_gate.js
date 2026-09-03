#!/usr/bin/env node
/**
 * Cadence gate.
 *
 * The previous gate asked whether pages were earning Google impressions before
 * allowing more publishing. That is the wrong question for an AEO goal: AI
 * citation and Google rank are largely decoupled - most pages AI engines cite do
 * not rank in Google's top 10 - so a page can be invisible in Search and still be
 * cited, or rank and never be cited. Gating publication on Search surfacing
 * measured the wrong thing, and because it never returned a non-zero exit it
 * could not have stopped anything anyway.
 *
 * This gates on freshness and volume, which are the two levers the evidence
 * actually ties to citation:
 *
 *   - Pages not updated within 13 weeks are markedly more likely to lose AI
 *     citations, and recency correlates strongly with being cited at all.
 *   - Publishing faster than a library can be maintained guarantees the tail
 *     ages past that threshold. The ceiling is therefore not a taste question:
 *     it is refresh capacity multiplied by the refresh window.
 *
 * Four blocking conditions, each with an exit code so a pipeline can act on it:
 *
 *   1. new pages in the last 7 days above the weekly cap
 *   2. share of pages older than the refresh window above the tolerance
 *   3. URLs with no lastmod at all - a crawler gets no freshness signal
 *   4. library larger than refresh capacity can keep inside the window
 *
 * It also warns, without blocking, when a very high share of pages carry the
 * same recent lastmod. That is the signature of a date bump rather than a
 * substantive refresh, and it is worth seeing rather than being rewarded by the
 * freshness rules above.
 *
 * This script is read-only with respect to data/cadence/known_urls.json, and
 * that is load-bearing. See the note above the report write below.
 *
 * Usage: node cadence_gate.js [--json] [--policy path]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { sitemapUrls, newSinceLedger } = require('./cadence/sitemap_urls.js');

const ROOT = process.cwd();
const args = process.argv.slice(2);
const JSON_ONLY = args.includes('--json');
const policyPath = (() => {
  const i = args.indexOf('--policy');
  return i >= 0 ? args[i + 1] : 'data/cadence/policy.json';
})();

// There is deliberately NO default rate here.
//
// This file used to carry a DEFAULT_POLICY of new_pages_per_week: 2 and
// refresh_capacity_per_week: 25 - the rates this repo published at before the
// cadence was throttled to 1 and 8. Those literals were a restatement of a rate
// that had since changed, and the merge order (`{...DEFAULT_POLICY, ...file}`)
// meant they were invisible right up until the moment they mattered: with
// data/cadence/policy.json absent or mistyped after --policy, the gate did not
// fail. It printed "CADENCE GATE CLEAR ... ceiling 325" and exited 0, having
// silently swapped a cap of 1/week for 2/week and a maintainable ceiling of 104
// for 325. A guard whose failure mode is to permit three times as much as the
// policy allows, while reporting success, is worse than no guard.
//
// Every threshold is now read from the policy file and nowhere else. The one
// number that IS derived - the maintainable ceiling - is computed at runtime as
// refresh_capacity_per_week x whole weeks in refresh_window_days, so a change to
// either rate moves it automatically instead of leaving a stale literal behind.
// A missing or incomplete policy is a hard stop, not a substitution.
const REQUIRED_POLICY_KEYS = [
  'refresh_window_days',
  'high_value_window_days',
  'stale_tolerance_pct',
  'new_pages_per_week',
  'refresh_capacity_per_week',
  'require_lastmod',
];

function loadPolicy() {
  const f = path.join(ROOT, policyPath);
  if (!fs.existsSync(f)) {
    console.error(
      `CADENCE GATE FAILED: no cadence policy at ${policyPath}. The gate will not invent a publication cap - `
      + 'a substituted default is how a throttled cadence silently reverts to an older, looser rate. '
      + 'Restore the policy file or pass --policy <path>.',
    );
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (err) {
    console.error(`CADENCE GATE FAILED: ${policyPath} is not valid JSON (${err.message}).`);
    process.exit(1);
  }
  const missing = REQUIRED_POLICY_KEYS.filter((k) => parsed[k] === undefined || parsed[k] === null);
  if (missing.length) {
    console.error(
      `CADENCE GATE FAILED: ${policyPath} is missing required rate(s): ${missing.join(', ')}. `
      + 'Every threshold this gate enforces must come from the policy, so a partial policy cannot be topped up with defaults.',
    );
    process.exit(1);
  }
  return { ...parsed, _source: policyPath };
}

const policy = loadPolicy();
const urls = sitemapUrls(ROOT);
const today = new Date(process.env.CADENCE_TODAY || new Date().toISOString().slice(0, 10));
const ageDays = (d) => Math.floor((today - new Date(d)) / 86400000);

// A page that changed is not a page that was published. Counting any recent
// lastmod as a new page made a one-off structural edit across the library look
// like a publishing spree, which is exactly the signal this is meant to
// distinguish. New means a page that was not in the sitemap last time this ran.
//
// "Page", not "URL string". Membership is tested on pageIdentity(), which routes
// both sides through the one definition of this origin's served URL form in
// scripts/lib/site_url.js. Comparing raw strings made a page's identity its
// spelling: when #12 rewrote every URL from the redirecting `/x.html` form to
// the `/x` form the origin actually serves, 105 unchanged pages read as new and
// this gate blocked the distribution lane over a publishing spree that had not
// happened. Re-spelling a URL is not a publication. Publishing a route that did
// not exist before still is, and still counts against the cap below.
const ledgerPath = path.join(ROOT, 'data/cadence/known_urls.json');
let knownUrls = [];
let ledgerExists = fs.existsSync(ledgerPath);
if (ledgerExists) {
  try { knownUrls = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).urls || []; }
  catch { ledgerExists = false; }
}
const newUrls = newSinceLedger([...urls.keys()], knownUrls);

// A section index is not a publication, for the same reason the paragraph above
// says a changed page is not a published one. The weekly cap exists because
// publishing faster than the library can be refreshed pushes the tail past the
// 13-week threshold. A section index is regenerated from the pages it lists,
// introduces no subject matter of its own, and so consumes none of the refresh
// capacity the cap is protecting.
//
// The classification is not invented here. It is read from whichever registry
// the repo already keeps: data/cadence/section_indexes.json, written by the
// generator that emits the pages, or the page_intent field that
// data/routes/route_manifest.json already records for every route. A reviewer
// can see exactly which URLs are exempt by reading that file. An unreadable or
// absent registry exempts nothing.
//
// Section indexes stay inside urls.size, so staleness, the ceiling and the
// lastmod checks below all still count them: they are pages a crawler fetches
// either way. Only the publication cadence cap ignores them, and they are
// reported as a warning rather than passing silently.
function sectionIndexPaths() {
  const out = new Set();
  const norm = (p) => String(p || '').replace(/\/index\.html$/, '').replace(/\/+$/, '') || '/';
  const registry = path.join(ROOT, 'data/cadence/section_indexes.json');
  if (fs.existsSync(registry)) {
    try { for (const r of JSON.parse(fs.readFileSync(registry, 'utf8')).routes || []) out.add(norm(r)); }
    catch { /* an unreadable registry exempts nothing */ }
  }
  const manifest = path.join(ROOT, 'data/routes/route_manifest.json');
  if (fs.existsSync(manifest)) {
    try {
      for (const r of JSON.parse(fs.readFileSync(manifest, 'utf8')).routes || []) {
        if (r.page_intent === 'section_index') out.add(norm(r.path));
      }
    } catch { /* same */ }
  }
  return out;
}
const sectionIndexes = sectionIndexPaths();
const isSectionIndex = (u) => {
  try {
    return sectionIndexes.has(new URL(u).pathname.replace(/\/index\.html$/, '').replace(/\/+$/, '') || '/');
  } catch { return false; }
};
const newSectionIndexes = newUrls.filter(isSectionIndex);
const newPublications = newUrls.filter((u) => !isSectionIndex(u));

const dated = [...urls.entries()].filter(([, d]) => d);
const undated = [...urls.entries()].filter(([, d]) => !d);
const ages = dated.map(([, d]) => ageDays(d));
const stale = ages.filter((a) => a > policy.refresh_window_days).length;
const fresh30 = ages.filter((a) => a <= policy.high_value_window_days).length;
const publishedThisWeek = ages.filter((a) => a <= 7).length;
const stalePct = dated.length ? (100 * stale) / dated.length : 0;
const ceiling = policy.refresh_capacity_per_week * Math.floor(policy.refresh_window_days / 7);

const blocking = [];
const warnings = [];

if (ledgerExists && newPublications.length > policy.new_pages_per_week) {
  blocking.push(`weekly_cap: ${newPublications.length} URLs are new since the last run, cap is ${policy.new_pages_per_week} per week`);
}
if (ledgerExists && newSectionIndexes.length) {
  warnings.push(`new_section_indexes: ${newSectionIndexes.length} navigation index route(s) are new since the last run and sit outside the publication cap (${newSectionIndexes.join(', ')})`);
}
if (stalePct > policy.stale_tolerance_pct) {
  blocking.push(`refresh_debt: ${stale} of ${dated.length} pages (${stalePct.toFixed(0)}%) are older than ${policy.refresh_window_days} days, tolerance is ${policy.stale_tolerance_pct}%`);
}
if (undated.length) {
  const msg = `no_freshness_signal: ${undated.length} sitemap URLs have no lastmod, so a crawler cannot tell when they changed`;
  if (policy.require_lastmod) blocking.push(msg);
  else warnings.push(`${msg} (reported only: ${policy._lastmod_note || 'enforcement disabled for this repo'})`);
}
if (urls.size > ceiling) {
  // Reported, not blocking. A library above the ceiling is a strategic problem -
  // the tail cannot be kept inside the refresh window, so it decays toward zero
  // citation value - but it is not something a publish step can fix, and a gate
  // that is permanently red teaches people to ignore it. It has to be worked
  // down by pruning or by raising real refresh capacity.
  warnings.push(`library_over_ceiling: ${urls.size} pages against a ceiling of ${ceiling} (${policy.refresh_capacity_per_week} substantive refreshes per week held inside ${policy.refresh_window_days} days). ${urls.size - ceiling} pages cannot be kept current at this capacity.`);
}
if (dated.length && publishedThisWeek === dated.length && dated.length > 20) {
  warnings.push(`uniform_lastmod: ${publishedThisWeek} of ${dated.length} pages share a lastmod inside 7 days - that is a date bump pattern, not a refresh, and it makes the freshness signal meaningless`);
}
if (dated.length && fresh30 === 0) {
  warnings.push('no_recent_refresh: nothing has been updated in the last 30 days, where recency correlates most strongly with citation');
}

function report_date() { return today.toISOString().slice(0, 10); }
const report = {
  generated_at: today.toISOString().slice(0, 10),
  policy_source: policy._source,
  urls: urls.size,
  dated: dated.length,
  undated: undated.length,
  stale_over_window: stale,
  stale_pct: Number(stalePct.toFixed(1)),
  fresh_within_30d: fresh30,
  lastmod_within_7d: publishedThisWeek,
  new_since_last_run: ledgerExists ? newUrls.length : null,
  new_publications_since_last_run: ledgerExists ? newPublications.length : null,
  new_section_indexes_since_last_run: ledgerExists ? newSectionIndexes : null,
  ledger_initialised: ledgerExists,
  maintainable_ceiling: ceiling,
  policy: { ...policy, _source: undefined },
  blocking,
  warnings,
  status: blocking.length ? 'BLOCKED' : 'CLEAR',
};

// The ledger is deliberately NOT written here. It used to be, "whether or not
// the gate blocks", on the reasoning that it records what exists rather than
// rewarding a pass. The effect was the opposite: the ledger is the only input
// that distinguishes a new page from an existing one, so writing it during the
// check consumed the evidence the check was reading. Two consecutive runs with
// nothing changed between them returned BLOCKED then CLEAR, so the cap could
// never hold. Advancing the baseline is now `npm run cadence:accept --
// --reason "..."`, which records what was accepted and why. CI never runs it.

fs.mkdirSync(path.join(ROOT, 'reports/cadence'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports/cadence/cadence-gate.json'), JSON.stringify(report, null, 2) + '\n');

if (JSON_ONLY) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`CADENCE GATE ${report.status}: ${urls.size} urls; ${stale} past ${policy.refresh_window_days}d (${report.stale_pct}%); ${fresh30} fresh within ${policy.high_value_window_days}d; ceiling ${ceiling}`);
  for (const b of blocking) console.log(`  BLOCK  ${b}`);
  for (const w of warnings) console.log(`  WARN   ${w}`);
}
process.exit(blocking.length ? 1 : 0);
