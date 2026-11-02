# Operations notes

Repo gotchas, moved here from assistant memory on 31 Oct 2026. Email setup is in
[`email-setup.md`](email-setup.md); the admin console in [`admin-console.md`](admin-console.md).

## Re-rendering a generated page
Re-rendering any generated page (section indexes, the rentals page, `build_pages` families) strips
the blocks later passes add. Run the whole chain, in this order, before `validate:release`:

1. the generator
2. `npm run normalize:public-urls`
3. `npm run clarity:install`
4. `node scripts/build_related_navigation.js --write --only=<rel,...>`
5. `npm run icons:install`
6. `npm run porch:install` (re-adds the porch price-article links a section-index re-render strips from `/faq/`)
7. `npm run chrome:install`
8. `npm run build:sitemap`
9. refreeze — the site-chrome installer's own refreeze can fail quietly, so check
   `frozen_outputs.mjs status` yourself.

## Asset caching
The Cloudflare zone's Browser Cache TTL rewrites `Cache-Control` on CSS/JS for porchandparty901.com,
so a `_headers` rule cannot shorten it (it only works on the pages.dev host).
`scripts/assemble_pages_output.js` stamps every `/assets/css` and `/assets/js` link with
`?v=<content hash>` at publish time and fails the build on a link to a missing asset or an
unversioned homepage stylesheet. Source HTML stays unversioned.

## Authority fanout churn on macOS
`npm run authority:cycle` on macOS rewrites all 20 `data/authority_scale/fanout_100k/part-*.jsonl.gz`
shards plus `index.json` with no content change (only the gzip OS byte differs from Linux CI). After
a local validation run, `git checkout -- data/authority_scale/fanout_100k/` before committing. The
real fix is pinning the gzip OS byte and mtime in `scripts/authority_scale/build_max_fanout.mjs`.

## Database migrations

**No migration deletes data by accident** (1 Nov 2026): `npm run validate:migrations-keep-data` (first in `validate:release`) fails a new or changed `migrations/*.sql` that drops a table or column, deletes every row, truncates, or rebuilds a table without one of its columns, unless it carries `-- destructive-ok: <reason> (backed up: <where>)`. Older migrations are grandfathered.

## Admin settings without logging in
Settings rows can be written directly:
`npx wrangler d1 execute pnp-admin --remote --command "INSERT INTO settings(key,value,updated_at) ... ON CONFLICT(key) DO UPDATE ..."`
(keys include `zelle`, `cashapp`, `qr`, `qr_type`, `business_name`, `business_address`, `id_folder_url`).

## Facebook
- The Page is facebook.com/porchandparty901 (the repurposed old Spry Ventures page; never mention
  Spry on it). Launch-post and Marketplace copy live in `docs/listings/`.
- Marketplace holds only the six bundle listings, posted from a personal profile (Pages need
  Commerce Manager); listings are edited in place, never deleted, when prices or photos change.
  Marketplace listings are email-only.

## Schedule
- Every scheduled job, in Central time, is listed in `docs/SCHEDULE.md` (rebalanced 1 Nov 2026).

## Public pages beyond the menu

- **Four service pages:** `/services/porch-decorating`, `/services/celebration-setups`,
  `/services/grazing-and-event-styling` and `/rentals/`. Prices live only in
  `data/offers/services.json`; rental games only in `data/rentals/games.json`.
- **Two search pages kept out of the menu:** `/services/hotel-room-decor-memphis` and
  `/rentals/giant-lawn-games-memphis`. They are not in the header or footer, but they are in the
  sitemap and every suburb page links to them.
- **32 suburb pages** come from `scripts/generators/build_area_pages.js` and
  `data/service_areas/city_profiles.json` (checks: `validate:area-pages`, `validate:service-pages`).
- **Service pictures** are registered in `data/offers/service_ai_images.json` (made by
  `scripts/generators/build_service_ai_images.mjs`, Workers AI, $0); the file's `_why` holds the
  picture rules, and owner photos are registered there by hash too.

## Search loop (shared engine, 1 Nov 2026)
New question pages come from the shared engine `seq23/search-loop@v1`
(`.github/workflows/search-loop.yml`, daily 07:29 CT; config `search-loop.config.json`;
ledger `data/search-loop/`). Pages land in `questions/` and publish straight away; the one
action is the quote request (`/request`); pages never state prices. When the engine
published, `.github/scripts/search_loop_post_build.sh` runs the re-render chain above for
them (section index `/questions/`, business node, related nav + link-in with a mutation
scope, finish passes, sitemap, refreeze). Engine pages are outside the cadence cap
(`scripts/cadence/sitemap_urls.js` reads `output.url_prefix`). A branch run is a proof run:
it uploads `search-loop-pages` and commits nothing. Throttle every site at once with
`gh variable set SEARCH_LOOP_MODE --body slow -R seq23/search-loop`.
