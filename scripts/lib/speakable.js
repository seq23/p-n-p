'use strict';
/**
 * Speakable (search-readiness checklist item c4): the answer-first block and the
 * FAQ a voice assistant or AI reader may read aloud, named on the page's own
 * JSON-LD node as a SpeakableSpecification whose cssSelector resolves on the page.
 *
 * One list for every writer: templates/page-shell.js (new guide / answer pages),
 * scripts/generators/build_focus_pages.js (the hotel guides) and the
 * structured-data pass (scripts/install_structured_data.js), which gives every
 * already-published page the same markup without re-rendering it.
 *
 * The weekly page-quality sample (boss-os searchReadiness/page-quality-sample.mjs)
 * failed /guides/graduation-party-decorations-at-home-memphis on 17 Nov 2026 with
 * "a guide page with no speakable markup": the shell made speakable opt-in per
 * entry and almost no entry opted in.
 */

// In reading order: the answer block first, then the FAQ.
const CANDIDATES = ['#recommendation-summary', '.service-answer', '.porch-faq', '.faq-list'];
// What templates/page-shell.js always renders (recommendation summary + FAQ list).
const SHELL_DEFAULT = ['#recommendation-summary', '.porch-faq'];
// What the focus / hotel pages always render.
const FOCUS_DEFAULT = ['.service-answer', '.faq-list'];
// What the /rentals/ page renders (scripts/generators/build_rentals_page.js): its FAQ list.
const RENTALS_DEFAULT = ['.faq-list'];

const ARTICLE_TYPES = ['Article', 'BlogPosting', 'NewsArticle'];
const PAGE_TYPES = ['WebPage', 'CollectionPage', 'AboutPage', 'ItemPage', 'ProfilePage'];
const JSONLD = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g;
const typesOf = (n) => [].concat((n && n['@type']) || []);

/** True when a simple #id or .class selector matches an element in the html (the sampler's own rule). */
function resolves(html, selector) {
  const m = String(selector).match(/^([.#])([\w-]+)$/);
  if (!m) return false;
  return (m[1] === '#' ? new RegExp(`id=["']${m[2]}["']`) : new RegExp(`class=["'][^"']*\\b${m[2]}\\b`)).test(html);
}

const selectorsFor = (html) => CANDIDATES.filter((s) => resolves(html, s));

/**
 * Add a SpeakableSpecification to the page's own node (WebPage family, else the
 * Article) when the page has none and at least one candidate block resolves.
 * Idempotent; returns html unchanged when there is nothing to do.
 */
function applySpeakable(html, rel) {
  if (/"SpeakableSpecification"/.test(html)) return html;
  const selectors = selectorsFor(html);
  if (!selectors.length) return html;
  const blocks = [...html.matchAll(JSONLD)];
  const parsed = blocks.map((b) => { try { return JSON.parse(b[2]); } catch (e) { throw new Error(`${rel}: unparseable JSON-LD block (${e.message})`); } });
  // The page node first; an Article only when no page node exists.
  for (const want of [PAGE_TYPES, ARTICLE_TYPES]) {
    for (let i = 0; i < blocks.length; i++) {
      let done = false;
      const visit = (n) => {
        if (done) return n;
        if (Array.isArray(n)) return n.map(visit);
        if (!n || typeof n !== 'object') return n;
        if (typesOf(n).some((t) => want.includes(t))) { done = true; return { ...n, speakable: { '@type': 'SpeakableSpecification', cssSelector: selectors } }; }
        const o = {};
        for (const [k, v] of Object.entries(n)) o[k] = visit(v);
        return o;
      };
      const next = visit(parsed[i]);
      if (!done) continue;
      const [whole, open, body, close] = blocks[i];
      const lead = body.match(/^\s*/)[0];
      const trail = body.match(/\s*$/)[0];
      const pretty = /^\{\s*\n(\s+)"/.exec(body.trim());
      const replaced = `${open}${lead}${pretty ? JSON.stringify(next, null, pretty[1].length) : JSON.stringify(next)}${trail}${close}`;
      return html.slice(0, blocks[i].index) + replaced + html.slice(blocks[i].index + whole.length);
    }
  }
  return html;
}

module.exports = { CANDIDATES, SHELL_DEFAULT, FOCUS_DEFAULT, RENTALS_DEFAULT, resolves, selectorsFor, applySpeakable };
