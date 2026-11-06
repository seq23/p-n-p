// Two jobs: p-n-p.pages.dev -> 301 to porchandparty901.com (functions/_lib/host-redirect.mjs),
// and no writes on a branch preview host (functions/_lib/preview-guard.mjs).
// Every other request is handed straight to next(), unchanged; if the check itself throws,
// the request still passes through, so this can never take the real site down.
import { hostRedirect } from './_lib/host-redirect.mjs';
import { previewWriteGuard } from './_lib/preview-guard.mjs';

export async function onRequest(context) {
  let moved = null;
  try { moved = hostRedirect(context.request) || previewWriteGuard(context.request); } catch { moved = null; }
  return moved || context.next();
}
