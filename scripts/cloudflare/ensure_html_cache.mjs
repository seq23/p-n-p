#!/usr/bin/env node
/**
 * Public HTML is served from the Cloudflare edge cache, not fetched from Pages
 * on every request.
 *
 * Why (Ahrefs Site Audit, 20 Oct 2026: "Slow page" on 4 pages). Every HTML
 * response answered `cf-cache-status: DYNAMIC`: Pages sends
 * `Cache-Control: public, max-age=0, must-revalidate` and the zone's default
 * cache level never stores HTML, so each request (crawler or visitor) went to
 * the Pages origin. No Function runs on content pages (functions/ holds
 * /admin, /api/, /request and /r/; there is no root _middleware, see
 * scripts/validators/validate_admin_noindex.mjs), so the fix is one zone Cache
 * Rule in the http_request_cache_settings phase.
 *
 * The rule (idempotent; found by its ref and updated in place):
 *   - caches GET requests on the apex host for every path EXCEPT the Function
 *     routes (/admin, /api/, /request, /r/) and /cdn-cgi/, so Valerie's /admin,
 *     the quote/booking form and its availability API, and the short-link
 *     redirects are never cached;
 *   - edge TTL 10 minutes, overriding Pages' max-age=0: a deploy reaches every
 *     visitor within 10 minutes with no purge step;
 *   - browser TTL respects origin (max-age=0), so the zone's 4-hour Browser
 *     Cache TTL can never pin an old page in a visitor's browser.
 * Guarded by scripts/validators/validate_edge_cache_rule.mjs, which derives the
 * excluded paths from functions/ so a new Function route cannot be cached.
 *
 *   CLOUDFLARE_API_TOKEN=... node scripts/cloudflare/ensure_html_cache.mjs
 *   (from the owner's Mac: the vault injects the token; it is never typed)
 */
import { pathToFileURL } from 'node:url';

export const ZONE = 'porchandparty901.com';
export const EDGE_TTL_SECONDS = 600;
export const UNCACHED_PREFIXES = ['/admin', '/api/', '/request', '/r/', '/cdn-cgi/'];

export const RULE = {
  ref: 'public_html_edge_cache',
  description: 'Public pages from the edge cache, 10 min; never /admin, /api/, /request, /r/, /cdn-cgi/ (scripts/cloudflare/ensure_html_cache.mjs)',
  expression: `(http.host eq "${ZONE}" and http.request.method eq "GET" and ${UNCACHED_PREFIXES.map((p) => `not starts_with(http.request.uri.path, "${p}")`).join(' and ')})`,
  action: 'set_cache_settings',
  action_parameters: {
    cache: true,
    edge_ttl: { mode: 'override_origin', default: EDGE_TTL_SECONDS },
    browser_ttl: { mode: 'respect_origin' },
  },
  enabled: true,
};

async function main() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) { console.error('NAMED STOP: CLOUDFLARE_API_TOKEN is not set'); process.exit(2); }
  const api = async (method, path, body) => {
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    if (!json.success) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json.errors)}`);
    return json.result;
  };
  const [zone] = await api('GET', `/zones?name=${ZONE}`);
  if (!zone) { console.error(`zone ${ZONE} not visible to this token`); process.exit(1); }
  const phase = `/zones/${zone.id}/rulesets/phases/http_request_cache_settings/entrypoint`;
  let ruleset;
  try {
    ruleset = await api('GET', phase);
  } catch (e) {
    if (!/404|10003/.test(String(e.message))) throw e;
    ruleset = await api('PUT', phase, { rules: [RULE] });
    console.log(`${RULE.ref}: cache-settings entrypoint created with the rule`);
    return;
  }
  const existing = (ruleset.rules || []).find((r) => r.ref === RULE.ref);
  if (existing) {
    await api('PATCH', `/zones/${zone.id}/rulesets/${ruleset.id}/rules/${existing.id}`, RULE);
    console.log(`${RULE.ref}: rule ${existing.id} updated`);
  } else {
    const out = await api('POST', `/zones/${zone.id}/rulesets/${ruleset.id}/rules`, RULE);
    const added = out.rules.find((r) => r.ref === RULE.ref);
    console.log(`${RULE.ref}: rule ${added && added.id} added`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
