#!/usr/bin/env node
/**
 * One host: www.porchandparty901.com answers with a single 301 to the apex,
 * path and query kept. Canonical tags already name the apex; Ahrefs Site Audit
 * (14 Oct 2026) crawled every page twice because www also answered 200.
 *
 * Pages _redirects cannot match on host, and a root functions/_middleware.js
 * is refused by scripts/validators/validate_admin_noindex.mjs (it would wrap
 * the public site), so the redirect is a zone Redirect Rule in the
 * http_request_dynamic_redirect phase, next to the repository-files rule.
 * Idempotent: the rule is found by its ref and updated in place.
 *
 *   CLOUDFLARE_API_TOKEN=... node scripts/cloudflare/ensure_www_redirect.mjs
 *   (from the owner's Mac: the vault injects the token; it is never typed)
 */
const ZONE = 'porchandparty901.com';
const RULE = {
  ref: 'www_to_apex_301',
  description: 'www.porchandparty901.com -> porchandparty901.com, one 301, path and query kept (scripts/cloudflare/ensure_www_redirect.mjs)',
  expression: '(http.host eq "www.porchandparty901.com")',
  action: 'redirect',
  action_parameters: {
    from_value: {
      status_code: 301,
      preserve_query_string: true,
      target_url: { expression: 'concat("https://porchandparty901.com", http.request.uri.path)' },
    },
  },
  enabled: true,
};

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) { console.error('NAMED STOP: CLOUDFLARE_API_TOKEN is not set'); process.exit(2); }
async function api(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.success) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json.errors)}`);
  return json.result;
}

const [zone] = await api('GET', `/zones?name=${ZONE}`);
if (!zone) { console.error(`zone ${ZONE} not visible to this token`); process.exit(1); }
const phase = `/zones/${zone.id}/rulesets/phases/http_request_dynamic_redirect/entrypoint`;
const ruleset = await api('GET', phase);
const existing = (ruleset.rules || []).find((r) => r.ref === RULE.ref);
if (existing) {
  await api('PATCH', `/zones/${zone.id}/rulesets/${ruleset.id}/rules/${existing.id}`, RULE);
  console.log(`www redirect: rule ${existing.id} updated`);
} else {
  const out = await api('POST', `/zones/${zone.id}/rulesets/${ruleset.id}/rules`, RULE);
  const added = out.rules.find((r) => r.ref === RULE.ref);
  console.log(`www redirect: rule ${added && added.id} added`);
}
