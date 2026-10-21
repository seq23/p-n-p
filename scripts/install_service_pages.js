#!/usr/bin/env node
'use strict';
/**
 * The three hand-maintained service pages (owner ruling 21 Oct 2026: exactly four services, one
 * strong page each; the fourth, /rentals/, is rendered by scripts/generators/build_rentals_page.js).
 *
 * For services/porch-decorating, services/celebration-setups and services/grazing-and-event-styling:
 *   - the hero (eyebrow + h1) moves above the recommendation summary, and its intro becomes the
 *     direct answer (price + what you get) with the big "Book online" button
 *     (<!--service-hero-->, scripts/lib/service_pages.js heroBlock);
 *   - before the closing call-to-action band: the named sub-sections (#hotel-room-setups on the
 *     party page), the registered AI pictures, the FAQ and "Book online" again
 *     (<!--service-page-->, bodyBlock);
 *   - the FAQPage JSON-LD is the visible FAQ, question for question;
 *   - the title / h1 the page targets, where the registry sets one.
 * And the home page's first quote button becomes "Book online" (scripts/lib/book_online.js).
 *
 * Idempotent: a second run writes nothing. Every substitution is asserted, so a page whose
 * shape changed fails loudly. Checked by scripts/validators/validate_service_pages.js.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SP = require(path.join(ROOT, 'scripts/lib/service_pages.js'));
const BO = require(path.join(ROOT, 'scripts/lib/book_online.js'));

const HEADS = {
  party: { h1: 'Party decorations and hotel room setups across the Memphis metro area.', from: 'Celebration setups for homes and hotel rooms across the Memphis metro area.' },
  grazing: { h1: 'Grazing tables and charcuterie tables across the Memphis metro area.', from: 'Styled event decor and grazing-table presentation across the Memphis metro area.' },
};
const SERVICE_NAMES = { grazing: ['Styled Event Decor & Grazing Tables', 'Grazing Tables'] };

const HERO_RE = /<p class="service-answer"[^>]*>[\s\S]*?<!--\/service-hero-->/;
const BODY_RE = /<!--service-page-->[\s\S]*?<!--\/service-page-->/;
const REC_RE = /<div class="info-panel recommendation-summary"[^>]*>[\s\S]*?<\/div>/;
const HERO_DIV_RE = /<div><span class="eyebrow">[^<]*<\/span><h1>[\s\S]*?<\/h1>[\s\S]*?<\/div><\/div>/;
const FAQ_LD_RE = /<script type="application\/ld\+json">\{"@context":"https:\/\/schema.org","@type":"FAQPage"[\s\S]*?<\/script>/;
const CTA = '<section class="section cta-band">';

function must(cond, msg) { if (!cond) throw new Error(msg); }

function servicePage(p, html) {
  const rel = p.file;
  // 1. Title and h1 the page targets.
  if (p.title) {
    const cur = html.match(/<title>([^<]*)<\/title>/)[1];
    if (cur !== p.title) {
      const head = html.slice(0, html.indexOf('</head>'));
      const rest = html.slice(head.length);
      html = head.split(`content="${cur}"`).join(`content="${p.title}"`).replace(`<title>${cur}</title>`, `<title>${p.title}</title>`) + rest;
    }
  }
  const hd = HEADS[p.key];
  if (hd && html.includes(hd.from)) html = html.split(hd.from).join(hd.h1);
  const sn = SERVICE_NAMES[p.key];
  if (sn) html = html.split(`"name":"${sn[0]}"`).join(`"name":"${sn[1]}"`);
  // 2. Hero: direct answer + Book online, above the recommendation summary.
  if (HERO_RE.test(html)) html = html.replace(HERO_RE, () => SP.heroBlock(p));
  else {
    const m = html.match(HERO_DIV_RE);
    must(m, `${rel}: no hero (eyebrow + h1) block`);
    const inner = m[0].replace(/(<\/h1>)[\s\S]*?(<\/div><\/div>)$/, (_, a) => `${a}${SP.heroBlock(p)}</div>`);
    must(inner !== m[0], `${rel}: hero intro + button row not found`);
    html = html.replace(m[0], () => inner);
  }
  const rec = html.match(REC_RE);
  const hero = html.match(/<div><span class="eyebrow">[^<]*<\/span><h1>[\s\S]*?<!--\/service-hero--><\/div>/);
  must(hero, `${rel}: hero not found after install`);
  if (rec && html.indexOf(rec[0]) < html.indexOf(hero[0])) {
    html = html.replace(hero[0], '');
    html = html.replace(rec[0], () => hero[0] + rec[0]);
  }
  // 3. Sub-sections, pictures, FAQ and Book online again, before the closing CTA band.
  const body = SP.bodyBlock(p);
  if (BODY_RE.test(html)) html = html.replace(BODY_RE, () => body);
  else {
    must(html.includes(CTA), `${rel}: no cta-band to put the service block before`);
    html = html.replace(CTA, () => `${body}\n${CTA}`);
  }
  // 4. FAQPage JSON-LD = the visible FAQ.
  must(FAQ_LD_RE.test(html), `${rel}: no FAQPage JSON-LD to replace`);
  html = html.replace(FAQ_LD_RE, () => `<script type="application/ld+json">${JSON.stringify(SP.faqJsonLd(p))}</script>`);
  return html;
}

function main() {
  let written = 0;
  const write = (rel, after) => {
    const abs = path.join(ROOT, rel);
    if (fs.readFileSync(abs, 'utf8') !== after) { fs.writeFileSync(abs, after); written += 1; }
  };
  for (const p of SP.PAGES.filter((x) => !x.generated)) write(p.file, servicePage(p, fs.readFileSync(path.join(ROOT, p.file), 'utf8')));
  write('index.html', BO.applyBookOnline(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), null, 'index.html'));
  console.log(`service pages: ${SP.PAGES.length} pages (${SP.PAGES.filter((x) => !x.generated).length} installed here + home), ${written} file(s) written`);
}

module.exports = { servicePage };
if (require.main === module) main();
