#!/usr/bin/env node
/**
 * The site's AI pictures, made with OpenAI images inside the owner's picture budget.
 *
 * Owner rulings, 24 Nov 2026: "The image generator u r using sucks - use ChatGPT or runware or
 * something that even costs cents"; "the $2 was for all pictures made here or by Noelle for rest
 * of 2026". The budget is one shared ledger, ~/.boss-os/image-budget-2026.json
 * ({cap_usd, through, spent_usd, log[]}), read before every call. This is the one paid lane in
 * this repository (config/llm_routing.json budget_lanes); no workflow may reach it, because the
 * ledger lives on the owner's Mac.
 *
 *   cd ~/GitHub/boss-os && npm run -s vault:run -- node \
 *     ~/GitHub/p-n-p/scripts/generators/build_service_ai_images.mjs porch/ai-memphis-spring-porch \
 *     [--model chatgpt-image-latest] [--ref assets/img/porch/<her photo>.jpg]
 *
 * Name pictures as their registry `file` without assets/img/ and .webp. Default model
 * gpt-image-1-mini; chatgpt-image-latest for hard scenes. --ref may only be one of her own photos
 * (inside assets/img/ or ~/porch-and-party/), never a competitor's.
 *
 * Each call: refuse (named STOP, exit 2, no network) when the ledger is missing or unreadable,
 * its numbers are not finite and >= 0, the budget date has passed, or spent + a conservative
 * estimate would cross the cap. After an answer, the real cost from `usage` is added (the
 * estimate when usage is missing, NaN or negative), the ledger is written atomically, then the
 * raw PNG goes to .build/ai-images/ and the center-cropped WebP to the registered path.
 * An OpenAI error leaves the ledger and the registry untouched and exits 1.
 * Only `source` ai entries named ai-*.webp with a prompt can be made: an owner photo, or a crop of
 * one (`original`), is never overwritten. A new picture is checked by eye (no faces, no text, no
 * logos; rentals show only availableNow items), then its sha1 is written into the registry by
 * hand: validate:service-pages and validate:no-placeholder-images fail on unregistered bytes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MODELS = {
  // USD per token (OpenAI image pricing, 24 Nov 2026).
  'gpt-image-1-mini': { text_in: 2e-6, image_in: 2.5e-6, out: 8e-6 },
  'chatgpt-image-latest': { text_in: 5e-6, image_in: 10e-6, out: 40e-6 },
};
export const DEFAULT_MODEL = 'gpt-image-1-mini';
const QUALITY = 'medium';
// Worst-case output tokens at medium quality, and a ceiling for one reference image.
const OUT_TOKENS = { '1024x1024': 1056, '1024x1536': 1584, '1536x1024': 1584 };
const REF_TOKENS = 6000;
const MARGIN = 1.25;
const AI_FILE = /^assets\/img\/[a-z]+\/ai-[a-z0-9-]+\.webp$/;
export const DEFAULT_LEDGER = path.join(os.homedir(), '.boss-os', 'image-budget-2026.json');

export class Stop extends Error {
  constructor(name, why) { super(`NAMED STOP ${name}: ${why}`); this.stop = name; }
}

export function readLedger(file, now = new Date()) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { throw new Stop('IMAGE_BUDGET_LEDGER_MISSING', `${file} cannot be read; no picture is made without the budget ledger`); }
  let led;
  try { led = JSON.parse(raw); } catch { throw new Stop('IMAGE_BUDGET_LEDGER_UNREADABLE', `${file} is not JSON`); }
  const { cap_usd: cap, spent_usd: spent, through } = led || {};
  if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0) throw new Stop('IMAGE_BUDGET_LEDGER_UNREADABLE', `cap_usd is ${JSON.stringify(cap)}`);
  if (typeof spent !== 'number' || !Number.isFinite(spent) || spent < 0) throw new Stop('IMAGE_BUDGET_LEDGER_UNREADABLE', `spent_usd is ${JSON.stringify(spent)}`);
  if (typeof through !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(through)) throw new Stop('IMAGE_BUDGET_LEDGER_UNREADABLE', `through is ${JSON.stringify(through)}`);
  if (now.toISOString().slice(0, 10) > through) throw new Stop('IMAGE_BUDGET_EXPIRED', `the budget ran through ${through}; a new one is the owner's decision`);
  if (!Array.isArray(led.log)) led.log = [];
  return led;
}

export function estimateUsd({ model, size, prompt, hasRef }) {
  const p = MODELS[model];
  const tokens = { out: OUT_TOKENS[size], text: Math.ceil(prompt.length / 3), image: hasRef ? REF_TOKENS : 0 };
  return (tokens.out * p.out + tokens.text * p.text_in + tokens.image * p.image_in) * MARGIN;
}

// Real cost from the response; anything missing, NaN or negative is charged at the estimate,
// so a bad number can never lower the total.
export function realUsd(usage, model, estimate) {
  const p = MODELS[model];
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : NaN);
  if (!usage || typeof usage !== 'object') return estimate;
  const out = n(usage.output_tokens);
  const d = usage.input_tokens_details;
  const text = d ? n(d.text_tokens) : NaN;
  const image = d ? n(d.image_tokens) : NaN;
  // No split: charge every input token at the dearer image rate.
  const input = d ? text * p.text_in + image * p.image_in : n(usage.input_tokens) * p.image_in;
  const usd = out * p.out + input;
  return Number.isFinite(usd) && usd >= 0 ? usd : estimate;
}

// One picture at a time across every caller of the ledger (this generator, Noelle): check, call and
// charge happen under one lock, so two runs can never both pass the cap on the same spent_usd
// (eng check 24 Nov 2026). A lock left by a crashed run is taken back after LOCK_STALE_MS.
export const LOCK_STALE_MS = 10 * 60 * 1000;
export function takeLock(ledgerPath, nowMs = Date.now()) {
  const dir = `${ledgerPath}.lock`;
  try { fs.mkdirSync(dir); } catch (e) {
    if (e.code !== 'EEXIST') throw new Stop('IMAGE_BUDGET_LOCK', `${dir} cannot be made (${e.code}); no picture is made without the lock`);
    let age = 0;
    try { age = nowMs - fs.statSync(dir).mtimeMs; } catch { age = 0; }
    if (age < LOCK_STALE_MS) throw new Stop('IMAGE_BUDGET_BUSY', `another picture is being made (${dir}); try again in a few minutes`);
    fs.rmSync(dir, { recursive: true, force: true });
    try { fs.mkdirSync(dir); } catch { throw new Stop('IMAGE_BUDGET_BUSY', `another picture is being made (${dir})`); }
  }
  return () => fs.rmSync(dir, { recursive: true, force: true });
}

function writeLedgerAtomic(file, led) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(led, null, 1)}\n`);
  fs.renameSync(tmp, file);
}

function parseArgs(argv) {
  const out = { targets: [], model: DEFAULT_MODEL, ref: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') out.model = argv[++i];
    else if (a === '--ref') out.ref = argv[++i];
    else if (a.startsWith('--')) throw new Stop('IMAGE_ARGS_REFUSED', `unknown flag ${a}`);
    else out.targets.push(a);
  }
  if (!MODELS[out.model]) throw new Stop('IMAGE_ARGS_REFUSED', `--model must be one of ${Object.keys(MODELS).join(', ')}`);
  if (!out.targets.length) throw new Stop('IMAGE_ARGS_REFUSED', 'name at least one picture, e.g. porch/ai-memphis-spring-porch');
  return out;
}

function resolveRef(ref, root, home) {
  if (!ref) return null;
  let real;
  try { real = fs.realpathSync(path.resolve(root, ref)); } catch { throw new Stop('IMAGE_REF_REFUSED', `${ref} does not exist`); }
  const allowed = [path.join(root, 'assets', 'img'), path.join(home, 'porch-and-party')].map((d) => { try { return fs.realpathSync(d); } catch { return d; } });
  if (!allowed.some((d) => real.startsWith(d + path.sep))) throw new Stop('IMAGE_REF_REFUSED', `${ref} is not one of her own photos (assets/img/ or ~/porch-and-party/ only)`);
  if (!/\.(jpe?g|png|webp)$/i.test(real)) throw new Stop('IMAGE_REF_REFUSED', `${ref} is not a JPEG, PNG or WebP`);
  return real;
}

function pickTarget(reg, key) {
  const file = `assets/img/${key}.webp`;
  const img = (reg.images || []).find((i) => i.file === file);
  if (!img) throw new Stop('IMAGE_TARGET_REFUSED', `${file} is not in data/offers/service_ai_images.json`);
  if (img.source === 'owner' || img.original || !AI_FILE.test(file)) throw new Stop('IMAGE_TARGET_REFUSED', `${file} is an owner photo or a crop of one; it is never regenerated`);
  if (!img.prompt) throw new Stop('IMAGE_TARGET_REFUSED', `${file} has no prompt in the registry`);
  return img;
}

// The crop runs in Python Pillow; it is found before any call, so nothing is paid for that
// cannot be cropped. Tests pass their own crop.
const CROP_PY = 'import sys\nfrom PIL import Image, ImageOps\nImageOps.fit(Image.open(sys.argv[1]).convert("RGB"),(int(sys.argv[3]),int(sys.argv[4])),Image.LANCZOS).save(sys.argv[2],"WEBP",quality=76,method=6)';
function pythonCrop(env) {
  const py = [env.PYTHON, '/opt/homebrew/bin/python3', 'python3'].filter(Boolean)
    .find((p) => spawnSync(p, ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0);
  if (!py) throw new Stop('PILLOW_MISSING', 'no python3 with Pillow (set PYTHON); nothing was paid for');
  return ({ raw, out, w, h }) => {
    const c = spawnSync(py, ['-c', CROP_PY, raw, out, String(w), String(h)], { encoding: 'utf8' });
    if (c.status !== 0) throw new Error(c.stderr.slice(0, 200));
  };
}

export async function run({ argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch, root = process.cwd(), home = os.homedir(), now = new Date(), log = console.log, crop = null } = {}) {
  const args = parseArgs(argv);
  const ledgerPath = env.IMAGE_BUDGET_LEDGER || path.join(home, '.boss-os', 'image-budget-2026.json');
  const regPath = path.join(root, 'data/offers/service_ai_images.json');
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  const jobs = args.targets.map((k) => ({ key: k, img: pickTarget(reg, k) }));
  readLedger(ledgerPath, now);
  if (!env.OPENAI_API_KEY) throw new Stop('OPENAI_KEY_MISSING', 'OPENAI_API_KEY is not set (inject it with the Boss OS vault: npm run -s vault:run -- ...)');
  const refPath = resolveRef(args.ref, root, home);
  const cropTo = crop || pythonCrop(env);
  const made = [];
  for (const { key, img } of jobs) {
    const portrait = (img.height || 768) > (img.width || 1024);
    const size = portrait ? '1024x1536' : '1536x1024';
    const est = estimateUsd({ model: args.model, size, prompt: img.prompt, hasRef: !!refPath });
    let res;
    let json;
    let usd;
    let fresh;
    const release = takeLock(ledgerPath);
    try {
    const led = readLedger(ledgerPath, now);
    if (led.spent_usd + est > led.cap_usd) throw new Stop('IMAGE_BUDGET_CAP', `$${led.spent_usd.toFixed(3)} spent of $${led.cap_usd.toFixed(2)}; this picture could cost up to $${est.toFixed(3)}`);
    const body = { model: args.model, prompt: img.prompt, size, quality: QUALITY, n: 1 };
    let init;
    if (refPath) {
      const form = new FormData();
      for (const [k, v] of Object.entries(body)) form.append(k, String(v));
      form.append('image[]', new Blob([fs.readFileSync(refPath)]), path.basename(refPath));
      init = { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form };
    } else {
      init = { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    }
    const url = `https://api.openai.com/v1/images/${refPath ? 'edits' : 'generations'}`;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(300000) });
      json = await res.json();
    } catch (e) {
      throw new Error(`${key}: OpenAI call failed (${e.message}); nothing charged, nothing written`);
    }
    if (!res.ok) throw new Error(`${key}: OpenAI answered ${res.status} ${JSON.stringify(json && json.error ? json.error.message : json).slice(0, 300)}; nothing charged, nothing written`);
    // An answer means the money was spent: charge it before anything else can fail.
    usd = realUsd(json.usage, args.model, est);
    fresh = readLedger(ledgerPath, now);
    fresh.spent_usd = Math.round((fresh.spent_usd + usd) * 1e6) / 1e6;
    fresh.log.push(`${now.toISOString().slice(0, 10)} p-n-p ${key} ${args.model}${refPath ? ' +ref' : ''} $${usd.toFixed(4)} total now $${fresh.spent_usd.toFixed(3)}`);
    writeLedgerAtomic(ledgerPath, fresh);
    } finally { release(); }
    const b64 = json.data && json.data[0] && json.data[0].b64_json;
    if (!b64) throw new Error(`${key}: OpenAI answered without an image ($${usd.toFixed(4)} charged); nothing written`);
    const rawDir = path.join(root, '.build/ai-images');
    fs.mkdirSync(rawDir, { recursive: true });
    const raw = path.join(rawDir, `${key.replace('/', '__')}.png`);
    fs.writeFileSync(raw, Buffer.from(b64, 'base64'));
    const w = img.width || 1024;
    const h = img.height || 768;
    try { cropTo({ raw, out: path.join(root, img.file), w, h }); } catch (e) { throw new Error(`${key}: crop failed (${e.message}); the raw picture is ${raw}`); }
    log(`${img.file}: written ($${usd.toFixed(4)}, budget $${fresh.spent_usd.toFixed(3)} of $${fresh.cap_usd.toFixed(2)}); check it by eye, then register its sha1`);
    made.push(img.file);
  }
  return made;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  run().then(() => process.exit(0), (e) => {
    console.error(e.message);
    process.exit(e instanceof Stop ? 2 : 1);
  });
}
