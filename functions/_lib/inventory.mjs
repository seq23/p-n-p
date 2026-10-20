// Rentals inventory for /admin Settings -> Inventory (owner-approved 18 Oct 2026; docs/admin-console.md).
//
// One source of truth, two readers:
//  - D1 (migration 0013) holds the live copy. Every admin page, the /request form, its availability
//    answer and the Monday summary call useInventory(env) first, so an item added, edited, removed
//    or brought back counts everywhere in the admin straight away (prices.mjs applyInventory).
//  - The public pages are pre-rendered for Google. Every save starts the Inventory Publish workflow
//    (.github/workflows/inventory-publish.yml) with the whole inventory as its input; it writes
//    data/rentals/games.json, converts any new photo, rebuilds every page that reads the file,
//    runs validate:release and pushes to main, and Cloudflare Pages deploys it (about 5 minutes).
//    Settings shows "Website updating..." then "Live ✓" once porchandparty901.com/rentals/ carries
//    the new inventory version (<meta name="pnp-inventory">), or a plain-words failure with a retry.
//
// The rules a save must pass are scripts/lib/inventory.js validate(), the same function CI runs on
// the committed file, so a save CI would reject is refused here with the same sentence.
import INV from '../../scripts/lib/inventory.js';
import { BUNDLED_GAMES, applyInventory } from './prices.mjs';
import { cleanImage } from './image-clean.mjs';
import { bytesToB64 } from './util.mjs';
import { expandItems, rentalWindows, isOut, countOf, listBookings, loadReturns } from './calendar.mjs';
import { shortName } from './requested.mjs';
import { shortDate } from './util.mjs';
import { currentHolds, fromSql } from './holds.mjs';

export const REPO = 'seq23/p-n-p';
export const WORKFLOW = 'inventory-publish.yml';
export const SITE = 'https://porchandparty901.com';
export const PHOTO_MAX_BYTES = 1900 * 1024; // D1 holds a row up to 2 MB
export const PUBLISH_TIMEOUT_MIN = 30;
const BUNDLED_VERSION = INV.hash(JSON.stringify(INV.inventoryOf(INV.resolve(BUNDLED_GAMES))));
// Items that have a photo in the repo (assets/rentals/<slug>.webp): every games / extras item does
// (validate:rentals holds that), so the bundled file is the list.
const BUNDLED_PHOTOS = new Set([...(BUNDLED_GAMES.games || []), ...(BUNDLED_GAMES.extras || [])].map((i) => i.slug));

// The inventory version: what the rentals page's <meta name="pnp-inventory"> carries once live.
export const versionOf = (data) => INV.hash(JSON.stringify(INV.inventoryOf(INV.resolve(data))));

let memo = { key: '', state: null };

async function meta(db) {
  const { results } = await db.prepare('SELECT key, value FROM inventory_meta').all();
  return Object.fromEntries((results || []).map((r) => [r.key, r.value]));
}
async function putMeta(db, key, value) {
  await db.prepare('INSERT INTO inventory_meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, String(value)).run();
}
async function bump(db) {
  await db.prepare("INSERT INTO inventory_meta (key, value) VALUES ('rev', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1").run();
}
export async function log(db, slug, action, detail = '') {
  await db.prepare('INSERT INTO inventory_log (slug, action, detail) VALUES (?1, ?2, ?3)').bind(slug, action, String(detail).slice(0, 500)).run();
}

// Replace every row with a games.json's items (first use, or a newer file from a code change).
async function seed(db, data, why) {
  const stmts = [db.prepare('DELETE FROM inventory_items')];
  for (const section of INV.SECTIONS) {
    (data[section] || []).forEach((item, position) => {
      stmts.push(db.prepare('INSERT INTO inventory_items (slug, section, position, data, photo_live) VALUES (?1, ?2, ?3, ?4, 1)')
        .bind(item.slug, section, position, JSON.stringify(item)));
    });
  }
  await db.batch(stmts);
  await putMeta(db, 'rates', JSON.stringify(data.rates));
  await putMeta(db, 'base_version', versionOf(data));
  await putMeta(db, 'dirty', '0');
  await bump(db);
  await log(db, '*', 'seed', why);
}

async function rows(db) {
  const { results } = await db.prepare('SELECT slug, section, position, data, photo_sha, photo_live, updated_at FROM inventory_items ORDER BY section, position').all();
  return results || [];
}

function fromRows(list, m) {
  const inv = { rates: m.rates ? JSON.parse(m.rates) : BUNDLED_GAMES.rates };
  for (const s of INV.SECTIONS) inv[s] = list.filter((r) => r.section === s).sort((a, b) => a.position - b.position).map((r) => JSON.parse(r.data));
  return inv;
}

// The live inventory: { data (games.json shape, resolved), rows, meta, version }.
export async function loadInventory(db) {
  let m = await meta(db);
  const key = `${m.rev || ''}|${BUNDLED_VERSION}|${m.base_version || ''}`;
  if (m.rev && memo.key === key && memo.state) return memo.state;
  let list = await rows(db);
  if (!list.length) {
    await seed(db, INV.resolve(BUNDLED_GAMES), 'first use: seeded from data/rentals/games.json');
    m = await meta(db); list = await rows(db);
  } else if (m.base_version !== BUNDLED_VERSION) {
    // A new website build is out. Either it carries our last save (it landed), or the file was
    // changed in the code (a developer change): that wins unless a save of Valerie's is still waiting.
    const mine = versionOf(INV.merge(BUNDLED_GAMES, fromRows(list, m)));
    if (mine === BUNDLED_VERSION) { await putMeta(db, 'base_version', BUNDLED_VERSION); await putMeta(db, 'dirty', '0'); }
    else if (m.dirty !== '1') await seed(db, INV.resolve(BUNDLED_GAMES), 'the website build changed data/rentals/games.json');
    else await putMeta(db, 'base_version_seen', BUNDLED_VERSION);
    m = await meta(db); list = await rows(db);
  }
  const data = INV.merge(BUNDLED_GAMES, fromRows(list, m));
  const state = { data, rows: list, meta: m, version: versionOf(data) };
  memo = { key: `${m.rev || ''}|${BUNDLED_VERSION}|${m.base_version || ''}`, state };
  return state;
}

// Every entry point calls this first. A database without migration 0013 (or any read failure)
// keeps the bundled games.json, so a page never breaks over the inventory.
export async function useInventory(env) {
  if (!env || !env.DB) return null;
  try {
    const state = await loadInventory(env.DB);
    applyInventory(state.data);
    return state;
  } catch {
    applyInventory(BUNDLED_GAMES);
    return null;
  }
}

export function hasImageFn(list) {
  const uploaded = new Set(list.filter((r) => r.photo_sha).map((r) => r.slug));
  return (slug) => BUNDLED_PHOTOS.has(slug) || uploaded.has(slug);
}

// Where the admin shows an item's photo from.
export function photoUrl(row) {
  if (row && row.photo_sha && !row.photo_live) return `/api/inventory/photo/${row.photo_sha}`;
  if (row && BUNDLED_PHOTOS.has(row.slug)) return `/assets/rentals/${row.slug}.webp`;
  if (row && row.photo_sha) return `/api/inventory/photo/${row.photo_sha}`;
  return '';
}

// Future rental pickups that take an item out (its name, or a bundle that carries it), for
// "Remove": say so plainly with the count, and still allow it.
export async function futureBookingsFor(db, name, today, table) {
  // A rental counts until its return day, not only from its pickup day (owner, 19 Oct 2026): one
  // picked up yesterday and back next week still has the item out.
  const { results } = await db.prepare(`SELECT p.id, p.date, p.items FROM bookings p WHERE p.kind = 'rental_pickup' AND (p.date >= ?1
      OR EXISTS (SELECT 1 FROM bookings r WHERE r.kind = 'rental_return' AND r.request_key IS NOT NULL AND r.request_key = p.request_key AND r.date >= ?1))`).bind(today).all();
  const n = String(name).toLowerCase();
  return (results || []).filter((b) => String(b.items || '').toLowerCase().includes(n) || expandItems(b.items, table).names.includes(name));
}

// ---- Saving ---------------------------------------------------------------------------------

const int = (v) => { const s = String(v == null ? '' : v).replace(/[$,\s]/g, ''); return /^\d+$/.test(s) ? Number(s) : NaN; };
const str = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

// The form's fields, cleaned. kind: 'game' | 'extra'; onWebsite: the "Show on website" switch.
export function readForm(form) {
  const g = (k) => form.get(k);
  return {
    name: str(g('name')), quantity: int(g('quantity')), dayPrice: int(g('day_price')), weekendPrice: int(g('weekend_price')),
    deposit: str(g('deposit')) === '' ? null : int(g('deposit')), blurb: str(g('blurb')), alt: str(g('alt')), size: str(g('size')),
    use: ['both', 'indoor', 'outdoor'].includes(str(g('use'))) ? str(g('use')) : 'both', kind: str(g('kind')) === 'extra' ? 'extra' : 'game',
    onWebsite: form.getAll('on_website').map(String).includes('1'),
  };
}

// Apply the form to an item object (keeps every key it already has, in its order).
function applyFields(item, f, to, data) {
  const out = { ...item };
  const renamed = item.name !== undefined && item.name !== f.name;
  out.name = f.name;
  out.quantity = f.quantity;
  // An admin-only item keeps only the public fields it already has or that were typed in, so a
  // save that changes nothing changes nothing (the form's default "Indoor or outdoor" included).
  for (const k of ['size', 'use', 'blurb', 'alt']) if (to !== 'adminItems' || item[k] !== undefined || (f[k] && !(k === 'use' && f[k] === 'both'))) out[k] = f[k];
  // The hand-written llms line and running-copy words follow the old name or size; drop them so
  // the derived ones (scripts/lib/inventory.js) take over.
  if (renamed || (item.size !== undefined && item.size !== f.size)) delete out.llms;
  if (renamed) { delete out.phrase; delete out.short; }
  if (to !== 'adminItems' && !out.formChoice) out.formChoice = f.name; // a rename keeps the old form string, so old requests still match
  if (to === 'extras' || (to === 'adminItems' && f.kind === 'extra' && Number.isInteger(f.dayPrice))) { out.dayPrice = f.dayPrice; out.weekendPrice = f.weekendPrice; }
  if (to === 'games') { delete out.dayPrice; delete out.weekendPrice; }
  if (to !== 'adminItems') { if (f.deposit == null || f.deposit === data.damageDeposit) delete out.deposit; else out.deposit = f.deposit; }
  if (out.bundleSets) out.bundleSets = f.quantity;
  if (to === 'adminItems') { out.admin_only = true; if (item.kind !== undefined || f.kind !== 'extra') out.kind = f.kind; } else { delete out.admin_only; delete out.kind; }
  if (out.availableNow === undefined) out.availableNow = true;
  return out;
}

// The section a form saves into: public games / extras, or adminItems for "Admin only".
const sectionFor = (f) => (f.onWebsite ? (f.kind === 'extra' ? 'extras' : 'games') : 'adminItems');

// Save one item (slug = '' for a new one). Returns { ok, errors, slug }.
export async function saveItem(env, { slug = '', form, photo = null }) {
  const db = env.DB;
  const state = await loadInventory(db);
  const f = readForm(form);
  const inv = INV.inventoryOf(state.data);
  const row = slug ? state.rows.find((r) => r.slug === slug) : null;
  if (slug && !row) return { ok: false, errors: ['That item is not in the inventory any more.'] };
  const to = sectionFor(f);
  let item;
  let at = -1;
  let newSlug = slug;
  if (row) {
    item = JSON.parse(row.data);
    at = inv[row.section].findIndex((i) => i.slug === slug);
    inv[row.section] = inv[row.section].filter((i) => i.slug !== slug);
  } else {
    newSlug = INV.slugify(f.name);
    if (!newSlug) return { ok: false, errors: ['Type a name for the item.'] };
    if (state.rows.some((r) => r.slug === newSlug)) return { ok: false, errors: [`There is already an item called "${f.name}". Edit that one, or pick a different name.`] };
    item = { slug: newSlug };
  }
  const next = applyFields(row ? item : INV.newItem(to, { ...f, slug: newSlug }), f, to, state.data);
  if (row && row.section === to && at >= 0) inv[to].splice(at, 0, next); else inv[to].push(next);
  // Photo: cleaned (EXIF stripped) and checked before anything is written.
  let cleaned = null;
  if (photo && photo.size) {
    if (photo.size > PHOTO_MAX_BYTES) return { ok: false, errors: ['That photo is too big. Take it again on your phone (it shrinks photos by itself), or pick a smaller one.'] };
    cleaned = cleanImage(new Uint8Array(await photo.arrayBuffer()), photo.type || '');
    if (!cleaned) return { ok: false, errors: ['That file is not a photo we can use. Pick a JPG or PNG photo.'] };
  }
  const candidate = INV.merge(BUNDLED_GAMES, inv);
  const hasImage = hasImageFn(state.rows);
  const errors = INV.validate(candidate, { hasImage: (s) => hasImage(s) || Boolean(cleaned && s === newSlug) });
  if (errors.length) return { ok: false, errors };
  let sha = null;
  if (cleaned) {
    sha = (await sha256(cleaned.bytes)).slice(0, 40);
    await db.prepare('INSERT OR IGNORE INTO inventory_photos (sha, slug, content_type, bytes, size) VALUES (?1, ?2, ?3, ?4, ?5)').bind(sha, newSlug, cleaned.type, cleaned.bytes, cleaned.bytes.length).run();
  }
  await writeItems(db, candidate, { slug: newSlug, sha });
  await log(db, newSlug, row ? 'edit' : 'add', row && row.section !== to ? `moved to ${to}` : to);
  return { ok: true, slug: newSlug, errors: [] };
}

// Write every item row from a resolved games.json (positions kept per section), plus rates.
async function writeItems(db, data, { slug = '', sha = null } = {}) {
  const old = await rows(db);
  const stmts = [];
  const keep = new Set();
  for (const section of INV.SECTIONS) {
    (data[section] || []).forEach((item, position) => {
      keep.add(item.slug);
      const was = old.find((r) => r.slug === item.slug);
      const photoSha = item.slug === slug && sha ? sha : (was ? was.photo_sha : null);
      const photoLive = item.slug === slug && sha ? 0 : (was ? was.photo_live : 1);
      stmts.push(db.prepare(`INSERT INTO inventory_items (slug, section, position, data, photo_sha, photo_live, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
        ON CONFLICT(slug) DO UPDATE SET section = excluded.section, position = excluded.position, data = excluded.data, photo_sha = excluded.photo_sha, photo_live = excluded.photo_live,
        updated_at = CASE WHEN inventory_items.data = excluded.data AND COALESCE(inventory_items.photo_sha, '') = COALESCE(excluded.photo_sha, '') THEN inventory_items.updated_at ELSE excluded.updated_at END`)
        .bind(item.slug, section, position, JSON.stringify(item), photoSha, photoLive));
    });
  }
  for (const r of old) if (!keep.has(r.slug)) stmts.push(db.prepare('DELETE FROM inventory_items WHERE slug = ?1').bind(r.slug));
  await db.batch(stmts);
  await putMeta(db, 'rates', JSON.stringify(data.rates));
  await putMeta(db, 'dirty', '1');
  await bump(db);
}

// Remove (soft: availableNow false) or bring back one item.
export async function setAvailable(env, slug, on) {
  const db = env.DB;
  const state = await loadInventory(db);
  const row = state.rows.find((r) => r.slug === slug);
  if (!row) return { ok: false, errors: ['That item is not in the inventory any more.'] };
  const inv = INV.inventoryOf(state.data);
  inv[row.section] = inv[row.section].map((i) => (i.slug === slug ? { ...i, availableNow: Boolean(on) } : i));
  const candidate = INV.merge(BUNDLED_GAMES, inv);
  const errors = INV.validate(candidate, { hasImage: hasImageFn(state.rows) });
  if (errors.length) return { ok: false, errors };
  await writeItems(db, candidate);
  await log(db, slug, on ? 'bring back' : 'remove');
  return { ok: true, errors: [] };
}

// The game day / weekend price (every game is the same price).
export async function saveRates(env, form) {
  const db = env.DB;
  const state = await loadInventory(db);
  const inv = INV.inventoryOf(state.data);
  inv.rates = { ...inv.rates, day: int(form.get('rate_day')), weekend: int(form.get('rate_weekend')) };
  const candidate = INV.merge(BUNDLED_GAMES, inv);
  const errors = INV.validate(candidate, { hasImage: hasImageFn(state.rows) });
  if (errors.length) return { ok: false, errors };
  await writeItems(db, candidate);
  await log(db, '*', 'game price', `$${inv.rates.day} day / $${inv.rates.weekend} weekend`);
  return { ok: true, errors: [] };
}

async function sha256(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Public GET /api/inventory/photo/<sha> (functions/api/inventory/photo/[sha].js): an inventory
// photo uploaded in Settings -> Inventory, by its content hash. The Inventory Publish workflow
// downloads new photos from here; the admin shows them from here until the website has them.
// Photos only (EXIF stripped on upload), never indexed; the hash is unguessable and the photo is
// meant for the public rentals page anyway.
export async function handlePhoto({ params, env }) {
  const row = env && env.DB ? await photoBySha(env.DB, String((params && params.sha) || '')).catch(() => null) : null;
  if (!row) return new Response('not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' } });
  return new Response(new Uint8Array(row.bytes), { headers: { 'Content-Type': row.content_type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' } });
}

export async function photoBySha(db, sha) {
  if (!/^[0-9a-f]{40}$/.test(String(sha))) return null;
  return db.prepare('SELECT content_type, bytes FROM inventory_photos WHERE sha = ?1').bind(sha).first();
}

// ---- Publishing (the website update) ---------------------------------------------------------
//
// Two ways a saved change reaches the Inventory Publish workflow; neither needs Valerie:
//  - always: the Inventory Poll workflow (every 5 minutes) reads GET /api/inventory/pending and,
//    when a change is waiting, starts Inventory Publish with GitHub's own workflow token;
//  - faster, when the Pages secret PNP_GITHUB_TOKEN (a GitHub key with Actions: write on
//    seq23/p-n-p) is set: the save starts it straight away. A missing or dead key only means the
//    5-minute round does it; it never blocks.
// The workflow reports back (POST /api/inventory/report, HMAC-signed with PNP_INVENTORY_REPORT_KEY,
// a secret on both GitHub and Pages) when it starts, pushes or fails. "Live ✓" is never taken on
// its word: it waits until porchandparty901.com/rentals/ carries the new inventory version.

const gh = (env) => env.PNP_FETCH || fetch;
const ghHeaders = (env) => ({ Authorization: `Bearer ${env.PNP_GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'pnp-admin-inventory' });
export const QUEUED_WORDS = 'Website updating… (it starts within 5 minutes)';
export const KEY_NOTE = 'The website update starts on its 5-minute round (the GitHub key for an instant start is not set).';
const KEY_DEAD = 'The website update starts on its 5-minute round (the GitHub key for an instant start stopped working).';
const FAILED_WORDS = 'The website did not update: the safety check found a problem with this change. Your change is saved and works in the admin and on the booking form. Tap Try again; if it fails twice, ask for help.';

async function latestPublish(db) {
  return db.prepare('SELECT * FROM inventory_publishes ORDER BY id DESC LIMIT 1').first();
}
async function setPublish(db, id, status, detail = '', extra = {}) {
  const sets = ['status = ?2', 'detail = ?3', "updated_at = datetime('now')"];
  const args = [id, status, detail];
  if (extra.run_url) { args.push(extra.run_url); sets.push(`run_url = ?${args.length}`); }
  if (status === 'live') sets.push("live_at = datetime('now')");
  await db.prepare(`UPDATE inventory_publishes SET ${sets.join(', ')} WHERE id = ?1`).bind(...args).run();
}

// The workflow input: the inventory (rates + the three item lists) as base64 JSON, and the
// photos the website does not have yet. Refuses rather than sends a payload GitHub would cut.
export function payloadFor(state) {
  const json = JSON.stringify(INV.inventoryOf(state.data));
  const inventory = bytesToB64(new TextEncoder().encode(json));
  const photos = state.rows.filter((r) => r.photo_sha && !r.photo_live).map((r) => ({ slug: r.slug, sha: r.photo_sha }));
  return { inventory, photos, size: inventory.length };
}

// Start a website update for the current inventory. Never throws: the outcome is a row.
export async function startPublish(env, what = '') {
  const db = env.DB;
  const state = await loadInventory(db);
  const { inventory, photos, size } = payloadFor(state);
  const row = await db.prepare("INSERT INTO inventory_publishes (version, status, detail, what, photos) VALUES (?1, 'queued', ?2, ?3, ?4) RETURNING id").bind(state.version, QUEUED_WORDS, String(what).slice(0, 200), JSON.stringify(photos)).first();
  const id = row.id;
  await db.prepare("UPDATE inventory_publishes SET status = 'superseded', detail = 'A newer change replaced this one.', updated_at = datetime('now') WHERE id < ?1 AND status IN ('queued','running','deploying','needs_key','failed')").bind(id).run();
  if (size > 60000) { await setPublish(db, id, 'failed', 'The inventory is too big to send in one website update. Ask for help: it needs a bigger channel.'); return { id, status: 'failed' }; }
  if (!env.PNP_GITHUB_TOKEN) return { id, status: 'queued', note: KEY_NOTE };
  try {
    const res = await gh(env)(`https://api.github.com/repos/${env.PNP_GITHUB_REPO || REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
      method: 'POST', headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { publish_id: String(id), inventory, photos: JSON.stringify(photos) } }),
    });
    if (res.ok) { await setPublish(db, id, 'running', 'Website updating…'); return { id, status: 'running' }; }
    return { id, status: 'queued', note: res.status === 401 || res.status === 403 ? KEY_DEAD : `GitHub answered ${res.status}; the 5-minute round will start it.` };
  } catch {
    return { id, status: 'queued', note: 'No connection to GitHub just now; the 5-minute round will start it.' };
  }
}

// Public GET /api/inventory/pending (the Inventory Poll workflow): the change waiting for the
// website, if any. Only what the publish needs (the inventory, which games.json in the public repo
// carries anyway, and new photo hashes); nothing about bookings or customers.
export async function pendingPayload(env) {
  const db = env.DB;
  const p = await latestPublish(db);
  const ageMin = p ? (Date.now() - Date.parse(`${String(p.updated_at).replace(' ', 'T')}Z`)) / 60000 : 0;
  // queued: nothing started it yet. running with no word from the workflow for 10 minutes: the
  // instant start was accepted but never ran, so the round starts it (it skips a run already there).
  const waiting = p && (p.status === 'queued' || (p.status === 'running' && ageMin > 10));
  if (!waiting) return { pending: false };
  const state = await loadInventory(db);
  const { inventory, photos } = payloadFor(state);
  return { pending: true, publish_id: p.id, version: state.version, inventory, photos };
}

async function hmacHex(key, text) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Public POST /api/inventory/report (the Inventory Publish workflow), signed:
// X-PNP-Signature = hex HMAC-SHA256(PNP_INVENTORY_REPORT_KEY, body). body:
// { publish_id, state: 'started' | 'pushed' | 'unchanged' | 'failed', run_url, ts }.
export async function handleReport(env, request) {
  const key = env.PNP_INVENTORY_REPORT_KEY;
  const body = await request.text();
  if (!key || body.length > 2000) return Response.json({ ok: false }, { status: 403 });
  const sig = String(request.headers.get('X-PNP-Signature') || '').toLowerCase();
  const want = await hmacHex(key, body);
  if (sig.length !== want.length || [...sig].reduce((d, c, i) => d | (c.charCodeAt(0) ^ want.charCodeAt(i)), 0)) return Response.json({ ok: false }, { status: 403 });
  let r;
  try { r = JSON.parse(body); } catch { return Response.json({ ok: false }, { status: 400 }); }
  if (Math.abs(Date.now() / 1000 - Number(r.ts || 0)) > 3600) return Response.json({ ok: false, error: 'stale' }, { status: 403 });
  const db = env.DB;
  const p = await db.prepare('SELECT * FROM inventory_publishes WHERE id = ?1').bind(Number(r.publish_id)).first();
  if (!p || ['live', 'superseded'].includes(p.status)) return Response.json({ ok: true, ignored: true });
  const runUrl = /^https:\/\/github\.com\/seq23\/p-n-p\/actions\/runs\/\d+$/.test(String(r.run_url || '')) ? r.run_url : '';
  if (r.state === 'started') await setPublish(db, p.id, 'running', 'Website updating…', { run_url: runUrl });
  else if (r.state === 'pushed' || r.state === 'unchanged') await setPublish(db, p.id, 'deploying', 'Website updating… (putting it live)', { run_url: runUrl });
  else if (r.state === 'failed') await setPublish(db, p.id, 'failed', FAILED_WORDS, { run_url: runUrl });
  else return Response.json({ ok: false }, { status: 400 });
  return Response.json({ ok: true });
}

async function liveVersion(env, id) {
  const res = await gh(env)(`${env.PNP_PUBLIC_SITE || SITE}/rentals/?inventory=${id}-${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' }, cf: { cacheTtl: 0 } });
  if (!res.ok) return '';
  const m = (await res.text()).match(/<meta name="pnp-inventory" content="([0-9a-f]+)"/);
  return m ? m[1] : '';
}

// Move the latest update along (the Settings page and its status poll call this). Returns the row.
export async function publishStatus(env) {
  const db = env.DB;
  let p = await latestPublish(db);
  if (!p || !['queued', 'running', 'deploying'].includes(p.status)) return p;
  const ageMin = (Date.now() - Date.parse(`${String(p.created_at).replace(' ', 'T')}Z`)) / 60000;
  try {
    if (p.status === 'running' && env.PNP_GITHUB_TOKEN) {
      const res = await gh(env)(`https://api.github.com/repos/${env.PNP_GITHUB_REPO || REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=20`, { headers: ghHeaders(env) });
      const runs = res.ok ? ((await res.json()).workflow_runs || []) : [];
      const run = runs.find((x) => x.display_title === `Inventory publish #${p.id}`);
      if (run && run.status === 'completed') {
        if (run.conclusion === 'success') await setPublish(db, p.id, 'deploying', 'Website updating… (putting it live)', { run_url: run.html_url });
        else if (run.conclusion === 'cancelled') await setPublish(db, p.id, 'queued', QUEUED_WORDS, { run_url: run.html_url });
        else await setPublish(db, p.id, 'failed', FAILED_WORDS, { run_url: run.html_url });
        p = await latestPublish(db);
      }
    }
    if (['queued', 'running', 'deploying'].includes(p.status)) {
      if ((await liveVersion(env, p.id)) === p.version) {
        await setPublish(db, p.id, 'live', 'Live ✓');
        for (const ph of JSON.parse(p.photos || '[]')) await db.prepare('UPDATE inventory_items SET photo_live = 1 WHERE slug = ?1 AND photo_sha = ?2').bind(ph.slug, ph.sha).run();
        const state = await loadInventory(db);
        if (state.version === p.version) await putMeta(db, 'dirty', '0');
        await bump(db);
      } else if (ageMin > PUBLISH_TIMEOUT_MIN) {
        await setPublish(db, p.id, 'failed', `The website did not update within ${PUBLISH_TIMEOUT_MIN} minutes. Your change is saved and works in the admin and on the booking form. Tap Try again.`);
      }
    }
  } catch {
    // A network hiccup: the next poll tries again.
  }
  return latestPublish(db);
}

// What Settings shows for the latest update.
export function publishWords(p) {
  if (!p) return { state: 'none', text: 'The website matches the inventory.' };
  const map = { queued: QUEUED_WORDS, running: 'Website updating…', deploying: 'Website updating…', live: 'Live ✓', failed: p.detail, superseded: 'Website updating…', needs_key: QUEUED_WORDS };
  return { state: p.status === 'needs_key' ? 'queued' : p.status, text: map[p.status] || p.detail, id: p.id, at: p.created_at, liveAt: p.live_at, runUrl: p.run_url || '' };
}

// Route entry points (functions/api/inventory/pending.js, report.js): no-store, never indexed.
const PUBLIC_HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
export async function handlePending({ env }) {
  try { return Response.json(await pendingPayload(env), { headers: PUBLIC_HEADERS }); } catch { return Response.json({ pending: false, error: 'unavailable' }, { status: 503, headers: PUBLIC_HEADERS }); }
}
export async function handleReportRoute({ request, env }) {
  const res = await handleReport(env, request);
  return new Response(res.body, { status: res.status, headers: { ...PUBLIC_HEADERS, 'Content-Type': 'application/json' } });
}

// ---- In / Out (owner, 19 Oct 2026) ------------------------------------------------------------
// Two separate ideas, never both called "available":
//  - Offered / Not offered is set by hand (Remove / Bring back: availableNow).
//  - In / Out is computed from the bookings: every rental from its pickup day through its return
//    day (calendar.mjs rentalWindows, the same windows and the same item matcher the /request form's
//    availability and the clash checks use), held (unpaid) or confirmed; a checked-in return frees it.
// A customer can book an item only when it is offered AND not out on their dates.

// "Tue 20 Oct, 3:40 PM" in Memphis, from a D1 UTC time.
export function holdUntilWords(until) {
  const ms = fromSql(until);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Chicago' }).replace(',', '');
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
  return `${day}, ${time}`;
}

// table: TRACK_TABLE; data: the games.json-shaped inventory (for Offered); holds: currentHolds rows.
// Returns slug -> { state: 'in' | 'out' | 'some' | 'hold' | 'off', label, next, upcoming: [...] }.
export function itemStatuses({ table, data, windows, holds = [], today }) {
  const held = new Map((holds || []).filter((h) => h.state === 'held').map((h) => [h.request_key, h]));
  const holdWords = (w) => { const h = held.get(w.key); if (!h) return ''; return h.until ? `Reserved until ${holdUntilWords(h.until)}` : 'Reserved by hand (no end date)'; };
  const offered = new Map(INV.allItems(data).map(({ item }) => [item.slug, item.availableNow !== false]));
  const out = {};
  for (const it of table.items) {
    const mine = windows.filter((w) => w.names.includes(it.name));
    const upcoming = mine.filter((w) => isOut(w, today, today) || w.start > today).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
      .map((w) => ({ key: w.key, name: shortName(w.name), start: w.start, end: w.end, count: countOf(w, it.name), outNow: isOut(w, today, today), late: isOut(w, today, today) && w.end < today, hold: holdWords(w) }));
    const now = upcoming.filter((u) => u.outNow);
    const nextW = upcoming.find((u) => !u.outNow);
    const next = nextW ? { ...nextW, words: `Next booked: ${shortDate(nextW.start)}${nextW.end !== nextW.start ? ` – ${shortDate(nextW.end)}` : ''}${nextW.hold ? ' (reserved)' : ''}` } : null;
    const stock = it.quantity || 1;
    const used = now.reduce((n, u) => n + u.count, 0);
    const isOffered = offered.has(it.slug) ? offered.get(it.slug) : !it.removed;
    const back = (u) => (u.late ? `was due back ${shortDate(u.end)}` : `back ${shortDate(u.end)}`);
    let state; let label;
    if (!isOffered) { state = 'off'; label = 'Not offered'; }
    else if (!used) { state = 'in'; label = 'In'; }
    else if (stock > 1 && used < stock) { state = 'some'; label = `${used} of ${stock} out`; }
    else if (now.every((u) => u.hold)) { state = 'hold'; label = now[0].hold; }
    else {
      const first = now.filter((u) => !u.hold).sort((a, b) => (a.end < b.end ? -1 : 1))[0];
      state = 'out';
      label = stock > 1 ? `${used} of ${stock} out, ${back(first)}` : `Out: ${first.name}, ${back(first)}`;
    }
    out[it.slug] = { state, label, used, stock, next, upcoming, offered: isOffered };
  }
  return out;
}

// The same, from the database (Inventory page and its item pages).
export async function loadStatuses(db, { table, data, today }) {
  const [bookings, returns, holds] = await Promise.all([listBookings(db), loadReturns(db), currentHolds(db)]);
  return itemStatuses({ table, data, windows: rentalWindows(bookings, returns, table), holds, today });
}
