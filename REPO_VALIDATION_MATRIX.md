# Repo Validation Matrix — Porch & Party 901

Status: ACTIVE — AUTHORITY SCALE STANDARD 2026-07-24

## Canonical release gate

`npm run validate:release`

This is the required structural/repository release gate. It does not claim live provider submission, indexing, rankings, LLM surfacing, or external citations.

| Validator / Test | Command | Severity | What It Proves |
|---|---|---:|---|
| Static/public site integrity | `npm run validate:pnp-phase` | HARD FAIL | Required files, metadata, internal links, sitemap coverage, legal identity, queue/manifest integrity, and validator purity remain intact |
| 100K fanout integrity | `npm run validate:max-fanout` | HARD FAIL | Exactly 100K unique planning queries, valid compressed shards, declared service-area geography only, and no page-quota conflation |
| Authority lifecycle | `npm run validate:authority-scale` | HARD FAIL | Operational window/backlog exist, Twin is disabled, admitted/frozen counts align, no unauthorized frozen drift, and starting velocity law is intact |
| KPI truth | `npm run validate:kpi-truth` | HARD FAIL | Indexation, visibility, LLM surfacing, references, and verified citations remain separate evidence-backed metrics |
| Citation/yield contract | `npm run validate:yield` | HARD FAIL | 100K/180-day target remains a non-guaranteed objective; Twin scope is correct; UNKNOWN evidence cannot upshift velocity |
| Page-quality contract | `npm run validate:page-quality` | HARD FAIL | Governed query entries have answer-first, substantive, internally linked content fields rather than thin page shells |
| Twin-learning transfer plan | `npm run validate:improvements` | HARD FAIL | Existing pages are prioritized for evidence-driven improvements without installing Twin infrastructure |
| Territory health | `npm run validate:territories` | HARD FAIL | Porch, party, hotel-room, and grazing authority territories each retain meaningful public surface depth |
| Distribution contract | `npm run validate:distribution-contract` | HARD FAIL | Sitemap, priority/batch submission inputs, validated workflow ordering, and evidence upload wiring remain aligned |
| Search intelligence truth | `npm run search:intelligence && npm run validate:search-intelligence` | RELEASE PROOF | Builds a non-publishing baseline snapshot, distinguishes live search observation from Google rank, marks unavailable/degraded providers honestly, and prepares bounded same-query retest candidates |
| Full-cycle repeatability | `npm run authority:cycle` twice with fixed run date | RELEASE PROOF | Deterministic authority artifacts reproduce without duplicate publication or unexplained mutation |
| Frozen-output tamper test | adversarial test during artifact build | RELEASE PROOF | A frozen page changed outside mutation scope is detected and rejected |
| Velocity gate test | isolated synthetic evidence test | RELEASE PROOF | Healthy evidence permits one-tier upshift; explicit failure downshifts; UNKNOWN holds |

## Execution commands

- `npm run authority:cycle` — governed daily authority loop.
- `npm run authority:publish` — publishes only enriched queued entries inside the remaining evidence-gated daily budget.
- `npm run distribution:prepare` — builds validated distribution inputs only; it does not contact providers.
- `npm run search:intelligence` — builds a non-publishing search-intelligence baseline; live provider checks run only when the required credentials and explicit live flags are present.
- `.github/workflows/deploy-distribution.yml` — validates first, then submits IndexNow/GSC when configured and uploads receipts.

## Non-negotiable truth rules

- 100K opportunities are not 100K public pages.
- Page count is not citation count.
- Search impressions are not citations.
- LLM mentions are not necessarily linked citations.
- Verified citations require explicit evidence.
- No city/service-area expansion beyond declared service truth.
- Twin Agent is absent from this repo by design.
