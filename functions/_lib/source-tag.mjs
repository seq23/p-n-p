// Where a visitor came from, for requests.source_tag (owner, 21 Nov 2026: "do the pnp tracking fix").
// Why: the Studio posts links tagged ?utm_source=<platform> (the web standard) and captions often link
// the bare home page, but /request only read ?src=, so all 8 requests since 1 Oct had no source.
// Order: ?src= (our own tags: mailer-38117, hotel, hoa ...), then ?utm_source=, then the site that
// sent the visit (Referer host). A visitor who lands on another page first and then opens /request
// (owner's Open Loops row, 23 Nov 2026) is counted through the browser: the header script on every
// page (scripts/lib/site_chrome.js FIRST_TOUCH) remembers the last visit that came from outside the
// site, and the form sends it back in the hidden first_touch field (firstTouchOf below). Never in the
// root middleware, whose HTML is edge-cached (validate_edge_cache_rule).
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

// Short utm_source spellings some apps add on their own (Instagram's link in bio sends "ig"), so one
// channel is never counted under two names.
const UTM_ALIASES = { ig: 'instagram', insta: 'instagram', fb: 'facebook', meta: 'facebook', tt: 'tiktok', pin: 'pinterest', yt: 'youtube', twitter: 'x', li: 'linkedin' };
const utmTag = (raw) => { const t = cleanSrc(raw); return UTM_ALIASES[t] || t; };

// One visit's tag from its three signals: ?src=, then ?utm_source=, then the site that sent it.
const tagOf = (src, utm, referer) => cleanSrc(src) || utmTag(utm) || tagFromReferer(referer);

// The tag this one request carries, or '' when it carries none.
export function sourceOf(url, referer) {
  return tagOf(url.searchParams.get('src'), url.searchParams.get('utm_source'), referer);
}

// The visit the browser remembered for this tab (the form's hidden first_touch field): JSON
// {s: ?src=, u: ?utm_source=, r: the sending site's host name}, written by FIRST_TOUCH in
// scripts/lib/site_chrome.js. Client-sent, so read as hostile: over FIRST_TOUCH_MAX characters, not
// JSON, not three strings or a host that is not a plain host name -> ''; the result goes through the
// same rules as a visit to /request, so it is only ever [a-z0-9-], at most 40 characters.
export const FIRST_TOUCH_MAX = 600;
const HOST_RE = /^[a-z0-9.-]{1,253}$/i;
export function firstTouchOf(raw) {
  const text = typeof raw === 'string' ? raw : '';
  if (!text || text.length > FIRST_TOUCH_MAX) return '';
  let t;
  try { t = JSON.parse(text); } catch { return ''; }
  if (!t || typeof t !== 'object' || Array.isArray(t)) return '';
  const str = (v) => (typeof v === 'string' ? v : '');
  const host = str(t.r);
  return tagOf(str(t.s), str(t.u), HOST_RE.test(host) ? `https://${host}/` : '');
}
