#!/usr/bin/env node
/**
 * The Inventory Publish workflow's first step: write the admin's inventory into
 * data/rentals/games.json (and any new photo into assets/rentals/<slug>.webp).
 *
 * Input (environment, from the workflow_dispatch the admin sends; functions/_lib/inventory.mjs):
 *   INVENTORY  base64 JSON { rates, games, extras, adminItems }
 *   PHOTOS     JSON [{ slug, sha }]: photos uploaded in the admin the website does not have yet,
 *              fetched from PHOTO_BASE/api/inventory/photo/<sha> and checked against their hash
 *   PHOTO_BASE default https://porchandparty901.com
 * The file is games.json with its items replaced and its bundles resolved
 * (scripts/lib/inventory.js merge), so everything that is not inventory (bundle prices, pickup,
 * deposit rules) stays as main has it. Refuses (exit 1, plain reason) anything validate() rejects:
 * the admin runs the same check before it saves, so this only fires on a real fault.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INV = createRequire(import.meta.url)(path.join(ROOT, 'scripts/lib/inventory.js'));
const FILE = path.join(ROOT, 'data/rentals/games.json');

export async function applyPublish({ inventoryB64, photos = [], photoBase = 'https://porchandparty901.com', fetchImpl = fetch, convert = toWebp, file = FILE, assetsDir = path.join(ROOT, 'assets/rentals') }) {
  if (!inventoryB64) throw new Error('INVENTORY is empty');
  const inv = JSON.parse(Buffer.from(inventoryB64, 'base64').toString('utf8'));
  for (const k of ['rates', ...INV.SECTIONS]) if (k !== 'adminItems' && !inv[k]) throw new Error(`INVENTORY has no ${k}`);
  const base = JSON.parse(fs.readFileSync(file, 'utf8'));
  const next = INV.merge(base, inv);
  const incoming = new Set(photos.map((p) => p.slug));
  const hasImage = (slug) => incoming.has(slug) || fs.existsSync(path.join(assetsDir, `${slug}.webp`));
  const errors = INV.validate(next, { hasImage });
  if (errors.length) throw new Error(`the inventory does not pass the rules: ${errors.join(' | ')}`);
  for (const p of photos) {
    if (!/^[a-z0-9-]+$/.test(p.slug) || !/^[0-9a-f]{40}$/.test(p.sha)) throw new Error(`bad photo entry ${JSON.stringify(p)}`);
    if (!INV.allItems(next).some(({ item }) => item.slug === p.slug)) throw new Error(`photo for unknown item ${p.slug}`);
    const res = await fetchImpl(`${photoBase}/api/inventory/photo/${p.sha}`);
    if (!res.ok) throw new Error(`photo ${p.sha} for ${p.slug}: HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const sha = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 40);
    if (sha !== p.sha) throw new Error(`photo for ${p.slug} does not match its hash`);
    await convert(bytes, path.join(assetsDir, `${p.slug}.webp`));
  }
  const text = INV.stringify(next);
  const changed = text !== fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text);
  return { changed, version: INV.hash(JSON.stringify(INV.inventoryOf(next))), photos: photos.length };
}

// 1200 x 900 (4:3, the size the rentals page declares), centre-cropped, no metadata, WebP.
export function toWebp(bytes, out) {
  const tmp = path.join(ROOT, '.build', `inventory-photo-${process.pid}.bin`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, bytes);
  const py = `import sys
from PIL import Image, ImageOps
im = ImageOps.exif_transpose(Image.open(sys.argv[1])).convert('RGB')
im = ImageOps.fit(im, (1200, 900), Image.LANCZOS)
im.save(sys.argv[2], 'WEBP', quality=82, method=6)`;
  try { execFileSync('python3', ['-c', py, tmp, out], { stdio: 'inherit' }); } finally { fs.rmSync(tmp, { force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  applyPublish({ inventoryB64: process.env.INVENTORY, photos: JSON.parse(process.env.PHOTOS || '[]'), photoBase: process.env.PHOTO_BASE || 'https://porchandparty901.com' })
    .then((r) => console.log(`inventory: games.json ${r.changed ? 'updated' : 'unchanged'}, version ${r.version}, ${r.photos} new photo(s)`))
    .catch((e) => { console.error(`::error::Inventory publish refused: ${e.message}`); process.exit(1); });
}
