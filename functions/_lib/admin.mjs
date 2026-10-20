// Request router for /admin/* pages. Auth is enforced before this runs, by
// functions/admin/_middleware.js (see guard.mjs).
import {
  SHEET_URL, FROM_EMAIL, esc, redirect, htmlResponse, getSettings, putSetting, toCents, invoiceTotal,
  halfDeposit, PAY_PLANS, payPlanOf, amountDueNow, todayISO, fromB64urlText, bytesToB64, b64ToBytes, needsPrice, b64urlText,
  ownerCopy, shortDate,
} from './util.mjs';
import * as RN from './request-new.mjs';
import * as ST from './steps.mjs';
import * as AS from './admin-steps.mjs';
import { syncExtraGames, freeGamesFor, extraGamesOf } from './extra-games.mjs';
import { checkPassword, hashPassword, issueCookie, clearCookie, clientIp, rateLimited, recordAttempt, loginConfigured, isAuthed } from './auth.mjs';
import { driveFileId, idFolderId } from './sheet.mjs';
import { loadRequests, weekCounts, monthCount, idOnFile, logEvent } from './requests.mjs';
import { loadTakedownFacts } from './takedown.mjs';
import { chicagoDate } from './reminders.mjs';
import { expireHolds, confirmHold, extendHold, keepHolding, releaseHold, currentHolds, endingSoon, holdSettings, getHold, fromSql } from './holds.mjs';
import { messageCtx, autoConfirm, smsFor } from './customer-messages.mjs';
import { isPhone, rentalDates, PHONE_SOURCE } from './phone-requests.mjs';
import { cleanImage } from './image-clean.mjs';
import { sendMessage } from './messages.mjs';
import * as VM2 from './views-messages.mjs';
import { hasEmail } from './reminders.mjs';
import { PRICE_TABLE, TRACK_TABLE, CONTACT } from './prices.mjs';
import { renderInvoicePdf, textMessage } from './pdf.mjs';
import { prefillLines, porchPrefill, pickupNote, isRentalInvoice } from './pricing.mjs';
import { renderInvoiceEmail, paymentStatus } from './email.mjs';
import * as V from './views.mjs';
import { sendWeeklySummary } from './weekly.mjs';
import SERVICES_DATA from '../../data/offers/services.json';
import * as VC from './views-calendar.mjs';
import * as C from './calendar.mjs';
import * as AC from './admin-calendar.mjs';
import * as AM from './admin-money.mjs';
import { balances, recordPayment, voidPayments, balanceWords, depositWords, depositHeld, linesFromForm, saveLines, linesByInvoice } from './ledger.mjs';
import * as AE from './admin-edit.mjs';
import * as INVD from './inventory.mjs';
import * as VI from './views-inventory.mjs';
import { categoriesFrom } from './expenses.mjs';
import { liveChecklistSource } from './checklist-source.mjs';
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
  const lines = linesFromForm(form);
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
  if (!rkParam) return htmlResponse(renderPrintPage(liveChecklistSource(), {}));
  const key = decodeKey(rkParam);
  const request = await findRequest(env, key);
  const values = { ...(request ? prefillFromRequest(liveChecklistSource(), request) : {}), ...((await savedChecklist(env, key)) || {}) };
  return htmlResponse(renderPrintPage(liveChecklistSource(), values, { who: request ? request.name : key.split('|')[1] || 'this request', onlineHref: `/admin/checklist/online?r=${rkParam}` }));
}

async function checklistOnline(env, url) {
  const rk = url.searchParams.get('r') || '';
  const key = decodeKey(rk);
  if (!key) return redirect('/admin/');
  const request = (await findRequest(env, key)) || { key, name: key.split('|')[1] || '', rentals: [], decor: [], other: [] };
  const saved = await savedChecklist(env, key);
  const values = saved || prefillFromRequest(liveChecklistSource(), request);
  const { results } = await env.DB.prepare('SELECT id FROM checklist_photos WHERE request_key = ?1 ORDER BY id').bind(key).all();
  const photos = (results || []).map((p) => ({ id: p.id, url: `/api/admin/checklist/photos/${p.id}` }));
  return htmlResponse(V.checklistOnlinePage({ request, rk, sections: renderOnlineSections(liveChecklistSource(), values), photos, values, maxPhotos: MAX_PHOTOS }));
}

async function folderUrl(env, settings, requests) {
  if (settings.id_folder_url) return settings.id_folder_url;
  const first = requests.map((r) => driveFileId(r.idFile)).find(Boolean);
  const folder = await idFolderId(env, first);
  if (folder) return `https://drive.google.com/drive/folders/${folder}`;
  // The form's uploads land in a Drive folder named "<form title> (File responses)".
  return 'https://drive.google.com/drive/search?q=%22File%20responses%22%20type%3Afolder';
}

// "IDs ready to delete": paid in full and, for a rental, the games back. A list, never automatic.
export function readyToDeleteId(r, st, inv, ret) {
  const bal = inv && inv.balance;
  const paidFull = bal ? (!bal.void && bal.total > 0 && bal.remaining === 0) : Boolean(st && st.status === 'paid');
  if (!paidFull) return false;
  return r.wantsRentals ? Boolean(ret && ret.returned_at) : true;
}

// "2026-10-26T15:00" typed on her phone = Memphis wall clock -> UTC ms.
export function chicagoLocalToMs(local) {
  const m = String(local || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return NaN;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return guess - (wall - guess);
}

// The holds list with what each row's buttons need (sms text, email twin, deposit target).
export async function holdsWithButtons(env, back = '/admin/') {
  const holds = await currentHolds(env.DB);
  for (const h of holds) {
    const ctx = await messageCtx(env.DB, h.request_key);
    h.sms = ctx ? smsFor('holdEnding', ctx) : null;
    h.canEmail = Boolean(ctx && hasEmail(ctx.email));
    h.depositTarget = h.invoice_id ? { action: `/admin/invoices/${h.invoice_id}/status`, fields: { action: 'deposit_paid', back } } : { action: '/admin/requests/status', fields: { r: b64urlText(h.request_key), status: 'deposit_paid' } };
  }
  return holds;
}

// Per-card extras: the hold controls on a held rental, "Hold expired", and the thank-you box;
// msgs: the confirmation and pickup-time messages, drawn by the card as small links (or the
// pickup text as the card's one primary, by the rules table).
async function cardExtras(env, requests, statuses, holds) {
  const out = {};
  const msgs = {};
  const bottom = {};
  const holdHtml = {};
  const byKey = Object.fromEntries(holds.map((h) => [h.request_key, h]));
  for (const r of requests) {
    const rk = b64urlText(r.key);
    const st = statuses[r.key] || {};
    const bits = [];
    const h = byKey[r.key];
    // On the card the hold's deposit button shows only when there is no invoice: with one, the
    // card's primary / Payment box already carries Mark deposit received.
    // The hold controls sit behind the step card's small "Hold longer" link (owner, 19 Oct 2026:
    // no 24/48 h choice up front); the card shows "Games held until <time>" itself.
    if (h) holdHtml[r.key] = `<style>${VM2.HOLD_CSS}</style>${VM2.holdControls(h, { rk, sms: h.sms, canEmail: h.canEmail, depositTarget: st.invoice_id ? null : h.depositTarget, compact: true })}`;
    else {
      const old = r.source === 'site' && r.wantsRentals ? await getHold(env.DB, r.key) : null;
      if (old && old.state === 'expired') bits.push('<div class="notice warn" data-hold-expired><strong>Hold expired.</strong> No deposit came in by the end time, so the games were freed. Use Give them more time on a new request, or book it by hand.</div>');
    }
    if (st.job_done_at && st.status !== 'void' && r.source) {
      const ctx = await messageCtx(env.DB, r.key);
      // The thank-you is one small line at the BOTTOM of the card, just above Show details.
      bottom[r.key] = VM2.thankYouBox(r, { rk, sms: ctx ? smsFor('thankyou', ctx) : null, canEmail: Boolean(ctx && hasEmail(ctx.email)) });
    }
    if (st.status === 'deposit_paid' || st.status === 'paid' || st.status === 'scheduled') {
      const ctx = await messageCtx(env.DB, r.key);
      // A phone request never gets (or shows) a confirmation email: they were confirmed on the call.
      const phone = isPhone(r);
      if (ctx && (r.confirmedTextedAt || (r.confirmEmailedAt && !phone))) bits.push(`<p class="money ok" data-confirm-sent>${r.confirmedTextedAt ? 'Confirmation sent ✓' : 'Confirmation email sent ✓'}</p>`);
      if (ctx) {
        msgs[r.key] = { confirm: { sms: smsFor('confirmation', ctx), canEmail: !phone && hasEmail(ctx.email) } };
        if (ctx.service === 'rentals') msgs[r.key].pickup = { sms: smsFor('pickupTime', ctx), canEmail: hasEmail(ctx.email) };
      }
    }
    if (bits.length) out[r.key] = bits.join('');
  }
  return { extras: out, msgs, bottom, holdHtml };
}

async function dashboard(env, url) {
  await expireHolds(env.DB);
  const settings = await getSettings(env.DB);
  let requests = []; let sheetError = '';
  try { requests = await loadRequests(env, { fresh: url.searchParams.get('fresh') === '1' }); } catch (e) { sheetError = e.message || String(e); }
  const statuses = await AC.statusMap(env.DB);
  const checklists = {};
  const saved = await env.DB.prepare('SELECT request_key, data FROM request_checklist').all();
  for (const row of saved.results || []) { try { checklists[row.request_key] = checklistState(JSON.parse(row.data)); } catch { /* unreadable row: no badge */ } }
  const bals = await balances(env.DB);
  const invoices = {};
  const linesBy = await linesByInvoice(env.DB);
  for (const [id, b] of Object.entries(bals)) invoices[id] = { ...b.invoice, total_cents: b.total, balance: b, lines: linesBy[id] || [] };
  const schedule = {};
  const { results: booked } = await env.DB.prepare("SELECT request_key, MIN(date) AS date FROM bookings WHERE request_key IS NOT NULL AND kind NOT IN ('porch_takedown','party_takedown','grazing_pickup','rental_return') GROUP BY request_key").all();
  for (const r of booked || []) schedule[r.request_key] = { date: r.date };
  const returns = await C.loadReturns(env.DB);
  const open = requests.filter((r) => !(statuses[r.key] && statuses[r.key].archived_at));
  const archived = requests.filter((r) => statuses[r.key] && statuses[r.key].archived_at)
    .sort((a, b) => String(statuses[b.key].archived_at).localeCompare(String(statuses[a.key].archived_at)));
  const kinds = {};
  const bookingsBy = {};
  const tdFacts = await loadTakedownFacts(env.DB);
  for (const [key, rows] of Object.entries(tdFacts.bookingsBy)) {
    kinds[key] = rows.map((k) => k.kind);
    bookingsBy[key] = rows.map((k) => ({ id: k.id, kind: k.kind, date: k.date, time: k.time, done_at: k.done_at }));
  }
  const events = {};
  const { results: evRows } = await env.DB.prepare('SELECT request_key, at, what, who FROM request_events ORDER BY id').all();
  for (const e of evRows || []) (events[e.request_key] = events[e.request_key] || []).push(e);
  const notes = {};
  const { results: noteRows } = await env.DB.prepare('SELECT request_key, body FROM booking_notes WHERE request_key IS NOT NULL ORDER BY id').all();
  for (const n of noteRows || []) (notes[n.request_key] = notes[n.request_key] || []).push(n);
  const { reminders, tomorrowLabel, overdue } = await AC.remindersAndOverdue(env.DB);
  const referrers = {};
  for (const r of requests) if (r.referralCode) referrers[r.referralCode] = r.name;
  const idsReady = requests.filter((r) => idOnFile(r) && readyToDeleteId(r, statuses[r.key], statuses[r.key] && statuses[r.key].invoice_id ? invoices[statuses[r.key].invoice_id] : null, returns[r.key]));
  const week = weekCounts(requests, chicagoDate());
  const holds = await holdsWithButtons(env);
  const { extras, msgs, bottom, holdHtml } = await cardExtras(env, open, statuses, holds);
  const stored = await ST.loadStored(env.DB);
  const depositOut = await ST.depositOutcomes(env.DB);
  const holdsBy = Object.fromEntries(holds.map((h) => [h.request_key, h]));
  const tdKey = url.searchParams.get('tdok') ? decodeKey(url.searchParams.get('tdok')) : '';
  const soon = endingSoon(holds, Date.now(), settings);
  // NEW until opened or acted on (request-new.mjs, migration 0016).
  const opened = await RN.openedSet(env.DB);
  const newKeys = new Set(open.filter((r) => RN.isNewRequest(r, { st: statuses[r.key], opened: opened.has(r.key) })).map((r) => r.key));
  return htmlResponse(V.dashboardPage({ newKeys, requests: open, statuses, checklists, invoices, schedule, returns, folderUrl: await folderUrl(env, settings, requests), sheetError, referrers,
    stored, depositOut, holds: holdsBy, holdHtml,
    weekBox: V.weekBox(week, newKeys), idsBox: V.idsReadyBox(idsReady), cardExtras: extras, cardMsgs: msgs, cardBottom: bottom, tdSaved: tdKey ? { key: tdKey, words: url.searchParams.get('tdm') || 'Saved ✓' } : null, bookings: bookingsBy, takedownInvoices: tdFacts.invoiceIds, today: chicagoDate(),
    archived, filter: url.searchParams.get('f') || 'all', openPutAway: url.searchParams.get('pa') === '1', kinds, events, notes,
    foodPerHead: SERVICES_DATA.services.grazing.foodPerHead || null, pickupPlace: PRICE_TABLE.pickupPlace,
    holdsBox: `${VM2.holdsSoonBox(soon, { soonHours: holdSettings(settings).soonHours })}${Object.keys(extras).length || Object.keys(msgs).length || Object.keys(bottom).length ? VM2.TAP_JS : ''}`,
    flash: url.searchParams.get('m') || '', error: url.searchParams.get('e') || '', missingPayment: paymentStatus(settings).missing, putAway: url.searchParams.get('put') || '',
    extraTop: VC.overdueBox(overdue), remindersLine: VC.remindersBox(reminders, tomorrowLabel, { line: true }) }));
}

// The invoice editor's quick-add buttons (owner-approved 19 Oct 2026): the prices come from
// data/offers/services.json invoiceQuickAdds; on a rental, the games free for its whole pickup ->
// return span (extra-games.mjs), booked ones shown as not free.
async function quickAddsFor(env, key, lines) {
  const q = SERVICES_DATA.invoiceQuickAdds || {};
  const out = { deliveryCents: Math.round(Number(q.deliveryFee || 0) * 100), extraGameCents: Math.round(Number(q.extraGame || 0) * 100), rental: false, games: [], span: '', baseCount: 0 };
  const request = key ? await findRequest(env, key) : null;
  out.rental = Boolean((request && (request.gamesAnswer || (request.wantsRentals && !request.wantsDecor))) || isRentalInvoice(lines, PRICE_TABLE));
  if (!out.rental) return out;
  const { results: bk } = key ? await env.DB.prepare("SELECT kind, date, items FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return')").bind(key).all() : { results: [] };
  const d = request ? rentalDates(request, bk || []) : { pickup: '', ret: '' };
  const pickup = d.pickup || '';
  const ret = d.ret || (pickup ? C.addDays(pickup, 1) : '');
  out.span = pickup ? `${shortDate(pickup)} to ${shortDate(ret)}` : '';
  const pk = (bk || []).find((b) => b.kind === 'rental_pickup');
  const own = [pk && pk.items, request && request.gamesAnswer, ...(lines || []).filter((l) => !l.refundable).map((l) => l.description)].filter(Boolean).join(', ');
  const windows = C.rentalWindows(await C.listBookings(env.DB), await C.loadReturns(env.DB), TRACK_TABLE);
  out.games = pickup ? freeGamesFor({ windows, pickup, ret, today: chicagoDate(), table: TRACK_TABLE, key: key || '', ownItems: own }) : [];
  const ex = C.expandItems(own, TRACK_TABLE);
  out.baseCount = TRACK_TABLE.items.filter((i) => i.kind === 'game' && ex.names.includes(i.name)).length - extraGamesOf(lines, TRACK_TABLE).length + (ex.unnamed || 0);
  return out;
}

async function newInvoice(env, url) {
  const key = url.searchParams.get('r') ? decodeKey(url.searchParams.get('r')) : '';
  let request = null; const warnings = [];
  if (key) {
    try { request = (await loadRequests(env)).find((r) => r.key === key) || null; } catch (e) { warnings.push(e.message); }
    if (!request) warnings.push('That request could not be found, so this invoice starts empty.');
  }
  // A rental's booked pickup and return days (phone bookings, or days she changed) set its length.
  if (request && request.wantsRentals) {
    const { results: bk } = await env.DB.prepare("SELECT kind, date FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return')").bind(key).all();
    const d = rentalDates(request, bk || []);
    request = { ...request, rentalPickup: d.pickup, rentalReturn: d.ret };
  }
  let lines = request ? prefillLines(request, PRICE_TABLE) : [{ description: '', qty: 1, unit_cents: 0, note: '', refundable: 0 }];
  let depositCents = null; let dueDate = todayISO(7);
  const fromChecklist = key ? invoiceFromChecklist(liveChecklistSource(), await savedChecklist(env, key)) : null;
  if (request && request.gamesAnswer && lines.some((l) => /^Game rental \(/.test(l.description))) warnings.push(`We could not match the games they picked ("${request.gamesAnswer}"). Check the first line under Change what goes into the total.`);
  if (request) warnings.push(...porchPrefill(request, PRICE_TABLE).warnings);
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
  const quick = await quickAddsFor(env, key, lines);
  return htmlResponse(V.invoiceEditorPage({ invoice, lines, request, action: '/admin/invoices', title: request ? `Invoice for ${V.firstName(request.name)}` : 'New invoice', warnings, pay, mode: 'new', quick }));
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
  if (key) await syncExtraGames(env.DB, key);
  if (form.get('go') === 'send') return afterSend(id, await deliver(env, id, false));
  return redirect(`/admin/invoices/${id}?m=${encodeURIComponent(afterSaveMessage(form.get('go')))}`);
}

// A draft invoice made for her by the site form (a rental booking): pay plan "custom" with the
// deposit asked for now. Never sent by itself: Valerie taps Send.
export async function createDraftInvoice(env, { key, name, email, phone, lines, depositCents, dueDate, notes = '' }) {
  const issue = todayISO();
  let number = await nextInvoiceNumber(env.DB, issue);
  let id = null;
  for (let attempt = 0; attempt < 3 && id === null; attempt += 1) {
    try {
      const row = await env.DB.prepare(`INSERT INTO invoices (number, request_key, customer_name, customer_email, customer_phone, issue_date, due_date, deposit_due_cents, notes, status, pay_plan, name_norm)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'draft', 'custom', ?10) RETURNING id`).bind(number, key, name, email, phone, issue, dueDate || issue, depositCents, notes, C.normName(name)).first();
      id = row.id;
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
      number = await nextInvoiceNumber(env.DB, issue);
    }
  }
  await saveLines(env.DB, id, lines);
  await setRequestStatus(env.DB, key, 'new', id);
  return id;
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
  // An extra game added (or removed) here is held for (or freed from) the rental's days at once.
  const rkey = (await env.DB.prepare('SELECT request_key FROM invoices WHERE id = ?1').bind(id).first() || {}).request_key;
  if (rkey) await syncExtraGames(env.DB, rkey);
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
    ...(test ? {} : ownerCopy('invoice')),
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
  if (invoice.request_key) await syncExtraGames(env.DB, invoice.request_key);
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
  if (action === 'texted') { await syncInvoiceBookings(env, id); if (invoice.request_key) await syncExtraGames(env.DB, invoice.request_key); }
  if ((action === 'deposit_paid' || (action === 'paid' && !['deposit_paid', 'paid', 'done'].includes(invoice.status))) && invoice.request_key) {
    const flash = action === 'deposit_paid' ? `Deposit received ✓${recorded ? ` ($${(recorded / 100).toFixed(2)} recorded)` : ''}` : `Paid in full ✓${recorded ? ` ($${(recorded / 100).toFixed(2)} recorded)` : ''}`;
    return afterDeposit(env, invoice.request_key, flash, back || `/admin/invoices/${id}`);
  }
  const money = (c) => `$${(c / 100).toFixed(2)}`;
  const label = {
    texted: 'Marked as sent by text ✓', deposit_paid: `Deposit received ✓${recorded ? ` (${money(recorded)} recorded)` : ''}`, paid: `Paid in full ✓${recorded ? ` (${money(recorded)} recorded)` : ''}`,
    done: 'Marked done ✓', void: `Invoice ${invoice.number} is void. Its bookings are off the calendar.`, unvoid: 'Invoice brought back. It is not sent yet. Send it again to put it back on the calendar.',
    unpaid: 'Marked as not paid.',
  }[action];
  return go('m', label);
}

// "Mark picked up" with "They paid the rest now" ticked (step cards): records the rest exactly as
// Mark paid in full does on the invoice (recordPayment 'full', invoice and request Paid).
export async function payRest(env, invoiceId, method = '') {
  const loaded = await loadInvoice(env.DB, invoiceId);
  if (!loaded || loaded.invoice.status === 'void') return 0;
  const recorded = await recordPayment(env.DB, loaded.invoice, loaded.lines, 'full', String(method || '').slice(0, 20));
  await env.DB.prepare("UPDATE invoices SET status = 'paid', updated_at = datetime('now') WHERE id = ?1").bind(invoiceId).run();
  if (loaded.invoice.request_key) {
    await setRequestStatus(env.DB, loaded.invoice.request_key, REQUEST_STATUS.paid, invoiceId);
    await confirmHold(env.DB, loaded.invoice.request_key);
  }
  return recorded;
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

// The site form's ID photo, from the private R2 bucket (binding IDS). Signed-in only (guard),
// never cached, never public: the bucket has no public URL and this is its only reader.
async function idPhoto(env, url) {
  const key = decodeKey(url.searchParams.get('r') || '');
  const row = key ? await env.DB.prepare('SELECT id_object, id_type, id_deleted_at FROM requests WHERE request_key = ?1').bind(key).first() : null;
  if (!row || !row.id_object || row.id_deleted_at || !env.IDS) return htmlResponse(V.layout('No ID', '<p>No ID photo is on file for this request.</p>', { screen: 'notfound', back: { href: '/admin/', label: 'Back to requests' } }), 404);
  const obj = await env.IDS.get(row.id_object);
  if (!obj) return htmlResponse(V.layout('No ID', '<p>No ID photo is on file for this request.</p>', { screen: 'notfound', back: { href: '/admin/', label: 'Back to requests' } }), 404);
  return new Response(obj.body, { headers: { 'Content-Type': row.id_type || 'image/jpeg', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="photo-id"' } });
}

// "Delete this ID": permanent, asked first, logged (who and when). Site photos are removed from
// private storage; for the old Google Form request the Drive file is hers to delete (the site
// cannot reach her personal Drive), so the card says where it is.
async function deleteId(env, request) {
  const form = await request.formData();
  const key = decodeKey(form.get('r'));
  const row = key ? await env.DB.prepare('SELECT source, id_object, id_file, id_deleted_at, name FROM requests WHERE request_key = ?1').bind(key).first() : null;
  if (!row) return redirect(`/admin/?e=${encodeURIComponent('That request was not found.')}`);
  if (row.id_deleted_at) return redirect(`/admin/?m=${encodeURIComponent('That ID was already deleted.')}`);
  if (row.id_object && env.IDS) await env.IDS.delete(row.id_object);
  await env.DB.prepare("UPDATE requests SET id_deleted_at = datetime('now'), id_object = NULL WHERE request_key = ?1").bind(key).run();
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  await logEvent(env.DB, key, row.source !== 'google_form' ? 'ID photo deleted for good from private storage' : 'ID marked deleted (the Drive copy is deleted by hand from the ID folder)', `signed-in admin (${ip})`);
  const msg = row.source !== 'google_form' ? 'ID deleted for good ✓' : 'ID removed from the card ✓ Also delete the photo from the ID folder in Google Drive (Open ID folder at the top).';
  return redirect(`/admin/?m=${encodeURIComponent(msg)}`);
}

// "Add ID photo" on a request with no ID on file (a phone booking: ID-for-everyone still
// stands, it just comes later). Same private bucket and the same cleaning (EXIF stripped) as
// the site form; logged on the request.
async function addId(env, request) {
  const form = await request.formData();
  const key = decodeKey(form.get('r'));
  const back = key ? `#c-${b64urlText(key)}` : '';
  const row = key ? await env.DB.prepare('SELECT source, id_object, id_file, id_deleted_at FROM requests WHERE request_key = ?1').bind(key).first() : null;
  if (!row) return redirect(`/admin/?e=${encodeURIComponent('That request was not found.')}`);
  if (row.id_object || (row.id_file && !row.id_deleted_at)) return redirect(`/admin/?m=${encodeURIComponent('An ID is already on file for this request.')}${back}`);
  const file = form.get('id_photo');
  if (!env.IDS || !file || typeof file !== 'object' || !file.size) return redirect(`/admin/?e=${encodeURIComponent('Pick a photo of their ID first.')}${back}`);
  if (file.size > 10 * 1024 * 1024) return redirect(`/admin/?e=${encodeURIComponent('That photo is too big. Take it again with your phone camera.')}${back}`);
  const image = cleanImage(new Uint8Array(await file.arrayBuffer()), file.type || 'image/jpeg');
  if (!image) return redirect(`/admin/?e=${encodeURIComponent('That file is not a photo we can use. Use a JPG or PNG.')}${back}`);
  const idObject = `ids/${[...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('')}.${image.type === 'image/png' ? 'png' : 'jpg'}`;
  await env.IDS.put(idObject, image.bytes, { httpMetadata: { contentType: image.type } });
  await env.DB.prepare('UPDATE requests SET id_object = ?1, id_type = ?2, id_size = ?3, id_deleted_at = NULL WHERE request_key = ?4').bind(idObject, image.type, image.bytes.length, key).run();
  await logEvent(env.DB, key, 'ID photo added by Valerie (kept in private storage)', 'Valerie');
  return redirect(`/admin/?m=${encodeURIComponent('ID photo added ✓')}${back}`);
}

const BACK_OK = (v) => (/^\/admin\/[A-Za-z0-9/_?=&.%-]*$/.test(String(v || '')) && !String(v).includes('//') ? String(v) : '/admin/');
async function holdAction(env, request, what) {
  const form = await request.formData();
  const key = decodeKey(form.get('r'));
  const back = BACK_OK(form.get('back'));
  const go = (k, m) => redirect(`${back}${back.includes('?') ? '&' : '?'}${k}=${encodeURIComponent(m)}`);
  if (!key) return go('e', 'Which request?');
  if (what === 'extend') {
    const until = form.get('until') ? chicagoLocalToMs(String(form.get('until'))) : 0;
    const r = await extendHold(env.DB, key, until ? { until: new Date(until).toISOString() } : { hours: Number(form.get('hours')) || 24 });
    if (!r.ok) return go('e', r.error);
    if (r.ok) {
      // A hold that had expired comes back: put its games on the calendar again.
      const req = await findRequest(env, key);
      const bk = await env.DB.prepare("SELECT COUNT(*) AS n FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return')").bind(key).first();
      if (req && (!bk || !bk.n)) {
        const pickup = (req.rentals.find((x) => /pickup date/i.test(x.label)) || {}).value;
        const ret = (req.rentals.find((x) => /return date/i.test(x.label)) || {}).value;
        const items = C.itemsText(C.expandItems(req.gamesAnswer, PRICE_TABLE)) || req.gamesAnswer;
        const st = await env.DB.prepare('SELECT invoice_id FROM request_status WHERE request_key = ?1').bind(key).first();
        const base = { request_key: key, invoice_id: st ? st.invoice_id : null, time: null, customer_name: req.name, phone: req.phone, email: req.email, place: PRICE_TABLE.pickupPlace, items };
        if (pickup && ret) await C.upsertBookings(env.DB, [{ ...base, kind: 'rental_pickup', date: pickup }, { ...base, kind: 'rental_return', date: ret }]);
      }
    }
    return go('m', `Hold extended ✓ ${VM2.endsWords(fromSql(r.until)).text}`);
  }
  if (what === 'keep') return go('m', (await keepHolding(env.DB, key)) ? 'Held by hand ✓ It stays held until you release it.' : 'That hold is not active any more.');
  return go('m', (await releaseHold(env.DB, key)) ? 'Games released ✓ They are free for others.' : 'That hold is not active any more.');
}

const MSG_TEMPLATES = { confirmation: 'confirm_emailed_at', thankyou: 'thankyou_emailed_at', holdEnding: null, pickupTime: null };
const TAP_COLUMNS = { confirmation: 'confirmed_texted_at', thankyou: 'thankyou_texted_at', holdEnding: 'hold_texted_at' };
async function emailMessage(env, request) {
  const form = await request.formData();
  const key = decodeKey(form.get('r'));
  const template = String(form.get('template') || '');
  if (!key || !(template in MSG_TEMPLATES)) return redirect(`/admin/?e=${encodeURIComponent('That message could not be found.')}`);
  const ctx = await messageCtx(env.DB, key);
  if (!ctx) return redirect(`/admin/?e=${encodeURIComponent('That request was not found.')}`);
  if (template === 'confirmation' && ctx.row.source === PHONE_SOURCE) return redirect(`/admin/?m=${encodeURIComponent('Phone bookings get no confirmation email. Text them instead.')}`);
  const col = MSG_TEMPLATES[template];
  if (col && ctx.row[col]) return redirect(`/admin/?m=${encodeURIComponent('That email was already sent ✓')}`);
  const out = await sendMessage(env, 'email', template, ctx);
  if (!out.ok) return redirect(`/admin/?e=${encodeURIComponent(`The email did not go out. (${out.error})`)}`);
  if (col) await env.DB.prepare(`UPDATE requests SET ${col} = datetime('now') WHERE request_key = ?1`).bind(key).run();
  await logEvent(env.DB, key, `Emailed: ${template}`, 'Valerie');
  return redirect(`/admin/?m=${encodeURIComponent('Sent ✓')}`);
}

async function tappedMessage(env, request) {
  const form = await request.formData();
  const key = decodeKey(form.get('r'));
  const col = TAP_COLUMNS[String(form.get('template') || '')];
  if (key && col) await env.DB.prepare(`UPDATE requests SET ${col} = COALESCE(${col}, datetime('now')) WHERE request_key = ?1`).bind(key).run();
  return Response.json({ ok: true });
}

async function confirmedScreen(env, url) {
  const key = decodeKey(url.searchParams.get('r') || '');
  const ctx = key ? await messageCtx(env.DB, key) : null;
  const back = BACK_OK(url.searchParams.get('back'));
  if (!ctx) return redirect(back);
  return htmlResponse(VM2.confirmedPage({ rk: b64urlText(key), name: ctx.name, sms: smsFor('confirmation', ctx), emailed: ctx.row.source !== PHONE_SOURCE && Boolean(ctx.row.confirm_emailed_at), texted: Boolean(ctx.row.confirmed_texted_at), canEmail: ctx.row.source !== PHONE_SOURCE && hasEmail(ctx.email), phone: ctx.row.source === PHONE_SOURCE, flash: url.searchParams.get('m') || '', back }));
}

// After a deposit is marked received on a request: confirm its hold, email the confirmation
// once, then the success screen with "Text them it's confirmed".
async function afterDeposit(env, key, flash, back) {
  await confirmHold(env.DB, key);
  if (env.DB) await autoConfirm(env, key).catch(() => null);
  return redirect(`/admin/confirmed?r=${b64urlText(key)}&m=${encodeURIComponent(flash)}&back=${encodeURIComponent(back || '/admin/')}`);
}

async function emailReminder(env, id) {
  const R = await import('./reminders.mjs');
  const b = await env.DB.prepare(`SELECT b.*, COALESCE(NULLIF(b.email, ''), i.customer_email, '') AS reminder_email FROM bookings b LEFT JOIN invoices i ON i.id = b.invoice_id WHERE b.id = ?1`).bind(id).first();
  if (!b || !hasEmail(b.reminder_email)) return redirect(`/admin/calendar?e=${encodeURIComponent('No email on file for that booking.')}`);
  const out = await sendMessage(env, 'email', 'reminder', { name: b.customer_name, reminderText: R.reminderText(b).replace(/Reply here/, 'Reply to this email'), dayShort: b.date }, { to: b.reminder_email });
  if (!out.ok) return redirect(`/admin/calendar?e=${encodeURIComponent(`The email did not go out. (${out.error})`)}`);
  await env.DB.prepare("UPDATE bookings SET email_reminded_at = datetime('now') WHERE id = ?1").bind(id).run();
  return redirect(`/admin/calendar?m=${encodeURIComponent('Reminder emailed ✓')}`);
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
  await INVD.useInventory(context.env);
  let res = await routeAdmin(context);
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const later = (p) => { if (typeof context.waitUntil === 'function') context.waitUntil(p.catch(() => {})); };
  if (method === 'POST' && res.status < 400 && !NO_SYNC.test(url.pathname.replace(/\/+$/, ''))) later(AM.syncSafely(env));
  if (method === 'GET' && res.status === 200 && /text\/html/.test(res.headers.get('Content-Type') || '') && env.DB && await isAuthed(request, env)) {
    // The tab badge: "2 holds ending soon" on Requests and Calendar & Bookings.
    let soon = 0;
    try { soon = endingSoon(await currentHolds(env.DB), Date.now(), await getSettings(env.DB)).length; } catch { soon = 0; }
    if (soon) {
      const badge = `<span class="navbadge" data-holds-badge> ${soon} ${soon === 1 ? 'hold' : 'holds'} ending soon</span>`;
      const html = (await res.text()).replace(/(<a href="\/admin\/"[^>]*>Requests)(<\/a>)/, `$1${badge}$2`).replace(/(<a href="\/admin\/calendar"[^>]*>Calendar &amp; Bookings)(<\/a>)/, `$1${badge}$2`)
        .replace('</style>', '.navbadge{background:#fff3dc;color:#7a4a0c;border:1px solid #ebcf96;border-radius:999px;padding:0 6px;font-size:.8rem;font-weight:700;margin-left:4px}</style>');
      res = new Response(html, { status: res.status, headers: res.headers });
    }
  }
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
    if (key && (status === 'deposit_paid' || (status === 'paid' && !(current && ['deposit_paid', 'paid'].includes(current.status))))) return afterDeposit(env, key, status === 'paid' ? 'Paid in full ✓' : 'Deposit received ✓', '/admin/');
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
    return redirect(`/admin/?m=${encodeURIComponent(undo ? 'Job done undone.' : 'Job done ✓')}${key ? `#c-${b64urlText(key)}` : ''}`);
  }
  if (segs[0] === 'holds' && method === 'POST' && ['extend', 'keep', 'release'].includes(segs[1])) return holdAction(env, request, segs[1]);
  if (segs[0] === 'msg' && segs[1] === 'email' && method === 'POST') return emailMessage(env, request);
  if (segs[0] === 'msg' && segs[1] === 'tapped' && method === 'POST') return tappedMessage(env, request);
  if (segs[0] === 'requests' && segs[1] === 'opened' && method === 'POST') {
    const form = await request.formData();
    const key = decodeKey(String(form.get('r') || ''));
    const done = key ? await RN.markOpened(env.DB, key, String(form.get('how') || 'card')) : false;
    return Response.json({ ok: Boolean(key), recorded: done });
  }
  if (segs[0] === 'confirmed' && method === 'GET') return confirmedScreen(env, url);
  if (segs[0] === 'requests' && segs[1] === 'thankyou-skip' && method === 'POST') {
    const form = await request.formData();
    const key = decodeKey(form.get('r'));
    if (key) await env.DB.prepare('UPDATE requests SET thankyou_skip = ?2 WHERE request_key = ?1').bind(key, form.get('skip') === '1' ? 1 : 0).run();
    return redirect(`/admin/?m=${encodeURIComponent(form.get('skip') === '1' ? 'No thank-you email will be sent for this request.' : 'The thank-you email will go out tomorrow morning.')}`);
  }
  if (segs[0] === 'requests' && segs[1] === 'takedown' && method === 'POST') {
    // The takedown is never required: Not sure yet / Customer will handle it (+ note), or '' to ask again.
    const form = await request.formData();
    const key = decodeKey(form.get('r'));
    const plan = String(form.get('plan') || '');
    if (key && ['not_sure', 'customer_handles', ''].includes(plan)) {
      // The inline row sends no note: the one already on file stays.
      const note = form.has('note') ? String(form.get('note') || '').trim().slice(0, 500) : null;
      await env.DB.prepare('UPDATE requests SET takedown_plan = ?2, takedown_note = CASE WHEN ?2 IS NULL THEN \'\' ELSE COALESCE(?3, takedown_note) END WHERE request_key = ?1').bind(key, plan || null, note).run();
      await logEvent(env.DB, key, plan === 'not_sure' ? `Takedown: not decided yet${note ? ` (${note})` : ''}` : (plan ? `Takedown: the customer will handle it${note ? ` (${note})` : ''}` : 'Takedown question asked again'), 'admin');
    }
    const words = plan === 'not_sure' ? 'Saved: takedown not decided yet.' : (plan ? 'Saved: the customer will handle the takedown.' : 'Saved ✓');
    return redirect(key ? `/admin/?tdok=${encodeURIComponent(form.get('r'))}&tdm=${encodeURIComponent(words)}#c-${form.get('r')}` : `/admin/?m=${encodeURIComponent(words)}`);
  }
  if (segs[0] === 'requests' && segs[1] === 'takedown-inline' && method === 'POST') return AC.takedownInlineRoute(env, request);
  // Step cards (owner-approved 19 Oct 2026): "I've talked to them" -> Yes, book it / Not yet / No;
  // the undo of Called back; Add a note.
  if (segs[0] === 'requests' && segs[1] === 'talked' && method === 'POST') return AS.talkedRoute(env, request);
  if (segs[0] === 'requests' && segs[1] === 'called' && method === 'POST') return AS.calledRoute(env, request);
  if (segs[0] === 'requests' && segs[1] === 'note' && method === 'POST') return AS.noteRoute(env, request);
  // "Change anything on this request" (owner, 18 Oct 2026): one page, one Save per section, at any stage.
  if (segs[0] === 'requests' && segs[1] === 'edit') {
    if (segs.length === 2 && method === 'GET') { await RN.markOpened(env.DB, decodeKey(url.searchParams.get('r') || ''), 'edit'); return AE.editPage(env, url); }
    if (segs.length === 3 && method === 'POST') return AE.editRoute(env, request, segs[2]);
  }
  if (segs[0] === 'requests' && segs[1] === 'id' && segs.length === 2 && method === 'GET') return idPhoto(env, url);
  if (segs[0] === 'requests' && segs[1] === 'id' && segs[2] === 'delete' && method === 'POST') return deleteId(env, request);
  if (segs[0] === 'requests' && segs[1] === 'id' && segs[2] === 'upload' && method === 'POST') return addId(env, request);
  if (segs[0] === 'requests' && segs[1] === 'archive' && method === 'POST') return AC.archiveRequest(env, request, true);
  if (segs[0] === 'requests' && segs[1] === 'unarchive' && method === 'POST') return AC.archiveRequest(env, request, false);
  // Put away left the main nav (JOB B): it is the collapsed section at the bottom of Requests.
  if (segs[0] === 'archive' && segs.length === 1 && method === 'GET') return redirect(`/admin/?pa=1${url.searchParams.get('m') ? `&m=${encodeURIComponent(url.searchParams.get('m'))}` : ''}#put-away`);
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
    if (segs[1] === 'remind' && segs.length === 2 && method === 'POST') return AM.remindRoute(env, request);
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
        if ((segs[3] === 'takedown-done' || segs[3] === 'done') && method === 'POST') return AC.takedownDoneRoute(env, request, bid);
        if (segs[3] === 'email-reminder' && method === 'POST') return emailReminder(env, bid);
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
        const quick = await quickAddsFor(env, loaded.invoice.request_key, loaded.lines);
        return htmlResponse(V.invoiceEditorPage({ invoice: { ...loaded.invoice, pay_plan: payPlanOf(loaded.invoice, invoiceTotal(loaded.lines)) }, lines: loaded.lines, request: null,
          action: `/admin/invoices/${id}`, title: `Change invoice for ${V.firstName(loaded.invoice.customer_name)}`, pay, mode: 'edit', quick, backHref: loaded.invoice.request_key ? `/admin/#c-${b64urlText(loaded.invoice.request_key)}` : '/admin/' }));
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
  if (segs[0] === 'packages' && segs.length === 1 && method === 'GET') return htmlResponse(V.porchPackagesPage(PRICE_TABLE.porchPackages));
  if (segs[0] === 'checklist' && method === 'GET') {
    if (segs.length === 1) return checklistPrint(env, url);
    if (segs[1] === 'online') return checklistOnline(env, url);
  }
  if (segs[0] === 'settings') {
    if (segs[1] === 'inventory') return inventoryRoute(env, request, url, segs.slice(2), method);
    if (segs.length === 1 && method === 'GET') {
      const settings = await getSettings(env.DB);
      return htmlResponse(V.settingsPage({ settings, inventory: await inventoryHtml(env), hasQr: Boolean(settings.qr_png), categories: categoriesFrom(settings), pendingSync: await AM.pendingSync(env.DB), flash: url.searchParams.get('m') || '', error: url.searchParams.get('e') || '' }));
    }
    if (segs.length === 1 && method === 'POST') return saveSettings(env, request);
    if (segs[1] === 'password' && method === 'POST') return changePassword(env, request);
    if (segs[1] === 'calendar-token' && method === 'POST') return AC.regenerateToken(env);
    if (segs[1] === 'sheet-sync' && method === 'POST') return AM.syncNowRoute(env, url);
    if (segs[1] === 'weekly' && method === 'POST') {
      const form = await request.formData();
      const on = form.get('weekly_summary') !== '0';
      await putSetting(env.DB, 'weekly_summary', on ? '1' : '0');
      return redirect(`/admin/settings?m=${encodeURIComponent(on ? 'The Monday summary is on ✓' : 'The Monday summary is off.')}`);
    }
    if (segs[1] === 'weekly-now' && method === 'POST') {
      const r = await sendWeeklySummary(env, { force: true, send: viaMailer(env) });
      return redirect(r.ok ? `/admin/settings?m=${encodeURIComponent(`This week's summary is on its way to ${r.to} ✓`)}` : `/admin/settings?e=${encodeURIComponent(`The summary did not go out: ${r.error}`)}`);
    }
    if (segs[1] === 'categories' && method === 'POST') return AM.saveCategories(env, request);
    if (segs[1] === 'holds' && method === 'POST') {
      const form = await request.formData();
      const n = (k, d, lo, hi) => { const v = Number(form.get(k)); return String(Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : d); };
      await putSetting(env.DB, 'hold_hours', n('hold_hours', 24, 1, 336));
      await putSetting(env.DB, 'hold_reminder_hours', n('hold_reminder_hours', 4, 1, 48));
      await putSetting(env.DB, 'hold_soon_hours', n('hold_soon_hours', 12, 1, 72));
      await putSetting(env.DB, 'hold_reminder', form.get('hold_reminder') === '1' ? '1' : '0');
      await putSetting(env.DB, 'hold_auto_expire', form.get('hold_auto_expire') === '1' ? '1' : '0');
      return redirect('/admin/settings?m=Hold settings saved ✓');
    }
  }
  return htmlResponse(V.layout('Not found', '<p>Nothing here.</p>', { screen: 'notfound', back: { href: '/admin/', label: 'Back to requests' } }), 404);
}

// ---- Settings -> Inventory (functions/_lib/inventory.mjs) ----------------------------------------
async function futureCounts(env, state) {
  const today = chicagoDate();
  const out = {};
  const { TRACK_TABLE } = await import('./prices.mjs');
  for (const r of state.rows) {
    const item = JSON.parse(r.data);
    out[r.slug] = (await INVD.futureBookingsFor(env.DB, item.name, today, TRACK_TABLE)).length;
  }
  return out;
}

async function inventoryHtml(env) {
  try {
    const state = await INVD.loadInventory(env.DB);
    const words = INVD.publishWords(await INVD.publishStatus(env));
    return VI.inventorySection({ state: await INVD.loadInventory(env.DB), words, future: await futureCounts(env, state), keyMissing: !env.PNP_GITHUB_TOKEN });
  } catch (e) {
    return `<section class="card" id="inventory"><h2>Inventory: your rental items</h2><div class="notice err">The inventory could not load: ${esc(String(e && e.message ? e.message : e))}</div></section>`;
  }
}

const invBack = (m, e = '') => redirect(`/admin/settings?${e ? `e=${encodeURIComponent(e)}` : `m=${encodeURIComponent(m)}`}#inventory`);
const SAVED = 'Saved ✓ It counts in the admin now. The website updates by itself in about 5 minutes.';

async function inventoryRoute(env, request, url, rest, method) {
  const res = await inventoryRouteInner(env, request, url, rest, method);
  // A save changes the tables this request already loaded: reload them for whatever runs next.
  if (method === 'POST') await INVD.useInventory(env);
  return res;
}

async function inventoryRouteInner(env, request, url, rest, method) {
  const state = await INVD.loadInventory(env.DB);
  const findRow = (slug) => state.rows.find((r) => r.slug === slug);
  if (rest[0] === 'publish' && method === 'POST') {
    const r = await INVD.startPublish(env, 'Try again');
    return invBack(r.status === 'running' ? 'The website update started again. About 5 minutes.' : 'Saved. See the box below for the website update.');
  }
  if (rest[0] === 'rates' && method === 'POST') {
    const r = await INVD.saveRates(env, await request.formData());
    if (!r.ok) return invBack('', r.errors.join(' '));
    await INVD.startPublish(env, 'game price');
    return invBack(SAVED);
  }
  if (rest[0] === 'new' && rest.length === 1) {
    if (method === 'GET') return htmlResponse(VI.itemFormPage({ isNew: true, data: state.data, section: 'games' }));
    if (method === 'POST') {
      const form = await request.formData();
      const r = await INVD.saveItem(env, { form, photo: form.get('photo') });
      if (!r.ok) return htmlResponse(VI.itemFormPage({ isNew: true, data: state.data, errors: r.errors, item: formItem(form), section: sectionOfForm(form) }), 422);
      await INVD.startPublish(env, `add ${r.slug}`);
      return invBack(SAVED);
    }
  }
  const slug = rest[0] || '';
  const row = findRow(slug);
  if (!row) return htmlResponse(V.layout('Not found', '<p>That item is not in the inventory.</p>', { screen: 'notfound', back: { href: '/admin/settings#inventory', label: 'Back to Settings' } }), 404);
  const item = JSON.parse(row.data);
  const { TRACK_TABLE } = await import('./prices.mjs');
  const future = (await INVD.futureBookingsFor(env.DB, item.name, chicagoDate(), TRACK_TABLE)).length;
  if (rest.length === 1 && method === 'GET') return htmlResponse(VI.itemFormPage({ isNew: false, item, row, section: row.section, data: state.data, futureCount: future }));
  if (rest.length === 1 && method === 'POST') {
    const form = await request.formData();
    const r = await INVD.saveItem(env, { slug, form, photo: form.get('photo') });
    if (!r.ok) return htmlResponse(VI.itemFormPage({ isNew: false, item: { ...item, ...formItem(form), slug }, row, section: sectionOfForm(form), data: state.data, errors: r.errors, futureCount: future }), 422);
    await INVD.startPublish(env, `edit ${slug}`);
    return invBack(SAVED);
  }
  if ((rest[1] === 'remove' || rest[1] === 'restore') && method === 'POST') {
    const on = rest[1] === 'restore';
    const r = await INVD.setAvailable(env, slug, on);
    if (!r.ok) return invBack('', r.errors.join(' '));
    await INVD.startPublish(env, `${rest[1]} ${slug}`);
    const kept = !on && future ? ` ${future} future ${future === 1 ? 'booking keeps' : 'bookings keep'} it.` : '';
    return invBack(`${item.name} ${on ? 'is back' : 'is removed'} ✓${kept} The website updates by itself in about 5 minutes.`);
  }
  return htmlResponse(V.layout('Not found', '<p>Nothing here.</p>', { screen: 'notfound', back: { href: '/admin/settings#inventory', label: 'Back to Settings' } }), 404);
}

// What the form said, to show it again after a refused save.
function formItem(form) {
  const f = INVD.readForm(form);
  return { name: f.name, quantity: Number.isNaN(f.quantity) ? '' : f.quantity, dayPrice: Number.isNaN(f.dayPrice) ? '' : f.dayPrice, weekendPrice: Number.isNaN(f.weekendPrice) ? '' : f.weekendPrice,
    deposit: f.deposit, blurb: f.blurb, alt: f.alt, size: f.size, use: f.use, kind: f.kind };
}
function sectionOfForm(form) {
  const f = INVD.readForm(form);
  return f.onWebsite ? (f.kind === 'extra' ? 'extras' : 'games') : 'adminItems';
}

// Send one email through the MAILER service binding (the pnp-mailer Worker's /send).
function viaMailer(env) {
  return async (m) => {
    if (!env.MAILER) throw new Error('Email is not connected on this copy of the site.');
    const res = await env.MAILER.fetch('https://pnp-mailer.internal/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) });
    const out = await res.json().catch(() => ({}));
    return res.ok && out.ok;
  };
}

export async function handleApi(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  await INVD.useInventory(env);
  if (url.pathname === '/api/admin/inventory/status' && request.method === 'GET') {
    return Response.json(INVD.publishWords(await INVD.publishStatus(env)), { headers: { 'Cache-Control': 'no-store' } });
  }
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
    const allowed = new Set(fieldIndex(liveChecklistSource()).map((f) => f.id));
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
