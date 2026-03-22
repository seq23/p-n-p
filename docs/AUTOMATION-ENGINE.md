# Porch & Party Automation Engine

This repo contains a lightweight static publishing engine for local-intent and extractable answer pages.

## Current automated page families
- FAQ / answer pages
- Local-intent pages
- Seasonal pages
- Hub pages

## Source-of-truth files
- `data/offers/services.json`
- `data/service_areas/areas.json`
- `data/faqs/faqs.json`
- `data/queries/query_universe.json`
- `data/publish_queue/publish_queue.json`

## Build flow
1. Update approved entries in `data/queries/query_universe.json`
2. Run `npm run build:all`
3. Run `npm run validate:all`
4. Review generated pages
5. Deploy

## Publish queue
The queue file tracks whether an entry is queued or already published. The current repo keeps the first approved batch marked as published.
