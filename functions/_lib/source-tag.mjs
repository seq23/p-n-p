// Where a visitor came from, for requests.source_tag (owner, 21 Nov 2026: "do the pnp tracking fix").
// Why: the Studio posts links tagged ?utm_source=<platform> (the web standard) and captions often link
// the bare home page, but /request only read ?src=, so all 8 requests since 1 Oct had no source.
// Order: ?src= (our own tags: mailer-38117, hotel, hoa ...), then ?utm_source=, then the site that
// sent the visit (Referer host). A visitor who lands on another page first and then opens /request
// is not counted yet: remembering the first touch belongs in the browser (page-shell inline script),
// never in the root middleware, whose HTML is edge-cached (validate_edge_cache_rule).
import { cleanSrc } from './request-form.mjs';

const OWN_HOSTS = ['porchandparty901.com', 'p-n-p.pages.dev'];

// Referer host -> tag. Structural (which site sent the visit), never a reading of anyone's words.
const REFERRERS = [
  ['instagram', ['instagram.com']],
  ['facebook', ['facebook.com', 'fb.com', 'fb.me', 'messenger.com']],
  ['tiktok', ['tiktok.com']],
  ['pinterest', ['pinterest.com', 'pin.it']],
  ['threads', ['threads.net', 'threads.com']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['nextdoor', ['nextdoor.com']],
  ['x', ['t.co', 'x.com', 'twitter.com']],
  ['linkedin', ['linkedin.com', 'lnkd.in']],
  ['google', ['google.com']],
  ['bing', ['bing.com']],
  ['duckduckgo', ['duckduckgo.com']],
  ['yahoo', ['yahoo.com']],
  ['chatgpt', ['chatgpt.com', 'chat.openai.com']],
  ['perplexity', ['perplexity.ai']],
];

function hostOf(value) {
  try { return new URL(String(value || '')).hostname.toLowerCase(); } catch { return ''; }
}
const isHost = (host, domain) => host === domain || host.endsWith(`.${domain}`);

export function tagFromReferer(referer) {
  const host = hostOf(referer);
  if (!host || OWN_HOSTS.some((d) => isHost(host, d))) return '';
  for (const [tag, domains] of REFERRERS) if (domains.some((d) => isHost(host, d))) return tag;
  // Any other outside site: its name without "www." (e.g. "memphisparent-com"), cleaned like ?src=.
  return cleanSrc(host.replace(/^www\./, '').replace(/\./g, '-'));
}

// The tag this one request carries, or '' when it carries none.
export function sourceOf(url, referer) {
  return cleanSrc(url.searchParams.get('src')) || cleanSrc(url.searchParams.get('utm_source')) || tagFromReferer(referer);
}
