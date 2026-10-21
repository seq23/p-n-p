#!/usr/bin/env node
/**
 * The edge-cache rule for public HTML (scripts/cloudflare/ensure_html_cache.mjs)
 * can never cache a Function route, and can never pin a page in a browser.
 *
 * Hard-fails when:
 *   - any top-level route under functions/ (today /admin, /api/, /request, /r/) is not
 *     excluded by the rule; the list is derived from the directory, so adding a
 *     Function without excluding it fails here, not in production;
 *   - the rule's expression does not carry every excluded prefix, is not
 *     limited to GET on the apex host, or does not cache;
 *   - the edge TTL is missing or over one hour (a deploy must reach visitors
 *     without a purge step), or the browser TTL does not respect origin;
 *   - a root functions/_middleware.* exists (it would put a Function in front
 *     of every public page);
 *   - a _routes.json sends public paths to Functions;
 *   - _headers gives /* or HTML a browser max-age above 0.
 * Fails on zero Function routes found (the derivation reached nothing).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULE, UNCACHED_PREFIXES, EDGE_TTL_SECONDS, ZONE } from '../cloudflare/ensure_html_cache.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const errors = [];
const fail = (m) => errors.push(m);

const fnDir = path.join(ROOT, 'functions');
const routes = fs.readdirSync(fnDir, { withFileTypes: true })
  .filter((e) => !e.name.startsWith('_'))
  .map((e) => (e.isDirectory() ? `/${e.name}/` : `/${e.name.replace(/\.(m?js|ts)$/, '')}`));
if (!routes.length) fail('found 0 Function routes under functions/; the derivation reached nothing');
for (const r of routes) {
  const covered = UNCACHED_PREFIXES.some((p) => r.startsWith(p) || p.startsWith(r.replace(/\/$/, '')));
  if (!covered) fail(`Function route ${r} is not excluded from the edge-cache rule (add it to UNCACHED_PREFIXES)`);
}
for (const p of UNCACHED_PREFIXES) if (!RULE.expression.includes(`not starts_with(http.request.uri.path, "${p}")`)) fail(`rule expression does not exclude ${p}`);
if (!RULE.expression.includes(`http.host eq "${ZONE}"`) || !RULE.expression.includes('http.request.method eq "GET"')) fail('rule is not limited to GET on the apex host');
const ap = RULE.action_parameters || {};
if (RULE.action !== 'set_cache_settings' || ap.cache !== true) fail('rule does not cache');
if (!ap.edge_ttl || ap.edge_ttl.mode !== 'override_origin' || !(ap.edge_ttl.default > 0) || ap.edge_ttl.default > 3600 || ap.edge_ttl.default !== EDGE_TTL_SECONDS) fail('edge TTL must override origin, be > 0 and <= 3600 s');
if (!ap.browser_ttl || ap.browser_ttl.mode !== 'respect_origin') fail('browser TTL must respect origin (max-age=0), or the zone Browser Cache TTL pins old pages');
for (const f of fs.readdirSync(fnDir)) if (/^_middleware\./.test(f)) fail(`functions/${f} would run a Function on every public page`);
const routesJson = path.join(ROOT, '_routes.json');
if (fs.existsSync(routesJson)) {
  const inc = JSON.parse(fs.readFileSync(routesJson, 'utf8')).include || [];
  for (const i of inc) if (!routes.some((r) => i.startsWith(r.replace(/\/$/, '')))) fail(`_routes.json includes ${i}, a public path, in Functions`);
}
const headers = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
for (const block of headers.split(/\n(?=\S)/)) {
  const [pattern, ...lines] = block.split('\n');
  if (!/^(\/\*|\/\*\.html|\/)\s*$/.test(pattern.trim())) continue;
  for (const l of lines) { const m = /max-age=(\d+)/i.exec(l); if (m && Number(m[1]) > 0) fail(`_headers gives ${pattern.trim()} max-age=${m[1]}`); }
}

if (errors.length) {
  console.error(`edge-cache-rule: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`edge-cache-rule: ${routes.length} Function route(s) (${routes.join(', ')}) excluded; public HTML edge TTL ${EDGE_TTL_SECONDS}s, browser TTL from origin`);
