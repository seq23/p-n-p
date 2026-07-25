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

## Docs
- `docs/AUTOMATION-ENGINE.md`
- `docs/GOOGLE-BUSINESS-PROFILE-CHECKLIST.md`
- `docs/DISTRIBUTION-RUNBOOK.md`
- `docs/CONTENT-OPERATIONS.md`
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
