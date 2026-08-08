# Search Intelligence — Porch & Party

A closed loop that tests real queries, compares what shows up against competitors,
checks Google's own numbers, diagnoses what is wrong, prepares the smallest safe
fix, retests the same queries, and feeds real evidence back into the authority
ledgers.

It does **not** publish anything and it does **not** change how often the site
publishes.

## The five rules this lane is built around

| # | Rule | How it is enforced |
|---|---|---|
| 1 | A live-search observation lane exists and can run at zero incremental cost when provider allowance permits | The observer is governed by a declared free-tier call budget. It refuses to spend past it and records `SKIPPED_BUDGET_EXHAUSTED` instead of billing. |
| 2 | Gemini/search grounding is NEVER literal Google SERP rank | Grounded observations carry `observation_kind: grounded_search_observation` and `is_literal_serp_rank: false`, and a validator hard-fails if any of them carries a `rank`/`position` field. Rank-like fields are only legal inside a Google Search Console record. |
| 3 | Google Search Console is the authority for own-site Google performance | Only GSC rows may produce impressions, clicks, CTR, average position, or indexation. A diagnosis that asserts own-site performance without a GSC basis is a hard failure. |
| 4 | Provider unavailable/degraded NEVER silently produces green/OK | Every artifact carries `provider_state`, `overall_status`, and `status_is_healthy`. A green status while any provider is degraded is a hard failure, and a degraded artifact must carry an `unavailable_note`. |
| 5 | Search intelligence NEVER changes the publishing cadence | The lane is not part of `authority:cycle`, repair output is `PREPARE_ONLY`, and a validator scans every lane script and hard-fails if it writes any protected publishing path. |

These are checked by `npm run validate:search-intelligence`, which is part of
`npm run validate:release`.

## The loop

```text
target query set
  -> live search observation        (grounded, free-allowance governed)
  -> competitor comparison
  -> real provider truth            (Google Search Console)
  -> diagnosis
  -> smallest bounded repair candidate
  -> existing approval + publishing rules   (unchanged)
  -> repair preparation
  -> same-query retest
  -> before/after evidence comparison
  -> authority / citation / entity / content feedback
```

## Commands

| Command | What it does | Contacts a provider? |
|---|---|---|
| `npm run search:targets` | Builds the target query set from existing repo sources | no |
| `npm run search:observe` | Grounded live-search observation inside the free allowance | yes, if `GEMINI_API_KEY` is set |
| `npm run search:competitors` | Competitor comparison from observation records | no |
| `npm run search:truth` | Ingests the real GSC Search Analytics export | no (the Python collector does) |
| `npm run search:diagnose` | Joins all evidence into per-query diagnosis | no |
| `npm run search:repair:prepare` | Prepares smallest bounded repair candidates | no |
| `npm run search:retest -- <label>` | Same-query retest snapshot | no |
| `npm run search:evidence:compare -- baseline after-repair` | Before/after evidence comparison | no |
| `npm run search:feedback -- --write` | Writes evidence-backed events to the authority ledgers | no |
| `npm run search:status` | Plain-English status, loud about provider state | no |
| `npm run search:cycle` | Runs the read-and-prepare loop end to end | only `search:observe` |
| `npm run search:proof` | Hostile-fixture + end-to-end loop self-tests | no |
| `npm run validate:search-intelligence` | Hard-fail truth-contract validator | no |

## Getting real provider truth

### Google Search Console (authoritative)

The repository already holds `GSC_SERVICE_ACCOUNT_JSON` and `GSC_SITE_URL` as
GitHub secrets. The easiest path is to dispatch the workflow:

```text
Actions -> Search Intelligence Cycle -> Run workflow
  start_date: 2026-07-01
  end_date:   2026-07-28
  retest_label: baseline
```

Locally, if you have the service-account file:

```bash
python3 distribution_scripts/gsc_search_analytics.py \
  ./gsc-service-account.json \
  "sc-domain:porchandparty901.com" \
  2026-07-01 2026-07-28 \
  data/search_intelligence/gsc_search_analytics_export.json

npm run search:truth
```

The collector uses the read-only scope `webmasters.readonly`. It reads; it never
submits or mutates anything.

### Grounded search observation (optional, free-allowance governed)

```bash
export GEMINI_API_KEY=...        # add as a repo secret to use it in CI
npm run search:observe
```

The default budget is 40 calls per run, inside the provider free allowance, so
the lane costs nothing. Raising the budget beyond the declared free allowance
requires `SEARCH_INTELLIGENCE_ALLOW_PAID_SPEND=true`; without it the request is
clamped down, not billed.

## Reading the status honestly

`npm run search:status` prints provider state first, on purpose.

- **`UNAVAILABLE`** means no provider truth was obtained. Zero findings is **not**
  a clean result — it means nothing was measured.
- **`DEGRADED`** means something answered but not completely. Treat findings as
  partial.
- **`OK`** means the provider answered.

A passing `npm run validate:search-intelligence` proves the truth contract holds.
It does **not** prove any provider was reachable. Those are separate facts and the
validator prints both.

## What a repair candidate is and is not

A repair candidate is a prepared, evidence-backed suggestion for the smallest
change to **one existing route**. It is not a publication and not an approval.

Every candidate carries `state: PREPARED_NOT_APPLIED`, `publishes: false`, and
`requires_existing_approval_and_publishing_rules: true`. Applying one goes through
the repo's normal rules: improve-before-duplicate-new-URL, the evidence-gated daily
ceiling (`3 → 5 → 10 → 15 → 25 → 50`, ceilings never quotas), admission, and freeze.

Candidates are never produced from a diagnosis whose confidence is
`INSUFFICIENT_EVIDENCE`.

## Authority feedback and KPI truth

`npm run search:feedback -- --write` writes into the repo's existing ledgers:

- `data/authority_scale/observed_surfacing_ledger.json`
- `data/authority_scale/citation_yield_observations.json`

Mapping is deliberately conservative and keeps the metrics separate:

| Evidence | Becomes | Never becomes |
|---|---|---|
| Grounded answer referenced an own URL | `llm_surfacing` / `llm_linked_citation` | a Google rank, a verified citation |
| GSC query row with impressions | `search_visibility` | a click, a citation |
| GSC query row with clicks | `search_click` | a citation |
| GSC page row with impressions | `indexed_page` | a ranking claim |

The feedback stage never creates a verified citation. Verified citations require
independent external evidence and stay at zero until that evidence exists.

Events are only written when they carry provider, timestamp, URL, and evidence.
Re-running the stage is idempotent.

## Proof

```bash
npm run search:proof
```

- `search:selftest` — 15 hostile fixtures. Each injects one violation (grounded
  observation claiming a SERP rank, a green status while a provider is down,
  own-site metrics without a GSC basis, a budget breach, the lane being wired into
  `authority:cycle`, a lane script writing the publish queue, an event illegally
  marked as a verified citation) and asserts the validator hard-fails on it. It also
  asserts a clean lane passes, and that the scan-exclusion list cannot be abused to
  hide a real writer.
- `search:selftest:loop` — 24 end-to-end checks. Drives the whole loop with fixture
  provider evidence in a temp sandbox and asserts the loop actually diagnoses,
  prepares bounded repairs, retests, detects before/after improvement, and emits
  feedback events that the repo's **existing** `validate:kpi-truth` validator accepts.

Both run in an isolated OS temp directory. Neither mutates the repo.

## What this lane does not do

- It does not publish, unpublish, queue, admit, freeze, or change the sitemap.
- It does not change the daily new-URL ceiling or the velocity governor.
- It does not run on a schedule.
- It does not submit anything to a provider. Submission stays in the existing
  distribution lane (`deploy-distribution.yml`).
- It does not claim rankings, indexation, surfacing, or citations that a provider
  did not actually report.
