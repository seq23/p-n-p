// Calendar screens for the /admin console: month view with the Unscheduled requests list,
// a day view that is also the printable Day sheet, the scheduling form, Move, notes, rental
// check-in ("Mark returned"), tomorrow's reminders, "Find a customer" and the Google
// Calendar link page. Same rules as views.mjs: words + colour, 48 px targets, every button
// and link carries a title from helptext.mjs.
import { esc, money, shortDate, prettyDate, b64urlText, STATUS_LABELS } from './util.mjs';
import { tip, hint, stepsPanel } from './helptext.mjs';
import { layout, act, chip, confirmStep, hiddenInputs, BACK_REQUESTS, CARD_CSS } from './views.mjs';
import { KINDS, KIND_LABELS, prettyTime, addDays, returnKeyOf, firstLine, usageOn } from './calendar.mjs';
import { serviceInfo, serviceKey } from './kinds.mjs';
import { balanceWords, depositWords } from './ledger.mjs';
import { reminderText, smsLink, normalizePhone, hasEmail } from './reminders.mjs';

const RENTAL = new Set(['rental_pickup', 'rental_return']);
const kindTag = (k) => `<span class="k ${esc(k)}">${esc(KIND_LABELS[k] || k)}</span>`;
const BACK_CAL = { href: '/admin/calendar', label: 'Back to the calendar' };

function tel(phone) {
  const d = normalizePhone(phone);
  return d ? `tel:${d}` : '';
}

// ctx: { bal, notes, ret, today }
export function statusBits(b, { bal, notes = [], ret, today, hold = null }) {
  const bits = [];
  if (hold && hold.state === 'held' && RENTAL.has(b.kind)) bits.push(`<span class="money owe" data-held-booking>Held — waiting for deposit${hold.until ? '' : ' (held by hand)'}</span>`);
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
@media print{.sheet{font-size:14pt}.daytools,.notes form,.dayonly{display:none!important}.wrap{max-width:none;padding:0}}
`;

// ---- Tomorrow's reminders / Overdue returns (Requests and Calendar) -------------------------

export function remindersBox(rows, tomorrowLabel) {
  if (!rows.length) return '';
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
  return `<section class="card" data-reminders><h2>Tomorrow's reminders <small class="muted">${esc(tomorrowLabel)}</small></h2>${items}
    <p class="muted" style="margin:8px 0 0">Customers with an email on file also get an email reminder by themselves at about 10 AM.</p></section>
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
  document.querySelectorAll('[data-day]').forEach(function(c){
    c.addEventListener('dragover',function(e){if(!dragging)return;e.preventDefault();c.classList.add('over');});
    c.addEventListener('dragleave',function(){c.classList.remove('over');});
    c.addEventListener('drop',function(e){e.preventDefault();c.classList.remove('over');drop(c.getAttribute('data-day'),c);});
  });
})();`;

export function searchBox(q = '') {
  return `<form class="card" method="get" action="/admin/search" role="search" data-search>
    <label for="find" style="margin-top:0;font-size:1.1rem;color:var(--ink)"><strong>Find a customer — type a name</strong></label>
    <input id="find" name="q" value="${esc(q)}" autocomplete="off" placeholder="For example: Jane, or 901 555" data-find${tip('find.box')}>
    <div style="margin-top:8px">${act(`<button class="btn ghost" type="submit"${tip('find.go')}>Find</button>`, 'find.go')}</div>
    <div id="find-results" aria-live="polite"></div></form>
  <script>(function(){var i=document.querySelector('[data-find]'),out=document.getElementById('find-results'),t=null,last='';if(!i||!out)return;
    i.addEventListener('input',function(){clearTimeout(t);t=setTimeout(function(){var q=i.value.trim();if(q===last)return;last=q;if(q.length<2){out.innerHTML='';return;}
      fetch('/admin/search?partial=1&q='+encodeURIComponent(q),{credentials:'same-origin'}).then(function(r){return r.text();}).then(function(h){if(i.value.trim()===q)out.innerHTML=h;});},300);});})();</script>`;
}

export function calendarPage({ month, today, bookings, all = bookings, ctx, windows, table, warnings, unscheduled, reminders, tomorrowLabel, overdue, flash = '', error = '', holdsBox = '', heldPane = '' }) {
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const startPad = new Date(`${first}T12:00:00Z`).getUTCDay();
  const gridStart = addDays(first, -startPad);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const byDay = {};
  for (const b of bookings) (byDay[b.date] = byDay[b.date] || []).push(b);
  const cells = [];
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
        return `<span class="k ${esc(b.kind)}" draggable="true" data-drag data-booking="${b.id}" data-date="${esc(b.date)}" data-move-label="${esc(`${b.customer_name || 'this'}'s ${String(KIND_LABELS[b.kind]).toLowerCase()}`)}"${tip('cal.booking')}>${esc(KIND_LABELS[b.kind])}${mark}: ${esc(firstLine(b.customer_name, 18))}</span>`;
      }).join('')}
      ${games ? `<span class="badge" data-games-out>${games} ${games === 1 ? 'game' : 'games'} out</span>` : ''}
      ${owes ? '<span class="due" data-due>$ due</span>' : ''}${late ? '<span class="late-dot">Not returned yet</span>' : ''}
    </a>`);
  }
  const upcoming = bookings.filter((b) => b.date >= today && b.date <= addDays(today, 14));
  const upcomingHtml = `<section class="card upcoming" data-upcoming><h2>Upcoming (next 14 days)</h2>${upcoming.length ? upcoming.map((b) => `<a class="item" href="/admin/day/${esc(b.date)}"${tip('cal.day')}>
      <strong>${esc(shortDate(b.date))}${b.time ? `, ${esc(prettyTime(b.time))}` : ''}</strong> ${kindTag(b.kind)} ${esc(b.customer_name || 'No name')}<br><span class="muted">${esc(b.items || '')}</span> ${statusBits(b, ctx(b))}</a>`).join('') : '<p class="muted" style="margin:0">Nothing in the next 14 days.</p>'}</section>`;
  const warn = warnings.length ? `<div class="notice err" data-overlap><strong>Double-booked:</strong>${warnings.map((w) => `<div>${esc(w.item)} (you have ${w.stock}) is out with ${esc(w.who.map((x) => `${x.name} (${shortDate(x.start)} to ${shortDate(x.end)})`).join(' and '))}. Starts ${esc(shortDate(w.first))}.</div>`).join('')}</div>` : '';
  const uns = `<aside class="card unsched" data-unscheduled><h2>Unscheduled requests</h2><p class="muted">On a computer, drag a request onto a day. Or tap Schedule.</p>
    ${unscheduled.length ? unscheduled.map((r) => `<div class="u" draggable="true" data-drag data-rk="${esc(b64urlText(r.key))}"${tip('cal.unscheduled')}><strong>${esc(r.name || 'No name')}</strong><div class="muted">${esc(r.summary || '')}</div>
      ${act(`<a class="btn ghost" href="/admin/calendar/new?r=${esc(b64urlText(r.key))}"${tip('cal.schedule')}>Schedule</a>`, 'cal.schedule')}</div>`).join('') : '<p class="muted">Every request is on the calendar.</p>'}</aside>`;
  const panel = stepsPanel('calendar', [
    [`<a class="btn ghost" href="/admin/search"${tip('sub.find')}>Find a customer</a>`],
    [`<a class="btn" href="/admin/calendar/new"${tip('cal.add')}>Add a booking</a>`],
    [`<a class="btn ghost" href="/admin/day/today"${tip('sub.today')}>Today's list</a>`],
  ]);
  return layout('Calendar', `<style>${CAL_CSS}${CARD_CSS}</style>
    ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}
    ${panel}
    <h1>Calendar</h1>
    ${searchBox()}
    ${holdsBox}
    ${overdueBox(overdue)}
    ${remindersBox(reminders, tomorrowLabel)}
    ${warn}
    <div class="actions">
      ${act(`<a class="btn ghost" href="/admin/calendar/link"${tip('cal.link')}>Link my Google Calendar</a>`, 'cal.link')}
    </div>
    <div class="actions" style="grid-template-columns:1fr 1fr 1fr" role="group" aria-label="How to show bookings">
      <button type="button" class="btn" data-view="month" aria-pressed="true"${tip('cal.viewMonth')}>Month</button>
      <button type="button" class="btn ghost" data-view="list" aria-pressed="false"${tip('cal.viewList')}>List</button>
      <button type="button" class="btn ghost" data-view="held" aria-pressed="false"${tip('cal.viewHeld')}>Held</button>
    </div>
    <div data-pane="held" hidden>${heldPane}</div>
    <div class="legend" data-service-key>${serviceKey()}</div>
    <div data-pane="list" hidden>${listView(all, today, ctx)}</div>
    <div data-pane="month">
    ${upcomingHtml}
    <div class="calwrap"><section>
      <div class="monthbar">
        <a class="btn ghost" href="/admin/calendar?month=${prev}"${tip('cal.prev')}>&larr; Previous month</a>
        <a class="btn ghost" href="/admin/calendar"${tip('cal.today')}>This month</a>
        <a class="btn ghost" href="/admin/calendar?month=${next}"${tip('cal.next')}>Next month &rarr;</a>
      </div>
      <h2>${esc(new Date(`${first}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }))}</h2>
      <div class="month">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>
    </section>${uns}</div></div>
    <form id="move-form" method="post" action="" hidden><input type="hidden" name="date" value=""></form>
    <script>${CAL_JS}${VIEW_JS}</script>`, { screen: '', back: BACK_REQUESTS, wide: true });
}

const VIEW_JS = `
(function(){
  var KEY='pnp-cal-view';
  function show(v){document.querySelectorAll('[data-pane]').forEach(function(p){p.hidden=p.getAttribute('data-pane')!==v;});
    document.querySelectorAll('[data-view]').forEach(function(b){var on=b.getAttribute('data-view')===v;b.setAttribute('aria-pressed',on?'true':'false');b.classList.toggle('ghost',!on);});
    try{localStorage.setItem(KEY,v);}catch(e){}}
  document.querySelectorAll('[data-view]').forEach(function(b){b.addEventListener('click',function(){show(b.getAttribute('data-view'));});});
  var saved=null;try{saved=localStorage.getItem(KEY);}catch(e){}if(saved==='list'||saved==='month'||saved==='held')show(saved);
  var past=document.querySelector('[data-show-past]');if(past)past.addEventListener('click',function(){var box=document.getElementById('past-list');box.hidden=!box.hidden;past.setAttribute('aria-pressed',box.hidden?'false':'true');past.textContent=box.hidden?'Show past bookings':'Hide past bookings';});
})();`;

function listEntry(b, ctx) {
  return `<a class="item" href="/admin/day/${esc(b.date)}"${tip('cal.day')}><strong>${esc(shortDate(b.date))}${b.time ? `, ${esc(prettyTime(b.time))}` : ''}</strong> ${kindTag(b.kind)} ${esc(b.customer_name || 'No name')}
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

export function dayPage({ date, today, bookings, ctx, windows, table, sheetText, settings, flash = '', error = '', holds = [] }) {
  const u = usageOn(windows, date, today, table);
  let owedTotal = 0; let depositTotal = 0;
  const rows = bookings.map((b) => {
    const c = ctx(b);
    const owe = c.bal && !c.bal.void ? c.bal.owed : 0;
    if (b.kind === 'rental_pickup' || !RENTAL.has(b.kind)) { owedTotal += owe; depositTotal += c.bal && !c.bal.void ? c.bal.depositOwed : 0; }
    return { b, c, owe };
  });
  const strip = `<section class="card"><h2>Games: what is out on ${esc(shortDate(date))}</h2>
    <p data-day-count><strong>${u.count} ${u.count === 1 ? 'game' : 'games'} out.</strong></p>
    ${u.over.length ? `<div class="notice err" data-overlap><strong>Double-booked:</strong> ${u.over.map((o) => `${esc(o.item)} (you have ${o.stock}) is out with ${esc(o.who.map((w) => w.name).join(' and '))}.`).join(' ')}</div>` : ''}
    <div class="strip" data-strip>${table.items.map((it) => { const v = u.byItem[it.name]; const n = v.who.length; return `<div class="it ${n > v.stock ? 'over' : (n ? 'out' : '')}"><strong>${esc(it.name)}</strong><br>${n ? `Out (${n} of ${v.stock})` : 'In'}${n ? `<div class="muted">${esc(v.who.map((w) => `${w.name}, back ${shortDate(w.end)}`).join('; '))}</div>` : ''}</div>`; }).join('')}</div>
    ${u.out.some((w) => w.unnamed) ? `<p class="muted">${esc(u.out.filter((w) => w.unnamed).map((w) => `${w.name}: ${w.unnamed} game${w.unnamed === 1 ? '' : 's'} not picked yet`).join('; '))}</p>` : ''}
    ${u.out.length ? `<div data-out-list>${u.out.flatMap((w) => w.names.map((n) => `<div>${esc(n)} — ${esc(w.name)}, back ${esc(shortDate(w.end))}</div>`)).join('')}</div>` : ''}</section>`;
  const holdsToday = holds.length ? `<section class="card" data-day-holds><h2>Holds ending this day</h2>${holds.map((h) => `<div><strong>${esc(h.timeLabel)}: ${esc(h.name || 'No name')}</strong> · ${esc(h.items || '')} · deposit not in yet</div>`).join('')}</section>` : '';
  const loading = rows.filter((r) => r.b.kind === 'rental_pickup');
  const load = loading.length ? `<section class="card" data-load><h2>Load these items</h2>${loading.map((r) => {
    const w = windows.find((x) => x.key === (r.b.request_key || `m:${String(r.b.customer_name).toLowerCase()}|${String(r.b.items).toLowerCase()}`));
    const names = w ? w.names : [];
    return `<div><strong>${esc(r.b.customer_name || 'No name')}:</strong> ${esc(names.join(', ') || r.b.items || '')}${w && w.unnamed ? `, plus ${w.unnamed} game${w.unnamed === 1 ? '' : 's'} they still need to pick` : ''}</div>`;
  }).join('')}</section>` : '';
  const sheet = `<section class="card"><h2>Day sheet</h2><table class="sheet" data-day-sheet><thead><tr><th>✓</th><th>Time</th><th>What</th><th>Customer</th><th>Items and where</th><th>Still owed</th><th>Notes</th></tr></thead><tbody>
    ${rows.map(({ b, c, owe }) => `<tr data-sheet-row="${b.id}"><td><span class="box"></span></td><td>${esc(b.time ? prettyTime(b.time) : 'Any time')}</td><td>${esc(`${serviceInfo(b.kind).short}: ${KIND_LABELS[b.kind]}`)}</td>
      <td><strong>${esc(b.customer_name || 'No name')}</strong><br>${esc(b.phone || '')}</td><td>${esc(b.items || '')}${b.place ? `<br><span class="muted">${esc(b.place)}</span>` : ''}</td>
      <td>${c.bal && !c.bal.void ? `${esc(owe > 0 ? money(owe) : 'Paid ✓')}${c.bal.refundable ? `<br><span class="muted">${esc(depositWords(c.bal))}</span>` : ''}` : ''}</td>
      <td>${(c.notes || []).map((n) => `<div>${esc(n.body)}</div>`).join('')}</td></tr>`).join('') || '<tr><td colspan="7">Nothing booked this day.</td></tr>'}
    </tbody></table>
    <p style="font-size:1.15rem" data-day-total><strong>Still to collect today: ${esc(money(owedTotal))}</strong>${depositTotal ? ` plus ${esc(money(depositTotal))} in refundable damage deposits` : ''}</p></section>`;
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
      <div class="spread"><h3 style="margin:0">${esc(b.customer_name || 'No name')}</h3>${kindTag(b.kind)}</div>
      <div><strong>${esc(b.time ? prettyTime(b.time) : 'Any time this day')}</strong></div>
      ${b.items ? `<div><strong>What:</strong> ${esc(b.items)}</div>` : ''}${b.place ? `<div><strong>Where:</strong> ${esc(b.place)}</div>` : ''}
      <div style="margin:6px 0">${statusBits(b, c)}</div>
      ${c.bal && c.bal.refundable && !c.bal.void ? `<div class="muted">${esc(depositWords(c.bal))}</div>` : ''}
      <div class="actions dayonly">
        ${tel(b.phone) ? act(`<a class="btn primary bigcall" href="${tel(b.phone)}"${tip('day.call')}>Call ${esc(b.phone)}</a>`, 'day.call') : '<p><strong>No phone on file.</strong></p>'}
        ${RENTAL.has(b.kind) && !returned ? act(`<a class="btn" href="/admin/returns?k=${esc(b64urlText(rk))}"${tip('ret.mark')}>Mark returned</a>`, 'ret.mark') : ''}
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
    ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}
    <h1>${esc(prettyDate(date))}</h1>
    ${tools}
    ${holdsToday}${sheet}${load}${strip}
    <div class="dayonly">${entries}
    ${act(`<a class="btn" href="/admin/calendar/new?date=${esc(date)}"${tip('cal.add')}>Add a booking on this day</a>`, 'cal.add')}</div>`, { screen: 'day', back: { href: `/admin/calendar?month=${date.slice(0, 7)}`, label: 'Back to the calendar' } });
}

// ---- Scheduling form ----------------------------------------------------------------------

export function bookingFormPage({ booking, action, title, rk = '', isNew = true, returnDate = '', avail = null, windowsJson = '[]', table, ignoreKey = '' }) {
  const rental = RENTAL.has(booking.kind);
  const total = table.items.length;
  const outCount = avail ? table.items.filter((it) => avail[it.name] <= 0).length : 0;
  const chosen = new Set(String(booking.items || '').toLowerCase().split(/,\s*/));
  const itemBoxes = `<fieldset id="rent-items" style="border:0;padding:0;margin:12px 0"${rental ? '' : ' hidden'}><legend style="font-weight:600">Which items</legend>
    <p data-avail-line><strong>On these dates: <span id="out-n">${outCount}</span> of ${total} items already out.</strong></p>
    ${table.items.map((it) => { const na = avail && avail[it.name] <= 0; const on = [...chosen].some((c) => c.includes(it.name.toLowerCase())); return `<label class="itemcheck${na ? ' na' : ''}" data-item="${esc(it.name)}"><input type="checkbox" name="item" value="${esc(it.name)}"${on ? ' checked' : ''}${na && !on ? ' disabled' : ''}> ${esc(it.name)} <span class="muted" data-na>${na ? '(out on these dates)' : ''}</span></label>`; }).join('')}
  </fieldset>`;
  const js = `(function(){var W=${windowsJson},S=${JSON.stringify(table.items.map((i) => [i.name, i.quantity || 1]))},IGN=${JSON.stringify(ignoreKey)};
    var f=document.getElementById('bk'),kind=f.querySelector('[name=kind]'),d=f.querySelector('[name=date]'),r=f.querySelector('[name=return_date]');
    function add(s,n){var x=new Date(s+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);}
    function out(w,day){if(day<w.start)return false;if(w.returnedDay)return day<w.returnedDay;return day<=w.last;}
    function upd(){var rent=/^rental_/.test(kind.value);document.getElementById('rent-items').hidden=!rent;var rw=document.getElementById('ret-wrap');if(rw)rw.hidden=kind.value!=='rental_pickup';if(!rent||!d.value)return;
      var end=(r&&r.value&&r.value>=d.value)?r.value:d.value,n=0;S.forEach(function(p){var left=p[1];for(var day=d.value;day<=end;day=add(day,1)){var c=W.filter(function(w){return w.key!==IGN&&out(w,day)&&w.names.indexOf(p[0])>=0;}).length;left=Math.min(left,p[1]-c);}
        var lab=f.querySelector('[data-item="'+p[0].replace(/"/g,'\\\\"')+'"]'),box=lab.querySelector('input'),na=left<=0;if(na)n++;lab.classList.toggle('na',na);if(!box.checked)box.disabled=na;lab.querySelector('[data-na]').textContent=na?'(out on these dates)':'';});
      document.getElementById('out-n').textContent=n;}
    f.addEventListener('change',upd);upd();})();`;
  return layout(title, `<style>${CAL_CSS}</style><h1>${esc(title)}</h1>
    <form id="bk" class="card" method="post" action="${esc(action)}">
      ${rk ? hiddenInputs({ r: rk }) : ''}
      <label for="kind">What kind of booking</label>
      <select id="kind" name="kind">${KINDS.map((k) => `<option value="${k}"${k === booking.kind ? ' selected' : ''}>${esc(KIND_LABELS[k])}</option>`).join('')}</select>
      <label for="date">Day</label><input id="date" name="date" type="date" required value="${esc(booking.date || '')}">
      <div id="ret-wrap"${booking.kind === 'rental_pickup' && isNew ? '' : ' hidden'}><label for="ret">Return day (a Rental return is added for this day)</label><input id="ret" name="return_date" type="date" value="${esc(returnDate)}"></div>
      <label for="time">Time (leave empty for all day)</label><input id="time" name="time" type="time" value="${esc(booking.time || '')}">
      <label for="cn">Customer name</label><input id="cn" name="customer_name" value="${esc(booking.customer_name || '')}" required>
      <label for="ph">Phone</label><input id="ph" name="phone" type="tel" value="${esc(booking.phone || '')}">
      <label for="em">Email (for the automatic reminder)</label><input id="em" name="email" type="email" value="${esc(booking.email || '')}">
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
