const fs = require('fs');
const path = require('path');
const entries = require('../../data/queries/query_universe.json');
const { renderPage } = require('../../templates/page-shell');

const root = path.resolve(__dirname, '..', '..');
const filterFolder = process.argv[2] || 'all';
const selected = entries.filter(entry => filterFolder === 'all' || entry.folder === filterFolder);

selected.forEach(entry => {
  const outDir = path.join(root, entry.folder);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${entry.slug}.html`);
  fs.writeFileSync(outPath, renderPage(entry));
});

// The registries describe the whole corpus, so they are written on every run,
// not only when the whole corpus was the argument. `npm run build:all` invokes
// this script nine times with individual folder names and never with `all`, so
// this block last executed on 2026-07-24 and the three registries have said 26
// entries ever since - against 109 live URLs. Nothing read them closely enough
// to notice, which is the only reason it went a month.
{
  const manifest = entries.map(entry => ({ slug: entry.slug, folder: entry.folder, path: `/${entry.folder}/${entry.slug}.html` }));
  const slugRegistry = entries.map(entry => `${entry.folder}/${entry.slug}`);
  const publishQueue = entries.map(entry => ({ slug: entry.slug, folder: entry.folder, status: 'published' }));
  fs.writeFileSync(path.join(root, 'data', 'published_manifest', 'published_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'data', 'slug_registry', 'slug_registry.json'), JSON.stringify(slugRegistry, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'data', 'publish_queue', 'publish_queue.json'), JSON.stringify(publishQueue, null, 2) + '\n');
}

console.log(`Generated ${selected.length} pages for ${filterFolder}.`);
