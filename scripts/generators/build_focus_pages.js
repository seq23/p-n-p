#!/usr/bin/env node
'use strict';
/**
 * Renders the two focused landing pages (owner approval 21 Oct 2026; registry and data in
 * scripts/lib/focus_pages.js): services/hotel-room-decor-memphis.html (rebuilt in place, same
 * URL) and rentals/giant-lawn-games-memphis.html. Out of the header and footer nav.
 *
 * Shape: breadcrumb (Home / parent service / page) -> direct answer with the data price and the
 * big "Book online" button above the first <h2> -> named sections -> registered AI pictures
 * (no captions) -> 6-question FAQ (FAQPage JSON-LD = the visible FAQ) -> "Book online" again ->
 * back to the parent service page. Service + BreadcrumbList JSON-LD.
 *
 * Like build_rentals_page.js, the blocks later passes own (Clarity loader, related-pages nav)
 * are carried over from disk, so a re-run is byte-identical. Also rewrites the
 * "Focused pages" section of llms.txt, llms-services.txt and llms-full.txt.
 * --check exits 1 when any file would change.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const { nav, footer, quoteEventScript } = require(path.join(ROOT, 'templates/page-shell.js'));
const { normalizeHtmlUrls } = require(path.join(ROOT, 'scripts/lib/site_url.js'));
const contactSurface = require(path.join(ROOT, 'scripts/lib/contact_surface.js'));
const siteIcons = require(path.join(ROOT, 'scripts/lib/site_icons.js'));
const SP = require(path.join(ROOT, 'scripts/lib/service_pages.js'));
const FP = require(path.join(ROOT, 'scripts/lib/focus_pages.js'));

const { esc, DOMAIN } = FP;
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;

function render(p) {
  const parent = FP.parentOf(p.parent);
  const url = `${DOMAIN}${p.url}`;
  const imgs = FP.imagesFor(p.key);
  const og = imgs[0];
  const faqs = p.faq();
  const secs = p.sections().map((s) => `<div class="info-panel" id="${s.id}"><h2>${s.h2}</h2>${s.body}</div>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${p.title}</title>
  <meta name="description" content="${esc(p.description)}" />
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
  <link rel="canonical" href="${url}" />
  <meta property="og:title" content="${p.title}" />
  <meta property="og:description" content="${esc(p.description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${url}" />
  <meta property="og:site_name" content="Porch &amp; Party" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:image" content="${DOMAIN}/${og.file}" />
  <meta property="og:image:alt" content="${esc(og.alt)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${p.title}" />
  <meta name="twitter:description" content="${esc(p.description)}" />
  <meta name="twitter:image" content="${DOMAIN}/${og.file}" />
  ${siteIcons.HEAD_ICON_LINKS}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Great+Vibes&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/styles.css" />
  <link rel="stylesheet" href="/assets/css/site-nav.css" data-site-chrome="css" />
  ${ld({ '@context': 'https://schema.org', '@type': 'WebPage', name: p.title.replace(/&amp;/g, '&'), description: p.description.replace(/&amp;/g, '&'), url, primaryImageOfPage: `${DOMAIN}/${og.file}`, publisher: { '@id': `${DOMAIN}/#business` } })}
  ${ld(FP.serviceJsonLd(p))}
  ${ld(FP.faqJsonLd(p))}
  ${ld(FP.breadcrumbJsonLd(p))}
</head>
<body>
  ${nav(p.url)}
  <main>
    <div class="breadcrumb-bar"><div class="container"><nav class="breadcrumb" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="${parent.url}">${esc(parent.name)}</a></li><li aria-current="page">${esc(p.crumb)}</li></ol></nav></div></div>
    <!--focus-page--><section class="section" data-focus-page="${p.key}">
      <div class="container">
        <div class="page-intro">
          <span class="eyebrow">${esc(p.eyebrow)}</span>
          <h1>${esc(p.h1)}</h1>
          <p class="service-answer" data-service-answer="${p.key}">${p.answer}</p>
          <div class="btn-row hero-centered-cta">${SP.bookButton(p.request, 'hero')}<a href="/pricing" class="btn-secondary">See Pricing</a></div>
          <p class="muted book-online-line" data-book-online-line>Request a Quote: pick your date on the booking form and we reply within one business day.</p>
          <p class="muted" data-parent-link>Part of our <a href="${parent.url}">${esc(parent.name.toLowerCase())}</a> service.</p>
        </div>
        <div class="content-stack" style="margin-top:28px;">${secs}</div>
        ${SP.gallery(p.key)}
        <div class="answer-block" id="service-faq" style="margin-top:40px;"><span class="eyebrow">FAQ</span><h2>${esc(p.crumb)} questions</h2></div>
        <div class="faq-list">${faqs.map(([q, a]) => `<div class="faq-item"><h3>${esc(q)}</h3><p>${esc(a)}</p></div>`).join('')}</div>
        <div class="btn-row centered-cta-row" style="margin-top:24px;">${SP.bookButton(p.request, 'after-faq')}<a href="${parent.url}" class="btn-secondary" data-parent-link>All ${esc(parent.name.toLowerCase())}</a></div>
        <p class="muted" style="text-align:center;">Request a Quote: pick your date on the booking form and we reply within one business day.</p>
      </div>
    </section><!--/focus-page-->
  </main>
  ${footer()}
  ${quoteEventScript()}
</body>
</html>
`;
}

function finalHtml(p, before) {
  let html = contactSurface.applyContactSurface(normalizeHtmlUrls(render(p)), p.file);
  if (typeof html !== 'string') html = html.html;
  const CLARITY = /<script data-clarity-loader>[\s\S]*?<\/script>/;
  const loader = before && before.match(CLARITY);
  if (loader) html = html.replace("</head>", () => `${loader[0]}</head>`);
  const RELATED = /<section[^>]+data-nav="related-pages"[\s\S]*?<\/section>/i;
  const related = before && before.match(RELATED);
  if (related) html = html.replace('</main>', () => `${related[0]}</main>`);
  // Same carry-over as the Clarity loader and the related-pages block, for the two
  // passes that run after every generator in build:all: the social-card tags
  // (scripts/install_social_tags.js: og:site_name and the og:image size measured
  // from the file) and the visible published/updated line
  // (scripts/install_page_dates.js). Without this, re-rendering a focused page
  // stripped both and validate:service-pages' "equals a fresh run" check failed
  // against the committed file every time.
  const SOCIAL = /<meta property="og:(?:site_name|image:width|image:height)" content="[^"]*" \/>/g;
  // One insert, keeping the order the tags were in, so a re-render is byte-identical.
  const social = ((before && before.match(SOCIAL)) || []).filter((tag) => !html.includes(tag));
  if (social.length) html = html.replace(/(<meta\b[^>]*\bproperty="og:image"[^>]*>)/i, `$1\n${social.join('\n')}`);
  const DATES = /<p class="page-dates" data-page-dates>[\s\S]*?<\/p>/;
  const dates = before && before.match(DATES);
  if (dates && !DATES.test(html)) html = html.replace(/<\/h1>/i, () => `</h1>${dates[0]}`);
  return html;
}

// ---- llms: one "Focused pages" section, before "## Party game rentals".
const LLMS = ['llms.txt', 'llms-services.txt', 'llms-full.txt'];
const LLMS_HEAD = '## Focused pages (inside the four services)';
function llmsSection() {
  const lines = FP.PAGES.map((p) => {
    const parent = FP.parentOf(p.parent);
    return `- ${p.h1}: ${DOMAIN}${p.url} (part of ${parent.name.toLowerCase()}, ${DOMAIN}${parent.url}). ${p.answer.replace(/&amp;/g, '&')}`;
  });
  return `${LLMS_HEAD}\n${lines.join('\n')}\n\n`;
}
function llmsRender(text, rel) {
  const re = new RegExp(`${LLMS_HEAD.replace(/[()]/g, '\\$&')}\\n[\\s\\S]*?\\n\\n`);
  if (re.test(text)) return text.replace(re, () => llmsSection());
  const at = text.indexOf('## Party game rentals');
  if (at < 0) throw new Error(`${rel}: no "## Party game rentals" section to put the focused pages before`);
  return text.slice(0, at) + llmsSection() + text.slice(at);
}

function plan() {
  const out = [];
  for (const p of FP.PAGES) {
    const abs = path.join(ROOT, p.file);
    const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    out.push([p.file, before, finalHtml(p, before)]);
  }
  for (const rel of LLMS) {
    const before = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    out.push([rel, before, llmsRender(before, rel)]);
  }
  return out;
}

module.exports = { render, finalHtml, llmsRender, llmsSection, plan };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const changed = plan().filter(([, b, a]) => b !== a);
  if (check) {
    if (changed.length) { console.error(`focus pages: ${changed.map(([r]) => r).join(', ')} would change (run node scripts/generators/build_focus_pages.js)`); process.exit(1); }
    console.log('focus pages: up to date');
  } else {
    for (const [rel, , after] of changed) { fs.mkdirSync(path.dirname(path.join(ROOT, rel)), { recursive: true }); fs.writeFileSync(path.join(ROOT, rel), after); }
    console.log(`focus pages: ${FP.PAGES.length} pages + ${LLMS.length} llms files, ${changed.length} written`);
  }
}
