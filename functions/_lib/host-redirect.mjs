/**
 * The production Pages host p-n-p.pages.dev serves the same site as
 * porchandparty901.com. An AI answer engine (6 Nov 2026) cited only the
 * pages.dev copies and "couldn't confirm the business"; the noindex from #190
 * stops new indexing but leaves the old copies cited. Every GET/HEAD on that
 * exact host now answers one 301 to the same path and query on the real domain.
 *
 * Deliberately NOT redirected:
 *   - any other host: porchandparty901.com (the real site, /admin and /api
 *     included) and www (a zone Redirect Rule) pass through untouched;
 *   - branch previews (<hash|branch>.p-n-p.pages.dev): Pages already answers
 *     them noindex, and a preview must show the branch, not production;
 *   - non-GET/HEAD methods: a 301 turns POST into GET, so a caller still
 *     posting to the pages.dev API keeps working instead of losing its body.
 * Behaviour test: scripts/validators/validate_edge_cache_rule.mjs drives the
 * root middleware with real-domain, preview and pages.dev requests.
 */
export const DUPLICATE_HOST = 'p-n-p.pages.dev';
export const CANONICAL_ORIGIN = 'https://porchandparty901.com';

/** The 301 Response for a duplicate-host request, or null to pass it through. */
export function hostRedirect(request) {
  const url = new URL(request.url);
  if (url.hostname !== DUPLICATE_HOST) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  return new Response(null, {
    status: 301,
    headers: { Location: `${CANONICAL_ORIGIN}${url.pathname}${url.search}`, 'Cache-Control': 'public, max-age=86400' },
  });
}
