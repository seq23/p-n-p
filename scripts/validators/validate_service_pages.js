#!/usr/bin/env node
'use strict';
/**
 * validate:service-pages - exactly four services, one strong page each (owner ruling 21 Oct 2026),
 * with "Book online" above the fold everywhere (owner ruling 21 Oct 2026).
 *
 * Registry (scripts/lib/service_pages.js PAGES) is exactly porch, party, grazing, rentals, and the
 * header nav names exactly those four service pages (no fifth service). For each service page:
 *   - published, in sitemap.xml at its served URL, canonical to it;
 *   - above the first <h2>: the direct answer with the "from" price from the data files and a
 *     "Book online" link to /request?service=<key>; "Book online" again after the FAQ;
 *   - a visible FAQ of 5+ questions, including how to pay and how far ahead to book, and a
 *     FAQPage JSON-LD that is exactly the visible questions; a Service JSON-LD node for the page;
 *   - links to /request and /pricing;
 *   - 3+ registered AI pictures (data/offers/service_ai_images.json), each with its registered
 *     alt text, no caption (owner ruling 21 Oct 2026); rental pictures map only to availableNow
 *     items in data/rentals/games.json (owner ruling 21 Oct 2026);
 *   - the named sub-sections: #hotel-room-setups "Hotel Room Setups" on the party page,
 *     #giant-lawn-games "Giant Lawn Games" on the rentals page;
 *   - never "insured", no testimonial/review claims;
 *   - the three hand-maintained pages equal a fresh scripts/install_service_pages.js pass.
 * Every one of the 32 city pages links all four service pages (and both named sub-sections)
 * from its sibling block and carries "Book online" above its first <h2>; so does the home page,
 * which also links all four service pages; so does the services hub.
 * Hard-fails on zero pages; self-test probes must each fail.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SP = require(path.join(ROOT, 'scripts/lib/service_pages.js'));
const BO = require(path.join(ROOT, 'scripts/lib/book_online.js'));
const G = require(path.join(ROOT, 'scripts/generators/build_area_pages.js'));
const chrome = require(path.join(ROOT, 'scripts/lib/site_chrome.js'));
const { servicePage } = require(path.join(ROOT, 'scripts/install_service_pages.js'));
const offers = require(path.join(ROOT, 'data/offers/services.json'));
const rentals = require(path.join(ROOT, 'data/rentals/games.json'));

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const plain = (h) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|’/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const hrefs = (h) => [...h.matchAll(/<a\b[^>]*?\bhref="([^"]+)"/gi)].map((m) => m[1]);
const ldOf = (h) => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => { try { const o = JSON.parse(m[1]); return Array.isArray(o) ? o : [o]; } catch (e) { return [{ __bad: m[1].slice(0, 60) }]; } });
const mainOf = (h) => { const i = h.indexOf('<main'); return i < 0 ? '' : h.slice(i, h.indexOf('</main>', i)); };
const aboveH2 = (h) => { const m = mainOf(h); const i = m.indexOf('<h2'); return i < 0 ? m : m.slice(0, i); };
const AVAILABLE = new Set([...(rentals.games || []), ...(rentals.extras || [])].filter((g) => g.availableNow).map((g) => g.slug));
const sitemap = read('sitemap.xml');

const KEYS = ['porch', 'party', 'grazing', 'rentals'];

/** Every problem on one service page's HTML. */
function checkPage(p, html) {
  const e = [];
  const rel = p.file;
  const text = plain(mainOf(html));
  const top = aboveH2(html);
  const links = hrefs(mainOf(html));
  const canon = (html.match(/<link\b[^>]*rel="canonical"[^>]*>/) || [''])[0];
  if (!canon.includes(`href="${offers.domain}${p.url}"`)) e.push(`${rel}: canonical is not ${offers.domain}${p.url}`);
  // Above the fold: direct answer with the price + Book online preselecting the service.
  if (!plain(top).includes(SP.money(p.from))) e.push(`${rel}: the direct answer above the first <h2> does not state the ${SP.money(p.from)} price (${p.fromText})`);
  const book = BO.heroBookLink(html);
  if (book !== BO.href(p.request)) e.push(`${rel}: no "Book online" link to ${BO.href(p.request)} above the first <h2> (found ${book})`);
  if (!/data-book-online="after-faq">Book online<\/a>/.test(html)) e.push(`${rel}: no "Book online" button after the FAQ`);
  // FAQ: visible = JSON-LD, 5+, pay + how far ahead.
  const faqHtml = (mainOf(html).match(/<div class="faq-list">([\s\S]*?)<\/div><\/div>(?:<\/div>|\s*<div class="btn-row)/) || [])[1] || '';
  const visible = [...faqHtml.matchAll(/<div class="faq-item"><h3>([\s\S]*?)<\/h3>/g)].map((m) => plain(m[1]).trim());
  const ld = ldOf(html);
  if (ld.some((o) => o.__bad)) e.push(`${rel}: a JSON-LD block does not parse`);
  const faqLd = ld.filter((o) => o['@type'] === 'FAQPage');
  const ldQs = faqLd.length === 1 ? (faqLd[0].mainEntity || []).map((q) => q.name) : [];
  if (faqLd.length !== 1) e.push(`${rel}: ${faqLd.length} FAQPage JSON-LD blocks (want 1)`);
  if (visible.length < 5) e.push(`${rel}: ${visible.length} visible FAQ questions (want 5+)`);
  if (JSON.stringify(ldQs) !== JSON.stringify(visible)) e.push(`${rel}: FAQPage JSON-LD questions differ from the visible FAQ`);
  if (faqLd.length === 1 && (faqLd[0].mainEntity || []).some((q) => q['@type'] !== 'Question' || !q.acceptedAnswer || q.acceptedAnswer['@type'] !== 'Answer' || !q.acceptedAnswer.text)) e.push(`${rel}: an FAQPage question lacks a Question/Answer shape`);
  if (!visible.some((q) => /\bpay\b/i.test(q))) e.push(`${rel}: the FAQ does not answer how to pay`);
  if (!visible.some((q) => /how far ahead/i.test(q))) e.push(`${rel}: the FAQ does not answer how far ahead to book`);
  const svc = ld.filter((o) => o['@type'] === 'Service');
  if (!svc.some((o) => String(o.url || '').replace(/\/$/, '') === `${offers.domain}${p.url}`.replace(/\/$/, ''))) e.push(`${rel}: no Service JSON-LD for ${p.url}`);
  if (!links.some((h) => h === '/request' || h.startsWith('/request?'))) e.push(`${rel}: no link to /request`);
  if (!links.includes('/pricing')) e.push(`${rel}: no link to /pricing`);
  // Pictures: 3+ registered AI pictures with their alt, no caption.
  const imgs = SP.imagesFor(p.key);
  if (imgs.length < 3) e.push(`${rel}: ${imgs.length} registered AI pictures (want 3+)`);
  for (const i of imgs) {
    const m = html.match(new RegExp(`<img src="/${i.file.replace(/[.]/g, '\\.')}" alt="([^"]*)"`));
    if (!m) e.push(`${rel}: AI picture ${i.file} is not on the page`);
    else if (m[1] !== SP.esc(i.alt) || i.alt.length < 30) e.push(`${rel}: AI picture ${i.file} lacks its registered descriptive alt text`);
    if (p.key === 'rentals') {
      if (!(i.items || []).length) e.push(`${i.file}: rental AI picture is not mapped to any rental item`);
      for (const it of i.items || []) if (!AVAILABLE.has(it)) e.push(`${i.file}: shows ${it}, which is not availableNow in data/rentals/games.json`);
    }
  }
  if (/Example styling|<figcaption/i.test(mainOf(html))) e.push(`${rel}: AI pictures carry a caption (owner ruling 21 Oct 2026: none)`);
  if (/\binsured\b/i.test(text)) e.push(`${rel}: says "insured" (never claim it)`);
  if (/\btestimonial|\breviews?\b[^.]{0,40}\b(say|rated|stars?)\b/i.test(text)) e.push(`${rel}: carries review/testimonial wording`);
  // Named sub-sections.
  const SUBS = { party: ['hotel-room-setups', 'Hotel Room Setups'], rentals: ['giant-lawn-games', 'Giant Lawn Games'] };
  if (SUBS[p.key]) {
    const [id, h2] = SUBS[p.key];
    if (!new RegExp(`id="${id}"[^>]*>[\\s\\S]{0,200}?<h2>${h2}</h2>`).test(html)) e.push(`${rel}: no #${id} sub-section headed "${h2}"`);
  }
  if (!sitemap.includes(`<loc>${offers.domain}${p.url}</loc>`)) e.push(`${rel}: not in sitemap.xml as ${offers.domain}${p.url}`);
  return e;
}

const errors = [];
let checks = 0;
const ok = (cond, msg) => { checks += 1; if (!cond) errors.push(msg); };

// ---- registry: exactly four.
ok(SP.PAGES.length === 4 && JSON.stringify(SP.PAGES.map((p) => p.key)) === JSON.stringify(KEYS), `service registry is [${SP.PAGES.map((p) => p.key).join(', ')}], ruled exactly [${KEYS.join(', ')}]`);
if (!SP.PAGES.length) { console.error('SERVICE PAGES FAILED: zero service pages enforces nothing.'); process.exit(1); }
const urls = SP.PAGES.map((p) => p.url);
const navServices = chrome.NAV_ITEMS.filter((i) => i.href.startsWith('/services/') || i.href.startsWith('/rentals'));
ok(JSON.stringify(navServices.map((i) => i.href)) === JSON.stringify(urls), `header nav names services [${navServices.map((i) => i.href).join(', ')}], ruled exactly the four pages [${urls.join(', ')}]`);

// ---- each service page.
let pages = 0;
for (const p of SP.PAGES) {
  if (!fs.existsSync(path.join(ROOT, p.file))) { ok(false, `${p.file}: missing`); continue; }
  pages += 1;
  const html = read(p.file);
  const errs = checkPage(p, html);
  checks += 20;
  errors.push(...errs);
  if (!p.generated) ok(servicePage(p, html) === html, `${p.file}: differs from a fresh install (run npm run service-pages:install)`);
}

// ---- home + services hub: Book online above the fold, all four linked.
for (const rel of ['index.html', 'services/index.html']) {
  const html = read(rel);
  const l = hrefs(mainOf(html));
  for (const u of urls) ok(l.includes(u), `${rel}: does not link the ${u} service page`);
  if (rel === 'index.html') ok(BO.heroBookLink(html) === BO.href(null), `${rel}: no "Book online" link to /request above the first <h2>`);
}

// ---- the 32 city pages.
let areaPages = 0;
for (const city of G.cities()) {
  for (const svc of G.SERVICE_KEYS) {
    const rel = G.relOf(city, svc);
    if (!fs.existsSync(path.join(ROOT, rel))) { ok(false, `${rel}: missing`); continue; }
    areaPages += 1;
    const html = read(rel);
    const sib = (html.match(/<!--area-siblings-->[\s\S]*?<!--\/area-siblings-->/) || [''])[0];
    const sl = hrefs(sib);
    for (const u of urls) ok(sl.includes(u), `${rel}: sibling block does not link the ${u} service page`);
    ok(sl.includes('/services/celebration-setups#hotel-room-setups') && sl.includes('/rentals/#giant-lawn-games'), `${rel}: sibling block does not link #hotel-room-setups and #giant-lawn-games`);
    ok(BO.heroBookLink(html) === BO.href(G.REQUEST_KEY[svc]), `${rel}: no "Book online" link to ${BO.href(G.REQUEST_KEY[svc])} above the first <h2>`);
  }
}
if (areaPages !== 32) ok(false, `${areaPages} city service pages checked, want 32`);

// ---- self-test: each broken copy must fail.
const party = SP.PAGES.find((p) => p.key === 'party');
const rentalsPage = SP.PAGES.find((p) => p.key === 'rentals');
const ph = read(party.file);
const rh = read(rentalsPage.file);
const probes = {
  'no Book online above the fold': [party, ph.replace('data-book-online="hero">Book online</a>', 'data-book-online="hero">Request a Quote</a>')],
  'no Book online after the FAQ': [party, ph.replace('data-book-online="after-faq">Book online', 'data-book-online="after-faq">Get started')],
  'a missing AI picture': [party, ph.replace(/<img src="\/assets\/img\/celebrations\/ai-hotel-room-rose-petals\.webp"[^>]*>/, '')],
  'an AI picture with a caption': [party, ph.replace('</main>', '<p>Example styling</p></main>')],
  'no Hotel Room Setups section': [party, ph.replace('<h2>Hotel Room Setups</h2>', '<h2>Hotel rooms</h2>')],
  'FAQ JSON-LD out of step': [party, ph.replace('"name":"How do I pay?"', '"name":"How do I settle up?"')],
  'a wrong from price': [party, ph.split(SP.money(SP.partyFrom)).join('$275')],
  'says insured': [party, ph.replace('</main>', '<p>We are fully insured.</p></main>')],
  'no Giant Lawn Games section': [rentalsPage, rh.replace('<h2>Giant Lawn Games</h2>', '<h2>Yard games</h2>')],
};
for (const [what, [p, html]] of Object.entries(probes)) {
  checks += 1;
  if (html === (p === party ? ph : rh)) errors.push(`self-test: could not build the "${what}" probe (page shape changed)`);
  else if (!checkPage(p, html).length) errors.push(`self-test: a page with ${what} PASSED`);
}
// An unavailable game in a rental picture must fail.
{
  const i = SP.imagesFor('rentals')[0];
  const saved = i.items;
  i.items = ['giant-tumble-tower'];
  checks += 1;
  if (!checkPage(rentalsPage, rh).some((x) => x.includes('giant-tumble-tower'))) errors.push('self-test: a rental picture showing an unavailable game PASSED');
  i.items = saved;
}

if (!pages) errors.push('Rule 0: zero service pages checked');
if (errors.length) {
  console.error(`SERVICE PAGES FAILED (${errors.length}):\n${errors.slice(0, 40).map((x) => `  - ${x}`).join('\n')}`);
  process.exit(1);
}
console.log(`service-pages: OK - ${checks} checks: exactly ${pages} service pages (${KEYS.join(' · ')}), each priced from data, Book online above the fold and after the FAQ, 5+ FAQ = FAQPage JSON-LD, Service JSON-LD, ${SP.AI.images.length} registered AI pictures (rentals only availableNow items, no captions), #hotel-room-setups + #giant-lawn-games; home + ${areaPages} city pages carry Book online and link all four; ${Object.keys(probes).length + 1} self-test probes fail as they should`);
