// Hold controls, "Holds ending soon", the deposit-received screen, the thank-you box and the
// twin message buttons (owner, 18 Oct 2026). Every text button is a free sms: link from
// Valerie's phone, and every one has its twin "Email them" that sends at once from hello@,
// both from the one templates map (messages.mjs). Same rules as views.mjs: plain words,
// 48 px targets, every control carries data-help + its title from helptext.mjs.
import { esc, b64urlText } from './util.mjs';
import { tip } from './helptext.mjs';
import { HOLD_EXTEND_DAYS, HOLD_EXTEND_MAX_DAYS } from './hold-rules.mjs';
import { act, confirmStep, hiddenInputs, layout, msgPair } from './views.mjs';

const MS_H = 3600000;

// "Ends today 3:00 PM (in 2 hours)" / "Ends Sun 26 Oct, 3:00 PM (in 1 day)".
export function endsWords(untilMs, now = Date.now()) {
  const tz = 'America/Chicago';
  const day = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz });
  const time = new Date(untilMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const left = untilMs - now;
  const inWords = left <= 0 ? 'ended' : left < MS_H ? `in ${Math.max(1, Math.round(left / 60000))} minutes` : left < 36 * MS_H ? `in ${Math.round(left / MS_H)} hour${Math.round(left / MS_H) === 1 ? '' : 's'}` : `in ${Math.round(left / (24 * MS_H))} days`;
  const tomorrow = day(now + 24 * MS_H);
  const label = day(untilMs) === day(now) ? `today ${time}` : day(untilMs) === tomorrow ? `tomorrow ${time}` : `${new Date(untilMs).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).replace(/^(\w+), (\w+) (\d+)$/, '$1 $3 $2')}, ${time}`;
  return { text: `Ends ${label} (${inWords})`, level: left < MS_H ? 'red' : 'amber' };
}

// A text button (sms:) and its email twin. tap = the request's key for the tap log.
export function twinButtons({ sms, rk, template, textKey, emailKey, textLabel, emailLabel = 'Email them', canEmail = true, sent = '' }) {
  const text = sms ? act(`<a class="btn" href="${esc(sms.href)}" data-msg-tap="${esc(template)}" data-rk="${esc(rk)}"${tip(textKey)}>${esc(textLabel)}</a>`, textKey) : '<p style="margin:0"><strong>No mobile number on file.</strong></p>';
  const email = canEmail ? `<form method="post" action="/admin/msg/email">${hiddenInputs({ r: rk, template })}${act(`<button class="btn ghost" type="submit"${tip(emailKey)}>${esc(emailLabel)}</button>`, emailKey)}</form>` : '';
  return `<div class="actions">${text}${email}</div>${sent ? `<p class="money ok" style="margin:4px 0 0">${esc(sent)}</p>` : ''}`;
}

export const TAP_JS = `<script>(function(){document.addEventListener('click',function(e){var a=e.target.closest('[data-msg-tap]');if(!a)return;var f=new FormData();f.append('r',a.getAttribute('data-rk'));f.append('template',a.getAttribute('data-msg-tap'));try{fetch('/admin/msg/tapped',{method:'POST',body:f,headers:{'X-Pnp-Fetch':'1'},credentials:'same-origin',keepalive:true});}catch(err){}});})();</script>`;

// "Games held until Wed 3 PM" (Memphis): weekday + time within the week, else with the date.
export function heldUntilWords(untilMs, now = Date.now()) {
  if (!Number.isFinite(untilMs)) return '';
  const tz = 'America/Chicago';
  const d = new Date(untilMs);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(':00', '');
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz });
  if (untilMs - now < 6 * 24 * MS_H) return `${wd} ${time}`;
  const day = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: tz }).replace(/^(\w+) (\d+)$/, '$2 $1');
  return `${wd} ${day}, ${time}`;
}

// "Fri 23 Oct, 11:59 PM" (Memphis): the one way a reserved-until date is written in the admin.
// RESERVE_JS formats the live "New date" the same way (same Intl options, same timezone).
export function reservedWords(untilMs) {
  if (!Number.isFinite(untilMs)) return '';
  const d = new Date(untilMs);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Chicago' }).replace(',', '');
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
  return `${day}, ${time}`;
}
export const RESERVED_BY_HAND = 'Reserved by hand (no end date)';
// The new end the server will set for N more days (holds.mjs extendHold): from the current end,
// or from now when there is none or it has passed.
export const reserveNewEnd = (untilMs, days, now = Date.now()) => Math.max(now, Number.isFinite(untilMs) ? untilMs : now) + days * 24 * MS_H;

// "Reserve their games longer" (owner-approved sample, 20 Oct 2026): a two-line button
// ("Give more time to pay") that opens inline: "Held until <end>", [3] more days + Save, a live
// "New date: <...>" line that follows what she types, and Cancel. Save adds N days to the
// current end (a hold with no end date: now + N days) and comes back "✓ Games reserved until
// <new date>"; the control is there again, so it is repeatable. card: answer back on that card.
export function reserveLongerControl(rk, { untilMs = NaN, back = '/admin/', card = false, now = Date.now() } = {}) {
  const timed = Number.isFinite(untilMs);
  const id = `hd${card ? "c" : ""}-${esc(rk)}`; // a card can show it twice (step box + More)
  return `<details class="reslonger" data-reserve-longer data-until-ms="${timed ? untilMs : ''}"><summary class="btn ghost ressum"${tip('hold.longer')}><b>Reserve their games longer</b><span class="ressub">Give more time to pay</span></summary>
    <div class="resext"><p class="restitle">Reserve their games longer</p><p class="muted" data-res-current>${timed ? `Held until ${esc(reservedWords(untilMs))}` : RESERVED_BY_HAND}</p>
    <form class="hlrow" method="post" action="/admin/holds/extend">${hiddenInputs({ r: rk, back, ...(card ? { card: '1' } : {}) })}
      <input id="${id}" type="number" name="days" value="${HOLD_EXTEND_DAYS}" min="1" max="${HOLD_EXTEND_MAX_DAYS}" step="1" inputmode="numeric" required aria-label="More days" data-res-days${tip('hold.days')}><label for="${id}">more days</label>
      <button class="btn primary ressave" type="submit"${tip('hold.go')}>Save</button></form>
    <p class="resnew" data-res-new>New date: <b>${esc(reservedWords(reserveNewEnd(untilMs, HOLD_EXTEND_DAYS, now)))}</b></p>
    <button class="rescancel" type="button" data-res-cancel${tip('hold.cancel')}>Cancel</button></div></details>${RESERVE_JS}`;
}

// The live "New date" line and Cancel. Idempotent: many controls on a page bind it once.
export const RESERVE_JS = `<script>(function(){if(window.__pnpRes)return;window.__pnpRes=1;var MAX=${HOLD_EXTEND_MAX_DAYS};function words(ms){var d=new Date(ms);var day=d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'America/Chicago'}).replace(',','');var t=d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/Chicago'});return day+', '+t;}function upd(box){var i=box.querySelector('[data-res-days]'),o=box.querySelector('[data-res-new]');if(!i||!o)return;var n=Number(i.value);var u=Number(box.getAttribute('data-until-ms'));var base=Math.max(Date.now(),box.getAttribute('data-until-ms')&&isFinite(u)?u:Date.now());if(!(Number.isInteger(n)&&n>=1&&n<=MAX)){o.textContent='Type a whole number of days, 1 to '+MAX+'.';return;}o.innerHTML='New date: <b></b>';o.querySelector('b').textContent=words(base+n*86400000);}document.addEventListener('input',function(e){var box=e.target.closest&&e.target.closest('[data-reserve-longer]');if(box&&e.target.matches('[data-res-days]'))upd(box);});document.addEventListener('toggle',function(e){var box=e.target;if(box.matches&&box.matches('[data-reserve-longer]')&&box.open){upd(box);var i=box.querySelector('[data-res-days]');if(i)i.focus();}},true);document.addEventListener('click',function(e){var c=e.target.closest&&e.target.closest('[data-res-cancel]');if(!c)return;var box=c.closest('[data-reserve-longer]');if(box)box.open=false;});})();</script>`;

// The hold controls for one held rental (request card, holds box, calendar). compact: on a
// request card, where the card's ONE big button is its primary, so the reminder is a small
// "Text a reminder · Email it" pair. On the card (under More → Money) it never repeats what
// the card already shows (owner, 20 Oct 2026): no second Call, no games list, no second
// "Reserve their games longer" (the card draws its own), and Release reads "Release the games now".
export function holdControls(h, { rk, sms = null, canEmail = false, now = Date.now(), depositTarget = null, back = '/admin/', compact = false }) {
  const ends = h.by_hand ? { text: RESERVED_BY_HAND, level: 'amber' } : endsWords(h.untilMs, now);
  const hidden = hiddenInputs({ r: rk, back });
  // "Reserve their games longer" (owner, 20 Oct 2026): the button, then Save (3 days prefilled;
  // the number she types is honoured). No 24 / 48 hour menus, no other choices.
  const more = reserveLongerControl(rk, { untilMs: h.by_hand ? NaN : h.untilMs, back, now });
  const keep = '';
  const release = confirmStep({ key: h.by_hand ? 'hold.releaseHand' : 'hold.release', yesKey: 'hold.releaseYes', label: h.by_hand ? 'Release these games' : (compact ? 'Release the games now' : 'Release now'), question: `Release ${h.name || 'this customer'}'s games now? They come off the calendar and others can book them.`, action: '/admin/holds/release', hidden, danger: true });
  const deposit = depositTarget ? confirmStep({ key: 'hold.deposit', yesKey: 'hold.depositYes', label: 'Mark deposit received', question: `Mark ${h.name || 'this customer'}'s deposit as received? Only do this after the money is in your account. The hold becomes a confirmed booking.`, action: depositTarget.action, hidden: hiddenInputs(depositTarget.fields) }) : '';
  return `<div class="hold" data-hold="${esc(rk)}"><p><span class="chip deposit_paid" data-held>Held — waiting for deposit</span> <strong class="ends ${ends.level}" data-hold-ends>${esc(ends.text)}</strong></p>
    ${h.items && !compact ? `<p class="muted" style="margin:0">${esc(h.items)}</p>` : ''}
    ${h.phone && !compact ? act(`<a class="btn ghost" href="tel:${esc(String(h.phone).replace(/[^\d+]/g, ''))}"${tip('hold.call')}>Call</a>`, 'hold.call') : ''}
    ${compact ? `<div class="msgline" data-messages>${msgPair({ sms, rk, template: 'holdEnding', textKey: 'hold.text', emailKey: 'hold.email', textLabel: 'Text a reminder', canEmail })}</div>`
    : twinButtons({ sms, rk, template: 'holdEnding', textKey: 'hold.text', emailKey: 'hold.email', textLabel: 'Text a reminder', canEmail })}
    <div class="actions">${deposit}${keep}${release}</div>${compact ? '' : more}</div>`;
}

export const HOLD_CSS = '.reslonger{margin-top:8px}.reslonger>summary.ressum{list-style:none;display:grid;gap:1px;width:100%;min-height:48px;text-align:left;justify-items:start;padding:10px 12px}.reslonger>summary::-webkit-details-marker{display:none}.ressum b{font-size:1rem}.ressum .ressub{font-size:.85rem;color:#6f6359;font-weight:400}.reslonger[open]>summary{display:none}.resext{border:1.5px solid #b65f3e;border-radius:10px;padding:12px;display:grid;gap:8px}.resext p{margin:0}.restitle{font-weight:700}.resnew b{color:#2f7a46}.rescancel{background:none;border:0;color:#6f6359;text-decoration:underline;padding:0;justify-self:start;min-height:32px;cursor:pointer;font:inherit}.hlrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0}.hlrow input{width:5.5em;min-height:48px;font-size:1.1rem;margin:0}.hlrow .btn{width:auto;min-height:48px;padding:8px 22px}.hold{border:2px solid #ebcf96;background:#fffaf0;border-radius:12px;padding:10px 12px;margin:10px 0}.ends.amber{color:#7a4a0c}.ends.red{color:#8f3427}.hold .actions{margin-top:6px}';

// "Holds ending soon" (top of Requests and Calendar): every unpaid hold ending within the
// Settings threshold, soonest first.
export function holdsSoonBox(rows, { now = Date.now(), soonHours = 12, back = '/admin/' } = {}) {
  if (!rows.length) return '';
  return `<section class="card" data-holds-soon><style>${HOLD_CSS}</style><h2>Holds ending soon <small class="muted">${rows.length}</small></h2>
    <p class="muted" style="margin:0 0 6px">Game rentals waiting for a deposit, ending in the next ${soonHours} hours.</p>
    ${rows.map((h) => `<div class="booking" data-hold-soon><strong>${esc(h.name || 'No name given')}</strong>${holdControls(h, { rk: b64urlText(h.request_key), sms: h.sms, canEmail: h.canEmail, now, depositTarget: h.depositTarget, back })}</div>`).join('')}
    ${TAP_JS}</section>`;
}

// The calendar's "Held" view: every current hold with its end time; held-by-hand apart.
export function heldPane(holds, { now = Date.now() } = {}) {
  const timed = holds.filter((h) => !h.by_hand);
  const byHand = holds.filter((h) => h.by_hand);
  const row = (h) => `<div class="item" data-held-row><strong>${esc(h.name || 'No name')}</strong> · ${esc(h.items || '')}<br><span class="muted">${h.by_hand ? RESERVED_BY_HAND : `Games reserved until ${esc(reservedWords(h.untilMs))}`}${h.pickup ? ` · pickup ${esc(h.pickup)}` : ''}</span></div>`;
  return `<section class="card upcoming" data-held-view><h2>Held (waiting for a deposit)</h2>${timed.length ? timed.map(row).join('') : '<p class="muted">No holds with an end time.</p>'}
    <h3>${RESERVED_BY_HAND}</h3>${byHand.length ? byHand.map(row).join('') : '<p class="muted">None.</p>'}</section>`;
}

// After "Mark deposit received": the big "Text them it's confirmed" button.
export function confirmedPage({ rk, name, sms, emailed, texted, canEmail, flash, back, phone = false }) {
  return layout('Deposit received', `${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}<h1>${esc(name || 'They')} ${name ? 'is' : 'are'} booked</h1>
    <section class="card" data-confirmed><p>Let them know it is confirmed.</p>
      ${twinButtons({ sms, rk, template: 'confirmation', textKey: 'conf.text', emailKey: 'conf.email', textLabel: "Text them it's confirmed", emailLabel: 'Email them', canEmail: canEmail && !emailed })}
      ${emailed ? '<p class="money ok" data-confirm-emailed>Confirmation email sent ✓</p>' : (phone ? '<p class="muted" data-phone-no-confirm>Phone booking: no confirmation email is sent. Text them if you want to.</p>' : (canEmail ? '' : '<p class="muted">No email on file, so no confirmation email.</p>'))}
      ${texted ? '<p class="money ok" data-confirm-texted>Confirmation sent ✓</p>' : ''}</section>
    <div class="actions">${act(`<a class="btn ghost" href="${esc(back || '/admin/')}"${tip('conf.back')}>Done</a>`, 'conf.back')}</div>${TAP_JS}`, { screen: 'confirmed', back: { href: back || '/admin/', label: 'Back' } });
}

// The thank-you box on a request whose job is done / games are back (on the card: small links,
// never a second big button).
export function thankYouBox(r, { rk, sms, canEmail, now = Date.now() }) {
  void now;
  // ONE small muted line at the bottom of the card (owner, 18 Oct 2026: "less bulky"):
  // "Thank-you email goes out tomorrow morning · Text a thank-you · Email it now · Don't send".
  const sentWords = r.thankyouEmailedAt ? 'Thank-you email sent ✓' : r.thankyouSkip ? 'No thank-you email (you chose not to send one)' : canEmail ? 'Thank-you email goes out tomorrow morning' : 'No email on file, so no thank-you email';
  const pair = msgPair({ sms, rk, template: 'thankyou', textKey: 'ty.text', emailKey: 'ty.email', textLabel: 'Text a thank-you', emailLabel: 'Email it now', canEmail: canEmail && !r.thankyouEmailedAt });
  const toggle = r.thankyouEmailedAt ? '' : `<form method="post" action="/admin/requests/thankyou-skip">${hiddenInputs({ r: rk, skip: r.thankyouSkip ? '0' : '1' })}<button class="linkbtn" type="submit"${tip(r.thankyouSkip ? 'ty.unskip' : 'ty.skip')}>${r.thankyouSkip ? 'Send it after all' : "Don't send"}</button></form>`;
  const sep = '<span aria-hidden="true">·</span>';
  return `<div class="tyline" data-thankyou><span data-thankyou-state>${esc(sentWords)}</span>${sep}${pair}${r.thankyouTextedAt ? `${sep}<span>Thank-you text sent ✓</span>` : ''}${toggle ? `${sep}${toggle}` : ''}</div>`;
}
