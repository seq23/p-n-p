#!/usr/bin/env node
'use strict';
/**
 * The four services everywhere a summary is drawn from (owner-approved
 * 2026-10-18): porch decorating, party planning & decor, grazing tables and
 * party game rentals, read from scripts/lib/brand.js SERVICES.
 *
 * Fails when any of these surfaces lacks any one of the four (label or alias,
 * case-insensitive, entities decoded):
 *   index.html   meta description, og:description, og:title, H1, the
 *                Quick Answer block, the business (Organization) JSON-LD
 *                description, the WebPage JSON-LD description;
 *   site.webmanifest description; llms.txt Primary Identity line;
 *   llms-entities.txt; llms-answers.txt;
 *   services/index.html meta description and its card headings (together);
 *   pricing.html, contact.html, how-it-works.html meta descriptions;
 *   pricing.html pricing cards: exactly four, their headings together
 *                naming all four services, the Party Game Rentals card
 *                quoting the data-file prices and linking /rentals/.
 * pricing.html also links the FAQ page's two tools ("Price my porch" ->
 * /faq/#porch-picker, "Estimate my grazing table" -> /faq/#grazing-estimator)
 * as btn-secondary links, and both ids exist in faq/index.html.
 * THE HOMEPAGE <title> IS THE ONE SURFACE NOT HELD TO ALL FOUR, because at the
 * length a search result shows it cannot be. The owner's Search Readiness
 * Checklist (25 Oct 2026) holds every sampled page's title to 30-65 characters
 * (item b1) and audits this site every Monday; the four labels and aliases are
 * 53 characters before a separator or the city, so "all four in the title" and
 * "65 characters" cannot both hold. Until 2026-10-26 the title won, at 87
 * characters, and the checklist reported the homepage as its one standing
 * failure every run. The later ruling wins.
 *
 * So the title keeps its own rule, checked here and nowhere else: it names at
 * least TITLE_MIN_SERVICES (3) of the four, and it names the city. That is a
 * NEW assertion, not a dropped one - before this the title had no city check at
 * all - and the fourth service is still required on all eight other homepage
 * surfaces, so nothing about what the site advertises has changed.
 *
 * Plus the pins that make those surfaces the approved ones: the homepage
 * title, og:title, H1, definition and Quick Answer openings are exactly the
 * brand.js strings; the homepage description is <=160 characters, quotes the
 * porch and game prices from the data files and no phone number; the homepage
 * carries the fourth (Party Game Rentals) service card, pricing card and FAQ.
 *
 * Retired identity: fails when any published html (scripts/install_brand_surfaces.js
 * siteHtml: archived reports and build output excluded) carries a
 * brand.STALE_IDENTITY_PHRASES phrase ("celebration styling company", "styled
 * event tables") or a brand.STALE_IDENTITIES sentence, when it scans zero
 * html files, or when data/offers/services.json carries a primaryIdentity
 * (brand.IDENTITY_SENTENCE is the one source).
 *
 * Hard-fails on zero surfaces checked. Self-test: broken copies held in
 * memory (a title without grazing, a services index without its rentals
 * card, a manifest without porch decorating, an empty file set) must FAIL.
 * Repair: node scripts/install_brand_surfaces.js (index, root pages, manifest,
 * llms files) or node scripts/generators/build_section_indexes.js (services).
 */
const fs = require('fs');
const path = require('path');
const brand = require('../lib/brand');
const { HOME, siteHtml } = require('../install_brand_surfaces');

const ROOT = path.resolve(__dirname, '../..');
const FILES = ['index.html', 'site.webmanifest', 'llms.txt', 'llms-entities.txt', 'llms-answers.txt',
  'services/index.html', 'pricing.html', 'contact.html', 'how-it-works.html', 'faq/index.html'];
/** The FAQ page's tools the pricing page links to (labels match the FAQ map cards). */
/**
 * The homepage <title> names at least this many of the four services, plus the
 * city. Three is the most that fits inside the checklist's 65 characters with
 * the city and the site name; see the header. Raising it makes this stricter,
 * lowering it does not - do not lower it.
 */
const TITLE_MIN_SERVICES = 3;
const TITLE_CITY = 'Memphis';

/**
 * Everything wrong with a homepage <title>, as its own function.
 *
 * It is separate from check() on purpose: check() also pins the title to
 * HOME.title exactly, so a probe that alters the title fails on the pin no
 * matter what, and a self-test driven through check() cannot tell whether the
 * services-and-city rule works at all. The probes below call this directly.
 */
function titleProblems(title) {
  const bad = [];
  if (title === '') { bad.push('index.html <title>: surface not found'); return bad; }
  const named = brand.SERVICES.filter((s) => brand.names(title, s));
  if (named.length < TITLE_MIN_SERVICES) {
    bad.push(`index.html <title> names ${named.length} of the four services (${named.map((s) => `"${s.label}"`).join(', ') || 'none'}), needs at least ${TITLE_MIN_SERVICES}: "${title}"`);
  }
  if (!title.toLowerCase().includes(TITLE_CITY.toLowerCase())) {
    bad.push(`index.html <title> does not name ${TITLE_CITY}: "${title}"`);
  }
  return bad;
}
const PRICING_TOOLS = Object.freeze([
  Object.freeze({ label: 'Price my porch', id: 'porch-picker' }),
  Object.freeze({ label: 'Estimate my grazing table', id: 'grazing-estimator' })
]);
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const text = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const meta = (html, attr, key) => {
  const tag = (html.match(new RegExp(`<meta\\b(?=[^>]*\\b${attr}="${key}")[^>]*>`)) || [])[0];
  return tag ? decode((tag.match(/\bcontent="([^"]*)"/) || [])[1] || '') : null;
};
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);

function check(files) {
  const errors = [];
  let checked = 0;
  const surface = (label, value) => {
    if (value == null || value === '') { errors.push(`${label}: surface not found`); return; }
    checked += 1;
    const miss = brand.missing(value);
    if (miss.length) errors.push(`${label} lacks ${miss.map((s) => `"${s.label}"`).join(', ')}: "${String(value).slice(0, 120)}"`);
  };
  const home = files['index.html'];
  if (home != null) {
    const title = decode((home.match(/<title>([^<]*)<\/title>/) || [])[1] || '');
    const titleBad = titleProblems(title);
    if (titleBad.length) errors.push(...titleBad);
    if (title !== '') checked += 1;
    if (title !== HOME.title) errors.push(`index.html <title> is not the approved "${HOME.title}"`);
    const desc = meta(home, 'name', 'description');
    surface('index.html meta description', desc);
    surface('index.html og:description', meta(home, 'property', 'og:description'));
    if (desc != null) {
      if (desc.length > 160) errors.push(`index.html meta description is ${desc.length} characters, max 160`);
      for (const n of [brand.PRICES.porch, brand.PRICES.gameDay]) if (!desc.includes(`$${n}`)) errors.push(`index.html meta description does not quote $${n} from the data files`);
      if (/\d{3}[-. ]\d{3}[-. ]\d{4}/.test(desc)) errors.push('index.html meta description carries a phone number');
      for (const [a, k] of [['property', 'og:description'], ['name', 'twitter:description']]) if (meta(home, a, k) !== desc) errors.push(`index.html ${k} differs from the meta description`);
    }
    const og = meta(home, 'property', 'og:title');
    surface('index.html og:title', og);
    if (og !== HOME.socialTitle || meta(home, 'name', 'twitter:title') !== HOME.socialTitle) errors.push(`index.html og:title / twitter:title are not "${HOME.socialTitle}"`);
    const h1 = text((home.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/) || [])[1]);
    surface('index.html H1', h1);
    if (!h1.startsWith(brand.SERVICE_SENTENCE.replace(/\.$/, ''))) errors.push('index.html H1 does not open with brand.SERVICE_SENTENCE');
    const def = text((home.match(/<p class="hero-definition"[^>]*>([\s\S]*?)<\/p>/) || [])[1]);
    if (!def.startsWith(brand.IDENTITY_SENTENCE)) errors.push('index.html definition paragraph does not open with brand.IDENTITY_SENTENCE');
    const qa = text((home.match(/<span class="eyebrow">Quick Answer<\/span>([\s\S]*?)<\/div>/) || [])[1]);
    surface('index.html Quick Answer block', qa);
    if (!text((home.match(/<span class="eyebrow">Quick Answer<\/span>\s*<h2>[^<]*<\/h2>\s*<p>([\s\S]*?)<\/p>/) || [])[1]).startsWith(brand.IDENTITY_SENTENCE)) errors.push('index.html Quick Answer does not open with brand.IDENTITY_SENTENCE');
    const nodes = ld(home);
    const biz = nodes.find((n) => n['@id'] === 'https://porchandparty901.com/#business');
    surface('index.html Organization JSON-LD description', biz && biz.description);
    if (biz && !String(biz.description).startsWith(brand.IDENTITY_SENTENCE)) errors.push('index.html Organization JSON-LD description does not open with brand.IDENTITY_SENTENCE');
    surface('index.html WebPage JSON-LD description', (nodes.find((n) => n['@type'] === 'WebPage') || {}).description);
    const card = (home.match(/<article class="card" data-brand="rentals-card">[\s\S]*?<\/article>/) || [])[0] || '';
    if (!/<h3>Party Game Rentals<\/h3>/.test(card) || !card.includes(`$${brand.PRICES.gameDay} a game per day`) || !card.includes('href="/rentals/"')) errors.push('index.html lacks the fourth service card (Party Game Rentals, $/game/day, /rentals/)');
    if (!/<div class="pricing-card" data-brand="rentals-price"><h3>Party Game Rentals<\/h3><span class="price">\$\d+<\/span>/.test(home)) errors.push('index.html Starting Pricing lacks the Party Game Rentals card');
    const faq = nodes.find((n) => n['@type'] === 'FAQPage');
    if (!faq || !(faq.mainEntity || []).some((q) => q.name === HOME.rentalsQ && q.acceptedAnswer.text === HOME.rentalsA) || !home.includes('data-brand="rentals-faq"')) errors.push('index.html FAQ (visible and JSON-LD) lacks the rentals question');
  }
  if (files['site.webmanifest'] != null) {
    let d = null; try { d = JSON.parse(files['site.webmanifest']).description; } catch { /* reported below */ }
    surface('site.webmanifest description', d);
    if (d !== brand.SERVICE_SENTENCE) errors.push('site.webmanifest description is not brand.SERVICE_SENTENCE');
  }
  if (files['llms.txt'] != null) surface('llms.txt identity line', (files['llms.txt'].match(/^Primary Identity:\n(.+)$/m) || [])[1]);
  if (files['llms-entities.txt'] != null) {
    surface('llms-entities.txt', files['llms-entities.txt']);
    surface('llms-entities.txt identity line', (files['llms-entities.txt'].match(/^- Porch & Party: (.+)$/m) || [])[1]);
    if (!/^- Party Game Rentals: .*\/rentals\/$/m.test(files['llms-entities.txt'])) errors.push('llms-entities.txt lacks the Party Game Rentals entity line');
  }
  if (files['llms-answers.txt'] != null) {
    surface('llms-answers.txt', files['llms-answers.txt']);
    surface('llms-answers.txt identity answer', (files['llms-answers.txt'].match(/^Q: What is Porch & Party\?\nA: (.+)$/m) || [])[1]);
    if (!new RegExp(`^Q: Does Porch & Party rent party games\\?\\nA: .*\\$${brand.PRICES.gameDay}\\b.*\\nURL: https://porchandparty901\\.com/rentals/$`, 'm').test(files['llms-answers.txt'])) errors.push('llms-answers.txt lacks the "Does Porch & Party rent party games?" Q&A with the price and the rentals URL');
  }
  const svc = files['services/index.html'];
  if (svc != null) {
    surface('services/index.html meta description', meta(svc, 'name', 'description'));
    const heads = [...svc.matchAll(/<div class="answer-block"><h2>([^<]*)<\/h2>/g)].map((m) => decode(m[1]));
    surface('services/index.html card headings', heads.join(' | '));
    if (!heads.some((h) => h.startsWith(`Party Game Rentals - from $${brand.PRICES.gameDay}`))) errors.push('services/index.html lacks the Party Game Rentals card heading');
  }
  for (const rel of ['pricing.html', 'contact.html', 'how-it-works.html']) if (files[rel] != null) {
    const d = meta(files[rel], 'name', 'description');
    surface(`${rel} meta description`, d);
    for (const [a, k] of [['property', 'og:description'], ['name', 'twitter:description']]) if (meta(files[rel], a, k) !== d) errors.push(`${rel} ${k} differs from the meta description`);
  }
  const pricing = files['pricing.html'];
  if (pricing != null) {
    const grid = (pricing.match(/<div class="pricing-grid[^"]*">([\s\S]*?)<\/div><\/div>(?=<section|<p class="pricing-note)/) || [])[1] || '';
    const cards = [...grid.matchAll(/<div class="pricing-card"[^>]*><h2>([^<]*)<\/h2>/g)].map((m) => decode(m[1]));
    if (cards.length !== 4) errors.push(`pricing.html has ${cards.length} pricing card(s), want 4 (one per service)`);
    else surface('pricing.html pricing card headings', cards.join(' | '));
    const rc = (pricing.match(/<div class="pricing-card" data-brand="rentals-price">[\s\S]*?<\/div>/) || [])[0] || '';
    if (!/<h2>Party Game Rentals<\/h2>/.test(rc) || !rc.includes(`$${brand.PRICES.gameDay} a game per day`) || !rc.includes(`Bundles from $${brand.PRICES.bundleFrom}`) || !rc.includes('href="/rentals/"')) errors.push(`pricing.html lacks the Party Game Rentals pricing card ($${brand.PRICES.gameDay} a game per day, bundles from $${brand.PRICES.bundleFrom}, /rentals/)`);
    const faqPage = files['faq/index.html'];
    for (const t of PRICING_TOOLS) {
      if (!new RegExp(`<a class="btn-secondary" href="/faq/#${t.id}">${t.label}</a>`).test(pricing)) errors.push(`pricing.html lacks the "${t.label}" btn-secondary link to /faq/#${t.id}`);
      if (faqPage == null || !new RegExp(`\\bid="${t.id}"`).test(faqPage)) errors.push(`faq/index.html has no id="${t.id}" for the pricing page's "${t.label}" link`);
    }
  }
  if (checked === 0) errors.push('zero surfaces checked');
  return { errors, checked };
}

const files = {};
for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { console.error(`service-coverage: FAIL - ${rel} is missing`); process.exit(1); }
  files[rel] = fs.readFileSync(abs, 'utf8');
}
const result = check(files);

/** Retired identity wording across every published html file. */
function staleCheck(pages, offers) {
  const errors = [];
  const names = Object.keys(pages);
  if (!names.length) errors.push('stale-identity: zero html files scanned');
  for (const rel of names) {
    const t = decode(pages[rel]);
    for (const p of [...brand.STALE_IDENTITY_PHRASES, ...brand.STALE_IDENTITIES]) if (t.includes(p)) errors.push(`${rel} carries the retired identity wording "${p.slice(0, 60)}"`);
  }
  if (offers && Object.prototype.hasOwnProperty.call(offers, 'primaryIdentity')) errors.push('data/offers/services.json carries primaryIdentity; brand.IDENTITY_SENTENCE is the one source');
  return errors;
}
const pages = {};
for (const rel of siteHtml()) pages[rel] = fs.readFileSync(path.join(ROOT, rel), 'utf8');
const offers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8'));
result.errors.push(...staleCheck(pages, offers));
const staleProbes = {
  'an answer page whose business JSON-LD keeps the old identity': [{ ...pages, 'answers/probe.html': `<script type="application/ld+json">{"description":${JSON.stringify(brand.STALE_IDENTITIES[0])}}</script>` }, offers],
  'a contact page that says styled event tables': [{ ...pages, 'contact.html': `${pages['contact.html'] || ''}<p>hotel-room decor, and styled event tables.</p>` }, offers],
  'an html-escaped celebration styling company': [{ ...pages, 'probe.html': '<p>Porch &amp; Party is a Memphis-based porch decorating and celebration styling company</p>' }, offers],
  'services.json with primaryIdentity back': [pages, { ...offers, primaryIdentity: brand.IDENTITY_SENTENCE }],
  'zero html files': [{}, offers]
};
for (const [label, [p, o]] of Object.entries(staleProbes)) if (!staleCheck(p, o).length) result.errors.push(`self-test: "${label}" passed when it should fail`);

// Self-test: each broken copy must fail.
const probes = {
  'services index without its rentals card': { ...files, 'services/index.html': files['services/index.html'].replace(/<div class="answer-block"><h2>Party Game Rentals[^<]*<\/h2>/, '<div class="answer-block"><h2>More</h2>') },
  'manifest without porch decorating': { ...files, 'site.webmanifest': files['site.webmanifest'].replace(/porch decorating, /, '') },
  'homepage without the fourth card': { ...files, 'index.html': files['index.html'].replace(/<article class="card" data-brand="rentals-card">[\s\S]*?<\/article>/, '') },
  'pricing description without game rentals': { ...files, 'pricing.html': files['pricing.html'].replace(/(name="description"|content=")([^"]*?)party game rentals/, '$1$2') },
  'pricing page with three pricing cards': { ...files, 'pricing.html': files['pricing.html'].replace(/<div class="pricing-card" data-brand="rentals-price">[\s\S]*?<\/div>/, '') },
  'pricing page without the porch tool link': { ...files, 'pricing.html': files['pricing.html'].replace('href="/faq/#porch-picker"', 'href="/faq/"') },
  'pricing page without the grazing tool link': { ...files, 'pricing.html': files['pricing.html'].replace(/<a class="btn-secondary" href="\/faq\/#grazing-estimator">[^<]*<\/a>/, '') },
  'faq page without the porch-picker id': { ...files, 'faq/index.html': files['faq/index.html'].replace(/\bid="porch-picker"/, 'id="porch-picker-old"') },
  'faq page without the grazing-estimator id': { ...files, 'faq/index.html': files['faq/index.html'].replace(/\bid="grazing-estimator"/, 'id="x"') },
  'no files at all': {}
};
for (const [label, broken] of Object.entries(probes)) if (!check(broken).errors.length) result.errors.push(`self-test: "${label}" passed when it should fail`);

// Self-test for the homepage title's own rule. Called directly, not through
// check(), so the HOME.title pin cannot be what makes these fail.
const titleProbes = {
  'a title naming only two of the four services': 'Memphis Porch Decor & Grazing Tables | Porch & Party',
  'a title naming one service': 'Memphis Porch Decor | Porch & Party',
  'a title naming no service': 'Memphis Event Help | Porch & Party',
  'a title that does not name the city': 'Porch Decor, Party Decor & Grazing Tables | Porch & Party',
  'an empty title': ''
};
for (const [label, t] of Object.entries(titleProbes)) if (!titleProblems(t).length) result.errors.push(`self-test: "${label}" passed when it should fail`);
// ...and the approved title itself must pass, or the rule is unreachable.
if (titleProblems(HOME.title).length) result.errors.push(`self-test: the approved HOME.title fails its own rule: ${titleProblems(HOME.title).join('; ')}`);

if (result.errors.length) { console.error(`service-coverage: FAIL (${result.errors.length})`); result.errors.forEach((e) => console.error(`  - ${e}`)); process.exit(1); }
console.log(`service-coverage: OK - ${result.checked} surface(s) name all ${brand.SERVICES.length} services (${brand.SERVICES.map((s) => s.label).join(' · ')}); ${Object.keys(pages).length} html file(s) free of retired identity wording; ${Object.keys(probes).length + Object.keys(staleProbes).length + Object.keys(titleProbes).length} self-test probes fail as they should`);
