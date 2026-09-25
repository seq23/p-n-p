#!/usr/bin/env node
/**
 * validate:backlog-reaches-builder
 *
 * The validated demand backlog was reported and never built from: seven rows sat
 * in data/demand/measured_demand.json from 2026-08-27 while the publish stage
 * named QUEUE_EXHAUSTED_NOTHING_REFILLS_IT every day. This fails that shape.
 *
 * Hard-fails when:
 *   - the backlog has zero rows (nothing to prove the path on is not a pass);
 *   - any row is older than the draft deadline (7 / new_pages_per_week days,
 *     from data/cadence/policy.json) and has no build attempt: no covering page,
 *     no draft, or a draft that is not yet in the publish queue;
 *   - any build link points at nothing: a covering page that is not on disk or
 *     not in the sitemap, a draft missing from the query universe, a queue status
 *     that will never publish;
 *   - the stage that queues drafts is not invoked ahead of the publisher in both
 *     the daily workflow and `npm run authority:cycle` - a feeder nothing runs is
 *     the defect this exists to catch.
 *
 * Rows younger than the deadline with no draft are reported, not failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { backlogState } from '../authority_scale/backlog_state.mjs';

const ROOT = process.cwd();
const today = process.env.BACKLOG_TODAY || process.env.AUTHORITY_RUN_DATE || new Date().toISOString().slice(0, 10);
const errors = [];
const notes = [];

const { rows, errors: linkErrors, maxAgeDays } = backlogState(ROOT, today);
errors.push(...linkErrors);

if (!rows.length) {
  errors.push('data/demand/measured_demand.json backlog_validated_not_yet_built has zero rows; built rows stay in the backlog with their build link, so an empty backlog means the evidence was deleted, not built');
}

for (const r of rows) {
  const overdue = r.age_days !== null && r.age_days > maxAgeDays;
  if (r.state === 'awaiting_draft') {
    if (overdue) errors.push(`"${r.query}" has waited ${r.age_days} days (deadline ${maxAgeDays}) with no draft and no covering page`);
    else notes.push(`"${r.query}" awaiting draft, ${r.age_days} of ${maxAgeDays} days used`);
  }
  if (r.state === 'drafted' && overdue) {
    errors.push(`"${r.query}" is drafted as ${r.page} but not in the publish queue after ${r.age_days} days; npm run authority:backlog:promote queues it`);
  }
}

// A queued draft with a page already on disk was published around the cadence -
// `npm run build:all` rendered every universe entry and marked the whole queue
// published until it learned to hold queued drafts back.
const queue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/publish_queue/publish_queue.json'), 'utf8'));
for (const q of queue.filter((x) => x.status === 'queued')) {
  if (fs.existsSync(path.join(ROOT, `${q.folder}/${q.slug}.html`))) {
    errors.push(`${q.folder}/${q.slug} is queued but its page is already on disk; something published it around authority:publish and the cadence gate`);
  }
}

// The feeder has to run, and before the publisher, in every lane that publishes.
const order = (text, where) => {
  const p = text.indexOf('authority:backlog:promote');
  const q = text.indexOf('authority:publish');
  if (p < 0) errors.push(`${where} never runs authority:backlog:promote, so nothing moves drafts from the backlog into the publish queue`);
  else if (q < 0 || p > q) errors.push(`${where} runs authority:backlog:promote after authority:publish (or has no publish), so a drafted row waits a full extra cycle`);
};
// The publisher opens an exact mutation scope for the frozen pages that gain a
// link to the new page; a lane that freezes without clearing it afterwards leaves
// those routes writable by anything, unguarded, from then on.
const closes = (text, where) => {
  const f = text.indexOf('authority:scale:freeze');
  const c = text.indexOf('authority:scale:clear-scope');
  if (c < 0 || f < 0 || c < f) errors.push(`${where} does not run authority:scale:clear-scope after authority:scale:freeze, so the relink scope the publisher opens is never closed`);
};
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
order(pkg.scripts['authority:cycle'] || '', 'npm run authority:cycle');
const daily = fs.readFileSync(path.join(ROOT, '.github/workflows/authority-daily.yml'), 'utf8');
order(daily, '.github/workflows/authority-daily.yml');
closes(pkg.scripts['authority:cycle'] || '', 'npm run authority:cycle');
closes(daily, '.github/workflows/authority-daily.yml');

const tally = rows.reduce((a, r) => ({ ...a, [r.state]: (a[r.state] || 0) + 1 }), {});
console.log(`backlog: ${rows.length} rows ${JSON.stringify(tally)}; draft deadline ${maxAgeDays} days; as of ${today}`);
for (const n of notes) console.log(`note: ${n}`);
if (errors.length) {
  console.error('validate:backlog-reaches-builder FAILED');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('validate:backlog-reaches-builder OK');
