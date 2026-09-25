/**
 * The one place that decides what a public Porch & Party URL looks like.
 *
 * WHY THIS EXISTS
 * ---------------
 * Cloudflare Pages serves this repo from its root and rewrites requests before
 * it serves them. Verified live against porchandparty901.com on 2026-09-03:
 *
 *   GET /answers/grazing-tables-memphis.html  -> 308 /answers/grazing-tables-memphis
 *   GET /answers/grazing-tables-memphis       -> 200
 *   GET /index.html                           -> 308 /
 *   GET /answers                              -> 308 /answers/
 *   GET /answers/                             -> 200
 *
 * So the `.html` form of every page on this site is a redirect, and the
 * extensionless form is the URL that actually serves. Every producer in this
 * repo used to emit the `.html` form: the canonical link, og:url, the JSON-LD
 * `url`/`@id`, the sitemap `<loc>`, and every internal href. That made 112 of
 * 113 published pages tell Google "index this other URL", where that other URL
 * immediately 308s. The canonical tag is the strongest statement a page makes
 * about its own identity, and it was pointing at a redirect on every page but
 * the home page.
 *
 * The same defect class was confirmed on approvalprep.com on 2026-09-02, where
 * Search Console excluded 123 pages as "Page with redirect". The fix there was
 * a single shared href helper; this is that helper for this repo.
 *
 * Keep this module dependency-free: validators, generators and the normalizer
 * pass all require it, and they must agree by construction rather than by three
 * copies of the same regex staying in sync.
 */

const fs = require('fs');
const path = require('path');

const DOMAIN = 'https://porchandparty901.com';
// The directory Cloudflare Pages serves. Everything here is Node built-ins, so
// the module stays dependency-free.
const ROOT = path.resolve(__dirname, '..', '..');

const isFile = (rel) => {
  try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch { return false; }
};

/**
 * The slash form Cloudflare Pages answers 200 for an extensionless path.
 *
 * Verified live on 2026-09-25 against porchandparty901.com: `/answers`,
 * `/services`, `/areas`, `/local`, `/events` and `/faq` each answer 308 to the
 * trailing-slash URL, because each is served by `<dir>/index.html`. The link
 * graph carried 136 internal links to those six bare forms, every one of them a
 * redirect, because this module stripped `/index.html` correctly but never
 * asked whether a bare path was a directory. The reverse holds too: `/contact/`
 * 308s to `/contact`, because `contact.html` is a file, not a directory index.
 *
 * So the served form of a path depends on what is on disk, and this is where
 * that is decided:
 *   - `<p>.html` absent, `<p>/index.html` present -> `/p/`
 *   - `<p>.html` present, `<p>/index.html` absent -> `/p`
 *   - otherwise (neither, or both)                 -> unchanged
 */
function servedSlashForm(pathPart) {
  if (!pathPart || pathPart === '/' || !pathPart.startsWith('/')) return pathPart;
  const bare = pathPart.replace(/\/+$/, '').slice(1);
  if (!bare || /\.[a-z0-9]+$/i.test(bare)) return pathPart; // an asset, not a page
  const asFile = isFile(`${bare}.html`);
  const asDir = isFile(`${bare}/index.html`);
  if (asDir && !asFile) return `/${bare}/`;
  if (asFile && !asDir) return `/${bare}`;
  return pathPart;
}

/**
 * Map a repository-relative HTML file path to the site path that serves it 200.
 *   'index.html'                  -> '/'
 *   'answers/index.html'          -> '/answers/'
 *   'answers/grazing.html'        -> '/answers/grazing'
 * Anything that is not an .html file is returned as a rooted path unchanged.
 */
function sitePathForFile(relFile) {
  const rel = String(relFile).replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel === 'index.html') return '/';
  if (/(^|\/)index\.html$/.test(rel)) return `/${rel.replace(/(^|\/)index\.html$/, '$1')}`;
  if (rel.endsWith('.html')) return `/${rel.slice(0, -'.html'.length)}`;
  return `/${rel}`;
}

/** Absolute canonical URL for a repository-relative HTML file path. */
function siteUrlForFile(relFile) {
  return `${DOMAIN}${sitePathForFile(relFile)}`;
}

/**
 * Normalize an already-written link or URL to the form the origin serves 200.
 * Handles site-relative hrefs and absolute porchandparty901.com URLs, preserves
 * any `?query` and `#fragment`, and leaves external, mailto:, tel: and anchor
 * hrefs completely alone.
 */
function internalHref(href) {
  if (typeof href !== 'string' || !href) return href;
  if (/^(mailto:|tel:|javascript:|data:|#)/i.test(href)) return href;

  let prefix = '';
  let rest = href;
  if (href.startsWith(`${DOMAIN}/`) || href === DOMAIN) {
    prefix = DOMAIN;
    rest = href.slice(DOMAIN.length) || '/';
  } else if (/^(https?:)?\/\//i.test(href)) {
    return href; // some other origin; not ours to reshape
  } else if (!href.startsWith('/')) {
    return href; // relative path: leave alone rather than guess a base
  }

  const hash = rest.includes('#') ? rest.slice(rest.indexOf('#')) : '';
  let withoutHash = hash ? rest.slice(0, rest.length - hash.length) : rest;
  const query = withoutHash.includes('?') ? withoutHash.slice(withoutHash.indexOf('?')) : '';
  let pathPart = query ? withoutHash.slice(0, withoutHash.length - query.length) : withoutHash;

  if (pathPart === '/index.html') pathPart = '/';
  else if (/\/index\.html$/.test(pathPart)) pathPart = pathPart.replace(/index\.html$/, '');
  else if (pathPart.endsWith('.html')) pathPart = pathPart.slice(0, -'.html'.length);
  pathPart = servedSlashForm(pathPart);

  return `${prefix}${pathPart}${query}${hash}`;
}

/**
 * True when a link or URL is in a form this origin answers with a redirect
 * rather than with the page itself. This is the predicate the guard asserts on.
 */
function isRedirectingForm(href) {
  if (typeof href !== 'string' || !href) return false;
  if (/^(mailto:|tel:|javascript:|data:|#)/i.test(href)) return false;
  if (/^(https?:)?\/\//i.test(href) && !href.startsWith(DOMAIN)) return false;
  if (!href.startsWith('/') && !href.startsWith(DOMAIN)) return false;
  return internalHref(href) !== href;
}

// Absolute self-references anywhere in a document: canonical, og:url, twitter,
// and every JSON-LD `url`/`@id`/`item` string.
const ABSOLUTE_SELF = /https:\/\/porchandparty901\.com\/[^\s"'<>\\)]*/g;
// Site-relative link targets written as attributes.
const LINK_ATTR = /\b(href|content)=(["'])(\/[^"']*)\2/g;

/**
 * Rewrite every self-referential URL in a block of HTML to the 200-serving
 * form. Used by `templates/page-shell.js` as it renders, and by
 * `scripts/normalize_public_urls.js` for pages other producers wrote, so both
 * paths apply one definition instead of two.
 *
 * Additive only: it never removes markup, so it cannot strip the Clarity tag or
 * the related-pages block `validate:retrofit-integrity` protects.
 */
// An anchor whose href is a mailto:, with its element content.
const MAILTO_ANCHOR = /<a\b[^>]*\bhref=(["'])mailto:[^"']*\1[^>]*>[\s\S]*?<\/a>/gi;
const EMAIL_OFF_OPEN = '<!--email_off-->';
const EMAIL_OFF_CLOSE = '<!--/email_off-->';

/**
 * Keep the public email address a real mailto: link at the edge.
 *
 * THE DEFECT THIS CLOSES
 * ----------------------
 * Cloudflare's Email Address Obfuscation runs on this zone. Every
 * `<a href="mailto:hello@porchandparty901.com">` served from the origin is
 * rewritten at the edge into
 * `<a href="/cdn-cgi/l/email-protection#<hex>"><span class="__cf_email__">[email
 * protected]</span></a>`, and `/cdn-cgi/l/email-protection` answers 404 to
 * anything that does not run the accompanying JavaScript.
 *
 * Verified live on 2026-09-17: that URL returns 404, and it is present on every
 * page of this site because the address sits in the footer. Ahrefs reported it
 * as "Page has links to broken page" on 112 URLs on 2026-09-10 - one broken
 * destination, 112 source pages, which is the entire crawlable site.
 *
 * The obfuscation was also buying nothing. `hello@porchandparty901.com` is
 * already served in plain text inside the LocalBusiness JSON-LD on every page,
 * which Cloudflare does not rewrite, so a harvester reads it there regardless
 * while the human-facing anchor is the only thing degraded - and degraded
 * specifically for the answer engines this site is built to be cited by, which
 * see "[email protected]" where the contact address should be.
 *
 * `<!--email_off-->` is Cloudflare's own documented opt-out. Wrapping the anchor
 * leaves the mailto: intact end to end: the quote path through /contact is
 * untouched, and the email fallback beside it starts working for crawlers again.
 *
 * Idempotent: an anchor already inside the wrapper is left alone.
 */
function protectMailtoLinks(html) {
  return String(html).replace(MAILTO_ANCHOR, (anchor, _q, offset, whole) => {
    const before = whole.slice(Math.max(0, offset - EMAIL_OFF_OPEN.length), offset);
    if (before.endsWith(EMAIL_OFF_OPEN)) return anchor;
    return `${EMAIL_OFF_OPEN}${anchor}${EMAIL_OFF_CLOSE}`;
  });
}

function normalizeHtmlUrls(html) {
  if (DOMAIN !== 'https://porchandparty901.com') {
    throw new Error(`site_url DOMAIN changed to ${DOMAIN}; update ABSOLUTE_SELF to match.`);
  }
  return protectMailtoLinks(String(html)
    .replace(ABSOLUTE_SELF, (url) => internalHref(url))
    .replace(LINK_ATTR, (whole, attr, quote, value) => {
      const fixed = internalHref(value);
      return fixed === value ? whole : `${attr}=${quote}${fixed}${quote}`;
    }));
}

module.exports = {
  DOMAIN, sitePathForFile, servedSlashForm, siteUrlForFile, internalHref, isRedirectingForm,
  normalizeHtmlUrls, protectMailtoLinks, MAILTO_ANCHOR, EMAIL_OFF_OPEN, EMAIL_OFF_CLOSE
};
