#!/usr/bin/env node
/**
 * validate:image-budget — the picture generator (scripts/generators/build_service_ai_images.mjs)
 * stays inside the owner's $2 picture budget for 2026 (her ruling 24 Nov 2026), and the seven
 * pictures she rejected that day never come back.
 *
 * Fails when, against a fake OpenAI and a throwaway ledger:
 *   - a call is made when spent + estimate would cross the cap (ledger at 1.99 of 2.00);
 *   - a call is made with the ledger missing, not JSON, or holding a NaN, negative or missing
 *     number, or after its `through` date, or without a key;
 *   - a NaN, negative or missing usage lowers the charge below the estimate, or a real usage is
 *     not charged exactly;
 *   - an OpenAI error (500 or a dropped connection) changes the ledger, the registry or the picture,
 *     or ends as anything but a thrown error (exit 1);
 *   - an owner photo, a crop of one, or an unknown file can be regenerated, or --ref reaches
 *     outside her own photos;
 *   - the command line, with no ledger, exits 0, prints no NAMED STOP, or touches the network;
 *   - any of the registry's `rejected` files exists, or any tracked file other than the registry
 *     and the edge redirect names one.
 * Hard-fails on zero cases or zero files scanned.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run, Stop, estimateUsd, MODELS, takeLock, LOCK_STALE_MS } from '../generators/build_service_ai_images.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEN = 'scripts/generators/build_service_ai_images.mjs';
const REG_FILE = 'data/offers/service_ai_images.json';
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, REG_FILE), 'utf8'));
const errors = [];
let cases = 0;
const must = (ok, msg) => { cases++; if (!ok) errors.push(msg); };

const TARGET = 'porch/ai-memphis-spring-porch';
const SHELF = 'porch/ai-bartlett-small-christmas-porch';
const NOW = new Date('2026-11-24T12:00:00Z');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64').toString('base64');

function sandbox(ledger) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-budget-'));
  fs.mkdirSync(path.join(dir, 'data/offers'), { recursive: true });
  // Every row gets a prompt, so an owner photo or a crop of one is refused for what it is,
  // not only for lacking a prompt.
  fs.writeFileSync(path.join(dir, REG_FILE), JSON.stringify({ ...REG, images: REG.images.map((i) => ({ prompt: 'a forged prompt', ...i })) }, null, 2));
  for (const svc of ['porch', 'grazing', 'rentals', 'celebrations']) fs.mkdirSync(path.join(dir, 'assets/img', svc), { recursive: true });
  for (const i of REG.images) fs.writeFileSync(path.join(dir, i.file), `original ${i.file}`);
  fs.writeFileSync(path.join(dir, 'assets/img/porch/her-photo.jpg'), 'her photo');
  fs.writeFileSync(path.join(dir, 'competitor.jpg'), 'someone else\'s photo');
  const ledgerPath = path.join(dir, 'image-budget-2026.json');
  if (ledger !== undefined) fs.writeFileSync(ledgerPath, typeof ledger === 'string' ? ledger : JSON.stringify(ledger));
  return { dir, ledgerPath, home: path.join(dir, 'home') };
}
const ledgerAt = (spent) => ({ cap_usd: 2, through: '2026-12-31', spent_usd: spent, log: [] });
function fakeFetch(answer) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return answer(url, init); };
  fn.calls = calls;
  return fn;
}
const okAnswer = (usage) => async () => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG }], usage }) });
async function attempt({ argv = [TARGET], ledger, fetch = fakeFetch(okAnswer({ output_tokens: 1584, input_tokens_details: { text_tokens: 200, image_tokens: 0 } })), env, now = NOW }) {
  const box = sandbox(ledger);
  const crops = [];
  const before = { ledger: fs.existsSync(box.ledgerPath) ? fs.readFileSync(box.ledgerPath, 'utf8') : null, reg: fs.readFileSync(path.join(box.dir, REG_FILE), 'utf8') };
  let err = null;
  let made = null;
  try {
    made = await run({ argv, env: env || { OPENAI_API_KEY: 'sk-test', IMAGE_BUDGET_LEDGER: box.ledgerPath }, fetchImpl: fetch, root: box.dir, home: box.home, now, log: () => {}, crop: (c) => { crops.push(c); fs.writeFileSync(c.out, 'new picture'); } });
  } catch (e) { err = e; }
  const after = { ledger: fs.existsSync(box.ledgerPath) ? fs.readFileSync(box.ledgerPath, 'utf8') : null, reg: fs.readFileSync(path.join(box.dir, REG_FILE), 'utf8') };
  const leftovers = fs.readdirSync(box.dir).filter((f) => f.endsWith('.tmp'));
  const pic = (key) => fs.readFileSync(path.join(box.dir, `assets/img/${key}.webp`), 'utf8');
  return { box, err, made, before, after, calls: fetch.calls, crops, leftovers, pic };
}
const stopped = (r, name) => r.err instanceof Stop && r.err.stop === name;

// Over the cap: refused before the call, nothing charged.
{
  const r = await attempt({ ledger: ledgerAt(1.99) });
  must(stopped(r, 'IMAGE_BUDGET_CAP'), `ledger at $1.99 of $2: expected NAMED STOP IMAGE_BUDGET_CAP, got ${r.err ? r.err.message : 'no refusal'}`);
  must(r.calls.length === 0, 'ledger at $1.99 of $2: OpenAI was called');
  must(r.after.ledger === r.before.ledger, 'ledger at $1.99 of $2: the ledger changed');
}
// Two runs at once: a fresh lock refuses the second before any call; a stale one is taken back; the lock is released.
{
  const box = sandbox(ledgerAt(0));
  fs.mkdirSync(`${box.ledgerPath}.lock`);
  let err = null; const calls = [];
  try { await run({ argv: [TARGET], env: { OPENAI_API_KEY: 'sk-test', IMAGE_BUDGET_LEDGER: box.ledgerPath }, fetchImpl: async (u) => { calls.push(u); throw new Error('no'); }, root: box.dir, home: box.home, log: () => {}, crop: () => {} }); } catch (e) { err = e; }
  must(err instanceof Stop && err.stop === 'IMAGE_BUDGET_BUSY', `a picture already being made: expected NAMED STOP IMAGE_BUDGET_BUSY, got ${err ? err.message : 'no refusal'}`);
  must(calls.length === 0, 'a picture already being made: OpenAI was called');
  const old = new Date(Date.now() - LOCK_STALE_MS - 60000);
  fs.utimesSync(`${box.ledgerPath}.lock`, old, old);
  const release = takeLock(box.ledgerPath);
  must(typeof release === 'function', 'a stale lock was not taken back');
  release();
  must(!fs.existsSync(`${box.ledgerPath}.lock`), 'the lock was not released');
}
{
  const r = await attempt({ ledger: ledgerAt(0) });
  must(!fs.existsSync(`${r.box.ledgerPath}.lock`), 'the lock is left behind after a run');
}
// Missing, unreadable, NaN, negative, missing numbers, expired, no key: refused, no call.
for (const [label, ledger, name, extra = {}] of [
  ['missing ledger', undefined, 'IMAGE_BUDGET_LEDGER_MISSING'],
  ['ledger not JSON', '{"cap_usd": 2, ', 'IMAGE_BUDGET_LEDGER_UNREADABLE'],
  ['spent "NaN"', { ...ledgerAt(0), spent_usd: 'NaN' }, 'IMAGE_BUDGET_LEDGER_UNREADABLE'],
  ['spent negative', ledgerAt(-5), 'IMAGE_BUDGET_LEDGER_UNREADABLE'],
  ['spent missing', { cap_usd: 2, through: '2026-12-31' }, 'IMAGE_BUDGET_LEDGER_UNREADABLE'],
  ['cap null', { ...ledgerAt(0), cap_usd: null }, 'IMAGE_BUDGET_LEDGER_UNREADABLE'],
  ['through missing', { cap_usd: 2, spent_usd: 0 }, 'IMAGE_BUDGET_LEDGER_UNREADABLE'],
  ['budget expired', ledgerAt(0), 'IMAGE_BUDGET_EXPIRED', { now: new Date('2027-01-01T06:00:00Z') }],
]) {
  const r = await attempt({ ledger, ...extra });
  must(stopped(r, name), `${label}: expected NAMED STOP ${name}, got ${r.err ? r.err.message : 'no refusal'}`);
  must(r.calls.length === 0, `${label}: OpenAI was called`);
  must(r.after.ledger === r.before.ledger, `${label}: the ledger changed`);
}
{
  const box = sandbox(ledgerAt(0));
  const r = await attempt({ ledger: ledgerAt(0), env: { IMAGE_BUDGET_LEDGER: box.ledgerPath } });
  must(stopped(r, 'OPENAI_KEY_MISSING') || stopped(r, 'IMAGE_BUDGET_LEDGER_MISSING'), `no key: expected a named stop, got ${r.err ? r.err.message : 'no refusal'}`);
  must(r.calls.length === 0, 'no key: OpenAI was called');
}
// The last day still works; a real usage is charged exactly; the ledger write is atomic.
{
  const r = await attempt({ ledger: ledgerAt(1.5), now: new Date('2026-12-31T23:00:00Z') });
  const want = 1584 * MODELS['gpt-image-1-mini'].out + 200 * MODELS['gpt-image-1-mini'].text_in;
  const spent = r.after.ledger && JSON.parse(r.after.ledger).spent_usd;
  must(!r.err, `a run inside the budget on its last day failed: ${r.err && r.err.message}`);
  must(r.calls.length === 1 && /\/v1\/images\/generations$/.test(r.calls[0].url), 'a run without --ref did not call /v1/images/generations once');
  must(Math.abs(spent - (1.5 + want)) < 1e-6, `real usage charged ${spent - 1.5}, expected ${want}`);
  must(r.leftovers.length === 0, 'the ledger write left a temp file behind');
  must(r.pic(TARGET) === 'new picture' && r.crops[0].w === 1024 && r.crops[0].h === 768, 'the site picture was not cropped to 1024x768 at its registered path');
}
// A bad usage never lowers the charge below the estimate.
const est = estimateUsd({ model: 'gpt-image-1-mini', size: '1536x1024', prompt: REG.images.find((i) => i.file === `assets/img/${TARGET}.webp`).prompt, hasRef: false });
for (const [label, usage] of [
  ['usage NaN', { output_tokens: NaN, input_tokens_details: { text_tokens: NaN, image_tokens: NaN } }],
  ['usage negative', { output_tokens: -100000, input_tokens_details: { text_tokens: -5, image_tokens: 0 } }],
  ['usage missing', undefined],
  ['usage as text', { output_tokens: '1584' }],
]) {
  const r = await attempt({ ledger: ledgerAt(1), fetch: fakeFetch(okAnswer(usage)) });
  const spent = r.after.ledger && JSON.parse(r.after.ledger).spent_usd;
  must(!r.err && Math.abs(spent - (1 + est)) < 1e-6, `${label}: charged ${spent - 1}, expected the estimate ${est} (${r.err && r.err.message})`);
}
// Outage: nothing charged, nothing written, a thrown error (exit 1), never a named stop or success.
for (const [label, answer] of [
  ['OpenAI 500', async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'server error' } }) })],
  ['OpenAI 429', async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) })],
  ['connection dropped', async () => { throw new Error('ECONNRESET'); }],
  ['answer not JSON', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } })],
]) {
  const r = await attempt({ ledger: ledgerAt(1), fetch: fakeFetch(answer) });
  must(r.err && !(r.err instanceof Stop), `${label}: expected a thrown error, got ${r.err ? r.err.message : 'success'}`);
  must(r.after.ledger === r.before.ledger, `${label}: the ledger changed`);
  must(r.after.reg === r.before.reg, `${label}: the registry changed`);
  must(r.pic(TARGET) === `original assets/img/${TARGET}.webp`, `${label}: the picture was overwritten`);
}
// Never her photos: owner files, crops of them, unknown files; --ref only from her photos.
for (const [label, argv, name] of [
  ['owner photo', ['celebrations/owner-birthday-bedroom'], 'IMAGE_TARGET_REFUSED'],
  ['crop of her photo', ['porch/ai-germantown-fall-porch'], 'IMAGE_TARGET_REFUSED'],
  ['unknown file', ['porch/ai-not-registered'], 'IMAGE_TARGET_REFUSED'],
  ['ref outside her photos', [TARGET, '--ref', 'competitor.jpg'], 'IMAGE_REF_REFUSED'],
  ['ref climbing out', [TARGET, '--ref', 'assets/img/../competitor.jpg'], 'IMAGE_REF_REFUSED'],
  ['ref not a picture', [TARGET, '--ref', 'assets/img/../data/offers/service_ai_images.json'], 'IMAGE_REF_REFUSED'],
  ['ref missing', [TARGET, '--ref', 'assets/img/porch/nope.jpg'], 'IMAGE_REF_REFUSED'],
  ['unknown model', [TARGET, '--model', 'dall-e-3'], 'IMAGE_ARGS_REFUSED'],
  ['no picture named', [], 'IMAGE_ARGS_REFUSED'],
]) {
  const r = await attempt({ argv, ledger: ledgerAt(0) });
  must(stopped(r, name), `${label}: expected NAMED STOP ${name}, got ${r.err ? r.err.message : 'no refusal'}`);
  must(r.calls.length === 0, `${label}: OpenAI was called`);
}
{
  const r = await attempt({ argv: [TARGET, '--ref', 'assets/img/porch/her-photo.jpg', '--model', 'chatgpt-image-latest'], ledger: ledgerAt(0) });
  must(!r.err && r.calls.length === 1 && /\/v1\/images\/edits$/.test(r.calls[0].url), `a run with her photo as --ref did not call /v1/images/edits (${r.err && r.err.message})`);
  const s = await attempt({ argv: [SHELF, '--model', 'chatgpt-image-latest'], ledger: ledgerAt(0) });
  const body = s.calls[0] && JSON.parse(s.calls[0].init.body);
  must(!s.err && body && body.size === '1024x1536' && s.crops[0].h === 1536, 'a portrait shelf picture was not made at 1024x1536');
}
// The command line: no ledger means a named stop, a non-zero exit and no network.
{
  const preload = 'data:text/javascript,globalThis.fetch=()=>{process.stderr.write("FETCH_ATTEMPTED\\n");throw new Error("network blocked")};';
  const r = spawnSync(process.execPath, ['--import', preload, GEN, TARGET], { cwd: ROOT, env: { ...process.env, OPENAI_API_KEY: 'sk-validator-dummy', IMAGE_BUDGET_LEDGER: path.join(os.tmpdir(), 'no-such-ledger.json') }, encoding: 'utf8', timeout: 30000 });
  const out = `${r.stdout}\n${r.stderr}`;
  must(r.status === 2, `command line without a ledger exited ${r.status}, expected 2\n${out.slice(0, 300)}`);
  must(/NAMED STOP IMAGE_BUDGET_LEDGER_MISSING/.test(out), 'command line without a ledger printed no NAMED STOP IMAGE_BUDGET_LEDGER_MISSING');
  must(!/FETCH_ATTEMPTED/.test(out), 'command line without a ledger touched the network');
}
// The seven she rejected stay gone, everywhere.
const rejected = (REG.rejected && REG.rejected.files) || [];
must(rejected.length === 7, `registry lists ${rejected.length} rejected pictures, expected the 7 of 24 Nov 2026`);
const ALLOWED = new Set([REG_FILE, 'scripts/cloudflare/ensure_www_redirect.mjs']);
const names = rejected.map((f) => path.basename(f).replace(/\.[a-z]+$/, ''));
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean);
let scanned = 0;
for (const f of rejected) must(!fs.existsSync(path.join(ROOT, f)), `${f} was rejected by the owner on 24 Nov 2026 and is back`);
for (const f of tracked) {
  if (ALLOWED.has(f) || !/\.(html|xml|json|js|mjs|cjs|md|txt|css|yml|yaml|toml|webmanifest)$/.test(f)) continue;
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) continue;
  scanned++;
  const text = fs.readFileSync(abs, 'utf8');
  for (const n of names) if (text.includes(n)) errors.push(`${f} names ${n}, a picture the owner rejected on 24 Nov 2026`);
}
must(scanned > 100, `scanned only ${scanned} tracked files for the rejected pictures`);
const allowedHits = [...ALLOWED].filter((f) => f !== REG_FILE && names.some((n) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes(n)));
must(allowedHits.length <= 1, 'more than the edge redirect names a rejected picture');

if (cases < 40) errors.push(`only ${cases} cases ran; the test is not reaching the generator`);
if (errors.length) {
  console.error(`image-budget: FAIL (${errors.length})`);
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}
console.log(`image-budget: PASS — ${cases} cases (cap, ledger missing/unreadable/NaN/negative/expired, usage NaN/negative/missing, outage x4, owner photos and refs refused, CLI stop) and ${scanned} tracked files free of the 7 rejected pictures`);
