// Hold controls, "Holds ending soon", the deposit-received screen, the thank-you box and the
// twin message buttons (owner, 18 Oct 2026). Every text button is a free sms: link from
// Valerie's phone, and every one has its twin "Email them" that sends at once from hello@,
// both from the one templates map (messages.mjs). Same rules as views.mjs: plain words,
// 48 px targets, every control carries data-help + its title from helptext.mjs.
import { esc, b64urlText } from './util.mjs';
import { tip } from './helptext.mjs';
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

// The hold controls for one held rental (request card, holds box, calendar). compact: on a
// request card, where the card's ONE big button is its primary, so the reminder is a small
// "Text a reminder · Email it" pair.
export function holdControls(h, { rk, sms = null, canEmail = false, now = Date.now(), depositTarget = null, back = '/admin/', compact = false }) {
  const ends = h.by_hand ? { text: 'Held by hand (no end time)', level: 'amber' } : endsWords(h.untilMs, now);
  const hidden = hiddenInputs({ r: rk, back });
  const more = `<details class="disclose" data-hold-more><summary${tip('hold.more')}>Give them more time</summary>
    <div class="actions">
      <form method="post" action="/admin/holds/extend">${hidden}<input type="hidden" name="hours" value="24">${act(`<button class="btn ghost" type="submit"${tip('hold.plus24')}>+24 hours</button>`, 'hold.plus24')}</form>
      <form method="post" action="/admin/holds/extend">${hidden}<input type="hidden" name="hours" value="48">${act(`<button class="btn ghost" type="submit"${tip('hold.plus48')}>+48 hours</button>`, 'hold.plus48')}</form>
    </div>
    <form method="post" action="/admin/holds/extend">${hidden}<label for="until-${esc(rk)}">Or pick a day and time</label><input id="until-${esc(rk)}" type="datetime-local" name="until" required>
      ${act(`<button class="btn ghost" type="submit"${tip('hold.pick')}>Hold until then</button>`, 'hold.pick')}</form></details>`;
  const keep = h.by_hand ? '' : `<form method="post" action="/admin/holds/keep">${hidden}${act(`<button class="btn ghost" type="submit"${tip('hold.keep')}>Keep holding — I'll handle it</button>`, 'hold.keep')}</form>`;
  const release = confirmStep({ key: h.by_hand ? 'hold.releaseHand' : 'hold.release', yesKey: 'hold.releaseYes', label: h.by_hand ? 'Release these games' : 'Release now', question: `Release ${h.name || 'this customer'}'s games now? They come off the calendar and others can book them.`, action: '/admin/holds/release', hidden, danger: true });
  const deposit = depositTarget ? confirmStep({ key: 'hold.deposit', yesKey: 'hold.depositYes', label: 'Mark deposit received', question: `Mark ${h.name || 'this customer'}'s deposit as received? Only do this after the money is in your account. The hold becomes a confirmed booking.`, action: depositTarget.action, hidden: hiddenInputs(depositTarget.fields) }) : '';
  return `<div class="hold" data-hold="${esc(rk)}"><p><span class="chip deposit_paid" data-held>Held — waiting for deposit</span> <strong class="ends ${ends.level}" data-hold-ends>${esc(ends.text)}</strong></p>
    ${h.items ? `<p class="muted" style="margin:0">${esc(h.items)}</p>` : ''}
    ${h.phone ? act(`<a class="btn ghost" href="tel:${esc(String(h.phone).replace(/[^\d+]/g, ''))}"${tip('hold.call')}>Call</a>`, 'hold.call') : ''}
    ${compact ? `<div class="msgline" data-messages>${msgPair({ sms, rk, template: 'holdEnding', textKey: 'hold.text', emailKey: 'hold.email', textLabel: 'Text a reminder', canEmail })}</div>`
    : twinButtons({ sms, rk, template: 'holdEnding', textKey: 'hold.text', emailKey: 'hold.email', textLabel: 'Text a reminder', canEmail })}
    <div class="actions">${deposit}${keep}${release}</div>${more}</div>`;
}

export const HOLD_CSS = '.hold{border:2px solid #ebcf96;background:#fffaf0;border-radius:12px;padding:10px 12px;margin:10px 0}.ends.amber{color:#7a4a0c}.ends.red{color:#8f3427}.hold .actions{margin-top:6px}';

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
  const row = (h) => `<div class="item" data-held-row><strong>${esc(h.name || 'No name')}</strong> · ${esc(h.items || '')}<br><span class="muted">${h.by_hand ? 'No end time' : esc(endsWords(h.untilMs, now).text)}${h.pickup ? ` · pickup ${esc(h.pickup)}` : ''}</span></div>`;
  return `<section class="card upcoming" data-held-view><h2>Held (waiting for a deposit)</h2>${timed.length ? timed.map(row).join('') : '<p class="muted">No holds with an end time.</p>'}
    <h3>Held by hand (no end time)</h3>${byHand.length ? byHand.map(row).join('') : '<p class="muted">None.</p>'}</section>`;
}

// After "Mark deposit received": the big "Text them it's confirmed" button.
export function confirmedPage({ rk, name, sms, emailed, texted, canEmail, flash, back }) {
  return layout('Deposit received', `${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}<h1>${esc(name || 'They')} ${name ? 'is' : 'are'} booked</h1>
    <section class="card" data-confirmed><p>Let them know it is confirmed.</p>
      ${twinButtons({ sms, rk, template: 'confirmation', textKey: 'conf.text', emailKey: 'conf.email', textLabel: "Text them it's confirmed", emailLabel: 'Email them', canEmail: canEmail && !emailed })}
      ${emailed ? '<p class="money ok" data-confirm-emailed>Confirmation email sent ✓</p>' : (canEmail ? '' : '<p class="muted">No email on file, so no confirmation email.</p>')}
      ${texted ? '<p class="money ok" data-confirm-texted>Confirmation sent ✓</p>' : ''}</section>
    <div class="actions">${act(`<a class="btn ghost" href="${esc(back || '/admin/')}"${tip('conf.back')}>Done</a>`, 'conf.back')}</div>${TAP_JS}`, { screen: 'confirmed', back: { href: back || '/admin/', label: 'Back' } });
}

// The thank-you box on a request whose job is done / games are back (on the card: small links,
// never a second big button).
export function thankYouBox(r, { rk, sms, canEmail, now = Date.now() }) {
  const sentWords = r.thankyouEmailedAt ? 'Thank-you email sent ✓' : r.thankyouSkip ? 'No thank-you email (you chose not to send one).' : canEmail ? 'Thank-you email goes out tomorrow morning.' : 'No email on file, so no thank-you email.';
  const toggle = `<form method="post" action="/admin/requests/thankyou-skip">${hiddenInputs({ r: rk, skip: r.thankyouSkip ? '0' : '1' })}${act(`<button class="btn ghost" type="submit"${tip(r.thankyouSkip ? 'ty.unskip' : 'ty.skip')}>${r.thankyouSkip ? 'Send the thank-you after all' : "Don't send a thank-you"}</button>`, r.thankyouSkip ? 'ty.unskip' : 'ty.skip')}</form>`;
  return `<section class="paybox" data-thankyou><h3>Send a thank-you</h3><p class="words" data-thankyou-state>${esc(sentWords)}</p>
    <div class="msgline" data-messages>${msgPair({ sms, rk, template: 'thankyou', textKey: 'ty.text', emailKey: 'ty.email', textLabel: 'Text a thank-you', emailLabel: 'Email it now', canEmail: canEmail && !r.thankyouEmailedAt })}</div>
    ${r.thankyouTextedAt ? '<p class="money ok" style="margin:4px 0 0">Thank-you text sent ✓</p>' : ''}
    ${r.thankyouEmailedAt ? '' : toggle}</section>`;
}
