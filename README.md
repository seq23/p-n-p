# p-n-p

Static site repo for Porch & Party at porchandparty901.com.

## Public contact path
- Quote page: `/contact.html`
- Form destination: /request (the site's own request form, 18 Oct 2026; the old Google Form https://forms.gle/vHjfKtRRAnGV3HxFA stays as an unlinked fallback)
- Public email: hello@porchandparty901.com
- Phone (call or text): 901-355-1518, `tel:+19013551518` / `sms:+19013551518`
- Google Business Profile: https://www.google.com/maps?cid=1437103205402862394 ("Porch and Party", Maps feature 0x13f19dc04f9ce33a)
- These live in `data/offers/services.json` `contact`; `scripts/install_contact_surface.js` puts them on every page and every LocalBusiness node, and `npm run validate:contact-surface` asserts it. Listing copy for Thumbtack and Bark: `docs/listings/`.
- One business entity (2026-10-16): every page carries exactly one business node, `@id` `https://porchandparty901.com/#business`, with `sameAs` = the Facebook Page + the Maps cid and `hasMap` = the Maps cid; every other node references it by `@id`. Footer links the Facebook Page and "Find us on Google Maps". No street address (service-area business). `npm run validate:business-entity` hard-fails otherwise.

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
| `scripts/normalize_public_urls.js` | the 200-serving form of every self-referential URL | the page's canonical names a redirect, which is what tells Google to index a URL that never serves |

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

## Site navigation (header + footer Rentals link)

One definition: `scripts/lib/site_chrome.js` (owner ruling 2026-10-13: Porch ·
Celebrations · Grazing & Events · Rentals · Pricing · How It Works, then Request a
Quote and Call or text; no Party Planning in the header). Styles:
`assets/css/site-nav.css`. `templates/page-shell.js` renders it natively;
`npm run chrome:install` (in `build:all`) puts it on every published page,
frozen ones included: it proves each frozen change is chrome-only, thaws exactly
those routes, refreezes, and restores the mutation scope. `npm run
validate:site-chrome` (in `validate:pnp-phase`) fails when any page's header
differs. To change the nav: edit `site_chrome.js` and the `RULED` list in the
validator, then run `npm run chrome:install`.

## Public URL form

This origin rewrites requests before it serves them. Verified live on
2026-09-03: `/pricing.html` 308s to `/pricing`, `/index.html` 308s to `/`, and
`/answers` 308s to `/answers/`. So the `.html` form of any page here is a
redirect, and only the extensionless form serves 200.

`scripts/lib/site_url.js` is the single definition of that rule.
`templates/page-shell.js` renders through it, `scripts/generators/update_sitemap.js`
and `scripts/authority_scale/build_distribution_artifacts.mjs` build their URLs
from it, and `scripts/normalize_public_urls.js` — the last pass in `build:all` —
applies it to pages the other producers wrote. `npm run validate:canonical-resolves`
asserts the result, so nothing here is trusted on faith.

**Do not reintroduce a `.html` link or canonical.** Ahrefs scored this site 33
with 331 errors on 2026-09-03, and the single largest item was 219 URLs whose
canonical pointed at a redirect.

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
