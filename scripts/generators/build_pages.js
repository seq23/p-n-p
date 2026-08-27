const fs = require('fs');
const path = require('path');
const entries = require('../../data/queries/query_universe.json');
const { renderPage } = require('../../templates/page-shell');

const root = path.resolve(__dirname, '..', '..');
const filterFolder = process.argv[2] || 'all';
const selected = entries.filter(entry => filterFolder === 'all' || entry.folder === filterFolder);

/**
 * This generator is not the last thing that writes a published page.
 *
 * Three passes run AFTER it and write markup it knows nothing about:
 *
 *   scripts/install_clarity.js          -> <script data-clarity-loader>
 *   scripts/build_related_navigation.js -> <section data-nav="related-pages">
 *   scripts/retrofit_*.js               -> data-retrofit="..." blocks
 *
 * Re-rendering an existing page therefore does not reproduce it - it reverts it.
 * Measured on 2026-08-27: all 26 template pages differed from a fresh render,
 * every one of them SMALLER by 1,500-1,900 bytes, and all 26 are among the 98
 * routes frozen in data/release/frozen_output_registry.json where
 * `normal_build_may_mutate_frozen` is false. `npm run build:all` invokes this
 * script nine times and would have silently stripped the analytics tag and the
 * internal-link block from all of them, which is unauthorized drift on 26 frozen
 * routes and an analytics blackout on top.
 *
 * The failure was silent because a smaller file is still a valid file: nothing
 * downstream compares byte counts, and the retrofit passes are idempotent, so a
 * later run would put the markup back and leave no trace that it had gone.
 *
 * So this refuses. Not a warning - a refusal with a non-zero exit, because a
 * warning in the middle of a nine-invocation `build:all` scrolls past unread.
 * It fires only when the write would actually LOSE something: a marker present
 * on disk and absent from the fresh render. A genuinely new page has no file to
 * lose anything from and is unaffected.
 *
 * If you need to change a page the generator owns, change the entry in
 * data/queries/query_universe.json, render that one page, then re-run the
 * retrofit passes - which is what scripts/generators/build_pages.js cannot do
 * for you, because it does not know they exist.
 *
 * --force overrides, and exists so the escape hatch is explicit and greppable
 * rather than someone deleting this check under deadline. Using it on a frozen
 * route still needs the thaw-validate-refreeze scope in
 * data/release/active_mutation_scope.json.
 */
const FORCE = process.argv.includes('--force');
const RETROFIT_MARKERS = [
  { marker: 'data-clarity-loader', wrote: 'scripts/install_clarity.js', is: 'the Microsoft Clarity analytics tag' },
  { marker: 'data-nav="related-pages"', wrote: 'scripts/build_related_navigation.js', is: 'the related-pages internal-link block' },
  { marker: 'data-retrofit=', wrote: 'scripts/retrofit_*.js', is: 'a retrofitted content block' },
];

const wouldLose = [];
const rendered = selected.map(entry => {
  const outPath = path.join(root, entry.folder, `${entry.slug}.html`);
  const html = renderPage(entry);
  if (fs.existsSync(outPath)) {
    const onDisk = fs.readFileSync(outPath, 'utf8');
    const lost = RETROFIT_MARKERS.filter(m => onDisk.includes(m.marker) && !html.includes(m.marker));
    if (lost.length) {
      wouldLose.push({
        rel: `${entry.folder}/${entry.slug}.html`,
        bytes: onDisk.length - html.length,
        lost,
      });
    }
  }
  return { outPath, html, folder: entry.folder };
});

if (wouldLose.length && !FORCE) {
  console.error(`\nbuild_pages.js REFUSED: rendering would strip post-generation markup from ${wouldLose.length} existing page(s).\n`);
  for (const p of wouldLose.slice(0, 10)) {
    console.error(`  ${p.rel}  (-${p.bytes} bytes)`);
    for (const l of p.lost) console.error(`      loses ${l.is} <${l.marker}>, written by ${l.wrote}`);
  }
  if (wouldLose.length > 10) console.error(`  ...and ${wouldLose.length - 10} more`);
  console.error(`\n  This generator does not run last. Re-rendering an existing page reverts it.`);
  console.error(`  Do not "fix" this by deleting the check - re-run the retrofit passes after`);
  console.error(`  rendering, or render only the new pages. See the comment above this guard.`);
  console.error(`  --force overrides; on a frozen route it still needs an active mutation scope.\n`);
  process.exit(1);
}
if (wouldLose.length && FORCE) {
  console.warn(`build_pages.js: --force set; stripping post-generation markup from ${wouldLose.length} page(s).`);
}

for (const { outPath, html, folder } of rendered) {
  fs.mkdirSync(path.join(root, folder), { recursive: true });
  fs.writeFileSync(outPath, html);
}

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
