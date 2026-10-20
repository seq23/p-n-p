// porchandparty901.com/request: the page (GET), the submission (POST), the "request received"
// page, the rentals availability/total API and the /r/<code> referral link. Public routes:
// functions/request/index.js, functions/request/received.js, functions/api/request/availability.js,
// functions/r/[code].js. Spec: docs/admin-console.md "Site request form".
//
// $0 spam protection: a honeypot field, a server-signed render time (too fast = a bot), Cloudflare
// Turnstile (free) when its keys are set, and a per-IP rate limit. A visitor without JavaScript
// cannot run Turnstile, so a submission with no Turnstile token is still taken (honeypot + timing
// + a tighter rate limit) and the admin card says "sent without the robot check".
import offers from '../../data/offers/services.json';
import games from '../../data/rentals/games.json';
import { useInventory } from './inventory.mjs';
import { PRICE_TABLE } from './prices.mjs';
import * as F from './request-form.mjs';
import * as C from './calendar.mjs';
import { getSettings, esc, sha256Hex, b64url, safeEqual } from './util.mjs';
import { availabilityFor } from './availability.mjs';
import { cleanImage } from './image-clean.mjs';
import { createHold, expireHolds, sqlTime } from './holds.mjs';
import { logEvent, fromRow } from './requests.mjs';
import { autoBookTakedown } from './takedown.mjs';
import { sendMessage } from './messages.mjs';
import { sendNewRequestEmail } from './owner-new-request.mjs';
import { createDraftInvoice } from './admin.mjs';
import { syncSafely } from './admin-money.mjs';

const HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff' };
const MIN_SECONDS = 3;
const MAX_AGE_SECONDS = 2 * 86400;
export const RATE = { perHour: 5, perHourNoJs: 3 };
const REF_COOKIE = 'pnp_ref';
const CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const formKey = (env) => env.PNP_ADMIN_SESSION_KEY || env.PNP_FORM_KEY || '';
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}
export async function signTs(env, now = Date.now()) {
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

function fieldsOf(form) {
  const out = {};
  for (const [k, v] of form.entries()) {
    if (typeof v !== 'string') continue;
    if (k === 'multi' || k === 'games' || k === 'porch_addons') (out[k] = out[k] || []).push(v);
    else out[k] = v;
  }
  return out;
}

async function turnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: true, used: false };
  if (!token) return { ok: true, used: false };
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }) });
    const j = await res.json();
    return { ok: Boolean(j.success), used: true };
  } catch { return { ok: false, used: true }; }
}

async function rateLimited(env, ipHash, limit) {
  const since = Math.floor(Date.now() / 1000) - 3600;
  await env.DB.prepare('DELETE FROM form_attempts WHERE ts < ?1').bind(since - 86400).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM form_attempts WHERE ip_hash = ?1 AND ts >= ?2').bind(ipHash, since).first();
  return (row ? row.n : 0) >= limit;
}

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
  const token = String(fields['cf-turnstile-response'] || '');
  const robot = await turnstile(env, token, ip);
  const ts = await checkTs(env, fields.ts);
  const values = { ...fields };
  delete values.ts; delete values['cf-turnstile-response'];
  if (!robot.ok) return formPage(env, url, { values, errors: { agree: 'The robot check did not pass. Please tick the box again and resend.' }, status: 400 });
  if (ts !== 'ok') return formPage(env, url, { values, errors: { agree: ts === 'old' ? 'This page was open a long time. Please check your answers and send again.' : 'Please check your answers and send again.' }, status: 400 });
  if (await rateLimited(env, ipHash, robot.used ? RATE.perHour : RATE.perHourNoJs)) {
    return new Response('<!doctype html><meta charset="utf-8"><title>Please wait</title><p style="font:18px/1.5 sans-serif;max-width:560px;margin:40px auto;padding:0 16px">We got several requests from here in the last hour. Please call or text <a href="tel:+19013551518">901-355-1518</a> and we will help you right away.</p>', { status: 429, headers: HEADERS });
  }
  await env.DB.prepare('INSERT INTO form_attempts (ip_hash, ts) VALUES (?1, ?2)').bind(ipHash, Math.floor(Date.now() / 1000)).run();

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

  // ---- Store it -------------------------------------------------------------------------
  const settings = await getSettings(env.DB);
  const now = Date.now();
  const submitted = sqlTime(now);
  const key = `site|${submitted}|${clean.email.toLowerCase()}`;
  const ext = image.type === 'image/png' ? 'png' : 'jpg';
  const idObject = `ids/${randomId()}.${ext}`;
  await env.IDS.put(idObject, image.bytes, { httpMetadata: { contentType: image.type } });
  const refIn = [fields.ref, cookie(request, REF_COOKIE)].find((c) => CODE_RE.test(String(c || ''))) || '';
  let referredBy = null;
  if (refIn) { const who = await env.DB.prepare('SELECT request_key FROM requests WHERE referral_code = ?1').bind(refIn).first(); if (who) referredBy = refIn; }
  const receipt = randomId();
  const code = randomCode();
  const extra = [];
  // The pickup and return days are answers of their own (request-form.mjs, from the event date).
  await env.DB.prepare(`INSERT INTO requests (request_key, source, submitted_at, services, name, email, phone, dob, social, heard, answers, id_object, id_type, id_size,
      agreed_at, rules_version, agreed_name, agreed_ip, takedown_plan, referral_code, referred_by, receipt_id, robot_check, name_norm, phone_digits)
    VALUES (?1, 'site', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?2, ?14, ?4, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)`)
    .bind(key, submitted, JSON.stringify(services), clean.name, clean.email, clean.phone, clean.dob, clean.social || '', clean.heard || '',
      JSON.stringify([...answers, ...extra]), idObject, image.type, image.bytes.length, F.RULES_VERSION, ip, clean.takedown_plan || null, code, referredBy, receipt,
      robot.used ? 'turnstile' : 'no-js', C.normName(clean.name), C.digitsOf(clean.phone)).run();
  await logEvent(env.DB, key, `Agreed to the Rules & Responsibilities (version ${F.RULES_VERSION}) and the Terms & Conditions, as "${clean.name}"`, 'website form');
  // A takedown date on the request books the takedown at once (takedown.mjs autoTakedownRow:
  // porch/party, "yes", a real date, never a duplicate). "Not sure" / "No" book nothing.
  const stored = await env.DB.prepare('SELECT * FROM requests WHERE request_key = ?1').bind(key).first();
  if (stored) await autoBookTakedown(env.DB, fromRow(stored), { who: 'website form' });

  let rentals = null;
  if (quote) {
    const hold = await createHold(env.DB, key, { now, settings });
    const items = quote.picked.map((i) => i.name).join(', ');
    const base = { request_key: key, invoice_id: null, time: null, customer_name: clean.name, phone: clean.phone, email: clean.email, place: PRICE_TABLE.pickupPlace };
    await C.upsertBookings(env.DB, [{ ...base, kind: 'rental_pickup', date: clean.pickup_date, items }, { ...base, kind: 'rental_return', date: clean.return_date, items }]);
    const invoiceId = await createDraftInvoice(env, { key, name: clean.name, email: clean.email, phone: clean.phone, lines: quote.lines, depositCents: quote.dueNow, dueDate: clean.pickup_date, notes: '' });
    await env.DB.prepare('UPDATE bookings SET invoice_id = ?1 WHERE request_key = ?2').bind(invoiceId, key).run();
    rentals = { items, pickupISO: clean.pickup_date, returnISO: clean.return_date,
      holdEnds: hold.until ? chicagoWords(Date.parse(`${hold.until.replace(' ', 'T')}Z`)) : 'Valerie confirms with you', quote };
  }
  const ctx = {
    name: clean.name, email: clean.email, phone: clean.phone, services,
    rentals: rentals ? { items: rentals.items, pickup: shortDay(rentals.pickupISO), returnDate: shortDay(rentals.returnISO), holdEnds: rentals.holdEnds,
      total: F.money(rentals.quote.total), damage: F.money(rentals.quote.damage), dueNow: F.money(rentals.quote.dueNow), atPickup: F.money(rentals.quote.atPickup) } : null,
    pay: { zelle: settings.zelle || '', cashapp: settings.cashapp || '' },
  };
  later(sendMessage(env, 'email', 'requestReceived', ctx).then((r) => (r.ok ? logEvent(env.DB, key, 'Confirmation email sent', 'website form') : logEvent(env.DB, key, `Confirmation email did not go out (${r.error})`, 'website form'))));
  // Valerie's own "New request" email with every answer (owner, 19 Oct 2026). Once per request,
  // website requests only; a failure is logged on the card and never blocks the submission.
  later(sendNewRequestEmail(env, key, { log: (what) => logEvent(env.DB, key, what, 'website form') }));
  later(syncSafely(env));
  await Promise.all(pending);
  return new Response(null, { status: 303, headers: { Location: `/request/received?k=${receipt}`, 'Cache-Control': 'no-store' } });
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
    const parts = [`<h2>Thank you, ${esc(first)}!</h2><p>Your request came through. We sent a copy to your email.</p>`];
    if (services.includes('rentals')) {
      const hold = await env.DB.prepare('SELECT * FROM holds WHERE request_key = ?1').bind(row.request_key).first();
      const answers = JSON.parse(row.answers || '[]');
      const get = (re) => (answers.find((a) => re.test(a.label)) || {}).value || '';
      const slugs = F.rentalItems(PRICE_TABLE).filter((i) => get(/^which games/i).split(/,\s*/).includes(i.choice)).map((i) => i.slug);
      const q = F.rentalQuote(slugs, /weekend/i.test(get(/^how long/i)) ? 'weekend' : 'day', PRICE_TABLE, games.holdPercent);
      const ends = hold && hold.until ? chicagoWords(Date.parse(`${hold.until.replace(' ', 'T')}Z`)) : '';
      parts.push(`<div class="rq-idnote" data-hold>${hold && hold.state === 'held' ? (ends ? `Your games are held until <strong>${esc(ends)}</strong>.` : 'Your games are held while Valerie confirms with you.') : 'Your games request is in.'}</div>`);
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
