// One shared password for the /admin console. The password is the Pages secret
// PNP_ADMIN_PASSWORD until Valerie changes it in Settings; then a salted SHA-256
// in D1 (settings.password_hash) overrides the secret. Sessions are an HMAC-signed
// cookie (key: PNP_ADMIN_SESSION_KEY) that also carries a fingerprint of the
// current password, so changing the password signs every device out.
import { b64url, safeEqual, sha256Hex } from './util.mjs';

export const COOKIE = 'pnp_admin';
const MAX_AGE = 30 * 86400;
export const LOGIN_LIMIT = 10;
export const LOGIN_WINDOW_SECONDS = 3600;

async function storedHash(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'password_hash'").first();
  return row ? row.value : null;
}

async function fingerprint(env) {
  const stored = await storedHash(env.DB);
  if (stored) return (await sha256Hex(`db:${stored}`)).slice(0, 16);
  if (env.PNP_ADMIN_PASSWORD) return (await sha256Hex(`env:${env.PNP_ADMIN_PASSWORD}`)).slice(0, 16);
  return null;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

export function loginConfigured(env) {
  return Boolean(env.PNP_ADMIN_SESSION_KEY) && Boolean(env.DB);
}

export async function checkPassword(env, password) {
  const stored = await storedHash(env.DB);
  if (stored) {
    const [, salt, hex] = stored.split('$');
    return safeEqual(await sha256Hex(`${salt}:${password}`), hex);
  }
  if (!env.PNP_ADMIN_PASSWORD) return false;
  return safeEqual(await sha256Hex(`x:${password}`), await sha256Hex(`x:${env.PNP_ADMIN_PASSWORD}`));
}

export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = [...saltBytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256$${salt}$${await sha256Hex(`${salt}:${password}`)}`;
}

export async function issueCookie(env) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const payload = `${exp}.${await fingerprint(env)}`;
  const value = `${payload}.${await hmac(env.PNP_ADMIN_SESSION_KEY, payload)}`;
  return `${COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

export async function isAuthed(request, env) {
  if (!loginConfigured(env)) return false;
  const value = readCookie(request);
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [exp, fp, sig] = parts;
  if (!(Number(exp) > Date.now() / 1000)) return false;
  const current = await fingerprint(env);
  if (!current || !safeEqual(fp, current)) return false;
  return safeEqual(sig, await hmac(env.PNP_ADMIN_SESSION_KEY, `${exp}.${fp}`));
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

// Counts every attempt from this IP in the last hour; the 11th is refused.
export async function rateLimited(env, ip) {
  const since = Math.floor(Date.now() / 1000) - LOGIN_WINDOW_SECONDS;
  await env.DB.prepare('DELETE FROM login_attempts WHERE ts < ?1').bind(since).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ?1 AND ts >= ?2').bind(ip, since).first();
  return (row ? row.n : 0) >= LOGIN_LIMIT;
}

export async function recordAttempt(env, ip) {
  await env.DB.prepare('INSERT INTO login_attempts (ip, ts) VALUES (?1, ?2)').bind(ip, Math.floor(Date.now() / 1000)).run();
}
