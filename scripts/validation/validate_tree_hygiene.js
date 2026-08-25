#!/usr/bin/env node
const fs = require('fs');
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
  'REPO_VALIDATION_MATRIX.md',
  '_headers',
  '_redirects',
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
  'sitemap.xml',
  'terms-and-conditions.html'
]);

const allowedRootDirs = new Set([
  '.build',
  '.github',
  'answers',
  'areas',
  'assets',
  'authority',
  'comparisons',
  'corporate',
  'data',
  'distribution_scripts',
  'docs',
  'events',
  'faq',
  'guides',
  'hubs',
  'local',
  'reports',
  'scripts',
  'seasonal',
  'services',
  'templates'
]);

const forbiddenNames = new Set([
  'node_modules',
  '.validation-runtime',
  '.validation-cache',
  '.cache',
  '.next',
  'dist'
]);

const errors = [];

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
