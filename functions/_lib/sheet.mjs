// Live read of the request form's Google Sheet as the gsc-bot service account
// (JWT signed here with WebCrypto RS256, scope spreadsheets.readonly). Cached 60 s.
import { SHEET_ID, SHEET_TAB, b64url, b64urlText } from './util.mjs';
import fixture from '../../data/admin/fixture-request.json';
import { PRICE_TABLE } from './prices.mjs';
import { realGamesAnswer, isNoAnswer } from './pricing.mjs';

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.metadata.readonly';
const tokenCache = {};
// Read/write scope for the Bookings / Monthly totals / Expenses / Year tabs (sheets-sync.mjs).
export const WRITE_SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

function pemToBytes(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function accessToken(env, scopes = SCOPES) {
  const now = Math.floor(Date.now() / 1000);
  const hit = tokenCache[scopes];
  if (hit && hit.exp - 60 > now) return hit.token;
  if (!env.GOOGLE_SA_JSON) throw new SheetError('no-key', 'The site holds no Google key (GOOGLE_SA_JSON is not set).');
  const sa = JSON.parse(env.GOOGLE_SA_JSON);
  const unsigned = `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlText(JSON.stringify({
    iss: sa.client_email, scope: scopes, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToBytes(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new SheetError('token', `Google refused the service-account sign-in (${res.status}).`);
  tokenCache[scopes] = { token: json.access_token, exp: now + (json.expires_in || 3600) };
  return json.access_token;
}

export class SheetError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

async function cached(key, ttl, produce) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const url = new URL(`https://pnp-admin-cache.internal/${key}`);
  if (cache) {
    const hit = await cache.match(url);
    if (hit) return hit.json();
  }
  const value = await produce();
  if (cache) await cache.put(url, new Response(JSON.stringify(value), { headers: { 'Cache-Control': `max-age=${ttl}`, 'Content-Type': 'application/json' } }));
  return value;
}

export async function readSheetValues(env, { fresh = false } = {}) {
  if (env.PNP_SHEET_FIXTURE === '1') return fixture.values;
  const produce = async () => {
    const token = await accessToken(env);
    const range = encodeURIComponent(`'${SHEET_TAB}'`);
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueRenderOption=FORMATTED_VALUE`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 403 || res.status === 404) {
      throw new SheetError('not-shared', `The responses sheet is not shared with the service account yet (Google answered ${res.status}).`, res.status);
    }
    if (!res.ok) throw new SheetError('read', `Google Sheets answered ${res.status}.`, res.status);
    const json = await res.json();
    return json.values || [];
  };
  if (fresh) return produce();
  return cached('sheet-values-v1', 60, produce);
}

// Folder that holds the uploaded IDs: the parent of the first ID file, when the
// service account can see it. Cached for an hour; null when it cannot.
export async function idFolderId(env, fileId) {
  if (!fileId || env.PNP_SHEET_FIXTURE === '1') return null;
  try {
    return await cached(`id-folder-v1-${fileId}`, 3600, async () => {
      const token = await accessToken(env);
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents&supportsAllDrives=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const json = await res.json();
      return (json.parents && json.parents[0]) || null;
    });
  } catch {
    return null;
  }
}

const FIELDS = [
  ['timestamp', /^timestamp/i],
  ['email', /e-?mail/i],
  ['name', /full name|^name\b|your name/i],
  ['dob', /date of birth|birth ?date|birthday/i],
  ['phone', /phone|mobile|cell/i],
  ['social2', /second social|another social|other social/i],
  ['social1', /social/i],
  ['idFile', /photo id|government|\bid\b|identification/i],
  ['heard', /hear about/i],
  ['need', /what do you need/i],
  ['games', /which games/i],
  ['duration', /how long/i],
  ['eventType', /event type|type of event/i],
  ['takedown', /take (it )?down|takedown/i],
  ['confirm', /please confirm|i confirm|agree/i],
];

export function mapHeaders(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const text = String(h || '').trim();
    for (const [field, re] of FIELDS) {
      if (map[field] !== undefined) continue;
      if (field === 'takedown' && /date|when/i.test(text)) continue;
      if (field === 'email' && /social/i.test(text)) continue;
      if (re.test(text)) { map[field] = i; break; }
    }
  });
  return map;
}

export function driveFileId(url) {
  const m = String(url || '').match(/[?&]id=([A-Za-z0-9_-]{10,})|\/d\/([A-Za-z0-9_-]{10,})/);
  return m ? (m[1] || m[2]) : null;
}

// Google Forms writes the sheet's local wall-clock time ("10/14/2026 9:15:02"); keep it as
// written (stored as if UTC) so the page shows the same time the sheet does, on any server.
function parseTimestamp(ts) {
  const m = String(ts || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +(m[6] || 0));
  const t = Date.parse(ts);
  return Number.isNaN(t) ? 0 : t;
}

export function rowsToRequests(values) {
  if (!values || !values.length) return [];
  const headers = values[0].map((h) => String(h || '').trim());
  const map = mapHeaders(headers);
  const known = new Set(Object.values(map));
  const rentalsStart = map.games !== undefined ? map.games : -1;
  const decorStart = map.eventType !== undefined ? map.eventType : -1;
  const end = map.confirm !== undefined ? map.confirm : headers.length;
  const out = [];
  for (const row of values.slice(1)) {
    const get = (f) => (map[f] === undefined ? '' : String(row[map[f]] || '').trim());
    const timestamp = get('timestamp');
    const email = get('email');
    if (!timestamp && !email) continue;
    const rentals = []; const decor = []; const other = [];
    headers.forEach((h, i) => {
      const value = String(row[i] || '').trim();
      // "n/a", "none", "-" and blanks are not answers: they never show on a card.
      if (isNoAnswer(value) || (known.has(i) && !['games', 'duration', 'eventType', 'takedown'].some((f) => map[f] === i))) return;
      const item = { label: h, value };
      if (decorStart >= 0 && i >= decorStart && i < end) decor.push(item);
      else if (rentalsStart >= 0 && i >= rentalsStart && i < (decorStart > rentalsStart ? decorStart : end)) rentals.push(item);
      else if (i !== map.confirm) other.push(item);
    });
    const need = get('need');
    const gamesAnswer = realGamesAnswer(get('games'), PRICE_TABLE);
    out.push({
      key: `${timestamp}|${email}`,
      timestamp,
      sortTime: parseTimestamp(timestamp),
      email,
      name: get('name'),
      dob: get('dob'),
      phone: get('phone'),
      social1: get('social1'),
      social2: get('social2'),
      idFile: get('idFile'),
      heard: get('heard'),
      need,
      gamesAnswer,
      // How long? only means something when real games were picked (the old form defaulted it).
      durationAnswer: gamesAnswer ? get('duration') : '',
      eventType: get('eventType'),
      takedownAnswer: get('takedown'),
      // A rental only when a real game or bundle is named (pricing.mjs realGamesAnswer).
      wantsRentals: Boolean(gamesAnswer),
      wantsDecor: /decor|porch|event|setup|grazing/i.test(need) || Boolean(get('eventType')),
      rentals, decor, other,
    });
  }
  out.sort((a, b) => b.sortTime - a.sortTime);
  return out;
}

export async function loadRequests(env, opts) {
  return rowsToRequests(await readSheetValues(env, opts));
}
