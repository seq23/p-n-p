#!/usr/bin/env node
/**
 * The cadence gate must not mistake a re-spelled URL for a published page.
 *
 * WHAT WENT WRONG (2026-09-03, run 33709958800, `Deploy Distribution` on main)
 * ---------------------------------------------------------------------------
 * The canonical fix (#12) changed how every URL on this origin is written:
 * `/x.html` 308s to `/x`, so every producer stopped emitting the `.html` form.
 * `data/cadence/known_urls.json` - the ledger that is the sole input
 * distinguishing a new page from an existing one - still held the `.html`
 * spelling of those same 112 pages, and the gate compared raw strings. Result:
 *
 *   CADENCE GATE BLOCKED: 112 urls; ...
 *     BLOCK  weekly_cap: 105 URLs are new since the last run, cap is 1 per week
 *
 * 105 pages "published" in a commit that published nothing. Nothing had changed
 * but the spelling: the identity sets on both sides were byte-identical after
 * normalisation. The lane stayed red, no re-run could clear it, and the honest
 * escape hatch - `cadence:accept` - would have recorded 105 fictitious
 * publications in the audit log and blown a cap of 1/week wide open.
 *
 * WHAT THIS ASSERTS
 * -----------------
 *   1. The shared comparison really is identity-based. Fixture proof, both
 *      ways: re-spelling every ledger URL to the redirecting form yields ZERO
 *      new pages, and a genuinely new route still yields exactly one. A gate
 *      immune to the regression but also blind to real publishing would be a
 *      worse outcome than the bug.
 *   2. Both callers route through it. `cadence_gate.js` and `cadence_accept.js`
 *      must call `newSinceLedger`, and neither may rebuild its own raw
 *      membership set from the ledger. That is exactly the line that broke.
 *   3. The committed ledger is stored in the form this origin serves - no entry
 *      is in a redirecting form, and no two entries are two spellings of one
 *      page.
 *   4. The live ledger and the live sitemap agree page-for-page in spelling as
 *      well as in identity, so no spelling-only drift is sitting there waiting
 *      to be misread by anything downstream that has not been taught the
 *      difference.
 *
 * It hard-fails when it examines zero ledger URLs or zero sitemap URLs rather
 * than passing an empty loop: an empty ledger is precisely the state in which
 * every page on the site looks new.
 *
 * Usage: node scripts/validators/validate_cadence_ledger_identity.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const {
  sitemapUrls, pageIdentity, newSinceLedger, LEDGER_REL,
} = require('../cadence/sitemap_urls.js');
const { DOMAIN, isRedirectingForm } = require('../lib/site_url.js');

const ROOT = process.cwd();
const GATE_REL = 'scripts/cadence_gate.js';
const ACCEPT_REL = 'scripts/cadence_accept.js';

const failures = [];
const counters = {
  ledger_urls: 0,
  sitemap_urls: 0,
  fixture_cases: 0,
  callers_checked: 0,
};

// --- 1: the shared comparison is identity-based, and still has teeth ---------
//
// Fixtures rather than the live data, so this proves the behaviour of the
// comparison itself and keeps proving it on a day when the live ledger and the
// live sitemap happen to be identical.
//
// Both spellings are written out literally. Deriving one from the other with
// pageIdentity() would make the fixtures self-referential: a pageIdentity() that
// stopped normalising would produce two identical lists and every case below
// would pass while proving nothing.
const FIXTURE_LEDGER = [
  `${DOMAIN}/index.html`,
  `${DOMAIN}/answers/index.html`,
  `${DOMAIN}/answers/grazing-tables-memphis.html`,
  `${DOMAIN}/local/index.html`,
  `${DOMAIN}/pricing.html`,
];
const RESPELLED = [
  `${DOMAIN}/`,
  `${DOMAIN}/answers/`,
  `${DOMAIN}/answers/grazing-tables-memphis`,
  `${DOMAIN}/local/`,
  `${DOMAIN}/pricing`,
];

// The pairing itself, asserted directly: each redirecting spelling and its
// served spelling must resolve to one identity, and a served spelling must
// resolve to itself rather than being normalised a second time.
for (let i = 0; i < FIXTURE_LEDGER.length; i += 1) {
  counters.fixture_cases += 1;
  const a = pageIdentity(FIXTURE_LEDGER[i]);
  const b = pageIdentity(RESPELLED[i]);
  if (a !== b) {
    failures.push(`fixture_identity_pair: pageIdentity() maps ${FIXTURE_LEDGER[i]} to ${a} and ${RESPELLED[i]} to ${b}. Those are one page on this origin - the first 308s to the second - so they must share one identity.`);
  }
  if (b !== RESPELLED[i]) {
    failures.push(`fixture_identity_stable: pageIdentity(${RESPELLED[i]}) returned ${b}. The form this origin serves must be a fixed point, or the ledger can never be written in a form that stays put.`);
  }
}

const fixtureCases = [
  {
    name: 'respelling_is_not_publication',
    urls: RESPELLED,
    ledger: FIXTURE_LEDGER,
    expect: 0,
    why: 'every ledger URL rewritten from the redirecting `.html` form to the form the origin serves. This is run 33709958800 exactly: same pages, new spelling, and it must not read as publishing.',
  },
  {
    name: 'reverse_respelling_is_not_publication',
    urls: FIXTURE_LEDGER,
    ledger: RESPELLED,
    expect: 0,
    why: 'the same drift in the other direction, so the comparison is symmetric rather than tuned to one migration.',
  },
  {
    name: 'a_new_route_is_still_new',
    urls: [...RESPELLED, `${DOMAIN}/answers/newly-published-page`],
    ledger: FIXTURE_LEDGER,
    expect: 1,
    why: 'a route the ledger has never seen. If this were 0 the weekly publication cap would be unenforceable, which is a worse defect than the one being guarded.',
  },
  {
    name: 'a_new_route_in_html_form_is_still_new',
    urls: [...RESPELLED, `${DOMAIN}/answers/newly-published-page.html`],
    ledger: FIXTURE_LEDGER,
    expect: 1,
    why: 'normalising spellings must not normalise an unseen page into an existing one.',
  },
  {
    name: 'an_empty_ledger_makes_everything_new',
    urls: RESPELLED,
    ledger: [],
    expect: RESPELLED.length,
    why: 'with no baseline every page is new; the identity mapping must not invent membership.',
  },
];

for (const c of fixtureCases) {
  counters.fixture_cases += 1;
  const got = newSinceLedger(c.urls, c.ledger).length;
  if (got !== c.expect) {
    failures.push(
      `fixture_${c.name}: newSinceLedger() reported ${got} new page(s), expected ${c.expect}. ${c.why}`,
    );
  }
}

// --- 2: both callers route through the shared comparison ---------------------
for (const rel of [GATE_REL, ACCEPT_REL]) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    failures.push(`caller_missing: ${rel} does not exist, so the cadence cap has no reader.`);
    continue;
  }
  counters.callers_checked += 1;
  const src = fs.readFileSync(file, 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
  if (!/\bnewSinceLedger\s*\(/.test(code)) {
    failures.push(
      `caller_bypasses_identity: ${rel} does not call newSinceLedger(). It must compare the sitemap against the ledger through the one shared identity-based comparison; a private comparison is how the ledger and the site drifted into two spellings of the same 112 pages.`,
    );
  }
  // The literal shape of the defect: a raw membership set built straight from
  // the ledger's stored strings.
  if (/new Set\(\s*JSON\.parse\([^)]*known_urls|new Set\(\s*[\w.]*[Uu]rls\b/.test(code)) {
    failures.push(
      `caller_raw_string_set: ${rel} builds a membership Set directly from the ledger's stored URL strings. That defines a page's identity as its spelling, which is the exact fault that blocked Deploy Distribution on 105 pages nobody published.`,
    );
  }
}

// --- 3 & 4: the committed ledger is stored in served form and matches ---------
const ledgerPath = path.join(ROOT, LEDGER_REL);
let ledgerUrls = null;
if (!fs.existsSync(ledgerPath)) {
  failures.push(`ledger_missing: ${LEDGER_REL} does not exist, so every page in the sitemap reads as newly published.`);
} else {
  try {
    ledgerUrls = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).urls;
  } catch (err) {
    failures.push(`ledger_unreadable: ${LEDGER_REL} is not valid JSON (${err.message}).`);
  }
  if (!Array.isArray(ledgerUrls)) {
    failures.push(`ledger_malformed: ${LEDGER_REL} has no \`urls\` array.`);
    ledgerUrls = null;
  }
}

if (ledgerUrls) {
  counters.ledger_urls = ledgerUrls.length;
  if (!ledgerUrls.length) {
    failures.push(`ledger_empty: ${LEDGER_REL} records zero URLs. An empty baseline is the state in which the whole library looks new, so it is a hard failure rather than an empty loop to pass over.`);
  }

  const redirecting = ledgerUrls.filter((u) => isRedirectingForm(u));
  if (redirecting.length) {
    failures.push(
      `ledger_in_redirecting_form: ${redirecting.length} of ${ledgerUrls.length} entries in ${LEDGER_REL} are written in a form this origin answers with a 3xx (e.g. ${redirecting.slice(0, 3).join(', ')}). Store the URL the origin serves, the same one scripts/lib/site_url.js gives every other producer.`,
    );
  }

  const seen = new Map();
  for (const u of ledgerUrls) {
    const id = pageIdentity(u);
    if (seen.has(id)) {
      failures.push(`ledger_duplicate_identity: ${LEDGER_REL} holds two spellings of one page (${seen.get(id)} and ${u}).`);
    } else {
      seen.set(id, u);
    }
  }
}

const sitemap = [...sitemapUrls(ROOT).keys()];
counters.sitemap_urls = sitemap.length;
if (!sitemap.length) {
  failures.push('sitemap_empty: no sitemap URLs were found, so this validator examined nothing. A check that passes on zero items proves nothing.');
}

if (ledgerUrls && ledgerUrls.length && sitemap.length) {
  const stored = new Set(ledgerUrls);
  const rawNew = sitemap.filter((u) => !stored.has(u));
  const identityNew = newSinceLedger(sitemap, ledgerUrls);
  const spellingOnly = rawNew.filter((u) => !identityNew.includes(u));
  if (spellingOnly.length) {
    failures.push(
      `ledger_spelling_drift: ${spellingOnly.length} sitemap URL(s) name a page the ledger already records, but under a different spelling (e.g. ${spellingOnly.slice(0, 3).join(', ')}). The gate is immune to this, but the drift means the ledger no longer says what the site says. Re-spell ${LEDGER_REL} into served form; do NOT run cadence:accept, which would record these as publications.`,
    );
  }
}

const receipt = {
  validator: 'cadence_ledger_identity',
  status: failures.length ? 'FAIL' : 'PASS',
  hard_failures: failures.length,
  ...counters,
  failures,
};
fs.mkdirSync(path.join(ROOT, 'reports/validation'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'reports/validation/cadence-ledger-identity.json'),
  JSON.stringify({ schema_version: '1.0', generated_at: new Date().toISOString(), ...receipt }, null, 2) + '\n',
);

if (failures.length) {
  console.error(JSON.stringify(receipt, null, 2));
  process.exit(1);
}
console.log(
  `Cadence ledger identity OK (${counters.ledger_urls} ledger URL(s) and ${counters.sitemap_urls} sitemap URL(s) checked, all in served form and agreeing page-for-page; `
  + `${counters.fixture_cases} fixture case(s) prove the comparison ignores re-spelling and still counts a genuinely new route; `
  + `${counters.callers_checked} caller(s) route through newSinceLedger)`,
);
