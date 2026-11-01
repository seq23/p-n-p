'use strict';
/**
 * Top-level names that are never part of the published site. One list, read by
 * scripts/assemble_pages_output.js (what Cloudflare Pages publishes) and
 * scripts/generators/update_sitemap.js (what sitemap.xml advertises), so the
 * sitemap can never name a file the deploy leaves out - e.g. the shared search
 * engine's undo snapshots under data/search-loop/snapshots/*.html.
 */
const EXCLUDE = new Set([
  '.pages-output', 'dist', 'node_modules', '.build', '.git', '.github', '.gitignore',
  'scripts', 'distribution_scripts', 'tests', 'test', 'docs', 'reports',
  'artifacts', 'validation', 'data', 'prompts', 'content-bank',
  'content-recipes', '.wrangler', '.astro', 'coverage',
  'package.json', 'package-lock.json', 'AGENTS.md', 'README.md',
  'ARTIFACT_MANIFEST.md', 'REPO_VALIDATION_MATRIX.md',
  // The /admin console's server code and config (docs/admin-console.md). Pages
  // reads functions/ and wrangler.toml from the repo root at build time; a copy
  // in the output would publish their source as static files.
  'functions', 'migrations', 'workers', 'wrangler.toml',
  // The shared search engine's config, checkout and run log (seq23/search-loop).
  'search-loop.config.json', '.search-loop-engine', '.search-loop-run.log',
]);

module.exports = { EXCLUDE };
