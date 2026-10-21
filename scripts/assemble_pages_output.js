#!/usr/bin/env node
/**
 * Assembles the publishable site into dist/ for Cloudflare Pages.
 *
 * These projects deployed the repository root, so the whole source tree was
 * reachable on the live domain - scripts, lockfiles, and AGENTS.md served as
 * raw text from a marketing hostname. Pages has no exclude mechanism for a
 * root deploy, so the fix is to publish a directory that only ever contained
 * the site.
 *
 * The exclusion list is a deny-list on purpose: an allow-list silently drops
 * site content the day someone adds a directory, whereas an unknown directory
 * here is published (visible) rather than lost. Every URL in sitemap.xml is
 * verified present afterwards, so a wrong exclusion fails the build loudly
 * instead of shipping a site with holes.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, '.pages-output');

const EXCLUDE = new Set([
  '.pages-output', 'dist', 'node_modules', '.build', '.git', '.github', '.gitignore',
  'scripts', 'distribution_scripts', 'tests', 'test', 'docs', 'reports',
  'artifacts', 'validation', 'data', 'prompts', 'content-bank',
  'content-recipes', '.wrangler', '.astro', 'coverage',
  'package.json', 'package-lock.json', 'AGENTS.md', 'README.md',
  'ARTIFACT_MANIFEST.md', 'REPO_VALIDATION_MATRIX.md',
  // The /admin console's server code and config (docs/admin-console.md). Pages
  // reads functions/ and wrangler.toml from the repo root at build time; a copy
  // in the output would publish their source as static files.
  'functions', 'migrations', 'workers', 'wrangler.toml',
]);
const EXCLUDE_EXT = new Set(['.md']);

let copied = 0;
function copyInto(srcDir, outDir, depth) {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (depth === 0 && EXCLUDE.has(entry.name)) continue;
    if (depth === 0 && EXCLUDE_EXT.has(path.extname(entry.name))) continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(outDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyInto(from, to, depth + 1);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      copied += 1;
    }
  }
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
copyInto(root, dist, 0);

// A URL listed in the sitemap that is missing from dist means an exclusion was
// wrong. Fail here rather than deploy a site with holes in it.
const sitemapPath = path.join(dist, 'sitemap.xml');
const missing = [];
if (fs.existsSync(sitemapPath)) {
  const xml = fs.readFileSync(sitemapPath, 'utf8');
  for (const m of xml.matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)) {
    const p = (m[1] || '/').replace(/^\//, '').replace(/\/$/, '');
    const candidates = p === ''
      ? ['index.html']
      : [p, `${p}.html`, path.join(p, 'index.html')];
    if (!candidates.some((c) => fs.existsSync(path.join(dist, c)))) missing.push(m[1] || '/');
  }
}
if (missing.length) {
  console.error(`assemble: ${missing.length} sitemap URL(s) missing from dist, e.g.`);
  console.error(missing.slice(0, 10).map((u) => `  ${u}`).join('\n'));
  process.exit(1);
}

// Nothing credential-shaped may ever reach a deploy directory, no matter how it
// got into the tree. CI recreates service-account keys from secrets, and a key
// written into the workspace instead of $RUNNER_TEMP would otherwise be copied
// here and published. Fail loudly rather than deploy and hope.
const CREDENTIAL_SHAPED = /(service[-_]?account|credentials?|secret|\.pem$|\.key$|\.p12$|id_rsa)/i;
const credentials = [];
(function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { scan(full); continue; }
    if (CREDENTIAL_SHAPED.test(entry.name)) credentials.push(path.relative(dist, full));
  }
})(dist);
if (credentials.length) {
  console.error('assemble: refusing to publish credential-shaped file(s): ' + credentials.join(', '));
  process.exit(1);
}

// No shipped image may exceed 500 KB. Ahrefs Site Audit (14 Oct 2026) flagged
// two 5 MB celebration PNGs as "Image too large"; they were re-encoded as JPEG
// at 1600px. Fail the build rather than publish a multi-megabyte image again.
const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif|svg|ico|bmp|tiff?)$/i;
const IMAGE_MAX_BYTES = 350 * 1024; // lowered from 500 KB on 2026-10-21 after re-encoding the nine 300-480 KB JPEGs (Ahrefs "Slow page")
const heavy = [];
let imagesChecked = 0;
(function scanImages(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { scanImages(full); continue; }
    if (!IMAGE_EXT.test(entry.name)) continue;
    imagesChecked += 1;
    const size = fs.statSync(full).size;
    if (size > IMAGE_MAX_BYTES) heavy.push(`${path.relative(dist, full)} (${size} bytes)`);
  }
})(dist);
if (imagesChecked === 0) {
  console.error('assemble: no images found in dist; the image size check reached nothing');
  process.exit(1);
}
if (heavy.length) {
  console.error(`assemble: ${heavy.length} image(s) over ${IMAGE_MAX_BYTES} bytes; compress at source:\n  ` + heavy.join('\n  '));
  process.exit(1);
}

// Stylesheets and scripts are served with a version query: /assets/css/x.css?v=<hash>.
// The porchandparty901.com zone's Browser Cache TTL (4 hours) rewrites the
// Cache-Control that Pages sends for cacheable assets (pages.dev serves
// max-age=0; the custom domain serves max-age=14400), so a _headers rule cannot
// stop returning visitors keeping old CSS: /faq/ rendered unstyled for them on
// 17 Oct 2026. A content hash in the URL changes the moment the file changes,
// whatever any cache layer does. Source HTML keeps plain URLs; only the
// published copy is stamped, so no generator has to know about it.
const crypto = require('crypto');
const ASSET_DIRS = ['assets/css', 'assets/js'];
const assetVersion = new Map();
for (const rel of ASSET_DIRS) {
  const dir = path.join(dist, rel);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(css|js)$/.test(name)) continue;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex').slice(0, 10);
    assetVersion.set(`/${rel}/${name}`, hash);
  }
}
if (assetVersion.size === 0) {
  console.error('assemble: no stylesheets found under assets/css; the asset versioning step reached nothing');
  process.exit(1);
}
const ASSET_REF = /(\b(?:href|src)=["'])(\/assets\/(?:css|js)\/[^"'?#]+)(?:\?[^"'#]*)?(["'#])/g;
let stampedFiles = 0;
let stampedRefs = 0;
const unversioned = [];
(function stamp(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { stamp(full); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const html = fs.readFileSync(full, 'utf8');
    let changed = 0;
    const out = html.replace(ASSET_REF, (m, pre, url, post) => {
      const v = assetVersion.get(url);
      if (!v) { unversioned.push(`${path.relative(dist, full)} -> ${url}`); return m; }
      changed += 1;
      return `${pre}${url}?v=${v}${post}`;
    });
    if (changed) { fs.writeFileSync(full, out); stampedFiles += 1; stampedRefs += changed; }
  }
})(dist);
if (unversioned.length) {
  console.error(`assemble: ${unversioned.length} asset reference(s) point at files that do not exist:\n  ` + unversioned.slice(0, 10).join('\n  '));
  process.exit(1);
}
const homepage = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
if (stampedRefs === 0 || !/\/assets\/css\/styles\.css\?v=[0-9a-f]{10}/.test(homepage)) {
  console.error('assemble: the homepage stylesheet is not versioned; returning visitors would keep stale CSS');
  process.exit(1);
}

// Below-the-fold images load lazily. Ahrefs (20 Oct 2026) flagged "Slow page"
// on four pages; the homepage shipped seven eager images (2.2 MB) and every
// page's later images competed with the first paint. The published copy gets
// loading="lazy" decoding="async" on every <img> after the first one in the
// page that does not already choose a loading mode; the first image (the hero)
// stays eager. Source HTML is untouched, like the asset versioning above.
const IMG_TAG = /<img\b[^>]*>/gi;
let lazyImgs = 0;
let imgsSeen = 0;
const eagerLeft = [];
(function lazy(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { lazy(full); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const html = fs.readFileSync(full, 'utf8');
    let n = 0;
    const out = html.replace(IMG_TAG, (tag) => {
      imgsSeen += 1;
      if (n++ === 0 || /\bloading=/i.test(tag)) return tag;
      lazyImgs += 1;
      const add = ' loading="lazy"' + (/\bdecoding=/i.test(tag) ? '' : ' decoding="async"');
      return tag.replace(/\s*\/?>$/, (end) => add + end);
    });
    if (out !== html) fs.writeFileSync(full, out);
    let k = 0;
    for (const tag of out.match(IMG_TAG) || []) if (k++ > 0 && !/\bloading=/i.test(tag)) eagerLeft.push(path.relative(dist, full));
  }
})(dist);
if (imgsSeen === 0) {
  console.error('assemble: no <img> found in dist pages; the lazy-loading step reached nothing');
  process.exit(1);
}
if (eagerLeft.length) {
  console.error(`assemble: ${eagerLeft.length} below-the-fold image(s) still load eagerly, e.g. ${eagerLeft.slice(0, 5).join(', ')}`);
  process.exit(1);
}

const leaked = ['README.md', 'package.json', 'AGENTS.md', 'package-lock.json']
  .filter((f) => fs.existsSync(path.join(dist, f)));
if (leaked.length) {
  console.error('assemble: source files still present in dist: ' + leaked.join(', '));
  process.exit(1);
}

console.log(`assemble: ${copied} files into .pages-output/ (sitemap URLs verified; ${stampedRefs} asset URLs versioned in ${stampedFiles} pages; ${lazyImgs} below-the-fold images set to lazy)`);
