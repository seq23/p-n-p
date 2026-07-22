# Porch & Party Day-0 Operator Guide

This repo is the static website for Porch & Party at `porchandparty901.com`.

## What This Repo Does

- Publishes local-service authority pages for porch decorating, party decor, hotel-room decor, grazing-table styling, events, comparisons, guides, and Memphis-area pages.
- Uses JSON source files under `data/` to rebuild generated pages and the sitemap.
- Keeps the public quote path at `/contact.html`.
- Keeps public identity consistent: `Porch & Party`, `Kerseta LLC`, and `hello@porchandparty901.com`.

## Normal Weekly Rhythm

1. Review one published page or one queued page from `data/publish_queue/publish_queue.json`.
2. If content source data changed, run `npm run build:all`.
3. Run `npm run validate:pnp-phase`.
4. Review changed pages before packaging or deploying.
5. Mirror one service theme in a social caption or Google Business Profile update if fresh media is available.

## Validation Rules

Validation checks contracts. It does not publish pages, submit URLs, run distribution, install dependencies, or self-heal source files.

Use:

```bash
npm run validate:pnp-phase
```

Hard failures are limited to important breakage: broken files, links, metadata, sitemap drift, malformed JSON/JSON-LD, missing public identity, missing core service-family surfaces, queue/manifest contract breakage, mutating validation profiles, or artifact tree pollution.

## Publishing And Repair

- `npm run publish:queue` is an execution command. It changes queue and manifest state.
- `npm run build:all` is an execution command. It rebuilds generated pages and sitemap surfaces.
- Do not place build or publish commands inside validation scripts.
- If the queue is empty because all approved items are already published, that is not a failure.

## External AI Agent Runs

This repo does not currently have an external AI agent artifact lane.

Do not add loose agent artifacts to root. If a future agent lane is added, define the raw, normalized, processed, and receipt directories in `data/ops/pnp_local_authority_contract.json` before enabling validators for it.
