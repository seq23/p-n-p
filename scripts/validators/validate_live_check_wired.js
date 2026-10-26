#!/usr/bin/env node
'use strict';
/**
 * validate:live-check-wired - the post-deploy live check exists, runs after a
 * deploy, and actually fetches the live host.
 *
 * Rule 0 in this repository is that no stage may exit 0 having done nothing, and
 * the defect class this guards is "exists but nothing invokes it": a workflow
 * file named for a live check that never runs, or that runs a script which no
 * longer fetches anything, would satisfy an external audit while checking
 * nothing. So this asserts the whole chain:
 *   - .github/workflows/live-check.yml exists and its name matches the pattern
 *     an audit looks for (post-deploy / live check / smoke);
 *   - it triggers on push to main (after the Pages deploy) and on a schedule,
 *     and NOT on pull_request - there is nothing deployed to check on a PR, and
 *     a network check must never become the merge gate;
 *   - it has a job-level timeout-minutes (a fault detector, per CLAUDE.md);
 *   - it runs npm run live:check, that script is in package.json, and the file
 *     it points at exists;
 *   - the script fetches over the network (fetch of an https URL built from the
 *     live host) and hard-fails on zero checks, so it cannot pass vacuously;
 *   - the script checks each thing item h4 names: the crawl files, the icons,
 *     the og image, the schema @id, the redirects and the IndexNow key.
 *
 * Usage: node scripts/validators/validate_live_check_wired.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WF = '.github/workflows/live-check.yml';
const SCRIPT = 'scripts/ops/post_deploy_live_check.mjs';

const errors = [];
let checks = 0;
const ok = (cond, msg) => { checks += 1; if (!cond) errors.push(msg); };

ok(fs.existsSync(path.join(ROOT, WF)), `${WF} does not exist`);
ok(fs.existsSync(path.join(ROOT, SCRIPT)), `${SCRIPT} does not exist`);
if (errors.length) { console.error(`live-check-wired: ${errors.length} problem(s)\n  - ${errors.join('\n  - ')}`); process.exit(1); }

const wf = fs.readFileSync(path.join(ROOT, WF), 'utf8');
const src = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// the name an audit greps for
ok(/^name:.*(post[-_ ]?deploy|live[-_ ]?check|smoke|verify[-_ ]?live)/im.test(wf),
  `${WF} name does not say post-deploy / live check / smoke, which is what an audit looks for`);

// when it runs
ok(/on:\s*[\s\S]*?push:\s*\n\s*branches:\s*\[main\]/m.test(wf), `${WF} does not run on push to main, so it never follows a deploy`);
ok(/schedule:\s*\n\s*(#[^\n]*\n\s*)*- cron:/m.test(wf), `${WF} has no schedule, so a site that breaks without a push is never noticed`);
ok(!/^\s*pull_request:/m.test(wf), `${WF} triggers on pull_request; a network check must not become the merge gate and there is nothing deployed to check`);
ok(/^\s*timeout-minutes:\s*\d+/m.test(wf), `${WF} has no job timeout-minutes`);

// what it runs
ok(/npm run live:check/.test(wf), `${WF} does not run npm run live:check`);
// A push must wait for THIS commit's deploy, not a fixed sleep: on 26 Oct 2026 a "sleep 90"
// compared #149 against the previous deploy and reported 81 false failures (main red, rerun green).
ok(/github\.event_name == 'push' && '--wait-for-deploy \d+'/.test(wf), `${WF} does not pass --wait-for-deploy on a push, so it can compare a commit against the previous deploy`);
ok(!/^\s*run:\s*sleep\s+\d+/m.test(wf), `${WF} waits with a fixed sleep; wait for the deploy of this commit instead (--wait-for-deploy)`);
ok(/wait-for-deploy/.test(fs.readFileSync(path.join(ROOT, SCRIPT), 'utf8')) && /committedSitemap && ll === committedLlms/.test(fs.readFileSync(path.join(ROOT, SCRIPT), 'utf8')), `${SCRIPT} does not implement --wait-for-deploy against the committed sitemap.xml and llms.txt`);
ok(pkg.scripts && pkg.scripts['live:check'] === `node ${SCRIPT}`, `package.json live:check must be "node ${SCRIPT}"`);

// the script does real work
ok(/\bawait fetch\(/.test(src), `${SCRIPT} never calls fetch; a "live" check that reads only the disk checks nothing`);
ok(/https:\/\/\$\{HOST\}/.test(src), `${SCRIPT} does not build its URLs from the live host`);
ok(/if \(!checks\)[\s\S]{0,200}process\.exit\(1\)/.test(src), `${SCRIPT} does not hard-fail on zero checks, so it could pass having looked at nothing`);
ok(/advertises no URL[\s\S]{0,120}process\.exit\(1\)/.test(src), `${SCRIPT} does not hard-fail on an empty committed sitemap`);

// each thing item h4 names
for (const [what, re] of [
  ['robots.txt', /\/robots\.txt/],
  ['sitemap.xml', /\/sitemap\.xml/],
  ['the IndexNow key file', /keyFiles/],
  ['the icons', /ICON_FILES/],
  ['the og image', /ogImages/],
  ['the schema business @id', /contact\.entity\.id/],
  ['the redirects', /_redirects/],
]) ok(re.test(src), `${SCRIPT} no longer checks ${what}, which her checklist item h4 names`);

if (!checks) { console.error('LIVE CHECK WIRED FAILED: 0 checks ran.'); process.exit(1); }
if (errors.length) {
  console.error(`live-check-wired: ${errors.length} problem(s) of ${checks} check(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Live check wired OK: ${checks} checks; ${WF} runs on push to main and on a schedule (never on a pull request) and runs ${SCRIPT}, which fetches the live host, hard-fails on zero checks, and covers the crawl files, the icons, the og images, the schema @id, the redirects and the IndexNow key.`);
