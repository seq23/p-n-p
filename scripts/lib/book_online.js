'use strict';
/**
 * "Book online" above the fold (owner ruling 21 Oct 2026: "we HAVE online booking ... it must be
 * prominently placed"). The /request form books every service and preselects one from
 * ?service=porch|party|grazing|rentals (functions/_lib/request-submit.mjs).
 *
 * applyBookOnline(html, svc) turns the first primary quote button above a page's first <h2>
 * into the big "Book online" button and keeps its old words as the line under the buttons.
 * Idempotent (a page that already carries data-book-online="hero" is returned unchanged) and
 * loud: a page with no primary /request button above its first <h2> throws.
 *
 * Used by scripts/generators/build_area_pages.js (all 32 city pages),
 * scripts/install_service_pages.js (home page) and checked by
 * scripts/validators/validate_service_pages.js.
 */
const path = require('path');
const offers = require(path.join(__dirname, '../../data/offers/services.json'));

const QUOTE = offers.quoteUrl;
const LABEL = 'Book online';
const href = (svc) => (svc ? `${QUOTE}?service=${svc}` : QUOTE);
const plain = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** The first "Book online" link to /request in <main> before the first <h2>, or null. */
function heroBookLink(html) {
  const main = html.indexOf('<main');
  if (main < 0) return null;
  const h2 = html.indexOf('<h2', main);
  const head = html.slice(main, h2 < 0 ? undefined : h2);
  const m = head.match(/<a\b[^>]*href="(\/request(?:\?[^"#]*)?(?:#[^"]*)?)"[^>]*>\s*Book online\s*<\/a>/);
  return m ? m[1] : null;
}

function applyBookOnline(html, svc, rel = 'page') {
  if (/data-book-online="hero"/.test(html)) return html;
  const main = html.indexOf('<main');
  const h2 = html.indexOf('<h2', main);
  if (main < 0 || h2 < 0) throw new Error(`${rel}: no <main> or no <h2> to put Book online above`);
  const head = html.slice(main, h2);
  const re = /<a\b([^>]*)class="btn-primary([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(head))) {
    const attrs = `${m[1]} ${m[3]}`;
    const hm = attrs.match(/href="([^"]*)"/);
    if (!hm || !/^\/request(?:[?#]|$)/.test(hm[1])) continue;
    const old = plain(m[4]);
    const at = main + m.index;
    const keepData = (attrs.match(/\sdata-quote-cta="[^"]*"/) || [''])[0];
    const btn = `<a href="${href(svc)}" class="btn-primary btn-book"${keepData} data-book-online="hero">${LABEL}</a>`;
    let out = html.slice(0, at) + btn + html.slice(at + m[0].length);
    // The old words become the line under the button row.
    const rowEnd = out.indexOf('</div>', at + btn.length);
    const line = `<p class="muted book-online-line" data-book-online-line>${old === LABEL ? 'Request a Quote' : old}: pick your date on the booking form and we reply within one business day.</p>`;
    out = out.slice(0, rowEnd + 6) + line + out.slice(rowEnd + 6);
    return out;
  }
  throw new Error(`${rel}: no primary /request button above the first <h2> to turn into Book online`);
}

module.exports = { LABEL, href, heroBookLink, applyBookOnline };
