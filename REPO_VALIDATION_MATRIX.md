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
| No internal instruction leak | `npm run validate:no-instruction-leak` | HARD FAIL | No published page renders external-agent build directives (`FILEPATH:`, `\|\| CURRENT/MISSING/EDIT:`, citation-ready update text) as reader-facing copy |
| No empty table cells | `npm run validate:no-empty-cells` | HARD FAIL | No published page ships a table with empty `<td>`/`<th>` cells, so table columns stay aligned with their headers for extraction |
| Twin-learning transfer plan | `npm run validate:improvements` | HARD FAIL | Existing pages are prioritized for evidence-driven improvements without installing Twin infrastructure |
| Territory health | `npm run validate:territories` | HARD FAIL | Porch, party, hotel-room, and grazing authority territories each retain meaningful public surface depth |
| Distribution contract | `npm run validate:distribution-contract` | HARD FAIL | Sitemap, priority/batch submission inputs, validated workflow ordering, and evidence upload wiring remain aligned |
| Search-intelligence truth contract | `npm run validate:search-intelligence` | HARD FAIL | Grounded observation is never literal SERP rank, Google Search Console remains the own-site performance authority, degraded/unavailable providers cannot produce green status, the free-allowance observation budget is respected, and the search lane cannot write publishing state or join `authority:cycle` |
| Search-intelligence hostile fixtures | `npm run search:selftest` | RELEASE PROOF | The truth validator actually hard-fails on rank conflation, silent green, non-GSC own-site claims, budget breach, cadence capture, and illegal verified-citation promotion |
| Search-intelligence end-to-end loop | `npm run search:selftest:loop` | RELEASE PROOF | With fixture provider evidence the loop really diagnoses, prepares bounded repairs, retests the same queries, detects before/after change, and emits feedback the existing KPI-truth validator accepts |
| Full-cycle repeatability | `npm run authority:cycle` twice with fixed run date | RELEASE PROOF | Deterministic authority artifacts reproduce without duplicate publication or unexplained mutation |
| Frozen-output tamper test | adversarial test during artifact build | RELEASE PROOF | A frozen page changed outside mutation scope is detected and rejected |
| Velocity gate test | isolated synthetic evidence test | RELEASE PROOF | Healthy evidence permits one-tier upshift; explicit failure downshifts; UNKNOWN holds |

## Execution commands

- `npm run authority:cycle` — governed daily authority loop.
- `npm run authority:publish` — publishes only enriched queued entries inside the remaining evidence-gated daily budget.
- `npm run distribution:prepare` — builds validated distribution inputs only; it does not contact providers.
- `.github/workflows/deploy-distribution.yml` — validates first, then submits IndexNow/GSC when configured and uploads receipts.
- `npm run search:cycle` — read-and-prepare search-intelligence loop; publishes nothing and is deliberately outside `authority:cycle`.
- `npm run search:status` — plain-English search-intelligence status; reports provider truth state first.
- `.github/workflows/search-intelligence.yml` — manual dispatch only; the only lane that collects real Google Search Console truth.

## Non-negotiable truth rules

- 100K opportunities are not 100K public pages.
- Page count is not citation count.
- Search impressions are not citations.
- LLM mentions are not necessarily linked citations.
- Verified citations require explicit evidence.
- No city/service-area expansion beyond declared service truth.
- Twin Agent is absent from this repo by design.
- Grounded/generative search observation is never a literal Google SERP rank.
- Only Google Search Console may state own-site Google impressions, clicks, CTR, average position, or indexation.
- A provider that is unavailable or degraded never produces a green search result.
- A passing search-intelligence validator does not mean any provider was reachable.
- Search intelligence never changes the publishing cadence.
