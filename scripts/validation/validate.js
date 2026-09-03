#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { siteUrlForFile } = require('../lib/site_url');

const root = path.resolve(__dirname, '..', '..');
let failed = false;

const requiredFiles = [
  'index.html',
  'pricing.html',
  'how-it-works.html',
  'contact.html',
  'privacy-policy.html',
  'terms-and-conditions.html',
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  'llms-entities.txt',
  'llms-services.txt',
  '_headers',
  '_redirects',
  'README.md',
  'package.json',
  '.gitignore',
  'REPO_VALIDATION_MATRIX.md',
  'assets/css/styles.css',
  'services/porch-decorating.html',
  'services/fall-porch-decorating.html',
  'services/christmas-porch-decorating.html',
  'services/front-door-styling.html',
  'services/small-porch-decorating.html',
  'areas/memphis-tn-porch-decorating.html',
  'areas/germantown-tn-porch-decorating.html',
  'areas/collierville-tn-porch-decorating.html',
  'areas/bartlett-tn-porch-decorating.html',
  'answers/how-much-does-porch-decorating-cost-in-memphis.html',
  'answers/porch-decorating-under-500-memphis.html',
  'assets/img/party/memphis-party-decor-hotel-room-birthday-setup.jpg',
  'services/party-decor-memphis.html',
  'services/hotel-room-decor-memphis.html',
  'services/birthday-party-decor-memphis.html',
  'services/celebration-setups-memphis.html',
  'services/grazing-tables-memphis.html',
  'services/bridal-shower-decor-memphis.html',
  'services/baby-shower-decor-memphis.html',
  'services/luxury-party-decor-memphis.html',
  'services/budget-party-decor-memphis.html',
  'answers/how-much-does-party-decor-cost-in-memphis.html',
  'answers/what-is-included-in-party-decor-setup.html',
  'answers/can-someone-decorate-hotel-room-birthday-memphis.html',
  'answers/how-much-does-a-grazing-table-cost-in-memphis.html',
  'answers/party-decor-vs-event-planning-memphis.html',
  'answers/can-i-book-decor-only-without-event-planning.html',
  'answers/small-party-decor-ideas-memphis.html',
  'answers/birthday-hotel-room-setup-ideas-memphis.html',
  'answers/grazing-table-ideas-bridal-showers-birthdays-small-events.html'
];

function fail(msg) {
  console.error(`VALIDATION FAIL: ${msg}`);
  failed = true;
}

for (const rel of requiredFiles) {
  if (!fs.existsSync(path.join(root, rel))) fail(`missing required file ${rel}`);
}

function walk(dir, acc = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.pages-output', 'node_modules', '.git'].includes(item.name)) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, acc);
    else if (item.isFile() && item.name.endsWith('.html')) acc.push(full);
  }
  return acc;
}

function matchAttr(html, tag, key, value, targetAttr) {
  const patterns = [
    new RegExp(`<${tag}[^>]*${key}=["']${value}["'][^>]*${targetAttr}=["']([^"']+)["']`, 'i'),
    new RegExp(`<${tag}[^>]*${targetAttr}=["']([^"']+)["'][^>]*${key}=["']${value}["']`, 'i')
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return '';
}

const htmlFiles = walk(root);
const canonicalSet = new Set();
const sitemap = fs.existsSync(path.join(root, 'sitemap.xml')) ? fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8') : '';

for (const file of htmlFiles) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const html = fs.readFileSync(file, 'utf8');
  if (!/<title>[^<]+<\/title>/i.test(html)) fail(`${rel} missing title`);
  if (!/<meta[^>]+name=["']description["']/i.test(html)) fail(`${rel} missing meta description`);
  const robots = matchAttr(html, 'meta', 'name', 'robots', 'content');
  // A deliberately noindex page (the 404 surface) still owes every quality check
  // below, but demanding it be indexable and sitemapped would be contradictory.
  const noindex = /noindex/i.test(robots || '');
  if (!noindex && (!robots || !/index/i.test(robots) || !/follow/i.test(robots))) fail(`${rel} missing index/follow robots meta`);
  if (!/<script type=["']application\/ld\+json["']>[\s\S]*?<\/script>/i.test(html)) fail(`${rel} missing JSON-LD`);
  if (!/hello@porchandparty901\.com/i.test(html)) fail(`${rel} missing contact email`);
  if (!/Kerseta LLC/i.test(html)) fail(`${rel} missing operating entity footer`);
  // These used to demand the `.html` form specifically. The origin 308s
  // /privacy-policy.html to /privacy-policy, so the form this check required
  // was the redirecting one - the validator was holding the defect in place.
  // Accept either form; validate:canonical-resolves is what insists on the
  // served one.
  if (!/href=["']\/privacy-policy(\.html)?["']/i.test(html)) fail(`${rel} missing privacy link`);
  if (!/href=["']\/terms-and-conditions(\.html)?["']/i.test(html)) fail(`${rel} missing terms link`);

  const canonical = matchAttr(html, 'link', 'rel', 'canonical', 'href');
  if (!canonical || !canonical.startsWith('https://porchandparty901.com/')) fail(`${rel} missing valid canonical`);
  if (canonicalSet.has(canonical)) fail(`duplicate canonical ${canonical}`);
  if (canonical) canonicalSet.add(canonical);

  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/g)].map(m => m[1]);
  for (const href of hrefs) {
    if (!href || /^(https?:|mailto:|tel:|#|javascript:|\/\/)/i.test(href)) continue;
    const clean = href.split('#')[0].split('?')[0];
    if (!clean) continue;
    // Three forms resolve, because three forms are served. Cloudflare Pages
    // answers /foo with foo.html at 200 and answers /foo.html with a 308 to
    // /foo - verified live with `curl -I` against porchandparty901.com. This
    // check used to accept only the file path and the directory index, so an
    // extensionless link to a page that exists, and that the origin serves 200,
    // was reported as broken.
    const base = clean === '/' ? path.join(root, 'index.html')
      : path.join(root, clean.replace(/^\//, ''));
    const candidates = [base, `${base}.html`, path.join(base, 'index.html')];
    const target = candidates.find((c) => fs.existsSync(c) && !fs.statSync(c).isDirectory());
    if (!target) fail(`${rel} broken internal href ${href}`);
  }

  // A directory index is served at the directory, not at its index.html: the
  // live host answers /answers/index.html with a 308 to /answers/. This check
  // demanded the redirecting form for the six section indexes while
  // scripts/generators/update_sitemap.js - correctly - writes the directory
  // form, so the two contradicted each other and `validate:all` hard-failed on
  // six pages that are in the sitemap under the URL that actually gets indexed.
  // Canonicalise the same way the generator does, rather than special-casing
  // the root index alone.
  // ...and the `.html` suffix redirects for the same reason, so the sitemap
  // form is derived from the shared definition rather than restated here.
  const sitemapRel = `<loc>${siteUrlForFile(rel)}</loc>`;
  if (!noindex && sitemap && !sitemap.includes(sitemapRel)) fail(`${rel} missing from sitemap`);
  if (noindex && sitemap && sitemap.includes(sitemapRel)) fail(`${rel} is noindex but listed in sitemap`);

  for (const m of html.matchAll(/<script type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(m[1]); } catch (err) { fail(`${rel} has malformed JSON-LD`); }
  }
}

const llms = fs.existsSync(path.join(root, 'llms.txt')) ? fs.readFileSync(path.join(root, 'llms.txt'), 'utf8') : '';
if (!/Memphis-based porch decorating and celebration styling company/i.test(llms)) fail('llms.txt missing primary entity sentence');
if (!/hotel-room decor/i.test(llms)) fail('llms.txt missing hotel decor service surface');
if (!/party decor/i.test(llms)) fail('llms.txt missing party decor service surface');
if (!/grazing table setups/i.test(llms)) fail('llms.txt missing grazing table service surface');
if (!/party decor.*Memphis/i.test(llms) && !/Memphis party decor/i.test(llms)) fail('llms.txt missing Memphis party decor extraction surface');
if (!/Hotel-room decor/i.test(llms) && !/hotel room decor/i.test(llms)) fail('llms.txt missing hotel room decor extraction surface');
if (!/Celebration setups start at \$300\+/i.test(llms)) fail('llms.txt missing party decor pricing extraction');
if (!/Grazing table styling starts at \$250\+/i.test(llms)) fail('llms.txt missing grazing table pricing extraction');


if (failed) process.exit(1);
console.log(`Core validation OK: ${htmlFiles.length} HTML files checked with simplified matrix.`);
