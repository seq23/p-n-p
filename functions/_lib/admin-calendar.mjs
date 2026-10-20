// Routes for the calendar side of /admin (docs/admin-console.md): Calendar, day view / Day
// sheet, scheduling, Move, notes, rental check-in, Put away, Find a customer, reminders and the
// private ICS feed token. Auth is enforced before this runs (guard.mjs), except the ICS feed,
// which lives in functions/api/calendar/ and checks its own token.
import { redirect, htmlResponse, getSettings, putSetting, fromB64urlText, b64urlText, shortDate, todayISO, FROM_EMAIL } from './util.mjs';
import { loadRequests, loadRequestsFromDb, logEvent } from './requests.mjs';
import * as ST from './steps.mjs';
import { loadTakedownFacts, takedownsToSchedule } from './takedown.mjs';
import { TRACK_TABLE as PRICE_TABLE } from './prices.mjs';
import { autoBookTakedown, inlineKindFor } from './takedown.mjs';
import { servicesOf, SCHEDULE_FIRST } from './cards.mjs';
import { calendarBack } from './admin-steps.mjs';
import { requestedChips, gamesAskedOn, askedDate } from './requested.mjs';
import * as C from './calendar.mjs';
import { notPaidYet } from './notpaid.mjs';
import { balances, balanceWords, depositWords } from './ledger.mjs';
import { tomorrowsBookings, tomorrowChicago, chicagoDate } from './reminders.mjs';
import * as V from './views.mjs';
import * as VC from './views-calendar.mjs';
import * as VM2 from './views-messages.mjs';
import { expireHolds, endingSoon, holdSettings, currentHolds } from './holds.mjs';
import { choiceFrom, createPhoneRequest, NOTE_CHOICE } from './phone-requests.mjs';
import { serviceOfKind, serviceInfo } from './kinds.mjs';

const decodeKey = (v) => { try { return fromB64urlText(v); } catch { return ''; } };
const wantsJson = (request) => request.headers.get('X-Pnp-Fetch') === '1';
const okJson = () => Response.json({ ok: true });

export async function statusMap(db) {
  const { results } = await db.prepare('SELECT * FROM request_status').all();
  const out = {};
  for (const r of results || []) out[r.request_key] = r;
  return out;
}

async function requestsSafe(env, opts) {
  try { return { requests: await loadRequests(env, opts), sheetError: '' }; } catch (e) { return { requests: [], sheetError: e.message || String(e) }; }
}

// Everything a booking row needs to describe itself: balance, notes, check-in.
export async function contextFor(db, bookings) {
  const [bals, returns, notes, holdRows, reqs, statuses, stored] = await Promise.all([balances(db), C.loadReturns(db), C.notesByBooking(db, bookings), db.prepare("SELECT * FROM holds WHERE state = 'held'").all().then((r) => r.results || []).catch(() => []),
    loadRequestsFromDb(db).catch(() => []), statusMap(db), ST.loadStored(db)]);
  const holds = Object.fromEntries(holdRows.map((h) => [h.request_key, h]));
  // Tentative (outlined "Requested · not confirmed") = its request is not confirmed (steps.mjs).
  const unconfirmed = ST.unconfirmedKeys({ requests: reqs, statuses, invoices: bals, returns, stored });
  const delivery = new Set(reqs.filter((r) => C.deliveryAddress(r)).map((r) => r.key));
  const ctx = (b) => ({ bal: b.invoice_id ? bals[b.invoice_id] : null, notes: notes[b.id] || [], ret: returns[C.returnKeyOf(b)], today: chicagoDate(), hold: b.request_key ? holds[b.request_key] || null : null,
    tentative: Boolean(b.request_key && unconfirmed.has(b.request_key)), delivery: Boolean(b.request_key && delivery.has(b.request_key)) });
  return { ctx, bals, returns, notes, unconfirmed };
}

export async function windowsFor(db, returns) {
  return C.rentalWindows(await C.listBookings(db), returns || await C.loadReturns(db), PRICE_TABLE);
}

export async function remindersAndOverdue(db) {
  const today = chicagoDate();
  const reminders = await tomorrowsBookings(db);
  const returns = await C.loadReturns(db);
  const all = await C.listBookings(db, '0000-01-01', today);
  return { reminders, tomorrowLabel: shortDate(tomorrowChicago()), overdue: C.overdueReturns(all, returns, today) };
}

// ---- Put away -------------------------------------------------------------------------

export async function archiveRequest(env, request, on) {
  const form = await request.formData();
  const key = decodeKey(form.get('r'));
  if (key) {
    if (on) {
      await env.DB.prepare(`INSERT INTO request_status (request_key, status, archived_at, updated_at) VALUES (?1, 'new', datetime('now'), datetime('now'))
        ON CONFLICT(request_key) DO UPDATE SET archived_at = datetime('now'), updated_at = datetime('now')`).bind(key).run();
    } else {
      await env.DB.prepare("UPDATE request_status SET archived_at = NULL, updated_at = datetime('now') WHERE request_key = ?1").bind(key).run();
    }
  }
  if (wantsJson(request)) return okJson();
  if (on) return redirect(`/admin/?put=${encodeURIComponent(form.get('r') || '')}`);
  return redirect(form.get('from') === 'archive' ? '/admin/?pa=1&m=Brought back ✓#put-away' : '/admin/?m=Brought back ✓');
}

// ---- Calendar --------------------------------------------------------------------------

export async function calendarPage(env, url) {
  await expireHolds(env.DB);
  const today = chicagoDate();
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : today.slice(0, 7);
  const all = await C.listBookings(env.DB);
  const { ctx, returns, unconfirmed: unconfKeys } = await contextFor(env.DB, all);
  const windows = C.rentalWindows(all, returns, PRICE_TABLE);
  const statuses = await statusMap(env.DB);
  const { requests } = await requestsSafe(env);
  const unconfirmed = C.unconfirmedRequests(requests, statuses, unconfKeys).map((r) => {
    const svc = servicesOf(r)[0];
    // yes: what the shared "Yes, book it" form (views.mjs bookYesForm) needs, the same as the card.
    const mine = all.filter((b) => b.request_key === r.key);
    const services = servicesOf(r);
    return { ...r, summary: V.wantSummary(r, mine).join(' · '), asked: svc ? askedDate(r, svc) : '', color: svc ? serviceInfo(SCHEDULE_FIRST[svc][1]).bar : '',
      yes: services.length ? { rk: b64urlText(r.key), services, bookings: mine } : null };
  });
  const from = C.addDays(`${month}-01`, -7); const to = C.addDays(`${month}-01`, 45);
  const visible = all.filter((b) => (b.date >= from && b.date <= to) || (b.date >= today && b.date <= C.addDays(today, 14)));
  const { reminders, tomorrowLabel, overdue } = await remindersAndOverdue(env.DB);
  const { holdsWithButtons } = await import('./admin.mjs');
  const settings = await getSettings(env.DB);
  const holds = await holdsWithButtons(env, '/admin/calendar');
  const soon = endingSoon(holds, Date.now(), settings);
  // "Still to decide": porch/party takedowns marked Not sure yet (not put away, not void).
  const stillToDecide = requests.filter((r) => r.takedownPlan === 'not_sure' && !(statuses[r.key] && (statuses[r.key].archived_at || statuses[r.key].status === 'void')))
    .map((r) => ({ name: r.name, note: r.takedownNote, rk: b64urlText(r.key), kind: (r.services || []).includes('porch') ? 'porch_takedown' : 'party_takedown' }));
  // "Takedowns to schedule": the customer asked for a takedown that is not booked yet; the day
  // they named prefills the booking screen, nothing is booked until she saves it.
  // inline: "Schedule takedown -> Book takedown" posts the card's own takedown-inline form.
  const toSchedule = takedownsToSchedule(requests, statuses, await loadTakedownFacts(env.DB), today).map((t) => {
    const r = requests.find((x) => x.key === t.key);
    return { ...t, rk: b64urlText(t.key), inline: Boolean(r && inlineKindFor(servicesOf(r)) === t.kind) };
  });
  // Asked for, not booked yet: outlined "Requested" chips (requested.mjs), never bookings.
  const requested = requestedChips(requests, statuses, all, PRICE_TABLE).map((c) => ({ ...c, rk: b64urlText(c.key) }));
  return htmlResponse(VC.calendarPage({ stillToDecide, toSchedule, requested,
    holdsBox: VM2.holdsSoonBox(soon, { soonHours: holdSettings(settings).soonHours, back: '/admin/calendar' }), heldPane: VM2.heldPane(holds),
    month, today, bookings: visible, all, ctx, windows, table: PRICE_TABLE, warnings: C.overlapWarnings(windows, PRICE_TABLE, { today }),
    unconfirmed, reminders, tomorrowLabel, overdue, flash: url.searchParams.get('m') || '', error: url.searchParams.get('e') || '',
  }));
}

export async function daySheetData(env, date) {
  const all = await C.listBookings(env.DB);
  const { ctx, returns } = await contextFor(env.DB, all);
  const windows = C.rentalWindows(all, returns, PRICE_TABLE);
  const bookings = all.filter((b) => b.date === date).sort(C.daySort);
  const rows = bookings.map((b) => {
    const c = ctx(b);
    return { ...b, timeLabel: b.time ? C.prettyTime(b.time) : '', owed: c.bal && !c.bal.void ? c.bal.owed : 0, note: c.notes[0] ? c.notes[0].body : '' };
  });
  const holds = (await currentHolds(env.DB)).filter((h) => !h.by_hand && h.until && C.chicagoDayOf(h.until) === date)
    .map((h) => ({ ...h, timeLabel: new Date(h.untilMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) }));
  // Rentals out with a customer this day, between their pickup and return (owner, 19 Oct 2026).
  const outRows = C.outBetween(windows, date, chicagoDate());
  return { all, ctx, windows, bookings, rows, holds, outRows };
}

export async function dayPage(env, url, date) {
  if (date === 'today') return redirect(`/admin/day/${chicagoDate()}`);
  if (!C.isISODate(date)) return redirect('/admin/calendar');
  const settings = await getSettings(env.DB);
  const { ctx, windows, bookings, rows, holds, outRows } = await daySheetData(env, date);
  const sheetText = C.daySheetText(date, rows, { host: url.host.replace(/^www\./, ''), dayLabel: shortDate(date), holds, outRows });
  // A customer with a balance is booked today: say how much is not paid yet in all.
  const { requests } = await requestsSafe(env);
  const np = await notPaidYet(env.DB, requests, chicagoDate());
  const statuses = await statusMap(env.DB);
  const tdToday = takedownsToSchedule(requests, statuses, await loadTakedownFacts(env.DB), chicagoDate()).filter((t) => t.date === date).map((t) => ({ ...t, rk: b64urlText(t.key) }));
  const reqChips = requestedChips(requests, statuses, await C.listBookings(env.DB), PRICE_TABLE).map((c) => ({ ...c, rk: b64urlText(c.key) }));
  const requested = reqChips.filter((c) => c.date === date);
  const gamesAsked = gamesAskedOn(reqChips, date);
  const owingToday = np.owed.filter((r) => bookings.some((b) => (b.request_key && b.request_key === r.requestKey) || (b.invoice_id && b.invoice_id === r.id)));
  return htmlResponse(VC.dayPage({ outRows, tdToday, requested, gamesAsked, notPaid: owingToday.length ? { today: owingToday.length, count: np.count, total: np.total } : null, holds, date, today: chicagoDate(), bookings, ctx, windows, table: PRICE_TABLE, sheetText, settings, flash: url.searchParams.get('m') || '', error: url.searchParams.get('e') || '' }));
}

// "Email it to me": the full day list to the Settings address, through the mailer.
export async function emailDay(env, url, date) {
  if (!C.isISODate(date)) return redirect('/admin/calendar');
  const settings = await getSettings(env.DB);
  const to = settings.day_list_email || FROM_EMAIL;
  const { rows, holds, outRows } = await daySheetData(env, date);
  const text = C.daySheetText(date, rows, { max: 100000, host: url.host.replace(/^www\./, ''), dayLabel: shortDate(date), holds, outRows });
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div style="font:16px/1.5 Arial,sans-serif;color:#3b302a"><h2>Day list for ${esc(shortDate(date))}</h2>${holds.map((h) => `<p><strong>Hold ends ${esc(h.timeLabel)} · ${esc(h.name || 'No name')}</strong><br>${esc(h.items || '')} · deposit not in yet</p>`).join('')}${outRows.map((w) => `<p><strong>Rental out · ${esc(w.name || 'No name')}</strong><br>${esc(C.namesText(w).join(', '))} · back ${esc(shortDate(w.end))}</p>`).join('')}${rows.map((r) => `<p><strong>${esc(r.timeLabel || 'Any time')} · ${esc(C.KIND_LABELS[r.kind])} · ${esc(r.customer_name || 'No name')}</strong><br>${esc([r.phone, r.items, r.place].filter(Boolean).join(' · '))}${r.owed ? `<br>Still owed: $${(r.owed / 100).toFixed(2)}` : ''}${r.note ? `<br>Note: ${esc(r.note)}` : ''}</p>`).join('') || '<p>Nothing booked.</p>'}</div>`;
  if (!env.MAILER) return redirect(`/admin/day/${date}?e=${encodeURIComponent('Email is not connected on this copy of the site, so nothing was sent.')}`);
  let ok = false; let err = '';
  try {
    const res = await env.MAILER.fetch('https://pnp-mailer.internal/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, replyTo: FROM_EMAIL, subject: `Day list: ${shortDate(date)}`, html, text }) });
    const out = await res.json().catch(() => ({}));
    ok = res.ok && out.ok; err = out.error || String(res.status);
  } catch (e) { err = String(e && e.message ? e.message : e); }
  return redirect(`/admin/day/${date}?${ok ? `m=${encodeURIComponent(`Sent to ${to}`)}` : `e=${encodeURIComponent(`The email did not go out. Please try again in a minute. (${err})`)}`}`);
}

// ---- Scheduling ------------------------------------------------------------------------

async function formExtras(env, date, returnDate, ignoreKey) {
  const all = await C.listBookings(env.DB);
  const returns = await C.loadReturns(env.DB);
  const windows = C.rentalWindows(all, returns, PRICE_TABLE);
  const today = chicagoDate();
  const avail = date ? C.availability(windows, date, returnDate || date, today, PRICE_TABLE, ignoreKey) : null;
  const windowsJson = JSON.stringify(windows.map((w) => ({ key: w.key, start: w.start, last: w.end < today && !w.returnedDay ? today : w.end, returnedDay: w.returnedDay, names: w.names, counts: w.counts }))).replace(/</g, '\\u003c');
  return { avail, windowsJson };
}

export async function newBookingPage(env, url) {
  const rk = url.searchParams.get('r') || '';
  const key = rk ? decodeKey(rk) : '';
  let booking = { kind: 'other', date: url.searchParams.get('date') || '', time: null, customer_name: '', phone: '', email: '', place: '', items: '' };
  let title = 'Add a booking';
  if (key) {
    const { requests } = await requestsSafe(env);
    const req = requests.find((r) => r.key === key);
    if (req) {
      booking = { ...C.bookingFromRequest(req, PRICE_TABLE) };
      if (url.searchParams.get('date')) booking.date = url.searchParams.get('date');
      title = `Put ${V.firstName(req.name)} on the calendar`;
    }
  }
  if (C.isISODate(url.searchParams.get('date'))) booking.date = url.searchParams.get('date');
  const req = key ? (await requestsSafe(env)).requests.find((r) => r.key === key) : null;
  // "Schedule takedown" / "Schedule pickup (optional)" / "Schedule install" on a card pass the kind.
  const wantKind = url.searchParams.get('kind') || '';
  if (C.KINDS.includes(wantKind) && wantKind !== booking.kind) {
    booking.kind = wantKind;
    if (req && /_takedown$|^grazing_pickup$/.test(wantKind) && !url.searchParams.get('date')) {
      const { results } = await env.DB.prepare('SELECT kind, date FROM bookings WHERE request_key = ?1').bind(key).all();
      const first = (results || []).find((b) => /_install$|_setup$/.test(b.kind));
      // The day the owner set, or the form's "Takedown date", or the day after the install/setup.
      booking.date = (/_takedown$/.test(wantKind) && C.isISODate(req.takedownDate) ? req.takedownDate : '') || C.secondDateFor(req, first ? first.date : booking.date);
    }
    if (/_takedown$/.test(wantKind)) title = `Schedule the takedown for ${V.firstName(req ? req.name : booking.customer_name)}`;
    if (wantKind === 'grazing_pickup') title = `Schedule the pickup for ${V.firstName(req ? req.name : booking.customer_name)}`;
  }
  const returnDate = booking.date ? (req ? C.requestReturnDate(req, booking.date) : C.returnDateFor(booking.date, '')) : '';
  const extras = await formExtras(env, booking.date, returnDate, key);
  // No request: ask which service (a phone request on Save) or Just a calendar note.
  const askService = !req;
  const pre = serviceOfKind(booking.kind);
  return htmlResponse(VC.bookingFormPage({ booking, action: '/admin/calendar/bookings', title, rk: req ? rk : '', isNew: true, returnDate, table: PRICE_TABLE, ignoreKey: key, askService, service: askService && pre !== 'other' ? pre : '', ...extras }));
}

function itemsFromForm(form, b) {
  const picked = form.getAll('item').map(String).filter(Boolean);
  if (C.KINDS.includes(b.kind) && /^rental_/.test(b.kind) && picked.length) {
    const typed = b.items.split(/,\s*/).filter((t) => t && !PRICE_TABLE.items.some((i) => t.toLowerCase().includes(i.name.toLowerCase())));
    return [...picked, ...typed].join(', ');
  }
  return b.items;
}

export async function createBookingRoute(env, request) {
  const form = await request.formData();
  const b = C.parseBookingForm(form);
  if (!b.date) return redirect(`/admin/calendar?e=${encodeURIComponent('Pick a day for the booking.')}`);
  let key = form.get('r') ? decodeKey(form.get('r')) : '';
  // No request yet (owner, 18 Oct 2026): a service + a customer makes a phone request, so the
  // booking lands on Requests; "Just a calendar note (no customer)" stays request-less.
  const choice = key ? null : choiceFrom(form, b.kind);
  if (choice) { b.kind = choice.kind; b.calendar_note = choice.service === NOTE_CHOICE ? 1 : 0; }
  b.items = itemsFromForm(form, b);
  const ret = C.parseFormDate(form.get('return_date'));
  // Rentals are a pair: the return is always booked with the pickup (its TIME may be "not sure yet").
  if (b.kind === 'rental_pickup' && !(ret && ret > b.date)) {
    return redirect(`/admin/calendar?e=${encodeURIComponent('A game pickup needs its return day too: pick a return day after the pickup day.')}`);
  }
  const phone = Boolean(choice && choice.service !== NOTE_CHOICE);
  if (phone && !b.customer_name) return redirect(`/admin/calendar?e=${encodeURIComponent('Type the customer name, or pick Just a calendar note.')}`);
  if (phone) {
    const planned = [{ ...b }, ...(b.kind === 'rental_pickup' ? [{ ...b, kind: 'rental_return', date: ret }] : [])];
    key = await createPhoneRequest(env.DB, { service: choice.service, name: b.customer_name, phone: b.phone, email: b.email, bookings: planned });
  }
  let id;
  // Booking a request's first job by hand (Book it on Unconfirmed requests, a drag onto a day,
  // or a card's Book the setup day) is her yes: the request is confirmed (steps.mjs).
  if (key && !C.SECOND_KINDS.has(b.kind)) await ST.markConfirmed(env.DB, key, 'booked by hand');
  if (key) id = await C.saveRequestBooking(env.DB, key, b);
  else id = await C.createBooking(env.DB, b);
  const retTime = String(form.get('return_time') || '').trim();
  if (b.kind === 'rental_pickup') {
    const r = { ...b, kind: 'rental_return', date: ret, time: /^\d{2}:\d{2}$/.test(retTime) ? retTime : null };
    if (key) await C.saveRequestBooking(env.DB, key, r); else await C.createBooking(env.DB, r);
  }
  if (b.note) await C.addNote(env.DB, { id, request_key: key || null }, b.note);
  if (key && /_takedown$/.test(b.kind)) await env.DB.prepare("UPDATE requests SET takedown_plan = 'scheduled' WHERE request_key = ?1").bind(key).run();
  // The install / setup is on the calendar: the takedown date the form gave is booked too, if
  // it was not already (never over a takedown she booked or changed).
  if (key && /^(porch_install|party_setup)$/.test(b.kind)) {
    const { requests } = await requestsSafe(env);
    const req = requests.find((r) => r.key === key);
    if (req) await autoBookTakedown(env.DB, req);
  }
  if (phone) return redirect(`/admin/?m=${encodeURIComponent('Saved ✓ On Requests as a phone booking, and on the calendar.')}#c-${b64urlText(key)}`);
  return redirect(`/admin/day/${b.date}?m=${encodeURIComponent(key ? 'Saved ✓ The request is marked Scheduled.' : 'Saved ✓')}`);
}

async function bookingById(env, id) {
  return env.DB.prepare('SELECT * FROM bookings WHERE id = ?1').bind(id).first();
}

export async function editBookingPage(env, id) {
  const booking = await bookingById(env, id);
  if (!booking) return redirect('/admin/calendar?e=That booking is gone.');
  const extras = await formExtras(env, booking.date, booking.date, booking.request_key || '');
  return htmlResponse(VC.bookingFormPage({ booking, action: `/admin/calendar/bookings/${id}`, title: `Change ${V.firstName(booking.customer_name)}'s booking`, isNew: false, table: PRICE_TABLE, ignoreKey: booking.request_key || '', ...extras }));
}

export async function updateBookingRoute(env, request, id) {
  const form = await request.formData();
  const b = C.parseBookingForm(form);
  if (!b.date) return redirect(`/admin/calendar/bookings/${id}/edit`);
  b.items = itemsFromForm(form, b);
  try { await C.updateBooking(env.DB, id, b); } catch (e) {
    if (/UNIQUE/i.test(String(e))) return redirect(`/admin/calendar/bookings/${id}/edit?e=${encodeURIComponent('This request already has a booking of that kind.')}`);
    throw e;
  }
  return redirect(`/admin/day/${b.date}?m=Saved ✓`);
}

export async function deleteBookingRoute(env, id) {
  const b = await C.deleteBooking(env.DB, id);
  return redirect(b ? `/admin/day/${b.date}?m=${encodeURIComponent('Booking deleted.')}` : '/admin/calendar');
}

export async function movePage(env, id) {
  const booking = await bookingById(env, id);
  if (!booking) return redirect('/admin/calendar');
  return htmlResponse(VC.movePage({ booking }));
}

export async function moveRoute(env, request, id) {
  const form = await request.formData();
  const date = C.parseFormDate(form.get('date'));
  if (!date) return redirect(`/admin/calendar/bookings/${id}/move`);
  await C.moveBooking(env.DB, id, date);
  return redirect(`/admin/day/${date}?m=${encodeURIComponent(`Moved to ${shortDate(date)} ✓`)}`);
}

export async function remindedRoute(env, request, id) {
  await env.DB.prepare("UPDATE bookings SET reminded_at = COALESCE(reminded_at, datetime('now')) WHERE id = ?1").bind(id).run();
  if (wantsJson(request)) return okJson();
  const ref = request.headers.get('Referer') || '';
  return redirect(/\/admin\/calendar/.test(ref) ? '/admin/calendar?m=Reminder marked ✓' : '/admin/?m=Reminder marked ✓');
}

// "Mark takedown done" / "Undo takedown done" on a porch/party takedown booking: ONE tap, any
// day (owner, 18 Oct 2026: "I don't see where I would mark the takedown as done with one click";
// it used to be refused before the takedown day). With Job done and Paid in full, the request is
// then Finished. Back to the card it came from (#c-<rk>) or the Day sheet.
// Step cards (owner-approved 19 Oct 2026) use the same one tap, at /bookings/:id/done, for the
// rental pickup ("Mark picked up", optionally recording the rest as paid: "They paid the rest
// now") and the grazing pickup ("Mark pickup done"). Undo takes back only the done mark; a
// payment recorded with it stays (money is changed on the invoice).
const DONE_KINDS = /_takedown$|^rental_pickup$|^grazing_pickup$/;
const DONE_WORDS = (kind, undo) => {
  const w = kind === 'rental_pickup' ? 'Picked up' : (kind === 'grazing_pickup' ? 'Pickup done' : 'Takedown done');
  return undo ? `${w} undone` : `${w} ✓`;
};
export async function takedownDoneRoute(env, request, id) {
  const form = await request.formData();
  const undo = form.get('undo') === '1';
  const b = await env.DB.prepare('SELECT id, request_key, kind, date FROM bookings WHERE id = ?1').bind(id).first();
  const back = (m, e = false) => {
    const ref = request.headers.get('Referer') || '';
    const to = /\/admin\/day\//.test(ref) && b ? `/admin/day/${b.date}` : '/admin/';
    const anchor = to === '/admin/' && b && b.request_key ? `#c-${b64urlText(b.request_key)}` : '';
    return redirect(`${to}?${e ? 'e' : 'm'}=${encodeURIComponent(m)}${anchor}`);
  };
  if (!b || !DONE_KINDS.test(b.kind)) return back('That booking cannot be marked done here.', true);
  if (undo) await env.DB.prepare('UPDATE bookings SET done_at = NULL WHERE id = ?1').bind(id).run();
  else await env.DB.prepare("UPDATE bookings SET done_at = COALESCE(done_at, datetime('now')) WHERE id = ?1").bind(id).run();
  let paidWords = '';
  if (!undo && b.kind === 'rental_pickup' && form.get('paid_rest') === '1' && b.request_key) {
    const st = await env.DB.prepare('SELECT invoice_id FROM request_status WHERE request_key = ?1').bind(b.request_key).first();
    if (st && st.invoice_id) {
      const { payRest } = await import('./admin.mjs');
      const cents = await payRest(env, st.invoice_id, String(form.get('method') || ''));
      if (cents) paidWords = ` The rest ($${(cents / 100).toFixed(2)}) is recorded as paid.`;
    }
  }
  if (b.request_key) await logEvent(env.DB, b.request_key, `${DONE_WORDS(b.kind, undo)}${paidWords}`, 'admin');
  return back(`${DONE_WORDS(b.kind, undo).replace(' undone', ' undone.')}${paidWords}`);
}

// The inline takedown row on a card (owner, 18 Oct 2026): Save books / moves the porch or party
// takedown (or the grazing pickup) right there, Remove takes it off the calendar. Never a rental.
// Saving marks it her booking (edited_by_hand = 1, so an invoice re-send keeps her day), sets
// takedown_plan = 'scheduled', writes one history line, never changes the request's status
// (calendar.mjs SECOND_KINDS), and comes back to the same card with
// "Takedown on the calendar for Tue 20 Oct ✓".
export async function takedownInlineRoute(env, request) {
  const form = await request.formData();
  const rkIn = String(form.get('r') || '');
  const key = decodeKey(rkIn);
  const go = String(form.get('go') || 'save');
  // back=/admin/calendar...: "Book takedown" in Step 2 of Calendar & Bookings stays on the calendar.
  const calBack = calendarBack(form.get('back'));
  const backTo = (words, err = false) => (calBack
    ? redirect(`${calBack.split('#')[0]}${calBack.includes('?') ? '&' : '?'}${err ? 'e' : 'm'}=${encodeURIComponent(err ? words : `✓ ${words.replace(/ ✓$/, '')}`)}#takedowns-to-schedule`)
    : redirect(err ? `/admin/?e=${encodeURIComponent(words)}#c-${rkIn}` : `/admin/?tdok=${encodeURIComponent(rkIn)}&tdm=${encodeURIComponent(words)}#c-${rkIn}`));
  const { requests } = await requestsSafe(env);
  const req = key ? requests.find((r) => r.key === key) : null;
  if (!req) return redirect(`/admin/?e=${encodeURIComponent('That request could not be found.')}`);
  const kind = inlineKindFor(servicesOf(req));
  if (!kind || String(form.get('kind') || kind) !== kind) return backTo('This request has no takedown to book.', true);
  const grazing = kind === 'grazing_pickup';
  const noun = grazing ? 'Pickup' : 'Takedown';
  const existing = await env.DB.prepare('SELECT * FROM bookings WHERE request_key = ?1 AND kind = ?2').bind(key, kind).first();
  if (go === 'remove') {
    if (existing) await C.deleteBooking(env.DB, existing.id);
    // Clear the asked-for day too, so nothing books it again by itself; the row asks again.
    if (!grazing) await env.DB.prepare("UPDATE requests SET takedown_date = '' WHERE request_key = ?1").bind(key).run();
    await logEvent(env.DB, key, `${noun} taken off the calendar`, 'Valerie');
    return backTo(`${noun} taken off the calendar.`);
  }
  const date = C.parseFormDate(form.get('date'));
  if (!date) return backTo(`Pick a day for the ${noun.toLowerCase()}.`, true);
  const t = String(form.get('time') || '').trim();
  const time = /^\d{2}:\d{2}$/.test(t) ? t : null;
  if (existing) await C.editBookingWhen(env.DB, existing.id, { date, time });
  else {
    const place = (req.decor || []).concat(req.other || []).find((x) => /^location|address|where/i.test(x.label));
    await C.saveRequestBooking(env.DB, key, { kind, date, time, customer_name: req.name || '', phone: req.phone || '', email: req.email || '', place: place ? place.value : '',
      items: kind === 'porch_takedown' ? 'Porch decorating' : (grazing ? 'Grazing table' : (req.eventType ? `Decor: ${req.eventType}` : 'Party decor')) });
  }
  if (!grazing) await env.DB.prepare("UPDATE requests SET takedown_plan = 'scheduled', takedown_date = ?2 WHERE request_key = ?1").bind(key, date).run();
  const when = `${shortDate(date)}${time ? `, ${C.prettyTime(time)}` : ''}`;
  await logEvent(env.DB, key, existing ? `${noun} moved to ${when}` : `${noun} booked for ${when}`, 'Valerie');
  return backTo(`${noun} on the calendar for ${shortDate(date)} ✓`);
}

// ---- Notes ----------------------------------------------------------------------------

const safeBack = (v, fallback) => (/^\/admin\/[A-Za-z0-9/_?=&.%-]*$/.test(String(v || '')) && !String(v).includes('//') ? String(v) : fallback);

export async function addNoteRoute(env, request, id) {
  const form = await request.formData();
  const b = await bookingById(env, id);
  if (!b) return redirect('/admin/calendar');
  await C.addNote(env.DB, b, form.get('body'));
  return redirect(`/admin/day/${b.date}?m=Note saved ✓`);
}

export async function editNoteRoute(env, request, id, del) {
  const form = await request.formData();
  if (del) await C.deleteNote(env.DB, id); else await C.editNote(env.DB, id, form.get('body'));
  return redirect(`${safeBack(form.get('back'), '/admin/calendar')}${String(form.get('back') || '').includes('?') ? '&' : '?'}m=${encodeURIComponent(del ? 'Note deleted.' : 'Note saved ✓')}`);
}

// ---- Rental check-in -------------------------------------------------------------------

async function returnTarget(env, keyB64) {
  const returnKey = decodeKey(keyB64);
  if (!returnKey) return null;
  let requestKey = null; let bookingId = null; let who = ''; let invoiceId = null;
  if (returnKey.startsWith('booking:')) {
    bookingId = Number(returnKey.slice(8));
    const b = await bookingById(env, bookingId);
    if (!b) return null;
    who = b.customer_name; invoiceId = b.invoice_id;
    return { returnKey, requestKey, bookingId, who, invoiceId, itemsText: b.items };
  }
  requestKey = returnKey;
  const { results } = await env.DB.prepare("SELECT * FROM bookings WHERE request_key = ?1 AND kind IN ('rental_pickup','rental_return') ORDER BY date").bind(requestKey).all();
  const first = (results || [])[0];
  const st = await env.DB.prepare('SELECT invoice_id FROM request_status WHERE request_key = ?1').bind(requestKey).first();
  invoiceId = (first && first.invoice_id) || (st && st.invoice_id) || null;
  who = first ? first.customer_name : requestKey.split('|')[1] || 'this rental';
  let itemsText = first ? first.items : '';
  if (invoiceId) {
    const { results: lines } = await env.DB.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?1').bind(invoiceId).all();
    const t = (lines || []).filter((l) => !l.refundable).map((l) => l.description).join(', ');
    if (t) itemsText = t;
  }
  if (!itemsText) {
    const { requests } = await requestsSafe(env);
    const r = requests.find((x) => x.key === requestKey);
    if (r) { itemsText = r.gamesAnswer; who = r.name || who; }
  }
  return { returnKey, requestKey, bookingId, who, invoiceId, itemsText };
}

export async function returnPage(env, url) {
  const k = url.searchParams.get('k') || '';
  const t = await returnTarget(env, k);
  if (!t) return redirect('/admin/calendar?e=That rental could not be found.');
  const exp = C.expandItems(t.itemsText, PRICE_TABLE);
  const items = [...C.namesText(exp), ...Array.from({ length: exp.unnamed }, (_, i) => `Game of their choice ${i + 1}`)];
  const saved = (await C.loadReturns(env.DB))[t.returnKey] || null;
  const bals = t.invoiceId ? (await balances(env.DB))[t.invoiceId] : null;
  const photoKey = `return|${k}`;
  const { results } = await env.DB.prepare('SELECT id FROM checklist_photos WHERE request_key = ?1 ORDER BY id').bind(photoKey).all();
  return htmlResponse(VC.returnPage({ who: t.who, items, saved, returnKeyB64: k, depositWordsText: bals ? depositWords(bals) : '', photos: (results || []).map((p) => ({ url: `/api/admin/checklist/photos/${p.id}` })) }));
}

export async function saveReturnRoute(env, request, url) {
  const k = url.searchParams.get('k') || '';
  const t = await returnTarget(env, k);
  if (!t) return redirect('/admin/calendar');
  const form = await request.formData();
  const back = new Set(form.getAll('back').map(String));
  const damaged = new Set(form.getAll('damaged').map(String));
  const exp = C.expandItems(t.itemsText, PRICE_TABLE);
  const names = [...C.namesText(exp), ...Array.from({ length: exp.unnamed }, (_, i) => `Game of their choice ${i + 1}`)];
  const items = names.map((name) => ({ name, back: back.has(name), damaged: damaged.has(name), note: String(form.get(`note_${name}`) || '').trim().slice(0, 1000) }));
  const res = await C.saveReturn(env.DB, { returnKey: t.returnKey, requestKey: t.requestKey, bookingId: t.bookingId, items, notes: String(form.get('notes') || '').trim().slice(0, 4000) });
  return redirect(`/admin/returns?k=${encodeURIComponent(k)}&m=${encodeURIComponent(res.damaged ? 'Saved. Returned — check damage.' : 'Returned ✓')}`);
}

export async function undoReturnRoute(env, url) {
  const k = url.searchParams.get('k') || '';
  const key = decodeKey(k);
  if (key) await C.undoReturn(env.DB, key);
  return redirect(`/admin/returns?k=${encodeURIComponent(k)}`);
}

// ---- Find a customer -------------------------------------------------------------------

export async function searchData(env, q) {
  const needle = C.normName(q);
  const digits = C.digitsOf(q);
  if (needle.length < 2) return { groups: [], capped: false };
  const like = `%${needle.replace(/[%_]/g, '')}%`;
  const { results } = await env.DB.prepare(`SELECT b.* FROM bookings b
    WHERE b.name_norm LIKE ?1 OR lower(b.email) LIKE ?1 OR (?2 <> '' AND length(?2) >= 3 AND b.phone_digits LIKE '%' || ?2 || '%')
    ORDER BY b.date DESC, b.id DESC LIMIT 51`).bind(like, digits).all();
  const rows = results || [];
  const capped = rows.length > 50;
  const bookings = rows.slice(0, 50);
  const statuses = await statusMap(env.DB);
  const { ctx } = await contextFor(env.DB, bookings);
  const { requests } = await requestsSafe(env);
  const groups = new Map();
  const keyOf = (name, phone) => `${C.normName(name)}|${C.digitsOf(phone).slice(-7)}`;
  const group = (name, phone, email) => {
    const k = keyOf(name, phone);
    if (!groups.has(k)) groups.set(k, { name, phone, email, items: [], paid: 0, owed: 0, invoices: new Set() });
    const g = groups.get(k);
    if (!g.email && email) g.email = email;
    return g;
  };
  for (const b of bookings) {
    const c = ctx(b);
    const st = b.request_key ? statuses[b.request_key] : null;
    const g = group(b.customer_name, b.phone, b.email);
    if (c.bal && !g.invoices.has(b.invoice_id)) { g.invoices.add(b.invoice_id); g.paid += c.bal.void ? 0 : c.bal.paid; g.owed += c.bal.owed; }
    g.items.push({
      type: 'booking', kind: b.kind, date: b.date, items: b.items, href: `/admin/day/${b.date}`,
      archived: Boolean(st && st.archived_at), void: Boolean((st && st.status === 'void') || (c.bal && c.bal.void)),
      balance: c.bal ? (c.bal.void ? 'Void' : `${balanceWords(c.bal)}${c.bal.paid ? ` · paid ${(c.bal.paid / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}` : ''}`) : '',
      returnWords: c.ret && c.ret.returned_at ? (c.ret.damaged ? 'Returned — check damage' : 'Returned ✓') : '',
      note: c.notes[0] ? c.notes[0].body : '',
    });
  }
  const booked = new Set(bookings.map((b) => b.request_key).filter(Boolean));
  for (const r of requests) {
    if (booked.has(r.key)) continue;
    const hit = C.normName(r.name).includes(needle) || String(r.email || '').toLowerCase().includes(needle) || (digits.length >= 3 && C.digitsOf(r.phone).includes(digits));
    if (!hit) continue;
    const st = statuses[r.key];
    const g = group(r.name, r.phone, r.email);
    g.items.push({ type: 'request', date: '', items: V.wantSummary(r).join(' · '), href: st && st.archived_at ? '/admin/archive' : '/admin/', archived: Boolean(st && st.archived_at), void: Boolean(st && st.status === 'void'), balance: '', returnWords: '', note: '' });
  }
  // "Sent you N customers": requests that came in on this customer's referral link.
  for (const r of requests) {
    if (!r.referralCode) continue;
    const n = requests.filter((x) => x.referredBy === r.referralCode).length;
    const g = n ? groups.get(keyOf(r.name, r.phone)) : null;
    if (g) g.sent = (g.sent || 0) + n;
  }
  return { groups: [...groups.values()], capped };
}

export async function searchRoute(env, url) {
  const q = String(url.searchParams.get('q') || '').slice(0, 100);
  const { groups, capped } = await searchData(env, q);
  if (url.searchParams.get('partial') === '1') return htmlResponse(VC.searchResults({ q, groups, capped }));
  return htmlResponse(VC.searchPage({ q, groups, capped }));
}

// ---- Calendar link ----------------------------------------------------------------------

function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function calendarToken(db) {
  const settings = await getSettings(db);
  if (settings.calendar_token && settings.calendar_token.length >= 32) return settings.calendar_token;
  const t = newToken();
  await putSetting(db, 'calendar_token', t);
  return t;
}

export async function linkPage(env, url) {
  const token = await calendarToken(env.DB);
  return htmlResponse(VC.linkPage({ feedUrl: `https://${url.host}/api/calendar/${token}.ics` }));
}

export async function regenerateToken(env) {
  await putSetting(env.DB, 'calendar_token', newToken());
  return redirect('/admin/settings?m=New calendar link made. Add it to Google Calendar again (Calendar, then Link my Google Calendar).');
}

export { todayISO, b64urlText };
