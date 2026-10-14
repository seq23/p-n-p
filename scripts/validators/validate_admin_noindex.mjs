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

if (errors.length) {
  console.error('VALIDATION FAIL: admin console noindex / guard');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`Admin noindex OK: ${announced.length} announcement files carry no admin URL; ${adminRoutes} admin route files all behind the guard.`);
