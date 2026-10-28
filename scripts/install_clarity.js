#!/usr/bin/env node
'use strict';
/**
 * Reconcile Microsoft Clarity on form and checkout pages only.
 *
 * The Clarity projects already existed - one per property - but no tag was ever
 * installed, so every project sat on "Almost there!" and none of them recorded a
 * single session. This closes that.
 *
 * The snippet resolves its project id from location.hostname rather than being
 * hardcoded, because some trees serve more than one domain from the same files
 * (spryexecutiveos.com and billionairehighperformancecoach.com are one tree with
 * two separate Clarity projects). A hardcoded id would send one domain's sessions
 * to the other domain's project.
 *
 * Reconcile existing tags too: the former all-page installer left recording on
 * informational pages. Removing a form or checkout removes its tag next build.
 */
const fs = require('fs');
const path = require('path');
const { formOrBuy, stripLoader } = require('./lib/clarity_scope');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'data/clarity_projects.json');
const MARKER = 'data-clarity-loader';

if (!fs.existsSync(CONFIG)) {
  console.error(`clarity: missing ${path.relative(ROOT, CONFIG)}`);
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const projects = cfg.projects || {};
const outDir = path.resolve(ROOT, cfg.public_root || '.');
const skipDirs = new Set([
  ...(cfg.skip_dirs || []),
  '.git', 'node_modules', '.pages-output', 'dist', 'scripts', 'data', 'reports',
  'artifacts', 'docs', 'tests', 'fixtures', 'config', 'content', 'templates',
]);
const skipFiles = new Set(cfg.skip_files || []);

if (!Object.keys(projects).length) {
  console.error('clarity: no projects configured');
  process.exit(1);
}

// One loader for every page. It picks the project by host so a shared tree cannot
// report one domain's sessions under another domain's project.
const snippet = `<script ${MARKER}>(function(w,d,m){var h=(w.location.hostname||"").toLowerCase().replace(/^www\\./,"");var id=m[h];if(!id)return;w.clarity=w.clarity||function(){(w.clarity.q=w.clarity.q||[]).push(arguments)};var s=d.createElement("script");s.async=1;s.src="https://www.clarity.ms/tag/"+id;var f=d.getElementsByTagName("script")[0];f.parentNode.insertBefore(s,f)})(window,document,${JSON.stringify(projects)})</script>`;

let touched = 0;
let already = 0;
let skipped = 0;
let removed = 0;

function walk(dir, depth) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!skipDirs.has(entry.name)) walk(abs, depth + 1); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const rel = path.relative(outDir, abs).replace(/\\/g, '/');
    if (skipFiles.has(rel) || skipFiles.has(entry.name)) { skipped += 1; continue; }
    const html = fs.readFileSync(abs, 'utf8');
    const clean = stripLoader(html);
    if (!formOrBuy(clean)) {
      if (clean !== html) { fs.writeFileSync(abs, clean); removed += 1; }
      else skipped += 1;
      continue;
    }
    // Generators carry the tag in place alongside other head passes. Preserve
    // a current, single tag so rebuilding an index cannot reorder those passes.
    if (html.includes(snippet) && html.split(MARKER).length === 2) { already += 1; continue; }
    if (!/<\/head>/i.test(clean)) { skipped += 1; continue; }
    const next = clean.replace(/<\/head>/i, `${snippet}</head>`);
    if (next === html) { already += 1; continue; }
    fs.writeFileSync(abs, next);
    touched += 1;
  }
}
walk(outDir, 0);

console.log(`clarity: installed on ${touched} form/checkout page(s); ${already} already correct; removed from ${removed} informational page(s); ${skipped} skipped`);
