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
const FP = require(path.join(ROOT, 'scripts/lib/focus_pages.js'));
const FG = require(path.join(ROOT, 'scripts/generators/build_focus_pages.js'));
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
let probeCount = 0;
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
    ok(sl.includes(SP.FOCUS.hotel) && sl.includes(SP.FOCUS.lawn), `${rel}: sibling block does not link the focused pages ${SP.FOCUS.hotel} and ${SP.FOCUS.lawn}`);
    ok(BO.heroBookLink(html) === BO.href(G.REQUEST_KEY[svc]), `${rel}: no "Book online" link to ${BO.href(G.REQUEST_KEY[svc])} above the first <h2>`);
  }
}
if (areaPages !== 32) ok(false, `${areaPages} city service pages checked, want 32`);

// ---- the two focused pages (owner approval 21 Oct 2026: out of the nav, inside the four services).
const footerHtml = require(path.join(ROOT, 'templates/page-shell.js')).footer();
/** Every problem on one focused page's HTML (and its parent page's HTML). */
function checkFocus(p, html, parentHtml, navItems = chrome.NAV_ITEMS) {
  const e = [];
  const rel = p.file;
  const url = `${offers.domain}${p.url}`;
  const top = aboveH2(html);
  const links = hrefs(mainOf(html));
  const parent = FP.parentOf(p.parent);
  const canon = (html.match(/<link\b[^>]*rel="canonical"[^>]*>/) || [''])[0];
  if (!canon.includes(`href="${url}"`)) e.push(`${rel}: canonical is not itself (${url})`);
  // Out of the nav: not a header nav item, not in the header or footer of any page.
  if (navItems.some((i) => i.href.replace(/\/$/, '') === p.url)) e.push(`${rel}: ${p.url} is in the header nav (ruled out of the nav)`);
  const chromeHtml = (html.match(/<header[\s\S]*?<\/header>/) || [''])[0] + (html.match(/<footer[\s\S]*?<\/footer>/) || [''])[0] + chrome.header('/') + footerHtml;
  if (hrefs(chromeHtml).some((h) => h.replace(/\.html$/, '') === p.url)) e.push(`${rel}: ${p.url} is linked from the header or footer`);
  if (!sitemap.includes(`<loc>${url}</loc>`)) e.push(`${rel}: not in sitemap.xml as ${url}`);
  // Above the fold: the data price + Book online preselecting the service.
  if (!plain(top).includes(SP.money(p.from))) e.push(`${rel}: the direct answer above the first <h2> does not state the ${SP.money(p.from)} price`);
  if (BO.heroBookLink(html) !== BO.href(p.request)) e.push(`${rel}: no "Book online" link to ${BO.href(p.request)} above the first <h2>`);
  if (!/data-book-online="after-faq">Book online<\/a>/.test(html)) e.push(`${rel}: no "Book online" button after the FAQ`);
  if (html.indexOf('data-book-online="after-faq"') < html.indexOf('<div class="faq-list">')) e.push(`${rel}: the second Book online is not after the FAQ`);
  // Prices match the data.
  const text = plain(mainOf(html)).replace(/ ([:.,;])/g, '$1');
  if (p.key === 'hotel' && SP.money(p.from) !== SP.money(SP.partyFrom)) e.push(`${rel}: price ${SP.money(p.from)} is not the celebration setups price ${SP.money(SP.partyFrom)}`);
  if (p.key === 'lawn') {
    for (const g of FP.LAWN) if (!text.includes(`${g.name}: ${plain(g.size).trim()}. ${SP.money(rentals.rates.day)} a day, ${SP.money(rentals.rates.weekend)} a weekend`)) e.push(`${rel}: ${g.name} is not listed at ${SP.money(rentals.rates.day)} a day / ${SP.money(rentals.rates.weekend)} a weekend`);
    for (const g of [...(rentals.games || [])].filter((x) => !x.availableNow)) if (text.includes(g.name)) e.push(`${rel}: names ${g.name}, which is not availableNow`);
    for (const b of FP.BUNDLES.filter((x) => !(x.items || []).length)) if (!text.includes(`${b.name}: `) || !text.includes(SP.money(b.dayPrice))) e.push(`${rel}: bundle ${b.name} is not listed at ${SP.money(b.dayPrice)}`);
    if (!text.includes(rentals.pickup.place)) e.push(`${rel}: no pickup/return line at ${rentals.pickup.place}`);
    if (!/photo ID/.test(text)) e.push(`${rel}: no photo ID line`);
  }
  const money = [...text.matchAll(/\$[0-9]+(?:,[0-9]{3})*/g)].map((m) => m[0]);
  const allowed = new Set([SP.money(p.from), SP.money(rentals.rates.day), SP.money(rentals.rates.weekend), SP.money(rentals.damageDeposit), ...FP.BUNDLES.flatMap((b) => [SP.money(b.dayPrice), b.weekendPrice ? SP.money(b.weekendPrice) : null]), SP.money(offers.addOns.takedown.fromPrice), SP.money(offers.travel.extendedFee), SP.money(offers.invoiceQuickAdds.deliveryFee)]);
  for (const m of money) if (!allowed.has(m)) e.push(`${rel}: price ${m} is not from the data files`);
  // FAQ: 5-6 visible = FAQPage JSON-LD.
  const faqHtml = (mainOf(html).match(/<div class="faq-list">([\s\S]*?)<\/div>\s*<div class="btn-row/) || [])[1] || '';
  const visible = [...faqHtml.matchAll(/<div class="faq-item"><h3>([\s\S]*?)<\/h3>/g)].map((m) => plain(m[1]).trim());
  const ld = ldOf(html);
  if (ld.some((o) => o.__bad)) e.push(`${rel}: a JSON-LD block does not parse`);
  const faqLd = ld.filter((o) => o['@type'] === 'FAQPage');
  if (faqLd.length !== 1) e.push(`${rel}: ${faqLd.length} FAQPage JSON-LD blocks (want 1)`);
  const ldQs = faqLd.length === 1 ? (faqLd[0].mainEntity || []).map((q) => q.name) : [];
  if (visible.length < 5 || visible.length > 6) e.push(`${rel}: ${visible.length} visible FAQ questions (want 5-6)`);
  if (JSON.stringify(ldQs) !== JSON.stringify(visible)) e.push(`${rel}: FAQPage JSON-LD questions differ from the visible FAQ`);
  if (faqLd.length === 1 && (faqLd[0].mainEntity || []).some((q) => q['@type'] !== 'Question' || !q.acceptedAnswer || q.acceptedAnswer['@type'] !== 'Answer' || !q.acceptedAnswer.text)) e.push(`${rel}: an FAQPage question lacks a Question/Answer shape`);
  if (!ld.some((o) => o['@type'] === 'Service' && o.url === url)) e.push(`${rel}: no Service JSON-LD for ${url}`);
  // Back to the parent service page.
  if (!links.includes(parent.url)) e.push(`${rel}: does not link back to its parent service page ${parent.url}`);
  // Pictures: 3-4 registered, alt, no caption; lawn pictures show only availableNow items.
  const imgs = FP.imagesFor(p.key);
  if (imgs.length < 3 || imgs.length > 4) e.push(`${rel}: ${imgs.length} registered AI pictures (want 3-4)`);
  for (const i of imgs) {
    const m = html.match(new RegExp(`<img src="/${i.file.replace(/[.]/g, '\\.')}" alt="([^"]*)"`));
    if (!m) e.push(`${rel}: AI picture ${i.file} is not on the page`);
    else if (m[1] !== SP.esc(i.alt) || i.alt.length < 30) e.push(`${rel}: AI picture ${i.file} lacks its registered descriptive alt text`);
    if (p.key === 'lawn') {
      if (!(i.items || []).length) e.push(`${i.file}: lawn picture is not mapped to any rental item`);
      for (const it of i.items || []) if (!AVAILABLE.has(it)) e.push(`${i.file}: shows ${it}, which is not availableNow in data/rentals/games.json`);
    }
  }
  if (/Example styling|<figcaption/i.test(mainOf(html))) e.push(`${rel}: AI pictures carry a caption (owner ruling 21 Oct 2026: none)`);
  if (/\binsured\b/i.test(text)) e.push(`${rel}: says "insured" (never claim it)`);
  if (/\btestimonial|\breviews?\b[^.]{0,40}\b(say|rated|stars?)\b|\bpast (job|client)s?\b/i.test(text)) e.push(`${rel}: carries review/testimonial/past-job wording`);
  // The parent's named sub-section is short, carries the price and links here.
  const sub = (parentHtml.match(new RegExp(`<div class="info-panel" id="${p.anchor}">([\\s\\S]*?)</div>`)) || parentHtml.match(new RegExp(`id="${p.anchor}"[\\s\\S]*?<h2>[^<]*</h2>([\\s\\S]*?)</div>`)) || [])[1] || '';
  const subText = plain(sub.replace(/&rarr;/g, '\u2192').replace(/<h2>[\s\S]*?<\/h2>/, '').replace(/<div class="service-gallery"[\s\S]*$/, '')).trim();
  if (!sub) e.push(`${parent.file}: no #${p.anchor} sub-section`);
  else {
    if (!hrefs(sub).includes(p.url)) e.push(`${parent.file}: #${p.anchor} does not link ${p.url}`);
    if (!new RegExp(`See ${p.key === 'hotel' ? 'hotel room setups' : 'giant lawn games'} →`).test(subText)) e.push(`${parent.file}: #${p.anchor} link is not "See ${p.key === 'hotel' ? 'hotel room setups' : 'giant lawn games'} →"`);
    if (!subText.includes(SP.money(p.from))) e.push(`${parent.file}: #${p.anchor} does not carry the ${SP.money(p.from)} price`);
    if ((sub.match(/<p\b/g) || []).length > 3 || subText.length > 420 || /<ul\b/.test(sub)) e.push(`${parent.file}: #${p.anchor} is ${subText.length} chars / ${(sub.match(/<p\b/g) || []).length} paragraphs (want 2-3 short lines + price; the focused page owns the detail)`);
  }
  return e;
}
let focusPages = 0;
for (const p of FP.PAGES) {
  if (!fs.existsSync(path.join(ROOT, p.file))) { ok(false, `${p.file}: missing`); continue; }
  focusPages += 1;
  const errs = checkFocus(p, read(p.file), read(FP.parentOf(p.parent).file));
  checks += 30;
  errors.push(...errs);
  for (const rel of ['llms.txt', 'llms-services.txt', 'llms-full.txt']) ok(read(rel).includes(`${offers.domain}${p.url}`), `${rel}: does not list ${offers.domain}${p.url}`);
}
ok(focusPages === 2, `${focusPages} focused pages checked, want 2`);
ok(FG.plan().every(([, b, a]) => b === a), 'focused pages or llms files differ from a fresh scripts/generators/build_focus_pages.js run');

// ---- owner photos (owner ruling 21 Oct 2026): the party page shows exactly the five owner photos
// (its AI pictures were "not good enough"), the hotel page the bedroom, hallway and anniversary
// ones, and every baby shower page the shower + teddy pair.
const OP = require(path.join(ROOT, 'scripts/install_owner_photos.js'));
const ownerOf = (key) => SP.imagesFor(key).filter((i) => i.source === 'owner').map((i) => i.file);
ok(SP.imagesFor('party').length === 5 && SP.imagesFor('party').every((i) => i.source === 'owner'), `party page pictures are [${SP.imagesFor('party').map((i) => i.file).join(', ')}], ruled exactly the five owner photos`);
ok(SP.imagesFor('hotel').length === 3 && ownerOf('hotel').length === 3, `hotel room setups pictures are [${SP.imagesFor('hotel').map((i) => i.file).join(', ')}], ruled the owner's bedroom, hallway and anniversary photos`);
ok(ownerOf(OP.KEY).length === 2, `${ownerOf(OP.KEY).length} owner photos registered for the baby shower pages (want the shower + teddy pair)`);
for (const i of SP.AI.images.filter((x) => x.source === 'owner')) ok(Number.isInteger(i.width) && Number.isInteger(i.height) && i.alt.length >= 30, `${i.file}: owner photo lacks width/height or descriptive alt`);
for (const rel of OP.PAGES) {
  const html = read(rel);
  ok(OP.apply(html, rel) === html, `${rel}: differs from a fresh scripts/install_owner_photos.js pass`);
  for (const f of ownerOf(OP.KEY)) ok(new RegExp(`<img src="/${f.replace(/[.]/g, '\\.')}" alt="[^"]{30,}"`).test(html), `${rel}: does not show the owner photo ${f}`);
  ok(!/<figcaption|Example styling/i.test(mainOf(html)), `${rel}: photos carry a caption`);
}
// Retired pictures stay off every page.
for (const gone of ['ai-anniversary-dinner', 'ai-baby-shower-setup', 'ai-birthday-balloon-arch', 'ai-hotel-room-rose-petals', 'ai-brunch-grazing', 'ai-charcuterie-table', 'ai-hotel-anniversary-suite', 'ai-hotel-proposal-candles', 'ai-hotel-birthday-balloons', 'ai-hotel-rose-heart-bed']) {
  for (const rel of ['services/celebration-setups.html', 'services/grazing-and-event-styling.html', 'services/hotel-room-decor-memphis.html', ...OP.PAGES]) ok(!read(rel).includes(`${gone}.webp`), `${rel}: still shows the retired picture ${gone}`);
}

// ---- self-test: each broken copy must fail.
const party = SP.PAGES.find((p) => p.key === 'party');
const rentalsPage = SP.PAGES.find((p) => p.key === 'rentals');
const ph = read(party.file);
const rh = read(rentalsPage.file);
const probes = {
  'no Book online above the fold': [party, ph.replace('data-book-online="hero">Book online</a>', 'data-book-online="hero">Request a Quote</a>')],
  'no Book online after the FAQ': [party, ph.replace('data-book-online="after-faq">Book online', 'data-book-online="after-faq">Get started')],
  'a missing owner photo': [party, ph.replace(/<img src="\/assets\/img\/celebrations\/owner-birthday-bedroom\.webp"[^>]*>/, '')],
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

// Focused-page probes: each broken copy must fail.
{
  const hp = FP.PAGES.find((p) => p.key === 'hotel');
  const lp = FP.PAGES.find((p) => p.key === 'lawn');
  const hh = read(hp.file); const lh = read(lp.file);
  const parH = read(FP.parentOf('party').file); const parL = read(FP.parentOf('rentals').file);
  const fprobes = {
    'a focused page in the header nav': [hp, hh, parH, [...chrome.NAV_ITEMS, { href: hp.url, label: 'Hotel' }]],
    'no Book online above the fold': [hp, hh.replace('data-book-online="hero">Book online</a>', 'data-book-online="hero">Request a Quote</a>'), parH],
    'no link back to the parent': [hp, hh.split('href="/services/celebration-setups"').join('href="/services/"'), parH],
    'a wrong hotel price': [hp, hh.split(SP.money(SP.partyFrom)).join('$275'), parH],
    'a long parent sub-section': [hp, hh, parH.replace('See hotel room setups &rarr;</a></p>', 'See hotel room setups &rarr;</a></p><p>More.</p><p>More.</p>')],
    'a parent sub-section without the link': [lp, lh, parL.split(`href="${lp.url}"`).join('href="/rentals/"')],
    'a wrong game price': [lp, lh.split(`${SP.money(rentals.rates.day)} a day,`).join('$45 a day,'), parL],
    'an unavailable game named': [lp, lh.replace('</main>', '<p>Giant Tumble Tower</p></main>'), parL],
    'FAQ JSON-LD out of step': [lp, lh.replace('"name":"Where do I pick up?"', '"name":"Where is pickup?"'), parL],
    'no photo ID line': [lp, lh.split('photo ID').join('ID card'), parL],
  };
  for (const [what, [p, html, par, navItems]] of Object.entries(fprobes)) {
    checks += 1;
    if (html === (p === hp ? hh : lh) && par === (p === hp ? parH : parL) && !navItems) errors.push(`self-test: could not build the focused "${what}" probe (page shape changed)`);
    else if (!checkFocus(p, html, par, navItems).length) errors.push(`self-test: a focused page with ${what} PASSED`);
  }
  const i = FP.imagesFor('lawn')[0];
  const saved = i.items;
  i.items = ['giant-tumble-tower'];
  checks += 1;
  if (!checkFocus(lp, lh, parL).some((x) => x.includes('giant-tumble-tower'))) errors.push('self-test: a lawn picture showing an unavailable game PASSED');
  i.items = saved;
  probeCount += Object.keys(fprobes).length + 1;
}

if (!pages) errors.push('Rule 0: zero service pages checked');
if (errors.length) {
  console.error(`SERVICE PAGES FAILED (${errors.length}):\n${errors.slice(0, 40).map((x) => `  - ${x}`).join('\n')}`);
  process.exit(1);
}
console.log(`service-pages: OK - ${checks} checks: exactly ${pages} service pages (${KEYS.join(' · ')}), each priced from data, Book online above the fold and after the FAQ, 5+ FAQ = FAQPage JSON-LD, Service JSON-LD, ${SP.AI.images.length} registered pictures (AI + owner photos; rentals only availableNow items, no captions), #hotel-room-setups + #giant-lawn-games; home + ${areaPages} city pages carry Book online and link all four; ${Object.keys(probes).length + 1 + probeCount} self-test probes fail as they should; ${focusPages} focused pages (${FP.PAGES.map((p) => p.url).join(', ')}) out of the nav, priced from data, linked from their parent sub-section, all 32 city pages, the sitemap and the llms files`);
