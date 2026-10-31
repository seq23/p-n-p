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
  'data/offers', 'data/rentals', 'data/ops', 'data/service_areas', 'data/queries/query_universe.json',
  'data/authority_scale/velocity_decision.json', 'data/authority_scale/citation_yield_contract.json',
  'data/published_manifest/published_manifest.json', 'data/slug_registry/slug_registry.json',
  // The fold list the publisher refuses to republish from (scripts/lib/hub_consolidation.js, 26 Oct 2026).
  'data/search_intelligence/hub_consolidation.json', 'data/content/hub_folds.json',
  // The business entity's sameAs and parent (scripts/lib/contact_surface.js reads it, 30 Oct 2026).
  'config/entity.json'
];
function sandboxRun({ frozen, measuredRoute, allowance = 5, alsoUnmeasured = false }) {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'pnp-freeze-'));
  for (const rel of COPY) {
    fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true });
    fs.cpSync(path.join(ROOT, rel), path.join(box, rel), { recursive: true });
  }
  const universe = read('data/queries/query_universe.json', []);
  const sample = universe.find((u) => u.folder && u.slug);
  const fixture = { ...sample, slug: `${sample.slug}-freeze-fixture` };
  const w = (rel, doc) => { fs.mkdirSync(path.dirname(path.join(box, rel)), { recursive: true }); fs.writeFileSync(path.join(box, rel), JSON.stringify(doc, null, 2)); };
  const other = { ...sample, slug: `${sample.slug}-freeze-fixture-unmeasured` };
  w('data/queries/query_universe.json', [...universe, fixture, ...(alsoUnmeasured ? [other] : [])]);
  w('data/publish_queue/publish_queue.json', [...(alsoUnmeasured ? [{ slug: other.slug, folder: other.folder, status: 'queued' }] : []), { slug: fixture.slug, folder: fixture.folder, status: 'queued' }]);
  w('data/cadence/policy.json', { ...policy, new_page_publication: { ...(freeze || {}), frozen } });
  const route = `/${fixture.folder}/${fixture.slug}`;
  w('data/search_intelligence/target_query_set.json', { targets: measuredRoute ? [{ query: 'fixture', expected_owned_route: route, source: 'gsc_export', measurement: { metric: 'impressions_28d', value: 5 } }] : [] });
  // The gate is stubbed with headroom so only the freeze can hold the page; --max=0
  // stops the unfrozen runs before they render, which is all the negative needs.
  fs.mkdirSync(path.join(box, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(box, 'scripts/cadence_gate.js'), `console.log(JSON.stringify({publication_allowance:${allowance},new_publications_since_last_run:0,ledger_baseline_date:"2026-01-01"}))`);
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
// A measured page waiting on the weekly cap must be named as the cap holding, never as
// "no measured demand" (the porch price articles wait a week each this way).
const capped = sandboxRun({ frozen: true, measuredRoute: true, allowance: 0, alsoUnmeasured: true });
if (capped.written || capped.json.published) fail('a measured page published with no cadence headroom');
if (capped.json.stop_reason !== 'CADENCE_CEILING_REACHED') fail(`a measured page waiting on the weekly cap was named ${capped.json.stop_reason}, expected CADENCE_CEILING_REACHED`);

// ------------------------------------------------------------- 3. history
const targets = read('data/search_intelligence/target_query_set.json', { targets: [] }).targets || [];
const measured = new Set(targets.filter((t) => t.expected_owned_route && t.measurement && Number(t.measurement.value) > 0).map((t) => t.expected_owned_route));
const ledger = read('data/release/daily_velocity_ledger.json', { days: {} });
// A past publication is judged by the evidence it was released on. Targets are
// re-derived every day: on 26 Oct 2026 /guides/porch-decorating-packages-memphis
// (published 19 Oct on "porch decorating service", 90 searches a month) was folded
// into /services/porch-decorating and its target re-pointed there, and this check,
// reading only today's target set, called a legitimate release a freeze breach and
// failed the Daily Authority Cycle. The publisher now records the releasing target
// per route (ledger days[day].released_by); a route passes on that recorded,
// positive measurement, or on a measured target today. Nothing else passes.
function historyProblems(days, frozenAt, measuredNow) {
  const out = [];
  for (const [day, v] of Object.entries(days || {})) {
    if (day < frozenAt || !Number(v.new_pages)) continue;
    const routes = v.routes || [];
    if (!routes.length) out.push(`${day}: ${v.new_pages} page(s) published during the freeze with no routes recorded`);
    for (const r of routes) {
      const e = (v.released_by || {})[r];
      const recorded = e && e.query && e.metric && Number(e.value) > 0;
      if (!recorded && !measuredNow.has(r)) out.push(`${day}: ${r} was published during the freeze without a measured target`);
    }
  }
  return out;
}
// Fixtures: the rule must still bite. A route with no recorded evidence and no
// target today fails; a recorded zero is not evidence; a recorded positive passes.
{
  const ev = { query: 'q', metric: 'impressions_28d', value: 3 };
  const cases = [
    [{ '2026-10-20': { new_pages: 1, routes: ['/a'] } }, 1, 'unrecorded, unmeasured route'],
    [{ '2026-10-20': { new_pages: 1, routes: ['/a'], released_by: { '/a': { ...ev, value: 0 } } } }, 1, 'recorded zero measurement'],
    [{ '2026-10-20': { new_pages: 1, routes: ['/a'], released_by: { '/a': ev } } }, 0, 'recorded positive measurement'],
    [{ '2026-10-20': { new_pages: 1, routes: ['/a'], released_by: { '/b': ev } } }, 1, 'evidence recorded for another route'],
    [{ '2026-10-01': { new_pages: 1, routes: ['/a'] } }, 0, 'published before the freeze'],
  ];
  for (const [days, want, name] of cases) {
    const got = historyProblems(days, '2026-10-11', new Set()).length;
    if (got !== want) fail(`history fixture "${name}": ${got} problem(s), expected ${want}`);
  }
}
if (freeze && freeze.frozen) for (const p of historyProblems(ledger.days, freeze.frozen_at, measured)) fail(p);

if (errors.length) {
  console.error(`publication-freeze: FAIL (${errors.length})`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
console.log(`publication-freeze: OK - frozen=${freeze.frozen} since ${freeze.frozen_at} (${freeze.release_rule}); sandbox publisher held an unmeasured queued page and released a measured one; ${measured.size} measured owned route(s); no unmeasured page published since ${freeze.frozen_at}`);
