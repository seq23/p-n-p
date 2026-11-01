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
