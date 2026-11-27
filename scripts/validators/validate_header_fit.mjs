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
// --base <dir> (a checkout of the base commit) the header at 414/768/1366 must keep the same layout within 2 px
// (every control's box and words) and, when the layout is identical, the same pixels apart from anti-aliasing.
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

// Base comparison (27 Nov 2026): every control keeps its name, words and presence, and its box
// moves or resizes by at most LAYOUT_TOLERANCE_PX. A sub-pixel shift is rendering noise
// (PR #238 changed only search-loop.config.json, yet the nav at 1366 px came back 0.6 px left
// and 1 px wider); a header that wraps (height doubles), loses a control, changes its words or
// really moves still fails. Her rule (21 Nov 2026): the hard fail catches broken output, never
// near-misses.
const LAYOUT_TOLERANCE_PX = 2;
const fmtLayout = (l) => (typeof l === 'string' ? l : l.map((c) => (c.missing ? `${c.name}:missing` : `${c.name}:${c.left.toFixed(1)}+${c.width.toFixed(1)}x${c.height.toFixed(1)}:${c.text}`)).join(' '));
/** null when `now` keeps `was`'s layout within the tolerance, else the reason it does not. */
function layoutDiff(now, was, tol = LAYOUT_TOLERANCE_PX) {
  if (typeof now === 'string' || typeof was === 'string') return fmtLayout(now) === fmtLayout(was) ? null : 'a header could not be measured on one side';
  if (now.length !== was.length) return `${now.length} controls, base has ${was.length}`;
  for (let i = 0; i < now.length; i += 1) {
    const [a, b] = [now[i], was[i]];
    if (a.name !== b.name) return `control ${i + 1} is ${a.name}, base has ${b.name}`;
    if (!!a.missing !== !!b.missing) return `${a.name} is ${a.missing ? 'missing' : 'shown'}, base has it ${b.missing ? 'missing' : 'shown'}`;
    if (a.missing) continue;
    if (a.text !== b.text) return `${a.name} says "${a.text}", base says "${b.text}"`;
    for (const k of ['left', 'width', 'height']) if (Math.abs(a[k] - b[k]) > tol) return `${a.name} ${k} ${a[k].toFixed(1)} px, base ${b[k].toFixed(1)} px (more than ${tol} px apart)`;
  }
  return null;
}
const sameExactly = (now, was) => fmtLayout(now) === fmtLayout(was);

if (process.argv.includes('--self-test')) {
  // The comparison alone, no browser: each case is one way it must judge a header.
  const row = (nav = {}, book = {}) => [
    { name: 'logo', left: 47, width: 236.9, height: 44, text: 'Porch & Party 901' },
    { name: 'nav', left: 350.5, width: 580, height: 44, text: 'Porch Celebrations Grazing Tables Rentals Pricing How It Works FAQ', ...nav },
    { name: 'book', left: 973.7, width: 123.7, height: 42, text: 'Book online', ...book },
  ];
  const cases = [
    ['PR #238 sub-pixel shift (nav 0.6 px left, 1 px wider) passes', row({ left: 351.1, width: 579 }), row(), true],
    ['identical layout passes', row(), row(), true],
    ['nav wraps to two lines (height 44 -> 88) fails', row({ height: 88 }), row(), false],
    ['Book overflows: 3 px further right fails', row({}, { left: 976.7 }), row(), false],
    ['Book words change fails', row({}, { text: 'Book' }), row(), false],
    ['a control goes missing fails', row({}, { missing: true }), row(), false],
    ['a control is dropped fails', row().slice(0, 2), row(), false],
    ['an unmeasured side fails', 'header not found', row(), false],
  ];
  const bad = cases.filter(([, now, was, ok]) => (layoutDiff(now, was) === null) !== ok);
  // The pixel compare, on tiny made-up pictures: a dark 1 px column on a light 8x3 picture.
  const pic = (col, rgb = [20, 20, 20]) => { const d = new Array(8 * 3 * 4).fill(240); for (let y = 0; y < 3; y += 1) { const i = (y * 8 + col) * 4; d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; } return d; };
  const px = [
    ['pixels: the same picture differs by 0', countDiff(pic(3), pic(3), 8, 3) === 0],
    ['pixels: text 1 px to the side differs by 0', countDiff(pic(4), pic(3), 8, 3) === 0],
    ['pixels: a 3 px move counts', countDiff(pic(6), pic(3), 8, 3) > 0],
    ['pixels: a colour change counts', countDiff(pic(3, [200, 20, 20]), pic(3), 8, 3) > 0],
  ];
  for (const [name, ok] of px) if (!ok) bad.push([name]);
  cases.push(...px);
  for (const [name] of bad) console.error(`header-fit self-test FAIL: ${name}`);
  console.log(bad.length ? `header-fit self-test: FAIL - ${bad.length} of ${cases.length} cases` : `header-fit self-test: ${cases.length} cases passed`);
  process.exit(bad.length ? 1 : 0);
}

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
  // A nav underline mid-transition (it scales in after load) or a text caret is not a header change:
  // freeze both so the base commit and the PR are compared at rest.
  const buf = await page.locator('header[data-site-chrome="header"] .pnp-header-inner').screenshot({ animations: 'disabled', caret: 'hide' });
  await page.close();
  return buf;
}

/** The visible controls' boxes and words, as one string, for an exact before/after comparison. */
async function layoutOf(ctx, url) {
  const page = await openPage(ctx, url);
  const m = await page.evaluate(measure);
  await page.close();
  if (m.error) return m.error;
  return m.controls.map(({ name, missing, left, width, height, text }) => ({ name, missing, left, width, height, text }));
}

/**
 * How many pixels differ between two RGBA buffers of the same size. A pixel differs only when NO pixel
 * within 1 px of the same spot in the other picture matches it within 64 per channel, checked both ways:
 * centred nav text landing 1 px apart between two builds is the same header, while a changed word or
 * colour, or a move of 2 px or more, still counts (27 Nov 2026: a 1 px nav shift read as 1514 pixels).
 */
function countDiff(da, db, W, H) {
  const close = (p, i, q, j) => Math.max(Math.abs(p[i] - q[j]), Math.abs(p[i + 1] - q[j + 1]), Math.abs(p[i + 2] - q[j + 2])) <= 64;
  const unmatched = (p, q, x, y) => {
    const i = (y * W + x) * 4;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < W && Y < H && close(p, i, q, (Y * W + X) * 4)) return false;
    }
    return true;
  };
  let diff = 0;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) if (unmatched(da, db, x, y) || unmatched(db, da, x, y)) diff += 1;
  return diff;
}

/** How many pixels of two PNGs differ (countDiff; Infinity when sizes differ). */
async function pixelDiff(ctx, a, b) {
  const page = await ctx.newPage();
  const got = await page.evaluate(async ([x, y]) => {
    const load = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const [ia, ib] = await Promise.all([load(x), load(y)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return null;
    const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); return Array.from(g.getImageData(0, 0, c.width, c.height).data); };
    return { w: ia.width, h: ia.height, a: px(ia), b: px(ib) };
  }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);
  await page.close();
  return got ? countDiff(got.a, got.b, got.w, got.h) : Infinity;
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

  // From 400 px up unchanged: same header layout and pixels as the base commit.
  const base = arg('base');
  if (base) {
    const b = await serve(path.resolve(base));
    const cmpPages = ['/', '/services/porch-decorating', '/rentals/', '/request'];
    // 414 too: from 400 px up the phone row must look exactly as before (full "Book online").
    for (const vw of [414, ...DESKTOP]) {
      const ctx = await browser.newContext({ viewport: { width: vw, height: 800 }, deviceScaleFactor: 1 });
      for (const p of cmpPages) {
        try {
          let now = await headerShot(ctx, head.origin + p);
          const was = await headerShot(ctx, b.origin + p);
          if (!now.equals(was)) now = await headerShot(ctx, head.origin + p); // one re-shoot: a first paint can differ by a few anti-aliased pixels
          // Layout must match exactly (boxes and words of every control); pixels must match
          // apart from anti-aliasing (a pixel counts only when a channel differs by more than 64).
          const [lNow, lWas] = [await layoutOf(ctx, head.origin + p), await layoutOf(ctx, b.origin + p)];
          const why = layoutDiff(lNow, lWas);
          // Pixels are compared only on an exactly identical layout: a sub-pixel shift moves every
          // glyph, so a pixel count there measures the shift, not a visual change.
          const exact = sameExactly(lNow, lWas);
          const px = !exact || now.equals(was) ? 0 : await pixelDiff(ctx, now, was);
          if (why) errors.push(`${p} @ ${vw}px: header layout differs from the base commit: ${why} (now ${fmtLayout(lNow)} | base ${fmtLayout(lWas)})`);
          if (px > 20) errors.push(`${p} @ ${vw}px: ${px} header pixels differ from the base commit`);
          if (!why && exact && px <= 20) rows.push(`${p} @ ${vw}px: header layout identical to base; ${px} pixels differ beyond anti-aliasing`);
          if (!why && !exact) rows.push(`${p} @ ${vw}px: header layout within ${LAYOUT_TOLERANCE_PX} px of base (now ${fmtLayout(lNow)} | base ${fmtLayout(lWas)})`);
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
