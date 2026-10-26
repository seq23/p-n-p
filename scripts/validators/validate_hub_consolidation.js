#!/usr/bin/env node
'use strict';
/**
 * The 26 Oct 2026 hub consolidation stays consolidated.
 *
 * WHY
 * ---
 * 73 thin pages were folded into 12 service hubs and answers/, local/ and events/ retired
 * (data/search_intelligence/hub_consolidation.json, scripts/lib/hub_consolidation.js). A 301 only
 * helps if nothing on the site still points at the old URL: a sitemap that submits a redirect, or
 * an internal link that goes through one, tells a crawler the old page still matters, and every
 * generator in this repo used to emit those links. This fails when any of that comes back.
 *
 * WHAT IT CHECKS
 *   1. Every folded page and retired index is gone from disk.
 *   2. No 301 source is in sitemap.xml.
 *   3. No published page or llms text file links a 301 source (href, content=, or an absolute
 *      porchandparty901.com URL), in any spelling.
 *   4. _redirects carries the generated block exactly, every folded URL has its 301 in it, and
 *      every destination is a page that is published (in sitemap.xml).
 *   5. Each of the 12 hubs is in the sitemap and carries its "More questions" block exactly as
 *      scripts/install_hub_folds.js renders it, with the anchor each old link now lands on, and no
 *      question twice on the page.
 *
 * Rule 0: zero folds, zero hubs, zero published pages or zero redirect rules is a failure.
 * Self-test: broken copies held in memory (a sitemap that still submits a folded URL, a page that
 * still links one, a _redirects without one of the rules, a hub that asks one question twice)
 * must each FAIL.
 *
 * Repair: node scripts/install_hub_folds.js, then the post-generation passes (CLAUDE.md).
 * Usage: node scripts/validators/validate_hub_consolidation.js
 */
const fs = require('fs');
const path = require('path');
const HC = require('../lib/hub_consolidation');
const HF = require('../install_hub_folds');

const ROOT = path.resolve(__dirname, '..', '..');
const DOMAIN = 'https://porchandparty901.com';
const TEXT_FILES = ['llms.txt', 'llms-full.txt', 'llms-entities.txt', 'llms-answers.txt', 'llms-services.txt'];
const SKIP = new Set(['node_modules', '.git', '.pages-output', '.build', 'dist', '.clarity', '.wrangler', 'reports', 'docs', 'data', 'scripts', 'templates', 'functions', 'workers', 'migrations', 'admin']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith('.html')) out.push(path.relative(ROOT, full).replace(/\\/g, '/'));
  }
  return out;
}

const sitemapPaths = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(DOMAIN, '') || '/');

/** Every internal URL a file mentions: href/src/content attributes and absolute self URLs. */
function linksIn(text) {
  const out = [];
  for (const m of text.matchAll(/\b(?:href|content)=["'](\/[^"'#?]*)/g)) out.push(m[1]);
  for (const m of text.matchAll(/https:\/\/porchandparty901\.com(\/[^\s"'<>\\)#?]*)/g)) out.push(m[1]);
  return out;
}

function check({ files, sitemapXml, redirects, read }) {
  const errors = [];
  const plan = HC.load().plan;
  if (!(plan.folds || []).length) errors.push('Rule 0: the plan folds zero pages');
  const hubs = HC.hubs();
  if (hubs.length !== 12) errors.push(`the plan folds into ${hubs.length} hubs, want 12`);
  if (!files.length) errors.push('Rule 0: zero published pages scanned');

  // 1. gone from disk
  for (const rel of HC.retiredFiles()) if (files.includes(rel)) errors.push(`${rel} was folded into a hub but is still on disk`);

  // 2. sitemap
  const submitted = sitemapPaths(sitemapXml);
  const submittedSet = new Set(submitted.map((p) => HC.bare(p)));
  for (const p of submitted) if (HC.isRetiredUrl(p)) errors.push(`sitemap.xml still submits ${p}, which 301s to ${HC.foldTarget(p).to}`);

  // 3. internal links
  for (const rel of [...files, ...TEXT_FILES]) {
    const text = read(rel);
    if (text == null) { errors.push(`${rel}: unreadable`); continue; }
    for (const href of new Set(linksIn(text))) {
      if (HC.isRetiredUrl(href)) errors.push(`${rel} links ${href}, which 301s to ${HC.foldTarget(href).to}; link the hub`);
    }
  }

  // 4. _redirects
  const rules = HC.redirectRules();
  if (!rules.length) errors.push('Rule 0: zero redirect rules');
  if (!redirects.includes(HC.redirectsBlock())) errors.push('_redirects does not carry the generated hub consolidation block (run node scripts/install_hub_folds.js)');
  const lines = new Set(redirects.split('\n').map((l) => l.trim().split(/\s+/).join(' ')));
  for (const f of plan.folds || []) if (!lines.has(`${HC.bare(f.from)} ${f.to} 301`)) errors.push(`_redirects has no "${HC.bare(f.from)} ${f.to} 301"`);
  for (const r of rules) if (!submittedSet.has(HC.bare(r.to))) errors.push(`_redirects sends ${r.from} to ${r.to}, which sitemap.xml does not publish`);

  // 5. hubs
  for (const { hub, file, items } of hubs) {
    if (!submittedSet.has(HC.bare(hub))) errors.push(`hub ${hub} is not in sitemap.xml`);
    const html = read(file);
    if (html == null) { errors.push(`hub ${file} is missing`); continue; }
    if (!items.length) errors.push(`hub ${file} has no folded questions`);
    if (!html.includes(HF.block(items))) errors.push(`${file}: the folded questions block is missing or stale (run node scripts/install_hub_folds.js)`);
    const qs = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''));
    const dup = qs.filter((q, i) => q && qs.indexOf(q) !== i);
    if (dup.length) errors.push(`${file}: asks the same question twice (${dup.length} repeat(s)) - no duplicate FAQ blocks`);
  }
  for (const f of plan.folds || []) {
    const t = HC.foldTarget(f.from);
    const html = read(`${t.to.replace(/^\//, '')}.html`) || '';
    if (!html.includes(`id="${t.hash.slice(1)}"`)) errors.push(`${f.from} lands on ${t.to}${t.hash}, which has no such id`);
  }
  return errors;
}

function live() {
  const read = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel), 'utf8') : null);
  return { files: walk(ROOT), sitemapXml: read('sitemap.xml') || '', redirects: read('_redirects') || '', read };
}

function main() {
  const base = live();
  const errors = check(base);

  // Self-test: each broken copy must fail.
  const folded = HC.load().plan.folds[0];
  const hub = HC.hubs()[0];
  const probes = {
    'a sitemap that still submits a folded URL': { ...base, sitemapXml: `${base.sitemapXml}<url><loc>${DOMAIN}${HC.bare(folded.from)}</loc></url>` },
    'a page that still links a folded URL': { ...base, read: (rel) => (rel === 'index.html' ? `${base.read(rel)}<a href="${folded.from}">x</a>` : base.read(rel)) },
    'a _redirects without one of the rules': { ...base, redirects: base.redirects.split('\n').filter((l) => !l.startsWith(`${HC.bare(folded.from)} `)).join('\n') },
    'a hub that asks one question twice': { ...base, read: (rel) => (rel === hub.file ? base.read(rel).replace('</main>', `<h3>${hub.items[0].q.replace(/&/g, '&amp;')}</h3></main>`) : base.read(rel)) },
    'a folded page back on disk': { ...base, files: [...base.files, folded.file] },
  };
  for (const [name, input] of Object.entries(probes)) {
    if (!check(input).length) errors.push(`self-test: ${name} passed, so this check cannot see it`);
  }

  if (errors.length) {
    console.error(`hub-consolidation: FAIL (${errors.length})`);
    errors.slice(0, 40).forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log(`hub-consolidation: OK - ${HC.load().plan.folds.length} pages folded into ${HC.hubs().length} hubs, `
    + `${HC.redirectRules().length} redirect rules, ${base.files.length} pages + ${TEXT_FILES.length} llms files free of 301 links, `
    + `sitemap free of 301 sources; ${Object.keys(probes).length} self-test probes fail as they should`);
}

if (require.main === module) main();
module.exports = { check };
