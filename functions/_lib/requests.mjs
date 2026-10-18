// Requests in D1 (table `requests`, migration 0006): the one store the admin console reads
// (owner, 18 Oct 2026). Two sources:
//   site         the porchandparty901.com/request form (functions/_lib/request-submit.mjs);
//   google_form  the one real Google Form request, imported once with its raw row and its
//                original request_key (scripts/admin/import_form_request.mjs), so everything
//                already linked to that key stays linked. Its ID stays the Drive link.
// Every request comes back in the same shape the cards, invoices, checklist and calendar
// already read (functions/_lib/sheet.mjs rowsToRequests), so nothing downstream branches on
// the source except the ID (private R2 photo vs Drive link).
import { rowsToRequests } from './sheet.mjs';
import { normName, digitsOf } from './calendar.mjs';
import fixture from '../../data/admin/fixture-request.json';

// The four services in the canonical order of scripts/lib/brand.js SERVICES.
export const SERVICE_KEYS = ['porch', 'party', 'grazing', 'rentals'];
export const SERVICE_WORDS = { porch: 'porch', party: 'party & decor', grazing: 'grazing', rentals: 'rentals' };

const TZ = 'America/Chicago';

// "2026-10-18 15:04:05" (UTC, D1 datetime) -> ms of the Memphis wall clock stored as if UTC,
// the same convention the Google Form rows use (sheet.mjs parseTimestamp), so friendlyWhen
// shows Memphis time for both sources.
export function wallClockMs(utc) {
  const d = new Date(`${String(utc).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return 0;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

// Which services an old Google Form request asks for (rentals only with a real game).
function servicesOf(r) {
  const need = String(r.need || '').toLowerCase();
  const out = [];
  if (/porch/.test(need) || /porch/i.test(r.eventType || '')) out.push('porch');
  if (r.wantsDecor && !out.includes('porch')) out.push('party');
  if (/grazing/.test(need) || [...(r.decor || [])].some((x) => /grazing/i.test(x.label) && /^\s*yes/i.test(x.value))) out.push('grazing');
  if (r.wantsRentals) out.push('rentals');
  return SERVICE_KEYS.filter((k) => out.includes(k));
}

// One D1 row -> the request object the console reads.
export function fromRow(row) {
  const common = {
    source: row.source, services: parse(row.services, []), agreedAt: row.agreed_at || '', rulesVersion: row.rules_version || '',
    agreedName: row.agreed_name || '', referredBy: row.referred_by || '', referralCode: row.referral_code || '', robotCheck: row.robot_check || '',
    idObject: row.id_object || '', idDeletedAt: row.id_deleted_at || '', isTest: Boolean(row.is_test), submittedAt: row.submitted_at,
    takedownPlan: row.takedown_plan || '',
  };
  if (row.source === 'google_form') {
    const raw = parse(row.raw_row, null);
    const [r] = raw ? rowsToRequests([raw.headers, raw.row]) : [];
    if (!r) return null;
    const out = { ...r, ...common, key: row.request_key };
    if (!common.services.length) out.services = servicesOf(out);
    if (row.id_deleted_at) out.idFile = '';
    return out;
  }
  const answers = parse(row.answers, []);
  const get = (re) => { const a = answers.find((x) => re.test(x.label)); return a ? a.value : ''; };
  const group = (g) => answers.filter((x) => x.group === g && x.value).map((x) => ({ label: x.label, value: x.value }));
  const services = common.services;
  return {
    ...common,
    key: row.request_key,
    timestamp: row.submitted_at,
    sortTime: wallClockMs(row.submitted_at),
    email: row.email, name: row.name, dob: row.dob, phone: row.phone, social1: row.social, social2: '',
    idFile: '', heard: row.heard,
    need: services.map((k) => SERVICE_WORDS[k]).join(' + '),
    gamesAnswer: services.includes('rentals') ? get(/^which games/i) : '',
    durationAnswer: services.includes('rentals') ? get(/^how long/i) : '',
    eventType: get(/event type|season or occasion/i),
    takedownAnswer: get(/take (it )?down/i),
    wantsRentals: services.includes('rentals'),
    wantsDecor: services.some((k) => k !== 'rentals'),
    rentals: group('rentals'), decor: group('decor'), other: group('other'),
  };
}

export async function loadRequestsFromDb(db) {
  const { results } = await db.prepare('SELECT * FROM requests ORDER BY submitted_at DESC').all();
  const out = (results || []).map(fromRow).filter(Boolean);
  out.sort((a, b) => b.sortTime - a.sortTime);
  return out;
}

// The D1 row for one Google Form row (the import). Key is the same `${timestamp}|${email}` the
// sheet reader always used. Returns null for a row the reader would skip.
export function importRowFor(headers, row) {
  const [r] = rowsToRequests([headers, row]);
  if (!r) return null;
  const ms = r.sortTime || 0;
  const submitted = ms ? new Date(ms).toISOString().slice(0, 19).replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' ');
  return {
    request_key: r.key, source: 'google_form', submitted_at: submitted, services: JSON.stringify(servicesOf(r)),
    name: r.name, email: r.email, phone: r.phone, dob: r.dob, social: [r.social1, r.social2].filter(Boolean).join(' '), heard: r.heard,
    raw_row: JSON.stringify({ headers, row }), id_file: r.idFile || '', name_norm: normName(r.name), phone_digits: digitsOf(r.phone),
  };
}

const IMPORT_COLS = ['request_key', 'source', 'submitted_at', 'services', 'name', 'email', 'phone', 'dob', 'social', 'heard', 'raw_row', 'id_file', 'name_norm', 'phone_digits'];
export function importStatement(db, rec) {
  return db.prepare(`INSERT OR IGNORE INTO requests (${IMPORT_COLS.join(', ')}) VALUES (${IMPORT_COLS.map((_, i) => `?${i + 1}`).join(', ')})`)
    .bind(...IMPORT_COLS.map((c) => rec[c]));
}

// Local test copies only (PNP_SHEET_FIXTURE=1): the fixture's fake Google Form rows become D1
// requests the first time anything reads, exactly as the one-time import would write them.
export async function seedFixture(db) {
  const [headers, ...rows] = fixture.values;
  const recs = rows.map((row) => importRowFor(headers, row)).filter(Boolean);
  if (recs.length) await db.batch(recs.map((rec) => importStatement(db, rec)));
}

export async function loadRequests(env) {
  if (env.PNP_SHEET_FIXTURE === '1') await seedFixture(env.DB);
  return loadRequestsFromDb(env.DB);
}

export async function logEvent(db, key, what, who = '') {
  await db.prepare('INSERT INTO request_events (request_key, who, what) VALUES (?1, ?2, ?3)').bind(key, who, what).run();
}

export async function eventsFor(db, key) {
  const { results } = await db.prepare('SELECT * FROM request_events WHERE request_key = ?1 ORDER BY id').bind(key).all();
  return results || [];
}

// ---- Weekly counts (Requests screen) and the month count (Money) -----------------------

// Monday (Memphis) of the week holding the Memphis date `iso`.
export function mondayOf(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
const plusDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const memphisDay = (r) => new Date(r.sortTime).toISOString().slice(0, 10);

// This week (Mon–Sun, America/Chicago) and last week: counts by service, and the requests.
export function weekCounts(requests, today) {
  const mon = mondayOf(today);
  const lastMon = plusDays(mon, -7);
  const real = requests.filter((r) => !r.isTest && r.sortTime);
  const inWeek = (start) => real.filter((r) => { const d = memphisDay(r); return d >= start && d <= plusDays(start, 6); });
  const tally = (list) => {
    const by = {};
    for (const k of SERVICE_KEYS) by[k] = 0;
    for (const r of list) for (const k of (r.services && r.services.length ? r.services : [])) by[k] += 1;
    return by;
  };
  const thisWeek = inWeek(mon); const lastWeek = inWeek(lastMon);
  return { start: mon, end: plusDays(mon, 6), thisWeek, lastWeek, byService: tally(thisWeek), lastByService: tally(lastWeek) };
}

export function monthCount(requests, month) {
  return requests.filter((r) => !r.isTest && r.sortTime && memphisDay(r).slice(0, 7) === month).length;
}

// "IDs ready to delete": an ID still on file, the request paid in full, and for a rental,
// the games back. Nothing ever deletes an ID by itself; this is a list for her to act on.
export function idOnFile(r) {
  return !r.idDeletedAt && Boolean(r.idObject || r.idFile);
}
