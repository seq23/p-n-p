// Calendar screens for the /admin console: month view with the Unconfirmed requests list,
// a day view that is also the printable Day sheet, the scheduling form, Move, notes, rental
// check-in ("Mark returned"), tomorrow's reminders, "Find a customer" and the Google
// Calendar link page. Same rules as views.mjs: words + colour, 48 px targets, every button
// and link carries a title from helptext.mjs.
import { esc, money, shortDate, prettyDate, b64urlText, STATUS_LABELS } from './util.mjs';
import { tip, hint, STEPS, PANELS } from './helptext.mjs';
import { layout, act, chip, confirmStep, hiddenInputs, BACK_REQUESTS, CARD_CSS, bookYesForm } from './views.mjs';
import { KINDS, KIND_LABELS, prettyTime, addDays, returnKeyOf, firstLine, usageOn, namesText, outBetween } from './calendar.mjs';
import { serviceInfo, serviceKey, SERVICE_KINDS } from './kinds.mjs';
import { gamesAskedOn } from './requested.mjs';
import { PHONE_SERVICES, PHONE_SERVICE_WORDS, NOTE_CHOICE, FIRST_KIND } from './phone-requests.mjs';
import { balanceWords, depositWords } from './ledger.mjs';
import { reminderText, smsLink, normalizePhone, hasEmail } from './reminders.mjs';
import { reservedWords, RESERVED_BY_HAND } from './views-messages.mjs';
import { fromSql } from './holds.mjs';

const RENTAL = new Set(['rental_pickup', 'rental_return']);
const kindTag = (k, label = '') => `<span class="k ${esc(k)}">${esc(label || KIND_LABELS[k] || k)}</span>`;
// Business delivery (owner, 19 Oct 2026): a rental going to a business reads "Delivery" and
// "Collect" (at its address) instead of "Rental pickup" / "Rental return".
const DELIVERY_WORDS = { rental_pickup: 'Delivery', rental_return: 'Collect' };
export const bookingLabel = (b, c) => (c && c.delivery && DELIVERY_WORDS[b.kind]) || KIND_LABELS[b.kind] || b.kind;
const BACK_CAL = { href: '/admin/calendar', label: 'Back to the calendar' };

function tel(phone) {
  const d = normalizePhone(phone);
  return d ? `tel:${d}` : '';
}

// ctx: { bal, notes, ret, today }
export function statusBits(b, { bal, notes = [], ret, today, hold = null }) {
  const bits = [];
  if (hold && hold.state === 'held' && RENTAL.has(b.kind)) bits.push(`<span class="money owe" data-held-booking>${hold.until ? `Games reserved until ${esc(reservedWords(fromSql(hold.until)))}` : RESERVED_BY_HAND} — waiting for deposit</span>`);
  if (bal && !bal.void) {
    bits.push(bal.owed > 0 ? `<span class="money owe" data-owed>${esc(balanceWords(bal))}</span>` : `<span class="money ok" data-paid>${esc(balanceWords(bal))}</span>`);
    if (b.kind === 'rental_pickup' && bal.owed > 0) bits.push(`<span class="money owe" data-collect>Collect ${esc(money(bal.owed))} at pickup</span>`);
  }
  if (b.kind === 'rental_return') {
    if (ret && ret.returned_at) bits.push(`<span class="money ${ret.damaged ? 'owe' : 'ok'}" data-returned>${ret.damaged ? 'Returned — check damage' : 'Returned ✓'}</span>`);
    else if (b.date < today) bits.push('<span class="money late" data-overdue>Not returned yet</span>');
  }
  if (notes.length) bits.push(`<span class="muted" data-latest-note>Note: ${esc(firstLine(notes[0].body))}</span>`);
  return bits.join(' ');
}

const CAL_CSS = `
.money{display:inline-block;font-weight:700;border-radius:8px;padding:1px 8px;font-size:.95rem}
.money.owe{background:#fff3dc;color:#7a4a0c;border:1px solid #ebcf96}.money.ok{background:#e4f1e1;color:#2f5a2b;border:1px solid #b2d3ab}
.money.late{background:#f9e3de;color:#8f3427;border:1px solid #e3ada2}
.badge{display:block;margin-top:2px;font-size:.72rem;font-weight:700;color:#2a3b70}
.due{display:block;font-size:.72rem;font-weight:700;color:#7a4a0c}
.late-dot{display:block;font-size:.72rem;font-weight:700;color:#8f3427}
.strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin:8px 0}
.strip .it{border:1px solid var(--line);border-radius:10px;padding:8px;background:#fff}
.strip .it.out{background:#f3efe9}.strip .it.over{background:#f9e3de;border-color:#e3ada2}
.sheet{width:100%;border-collapse:collapse;font-size:1.05rem}.sheet th,.sheet td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}
.sheet .box{width:28px;height:28px;border:2px solid var(--ink);border-radius:4px;display:inline-block}
.itemcheck{display:flex;gap:10px;align-items:center;min-height:48px;margin:0;color:var(--ink);font-size:1.1rem}
.itemcheck input{width:26px;height:26px;min-height:26px;flex:none}
.itemcheck.na{opacity:.45}
.notes .n{padding:10px 0;border-bottom:1px solid var(--line)}
.found h3{margin-bottom:2px}
/* Requested (asked for, not booked): outlined, never filled. Words always shown. */
.k.req{background:transparent!important;border-style:dashed;border-width:2px;font-weight:600}
.k.req.tent{border-style:dashed;color:var(--ink)}
.tentpill{display:inline-block;padding:1px 8px;border:2px dashed #8a7d73;border-radius:999px;color:#5f5148;font-size:.85rem;font-weight:700;background:#fff;margin:2px 0}
.askedline{margin:6px 0}.askedline a.k{display:inline-flex;align-items:center;min-height:40px;padding:2px 10px;text-decoration:none;color:var(--ink)}
a.k.req{text-decoration:none;color:var(--ink)}
.k.req[role=link]{cursor:pointer}
.badge.asked{color:#4b3f8f}
.k.rental_out{border-color:#1d4ed8;background:repeating-linear-gradient(135deg,#dbeafe 0 8px,#eef4ff 8px 16px);color:#2b2420}a.k.rental_out{text-decoration:none}
.fill-legend{margin:0 0 10px;font-size:.98rem}.fill-legend .k{margin-right:4px}
.reqlist{display:flex;flex-wrap:wrap;gap:8px}.reqlist a.k{display:inline-flex;align-items:center;min-height:44px;padding:4px 12px;font-size:1rem}
/* The Day sheet (owner, 18 Oct 2026: one simple block per job, one printed page). */
.jobs{display:grid;gap:10px}
.job{display:grid;grid-template-columns:34px 1fr;gap:10px;align-items:start;padding:8px 0;border-bottom:1px solid var(--line);break-inside:avoid}
.job .box{width:26px;height:26px;border:2px solid var(--ink);border-radius:4px;display:inline-block;margin-top:2px}
.job .jl{font-size:1.2rem;font-weight:700}.job .ji{font-size:1.05rem}.job .jn{font-style:italic}
.job .jo{font-weight:700;color:#7a4a0c}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin:8px 0}
.grid .tile{position:relative;border:1px solid;border-radius:10px;padding:8px;min-height:64px;overflow:hidden}
.grid .tile strong{position:relative;display:block}.grid .tile span{position:relative;display:block;font-size:.95rem}
.grid .tile.in{background:#e7f5e4;border-color:#9fcb97}
.grid .tile.out{background:#fbe3e0;border-color:#e3a59b;background-image:linear-gradient(to top right,transparent calc(50% - 1px),rgba(143,52,39,.28) 50%,transparent calc(50% + 1px)),linear-gradient(to bottom right,transparent calc(50% - 1px),rgba(143,52,39,.28) 50%,transparent calc(50% + 1px))}
.grid .tile.over{border-width:3px;border-color:#8f3427}
/* Month on a phone: a day-by-day list, full chips (the grid stays from 700 px up). */
.monthlist{display:none}
@media(max-width:899px){.month{display:none}.monthlist{display:grid;gap:8px}}
.mday{border:1px solid var(--line);border-radius:10px;background:#fff;padding:8px 10px;display:grid;gap:6px;min-width:0}
.mday.today{border:2px solid var(--accent)}
.mday .mdh{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;min-height:44px;color:var(--ink);text-decoration:none;font-size:1.1rem}
.mday .mdh .badge{display:inline;margin:0}
.mday .k{display:block;min-height:44px;padding:8px 10px;font-size:1rem;line-height:1.35;text-decoration:none;color:var(--ink);overflow-wrap:anywhere;white-space:normal;max-width:100%;box-sizing:border-box}
.mday .k .ki{font-weight:400}
@media print{
  @page{size:Letter;margin:12mm}
  .notice.ok,.notice.flash,[data-flash],.daytools,.notes form,.dayonly,.btn,.actions,button,form,nav,header.top,.back,.topsteps{display:none!important}
  .wrap{max-width:none;padding:0}h1{font-size:20pt;margin:0 0 6px}h2{font-size:13pt;margin:8px 0 4px}
  .job{padding:4px 0}.job .jl{font-size:13pt}.job .ji{font-size:11pt}
  .grid{grid-template-columns:repeat(4,1fr);gap:4px}.grid .tile{min-height:0;padding:4px 6px;font-size:10pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`;

// ---- Tomorrow's reminders / Overdue returns (Requests and Calendar) -------------------------

// line: true (Requests, owner 19 Oct 2026) folds the box into ONE tappable line at the bottom of
// the page, "3 reminders ▸", that opens to the same box. The Calendar keeps the open box.
export function remindersBox(rows, tomorrowLabel, { line = false, bare = false } = {}) {
  if (!rows.length) return bare ? `<section data-reminders><p class="muted" style="margin:0">No reminders for tomorrow, ${esc(tomorrowLabel)}.</p></section>` : '';
  const items = rows.map((b) => {
    const body = reminderText(b);
    const sms = smsLink(b.phone, body);
    const done = b.reminded_at;
    const mail = hasEmail(b.reminder_email || b.email) ? `mailto:${esc(b.reminder_email || b.email)}?subject=${encodeURIComponent('Reminder from Porch & Party')}&body=${encodeURIComponent(body)}` : '';
    return `<div class="booking" data-reminder="${b.id}"><div>${kindTag(b.kind)} <strong>${esc(b.customer_name || 'No name')}</strong>${b.time ? ` · ${esc(prettyTime(b.time))}` : ''}</div>
      <div class="muted">${esc([b.items, b.place].filter(Boolean).join(' · '))}</div>
      ${done ? '<div class="money ok" data-reminded>Reminder sent ✓</div>' : ''}
      ${b.email_reminded_at ? '<div class="muted">Email reminder sent ✓</div>' : ''}
      <div class="actions">
        ${sms ? act(`<a class="btn${done ? ' ghost' : ''}" href="${esc(sms)}" data-remind-tap="/admin/calendar/bookings/${b.id}/reminded"${tip('rem.text')}>Text reminder</a>`, 'rem.text') : '<p style="margin:0"><strong>No phone on file.</strong></p>'}
        ${!sms && mail ? act(`<a class="btn ghost" href="${mail}"${tip('rem.email')}>Email reminder</a>`, 'rem.email') : ''}
        ${sms && mail && !b.email_reminded_at ? `<form method="post" action="/admin/calendar/bookings/${b.id}/email-reminder">${act(`<button class="btn ghost" type="submit"${tip('rem.emailNow')}>Email them</button>`, 'rem.emailNow')}</form>` : ''}
        ${done ? '' : `<form method="post" action="/admin/calendar/bookings/${b.id}/reminded">${act(`<button class="btn ghost" type="submit"${tip('rem.mark')}>Mark reminded</button>`, 'rem.mark')}</form>`}
      </div></div>`;
  }).join('');
  const left = rows.filter((b) => !b.reminded_at).length;
  const inner = `<h2>Tomorrow's reminders <small class="muted">${esc(tomorrowLabel)}</small></h2>${items}
    <p class="muted" style="margin:8px 0 0">Customers with an email on file also get an email reminder by themselves at about 10 AM.</p>`;
  const box = bare
    ? `<section data-reminders><p class="muted" style="margin:0 0 4px">For ${esc(tomorrowLabel)}${left && left < rows.length ? ` · ${left} still to send` : (!left ? ' · all sent ✓' : '')}</p>${items}<p class="muted" style="margin:8px 0 0">Customers with an email on file also get an email reminder by themselves at about 10 AM.</p></section>`
    : line
    ? `<details class="card remline" data-reminders data-reminders-line><summary${tip('req.reminders')}><span class="remcount">${rows.length} reminder${rows.length === 1 ? '' : 's'}</span> <span class="muted">for tomorrow, ${esc(tomorrowLabel)}${left && left < rows.length ? ` · ${left} still to send` : (!left ? ' · all sent ✓' : '')}</span><span class="remchev" aria-hidden="true">▸</span></summary><div class="remin">${inner}</div></details>`
    : `<section class="card" data-reminders>${inner}</section>`;
  return `${box}
  <script>(function(){document.addEventListener('click',function(e){var a=e.target.closest('[data-remind-tap]');if(!a)return;try{fetch(a.getAttribute('data-remind-tap'),{method:'POST',headers:{'X-Pnp-Fetch':'1'},credentials:'same-origin',keepalive:true});}catch(err){}});})();</script>`;
}

export function overdueBox(rows) {
  if (!rows.length) return '';
  return `<section class="notice err" data-overdue-box><strong>Overdue returns: ${rows.length}</strong>
    ${rows.map((b) => `<div class="booking"><strong>${esc(b.customer_name || 'No name')}</strong> was due back ${esc(shortDate(b.date))}. ${esc(b.items || '')}
      <div class="actions">${tel(b.phone) ? act(`<a class="btn bigcall" href="${tel(b.phone)}"${tip('day.call')}>Call ${esc(b.phone)}</a>`, 'day.call') : ''}
      ${act(`<a class="btn ghost" href="/admin/returns?k=${esc(b64urlText(returnKeyOf(b)))}"${tip('ret.mark')}>Mark returned</a>`, 'ret.mark')}</div></div>`).join('')}</section>`;
}

// ---- Month -----------------------------------------------------------------------------------

const CAL_JS = `
(function(){
  var dragging=null;
  function go(u){location.href=u;}
  function drop(day,el){if(!dragging)return;var d=dragging;dragging=null;
    if(d.type==='request'){go('/admin/calendar/new?r='+encodeURIComponent(d.rk)+'&date='+day);return;}
    if(d.type==='booking'){if(d.date===day)return;var label=el.getAttribute('data-label')||'';
      if(confirm('Move '+d.label+' to '+label+'?')){var f=document.getElementById('move-form');f.action='/admin/calendar/bookings/'+d.id+'/move';f.querySelector('[name=date]').value=day;f.submit();}}}
  function start(el){return el.hasAttribute('data-rk')?{type:'request',rk:el.getAttribute('data-rk')}:{type:'booking',id:el.getAttribute('data-booking'),label:el.getAttribute('data-move-label'),date:el.getAttribute('data-date')};}
  document.querySelectorAll('[data-drag]').forEach(function(el){
    el.addEventListener('dragstart',function(e){dragging=start(el);try{e.dataTransfer.setData('text/plain','x');e.dataTransfer.effectAllowed='move';}catch(err){}});
    el.addEventListener('dragend',function(){document.querySelectorAll('.day.over').forEach(function(c){c.classList.remove('over');});});
    // Pointer events: a pen or a mouse on a browser without HTML5 drag-and-drop.
    el.addEventListener('pointerdown',function(e){if(e.pointerType==='touch'||('draggable' in el&&e.pointerType==='mouse'))return;dragging=start(el);el.setPointerCapture(e.pointerId);});
    el.addEventListener('pointerup',function(e){if(!dragging)return;var t=document.elementFromPoint(e.clientX,e.clientY);var c=t&&t.closest('[data-day]');if(c)drop(c.getAttribute('data-day'),c);else dragging=null;});
  });
  document.querySelectorAll('[data-open]').forEach(function(el){
    function open(e){e.preventDefault();e.stopPropagation();go(el.getAttribute('data-open'));}
    el.addEventListener('click',open);el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' ')open(e);});
  });
  document.querySelectorAll('[data-day]').forEach(function(c){
    c.addEventListener('dragover',function(e){if(!dragging)return;e.preventDefault();c.classList.add('over');});
    c.addEventListener('dragleave',function(){c.classList.remove('over');});
    c.addEventListener('drop',function(e){e.preventDefault();c.classList.remove('over');drop(c.getAttribute('data-day'),c);});
  });
})();`;

export function searchBox(q = '', { bare = false } = {}) {
  return `<form class="${bare ? 'findbar' : 'card'}" method="get" action="/admin/search" role="search" data-search>
    <label for="find" ${bare ? 'class="vh"' : 'style="margin-top:0;font-size:1.1rem;color:var(--ink)"'}><strong>Find a customer — type a name</strong></label>
    ${bare ? '<span class="findrow">' : ''}<input id="find" name="q" type="search" value="${esc(q)}" autocomplete="off" placeholder="${bare ? 'Find a customer: name, phone or email' : 'For example: Jane, or 901 555'}" data-find${tip('find.box')}>
    ${bare ? `<button class="btn ghost" type="submit"${tip('find.go')}>Find</button></span>` : `<div style="margin-top:8px">${act(`<button class="btn ghost" type="submit"${tip('find.go')}>Find</button>`, 'find.go')}</div>`}
    <div id="find-results" aria-live="polite"></div></form>
  <script>(function(){var i=document.querySelector('[data-find]'),out=document.getElementById('find-results'),t=null,last='';if(!i||!out)return;
    i.addEventListener('input',function(){clearTimeout(t);t=setTimeout(function(){var q=i.value.trim();if(q===last)return;last=q;if(q.length<2){out.innerHTML='';return;}
      fetch('/admin/search?partial=1&q='+encodeURIComponent(q),{credentials:'same-origin'}).then(function(r){return r.text();}).then(function(h){if(i.value.trim()===q)out.innerHTML=h;});},300);});})();</script>`;
}

// "Takedowns to schedule" (owner, 18 Oct 2026): the customer asked for a takedown that is not
// on the calendar yet. Their day prefills the booking screen; nothing is booked until she saves.
export function toScheduleBox(rows = [], { inline = false, back = '/admin/calendar' } = {}) {
  if (inline) {
    return `<section class="sub" id="takedowns-to-schedule" data-takedowns-to-schedule><h3>Takedowns to schedule (${rows.length})</h3>
      ${rows.length ? rows.map((d) => `<div class="u" data-td-to-schedule><strong>${esc(d.name || 'No name')}</strong> <span class="muted">${esc(KIND_LABELS[d.kind])}${d.date ? ` · asked for ${esc(shortDate(d.date))}` : ' · no day given yet'}${d.note ? ` · ${esc(d.note)}` : ''}</span>
        ${d.inline ? `<details class="yes" data-td-inline><summary class="btn primary"${tip('cal.tdOpen')}>Schedule takedown</summary>
          <form method="post" action="/admin/requests/takedown-inline" data-td-book>${hiddenInputs({ r: d.rk, kind: d.kind, go: 'save', back })}<label for="td-${esc(d.rk)}">Takedown day</label><input type="date" id="td-${esc(d.rk)}" name="date" value="${esc(d.date || '')}" required${tip('step.date')}><button class="btn primary" type="submit"${tip('cal.tdBook')}>Book takedown</button></form></details>` : ''}
        <p class="rowlinks"><a href="/admin/calendar/new?r=${esc(d.rk)}&amp;kind=${esc(d.kind)}${d.date ? `&amp;date=${esc(d.date)}` : ''}"${tip('cal.tdToSchedule')}>More choices</a> · <a href="/admin/#c-${esc(d.rk)}"${tip('cal.decideOpen')}>Open the request</a></p>
        ${d.inline ? `<form method="post" action="/admin/requests/takedown" data-td-not-needed>${hiddenInputs({ r: d.rk, plan: 'customer_handles', back })}<button class="btn ghost" type="submit"${tip('cal.tdNotNeeded')}>Not needed</button></form>` : ''}</div>`).join('') : '<p class="muted" style="margin:0">Nothing waiting.</p>'}</section>`;
  }
  if (!rows.length) return '';
  return `<section class="card notice warn" id="takedowns-to-schedule" data-takedowns-to-schedule><h2>Takedowns to schedule</h2><p class="muted">The customer asked for a takedown. The job is not Finished until it is done. Tap to book it on the day they asked for.</p>
      ${rows.map((d) => `<div class="u" data-td-to-schedule><strong>${esc(d.name || 'No name')}</strong> <span class="muted">${esc(KIND_LABELS[d.kind])}${d.date ? ` · asked for ${esc(shortDate(d.date))}` : ' · no day given yet'}${d.note ? ` · ${esc(d.note)}` : ''}</span>
        <div class="actions" style="grid-template-columns:1fr 1fr"><a class="btn primary" href="/admin/calendar/new?r=${esc(d.rk)}&amp;kind=${esc(d.kind)}${d.date ? `&amp;date=${esc(d.date)}` : ''}"${tip('cal.tdToSchedule')}>Schedule takedown${d.date ? ` (${esc(shortDate(d.date))})` : ''}</a><a class="btn ghost" href="/admin/#c-${esc(d.rk)}"${tip('cal.decideOpen')}>Open the request</a></div></div>`).join('')}</section>`;
}

// One "Requested" chip: outlined in the service colour, the word Requested, first name + last
// initial. Tap opens the request card. In a month cell (itself a link to the day) it is a
// span with role=link (CAL_JS opens it); elsewhere a real link.
export function requestedChip(c, tag = 'a') {
  const href = `/admin/#c-${c.rk}`;
  const what = `${c.part === 'out' ? OUT_WORDS : c.part === 'return' ? 'Rental return' : SERVICE_KINDS[c.service].short}: ${c.name}`;
  // The month grid (owner-approved calm calendar, 19 Oct 2026): "? Party: Rene P." in a dashed
  // outline; the legend says what ? means. Lists, the Day sheet and a phone's day keep the words.
  const words = tag === 'a' ? `${TENT_WORDS} · ${what}` : `? ${what}`;
  const attrs = `class="k req ${esc(c.kind)}" style="border-color:${esc(c.color)}" data-requested="${esc(c.service)}"${tip('cal.requested')}`;
  return tag === 'a' ? `<a ${attrs} href="${esc(href)}">${esc(words)}</a>` : `<span ${attrs} role="link" tabindex="0" data-open="${esc(href)}">${esc(words)}</span>`;
}

// "Rental out" on every day between a rental's pickup and its return (owner, 19 Oct 2026): the
// games are with the customer, so the span reads pickup chip, Rental out, ..., return chip.
export const OUT_WORDS = 'Rental out';
// Tentative = asked for, not confirmed (owner, 19 Oct 2026): every request's date shows OUTLINED
// from the moment it arrives, for all four services, and turns solid only on "Yes, book it" on its
// card (or a deposit, a phone booking, a done job: steps.mjs isConfirmed). A booking that already
// exists for an unconfirmed request (a held rental, an invoice sent) is outlined the same way.
export const TENT_WORDS = 'Requested · not confirmed';
const tentAttrs = (b, c) => (c && c.tentative ? ` data-tentative style="border-color:${esc(serviceInfo(b.kind).bar)}"` : '');
const tentClass = (c) => (c && c.tentative ? ' req tent' : '');
const tentWords = (c, held) => (c && c.tentative ? `${TENT_WORDS}${held ? ' (games held)' : ''} · ` : (held ? 'Held · ' : ''));
export function outChips(windows, day, today, tag = 'span') {
  return outBetween(windows, day, today).map((w) => {
    const words = `${OUT_WORDS}: ${tag === 'a' ? (w.name || 'No name') : firstLine(w.name, 18)}`;
    const back = ` <span class="ki">· back ${esc(shortDate(w.end))}</span>`;
    return tag === 'a'
      ? `<a class="k rental_out" href="/admin/day/${esc(day)}" data-rental-out="${esc(w.key)}"${tip('cal.rentalOut')}>${esc(words)}${back}</a>`
      : `<span class="k rental_out" data-rental-out="${esc(w.key)}"${tip('cal.rentalOut')}>${esc(words)}</span>`;
  }).join('');
}

export function fillLegend() {
  const s = SERVICE_KINDS.porch;
  return `<div class="fill-legend" data-fill-legend${tip('cal.legend')}><span class="k porch_install">Booked</span><span class="k req" style="border-color:${s.bar}">Requested</span> Filled = booked (you said yes) · Outlined = requested, not confirmed yet</div>`;
}

// The calm Calendar & Bookings (owner-approved mock-up, 19 Oct 2026). On a computer (>= 900 px)
// the month comes first and largest, numbered steps 1-4 sit in the right margin and Step 5 (the
// next 14 days) under the month. On a phone: Step 1's search at the top, a small month with a
// coloured dot per job (hollow = not confirmed), the tapped day's jobs right under it (each opens
// to its details), then Steps 2-5 as numbered rows that fold. Every booking (the old List) is a
// section at the bottom. "Yes, book it" here is the Requests card's own form (bookYesForm ->
// POST /admin/requests/talked), one code path. Nothing that was on the page is gone, only moved.
const CALM_CSS = `
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.calm{display:grid;gap:16px;margin:0 0 16px}
.calmain,.calside{display:grid;gap:16px;align-content:start;min-width:0}
.cstep{background:var(--card);border-radius:14px;padding:14px 16px;min-width:0;box-shadow:0 1px 0 var(--line)}
.cstep>.csh{display:flex;gap:10px;align-items:center;margin:0;font:600 1.2rem/1.2 "Cormorant Garamond",Georgia,serif;color:var(--ink);list-style:none}
.cstep>summary.csh{cursor:pointer;min-height:48px}.cstep>summary.csh::-webkit-details-marker{display:none}
.cstep .n{flex:none;width:28px;height:28px;border-radius:50%;background:var(--accent);color:#fff;font:700 .95rem Inter,Arial,sans-serif;display:inline-flex;align-items:center;justify-content:center}
.cstep .spt{flex:1;min-width:0}.cstep .cnt{font:600 .95rem Inter,Arial,sans-serif;color:var(--muted)}
.cstep .chev{display:inline-block;color:var(--accent);font-size:1rem;transition:transform .2s}.cstep[open] .chev{transform:rotate(90deg)}
.cstep .spl{margin:4px 0 10px;color:var(--muted);font-size:.98rem}
.cstep .csb{display:grid;gap:10px;min-width:0}
.cstep .sub h3{font:700 .95rem Inter,Arial,sans-serif;margin:6px 0 6px}
.cstep .u{background:var(--cream);border:0;border-radius:10px;padding:10px;margin:0 0 8px;display:grid;gap:6px;min-width:0}
.cstep .u[draggable=true]{cursor:grab}
.cstep .rowlinks{margin:0;font-size:.95rem}.cstep .s1links{display:flex;flex-wrap:wrap;gap:0 18px}.cstep .rowlinks a{display:inline-flex;min-height:36px;align-items:center}
.cstep .btn{min-height:46px;padding:8px 14px;font-size:1rem}
.cstep details.yes>summary{list-style:none}.cstep details.yes>summary::-webkit-details-marker{display:none}
details.yes[open]>summary{display:none}
details.yes form{display:grid;gap:6px;margin:0}details.yes label{margin:0;font-size:.95rem;color:var(--muted)}
.findbar{margin:0}.findrow{display:flex;gap:8px}.findrow input{flex:1;min-width:0}.findrow .btn{width:auto;flex:none}
.calcal{min-width:0}
.mhead{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:0 0 8px}
.mhead h2{flex:1;margin:0;font-size:1.6rem;min-width:10ch}
.mnav{display:flex;gap:6px}.mnav .btn{width:auto;min-height:44px;padding:6px 12px;font-size:.95rem}
.views{display:flex;gap:6px}.views .btn{width:auto;min-height:44px;padding:6px 14px;font-size:.95rem}
.calcal .legend{margin:0 0 6px;font-size:.85rem}.calcal .legend .k{font-size:.8rem}
.calcal .fill-legend{font-size:.92rem;color:var(--muted)}
.month .day .k.req,.month .day .k.tent{border-style:dashed}
.cstep .upcoming .item{padding:10px 0}
.evb{margin:8px 0 0}.evb>summary{list-style:none}.evb>summary::-webkit-details-marker{display:none}
.evb>summary{cursor:pointer;min-height:48px;display:flex;align-items:center;font-weight:600;color:var(--accent)}
.evb .links{margin:8px 0}
/* Phone month: dots, a tapped day, a job that opens */
.pmonth{display:none}
.pmonth .pdw{font-size:.75rem;color:var(--muted);text-align:center}
.pmonth .pd{display:grid;justify-items:center;gap:3px;padding:6px 0 4px;border-radius:10px;text-decoration:none;color:var(--ink);min-height:48px;min-width:0}
.pmonth .pd.out{opacity:.4}.pmonth .pd.today{background:#fbf0ea}.pmonth .pd.sel{outline:2px solid var(--accent);outline-offset:-2px}
.pmonth .pd b{font-size:.95rem;font-weight:600}
.pmonth .dots{display:flex;gap:2px;height:8px;flex-wrap:nowrap}.pmonth .dots i{width:7px;height:7px;border-radius:50%;border:1.5px solid;box-sizing:border-box}
.pmonth .dots i.tent{background:transparent!important}
.pmonth .dots i.more{border:0;width:auto;height:auto;font:700 .6rem/1 Inter,Arial,sans-serif;font-style:normal;color:var(--muted)}
.monthlist .mday{background:var(--card);border:0;box-shadow:0 1px 0 var(--line)}
.mday .pj{border-left:5px solid;border-radius:8px;background:var(--cream);padding:0;min-width:0}
.mday .pj.tent{border-left-style:dashed}
.mday .pj>summary{list-style:none;cursor:pointer;padding:8px 10px;min-height:44px;display:grid;gap:2px}.mday .pj>summary::-webkit-details-marker{display:none}
.mday .pj .pjw{font-size:.88rem;color:var(--muted)}
.mday .pj .pjb{padding:0 10px 10px;display:grid;gap:8px}
.mday dl.jd{margin:0;display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:.95rem}.mday dl.jd dt{color:var(--muted)}.mday dl.jd dd{margin:0;overflow-wrap:anywhere}
.mday .jb{display:flex;flex-wrap:wrap;gap:6px;margin:0}.mday .jb .btn{width:auto;min-height:44px;padding:6px 12px;font-size:.95rem}
.mday .jb details.yes{flex-basis:100%}
@media(min-width:900px){.calm{grid-template-columns:minmax(0,1fr) 320px;gap:22px;align-items:start}
  .cstep>summary.csh{cursor:default}.cstep>summary.csh .chev{display:none}}
@media(max-width:899px){.calm{display:flex;flex-direction:column}.calmain,.calside{display:contents}
  [data-calstep="1"]{order:1}.calcal{order:2}[data-calstep="2"]{order:3}[data-calstep="3"]{order:4}[data-calstep="4"]{order:5}[data-calstep="5"]{order:6}
  .pmonth{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;margin:0 0 8px}
  .monthlist .mday{display:none}.monthlist .mday.sel{display:grid}
  .mhead h2{font-size:1.35rem}.calcal .legend{display:none}
  .cstep{padding:4px 14px}.cstep[open]{padding-bottom:14px}.cstep[data-calstep="1"]{padding:12px 14px}
  .cstep>.csh{font-size:1.1rem}}
@media print{.calside,.pmonth,.mhead .views,.evb{display:none!important}}
`;

const calmStep = (n, inner, { fold = true, count = '' } = {}) => {
  const title = `<span class="n">${n}</span><span class="spt">${esc(STEPS.calendar[n - 1])}</span>${count !== '' ? `<span class="cnt">(${esc(String(count))})</span>` : ''}`;
  const body = `<p class="spl">${esc(PANELS.calendar[n - 1])}</p><div class="csb">${inner}</div>`;
  return fold
    ? `<details class="cstep" id="calstep-${n}" data-calstep="${n}" open><summary class="csh"${tip('cal.stepRow')}>${title}<span class="chev" aria-hidden="true">▸</span></summary>${body}</details>`
    : `<section class="cstep" id="calstep-${n}" data-calstep="${n}"><h2 class="csh">${title}</h2>${body}</section>`;
};

// One job on a phone's tapped day: a row that opens to time, where, what to bring, what is left
// to collect (or Paid in full ✓), the deposit, then Call · Text · Open their card (· Yes, book it).
function phoneJob(b, c, day, yesFor) {
  const s = serviceInfo(b.kind);
  const held = RENTAL.has(b.kind) && c.hold && c.hold.state === 'held';
  const ret = c.ret;
  const words = `${bookingLabel(b, c)}${b.kind === 'rental_return' && ret && ret.returned_at ? ' ✓' : ''}: ${b.customer_name || 'No name'}`;
  const bal = c.bal && !c.bal.void ? c.bal : null;
  const rows = [['Time', b.time ? prettyTime(b.time) : 'Any time this day']];
  if (b.place) rows.push(['Where', b.place]);
  if (b.items) rows.push([RENTAL.has(b.kind) ? 'Games' : 'Bring', b.items]);
  rows.push(['Collect', bal ? (bal.owed > 0 ? `${money(bal.owed)} still to collect` : 'Paid in full ✓') : 'No invoice yet']);
  if (bal && bal.refundable) rows.push(['Deposit', depositWords(bal)]);
  if (held) rows.push(['Reserved', c.hold.until ? `Games reserved until ${reservedWords(fromSql(c.hold.until))}, waiting for the deposit` : `${RESERVED_BY_HAND}, waiting for the deposit`]);
  if (c.notes && c.notes.length) rows.push(['Note', firstLine(c.notes[0].body)]);
  const phone = normalizePhone(b.phone);
  const rk = b.request_key ? b64urlText(b.request_key) : '';
  const yes = c.tentative && b.request_key && yesFor[b.request_key] ? yesBox(yesFor[b.request_key], `p${day.replace(/-/g, '')}${b.id}`) : '';
  return `<details class="pj${c.tentative ? ' tent' : ''}" style="border-color:${esc(s.bar)}" data-pjob="${b.id}"${c.tentative ? ' data-tentative' : ''}><summary${tip('cal.pjob')}><span class="k ${esc(b.kind)}${tentClass(c)}" data-list-booking="${b.id}"${tentAttrs(b, c)}>${esc(tentWords(c, held))}${esc(words)}</span><span class="pjw">${c.tentative ? 'Not confirmed yet · call them back' : 'Booked'} · tap for more</span></summary>
    <span class="pjb"><dl class="jd">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <span class="jb">${phone ? `<a class="btn ghost" href="tel:${phone}"${tip('day.call')}>Call</a><a class="btn ghost" href="sms:${phone}"${tip('cal.jobText')}>Text</a>` : ''}${rk ? `<a class="btn ghost" href="/admin/#c-${esc(rk)}"${tip('cal.openCard')}>Open their card</a>` : `<a class="btn ghost" href="/admin/day/${esc(day)}"${tip('cal.daySheet')}>Open the day sheet</a>`}${yes}</span></span></details>`;
}

// A request asked for this day with no booking yet (outlined): the same row, from the request.
function phoneAsked(c, day, yesFor) {
  const s = SERVICE_KINDS[c.service];
  const words = `${TENT_WORDS} · ${c.part === 'out' ? OUT_WORDS : c.part === 'return' ? 'Rental return' : s.short}: ${c.name}`;
  const y = yesFor[c.key];
  const r = y ? y.r : null;
  const phone = r ? normalizePhone(r.phone) : '';
  const rows = [['Asked for', shortDate(day)]];
  if (y && y.summary) rows.push(['What', y.summary]);
  return `<details class="pj tent" style="border-color:${esc(c.color)}" data-pjob-asked="${esc(c.rk)}" data-tentative><summary${tip('cal.pjob')}><span class="k req ${esc(c.kind)}" style="border-color:${esc(c.color)}" data-requested="${esc(c.service)}">${esc(words)}</span><span class="pjw">Not confirmed yet · call them back · tap for more</span></summary>
    <span class="pjb"><dl class="jd">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <span class="jb">${phone ? `<a class="btn ghost" href="tel:${phone}"${tip('day.call')}>Call</a><a class="btn ghost" href="sms:${phone}"${tip('cal.jobText')}>Text</a>` : ''}<a class="btn ghost" href="/admin/#c-${esc(c.rk)}"${tip('cal.openCard')}>Open their card</a>${y ? yesBox(y, `q${day.replace(/-/g, '')}${c.rk.slice(0, 6)}${c.part || ''}`) : ''}</span></span></details>`;
}

// "Yes, book it" -> the day(s) prefilled -> "Book it": the Requests card's form, back here.
function yesBox(y, idp) {
  return `<details class="yes" data-yes-book><summary class="btn primary"${tip('cal.yesOpen')}>Yes, book it</summary>${bookYesForm(y.r, y, { label: 'Book it', idp, back: y.back, key: 'cal.bookYes' })}</details>`;
}

export function calendarPage({ stillToDecide = [], toSchedule = [], requested = [], month, today, bookings, all = bookings, ctx, windows, table, warnings, unconfirmed = [], reminders, tomorrowLabel, overdue, flash = '', error = '', holdsBox = '', heldPane = '' }) {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const startPad = new Date(`${first}T12:00:00Z`).getUTCDay();
  const gridStart = addDays(first, -startPad);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const back = `/admin/calendar?month=${month}`;
  const yesFor = Object.fromEntries(unconfirmed.filter((r) => r.yes).map((r) => [r.key, { ...r.yes, r, summary: r.summary, back }]));
  const byDay = {};
  for (const b of bookings) (byDay[b.date] = byDay[b.date] || []).push(b);
  const reqByDay = {};
  for (const c of requested) (reqByDay[c.date] = reqByDay[c.date] || []).push(c);
  const cells = [];
  const pcells = [];
  for (let i = 0; i < 42; i += 1) {
    const day = addDays(gridStart, i);
    if (i >= 35 && day.slice(0, 7) !== month) break;
    const list = byDay[day] || [];
    const games = usageOn(windows, day, today, table).count;
    const owes = list.some((b) => { const bal = ctx(b).bal; return bal && !bal.void && bal.owed > 0; });
    const late = list.some((b) => b.kind === 'rental_return' && b.date < today && !(ctx(b).ret && ctx(b).ret.returned_at));
    cells.push(`<a class="day${day.slice(0, 7) !== month ? ' out' : ''}${day === today ? ' today' : ''}" href="/admin/day/${day}" data-day="${day}" data-label="${esc(shortDate(day))}"${tip('cal.day')}>
      <span class="d">${Number(day.slice(8))}</span>
      ${list.map((b) => {
        const r = ctx(b).ret;
        const mark = b.kind === 'rental_return' && r && r.returned_at ? ' ✓' : '';
        const held = RENTAL.has(b.kind) && ctx(b).hold && ctx(b).hold.state === 'held';
        const c = ctx(b);
        return `<span class="k ${esc(b.kind)}${tentClass(c)}" draggable="true" data-drag data-booking="${b.id}" data-date="${esc(b.date)}"${held ? ' data-held-chip' : ''}${tentAttrs(b, c)} data-move-label="${esc(`${b.customer_name || 'this'}'s ${String(KIND_LABELS[b.kind]).toLowerCase()}`)}"${tip(c.tentative ? 'cal.tentative' : (held ? 'cal.heldChip' : 'cal.booking'))}>${esc(gridTent(c, held))}${esc(bookingLabel(b, c))}${mark}: ${esc(firstLine(b.customer_name, 18))}</span>`;
      }).join('')}
      ${outChips(windows, day, today, 'span')}
      ${(reqByDay[day] || []).map((c) => requestedChip(c, 'span')).join('')}
      ${games ? `<span class="badge" data-games-out>${games} ${games === 1 ? 'game' : 'games'} out</span>` : ''}
      ${gamesAskedOn(requested, day) ? `<span class="badge asked" data-games-asked${tip('cal.gamesAsked')}>${gamesAskedOn(requested, day)} ${gamesAskedOn(requested, day) === 1 ? 'game' : 'games'} asked for</span>` : ''}
      ${owes ? '<span class="due" data-due>$ due</span>' : ''}${late ? '<span class="late-dot">Not returned yet</span>' : ''}
    </a>`);
    // The phone month: one dot per job in its service colour, hollow = not confirmed yet.
    const dots = [...list.map((b) => ({ bar: serviceInfo(b.kind).bar, tent: ctx(b).tentative })),
      ...(reqByDay[day] || []).filter((c) => c.part !== 'out').map((c) => ({ bar: c.color, tent: true }))];
    pcells.push(`<a class="pd${day.slice(0, 7) !== month ? ' out' : ''}${day === today ? ' today' : ''}" href="${day.slice(0, 7) === month ? `#d-${day}` : `/admin/calendar?month=${day.slice(0, 7)}#d-${day}`}" data-pday="${day}"${tip('cal.pday')}><b>${Number(day.slice(8))}</b><span class="dots" aria-hidden="true">${dots.slice(0, 4).map((d) => `<i class="${d.tent ? 'tent' : ''}" style="border-color:${esc(d.bar)};background:${esc(d.bar)}"></i>`).join('')}${dots.length > 4 ? `<i class="more">+${dots.length - 4}</i>` : ''}</span><span class="vh">${dots.length ? `${dots.length} ${dots.length === 1 ? 'job' : 'jobs'}` : 'nothing booked'}</span></a>`);
  }
  // The phone's tapped day: every day of the month has its panel (one shows at a time); the
  // default is today in this month, else the first day with something on it, else the 1st.
  const days = [];
  for (let day = first; day.slice(0, 7) === month; day = addDays(day, 1)) days.push(day);
  const busy = (d) => (byDay[d] || []).length || (reqByDay[d] || []).length;
  const selDay = days.includes(today) ? today : (days.find(busy) || first);
  const listDays = days.map((day) => {
    const list = byDay[day] || []; const asked = reqByDay[day] || [];
    const outs = outChips(windows, day, today, 'a');
    const games = usageOn(windows, day, today, table).count;
    const wd = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    return `<section class="mday${day === today ? ' today' : ''}${day === selDay ? ' sel' : ''}" id="d-${day}" data-month-day="${day}"><a class="mdh" href="/admin/day/${day}"${tip('cal.day')}><strong>${esc(wd)}</strong>${day === today ? ' <span class="muted">today</span>' : ''}${games ? ` <span class="badge" data-games-out>${games} ${games === 1 ? 'game' : 'games'} out</span>` : ''}</a>
      ${list.map((b) => phoneJob(b, ctx(b), day, yesFor)).join('')}
      ${outs}${asked.map((c) => phoneAsked(c, day, yesFor)).join('')}
      ${!list.length && !asked.length && !outs ? '<p class="muted" style="margin:0">Nothing booked. Tap another day.</p>' : `<p class="rowlinks" style="margin:0"><a href="/admin/day/${day}"${tip('cal.daySheet')}>Open the day sheet</a></p>`}</section>`;
  });
  const monthList = `<div class="monthlist" data-month-list data-phone-day>${listDays.join('')}</div>`;
  const upcoming = bookings.filter((b) => b.date >= today && b.date <= addDays(today, 14));
  // Requested dates (outlined, not confirmed) are in Upcoming too, so a request a few days out
  // is seen without paging the month (owner, 19 Oct 2026: a 3 Nov request looked "unscheduled").
  const upReq = requested.filter((c) => (!c.part || c.part === 'pickup') && c.date >= today && c.date <= addDays(today, 14));
  const upRows = [...upcoming.map((b) => ({ date: b.date, time: b.time || '', html: `<a class="item" href="/admin/day/${esc(b.date)}"${tip('cal.day')}>
      <strong>${esc(shortDate(b.date))}${b.time ? `, ${esc(prettyTime(b.time))}` : ''}</strong> ${kindTag(b.kind, bookingLabel(b, ctx(b)))}${ctx(b).tentative ? ` <span class="tentpill" data-tentative-pill>${TENT_WORDS}</span>` : ''} ${esc(b.customer_name || 'No name')}<br><span class="muted">${esc([b.items, ctx(b).delivery ? b.place : ''].filter(Boolean).join(' · '))}</span> ${statusBits(b, ctx(b))}</a>` })),
    ...upReq.map((c) => ({ date: c.date, time: '', html: `<div class="item" data-upcoming-requested><strong>${esc(shortDate(c.date))}</strong> ${requestedChip(c, 'a')}</div>` }))]
    .sort((x, y2) => (x.date + x.time).localeCompare(y2.date + y2.time));
  const upcomingHtml = `<section class="upcoming" data-upcoming><h3 class="vh">Upcoming (next 14 days)</h3>${upRows.length ? upRows.map((x) => x.html).join('') : '<p class="muted" style="margin:0">Nothing in the next 14 days.</p>'}</section>`;
  const warn = warnings.length ? `<div class="notice err" data-overlap><strong>Double-booked:</strong>${warnings.map((w) => `<div>${esc(w.item)} (you have ${w.stock}) is out with ${esc(w.who.map((x) => `${x.name} (${shortDate(x.start)} to ${shortDate(x.end)})`).join(' and '))}. Starts ${esc(shortDate(w.first))}.</div>`).join('')}</div>` : '';
  // Unconfirmed requests (owner, 19 Oct 2026; was "Unscheduled requests"): every live request
  // she has not said yes to. Each stays here, outlined on its asked-for day, until "Yes, book it"
  // (here or on its card) or a drag onto a day; then it leaves the list and its day turns solid.
  const uns = `<section class="sub unsched" data-unconfirmed><h3>Unconfirmed requests (${unconfirmed.length})</h3>
    ${unconfirmed.length ? unconfirmed.map((r) => `<div class="u" draggable="true" data-drag data-rk="${esc(b64urlText(r.key))}" data-unconfirmed-row${tip('cal.unconfirmed')}><strong>${esc(r.name || 'No name')}</strong><span class="muted">${esc(r.summary || '')}</span>
      ${r.asked ? `<p class="askedline" data-asked="${esc(r.asked)}">Asked for <a class="k req" style="border-color:${esc(r.color || '#999')}" href="/admin/calendar?month=${esc(r.asked.slice(0, 7))}#d-${esc(r.asked)}"${tip('cal.askedDay')}>${esc(shortDate(r.asked))}</a> · not confirmed yet</p>` : '<p class="askedline muted">No date given yet.</p>'}
      ${yesFor[r.key] ? yesBox(yesFor[r.key], `s${b64urlText(r.key).slice(0, 8)}`) : ''}
      <p class="rowlinks">${normalizePhone(r.phone) ? `<a href="tel:${normalizePhone(r.phone)}"${tip('day.call')}>Call</a> · ` : ''}<a href="/admin/#c-${esc(b64urlText(r.key))}"${tip('cal.openCard')}>Open the request</a> · <a href="/admin/calendar/new?r=${esc(b64urlText(r.key))}"${tip('cal.schedule')}>More choices</a></p></div>`).join('') : '<p class="muted" style="margin:0">Every request is confirmed.</p>'}</section>`;
  const still = `<section class="sub" id="still-to-decide" data-still-to-decide><h3>Still to decide (${stillToDecide.length})</h3>${stillToDecide.length ? `<p class="muted" style="margin:0 0 6px">Takedowns marked Not sure yet. Nothing is required: schedule it, or tell the card the customer will handle it.</p>
      ${stillToDecide.map((d) => `<div class="u"><strong>${esc(d.name || 'No name')}</strong> <span class="muted">${esc(KIND_LABELS[d.kind])}${d.note ? ` · ${esc(d.note)}` : ''}</span>
        <p class="rowlinks"><a href="/admin/calendar/new?r=${esc(d.rk)}&amp;kind=${esc(d.kind)}"${tip('cal.decide')}>Schedule it</a> · <a href="/admin/#c-${esc(d.rk)}"${tip('cal.decideOpen')}>Open the request</a></p></div>`).join('')}` : '<p class="muted" style="margin:0">Nothing waiting.</p>'}</section>`;
  const monthName = new Date(`${first}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const todayList = (byDay[today] || []).length;
  const step1 = calmStep(1, `${searchBox('', { bare: true })}<p class="rowlinks s1links"><a href="#every-booking" data-show-list${tip('cal.everyBooking')}>Every booking as a list</a> <a href="/admin/calendar/link"${tip('cal.link')}>Link my Google Calendar</a></p>`, { fold: false });
  const step2 = calmStep(2, `${uns}${toScheduleBox(toSchedule, { inline: true, back: `${back}#takedowns-to-schedule` })}${still}
    ${act(`<a class="btn" href="/admin/calendar/new"${tip('cal.add')}>Add a booking</a>`, 'cal.add')}`, { count: unconfirmed.length });
  const step3 = calmStep(3, `<p style="margin:0"><strong>Today, ${esc(shortDate(today))}:</strong> ${todayList ? `${todayList} ${todayList === 1 ? 'job' : 'jobs'}` : 'nothing booked'}.</p>
    ${act(`<a class="btn ghost" href="/admin/day/today"${tip('sub.today')}>Today's list</a>`, 'sub.today')}`);
  const step4 = calmStep(4, remindersBox(reminders, tomorrowLabel, { bare: true }), { count: reminders.length });
  const step5 = calmStep(5, upcomingHtml, { count: upRows.length });
  const cal = `<section class="calcal" data-calendar>
      <div class="mhead"><h2>${esc(monthName)}</h2>
        <span class="mnav"><a class="btn ghost" href="/admin/calendar?month=${prev}"${tip('cal.prev')}>&larr;<span class="vh"> Previous month</span></a><a class="btn ghost" href="/admin/calendar"${tip('cal.today')}>This month</a><a class="btn ghost" href="/admin/calendar?month=${next}"${tip('cal.next')}><span class="vh">Next month </span>&rarr;</a></span>
        <span class="views" role="group" aria-label="How to show bookings"><button type="button" class="btn" data-view="month" aria-pressed="true"${tip('cal.viewMonth')}>Month</button><button type="button" class="btn ghost" data-view="list" aria-pressed="false"${tip('cal.viewList')}>List</button><button type="button" class="btn ghost" data-view="held" aria-pressed="false"${tip('cal.viewHeld')}>Held</button></span></div>
      <div class="legend" data-service-key>${serviceKey()}</div>
      ${fillLegend()}
      <div data-pane="held" hidden>${heldPane}</div>
      <div data-pane="month">
        <div class="month">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>
        <div class="pmonth" data-phone-month>${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<span class="pdw">${d}</span>`).join('')}${pcells.join('')}</div>
        ${monthList}
      </div></section>`;
  const every = `<details class="card evb" id="every-booking" data-every-booking><summary${tip('cal.everyBooking')}>Every booking (${all.length}) — the whole list</summary><div data-pane="list">${listView(all, today, ctx)}</div></details>`;
  return layout('Calendar', `<style>${CAL_CSS}${CARD_CSS}${CALM_CSS}</style>
    ${flash ? `<div class="notice ok" data-cal-flash>${esc(flash)}</div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}
    <h1 class="vh">Calendar &amp; Bookings</h1>
    ${holdsBox}
    ${overdueBox(overdue)}
    ${warn}
    <div class="calm" data-steps="calendar" data-steps-panel data-calm>
      <div class="calmain">${cal}${step5}</div>
      <aside class="calside">${step1}${step2}${step3}${step4}</aside>
    </div>
    ${every}
    <form id="move-form" method="post" action="" hidden><input type="hidden" name="date" value=""></form>
    <script>${CAL_JS}${VIEW_JS}</script>`, { screen: '', back: BACK_REQUESTS, wide: true });
}

// "? " = not confirmed yet (the month grid; the legend says so). "Held · " = games held.
const gridTent = (c, held) => (c && c.tentative ? `? ${held ? '(games held) ' : ''}` : (held ? 'Held · ' : ''));

const VIEW_JS = `
(function(){
  var KEY='pnp-cal-view',wide=window.matchMedia('(min-width:900px)');
  var every=document.getElementById('every-booking');
  function show(v){if(v==='list'){if(every){every.open=true;every.scrollIntoView({block:'start'});}v='month';}
    document.querySelectorAll('[data-pane]').forEach(function(p){if(p.getAttribute('data-pane')!=='list')p.hidden=p.getAttribute('data-pane')!==v;});
    document.querySelectorAll('[data-view]').forEach(function(b){var on=b.getAttribute('data-view')===v;b.setAttribute('aria-pressed',on?'true':'false');b.classList.toggle('ghost',!on);});}
  document.querySelectorAll('[data-view]').forEach(function(b){b.addEventListener('click',function(){var v=b.getAttribute('data-view');try{localStorage.setItem(KEY,v==='list'?'month':v);}catch(e){}show(v);});});
  var saved=null;try{saved=localStorage.getItem(KEY);}catch(e){}if(saved==='held')show(saved);
  var sl=document.querySelector('[data-show-list]');if(sl)sl.addEventListener('click',function(){if(every)every.open=true;});
  var past=document.querySelector('[data-show-past]');if(past)past.addEventListener('click',function(){var box=document.getElementById('past-list');box.hidden=!box.hidden;past.setAttribute('aria-pressed',box.hidden?'false':'true');past.textContent=box.hidden?'Show past bookings':'Hide past bookings';});
  // Steps: all open beside the month on a computer; folded rows on a phone (the one holding the
  // #target stays open).
  var steps=document.querySelectorAll('details.cstep');
  function fold(){var t=location.hash?document.getElementById(location.hash.slice(1)):null;
    steps.forEach(function(d){d.open=wide.matches||(t&&d.contains(t));});}
  fold();if(wide.addEventListener)wide.addEventListener('change',fold);
  steps.forEach(function(d){d.querySelector('summary').addEventListener('click',function(e){if(wide.matches)e.preventDefault();});});
  // The phone month: tap a day, its jobs show right under the month.
  function pick(day){var p=document.getElementById('d-'+day);if(!p||!p.hasAttribute('data-month-day'))return false;
    document.querySelectorAll('[data-month-day].sel').forEach(function(x){x.classList.remove('sel');});p.classList.add('sel');
    document.querySelectorAll('[data-pday]').forEach(function(a){a.classList.toggle('sel',a.getAttribute('data-pday')===day);a.setAttribute('aria-current',a.getAttribute('data-pday')===day?'date':'false');});return true;}
  document.querySelectorAll('[data-pday]').forEach(function(a){a.addEventListener('click',function(e){if(pick(a.getAttribute('data-pday')))e.preventDefault();});});
  var h=/^#d-(\\d{4}-\\d{2}-\\d{2})$/.exec(location.hash);var sel=document.querySelector('[data-month-day].sel');pick(h?h[1]:(sel?sel.getAttribute('data-month-day'):''));
})();`;

function listEntry(b, ctx) {
  return `<a class="item" href="/admin/day/${esc(b.date)}"${tip('cal.day')}><strong>${esc(shortDate(b.date))}${b.time ? `, ${esc(prettyTime(b.time))}` : ''}</strong> ${kindTag(b.kind, bookingLabel(b, ctx(b)))}${ctx(b).tentative ? ` <span class="tentpill" data-tentative-pill>${TENT_WORDS}</span>` : ''} ${esc(b.customer_name || 'No name')}
    <br><span class="muted">${esc([b.items, b.place].filter(Boolean).join(' · '))}</span> ${statusBits(b, ctx(b))}</a>`;
}

function listView(all, today, ctx) {
  const upcoming = all.filter((b) => b.date >= today).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const past = all.filter((b) => b.date < today).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  return `<section class="card upcoming" data-list-view><h2>Every booking</h2><h3>Upcoming</h3>${upcoming.length ? upcoming.map((b) => listEntry(b, ctx)).join('') : '<p class="muted">Nothing coming up.</p>'}
    <div style="margin-top:12px">${act(`<button type="button" class="btn ghost" data-show-past aria-pressed="false"${tip('cal.past')}>Show past bookings</button>`, 'cal.past')}</div>
    <div id="past-list" hidden><h3>Past</h3>${past.length ? past.map((b) => listEntry(b, ctx)).join('') : '<p class="muted">No past bookings.</p>'}</div></section>`;
}

// ---- Day view = Day sheet -----------------------------------------------------------------

function notesBlock(b, notes) {
  return `<div class="notes" data-notes="${b.id}">
    ${notes.map((n) => `<div class="n" data-note="${n.id}"><strong>${esc(noteWhen(n.created_at))}</strong> — <span style="white-space:pre-wrap">${esc(n.body)}</span>
      <details class="disclose dayonly"><summary${tip('note.edit')}>Change this note</summary>
        <form method="post" action="/admin/notes/${n.id}"><textarea name="body" rows="4">${esc(n.body)}</textarea>${hiddenInputs({ back: `/admin/day/${b.date}` })}
          <div style="margin-top:8px">${act(`<button class="btn" type="submit"${tip('note.save')}>Save note</button>`, 'note.save')}</div></form>
        ${confirmStep({ key: 'note.delete', yesKey: 'note.deleteYes', label: 'Delete this note', question: 'Are you sure? This note will be gone for good.', action: `/admin/notes/${n.id}/delete`, hidden: hiddenInputs({ back: `/admin/day/${b.date}` }), danger: true })}
      </details></div>`).join('')}
    <details class="disclose dayonly"><summary${tip('note.add')}>Add a note</summary>
      <form method="post" action="/admin/calendar/bookings/${b.id}/notes"><label for="note-${b.id}">Note (only you see this)</label><textarea id="note-${b.id}" name="body" rows="5"></textarea>
        <div style="margin-top:8px">${act(`<button class="btn" type="submit"${tip('note.save')}>Save note</button>`, 'note.save')}</div></form>
    </details></div>`;
}

function noteWhen(utc) {
  const d = new Date(`${String(utc).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(utc);
  const date = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Chicago' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
  return `${date.replace(/^(\w+), (\w+) (\d+)$/, '$1 $3 $2')}, ${time}`;
}

// The words for one job on the Day sheet: "Game pickup", "Porch install", ...
export const SHEET_WORDS = { rental_pickup: 'Game pickup', rental_return: 'Game return' };
const firstOf = (name) => String(name || '').trim().split(/\s+/)[0] || 'No name';

// The games grid: one tile per item, OUT = light red with a light diagonal X (the name stays
// readable), IN = light green. The words are always there, so a black-and-white print reads.
export function gamesGrid(u, table) {
  // A removed item (Settings -> Inventory) shows only on a day it is still out for an old booking.
  const shown = table.items.filter((it) => !it.removed || (u.byItem[it.name] && u.byItem[it.name].used));
  const tiles = shown.map((it) => {
    const v = u.byItem[it.name];
    const n = v ? v.used : 0;
    const stock = v ? v.stock : (it.quantity || 1);
    if (!n) return `<div class="tile in" data-tile="in"><strong>${esc(it.name)}</strong><span>In</span></div>`;
    const who = v.who.map((w) => `Out · back ${shortDate(w.end)} · ${firstOf(w.name)}`).join('; ');
    return `<div class="tile out${n > stock ? ' over' : ''}" data-tile="out"><strong>${esc(it.name)}</strong><span>${esc(who)}${stock > 1 ? ` (${n} of ${stock})` : ''}${n > stock ? ' · DOUBLE-BOOKED' : ''}</span></div>`;
  });
  const outTiles = shown.filter((it) => u.byItem[it.name] && u.byItem[it.name].who.length).length;
  return { html: `<div class="grid" data-strip>${tiles.join('')}</div>`, outTiles, total: shown.length };
}

export function dayPage({ outRows = [], tdToday = [], requested = [], gamesAsked = 0, date, today, bookings, ctx, windows, table, sheetText, settings, flash = '', error = '', holds = [], notPaid = null }) {
  const u = usageOn(windows, date, today, table);
  let owedTotal = 0; let depositTotal = 0;
  const rows = bookings.map((b) => {
    const c = ctx(b);
    const owe = c.bal && !c.bal.void ? c.bal.owed : 0;
    if (b.kind === 'rental_pickup' || !RENTAL.has(b.kind)) { owedTotal += owe; depositTotal += c.bal && !c.bal.void ? c.bal.depositOwed : 0; }
    return { b, c, owe };
  });
  const npLine = notPaid ? `<div class="notice warn" data-day-not-paid><strong>${notPaid.today} ${notPaid.today === 1 ? 'customer' : 'customers'} booked today still ${notPaid.today === 1 ? 'owes' : 'owe'} money.</strong> Not paid yet in all: ${notPaid.count} ${notPaid.count === 1 ? 'customer owes' : 'customers owe'} ${esc(money(notPaid.total))}. <a href="/admin/money#not-paid"${tip('np.filter')}>See Not paid yet</a></div>` : '';
  const g = gamesGrid(u, table);
  const strip = `${npLine}<section class="card" data-games-grid><h2 data-day-count>${g.outTiles} of ${g.total} games out</h2>
    ${u.over.length ? `<div class="notice err" data-overlap><strong>Double-booked:</strong> ${u.over.map((o) => `${esc(o.item)} (you have ${o.stock}) is out with ${esc(o.who.map((w) => w.name).join(' and '))}.`).join(' ')}</div>` : ''}
    ${g.html}
    ${u.out.some((w) => w.unnamed) ? `<p class="muted">${esc(u.out.filter((w) => w.unnamed).map((w) => `${firstOf(w.name)}: ${w.unnamed} game${w.unnamed === 1 ? '' : 's'} not picked yet`).join('; '))}</p>` : ''}
    <p class="noprint" style="margin:8px 0 0"><a href="/admin/settings#inventory"${tip('inv.fromGrid')}>Change the items (Inventory)</a></p>
    ${gamesAsked ? `<div class="muted" data-games-asked${tip('cal.gamesAsked')}>${gamesAsked} ${gamesAsked === 1 ? 'game' : 'games'} asked for, not booked yet (not counted as out).</div>` : ''}</section>`;
  const holdsToday = holds.length ? `<section class="card" data-day-holds><h2>Holds ending this day</h2>${holds.map((h) => `<div><strong>${esc(h.timeLabel)}: ${esc(h.name || 'No name')}</strong> · ${esc(h.items || '')} · deposit not in yet</div>`).join('')}</section>` : '';
  const askedToday = requested.length ? `<section class="card dayonly" data-day-requested><h2>Asked for, not booked yet</h2><div class="reqlist">${requested.map((c) => requestedChip(c, 'a')).join('')}</div></section>` : '';
  // "Load these items" only when two or more jobs load that day (one job's block says it already).
  const loading = rows.filter((r) => r.b.kind === 'rental_pickup');
  const load = loading.length >= 2 ? `<section class="card" data-load><h2>Load these items</h2>${loading.map((r) => {
    const w = windows.find((x) => x.key === (r.b.request_key || `m:${String(r.b.customer_name).toLowerCase()}|${String(r.b.items).toLowerCase()}`));
    const names = w ? namesText(w) : [];
    return `<div><strong>${esc(firstOf(r.b.customer_name))}:</strong> ${esc(names.join(', ') || r.b.items || '')}${w && w.unnamed ? `, plus ${w.unnamed} game${w.unnamed === 1 ? '' : 's'} they still need to pick` : ''}</div>`;
  }).join('')}</section>` : '';
  // One block per job: checkbox + "Anytime · Game pickup · Ada"; items; place; Still owed only
  // when > 0; notes in italics. Timed jobs first, Anytime last (daySort).
  const sheet = `<section class="card"><h2>Day sheet</h2><div class="jobs" data-day-sheet>
    ${rows.map(({ b, c, owe }) => `<div class="job" data-sheet-row="${b.id}"><span class="box" aria-hidden="true"></span><div>
      <div class="jl">${esc([b.time ? prettyTime(b.time) : 'Anytime', (c.delivery && DELIVERY_WORDS[b.kind]) || SHEET_WORDS[b.kind] || KIND_LABELS[b.kind] || 'Booking', firstOf(b.customer_name)].join(' · '))}${c.tentative ? ` <span class="tentpill" data-tentative-pill>${TENT_WORDS}</span>` : ''}</div>
      ${b.items ? `<div class="ji">${esc(b.items)}</div>` : ''}${b.place ? `<div class="muted">${esc(b.place)}</div>` : ''}
      ${owe > 0 ? `<div class="jo" data-still-owed>Still owed ${esc(money(owe))}</div>` : ''}
      ${(c.notes || []).map((n) => `<div class="jn">${esc(n.body)}</div>`).join('')}</div></div>`).join('') || (outRows.length ? '' : '<p>Nothing booked this day.</p>')}
    </div>
    ${outRows.length ? `<div class="jobs" data-day-out>${outRows.map((w) => `<div class="job" data-rental-out="${esc(w.key)}"><span class="box" aria-hidden="true"></span><div><div class="jl">${esc([OUT_WORDS, firstOf(w.name)].join(' · '))}</div><div class="ji">${esc(namesText(w).join(', ') || '')}</div><div class="muted">Picked up ${esc(shortDate(w.start))}, back ${esc(shortDate(w.end))}</div></div></div>`).join('')}</div>` : ''}
    ${owedTotal > 0 ? `<p style="font-size:1.15rem" data-day-total><strong>Still to collect today: ${esc(money(owedTotal))}</strong>${depositTotal ? ` plus ${esc(money(depositTotal))} in refundable damage deposits` : ''}</p>` : ''}</section>`;
  const smsTo = normalizePhone(settings.day_list_phone || '901-355-1518');
  const tools = `<div class="actions three daytools">
    ${act(`<button type="button" class="btn" onclick="window.print()"${tip('day.print')}>Print this list</button>`, 'day.print')}
    ${act(`<a class="btn ghost" href="${esc(`sms:${smsTo}?&body=${encodeURIComponent(sheetText)}`)}"${tip('day.textMe')}>Text it to me</a>`, 'day.textMe')}
    <form method="post" action="/admin/day/${esc(date)}/email">${act(`<button class="btn ghost" type="submit"${tip('day.emailMe')}>Email it to me</button>`, 'day.emailMe')}</form>
  </div>`;
  const entries = rows.map(({ b, c }) => {
    const rk = returnKeyOf(b);
    const returned = c.ret && c.ret.returned_at;
    return `<article class="card booking" data-booking-card="${b.id}">
      <div class="spread"><h3 style="margin:0">${esc(b.customer_name || 'No name')}</h3>${kindTag(b.kind, bookingLabel(b, c))}</div>${c.tentative ? `<p class="tentpill" data-tentative-pill>${TENT_WORDS}: say yes on <a href="/admin/#c-${esc(b64urlText(b.request_key))}"${tip('cal.openCard')}>their card</a> to confirm.</p>` : ''}
      <div><strong>${esc(b.time ? prettyTime(b.time) : 'Any time this day')}</strong></div>
      ${b.items ? `<div><strong>What:</strong> ${esc(b.items)}</div>` : ''}${b.place ? `<div><strong>Where:</strong> ${esc(b.place)}</div>` : ''}
      <div style="margin:6px 0">${statusBits(b, c)}</div>
      ${c.bal && c.bal.refundable && !c.bal.void ? `<div class="muted">${esc(depositWords(c.bal))}</div>` : ''}
      <div class="actions dayonly">
        ${tel(b.phone) ? act(`<a class="btn primary bigcall" href="${tel(b.phone)}"${tip('day.call')}>Call ${esc(b.phone)}</a>`, 'day.call') : '<p><strong>No phone on file.</strong></p>'}
        ${RENTAL.has(b.kind) && !returned ? act(`<a class="btn" href="/admin/returns?k=${esc(b64urlText(rk))}"${tip('ret.mark')}>Mark returned</a>`, 'ret.mark') : ''}
        ${/_takedown$/.test(b.kind) && !b.done_at ? `<form method="post" action="/admin/calendar/bookings/${b.id}/takedown-done">${act(`<button class="btn" type="submit"${tip('td.markDone')}>Mark takedown done</button>`, 'td.markDone')}</form>` : ''}
        ${/_takedown$/.test(b.kind) && b.done_at ? `<p class="money ok" data-takedown-done>Takedown done ✓</p><form method="post" action="/admin/calendar/bookings/${b.id}/takedown-done">${hiddenInputs({ undo: '1' })}<button class="linkbtn" type="submit"${tip('td.undoDone')}>Undo takedown done</button></form>` : ''}
        ${RENTAL.has(b.kind) && returned ? act(`<a class="btn ghost" href="/admin/returns?k=${esc(b64urlText(rk))}"${tip('ret.see')}>See the check-in</a>`, 'ret.see') : ''}
        ${act(`<a class="btn ghost" href="/admin/calendar/bookings/${b.id}/move"${tip('bk.move')}>Move to another day</a>`, 'bk.move')}
        ${act(`<a class="btn ghost" href="/admin/calendar/bookings/${b.id}/edit"${tip('day.edit')}>Change this booking</a>`, 'day.edit')}
        ${b.invoice_id ? act(`<a class="btn ghost" href="/admin/invoices/${b.invoice_id}"${tip('card.openInvoice')}>Open invoice</a>`, 'card.openInvoice') : ''}
        ${confirmStep({ key: 'day.delete', yesKey: 'day.deleteYes', label: 'Delete this booking', question: `Are you sure? This takes ${b.customer_name || 'this'}'s ${String(KIND_LABELS[b.kind]).toLowerCase()} off the calendar.`, action: `/admin/calendar/bookings/${b.id}/delete`, hidden: '', danger: true })}
      </div>
      <h4 style="margin:12px 0 0">Notes</h4>${notesBlock(b, c.notes || [])}
    </article>`;
  }).join('');
  return layout(`Day sheet ${date}`, `<style>${CAL_CSS}</style>
    ${flash ? `<div class="notice ok" data-flash>${esc(flash)}</div>` : ''}${error ? `<div class="notice err" data-flash>${esc(error)}</div>` : ''}
    <h1>${esc(prettyDate(date))}</h1>
    ${tools}
    ${toScheduleBox(tdToday)}${holdsToday}${sheet}${load}${strip}${askedToday}
    <div class="dayonly">${entries}
    ${act(`<a class="btn" href="/admin/calendar/new?date=${esc(date)}"${tip('cal.add')}>Add a booking on this day</a>`, 'cal.add')}</div>`, { screen: 'day', back: { href: `/admin/calendar?month=${date.slice(0, 7)}`, label: 'Back to the calendar' } });
}

// ---- Scheduling form ----------------------------------------------------------------------

// "Add a booking" with no request (owner, 18 Oct 2026): which service, in the four colours with
// words, or "Just a calendar note (no customer)". A service makes a phone request on Save
// (phone-requests.mjs); the note keeps the old request-less booking.
export function serviceChoice(picked = '') {
  const card = (value, label, style, key) => `<label class="svcpick" data-service-pick="${esc(value)}"${style ? ` style="${style}"` : ''}><input type="radio" name="service" value="${esc(value)}" required${picked === value ? ' checked' : ''}${tip(key)}> <span>${esc(label)}</span></label>`;
  return `<fieldset class="svcpicks" data-service-choice><legend>Which service?</legend>
    ${PHONE_SERVICES.map((k) => card(k, PHONE_SERVICE_WORDS[k], `border-color:${SERVICE_KINDS[k].bar};background:${SERVICE_KINDS[k].tint}`, 'bk.service')).join('')}
    ${card(NOTE_CHOICE, 'Just a calendar note (no customer)', '', 'bk.note')}
    <p class="muted" data-service-hint>A service adds the customer to Requests as a phone booking. A calendar note does not.</p></fieldset>`;
}
const SVC_CSS = `.svcpicks{border:0;padding:0;margin:0 0 12px;display:grid;gap:8px}.svcpicks legend{font-weight:700;margin-bottom:6px}
.svcpick{display:flex;align-items:center;gap:10px;min-height:48px;margin:0;padding:6px 12px;border:2px solid var(--line);border-left-width:8px;border-radius:10px;background:#fff;color:var(--ink);font-weight:600;font-size:1.05rem}
.svcpick input{width:24px;height:24px;min-height:24px;flex:none}.svcpick:has(input:checked){outline:3px solid var(--ink);outline-offset:1px}`;

export function bookingFormPage({ booking, action, title, rk = '', isNew = true, returnDate = '', avail = null, windowsJson = '[]', table, ignoreKey = '', askService = false, service = '' }) {
  const rental = RENTAL.has(booking.kind);
  const chosen = new Set(String(booking.items || '').toLowerCase().split(/,\s*/));
  // The picker lists what can be booked; a removed item appears only on a booking that has it.
  const picks = table.items.filter((it) => !it.removed || [...chosen].some((c) => c.includes(it.name.toLowerCase())));
  const total = picks.length;
  const outCount = avail ? picks.filter((it) => avail[it.name] <= 0).length : 0;
  const itemBoxes = `<fieldset id="rent-items" style="border:0;padding:0;margin:12px 0"${rental ? '' : ' hidden'}><legend style="font-weight:600">Which items</legend>
    <p data-avail-line><strong>On these dates: <span id="out-n">${outCount}</span> of ${total} items already out.</strong></p>
    ${picks.map((it) => { const na = avail && avail[it.name] <= 0; const on = [...chosen].some((c) => c.includes(it.name.toLowerCase())); return `<label class="itemcheck${na ? ' na' : ''}" data-item="${esc(it.name)}"><input type="checkbox" name="item" value="${esc(it.name)}"${on ? ' checked' : ''}${na && !on ? ' disabled' : ''}> ${esc(it.name)} <span class="muted" data-na>${na ? '(out on these dates)' : ''}</span></label>`; }).join('')}
  </fieldset>`;
  const js = `(function(){var W=${windowsJson},S=${JSON.stringify(table.items.map((i) => [i.name, i.quantity || 1]))},IGN=${JSON.stringify(ignoreKey)};
    var f=document.getElementById('bk'),kind=f.querySelector('[name=kind]'),d=f.querySelector('[name=date]'),r=f.querySelector('[name=return_date]');
    function add(s,n){var x=new Date(s+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);}
    function out(w,day){if(day<w.start)return false;if(w.returnedDay)return day<w.returnedDay;return day<=w.last;}
    function upd(){var rent=/^rental_/.test(kind.value);document.getElementById('rent-items').hidden=!rent;var rw=document.getElementById('ret-wrap');if(rw)rw.hidden=kind.value!=='rental_pickup';if(!rent||!d.value)return;
      var end=(r&&r.value&&r.value>=d.value)?r.value:d.value,n=0;S.forEach(function(p){var left=p[1];for(var day=d.value;day<=end;day=add(day,1)){var c=W.filter(function(w){return w.key!==IGN&&out(w,day)&&w.names.indexOf(p[0])>=0;}).reduce(function(k,w){return k+((w.counts&&w.counts[p[0]])||1);},0);left=Math.min(left,p[1]-c);}
        var lab=f.querySelector('[data-item="'+p[0].replace(/"/g,'\\\\"')+'"]'),box=lab.querySelector('input'),na=left<=0;if(na)n++;lab.classList.toggle('na',na);if(!box.checked)box.disabled=na;lab.querySelector('[data-na]').textContent=na?'(out on these dates)':'';});
      document.getElementById('out-n').textContent=n;}
    var KS=${JSON.stringify(Object.fromEntries(PHONE_SERVICES.map((k) => [k, SERVICE_KINDS[k].kinds])))},FK=${JSON.stringify(FIRST_KIND)};
    function svc(){var p=f.querySelector('[name=service]:checked');if(!p)return;var v=p.value,cn=f.querySelector('[name=customer_name]'),lab=f.querySelector('label[for=cn]');
      Array.prototype.forEach.call(kind.options,function(o){o.hidden=v!=='${NOTE_CHOICE}'&&KS[v].indexOf(o.value)<0;});
      if(v!=='${NOTE_CHOICE}'&&KS[v].indexOf(kind.value)<0)kind.value=FK[v];
      if(cn){cn.required=v!=='${NOTE_CHOICE}';if(lab)lab.textContent=v==='${NOTE_CHOICE}'?'Name for the note (optional)':'Customer name';}}
    f.addEventListener('change',function(e){if(e.target&&e.target.name==='service')svc();upd();});svc();upd();})();`;
  return layout(title, `<style>${CAL_CSS}${askService ? SVC_CSS : ''}</style><h1>${esc(title)}</h1>
    <form id="bk" class="card" method="post" action="${esc(action)}">
      ${rk ? hiddenInputs({ r: rk }) : ''}
      ${askService ? serviceChoice(service) : ''}
      <label for="kind">What kind of booking</label>
      <select id="kind" name="kind">${KINDS.map((k) => `<option value="${k}"${k === booking.kind ? ' selected' : ''}>${esc(KIND_LABELS[k])}</option>`).join('')}</select>
      <label for="date">Day</label><input id="date" name="date" type="date" required value="${esc(booking.date || '')}">
      <div id="ret-wrap"${booking.kind === 'rental_pickup' && isNew ? '' : ' hidden'}><label for="ret">Return day (always booked with the pickup; filled in from how long they rent, change it if needed)</label><input id="ret" name="return_date" type="date" value="${esc(returnDate)}">
        <label for="rett">Return time (leave empty if not sure yet)</label><input id="rett" name="return_time" type="time" value=""></div>
      <label for="time">Time (leave empty for all day)</label><input id="time" name="time" type="time" value="${esc(booking.time || '')}">
      <label for="cn">Customer name</label><input id="cn" name="customer_name" value="${esc(booking.customer_name || '')}" required>
      <label for="ph">Phone</label><input id="ph" name="phone" type="tel" value="${esc(booking.phone || '')}">
      <label for="em">Email (optional, for the automatic reminder${askService ? ' and thank-you' : ''})</label><input id="em" name="email" type="email" value="${esc(booking.email || '')}">
      <label for="pl">Where</label><input id="pl" name="place" value="${esc(booking.place || '')}">
      ${itemBoxes}
      <label for="it">What (words)</label><textarea id="it" name="items" rows="3">${esc(booking.items || '')}</textarea>
      ${isNew ? `<label for="nt">Note (optional, only you see it)</label><textarea id="nt" name="note" rows="3">${esc(booking.note || '')}</textarea>` : ''}
      <div style="margin-top:16px">${act(`<button class="btn primary" type="submit"${tip('bk.save')}>Save booking</button>`, 'bk.save')}</div>
    </form><script>${js}</script>`, { screen: 'booking', back: BACK_CAL });
}

export function movePage({ booking }) {
  return layout('Move a booking', `<h1>Move ${esc(booking.customer_name || 'this')}'s ${esc(String(KIND_LABELS[booking.kind]).toLowerCase())}</h1>
    <form class="card" method="post" action="/admin/calendar/bookings/${booking.id}/move">
      <p>Now on <strong>${esc(prettyDate(booking.date))}</strong>.</p>
      <label for="nd">New day</label><input id="nd" name="date" type="date" required value="${esc(booking.date)}">
      <div style="margin-top:16px">${act(`<button class="btn primary" type="submit"${tip('bk.moveYes')}>Move it</button>`, 'bk.moveYes')}</div>
    </form>`, { screen: 'move', back: { href: `/admin/day/${booking.date}`, label: 'Back to the day' } });
}

// ---- Link my Google Calendar ----------------------------------------------------------------

export function linkPage({ feedUrl }) {
  return layout('Link my Google Calendar', `<h1>Link my Google Calendar</h1>
    <div class="card"><label for="feed" style="margin-top:0">Your private calendar link (keep it to yourself)</label>
      <input id="feed" value="${esc(feedUrl)}" readonly onclick="this.select()">
      <div style="margin-top:10px">${act(`<button type="button" class="btn primary" data-copy-feed${tip('gl.copy')}>Copy link</button>`, 'gl.copy')}</div></div>
    <div class="card"><ol class="steps">
      <li><strong>Tap Copy link</strong> above. (Or email the link to yourself so you have it on the computer.)</li>
      <li><strong>On a computer, open calendar.google.com</strong> and sign in as valeriektaylor13@gmail.com.</li>
      <li>On the left, find <strong>Other calendars</strong> and click the <strong>+</strong> next to it.</li>
      <li>Click <strong>From URL</strong>.</li>
      <li><strong>Paste the link</strong> into the box.</li>
      <li>Click <strong>Add calendar</strong>. Done. It shows on your phone's Google Calendar too.</li>
    </ol>
    ${act(`<a class="btn ghost" href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl" target="_blank" rel="noopener noreferrer"${tip('gl.open')}>Open Google Calendar (From URL)</a>`, 'gl.open')}</div>
    <div class="notice warn"><strong>Good to know:</strong> Google refreshes linked calendars on its own schedule, which can take several hours. A brand-new booking is always on the admin <strong>Calendar</strong> tab straight away.</div>
    <script>(function(){var b=document.querySelector('[data-copy-feed]'),i=document.getElementById('feed');b.addEventListener('click',function(){var done=function(){b.textContent='Copied ✓';setTimeout(function(){b.textContent='Copy link';},2000);};
      if(navigator.clipboard)navigator.clipboard.writeText(i.value).then(done,function(){i.select();document.execCommand('copy');done();});else{i.select();document.execCommand('copy');done();}});})();</script>`,
  { screen: 'gcal', back: { href: '/admin/calendar', label: 'Back to the calendar' } });
}

// ---- Rental check-in ("Mark returned") ----------------------------------------------------

const PHOTO_JS = `
(function(){
  var root=document.getElementById('ret');if(!root)return;var url=root.dataset.photos,file=document.getElementById('photo-input'),grid=document.getElementById('photos'),st=document.getElementById('photo-state');
  function shrink(f){return new Promise(function(res,rej){var img=new Image();img.onload=function(){var s=Math.min(1,1600/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);var q=0.85;(function go(){c.toBlob(function(b){if(!b)return rej(new Error('could not read that image'));if(b.size>1500000&&q>0.4){q-=0.1;go();}else res(b);},'image/jpeg',q);})();};
    img.onerror=function(){rej(new Error('could not read that image'));};img.src=URL.createObjectURL(f);});}
  if(file)file.addEventListener('change',function(){var fs=[].slice.call(file.files);file.value='';(function next(){var f=fs.shift();if(!f){st.textContent='';return;}st.textContent='Uploading…';
    shrink(f).then(function(b){return fetch(url,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:b,credentials:'same-origin'});}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||r.status);
      var fig=document.createElement('figure');fig.innerHTML=document.getElementById('photo-tpl').innerHTML;var a=fig.querySelector('a');a.href=j.url;a.innerHTML='<img src="'+j.url+'" alt="Return photo" loading="lazy">';grid.appendChild(fig);});}).then(next).catch(function(e){st.textContent='Photo not added: '+e.message;});})();});
  var all=document.getElementById('all-good');if(all)all.addEventListener('click',function(){root.querySelectorAll('[name=back]').forEach(function(b){b.checked=true;});root.querySelectorAll('[name=damaged]').forEach(function(b){b.checked=false;});});
})();`;

export function returnPage({ who, items, saved, returnKeyB64, depositWordsText = '', photos = [] }) {
  const rows = items.map((name, i) => {
    const s = (saved && saved.items || []).find((x) => x.name === name) || {};
    return `<div class="card" style="padding:10px 14px"><label class="itemcheck"><input type="checkbox" name="back" value="${esc(name)}"${s.back ? ' checked' : ''}> <strong>${esc(name)}</strong> came back</label>
      <label class="itemcheck"><input type="checkbox" name="damaged" value="${esc(name)}"${s.damaged ? ' checked' : ''}> It is damaged</label>
      <label for="n${i}">What is wrong (only if something is missing or damaged)</label><input id="n${i}" name="note_${esc(name)}" value="${esc(s.note || '')}"></div>`;
  }).join('');
  const returned = saved && saved.returned_at;
  return layout(`Check in ${who}`, `<style>${CAL_CSS}.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}.photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px}</style>
    <h1>Mark returned: ${esc(who)}</h1>
    ${returned ? `<div class="notice ${saved.damaged ? 'warn' : 'ok'}" data-return-state><strong>${saved.damaged ? 'Returned — check damage' : 'Returned ✓'}</strong> on ${esc(prettyDate(String(returned).slice(0, 10)))}.</div>` : ''}
    ${saved && saved.damaged && depositWordsText ? `<div class="notice warn" data-deposit-reminder><strong>${esc(depositWordsText)}.</strong> Decide whether to refund the deposit in full or keep part of it. Nothing is sent to the customer and no money moves by itself.</div>` : ''}
    <form id="ret" method="post" action="/admin/returns?k=${esc(returnKeyB64)}" data-photos="/api/admin/checklist/photos?r=${esc(b64urlText(`return|${returnKeyB64}`))}">
      ${act(`<button type="button" class="btn ghost" id="all-good"${tip('ret.allGood')}>Everything came back in good shape</button>`, 'ret.allGood')}
      ${rows || '<p>No items are listed for this rental. Type what came back in the note below.</p>'}
      <label for="rn">Anything else (optional)</label><textarea id="rn" name="notes" rows="3">${esc(saved ? saved.notes : '')}</textarea>
      <div class="card"><h3 style="margin-top:0">Photos of any damage <small class="muted">up to 10</small></h3>
        <div class="photos" id="photos">${photos.map((p) => `<figure><a href="${esc(p.url)}" target="_blank" rel="noopener"${tip('cl.photo')}><img src="${esc(p.url)}" alt="Return photo" loading="lazy"></a></figure>`).join('')}</div>
        ${act(`<label class="btn ghost" style="color:var(--accent);margin:0"${tip('cl.addPhotos')}>Add photos<input id="photo-input" type="file" accept="image/*" multiple style="display:none"></label>`, 'cl.addPhotos')}
        <template id="photo-tpl"><a href="" target="_blank" rel="noopener"${tip('cl.photo')}></a></template><div id="photo-state" class="muted"></div></div>
      <div style="margin-top:12px">${act(`<button class="btn primary" type="submit"${tip('ret.save')}>Save: it is returned</button>`, 'ret.save')}</div>
    </form>
    ${returned ? `<div style="margin-top:14px">${confirmStep({ key: 'ret.undo', yesKey: 'ret.undoYes', label: 'Undo returned', question: `Undo "returned" for ${who}? The rental goes back to not returned and the request gets its old status back.`, action: `/admin/returns/undo?k=${esc(returnKeyB64)}`, hidden: '', danger: true })}</div>` : ''}
    <script>${PHOTO_JS}</script>`, { screen: 'returns', back: BACK_CAL });
}

// ---- Find a customer -----------------------------------------------------------------------

export function searchResults({ q, groups, capped }) {
  if (String(q || '').trim().length < 2) return '<p class="muted">Type at least 2 letters.</p>';
  if (!groups.length) return `<p data-search-empty><strong>No customer found for '${esc(q)}'.</strong> Check the spelling or try part of the name.</p>`;
  return `${capped ? '<p class="muted" data-capped>Showing the newest 50.</p>' : ''}${groups.map((g) => `<section class="card found" data-found>
    <h3>${esc(g.name || 'No name')}</h3>
    <div class="row">${tel(g.phone) ? `<a class="btn inline" href="${tel(g.phone)}"${tip('day.call')}>Call ${esc(g.phone)}</a>` : ''}${g.email ? `<span class="muted">${esc(g.email)}</span>` : ''}</div>
    <p data-customer-total><strong>${g.items.filter((i) => i.type === 'booking').length} ${g.items.filter((i) => i.type === 'booking').length === 1 ? 'booking' : 'bookings'} · ${esc(money(g.paid))} paid${g.owed ? ` · ${esc(money(g.owed))} still owed` : ''}</strong></p>
    ${g.sent ? `<p data-sent-you>Sent you ${g.sent} ${g.sent === 1 ? 'customer' : 'customers'}</p>` : ''}
    ${g.items.map((i) => `<div class="booking">
      <strong>${esc(i.date ? shortDate(i.date) : 'No date')}</strong> ${i.type === 'booking' ? kindTag(i.kind) : '<span class="k other">Request (not on the calendar)</span>'}
      ${i.archived ? ' <span class="chip done">Put away</span>' : ''}${i.void ? ' <span class="chip void">Void</span>' : ''}
      <div>${esc(i.items || '')}</div>
      <div>${i.balance ? esc(i.balance) : ''}${i.returnWords ? ` · ${esc(i.returnWords)}` : ''}</div>
      ${i.note ? `<div class="muted">Note: ${esc(firstLine(i.note))}</div>` : ''}
      ${act(`<a class="btn ghost inline" href="${esc(i.href)}"${tip('find.open')}>Open</a>`, 'find.open')}</div>`).join('')}
  </section>`).join('')}`;
}

export function searchPage({ q, groups, capped }) {
  return layout('Find a customer', `<style>${CAL_CSS}</style><h1>Find a customer</h1>${searchBox(q).replace('<div id="find-results" aria-live="polite"></div>', `<div id="find-results" aria-live="polite">${q ? searchResults({ q, groups, capped }) : ''}</div>`)}`,
    { screen: 'search', back: BACK_CAL });
}

export { STATUS_LABELS };
