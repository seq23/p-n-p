#!/usr/bin/env node
'use strict';
/**
 * Thin-page retrofit for the hand-maintained pages under answers/ and services/.
 *
 * These 17 pages are not produced by any generator - they predate
 * templates/page-shell.js and are edited in place - and they sat at 194-295
 * words with no BreadcrumbList. Under 300 words is the band where a page stops
 * being retrieved at all, so the shortfall was the whole defect: the schema and
 * the headings on these pages were already correct.
 *
 * What gets added is the record of the service each page is about, which the
 * page never carried: `includes`, `notes` and the starting price from
 * data/offers/services.json, plus the matching entries from data/faqs/faqs.json.
 * All of it is authored text already in the tree. Nothing is written here, and
 * a pair that restates a question the page already asks is dropped rather than
 * repeated - so a page gains only material it was actually missing.
 *
 * The service each page maps to is declared in SERVICE_BY_PAGE below rather than
 * inferred. Inference was tried first and does not hold: six of the nine
 * answers/ pages name no price at all, and two name two different ones, so any
 * price- or link-based guess silently mismaps a page onto the wrong service
 * record and then publishes its prices.
 *
 * Idempotent. Retrofitted blocks carry data-retrofit="service-faq" and are
 * stripped before being rebuilt, so re-running yields byte-identical output.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const siteFaqs = require(path.join(ROOT, 'data/faqs/faqs.json'));

const DOMAIN = offers.domain;

// Declared, not inferred - see the header note.
const SERVICE_BY_PAGE = {
  'answers/how-much-does-a-grazing-table-cost-in-memphis.html': 'grazing',
  'answers/grazing-table-ideas-bridal-showers-birthdays-small-events.html': 'grazing',
  'answers/how-much-does-party-decor-cost-in-memphis.html': 'celebration',
  'answers/can-someone-decorate-hotel-room-birthday-memphis.html': 'celebration',
  'answers/can-i-book-decor-only-without-event-planning.html': 'celebration',
  'answers/party-decor-vs-event-planning-memphis.html': 'celebration',
  'answers/what-is-included-in-party-decor-setup.html': 'celebration',
  'answers/birthday-hotel-room-setup-ideas-memphis.html': 'celebration',
  'answers/small-party-decor-ideas-memphis.html': 'celebration',
  'services/baby-shower-decor-memphis.html': 'celebration',
  'services/bridal-shower-decor-memphis.html': 'celebration',
  'services/celebration-setups-memphis.html': 'celebration',
  'services/luxury-party-decor-memphis.html': 'celebration',
  'services/birthday-party-decor-memphis.html': 'celebration',
  'services/hotel-room-decor-memphis.html': 'celebration',
  'services/budget-party-decor-memphis.html': 'celebration',
  'services/grazing-tables-memphis.html': 'grazing'
};

const SECTION_NAME = { answers: 'Answers', services: 'Services' };

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rp = (s) => String(s).replace(/\$/g, '$$$$');   // see retrofit_answer_cards.js
const norm = (s) => String(s || '').toLowerCase().replace(/<[^>]+>/g, ' ')
  .replace(/&[a-z]+;/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

function overlaps(a, b, ceiling = 0.45) {
  const A = new Set(norm(a)); const B = new Set(norm(b));
  if (!A.size || !B.size) return false;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / (A.size + B.size - hit) > ceiling;
}

const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

/**
 * The full candidate set for a service, before any de-duplication. Deterministic
 * from the data files, which is what makes the retrofit idempotent: a re-run
 * recognises its own previous output by name and rebuilds it rather than
 * treating it as pre-existing content and then dropping everything.
 */
function candidatePairs(service, serviceKey) {
  const out = [];
  const push = (question, answer, listItems) => { out.push({ question, answer, listItems }); };
  push(
    `What does ${service.name} include?`,
    `${service.summary} Included: ${service.includes.join('; ')}.`,
    service.includes
  );
  push(
    `What can change the final quote for ${service.name}?`,
    `${service.name} starts at ${service.price}. ${service.notes.join(' ')}`
  );
  // Only the site FAQ that matches this service, plus the booking question that
  // applies to all three. Pushing all four onto all seventeen pages added ~236
  // identical words per page - which is the near-duplicate scaffolding
  // scripts/template_share.js exists to catch, not substance. The service-area
  // list is deliberately absent: every page already carries it in the footer,
  // and the services/ pages carry it in the body as well.
  const matched = { porch: 3, celebration: 0, grazing: 1 }[serviceKey];
  for (const idx of [matched, 2]) {
    const f = siteFaqs[idx];
    if (f) push(f.question, f.answer);
  }
  return out;
}

/** Candidates the page does not already ask, in order. */
function selectPairs(candidates, existingQuestions) {
  const out = [];
  for (const c of candidates) {
    if (existingQuestions.some((q) => overlaps(q, c.question))) continue;
    if (out.some((p) => overlaps(p.question, c.question))) continue;
    out.push(c);
  }
  return out;
}

function itemHtml(p) {
  const list = p.listItems ? `<ul>${p.listItems.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
  const lead = p.listItems ? p.answer.split(/ (?:Included|: )/)[0] : p.answer;
  const body = p.listItems ? `<p>${esc(lead)}</p>${list}` : `<p>${esc(p.answer)}</p>`;
  return `<div class="faq-item" data-retrofit="service-faq"><h3>${esc(p.question)}</h3>${body}</div>`;
}

const apply = !process.argv.includes('--check');
const report = [];

for (const [rel, key] of Object.entries(SERVICE_BY_PAGE)) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error(`missing page ${rel}`);
  const service = offers.services[key];
  let html = fs.readFileSync(abs, 'utf8');

  // Drop anything a previous run added so the script is idempotent.
  // A retrofitted item holds only <h3>, <p> and <ul> - no nested <div> - so the
  // first closing tag is its own.
  html = html.replace(/<div class="faq-item" data-retrofit="service-faq">[\s\S]*?<\/div>/g, '');
  html = html.replace(/<section class="section section-soft" data-retrofit="service-faq">[\s\S]*?<\/section>\n?/g, '');
  html = html.replace(/<script type="application\/ld\+json">\{"@context":"https:\/\/schema\.org","@type":"BreadcrumbList"[\s\S]*?<\/script>\n?/g, '');

  const h1 = ((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '').replace(/<[^>]+>/g, '').trim();
  const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  if (!h1 || !canonical) throw new Error(`${rel}: missing h1 or canonical`);

  const candidates = candidatePairs(service, key);
  const candidateNames = new Set(candidates.map((c) => c.question));

  // Questions the page already asks, visibly and in schema - excluding this
  // script's own previous output, which is stripped from the page above but
  // still sits in the FAQPage node until it is rebuilt below.
  const existing = [
    ...[...html.matchAll(/<div class="faq-item"[^>]*><h3>([\s\S]*?)<\/h3>/g)].map((m) => m[1]),
    ...[...html.matchAll(/"@type":"Question","name":"([^"]*)"/g)].map((m) => m[1]),
    h1
  ].filter((q) => !candidateNames.has(q.replace(/&amp;/g, '&')));

  const pairs = selectPairs(candidates, existing);

  // --- visible Q&A -------------------------------------------------------
  if (/<div class="faq-list">/.test(html)) {
    html = html.replace(/(<div class="faq-list">[\s\S]*?)(<\/div><\/div><\/section>)/,
      (m, body, tail) => `${body}${rp(pairs.map(itemHtml).join(''))}${tail}`);
  } else {
    const section = '<section class="section section-soft" data-retrofit="service-faq">'
      + '<div class="container"><div class="answer-block"><span class="eyebrow">FAQ</span>'
      + `<h2>More about ${esc(service.name)}</h2></div>`
      + `<div class="faq-list">${pairs.map(itemHtml).join('')}</div></div></section>\n`;
    if (!/<section class="section cta-band">/.test(html)) throw new Error(`${rel}: no cta-band anchor`);
    html = html.replace(/(<section class="section cta-band">)/, `${rp(section)}$1`);
  }

  // --- FAQPage schema: merge, do not replace -----------------------------
  const faqRe = /<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"FAQPage"[\s\S]*?\})<\/script>/;
  const added = pairs.map((p) => ({
    '@type': 'Question', name: p.question,
    acceptedAnswer: { '@type': 'Answer', text: p.answer }
  }));
  if (faqRe.test(html)) {
    const node = JSON.parse(html.match(faqRe)[1]);
    const kept = (node.mainEntity || []).filter((q) => !candidateNames.has(q.name));
    node.mainEntity = [...kept, ...added];
    html = html.replace(faqRe, rp(ld(node)));
  } else {
    throw new Error(`${rel}: expected an existing FAQPage node to merge into`);
  }

  // --- BreadcrumbList ----------------------------------------------------
  const folder = rel.split('/')[0];
  const crumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${DOMAIN}/` },
      { '@type': 'ListItem', position: 2, name: SECTION_NAME[folder], item: `${DOMAIN}/${folder}/` },
      { '@type': 'ListItem', position: 3, name: h1.replace(/&amp;/g, '&'), item: canonical }
    ]
  };
  html = html.replace(/(<\/head>)/, `${rp(ld(crumb))}\n$1`);

  if (apply) fs.writeFileSync(abs, html);
  report.push({ page: rel, service: service.name, pairs_added: pairs.length });
}

console.log(JSON.stringify({ mode: apply ? 'apply' : 'check', pages: report.length, report }, null, 2));
