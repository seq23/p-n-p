# Zero paid LLM — p-n-p

Owner policy, 11 Oct 2026: "nothing should be paid … cut the probes and make them free."

## What was paid

| Call site | Ran from | How often | Model | What it did |
|---|---|---|---|---|
| `scripts/llm_citation_probe.mjs` (via `scripts/lib/openrouter_web_search.mjs`) | `authority-daily.yml` step "Observe whether answer engines cite us" | Every day, 15:00 UTC, 25 queries | `openai/gpt-4o-mini` + OpenRouter web plugin (parallel/turbo, billed per web result) | Citation probe: asked whether answer engines cite this site. Observes/scores the loop's own output. |
| `scripts/search_intelligence/observe_live_search.mjs` | `search-intelligence.yml` (manual dispatch, `run_grounded_observation`) | Only when dispatched; 10 queries × 10 results | `openai/gpt-4o-mini` + OpenRouter web plugin | Grounded search observation of target queries. Observes the loop's own output. |

No content generation, rewriting, classification or outreach in this repo calls a model. Page building is template-driven.

## The one capped lane: site pictures

Owner ruling, 24 Nov 2026: "The image generator u r using sucks - use ChatGPT or runware or something that even costs cents"; "the $2 was for all pictures made here or by Noelle for rest of 2026 photos needed for social". The old free Workers AI picture path was removed that day.

- `scripts/generators/build_service_ai_images.mjs` makes the pictures registered in `data/offers/service_ai_images.json` with OpenAI images (default `gpt-image-1-mini`, `--model chatgpt-image-latest` for hard scenes, `--ref` only from her own photos). The key comes from the Boss OS vault (`npm run -s vault:run -- node …`).
- Before every call it reads the shared ledger `~/.boss-os/image-budget-2026.json` (`cap_usd`, `through`, `spent_usd`). It refuses with a named stop and no call when the ledger is missing or unreadable, a number is NaN or negative, the date has passed, or spent plus a conservative estimate would cross the cap. After an answer it adds the real cost from `usage` (the estimate when usage is missing or bad) and writes the ledger atomically. An OpenAI error charges nothing and writes nothing.
- It is declared in `config/llm_routing.json` `budget_lanes`. `validate:zero-paid-llm` fails if any workflow reaches it or its entry runs without a ledger; `validate:image-budget` proves every refusal against a fake OpenAI.

## Now

- **Both probes are off.** Neither is on any schedule. The citation probe moved to `citation-probe.yml`; the grounded observation stays in `search-intelligence.yml`. Both run only when someone dispatches them by hand with `confirm_paid: true`. Any other dispatch is the named stop `PAID_LANE_REFUSED`. The scripts also refuse on their own when `CONFIRM_PAID` is not `true` (exit 0, receipt, no network call).
- **Every other model call goes through the free router**, `scripts/llm/free_router.mjs`. It reads `config/llm_routing.json`, where `max_cost_usd: 0` is a hard policy. The router tries only the $0 models listed there, in order (snapshot dated in the file). It adds OpenRouter `provider.max_price` 0 and never falls back to a paid model. If no free model answers, it returns a named stop and generates nothing. A non-zero `usage.cost`, or an answer from a model that is not on the list, throws and fails the run.
- **The daily cycle checks the router.** `authority-daily.yml` runs `npm run llm:check` every day. It confirms live pricing is still $0 for every configured model, then sends one free ping. Its receipt is the log line `LLM_ROUTER_RECEIPT`. A key that is disabled or invalid gives the named stop `CREDENTIAL_REFUSED`, and the cycle stays green.
- **The guard is `npm run validate:zero-paid-llm`**, part of `validate:release`, which runs on every PR. It checks that the config holds only $0 models. It checks that no model or provider call exists outside the router or a declared paid lane. It checks that no scheduled workflow reaches a paid lane. It checks that paid lanes are dispatch-only and gated by `confirm_paid`. Finally it checks how the router behaves against a stubbed provider.

## Refreshing the free list

Fetch `https://openrouter.ai/api/v1/models` (no key). Keep models where `pricing.prompt == "0" && pricing.completion == "0"` and the context is at least 32k. Choose 3–4 strong instruct models and update `models` and `pricing_snapshot` in `config/llm_routing.json`. If a configured model turns paid, `llm:check` fails loudly.
