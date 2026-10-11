#!/usr/bin/env node
/**
 * The new-page publication freeze is a config flag, and this is the code that
 * reads it (data/cadence/policy.json `new_page_publication`, set 2026-10-10).
 *
 * Search Console showed 66 impressions on the homepage for 22 queries and none
 * for the 120 targets the authority cycle was publishing toward, which measured
 * 0 searches a month. The freeze stops the cycle adding zero-demand pages while
 * it keeps improving existing ones; a queued page is released automatically
 * when the measured target set names its route with a measured number.
 *
 * Hard-fails when:
 *   1. the flag is missing or malformed (frozen not a boolean, no frozen_at date,
 *      unknown release_rule);
 *   2. behaviour: the real publisher, run in a temp sandbox against a queued
 *      page with no measured target, publishes it or fails to name the stop
 *      PUBLICATION_FROZEN_UNMEASURED_DEMAND - and, as the negative proof, the
 *      same sandbox with the flag off or with a measured target for that route
 *      does NOT hold the page (so the test cannot pass vacuously);
 *   3. history: data/release/daily_velocity_ledger.json records a page published
 *      on or after frozen_at whose route is not a measured target's owned route.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const errors = [];
const fail = (m) => errors.push(m);
const read = (rel, fb) => (fs.existsSync(path.join(ROOT, rel)) ? JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')) : fb);

const RULES = new Set(['measured_target_only']);
const policy = read('data/cadence/policy.json', {});
const freeze = policy.new_page_publication;
if (!freeze || typeof freeze !== 'object') fail('data/cadence/policy.json has no new_page_publication block');
else {
  if (typeof freeze.frozen !== 'boolean') fail('new_page_publication.frozen must be true or false');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(freeze.frozen_at || ''))) fail('new_page_publication.frozen_at must be a YYYY-MM-DD date');
  if (!RULES.has(freeze.release_rule)) fail(`new_page_publication.release_rule must be one of ${[...RULES].join(', ')}`);
}

// ------------------------------------------------------------ 2. behaviour
const COPY = [
  'scripts/authority_scale/publish_governed_queue.mjs', 'templates', 'scripts/lib',
  'data/offers', 'data/ops', 'data/service_areas', 'data/queries/query_universe.json',
  'data/authority_scale/velocity_decision.json', 'data/authority_scale/citation_yield_contract.json',
  'data/published_manifest/published_manifest.json', 'data/slug_registry/slug_registry.json'
];
function sandboxRun({ frozen, measuredRoute }) {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-freeze-'));
  for (const rel of COPY) {
    fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
    fs.cpSync(path.join(ROOT, rel), path.join(box, rel), { recursive: true });
  }
  const universe = read('data/queries/query_universe.json', []);
  const sample = universe.find((u) => u.folder && u.slug);
  const fixture = { ...sample, slug: `${sample.slug}-freeze-fixture` };
  const w = (rel, doc) => { fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true }); fs.writeFileSync(path.join(box, rel), JSON.stringify(doc, null, 2)); };
  w('data/queries/query_universe.json', [...universe, fixture]);
  w('data/publish_queue/publish_queue.json', [{ slug: fixture.slug, folder: fixture.folder, status: 'queued' }]);
  w('data/cadence/policy.json', { ...policy, new_page_publication: { ...(freeze || {}), frozen } });
  const route = `/${fixture.folder}/${fixture.slug}`;
  w('data/search_intelligence/target_query_set.json', { targets: measuredRoute ? [{ query: 'fixture', expected_owned_route: route, source: 'gsc_export', measurement: { metric: 'impressions_28d', value: 5 } }] : [] });
  // The gate is stubbed with headroom so only the freeze can hold the page; --max=0
  // stops the unfrozen runs before they render, which is all the negative needs.
  fs.mkdirSync(path.join(box, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(box, 'scripts/cadence_gate.js'), 'console.log(JSON.stringify({publication_allowance:5,new_publications_since_last_run:0,ledger_baseline_date:"2026-01-01"}))');
  const args = ['scripts/authority_scale/publish_governed_queue.mjs', ...(frozen && !measuredRoute ? [] : ['--max=0'])];
  let out = '';
  try {
    out = execFileSync(process.execPath, args, { cwd: box, encoding: 'utf8', env: { ...process.env, AUTHORITY_RUN_DATE: '2026-10-12' }, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`;
    fail(`sandbox publisher exited ${e.status} (frozen=${frozen}, measured=${Boolean(measuredRoute)}): ${out.split('\n').slice(-3).join(' ')}`);
  }
  const written = fs.existsSync(path.join(box, `${fixture.folder}/${fixture.slug}.html`));
  fs.rmSync(box, { recursive: true, force: true });
  const json = (() => { try { return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); } catch { return {}; } })();
  return { json, written };
}
const held = sandboxRun({ frozen: true, measuredRoute: false });
if (held.written || held.json.published) fail('frozen publisher published a queued page that has no measured target');
if (held.json.stop_reason !== 'PUBLICATION_FROZEN_UNMEASURED_DEMAND') fail(`frozen publisher named stop ${held.json.stop_reason}, expected PUBLICATION_FROZEN_UNMEASURED_DEMAND`);
const open = sandboxRun({ frozen: false, measuredRoute: false });
if (open.json.held_by_freeze !== 0 || open.json.stop_reason === 'PUBLICATION_FROZEN_UNMEASURED_DEMAND') fail('negative proof failed: with the flag off the publisher still held the page, so the test cannot tell the flag is what holds it');
const released = sandboxRun({ frozen: true, measuredRoute: true });
if (released.json.held_by_freeze !== 0) fail('a queued page whose route has a measured target was still held by the freeze');

// ------------------------------------------------------------- 3. history
const targets = read('data/search_intelligence/target_query_set.json', { targets: [] }).targets || [];
const measured = new Set(targets.filter((t) => t.expected_owned_route && t.measurement && Number(t.measurement.value) > 0).map((t) => t.expected_owned_route));
const ledger = read('data/release/daily_velocity_ledger.json', { days: {} });
if (freeze && freeze.frozen) {
  for (const [day, v] of Object.entries(ledger.days || {})) {
    if (day < freeze.frozen_at || !Number(v.new_pages)) continue;
    const routes = v.routes || [];
    if (!routes.length) fail(`${day}: ${v.new_pages} page(s) published during the freeze with no routes recorded`);
    for (const r of routes) if (!measured.has(r)) fail(`${day}: ${r} was published during the freeze without a measured target`);
  }
}

if (errors.length) {
  console.error(`publication-freeze: FAIL (${errors.length})`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
console.log(`publication-freeze: OK - frozen=${freeze.frozen} since ${freeze.frozen_at} (${freeze.release_rule}); sandbox publisher held an unmeasured queued page and released a measured one; ${measured.size} measured owned route(s); no unmeasured page published since ${freeze.frozen_at}`);
