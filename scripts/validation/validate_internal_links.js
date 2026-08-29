#!/usr/bin/env node
/**
 * Every internal href resolves to a file this repo publishes.
 *
 * WHY THIS WAS RED AND STAYED UNWIRED
 * -----------------------------------
 * This validator existed but nothing ran it, and running it reported 851 broken
 * links. Every one of those was a false positive. The site publishes clean URLs:
 * `/faq/do-party-decorators-come-to-your-house` is served from
 * `faq/do-party-decorators-come-to-your-house.html`, which is how Cloudflare
 * Pages resolves an extensionless request. The original resolver only tried the
 * literal path and `<path>/index.html`, so every clean URL on the site looked
 * broken. A validator that cries wolf on the entire link graph gets left out of
 * validate:all, and then nothing checks links at all - which is exactly what
 * happened.
 *
 * The resolver now tries, in order: the literal path, `<path>.html`, and
 * `<path>/index.html`, plus any source path declared in `_redirects`. With that,
 * the current tree reports zero broken links, so this is safe to gate on.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SKIP = new Set(['.pages-output', 'node_modules', '.git']);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

function redirectSources() {
  const file = path.join(ROOT, '_redirects');
  if (!fs.existsSync(file)) return new Set();
  return new Set(fs.readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0]));
}

const redirects = redirectSources();
const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();

function resolves(from, href) {
  if (!href || /^(https?:|mailto:|tel:|#|javascript:|\/\/)/i.test(href)) return true;
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return true;
  if (redirects.has(clean)) return true;
  const base = clean.startsWith('/')
    ? path.join(ROOT, clean)
    : path.resolve(path.dirname(from), clean);
  return isFile(base) || isFile(`${base}.html`) || isFile(path.join(base, 'index.html'));
}

const files = walk(ROOT);
if (!files.length) {
  console.error('INTERNAL LINKS FAILED: walked the tree and found zero HTML files. The scan is broken, not the site.');
  process.exit(1);
}

const bad = [];
let checked = 0;
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const re = /href=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) {
    checked += 1;
    if (!resolves(file, m[1])) bad.push(`${path.relative(ROOT, file)} -> ${m[1]}`);
  }
}

if (!checked) {
  console.error(`INTERNAL LINKS FAILED: ${files.length} HTML file(s) carried zero href attributes between them. The scan is broken, not the site.`);
  process.exit(1);
}

if (bad.length) {
  console.error(`Broken internal links (${bad.length} of ${checked} checked):`);
  for (const item of bad.slice(0, 50)) console.error(`- ${item}`);
  if (bad.length > 50) console.error(`  ...and ${bad.length - 50} more`);
  process.exit(1);
}

console.log(`Internal link validation OK: ${checked} href(s) across ${files.length} HTML file(s), all resolving (clean URL, .html or index.html)`);
