#!/usr/bin/env node
/**
 * Feed the validated demand backlog into the page builder.
 *
 * data/demand/measured_demand.json has carried `backlog_validated_not_yet_built`
 * since 2026-08-27, and until this stage existed nothing read it except a
 * validator that printed its length. Seven validated queries sat there for a
 * month while the publish queue reported QUEUE_EXHAUSTED_NOTHING_REFILLS_IT every
 * day: a backlog that exists and that nothing invokes.
 *
 * A backlog row becomes a page along the path every page here already takes:
 *
 *   1. The row gets a `build` link. Either `covered_by` - a published page that
 *      already answers it, with a `why` - or `page` - the folder/slug of a draft in
 *      data/queries/query_universe.json. Writing that draft is the approval step:
 *      docs/CONTENT-OPERATIONS.md allows publishing only from the approved query
 *      universe, and an entry lands there only through a reviewed, merged PR.
 *   2. This stage puts every drafted page the publish queue does not yet hold into
 *      the queue as `queued`, and adds it to the slug registry the local authority
 *      contract requires queued items to be in.
 *   3. `npm run authority:publish` publishes the queue at most one page per
 *      cadence week, and the cadence gate is the backstop behind it.
 *
 * Rule 0: this never exits 0 having silently done nothing. Every run prints what
 * it queued and names every row still waiting for a draft, with its age. A row
 * past the cadence week without a draft is a hard failure in
 * `npm run validate:backlog-reaches-builder`, which validate:release runs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { backlogState } from './backlog_state.mjs';

const ROOT = process.cwd();
const queuePath = path.join(ROOT, 'data/publish_queue/publish_queue.json');
const slugPath = path.join(ROOT, 'data/slug_registry/slug_registry.json');
const today = process.env.AUTHORITY_RUN_DATE || new Date().toISOString().slice(0, 10);

const state = backlogState(ROOT, today);
if (state.errors.length) {
  console.error('[backlog-promote] REFUSED: the backlog links point at things that do not exist:');
  for (const e of state.errors) console.error(`  - ${e}`);
  process.exit(1);
}

const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
const slugs = JSON.parse(fs.readFileSync(slugPath, 'utf8'));
const enqueued = [];
for (const row of state.rows.filter((r) => r.state === 'drafted')) {
  const [folder, slug] = row.page.split('/');
  queue.push({ slug, folder, status: 'queued' });
  if (!slugs.includes(row.page)) slugs.push(row.page);
  enqueued.push(row.page);
}
if (enqueued.length) {
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2) + '\n');
  fs.writeFileSync(slugPath, JSON.stringify(slugs, null, 2) + '\n');
}

const count = (s) => state.rows.filter((r) => r.state === s).length;
const awaiting = state.rows.filter((r) => r.state === 'awaiting_draft');
console.log(JSON.stringify({
  day: today,
  backlog_rows: state.rows.length,
  covered: count('covered'),
  queued: count('queued') + enqueued.length,
  published: count('published'),
  enqueued_this_run: enqueued,
  awaiting_draft: awaiting.map((r) => ({ query: r.query, observed_at: r.observed_at, age_days: r.age_days })),
  draft_deadline_days: state.maxAgeDays,
}, null, 2));

if (!state.rows.length) {
  console.log('[backlog-promote] NAMED STOP BACKLOG_EMPTY: data/demand/measured_demand.json holds no validated backlog rows; nothing to feed the builder.');
}
if (awaiting.length) {
  const msg = `${awaiting.length} validated backlog row(s) have no page draft yet: `
    + awaiting.map((r) => `"${r.query}" (${r.age_days}d)`).join(', ')
    + `. Draft each into data/queries/query_universe.json and set its build.page, or set build.covered_by to the page that already answers it. `
    + `validate:backlog-reaches-builder fails once a row is older than ${state.maxAgeDays} days.`;
  console.log(`[backlog-promote] NAMED STOP BACKLOG_AWAITING_DRAFT: ${msg}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Backlog awaiting draft::${msg}`);
}
