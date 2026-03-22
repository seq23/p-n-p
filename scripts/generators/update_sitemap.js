const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const domain = 'https://porchandparty901.com';
function walk(dir, acc = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === 'node_modules' || item.name.startsWith('.git')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, acc);
    else if (item.isFile() && item.name.endsWith('.html')) acc.push(full);
  }
  return acc;
}
const htmlFiles = walk(root)
  .map(f => path.relative(root, f).replace(/\\/g, '/'))
  .sort();
const body = htmlFiles.map(rel => `  <url><loc>${domain}/${rel === 'index.html' ? '' : rel}</loc></url>`).join('\n');
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
fs.writeFileSync(path.join(root, 'sitemap.xml'), xml);
console.log(`Updated sitemap with ${htmlFiles.length} HTML files.`);
