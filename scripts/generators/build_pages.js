const fs = require('fs');
const path = require('path');
const entries = require('../../data/queries/query_universe.json');
const { renderPage } = require('../../templates/page-shell');

const root = path.resolve(__dirname, '..', '..');
const filterFolder = process.argv[2] || 'all';
let manifest = [];
try {
  manifest = require('../../data/published_manifest/published_manifest.json');
} catch {}
let slugRegistry = [];
try {
  slugRegistry = require('../../data/slug_registry/slug_registry.json');
} catch {}

const selected = entries.filter(entry => filterFolder === 'all' || entry.folder === filterFolder);
selected.forEach(entry => {
  const outDir = path.join(root, entry.folder);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${entry.slug}.html`);
  fs.writeFileSync(outPath, renderPage(entry));
  if (!manifest.find(m => m.slug === entry.slug && m.folder === entry.folder)) {
    manifest.push({ slug: entry.slug, folder: entry.folder, path: `/${entry.folder}/${entry.slug}.html` });
  }
  if (!slugRegistry.includes(entry.slug)) slugRegistry.push(entry.slug);
});
fs.writeFileSync(path.join(root, 'data', 'published_manifest', 'published_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'data', 'slug_registry', 'slug_registry.json'), JSON.stringify(slugRegistry, null, 2) + '\n');
console.log(`Generated ${selected.length} pages for ${filterFolder}.`);
