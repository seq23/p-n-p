// Shared helpers for the /admin invoicing console (docs/admin-console.md).
export const SHEET_ID = '1I2YgweURdLHhg9dKrgWu0Zsyo3eXpF6bj1KEOS2RMDo';
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
export const SHEET_TAB = 'Form Responses 1';
export const FROM_EMAIL = 'hello@porchandparty901.com';
// Which emails to customers send Valerie a copy (Bcc to hello@) - owner, 19 Oct 2026: invoices
// and receipts ONLY. Thank-yous, request confirmations, reminders, hold reminders and every other
// customer message go without a copy (they stay logged on the card). Every send asks this one
// place; scripts/validators/validate_owner_email.mjs pins it.
export const OWNER_COPY_KINDS = Object.freeze(['invoice', 'receipt']);
export const ownerCopy = (kind) => (OWNER_COPY_KINDS.includes(kind) ? { bcc: FROM_EMAIL } : {});
export const SA_EMAIL = 'gsc-bot@gsc-automation-493801.iam.gserviceaccount.com';

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function money(cents) {
  const n = Math.round(Number(cents) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars}.${rest}`;
}

export function toCents(value) {
  const n = Number(String(value == null ? '' : value).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function lineTotal(line) {
  return Math.round((Number(line.qty) || 0) * (Number(line.unit_cents) || 0));
}

export function invoiceTotal(lines) {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0);
}

export function halfDeposit(totalCents) {
  return Math.round(totalCents / 2);
}

// How the customer pays. 'half': a deposit of half the total now, the rest by the due
// date. 'full' ("All now"): the whole total now. 'custom': a typed deposit now, the rest by the
// due date. 'none' ("No deposit", owner-approved 20 Oct 2026): nothing now, all of it by the due
// date. Every row saved before 'none' existed keeps the plan it has (pay_plan is always set).
export const PAY_PLANS = ['half', 'full', 'custom', 'none'];
// One payment only (no deposit step): "Mark paid in full" is the money button.
export const singlePayment = (plan) => plan === 'full' || plan === 'none';

export function payPlanOf(invoice, totalCents) {
  if (PAY_PLANS.includes(invoice.pay_plan)) return invoice.pay_plan;
  if (totalCents > 0 && invoice.deposit_due_cents >= totalCents) return 'full';
  return invoice.deposit_due_cents === halfDeposit(totalCents) ? 'half' : 'custom';
}

// What is asked for right now under a plan; the rest is total minus this.
export function amountDueNow(plan, totalCents, customCents = 0) {
  if (plan === 'full') return totalCents;
  if (plan === 'none') return 0;
  if (plan === 'custom') return Math.max(0, Math.min(totalCents, Math.round(customCents) || 0));
  return halfDeposit(totalCents);
}

// A starting line the auto draft wrote keeps its kind (invoice_lines.auto) only while it is
// exactly as written: the editor posts "<kind>:<sig>" and a line whose fields no longer match
// its sig was changed by hand (ledger.mjs linesFromForm), so a rebuild keeps it.
export const AUTO_KINDS = ['start', 'food', 'takedown', 'rental', 'porch', 'deposit'];
export function lineSig(line) {
  const t = [line.description, Number(line.qty), Math.round(Number(line.unit_cents) || 0), line.note || '', line.refundable ? 1 : 0].join('\u0001');
  let h = 5381;
  for (let i = 0; i < t.length; i += 1) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
export const autoTag = (line) => (line && AUTO_KINDS.includes(line.auto) ? `${line.auto}:${lineSig(line)}` : '');

export function b64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i += 1) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlText(text) {
  return b64url(new TextEncoder().encode(text));
}

export function fromB64urlText(value) {
  const s = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function bytesToB64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a, b) {
  const x = String(a); const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

// Short day for chips and questions: "Sat 25 Oct".
export function shortDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso || '';
  return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()} ${d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}`;
}

export const REQUEST_STATUSES = ['new', 'invoiced', 'deposit_paid', 'scheduled', 'job_done', 'paid', 'void'];

export function todayISO(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

export function prettyDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// A header holds bytes only: a typed "Saved ✓" in the address is percent-encoded here (19 Oct 2026:
// Settings Save, Hold settings and Expense categories answered 500 "Cannot convert argument to a
// ByteString" after saving).
export function redirect(location, headers = {}) {
  const safe = String(location).replace(/[^\x00-\x7F]+/gu, (run) => encodeURIComponent(run));
  return new Response(null, { status: 303, headers: { Location: safe, ...headers } });
}

export function htmlResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });
}

export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const row of results || []) out[row.key] = row.value;
  return out;
}

export async function putSetting(db, key, value) {
  await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, value).run();
}

export const STATUS_LABELS = {
  new: 'New', invoiced: 'Invoiced', deposit_paid: 'Deposit paid', paid: 'Paid', done: 'Job done', job_done: 'Job done', scheduled: 'Scheduled',
  draft: 'Not sent yet', sent: 'Invoiced', void: 'Void',
};

// A $0 line the customer would see as "Free" when nobody meant it: the decor line before
// Valerie sets its price. A line Valerie marks with the note 'free' is free on purpose.
export function needsPrice(line) {
  return lineTotal(line) === 0 && line.note !== 'free';
}
