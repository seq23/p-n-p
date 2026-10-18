#!/usr/bin/env node
/**
 * Re-render every public page that reads data/rentals/games.json, in the order the site's
 * post-generation passes need (README; ~/.claude memory "p-n-p regenerate pages order"):
 *   generators (rentals page, llms rentals sections, request.html, section indexes, brand surfaces)
 *   -> normalize:public-urls -> clarity:install -> related navigation (changed pages)
 *   -> icons:install -> porch:install -> chrome:install -> build:sitemap
 * then re-freeze exactly the frozen pages that changed (scoped, never a blanket freeze) and
 * restore the mutation scope file. Fails if frozen_outputs status shows any unscoped drift.
 *
 * Run by the Inventory Publish workflow after scripts/inventory/apply_publish.mjs, and by hand
 * after editing data/rentals/games.json (`npm run inventory:regenerate`).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const node = (...args) => run(process.execPath, args);
const SCOPE = path.join(ROOT, 'data/release/active_mutation_scope.json');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/release/frozen_output_registry.json'), 'utf8'));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.pages-output', 'reports', '.build', 'data', 'scripts', 'functions', 'workers', 'migrations', 'templates'].includes(e.name) && dir === ROOT) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(html|txt|xml)$/.test(e.name)) out.push(path.relative(ROOT, p));
  }
  return out;
}
const snapshot = () => Object.fromEntries(walk(ROOT).map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex')]));

const before = snapshot();
node('scripts/generators/build_rentals_page.js');
node('scripts/generators/build_llms_rentals.js');
node('scripts/generators/build_request_pages.js');
node('scripts/generators/build_section_indexes.js');
node('scripts/install_brand_surfaces.js');
node('scripts/normalize_public_urls.js');
node('scripts/install_clarity.js');
const mid = snapshot();
const changedHtml = Object.keys(mid).filter((f) => f.endsWith('.html') && mid[f] !== before[f]);
if (changedHtml.length) node('scripts/build_related_navigation.js', '--write', `--only=${changedHtml.join(',')}`);
node('scripts/install_site_icons.js');
node('scripts/install_porch_packages.js');
node('scripts/install_site_chrome.js');
node('scripts/generators/update_sitemap.js');
const after = snapshot();
const changed = Object.keys(after).filter((f) => after[f] !== before[f]);

// Re-freeze only the frozen pages this change touched.
const frozenChanged = REGISTRY.pages.filter((p) => changed.includes(p.rendered_file));
const scopeBefore = fs.readFileSync(SCOPE, 'utf8');
if (frozenChanged.length) {
  const scope = JSON.parse(scopeBefore);
  scope.routes = [...new Set([...(scope.routes || []), ...frozenChanged.map((p) => p.route)])];
  fs.writeFileSync(SCOPE, `${JSON.stringify(scope, null, 2)}\n`);
  try { node('scripts/authority_scale/frozen_outputs.mjs', 'freeze'); } finally { fs.writeFileSync(SCOPE, scopeBefore); }
}
const status = JSON.parse(node('scripts/authority_scale/frozen_outputs.mjs', 'status'));
const drift = (status.unscoped_drift ?? (status.summary && status.summary.unscoped_drift)) ?? (status.drift || []).length;
fs.mkdirSync(path.join(ROOT, '.build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.build/inventory-changed.txt'), changed.map((f) => `${f}\n`).join(''));
console.log(JSON.stringify({ changed, refrozen: frozenChanged.map((p) => p.route), unscoped_drift: drift }, null, 2));
if (drift) { console.error('inventory:regenerate: frozen outputs drifted outside the scope'); process.exit(1); }
