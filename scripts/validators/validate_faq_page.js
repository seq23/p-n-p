#!/usr/bin/env node
'use strict';
/**
 * The consolidated FAQ page (owner ruling 2026-10-17): /faq/ is ONE page
 * sectioned by service, in the header and footer of every page, with a
 * grazing estimator and a porch-size picker whose numbers are the data's.
 *
 *   - /faq/index.html carries the five sections booking, porch, party,
 *     grazing, rentals, in that order, each with an id, a jump link and a
 *     Request a Quote button opening the form in a new tab;
 *   - the FAQPage JSON-LD lists every question rendered (>= 30), and the
 *     rentals section repeats the rentals page's questions word for word;
 *   - every dollar amount on the page is a price in services.json (tiers,
 *     travel fee, starting prices, takedown, food per head) or games.json
 *     (rates, deposit, bundles); a typed-in price fails here;
 *   - the Price my porch calculator (#porch-picker) is exactly
 *     scripts/lib/porch_packages.js calculatorHtml(data/offers/porch_packages.json):
 *     a season toggle with both seasons, all four packages per season at
 *     their from-prices, the size hint, the custom-design, add-ons, bundle
 *     and rough-estimate lines and a "Request this package" link per tier and
 *     season preselecting both on /request (owner, 2026-10-18; replaced the
 *     three porch-size pictures);
 *     the grazing estimator carries the four tiers + per-head range as its
 *     data-config, and the food line says it is a separate rough estimate;
 *   - the travel answer names every city in areas.json and the $75 fee;
 *   - rentals/index.html links /faq/#rentals above its questions and has
 *     the hero button reads "Book online" (owner ruling 2026-10-21) and the under-the-bundles
 *     button "Book your games", and both open
 *     the booking form's rentals path (owner, 2026-10-18; were "Check My Date");
 *   - the homepage links /faq/ from its FAQ block.
 * Navigation pass (owner-approved 2026-10-17):
 *   - no "What this page recommends" block; the hero (#top) has ONE button,
 *     Request a Quote, and the h1 is "Frequently asked questions";
 *   - under the hero a map: 5 section cards + 2 tool cards (#porch-picker,
 *     #grazing-estimator), every href resolving to an id on the page;
 *   - a sticky jump nav (position: sticky in styles.css) with a "Jump to:"
 *     label and exactly 5 links, plus the IntersectionObserver highlighter;
 *   - every question is <details class="faq-item"><summary><h3>, exactly one
 *     open per section and it is the first;
 *   - the porch picker is the first block of #porch, the estimator of #grazing;
 *   - FAQPage mainEntity count == rendered <details> count (>= 30);
 *   - exactly 6 form links in <main> (1 hero + 5 sections), all "Request a Quote";
 *   - each section ends with Back to top (#top) and, except the last, Next.
 * Self-test: a mutated page for every rule above must FAIL. Hard-fails on a
 * missing page.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const games = require(path.join(ROOT, 'data/rentals/games.json'));
const porchPackages = require(path.join(ROOT, 'data/offers/porch_packages.json'));
const PP = require(path.join(ROOT, 'scripts/lib/porch_packages.js'));
const areas = require(path.join(ROOT, 'data/service_areas/areas.json'));
const { FAQ: RENTALS_FAQ } = require(path.join(ROOT, 'scripts/generators/build_rentals_page.js'));

const FORM = '/request';
const SECTIONS = ['booking', 'porch', 'party', 'grazing', 'rentals'];
const errors = [];
const fail = (m) => errors.push(m);
const text = (s) => s.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function allowedPrices() {
  const S = offers.services;
  const n = new Set();
  const add = (v) => { if (v == null) return; const m = String(v).match(/\d[\d,]*/g); if (m) m.forEach((x) => n.add(Number(x.replace(/,/g, '')))); };
  for (const k of Object.keys(S)) { add(S[k].price); (S[k].tiers || []).forEach((t) => add(t.from)); }
  porchPackages.seasons.forEach((x) => Object.values(x.tiers).forEach((t) => add(t.from)));
  add(S.grazing.foodPerHead.low); add(S.grazing.foodPerHead.high);
  add(offers.addOns.takedown.fromPrice); add(offers.travel.extendedFee);
  // Business delivery of game rentals (19 Oct 2026): the invoice quick-add's delivery fee.
  add(offers.invoiceQuickAdds.deliveryFee);
  add(games.rates.day); add(games.rates.weekend); add(games.damageDeposit);
  (games.extras || []).forEach((x) => { add(x.dayPrice); add(x.weekendPrice); add(x.rates && x.rates.day); add(x.rates && x.rates.weekend); });
  (games.bundles || []).forEach((b) => { add(b.dayPrice); add(b.weekendPrice); });
  return n;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const ITEM = /<details class="faq-item"( open)?><summary><h3>([\s\S]*?)<\/h3><\/summary><p>[\s\S]*?<\/p><\/details>/g;

function checkNavigation(html) {
  const css = read('assets/css/styles.css');
  if (/recommendation-summary|What this page recommends/i.test(html)) fail('faq/index.html: still carries the "What this page recommends" block');
  const hero = html.match(/<div class="page-intro" id="top">([\s\S]*?)<\/div>\s*<\/div>|<div class="page-intro" id="top">([\s\S]*?<div class="btn-row[^"]*">[\s\S]*?<\/div>)/);
  if (!hero) fail('faq/index.html: no hero with id="top"');
  else {
    const h = hero[1] || hero[2];
    const btns = (h.match(/class="btn-[a-z]+"/g) || []).length;
    if (btns !== 1 || !/class="btn-primary"[^>]*>Request a Quote<\/a>/.test(h)) fail(`faq/index.html: hero has ${btns} button(s), want exactly one Request a Quote`);
    if (!/<h1>Frequently asked questions<\/h1>/.test(h)) fail('faq/index.html: h1 is not "Frequently asked questions"');
  }
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const map = html.match(/<nav class="faq-map"[^>]*>([\s\S]*?)<\/nav>/);
  if (!map) fail('faq/index.html: no section map under the hero');
  else {
    const cards = [...map[1].matchAll(/<a class="faq-map__card( faq-map__card--tool)?" href="#([^"]+)">([\s\S]*?)<\/a>/g)];
    const sec = cards.filter((c) => !c[1]).map((c) => c[2]);
    const tools = cards.filter((c) => c[1]).map((c) => c[2]);
    if (JSON.stringify(sec) !== JSON.stringify(SECTIONS)) fail(`faq/index.html: map section cards are [${sec}], want [${SECTIONS}]`);
    if (JSON.stringify(tools) !== JSON.stringify(['porch-picker', 'grazing-estimator'])) fail(`faq/index.html: map tool cards are [${tools}], want porch-picker + grazing-estimator`);
    for (const c of cards) {
      if (!ids.has(c[2])) fail(`faq/index.html: map card #${c[2]} points at no id on the page`);
      if (!/&rarr;|→/.test(c[3])) fail(`faq/index.html: map card #${c[2]} has no arrow`);
    }
    for (const c of cards.filter((x) => !x[1])) if (!/\d+ questions/.test(c[3])) fail(`faq/index.html: map card #${c[2]} has no question count`);
  }
  const nav = html.match(/<nav class="faq-jump"[^>]*>([\s\S]*?)<\/nav>/);
  if (!nav) fail('faq/index.html: no jump nav');
  else {
    if (!/<span class="faq-jump__label">Jump to:<\/span>/.test(nav[1])) fail('faq/index.html: jump nav has no "Jump to:" label');
    const links = (nav[1].match(/<a href="#[a-z]+">/g) || []).length;
    if (links !== SECTIONS.length) fail(`faq/index.html: jump nav has ${links} links, want ${SECTIONS.length}`);
  }
  if (!/\.faq-jump \{[^}]*position: sticky/.test(css)) fail('styles.css: .faq-jump is not position: sticky');
  if (!/IntersectionObserver/.test(html) || !/aria-current/.test(html)) fail('faq/index.html: no IntersectionObserver section highlighter');
  const sections = [...html.matchAll(/<section class="faq-section" id="([a-z]+)">([\s\S]*?)<\/section>/g)];
  sections.forEach(([, id, body], i) => {
    const items = [...body.matchAll(ITEM)];
    const raw = (body.match(/class="faq-item"/g) || []).length;
    if (raw !== items.length) fail(`faq/index.html: section #${id} has ${raw - items.length} question(s) not rendered as <details><summary><h3>`);
    const open = items.map((m, j) => (m[1] ? j : -1)).filter((j) => j >= 0);
    if (open.length !== 1 || open[0] !== 0) fail(`faq/index.html: section #${id} opens questions [${open}], want only the first`);
    const afterHead = body.replace(/^\s*<div class="answer-block">[\s\S]*?<\/p><\/div>/, '').trimStart();
    if (id === 'porch' && !afterHead.startsWith('<div class="faq-tool" id="porch-picker">')) fail('faq/index.html: the porch picker is not the first block of #porch');
    if (id === 'grazing' && !afterHead.startsWith('<div class="info-panel estimator" id="grazing-estimator"')) fail('faq/index.html: the grazing estimator is not the first block of #grazing');
    const next = sections[i + 1];
    const tail = new RegExp(`<p class="faq-next"><a href="#top">[^<]*Back to top</a>${next ? `<a href="#${next[1]}">Next: [^<]+</a>` : ''}</p>\\s*$`);
    if (!tail.test(body)) fail(`faq/index.html: section #${id} does not end with Back to top${next ? ` and Next: #${next[1]}` : ''}`);
  });
  const main = (html.match(/<main>([\s\S]*?)<\/main>/) || ['', ''])[1];
  const formLinks = [...main.matchAll(new RegExp(`<a href="${esc(FORM)}"[^>]*>([^<]*)</a>`, 'g'))];
  if (formLinks.length !== 1 + SECTIONS.length) fail(`faq/index.html: ${formLinks.length} quote links in <main>, want ${1 + SECTIONS.length} (hero + one per section)`);
  for (const [, label] of formLinks) if (label !== 'Request a Quote') fail(`faq/index.html: a quote link in <main> reads "${label}", want "Request a Quote"`);
}

function checkFaqPage(html) {
  const t = text(html);
  checkNavigation(html);
  let last = -1;
  for (const id of SECTIONS) {
    const i = html.indexOf(`<section class="faq-section" id="${id}">`);
    if (i < 0) { fail(`faq/index.html: no section #${id}`); continue; }
    if (i < last) fail(`faq/index.html: section #${id} is out of order`);
    last = i;
    if (!html.includes(`<a href="#${id}">`)) fail(`faq/index.html: no jump link to #${id}`);
  }
  const sections = [...html.matchAll(/<section class="faq-section" id="([a-z]+)">([\s\S]*?)<\/section>/g)];
  if (sections.length !== SECTIONS.length) fail(`faq/index.html: ${sections.length} faq sections, want ${SECTIONS.length}`);
  for (const [, id, body] of sections) {
    if (!body.includes(`<a href="${FORM}" class="btn-primary">Request a Quote</a>`)) fail(`faq/index.html: section #${id} has no Request a Quote button opening the request form`);
    if ((body.match(/<details class="faq-item"/g) || []).length < 5) fail(`faq/index.html: section #${id} has fewer than 5 questions`);
  }
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = ld.find((o) => o['@type'] === 'FAQPage');
  const rendered = [...html.matchAll(ITEM)].map((m) => m[2].replace(/&amp;/g, '&'));
  const detailsCount = (html.match(/<details class="faq-item"/g) || []).length;
  if (!faq) fail('faq/index.html: no FAQPage JSON-LD');
  else {
    const names = faq.mainEntity.map((q) => q.name);
    if (names.length < 30) fail(`faq/index.html: FAQPage lists ${names.length} questions, want at least 30`);
    if (names.length !== detailsCount) fail(`faq/index.html: FAQPage lists ${names.length} questions but the page renders ${detailsCount} <details>`);
    if (JSON.stringify(names) !== JSON.stringify(rendered)) fail('faq/index.html: FAQPage questions differ from the questions rendered on the page');
    for (const [q] of RENTALS_FAQ) if (!names.includes(q)) fail(`faq/index.html: rentals section lacks the rentals page question "${q}"`);
  }
  // Prices only from data.
  const allowed = allowedPrices();
  const seen = new Set((t.match(/\$\d[\d,]*/g) || []).map((x) => Number(x.slice(1).replace(/,/g, ''))));
  for (const n of seen) if (!allowed.has(n)) fail(`faq/index.html quotes $${n}, which is not a price in services.json or games.json`);
  if (!seen.size) fail('faq/index.html quotes no prices at all');
  // Price my porch calculator.
  if (!html.includes(PP.calculatorHtml(porchPackages))) fail('faq/index.html: the Price my porch calculator is not the one scripts/lib/porch_packages.js renders from data/offers/porch_packages.json');
  const calc = (html.match(/<div class="faq-tool" id="porch-picker">[\s\S]*?<\/script><\/div>/) || [''])[0];
  const toggles = (calc.match(/<input type="radio" name="pkg-season" value="([a-z]+)"/g) || []).length;
  if (toggles !== porchPackages.seasons.length) fail(`faq/index.html: the calculator season toggle has ${toggles} choice(s), want ${porchPackages.seasons.length}`);
  for (const season of porchPackages.seasons) {
    for (const k of porchPackages.tierOrder) {
      const name = porchPackages.tiers[k].name;
      const card = `<article class="pkg-tier" data-tier="${k}"><h4>${name}</h4><p class="pkg-price">${PP.money(season.tiers[k].from)}+</p>`;
      const block = calc.slice(calc.indexOf(`data-season="${season.key}"`));
      if (!calc.includes(`data-season="${season.key}"`) || !block.slice(0, block.indexOf('pkg-custom')).includes(card)) fail(`faq/index.html: calculator lacks ${season.name} ${name} at ${PP.money(season.tiers[k].from)}+`);
      if (!calc.includes(`href="${PP.requestHref(porchPackages, season.key, k)}"`)) fail(`faq/index.html: calculator lacks "Request this package" for ${season.name} ${name}`);
    }
  }
  for (const [label, line] of [['size hint', porchPackages.sizeHint], ['add-ons', porchPackages.addOns.line], ['bundle', porchPackages.bundle.line], ['rough-estimate', porchPackages.estimateLine]]) {
    if (!calc.includes(PP.esc(line))) fail(`faq/index.html: calculator lacks the ${label} line`);
  }
  // Grazing estimator.
  const est = html.match(/data-estimator="grazing" data-config='([^']*)'/);
  if (!est) fail('faq/index.html: no grazing estimator');
  else {
    const cfg = JSON.parse(est[1].replace(/&#39;/g, "'"));
    if (JSON.stringify(cfg.tiers) !== JSON.stringify(offers.services.grazing.tiers)) fail('faq/index.html: grazing estimator tiers differ from services.json');
    if (cfg.food.low !== offers.services.grazing.foodPerHead.low || cfg.food.high !== offers.services.grazing.foodPerHead.high) fail('faq/index.html: grazing estimator per-head range differs from services.json');
    if (!t.includes(offers.services.grazing.foodPerHead.line)) fail('faq/index.html: the food line (separate rough estimate) is missing');
    if (!/function pick\(/.test(html) || !/data-out="food"/.test(html)) fail('faq/index.html: grazing estimator script or output is missing');
  }
  // Travel.
  const travelAnswer = t;
  for (const city of areas.areas.map((a) => a.split(',')[0])) if (!travelAnswer.includes(city)) fail(`faq/index.html: travel answer does not name ${city}`);
  if (!t.includes(`$${offers.travel.extendedFee} travel fee`)) fail(`faq/index.html: no $${offers.travel.extendedFee} travel fee line`);
  if (/social media/i.test(t)) fail('faq/index.html mentions a social media link (owner ruling 2026-10-15: form only)');
  if (/\bdeliver(?:y|ed)\b/i.test(t) && !/no delivery|do not deliver|not bring/i.test(t)) fail('faq/index.html talks about delivery');
}

function checkOtherPages() {
  const r = read('rentals/index.html');
  if (!/<a href="\/faq\/#rentals">FAQ page<\/a>/.test(r)) fail('rentals/index.html: no link to /faq/#rentals above its questions');
  // Owner ruling 2026-10-21: the hero button reads "Book online"; under the bundles it stays "Book your games".
  if (!r.includes('<a href="/request?service=rentals" class="btn-primary btn-book" data-quote-cta="rentals-top" data-book-online="hero">Book online</a>')) fail('rentals/index.html: the hero button is not "Book online" opening /request?service=rentals');
  if (!r.includes('<a href="/request?service=rentals" class="btn-primary" data-quote-cta="rentals-bundles">Book your games</a>')) fail('rentals/index.html: the under-the-bundles button is not "Book your games" opening /request?service=rentals');
  if (/Check My Date/.test(r)) fail('rentals/index.html still says "Check My Date"');
  const home = read('index.html');
  if (!/<a href="\/faq\/">FAQ page<\/a>/.test(home)) fail('index.html: FAQ block does not link the FAQ page');
}

const faqPath = path.join(ROOT, 'faq/index.html');
if (!fs.existsSync(faqPath)) { console.error('validate_faq_page: FAIL - faq/index.html is missing'); process.exit(1); }
const html = read('faq/index.html');
checkFaqPage(html);
checkOtherPages();

// Self-test: the check must fail on a broken page.
const probe = (label, mutated) => { const before = errors.length; checkFaqPage(mutated); const caught = errors.length > before; errors.length = before; if (!caught) fail(`self-test: ${label} passed when it should fail`); };
probe('page without the grazing estimator', html.replace(/<div class="info-panel estimator"[\s\S]*?<\/script>/, ''));
probe('page with a typed-in price', html.replace('faq-section" id="party"', 'faq-section" id="party"><p>$999</p'));
const sectionOf = (id) => html.match(new RegExp(`<section class="faq-section" id="${id}">[\\s\\S]*?</section>`))[0];
probe('page with the recommends block back', html.replace('<nav class="faq-map"', '<div class="info-panel recommendation-summary"><h2>What this page recommends</h2></div><nav class="faq-map"'));
probe('hero with a second button', html.replace(/(<div class="page-intro" id="top">[\s\S]*?Request a Quote<\/a>)/, '$1<a href="/pricing.html" class="btn-secondary">See Pricing</a>'));
probe('map without a tool card', html.replace(/<a class="faq-map__card faq-map__card--tool" href="#porch-picker">[\s\S]*?<\/a>/, ''));
probe('map card pointing at no id', html.replace('href="#grazing-estimator"', 'href="#grazing-calculator"'));
probe('jump nav without its label', html.replace('<span class="faq-jump__label">Jump to:</span>', ''));
probe('a question as an <article>', html.replace(/<details class="faq-item"><summary><h3>([\s\S]*?)<\/h3><\/summary>(<p>[\s\S]*?<\/p>)<\/details>/, '<article class="faq-item"><h3>$1</h3>$2</article>'));
probe('two open questions in a section', html.replace(/(<section class="faq-section" id="party">[\s\S]*?<details class="faq-item" open>[\s\S]*?)<details class="faq-item">/, '$1<details class="faq-item" open>'));
probe('porch picker after the questions', html.replace(sectionOf('porch'), sectionOf('porch').replace('<div class="faq-tool" id="porch-picker">', '<div class="faq-tool" id="porch-picker-moved">').replace('<p class="faq-cta">', '<div class="faq-tool" id="porch-picker"></div><p class="faq-cta">')));
probe('calculator with a typed-in tier price', html.replace('<p class="pkg-price">$550+</p>', '<p class="pkg-price">$600+</p>'));
probe('calculator without the bundle line', html.replace(`<p class="pkg-bundle">${PP.esc(porchPackages.bundle.line)}</p>`, ''));
probe('calculator with one season only', html.replace(/<label><input type="radio" name="pkg-season" value="christmas"> [^<]*<\/label>/, ''));
probe('an extra quote link in main', html.replace('<p class="faq-hero-note">', `<p><a href="${FORM}">Request a quote</a></p><p class="faq-hero-note">`));
probe('a section without Back to top', html.replace(/<p class="faq-next"><a href="#top">[^<]*<\/a>/, '<p class="faq-next">'));
probe('a section without its Next link', html.replace(/<a href="#party">Next: [^<]+<\/a>/, ''));
probe('FAQPage with a question the page does not render', html.replace(/<details class="faq-item"><summary>[\s\S]*?<\/details>/, ''));

if (errors.length) { console.error(`validate_faq_page: FAIL\n - ${errors.join('\n - ')}`); process.exit(1); }
console.log(`validate_faq_page: OK - /faq/ has ${SECTIONS.length} sections, ${(html.match(/<details class="faq-item"/g) || []).length} questions as accordions (first open per section), a 7-card map, a sticky Jump-to nav, 6 quote buttons, the Price my porch calculator (${porchPackages.seasons.length} seasons x ${porchPackages.tierOrder.length} packages), the grazing estimator (${offers.services.grazing.tiers.length} tiers, food separate), the $${offers.travel.extendedFee} travel line; rentals page links it and has 2 Check My Date buttons`);
