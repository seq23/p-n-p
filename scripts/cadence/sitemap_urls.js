'use strict';
/**
 * The sitemap URL inventory the cadence gate reasons over.
 *
 * Extracted so that cadence_gate.js and cadence_accept.js cannot disagree about
 * what the library contains. They used to be the same code in one file because
 * the gate advanced the ledger itself; now that accepting is a separate,
 * deliberate command, both sides have to read the world the same way or an
 * acceptance would record a different URL set than the one that was blocked on.
 */
const fs = require('fs');
const path = require('path');
const { internalHref } = require('../lib/site_url.js');

/**
 * The identity of a page, as opposed to the spelling of its URL.
 *
 * The cadence ledger records which pages the library already contained, and the
 * gate calls a sitemap URL "new" when the ledger has not seen it. That
 * comparison used to be a raw string match, which quietly defined a page's
 * identity as the exact characters of its URL. It held only for as long as
 * nobody changed how a URL is written.
 *
 * On 2026-09-02 the canonical fix (#12) changed how every URL on this origin is
 * written - `/x.html` became `/x`, because `/x.html` is a 308 - and the ledger,
 * still holding the `.html` spelling of the same 112 pages, made 105 unchanged
 * pages read as newly published. The gate blocked `Deploy Distribution` on a
 * publishing spree that never happened, and no amount of re-running could clear
 * it because nothing had actually been published.
 *
 * A page is therefore identified by the URL this origin serves for it, derived
 * from `scripts/lib/site_url.js` - the same single definition the canonical,
 * og:url, sitemap and href producers use. Re-spelling a URL is not a
 * publication; publishing a route that did not exist still is.
 */
function pageIdentity(url) {
  return internalHref(String(url || '').trim());
}

/** The identity set of a list of URLs, for `has()` membership tests. */
function identitySet(urls) {
  return new Set([...(urls || [])].map(pageIdentity));
}

/**
 * The URLs in `urls` naming a page the ledger has not seen before.
 *
 * This is the one comparison the weekly publication cap rests on, so it lives
 * here rather than being written out twice: cadence_gate.js decides what to
 * block on it and cadence_accept.js decides what to record on it, and if those
 * two ever disagreed an acceptance would enter a different set than the one
 * that was blocked. `validate:cadence-ledger-identity` proves this function
 * against fixtures and proves both callers still route through it.
 */
function newSinceLedger(urls, ledgerUrls) {
  const known = identitySet(ledgerUrls);
  return [...(urls || [])].filter((u) => !known.has(pageIdentity(u)));
}

function sitemapUrls(ROOT) {
  const found = new Map();
  const walk = (dir, depth = 0) => {
    if (depth > 4) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (/^(node_modules|\.git|\.pages-output|coverage)$/.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/^sitemap.*\.xml$/i.test(e.name)) {
        const xml = fs.readFileSync(full, 'utf8');
        for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
          const loc = (m[1].match(/<loc>(.*?)<\/loc>/) || [])[1];
          if (!loc) continue;
          const lm = (m[1].match(/<lastmod>(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
          const prev = found.get(loc);
          if (prev === undefined || (lm && (!prev || lm > prev))) found.set(loc, lm);
        }
      }
    }
  };
  walk(ROOT);
  return found;
}

module.exports = {
  sitemapUrls,
  pageIdentity,
  identitySet,
  newSinceLedger,
  LEDGER_REL: 'data/cadence/known_urls.json',
};
