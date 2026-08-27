#!/usr/bin/env node
'use strict';
/**
 * Stop BreadcrumbList naming a parent URL that does not exist.
 *
 * The defect. templates/page-shell.js emits a three-item BreadcrumbList whose
 * position-2 item is `https://porchandparty901.com/<section>/`, for every
 * section in a hard-coded map. scripts/generators/build_section_indexes.js only
 * builds an index for a section holding four or more published pages - and that
 * is a deliberate decision, recorded in its own header: a two-page directory
 * does not need a navigation surface, and publishing one adds a thin page for no
 * reachability gain. Six sections therefore have no index, and eleven published
 * pages assert a parent that answers 404:
 *
 *   /authority/  /comparisons/  /corporate/  /guides/  /hubs/  /seasonal/
 *
 * Confirmed live with `curl -I`: all six return 404. A breadcrumb naming a URL
 * that 404s is worse than no breadcrumb - it is a structured-data claim about
 * the site's shape that the site contradicts.
 *
 * The repair. Drop the position-2 item on exactly those pages and renumber the
 * page's own crumb to position 2, so the trail reads Home > This page: what the
 * site actually offers. Sections that do have an index keep all three items.
 * Nothing is added, no URL is invented, and no visible text changes - these
 * eleven pages carry no visible breadcrumb bar, only the JSON-LD.
 *
 * templates/page-shell.js is fixed at the same time, so a future rebuild does
 * not put the false crumb back. This script exists because the published pages
 * have been retrofitted since they were generated and must not be regenerated
 * to pick up a schema fix.
 *
 * Idempotent: a page whose trail is already correct is left byte-identical.
 *
 * Usage: node scripts/repair_breadcrumb_parents.js [--write] [--check]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOMAIN = 'https://porchandparty901.com';
const WRITE = process.argv.includes('--write');
const CHECK = process.argv.includes('--check');

const SECTION_DIRS = ['authority', 'answers', 'areas', 'comparisons', 'corporate',
  'events', 'faq', 'guides', 'hubs', 'local', 'seasonal', 'services'];

/** A section is a real parent only when it has an index page on disk. */
const hasIndex = (dir) => fs.existsSync(path.join(ROOT, dir, 'index.html'));

const LD = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function fixTrail(node, dir) {
  if (!node || node['@type'] !== 'BreadcrumbList' || !Array.isArray(node.itemListElement)) {
    return false;
  }
  const parent = `${DOMAIN}/${dir}/`;
  const kept = node.itemListElement.filter((item) => String(item.item || '') !== parent);
  if (kept.length === node.itemListElement.length) return false;
  node.itemListElement = kept.map((item, i) => Object.assign({}, item, { position: i + 1 }));
  return true;
}

function walk(value, dir) {
  let changed = false;
  if (Array.isArray(value)) {
    for (const v of value) changed = walk(v, dir) || changed;
  } else if (value && typeof value === 'object') {
    changed = fixTrail(value, dir) || changed;
    for (const v of Object.values(value)) changed = walk(v, dir) || changed;
  }
  return changed;
}

const repaired = [];
const skippedUnparsed = [];

for (const dir of SECTION_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs) || hasIndex(dir)) continue;
  for (const name of fs.readdirSync(abs).filter((n) => n.endsWith('.html')).sort()) {
    const rel = `${dir}/${name}`;
    const file = path.join(ROOT, rel);
    const before = fs.readFileSync(file, 'utf8');
    let touched = false;
    const after = before.replace(LD, (whole, body) => {
      let data;
      try {
        data = JSON.parse(body);
      } catch {
        skippedUnparsed.push(rel);
        return whole;
      }
      if (!walk(data, dir)) return whole;
      touched = true;
      return whole.replace(body, JSON.stringify(data));
    });
    if (touched) {
      repaired.push(rel);
      if (WRITE) fs.writeFileSync(file, after, 'utf8');
    }
  }
}

const receipt = {
  status: 'PASS',
  written: WRITE,
  sections_without_an_index: SECTION_DIRS.filter((d) => fs.existsSync(path.join(ROOT, d)) && !hasIndex(d)),
  pages_repaired: repaired.length,
  pages: repaired,
  jsonld_blocks_that_would_not_parse: skippedUnparsed
};
console.log(JSON.stringify(receipt, null, 2));
if (CHECK && repaired.length) process.exit(1);
