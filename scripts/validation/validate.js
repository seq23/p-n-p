#!/usr/bin/env node
// validate:llm-surfaces (restored 10 Nov 2026, hostile review: legal and disclosure rules only).
//  - no page and no llms file says "insured" (the business is not insured);
//  - the legal name Kerseta appears in visible text only on the Terms and the Privacy Policy;
//  - the Terms keep "Reply STOP to opt out" and "Message and data rates may apply" (text consent);
//  - the Privacy Policy keeps #privacy-choices with the Microsoft Clarity opt-out;
//  - every page links the Privacy Policy.
// Blocking: runs in validate:all (validate:pnp-phase, validate:release).
const fs = require('fs');
const path = require('path');
const { EXCLUDE: UNPUBLISHED } = require('../lib/unpublished');

const root = path.resolve(__dirname, '..', '..');
const errors = [];
const fail = (msg) => errors.push(msg);

function walk(dir, acc = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.pages-output', 'node_modules', '.git'].includes(item.name)) continue;
    if (dir === root && UNPUBLISHED.has(item.name)) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) walk(full, acc);
    else if (item.isFile() && item.name.endsWith('.html')) acc.push(full);
  }
  return acc;
}
const readRoot = (rel) => (fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : '');

const htmlFiles = walk(root);
if (!htmlFiles.length) { console.error('VALIDATION FAIL: zero HTML pages found; nothing was checked'); process.exit(1); }
for (const file of htmlFiles) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const html = fs.readFileSync(file, 'utf8');
  const visible = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
  const legalPage = rel === 'terms-and-conditions.html' || rel === 'privacy-policy.html';
  if (!legalPage && /Kerseta/i.test(visible)) fail(`${rel} names Kerseta in visible text; only the Terms and the Privacy Policy may`);
  if (/\binsured\b/i.test(html)) fail(`${rel} says "insured"; the business is not insured`);
  if (!/href=["']\/privacy-policy(\.html)?["']/i.test(html)) fail(`${rel} missing privacy link`);
}
const llmsFiles = ['llms.txt', 'llms-full.txt', 'llms-entities.txt', 'llms-answers.txt', 'llms-services.txt', 'site.webmanifest'];
for (const rel of llmsFiles) if (/\binsured\b/i.test(readRoot(rel))) fail(`${rel} says "insured"; the business is not insured`);
if (!readRoot('llms.txt')) fail('llms.txt is missing; the "insured" check read nothing');

const terms = readRoot('terms-and-conditions.html');
if (!/Reply STOP to opt out/.test(terms) || !/Message and data rates may apply/.test(terms)) fail('terms-and-conditions.html lacks the text-message consent clause (Reply STOP to opt out, Message and data rates may apply)');
const privacy = readRoot('privacy-policy.html');
if (!/<h2 id="privacy-choices">/.test(privacy) || !/Microsoft Clarity/.test(privacy) || !/opt out/i.test(privacy)) fail('privacy-policy.html lacks the #privacy-choices section (Microsoft Clarity, how to opt out)');

if (errors.length) { for (const e of errors) console.error(`VALIDATION FAIL: ${e}`); process.exit(1); }
console.log(`LLM surfaces OK: ${htmlFiles.length} HTML files and ${llmsFiles.length} llms files checked (insured, Kerseta, text consent, Clarity opt-out, privacy link).`);
