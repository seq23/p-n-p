#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Main push coverage: every human ref update on main has a workflow run on
 * its exact sha.
 *
 * WHY THIS EXISTS. On 2026-09-17 PR #18 (six commits, 332 files, the broken-link
 * repair) was merged to main as 1c9c6cb6 through the GitHub web UI. Nothing ran.
 * Not "the lane went red" - `actions/runs?head_sha=1c9c6cb6...` returned
 * total_count 0 for every workflow. The repository activity log (the server-side
 * record of ref updates, `GET /repos/{owner}/{repo}/activity`) lists every
 * earlier human merge as `pr_merge` and has NO entry for this one; the next
 * entry on main simply has before=1c9c6cb6. GitHub moved the ref and never
 * emitted the event, so every consumer of that event - Actions, the Cloudflare
 * Pages app (no production check-run on 1c9c6cb6 either), the Events feed - saw
 * nothing. deploy-distribution.yml was unchanged since the last human push that
 * DID run (26e8e399, 2026-09-09), parsed clean under actionlint and PyYAML, and
 * Actions was enabled with every workflow active. The trigger was correct and
 * it was still not enough.
 *
 * A dropped event produces no artifact, so no validator that reads the repo can
 * see it. Nor can one that reads the activity log - the first version of this
 * validator did, printed OK, and was wrong, because the activity log is the
 * thing that was dropped. The one record the drop cannot touch is the commit
 * graph: 1c9c6cb6 is on main whether or not GitHub announced it. So:
 *
 *   1. Walk main's FIRST-PARENT history through the API (a checkout in CI has
 *      depth 1) and collect the most recent human landings. A landing is a
 *      merge commit with a human author (a PR merge: author seq23, committer
 *      web-flow), or a run of consecutive non-merge commits with a human author
 *      and committer (a direct push; only its tip receives a run). Commits
 *      authored and committed by the repo's bots (pnp-authority-bot as the
 *      `actions` login, github-actions[bot]) are the automated cycles, which
 *      by GitHub's rule raise no push event and are reached by workflow_run.
 *   2. For each landing, require at least one workflow run whose head_sha is
 *      the landing's tip, or - for a merge - its second parent, the PR head
 *      that the pull_request trigger validates before merge.
 *   3. Report every uncovered landing by name. Exit 1 if any.
 *
 * It hard-fails when it can examine zero human landings and when the API
 * cannot be reached: a scan that proves nothing must not print OK.
 *
 * Remediation for an uncovered sha (this is how 1c9c6cb6 was covered): push a
 * branch at that sha and dispatch the lane on it, which creates a run with that
 * exact head_sha -
 *   git push origin <sha>:refs/heads/validate/<sha>
 *   gh workflow run "Deploy Distribution" --ref validate/<sha>
 *   git push origin --delete validate/<sha>     (after the run completes)
 *
 * Needs a token: GH_TOKEN or GITHUB_TOKEN (the lane passes github.token, which
 * needs `actions: read`), or locally whatever `gh auth token` returns.
 */
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
// --ref lets the same walk be pointed at another branch. That is how the
// negative proof is run: a branch whose tip is a human commit with no run.
const REF = argOf('--ref', 'main');
const WINDOW = Number(process.env.MAIN_PUSH_COVERAGE_WINDOW || 10);
// Overridable so the zero-landings hard-fail can be proven against a stub.
const API_BASE = process.env.MAIN_PUSH_COVERAGE_API_BASE || 'https://api.github.com';
const MAX_PAGES = 5; // 100 commits per page; enough first-parent history to find WINDOW landings

function fail(msg) {
  console.error(`validate:main-push-coverage FAILED: ${msg}`);
  process.exit(1);
}

function repoSlug() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  let url = '';
  try {
    url = execFileSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim();
  } catch {
    fail('no GITHUB_REPOSITORY and no git remote "origin" to derive the repository from.');
  }
  const m = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
  if (!m) fail(`cannot derive owner/repo from remote "${url}".`);
  return m[1];
}

function token() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

async function api(path, tok) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'p-n-p-validate-main-push-coverage',
      ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
    },
  });
  if (!res.ok) {
    fail(`GET ${path} -> HTTP ${res.status} ${res.statusText}. The scan is broken, not the repo: it cannot tell whether main was covered.`);
  }
  return res.json();
}

// GitHub identity (may be null when the email is unmatched) plus the git
// identity. The repo's bots: pnp-authority-bot commits under the `actions`
// login with actions@users.noreply.github.com; github-actions[bot] under its
// own. An unmatched human email is still human.
const isBot = (gh, git) => {
  const login = (gh && gh.login) || '';
  const email = (git && git.email) || '';
  const name = (git && git.name) || '';
  return /\[bot\]$/.test(login) || login === 'actions' || login === 'github-actions'
    || /^actions@|\[bot\]@/.test(email) || /\[bot\]$|-bot$/.test(name);
};

async function main() {
  const repo = repoSlug();
  const tok = token();
  if (!tok) {
    fail('no token (GH_TOKEN, GITHUB_TOKEN, or `gh auth token`). Unauthenticated calls cannot read this repo\'s runs reliably, so the result would be meaningless.');
  }

  // 1. First-parent history of the ref, newest first, from the API.
  const bySha = new Map();
  let head = null;
  let page = 1;
  const fetchPage = async () => {
    const rows = await api(`/repos/${repo}/commits?sha=${encodeURIComponent(REF)}&per_page=100&page=${page}`, tok);
    page += 1;
    if (!Array.isArray(rows)) fail('commits API did not return a list.');
    for (const c of rows) bySha.set(c.sha, c);
    if (!head && rows.length) head = rows[0].sha;
    return rows.length;
  };
  await fetchPage();
  if (!head) fail(`the commits API returned zero commits for ${REF}. The scan is broken, not the repo.`);

  const landings = []; // { tip, type, author, at, candidates }
  let walked = 0;
  let cur = head;
  let openRun = null; // consecutive human non-merge commits = one direct push
  while (cur && landings.length < WINDOW && walked < 100 * MAX_PAGES) {
    if (!bySha.has(cur)) {
      const got = await fetchPage();
      if (!bySha.has(cur)) {
        if (!got) break; // history exhausted or unreachable through listing
        continue;
      }
    }
    const c = bySha.get(cur);
    walked += 1;
    const human = !isBot(c.author, c.commit.author) && !isBot(c.committer, c.commit.committer);
    const merge = (c.parents || []).length === 2;
    if (human && merge) {
      if (openRun) { landings.push(openRun); openRun = null; }
      landings.push({ tip: c.sha, type: 'pr_merge', author: c.commit.author.name, at: c.commit.committer.date, candidates: [c.sha, c.parents[1].sha] });
    } else if (human) {
      if (!openRun) openRun = { tip: c.sha, type: 'push', author: c.commit.author.name, at: c.commit.committer.date, candidates: [c.sha], commits: 0 };
      openRun.commits += 1;
    } else if (openRun) {
      landings.push(openRun); openRun = null;
    }
    cur = c.parents && c.parents.length ? c.parents[0].sha : null;
  }
  if (openRun && landings.length < WINDOW) landings.push(openRun);
  if (!landings.length) {
    fail(`walked ${walked} first-parent commit(s) on ${REF} and found zero human landings. Either the commits API returned nothing or every commit was a bot; either way nothing was proven.`);
  }

  // 2. For each, a run on the exact sha or on the PR head it merged.
  const uncovered = [];
  const covered = [];
  for (const l of landings) {
    let hit = null;
    for (const sha of l.candidates) {
      const runs = await api(`/repos/${repo}/actions/runs?head_sha=${sha}&per_page=5`, tok);
      if (runs.total_count > 0) {
        const r = runs.workflow_runs[0];
        hit = { on: sha === l.tip ? 'exact sha' : `PR head ${sha.slice(0, 8)}`, run_id: r.id, workflow: r.name, event: r.event, conclusion: r.conclusion || r.status };
        break;
      }
    }
    if (hit) covered.push({ ...l, ...hit });
    else uncovered.push(l);
  }

  for (const c of covered) {
    console.log(`  covered   ${c.tip.slice(0, 8)} ${c.type.padEnd(8)} ${c.at} by ${c.author}: run ${c.run_id} (${c.workflow}, ${c.event}, ${c.conclusion}) on ${c.on}`);
  }
  for (const u of uncovered) {
    console.error(`  UNCOVERED ${u.tip.slice(0, 8)} ${u.type.padEnd(8)} ${u.at} by ${u.author}: no workflow run on ${u.candidates.map((s) => s.slice(0, 8)).join(' or ')}`);
  }

  if (uncovered.length) {
    fail(
      `${uncovered.length} of the last ${landings.length} human landing(s) on ${REF} reached the branch and no workflow ran on them. `
      + 'GitHub dropped the push event (this happened to 1c9c6cb6 on 2026-09-17) or the trigger is unreachable. '
      + 'Cover each sha with a run: git push origin <sha>:refs/heads/validate/<sha> && gh workflow run "Deploy Distribution" --ref validate/<sha>',
    );
  }
  console.log(`Main push coverage OK (${landings.length} human landing(s) on ${REF} examined across ${walked} first-parent commit(s); every one has a workflow run on its exact sha or its PR head)`);
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
