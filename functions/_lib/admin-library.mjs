// The Design Library (/admin/library; owner-approved 22 Oct 2026). Behind the one admin guard
// (functions/admin/_middleware.js: session + noindex + no-store), like every /admin page.
//   GET /admin/library                         home: sections, fresh ideas, collections
//   GET /admin/library/<section>               porches | rooms | balloons | grazing | colors | tips | shopping
//   GET /admin/library/<design section>/<slug> one design (Pinterest pins first)
//   GET /admin/library/colors/<slug>           one color set
//   GET /admin/library/tips/<slug>             one tips group
//   GET /admin/library/collections/<key>       one collection across the four design sections
//   GET /admin/library/data.json               the data (data/admin/design-library/library.json, bundled)
//   GET /admin/library/app.js | app.css        the page code (functions/_lib/assets/design-library.*.txt)
//   GET /admin/library/img/<name>.webp         an AI fallback picture, read from the Pages assets
//                                              (scripts/assemble_pages_output.js copies them to
//                                              admin/library/img/, which only this route reaches)
// Pinterest's pinit.js is loaded on design pages only. Data refresh: npm run library:sync.
import LIB from '../../data/admin/design-library/library.json';
import APP_JS from './assets/design-library.js.txt';
import APP_CSS from './assets/design-library.css.txt';
import { layout } from './views.mjs';
import { tip } from './helptext.mjs';
import { esc, htmlResponse } from './util.mjs';
import LIBRARY_ASSETS from '../../scripts/lib/library_assets.js';

export const LIBRARY_HOME = '/admin/library';
export const LIBRARY_TITLE = 'Design Library';
export const SECTIONS = [
  ['porches', 'Porches'], ['rooms', 'Party & Room Decor'], ['balloons', 'Balloons'], ['grazing', 'Grazing Tables'],
  ['colors', 'Color Schemes'], ['tips', 'Tips & Tricks'], ['shopping', 'Shopping List'],
];
export const DESIGN_SECTIONS = ['porches', 'rooms', 'balloons', 'grazing'];
export const PINIT_SRC = 'https://assets.pinterest.com/js/pinit.js';
const SECTION_NAME = Object.fromEntries(SECTIONS);

function hash(s) { let h = 5381; for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
const DATA_TEXT = JSON.stringify(LIB);
export const VERSION = hash(`${APP_JS.length}:${hash(APP_JS)}:${hash(APP_CSS)}:${hash(DATA_TEXT)}`);

export function findDesign(sec, slug) { return LIB.designs.find((d) => d.sec === sec && d.slug === slug) || null; }

function shell({ view, sec = '', key = '', title, where, back, screen, design = false }) {
  const tripLink = view === 'shopping' ? '' : `<p class="dl-tripbar"><a class="btn ghost inline" href="${LIBRARY_HOME}/shopping"${tip('lib.trip')}>🛒 My trip list<span data-trip-count></span></a></p>`;
  const body = `<link rel="stylesheet" href="${LIBRARY_HOME}/app.css?v=${VERSION}">
<div class="dl" id="dl-app" data-view="${esc(view)}" data-sec="${esc(sec)}" data-key="${esc(key)}" data-v="${VERSION}">${tripLink}
<div class="dl-layout"><div id="dl-main"><h1>${esc(title)}</h1><p class="dl-muted">Opening the library…</p>
<noscript><p class="dl-note">The Design Library needs JavaScript turned on in Safari (Settings → Apps → Safari → Advanced → JavaScript).</p></noscript></div>
<aside class="dl-aside dl-rules" id="dl-aside" aria-label="Rules to remember"></aside></div></div>
<script src="${LIBRARY_HOME}/app.js?v=${VERSION}" defer></script>${design ? `\n<script async defer src="${PINIT_SRC}" data-pinit-loader></script>` : ''}`;
  return layout(title, body, { screen, back, where, wide: true });
}

const notFound = (words) => htmlResponse(layout('Not found', `<p>${esc(words)}</p>`, { screen: 'notfound', back: { href: LIBRARY_HOME, label: 'Back' } }), 404);
const page = (o) => htmlResponse(shell(o));
const BACK_HOME = { href: LIBRARY_HOME, label: 'Back' };

export async function libraryRoute(env, request, url, segs) {
  // segs[0] === 'library'
  const [, a, b, extra] = segs.map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  if (extra !== undefined) return notFound('No such page in the Design Library.');
  if (!a) return page({ view: 'home', title: LIBRARY_TITLE, where: LIBRARY_TITLE, back: { href: '/admin/', label: 'Back to main page' }, screen: 'library' });
  if (a === 'data.json' && !b) {
    const etag = `"${VERSION}"`;
    if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'private, max-age=300' } });
    return new Response(DATA_TEXT, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=300', ETag: etag } });
  }
  if (a === 'app.js' && !b) return new Response(APP_JS, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'private, max-age=86400' } });
  if (a === 'app.css' && !b) return new Response(APP_CSS, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'private, max-age=86400' } });
  if (a === 'img') {
    if (!b || !LIBRARY_ASSETS.NAME.test(b) || !env.ASSETS) return new Response('not found', { status: 404 });
    const r = await env.ASSETS.fetch(new Request(new URL(`/${LIBRARY_ASSETS.OUTPUT}/${b}`, url.origin)));
    if (!r.ok) return new Response('not found', { status: 404 });
    return new Response(r.body, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=604800' } });
  }
  if (a === 'collections') {
    const c = b && LIB.collections.find((x) => x.k === b);
    if (!c) return notFound('No such collection.');
    return page({ view: 'collection', key: c.k, title: c.n, where: `Collection: ${c.n}`, back: BACK_HOME, screen: 'library' });
  }
  if (!SECTION_NAME[a]) return notFound('No such section in the Design Library.');
  const secBack = { href: `${LIBRARY_HOME}/${a}`, label: 'Back' };
  if (!b) return page({ view: a === 'colors' || a === 'tips' || a === 'shopping' ? a : 'section', sec: a, title: SECTION_NAME[a], where: SECTION_NAME[a], back: BACK_HOME, screen: a === 'shopping' ? 'libraryTrip' : 'library' });
  if (DESIGN_SECTIONS.includes(a)) {
    const d = findDesign(a, b);
    if (!d) return notFound('No such design.');
    return page({ view: 'design', sec: a, key: d.slug, title: d.n, where: SECTION_NAME[a], back: secBack, screen: 'libraryDesign', design: true });
  }
  if (a === 'colors') {
    const p = LIB.palettes.find((x) => x.slug === b);
    if (!p) return notFound('No such color set.');
    return page({ view: 'palette', sec: a, key: p.slug, title: p.name, where: 'Color Schemes', back: secBack, screen: 'library' });
  }
  if (a === 'tips') {
    const t = LIB.tips.find((x) => x.slug === b);
    if (!t) return notFound('No such tips group.');
    return page({ view: 'tipgroup', sec: a, key: t.slug, title: t.name, where: 'Tips & Tricks', back: secBack, screen: 'library' });
  }
  return notFound('No such page in the Design Library.');
}
