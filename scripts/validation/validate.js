const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
let failed = false;
const required = ['index.html','pricing.html','how-it-works.html','contact.html','robots.txt','llms.txt','_headers','_redirects','README.md','package.json','.gitignore','services/porch-decorating.html','services/celebration-setups.html','services/grazing-and-event-styling.html','assets/css/styles.css','data/offers/services.json','data/queries/query_universe.json','scripts/generators/build_pages.js','scripts/generators/update_sitemap.js'];
for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) {
    console.error(`Missing required file: ${rel}`);
    failed = true;
  }
}
function walk(dir, acc=[]) {
  for (const item of fs.readdirSync(dir, { withFileTypes:true })) {
    if (['node_modules','.git'].includes(item.name)) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, acc);
    else if (item.isFile() && item.name.endsWith('.html')) acc.push(full);
  }
  return acc;
}
const htmlFiles = walk(root);
const titles = new Map();
const canonicals = new Set();
for (const file of htmlFiles) {
  const rel = path.relative(root, file).replace(/\\/g,'/');
  const html = fs.readFileSync(file,'utf8');
  const checks = [
    ['title', /<title>.+<\/title>/i],
    ['canonical', /<link rel="canonical" href="[^"]+"/i],
    ['json-ld', /<script type="application\/ld\+json">[\s\S]*?<\/script>/i],
    ['top CTA', /Request a Quote|Start Your Request/i]
  ];
  for (const [label, re] of checks) {
    if (!re.test(html)) {
      console.error(`Validation failed in ${rel}: missing ${label}`);
      failed = true;
    }
  }
  const ctaMatches = html.match(/Request a Quote|Start Your Request/g) || [];
  if (ctaMatches.length < 3) {
    console.error(`Validation failed in ${rel}: fewer than 3 CTA mentions`);
    failed = true;
  }
  if ((rel.startsWith('local/') || rel.startsWith('seasonal/') || rel.startsWith('hubs/')) && !/Memphis/i.test(html)) {
    console.error(`Validation failed in ${rel}: missing Memphis mention`);
    failed = true;
  }
  const title = (html.match(/<title>([^<]+)<\/title>/i)||[])[1];
  if (title) {
    if (titles.has(title)) {
      console.error(`Validation failed: duplicate title in ${rel} and ${titles.get(title)}`);
      failed = true;
    }
    titles.set(title, rel);
  }
  const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/i)||[])[1];
  if (canonical) {
    if (canonicals.has(canonical)) {
      console.error(`Validation failed: duplicate canonical ${canonical}`);
      failed = true;
    }
    canonicals.add(canonical);
  }
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1]);
  for (const href of hrefs) {
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    const target = href === '/' ? 'index.html' : href.replace(/^\//,'');
    const targetPath = path.join(root, target);
    if (!fs.existsSync(targetPath)) {
      console.error(`Validation failed in ${rel}: broken internal href ${href}`);
      failed = true;
    }
  }
}
const homepage = fs.readFileSync(path.join(root, 'index.html'),'utf8');
const expected = 'https://porchandparty901.com/';
const canonical = (homepage.match(/<link rel="canonical" href="([^"]+)"/i)||[])[1];
const ogUrl = (homepage.match(/<meta property="og:url" content="([^"]+)"/i)||[])[1];
const schemaMatch = homepage.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
let schemaUrl = '';
if (schemaMatch) {
  try {
    const obj = JSON.parse(schemaMatch[1]);
    schemaUrl = obj.url || '';
  } catch {
    console.error('Validation failed in index.html: invalid homepage JSON-LD');
    failed = true;
  }
}
if (canonical !== expected || ogUrl !== expected || schemaUrl !== expected) {
  console.error('Validation failed in index.html: homepage root URL contract mismatch');
  failed = true;
}
if (!/href="\/"/i.test(homepage)) {
  console.error('Validation failed in index.html: brand link must point to /');
  failed = true;
}
const queryUniverse = JSON.parse(fs.readFileSync(path.join(root,'data/queries/query_universe.json'),'utf8'));
const slugSet = new Set();
for (const entry of queryUniverse) {
  if (slugSet.has(entry.slug)) {
    console.error(`Validation failed: duplicate slug ${entry.slug} in query universe`);
    failed = true;
  }
  slugSet.add(entry.slug);
  const pagePath = path.join(root, entry.folder, `${entry.slug}.html`);
  if (!fs.existsSync(pagePath)) {
    console.error(`Validation failed: generated page missing ${entry.folder}/${entry.slug}.html`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('validate:all passed');
