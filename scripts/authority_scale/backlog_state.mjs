/**
 * The one reading of where each validated backlog row stands.
 *
 * Shared by the stage that feeds the backlog into the publish queue
 * (promote_backlog.mjs) and the validator that fails when it has not
 * (scripts/validators/validate_backlog_reaches_builder.js), so the two cannot
 * keep their own ideas of what "built" means.
 *
 * A row's state is derived, never stored: the row carries only a `build` link,
 * and the state comes from the query universe, the publish queue, the pages on
 * disk and the sitemap.
 *
 *   covered         build.covered_by names a published page (on disk and in the sitemap)
 *   drafted         build.page is in the query universe but not yet in the publish queue
 *   queued          build.page is queued; authority:publish will take it under the cadence
 *   published       build.page has been published
 *   awaiting_draft  no build link yet - a named stop until a draft or a covering page is recorded
 *
 * The draft deadline is derived from data/cadence/policy.json rather than
 * written here: the cadence consumes one queue slot every 7 / new_pages_per_week
 * days, so a row left undrafted longer than that is a row the builder could
 * already have been working on. At the current 1 page per week it is 7 days.
 */
import fs from 'node:fs';
import path from 'node:path';

const read = (root, rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

export function draftDeadlineDays(root) {
  const policy = read(root, 'data/cadence/policy.json');
  const rate = Number(policy.new_pages_per_week);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('data/cadence/policy.json has no positive new_pages_per_week; the backlog draft deadline is derived from it and will not be guessed');
  }
  return Math.ceil(7 / rate);
}

export function backlogState(root, today) {
  const demand = read(root, 'data/demand/measured_demand.json');
  const universe = read(root, 'data/queries/query_universe.json');
  const queue = read(root, 'data/publish_queue/publish_queue.json');
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  const served = new Set([...sitemap.matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)]
    .map((m) => m[1].replace(/\.html$/, '').replace(/\/$/, '') || '/'));
  const universeKeys = new Set(universe.map((e) => `${e.folder}/${e.slug}`));
  const queueByKey = new Map(queue.map((q) => [`${q.folder}/${q.slug}`, q]));
  const maxAgeDays = draftDeadlineDays(root);
  const now = Date.parse(`${today}T00:00:00Z`);

  const errors = [];
  const rows = (demand.backlog_validated_not_yet_built || []).map((r) => {
    const observed = Date.parse(`${r.observed_at}T00:00:00Z`);
    if (!Number.isFinite(observed)) errors.push(`"${r.query}" has no usable observed_at (${JSON.stringify(r.observed_at)}), so its age cannot be judged`);
    const age_days = Number.isFinite(observed) ? Math.floor((now - observed) / 86400000) : null;
    const base = { query: r.query, observed_at: r.observed_at, age_days };
    const b = r.build;
    if (!b) return { ...base, state: 'awaiting_draft' };
    if (b.covered_by && b.page) {
      errors.push(`"${r.query}" names both a covering page and a draft; it is one or the other`);
      return { ...base, state: 'invalid' };
    }
    if (b.covered_by) {
      const rel = String(b.covered_by).replace(/^\//, '');
      const servedPath = `/${rel}`.replace(/\.html$/, '').replace(/\/index$/, '') || '/';
      if (!fs.existsSync(path.join(root, rel))) errors.push(`"${r.query}" is marked covered by ${b.covered_by}, which is not on disk`);
      else if (!served.has(servedPath)) errors.push(`"${r.query}" is marked covered by ${b.covered_by}, which the sitemap does not publish`);
      if (!b.why || String(b.why).trim().length < 20) errors.push(`"${r.query}" is marked covered by ${b.covered_by} with no reason; say why that page answers it`);
      return { ...base, state: 'covered', covered_by: b.covered_by };
    }
    if (b.page) {
      if (!universeKeys.has(b.page)) {
        errors.push(`"${r.query}" points at draft ${b.page}, which is not in data/queries/query_universe.json`);
        return { ...base, state: 'invalid', page: b.page };
      }
      const item = queueByKey.get(b.page);
      if (!item) return { ...base, state: 'drafted', page: b.page };
      if (item.status === 'published') {
        if (!fs.existsSync(path.join(root, `${b.page}.html`))) errors.push(`"${r.query}" draft ${b.page} is marked published but ${b.page}.html is not on disk`);
        return { ...base, state: 'published', page: b.page };
      }
      if (item.status === 'queued') return { ...base, state: 'queued', page: b.page };
      errors.push(`"${r.query}" draft ${b.page} has queue status ${item.status}, which will never publish it`);
      return { ...base, state: 'invalid', page: b.page };
    }
    errors.push(`"${r.query}" has a build link with neither covered_by nor page`);
    return { ...base, state: 'invalid' };
  });
  return { rows, errors, maxAgeDays };
}
