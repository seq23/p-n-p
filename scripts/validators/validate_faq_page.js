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
 *   - the porch picker shows the three tiers with their pictures and prices,
 *     the grazing estimator carries the four tiers + per-head range as its
 *     data-config, and the food line says it is a separate rough estimate;
 *   - the travel answer names every city in areas.json and the $75 fee;
 *   - rentals/index.html links /faq/#rentals above its questions and has
 *     two Check My Date buttons (hero + under the bundles);
 *   - the homepage links /faq/ from its FAQ block.
 * Self-test: a page with the grazing estimator removed and a page with a
 * typed-in price must FAIL. Hard-fails on a missing page.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const games = require(path.join(ROOT, 'data/rentals/games.json'));
const areas = require(path.join(ROOT, 'data/service_areas/areas.json'));
const { FAQ: RENTALS_FAQ } = require(path.join(ROOT, 'scripts/generators/build_rentals_page.js'));

const FORM = 'https://forms.gle/vHjfKtRRAnGV3HxFA';
const SECTIONS = ['booking', 'porch', 'party', 'grazing', 'rentals'];
const errors = [];
const fail = (m) => errors.push(m);
const text = (s) => s.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

function allowedPrices() {
  const S = offers.services;
  const n = new Set();
  const add = (v) => { if (v == null) return; const m = String(v).match(/\d[\d,]*/g); if (m) m.forEach((x) => n.add(Number(x.replace(/,/g, '')))); };
  for (const k of Object.keys(S)) { add(S[k].price); (S[k].tiers || []).forEach((t) => add(t.from)); }
  add(S.grazing.foodPerHead.low); add(S.grazing.foodPerHead.high);
  add(offers.addOns.takedown.fromPrice); add(offers.travel.extendedFee);
  add(games.rates.day); add(games.rates.weekend); add(games.damageDeposit);
  (games.extras || []).forEach((x) => { add(x.dayPrice); add(x.weekendPrice); add(x.rates && x.rates.day); add(x.rates && x.rates.weekend); });
  (games.bundles || []).forEach((b) => { add(b.dayPrice); add(b.weekendPrice); });
  return n;
}

function checkFaqPage(html) {
  const t = text(html);
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
    if (!new RegExp(`<a href="${FORM.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}" target="_blank" rel="noopener" class="btn-primary">Request a Quote</a>`).test(body)) fail(`faq/index.html: section #${id} has no Request a Quote button opening the form in a new tab`);
    if ((body.match(/<article class="faq-item">/g) || []).length < 5) fail(`faq/index.html: section #${id} has fewer than 5 questions`);
  }
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = ld.find((o) => o['@type'] === 'FAQPage');
  const rendered = [...html.matchAll(/<article class="faq-item"><h3>([\s\S]*?)<\/h3>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  if (!faq) fail('faq/index.html: no FAQPage JSON-LD');
  else {
    const names = faq.mainEntity.map((q) => q.name);
    if (names.length < 30) fail(`faq/index.html: FAQPage lists ${names.length} questions, want at least 30`);
    if (JSON.stringify(names) !== JSON.stringify(rendered)) fail('faq/index.html: FAQPage questions differ from the questions rendered on the page');
    for (const [q] of RENTALS_FAQ) if (!names.includes(q)) fail(`faq/index.html: rentals section lacks the rentals page question "${q}"`);
  }
  // Prices only from data.
  const allowed = allowedPrices();
  const seen = new Set((t.match(/\$\d[\d,]*/g) || []).map((x) => Number(x.slice(1).replace(/,/g, ''))));
  for (const n of seen) if (!allowed.has(n)) fail(`faq/index.html quotes $${n}, which is not a price in services.json or games.json`);
  if (!seen.size) fail('faq/index.html quotes no prices at all');
  // Porch picker.
  for (const tier of offers.services.porch.tiers) {
    if (!html.includes(`<img src="${tier.image}"`)) fail(`faq/index.html: porch picker lacks the ${tier.name} picture`);
    if (!t.includes(`${tier.name}`) || !t.includes(`From $${tier.from}`)) fail(`faq/index.html: porch picker lacks "${tier.name}" at From $${tier.from}`);
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
  const cmd = (r.match(/>Check My Date<\/a>/g) || []).length;
  if (cmd !== 2) fail(`rentals/index.html has ${cmd} Check My Date button(s), want 2 (hero + under the bundles)`);
  if (!/data-quote-cta="rentals-bundles"/.test(r)) fail('rentals/index.html: the Check My Date under the bundles is missing');
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

if (errors.length) { console.error(`validate_faq_page: FAIL\n - ${errors.join('\n - ')}`); process.exit(1); }
console.log(`validate_faq_page: OK - /faq/ has ${SECTIONS.length} sections, ${(html.match(/<article class="faq-item">/g) || []).length} questions, the porch picker (${offers.services.porch.tiers.length} tiers), the grazing estimator (${offers.services.grazing.tiers.length} tiers, food separate), the $${offers.travel.extendedFee} travel line; rentals page links it and has 2 Check My Date buttons`);
