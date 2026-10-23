#!/usr/bin/env node
/**
 * The Design Library in /admin (owner-approved 22 Oct 2026; docs/admin-console.md).
 *
 * 1. Data: data/admin/design-library/library.json has every design with a unique page slug, and
 *    its Pinterest pins are exactly its group's pins in pins.json (so library:sync was run after
 *    the last pin change); every pin is a numeric id with an https://i.pinimg.com picture and a
 *    credit; every group has at least 3 pins, so no design falls back to an AI picture; every AI
 *    fallback picture named in the data is on disk and under the published image size limit.
 * 2. Routes, through the real guard + router: signed out, every library URL (pages, data, code,
 *    pictures) sends to sign-in; signed in, every section, a design from each design section,
 *    every color set, every tips group and every collection answers 200 with the console's menu
 *    ("Design Library" after Inventory, marked current), a Back link, the numbered steps and
 *    noindex; Pinterest's pinit.js is on design pages and on no other page; unknown pages 404;
 *    data.json is the bundled file; a picture is served byte for byte; a bad picture name is 404.
 * 3. The page code runs (in a small stand-in DOM) for every view and draws what was approved:
 *    picture-first cards led by the pin picture with its Pinterest credit, porch tabs + size
 *    pull-down, collections, price filters, the floating Rules to remember, the balloon map and
 *    its dot strip, the supply calculator, 3-6 official pin embeds + "See more on Pinterest" on a
 *    design page, the combined trip list by store, and "Picture coming" / the AI picture only
 *    when a design has no pin.
 * Rule 0: fewer than 212 designs, 60 groups or 40 routes checked is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
const must = (ok, msg) => { if (!ok) errors.push(msg); };
const DIR = path.join(ROOT, 'data/admin/design-library');
const LIB = JSON.parse(fs.readFileSync(path.join(DIR, 'library.json'), 'utf8'));
const PINS = JSON.parse(fs.readFileSync(path.join(DIR, 'pins.json'), 'utf8'));
const LIB_ASSETS = createRequire(import.meta.url)('../lib/library_assets.js');

// ---- 1. Data ---------------------------------------------------------------------------
const designs = LIB.designs || [];
must(designs.length >= 212, `only ${designs.length} designs in library.json`);
const slugs = new Set();
for (const d of designs) {
  must(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug || ''), `${d.sec}.${d.id} has no clean page slug (${d.slug})`);
  must(!slugs.has(`${d.sec}/${d.slug}`), `two designs share /admin/library/${d.sec}/${d.slug}`);
  slugs.add(`${d.sec}/${d.slug}`);
  const want = (PINS.groups[d.pg] || []).slice().sort().join(',');
  must(want && (d.pins || []).slice().sort().join(',') === want, `${d.sec}.${d.id}: its pins are not its group's pins in pins.json (group ${d.pg}); run npm run library:sync`);
  must((d.pins || []).length >= 3 && (d.pins || []).length <= 6, `${d.sec}.${d.id} shows ${(d.pins || []).length} pins (3 to 6 wanted)`);
  if (d.img) {
    const f = path.join(ROOT, LIB_ASSETS.SOURCE, d.img);
    must(LIB_ASSETS.NAME.test(d.img) && fs.existsSync(f), `${d.sec}.${d.id} names a missing AI picture ${d.img}`);
    if (fs.existsSync(f)) must(fs.statSync(f).size <= 350 * 1024, `${d.img} is over 350 KB`);
  }
}
const groups = Object.entries(PINS.groups);
must(groups.length >= 60, `only ${groups.length} pin groups`);
for (const [g, ids] of groups) {
  must(ids.length >= 3, `pin group ${g} has ${ids.length} pins (at least 3, aim for 6)`);
  for (const id of ids) {
    const p = PINS.pins[id];
    must(/^\d{6,20}$/.test(id), `pin id ${id} in ${g} is not a Pinterest pin id`);
    must(p && /^https:\/\/i\.pinimg\.com\/[^"'<>\s]+$/.test(p.img || ''), `pin ${id} has no i.pinimg.com picture`);
    must(p && typeof p.by === 'string', `pin ${id} has no credit`);
  }
}
const grouped = new Set(designs.map((d) => d.pg));
for (const g of grouped) must((PINS.groups[g] || []).length, `design group ${g} has no pins`);
must(JSON.stringify(LIB.pinInfo) === JSON.stringify(PINS.pins), 'library.json pinInfo differs from pins.json; run npm run library:sync');
for (const f of fs.readdirSync(path.join(ROOT, LIB_ASSETS.SOURCE))) must(LIB_ASSETS.NAME.test(f), `unexpected file ${f} in ${LIB_ASSETS.SOURCE}`);

// ---- 2. Routes ---------------------------------------------------------------------------
const L = await mod('functions/_lib/admin-library.mjs');
const s = await session();
let routes = 0;
const firstImg = designs.find((d) => d.img).img;
for (const p of ['/admin/library', '/admin/library/balloons', `/admin/library/porches/${designs.find((d) => d.sec === 'porches').slug}`, '/admin/library/data.json', '/admin/library/app.js', `/admin/library/img/${firstImg}`]) {
  const r = await s.get(p, { auth: false });
  routes += 1;
  must(r.status === 303 && r.location === '/admin', `signed out, ${p} must send to sign-in (got ${r.status} ${r.location})`);
}
const pages = [['/admin/library', 'library', false], ...L.SECTIONS.map(([k]) => [`/admin/library/${k}`, k === 'shopping' ? 'libraryTrip' : 'library', false])];
for (const k of L.DESIGN_SECTIONS) for (const d of designs.filter((x) => x.sec === k).slice(0, 3)) pages.push([`/admin/library/${k}/${d.slug}`, 'libraryDesign', true]);
for (const p of LIB.palettes) pages.push([`/admin/library/colors/${p.slug}`, 'library', false]);
for (const t of LIB.tips) pages.push([`/admin/library/tips/${t.slug}`, 'library', false]);
for (const c of LIB.collections) pages.push([`/admin/library/collections/${c.k}`, 'library', false]);
for (const [p, steps, isDesign] of pages) {
  const r = await s.get(p);
  routes += 1;
  if (r.status !== 200) { errors.push(`${p} answered ${r.status}`); continue; }
  must(/noindex/.test(r.headers.get('X-Robots-Tag') || ''), `${p} is not noindex`);
  const nav = (r.text.match(/<nav aria-label="Main">([\s\S]*?)<\/nav>/) || ['', ''])[1];
  const links = [...nav.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => m[2]);
  must(links[3] === 'Inventory' && links[4] === 'Design Library', `${p}: Design Library is not in the menu right after Inventory (${links.join(' · ')})`);
  if (p === '/admin/library') must(/<a href="\/admin\/library" aria-current="page"/.test(nav), '/admin/library does not mark Design Library as the current screen');
  must(/data-back/.test(r.text), `${p} has no ← Back`);
  must(new RegExp(`data-steps="${steps}"`).test(r.text), `${p} lacks its numbered steps (${steps})`);
  must(r.text.includes(`id="dl-app"`) && r.text.includes('/admin/library/app.js?v='), `${p} does not load the library page code`);
  must(isDesign === r.text.includes(L.PINIT_SRC), `${p}: Pinterest's pinit.js must load on design pages only`);
}
for (const p of ['/admin/library/porches/no-such-design', '/admin/library/nope', '/admin/library/colors/zz', '/admin/library/tips/zz', '/admin/library/collections/zz', '/admin/library/balloons/a/b']) {
  const r = await s.get(p); routes += 1;
  must(r.status === 404, `${p} answered ${r.status}, not 404`);
}
{
  const r = await s.get('/admin/library/data.json'); routes += 1;
  must(r.status === 200 && /application\/json/.test(r.headers.get('Content-Type') || ''), `data.json answered ${r.status} ${r.headers.get('Content-Type')}`);
  let same = false; try { same = JSON.stringify(JSON.parse(r.text)) === JSON.stringify(LIB); } catch { same = false; }
  must(same, 'data.json is not data/admin/design-library/library.json');
  must(/private/.test(r.headers.get('Cache-Control') || ''), 'data.json may be cached by shared caches');
  for (const [p, type] of [['/admin/library/app.js', 'text/javascript'], ['/admin/library/app.css', 'text/css']]) {
    const x = await s.get(p); routes += 1;
    must(x.status === 200 && (x.headers.get('Content-Type') || '').startsWith(type), `${p} answered ${x.status} ${x.headers.get('Content-Type')}`);
  }
  const img = await s.get(`/admin/library/img/${firstImg}`); routes += 1;
  const bytes = fs.statSync(path.join(ROOT, LIB_ASSETS.SOURCE, firstImg)).size;
  must(img.status === 200 && img.headers.get('Content-Type') === 'image/webp' && Buffer.byteLength(img.text, 'latin1') > 0, `the picture ${firstImg} answered ${img.status} ${img.headers.get('Content-Type')}`);
  must(bytes > 1000, `${firstImg} is suspiciously small`);
  for (const bad of ['../../wrangler.toml', 'x.png', 'a%2Fb.webp']) { const x = await s.get(`/admin/library/img/${bad}`); routes += 1; must(x.status === 404 || x.status === 303, `/admin/library/img/${bad} answered ${x.status}`); }
}
must(routes >= 40, `only ${routes} library routes checked`);

// ---- 3. The page code, in a stand-in DOM ---------------------------------------------------
const APP_JS = fs.readFileSync(path.join(ROOT, 'functions/_lib/assets/design-library.js.txt'), 'utf8');
try { new vm.Script(APP_JS); } catch (e) { errors.push(`design-library.js.txt does not parse: ${e.message}`); }
function el(id) {
  const kids = []; const attrs = {};
  return {
    id, hidden: false, value: id === 'c-len' ? '10' : id === 'c-style' ? 'light' : '', checked: false, textContent: '', innerHTML: '', style: {}, dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return attrs[k] ?? null; }, hasAttribute(k) { return k in attrs; }, removeAttribute(k) { delete attrs[k]; },
    appendChild(c) { kids.push(c); }, insertAdjacentHTML(_, h) { this.innerHTML += h; }, querySelectorAll() { return []; }, querySelector() { return null; },
    focus() {}, scrollIntoView() {}, setSelectionRange() {}, remove() {},
  };
}
async function render(view, sec = '', key = '', { trip = [], search = '' } = {}) {
  const els = {}; const body = el('body');
  const root = el('dl-app'); root.setAttribute('data-view', view); root.setAttribute('data-sec', sec); root.setAttribute('data-key', key); root.setAttribute('data-v', L.VERSION);
  els['dl-app'] = root; els['dl-main'] = el('dl-main'); els['dl-aside'] = el('dl-aside');
  const store = { 'dl-trip': JSON.stringify(trip) };
  let fetched = '';
  const document = {
    getElementById: (id) => els[id] || (els[id] = el(id)), querySelector: () => el('q'), querySelectorAll: () => [], createElement: () => el('x'),
    addEventListener() {}, body, documentElement: el('html'),
  };
  const ctx = {
    document, window: {}, console, URLSearchParams, Math, JSON, Object, Array, String, Number, Infinity, encodeURIComponent, decodeURIComponent, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    location: { search, pathname: '/admin/library' }, history: { replaceState() {} }, scrollY: 0, scrollTo() {}, addEventListener() {}, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, btoa: (x) => Buffer.from(x, 'binary').toString('base64'), unescape, confirm: () => true,
    fetch: async (u) => { fetched = u; return { ok: true, json: async () => JSON.parse(JSON.stringify(LIB)) }; },
  };
  ctx.window = ctx; ctx.DL_DEBUG = process.env.DL_DEBUG === "1";
  vm.runInNewContext(APP_JS, ctx);
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
  must(fetched.startsWith('/admin/library/data.json'), `${view}: the page code did not fetch /admin/library/data.json`);
  return { main: els['dl-main'].innerHTML, aside: els['dl-aside'].innerHTML, body: body.innerHTML, root };
}
const count = (h, re) => (h.match(re) || []).length;
{
  const h = await render('home');
  must(/<h1>Design Library<\/h1>/.test(h.main) && count(h.main, /class="dl-row"/g) >= 7 + LIB.collections.length, 'home: no sections and collections list');
  must(count(h.main, /class="dl-card"/g) === 3, 'home: no three fresh ideas');
}
for (const k of L.DESIGN_SECTIONS) {
  const h = await render('section', k);
  const n = designs.filter((d) => d.sec === k && (k !== 'porches' || d.g === 'Fall / Halloween')).length;
  must(count(h.main, /class="dl-card"/g) === n, `${k}: ${count(h.main, /class="dl-card"/g)} cards, ${n} expected`);
  must(count(h.main, /<img src="https:\/\/i\.pinimg\.com\//g) === n && count(h.main, /class="dl-credit" href="https:\/\/www\.pinterest\.com\/pin\/\d+\/"/g) === n, `${k}: not every card leads with its pin picture and Pinterest credit`);
  must(!/Picture coming|Idea picture \(AI\)/.test(h.main), `${k}: a card fell back to an AI picture although every group has pins`);
  must(/id="f-tier"/.test(h.main) && /Price: tap to choose/.test(h.main) && /id="f-cl"/.test(h.main), `${k}: no price and collection pull-downs`);
  must(/dl-rulespill/.test(h.body) && /Rules to remember \(\d+\) · tap to open/.test(h.body) && /✕ Close/.test(h.body) && /<h2>Rules to remember<\/h2>/.test(h.aside), `${k}: no Rules to remember pill, sheet and column`);
  if (k === 'porches') must(count(h.main, /data-tab="/g) === 3 && /Fall \/ Halloween/.test(h.main) && /Winter \/ Christmas/.test(h.main) && /id="f-size"/.test(h.main), 'porches: no three season tabs and the size pull-down');
  if (k === 'balloons') must(/Supply calculator/.test(h.main) && /id="c-len"/.test(h.main) && count(h.main, /class="dl-minimap"/g) > 50, 'balloons: no supply calculator or dot strips');
}
{
  const h = await render('section', 'porches', '', { search: '?tab=Other&size=grand' });
  must(count(h.main, /class="dl-card"/g) === designs.filter((d) => d.sec === 'porches' && d.g === 'Other' && d.x && d.x.size === 'grand').length, 'porches: the tab and size from the address are not applied');
}
for (const k of L.DESIGN_SECTIONS) {
  const d = designs.find((x) => x.sec === k);
  const h = await render('design', k, d.slug);
  const embeds = count(h.main, /data-pin-do="embedPin"/g);
  must(embeds === d.pins.length && embeds >= 3 && embeds <= 6, `${k}/${d.slug}: ${embeds} Pinterest embeds (want its ${d.pins.length} pins)`);
  must(h.main.indexOf('data-pin-do') < h.main.indexOf('Price tier'), `${k}/${d.slug}: the Pinterest pins do not lead the page`);
  must(/See more on Pinterest/.test(h.main) && /pinterest\.com\/search\/pins\/\?q=/.test(h.main), `${k}/${d.slug}: no See more on Pinterest search button`);
  must(/Add to my trip list/.test(h.main) && /<h2>Shopping list<\/h2>/.test(h.main) && /<h2>Steps<\/h2>/.test(h.main), `${k}/${d.slug}: no steps, shopping list or Add to my trip list`);
  if (k === 'balloons') must(/<h2>Balloon map<\/h2>/.test(h.main) && /id="dl-mappal"/.test(h.main) && /class="dl-badge"/.test(h.main) && /By colour/.test(h.main), 'balloons: no balloon map with counts by colour, numbered clusters and the recolour picker');
}
{
  // A design whose group had no pin: the AI picture (labelled) or "Picture coming".
  const saved = JSON.parse(JSON.stringify(LIB));
  const withImg = LIB.designs.find((d) => d.img); const noImg = LIB.designs.find((d) => !d.img && d.sec === withImg.sec);
  withImg.pins = []; noImg.pins = [];
  const h = await render('section', withImg.sec, '', { search: withImg.sec === 'porches' ? `?tab=${encodeURIComponent(withImg.g)}` : '' });
  must(/Idea picture \(AI\)/.test(h.main) && h.main.includes(`/admin/library/img/${withImg.img}`), 'a design with no pin does not fall back to its AI picture');
  const h2 = await render('design', noImg.sec, noImg.slug);
  must(/Picture coming/.test(h2.main) && !/data-pin-do/.test(h2.main), 'a design with no pin and no AI picture does not say "Picture coming"');
  Object.assign(LIB, saved); LIB.designs = saved.designs;
}
{
  const h = await render('colors'); must(count(h.main, /class="dl-pal" href="\/admin\/library\/colors\//g) === LIB.palettes.length, 'colors: not a link to every color set');
  const p = await render('palette', 'colors', LIB.palettes[0].slug); must(/class="dl-sw"/.test(p.main) && /What to buy/.test(p.main), 'a color set page has no swatch or what to buy');
  const t = await render('tips'); must(count(t.main, /href="\/admin\/library\/tips\//g) === LIB.tips.length, 'tips: not a link to every tips group');
  const g = await render('tipgroup', 'tips', LIB.tips[0].slug); must(count(g.main, /class="dl-tip"/g) >= (LIB.tips[0].tips || []).length, 'a tips group page does not list its tips');
  const c = await render('collection', '', LIB.collections[0].k); must(count(c.main, /class="dl-card"/g) === designs.filter((d) => (d.cl || []).includes(LIB.collections[0].k)).length, 'a collection page does not show its designs');
  const two = designs.filter((d) => d.sec === 'balloons').slice(0, 2).map((d) => `${d.sec}.${d.id}`);
  const sh = await render('shopping', 'shopping', '', { trip: two });
  must(/Trip total/.test(sh.main) && count(sh.main, /class="dl-store"/g) >= 1 && /Clear the whole trip list/.test(sh.main) && /class="dl-apart"/.test(sh.main), 'shopping: the trip list is not combined by store with a separate, labelled Clear');
  const empty = await render('shopping', 'shopping');
  must(/Your trip list is empty/.test(empty.main) && count(empty.main, /class="dl-row"/g) === designs.length, 'shopping: no empty message or no list for every design');
}

// ---- Wiring --------------------------------------------------------------------------------
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
must(/scripts\/admin\/library_sync\.mjs/.test(pkg.scripts['library:sync'] || ''), 'npm run library:sync is missing');
must((pkg.scripts['validate:admin'] || '').includes('validate:admin-design-library'), 'validate:admin does not run validate:admin-design-library');

if (errors.length) {
  console.error(`VALIDATION FAIL: admin design library (${errors.length})\n- ${errors.slice(0, 40).join('\n- ')}`);
  process.exit(1);
}
console.log(`VALIDATION PASS: admin design library (${designs.length} designs, ${groups.length} pin groups, ${Object.keys(PINS.pins).length} pins, ${routes} routes, ${designs.filter((d) => d.img).length} AI fallback pictures)`);
