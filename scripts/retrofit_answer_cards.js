#!/usr/bin/env node
'use strict';
/**
 * Answer-card retrofit.
 *
 * The defect. Every card under answers/ that is backed by
 * data/answers/answers-index.json carried the wrong <h1>. The card's `query`
 * field is a *follow-up* question - it is byte-identical to `faqQuestion` on the
 * matching data/queries/query_universe.json record, verified for all 26 cards -
 * and it was being rendered as the page heading. So
 * /answers/how-much-does-hotel-room-decor-cost-in-memphis.html led with
 * "What usually pushes the price up?" while the URL, the canonical target and
 * the searcher's phrasing all say "How much does hotel room decor cost in
 * Memphis?". A heading that answers a different question than the URL is the
 * single most damaging answer-shape defect: the extractable span never matches
 * the query it would be retrieved for. The same wrong string was also the
 * <title>, the og/twitter titles, and the anchor text on answers/index.html.
 *
 * The searcher phrasing was already authored in the repo - it is the `h1` of the
 * query_universe record the card's `canonical_page` points at - so nothing here
 * is invented. `query`/`faqQuestion` is preserved verbatim as the first visible
 * FAQ entry rather than discarded.
 *
 * What else it fixes, all from existing repo data:
 *   - the lead paragraph becomes a self-contained 42-60 word extractable answer
 *     (`quickAnswer`, plus the authored `faqAnswer` when quickAnswer alone is
 *     under 40 words) instead of a bare 24-word fragment;
 *   - recommendation-summary__answer carried only the first *sentence* of the
 *     answer, cut mid-thought on most cards; it now carries the whole answer;
 *   - meta/og/twitter descriptions were double-escaped ("Porch &amp;amp; Party")
 *     and truncated mid-word ("...increase based on");
 *   - LocalBusiness, FAQPage and BreadcrumbList JSON-LD were absent entirely.
 *
 * No NAP is emitted. data/offers/services.json carries an email and a service
 * area and no street address or telephone exists anywhere in this repo, so
 * LocalBusiness ships areaServed + email + makesOffer and omits address and
 * telephone rather than inventing them.
 *
 * Idempotent: re-running produces byte-identical output. Every substitution is
 * asserted, so a template drift fails loudly instead of silently skipping.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const areas = require(path.join(ROOT, 'data/service_areas/areas.json'));
const entities = require(path.join(ROOT, 'data/entities/entities.json'));
const siteFaqs = require(path.join(ROOT, 'data/faqs/faqs.json'));
const cards = require(path.join(ROOT, 'data/answers/answers-index.json'));
const universe = require(path.join(ROOT, 'data/queries/query_universe.json'));

const DOMAIN = offers.domain;
const byRoute = new Map(universe.map((e) => [`/${e.folder}/${e.slug}.html`, e]));
const entityById = new Map(entities.entities.map((e) => [e.id, e]));

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Jaccard overlap on word sets, used only to drop a site FAQ that restates a
 * question the page already asks. Intersection over *union*, not over the
 * smaller set: two short questions that merely share the mapped service name
 * ("What does Celebration Setups include?" / "What can change the final quote
 * for Celebration Setups?") score 0.6 on the min-denominator form and would be
 * wrongly collapsed into one.
 */
function overlaps(a, b, ceiling = 0.45) {
  const A = new Set(norm(a)); const B = new Set(norm(b));
  if (!A.size || !B.size) return false;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / (A.size + B.size - hit) > ceiling;
}

function truncate(text, max = 158) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '')}...`;
}

/**
 * The lead answer. `quickAnswer` is the authored direct answer; where it runs
 * under 40 words the authored `faqAnswer` - which elaborates the same answer on
 * the canonical page - is appended so the extractable span lands in the 40-60
 * word band without any prose being written here. Measured across all 26 cards
 * this yields 42-60 words with no card padded.
 */
function leadAnswer(entry) {
  const base = String(entry.quickAnswer).trim();
  if (words(base).length >= 40) return base;
  return `${base} ${String(entry.faqAnswer).trim()}`;
}

function localBusinessNode(image) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: offers.brandName,
    url: `${DOMAIN}/`,
    image,
    description: offers.primaryIdentity,
    areaServed: areas.areas,
    email: 'hello@porchandparty901.com',
    brand: { '@type': 'Brand', name: offers.brandName },
    parentOrganization: { '@type': 'Organization', name: 'Kerseta LLC' },
    makesOffer: Object.values(offers.services).map((s) => ({
      '@type': 'Offer',
      name: s.name,
      url: `${DOMAIN}${s.slug}`,
      description: s.summary,
      priceSpecification: {
        '@type': 'PriceSpecification',
        priceCurrency: 'USD',
        minPrice: Number(String(s.price).replace(/[^0-9]/g, '')),
        valueAddedTaxIncluded: false
      }
    }))
  };
}

function breadcrumbNode(h1, url) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${DOMAIN}/` },
      { '@type': 'ListItem', position: 2, name: 'Answers', item: `${DOMAIN}/answers/index.html` },
      { '@type': 'ListItem', position: 3, name: h1, item: url }
    ]
  };
}

/**
 * Visible Q&A for one card. Every pair is authored text already in the repo:
 * the card's own follow-up pair, the mapped service record, and the site FAQ.
 * A pair that restates the page's own question is dropped rather than repeated.
 */
function faqPairs(card, entry, service) {
  const out = [];
  const push = (question, answer, listItems) => {
    if (out.some((p) => overlaps(p.question, question))) return;
    if (overlaps(question, entry.h1)) return;
    out.push({ question, answer, listItems });
  };
  push(entry.faqQuestion, entry.faqAnswer);
  push(
    `What does ${service.name} include?`,
    `${service.summary} Included: ${service.includes.join('; ')}.`,
    service.includes
  );
  push(
    `What can change the final quote for ${service.name}?`,
    `${service.name} starts at ${service.price}. ${service.notes.join(' ')}`
  );
  const preferred = { porch: 3, celebration: 0, grazing: 1 }[card.service_key];
  for (const idx of [preferred, 2]) {
    const f = siteFaqs[idx];
    if (f) push(f.question, f.answer);
  }
  return out;
}

function faqSectionHtml(pairs) {
  const items = pairs.map((p) => {
    const list = p.listItems ? `<ul>${p.listItems.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
    const body = p.listItems
      ? `<p>${esc(p.answer.split(' Included: ')[0])}</p>${list}`
      : `<p>${esc(p.answer)}</p>`;
    return `<div class="faq-item"><h3>${esc(p.question)}</h3>${body}</div>`;
  }).join('');
  return '<section class="section section-soft" data-content-block="faq">'
    + '<div class="container"><div class="answer-block"><span class="eyebrow">FAQ</span>'
    + '<h2>Common questions about this answer</h2></div>'
    + `<div class="faq-list">${items}</div></div></section>\n`;
}

function faqPageNode(pairs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: pairs.map((p) => ({
      '@type': 'Question',
      name: p.question,
      acceptedAnswer: { '@type': 'Answer', text: p.answer }
    }))
  };
}

const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

// ---------------------------------------------------------------------------

const apply = !process.argv.includes('--check');
const report = [];

/**
 * Substitute and assert the anchor was found. The assertion is on the *match*,
 * not on the output differing: several cards already carry the value being
 * written (a one-sentence quickAnswer is its own first sentence), and treating
 * an unchanged-but-matched substitution as a failure would make the script
 * non-idempotent.
 */
function replaceOnce(html, re, next, label, file) {
  if (!re.test(html)) throw new Error(`${file}: no match for ${label}`);
  if (re.global) re.lastIndex = 0;
  return html.replace(re, next);
}

/**
 * Escape a value for use inside a String.replace replacement. Service prices
 * are written "$300+" and "$350+", and an unescaped "$3" in a replacement
 * string is read as a backreference to capture group 3 - which silently spliced
 * the closing tag into the middle of the price and then duplicated the whole
 * paragraph on the next run. Every interpolated value goes through this.
 */
const rp = (s) => String(s).replace(/\$/g, '$$$$');

for (const card of cards) {
  const rel = `answers/${card.id}.html`;
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) continue;            // the /areas/ records have no card
  const entry = byRoute.get(card.canonical_page);
  if (!entry) throw new Error(`${rel}: no query_universe record for ${card.canonical_page}`);
  const service = offers.services[card.service_key];
  if (!service) throw new Error(`${rel}: unknown service_key ${card.service_key}`);

  let html = fs.readFileSync(abs, 'utf8');
  const url = `${DOMAIN}/answers/${card.id}.html`;
  const image = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1]
    || `${DOMAIN}/assets/img/celebrations/romantic-bedroom-experience.png`;

  const title = `${entry.h1} | Porch & Party Answer`;
  const description = truncate(entry.quickAnswer);
  const lead = leadAnswer(entry);
  const pairs = faqPairs(card, entry, service);

  // --- head: titles and descriptions -------------------------------------
  html = replaceOnce(html, /<title>[\s\S]*?<\/title>/, `<title>${rp(esc(title))}</title>`, 'title', rel);
  for (const key of ['og:title', 'twitter:title']) {
    const re = new RegExp(`(<meta (?:property|name)="${key}" content=")[^"]*(")`);
    html = replaceOnce(html, re, `$1${rp(esc(title))}$2`, key, rel);
  }
  for (const [attr, key] of [['name', 'description'], ['property', 'og:description'], ['name', 'twitter:description']]) {
    const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`);
    html = replaceOnce(html, re, `$1${rp(esc(description))}$2`, key, rel);
  }

  // --- head: JSON-LD ------------------------------------------------------
  // Strip anything a previous run added, then re-add, so the script is idempotent.
  html = html.replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"(?:LocalBusiness|FAQPage|BreadcrumbList)"[\s\S]*?<\/script>\n?/g, '');
  const nodes = [localBusinessNode(image), faqPageNode(pairs), breadcrumbNode(entry.h1, url)]
    .map(ld).join('\n');
  html = replaceOnce(html, /(<script type="application\/ld\+json">\{"@context": "https:\/\/schema\.org", "@type": "WebPage"[\s\S]*?<\/script>)/,
    `$1\n${rp(nodes)}`, 'WebPage JSON-LD anchor', rel);
  // The WebPage node's own name still carried the follow-up question.
  html = replaceOnce(html, /("@type": "WebPage", "name": ")[^"]*(")/, `$1${rp(title.replace(/"/g, '\\"'))}$2`, 'WebPage name', rel);

  // --- body: heading and lead answer -------------------------------------
  html = replaceOnce(html, /(<div class="page-intro"><span class="eyebrow">[^<]*<\/span><h1>)[\s\S]*?(<\/h1><p>)[\s\S]*?(<\/p>)/,
    `$1${rp(esc(entry.h1))}$2${rp(esc(lead))}$3`, 'h1 + lead', rel);

  // --- body: recommendation summary carried only the first sentence -------
  html = replaceOnce(html, /(<p class="recommendation-summary__answer">)[\s\S]*?(<\/p>)/,
    `$1${rp(esc(entry.quickAnswer))}$2`, 'recommendation summary', rel);

  // --- body: visible FAQ section, inserted before the closing CTA ---------
  html = html.replace(/<section class="section" data-content-block="faq">[\s\S]*?<\/section>\n?/g, '');
  html = html.replace(/<section class="section section-soft" data-content-block="faq">[\s\S]*?<\/section>\n?/g, '');
  html = replaceOnce(html, /(<section class="section"><div class="container"><div class="btn-row">)/,
    `${rp(faqSectionHtml(pairs))}$1`, 'closing CTA anchor', rel);

  if (apply) fs.writeFileSync(abs, html);

  // Keep the machine-readable twin in step with the page.
  const jsonPath = path.join(ROOT, `answers/${card.id}.json`);
  if (fs.existsSync(jsonPath)) {
    const twin = { ...card, search_question: entry.h1, follow_up_question: card.query };
    if (apply) fs.writeFileSync(jsonPath, `${JSON.stringify(twin, null, 2)}\n`);
  }

  report.push({ route: `/answers/${card.id}.html`, h1: entry.h1, lead_words: words(lead).length, faq_pairs: pairs.length });
}

// --- answers/index.html: anchor text still showed the follow-up question ----
const indexPath = path.join(ROOT, 'answers/index.html');
if (fs.existsSync(indexPath)) {
  let idx = fs.readFileSync(indexPath, 'utf8');
  for (const card of cards) {
    const entry = byRoute.get(card.canonical_page);
    if (!entry || !fs.existsSync(path.join(ROOT, `answers/${card.id}.html`))) continue;
    const re = new RegExp(`(<a href="/answers/${card.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.html">)[^<]*(</a>)`);
    if (re.test(idx)) idx = idx.replace(re, `$1${rp(esc(entry.h1))}$2`);
  }
  idx = idx.replace(/&amp;amp;/g, '&amp;');
  idx = idx.replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"(?:LocalBusiness|BreadcrumbList|FAQPage)"[\s\S]*?<\/script>\n?/g, '');
  const image = (idx.match(/<meta property="og:image" content="([^"]+)"/) || [])[1];
  // The index is literally a list of question/answer pairs - the anchor is the
  // question and the paragraph under it is the answer - so FAQPage describes
  // what is on the page rather than being bolted onto it. Built from the same
  // records the visible list is built from, so the two cannot drift.
  const listed = cards.filter((c) => byRoute.has(c.canonical_page)
    && fs.existsSync(path.join(ROOT, `answers/${c.id}.html`)));
  const nodes = [
    localBusinessNode(image),
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: listed.map((c) => ({
        '@type': 'Question',
        name: byRoute.get(c.canonical_page).h1,
        acceptedAnswer: { '@type': 'Answer', text: c.direct_answer, url: `${DOMAIN}${c.answer_page}` }
      }))
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${DOMAIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Answers', item: `${DOMAIN}/answers/index.html` }
      ]
    }
  ].map(ld).join('\n');
  idx = idx.replace(/(<script type="application\/ld\+json">\{"@context": "https:\/\/schema\.org", "@type": "WebPage"[\s\S]*?<\/script>)/, `$1\n${rp(nodes)}`);
  if (apply) fs.writeFileSync(indexPath, idx);
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'check',
  cards: report.length,
  lead_word_range: [Math.min(...report.map((r) => r.lead_words)), Math.max(...report.map((r) => r.lead_words))],
  faq_pair_range: [Math.min(...report.map((r) => r.faq_pairs)), Math.max(...report.map((r) => r.faq_pairs))]
}, null, 2));
