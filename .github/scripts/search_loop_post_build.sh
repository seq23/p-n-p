#!/usr/bin/env bash
# Search loop (seq23/search-loop), post-build for porchandparty901.com. The engine
# runs this only when it published pages. It folds the new /questions/ pages into
# the site exactly as docs/OPERATIONS.md "Re-rendering a generated page" orders it:
# section indexes (the /questions/ index and the HTML sitemap link every engine
# page, so none is an orphan), porch price links, the business node, the finish
# passes (structured data, icons, contact surface, chrome, social tags, dates),
# sitemap.xml + lastmod, then the frozen-output refreeze. validate:release runs on
# the pushed commit (Deploy Distribution).
set -Eeuo pipefail
npm run build:section-indexes
npm run porch:install
node scripts/install_search_loop_pages.js
# The finish passes read sitemap.xml for the published page list, so the new
# pages enter it first; the second build:sitemap records their final lastmod.
npm run build:sitemap
# The site's related-pages block on each engine page, and inbound links to it from
# related site pages (--link-in), so no engine page is an orphan
# (validate:retrofit-integrity). It reads sitemap.xml, so it runs after the first
# build:sitemap.
pages="$(cd questions 2>/dev/null && ls *.html 2>/dev/null | grep -v '^index.html$' | sed 's#^#questions/#' | paste -sd, -)"
idx="$( [ -f questions/index.html ] && echo questions/index.html || true)"
if [ -n "$pages" ]; then
  if ! node scripts/build_related_navigation.js --write --only="$pages${idx:+,$idx}" --link-in="$pages" > .search-loop-related.json; then
    # An engine page no site page ranks as related still has inbound links: the
    # /questions/ section index (listed on /sitemap), the engine's own "Related
    # questions" block on relevant pages, and IndexNow. That one problem is a note; any other related-nav problem stops.
    node -e '
      const r = JSON.parse(require("fs").readFileSync(".search-loop-related.json", "utf8"));
      const other = (r.problems || []).filter((p) => !/would publish orphaned/.test(p));
      if (r.status !== "FAIL" || other.length || !r.written) { console.error("related navigation failed:", JSON.stringify(other.length ? other : r)); process.exit(1); }
      for (const p of r.problems) console.log("NAMED NOTE [NO_SITE_RELATED_RANK] " + p + " (inbound links: the /questions/ index on /sitemap, the engine Related questions block, IndexNow)");
    '
  fi
  rm -f .search-loop-related.json
fi
# Linking in edits existing (frozen) site pages, so exactly those pages enter the
# mutation scope before the finish passes refreeze (the same open-scope -> freeze
# -> clear-scope the daily authority cycle uses), and the scope is closed after.
routes=$(git status --porcelain -- '*.html' | awk '$1=="M"{print $2}' | sed -E 's#(^|/)index\.html$#\1#; s#\.html$##; s#^#/#')
# shellcheck disable=SC2086 # routes are space-free site paths, one argument each
node scripts/authority_scale/frozen_outputs.mjs prepare-scope $routes
npm run build:finish
npm run build:sitemap
npm run authority:scale:freeze
npm run authority:scale:clear-scope
