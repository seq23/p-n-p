'use strict';

// Record the step where a visitor fills a form or buys. A link to /request
// alone does not make an informational page that step.
function formOrBuy(html) {
  const markup = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  if (/<form\b/i.test(markup)) return true;
  for (const m of markup.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi)) {
    try {
      const url = new URL((m[1] ?? m[2] ?? m[3]).replace(/&amp;/g, '&'), 'https://porchandparty901.com/');
      if (!/^https?:$/.test(url.protocol)) continue;
      if (/(^|\.)(gumroad\.com|stripe\.com|paypal\.com|lemonsqueezy\.com|square\.link|checkout\.shopify\.com)$/.test(url.hostname)
        || /\/(checkout|cart|buy|order|book(ing)?)(\/|$)/i.test(url.pathname)) return true;
    } catch { /* Invalid destinations cannot be checkout links. */ }
  }
  return false;
}

// The rentals generator added a newline with its carried loader. Remove that
// newline too, so the page still equals a fresh render without the loader.
const LOADER = /<script\b[^>]*\bdata-clarity-loader\b[^>]*>[\s\S]*?<\/script>(?:\r?\n)?/gi;
const stripLoader = (html) => String(html).replace(LOADER, '');
module.exports = { formOrBuy, stripLoader };
