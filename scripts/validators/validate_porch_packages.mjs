#!/usr/bin/env node
/**
 * Porch packages (owner-approved 18 Oct 2026; spec ~/porch-and-party/porch-packages.md).
 * data/offers/porch_packages.json is the one source; scripts/lib/porch_packages.js renders
 * every surface from it. This fails when:
 *
 *  1. a tier price is typed anywhere but the data file: the source tree (functions/,
 *     scripts/, templates/) carries a tier price literal, or a surface rendered from a
 *     perturbed copy of the data still shows an original price (calculator, page grid,
 *     schema, form ranges, admin grid, card line, invoice prefill);
 *  2. the /request form carries a tier price: the porch path may show only the from-price
 *     and range line per season (read from the data), the final-quote line and the "See
 *     examples and prices" link; the question and its five answers are the owner's
 *     wording verbatim, and "Book both seasons" and the unpriced add-ons are on it;
 *  3. a page in porch_packages.json `pages` lacks the current grid block or its Offer /
 *     PriceSpecification schema, or the admin Porch packages screen does not render the
 *     same grid (gridHtml) the public pages show;
 *  4. the bundle wording is missing from the package grid, the calculator, the form, the
 *     pages, the card line or the invoice prefill (10% off the Christmas package);
 *  5. end to end through the real handlers: a porch request with a package and both seasons
 *     does not show "<Season> · picturing ... (<Tier>, from $N)" on its card, its invoice
 *     does not start at the tier minimum with the bundle line, "Request this package"
 *     (/request?season=&decor=) does not preselect both answers, an admin screen still links
 *     /admin/packages instead of the Quick Pricing Summary (/admin/pricing), or /admin/packages is
 *     not linked from Requests and the invoice screen;
 *  6. the retired small stoop / standard porch / large porch tiers ($350/$600/$800) are
 *     still published anywhere.
 * Self-test: each check is run against a broken input and must fail. Rule 0: fewer than
 * 8 priced offers or 5 pages checked is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const require = createRequire(import.meta.url);
const HC = require('../lib/hub_consolidation.js');
const PP = require(path.join(ROOT, 'scripts/lib/porch_packages.js'));
const pk = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/porch_packages.json'), 'utf8'));
const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8'));
const games = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/rentals/games.json'), 'utf8'));
const { applyPorchPackages } = require(path.join(ROOT, 'scripts/install_porch_packages.js'));
const F = await mod('functions/_lib/request-form.mjs');
const P = await mod('functions/_lib/pricing.mjs');
const V = await mod('functions/_lib/views.mjs');

const errors = [];
const fail = (m) => errors.push(m);
const text = (h) => String(h).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');
const offers = pk.seasons.flatMap((s) => pk.tierOrder.map((t) => ({ s, t, from: s.tiers[t].from })));
const perturb = (d) => { const c = JSON.parse(JSON.stringify(d)); c.seasons.forEach((s, i) => Object.values(s.tiers).forEach((t, j) => { t.from += 13 + i * 100 + j; })); return c; };
const pk2 = perturb(pk);
const money = PP.money;

// ---- 0. the data -------------------------------------------------------------------
if (offers.length < 8) fail(`Rule 0: only ${offers.length} priced offers in porch_packages.json, want 2 seasons x 4 packages`);
if (JSON.stringify(pk.tierOrder) !== JSON.stringify(['stoop', 'classic', 'grand', 'showstopper'])) fail('tier order is not Stoop, Classic, Grand, Showstopper');
for (const s of pk.seasons) {
  const p = pk.tierOrder.map((t) => s.tiers[t] && s.tiers[t].from);
  if (p.some((x) => !(x > 0)) || p.some((x, i) => i && x <= p[i - 1])) fail(`${s.name}: package prices are missing or not rising (${p})`);
}
if (!(pk.bundle.percentOff > 0) || pk.bundle.appliesTo !== 'christmas') fail('the bundle is not a percentage off the Christmas package');
if (pk.addOns.priced !== false || /\$\d/.test(pk.addOns.line + pk.addOns.formItems.join(' '))) fail('add-ons carry a price');
if (services.services.porch.tiers) fail('data/offers/services.json still carries the retired porch tiers');

// ---- 1. single source --------------------------------------------------------------
const SRC_DIRS = ['functions', 'scripts', 'templates'];
// $350 is also the overall porch floor in services.json (its own source), so it is not a package-only literal.
const priceLits = [...new Set(offers.map((o) => o.from))].filter((n) => n !== Number(String(services.services.porch.price).replace(/[^0-9]/g, "")));
const litRe = new RegExp(`\\$(${priceLits.map((n) => money(n).slice(1).replace(',', ',?')).join('|')})(?![\\d,])`);
const scan = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = `${dir}/${e.name}`;
  if (e.isDirectory()) return /node_modules|validators|\.wrangler/.test(e.name) ? [] : scan(rel);
  return /\.(m?js|txt)$/.test(e.name) ? [rel] : [];
});
let scanned = 0;
for (const rel of SRC_DIRS.flatMap(scan)) {
  scanned += 1;
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const line of src.split('\n')) if (/porch|stoop|classic|grand|showstopper|christmas|fall/i.test(line) && litRe.test(line)) fail(`${rel}: a porch package price is typed in the code: ${line.trim().slice(0, 120)}`);
}
if (scanned < 50) fail(`Rule 0: only ${scanned} source files scanned`);
// Every surface follows the data: rendered from the perturbed copy, no original price survives.
const origOnly = offers.map((o) => money(o.from)).filter((m) => !pk2.seasons.some((s) => Object.values(s.tiers).some((t) => money(t.from) === m)));
const surfaces = (d) => ({
  calculator: PP.calculatorHtml(d),
  'page grid': PP.pageBlockHtml(d),
  schema: JSON.stringify(PP.schemaNode(d, { domain: services.domain, url: `${services.domain}/pricing` })).replace(/"minPrice":(\d+)/g, (m, n) => `${m} ${money(Number(n))}`),
  'form ranges': F.porchQuestions(d, 75).map((q) => q.helpHtml || '').join(' '),
  'admin grid': V.porchPackagesPage(d),
  'card line': offers.map((o) => PP.cardLine(d, { season: o.s.formChoice, decor: pk.tiers[o.t].formAnswer })).join(' | '),
  'invoice prefill': offers.map((o) => P.prefillLines({ services: ['porch'], wantsDecor: true, porchSeason: o.s.formChoice, porchDecor: pk.tiers[o.t].formAnswer }, { ...P.buildPriceTable(games, services, d) }).map((l) => money(l.unit_cents / 100)).join(' ')).join(' | '),
});
function checkFollows(d, label) {
  const before = errors.length;
  for (const [name, out] of Object.entries(surfaces(d))) {
    for (const s of d.seasons) for (const t of d.tierOrder) {
      const want = money(s.tiers[t].from);
      if (name === 'form ranges') continue; // checked by range below
      if (!out.includes(want)) fail(`${label}: ${name} does not show ${s.name} ${d.tiers[t].name} at ${want}`);
    }
    if (d !== pk) for (const m of origOnly) if (out.includes(m)) fail(`${label}: ${name} still shows ${m} after the data changed (a typed-in price)`);
  }
  const ranges = surfaces(d)['form ranges'];
  for (const line of PP.formRangeLines(d)) if (!ranges.includes(PP.esc(line))) fail(`${label}: the form range line "${line}" is not rendered from the data`);
  return errors.length > before;
}
checkFollows(pk, 'data');
checkFollows(pk2, 'perturbed data');

// ---- 2. the /request form ----------------------------------------------------------
const VERBATIM = {
  question: 'How much decor are you picturing?',
  answers: [
    'A simple touch: a few pumpkins or holiday greenery + a door accent (our Stoop package)',
    'A full porch (our Classic package)',
    'Porch and steps (our Grand package)',
    'The works: porch, steps and walkway (our Showstopper package)',
    'Not sure yet, help me decide',
  ],
  final: "Your final quote depends on the design you want, your porch size and how much decor. We'll confirm it after a quick look.",
  bundle: 'Book fall and Christmas together and save 10% on your Christmas package.',
};
function checkForm(html, label) {
  const before = errors.length;
  const s = (html.match(/<section class="rq-section" data-section="porch">[\s\S]*?<\/section>/) || [''])[0];
  if (!s) { fail(`${label}: no porch section`); return true; }
  const t = text(s);
  const noRange = text(s.replace(/<span class="rq-range">[\s\S]*?<\/span>/, ' '));
  for (const m of PP.tierPriceStrings(pk)) if (noRange.includes(m)) fail(`${label}: the porch path shows the tier price ${m} outside the from-price / range lines`);
  for (const line of PP.formRangeLines(pk)) if (!t.includes(line)) fail(`${label}: lacks "${line}"`);
  if (!t.includes(`${VERBATIM.question}`)) fail(`${label}: lacks the question "${VERBATIM.question}"`);
  const radios = [...s.matchAll(/<input type="radio" name="porch_decor" value="([^"]+)"[^>]*> <span>([^<]*)<\/span>/g)].map((m) => m[2].replace(/&amp;/g, '&'));
  if (JSON.stringify(radios) !== JSON.stringify(VERBATIM.answers)) fail(`${label}: the decor answers are not the owner's five, verbatim: ${JSON.stringify(radios)}`);
  if (!t.includes(VERBATIM.final)) fail(`${label}: lacks the final-quote line`);
  if (!/<a href="\/faq\/#porch-picker" target="_blank" rel="noopener"[^>]*>See examples and prices<\/a>/.test(s)) fail(`${label}: lacks "See examples and prices" opening the calculator in a new tab`);
  if (!/<input type="checkbox" name="porch_both" value="yes"/.test(s) || !t.includes('Book both seasons') || !t.includes(VERBATIM.bundle)) fail(`${label}: lacks the "Book both seasons" box with the bundle line`);
  for (const a of pk.addOns.formItems) if (!s.includes(`name="porch_addons" value="${PP.esc(a)}"`)) fail(`${label}: lacks the add-on "${a}"`);
  if (/porch_budget/.test(s)) fail(`${label}: the retired porch budget question is back`);
  if (!/name="porch_notes"/.test(s)) fail(`${label}: lacks the porch notes box`);
  return errors.length > before;
}
const table = P.buildPriceTable(games, services, pk);
const formHtml = F.renderForm({ offers: services, table });
checkForm(formHtml, 'renderForm');
checkForm(fs.readFileSync(path.join(ROOT, 'request.html'), 'utf8'), 'request.html');
if (pk.form.bothSeasonsHelp !== pk.bundle.line) fail('the form bundle line differs from the bundle line');

// ---- 3. the pages and the admin grid ------------------------------------------------
let pagesChecked = 0;
const publicSeasons = pk.seasons.map((s) => PP.seasonHtml(pk, s.key, { links: true }).replace(/<a class="pkg-request"[^>]*>[^<]*<\/a>/g, ''));
const adminSeasons = pk.seasons.map((s) => PP.seasonHtml(pk, s.key));
if (JSON.stringify(publicSeasons) !== JSON.stringify(adminSeasons)) fail('the public and admin package grids differ beyond the request links');
for (const rel of pk.pages) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { fail(`${rel}: listed in porch_packages.json pages but missing`); continue; }
  const html = fs.readFileSync(abs, 'utf8');
  pagesChecked += 1;
  if (!html.includes(PP.pageBlockHtml(pk))) fail(`${rel}: the porch package grid is missing or stale (run node scripts/install_porch_packages.js)`);
  if (applyPorchPackages(html, rel, pk, services.domain) !== html) fail(`${rel}: the porch packages block or schema is stale`);
  const ld = (html.match(/<script type="application\/ld\+json" data-porch-packages>([\s\S]*?)<\/script>/) || [])[1];
  if (!ld) { fail(`${rel}: no porch packages Offer schema`); continue; }
  const node = JSON.parse(ld);
  const prices = node.hasOfferCatalog.itemListElement.flatMap((c) => c.itemListElement.map((o) => o.priceSpecification.minPrice));
  if (JSON.stringify(prices) !== JSON.stringify(offers.map((o) => o.from))) fail(`${rel}: schema minPrices ${prices} differ from the data`);
  if (node.provider['@id'] !== `${services.domain}/#business`) fail(`${rel}: schema provider is not the business node`);
  if (!text(html).includes(pk.bundle.line)) fail(`${rel}: lacks the bundle line`);
}
if (pagesChecked < 5) fail(`Rule 0: only ${pagesChecked} porch package pages checked`);
const faqHtml = fs.readFileSync(path.join(ROOT, 'faq/index.html'), 'utf8');
if (!faqHtml.includes(PP.calculatorHtml(pk))) fail('faq/index.html: the calculator is not rendered from the data');
if (!faqHtml.includes('"@id":"https://porchandparty901.com/#porch-packages"')) fail('faq/index.html: no porch packages Offer schema');
const adminPage = V.porchPackagesPage(pk);
if (!adminPage.includes(PP.gridHtml(pk))) fail('the admin Porch packages screen does not render the public grid');

// ---- 4. bundle everywhere -----------------------------------------------------------
const bundleCard = PP.cardLine(pk, { season: 'Fall / Halloween', decor: pk.tiers.classic.formAnswer, both: true });
if (!bundleCard.includes(`${pk.bundle.percentOff}% off the Christmas package`)) fail(`card line with both seasons lacks the bundle: "${bundleCard}"`);
if (!PP.calculatorHtml(pk).includes(PP.esc(pk.bundle.line))) fail('the calculator lacks the bundle line');
if (!PP.gridHtml(pk).includes(PP.esc(pk.bundle.line))) fail('the package grid lacks the bundle line');
for (const sAns of ['Fall / Halloween', 'Christmas & holidays']) {
  const lines = P.prefillLines({ services: ['porch'], wantsDecor: true, porchSeason: sAns, porchDecor: pk.tiers.grand.formAnswer, porchBoth: true }, table);
  const xmas = PP.priceOf(pk, 'christmas', 'grand');
  const disc = lines.find((l) => l.description === pk.bundle.invoiceLine);
  if (!disc || disc.unit_cents !== -Math.round(xmas * pk.bundle.percentOff)) fail(`${sAns} + both seasons: no "${pk.bundle.invoiceLine}" line of -${pk.bundle.percentOff}% of ${money(xmas)}`);
  if (lines.filter((l) => /porch: Grand package$/.test(l.description)).length !== 2) fail(`${sAns} + both seasons: the invoice does not carry both seasons' Grand package`);
}

// ---- 5. end to end ------------------------------------------------------------------
const s = await session();
const plus = (n) => { const d = new Date(`${F.chicagoToday()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const sent = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_both: 'yes', porch_addons: ['Lighting', 'A lamp post'], porch_notes: 'Two columns', event_date: plus(10), location: 'Germantown', name: 'Paula Package', phone: '901-555-0410', email: 'paula@example.com' });
if (sent.status !== 303) fail(`a porch package request did not go through (${sent.status}) ${text(sent.text).slice(0, 200)}`);
else {
  const home = text((await s.get('/admin/')).text);
  const want = `Porch: ${PP.cardLine(pk, { season: 'Fall / Halloween', decor: pk.tiers.classic.formAnswer, both: true })}`;
  if (!home.includes(want)) fail(`the card does not read "${want}"`);
  if (!home.includes(`Fall · picturing a full porch (Classic, from ${money(PP.priceOf(pk, 'fall', 'classic'))})`)) fail('the card does not read "Fall · picturing a full porch (Classic, from $…)"');
  if (!home.includes('Add-ons: Lighting, A lamp post')) fail('the card does not list the add-ons');
  const inv = (await s.get(`/admin/invoices/new?r=${s.rk(sent.row.request_key)}`)).text;
  const descs = [...inv.matchAll(/name="line_desc" value="([^"]*)"/g)].map((m) => m[1]);
  const prices = [...inv.matchAll(/name="line_price" type="number" step="0.01" inputmode="decimal" value="([^"]*)"/g)].map((m) => m[1]);
  const at = (d) => prices[descs.indexOf(d)];
  if (at('Fall porch: Classic package') !== (PP.priceOf(pk, 'fall', 'classic')).toFixed(2)) fail(`the invoice does not start at the Classic fall minimum (${descs} / ${prices})`);
  if (at('Christmas porch: Classic package') !== (PP.priceOf(pk, 'christmas', 'classic')).toFixed(2)) fail('the invoice does not add the Christmas Classic package for both seasons');
  if (at(PP.esc(pk.bundle.invoiceLine)) !== (-PP.priceOf(pk, 'christmas', 'classic') * pk.bundle.percentOff / 100).toFixed(2)) fail('the invoice lacks the editable bundle line');
  if (descs.some((d) => /^Decor/.test(d))) fail('a porch-only package invoice still carries a $0 "Decor" line');
  // Every admin link to prices goes to the Quick Pricing Summary (owner, 20 Oct 2026); /admin/packages
  // still answers for old links and bookmarks, but nothing links to it.
  if (!/<a href="\/admin\/pricing" target="_blank" rel="noopener" data-see-prices data-help="ed\.packages"[^>]*>See your prices \(Quick Pricing Summary\)<\/a>/.test(inv)) fail('the invoice screen does not link "See your prices (Quick Pricing Summary)" in a new tab');
  if (!/<option value="Fall porch: Classic package" data-price="[\d.]+"/.test(inv) || !/data-q-porch/.test(inv)) fail('＋ Add something has no "A porch package" picker at the package prices');
  const reqPage = (await s.get('/admin/')).text;
  if (!/<a href="\/admin\/pricing" data-help="sub\.packages"[^>]*>Quick Pricing Summary<\/a>/.test(reqPage)) fail('Requests does not link the Quick Pricing Summary');
  for (const [where, h] of [['Requests', reqPage], ['the invoice editor', inv], ['/admin/help', (await s.get('/admin/help')).text]]) if (/href="\/admin\/packages"/.test(h)) fail(`${where} still links /admin/packages`);
  const pkg = await s.get('/admin/packages');
  if (pkg.status !== 200 || !pkg.text.includes(PP.gridHtml(pk))) fail('/admin/packages does not render the package grid');
  const unsure = await s.siteRequest({ service: 'porch', porch_season: 'Christmas & holidays', porch_decor: 'not_sure', event_date: plus(40), location: 'Bartlett', name: 'Nell Unsure', phone: '901-555-0411', email: 'nell@example.com' });
  if (unsure.status !== 303) fail('a "not sure" porch request did not go through');
  else {
    const inv2 = (await s.get(`/admin/invoices/new?r=${s.rk(unsure.row.request_key)}`)).text;
    if (!inv2.includes('Christmas porch package') || !/not sure how much decor/i.test(inv2)) fail('a "not sure" porch invoice does not start with a Christmas package line to price and a warning');
  }
}
const pre = await s.RS.handleRequestPage({ request: new Request('https://porchandparty901.com/request?service=porch&season=christmas&decor=grand'), env: s.env, params: {} });
const preHtml = await pre.text();
if (!/name="porch_season" value="Christmas &amp; holidays" checked/.test(preHtml) || !/name="porch_decor" value="grand" checked/.test(preHtml) || !/name="service" value="porch" checked/.test(preHtml)) fail('"Request this package" (/request?season=christmas&decor=grand) does not preselect porch, the season and the answer');

// ---- 6. retired wording ------------------------------------------------------------
const RETIRED = [/Small stoop/, /Standard porch/, /Large or wraparound porch/, /porch-size (pictures|prices)/i, /\$350 \/ \$600 \/ \$800/, /From \$600/, /\$500–\$800/];
const SKIP = new Set(['node_modules', '.git', '.pages-output', '.wrangler', '.claude', 'reports', 'data', 'scripts', 'docs', 'functions', 'templates']);
const published = (dir = ROOT, acc = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (SKIP.has(e.name) || e.name.startsWith('.')) continue; const abs = path.join(dir, e.name); if (e.isDirectory()) published(abs, acc); else if (/\.(html|txt)$/.test(e.name)) acc.push(abs); } return acc; };
const pub = published();
if (pub.length < 100) fail(`Rule 0: only ${pub.length} published files scanned for retired wording`);
for (const abs of pub) { const h = fs.readFileSync(abs, 'utf8'); for (const re of RETIRED) if (re.test(h)) fail(`${path.relative(ROOT, abs)}: still says "${h.match(re)[0]}" (retired porch tiers)`); }

// ---- 7. porch price articles (owner-approved 18 Oct 2026) ---------------------------
// Each article in porch_packages.json `articles` is either published (grid + schema + the
// article links current) or queued for the cadence gate with a measured target naming its
// route. A queued draft types no price: rendered from a perturbed copy of the data it shows
// only the perturbed prices, with the comparison table, several FAQ questions in the
// FAQPage node, speakable, the bundle line and a /request?service=porch link.
// templates/page-shell.js requires JSON, which the admin harness's module loader (above)
// rewrites, so the page renders in a clean child process: the same renderPage the
// publisher calls.
const { execFileSync } = await import('node:child_process');
const RENDER_JS = `const fs=require('fs');const {renderPage}=require(process.argv[1]);const jobs=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(jobs.map(([e,d])=>renderPage(e,d?{porchPackages:d}:{}))));`;
const renderPage = (entry, opts = {}) => JSON.parse(execFileSync(process.execPath, ['-e', RENDER_JS, path.join(ROOT, 'templates/page-shell.js')], { input: JSON.stringify([[entry, opts.porchPackages || null]]), encoding: 'utf8', maxBuffer: 1 << 26 }))[0];
const { applyFaqLinks, publishedArticles } = require(path.join(ROOT, 'scripts/install_porch_packages.js'));
const universe = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/queries/query_universe.json'), 'utf8'));
const queue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/publish_queue/publish_queue.json'), 'utf8'));
const targetSet = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/search_intelligence/target_query_set.json'), 'utf8'));
const measuredRoutes = new Set((targetSet.targets || []).filter((t) => t.measurement && Number(t.measurement.value) > 0).map((t) => t.expected_owned_route));
let pubArticles = [];
try { pubArticles = publishedArticles(pk); } catch (err) { fail(err.message); }
/** True when a rendered porch article is missing something it must carry. */
function checkArticle(html, data, label) {
  const before = errors.length;
  const t = text(html);
  if (/\{\{/.test(html)) fail(`${label}: an unfilled {{token}} is on the page`);
  for (const s of data.seasons) for (const k of data.tierOrder) if (!t.includes(money(s.tiers[k].from))) fail(`${label}: ${s.name} ${data.tiers[k].name} price ${money(s.tiers[k].from)} is not on the page`);
  // $350 is also the overall porch floor in services.json, which every porch page prints ("starts at $350+").
  const floor = String(services.services.porch.price).replace(/\+$/, '');
  if (data !== pk) for (const m of origOnly) if (m !== floor && new RegExp(`\\${m.replace(',', ',')}(?![\\d,])`).test(t)) fail(`${label}: shows ${m}, a price typed in the draft rather than read from the data`);
  if (!/<caption>[^<]*porch packages/i.test(html) || !html.includes('<th scope="col">Package</th>')) fail(`${label}: no package comparison table`);
  const faq = [...html.matchAll(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema.org","@type":"FAQPage"[\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]))[0];
  if (!faq || faq.mainEntity.length < 4) fail(`${label}: FAQPage schema has fewer than 4 questions`);
  if (!/"speakable":\{"@type":"SpeakableSpecification","cssSelector":\[/.test(html)) fail(`${label}: no speakable`);
  if (!html.includes('href="/request?service=porch')) fail(`${label}: no /request?service=porch link`);
  if (!t.includes(data.bundle.line)) fail(`${label}: lacks the bundle line`);
  for (const re of RETIRED) if (re.test(html)) fail(`${label}: says "${html.match(re)[0]}" (retired porch tiers)`);
  return errors.length > before;
}
const drafts = universe.filter((e) => e.porchPackages);
let articlesChecked = 0;
for (const a of pk.articles || []) {
  const abs = path.join(ROOT, a.path);
  const route = `/${a.path.replace(/\.html$/, '')}`;
  if (fs.existsSync(abs)) {
    const html = fs.readFileSync(abs, 'utf8');
    if (applyPorchPackages(html, a.path, pk, services.domain, pubArticles) !== html) fail(`${a.path}: the porch grid, schema or article links are stale (run node scripts/install_porch_packages.js)`);
    articlesChecked += 1;
    continue;
  }
  const entry = drafts.find((e) => `${e.folder}/${e.slug}.html` === a.path);
  if (!entry) { fail(`${a.path}: not published and no porchPackages draft in data/queries/query_universe.json`); continue; }
  const q = queue.find((x) => `${x.folder}/${x.slug}.html` === a.path);
  if (!q || q.status !== 'queued') fail(`${a.path}: not published and not queued in data/publish_queue/publish_queue.json`);
  if (!measuredRoutes.has(route)) fail(`${a.path}: no measured target in data/search_intelligence/target_query_set.json names ${route}, so the publication freeze would hold it forever`);
  checkArticle(applyPorchPackages(renderPage(entry), a.path, pk, services.domain, pubArticles), pk, a.path);
  checkArticle(renderPage(entry, { porchPackages: pk2 }), pk2, `${a.path} (perturbed data)`);
  articlesChecked += 1;
}
// Porch price articles folded into a porch hub (26 Oct 2026, scripts/lib/hub_consolidation.js):
// each still counts as a checked article, but only when the page is really gone, every link to
// it lands on its hub, and that hub carries the full grid (it must be in pk.pages, checked above).
for (const a of pk.foldedArticles || []) {
  const target = HC.foldTarget(`/${a.path}`);
  if (fs.existsSync(path.join(ROOT, a.path))) fail(`${a.path}: listed as folded but still on disk`);
  else if (!target || `${target.to.replace(/^\//, '')}.html` !== a.hub) fail(`${a.path}: folded into ${a.hub} in porch_packages.json, but hub_consolidation.json sends it to ${target ? target.to : 'nowhere'}`);
  else if (!pk.pages.includes(a.hub)) fail(`${a.path}: its hub ${a.hub} is not in porch_packages.json pages, so nothing holds the grid it used to carry`);
  else articlesChecked += 1;
}
for (const e of drafts) if (!(pk.articles || []).some((a) => a.path === `${e.folder}/${e.slug}.html`) && !(pk.foldedArticles || []).some((a) => a.path === `${e.folder}/${e.slug}.html`)) fail(`${e.folder}/${e.slug}: a porchPackages draft missing from porch_packages.json articles`);
if (articlesChecked < 4) fail(`Rule 0: only ${articlesChecked} porch price articles checked`);
for (const rel of pk.pages) {
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs) && !fs.readFileSync(abs, 'utf8').includes(PP.articleLinksHtml(pk, pubArticles, rel))) fail(`${rel}: the porch price article links are missing or stale`);
}
if (applyFaqLinks(faqHtml, pk, pubArticles) !== faqHtml) fail('faq/index.html: the porch section does not link the published porch price articles');
if (pubArticles.length && !faqHtml.includes(`href="/${pubArticles[0].replace(/\.html$/, '')}"`)) fail('faq/index.html: the porch section links no porch price article');

// ---- self-test ---------------------------------------------------------------------
const probe = (label, broken) => { const before = errors.length; const caught = broken(); errors.length = before; if (!caught) errors.push(`self-test: ${label} passed when it should fail`); };
probe('a form with a tier price', () => checkForm(formHtml.replace('Not sure yet, help me decide', `Not sure yet, help me decide (${money(PP.priceOf(pk, 'fall', 'classic'))})`), 'probe'));
probe('a form without the bundle box', () => checkForm(formHtml.replace(/<input type="checkbox" name="porch_both"[^>]*>/, ''), 'probe'));
probe('a form with reworded answers', () => checkForm(formHtml.replace('A full porch (our Classic package)', 'A full porch (Classic)'), 'probe'));
probe('a calculator with a typed price', () => { const real = PP.calculatorHtml; const fake = (d) => real(d).replace(money(d.seasons[0].tiers.classic.from), '$550'); const before = errors.length; const out = fake(pk2); for (const m of origOnly) if (out.includes(m)) errors.push('x'); return errors.length > before; });
probe('a page without the grid', () => { const h = fs.readFileSync(path.join(ROOT, pk.pages[0]), 'utf8').replace(/<!--porch-packages-->[\s\S]*?<!--\/porch-packages-->/, ''); return !h.includes(PP.pageBlockHtml(pk)); });
{
  const d = drafts[0];
  const typed = JSON.parse(JSON.stringify(d).replace('{{from:fall.classic}}', money(PP.priceOf(pk, 'fall', 'classic'))));
  probe('an article draft with a typed price', () => checkArticle(renderPage(typed, { porchPackages: pk2 }), pk2, 'probe'));
  probe('an article with no FAQ list', () => checkArticle(renderPage({ ...d, faqs: [] }), pk, 'probe'));
  probe('an article with no speakable', () => checkArticle(renderPage({ ...d, speakable: [] }), pk, 'probe'));
}

if (errors.length) { console.error(`VALIDATION FAIL: porch packages\n - ${[...new Set(errors)].join('\n - ')}`); process.exit(1); }
console.log(`validate_porch_packages: OK - ${offers.length} priced offers from data/offers/porch_packages.json; ${Object.keys(surfaces(pk)).length} surfaces follow a perturbed copy; ${scanned} source files free of typed tier prices; /request shows only the from/range lines with the owner's five answers; ${pagesChecked} pages + /faq/ carry the grid and Offer schema; admin grid = public grid; bundle on grid, calculator, form, card and invoice; card, invoice, preselect and /admin/packages proven end to end; ${articlesChecked} porch price articles (${pubArticles.length} published and linked from every porch page and /faq/, the rest queued with a measured target, drafts free of typed prices); ${pub.length} published files free of the retired tiers`);
