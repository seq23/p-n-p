#!/usr/bin/env node
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

const allowedRootFiles = new Set([
  '.gitignore',
  // Cloudflare Pages serves this for unmatched paths. Without it Pages
  // falls back to index.html under a 200, so every nonexistent URL became
  // an indexable duplicate of the homepage.
  '404.html',
  'AGENTS.md',
  'ARTIFACT_MANIFEST.md',
  'README.md',
  // The portfolio-wide repo-to-domain map. The site-audit duty greps
  // ~/GitHub/*/REPO_IDENTITY.md for a domain to decide which repository owns an
  // Ahrefs finding; without this file at the root, porchandparty901.com matched
  // no repository and this site was skipped on every audit run.
  'REPO_IDENTITY.md',
  'REPO_VALIDATION_MATRIX.md',
  '_headers',
  '_redirects',
  'apple-touch-icon.png',
  'favicon.ico',
  'site.webmanifest',
  'accessibility.html',
  'contact.html',
  'how-it-works.html',
  'index.html',
  'llms-answers.txt',
  'llms-entities.txt',
  'llms-full.txt',
  'llms-services.txt',
  'llms.txt',
  'package-lock.json',
  'package.json',
  'pricing.html',
  'privacy-policy.html',
  'robots.txt',
  'sitemap.html',
  'sitemap.xml',
  'terms-and-conditions.html',
  // Cloudflare Pages config for the /admin invoicing console: declares the
  // pnp-admin D1 binding and the pnp-mailer service binding (docs/admin-console.md).
  'wrangler.toml'
]);

const allowedRootDirs = new Set([
  // Gitignored Cloudflare Pages deploy output. Pages published the repo root,
  // which served README.md, package.json, AGENTS.md and scripts/ as raw text
  // on the live domain; scripts/assemble_pages_output.js builds a copy that
  // contains only the public site, and Pages publishes that instead.
  '.pages-output',
  '.build',
  '.github',
  'answers',
  'areas',
  'assets',
  'authority',
  'comparisons',
  // config/llm_routing.json: the $0-only model policy read by scripts/llm/free_router.mjs.
  'config',
  'corporate',
  'data',
  'distribution_scripts',
  'docs',
  'events',
  'faq',
  'guides',
  'hubs',
  'local',
  'rentals',
  'reports',
  'scripts',
  'seasonal',
  'services',
    'templates',
    // Pages Functions for the /admin invoicing console (docs/admin-console.md);
    // excluded from .pages-output by scripts/assemble_pages_output.js.
    'functions',
    // D1 schema for the console (pnp-admin), applied by `npm run admin:migrate`.
    'migrations',
    // The private pnp-mailer Worker that holds the send_email binding Pages cannot.
    'workers',
    // Gitignored local state of `wrangler pages dev` / local D1 (npm run admin:dev).
    '.wrangler',
    // Dependency install for functions/ (pdf-lib); guarded below: never tracked, never published.
    'node_modules',
    // Holds the content-pattern contract derived from the agent recommendation
    // corpus. Read by the generators, so it belongs in the tree.
    '.clarity'
]);

// node_modules is NOT in this set: npm ci creates it in CI and the Cloudflare Pages build
// creates it to bundle functions/ dependencies (pdf-lib). The harms it used to stand for are
// pinned directly below: it must never be tracked in git, never be copied into the publish
// root (.pages-output, see scripts/assemble_pages_output.js), and must stay gitignored.
const forbiddenNames = new Set([
  '.validation-runtime',
  '.validation-cache',
  '.cache',
  '.next',
  'dist'
]);

const errors = [];

{
  const tracked = execFileSync('git', ['ls-files', '--', 'node_modules'], { cwd: root, encoding: 'utf8' }).trim();
  if (tracked) errors.push(`node_modules is tracked in git (${tracked.split('\n').length} files); it must stay out of the repository`);
  const ignore = fs.existsSync(path.join(root, '.gitignore')) ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8') : '';
  if (!/^node_modules\/?$/m.test(ignore)) errors.push('.gitignore does not ignore node_modules');
  const assemble = fs.readFileSync(path.join(root, 'scripts/assemble_pages_output.js'), 'utf8');
  if (!/'node_modules'/.test(assemble)) errors.push('scripts/assemble_pages_output.js no longer excludes node_modules from the publish root');
  if (fs.existsSync(path.join(root, '.pages-output', 'node_modules'))) errors.push('node_modules was copied into the publish root .pages-output');
}

for (const item of fs.readdirSync(root, { withFileTypes: true })) {
  if (item.name === '.git') continue;
  if (forbiddenNames.has(item.name)) {
    errors.push(`forbidden generated/dependency folder at root: ${item.name}`);
    continue;
  }
  if (item.isDirectory() && !allowedRootDirs.has(item.name)) {
    errors.push(`unexpected root directory: ${item.name}`);
  }
  if (item.isFile() && !allowedRootFiles.has(item.name) && !/^[a-f0-9-]{36}\.txt$/i.test(item.name)) {
    errors.push(`unexpected root file: ${item.name}`);
  }
}

if (errors.length) {
  console.error('VALIDATION FAIL: tree hygiene failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Tree hygiene OK: root contains only public static files, repo contracts, and approved operations folders.');
