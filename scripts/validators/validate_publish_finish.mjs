#!/usr/bin/env node
/**
 * validate:publish-finish - a page the daily cycle publishes gets the same
 * finishing passes as a page build:all renders, from ONE list.
 *
 * WHY
 * ---
 * Two places finish a rendered page: build:all (every page) and
 * scripts/authority_scale/publish_governed_queue.mjs (authority:publish, the
 * daily cycle's new page). The publisher kept its own copy of the list - Clarity
 * and the URL form - so every pass later added to the end of build:all was
 * missing from a page born in the cycle. On 26 Oct 2026 the first page it
 * published after #145 (guides/holiday-porch-decorating-service-memphis) had no
 * og:image:width/height and no visible date, and validate:social-tags and
 * validate:page-dates failed the Daily Authority Cycle.
 *
 * The list now lives once, in package.json `build:finish`. This pins:
 *   1. build:finish is a non-empty chain of `node scripts/...` passes and holds
 *      every pass whose output a release validator reads on a new page
 *      (structured data, social tags, page dates, URL form, Clarity);
 *   2. build:all ends with `npm run build:finish`, straight after the sitemap is
 *      written, so a pass added to the tail of build:all can only go into the
 *      shared list (anything placed after the sitemap but outside it fails here);
 *   3. the publisher runs `npm run build:finish` and runs none of its passes on
 *      its own, so it cannot drift into a second list again.
 * Rule 0: zero passes found is a hard failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const publisherRel = 'scripts/authority_scale/publish_governed_queue.mjs';
const publisher = fs.readFileSync(path.join(ROOT, publisherRel), 'utf8');
const errors = [];

const steps = (cmd) => String(cmd || '').split('&&').map((s) => s.trim()).filter(Boolean);

const finish = steps(pkg.scripts['build:finish']);
const passes = finish.map((s) => /^node (scripts\/\S+\.m?js)$/.exec(s)?.[1] || null);
if (!finish.length) errors.push('package.json has no build:finish; there is no shared list of finishing passes');
finish.forEach((s, i) => { if (!passes[i]) errors.push(`build:finish step "${s}" is not a plain \`node scripts/...\` pass`); });
for (const p of passes.filter(Boolean)) if (!fs.existsSync(path.join(ROOT, p))) errors.push(`build:finish runs ${p}, which does not exist`);

const MUST = ['scripts/install_structured_data.js', 'scripts/install_clarity.js', 'scripts/normalize_public_urls.js',
  'scripts/install_social_tags.js', 'scripts/install_page_dates.js'];
for (const m of MUST) if (!passes.includes(m)) errors.push(`build:finish no longer runs ${m}; a page the cycle publishes would ship without it`);

const all = steps(pkg.scripts['build:all']);
if (all[all.length - 1] !== 'npm run build:finish') errors.push(`build:all must end with "npm run build:finish"; it ends with "${all[all.length - 1]}"`);
if (all[all.length - 2] !== 'node scripts/generators/update_sitemap.js') errors.push(`build:all must run build:finish straight after update_sitemap.js; a pass between them ("${all[all.length - 2]}") is outside the shared list and the cycle's publisher never runs it`);
for (const p of passes.filter(Boolean)) if (all.includes(`node ${p}`)) errors.push(`build:all runs ${p} itself as well as through build:finish; keep one list`);

if (!/execFileSync\(\s*'npm'\s*,\s*\[\s*'run'\s*,\s*'-s'\s*,\s*'build:finish'\s*\]/.test(publisher)) errors.push(`${publisherRel} does not run npm run build:finish; a page it publishes misses the finishing passes`);
for (const p of passes.filter(Boolean)) if (publisher.includes(`'${p}'`)) errors.push(`${publisherRel} runs ${p} on its own; that is a second copy of the build:finish list`);

if (errors.length) {
  console.error(`PUBLISH FINISH FAILED: ${errors.length} problem(s).`);
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`Publish finish OK: ${passes.length} finishing pass(es) in build:finish, run last by build:all and after every page authority:publish writes; the publisher keeps no list of its own.`);
