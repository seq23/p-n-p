#!/usr/bin/env node
/**
 * The service pages' AI pictures (owner ruling 21 Oct 2026), generated at $0 with Workers AI
 * @cf/black-forest-labs/flux-1-schnell (free allowance; never a paid model).
 *
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run build:service-ai-images -- porch/ai-fall-porch
 *
 * Reads the prompts in data/offers/service_ai_images.json, writes the raw JPEG to
 * .build/ai-images/ and a 1024x768 center-cropped WebP to the registered path (Python Pillow).
 * A new picture is checked by eye (no faces, no text, no logos; rentals show only availableNow
 * items), then its sha1 is written into the registry by hand: validate:service-pages and
 * validate:no-placeholder-images fail on any ai-*.webp whose bytes are not registered.
 * No argument regenerates nothing: name the files (registry `file` without assets/img/ and .webp).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/service_ai_images.json'), 'utf8'));
const want = process.argv.slice(2);
if (!want.length) { console.error('name at least one picture, e.g. porch/ai-fall-porch'); process.exit(1); }
const { CLOUDFLARE_ACCOUNT_ID: acct, CLOUDFLARE_API_TOKEN: token } = process.env;
if (!acct || !token) { console.error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI) are required'); process.exit(1); }
fs.mkdirSync(path.join(ROOT, '.build/ai-images'), { recursive: true });
for (const key of want) {
  const img = REG.images.find((i) => i.file === `assets/img/${key}.webp`);
  if (!img) throw new Error(`${key}: not in data/offers/service_ai_images.json`);
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${REG.model}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: img.prompt, steps: 8 }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`${key}: ${JSON.stringify(j.errors)}`);
  const raw = path.join(ROOT, '.build/ai-images', `${key.replace('/', '__')}.jpg`);
  fs.writeFileSync(raw, Buffer.from(j.result.image, 'base64'));
  execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image, ImageOps\nImageOps.fit(Image.open(sys.argv[1]).convert("RGB"),(1024,768),Image.LANCZOS).save(sys.argv[2],"WEBP",quality=76,method=6)', raw, path.join(ROOT, img.file)]);
  console.log(`${img.file}: written; check it by eye, then register its sha1`);
}
