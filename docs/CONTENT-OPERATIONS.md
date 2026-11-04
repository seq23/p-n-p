# Content Operations — Porch & Party

## Build rules
- Only publish from the approved query universe
- Keep local pages genuinely distinct
- Avoid duplicative city stuffing
- Keep answer-first sections near the top of each page
- Every generated page must link back to the most relevant service page and the quote path

## Review rules
- Spot-check page titles, H1s, and canonicals monthly
- Spot-check whether pages remain factually aligned with current pricing and service scope
- Remove or rewrite any page that drifts into unsupported claims or generic filler

## Publish cadence
- Weekly build / validate cadence
- Monthly audit cadence
- No daily bulk publishing
- The queue may have zero unpublished items when every approved query-universe item has already shipped
- New pages publish at `new_pages_per_week` from `data/cadence/policy.json` (1 today): `npm run authority:publish` takes the tighter of the daily ceiling, that rate over the trailing seven days, and the cadence gate's own headroom

## From the demand backlog to a page
- Validated queries wait in `backlog_validated_not_yet_built` in `data/demand/measured_demand.json`
- Each row gets a `build` link: `covered_by` (a published page that already answers it, plus `why`) or `page` (the `folder/slug` of a draft written into `data/queries/query_universe.json`)
- Writing the draft is the approval step: it lands in the approved query universe only through a reviewed, merged PR
- `npm run authority:backlog:promote` queues drafted rows and prints `NAMED STOP BACKLOG_AWAITING_DRAFT` for rows with no link
- The daily cycle publishes queued drafts one per cadence week, relinks the pages whose related list names the new page under an exact mutation scope, and freezes them
- `npm run validate:backlog-reaches-builder` fails when a row older than 7 / `new_pages_per_week` days has no build attempt

## Self-heal boundary
- Validation may identify missing queue, manifest, sitemap, or static-file contract issues
- Validation must not change source files
- Safe repairs should be run as explicit operator actions after reviewing the exact failure
- Pricing, offer scope, public claims, real-project image claims, and external provider submissions require operator review

## Page-quality consolidation (4 Nov 2026)

`data/search_intelligence/page_quality_kept.json` records the 34 reviewed sitemap
URLs and 66 newly redirected pages. All service, menu, booking, operational and
legal pages stay. Locality variants now use the relevant service hub; `/areas/`
lists coverage, travel terms and service links without a page per city/service.
The existing hub-consolidation registry owns redirects and generator exclusions.
The release gate checks exact kept-ledger membership, direct published redirect
targets and absence of retired pages/links. Admission and territory floors follow
the reviewed kept set, with zero-items failures retained.

The supplied temporary `page-shape.md` was unavailable on resume. The implemented
shape follows the task brief: authored answer-first definitions, question headings,
visible FAQ, lists/tables, linked business source terms, a business publisher byline,
content-based dates and one next-step section. No new blocking wording validator.
Legacy source pages receive definitions from `data/content/definition_leads.json`
through `scripts/retrofit_definition_leads.js`; generated pages use their templates.
