'use strict';
/**
 * The two provenance lines every published page carries, in ONE definition.
 *
 * WHY
 * ---
 * Her Search Readiness Checklist, items c6 and d4: a named author or reviewer is
 * visible, and the published / updated dates are visible. The weekly quality
 * sample on 3 Nov 2026 failed 86 of the 99 published pages on c6 and 18 on d4,
 * and all five pages it sampled carried "no named author or reviewer is visible".
 *
 * WHO WRITES THEM
 * ---------------
 * scripts/install_page_dates.js, the last pass in build:all. Nothing else.
 *
 * WHY THIS FILE EXISTS ANYWAY
 * ---------------------------
 * Because the generators do not run last. Re-rendering a page that already
 * carries these lines reverts it, which is the defect
 * scripts/generators/build_pages.js documents at length and the three
 * idempotency validators measure (validate:root-pages-idempotent,
 * validate:section-indexes-idempotent, validate:rentals, validate:service-pages:
 * "the rebuild rewrites it"). So every generator that re-renders an existing
 * published page calls `carry(fresh, before, rel)` as its last step, the same way
 * it already carries the Clarity loader and the related-pages block.
 *
 * `carry` is not a second source of truth: the dates come from
 * scripts/lib/article_schema.js (the lastmod ledger and the first-seen store,
 * never the build date), the byline is the constant below, and the placement
 * rules are the ones install_page_dates.js uses.
 *
 * THE BYLINE NAMES THE BUSINESS, NOT A PERSON
 * -------------------------------------------
 * config/entity.json: the business node carries no founder, "no private names in
 * public files". The owner's and the operator's names are not ours to publish, and
 * the brain's voice rule signs every P&P surface off as Porch & Party. So the
 * byline names the business, links to /about with rel="author" - the page that
 * says who we are - and claims nothing beyond the truth that these pages are
 * written and checked here.
 */
const { applyPageDates } = require('./article_schema');

/** The byline, identical on every page. Under 20 words on purpose: the quality
 * sample reads the first <p> of 20+ words under the h1 as the page's definition
 * (item b4), and a long byline would be read as that paragraph. */
// `muted` is the site's existing small-print class (assets/css/styles.css), so the
// line needs no new CSS and reads as the footnote it is.
const BYLINE = '<p class="page-byline muted" data-page-byline>Written and checked by <a rel="author" href="/about">Porch &amp; Party</a>, Memphis, TN.</p>';
const BYLINE_RE = /<p class="page-byline[^"]*" data-page-byline>[\s\S]*?<\/p>/;
const DATES_RE = /<p class="page-dates" data-page-dates>[\s\S]*?<\/p>/;

/**
 * The byline, immediately before the last </main>: after the page's content and
 * its related links, never at the top. The first paragraph under the h1 is the
 * page's direct answer (validate:content-pattern-contract measures it) and the
 * quality sample reads the first 100 words of the body for the answer to the
 * page's own question (item d1); a byline up there would displace both.
 *
 * Returns the html unchanged, and `false` for ok, when there is no </main>.
 */
function installByline(html) {
  const stripped = String(html).replace(BYLINE_RE, '');
  const at = stripped.lastIndexOf('</main>');
  if (at < 0) return { html: stripped, ok: false };
  return { html: stripped.slice(0, at) + BYLINE + stripped.slice(at), ok: true };
}

/** The date line goes after the lead paragraph under the h1, as install_page_dates puts it. */
function placeDates(html, line) {
  const h1 = /<h1[^>]*>[\s\S]*?<\/h1>/i.exec(html);
  if (!h1) return html;
  const afterH1 = h1.index + h1[0].length;
  const lead = /^\s*<p[^>]*>[\s\S]*?<\/p>/i.exec(html.slice(afterH1));
  const at = afterH1 + (lead ? lead[0].length : 0);
  return html.slice(0, at) + line + html.slice(at);
}

/**
 * A freshly rendered page, with its provenance put back: the dates in its
 * structured data, the visible date line it already had, and the byline.
 * Call it as the LAST step of a generator that re-renders a published page.
 */
function carry(fresh, before, rel) {
  let html = applyPageDates(String(fresh), rel);
  const dates = before && String(before).match(DATES_RE);
  if (dates && !DATES_RE.test(html)) html = placeDates(html, dates[0]);
  return installByline(html).html;
}

module.exports = { BYLINE, BYLINE_RE, DATES_RE, installByline, placeDates, carry };
