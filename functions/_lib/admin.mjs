// Request router for /admin/* pages. Auth is enforced before this runs, by
// functions/admin/_middleware.js (see guard.mjs).
import {
  SHEET_URL, FROM_EMAIL, esc, redirect, htmlResponse, getSettings, putSetting, toCents, invoiceTotal,
  halfDeposit, PAY_PLANS, payPlanOf, amountDueNow, todayISO, fromB64urlText, bytesToB64, b64ToBytes, needsPrice,
} from './util.mjs';
import { checkPassword, hashPassword, issueCookie, clearCookie, clientIp, rateLimited, recordAttempt, loginConfigured, isAuthed } from './auth.mjs';
import { loadRequests, driveFileId, idFolderId } from './sheet.mjs';
import { PRICE_TABLE, CONTACT } from './prices.mjs';
import { renderInvoicePdf, textMessage } from './pdf.mjs';
import { prefillLines, pickupNote, isRentalInvoice } from './pricing.mjs';
import { renderInvoiceEmail, paymentStatus } from './email.mjs';
import * as V from './views.mjs';
import * as VC from './views-calendar.mjs';
import * as C from './calendar.mjs';
import * as AC from './admin-calendar.mjs';
import * as AM from './admin-money.mjs';
import { balances, recordPayment, voidPayments, balanceWords, depositWords, depositHeld } from './ledger.mjs';
import { categoriesFrom } from './expenses.mjs';
import { CHECKLIST_SOURCE } from './checklist-source.mjs';
import { renderPrintPage, prefillFromRequest, renderOnlineSections, checklistState, invoiceFromChecklist, fieldIndex } from './checklist.mjs';

const MAX_PHOTOS = 10;
const PHOTO_MAX_BYTES = 1500000;

const QR_MAX_BYTES = 1024 * 1024;
const REQUEST_STATUS = { sent: 'invoiced', deposit_paid: 'deposit_paid', paid: 'paid', done: 'job_done' };

// Bookings an invoice makes for its request (rental pickup + return, porch / party / grazing
// jobs). Upserted by (request_key, kind): re-sending never duplicates, and a booking she
// scheduled by hand keeps her date. Never blocks the invoice: a sheet outage just adds nothing.
async function syncInvoiceBookings(env, id) {
  try {
    const loaded = await loadInvoice(env.DB, id);
    if (!loaded || !loaded.invoice.request_key || loaded.invoice.status === 'void') return 0;
    const request = await findRequest(env, loaded.invoice.request_key);
    const rows = C.bookingsFromInvoice({ invoice: loaded.invoice, lines: loaded.lines, request, table: PRICE_TABLE, isRental: isRentalInvoice(loaded.lines, PRICE_TABLE) });
    return await C.upsertBookings(env.DB, rows);
  } catch { return 0; }
}

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
  const statuses = await AC.statusMap(env.DB);
  const checklists = {};
  const saved = await env.DB.prepare('SELECT request_key, data FROM request_checklist').all();
  for (const row of saved.results || []) { try { checklists[row.request_key] = checklistState(JSON.parse(row.data)); } catch { /* unreadable row: no badge */ } }
  const bals = await balances(env.DB);
  const invoices = {};
  for (const [id, b] of Object.entries(bals)) invoices[id] = { ...b.invoice, total_cents: b.total, balance: b };
  const schedule = {};
  const { results: booked } = await env.DB.prepare('SELECT request_key, MIN(date) AS date FROM bookings WHERE request_key IS NOT NULL GROUP BY request_key').all();
  for (const r of booked || []) schedule[r.request_key] = { date: r.date };
  const returns = await C.loadReturns(env.DB);
  const open = requests.filter((r) => !(statuses[r.key] && statuses[r.key].archived_at));
  const { reminders, tomorrowLabel, overdue } = await AC.remindersAndOverdue(env.DB);
  return htmlResponse(V.dashboardPage({ requests: open, statuses, checklists, invoices, schedule, returns, folderUrl: await folderUrl(env, settings, requests), sheetError,
    flash: url.searchParams.get('m') || '', error: url.searchParams.get('e') || '', missingPayment: paymentStatus(settings).missing, putAway: url.searchParams.get('put') || '',
    extraTop: `${VC.overdueBox(overdue)}${VC.remindersBox(reminders, tomorrowLabel)}` }));
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
  if (request && request.gamesAnswer && lines.some((l) => /^Game rental \(/.test(l.description))) warnings.push(`We could not match the games they picked ("${request.gamesAnswer}"). Check the first line under Change what goes into the total.`);
  if (request && lines.some((l) => /of your choice/i.test(l.description))) warnings.push('They picked a bundle without naming every game. Ask which games, then change the line under Change what goes into the total.');
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
      const row = await env.DB.prepare(`INSERT INTO invoices (number, request_key, customer_name, customer_email, customer_phone, issue_date, due_date, deposit_due_cents, notes, status, pay_plan, name_norm)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'draft', ?10, ?11) RETURNING id`).bind(number, key, invoice.customer_name, invoice.customer_email,
        invoice.customer_phone, invoice.issue_date, invoice.due_date, invoice.deposit_due_cents, invoice.notes, invoice.pay_plan, C.normName(invoice.customer_name)).first();
      id = row.id;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
      number = await nextInvoiceNumber(env.DB, invoice.issue_date);
    }
  }
  await saveLines(env.DB, id, lines);
  if (key) {
    const existing = await env.DB.prepare('SELECT status FROM request_status WHERE request_key = ?1').bind(key).first();
    await setRequestStatus(env.DB, key, existing && existing.status !== 'void' ? existing.status : 'new', id);
  }
  await syncInvoiceBookings(env, id);
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
  const current = await env.DB.prepare('SELECT status FROM invoices WHERE id = ?1').bind(id).first();
  if (current && current.status === 'void') return redirect(`/admin/invoices/${id}?e=${encodeURIComponent('This invoice is void. Bring it back first (Payment box), then change it.')}`);
  await env.DB.prepare(`UPDATE invoices SET customer_name=?1, customer_email=?2, customer_phone=?3, issue_date=?4, due_date=?5, deposit_due_cents=?6, notes=?7, pay_plan=?9, name_norm=?10, updated_at=datetime('now') WHERE id=?8`)
    .bind(invoice.customer_name, invoice.customer_email, invoice.customer_phone, invoice.issue_date, invoice.due_date, invoice.deposit_due_cents, invoice.notes, id, invoice.pay_plan, C.normName(invoice.customer_name)).run();
  await saveLines(env.DB, id, lines);
  if (form.get('go') === 'send') return afterSend(id, await deliver(env, id, false));
  return redirect(`/admin/invoices/${id}?m=${encodeURIComponent(afterSaveMessage(form.get('go')))}`);
}

async function emailParts(env, invoice, lines, settings, forPreview) {
  const qrSrc = settings.qr_png ? (forPreview ? '/api/admin/qr.png' : 'cid:pnp-payment-qr') : null;
  const rendered = renderInvoiceEmail({ invoice, lines, settings, contact: CONTACT, qrSrc, pickup: pickupNote(lines, PRICE_TABLE) });
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
  if (invoice.status === 'void') return { ok: false, error: 'This invoice is void, so it cannot be sent. Tap Bring back (undo Void) in the Payment box first.' };
  if (!test && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invoice.customer_email)) return { ok: false, error: 'No working email on this invoice. Tap Text the invoice (PDF) instead, or add the email under Change the invoice.' };
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
  await syncInvoiceBookings(env, id);
  return { ok: true, message: `Sent ✓ to ${invoice.customer_email}` };
}

function afterSend(id, result) {
  return redirect(`/admin/invoices/${id}?${result.ok ? 'm' : 'e'}=${encodeURIComponent(result.ok ? result.message : result.error)}`);
}

async function sendInvoice(env, request, id) {
  const form = await request.formData();
  return afterSend(id, await deliver(env, id, form.get('test') === '1'));
}

const MONEY_ACTIONS = new Set(['deposit_paid', 'paid', 'texted', 'done', 'unpaid']);
const safeBack = (v) => (/^\/admin\/[A-Za-z0-9/_?=&.%-]*$/.test(String(v || '')) && !String(v).includes('//') ? String(v) : '');

async function changeStatus(env, request, id) {
  const form = await request.formData();
  const action = String(form.get('action') || '');
  const back = safeBack(form.get('back'));
  const go = (key, msg) => redirect(`${back || `/admin/invoices/${id}`}${(back || '').includes('?') ? '&' : '?'}${key}=${encodeURIComponent(msg)}`);
  const loaded = await loadInvoice(env.DB, id);
  if (!loaded) return htmlResponse(V.layout('Not found', '<p>No such invoice.</p>', { screen: 'notfound', back: { href: '/admin/invoices', label: 'Back to invoices' } }), 404);
  const { invoice, lines } = loaded;
  const next = { texted: 'sent', deposit_paid: 'deposit_paid', paid: 'paid', done: 'done', void: 'void', unvoid: 'draft', unpaid: 'sent' }[action];
  if (!next) return redirect(`/admin/invoices/${id}`);
  if (invoice.status === 'void' && action !== 'unvoid') return go('e', 'This invoice is void. It cannot be sent or marked paid. Tap Bring back (undo Void) first.');
  if (invoice.status !== 'void' && action === 'unvoid') return go('m', 'This invoice is not void.');
  const method = String(form.get('method') || '').slice(0, 20);
  let recorded = 0;
  if (action === 'deposit_paid') recorded = await recordPayment(env.DB, invoice, lines, 'deposit', method);
  if (action === 'paid') recorded = await recordPayment(env.DB, invoice, lines, 'full', method);
  if (action === 'unpaid') await voidPayments(env.DB, id);
  if (action === 'texted') await env.DB.prepare("UPDATE invoices SET status='sent', sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?1").bind(id).run();
  else await env.DB.prepare("UPDATE invoices SET status=?1, updated_at=datetime('now') WHERE id=?2").bind(next, id).run();
  if (action === 'void') await C.removeInvoiceBookings(env.DB, id);
  if (invoice.request_key) {
    if (next === 'void') await setRequestStatus(env.DB, invoice.request_key, 'void', id);
    else if (next === 'draft') await setRequestStatus(env.DB, invoice.request_key, 'new', id);
    else if (action === 'unpaid') await setRequestStatus(env.DB, invoice.request_key, invoice.sent_at ? 'invoiced' : 'new', id);
    else await setRequestStatus(env.DB, invoice.request_key, REQUEST_STATUS[next], id);
    if (action === 'done') await env.DB.prepare("UPDATE request_status SET job_done_at = COALESCE(job_done_at, datetime('now')) WHERE request_key = ?1").bind(invoice.request_key).run();
  }
  if (action === 'texted') await syncInvoiceBookings(env, id);
  const money = (c) => `$${(c / 100).toFixed(2)}`;
  const label = {
    texted: 'Marked as sent by text ✓', deposit_paid: `Deposit received ✓${recorded ? ` (${money(recorded)} recorded)` : ''}`, paid: `Paid in full ✓${recorded ? ` (${money(recorded)} recorded)` : ''}`,
    done: 'Marked done ✓', void: `Invoice ${invoice.number} is void. Its bookings are off the calendar.`, unvoid: 'Invoice brought back. It is not sent yet. Send it again to put it back on the calendar.',
    unpaid: 'Marked as not paid.',
  }[action];
  return go('m', label);
}

async function saveSettings(env, request) {
  const form = await request.formData();
  for (const key of ['zelle', 'cashapp', 'business_name', 'business_address', 'id_folder_url', 'day_list_phone', 'day_list_email']) {
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

// Every admin request: route it, then (1) after a change, update the Google Sheet in the
// background; (2) on a page, retry a queued sheet update and say "Google Sheet will catch up
// shortly" while one is waiting. Neither ever blocks or breaks the page.
const NO_SYNC = /^\/admin\/(login|logout|settings\/password|settings\/sheet-sync)$/;
export async function handleAdmin(context) {
  const res = await routeAdmin(context);
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const later = (p) => { if (typeof context.waitUntil === 'function') context.waitUntil(p.catch(() => {})); };
  if (method === 'POST' && res.status < 400 && !NO_SYNC.test(url.pathname.replace(/\/+$/, ''))) later(AM.syncSafely(env));
  if (method === 'GET' && res.status === 200 && /text\/html/.test(res.headers.get('Content-Type') || '') && env.DB) {
    const pending = await AM.pendingSync(env.DB);
    if (pending) {
      later(AM.syncSafely(env));
      const html = (await res.text()).replace('<main class="wrap', '<div class="wrap" style="padding-bottom:0"><div class="notice warn" data-sheet-pending>Google Sheet will catch up shortly.</div></div><main class="wrap');
      return new Response(html, { status: res.status, headers: res.headers });
    }
  }
  return res;
}

async function routeAdmin(context) {
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
    // A request with no invoice: its Payment box (deposit / paid / not paid / Void / Bring back).
    const form = await request.formData();
    const key = decodeKey(form.get('r'));
    const want = String(form.get('status') || '');
    const current = key ? await env.DB.prepare('SELECT status FROM request_status WHERE request_key = ?1').bind(key).first() : null;
    const isVoid = current && current.status === 'void';
    if (isVoid && want !== 'unvoid') return redirect(`/admin/?e=${encodeURIComponent('This request is void, so it cannot be marked paid. Tap Bring back (undo Void) first.')}`);
    const status = { deposit_paid: 'deposit_paid', paid: 'paid', unpaid: 'new', void: 'void', unvoid: 'new' }[want];
    if (key && status) await setRequestStatus(env.DB, key, status, null);
    return redirect(`/admin/?m=${encodeURIComponent(status === 'void' ? 'Request is void.' : 'Saved ✓')}`);
  }
  if (segs[0] === 'requests' && segs[1] === 'jobdone' && method === 'POST') {
    // "Mark job done" / "Undo job done" for a porch, party or grazing job (rentals use Mark returned).
    const form = await request.formData();
    const key = decodeKey(form.get('r'));
    const undo = form.get('undo') === '1';
    if (key) {
      if (undo) await env.DB.prepare("UPDATE request_status SET job_done_at = NULL, status = COALESCE(prev_status, status), prev_status = NULL, updated_at = datetime('now') WHERE request_key = ?1").bind(key).run();
      else await env.DB.prepare(`INSERT INTO request_status (request_key, status, job_done_at, prev_status, updated_at) VALUES (?1, 'job_done', datetime('now'), 'new', datetime('now'))
        ON CONFLICT(request_key) DO UPDATE SET prev_status = CASE WHEN request_status.status = 'job_done' THEN request_status.prev_status ELSE request_status.status END,
          status = 'job_done', job_done_at = COALESCE(request_status.job_done_at, datetime('now')), updated_at = datetime('now')`).bind(key).run();
    }
    return redirect(`/admin/?m=${encodeURIComponent(undo ? 'Job done undone.' : 'Job done ✓')}`);
  }
  if (segs[0] === 'requests' && segs[1] === 'archive' && method === 'POST') return AC.archiveRequest(env, request, true);
  if (segs[0] === 'requests' && segs[1] === 'unarchive' && method === 'POST') return AC.archiveRequest(env, request, false);
  if (segs[0] === 'archive' && segs.length === 1 && method === 'GET') return AC.archivePage(env, url);
  if (segs[0] === 'search' && method === 'GET') return AC.searchRoute(env, url);
  if (segs[0] === 'day' && segs[1]) {
    if (segs.length === 2 && method === 'GET') return AC.dayPage(env, url, segs[1]);
    if (segs[2] === 'email' && method === 'POST') return AC.emailDay(env, url, segs[1]);
  }
  if (segs[0] === 'returns') {
    if (segs.length === 1 && method === 'GET') return AC.returnPage(env, url);
    if (segs.length === 1 && method === 'POST') return AC.saveReturnRoute(env, request, url);
    if (segs[1] === 'undo' && method === 'POST') return AC.undoReturnRoute(env, url);
  }
  if (segs[0] === 'notes' && /^\d+$/.test(segs[1] || '') && method === 'POST') return AC.editNoteRoute(env, request, Number(segs[1]), segs[2] === 'delete');
  if (segs[0] === 'money') {
    if (segs.length === 1 && method === 'GET') return AM.moneyPage(env, url);
    if (segs[1] === 'detail' && method === 'GET') return AM.moneyDetail(env, url);
    if (segs[1] === 'year' && segs.length === 2 && method === 'GET') return AM.yearPage(env, url);
    if (segs[1] === 'year.pdf' && method === 'GET') return AM.yearPdf(env, url);
    if (segs[1] === 'year.csv' && method === 'GET') return AM.yearCsv(env, url);
    if (segs[1] === 'year' && segs[2] === 'email' && method === 'POST') return AM.yearEmail(env, url);
    if (segs[1] === 'receipts.zip' && method === 'GET') return AM.receiptsZip(env, url);
    if (segs[1] === 'expenses') {
      if (segs.length === 2 && method === 'POST') return AM.saveExpense(env, request, null);
      if (segs[2] === 'new' && method === 'GET') return AM.expensePage(env, 'new');
      const eid = Number(segs[2]);
      if (Number.isInteger(eid) && eid > 0) {
        if (segs.length === 3 && method === 'GET') return AM.expensePage(env, eid);
        if (segs.length === 3 && method === 'POST') return AM.saveExpense(env, request, eid);
        if (segs[3] === 'delete' && method === 'POST') return AM.deleteExpense(env, eid);
        if (segs[3] === 'receipt' && method === 'GET') return AM.receiptFile(env, eid);
      }
    }
  }
  if (segs[0] === 'calendar') {
    if (segs.length === 1 && method === 'GET') return AC.calendarPage(env, url);
    if (segs[1] === 'day' && segs[2]) return redirect(`/admin/day/${segs[2]}`);
    if (segs[1] === 'link' && method === 'GET') return AC.linkPage(env, url);
    if (segs[1] === 'new' && method === 'GET') return AC.newBookingPage(env, url);
    if (segs[1] === 'bookings') {
      if (segs.length === 2 && method === 'POST') return AC.createBookingRoute(env, request);
      const bid = Number(segs[2]);
      if (Number.isInteger(bid) && bid > 0) {
        if (segs.length === 3 && method === 'POST') return AC.updateBookingRoute(env, request, bid);
        if (segs[3] === 'edit' && method === 'GET') return AC.editBookingPage(env, bid);
        if (segs[3] === 'delete' && method === 'POST') return AC.deleteBookingRoute(env, bid);
        if (segs[3] === 'move' && method === 'GET') return AC.movePage(env, bid);
        if (segs[3] === 'move' && method === 'POST') return AC.moveRoute(env, request, bid);
        if (segs[3] === 'reminded' && method === 'POST') return AC.remindedRoute(env, request, bid);
        if (segs[3] === 'notes' && method === 'POST') return AC.addNoteRoute(env, request, bid);
      }
    }
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
        if (!loaded) return htmlResponse(V.layout('Not found', '<p>No such invoice.</p>', { screen: 'notfound', back: { href: '/admin/invoices', label: 'Back to invoices' } }), 404);
        const settings = await getSettings(env.DB);
        const emailHtml = (await emailParts(env, loaded.invoice, loaded.lines, settings, true)).html;
        const pickup = pickupNote(loaded.lines, PRICE_TABLE);
        const smsText = textMessage({ invoice: loaded.invoice, lines: loaded.lines, settings, pickup });
        const balance = (await balances(env.DB))[id];
        if (balance) Object.assign(balance, await depositHeld(env.DB, id));
        return htmlResponse(V.invoiceViewPage({ ...loaded, emailHtml, smsText, pickup, balance, pay: paymentStatus(settings), flash: url.searchParams.get('m') || '', error: url.searchParams.get('e') || '' }));
      }
      if (segs[2] === 'edit' && method === 'GET') {
        const loaded = await loadInvoice(env.DB, id);
        if (!loaded) return htmlResponse(V.layout('Not found', '<p>No such invoice.</p>', { screen: 'notfound', back: { href: '/admin/invoices', label: 'Back to invoices' } }), 404);
        const pay = paymentStatus(await getSettings(env.DB));
        return htmlResponse(V.invoiceEditorPage({ invoice: { ...loaded.invoice, pay_plan: payPlanOf(loaded.invoice, invoiceTotal(loaded.lines)) }, lines: loaded.lines, request: null,
          action: `/admin/invoices/${id}`, title: `Change invoice for ${V.firstName(loaded.invoice.customer_name)}`, pay, mode: 'edit' }));
      }
      if (segs.length === 2 && method === 'POST') return updateInvoice(env, request, id);
      if (segs[2] === 'send' && method === 'POST') return sendInvoice(env, request, id);
      if (segs[2] === 'status' && method === 'POST') return changeStatus(env, request, id);
      if (segs[2] === 'deposit' && method === 'POST') return AM.depositOutcome(env, request, id);
      if (segs[2] === 'invoice.pdf' && method === 'GET') {
        const loaded = await loadInvoice(env.DB, id);
        if (!loaded) return htmlResponse('Not found', 404);
        const bytes = await renderInvoicePdf({ invoice: loaded.invoice, lines: loaded.lines, settings: await getSettings(env.DB), contact: CONTACT, pickup: pickupNote(loaded.lines, PRICE_TABLE) });
        const filename = `Porch-and-Party-Invoice-${loaded.invoice.number}.pdf`;
        return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${url.searchParams.get('dl') === '1' ? 'attachment' : 'inline'}; filename="${filename}"`, 'Cache-Control': 'no-store' } });
      }
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
      return htmlResponse(V.settingsPage({ settings, hasQr: Boolean(settings.qr_png), categories: categoriesFrom(settings), pendingSync: await AM.pendingSync(env.DB), flash: url.searchParams.get('m') || '', error: url.searchParams.get('e') || '' }));
    }
    if (segs.length === 1 && method === 'POST') return saveSettings(env, request);
    if (segs[1] === 'password' && method === 'POST') return changePassword(env, request);
    if (segs[1] === 'calendar-token' && method === 'POST') return AC.regenerateToken(env);
    if (segs[1] === 'sheet-sync' && method === 'POST') return AM.syncNowRoute(env, url);
    if (segs[1] === 'categories' && method === 'POST') return AM.saveCategories(env, request);
  }
  return htmlResponse(V.layout('Not found', '<p>Nothing here.</p>', { screen: 'notfound', back: { href: '/admin/', label: 'Back to requests' } }), 404);
}

export async function handleApi(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.pathname === '/api/admin/qr.png' && request.method === 'GET') {
    const settings = await getSettings(env.DB);
    if (!settings.qr_png) return new Response('no QR code yet', { status: 404, headers: { 'Cache-Control': 'no-cache' } });
    return new Response(b64ToBytes(settings.qr_png), { headers: { 'Content-Type': settings.qr_type || 'image/png', 'Cache-Control': 'no-cache' } });
  }
  if (url.pathname === '/api/admin/receipts' && request.method === 'POST') return AM.uploadReceipt(env, request);
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
