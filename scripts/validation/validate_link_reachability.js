#!/usr/bin/env node
'use strict';
/**
 * validate:link-reachability (restored 10 Nov 2026, hostile review: rules 1 and 1b only, email_off).
 *
 * Cloudflare Email Address Obfuscation rewrites every mailto: anchor at the edge into
 * /cdn-cgi/l/email-protection#<hex>, which answers 404 to any client that does not run its
 * JavaScript (Ahrefs, 2026-09-17: 112 broken links, one per page via the footer), and wraps an
 * address written as plain prose in a NEW anchor to the same 404 (/privacy-policy, 2026-10-21).
 *   1.  every mailto: anchor on a published page sits inside <!--email_off--> ... <!--/email_off-->;
 *   1b. no email address survives in rendered text outside <!--email_off-->.
 * The published set is sitemap.xml. Rule 0: zero sitemap entries, fewer than 20 resolved pages,
 * or zero protected mailto: anchors is a hard failure.
 *
 * Usage: node scripts/validation/validate_link_reachability.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DOMAIN = 'https://porchandparty901.com';
const EMAIL_OFF_OPEN = '<!--email_off-->';
const EMAIL_OFF_CLOSE = '<!--/email_off-->';
const MIN_PUBLISHED = 20;

const sitemapPath = path.join(ROOT, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) { console.error('LINK REACHABILITY FAILED: sitemap.xml is missing, so there is no published set to check.'); process.exit(1); }
const locs = [...fs.readFileSync(sitemapPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(DOMAIN, ''));
if (!locs.length) { console.error('LINK REACHABILITY FAILED: sitemap.xml carries zero <loc> entries. The scan is broken, not the site.'); process.exit(1); }

function relForServedPath(p) {
  const bare = (p === '/' ? '/index' : p).replace(/\/$/, '').replace(/^\//, '');
  for (const candidate of [bare, `${bare}.html`, `${bare}/index.html`]) {
    if (candidate.endsWith('.html') && fs.existsSync(path.join(ROOT, candidate))) return candidate;
  }
  return null;
}
const pages = new Set(locs.map(relForServedPath).filter(Boolean));
if (pages.size < MIN_PUBLISHED) { console.error(`LINK REACHABILITY FAILED: resolved only ${pages.size} of ${locs.length} sitemap URL(s) to files, below the floor of ${MIN_PUBLISHED}. The read is broken, not the site.`); process.exit(1); }

const MAILTO_ANCHOR = /<a\b[^>]*\bhref=(["'])mailto:[^"']*\1[^>]*>[\s\S]*?<\/a>/gi;
const EMAIL_OFF_BLOCK = /<!--email_off-->[\s\S]*?<!--\/email_off-->/g;
const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;
const ANY_TAG = /<[^>]*>/g;
const ANY_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

let mailtoAnchors = 0;
let protectedAddresses = 0;
const unprotected = [];
const bareAddresses = [];
for (const rel of pages) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  MAILTO_ANCHOR.lastIndex = 0;
  let a;
  while ((a = MAILTO_ANCHOR.exec(html))) {
    mailtoAnchors += 1;
    const before = html.slice(Math.max(0, a.index - EMAIL_OFF_OPEN.length), a.index);
    const after = html.slice(a.index + a[0].length, a.index + a[0].length + EMAIL_OFF_CLOSE.length);
    if (before !== EMAIL_OFF_OPEN || after !== EMAIL_OFF_CLOSE) unprotected.push(`${rel}: ${a[0].slice(0, 80)}`);
    else protectedAddresses += 1;
  }
  const bareText = html.replace(EMAIL_OFF_BLOCK, ' ').replace(SCRIPT_OR_STYLE, ' ').replace(ANY_TAG, ' ');
  ANY_ADDRESS.lastIndex = 0;
  let addr;
  while ((addr = ANY_ADDRESS.exec(bareText))) {
    const at = addr.index;
    bareAddresses.push(`${rel}: ...${bareText.slice(Math.max(0, at - 40), at + addr[0].length + 10).replace(/\s+/g, ' ').trim()}...`);
  }
}
if (!mailtoAnchors || !protectedAddresses) {
  console.error(`LINK REACHABILITY FAILED: found ${mailtoAnchors} mailto: anchor(s), ${protectedAddresses} inside <!--email_off-->, across ${pages.size} published page(s). The footer publishes the contact address, so the read is broken, not the site.`);
  process.exit(1);
}
const failures = [
  ...bareAddresses.map((u) => `email address in rendered text outside <!--email_off-->, so Cloudflare will wrap it in its own 404 /cdn-cgi/l/email-protection anchor; write it as an opted-out mailto: anchor: ${u}`),
  ...unprotected.map((u) => `mailto: anchor outside <!--email_off-->, so Cloudflare will rewrite it into a 404 /cdn-cgi/l/email-protection link: ${u}`),
];
if (failures.length) {
  console.error(`LINK REACHABILITY FAILED: ${failures.length} problem(s) across ${pages.size} published page(s).`);
  for (const f of failures.slice(0, 50)) console.error(`- ${f}`);
  process.exit(1);
}
console.log(`Link reachability OK: ${pages.size} published page(s), ${mailtoAnchors} mailto: anchor(s) all inside <!--email_off-->, 0 email addresses in rendered text outside it.`);
