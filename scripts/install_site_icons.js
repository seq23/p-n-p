#!/usr/bin/env node
'use strict';
/**
 * Install the favicon / touch-icon / manifest links into every published page
 * that the template does not render (root pages, services, section indexes).
 * Idempotent: a page already carrying the marker is left alone.
 */
const fs = require('fs');
const path = require('path');
const { MARKER, HEAD_ICON_LINKS } = require('./lib/site_icons');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['.git', 'node_modules', '.pages-output', 'dist', 'scripts', 'data', 'reports',
  'artifacts', 'docs', 'tests', 'fixtures', 'config', 'content', 'templates', '.build']);
let touched = 0, already = 0, skipped = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(abs); continue; }
    if (!e.name.endsWith('.html')) continue;
    const html = fs.readFileSync(abs, 'utf8');
    if (html.includes(MARKER)) { already += 1; continue; }
    if (!/<\/head>/i.test(html)) { skipped += 1; continue; }
    fs.writeFileSync(abs, html.replace(/<\/head>/i, `${HEAD_ICON_LINKS}</head>`));
    touched += 1;
  }
})(ROOT);
if (touched + already === 0) { console.error('site-icons: no page with a <head> found'); process.exit(1); }
console.log(`site-icons: installed on ${touched} page(s); ${already} already had it; ${skipped} skipped`);
