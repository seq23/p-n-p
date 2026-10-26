# CLAUDE.md — p-n-p (porchandparty901.com)

Repo authority for any agent working here. `AGENTS.md` holds the operating law
(exact repo/worktree/branch locking, `work/*` isolation, exact-SHA checks before
merge); `REPO_IDENTITY.md` holds the one public domain this repository owns.
Read both. This file holds the rules an agent most often breaks.

## Cost: nothing paid

**Nothing paid.** No model call, search provider call or probe in this repository
may cost money. `config/llm_routing.json` carries `max_cost_usd: 0` and a list of
$0-only models; every model call goes through `scripts/llm/free_router.mjs`, which
refuses a paid fallback and throws on a non-zero reported cost. The two historical
paid probes (`scripts/llm_citation_probe.mjs`,
`scripts/search_intelligence/observe_live_search.mjs`) are declared paid lanes:
dispatch-only, gated by a `confirm_paid` input defaulting to false, and they print
the named stop `PAID_LANE_REFUSED` without `CONFIRM_PAID`.

The full policy, what used to be paid, and how to refresh the free model list are
in **[`docs/cost/zero-paid-llm.md`](docs/cost/zero-paid-llm.md)**.

The guard is `npm run validate:zero-paid-llm`, which runs inside
`npm run validate:release` on every pull request. It reads this file and that
document, so the rule is not a wish: delete either, or drop the "nothing paid"
line above, and the validator fails.

## Working here

- Regenerate pages in order: generator → normalize → clarity → related-nav →
  icons → chrome → sitemap → refreeze, or just `npm run validate:release`.
- Never hand-edit generated pages. Fix the generator, template or data file; the
  next build overwrites anything else.
- The owner-facing `/admin` console is operated by a non-technical person. Keep it
  calm: plain words, one decision per screen, nothing hidden behind jargon.
- Every fix lands with a registered validator in `scripts/validators/` or
  `scripts/validation/`, wired into `package.json` and reached by
  `npm run validate:release`.
