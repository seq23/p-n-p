#!/usr/bin/env node
/**
 * favicon.ico returned 404 on porchandparty901.com until 2026-10-11. Hard-fails when
 * any icon file is missing or malformed, the manifest does not name a 192 and a 512
 * icon that exist, the template stops rendering the shared link block, or any
 * published page lacks the icon and manifest links.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const { MARKER, ICON_FILES } = createRequire(import.meta.url)(path.join(ROOT, 'scripts/lib/site_icons.js'));
const errors = [];
const fail = (m) => errors.push(m);
const pngSize = (b) => (b.slice(1, 4).toString() === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null);

for (const f of ICON_FILES) if (!fs.existsSync(path.join(ROOT, f))) fail(`${f} is missing`);
if (!errors.length) {
  const ico = fs.readFileSync(path.join(ROOT, 'favicon.ico'));
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) < 1) fail('favicon.ico is not an ICO file');
  const touch = pngSize(fs.readFileSync(path.join(ROOT, 'apple-touch-icon.png')));
  if (!touch || touch[0] !== 180 || touch[1] !== 180) fail(`apple-touch-icon.png is ${touch} not 180x180`);
  let man;
  try { man = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.webmanifest'), 'utf8')); } catch (e) { fail(`site.webmanifest does not parse: ${e.message}`); }
  if (man) {
    if (!man.name || !man.start_url) fail('site.webmanifest lacks name or start_url');
    for (const want of ['192x192', '512x512']) {
      const icon = (man.icons || []).find((i) => i.sizes === want);
      if (!icon) { fail(`site.webmanifest has no ${want} icon`); continue; }
      const file = path.join(ROOT, icon.src.replace(/^\//, ''));
      const dim = fs.existsSync(file) ? pngSize(fs.readFileSync(file)) : null;
      if (!dim || `${dim[0]}x${dim[1]}` !== want) fail(`${icon.src} is missing or not ${want}`);
    }
  }
}
if (!fs.readFileSync(path.join(ROOT, 'templates/page-shell.js'), 'utf8').includes('${siteIcons.HEAD_ICON_LINKS}')) fail('templates/page-shell.js no longer renders siteIcons.HEAD_ICON_LINKS');

const SKIP = new Set(['node_modules', 'dist', 'scripts', 'data', 'reports', 'artifacts', 'docs', 'tests', 'fixtures', 'config', 'content', 'templates']);
let pages = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(abs); continue; }
    if (!e.name.endsWith('.html')) continue;
    const html = fs.readFileSync(abs, 'utf8');
    if (!/<\/head>/i.test(html)) continue;
    pages += 1;
    const head = html.slice(0, html.search(/<\/head>/i));
    if (!head.includes(MARKER) || !/<link rel="icon" href="\/favicon\.ico"/.test(head) || !/<link rel="manifest" href="\/site\.webmanifest">/.test(head)) {
      fail(`${path.relative(ROOT, abs)} lacks the favicon/manifest links in <head> (run npm run icons:install)`);
    }
  }
})(ROOT);
if (pages === 0) fail('zero pages with a <head> found');

if (errors.length) { console.error(`site-icons: FAIL (${errors.length})`); errors.slice(0, 15).forEach((e) => console.error(`  - ${e}`)); process.exit(1); }
console.log(`site-icons: OK - ${ICON_FILES.length} icon files valid; ${pages} pages carry the icon + manifest links`);
