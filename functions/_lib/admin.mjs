// Request router for /admin/* pages. Auth is enforced before this runs, by
// functions/admin/_middleware.js (see guard.mjs).
import {
  SHEET_URL, FROM_EMAIL, esc, redirect, htmlResponse, getSettings, putSetting, toCents, invoiceTotal,
  halfDeposit, PAY_PLANS, payPlanOf, amountDueNow, todayISO, fromB64urlText, bytesToB64, b64ToBytes, needsPrice,
} from './util.mjs';
import { checkPassword, hashPassword, issueCookie, clearCookie, clientIp, rateLimited, recordAttempt, loginConfigured, isAuthed } from './auth.mjs';
import { loadRequests, driveFileId, idFolderId } from './sheet.mjs';
import { PRICE_TABLE, CONTACT } from './prices.mjs';
import { prefillLines } from './pricing.mjs';
import { renderInvoiceEmail, paymentStatus } from './email.mjs';
import * as V from './views.mjs';
import { CHECKLIST_SOURCE } from './checklist-source.mjs';
import { renderPrintPage, prefillFromRequest, renderOnlineSections, checklistState, invoiceFromChecklist, fieldIndex } from './checklist.mjs';

const MAX_PHOTOS = 10;
const PHOTO_MAX_BYTES = 1500000;

const QR_MAX_BYTES = 1024 * 1024;
const REQUEST_STATUS = { sent: 'invoiced', deposit_paid: 'deposit_paid', paid: 'paid', done: 'done' };

function decodeKey(value) {
  try { return fromB64urlText(value); } catch { return ''; }
}

async function nextInvoiceNumber(db, isoDate) {
  const year = isoDate.slice(0, 4);
  const row = await db.prepare("SELECT number FROM invoices WHERE number LIKE ?1 ORDER BY number DESC LIMIT 1").bind(`PNP-${year}-%`).first();
  const n = row ? Number(row.number.split('-')[2]) + 1 : 1;
  return `PNP-${year}-${String(n).padStart(4, '0')}`;
}

async function loadInvoice(db, id) {
  const invoice = await db.prepare('SELECT * FROM invoices WHERE id = ?1').bind(id).first();
  if (!invoice) return null;
  const { results } = await db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id').bind(id).all();
  return { invoice, lines: results || [] };
}

function parseInvoiceForm(form) {
  const desc = form.getAll('line_desc'); const qty = form.getAll('line_qty');
  const price = form.getAll('line_price'); const note = form.getAll('line_note'); const ref = form.getAll('line_refundable');
  const lines = [];
  desc.forEach((d, i) => {
    const description = String(d || '').trim();
    if (!description) return;
    const q = Number(qty[i]);
    lines.push({ description, qty: Number.isFinite(q) ? q : 1, unit_cents: toCents(price[i]), note: String(note[i] || '').trim(), refundable: ref[i] === '1' ? 1 : 0 });
  });
  const total = invoiceTotal(lines);
  const plan = PAY_PLANS.includes(form.get('pay_plan')) ? form.get('pay_plan') : 'half';
  return {
    invoice: {
      customer_name: String(form.get('customer_name') || '').trim(),
      customer_email: String(form.get('customer_email') || '').trim(),
      customer_phone: String(form.get('customer_phone') || '').trim(),
      issue_date: String(form.get('issue_date') || todayISO()),
      due_date: String(form.get('due_date') || todayISO(7)),
      pay_plan: plan,
      deposit_due_cents: amountDueNow(plan, total, toCents(form.get('deposit'))),
      notes: String(form.get('notes') || '').trim(),
    },
    lines,
  };
}

async function saveLines(db, invoiceId, lines) {
  const stmts = [db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?1').bind(invoiceId)];
  lines.forEach((l, i) => stmts.push(db.prepare('INSERT INTO invoice_lines (invoice_id, position, description, qty, unit_cents, note, refundable) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(invoiceId, i, l.description, l.qty, l.unit_cents, l.note, l.refundable)));
  await db.batch(stmts);
}

async function setRequestStatus(db, key, status, invoiceId) {
  if (!key) return;
  await db.prepare(`INSERT INTO request_status (request_key, status, invoice_id, updated_at) VALUES (?1, ?2, ?3, datetime('now'))
    ON CONFLICT(request_key) DO UPDATE SET status = excluded.status, invoice_id = COALESCE(excluded.invoice_id, request_status.invoice_id), updated_at = excluded.updated_at`)
    .bind(key, status, invoiceId ?? null).run();
}

async function savedChecklist(env, key) {
  const row = await env.DB.prepare('SELECT data FROM request_checklist WHERE request_key = ?1').bind(key).first();
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

async function findRequest(env, key) {
  try { return (await loadRequests(env)).find((r) => r.key === key) || null; } catch { return null; }
}

async function checklistPrint(env, url) {
  const rkParam = url.searchParams.get('r');
  if (!rkParam) return htmlResponse(renderPrintPage(CHECKLIST_SOURCE, {}));
  const key = decodeKey(rkParam);
  const request = await findRequest(env, key);
  const values = { ...(request ? prefillFromRequest(CHECKLIST_SOURCE, request) : {}), ...((await savedChecklist(env, key)) || {}) };
  return htmlResponse(renderPrintPage(CHECKLIST_SOURCE, values, { who: request ? request.name : key.split('|')[1] || 'this request', onlineHref: `/admin/checklist/online?r=${rkParam}` }));
}

async function checklistOnline(env, url) {
  const rk = url.searchParams.get('r') || '';
  const key = decodeKey(rk);
  if (!key) return redirect('/admin/');
  const request = (await findRequest(env, key)) || { key, name: key.split('|')[1] || '', rentals: [], decor: [], other: [] };
  const saved = await savedChecklist(env, key);
  const values = saved || prefillFromRequest(CHECKLIST_SOURCE, request);
  const { results } = await env.DB.prepare('SELECT id FROM checklist_photos WHERE request_key = ?1 ORDER BY id').bind(key).all();
  const photos = (results || []).map((p) => ({ id: p.id, url: `/api/admin/checklist/photos/${p.id}` }));
  return htmlResponse(V.checklistOnlinePage({ request, rk, sections: renderOnlineSections(CHECKLIST_SOURCE, values), photos, values, maxPhotos: MAX_PHOTOS }));
}

async function folderUrl(env, settings, requests) {
  if (settings.id_folder_url) return settings.id_folder_url;
  const first = requests.map((r) => driveFileId(r.idFile)).find(Boolean);
  const folder = await idFolderId(env, first);
  if (folder) return `https://drive.google.com/drive/folders/${folder}`;
  // The form's uploads land in a Drive folder named "<form title> (File responses)".
  return 'https://drive.google.com/drive/search?q=%22File%20responses%22%20type%3Afolder';
}

async function dashboard(env, url) {
  const settings = await getSettings(env.DB);
  let requests = []; let sheetError = '';
  try { requests = await loadRequests(env, { fresh: url.searchParams.get('fresh') === '1' }); } catch (e) { sheetError = e.message || String(e); }
  const { results } = await env.DB.prepare('SELECT request_key, status, invoice_id FROM request_status').all();
  const statuses = {};
  for (const row of results || []) statuses[row.request_key] = row;
  const checklists = {};
  const saved = await env.DB.prepare('SELECT request_key, data FROM request_checklist').all();
  for (const row of saved.results || []) { try { checklists[row.request_key] = checklistState(JSON.parse(row.data)); } catch { /* unreadable row: no badge */ } }
  return htmlResponse(V.dashboardPage({ requests, statuses, checklists, folderUrl: await folderUrl(env, settings, requests), sheetError, flash: url.searchParams.get('m') || '', missingPayment: paymentStatus(settings).missing }));
}

async function newInvoice(env, url) {
  const key = url.searchParams.get('r') ? decodeKey(url.searchParams.get('r')) : '';
  let request = null; const warnings = [];
  if (key) {
    try { request = (await loadRequests(env)).find((r) => r.key === key) || null; } catch (e) { warnings.push(e.message); }
    if (!request) warnings.push('That request could not be found, so this invoice starts empty.');
  }
  let lines = request ? prefillLines(request, PRICE_TABLE) : [{ description: '', qty: 1, unit_cents: 0, note: '', refundable: 0 }];
  let depositCents = null; let dueDate = todayISO(7);
  const fromChecklist = key ? invoiceFromChecklist(CHECKLIST_SOURCE, await savedChecklist(env, key)) : null;
  if (request && request.gamesAnswer && lines.some((l) => l.description === 'Game rental (1 day)')) warnings.push(`We could not match the games they picked ("${request.gamesAnswer}"). Check the first line under Change what goes into the total.`);
  if (fromChecklist) {
    if (fromChecklist.lines.length) {
      const damage = lines.find((l) => l.refundable);
      lines = [...fromChecklist.lines, ...(damage ? [damage] : [])];
    }
    if (fromChecklist.depositCents) depositCents = fromChecklist.depositCents;
    if (fromChecklist.dueDate) dueDate = fromChecklist.dueDate;
    warnings.push('Filled in from your checklist (quote and agreed price). Check the lines before sending.');
    const total = invoiceTotal(lines.filter((l) => !l.refundable));
    if (fromChecklist.agreedPriceCents && fromChecklist.agreedPriceCents !== total) warnings.push(`Your checklist says the agreed price is $${(fromChecklist.agreedPriceCents / 100).toFixed(2)}, but these lines add up to $${(total / 100).toFixed(2)} (not counting the deposit they get back).`);
  }
  const invoice = {
    customer_name: request ? request.name : '', customer_email: request ? request.email : '', customer_phone: request ? request.phone : '',
    issue_date: todayISO(), due_date: dueDate, pay_plan: depositCents !== null ? 'custom' : 'half', notes: '',
    deposit_due_cents: amountDueNow(depositCents !== null ? 'custom' : 'half', invoiceTotal(lines), depositCents || 0),
  };
  const pay = paymentStatus(await getSettings(env.DB));
  return htmlResponse(V.invoiceEditorPage({ invoice, lines, request, action: '/admin/invoices', title: request ? `Invoice for ${V.firstName(request.name)}` : 'New invoice', warnings, pay, mode: 'new' }));
}

async function createInvoice(env, request) {
  const form = await request.formData();
  const { invoice, lines } = parseInvoiceForm(form);
  const key = form.get('r') ? decodeKey(form.get('r')) : null;
  let number = await nextInvoiceNumber(env.DB, invoice.issue_date);
  let id = null;
  for (let attempt = 0; attempt < 3 && id === null; attempt += 1) {
    try {
      const row = await env.DB.prepare(`INSERT INTO invoices (number, request_key, customer_name, customer_email, customer_phone, issue_date, due_date, deposit_due_cents, notes, status, pay_plan)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'draft', ?10) RETURNING id`).bind(number, key, invoice.customer_name, invoice.customer_email,
        invoice.customer_phone, invoice.issue_date, invoice.due_date, invoice.deposit_due_cents, invoice.notes, invoice.pay_plan).first();
      id = row.id;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
      number = await nextInvoiceNumber(env.DB, invoice.issue_date);
    }
  }
  await saveLines(env.DB, id, lines);
  if (key) {
    const existing = await env.DB.prepare('SELECT status FROM request_status WHERE request_key = ?1').bind(key).first();
    await setRequestStatus(env.DB, key, existing ? existing.status : 'new', id);
  }
  if (form.get('go') === 'send') return afterSend(id, await deliver(env, id, false));
  return redirect(`/admin/invoices/${id}?m=${encodeURIComponent(afterSaveMessage(form.get('go')))}`);
}

// 'preview' = she tapped "See it before sending": the invoice page shows the email itself.
function afterSaveMessage(go) {
  return go === 'preview' ? 'Saved, not sent. Below is the email the customer gets. Tap Send when it looks right.' : 'Saved. Not sent yet.';
}

async function updateInvoice(env, request, id) {
  const form = await request.formData();
  const { invoice, lines } = parseInvoiceForm(form);
  await env.DB.prepare(`UPDATE invoices SET customer_name=?1, customer_email=?2, customer_phone=?3, issue_date=?4, due_date=?5, deposit_due_cents=?6, notes=?7, pay_plan=?9, updated_at=datetime('now') WHERE id=?8`)
    .bind(invoice.customer_name, invoice.customer_email, invoice.customer_phone, invoice.issue_date, invoice.due_date, invoice.deposit_due_cents, invoice.notes, id, invoice.pay_plan).run();
  await saveLines(env.DB, id, lines);
  if (form.get('go') === 'send') return afterSend(id, await deliver(env, id, false));
  return redirect(`/admin/invoices/${id}?m=${encodeURIComponent(afterSaveMessage(form.get('go')))}`);
}

async function emailParts(env, invoice, lines, settings, forPreview) {
  const qrSrc = settings.qr_png ? (forPreview ? '/api/admin/qr.png' : 'cid:pnp-payment-qr') : null;
  const rendered = renderInvoiceEmail({ invoice, lines, settings, contact: CONTACT, qrSrc });
  const attachments = settings.qr_png && !forPreview ? [{
    contentBase64: settings.qr_png, filename: settings.qr_type === 'image/jpeg' ? 'payment-qr.jpg' : 'payment-qr.png',
    type: settings.qr_type || 'image/png', disposition: 'inline', contentId: 'pnp-payment-qr',
  }] : [];
  return { ...rendered, attachments };
}

async function deliver(env, id, test) {
  const loaded = await loadInvoice(env.DB, id);
  if (!loaded) return { ok: false, error: 'That invoice was not found.' };
  const { invoice, lines } = loaded;
  if (invoice.status === 'void') return { ok: false, error: 'This invoice is cancelled. Bring it back under More before sending.' };
  if (!test && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invoice.customer_email)) return { ok: false, error: "The customer's email address is missing or has a typo. Fix it under Change the invoice, Change what goes into the total, then tap Send again." };
  if (!lines.length) return { ok: false, error: 'This invoice has no lines yet. Add what they are paying for under Change the invoice, Change what goes into the total.' };
  const unpriced = lines.filter(needsPrice);
  if (!test && unpriced.length) return { ok: false, error: `Not sent yet: ${unpriced.map((l) => l.description).join(', ')} has no price. Tap Change the invoice, then Change what goes into the total, type the price, then send.` };
  if (!env.MAILER) return { ok: false, error: 'Email is not connected on this copy of the site, so nothing was sent.' };
  const settings = await getSettings(env.DB);
  const parts = await emailParts(env, invoice, lines, settings, false);
  const payload = {
    to: test ? FROM_EMAIL : invoice.customer_email,
    ...(test ? {} : { bcc: FROM_EMAIL }),
    replyTo: FROM_EMAIL,
    subject: test ? `TEST ${parts.subject}` : parts.subject,
    html: parts.html, text: parts.text, attachments: parts.attachments,
  };
  let out = {};
  try {
    const res = await env.MAILER.fetch('https://pnp-mailer.internal/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    try { out = await res.json(); } catch { out = { ok: false, error: `mailer answered ${res.status}` }; }
    if (!res.ok) out.ok = false;
  } catch (e) { out = { ok: false, error: String(e && e.message ? e.message : e) }; }
  if (!out.ok) return { ok: false, error: `The email did not go out. Nothing was changed; please try again in a minute. (${out.error || 'no answer'})` };
  if (test) return { ok: true, message: `Test copy sent ✓ to ${FROM_EMAIL}` };
  const status = invoice.status === 'draft' ? 'sent' : invoice.status;
  await env.DB.prepare("UPDATE invoices SET status=?1, sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?2").bind(status, id).run();
  if (invoice.request_key && invoice.status === 'draft') await setRequestStatus(env.DB, invoice.request_key, 'invoiced', id);
  return { ok: true, message: `Sent ✓ to ${invoice.customer_email}` };
}

function afterSend(id, result) {
  return redirect(`/admin/invoices/${id}?${result.ok ? 'm' : 'e'}=${encodeURIComponent(result.ok ? result.message : result.error)}`);
}

async function sendInvoice(env, request, id) {
  const form = await request.formData();
  return afterSend(id, await deliver(env, id, form.get('test') === '1'));
}

async function changeStatus(env, request, id) {
  const form = await request.formData();
  const action = String(form.get('action') || '');
  const loaded = await loadInvoice(env.DB, id);
  if (!loaded) return htmlResponse(V.layout('Not found', '<p>No such invoice.</p>'), 404);
  const { invoice } = loaded;
  const next = { deposit_paid: 'deposit_paid', paid: 'paid', done: 'done', void: 'void', unvoid: 'draft' }[action];
  if (!next) return redirect(`/admin/invoices/${id}`);
  await env.DB.prepare("UPDATE invoices SET status=?1, updated_at=datetime('now') WHERE id=?2").bind(next, id).run();
  if (invoice.request_key) {
    if (next === 'void') {
      await env.DB.prepare("UPDATE request_status SET status='new', invoice_id=NULL, updated_at=datetime('now') WHERE request_key=?1 AND invoice_id=?2").bind(invoice.request_key, id).run();
    } else if (next === 'draft') {
      await setRequestStatus(env.DB, invoice.request_key, 'new', id);
    } else {
      await setRequestStatus(env.DB, invoice.request_key, REQUEST_STATUS[next], id);
    }
  }
  const label = { deposit_paid: 'Deposit received ✓', paid: 'Paid in full ✓', done: 'Marked done ✓', void: 'Invoice cancelled.', draft: 'Invoice brought back. It is not sent yet.' }[next];
  return redirect(`/admin/invoices/${id}?m=${encodeURIComponent(label)}`);
}

async function saveSettings(env, request) {
  const form = await request.formData();
  for (const key of ['zelle', 'cashapp', 'business_name', 'business_address', 'id_folder_url']) {
    await putSetting(env.DB, key, String(form.get(key) || '').trim());
  }
  if (form.get('remove_qr') === '1') {
    await env.DB.prepare("DELETE FROM settings WHERE key IN ('qr_png','qr_type')").run();
  }
  const file = form.get('qr');
  if (file && typeof file === 'object' && file.size > 0) {
    if (file.size > QR_MAX_BYTES) return redirect(`/admin/settings?e=${encodeURIComponent('That picture is too big (over 1 MB). Take a screenshot of the QR code and upload the screenshot instead.')}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpeg) return redirect(`/admin/settings?e=${encodeURIComponent('That file is not a picture we can use. Upload a PNG or JPG photo or screenshot of the QR code.')}`);
    await putSetting(env.DB, 'qr_png', bytesToB64(bytes));
    await putSetting(env.DB, 'qr_type', isPng ? 'image/png' : 'image/jpeg');
  }
  return redirect('/admin/settings?m=Saved ✓');
}

async function changePassword(env, request) {
  const form = await request.formData();
  const current = String(form.get('current') || '');
  const next = String(form.get('next') || '');
  if (!(await checkPassword(env, current))) return redirect(`/admin/settings?e=${encodeURIComponent('The current password is wrong.')}`);
  if (next.length < 10) return redirect(`/admin/settings?e=${encodeURIComponent('The new password needs at least 10 characters.')}`);
  if (next !== String(form.get('confirm') || '')) return redirect(`/admin/settings?e=${encodeURIComponent('The two new passwords do not match.')}`);
  await putSetting(env.DB, 'password_hash', await hashPassword(next));
  return redirect('/admin/settings?m=Password changed. Other devices are signed out.', { 'Set-Cookie': await issueCookie(env) });
}

export async function login(env, request) {
  if (!loginConfigured(env)) return htmlResponse(V.loginPage({ disabled: true }), 503);
  const ip = clientIp(request);
  if (await rateLimited(env, ip)) return htmlResponse(V.loginPage({ error: 'Too many sign-in attempts. Try again in an hour.' }), 429);
  await recordAttempt(env, ip);
  const form = await request.formData();
  if (!(await checkPassword(env, String(form.get('password') || '')))) return htmlResponse(V.loginPage({ error: 'That password is not right.' }), 401);
  return redirect('/admin/', { 'Set-Cookie': await issueCookie(env) });
}

export async function handleAdmin(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const segs = path.split('/').filter(Boolean).slice(1);

  if (segs[0] === 'login' && method === 'POST') return login(env, request);
  if (segs.length === 0 && method === 'GET') {
    if (!(await isAuthed(request, env))) return htmlResponse(V.loginPage({ disabled: !loginConfigured(env) }));
    if (!url.pathname.endsWith('/')) return redirect('/admin/');
    return dashboard(env, url);
  }
  if (segs[0] === 'logout' && method === 'POST') return redirect('/admin', { 'Set-Cookie': clearCookie() });
  if (segs[0] === 'requests' && segs[1] === 'status' && method === 'POST') {
    const form = await request.formData();
    const key = decodeKey(form.get('r'));
    const status = String(form.get('status') || '');
    if (key && ['new', 'invoiced', 'deposit_paid', 'paid', 'done'].includes(status)) await setRequestStatus(env.DB, key, status, null);
    return redirect('/admin/?m=Status saved ✓');
  }
  if (segs[0] === 'invoices') {
    if (segs.length === 1 && method === 'GET') {
      const { results } = await env.DB.prepare(`SELECT i.*, COALESCE((SELECT SUM(ROUND(qty*unit_cents)) FROM invoice_lines l WHERE l.invoice_id=i.id),0) AS total_cents
        FROM invoices i ORDER BY i.id DESC LIMIT 200`).all();
      return htmlResponse(V.invoicesPage({ invoices: results || [] }));
    }
    if (segs.length === 1 && method === 'POST') return createInvoice(env, request);
    if (segs[1] === 'new' && method === 'GET') return newInvoice(env, url);
    const id = Number(segs[1]);
    if (Number.isInteger(id) && id > 0) {
      if (segs.length === 2 && method === 'GET') {
        const loaded = await loadInvoice(env.DB, id);
        if (!loaded) return htmlResponse(V.layout('Not found', '<p>No such invoice.</p>'), 404);
        const settings = await getSettings(env.DB);
        const emailHtml = (await emailParts(env, loaded.invoice, loaded.lines, settings, true)).html;
        return htmlResponse(V.invoiceViewPage({ ...loaded, emailHtml, pay: paymentStatus(settings), flash: url.searchParams.get('m') || '', error: url.searchParams.get('e') || '' }));
      }
      if (segs[2] === 'edit' && method === 'GET') {
        const loaded = await loadInvoice(env.DB, id);
        if (!loaded) return htmlResponse(V.layout('Not found', '<p>No such invoice.</p>'), 404);
        const pay = paymentStatus(await getSettings(env.DB));
        return htmlResponse(V.invoiceEditorPage({ invoice: { ...loaded.invoice, pay_plan: payPlanOf(loaded.invoice, invoiceTotal(loaded.lines)) }, lines: loaded.lines, request: null,
          action: `/admin/invoices/${id}`, title: `Change invoice for ${V.firstName(loaded.invoice.customer_name)}`, pay, mode: 'edit' }));
      }
      if (segs.length === 2 && method === 'POST') return updateInvoice(env, request, id);
      if (segs[2] === 'send' && method === 'POST') return sendInvoice(env, request, id);
      if (segs[2] === 'status' && method === 'POST') return changeStatus(env, request, id);
      if (segs[2] === 'preview' && method === 'GET') {
        const loaded = await loadInvoice(env.DB, id);
        if (!loaded) return htmlResponse('Not found', 404);
        const parts = await emailParts(env, loaded.invoice, loaded.lines, await getSettings(env.DB), true);
        return htmlResponse(parts.html);
      }
    }
  }
  if (segs[0] === 'help' && method === 'GET') return htmlResponse(V.helpPage());
  if (segs[0] === 'checklist' && method === 'GET') {
    if (segs.length === 1) return checklistPrint(env, url);
    if (segs[1] === 'online') return checklistOnline(env, url);
  }
  if (segs[0] === 'settings') {
    if (segs.length === 1 && method === 'GET') {
      const settings = await getSettings(env.DB);
      return htmlResponse(V.settingsPage({ settings, hasQr: Boolean(settings.qr_png), flash: url.searchParams.get('m') || '', error: url.searchParams.get('e') || '' }));
    }
    if (segs.length === 1 && method === 'POST') return saveSettings(env, request);
    if (segs[1] === 'password' && method === 'POST') return changePassword(env, request);
  }
  return htmlResponse(V.layout('Not found', `<p>Nothing here. <a href="/admin/">Back to requests</a>.</p>`), 404);
}

export async function handleApi(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.pathname === '/api/admin/qr.png' && request.method === 'GET') {
    const settings = await getSettings(env.DB);
    if (!settings.qr_png) return new Response('no QR code yet', { status: 404, headers: { 'Cache-Control': 'no-cache' } });
    return new Response(b64ToBytes(settings.qr_png), { headers: { 'Content-Type': settings.qr_type || 'image/png', 'Cache-Control': 'no-cache' } });
  }
  if (url.pathname === '/api/admin/checklist' && request.method === 'PUT') {
    const key = decodeKey(url.searchParams.get('r'));
    if (!key) return Response.json({ error: 'which request?' }, { status: 400 });
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
    const allowed = new Set(fieldIndex(CHECKLIST_SOURCE).map((f) => f.id));
    const clean = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (k === '_done') { if (v) clean._done = true; continue; }
      if (!allowed.has(k)) continue;
      clean[k] = typeof v === 'boolean' ? v : String(v).slice(0, 5000);
    }
    await env.DB.prepare("INSERT INTO request_checklist (request_key, data, updated_at) VALUES (?1, ?2, datetime('now')) ON CONFLICT(request_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
      .bind(key, JSON.stringify(clean)).run();
    return Response.json({ ok: true, state: checklistState(clean) });
  }
  if (url.pathname === '/api/admin/checklist/photos' && request.method === 'POST') {
    const key = decodeKey(url.searchParams.get('r'));
    if (!key) return Response.json({ error: 'which request?' }, { status: 400 });
    const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return Response.json({ error: 'photos must be JPEG, PNG or WebP' }, { status: 415 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (!bytes.length) return Response.json({ error: 'empty photo' }, { status: 400 });
    if (bytes.length > PHOTO_MAX_BYTES) return Response.json({ error: 'photo is over 1.5 MB after shrinking' }, { status: 413 });
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM checklist_photos WHERE request_key = ?1').bind(key).first();
    if ((count ? count.n : 0) >= MAX_PHOTOS) return Response.json({ error: `this request already has ${MAX_PHOTOS} photos` }, { status: 409 });
    const row = await env.DB.prepare('INSERT INTO checklist_photos (request_key, content_type, bytes, size) VALUES (?1, ?2, ?3, ?4) RETURNING id')
      .bind(key, type, bytes, bytes.length).first();
    return Response.json({ ok: true, id: row.id, url: `/api/admin/checklist/photos/${row.id}` });
  }
  const photo = url.pathname.match(/^\/api\/admin\/checklist\/photos\/(\d+)$/);
  if (photo && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT content_type, bytes FROM checklist_photos WHERE id = ?1').bind(Number(photo[1])).first();
    if (!row) return new Response('not found', { status: 404 });
    return new Response(new Uint8Array(row.bytes), { headers: { 'Content-Type': row.content_type, 'Cache-Control': 'private, max-age=3600' } });
  }
  if (photo && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM checklist_photos WHERE id = ?1').bind(Number(photo[1])).run();
    return Response.json({ ok: true });
  }
  return Response.json({ error: 'not found' }, { status: 404 });
}

export { SHEET_URL, esc };
