#!/usr/bin/env node
/**
 * npm run library:sync — re-copies the Design Library data from the research build
 * (~/claude-work/design-library/build/index.html, or LIBRARY_SRC=<dir>) into
 * data/admin/design-library/library.json, which /admin/library serves behind the admin guard.
 *
 * Pictures: real Pinterest pins are the pictures (owner, 22 Oct 2026). Each design gets its
 * group's pins from data/admin/design-library/pins.json (the source of truth for pins; checked
 * with npm run library:pins:check), the best match first by price tier. The 51 AI idea pictures
 * in data/admin/design-library/images/ are only the fallback for a design whose group has no pin
 * (or whose pin picture stops loading); AI picture generation has stopped, so this script copies
 * data only and never pictures.
 *
 * Then: npm run validate:admin-design-library, and open a PR.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'data/admin/design-library');
const SRC = process.env.LIBRARY_SRC || path.join(os.homedir(), 'claude-work/design-library/build');
const page = path.join(SRC, 'index.html');
if (!fs.existsSync(page)) { console.error(`library:sync: no build at ${page} (set LIBRARY_SRC=<build dir>)`); process.exit(1); }

const html = fs.readFileSync(page, 'utf8');
const m = html.match(/<script id="dl-data"[^>]*>([\s\S]*?)<\/script>/);
if (!m) { console.error('library:sync: the build has no <script id="dl-data"> block'); process.exit(1); }
const data = JSON.parse(m[1]);
const PINS = JSON.parse(fs.readFileSync(path.join(DIR, 'pins.json'), 'utf8'));

const slugOf = (id) => String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const groupOf = (d) => `${d.sec}|${d.sec === 'porches' ? (d.g0 || d.g) : d.g}`;
const TIER_ORDER = ['$', '$$', '$$$', '$$$$'];
const imgName = (d) => `${d.sec}-${d.id}`.replace(/[^A-Za-z0-9_-]/g, '_') + '.webp';

// One URL slug per design, unique inside its section.
const seen = new Set();
for (const d of data.designs) {
  let s = slugOf(d.id); let n = 2;
  while (seen.has(`${d.sec}/${s}`)) s = `${slugOf(d.id)}-${n++}`;
  seen.add(`${d.sec}/${s}`); d.slug = s;
  delete d.ex; // Openverse thumbnails are superseded by the Pinterest pins
  const file = path.join(DIR, 'images', imgName(d));
  if (fs.existsSync(file)) d.img = imgName(d); else delete d.img;
}
for (const t of data.tips) t.slug = slugOf(t.id || t.name);
for (const p of data.palettes) p.slug = slugOf(p.id);

// Pins: the group's pins, rotated so each design in a group leads with a different pin,
// in price-tier order ($ gets the first, $$$$ the fourth), so the best match per tier leads.
const byGroup = {};
for (const d of data.designs) (byGroup[groupOf(d)] ||= []).push(d);
let covered = 0;
for (const [g, ds] of Object.entries(byGroup)) {
  const pins = (PINS.groups[g] || []).filter((id) => PINS.pins[id]);
  ds.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier));
  ds.forEach((d, i) => {
    d.pg = g;
    d.pins = pins.length ? [...pins.slice(i % pins.length), ...pins.slice(0, i % pins.length)] : [];
    if (d.pins.length) covered += 1;
  });
}
data.pinInfo = PINS.pins;
data.pinsChecked = PINS.checked;

const out = path.join(DIR, 'library.json');
fs.writeFileSync(out, JSON.stringify(data) + '\n');
const groups = Object.keys(byGroup).length;
const noPin = Object.entries(byGroup).filter(([g]) => !(PINS.groups[g] || []).length).map(([g]) => g);
console.log(`library:sync: ${data.designs.length} designs, ${groups} groups, ${covered} designs with pins, ${data.designs.filter((d) => d.img).length} AI fallback pictures on disk${noPin.length ? `; groups with no pin: ${noPin.join(', ')}` : ''}`);
console.log(`library:sync: wrote ${path.relative(ROOT, out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
