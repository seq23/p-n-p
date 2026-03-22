const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
let failed = false;

const required = [
  'index.html','pricing.html','how-it-works.html','contact.html','privacy-policy.html','terms-and-conditions.html',
  'robots.txt','llms.txt','_headers','_redirects','README.md','package.json','.gitignore',
  'services/porch-decorating.html','services/celebration-setups.html','services/grazing-and-event-styling.html',
  'assets/css/styles.css','data/offers/services.json','data/queries/query_universe.json','data/clusters/clusters.json',
  'scripts/generators/build_pages.js','scripts/generators/update_sitemap.js','scripts/validation/validate.js',
  '.github/workflows/velocity-weekly.yml','.github/workflows/monthly-audit.yml',
  'docs/AUTOMATION-ENGINE.md','docs/GOOGLE-BUSINESS-PROFILE-CHECKLIST.md','docs/DISTRIBUTION-RUNBOOK.md','docs/CONTENT-OPERATIONS.md'
];

for (const rel of required) {
  if (!fs.existsSync(path.join(root, rel))) {
    console.error(`Missing required file: ${rel}`);
    failed = true;
  }
}

function walk(dir, acc = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(item.name)) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, acc);
    else if (item.isFile() && item.name.endsWith('.html')) acc.push(full);
  }
  return acc;
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const htmlFiles = walk(root);
const titles = new Map();
const canonicals = new Set();
const generatedFolders = new Set(['authority','faq','local','seasonal','guides','comparisons','events','corporate','hubs']);

for (const file of htmlFiles) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const html = fs.readFileSync(file, 'utf8');
  const checks = [
    ['title', /<title>.+<\/title>/i],
    ['canonical', /<link rel="canonical" href="[^"]+"/i],
    ['json-ld', /<script type="application\/ld\+json">[\s\S]*?<\/script>/i]
  ];
  for (const [label, re] of checks) {
    if (!re.test(html)) {
      console.error(`Validation failed in ${rel}: missing ${label}`);
      failed = true;
    }
  }

  const legalChecks = [
    ['All rights reserved', /All rights reserved/i],
    ['Kerseta LLC', /Kerseta LLC/i],
    ['hello email', /hello@porchandparty901\.com/i],
    ['privacy link', /href="\/privacy-policy\.html"/i],
    ['terms link', /href="\/terms-and-conditions\.html"/i]
  ];
  for (const [label, re] of legalChecks) {
    if (!re.test(html)) {
      console.error(`Validation failed in ${rel}: missing ${label}`);
      failed = true;
    }
  }

  const isLegalPage = rel === 'privacy-policy.html' || rel === 'terms-and-conditions.html';
  const ctaMatches = html.match(/Request a Quote|Start Your Request/g) || [];
  if (!isLegalPage && ctaMatches.length < 3) {
    console.error(`Validation failed in ${rel}: fewer than 3 CTA mentions`);
    failed = true;
  }

  const folder = rel.split('/')[0];
  if (generatedFolders.has(folder)) {
    const generatedHeadings = ['Quick answer','Who this is for','What this includes','What this means in practice','Before you book','What to do next'];
    for (const heading of generatedHeadings) {
      if (!new RegExp(`<h[23]>${heading}<\\/h[23]>`, 'i').test(html)) {
        console.error(`Validation failed in ${rel}: missing section heading ${heading}`);
        failed = true;
      }
    }
    const wordCount = stripTags(html).split(/\s+/).filter(Boolean).length;
    const minWords = folder === 'authority' ? 520 : 360;
    if (wordCount < minWords) {
      console.error(`Validation failed in ${rel}: thin content (${wordCount} words, min ${minWords})`);
      failed = true;
    }
  }

  if ((rel.startsWith('local/') || rel.startsWith('seasonal/') || rel.startsWith('hubs/') || rel.startsWith('authority/') || rel.startsWith('corporate/') || rel.startsWith('events/')) && !/Memphis/i.test(html)) {
    console.error(`Validation failed in ${rel}: missing Memphis mention`);
    failed = true;
  }

  const title = (html.match(/<title>([^<]+)<\/title>/i) || [])[1];
  if (title) {
    if (titles.has(title)) {
      console.error(`Validation failed: duplicate title in ${rel} and ${titles.get(title)}`);
      failed = true;
    }
    titles.set(title, rel);
  }

  const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/i) || [])[1];
  if (canonical) {
    if (canonicals.has(canonical)) {
      console.error(`Validation failed: duplicate canonical ${canonical}`);
      failed = true;
    }
    canonicals.add(canonical);
  }

  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  for (const href of hrefs) {
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    const target = href === '/' ? 'index.html' : href.replace(/^\//, '');
    if (!fs.existsSync(path.join(root, target))) {
      console.error(`Validation failed in ${rel}: broken internal href ${href}`);
      failed = true;
    }
  }
}

const homepage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const expected = 'https://porchandparty901.com/';
const canonical = (homepage.match(/<link rel="canonical" href="([^"]+)"/i) || [])[1];
const ogUrl = (homepage.match(/<meta property="og:url" content="([^"]+)"/i) || [])[1];
const schemaMatches = [...homepage.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/ig)];
let schemaUrl = '';
for (const m of schemaMatches) {
  try {
    const obj = JSON.parse(m[1]);
    if (obj['@type'] === 'LocalBusiness') {
      schemaUrl = obj.url || '';
      break;
    }
  } catch {}
}
if (canonical !== expected || ogUrl !== expected || schemaUrl !== expected) {
  console.error('Validation failed in index.html: homepage root URL contract mismatch');
  failed = true;
}
if (!/Quotes are custom based on scope, location, date, and setup needs\./i.test(homepage)) {
  console.error('Validation failed in index.html: missing homepage trust line');
  failed = true;
}
if (!/href="\/"/i.test(homepage)) {
  console.error('Validation failed in index.html: brand link must point to /');
  failed = true;
}

const celebration = fs.readFileSync(path.join(root, 'services/celebration-setups.html'), 'utf8');
if (!/Availability is not guaranteed until your request is confirmed\./i.test(celebration)) {
  console.error('Validation failed in services/celebration-setups.html: missing celebration disclaimer');
  failed = true;
}
const porch = fs.readFileSync(path.join(root, 'services/porch-decorating.html'), 'utf8');
if (!/take-down/i.test(porch)) {
  console.error('Validation failed in services/porch-decorating.html: missing take-down note');
  failed = true;
}
const grazing = fs.readFileSync(path.join(root, 'services/grazing-and-event-styling.html'), 'utf8');
if (!/food is not included/i.test(grazing) || !/additional fee/i.test(grazing)) {
  console.error('Validation failed in services/grazing-and-event-styling.html: missing grazing disclaimer');
  failed = true;
}

const queryUniverse = JSON.parse(fs.readFileSync(path.join(root, 'data/queries/query_universe.json'), 'utf8'));
const slugSet = new Set();
for (const entry of queryUniverse) {
  const key = `${entry.folder}/${entry.slug}`;
  if (slugSet.has(key)) {
    console.error(`Validation failed: duplicate entry ${key} in query universe`);
    failed = true;
  }
  slugSet.add(key);
  const pagePath = path.join(root, entry.folder, `${entry.slug}.html`);
  if (!fs.existsSync(pagePath)) {
    console.error(`Validation failed: generated page missing ${entry.folder}/${entry.slug}.html`);
    failed = true;
  }
}

const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
for (const loc of ['https://porchandparty901.com/privacy-policy.html', 'https://porchandparty901.com/terms-and-conditions.html']) {
  if (!sitemap.includes(loc)) {
    console.error(`Validation failed: sitemap missing ${loc}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log('validate:all passed');
