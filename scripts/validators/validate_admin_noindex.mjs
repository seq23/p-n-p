#!/usr/bin/env node
/**
 * The /admin invoicing console (docs/admin-console.md) must never be announced
 * to a search or answer engine, and every response it sends must say noindex.
 *
 * 1. sitemap.xml and every llms*.txt carry no /admin or /api/admin URL.
 * 2. Every Functions route file that serves /admin or /api/admin sits under
 *    functions/admin/ or functions/api/admin/, and both directories carry a
 *    _middleware.js that runs the one guard (functions/_lib/guard.mjs). A route
 *    file anywhere else (functions/admin.js, functions/[[all]].js ...) would
 *    reach those URLs around the guard, so it fails here. That covers every
 *    page under /admin, the walk-through checklist (/admin/checklist) included.
 * 3. The guard sets X-Robots-Tag: noindex on every response and refuses
 *    unauthenticated requests outside the sign-in form.
 * 4. The static site has no admin/ directory, and the Pages deploy output never
 *    carries functions/, migrations/, workers/ or wrangler.toml as files.
 *
 * Rule 0: zero route files under the admin directories is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const errors = [];
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ADMIN = /\/(api\/)?admin(\/|\b)/i;

const announced = ['sitemap.xml', ...fs.readdirSync(ROOT).filter((f) => /^llms.*\.txt$/.test(f))];
for (const file of announced) {
  read(file).split('\n').forEach((line, i) => {
    if (ADMIN.test(line)) errors.push(`${file}:${i + 1} announces an admin URL: ${line.trim().slice(0, 120)}`);
  });
}

function walk(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const routeFiles = walk('functions').filter((f) => !f.startsWith(path.join('functions', '_lib')) && /\.(js|mjs|ts)$/.test(f));
const guardedDirs = [path.join('functions', 'admin'), path.join('functions', 'api', 'admin')];
let adminRoutes = 0;
for (const f of routeFiles) {
  const inGuarded = guardedDirs.some((d) => f.startsWith(d + path.sep));
  const rel = f.slice('functions'.length);
  const reachesAdmin = /^[/\\](api[/\\])?admin/.test(rel) || /\[\[?[^\]]+\]\]?/.test(path.basename(f)) && !inGuarded && /^[/\\](api[/\\])?[^/\\]*$/.test(rel);
  if (inGuarded) { if (!/_middleware\./.test(f)) adminRoutes += 1; continue; }
  if (reachesAdmin) errors.push(`${f} can serve /admin or /api/admin outside the guarded directories`);
  if (/_middleware\./.test(f) && path.dirname(f) === 'functions') errors.push(`${f}: a root middleware would wrap the public site; admin guards live in functions/admin and functions/api/admin`);
}
if (adminRoutes === 0) errors.push('no route files under functions/admin or functions/api/admin (Rule 0: the console is missing)');
for (const d of guardedDirs) {
  const mw = path.join(d, '_middleware.js');
  if (!fs.existsSync(path.join(ROOT, mw))) { errors.push(`${mw} is missing: routes there would run without the guard`); continue; }
  const src = read(mw);
  if (!/import\s*\{\s*guard\s*\}\s*from\s*'[./]+_lib\/guard\.mjs'/.test(src) || !/export const onRequest = guard;/.test(src)) {
    errors.push(`${mw} does not export the shared guard as onRequest`);
  }
}

const guard = read('functions/_lib/guard.mjs');
if (!/headers\.set\('X-Robots-Tag', 'noindex, nofollow'\)/.test(guard)) errors.push('functions/_lib/guard.mjs no longer sets X-Robots-Tag: noindex, nofollow');
if (!/isAuthed\(request, env\)/.test(guard)) errors.push('functions/_lib/guard.mjs no longer checks the session');
const publicRules = (guard.match(/\(m, p\) =>/g) || []).length;
if (publicRules !== 2) errors.push(`functions/_lib/guard.mjs has ${publicRules} unauthenticated routes; only GET /admin and POST /admin/login may be open`);

if (fs.existsSync(path.join(ROOT, 'admin'))) errors.push('a static admin/ directory exists; it would publish around the guard');
const assemble = read('scripts/assemble_pages_output.js');
for (const name of ['functions', 'migrations', 'workers', 'wrangler.toml']) {
  if (!new RegExp(`'${name.replace('.', '\\.')}'`).test(assemble.split('const EXCLUDE')[1].split(']);')[0])) {
    errors.push(`scripts/assemble_pages_output.js does not exclude ${name}; its source would be served as static files`);
  }
}

// 5. The private ICS feed (/api/calendar/<token>.ics) is the ONE admin route outside the
//    session guard: Google fetches it with no cookie, so its 64-hex token is the auth. It must
//    stay a single GET/HEAD route file that runs the shared handler, answer noindex, compare
//    the token in constant time, 404 on a wrong token, and never be announced.
const icsFiles = routeFiles.filter((f) => f.startsWith(path.join('functions', 'api', 'calendar') + path.sep));
if (icsFiles.length !== 1 || path.basename(icsFiles[0]) !== '[token].js') errors.push(`functions/api/calendar must hold exactly one route file, [token].js (found: ${icsFiles.join(', ') || 'none'})`);
else {
  const src = read(icsFiles[0]);
  if (!/import \{ handleIcs \} from '\.\.\/\.\.\/_lib\/ics-route\.mjs';/.test(src) || !/export const onRequest = \(context\) => handleIcs\(context\);/.test(src)) errors.push(`${icsFiles[0]} does not just run the shared ICS handler`);
}
const ics = read('functions/_lib/ics-route.mjs');
for (const [re, why] of [
  [/'X-Robots-Tag': 'noindex, nofollow'/, 'the ICS feed does not answer X-Robots-Tag: noindex'],
  [/safeEqual\(m\[1\], token\)/, 'the ICS token is not compared in constant time'],
  [/\^\(\[a-f0-9\]\{64\}\)\\\.ics\$/, 'the ICS route accepts something other than a 64-hex token'],
  [/token\.length !== 64/, 'the ICS route serves when no token is set'],
  [/method !== 'GET' && method !== 'HEAD'/, 'the ICS route accepts methods other than GET/HEAD'],
]) if (!re.test(ics)) errors.push(why);
for (const file of announced) if (/\/api\/calendar/.test(read(file))) errors.push(`${file} announces the private calendar feed`);
{
  const { handleIcs } = await import(new URL('../../functions/_lib/ics-route.mjs', import.meta.url).href);
  const settings = { calendar_token: 'a'.repeat(64) };
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => null }), all: async () => ({ results: Object.entries(settings).map(([key, value]) => ({ key, value })) }) }) };
  const ask = async (tok, method = 'GET') => handleIcs({ request: new Request(`https://porchandparty901.com/api/calendar/${tok}`, { method }), env: { DB: db }, params: { token: tok } });
  const wrong = await ask(`${'b'.repeat(64)}.ics`);
  if (wrong.status !== 404 || wrong.headers.get('X-Robots-Tag') !== 'noindex, nofollow') errors.push(`a wrong ICS token answered ${wrong.status} (want 404, noindex)`);
  if ((await ask('short.ics')).status !== 404) errors.push('a malformed ICS token is not 404');
  if ((await ask(`${'a'.repeat(64)}.ics`, 'POST')).status !== 405) errors.push('the ICS route accepts POST');
  const right = await ask(`${'a'.repeat(64)}.ics`);
  if (right.status !== 200 || right.headers.get('X-Robots-Tag') !== 'noindex, nofollow' || !/text\/calendar/.test(right.headers.get('Content-Type') || '')) errors.push(`the right ICS token answered ${right.status} without noindex text/calendar`);
}

// 6. The daily sheet-resync hook (/api/sync/<token>) is the only other route outside the
//    guard: POST only, a 64-hex token from settings, 404 otherwise, noindex, never announced.
const syncFiles = routeFiles.filter((f) => f.startsWith(path.join('functions', 'api', 'sync') + path.sep));
if (syncFiles.length !== 1 || path.basename(syncFiles[0]) !== '[token].js' || !/export const onRequest = \(context\) => handleSync\(context\);/.test(read(syncFiles[0]))) errors.push('functions/api/sync must hold exactly one [token].js that runs the shared handleSync');
const syncSrc = read('functions/_lib/sync-route.mjs');
for (const [re, why] of [[/'X-Robots-Tag': 'noindex, nofollow'/, 'the sync hook does not answer noindex'], [/safeEqual\(tok, token\)/, 'the sync token is not compared in constant time'], [/!== 'POST'/, 'the sync hook accepts methods other than POST'], [/token\.length !== 64/, 'the sync hook runs when no token is set']]) if (!re.test(syncSrc)) errors.push(why);
for (const file of announced) if (/\/api\/sync/.test(read(file))) errors.push(`${file} announces the sheet-resync hook`);
// The public request form (porchandparty901.com/request): exactly these four routes, each a
// one-line call into functions/_lib/request-submit.mjs, none of them able to reach /admin.
const FORM_ROUTES = {
  [path.join('functions', 'request', 'index.js')]: /export const onRequest = \(context\) => handleRequestPage\(context\);/,
  [path.join('functions', 'request', 'received.js')]: /export const onRequestGet = \(context\) => handleReceived\(context\);/,
  [path.join('functions', 'api', 'request', 'availability.js')]: /export const onRequestGet = \(context\) => handleAvailability\(context\);/,
  [path.join('functions', 'r', '[code].js')]: /export const onRequestGet = \(context\) => handleReferral\(context\);/,
};
for (const [f, re] of Object.entries(FORM_ROUTES)) {
  if (!fs.existsSync(path.join(ROOT, f))) { errors.push(`${f} is missing (the request form route)`); continue; }
  const src = read(f);
  if (!re.test(src) || !/from '(\.\.\/)+_lib\/request-submit\.mjs'/.test(src) || src.split('\n').filter((l) => l.trim()).length !== 2) errors.push(`${f} must be the one-line call into request-submit.mjs`);
}
// The one public inventory route (Settings -> Inventory, 18 Oct 2026): photos by content hash for
// the Inventory Publish workflow. A one-line call into inventory.mjs handlePhoto, which serves only
// image bytes from inventory_photos with X-Robots-Tag: noindex (validate:admin-inventory drives it).
// The inventory publish pipeline's public routes (no admin data): the pending change for the
// Inventory Poll workflow and the workflow's signed report back.
const PHOTO_ROUTES = {
  [path.join('functions', 'api', 'inventory', 'photo', '[sha].js')]: /export const onRequestGet = \(context\) => handlePhoto\(context\);/,
  [path.join('functions', 'api', 'inventory', 'pending.js')]: /export const onRequestGet = \(context\) => handlePending\(context\);/,
  [path.join('functions', 'api', 'inventory', 'report.js')]: /export const onRequestPost = \(context\) => handleReportRoute\(context\);/,
};
for (const [f, re] of Object.entries(PHOTO_ROUTES)) {
  if (!fs.existsSync(path.join(ROOT, f))) { errors.push(`${f} is missing (an inventory publish route)`); continue; }
  const src = read(f);
  if (!re.test(src) || !/from '(\.\.\/)+_lib\/inventory\.mjs'/.test(src) || src.split('\n').filter((l) => l.trim()).length !== 2) errors.push(`${f} must be the one-line call into inventory.mjs`);
}
if (!/const PUBLIC_HEADERS = \{ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' \}/.test(read(path.join('functions', '_lib', 'inventory.mjs')))) errors.push('inventory.mjs pending/report routes must answer no-store + noindex');
if (!/X-Robots-Tag': 'noindex'[\s\S]*SELECT content_type, bytes FROM inventory_photos WHERE sha = \?1/.test(read(path.join('functions', '_lib', 'inventory.mjs')))) errors.push('inventory.mjs handlePhoto must answer noindex and read only inventory_photos by sha');
// The owner feed for Boss OS (22 Oct 2026): token-guarded (Bearer OWNER_FEED_TOKEN, 401 otherwise),
// read-only, no-store + noindex; validate:owner-feed holds its behaviour.
const FEED_ROUTES = { [path.join('functions', 'api', 'owner-feed.js')]: /export const onRequest = \(context\) => handleOwnerFeed\(context\);/ };
for (const [f, re] of Object.entries(FEED_ROUTES)) {
  if (!fs.existsSync(path.join(ROOT, f))) { errors.push(`${f} is missing (the owner feed route)`); continue; }
  const src = read(f).split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).join('\n');
  if (!re.test(src) || !/from '\.\.\/_lib\/owner-feed\.mjs'/.test(src) || src.split('\n').length !== 2) errors.push(`${f} must be the one-line call into owner-feed.mjs`);
}
if (!/'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow'/.test(read(path.join('functions', '_lib', 'owner-feed.mjs'))) || !/return deny\(401, 'unauthorized'\)/.test(read(path.join('functions', '_lib', 'owner-feed.mjs')))) errors.push('owner-feed.mjs must answer no-store + noindex and 401 without the token');
const outside = routeFiles.filter((f) => !guardedDirs.some((d) => f.startsWith(d + path.sep)));
// The holiday office outreach API for Boss OS (30 Oct 2026): token-guarded (Bearer PNP_OUTREACH_TOKEN,
// 401 otherwise), no-store + noindex; validate:corporate-outreach holds its behaviour.
const OUTREACH_ROUTES = {
  [path.join('functions', 'api', 'outreach', 'send.js')]: /export const onRequest = \(context\) => handleOutreach\(context, 'send'\);/,
  [path.join('functions', 'api', 'outreach', 'status.js')]: /export const onRequest = \(context\) => handleOutreach\(context, 'status'\);/,
};
for (const [f, re] of Object.entries(OUTREACH_ROUTES)) {
  if (!fs.existsSync(path.join(ROOT, f))) { errors.push(`${f} is missing (the outreach route)`); continue; }
  const src = read(f);
  if (!re.test(src) || !/from '\.\.\/\.\.\/_lib\/outreach\.mjs'/.test(src) || src.trim().split('\n').length !== 2) errors.push(`${f} must be the one-line call into outreach.mjs`);
}
{ const o = read(path.join('functions', '_lib', 'outreach.mjs'));
  if (!/'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow'/.test(o) || !/reason: 'Unauthorized\.' \}, 401\)/.test(o) || !/tokenMatches\(token\[1\], env\.PNP_OUTREACH_TOKEN\)/.test(o)) errors.push('outreach.mjs must answer no-store + noindex and 401 without PNP_OUTREACH_TOKEN'); }
for (const f of outside) if (![...icsFiles, ...syncFiles, ...Object.keys(FORM_ROUTES), ...Object.keys(PHOTO_ROUTES), ...Object.keys(FEED_ROUTES), ...Object.keys(OUTREACH_ROUTES)].includes(f)) errors.push(`${f} is a route outside the guard that is neither the ICS feed, the sync hook, the owner feed, the outreach API nor a request-form route`);

if (errors.length) {
  console.error('VALIDATION FAIL: admin console noindex / guard');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`Admin noindex OK: ${announced.length} announcement files carry no admin URL; ${adminRoutes} admin route files all behind the guard; the private ICS feed answers noindex and 404s a wrong token.`);
