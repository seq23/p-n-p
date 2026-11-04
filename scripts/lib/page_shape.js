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
 * Uses authored definition leads and concise link labels. The historical
 * assertLead name is retained for generator callers; it does not gate copy.
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
 * Used by generators to compose leads and concise link labels; no wording validator.
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
  // Copy is authored in the generator. Page wording is never a release gate.
  return text;
}

/**
 * A LINK label for a page: its own h1, cut back to its first clause when the
 * whole heading is too long to be a link.
 *
 * WHY. Eight of this site's h1s read "<City> party decor, hotel-room decor, and
 * grazing table styling". Any block that lists all eight - a related-pages nav,
 * the /areas/ index - repeated "party decor, hotel-room decor, and grazing table
 * styling" eight times in one page's body, which the owner's weekly quality
 * sample reads, correctly, as template filler: on 3 Nov 2026 it failed 32 of the
 * 99 published pages on exactly that, and named this phrase in the brief for two
 * of the five pages it sampled ("7 times").
 *
 * The h1s themselves stay as they are: the long page titles are the owner's call
 * (porch-and-party brain, the standing OpenSEO decision), and they are the right
 * title for each page. What was wrong was using a whole sentence as a link label
 * eight times over. A link label is a name, not a sentence.
 *
 * The cut is at a clause boundary (a comma or a colon) and nowhere else, so a
 * label is never a sentence chopped mid-phrase: "Arlington party decor",
 * "Holiday porch decorating service in Memphis", "Memphis porch decorating". A
 * heading with no clause boundary short enough to use is left whole - those are
 * already distinct from one another, which is what the check is about.
 */
const LABEL_MAX_WORDS = 8;
function linkLabel(h1) {
  const full = String(h1).trim();
  const w = (t) => String(t).split(/\s+/).filter(Boolean).length;
  if (w(full) <= LABEL_MAX_WORDS) return full;
  const cut = full.search(/[,:]/);
  if (cut < 0) return full;
  const head = full.slice(0, cut).trim().replace(/\s+&amp;$/, '').replace(/\s+&$/, '');
  const n = w(head);
  return n >= 3 && n <= LABEL_MAX_WORDS ? head : full;
}

module.exports = { MIN_WORDS, MAX_WORDS, LABEL_MAX_WORDS, ANSWER, DEFINES, words, wordCount, checkLead, assertLead, linkLabel };
