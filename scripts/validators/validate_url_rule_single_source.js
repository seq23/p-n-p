#!/usr/bin/env node
/**
 * Every component that maps a repository file to a public URL asks
 * scripts/lib/site_url.js. None of them keeps its own copy of the rule.
 *
 * WHY THIS EXISTS
 * ---------------
 * `Bounded Self-Healing` run 34376648600 failed on 2026-09-09 having run its
 * repair three times without effect:
 *
 *   [self-heal] 1 failing (1 repairable)
 *     repairing sitemap-coverage: npm run build:sitemap
 *   ... x3 ...
 *   [self-heal] NOT CLEAN after 3 attempt(s)
 *
 * The sitemap was correct every time. PR #12 (450e1f8, 2026-09-02) moved the
 * builder, the canonicals and every internal href onto site_url.js, because
 * Cloudflare Pages answers /answers/grazing.html with a 308 to
 * /answers/grazing. `validate_sitemap_coverage.js` was not moved with them and
 * kept inverting URLs with its own two-line rule, so it compared
 * `answers/grazing` against `answers/grazing.html`, matched nothing, and called
 * all 112 pages both missing from the sitemap and orphaned in it.
 *
 * A REPAIR THAT CANNOT SATISFY ITS OWN CHECK NEVER TERMINATES. The lane whose
 * job is fixing everything else could not fix itself, and it was the FIRST
 * scheduled run after #12 that discovered this — the drift had been latent for
 * a week.
 *
 * site_url.js already asked for this in prose: "validators, generators and the
 * normalizer pass all require it, and they must agree by construction rather
 * than by three copies of the same regex staying in sync." Prose is not
 * enforcement. This is.
 *
 * WHAT IT ASSERTS, AND WHY IT IS SCOPED RATHER THAN REPO-WIDE
 * ----------------------------------------------------------
 * A repo-wide grep for `.html` handling flags six files that legitimately slice
 * an extension off a filename to build a slug, a cache key or a report label.
 * Reporting those would be a detector that cries wolf, and a guard nobody can
 * clear gets ignored or deleted — the failure mode this repository has already
 * been bitten by elsewhere.
 *
 * So the roles are NAMED. Each entry below is a component whose actual job is
 * to decide what a public URL looks like, and for each one:
 *
 *   1. it must require scripts/lib/site_url.js, and
 *   2. its CODE (comments stripped, so a file may quote the old rule while
 *      explaining why it no longer uses it) must not hand-roll the mapping.
 *
 * A named file that goes missing is a FAILURE, not a smaller check: deleting or
 * renaming one must not be a way to make this pass.
 *
 * RULE 0: exits non-zero if it examines zero roles.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE_OF_TRUTH = 'scripts/lib/site_url.js';

// The components whose job is file -> public URL. Add a role here when a new
// producer or guard starts deciding what a URL looks like.
const ROLES = [
  ['scripts/generators/update_sitemap.js', 'writes every sitemap <loc>'],
  ['scripts/validation/validate_sitemap_coverage.js', 'checks the sitemap covers the tree'],
  ['scripts/validators/validate_canonical_resolves.js', 'checks canonicals name a served URL'],
  ['scripts/normalize_public_urls.js', 'rewrites URLs other producers wrote'],
  ['templates/page-shell.js', 'renders canonical, og:url and JSON-LD @id'],
];

// The mapping written by hand. Each is a shape that decides, on its own, what a
// public URL looks like -- not merely a filename that happens to end in .html.
const HAND_ROLLED = [
  [/replace\(\s*\/\\\/\$\/\s*,\s*['"`]\/index\.html/, "trailing slash -> '/index.html'"],
  [/['"`]index\.html['"`]\s*:/, "a ternary mapping '' to 'index.html'"],
  [/index\\\.html\$\//, 'an index.html suffix regex'],
  [/slice\(\s*0\s*,\s*-\s*['"`]\.html['"`]\.length\s*\)/, "slicing '.html' off by length"],
];
// DELIBERATELY NOT LISTED: a bare `.replace(/\.html$/, '')`. templates/page-shell.js
// uses exactly that in breadcrumbJsonLd() to turn a path into BREADCRUMB SEGMENTS,
// not to decide a URL -- the URL beside it is built from offers.domain separately.
// Flagging it would be a detector crying wolf on correct code, and a guard nobody
// can clear is a guard that gets deleted. Every shape kept above decides, on its
// own and unambiguously, what a public URL looks like.

/** Remove block and line comments so a file may QUOTE the old rule in prose. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

const requiresSourceOfTruth = (src) =>
  /require\(\s*['"`][^'"`]*site_url(\.js)?['"`]\s*\)/.test(src)
  || /from\s+['"`][^'"`]*site_url(\.js)?['"`]/.test(src);

const failures = [];
let examined = 0;

if (!fs.existsSync(path.join(ROOT, SOURCE_OF_TRUTH))) {
  console.error(`The single source of truth ${SOURCE_OF_TRUTH} does not exist.`);
  process.exit(1);
}

for (const [rel, job] of ROLES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    failures.push(
      `${rel} is named as a URL-deciding role (${job}) and does not exist. A role that `
      + `disappears must fail this check, not shrink it -- otherwise renaming a file is a `
      + `way to stop it being governed.`
    );
    continue;
  }
  examined += 1;
  const code = stripComments(fs.readFileSync(abs, 'utf8'));

  if (!requiresSourceOfTruth(code)) {
    failures.push(
      `${rel} (${job}) does not require ${SOURCE_OF_TRUTH}. That is the drift that broke `
      + `sitemap-coverage after 450e1f8 and left Bounded Self-Healing repairing a file that `
      + `was already correct, three times, before giving up.`
    );
  }

  const handRolled = HAND_ROLLED.filter(([re]) => re.test(code)).map(([, what]) => what);
  if (handRolled.length) {
    failures.push(
      `${rel} (${job}) decides what a public URL looks like on its own: ${handRolled.join('; ')}. `
      + `Two copies of this rule is how the builder and its guard came to disagree.`
    );
  }
}

// RULE 0. A check that examined no roles has proven nothing at all.
if (examined === 0) {
  console.error(
    'URL RULE SINGLE SOURCE: zero roles examined. That is a failure, not a pass -- a guard '
    + 'that iterates over an empty list is the defect this repository names most often.'
  );
  process.exit(1);
}

if (failures.length) {
  console.error('URL RULE SINGLE SOURCE: FAIL');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `URL RULE SINGLE SOURCE: ${examined} role(s) all defer to ${SOURCE_OF_TRUTH}; `
  + 'no component keeps its own copy of the file-to-URL mapping.'
);
