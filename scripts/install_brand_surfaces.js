#!/usr/bin/env node
'use strict';
/**
 * Writes every summary surface from scripts/lib/brand.js (owner-approved
 * 2026-10-18: the four services everywhere a summary is drawn from).
 *
 *   index.html     <title>, meta / og / twitter descriptions, og / twitter
 *                  titles, H1, the definition paragraph's first sentence, the
 *                  Quick Answer's first sentence, the business + WebPage
 *                  JSON-LD descriptions, the fourth service card and pricing
 *                  card (Party Game Rentals) and the rentals FAQ (visible +
 *                  FAQPage JSON-LD);
 *   pricing.html, contact.html, how-it-works.html   meta + og + twitter
 *                  descriptions and the WebPage JSON-LD description;
 *                  pricing.html also the fourth pricing card (Party Game
 *                  Rentals, linking /rentals/), so the page carries all four
 *                  services;
 *   every other published html   a JSON-LD description equal to a retired
 *                  brand.STALE_IDENTITIES sentence becomes IDENTITY_SENTENCE
 *                  (the business node on the older frozen pages);
 *   site.webmanifest  description = SERVICE_SENTENCE;
 *   llms.txt, llms-full.txt, llms-entities.txt, llms-answers.txt   identity
 *                  line, the Party Game Rentals entity line and the rentals Q&A.
 *
 * Prices come from data/offers/services.json and data/rentals/games.json via
 * brand.PRICES. Idempotent; exits non-zero when a surface it owns has no
 * anchor to write into, so a reshaped page fails loudly instead of silently
 * keeping old copy. Guarded by scripts/validators/validate_service_coverage.js.
 */
const fs = require('fs');
const path = require('path');
const brand = require('./lib/brand');
const games = require('../data/rentals/games.json');
const areas = require('../data/service_areas/areas.json');

const ROOT = path.resolve(__dirname, '..');
const { esc, SERVICE_SENTENCE, IDENTITY_SENTENCE, SERVICE_LIST, PRICES } = brand;
const DOMAIN = 'https://porchandparty901.com';
const CITIES = areas.areas.map((a) => a.split(',')[0]);
const cityList = `${CITIES.slice(0, -1).join(', ')}, and ${CITIES[CITIES.length - 1]}`;
const PICKUP = games.pickup.place;

const HOME = Object.freeze({
  title: 'Memphis Porch Decorating, Party Planning, Grazing Tables & Game Rentals | Porch & Party',
  description: `Memphis porch decorating from $${PRICES.porch}, party planning & decor, grazing tables, and party game rentals at $${PRICES.gameDay} a game per day, for homes and hotels.`,
  socialTitle: `Porch & Party · ${SERVICE_SENTENCE}`,
  h1: SERVICE_SENTENCE.replace(/\.$/, ' for homes, hotels and porches.'),
  orgDescription: `${IDENTITY_SENTENCE} Serving ${cityList} across the Memphis metro area.`,
  webPageDescription: `${IDENTITY_SENTENCE} Porch decor from $${PRICES.porch}, party and hotel-room setups from $${PRICES.party}, grazing table styling from $${PRICES.grazing}, and giant yard games at $${PRICES.gameDay} a game per day across the Memphis metro area.`,
  rentalsQ: 'Do you rent party games?',
  rentalsA: `Yes. Giant yard games are $${PRICES.gameDay} a game per day, with bundles from $${PRICES.bundleFrom}. You pick up and return them at ${PICKUP}, a safe exchange zone.`
});

const ROOT_PAGES = Object.freeze({
  'pricing.html': `Starting prices for Memphis ${SERVICE_LIST} from Porch & Party, and what changes a quote.`,
  'contact.html': `Request a Porch & Party quote for Memphis ${SERVICE_LIST} by form, phone or email.`,
  'how-it-works.html': `How Porch & Party handles quotes, planning and setup for Memphis ${SERVICE_LIST}.`
});

const RENTALS_ENTITY = `- Party Game Rentals: Giant yard games, an inflatable movie screen and a card table, picked up and returned at ${PICKUP}. $${PRICES.gameDay} a game per day; bundles from $${PRICES.bundleFrom}. URL: ${DOMAIN}/rentals/`;
const RENTALS_QA = `Q: Does Porch & Party rent party games?\nA: Yes. Porch & Party rents giant yard games for $${PRICES.gameDay} a game per day, with bundles from $${PRICES.bundleFrom}. You pick up and return them at ${PICKUP}.\nURL: ${DOMAIN}/rentals/`;

const missingAnchor = [];
function sub(text, re, fn, label) {
  if (!re.test(text)) { missingAnchor.push(label); return text; }
  return text.replace(re, fn);
}

/** Sets the content of one <meta> identified by name= or property=, whatever the attribute order. */
function setMeta(html, attr, key, value, file) {
  const re = new RegExp(`<meta\\b(?=[^>]*\\b${attr}="${key}")[^>]*>`);
  return sub(html, re, (tag) => tag.replace(/\bcontent="[^"]*"/, `content="${esc(value)}"`), `${file} meta ${key}`);
}

function setLd(html, pick, edit, label) {
  let hit = false;
  const out = html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, (whole, a, body, c) => {
    let node;
    try { node = JSON.parse(body); } catch { return whole; }
    if (!pick(node)) return whole;
    hit = true;
    edit(node);
    return a + JSON.stringify(node) + c;
  });
  if (!hit) missingAnchor.push(label);
  return out;
}

const rentalsCard = () => `<article class="card" data-brand="rentals-card"><div class="card-media"><img alt="${esc(games.hero.alt)}" src="${games.hero.file}"/></div><div class="card-body"><h3>Party Game Rentals</h3><p>Giant yard games, an inflatable movie screen and a card table for backyard parties, birthdays, reunions and school events, picked up and returned at ${esc(PICKUP)}.</p><p class="muted">Starting at $${PRICES.gameDay} a game per day. Bundles from $${PRICES.bundleFrom}.</p><p><a href="/rentals/"><strong>See party game rentals</strong></a></p></div></article>`;
const rentalsPrice = () => `<div class="pricing-card" data-brand="rentals-price"><h3>Party Game Rentals</h3><span class="price">$${PRICES.gameDay}</span><p>A game per day, $${games.rates.weekend} for a weekend. Bundles from $${PRICES.bundleFrom}.</p><p class="muted">Pick up and return at ${esc(PICKUP)}. $${games.damageDeposit} refundable damage deposit.</p></div>`;
/** pricing.html variant: the page's cards use <h2> and each carries its own next-step link. */
const rentalsPricingPage = () => `<div class="pricing-card" data-brand="rentals-price"><h2>Party Game Rentals</h2><span class="price">$${PRICES.gameDay}+</span><p>Starting at $${PRICES.gameDay} a game per day, $${games.rates.weekend} for a weekend. Bundles from $${PRICES.bundleFrom}.</p><p class="muted">Pick up and return at ${esc(PICKUP)}. $${games.damageDeposit} refundable damage deposit.</p><p class="pricing-tool"><a class="btn-secondary" href="/rentals/">See party game rentals</a></p></div>`;
const rentalsFaq = () => `<article class="faq-item" data-brand="rentals-faq"><h3>${esc(HOME.rentalsQ)}</h3><p>${esc(HOME.rentalsA)}</p></article>`;

/** Puts `block` (marked data-brand=`mark`) as the last child of the first container opened by `openRe`. */
function ownLastChild(html, openRe, mark, block, closer, label) {
  let out = html.replace(new RegExp(`<(article|div) class="[^"]*" data-brand="${mark}">[\\s\\S]*?</${closer}>`), '');
  // the block's own outer element is article/div; strip by marker, then re-add
  const m = openRe.exec(out);
  if (!m) { missingAnchor.push(label); return html; }
  // walk to the matching close of the container
  const start = m.index + m[0].length;
  let depth = 1; let i = start; const tag = /<(\/?)div\b[^>]*>/g; tag.lastIndex = start;
  let t;
  while ((t = tag.exec(out))) { depth += t[1] ? -1 : 1; if (depth === 0) { i = t.index; break; } }
  if (depth !== 0) { missingAnchor.push(label); return html; }
  return out.slice(0, i) + block + out.slice(i);
}

function home(html) {
  const f = 'index.html';
  let out = sub(html, /<title>[^<]*<\/title>/, () => `<title>${esc(HOME.title)}</title>`, `${f} title`);
  for (const [attr, key] of [['name', 'description'], ['property', 'og:description'], ['name', 'twitter:description']]) out = setMeta(out, attr, key, HOME.description, f);
  for (const [attr, key] of [['property', 'og:title'], ['name', 'twitter:title']]) out = setMeta(out, attr, key, HOME.socialTitle, f);
  out = sub(out, /(<h1 class="hero-lead">)[\s\S]*?(<\/h1>)/, (w, a, b) => a + esc(HOME.h1) + b, `${f} H1`);
  out = sub(out, /(<p class="hero-definition" id="what-is-porch-and-party">)[\s\S]*?\.\s/, (w, a) => `${a}${esc(IDENTITY_SENTENCE)} `, `${f} definition paragraph`);
  out = sub(out, /(<span class="eyebrow">Quick Answer<\/span>\s*<h2>[^<]*<\/h2>\s*<p>)[\s\S]*?\.\s/, (w, a) => `${a}${esc(IDENTITY_SENTENCE)} `, `${f} Quick Answer`);
  out = setLd(out, (n) => n['@id'] === `${DOMAIN}/#business`, (n) => { n.description = HOME.orgDescription; }, `${f} business JSON-LD`);
  out = setLd(out, (n) => n['@type'] === 'WebPage', (n) => { n.description = HOME.webPageDescription; }, `${f} WebPage JSON-LD`);
  out = setLd(out, (n) => n['@type'] === 'FAQPage', (n) => {
    n.mainEntity = (n.mainEntity || []).filter((q) => q.name !== HOME.rentalsQ);
    n.mainEntity.push({ '@type': 'Question', name: HOME.rentalsQ, acceptedAnswer: { '@type': 'Answer', text: HOME.rentalsA } });
  }, `${f} FAQPage JSON-LD`);
  out = out.replace(/<div class="cards-grid(?: cards-grid--four)?">(?=\s*<article class="card">\s*<div class="card-media">\s*<img alt="Seasonal porch decorating)/, '<div class="cards-grid cards-grid--four">');
  out = ownLastChild(out, /<div class="cards-grid cards-grid--four">/, 'rentals-card', rentalsCard(), 'article', `${f} service cards`);
  out = out.replace(/<div class="pricing-grid(?: pricing-grid--four)?">/, '<div class="pricing-grid pricing-grid--four">');
  out = ownLastChild(out, /<div class="pricing-grid pricing-grid--four">/, 'rentals-price', rentalsPrice(), 'div', `${f} pricing cards`);
  out = ownLastChild(out, /<section class="section" id="faq">[\s\S]*?<div class="faq-list">/, 'rentals-faq', rentalsFaq(), 'article', `${f} FAQ list`);
  return out;
}

function rootPage(html, file) {
  let out = html;
  for (const [attr, key] of [['name', 'description'], ['property', 'og:description'], ['name', 'twitter:description']]) out = setMeta(out, attr, key, ROOT_PAGES[file], file);
  out = setLd(out, (n) => n['@type'] === 'WebPage', (n) => { n.description = ROOT_PAGES[file]; }, `${file} WebPage JSON-LD`);
  if (file === 'pricing.html') {
    out = out.replace(/<div class="pricing-grid(?: pricing-grid--four)?">/, '<div class="pricing-grid pricing-grid--four">');
    out = ownLastChild(out, /<div class="pricing-grid pricing-grid--four">/, 'rentals-price', rentalsPricingPage(), 'div', `${file} pricing cards`);
  }
  return staleIdentity(out);
}

/** Retired identity sentences in JSON-LD become IDENTITY_SENTENCE; nothing else on the page moves. */
function staleIdentity(html) {
  let out = html;
  for (const old of brand.STALE_IDENTITIES) out = out.split(`"description":${JSON.stringify(old)}`).join(`"description":${JSON.stringify(IDENTITY_SENTENCE)}`);
  return out;
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.pages-output', 'reports']);
/** Every html file the site publishes (repo-relative), archived reports and build output excluded. */
function siteHtml(dir = ROOT, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) siteHtml(path.join(dir, e.name), out); } else if (e.name.endsWith('.html')) out.push(path.relative(ROOT, path.join(dir, e.name)));
  }
  return out;
}

function manifest(text) {
  const m = JSON.parse(text);
  m.description = SERVICE_SENTENCE;
  return JSON.stringify(m, null, 2).replace(/\{\n\s+("src"[^}]*?)\n\s+\}/g, (w, inner) => `{ ${inner.replace(/,\n\s+/g, ', ')} }`) + '\n';
}

function llms(text, file) {
  let out = text;
  if (file === 'llms.txt') {
    out = sub(out, /^Primary-Entity: .*$/m, () => `Primary-Entity: Memphis company for ${SERVICE_LIST}`, `${file} Primary-Entity`);
    out = sub(out, /(^Primary Identity:\n).*$/m, (w, a) => a + IDENTITY_SENTENCE, `${file} Primary Identity`);
  }
  if (file === 'llms-full.txt') out = sub(out, /^(# Porch & Party[^\n]*\n\n).*$/m, (w, a) => a + IDENTITY_SENTENCE, `${file} identity line`);
  if (file === 'llms-entities.txt') {
    out = sub(out, /^- Porch & Party: .*$/m, () => `- Porch & Party: ${IDENTITY_SENTENCE} URL: ${DOMAIN}/`, `${file} identity line`);
    out = out.replace(/^- Party Game Rentals: .*\n/m, '');
    out = sub(out, /^(- Grazing Tables & Styled Setups: .*\n)/m, (w, a) => `${a}${RENTALS_ENTITY}\n`, `${file} grazing entity line`);
  }
  if (file === 'llms-answers.txt') {
    out = sub(out, /(^Q: What is Porch & Party\?\nA: ).*$/m, (w, a) => a + IDENTITY_SENTENCE, `${file} identity answer`);
    out = out.replace(/^Q: Does Porch & Party rent party games\?\n.*\n.*\n\n/m, '');
    out = sub(out, /(^Q: Does Porch & Party do grazing table setups\?\n.*\n.*\n\n)/m, (w, a) => `${a}${RENTALS_QA}\n\n`, `${file} grazing Q&A`);
  }
  return out;
}

function main() {
  const jobs = [
    ['index.html', home],
    ...Object.keys(ROOT_PAGES).map((f) => [f, (t) => rootPage(t, f)]),
    ...siteHtml().filter((f) => f !== 'index.html' && !(f in ROOT_PAGES)).map((f) => [f, staleIdentity]),
    ['site.webmanifest', manifest],
    ...['llms.txt', 'llms-full.txt', 'llms-entities.txt', 'llms-answers.txt'].map((f) => [f, (t) => llms(t, f)])
  ];
  let changed = 0;
  const writes = [];
  for (const [file, fn] of jobs) {
    const abs = path.join(ROOT, file);
    const before = fs.readFileSync(abs, 'utf8');
    const after = fn(before);
    if (after !== before) writes.push([abs, after]);
  }
  if (missingAnchor.length) { console.error(`brand-surfaces: FAIL - no anchor for: ${missingAnchor.join('; ')}`); process.exit(1); }
  for (const [abs, after] of writes) { fs.writeFileSync(abs, after); changed += 1; }
  console.log(`brand-surfaces: ${jobs.length} surface file(s) checked, ${changed} updated`);
}

if (require.main === module) main();
module.exports = { HOME, ROOT_PAGES, RENTALS_ENTITY, RENTALS_QA, siteHtml };
