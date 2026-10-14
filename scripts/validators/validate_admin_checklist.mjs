#!/usr/bin/env node
/**
 * The walk-through checklist (owner-approved wording, functions/_lib/assets/
 * walkthrough-checklist.html.txt) is printed from /admin/checklist and filled in
 * online at /admin/checklist/online.
 *
 * 1. The print page yields exactly 4 pages: 4 page sections in the source, in
 *    the blank print render and in a render with every field filled with long
 *    text, and the @media print rules that break one section per letter page.
 * 2. Every field id in the online form maps to a labelled element in the print
 *    page, and every printed field is in the online form: no orphans either way.
 * 3. The print page says noindex.
 *
 * Rule 0: zero fields is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = path.join(ROOT, 'functions/_lib/assets/walkthrough-checklist.html.txt');
const src = fs.readFileSync(SOURCE, 'utf8');
const { annotate, renderPrintPage, renderOnlineSections } = await import(pathToFileURL(path.join(ROOT, 'functions/_lib/checklist.mjs')).href);
const errors = [];
const sections = (html) => (html.match(/<section class="page">/g) || []).length;

const { fields } = annotate(src);
if (!fields.length) errors.push('the checklist yields 0 fields');
const blank = renderPrintPage(src, {});
const full = renderPrintPage(src, Object.fromEntries(fields.map((f) => [f.id, f.kind === 'check' ? true : 'x'.repeat(400)])));
for (const [name, html] of [['source', src], ['blank print', blank], ['filled print', full]]) {
  if (sections(html) !== 4) errors.push(`${name} has ${sections(html)} page sections, expected 4`);
}
const printRules = (blank.match(/@media print\{[\s\S]*?@page\{[^}]*\}\}/) || [''])[0];
if (!/\.page\{[^}]*break-after:page[^}]*height:9\.85in;overflow:hidden/.test(printRules)) errors.push('the print rules no longer pin one fixed-height section per page');
if (!/@page\{size:letter/.test(blank)) errors.push('the print rules no longer set letter paper');
if (/clarity\.ms|googletagmanager|google-analytics/i.test(blank)) errors.push('the print page carries an analytics script; /admin has none');
if (!/<meta name="robots" content="noindex,nofollow">/.test(blank)) errors.push('the print page does not say noindex');

const printIds = new Map();
for (const m of blank.matchAll(/data-field="([^"]+)"/g)) printIds.set(m[1], true);
const label = Object.fromEntries(fields.map((f) => [f.id, f.label]));
const online = renderOnlineSections(src, {});
const onlineIds = [...online.matchAll(/data-field="([^"]+)"/g)].map((m) => m[1]);
if (!onlineIds.length) errors.push('the online form has 0 fields');
for (const id of onlineIds) {
  if (!printIds.has(id)) errors.push(`online field ${id} has no element in the print page`);
  else if (!label[id] || !label[id].trim()) errors.push(`online field ${id} has no printed label`);
}
for (const id of printIds.keys()) if (!onlineIds.includes(id)) errors.push(`printed field ${id} is missing from the online form`);
if (new Set(onlineIds).size !== onlineIds.length) errors.push('the online form repeats a field id');

if (errors.length) {
  console.error('VALIDATION FAIL: walk-through checklist');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`Checklist OK: 4 print pages; ${onlineIds.length} online fields, each with a printed label, none orphaned.`);
