#!/usr/bin/env node
'use strict';
/**
 * Every published page whose title says "vs" carries a real comparison table.
 *
 * WHY
 * ---
 * The owner's Search Readiness Checklist (item d2, 25 Oct 2026) samples this
 * site every Monday: "pages whose title says ' vs ' carry a table", because a
 * table snippet is extracted from a literal <table> and never from prose. It
 * reported /answers/party-decor-vs-event-planning-memphis on 2026-10-26, and a
 * sweep found five such pages with no table at all. Nothing checked it, so
 * nothing stopped it - and two of the five were published a second time under
 * the other folder, so the same gap existed twice.
 *
 * WHAT IT CHECKS
 * --------------
 * Per published comparison page (the sitemap is the published set, the page's
 * own <title> decides whether it is a comparison, exactly as the checklist
 * does):
 *   - a <table> exists;
 *   - it has a <caption>, a <thead> row and at least MIN_ROWS body rows, so a
 *     one-cell table cannot satisfy the rule;
 *   - every cell is non-empty (a hole reads as a missing answer);
 *   - the table has at least MIN_COLUMNS columns, since a comparison needs the
 *     factor and the two things being compared.
 * Plus: data/content/comparison_tables.json and the stamped HTML agree, so an
 * edit to the data file that was never installed fails here rather than going
 * live as prose.
 *
 * Rule 0: zero published pages, or zero comparison pages, is a hard failure.
 *
 * Self-test: broken copies held in memory (a comparison page with its table
 * removed, one with an empty cell, one with a single body row, one with two
 * columns) must FAIL.
 *
 * Repair: node scripts/install_comparison_tables.js
 * Usage: node scripts/validators/validate_comparison_tables.js
 */
const fs = require('fs');
const path = require('path');
const { tableSection, IS_COMPARISON, titleOf, publishedPages, DATA } = require('../install_comparison_tables');

const MIN_ROWS = 3;
const MIN_COLUMNS = 3;
const ROOT = path.resolve(__dirname, '../..');

const cells = (row) => [...row.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
const stripped = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

/** Everything wrong with one comparison page's table, as its own function so the self-test can call it. */
function tableProblems(rel, html) {
  const bad = [];
  const table = (html.match(/<table\b[\s\S]*?<\/table>/i) || [])[0];
  if (!table) { bad.push(`${rel}: title says "vs" but the page has no <table>`); return bad; }
  if (!/<caption\b[^>]*>[\s\S]*?<\/caption>/i.test(table)) bad.push(`${rel}: the table has no <caption>`);

  const head = (table.match(/<thead\b[\s\S]*?<\/thead>/i) || [])[0];
  if (!head) bad.push(`${rel}: the table has no <thead>`);
  const headCells = head ? cells(head) : [];
  if (head && headCells.length < MIN_COLUMNS) bad.push(`${rel}: the table has ${headCells.length} column(s), needs at least ${MIN_COLUMNS}`);

  const body = (table.match(/<tbody\b[\s\S]*?<\/tbody>/i) || [])[0];
  const rows = body ? [...body.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => m[0]) : [];
  if (rows.length < MIN_ROWS) bad.push(`${rel}: the table has ${rows.length} body row(s), needs at least ${MIN_ROWS}`);

  for (const [i, row] of rows.entries()) {
    const cs = cells(row);
    if (headCells.length && cs.length !== headCells.length) {
      bad.push(`${rel}: body row ${i + 1} has ${cs.length} cell(s) against ${headCells.length} column(s)`);
    }
    for (const [j, c] of cs.entries()) {
      if (!stripped(c)) bad.push(`${rel}: body row ${i + 1}, cell ${j + 1} is empty`);
    }
  }
  for (const [j, c] of headCells.entries()) if (!stripped(c)) bad.push(`${rel}: header cell ${j + 1} is empty`);
  return bad;
}

function run() {
  const errors = [];
  const pages = publishedPages();
  if (!pages.length) {
    console.error('COMPARISON TABLES FAILED: zero published pages read from sitemap.xml. The read is broken, not the site.');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const tables = data.tables || {};

  let comparisons = 0;
  for (const p of pages) {
    if (!IS_COMPARISON.test(titleOf(p.html))) continue;
    comparisons += 1;
    errors.push(...tableProblems(p.rel, p.html));
    // A page this repo stamps must match the data file byte for byte, so an
    // edited table that was never installed fails here instead of going live.
    if (p.html.includes(`data-comparison-table="${p.slug}"`)) {
      if (!tables[p.slug]) errors.push(`${p.rel}: carries a stamped table for "${p.slug}", which data/content/comparison_tables.json no longer holds`);
      else if (!p.html.includes(tableSection(p.slug, tables[p.slug]))) {
        errors.push(`${p.rel}: the stamped table does not match data/content/comparison_tables.json; run node scripts/install_comparison_tables.js`);
      }
    }
  }
  if (!comparisons) errors.push('zero published comparison pages found; the title test is broken, not the site.');

  // Self-test: each broken copy must fail.
  const good = `<title>A vs B</title><table><caption>c</caption><thead><tr><th>F</th><th>A</th><th>B</th></tr></thead>`
    + `<tbody><tr><th>1</th><td>x</td><td>y</td></tr><tr><th>2</th><td>x</td><td>y</td></tr><tr><th>3</th><td>x</td><td>y</td></tr></tbody></table>`;
  if (tableProblems('probe', good).length) errors.push(`self-test: a sound table failed its own rule: ${tableProblems('probe', good).join('; ')}`);
  const probes = {
    'a comparison page with no table': '<title>A vs B</title><p>prose only</p>',
    'a table with no caption': good.replace(/<caption>c<\/caption>/, ''),
    'a table with an empty cell': good.replace('<td>x</td><td>y</td></tr><tr><th>2</th>', '<td></td><td>y</td></tr><tr><th>2</th>'),
    'a table with one body row': good.replace(/<tr><th>2<\/th>[\s\S]*<\/tbody>/, '</tbody>'),
    'a table with two columns': good.replace('<th>B</th>', '').replace(/<td>y<\/td>/g, '')
  };
  for (const [label, html] of Object.entries(probes)) {
    if (!tableProblems('probe', html).length) errors.push(`self-test: "${label}" passed when it should fail`);
  }

  if (errors.length) {
    console.error(`comparison-tables: FAIL (${errors.length})`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log(`comparison-tables: OK - ${comparisons} published comparison page(s), each with a captioned table of at least `
    + `${MIN_ROWS} rows and ${MIN_COLUMNS} columns, no empty cells; ${Object.keys(probes).length + 1} self-test probes behave as they should`);
}

module.exports = { tableProblems };
if (require.main === module) run();
