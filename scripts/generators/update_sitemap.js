const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const domain = 'https://porchandparty901.com';
function walk(dir, acc = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    // .pages-output is the assembled deploy copy of this same tree. Walking it
    // put every page into the sitemap twice, the second time under a
    // /.pages-output/ prefix that does not exist on the live site - which the
    // assembler then correctly refused to publish.
    if (item.name === 'node_modules' || item.name === '.pages-output' || item.name === 'dist' || item.name.startsWith('.git')) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, acc);
    else if (item.isFile() && item.name.endsWith('.html')) acc.push(full);
  }
  return acc;
}
// A noindex page must never be submitted in the sitemap - Search Console reports
// that as an error against the whole file. The 404 surface is the case that
// surfaced it.
const isNoindex = (abs) => /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i
  .test(fs.readFileSync(abs, 'utf8'));
const htmlFiles = walk(root)
  .filter((abs) => !isNoindex(abs))
  .map(f => path.relative(root, f).replace(/\\/g, '/'))
  .sort();
const body = htmlFiles.map(rel => `  <url><loc>${domain}/${rel === 'index.html' ? '' : rel}</loc></url>`).join('\n');
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
fs.writeFileSync(path.join(root, 'sitemap.xml'), xml);
console.log(`Updated sitemap with ${htmlFiles.length} HTML files.`);
