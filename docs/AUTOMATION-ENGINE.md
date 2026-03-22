# Automation Engine — Porch & Party

## Purpose
This repo is designed to support a local discovery system for Porch & Party rather than only a brochure site.

## Core page families
- authority pages
- local pages
- FAQ / answer pages
- seasonal pages
- comparison pages
- guide / problem pages
- event-type pages
- corporate pages
- hub pages

## Source-of-truth files
- `data/offers/services.json`
- `data/service_areas/areas.json`
- `data/queries/query_universe.json`
- `data/clusters/clusters.json`

## Build flow
1. Update source-of-truth files.
2. Run `npm run build:all`.
3. Run `npm run validate:all`.
4. Review changed surfaces.
5. Package a full baseline snapshot.

## Publishing cadence
- weekly build / validation workflow
- monthly audit workflow
- no daily bulk publishing

## Rules
- do not add pages outside the approved query universe
- do not add thin local pages
- keep pricing, disclaimers, and email aligned with the core site
- keep generated pages linked back to the primary service and quote path
