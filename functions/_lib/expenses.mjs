// Expenses for taxes (docs/admin-console.md): a receipt photo or PDF goes into the private R2
// bucket (binding RECEIPTS, bucket pnp-receipts, never public), Cloudflare Workers AI reads it
// (binding AI, $0: capped per day inside the free allocation; never any other AI service), and
// the result lands as "Needs checking" with every field editable. Nothing is ever saved by the
// AI alone. When the AI is missing, fails, or the day's cap is used up, the form opens empty.
import { chicagoDate } from './reminders.mjs';
import { DEFAULT_EXPENSE_CATEGORIES } from './money.mjs';

export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const AI_DAILY_CAP = 25;
export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export function categoriesFrom(settings) {
  try {
    const list = JSON.parse(settings.expense_categories || 'null');
    if (Array.isArray(list) && list.length) return list.map((x) => String(x).trim()).filter(Boolean).slice(0, 30);
  } catch { /* fall through */ }
  return DEFAULT_EXPENSE_CATEGORIES;
}

const PROMPT = (cats) => `You read a store receipt for a small party-decor business. Reply with ONLY one JSON object, no other words:
{"vendor": string, "date": "YYYY-MM-DD", "total": number, "tax": number, "suggested_category": one of ${JSON.stringify(cats)}, "line_items": [{"name": string, "amount": number}], "confidence": {"vendor": 0-1, "date": 0-1, "total": 0-1, "tax": 0-1}}
Use null for anything you cannot read. total is the amount paid, in dollars.`;

function dollarsToCents(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 1000000 ? Math.round(n * 100) : null;
}

function readDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  return '';
}

// Defensive parse of whatever the model said. Never throws; garbage gives empty fields with
// zero confidence, so the form simply opens for typing.
export function parseExtraction(text, categories = DEFAULT_EXPENSE_CATEGORIES) {
  const raw = String(text || '');
  let obj = null;
  const start = raw.indexOf('{');
  if (start >= 0) {
    for (let end = raw.lastIndexOf('}'); end > start && !obj; end = raw.lastIndexOf('}', end - 1)) {
      try { obj = JSON.parse(raw.slice(start, end + 1)); } catch { obj = null; }
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, vendor: '', date: '', total_cents: 0, tax_cents: 0, category: 'Other', line_items: [], confidence: { vendor: 0, date: 0, total: 0, tax: 0 } };
  const vendor = typeof obj.vendor === 'string' ? obj.vendor.trim().slice(0, 120) : '';
  const date = readDate(obj.date);
  const total = dollarsToCents(obj.total);
  let tax = dollarsToCents(obj.tax);
  if (tax !== null && total !== null && tax > total) tax = null;
  const catRaw = String(obj.suggested_category || '');
  const category = categories.find((c) => c.toLowerCase() === catRaw.toLowerCase()) || 'Other';
  const conf = obj.confidence && typeof obj.confidence === 'object' ? obj.confidence : {};
  const c = (k, valid) => (valid ? Math.max(0, Math.min(1, Number.isFinite(Number(conf[k])) ? Number(conf[k]) : 0.6)) : 0);
  const items = Array.isArray(obj.line_items) ? obj.line_items.slice(0, 50).map((i) => ({ name: String((i && i.name) || '').slice(0, 120), amount_cents: dollarsToCents(i && i.amount) || 0 })) : [];
  return {
    ok: Boolean(vendor || date || total), vendor, date, total_cents: total || 0, tax_cents: tax || 0, category, line_items: items,
    confidence: { vendor: c('vendor', Boolean(vendor)), date: c('date', Boolean(date)), total: c('total', total !== null && total > 0), tax: c('tax', tax !== null) },
  };
}

export const LOW_CONFIDENCE = 0.7;

async function underCap(db) {
  const day = chicagoDate();
  const row = await db.prepare('SELECT count FROM ai_usage WHERE day = ?1').bind(day).first();
  if (row && row.count >= AI_DAILY_CAP) return false;
  await db.prepare('INSERT INTO ai_usage (day, count) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1').bind(day).run();
  return true;
}

async function runModel(ai, input) {
  try { return await ai.run(VISION_MODEL, input); } catch (e) {
    // The Llama 3.2 vision licence is accepted once per account by sending "agree".
    if (/agree|licen[cs]e|terms/i.test(String(e && e.message ? e.message : e))) {
      await ai.run(VISION_MODEL, { prompt: 'agree' });
      return ai.run(VISION_MODEL, input);
    }
    throw e;
  }
}

// -> { extraction, message, raw }. message is the plain words shown when the AI did not help.
export async function extractReceipt(env, { bytes, type, name = 'receipt' }, categories) {
  const empty = { extraction: parseExtraction(''), raw: '' };
  if (!env.AI) return { ...empty, message: 'The receipt reader is not switched on here. Please type the details in.' };
  if (!(await underCap(env.DB))) return { ...empty, message: `The receipt reader has done its ${AI_DAILY_CAP} receipts for today. Please type this one in.` };
  try {
    let out;
    if (type === 'application/pdf') {
      const md = await env.AI.toMarkdown({ name: `${name}.pdf`, blob: new Blob([bytes], { type }) });
      const text = (Array.isArray(md) ? md[0] : md) || {};
      const body = String(text.data || '').slice(0, 12000);
      if (!body.trim()) return { ...empty, message: 'This PDF has no text the reader can see. Please type the details in.' };
      out = await runModel(env.AI, { messages: [{ role: 'user', content: `${PROMPT(categories)}\n\nReceipt text:\n${body}` }], max_tokens: 700 });
    } else {
      // The vision model wants the image as a byte array next to a system + user message; an
      // older input shape (prompt + image) is tried if the account's model version refuses it.
      const image = [...bytes];
      try {
        out = await runModel(env.AI, { messages: [{ role: 'system', content: 'You read receipts and answer only with JSON.' }, { role: 'user', content: PROMPT(categories) }], image, max_tokens: 700 });
      } catch (e) {
        if (!/message|input|image/i.test(String(e && e.message ? e.message : e))) throw e;
        out = await runModel(env.AI, { prompt: PROMPT(categories), image, max_tokens: 700 });
      }
    }
    // Workers AI hands back { response: "text" }, or { response: {...} } when the text was JSON.
    const body = typeof out === 'string' ? out : (out && (out.response !== undefined ? out.response : (out.result !== undefined ? out.result : out)));
    const raw = typeof body === 'string' ? body : JSON.stringify(body || '');
    const extraction = parseExtraction(raw, categories);
    return { extraction, raw: String(raw).slice(0, 8000), message: extraction.ok ? '' : 'The reader could not make out this receipt. Please type the details in.' };
  } catch (e) {
    return { ...empty, message: 'The receipt reader is not working right now. Please type the details in.', raw: String(e && e.message ? e.message : e).slice(0, 500) };
  }
}

export function receiptKey(type, now = new Date()) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[type] || 'bin';
  const rand = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `receipts/${chicagoDate(now).slice(0, 4)}/${rand}.${ext}`;
}

export function parseExpenseForm(form, categories) {
  const cents = (v) => { const n = Number(String(v || '').replace(/[$,\s]/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0; };
  const cat = String(form.get('category') || 'Other');
  return {
    vendor: String(form.get('vendor') || '').trim().slice(0, 120),
    date: readDate(form.get('date')) || chicagoDate(),
    total_cents: cents(form.get('total')),
    tax_cents: cents(form.get('tax')),
    category: categories.includes(cat) ? cat : 'Other',
    payment_method: String(form.get('payment_method') || '').trim().slice(0, 40),
    note: String(form.get('note') || '').trim().slice(0, 2000),
  };
}
