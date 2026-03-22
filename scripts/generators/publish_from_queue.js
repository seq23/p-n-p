const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const queuePath = path.join(root, 'data', 'publish_queue', 'publish_queue.json');
const manifestPath = path.join(root, 'data', 'published_manifest', 'published_manifest.json');
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const maxItems = Number(process.argv[2] || 3);
let promoted = 0;
for (const item of queue) {
  if (item.status === 'queued' && promoted < maxItems) {
    item.status = 'published';
    if (!manifest.find(m => m.slug === item.slug && m.folder === item.folder)) {
      manifest.push({ slug: item.slug, folder: item.folder, path: `/${item.folder}/${item.slug}.html` });
    }
    promoted += 1;
  }
}
fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2) + '\n');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Published ${promoted} queued items.`);
