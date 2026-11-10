# Repo Validation Matrix — Porch & Party 901

Status: ACTIVE — AUTHORITY SCALE STANDARD 2026-07-24

## Canonical release gate

`npm run validate:release`

This is the required structural/repository release gate. It does not claim live provider submission, indexing, rankings, LLM surfacing, or external citations.

| Validator / Test | Command | Severity | What It Proves |
|---|---|---:|---|
| Migrations keep their data (owner, 2026-11-01) | `npm run validate:migrations-keep-data` | HARD FAIL | No new or changed migration drops a table or column, deletes every row, truncates, or rebuilds a table without one of its columns unless it carries `-- destructive-ok: <reason> (backed up: <where>)`; history grandfathered; 31-check self-test |
| Zero paid LLM (owner policy 2026-10-11) | `npm run validate:zero-paid-llm` | HARD FAIL | config/llm_routing.json lists only $0 models with a snapshot date and max_cost_usd 0; no model/provider call outside scripts/llm/free_router.mjs or a declared paid lane; no scheduled workflow reaches a paid lane; paid lanes are dispatch-only behind confirm_paid and refuse without it; router never falls back to paid and fails on a reported cost |
| Static/public site integrity | `npm run validate:pnp-phase` | HARD FAIL | Required files, metadata, internal links, sitemap coverage, legal identity, queue/manifest integrity, and validator purity remain intact |
| KPI truth | `npm run validate:kpi-truth` | HARD FAIL | Indexation, visibility, LLM surfacing, references, and verified citations remain separate evidence-backed metrics |
| No internal instruction leak | `npm run validate:no-instruction-leak` | HARD FAIL | No published page renders external-agent build directives (`FILEPATH:`, `\|\| CURRENT/MISSING/EDIT:`, citation-ready update text) as reader-facing copy |
| Content pattern contract | `npm run validate:content-pattern` | HARD FAIL | Every published page carries a direct answer, an h1 that carries the query, no empty table cells, and one quote-request conversion path; coverage for checklist, comparison table, concrete numbers, named sources, FAQ and JSON-LD is measured and reported |
| Internal links resolve | `npm run validate:internal-links` | HARD FAIL | Every internal href resolves to a published file, counting clean URLs (`<path>.html`), directory indexes and `_redirects` sources. Fails if the scan finds no HTML or no hrefs |
| LLM surfaces, legal and disclosure (restored 10 Nov 2026) | `npm run validate:llm-surfaces` | HARD FAIL | No page or llms file says "insured"; Kerseta named only on the Terms and the Privacy Policy; the Terms keep "Reply STOP to opt out" and "Message and data rates may apply"; the Privacy Policy keeps #privacy-choices with the Clarity opt-out; every page links the Privacy Policy |
| Clarity scope (restored 10 Nov 2026) | `npm run validate:clarity-scope` | HARD FAIL | Clarity records only on form/checkout pages; the installer removes legacy tags and stays idempotent |
| Page dates (restored 10 Nov 2026) | `npm run validate:page-dates` | HARD FAIL | Every visible date is one the page's structured data states, and every stated date is visible |
| Sitemap lastmod (restored 10 Nov 2026) | `npm run validate:sitemap-lastmod` | HARD FAIL | lastmod moves only when content changes, never a run-date stamp; matches the ledger |
| Area-page prices (restored 10 Nov 2026, PART) | `npm run validate:area-pages` | HARD FAIL | Published area pages state the data-file prices; generator output equals a fresh run |
| FAQ prices and travel (restored 10 Nov 2026, PART) | `npm run validate:faq-page` | HARD FAIL | Every $ amount on /faq/ is a real data price; the travel answer names every city and the $75 fee |
| Hotel non-affiliation (restored 10 Nov 2026, PART) | `npm run validate:place-pages` | HARD FAIL | Every hotel anchor page says "Porch & Party is not affiliated with <hotel>" |
| Email links survive the edge (restored 10 Nov 2026, PART) | `npm run validate:link-reachability` | HARD FAIL | Every mailto: anchor and every rendered address sits inside `<!--email_off-->` (no Cloudflare 404 email-protection link) |
| Search-intelligence hostile fixtures | `npm run search:selftest` | RELEASE PROOF | The truth validator actually hard-fails on rank conflation, silent green, non-GSC own-site claims, budget breach, cadence capture, and illegal verified-citation promotion |
| Search-intelligence end-to-end loop | `npm run search:selftest:loop` | RELEASE PROOF | With fixture provider evidence the loop really diagnoses, prepares bounded repairs, retests the same queries, detects before/after change, and emits feedback the existing KPI-truth validator accepts |
| Full-cycle repeatability | `npm run authority:cycle` twice with fixed run date | RELEASE PROOF | Deterministic authority artifacts reproduce without duplicate publication or unexplained mutation |
| Frozen-output tamper test | adversarial test during artifact build | RELEASE PROOF | A frozen page changed outside mutation scope is detected and rejected |
| Velocity gate test | isolated synthetic evidence test | RELEASE PROOF | Healthy evidence permits one-tier upshift; explicit failure downshifts; UNKNOWN holds |

## Execution commands

- `npm run authority:cycle` — governed daily authority loop.
- `npm run authority:publish` — publishes only enriched queued entries inside the remaining evidence-gated daily budget.
- `npm run distribution:prepare` — builds validated distribution inputs only; it does not contact providers.
- `.github/workflows/deploy-distribution.yml` — validates first, then submits IndexNow/GSC when configured and uploads receipts. Runs on `push` to `main`, on `pull_request` targeting `main` (validation only; nothing is distributed from a PR), on `workflow_dispatch`, and by `workflow_run` after each publishing cycle. A GSC URL inspection the provider refuses (quota, credential) is a named `HELD_*` in the receipt and a warning on the run; IndexNow and the sitemap submission are the distribution and are attempted regardless.
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

Page-quality review (4 Nov 2026): `validate:hub-consolidation` holds the sitemap to the nonempty reviewed kept ledger, checks every retired source is absent and redirects directly to a published target, and rejects missing or duplicate sitemap members. `validate:area-pages` and `validate:place-pages` account for every configured locality through its kept page or direct replacement; hotel affiliation/permission negative fixtures remain. Admission and territory floors now require exact reviewed ledger membership. No new wording gate.
