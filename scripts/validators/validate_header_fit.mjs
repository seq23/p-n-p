#!/usr/bin/env node
// The shared header fits every phone from 320 px up (24 Nov 2026: at <= 388 px the menu
// button ran off the right edge, 43 px at 320). Renders real pages in Chromium and measures
// bounding boxes; it never reads the CSS text.
//
// For every page carrying the shared header, at 320/360/375/390/414 px, light and dark:
//   - the header scrolls no wider than the screen (a page body that does is printed as WARN);
//   - logo, Book, call and menu are each rendered, fully on screen, in that order, not overlapping,
//     with a right gutter no narrower than the left (nothing jammed against the edge);
//   - Book shows "Book" under 400 px and "Book online" from 400 px up;
//   - call and menu are >= 44x44 px tap targets, Book >= 44 px tall;
//   - Book still opens /request and is named "Book online"; call still dials +19013551518.
// At 768 and 1366 px the same checks run on the row that shows there, and with
// --base <dir> (a checkout of the base commit) the header pixels at 768/1366 must be identical.
// With --url <origin> it measures that live site instead of a local copy (production check).
// Fails closed: a page that does not load, a header or control not found, or 0 pages measured
// is a failure, never a pass.
//
// usage: node scripts/validators/validate_header_fit.mjs [--url https://porchandparty901.com]
//        [--base <dir>] [--shots <dir>] [--pages /,/rentals/,...]
// needs: playwright (CI installs it: .github/workflows/header-fit.yml)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };
const PHONES = [320, 360, 375, 390, 414];
const DESKTOP = [768, 1366];
const SCHEMES = ['light', 'dark'];
const TEL = 'tel:+19013551518';
const SHOTS = arg('shots');

let playwright;
try { playwright = await import('playwright'); } catch {
  console.error('header-fit: REFUSED - playwright is not installed, so nothing was measured (npm i --no-save playwright@1.49.1)');
  process.exit(2);
}

/** Every served page that carries the shared header (data/ snapshots are not served). */
function headerPages(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(path.join(dir, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) { if (!/^(node_modules|data|\.|reports|templates|docs|scripts|functions|workers|migrations|config)/.test(rel)) walk(rel); continue; }
      if (!e.name.endsWith('.html')) continue;
      if (!fs.readFileSync(path.join(dir, rel), 'utf8').includes('data-site-chrome="header"')) continue;
      out.push('/' + rel.replace(/index\.html$/, '').replace(/\.html$/, ''));
    }
  };
  walk('');
  return out.sort();
}

/** A static server for a checkout: /x -> x.html, /d/ -> d/index.html. */
function serve(dir) {
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const cands = p.endsWith('/') ? [p + 'index.html'] : [p, p + '.html', p + '/index.html'];
    for (const c of cands) {
      const f = path.join(dir, c);
      if (f.startsWith(dir) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
        return fs.createReadStream(f).pipe(res);
      }
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

// Runs in the page. Returns the measured row, or { error } when something is missing.
function measure() {
  const vw = window.innerWidth;
  const header = document.querySelector('header[data-site-chrome="header"]');
  if (!header) return { error: 'no shared header on the page' };
  const shown = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' ? el : null; };
  const pick = (sel) => [...header.querySelectorAll(sel)].map(shown).find(Boolean) || null;
  const phone = vw < 1024;
  const want = phone
    ? [['logo', 'a.pnp-logo'], ['book', 'a.pnp-book-m'], ['call', 'a.pnp-icon-call'], ['menu', '.pnp-toggle']]
    : [['logo', 'a.pnp-logo'], ['nav', 'nav.pnp-nav'], ['book', 'a.pnp-quote'], ['call', 'a.pnp-call']];
  const controls = want.map(([name, sel]) => {
    const el = pick(sel);
    if (!el) return { name, missing: true };
    const r = el.getBoundingClientRect();
    return { name, left: r.left, right: r.right, width: r.width, height: r.height, href: el.getAttribute('href'), label: el.getAttribute('aria-label'), text: el.innerText.replace(/\s+/g, ' ').trim(), tag: el.tagName };
  });
  const plaque = header.querySelector('.pp-plaque');
  return {
    vw, phone,
    docScroll: document.documentElement.scrollWidth,
    headerScroll: Math.max(header.scrollWidth, header.querySelector('.pnp-header-inner')?.scrollWidth || 0),
    plaquePx: plaque ? parseFloat(getComputedStyle(plaque).fontSize) : null,
    widest: (() => { let w = null, best = vw; for (const el of document.body.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.right > best + 0.5) { best = r.right; w = `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} to ${r.right.toFixed(0)}px`; } } return w; })(),
    controls
  };
}

function check(m, where) {
  const e = [];
  if (m.error) return [`${where}: ${m.error}`];
  // The page body scrolling sideways is outside this header fix: reported, with its widest element.
  if (m.docScroll > m.vw) warns.push(`${where}: page body is ${m.docScroll} px wide (widest: ${m.widest})`);
  if (m.headerScroll > m.vw) e.push(`${where}: header is ${m.headerScroll} px wide on a ${m.vw} px screen`);
  let prev = null;
  for (const c of m.controls) {
    if (c.missing) { e.push(`${where}: ${c.name} is not shown`); continue; }
    if (c.left < -0.5 || c.right > m.vw + 0.5) e.push(`${where}: ${c.name} runs off screen (${c.left.toFixed(1)}..${c.right.toFixed(1)} of ${m.vw})`);
    if (prev && c.left < prev.right - 0.5) e.push(`${where}: ${c.name} overlaps ${prev.name} (${c.left.toFixed(1)} < ${prev.right.toFixed(1)})`);
    prev = c;
  }
  // Nothing jammed against the edge: the right gutter is at least the left one (the row pads
  // both sides alike), so a control touching the screen edge fails, not only one cut off.
  const shownC = m.controls.filter((c) => !c.missing);
  if (shownC.length) {
    const leftGap = shownC[0].left, rightGap = m.vw - shownC[shownC.length - 1].right;
    if (rightGap < leftGap - 0.5) e.push(`${where}: right gutter ${rightGap.toFixed(1)} px is narrower than the left ${leftGap.toFixed(1)} px`);
  }
  const by = Object.fromEntries(m.controls.filter((c) => !c.missing).map((c) => [c.name, c]));
  if (m.phone) {
    for (const n of ['call', 'menu']) if (by[n] && (by[n].width < 44 || by[n].height < 44)) e.push(`${where}: ${n} tap target is ${by[n].width}x${by[n].height}, under 44x44`);
    if (by.book && by.book.height < 44) e.push(`${where}: Book is ${by.book.height} px tall, under 44`);
    if (by.book && (by.book.label || by.book.text) !== 'Book online') e.push(`${where}: Book is named "${by.book.label || by.book.text}", not "Book online"`);
    // Under 400 px the button shows "Book"; from 400 px up it keeps the full "Book online".
    const shows = m.vw < 400 ? 'Book' : 'Book online';
    if (by.book && by.book.text !== shows) e.push(`${where}: Book shows "${by.book.text}", expected "${shows}"`);
    if (by.call && by.call.href !== TEL) e.push(`${where}: call dials ${by.call.href}, not ${TEL}`);
  } else {
    if (by.book && by.book.text !== 'Book online') e.push(`${where}: desktop Book reads "${by.book.text}"`);
    if (by.call && by.call.href !== TEL) e.push(`${where}: call dials ${by.call.href}, not ${TEL}`);
  }
  if (by.book && by.book.href !== '/request') e.push(`${where}: Book opens ${by.book.href}, not /request`);
  return e;
}

async function openPage(ctx, url) {
  const page = await ctx.newPage();
  // Pictures do not change the header and slow 600 loads; fonts and CSS load for real.
  await page.route('**/*', (r) => (r.request().resourceType() === 'image' || r.request().resourceType() === 'media' ? r.abort() : r.continue()));
  const res = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  if (!res || res.status() >= 400) throw new Error(`HTTP ${res ? res.status() : 'no response'}`);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

async function headerShot(ctx, url) {
  const page = await openPage(ctx, url);
  const buf = await page.locator('header[data-site-chrome="header"] .pnp-header-inner').screenshot();
  await page.close();
  return buf;
}

const live = arg('url');
const localDir = ROOT;
const pages = arg('pages') ? arg('pages').split(',') : (live ? ['/', '/services/porch-decorating', '/rentals/', '/areas/', '/request'] : headerPages(localDir));
if (!pages.length) { console.error('header-fit: FAIL - 0 pages with the shared header found'); process.exit(1); }
const head = live ? { origin: live.replace(/\/$/, '') } : await serve(localDir);

const browser = await playwright.chromium.launch();
const errors = [];
const warns = [];
const rows = [];
let measured = 0;
try {
  for (const scheme of SCHEMES) {
    for (const vw of [...PHONES, ...DESKTOP]) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: 800 }, colorScheme: scheme, deviceScaleFactor: 1 });
      for (const p of pages) {
        const where = `${p} @ ${vw}px ${scheme}`;
        try {
          const page = await openPage(ctx, head.origin + p);
          const m = await page.evaluate(measure);
          if (SHOTS && (p === '/' || p === pages[0]) && !m.error) {
            fs.mkdirSync(SHOTS, { recursive: true });
            await page.screenshot({ path: path.join(SHOTS, `header-${vw}-${scheme}.png`), clip: { x: 0, y: 0, width: vw, height: 120 } });
          }
          await page.close();
          const e = check(m, where);
          errors.push(...e);
          if (!m.error) measured += 1;
          if (p === pages[0] || e.length) rows.push(`${where}: row ${m.controls?.map((c) => c.missing ? `${c.name}=MISSING` : `${c.name} ${c.left.toFixed(0)}-${c.right.toFixed(0)}`).join(', ')}; header ${m.headerScroll}px; 901 badge ${m.plaquePx}px`);
        } catch (err) {
          errors.push(`${where}: did not load (${err.message.split('\n')[0]})`);
        }
      }
      await ctx.close();
    }
  }

  // Desktop and tablet unchanged: same header pixels as the base commit.
  const base = arg('base');
  if (base) {
    const b = await serve(path.resolve(base));
    const cmpPages = ['/', '/services/porch-decorating', '/rentals/', '/request'];
    // 414 too: from 400 px up the phone row must look exactly as before (full "Book online").
    for (const vw of [414, ...DESKTOP]) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: 800 }, deviceScaleFactor: 1 });
      for (const p of cmpPages) {
        try {
          const now = await headerShot(ctx, head.origin + p);
          const was = await headerShot(ctx, b.origin + p);
          if (!now.equals(was)) errors.push(`${p} @ ${vw}px: header pixels differ from the base commit`);
          else rows.push(`${p} @ ${vw}px: header pixels identical to base`);
          if (SHOTS && p === '/') { fs.writeFileSync(path.join(SHOTS, `desktop-${vw}-now.png`), now); fs.writeFileSync(path.join(SHOTS, `desktop-${vw}-base.png`), was); }
        } catch (err) { errors.push(`${p} @ ${vw}px base compare: ${err.message.split('\n')[0]}`); }
      }
      await ctx.close();
    }
    b.server.close();
  }
} finally {
  await browser.close();
  head.server?.close();
}

for (const r of rows) console.log(r);
for (const w of warns) console.log(`WARN ${w}`);
const total = pages.length * SCHEMES.length * (PHONES.length + DESKTOP.length);
if (measured < total) errors.push(`measured ${measured} of ${total} page views`);
if (errors.length) {
  console.error(`header-fit: FAIL - ${errors.length} problem(s):`);
  const per = {};
  for (const e of errors) { const k = (e.match(/@ (\d+px(?: \w+)?)/) || [, 'other'])[1]; per[k] = (per[k] || 0) + 1; }
  console.error(`  by screen: ${Object.entries(per).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  for (const e of errors.slice(0, 60)) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`header-fit: OK - ${measured} page views (${pages.length} pages x ${PHONES.join('/')}/${DESKTOP.join('/')} px x light+dark) on ${live || 'the local build'}: header fits, every control on screen, tap targets >= 44 px`);
