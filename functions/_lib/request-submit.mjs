// porchandparty901.com/request: the page (GET), the submission (POST), the "request received"
// page, the rentals availability/total API and the /r/<code> referral link. Public routes:
// functions/request/index.js, functions/request/received.js, functions/api/request/availability.js,
// functions/r/[code].js. Spec: docs/admin-console.md "Site request form".
//
// $0 spam protection (owner, 23 Nov 2026: "anyone can trigger them and use up your quota"; a real
// customer is never turned away): a honeypot field, a server-signed render time (too fast = a bot),
// Cloudflare Turnstile verified at the server once its keys exist, and limits read from the D1 the
// form already writes. A request gets the FULL flow (customer confirmation email + rental hold) only
// when the robot check passed (or no keys are set: the named note TURNSTILE_NOT_CONFIGURED) AND it is
// under every limit: 3 per IP per hour, 3 per email address per 24 hours, 20 confirmation emails per
// 24 hours across the site. Otherwise it is KEPT for Valerie, flagged "sent without the robot check",
// with her notice and the draft invoice, but no email to the typed address and no hold (HELD_BACK).
// A forged token is the only refusal; past IP_HARD_HOUR from one address the form asks them to call.
import offers from '../../data/offers/services.json';
import games from '../../data/rentals/games.json';
import { useInventory } from './inventory.mjs';
import { PRICE_TABLE } from './prices.mjs';
import * as F from './request-form.mjs';
import { sourceOf, firstTouchOf } from './source-tag.mjs';
import * as C from './calendar.mjs';
import { getSettings, esc, sha256Hex, b64url, safeEqual } from './util.mjs';
import { availabilityFor } from './availability.mjs';
import { cleanImage } from './image-clean.mjs';
import { createHold, expireHolds, sqlTime } from './holds.mjs';
import { logEvent, fromRow } from './requests.mjs';
import { autoBookTakedown } from './takedown.mjs';
import { sendMessage } from './messages.mjs';
import { sendNewRequestEmail } from './owner-new-request.mjs';
import { makeAutoDraft } from './auto-draft.mjs';
import { syncSafely } from './admin-money.mjs';

const HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff' };
const MIN_SECONDS = 3;
const MAX_AGE_SECONDS = 2 * 86400;
// ipHardHour: past it the form stops storing and asks for a call (no person sends 20 an hour; it
// bounds the photos and rows one address can pile up). ownerNoticesDay: Valerie's own "New request"
// emails per 24 hours, so a flood cannot spend the mail quota through her notice either.
export const RATE = { perIpHour: 3, perEmailDay: 3, confirmationsDay: 20, ipHardHour: 20, ownerNoticesDay: 40 };
export const TURNSTILE_TIMEOUT_MS = 4000;
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
// Logged on the card when a request is kept without the confirmation email and the hold. The
// "request received" page reads it, so it never claims an email or a hold that did not happen.
export const HELD_BACK = 'Kept for Valerie without the confirmation email or a hold';
// Matched as a prefix with substr(), never LIKE: D1 refuses a LIKE pattern over 50 bytes, and this one is longer.
export const HELD_BACK_WHY = {
  missing: 'the robot check did not run in their browser',
  unavailable: 'the robot check could not be reached',
  expired: 'the robot check had expired or was used twice',
  ip: `more than ${RATE.perIpHour} website requests from one internet address in an hour`,
  email: `more than ${RATE.perEmailDay} website requests for this email address in 24 hours`,
  site: `more than ${RATE.confirmationsDay} confirmation emails in 24 hours`,
};
export const heldBackNote = (why) => `${HELD_BACK}: ${HELD_BACK_WHY[why]} (a safety limit against spam). Check it looks real, then text or email them yourself.`;
const REF_COOKIE = 'pnp_ref';

/**
 * True when the request that owns a referral code is the same person booking now: the same phone
 * digits, email or normalised name. A customer who taps her own /r/<code> link and books for herself
 * is never her own referrer (the $25 referral reward, owner 21 Nov 2026, is for two people).
 */
export function isSelfReferral(referrer, me) {
  if (!referrer) return false;
  const phone = (r) => C.digitsOf(r.phone_digits || r.phone || '').slice(-10);
  const name = (r) => r.name_norm || C.normName(r.name || '');
  const email = (r) => String(r.email || '').trim().toLowerCase();
  const same = (a, b) => Boolean(a) && a === b;
  return same(phone(referrer), phone(me)) || same(email(referrer), email(me)) || same(name(referrer), name(me));
}
const CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const formKey = (env) => env.PNP_ADMIN_SESSION_KEY || env.PNP_FORM_KEY || '';
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}
export async function signTs(env, now = Date.now()) {
  // No key (a branch preview has no Pages secrets): an empty stamp, which checkTs already treats
  // as 'missing', instead of an HMAC over a zero-length key that throws and 500s the form page.
  if (!formKey(env)) return '';
  const t = String(Math.floor(now / 1000));
  return `${t}.${await hmac(formKey(env), `request-form:${t}`)}`;
}
export async function checkTs(env, value, now = Date.now()) {
  const [t, sig] = String(value || '').split('.');
  if (!t || !sig || !formKey(env)) return 'missing';
  if (!safeEqual(sig, await hmac(formKey(env), `request-form:${t}`))) return 'bad';
  const age = now / 1000 - Number(t);
  if (age < MIN_SECONDS) return 'fast';
  if (age > MAX_AGE_SECONDS) return 'old';
  return 'ok';
}

export function randomCode(n = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}
const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

function cookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

// The page shell (request.html, built by scripts/generators/build_request_pages.js) with its
// form block replaced. Tests pass env.ASSETS reading the file from the repo.
async function shell(env, url) {
  if (!env.ASSETS) return '<!doctype html><html><head><meta charset="utf-8"><title>Request a quote | Porch &amp; Party</title></head><body><main><!--request-form--><!--/request-form--></main></body></html>';
  const res = await env.ASSETS.fetch(new Request(new URL('/request', url).toString()));
  return res.text();
}
const FORM_BLOCK = /<!--request-form-->[\s\S]*?<!--\/request-form-->/;
const withBlock = (html, block) => html.replace(FORM_BLOCK, () => block);

async function formPage(env, url, { values = {}, errors = {}, status = 200, referral = '' } = {}) {
  const html = withBlock(await shell(env, url), F.renderForm({ offers, table: PRICE_TABLE, values, errors, ts: await signTs(env), sitekey: env.TURNSTILE_SITEKEY || '', referral, today: F.chicagoToday() }));
  return new Response(html, { status, headers: HEADERS });
}

// Fields where a customer can tick more than one box; every other field keeps one value.
const MULTI_FIELDS = new Set(['multi', 'games', 'porch_addons', 'porch_features']);

function fieldsOf(form) {
  const out = {};
  for (const [k, v] of form.entries()) {
    if (typeof v !== 'string') continue;
    if (MULTI_FIELDS.has(k)) (out[k] = out[k] || []).push(v);
    else out[k] = v;
  }
  return out;
}

/**
 * The robot check, at the server -> 'ok' | 'missing' | 'bad' | 'unavailable' | 'not_configured'.
 * Only 'ok' (or 'not_configured', the named note) can earn the full flow; 'bad' is refused;
 * 'missing' / 'unavailable' are kept without the email and hold. Never trusts the browser: the
 * token is checked with Cloudflare (env.FETCH is the test seam messages.mjs already uses), with a
 * time limit, and anything but an explicit success: true is not 'ok'.
 */
export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITEKEY) return 'not_configured';
  if (!token) return 'missing';
  if (token.length > 2048) return 'bad'; // Cloudflare tokens are at most 2048 characters
  try {
    const res = await (env.FETCH || fetch)(TURNSTILE_VERIFY, { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }), signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS) });
    if (!res.ok) return 'unavailable';
    const j = await res.json();
    if (j && j.success === true) return 'ok';
    const codes = (j && Array.isArray(j['error-codes'])) ? j['error-codes'] : [];
    // Our own key being wrong is never the customer's fault: kept, never refused, and named.
    if (codes.some((c) => /input-secret/.test(c))) { console.error('TURNSTILE_SECRET_REJECTED: Cloudflare refused TURNSTILE_SECRET; website requests are kept without the confirmation email or hold until it is fixed.'); return 'unavailable'; }
    if (codes.includes('internal-error')) return 'unavailable';
    // A real token used twice or left too long (a double tap, the back button): kept, not refused.
    if (codes.includes('timeout-or-duplicate')) return 'expired';
    return 'bad';
  } catch { return 'unavailable'; }
}

const hourAgo = (now) => Math.floor(now / 1000) - 3600;
// Requests from this (hashed) address in the last hour, all kinds counted.
async function ipCount(env, ipHash, now) {
  await env.DB.prepare('DELETE FROM form_attempts WHERE ts < ?1').bind(hourAgo(now) - 86400).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM form_attempts WHERE ip_hash = ?1 AND ts >= ?2').bind(ipHash, hourAgo(now)).first();
  return row ? row.n : 0;
}
async function count(env, sql, ...args) {
  const row = await env.DB.prepare(sql).bind(...args).first();
  return row ? Number(row.n) : 0;
}
// Website requests for one email address in the last 24 hours, kept ones included.
const emailCount = (env, now, email) => count(env, "SELECT COUNT(*) AS n FROM requests WHERE source = 'site' AND submitted_at >= ?1 AND lower(email) = ?2", sqlTime(now - 86400000), email.toLowerCase());
// Website requests in the last 24 hours that got the full flow (a confirmation email), this one
// included once it is stored: a flood of held-back requests never uses up real customers' emails.
const fullFlowCount = (env, now) => count(env, `SELECT COUNT(*) AS n FROM requests r WHERE r.source = 'site' AND r.submitted_at >= ?1
  AND NOT EXISTS (SELECT 1 FROM request_events e WHERE e.request_key = r.request_key AND substr(e.what, 1, length(?2)) = ?2)`, sqlTime(now - 86400000), HELD_BACK);
const ownerNoticeCount = (env, now) => count(env, 'SELECT COUNT(*) AS n FROM requests WHERE owner_emailed_at >= ?1', sqlTime(now - 86400000));
const tooMany = () => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Please call us | Porch &amp; Party</title><p style="font:18px/1.5 sans-serif;max-width:560px;margin:40px auto;padding:0 16px">We got a lot of requests from this connection in the last hour, so the form is paused here. Please call or text <a href="tel:+19013551518">901-355-1518</a> and we will help you right away.</p>', { status: 429, headers: HEADERS });

// TURNSTILE_NOT_CONFIGURED is named once per isolate (each submission still runs on the limits).
let noKeyNoted = false;

// "Sun 26 Oct, 3:00 PM" in Memphis for a UTC instant (ms).
export function chicagoWords(ms) {
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Chicago' }).replace(/^(\w+), (\w+) (\d+)$/, '$1 $3 $2');
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
  return `${day}, ${time}`;
}

export async function handleRequestPage(context) {
  const { request, env } = context;
  await useInventory(env); // Settings -> Inventory counts on the form straight away
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    const ref = CODE_RE.test(url.searchParams.get('ref') || '') ? url.searchParams.get('ref') : (CODE_RE.test(cookie(request, REF_COOKIE)) ? cookie(request, REF_COOKIE) : '');
    const values = {};
    const want = url.searchParams.get('service');
    if (F.SERVICE_KEYS.includes(want)) values.service = want;
    // "Request this package" on the price grid and the FAQ calculator preselects the season
    // and the decor answer: /request?service=porch&season=fall&decor=classic.
    const pk = PRICE_TABLE.porchPackages;
    const season = pk && pk.seasons.find((x) => x.key === url.searchParams.get('season'));
    if (season) { values.service = values.service || 'porch'; values.porch_season = season.formChoice; }
    const decor = url.searchParams.get('decor');
    if (pk && (pk.tierOrder.includes(decor) || decor === 'not_sure')) { values.service = values.service || 'porch'; values.porch_decor = decor; }
    // ?src=, then ?utm_source=, then the site that sent the visit (source-tag.mjs).
    const src = sourceOf(url, request.headers.get('Referer'));
    if (src) values.src = src;
    return formPage(env, url, { values, referral: ref });
  }
  if (method !== 'POST') return new Response('method not allowed', { status: 405, headers: { Allow: 'GET, POST' } });
  return submit(context);
}

async function submit(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pending = [];
  const later = (p) => { const q = p.catch(() => {}); if (typeof context.waitUntil === 'function') context.waitUntil(q); else pending.push(q); };
  if (!env.DB || !env.IDS) return new Response('The request form is resting for a moment. Please call or text 901-355-1518.', { status: 503, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
  let form;
  try { form = await request.formData(); } catch { return formPage(env, url, { errors: { service: 'That did not come through. Please try again.' }, status: 400 }); }
  const fields = fieldsOf(form);
  // Honeypot: a person never sees the field. Answer like a success, store nothing.
  if (String(fields.website || '').trim()) return Response.redirect(new URL('/request/received?k=thanks', url).toString(), 303);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const ipHash = (await sha256Hex(`${formKey(env)}|${ip}`)).slice(0, 32);
  const values = { ...fields };
  delete values.ts; delete values['cf-turnstile-response'];
  // The robot check comes first. Only 'ok' (or no keys yet: the named note) can earn the full flow;
  // a forged token is refused; anything else is kept for Valerie without the email and the hold.
  const robot = await verifyTurnstile(env, String(fields['cf-turnstile-response'] || ''), ip);
  if (robot === 'not_configured' && !noKeyNoted) { noKeyNoted = true; console.warn('TURNSTILE_NOT_CONFIGURED: TURNSTILE_SITEKEY / TURNSTILE_SECRET are not set on this deployment; website requests run on the limits alone (docs/admin-console.md "Spam").'); }
  if (robot === 'bad') return formPage(env, url, { values, errors: { agree: 'The robot check did not pass. Please tick the box again and send again, or call or text 901-355-1518.' }, status: 400 });
  const ts = await checkTs(env, fields.ts);
  if (ts !== 'ok') return formPage(env, url, { values, errors: { agree: ts === 'old' ? 'This page was open a long time. Please check your answers and send again.' : 'Please check your answers and send again.' }, status: 400 });
  const fromIp = await ipCount(env, ipHash, Date.now());
  if (fromIp >= RATE.ipHardHour) return tooMany();
  let heldBack = robot === 'ok' || robot === 'not_configured' ? null : robot;
  if (!heldBack && fromIp >= RATE.perIpHour) heldBack = 'ip';

  const file = form.get('id_photo');
  const fileInfo = file && typeof file === 'object' ? { size: file.size, type: file.type || 'application/octet-stream' } : null;
  if (fileInfo && fileInfo.type === 'application/octet-stream') fileInfo.type = 'image/jpeg';
  const today = F.chicagoToday();
  const { errors, answers, clean } = F.validateSubmission(fields, { offers, table: PRICE_TABLE, today, file: fileInfo });
  let image = null;
  if (!errors.id_photo && file && typeof file === 'object') {
    image = cleanImage(new Uint8Array(await file.arrayBuffer()), file.type);
    if (!image) errors.id_photo = 'That file is not a photo we can use. Take a photo with your phone camera, or upload a JPG or PNG.';
  }
  // Inspiration photos (owner, 5 Nov 2026): optional, up to MAX_INSPO, cleaned like the ID photo,
  // kept private in the same bucket under inspo/. A bad file names itself; nothing is guessed.
  const inspo = [];
  const inspoFiles = form.getAll('inspo_photos').filter((x) => x && typeof x === 'object' && x.size > 0).slice(0, F.MAX_INSPO);
  for (const x of inspoFiles) {
    if (errors.inspo_photos) break;
    if (x.size > 10 * 1024 * 1024) { errors.inspo_photos = 'One of your inspiration photos is too large (over 10 MB). Please pick a smaller one.'; break; }
    const img = cleanImage(new Uint8Array(await x.arrayBuffer()), x.type === 'application/octet-stream' ? '' : x.type);
    if (!img) errors.inspo_photos = 'One of your inspiration photos is not a photo we can use. Please use a JPG or PNG, or a screenshot.';
    else inspo.push(img);
  }
  const services = clean.services;
  let quote = null;
  if (services.includes('rentals') && clean.games && clean.games.length && clean.pickup_date && clean.return_date && clean.duration && !errors.rental_date && !errors.pickup_when && !errors.return_when) {
    await expireHolds(env.DB);
    const left = await availabilityFor(env.DB, clean.pickup_date, clean.return_date, today);
    quote = F.rentalQuote(clean.games, clean.duration, PRICE_TABLE, games.holdPercent);
    // How many of each item the quote takes out: a Whole Yard it lands on carries both Giant
    // Color Stack sets, so one set already out makes it unbookable (18 Oct 2026).
    const takes = C.expandItems(quote ? quote.lines.filter((l) => !l.refundable).map((l) => l.description).join(', ') : '', PRICE_TABLE).counts;
    const busy = F.rentalItems(PRICE_TABLE).filter((i) => clean.games.includes(i.slug) && left[i.slug] !== undefined && left[i.slug] < Math.max(1, takes[i.name] || 0));
    if (busy.length) errors.games = `${busy.map((i) => i.name).join(', ')} ${busy.length === 1 ? 'is' : 'are'} already booked for those dates. Untick ${busy.length === 1 ? 'it' : 'them'} or pick another date.`;
  }
  if (Object.keys(errors).length) { delete values.id_photo; return formPage(env, url, { values, errors, status: 400 }); }

  // ---- Limits, then store it -----------------------------------------------------------------
  const now = Date.now();
  if (!heldBack && await emailCount(env, now, clean.email) >= RATE.perEmailDay) heldBack = 'email';
  await env.DB.prepare('INSERT INTO form_attempts (ip_hash, ts) VALUES (?1, ?2)').bind(ipHash, Math.floor(now / 1000)).run();
  const settings = await getSettings(env.DB);
  const submitted = sqlTime(now);
  const key = `site|${submitted}|${clean.email.toLowerCase()}`;
  const ext = image.type === 'image/png' ? 'png' : 'jpg';
  const idObject = `ids/${randomId()}.${ext}`;
  await env.IDS.put(idObject, image.bytes, { httpMetadata: { contentType: image.type } });
  const inspoObjects = [];
  for (const img of inspo) {
    const k = `inspo/${randomId()}.${img.type === 'image/png' ? 'png' : 'jpg'}`;
    await env.IDS.put(k, img.bytes, { httpMetadata: { contentType: img.type } });
    inspoObjects.push(k);
  }
  const refIn = [fields.ref, cookie(request, REF_COOKIE)].find((c) => CODE_RE.test(String(c || ''))) || '';
  let referredBy = null;
  if (refIn) {
    const who = await env.DB.prepare('SELECT request_key, name, email, phone, name_norm, phone_digits FROM requests WHERE referral_code = ?1').bind(refIn).first();
    if (who && !isSelfReferral(who, { name: clean.name, email: clean.email, phone: clean.phone })) referredBy = refIn;
  }
  // Where the request came from: the last visit from outside the site that this browser tab
  // remembered (first_touch), else the /request visit's own tag (src, set at GET; also what a browser
  // with storage blocked or no JavaScript sends). source-tag.mjs.
  const sourceTag = firstTouchOf(fields.first_touch) || F.cleanSrc(fields.src);
  const receipt = randomId();
  const code = randomCode();
  const extra = [];
  // The pickup and return days are answers of their own (request-form.mjs, from the event date).
  await env.DB.prepare(`INSERT INTO requests (request_key, source, submitted_at, services, name, email, phone, dob, social, heard, answers, id_object, id_type, id_size,
      agreed_at, rules_version, agreed_name, agreed_ip, takedown_plan, referral_code, referred_by, receipt_id, robot_check, name_norm, phone_digits, source_tag, corporate, inspo_objects)
    VALUES (?1, 'site', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?2, ?14, ?4, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)`)
    .bind(key, submitted, JSON.stringify(services), clean.name, clean.email, clean.phone, clean.dob, clean.social || '', clean.heard || '',
      JSON.stringify([...answers, ...extra]), idObject, image.type, image.bytes.length, F.RULES_VERSION, ip, clean.takedown_plan || null, code, referredBy, receipt,
      robot === 'ok' ? 'turnstile' : 'no-js', C.normName(clean.name), C.digitsOf(clean.phone), sourceTag, clean.corporate ? 1 : 0, inspoObjects.length ? JSON.stringify(inspoObjects) : null).run();
  await logEvent(env.DB, key, `Agreed to the Rules & Responsibilities (version ${F.RULES_VERSION}) and the Terms & Conditions, as "${clean.name}"`, 'website form');
  // The site-wide cap counts this request, now stored. A held-back request says why on its card at
  // once (the count above reads that note), and gets no confirmation email, hold, rental bookings or
  // takedown: Valerie books those with the normal Schedule step once she has checked it is real.
  if (!heldBack && await fullFlowCount(env, now) > RATE.confirmationsDay) heldBack = 'site';
  if (heldBack) await logEvent(env.DB, key, heldBackNote(heldBack), 'website form');
  // A takedown date on the request books the takedown at once (takedown.mjs autoTakedownRow:
  // porch/party, "yes", a real date, never a duplicate). "Not sure" / "No" book nothing.
  const stored = heldBack ? null : await env.DB.prepare('SELECT * FROM requests WHERE request_key = ?1').bind(key).first();
  if (stored) await autoBookTakedown(env.DB, fromRow(stored), { who: 'website form' });

  let rentals = null;
  if (quote && heldBack) await autoDraft(env, key, { lines: quote.lines, depositCents: quote.dueNow, dueDate: clean.pickup_date });
  if (quote && !heldBack) {
    const hold = await createHold(env.DB, key, { now, settings });
    const items = quote.picked.map((i) => i.name).join(', ');
    const base = { request_key: key, invoice_id: null, time: null, customer_name: clean.name, phone: clean.phone, email: clean.email, place: PRICE_TABLE.pickupPlace };
    await C.upsertBookings(env.DB, [{ ...base, kind: 'rental_pickup', date: clean.pickup_date, items }, { ...base, kind: 'rental_return', date: clean.return_date, items }]);
    const invoiceId = await autoDraft(env, key, { lines: quote.lines, depositCents: quote.dueNow, dueDate: clean.pickup_date });
    if (invoiceId) await env.DB.prepare('UPDATE bookings SET invoice_id = ?1 WHERE request_key = ?2').bind(invoiceId, key).run();
    rentals = { items, pickupISO: clean.pickup_date, returnISO: clean.return_date,
      holdEnds: hold.until ? chicagoWords(Date.parse(`${hold.until.replace(' ', 'T')}Z`)) : 'Valerie confirms with you', quote };
  }
  // Porch, party & decor and grazing requests get their draft invoice too (owner, 20 Oct 2026).
  if (!quote) await autoDraft(env, key);
  const ctx = {
    name: clean.name, email: clean.email, phone: clean.phone, services,
    rentals: rentals ? { items: rentals.items, pickup: shortDay(rentals.pickupISO), returnDate: shortDay(rentals.returnISO), holdEnds: rentals.holdEnds,
      total: F.money(rentals.quote.total), damage: F.money(rentals.quote.damage), dueNow: F.money(rentals.quote.dueNow), atPickup: F.money(rentals.quote.atPickup) } : null,
    pay: { zelle: settings.zelle || '', cashapp: settings.cashapp || '' },
  };
  if (!heldBack) later(sendMessage(env, 'email', 'requestReceived', ctx).then((r) => (r.ok ? logEvent(env.DB, key, 'Confirmation email sent', 'website form') : logEvent(env.DB, key, `Confirmation email did not go out (${r.error})`, 'website form'))));
  // Valerie's own "New request" email with every answer (owner, 19 Oct 2026). Once per request,
  // website requests only; a failure is logged on the card and never blocks the submission.
  // Past ownerNoticesDay in 24 hours a flood cannot spend the mail quota: the card is still there.
  if (await ownerNoticeCount(env, now) >= RATE.ownerNoticesDay) await logEvent(env.DB, key, `New-request email to Valerie not sent: more than ${RATE.ownerNoticesDay} in 24 hours (a safety limit against spam). The request is on /admin.`, 'website form');
  else later(sendNewRequestEmail(env, key, { log: (what) => logEvent(env.DB, key, what, 'website form') }));
  later(syncSafely(env));
  await Promise.all(pending);
  return new Response(null, { status: 303, headers: { Location: `/request/received?k=${receipt}`, 'Cache-Control': 'no-store' } });
}

// The draft invoice made from the request (auto-draft.mjs makeAutoDraft): never sent by itself, one
// per request. A failure never loses the request: it is logged on the card, which then shows its
// normal "Create invoice" button.
async function autoDraft(env, key, quote = null) {
  try { return await makeAutoDraft(env, key, { who: 'website form', quote }); } catch (e) {
    await logEvent(env.DB, key, `The invoice draft could not be made by itself (${String((e && e.message) || e).slice(0, 120)}). Tap Create invoice.`, 'website form').catch(() => {});
    return null;
  }
}

export function shortDay(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso || '';
  return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()} ${d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}`;
}

function quoteTable(q) {
  return `<table><tbody>${q.lines.map((l) => `<tr><td>${esc(l.description)}</td><td>${F.money(Math.round(l.qty * l.unit_cents))}</td></tr>`).join('')}
    <tr><td><strong>Total</strong></td><td><strong>${F.money(q.total)}</strong></td></tr>
    <tr><td><strong>Due now to confirm</strong> (damage deposit + half the rental)</td><td><strong>${F.money(q.dueNow)}</strong></td></tr>
    <tr><td>Paid at pickup</td><td>${F.money(q.atPickup)}</td></tr></tbody></table>
    <p class="rq-help">The ${F.money(q.damage)} damage deposit comes back when everything is returned complete.</p>`;
}

// /request/received?k=<receipt>: first name and what happens next. Nothing private on it.
export async function handleReceived({ request, env }) {
  const url = new URL(request.url);
  const k = url.searchParams.get('k') || '';
  const row = /^[a-f0-9]{32}$/.test(k) && env.DB ? await env.DB.prepare('SELECT request_key, name, services, answers FROM requests WHERE receipt_id = ?1').bind(k).first() : null;
  const settings = env.DB ? await getSettings(env.DB) : {};
  let body;
  if (!row) {
    body = '<section class="rq-section"><h2>Thank you!</h2><p>Your request came through. We usually reply within a day. Questions? Call or text <a href="tel:+19013551518">901-355-1518</a>.</p></section>';
  } else {
    const services = JSON.parse(row.services || '[]');
    const first = String(row.name || '').trim().split(/\s+/)[0] || 'there';
    // A held-back request got no confirmation email and no hold (submit): the page never claims either.
    const heldBack = await env.DB.prepare('SELECT 1 AS y FROM request_events WHERE request_key = ?1 AND substr(what, 1, length(?2)) = ?2').bind(row.request_key, HELD_BACK).first();
    const parts = [`<h2>Thank you, ${esc(first)}!</h2><p data-copy>Your request came through. ${heldBack ? 'Valerie will text you shortly.' : 'We sent a copy to your email.'}</p>`];
    if (services.includes('rentals')) {
      const hold = await env.DB.prepare('SELECT * FROM holds WHERE request_key = ?1').bind(row.request_key).first();
      const answers = JSON.parse(row.answers || '[]');
      const get = (re) => (answers.find((a) => re.test(a.label)) || {}).value || '';
      const slugs = F.rentalItems(PRICE_TABLE).filter((i) => get(/^which games/i).split(/,\s*/).includes(i.choice)).map((i) => i.slug);
      const q = F.rentalQuote(slugs, /weekend/i.test(get(/^how long/i)) ? 'weekend' : 'day', PRICE_TABLE, games.holdPercent);
      const ends = hold && hold.until ? chicagoWords(Date.parse(`${hold.until.replace(' ', 'T')}Z`)) : '';
      parts.push(`<div class="rq-idnote" data-hold>${hold && hold.state === 'held' ? (ends ? `Your games are held until <strong>${esc(ends)}</strong>.` : 'Your games are held while Valerie confirms with you.') : 'Your games request is in. Valerie checks the dates and texts you.'}</div>`);
      if (q) parts.push(`<div class="rq-total">${quoteTable(q)}</div>`);
      const pay = [settings.zelle ? `Zelle: <strong>${esc(settings.zelle)}</strong>` : '', settings.cashapp ? `Cash App: <strong>$${esc(String(settings.cashapp).replace(/^\$/, ''))}</strong>` : ''].filter(Boolean).join(' · ');
      parts.push(`<h3>How to pay</h3><ol><li>Valerie sends your invoice by email or text.</li><li>Pay the amount due now by Zelle or Cash App${pay ? ` (${pay})` : ''}, with your invoice number in the note${ends ? `, before ${esc(ends)}` : ''}.</li><li>Your games are booked. Text or call <a href="tel:+19013551518">901-355-1518</a> to set your pickup time at ${esc(PRICE_TABLE.pickupPlace)}.</li></ol>`);
    }
    if (services.some((s) => s !== 'rentals')) parts.push('<h3>What happens next</h3><ol><li>We text you a quote, usually within a day.</li><li>Your date is held once the 50% deposit is paid by Zelle or Cash App.</li><li>The rest is due when we arrive to set up.</li></ol>');
    parts.push('<p>Questions? Text <a href="sms:+19013551518">901-355-1518</a>.</p>');
    body = `<section class="rq-section" data-received>${parts.join('')}</section>`;
  }
  const html = withBlock(await shell(env, url), `<!--request-form--><div class="rq-wrap">${body}</div><style>.rq-wrap{max-width:680px;margin:0 auto}.rq-section{background:#fff;border:1px solid #e8dfd4;border-radius:16px;padding:18px 16px;margin:16px 0}.rq-idnote{background:#faf7f2;border-left:4px solid #b85f40;padding:10px 12px;border-radius:8px}.rq-total table{width:100%;border-collapse:collapse}.rq-total td{padding:4px 0}.rq-total td+td{text-align:right}.rq-help{color:#5f5148}</style><!--/request-form-->`)
    .replace(/<meta name="robots"[^>]*>/, '<meta name="robots" content="noindex, nofollow">');
  return new Response(html, { headers: { ...HEADERS, 'X-Robots-Tag': 'noindex, nofollow' } });
}

// GET /api/request/availability?pickup=&duration=&games=a,b -> games left for those dates and
// the exact total. Counts only: no names, no bookings.
export async function handleAvailability({ request, env }) {
  const url = new URL(request.url);
  await useInventory(env);
  const duration = url.searchParams.get('duration') === 'weekend' ? 'weekend' : 'day';
  // The event date and the two choices (owner, 19 Oct 2026) give the pickup and return days.
  const span = C.rentalSpan({ event: url.searchParams.get('event') || '', length: duration, pickup: url.searchParams.get('pickup_when') || '', ret: url.searchParams.get('return_when') || '' });
  const pickup = span.error ? '' : span.pickup;
  const slugs = String(url.searchParams.get('games') || '').split(',').filter((s) => /^[a-z0-9-]{1,60}$/.test(s));
  const today = F.chicagoToday();
  const out = { ok: true, left: {}, html: '' };
  if (C.isISODate(pickup) && pickup >= today && env.DB) {
    await expireHolds(env.DB);
    const ret = span.ret;
    out.returnDate = ret;
    // Public items only: an admin-only item (the Projector) never reaches this public answer.
    const left = await availabilityFor(env.DB, pickup, ret, today);
    out.left = Object.fromEntries(Object.entries(left).filter(([slug]) => PRICE_TABLE.items.some((i) => i.slug === slug)));
  }
  const q = F.rentalQuote(slugs, duration, PRICE_TABLE, games.holdPercent);
  if (q) out.html = `<h3>Your total</h3>${quoteTable(q)}${out.returnDate ? `<p class="rq-help">Pickup ${esc(shortDay(pickup))}, return ${esc(shortDay(out.returnDate))}, at ${esc(PRICE_TABLE.pickupPlace)}.</p>` : ''}`;
  return Response.json(out, { headers: { 'Cache-Control': 'no-store' } });
}

// /r/<code>: a friend's referral link. Sets a first-party cookie the form reads, then goes home.
export async function handleReferral({ params }) {
  const code = String((params && params.code) || '').toLowerCase();
  const headers = { Location: '/', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  if (CODE_RE.test(code)) headers['Set-Cookie'] = `${REF_COOKIE}=${code}; Path=/; Max-Age=${90 * 86400}; Secure; SameSite=Lax`;
  return new Response(null, { status: 302, headers });
}
