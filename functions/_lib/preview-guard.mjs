/**
 * Branch previews (<hash|branch>.p-n-p.pages.dev) run the same Functions and the same bindings
 * (D1 pnp-admin, the pnp-mailer service, R2) as the real site. A design preview must never
 * create a real request, send Valerie an email or change a booking, so on a preview host every
 * request that could write (anything but GET/HEAD/OPTIONS) is refused here, before any Function
 * runs. porchandparty901.com, www and p-n-p.pages.dev are not matched.
 * Behaviour test: scripts/validators/validate_edge_cache_rule.mjs.
 */
const PREVIEW_HOST_RE = /^[a-z0-9-]+\.p-n-p\.pages\.dev$/;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** A 403 Response for a write on a preview host, or null to pass it through. */
export function previewWriteGuard(request) {
  const url = new URL(request.url);
  if (!PREVIEW_HOST_RE.test(url.hostname)) return null;
  if (READ_METHODS.has(request.method)) return null;
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Design preview</title>'
    + '<p style="font:18px/1.5 system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem">This is a design preview, so nothing was sent. '
    + 'To book, use <a href="https://porchandparty901.com/request">porchandparty901.com/request</a>.</p>',
    { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } },
  );
}
