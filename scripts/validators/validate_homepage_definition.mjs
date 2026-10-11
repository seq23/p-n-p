#!/usr/bin/env node
/**
 * AEO: the homepage answers "what is Porch & Party" in one 40-60 word paragraph
 * directly under the H1, and the WebPage node's SpeakableSpecification points at
 * it. Hard-fails when the paragraph moves, loses its opening, leaves the word
 * range, or when any speakable cssSelector does not resolve to exactly one
 * element; also requires the FAQPage node to remain.
 */
import fs from 'node:fs';

const html = fs.readFileSync('index.html', 'utf8');
const errors = [];
const fail = (m) => errors.push(m);
const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const m = html.match(/<\/h1>\s*<p([^>]*)>([\s\S]*?)<\/p>/i);
const id = m && (m[1].match(/\bid="([^"]+)"/) || [])[1];
if (!m) fail('no <p> directly follows the homepage </h1>');
else {
  const t = text(m[2]);
  const words = t.split(' ').filter((w) => /\w/.test(w)).length;
  if (!t.startsWith('Porch & Party is ')) fail(`definition paragraph must open "Porch & Party is ...", got "${t.slice(0, 40)}"`);
  if (words < 40 || words > 60) fail(`definition paragraph is ${words} words, not 40-60`);
  if (!id) fail('definition paragraph has no id for the speakable selector');
}

const nodes = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((x) => { try { return JSON.parse(x[1]); } catch { return {}; } });
const page = nodes.find((n) => n['@type'] === 'WebPage');
if (!nodes.some((n) => n['@type'] === 'FAQPage')) fail('FAQPage JSON-LD node is gone from the homepage');
const sel = page?.speakable?.['@type'] === 'SpeakableSpecification' ? page.speakable.cssSelector || [] : null;
if (!sel || !sel.length) fail('WebPage node has no SpeakableSpecification with a cssSelector');
else {
  for (const s of sel) {
    let count;
    if (/^#[\w-]+$/.test(s)) count = (html.match(new RegExp(`\\bid="${s.slice(1)}"`, 'g')) || []).length;
    else if (/^\.[\w-]+$/.test(s)) count = (html.match(new RegExp(`class="[^"]*\\b${s.slice(1)}\\b[^"]*"`, 'g')) || []).length;
    else { fail(`speakable selector ${s} is not a plain #id or .class this validator can resolve`); continue; }
    if (count !== 1) fail(`speakable selector ${s} resolves to ${count} elements, not 1`);
  }
  if (id && !sel.includes(`#${id}`)) fail(`speakable does not cover the definition paragraph #${id}`);
}

if (errors.length) { console.error(`homepage-definition: FAIL (${errors.length})`); errors.forEach((e) => console.error(`  - ${e}`)); process.exit(1); }
console.log(`homepage-definition: OK - #${id} under the H1, speakable ${JSON.stringify(sel)}, FAQPage present`);
