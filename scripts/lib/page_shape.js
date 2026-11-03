'use strict';
/**
 * The shape of a page's opening paragraph, in ONE definition, measured the way
 * the owner's own sampler measures it.
 *
 * WHY
 * ---
 * Her Search Readiness Checklist item b4: a 40-60 word "X is ..." definition
 * under the h1. Item d1: the answer to the page's own question inside the first
 * 100 words. The weekly quality sample on 3 Nov 2026 failed 87 of the 99
 * published pages on b4 and 27 on d1 - "opening paragraph is 28 words and
 * defines nothing (needs 40-60, 'X is ...')" - including all five pages it
 * sampled.
 *
 * WHAT A GENERATOR DOES WITH IT
 * -----------------------------
 * Calls `assertLead(text, where)` on the lead it is about to write. A lead out
 * of shape fails the build at the generator, naming the page and the count,
 * rather than shipping a page the next Monday reports. That is the point: the
 * count is easy to get wrong by a word or two when the text is assembled from
 * prices and city names, and nobody counts by hand.
 *
 * HOW IT MEASURES
 * ---------------
 * Exactly as boss-os/src/shared/boss/searchReadiness/page-quality-sample.mjs
 * does, so passing here means passing there:
 *   - words are [A-Za-z0-9][\w'-]* runs, counted after the markup and the HTML
 *     entities are gone (so "Porch &amp; Party" is two words, not three);
 *   - the paragraph must hold a standalone "is" or "are" - a definition, not a
 *     list of services;
 *   - 40 to 60 words inclusive.
 * MIN/MAX live here and nowhere else.
 *
 * Guarded by npm run validate:page-shape, which re-measures every published
 * page, and by --self-test on this module's own counting.
 */
const MIN_WORDS = 40;
const MAX_WORDS = 60;
/** The sampler's own d1 test: the lead has to say something, not just name things. */
const ANSWER = /\b(is|are|means|costs?|takes?|requires?|depends|yes|no|can|should|will|must)\b/;
const DEFINES = /\b(is|are)\b/;

/** Visible words of a fragment of HTML, counted as the sampler counts them. */
function words(htmlOrText) {
  const text = String(htmlOrText)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&middot;/g, '.')
    .replace(/&ndash;|&mdash;/g, '-').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return text.match(/[A-Za-z0-9][\w'’-]*/g) || [];
}
const wordCount = (t) => words(t).length;

/** { ok, count, why } for one lead paragraph. Pure. */
function checkLead(text) {
  const count = wordCount(text);
  const defines = DEFINES.test(String(text).replace(/<[^>]+>/g, ' '));
  if (count < MIN_WORDS) return { ok: false, count, why: `${count} words, needs at least ${MIN_WORDS}` };
  if (count > MAX_WORDS) return { ok: false, count, why: `${count} words, needs at most ${MAX_WORDS}` };
  if (!defines) return { ok: false, count, why: `${count} words but defines nothing (needs a standalone "is" or "are": "X is ...")` };
  return { ok: true, count };
}

/** Throws unless `text` is a 40-60 word definition. `where` names the page. */
function assertLead(text, where) {
  const r = checkLead(text);
  if (!r.ok) throw new Error(`${where}: the opening paragraph is out of shape - ${r.why}. Checklist item b4 wants a 40-60 word "X is ..." definition under the h1; see scripts/lib/page_shape.js.`);
  return text;
}

module.exports = { MIN_WORDS, MAX_WORDS, ANSWER, DEFINES, words, wordCount, checkLead, assertLead };

// --- self-test: the counting itself, proven negatively ------------------------
if (require.main === module && process.argv.includes('--self-test')) {
  const probes = [
    ['entities are one word', 'Porch &amp; Party', 2],
    ['markup is not words', '<a href="/x">two words</a>', 2],
    ['hyphens hold together', 'hotel-room decor', 2],
  ];
  const bad = [];
  for (const [name, text, want] of probes) if (wordCount(text) !== want) bad.push(`${name}: counted ${wordCount(text)}, expected ${want}`);
  const forty = Array.from({ length: 40 }, (_, i) => (i === 1 ? 'is' : `w${i}`)).join(' ');
  const cases = [
    ['a 40-word definition passes', forty, true],
    ['39 words fails', forty.split(' ').slice(0, 39).join(' '), false],
    ['61 words fails', `${forty} ${Array.from({ length: 21 }, (_, i) => `x${i}`).join(' ')}`, false],
    ['40 words with no is/are fails', forty.replace(' is ', ' and '), false],
  ];
  for (const [name, text, want] of cases) if (checkLead(text).ok !== want) bad.push(`${name}: got ${checkLead(text).ok}`);
  let threw = false;
  try { assertLead('too short', 'probe'); } catch { threw = true; }
  if (!threw) bad.push('assertLead did not throw on a short lead');
  if (bad.length) { console.error(`page-shape self-test FAILED:\n- ${bad.join('\n- ')}`); process.exit(1); }
  console.log(`page-shape self-test OK: ${probes.length + cases.length + 1} probes, every bad lead refused.`);
}
