#!/usr/bin/env node
/**
 * No placeholder drawings on the live site (owner, 20 Oct 2026). assets/img/party/*.jpg and three
 * porch files were drawings (balloons on sticks over a beige box; a cartoon door with pumpkins)
 * standing in for photos on 35 live pages and the thank-you email. They were swapped for the
 * site's real photos (scripts/lib/placeholder_images.js holds each one's hash and its photo).
 *
 * Fails when:
 *  1. any published page, email module or source file names a placeholder path;
 *  2. any image under assets/ has a placeholder's hash (a drawing re-added under a new name);
 *  3. a published page points at an /assets/img image that does not exist;
 *  4. a drawing's replacement photo is missing or is itself a drawing (old image URLs are not
 *     redirected: validate:link-reachability allows redirects to pages only);
 *  5. the thank-you email's service pictures are missing or a placeholder;
 *  6. an AI picture (assets/img/<service>/ai-*.webp, owner-approved 21 Oct 2026) is not registered
 *     in data/offers/service_ai_images.json with its exact sha1, or a registered one is missing,
 *     outside assets/img/<service>/ai-*.webp, or a placeholder drawing. Approved pictures pass by
 *     their hash, one by one; anything else stays banned.
 * Rule 0: fewer than 100 pages scanned, 20 images hashed or 9 placeholders known is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const { PLACEHOLDERS } = require(path.join(ROOT, 'scripts/lib/placeholder_images.js'));
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

const SKIP_DIRS = new Set(['node_modules', '.git', '.pages-output', '.wrangler', 'frozen_accepted_outputs', 'admin-screenshots']);
const TEXT = new Set(['.html', '.js', '.mjs', '.cjs', '.json', '.md', '.txt', '.xml', '.css', '.toml', '.yml', '.yaml']);
const IMG = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const SELF = new Set(['scripts/lib/placeholder_images.js', 'scripts/validators/validate_no_placeholder_images.mjs']);
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.github')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(path.relative(ROOT, p));
  }
  return out;
};
const files = walk(ROOT);
const olds = Object.keys(PLACEHOLDERS);
must(olds.length >= 9 && Object.values(PLACEHOLDERS).every((x) => /^[0-9a-f]{40}$/.test(x.sha1)), 'the placeholder list is short or a hash is malformed');

// 1. No reference anywhere.
let pages = 0;
for (const f of files.filter((x) => TEXT.has(path.extname(x)) && !SELF.has(x))) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (f.endsWith('.html')) pages += 1;
  const hit = olds.filter((o) => t.includes(o) || t.includes(o.replace(/^assets\/img\//, 'img/')));
  must(!hit.length, `${f} still uses a placeholder drawing: ${hit.join(', ')}`);
}

// 2. No placeholder bytes under assets/, under any name.
const bad = new Map(Object.entries(PLACEHOLDERS).map(([p, x]) => [x.sha1, p]));
const images = files.filter((f) => f.startsWith('assets/') && IMG.has(path.extname(f).toLowerCase()));
for (const f of images) {
  const h = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
  must(!bad.has(h), `${f} is the placeholder drawing ${bad.get(h)} (same bytes)`);
}

// 3. Every /assets/img image a published page uses exists.
const missing = new Set();
for (const f of files.filter((x) => x.endsWith('.html'))) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const m of t.matchAll(/(?:https:\/\/porchandparty901\.com)?\/(assets\/img\/[a-z0-9/_-]+\.(?:jpg|jpeg|png|webp))/gi)) if (!fs.existsSync(path.join(ROOT, m[1]))) missing.add(`${f} → ${m[1]}`);
}
must(!missing.size, `pages point at missing images: ${[...missing].slice(0, 8).join('; ')}`);

// 4. Each drawing's replacement is a real photo that exists, and the drawing itself is gone.
for (const [old, x] of Object.entries(PLACEHOLDERS)) {
  must(fs.existsSync(path.join(ROOT, x.photo)) && !bad.has(crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, x.photo))).digest('hex')), `${old}: its replacement ${x.photo} is missing or a drawing`);
  must(!fs.existsSync(path.join(ROOT, old)), `${old} (a drawing) is still in the repo`);
}

// 5. The thank-you email's service pictures.
const msgs = fs.readFileSync(path.join(ROOT, 'functions/_lib/messages.mjs'), 'utf8');
const refImgs = [...msgs.slice(msgs.indexOf('REFERRAL_SERVICES = ['), msgs.indexOf('];', msgs.indexOf('REFERRAL_SERVICES = ['))).matchAll(/img: '\/([^']+)'/g)].map((m) => m[1]);
must(refImgs.length === 4, `the thank-you email has ${refImgs.length} service pictures, not 4`);
for (const p of refImgs) must(fs.existsSync(path.join(ROOT, p)) && fs.statSync(path.join(ROOT, p)).size < 40000, `thank-you email picture ${p} is missing or too heavy for an email`);

// 6. AI pictures: approved one by one, by hash.
const AI = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/service_ai_images.json'), 'utf8'));
const reg = new Map(AI.images.map((i) => [i.file, i.sha1]));
const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
const aiFiles = images.filter((f) => /^assets\/img\/[a-z]+\/ai-[a-z0-9-]+\.webp$/.test(f) || /(^|\/)ai-[^/]*$/.test(f));
must(reg.size >= 12, `only ${reg.size} AI pictures registered (3+ per service page)`);
for (const f of aiFiles) must(reg.has(f) && reg.get(f) === sha(f), `${f} is an AI picture that is not registered with its sha1 in data/offers/service_ai_images.json`);
for (const [f, h] of reg) {
  must(/^assets\/img\/[a-z]+\/ai-[a-z0-9-]+\.webp$/.test(f), `${f}: registered AI pictures live at assets/img/<service>/ai-*.webp`);
  must(/^[0-9a-f]{40}$/.test(h) && !bad.has(h), `${f}: registered hash is malformed or a placeholder drawing`);
  must(fs.existsSync(path.join(ROOT, f)), `${f}: registered but missing`);
}

if (pages < 100) errors.push(`Rule 0: only ${pages} pages scanned`);
if (images.length < 20) errors.push(`Rule 0: only ${images.length} images hashed`);
if (errors.length) { console.error(`VALIDATION FAIL: placeholder images (${errors.length})\n${errors.map((e) => `- ${e}`).join('\n')}`); process.exit(1); }
console.log(`validate_no_placeholder_images: OK (${checks} checks: ${pages} pages and every source file free of the ${olds.length} placeholder drawings, ${images.length} images hashed, no missing page images, drawings deleted, replacements real, thank-you email pictures real and light, ${aiFiles.length} AI pictures each registered by hash)`);
