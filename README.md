# p-n-p

Static site repo for Porch & Party at porchandparty901.com.

## Public contact path
- Quote page: `/contact.html`
- Form destination: https://forms.gle/vHjfKtRRAnGV3HxFA
- Public email: hello@porchandparty901.com

## Build commands
- `npm run build:all`
- `npm run validate:all`
- `npm run validate:pnp-phase`

### Read this before running `build:all`

**`build_pages.js` does not run last, so re-rendering an existing page reverts it.**

Two passes write markup into published pages *after* the generator has produced
them, and the generator knows nothing about either:

| Pass | Writes | Losing it means |
|---|---|---|
| `scripts/install_clarity.js` | `<script data-clarity-loader>` | the page records no analytics sessions, silently, forever |
| `scripts/build_related_navigation.js` | `<section data-nav="related-pages">` | the page is orphaned; orphan count is this portfolio's strongest measured correlate with being cited |

Measured 2026-08-27: all 26 template pages differed from a fresh render, every
one **smaller by 1,500–1,900 bytes**, and all 26 are among the 98 routes frozen
in `data/release/frozen_output_registry.json`, where
`normal_build_may_mutate_frozen` is `false`. `npm run build:all` invokes the
generator nine times and would have stripped both blocks from every one of them
— unauthorized drift on 26 frozen routes plus an analytics blackout.

It was silent because a smaller file is still a valid file. Nothing downstream
compares byte counts, and the retrofit passes are idempotent, so a later run
puts the markup back and leaves no trace it was ever gone.

Two guards now exist:

- `build_pages.js` **refuses** the write and exits non-zero when it would drop a
  marker that is on disk. `--force` overrides; on a frozen route that still needs
  an active mutation scope.
- `npm run validate:retrofit-integrity` (in `validate:pnp-phase`) hard-fails if
  any published page has lost either block by any other route.

**To change a page the generator owns:** edit its entry in
`data/queries/query_universe.json`, render that one page, then re-run the
retrofit passes. Do not delete the guard.

## Docs
- `docs/AUTOMATION-ENGINE.md`
- `docs/GOOGLE-BUSINESS-PROFILE-CHECKLIST.md`
- `docs/DISTRIBUTION-RUNBOOK.md`
- `docs/CONTENT-OPERATIONS.md`
- `docs/SEARCH-INTELLIGENCE.md`
- `docs/day-0/START_HERE.md`

## Operating contracts
- `data/ops/pnp_local_authority_contract.json`

## Authority Scale System — 2026-07-24

Porch & Party now uses a governed local-authority loop rather than treating page count as the goal.

- 100,000 deterministic opportunity records are stored as compressed planning intelligence, not public pages.
- A 2,500-opportunity operational window is scored against existing authority URLs.
- The engine prefers improving an existing intent-matched page before creating a duplicate URL.
- New enriched queue items share one evidence-gated daily ceiling: `3 → 5 → 10 → 15 → 25 → 50`; these are ceilings, never quotas.
- Accepted authority pages are admitted and frozen; semantic changes require exact mutation scope and refreeze.
- Validated publication feeds sitemap, IndexNow, and Google Search Console distribution when credentials are configured.
- Citation, indexation, search visibility, LLM surfacing, external references, and verified citations remain separate metrics.
- Twin Agent is not installed here. Twin remains limited to Velocity and Spry; this repo uses only generalized page-quality lessons.

See `docs/AUTHORITY_SCALE_100K_OPERATING_CONTRACT.md`.

Canonical commands:

```bash
npm run authority:cycle
npm run validate:release
npm run authority:scale:status
```

## Search Intelligence — 2026-08-07

A closed search-intelligence loop runs alongside the authority engine: target
queries → live grounded observation → competitor comparison → real Google Search
Console truth → diagnosis → smallest bounded repair candidate → existing approval
and publishing rules → same-query retest → before/after evidence → authority
feedback.

- Google Search Console is the only authority for own-site Google performance.
- Grounded/generative search observation is never reported as a Google SERP rank.
- The observation lane is governed by a free-tier allowance and refuses to spend
  past it, so it runs at zero incremental cost by default.
- An unavailable or degraded provider always reports `UNAVAILABLE`/`DEGRADED`. It
  never produces a green result, and zero findings never means "healthy".
- The lane publishes nothing, is not part of `authority:cycle`, and does not change
  the publishing cadence.

```bash
npm run search:cycle     # read-and-prepare loop
npm run search:status    # provider truth state first
npm run search:proof     # hostile-fixture + end-to-end loop self-tests
```

See `docs/SEARCH-INTELLIGENCE.md`.
