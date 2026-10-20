// Server-rendered pages for the /admin console. Built for one non-technical person on a phone:
// plain words, one obvious button per step, big tap targets (48 px+), 16 px+ type, no hover-only
// controls, no framework, no analytics. Every button and link carries data-help + a title from
// the one map in helptext.mjs, primary actions carry a visible helper line under them, every
// screen opens with a numbered 1-2-3 and (except Requests itself) a Back link.
import { esc, money, lineTotal, invoiceTotal, prettyDate, shortDate, STATUS_LABELS, SHEET_URL, SA_EMAIL, b64urlText, needsPrice, payPlanOf } from './util.mjs';
import { tip, hint, stepsBar, stepsPanel, helpGlossary, STEPS } from './helptext.mjs';
import { servicesOf, cardStage, cardButtons, cardPayment, cardDates, grazingFacts, notPaidYet, matchesFilter, serviceBadge, FILTERS, inlineRowKind, SCHEDULE_FIRST } from './cards.mjs';
import { HOLD_DEFAULT_HOURS } from './hold-rules.mjs';
import { reserveLongerControl, reservedWords, RESERVED_BY_HAND, HOLD_CSS } from './views-messages.mjs';
import { deriveSteps, undoFor, waitingDays, waitingWords, sentMs, WAIT_HIGHLIGHT_DAYS } from './steps.mjs';
import { parseFormDate, deliveryAddress, PICKUP_CHOICES, RETURN_CHOICES } from './calendar.mjs';
import { dueWords } from './ledger.mjs';
import { DELIVERY_LINE } from './invoice-note.mjs';
import { kindCss } from './kinds.mjs';
import { deriveProgress, STATUS_MEANINGS } from './progress.mjs';
import { takedownState, inlineDefaultDate } from './takedown.mjs';
import PP from '../../scripts/lib/porch_packages.js';
import SERVICES_DATA from '../../data/offers/services.json';
import { isPhone, rentalDates, rentalSpanWords, rentalLength } from './phone-requests.mjs';
import { lateWords, missedCountWords } from './missed.mjs';
import { dayWords } from './reminders.mjs';

const CSS = `
:root{--cream:#faf7f2;--ink:#3b302a;--accent:#b85f40;--line:#e3d8cb;--muted:#5f5148;--card:#fff;--ok:#3f6b3a;--warn:#8a5212}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--cream);color:var(--ink);font:17px/1.5 Inter,"Helvetica Neue",Arial,sans-serif}
a{color:var(--accent)}h1,h2,h3{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;line-height:1.15;margin:0 0 .4em}
h1{font-size:2rem}h2{font-size:1.55rem}h3{font-size:1.4rem}
.wrap{max-width:760px;margin:0 auto;padding:16px}
header.top{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--line);background:var(--card)}
header.top .brand{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.5rem;font-weight:600;text-decoration:none;color:var(--ink);min-height:48px;display:inline-flex;align-items:center}
header.top nav{display:flex;flex-wrap:wrap;gap:0 4px;align-items:center}
header.top nav a,header.top nav button{min-height:48px;display:inline-flex;align-items:center;padding:0 8px;font:600 1rem Inter,Arial,sans-serif;color:var(--accent);text-decoration:none;background:none;border:0;cursor:pointer}
.big-buttons{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:4px 0 18px}.big-buttons>*,.actions>*{min-width:0}
html,body{overflow-x:hidden}main,article,.card{min-width:0;overflow-wrap:anywhere}
.btn{display:flex;align-items:center;justify-content:center;gap:6px;min-height:52px;padding:12px 18px;border-radius:12px;border:2px solid var(--accent);background:var(--accent);color:#fff;font:600 1.05rem Inter,Arial,sans-serif;text-decoration:none;cursor:pointer;text-align:center;width:100%;-webkit-appearance:none;appearance:none}
.btn.ghost{background:#fff;color:var(--accent)}.btn.danger{background:#fff;color:#8f3427;border-color:#8f3427}
.btn.primary{min-height:60px;font-size:1.15rem}
.btn.inline{display:inline-flex;width:auto}
.actions{display:grid;grid-template-columns:1fr;gap:10px;margin-top:12px}
@media(min-width:520px){.actions.three{grid-template-columns:1fr 1fr 1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:0 0 14px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.spread{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
.chip{display:inline-block;padding:4px 12px;border-radius:999px;font-size:.95rem;font-weight:600;border:1px solid var(--line);background:var(--cream);white-space:nowrap}
.chip.new{background:#fde9e1;border-color:#e9b9a6;color:#7a3519}.chip.invoiced,.chip.sent{background:#e8eefa;border-color:#b9c7ea;color:#2a3b70}
.chip.deposit_paid{background:#fff3dc;border-color:#ebcf96;color:var(--warn)}.chip.paid{background:#e4f1e1;border-color:#b2d3ab;color:var(--ok)}
.chip.phone{background:#e6f2f5;border-color:#8fbfcc;color:#1d4652}.idup{margin:8px 0 0}.idup label{font-weight:600}
.chip.done{background:#ececec;color:#444}.chip.void{background:#f4e1de;color:#8f3427}.chip.draft{background:#f3efe9;color:var(--ink)}
.when{color:var(--muted)}.want{font-size:1.05rem;margin:6px 0 2px}
dl.kv{display:grid;grid-template-columns:1fr;gap:2px 12px;margin:8px 0}dl.kv dt{color:var(--muted);font-size:.95rem}dl.kv dd{margin:0 0 8px;word-break:break-word}
details.more{margin-top:12px;border-top:1px solid var(--line)}
details.more>summary{list-style:none;cursor:pointer;min-height:48px;display:flex;align-items:center;font-weight:600;color:var(--accent)}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary::before{content:"+";display:inline-block;width:1.2em;font-size:1.3rem}
details.more[open]>summary::before{content:"\\2013"}
label{display:block;font-size:1rem;color:var(--muted);margin:12px 0 4px}
input,select,textarea{width:100%;font:17px Inter,Arial,sans-serif;padding:12px;border:1px solid #cbbcad;border-radius:10px;background:#fff;color:var(--ink);min-height:48px}
textarea{min-height:90px}
.notice{border-radius:12px;padding:14px 16px;margin:0 0 14px;border:1px solid}
.notice.warn{background:#fff3dc;border-color:#ebcf96}.notice.err{background:#f9e3de;border-color:#e3ada2}.notice.ok{background:#e4f1e1;border-color:#b2d3ab}
.notice a{font-weight:600}
.sumlines{width:100%;border-collapse:collapse}.sumlines td{padding:10px 0;border-bottom:1px solid var(--line);vertical-align:top}
.sumlines .amt{text-align:right;white-space:nowrap;padding-left:12px}
.calc{margin-top:10px;border-top:2px solid var(--ink);padding-top:8px}.calc .spread{padding:4px 0}.calc .now{color:var(--accent);font-size:1.15rem}
.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:6px 0 10px}@media(max-width:520px){.plans{grid-template-columns:1fr}}
.plan{display:flex;gap:8px;align-items:flex-start;border:1.5px solid var(--line);border-radius:10px;padding:10px;cursor:pointer;background:#fff;margin:0}
.plan input{margin-top:5px;width:auto}.plan strong{display:block}.plan small{color:var(--muted);line-height:1.3;display:block}
.plan:has(input:checked){border-color:var(--accent);background:#fbf0ea}
.emailframe{width:100%;border:0;display:block;min-height:720px;background:#faf7f2}
.bigtotal{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.7rem;font-weight:600}
.line{border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 10px;background:var(--cream)}
.line .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}.line .grid .full{grid-column:1/-1}
table.list{width:100%;border-collapse:collapse}table.list td{padding:12px 4px;border-bottom:1px solid var(--line);vertical-align:top}
table.list a{display:inline-block;min-height:32px}
.muted{color:var(--muted)}.right{text-align:right}
.steps{counter-reset:s;list-style:none;padding:0;margin:0}.steps li{counter-increment:s;margin:0 0 18px;padding-left:52px;position:relative}
.steps li::before{content:counter(s);position:absolute;left:0;top:0;width:38px;height:38px;border-radius:50%;background:var(--accent);color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center}
.pic{pointer-events:none;margin:8px 0;max-width:320px;padding:8px;border:1px dashed #cbbcad;border-radius:16px;background:var(--cream)}
`;

const EXTRA_CSS = `
.back{display:inline-flex;align-items:center;min-height:48px;font-weight:600;font-size:1.05rem;text-decoration:none;margin:0 0 4px}
.adminbar{display:flex;align-items:center;gap:10px;margin:-4px 0 10px;padding:0 0 6px;border-bottom:1px solid var(--line)}.adminbar .back{margin:0;padding:0 8px 0 0;font-size:1.1rem}
.adminbar .where{margin-left:auto;color:var(--muted);font-size:.98rem;text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.idview{position:fixed;inset:0;z-index:60;background:rgba(20,16,12,.94);color:#fff;display:grid;grid-template-rows:auto 1fr auto}.idview[hidden]{display:none}
.idview .idtop{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:max(12px,env(safe-area-inset-top)) 14px 12px}
.idview .idx{font:700 1.15rem Inter,Arial,sans-serif;background:#fff;color:#14110f;border:0;border-radius:999px;min-height:52px;padding:0 22px;cursor:pointer}
.idview .idx:focus-visible{outline:3px solid #f0b08f;outline-offset:3px}
.idview .idstage{display:flex;align-items:center;justify-content:center;padding:8px;min-height:0;overflow:auto}.idview .idstage img{max-width:100%;max-height:100%;object-fit:contain;border-radius:10px;background:#3a332e}
.idview .idfoot{margin:0;padding:10px 14px max(14px,env(safe-area-inset-bottom));text-align:center;color:#ddd;font-size:.95rem}
.idpage img{display:block;width:100%;height:auto;border-radius:12px;border:1px solid var(--line);margin:8px 0 14px;background:#eee}

.topsteps{list-style:none;margin:0 0 16px;padding:12px 14px;background:var(--card);border:1px solid var(--line);border-radius:14px;display:grid;gap:8px}
.topsteps li{display:flex;gap:10px;align-items:flex-start;font-size:1.05rem}
.topsteps .n{flex:none;width:30px;height:30px;border-radius:50%;background:var(--accent);color:#fff;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
.hint{margin:4px 2px 0;color:var(--muted);font-size:.95rem;line-height:1.35}
.act{min-width:0}
.subnav{display:flex;flex-wrap:wrap;gap:8px;padding:10px 16px;background:#f3ece3;border-bottom:1px solid var(--line)}
.subnav .act{flex:1 1 220px}
@media(max-width:560px){.subnav .act{flex-basis:100%}}
details.confirm>summary,details.disclose>summary{list-style:none}
details.confirm>summary::-webkit-details-marker,details.disclose>summary::-webkit-details-marker{display:none}
details.disclose{margin-top:12px;border-top:1px solid var(--line)}
details.disclose>summary{cursor:pointer;min-height:48px;display:flex;align-items:center;font-weight:600;color:var(--accent)}
details.disclose>summary::before{content:"\\25B8";display:inline-block;width:1.2em}
details.disclose[open]>summary::before{content:"\\25BE"}
.confirmbox{margin-top:10px;padding:14px;border:2px solid var(--warn);border-radius:12px;background:#fff8ea}
.confirmbox p{margin:0 0 10px;font-size:1.05rem}
.confirmbox .actions{margin-top:0}
.paybox{border:2px solid var(--line);border-radius:14px;padding:14px;margin-top:14px;background:#fff}
.paybox h3{margin:0 0 4px}.paybox .words{font-size:1.1rem;font-weight:600;margin:0 0 10px}
.chip.void{background:#e6e6e6;border-color:#c4c4c4;color:#444}.chip.step{background:#e8eefa;border-color:#b9c7ea;color:#2a3b70}.chip.job_done{background:#ececec;color:#333}
.progress{list-style:none;padding:0;margin:10px 0;display:flex;flex-wrap:wrap;gap:6px}
.progress li{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:#fff;font-size:.95rem;color:var(--muted)}
.progress li.done{color:#2f5a2b;background:#eef6ec;border-color:#b2d3ab}.progress li.now{color:#fff;background:var(--accent);border-color:var(--accent);font-weight:700}
.progress .pn{font-weight:700}
.chip.scheduled,.chip.sched{background:#e3f0f4;border-color:#a9cfdb;color:#1f5566}
.stamp{display:block;text-align:center;font:700 4rem/1 Inter,Arial,sans-serif;letter-spacing:.2em;color:#8f3427;border:6px solid #8f3427;border-radius:14px;padding:10px 0;margin:10px 0 14px;transform:rotate(-4deg);opacity:.85}
.undo-slot{position:fixed;left:0;right:0;bottom:0;z-index:20;padding:0 12px 12px}
.undo-slot .notice{max-width:760px;margin:0 auto;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;font-size:1.15rem;box-shadow:0 4px 18px rgba(0,0,0,.15)}
.undo-slot form{margin:0}
.gloss dl{margin:0}.gloss .g{padding:10px 0;border-bottom:1px solid var(--line);break-inside:avoid}.gloss dt{font-size:1.05rem}.gloss dd{margin:2px 0 0}
.gwarn{margin-top:4px;color:#8f3427;font-weight:600}
.legend{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.k{display:inline-block;padding:2px 8px;border-radius:8px;font-size:.85rem;font-weight:600;border-left:6px solid;background:#fff;line-height:1.3}
${kindCss()}
.calwrap{display:grid;gap:16px}@media(min-width:960px){.wrap.wide{max-width:1180px}.calwrap{grid-template-columns:1fr 300px}}
.monthbar{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:0 0 10px}
.month{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}
.month .dow{text-align:center;font-weight:600;color:var(--muted);font-size:.85rem;padding:4px 0}
.month .day{display:block;min-height:76px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:4px;text-decoration:none;color:var(--ink);overflow:hidden}
.month .day.out{opacity:.45}.month .day.today{border:2px solid var(--accent)}
.month .day .d{font-weight:700;font-size:1.05rem}
.month .day .k{display:block;margin-top:2px;font-size:.72rem;padding:1px 4px;overflow-wrap:anywhere}
.month .day.over{outline:3px dashed var(--accent);outline-offset:-3px}
@media(min-width:700px){.month .day{min-height:110px}.month .day .k{font-size:.8rem}}
.upcoming .item,.booking{display:block;padding:12px 0;border-bottom:1px solid var(--line)}
.unsched .u{background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px;margin:0 0 8px}
.unsched .u[draggable=true]{cursor:grab}
.bigcall{font-size:1.25rem}
@media print{header.top,.subnav,.noprint,.back,.topsteps{display:none!important}body{background:#fff}.card{border:0;padding:0;margin:0 0 10px}.gloss .g{padding:4px 0}}
`;

export function layout(title, body, { authed = true, screen = '', back = null, subnav = '', wide = false, panelWide = false, where = '' } = {}) {
  const nav = authed ? `<nav aria-label="Main">
    <a href="/admin/"${tip('nav.requests')}>Requests</a><a href="/admin/calendar"${tip('nav.calendar')}>Calendar &amp; Bookings</a><a href="/admin/money"${tip('nav.money')}>Money</a><a href="/admin/inventory"${tip('nav.inventory')}>Inventory</a><a href="/admin/settings"${tip('nav.settings')}>Settings</a><a href="/admin/help"${tip('nav.help')}>Help</a><a href="/admin/pricing"${tip('nav.pricing')}>Quick Pricing Summary</a>
    <form method="post" action="/admin/logout" style="display:inline"><button type="submit"${tip('nav.signout')}>Sign out</button></form></nav>` : '';
  // The same top bar on every screen (owner, 20 Oct 2026): "← Back" on the left (history.back()
  // when she came from another admin screen, else the screen's parent), where she is on the right.
  // A Home Screen icon has no browser Back button, so this is it.
  const parent = back && back.href ? back.href : '/admin/';
  const backLink = authed ? `<nav class="adminbar noprint" aria-label="Back" data-adminbar><a class="back" href="${esc(parent)}" data-back${tip('nav.back')}>&larr; Back</a><span class="where" data-where>${esc(where || title)}</span></nav>` : '';
  const viewer = authed && body.includes('data-id-open') ? ID_VIEWER : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<meta name="format-detection" content="telephone=no">
<title>${esc(title)} · Porch &amp; Party</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>${CSS}${EXTRA_CSS}</style></head><body>
<header class="top"><a class="brand" href="/admin/"${tip('nav.brand')}>Porch &amp; Party</a>${nav}</header>${subnav}
<main class="wrap${wide ? ' wide' : ''}${panelWide ? ' panelwide' : ''}">${backLink}${screen ? stepsBar(screen) : ''}${body}</main>${viewer}${authed ? `<script>${ADMIN_JS}</script>` : ''}</body></html>`;
}

const BACK_REQUESTS = { href: '/admin/', label: 'Back to requests' };

// A button/link with its helper line underneath.
function act(html, key) {
  return `<div class="act">${html}${hint(key)}</div>`;
}

export function loginPage({ error = '', disabled = false } = {}) {
  return layout('Sign in', `<div class="card" style="max-width:420px;margin:24px auto">
  <h1>Sign in</h1>
  ${error ? `<div class="notice err">${esc(error)}</div>` : ''}
  ${disabled ? '<div class="notice warn">Sign-in is not switched on for this copy of the site.</div>' : ''}
  <form method="post" action="/admin/login">
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
    <div style="margin-top:16px"><button class="btn primary" type="submit"${tip('login.submit')}>Sign in</button></div>
  </form></div>`, { authed: false, screen: 'signin' });
}

function chip(status) {
  return `<span class="chip ${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;
}

function link(url, label, key) {
  if (!url) return '';
  const safe = /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/+/, '')}`;
  return `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer"${tip(key)}>${esc(label || url)}</a>`;
}

function kv(items) {
  const rows = items.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!rows.length) return '';
  return `<dl class="kv">${rows.map(([k, v, raw]) => `<dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd>`).join('')}</dl>`;
}

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'the customer';
}

function friendlyWhen(r) {
  if (!r.sortTime) return r.timestamp || '';
  const d = new Date(r.sortTime);
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return `Asked ${date}, ${time}`;
}

function answerOf(r, re) {
  const all = [...r.rentals, ...r.decor, ...r.other];
  const hit = all.find((x) => re.test(x.label));
  return hit ? hit.value : '';
}

// One plain sentence per request: what they want and when.
// bookings: the request's bookings ([{kind, date}]); a rental with both its pickup and its
// return day says how long from those days (owner, 18 Oct 2026: Sun 18 -> Tue 20 read "for one
// day"): "pickup Sun 18 Oct, back Tue 20 Oct (2 days)".
export function wantSummary(r, bookings = []) {
  const parts = [];
  if (r.gamesAnswer) {
    const { pickup, ret } = rentalDates(r, bookings);
    const span = rentalSpanWords(pickup, ret);
    const how = /weekend/i.test(r.durationAnswer) ? 'for the weekend' : (r.durationAnswer ? 'for one day' : '');
    const when = answerOf(r, /pickup date|delivery date/i);
    parts.push(span ? `Games: ${r.gamesAnswer}, ${span}` : `Games: ${r.gamesAnswer}${how ? ` ${how}` : ''}${when ? `, ${when}` : ''}`);
  } else if (r.wantsRentals) parts.push('Game rentals');
  if (r.wantsDecor) {
    const when = answerOf(r, /event date/i);
    const take = /^\s*yes/i.test(r.takedownAnswer) ? ', with takedown' : '';
    // A site porch request reads as its package: "Porch: Fall · picturing a full porch (Classic, from $N)".
    if (r.porchLine) parts.push(`Porch: ${r.porchLine}${when ? `, ${when}` : ''}${take}${r.porchAddOns ? `. Add-ons: ${r.porchAddOns}` : ''}`);
    if (!r.porchLine || (r.services || []).some((k) => k === 'party' || k === 'grazing')) parts.push(`Decor: ${r.porchLine ? 'party or grazing setup' : (r.eventType || 'setup')}${when ? `, ${when}` : ''}${r.porchLine ? '' : take}`);
  }
  if (!parts.length && r.need) parts.push(r.need);
  return parts;
}

export function setupBanner(missing) {
  if (!missing.length) return '';
  return `<div class="notice warn"><strong>Finish setup: add your payment details.</strong><br>Customers need your ${esc(missing.join(', ').replace(/, ([^,]*)$/, ' and $1'))} to pay you.
    <div style="margin-top:10px"><a class="btn inline" href="/admin/settings"${tip('settings.open')}>Open Settings</a></div></div>`;
}

// ---- Payment box (request card and invoice page) ---------------------------------------
// Money actions live here, never under "More options". Each one asks first, in words.
const METHODS = [['zelle', 'Zelle'], ['cashapp', 'Cash App'], ['cash', 'Cash'], ['card', 'Card'], ['other', 'Other']];
function methodPicker() {
  return `<label>How did they pay?</label><select name="method">${METHODS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
}

// link: a small text link instead of a big button (calm cards: undo and Void); helper: false
// keeps the helper line as the tooltip only.
function confirmStep({ key, yesKey, label, question, action, hidden, danger = false, extra = '', cls = '', link = false, helper = true }) {
  const summary = link ? `linkbtn${danger ? ' danger' : ''}` : `btn ${danger ? 'danger' : (cls || 'ghost')}`;
  return `<div class="act${link ? ' small' : ''}"><details class="confirm"><summary class="${summary}"${tip(key)}>${esc(label)}</summary>
    <div class="confirmbox"><p><strong>${esc(question)}</strong></p><div class="actions">
      <form method="post" action="${esc(action)}">${hidden}${extra}<button class="btn${danger ? ' danger' : ''}" type="submit"${tip(yesKey)}>${esc(LABEL[yesKey])}</button></form>
      <button type="button" class="btn ghost" onclick="this.closest('details').open=false"${tip('pay.no')}>No, go back</button></div></div></details>${helper && !link ? hint(key) : ''}</div>`;
}
const LABEL = { 'dep.refundYes': 'Yes, record the refund', 'dep.keepYes': 'Yes, keep it for damage', 'exp.deleteYes': 'Yes, delete the expense', 'pay.depositYes': 'Yes, mark deposit received', 'pay.paidYes': 'Yes, mark paid in full', 'pay.unpaidYes': 'Yes, mark as not paid', 'pay.voidYes': 'Yes, void it',
  'day.deleteYes': 'Yes, delete it', 'card.idDeleteYes': 'Yes, delete the ID for good', 'hold.releaseYes': 'Yes, release the games', 'hold.depositYes': 'Yes, mark deposit received', 'set.newTokenYes': 'Yes, make a new link', 'td.jobDoneYes': 'Yes, mark job done', 'note.deleteYes': 'Yes, delete the note', 'ret.undoYes': 'Yes, undo returned',
  'edit.removeBookingYes': 'Yes, remove the booking', 'edit.removePaymentYes': 'Yes, remove this payment', 'tip.deleteYes': 'Yes, remove the tip' };

const hiddenInputs = (obj) => Object.entries(obj).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');

export function payWords(status, { rest = 0, hasInvoice = true } = {}) {
  return ({
    new: hasInvoice ? 'Invoice made, not sent yet. Nothing paid.' : 'No invoice yet. Nothing paid.',
    draft: 'Not sent yet. Nothing paid.',
    scheduled: 'On the calendar. Nothing paid yet.',
    invoiced: 'Invoice sent. Not paid yet.', sent: 'Invoice sent. Not paid yet.',
    deposit_paid: rest > 0 ? `Deposit received. ${money(rest)} is still owed.` : 'Deposit received. The rest is still owed.',
    paid: 'Paid in full.', done: 'Job finished.',
    void: 'Void. Nothing is owed. The customer was not told.',
  })[status] || STATUS_LABELS[status] || status;
}

// target: { action, field, extra } where field is 'action' (invoice) or 'status' (request).
export function paymentBox({ who, status, plan = 'half', rest = 0, hasInvoice = true, number = '', target, balanceLine = '', omit = '' }) {
  const send = (value) => hiddenInputs({ ...target.extra, [target.field]: value });
  const isInvoice = target.field === 'action';
  const v = (inv, req) => (isInvoice ? inv : req);
  const out = [];
  if (status === 'void') {
    out.push(act(`<form method="post" action="${esc(target.action)}">${send(v('unvoid', 'unvoid'))}<button class="btn ghost" type="submit"${tip('pay.unvoid')}>Bring back (undo Void)</button></form>`, 'pay.unvoid'));
  } else {
    const paid = status === 'paid' || status === 'done';
    if (!paid && status !== 'deposit_paid' && plan !== 'full' && omit !== 'pay.deposit') {
      out.push(confirmStep({ key: 'pay.deposit', yesKey: 'pay.depositYes', label: 'Mark deposit received', question: `Mark ${who}'s deposit as received? Only do this after the money is in your account.`, action: target.action, hidden: send('deposit_paid'), extra: isInvoice ? methodPicker() : '' }));
    }
    if (!paid && omit !== 'pay.paid') {
      out.push(confirmStep({ key: 'pay.paid', yesKey: 'pay.paidYes', label: 'Mark paid in full', question: `Mark ${who} as paid in full? Only do this after the money is in your account.`, action: target.action, hidden: send('paid'), extra: isInvoice ? methodPicker() : '' }));
    }
    if (status === 'deposit_paid' || status === 'paid') {
      out.push(confirmStep({ key: 'pay.unpaid', yesKey: 'pay.unpaidYes', label: 'That was a mistake: mark as not paid', question: `Mark ${who} as not paid? Only do this to fix a mistake.`, action: target.action, hidden: send(v('unpaid', 'unpaid')) }));
    }
    const voidQ = number ? `Void invoice ${number} for ${who}? The customer is not told. Use this when the job is cancelled or the invoice was a mistake.`
      : `Void the request from ${who}? The customer is not told. Use this when the job is cancelled or the request was a mistake.`;
    out.push(confirmStep({ key: 'pay.void', yesKey: 'pay.voidYes', label: 'Void', question: voidQ, action: target.action, hidden: send('void'), danger: true }));
  }
  return `<section class="paybox" data-payment><h3>Payment</h3><p class="words" data-pay-words>${esc(payWords(status, { rest, hasInvoice }))}</p>${balanceLine ? `<p data-balance>${balanceLine}</p>` : ''}<div class="actions">${out.join('')}</div></section>`;
}

// ---- Requests --------------------------------------------------------------------------
// The NEW badge and the phone-first order of Requests (owner, 19 Oct 2026).
const NEW_CSS = `
.newb{display:inline-flex;align-items:center;padding:2px 10px;border-radius:999px;background:#c2410c;color:#fff;font:800 .85rem Inter,Arial,sans-serif;letter-spacing:.06em;border:0;white-space:nowrap;vertical-align:middle}
button.newb.big{min-height:44px;padding:0 16px;font-size:1rem;cursor:pointer}
article[data-new]{box-shadow:0 0 0 3px #f3b493}
.rqflow{display:flex;flex-direction:column}.rqmain{order:1}.rqpanel{order:2;margin-top:18px}
@media(min-width:900px){.rqpanel{order:0;margin-top:0}}
.weekcard{padding-top:12px;padding-bottom:12px}.weekcard .weekline{margin:0}.weekcard details{margin-top:6px}
.weekcard .wkn{display:none}@media(min-width:600px){.weekcard .wkn{display:inline}}
.weekcard summary{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}.weekcard li a{color:inherit}
.remline{padding:0}.remline>summary{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;min-height:56px;padding:12px 16px;cursor:pointer;list-style:none;font-size:1.1rem}
.remline>summary::-webkit-details-marker{display:none}.remline .remcount{font-weight:700}.remline .remchev{margin-left:auto;font-size:1.2rem;color:var(--accent);transition:transform .15s}
.remline[open] .remchev{transform:rotate(90deg)}.remline .remin{padding:0 16px 14px;border-top:1px solid var(--line)}.remline .remin h2{margin-top:12px}
`;
// Opening a card clears its NEW: the badge itself, Show details, Edit, any button or link on it,
// or arriving at #c-<card> from the New-request email.
const NEW_JS = `(function(){
  function seen(card,how){if(!card||!card.hasAttribute('data-new'))return;card.removeAttribute('data-new');var b=card.querySelector('[data-new-badge]');if(b)b.remove();
    var f=new FormData();f.append('r',card.getAttribute('data-card'));f.append('how',how);try{fetch('/admin/requests/opened',{method:'POST',body:f,headers:{'X-Pnp-Fetch':'1'},credentials:'same-origin',keepalive:true});}catch(e){}}
  document.addEventListener('click',function(e){var c=e.target.closest('article[data-new]');if(!c)return;var t=e.target.closest('[data-new-badge],summary,a,button');if(t)seen(c,t.matches('[data-new-badge]')?'badge':'card');});
  if(/^#c-/.test(location.hash)){var c=document.getElementById(location.hash.slice(1));if(c){seen(c,'link');c.scrollIntoView();}}
})();`;

const DASH_JS = `
(function(){
  var tpl=document.getElementById('undo-tpl'),slot=document.getElementById('undo-slot');if(!slot)return;
  function post(f){return fetch(f.action,{method:'POST',body:new FormData(f),headers:{'X-Pnp-Fetch':'1'},credentials:'same-origin'});}
  function wire(banner){var f=banner.querySelector('form'),t=setTimeout(function(){banner.remove();},6000);
    f.addEventListener('submit',function(e){e.preventDefault();clearTimeout(t);post(f).then(function(){location.href='/admin/';}).catch(function(){f.submit();});});}
  document.addEventListener('submit',function(e){var f=e.target;if(!f.matches('[data-archive]'))return;e.preventDefault();var b=f.querySelector('button');b.disabled=true;
    post(f).then(function(r){if(!r.ok)throw new Error(String(r.status));var card=f.closest('[data-card]');if(card)card.remove();
      slot.innerHTML=tpl.innerHTML;var banner=slot.firstElementChild;banner.querySelector('[name=r]').value=f.querySelector('[name=r]').value;wire(banner);})
    .catch(function(){f.submit();});});
  var pre=slot.querySelector('[data-autohide]');if(pre)wire(pre);
})();`;

function undoBanner(rk) {
  return `<div class="notice ok" data-autohide><strong>Put away.</strong><form method="post" action="/admin/requests/unarchive">${hiddenInputs({ r: rk })}<button class="btn inline" type="submit"${tip('req.undo')}>Undo</button></form></div>`;
}

// The Porch packages reference (owner, 18 Oct 2026): the SAME grid the website shows
// (scripts/lib/porch_packages.js gridHtml, from data/offers/porch_packages.json), without the
// customer "Request this package" links.
export function porchPackagesPage(pk) {
  return layout('Porch packages', `<h1>Porch packages</h1>
    <p class="hint">Starting prices per season. A porch invoice starts at the package the customer picked; change it after the walk-through.</p>
    <div class="card"><style>${PP.GRID_CSS}</style>${PP.gridHtml(pk)}</div>`, { screen: 'packages', back: BACK_REQUESTS });
}

// "Sun 26 Oct, 3:00 PM" (Memphis) for a D1 UTC datetime.
function memphisWhen(utc) {
  const d = new Date(`${String(utc || '').replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(utc || '');
  const day = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Chicago' });
  return `${day}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })}`;
}

// A phone request has no ID on file at first (ID-for-everyone still stands): it says so, and
// Valerie can add one later with the optional upload (admin.mjs addId).
export function idUploadForm(rk) {
  return `<form class="idup" method="post" action="/admin/requests/id/upload" enctype="multipart/form-data" data-id-upload>${hiddenInputs({ r: rk })}
      <label for="idp-${esc(rk)}">Add their ID photo (optional)</label><input id="idp-${esc(rk)}" type="file" name="id_photo" accept="image/jpeg,image/png" required${tip('card.idUpload')}>
      ${act(`<button class="btn ghost" type="submit"${tip('card.idUpload')}>Add ID photo</button>`, 'card.idUpload')}</form>`;
}
function idCell(r, rk) {
  if (r.idDeletedAt) return esc(`Deleted ${memphisWhen(r.idDeletedAt)}`);
  if (isPhone(r) && !r.idObject) return `<span data-id-phone>Not collected (phone booking)</span>${idUploadForm(rk)}`;
  if (r.idObject) return idOpenLink(r, rk);
  return r.idFile ? r.idFile.split(/,\s*/).map((u, i) => link(u, i ? `Open ID photo ${i + 1}` : 'Open ID photo', 'card.idPhoto')).join('<br>') : '';
}

// "Open ID photo" (owner, 20 Oct 2026): opens over the card (ID_VIEWER), never a new tab that
// strands her. Without JS it is a normal same-tab page with the top bar and a Back to the card.
// The image itself still comes from the private, no-store route /admin/requests/id.
export function idOpenLink(r, rk) {
  return `<a href="/admin/requests/id/view?r=${esc(rk)}" data-id-open data-src="/admin/requests/id?r=${esc(rk)}" data-who="${esc(`${r.name || 'Customer'} · photo ID`)}"${tip('card.idPhoto')}>Open ID photo</a>`;
}

// The no-JS page for the photo: the admin bar, the photo, Back to the card.
export function idPhotoPage(r, rk) {
  const card = `/admin/#c-${rk}`;
  return layout('Photo ID', `<section class="card idpage" data-id-page><h1>${esc(r.name || 'Customer')}: photo ID</h1>
    <img src="/admin/requests/id?r=${esc(rk)}" alt="${esc(`${r.name || 'Customer'}'s photo ID`)}">
    ${act(`<a class="btn ghost" href="${esc(card)}" data-id-back${tip('card.idBack')}>&larr; Back to the card</a>`, 'card.idBack')}</section>`, { screen: 'idPhoto', back: { href: card }, where: `Photo ID · ${r.name || 'Customer'}` });
}

const ID_VIEWER = `<div class="idview" data-id-viewer hidden role="dialog" aria-modal="true" aria-label="Photo ID"><div class="idtop"><span data-id-who>Photo ID</span><button type="button" class="idx" data-id-close${tip('card.idClose')}>&#10005; Close</button></div><div class="idstage" data-id-stage><img alt="Customer photo ID" data-id-img></div><p class="idfoot">Tap &#10005; Close or swipe down to go back to the card</p></div>`;

// Every admin screen: Back (history when it came from an admin screen) and the ID viewer.
const ADMIN_JS = `(function(){var b=document.querySelector('[data-back]');if(b)b.addEventListener('click',function(e){try{var r=document.referrer?new URL(document.referrer):null;
if(r&&r.origin===location.origin&&r.pathname.indexOf('/admin')===0&&history.length>1){e.preventDefault();history.back();}}catch(x){}});
var v=document.querySelector('[data-id-viewer]');if(!v)return;var img=v.querySelector('[data-id-img]'),who=v.querySelector('[data-id-who]'),x=v.querySelector('[data-id-close]'),opener=null,y0=null;
function shut(){if(v.hidden)return;v.hidden=true;img.removeAttribute('src');document.documentElement.style.overflow='';if(opener){opener.focus();opener=null;}}
document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('[data-id-open]'):null;if(!a)return;e.preventDefault();opener=a;img.src=a.getAttribute('data-src');
who.textContent=a.getAttribute('data-who')||'Photo ID';v.hidden=false;document.documentElement.style.overflow='hidden';x.focus();});
x.addEventListener('click',shut);v.addEventListener('click',function(e){if(e.target===v||e.target.hasAttribute('data-id-stage'))shut();});
document.addEventListener('keydown',function(e){if(e.key==='Escape')shut();if(e.key==='Tab'&&!v.hidden){e.preventDefault();x.focus();}});
v.addEventListener('touchstart',function(e){y0=e.touches.length===1?e.touches[0].clientY:null;},{passive:true});
v.addEventListener('touchend',function(e){if(y0!=null&&e.changedTouches[0].clientY-y0>80)shut();y0=null;});})();`;

function deleteIdStep(r, rk) {
  if (r.idDeletedAt || !(r.idObject || r.idFile)) return '';
  return confirmStep({ key: 'card.idDelete', yesKey: 'card.idDeleteYes', label: 'Delete this ID', question: `Delete ${r.name || 'this customer'}'s ID photo for good? It cannot be brought back.`, action: '/admin/requests/id/delete', hidden: hiddenInputs({ r: rk }), danger: true });
}

// ---- "More about <first name>" (owner-approved mock-up, 20 Oct 2026, panel 6) -----------------
// Raw ISO dates in answers read as words ("2026-10-30" -> "Fri 30 Oct"); a date of birth keeps its
// year. Display only: the stored answers are never rewritten.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export function answerWords(v) {
  const t = String(v == null ? '' : v).trim();
  return ISO_DAY.test(t) ? shortDate(t) : t;
}
export function dobWords(v) {
  const t = String(v || '').trim();
  if (!ISO_DAY.test(t)) return t;
  const d = new Date(`${t}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? t : `${d.getUTCDate()} ${d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}
// History lines that carry a raw UTC timestamp ("held until 2026-10-21 02:37:53 UTC") read in
// plain Memphis words ("held until Tue 20 Oct, 9:37 PM"). Display only: request_events rows are
// never rewritten.
const UTC_STAMP = /(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?(?:\.\d+)?\s*(?:UTC|Z)\b/g;
export function plainHistory(what) {
  return String(what || '').replace(UTC_STAMP, (all, day, hm) => {
    const d = new Date(`${day}T${hm}:00Z`);
    if (Number.isNaN(d.getTime())) return all;
    const dd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return `${shortDate(dd)}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })}`;
  });
}
// "Tue 20 Oct" (Memphis) for a D1 UTC datetime.
function memphisDay(utc) {
  const d = new Date(`${String(utc || '').replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return shortDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d));
}

// The answers a group already shows (never repeated under "Other answers").
const SHOWN_ELSEWHERE = /^(business delivery|business name|delivery address)$/i;

// Group 3: their details and ID. used: the answer labels the other groups already show.
function detailsGroupBody(r, rk, { referrers = {}, used = new Set(), archived = false, st = {} } = {}) {
  const other = [...r.rentals, ...r.decor, ...r.other].filter((x) => !used.has(x.label) && !SHOWN_ELSEWHERE.test(String(x.label || '')));
  const rules = r.agreedAt ? `<p class="gl ok" data-rules>✓ Agreed to the rules, ${esc(memphisDay(r.agreedAt) || memphisWhen(r.agreedAt))}${r.rulesVersion ? ` (version ${esc(r.rulesVersion)})` : ''}</p>`
    : (isPhone(r) ? '<p class="gl muted" data-rules>Rules: not asked (phone booking)</p>' : '');
  const robot = r.robotCheck === 'no-js' ? '<p class="gl warnline" data-robot-check>⚠ Sent without the robot check (their phone had JavaScript off). Check it looks real.</p>' : '';
  const asked = `<p class="gl muted" data-asked>${esc(friendlyWhen(r))}${archived && st.archived_at ? ` · put away ${esc(prettyDate(String(st.archived_at).slice(0, 10)))}` : ''}</p>`;
  return `<div data-details-body>${kv([
      ['Phone', r.phone ? `<a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}" data-detail-phone${tip('card.phone')}>${esc(r.phone)}</a>` : '', true],
      ['Email', r.email ? `<a href="mailto:${esc(r.email)}" data-detail-email${tip('card.email')}>${esc(r.email)}</a>` : '', true],
      ['Date of birth', dobWords(r.dob)],
      ['Social media', [r.social1, r.social2].filter(Boolean).map((u) => link(u, '', 'card.social')).join('<br>'), true],
      ['Found us through', r.heard],
      ['Referred by', r.referredBy ? (referrers[r.referredBy] || 'a past customer') : ''],
    ])}${asked}${rules}${robot}
    ${(() => { const id = idCell(r, rk); return id ? `<div class="gl" data-id-cell><b>Photo ID:</b> ${id}</div>` : ''; })()}
    ${deleteIdStep(r, rk)}
    ${other.length ? `<div data-other-answers><h4>Other answers</h4>${kv(other.map((x) => [x.label, answerWords(x.value)]))}</div>` : ''}</div>`;
}

// Top of Requests: this week (Mon–Sun, Memphis) by service, and last week.
export function weekBox(w, newKeys = new Set()) {
  const n = w.thisWeek.length;
  const parts = [['porch', 'porch'], ['party', 'party & decor'], ['grazing', 'grazing'], ['rentals', 'rentals']].filter(([k]) => w.byService[k]).map(([k, word]) => `${w.byService[k]} ${word}`);
  const fresh = w.thisWeek.filter((r) => newKeys.has(r.key));
  const badge = (txt) => `<span class="newb" data-new-count>${esc(txt)}</span>`;
  const list = w.thisWeek.map((r) => `<li>${newKeys.has(r.key) ? `${badge('NEW')} ` : ''}<a href="#c-${esc(b64urlText(r.key))}"${tip('req.weekJump')}>${esc(r.name || 'No name given')}</a> <span class="muted">${esc(shortDate(new Date(r.sortTime).toISOString().slice(0, 10)))}</span></li>`).join('');
  // The collapsed line names the newest request and says how many are NEW (owner, 19 Oct 2026).
  const newest = w.thisWeek.slice().sort((a, b) => (b.sortTime || 0) - (a.sortTime || 0))[0];
  const sum = n ? `<span class="wkl">Latest: ${esc(newest.name || 'No name given')}</span>${fresh.length ? ` ${badge(fresh.length === 1 ? 'NEW' : `${fresh.length} NEW`)}` : ''}${n > 1 ? ` <span class="muted wkn">· see all ${n}</span>` : ''}` : '';
  return `<section class="card weekcard" data-week-counts><p class="weekline"><strong>This week: ${n} new request${n === 1 ? '' : 's'}</strong>${parts.length ? ` (${esc(parts.join(', '))})` : ''} <span class="muted">· Last week: ${w.lastWeek.length}</span></p>
    ${n ? `<details class="disclose" data-week-list><summary${tip('req.weekList')}>${sum}</summary><ul>${list}</ul></details>` : ''}</section>`;
}

// A gentle list: requests paid in full (and for rentals, returned) that still hold an ID photo.
export function idsReadyBox(rows) {
  if (!rows.length) return '';
  return `<section class="card" data-ids-ready><h2>IDs ready to delete <small class="muted">${rows.length}</small></h2>
    <p class="muted" style="margin:0 0 8px">These are paid in full${rows.some((r) => r.wantsRentals) ? ' (rentals: returned)' : ''}. Nothing is ever deleted by itself: tap Delete this ID when you are ready.</p>
    ${rows.map((r) => `<div class="booking" data-id-ready><strong>${esc(r.name || 'No name given')}</strong>${deleteIdStep(r, b64urlText(r.key))}</div>`).join('')}</section>`;
}

// The Payment box on a request card: stage-aware, from the rules table (cards.mjs cardPayment).
// One line of words, at most ONE money button, a small undo link; Void lives under Show details.
function cardPaymentBox(r, st, inv, primary, ctx) {
  const who = ctx.who;
  const t = ctx.payTarget;
  const p = cardPayment({ inv, status: st.status, plan: inv ? payPlanOf(inv, inv.total_cents || 0) : 'half', primary });
  const bal = inv && inv.balance;
  // The one way to say what is due (ledger.mjs dueWords): "$180 due ($130 + $50 refundable deposit)".
  const due = dueWords(bal || { owed: inv ? Math.max(0, inv.total_cents || 0) : 0, refundable: 0 });
  const dmg = bal && bal.refundable && !(bal.depositOwed > 0) ? ` · damage deposit ${money(bal.refundable)}, refundable (collected)` : '';
  const words = {
    none: 'No invoice yet.', draft: 'Invoice made, not sent yet.',
    sent: `Invoice sent · ${due || 'nothing due'}`,
    deposit: inv ? `Deposit in · ${due || 'nothing more due'}` : 'Deposit in.',
    paid: 'Paid in full ✓',
  }[p.state] || '';
  // Paid in full: no box at all (owner, 18 Oct 2026: the progress line already says it; the undo
  // is the small link on the progress line and on the Edit page).
  if (p.state === 'paid') return '';
  if (p.state === 'none' || p.state === 'draft') return `<p class="payline muted" data-payment data-pay-state="${p.state}" data-pay-words>${esc(words)}</p>`;
  const out = [];
  if (p.button) out.push(cardButton(p.button, ctx, false, { helper: false }));
  if (p.undo) out.push(confirmStep({ key: 'pay.unpaid', yesKey: 'pay.unpaidYes', label: 'That was a mistake: mark as not paid', question: `Mark ${who} as not paid? Only do this to fix a mistake.`, action: t.action, hidden: hiddenInputs({ ...t.extra, [t.field]: 'unpaid' }), link: true }));
  return `<section class="paybox calm" data-payment data-pay-state="${p.state}"><p class="words" data-pay-words>${esc(words + dmg)}</p>${out.length ? `<div class="payacts">${out.join('')}</div>` : ''}</section>`;
}

// "Cancel this job…" (was "Void this request…", owner, 20 Oct 2026): the same Void action with
// its confirm step, as a small danger link in the quiet bottom row of More (never a big button).
function voidLink(r, inv, ctx) {
  const t = ctx.payTarget;
  const q = inv && inv.number ? `Cancel this job for ${ctx.who}? Invoice ${inv.number} is voided. The customer is not told. Use this when the job is cancelled or the invoice was a mistake.`
    : `Cancel this job for ${ctx.who}? The request is voided. The customer is not told. Use this when the job is cancelled or the request was a mistake.`;
  return `<div class="voidlink" data-void-link>${confirmStep({ key: 'card.cancelJob', yesKey: 'pay.voidYes', label: 'Cancel this job…', question: q, action: t.action, hidden: hiddenInputs({ ...t.extra, [t.field]: 'void' }), danger: true, link: true })}</div>`;
}

// ---- Request cards (JOB B, owner-approved 18 Oct 2026) -----------------------------------
// One rules table (cards.mjs) decides the buttons; this only draws them. Service badge(s) with
// words and a coloured left border, name large, ONE key-facts line, a compact 1-6 line, ONE big
// primary button, a tidy secondary row, the Payment box, and everything else to read behind
// "Show details".
export const CARD_CSS = `
.svcs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 6px}
.svc{display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;font:700 1rem Inter,Arial,sans-serif;border:2px solid;color:#2b2420}
article[data-reqcard]{border-left-width:8px}
article[data-reqcard] h3.who{font-size:1.75rem;margin:0}
.editlink{display:inline-flex;align-items:center;min-height:48px;padding:0 18px;border:2px solid var(--accent);border-radius:999px;background:#fff;color:var(--accent);font:700 1.05rem Inter,Arial,sans-serif;text-decoration:none}
.facts{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;margin:6px 0 2px;font-size:1.05rem}
.facts .call{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:999px;background:var(--ok);color:#fff;font-weight:700;text-decoration:none}
.progress.mini{gap:4px;margin:8px 0}.progress.mini li{padding:1px 8px;font-size:.82rem}
.secrow{display:flex;flex-wrap:wrap;gap:6px 8px;margin-top:10px}.secrow>*{min-width:0;margin:0}
.secrow .act{margin:0}.secrow .btn{width:auto;min-height:44px;font-size:.95rem;padding:6px 14px;border-width:1px;border-radius:999px}
.filters{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
.filters a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:999px;border:2px solid var(--line);background:#fff;color:var(--ink);font-weight:600;text-decoration:none}
.filters a[aria-current=true]{background:var(--ink);border-color:var(--ink);color:#fff}
.stepspanel{gap:12px}
.stepspanel li{align-items:flex-start}.stepspanel .sp{min-width:0;flex:1}
.stepspanel .spt{display:block;font-size:1.15rem}.stepspanel .spl{margin:2px 0 8px;color:var(--muted)}
.stepspanel .spb{display:grid;gap:8px}.stepspanel .spb .btn{min-height:48px}
.stepspanel .sps{margin:8px 0 0;font-size:.95rem}.stepspanel .sps a{display:inline-flex;min-height:32px;align-items:center;margin-right:12px}
@media(min-width:900px){.wrap.panelwide{max-width:1080px}.stepspanel{grid-template-columns:repeat(3,1fr)}}
.putaway{margin-top:24px}
.payline{margin:12px 2px 0;font-size:1rem}
.paybox.calm{padding:10px 14px}.paybox.calm .words{margin:0 0 6px}
.payacts{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center}.payacts .act{margin:0}
.act.small{margin:0}.linkbtn.danger{color:#8f3427}
.voidlink{margin-top:12px;border-top:1px solid var(--line);padding-top:4px}
.msgline{display:flex;flex-wrap:wrap;align-items:center;gap:0 14px;margin:10px 0 0;padding:4px 0;border-top:1px solid var(--line)}
.msgline .msgsep{color:var(--line)}.msgline .mlabel{font-weight:700;color:var(--muted);margin-right:2px}
.msgpair{display:inline-flex;flex-wrap:wrap;align-items:center;gap:0 6px}.msgpair form{display:inline;margin:0}
.msglink{display:inline-flex;align-items:center;min-height:44px;color:var(--accent);font:600 1rem Inter,Arial,sans-serif;text-decoration:underline}
.nextline{margin:12px 2px 0;font-size:1rem}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tdrow{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;margin:12px 0 4px;padding:10px 12px;border:2px solid var(--line);border-radius:12px;background:#fff}
.tdrow.amber{border-color:#ebcf96;background:#fffaf0}.tdrow.okrow{border-color:#b2d3ab;background:#f3faf1}
.tdrow .tdl{font-weight:700;font-size:1.1rem}
.tdrow input[type=date],.tdrow input[type=time]{width:auto;min-height:48px;font-size:1.05rem;margin:0}
.tdrow .btn{width:auto;min-height:48px;padding:8px 18px}
.tdrow .hint{flex-basis:100%;margin:0}
.tdrow .tdsaved{flex-basis:100%;font-weight:700;color:#2f5a2b}
.tdrow details{display:inline}.tdrow details[open]{flex-basis:100%}.tdrow summary{display:inline-flex;align-items:center;min-height:44px;color:var(--accent);font-weight:600;text-decoration:underline;cursor:pointer;list-style:none}
.tdrow .tdmore{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:6px}
.tdrow form{margin:0;display:inline-flex;flex-wrap:wrap;align-items:center;gap:8px}
.tdchoices{display:inline-flex;flex-wrap:wrap;align-items:center;gap:0 8px}
.tdpill{display:inline-block;padding:2px 10px;border-radius:999px;background:#fff3dc;color:#7a4a0c;font-weight:700;font-size:.9rem}
.nextslot{display:flex;align-items:center;min-height:52px;padding:8px 16px;border:2px dashed var(--line);border-radius:12px;color:var(--muted);font-weight:600;margin:12px 0 0}
.tyline{margin:10px 2px 0;font-size:.92rem;color:var(--muted);line-height:2.6}
.tyline>span[aria-hidden]{margin:0 6px}
.tyline form,.tyline .msgpair,.tyline .msgpair form{display:inline;margin:0}.tyline .msgpair .muted{margin:0 6px}
.tyline .linkbtn,.tyline .msglink{display:inline;font-size:.92rem;min-height:0;padding:6px 0}
.paidundo{display:inline-block;margin-left:4px;font-size:.85rem}.paidundo .linkbtn{font-size:.85rem;min-height:32px}
.tdsub{font-weight:600;color:#92400e}.tdsub.done{color:inherit;font-weight:400}.tdbox{margin:10px 0}.tdbox .secrow{margin-top:8px}.linkbtn{background:none;border:0;color:var(--accent);font:600 1rem Inter,Arial,sans-serif;text-decoration:underline;cursor:pointer;min-height:44px}
`;

// 📞 Call and 💬 Text in the top right of every request card, at every step (owner, 20 Oct 2026),
// only when a phone number exists. Text is a free sms: link with a blank body (no paid SMS).
export function quickContact(r) {
  const n = String((r && r.phone) || '').replace(/[^\d+]/g, '');
  if (n.replace(/\D/g, '').length < 7) return '';
  return `<div class="qa" data-quick-contact><a href="tel:${esc(n)}" data-card-call${tip('card.quickCall')}>&#128222; Call</a><a href="sms:${esc(n)}" data-card-text${tip('card.quickText')}>&#128172; Text</a></div>`;
}

const CARD_LABEL = {
  'card.createInvoice': 'Create invoice', 'card.openInvoice': 'Open invoice', 'card.seeCal': 'See it on the calendar',
  'card.checklist': 'Walk-through checklist', 'card.printChecklist': 'Print checklist', 'ret.mark': 'Mark returned', 'ret.see': 'See the check-in',
  'card.schedInstall': 'Schedule install', 'card.schedSetup': 'Schedule setup', 'card.schedPickup': 'Schedule pickup + return',
  'td.markDone': 'Mark takedown done',
};

// One button from the rules table. ctx: { rk, inv, st, sched, payTarget, who, plan }.
function cardButton(keyKind, ctx, primary, { helper = true } = {}) {
  const [key, kind] = keyKind.split('|');
  const cls = primary ? 'btn primary' : 'btn ghost';
  const wrap = (html) => (primary ? act(html, key) : `<div class="act">${html}</div>`);
  const a = (href, label, extra = '') => wrap(`<a class="${cls}" href="${esc(href)}"${extra}${tip(key)}>${esc(label)}</a>`);
  const { rk, inv, sched } = ctx;
  switch (key) {
    case 'card.createInvoice': return a(`/admin/invoices/new?r=${rk}`, CARD_LABEL[key]);
    case 'card.openInvoice': return a(`/admin/invoices/${inv.id}`, primary && inv.status === 'draft' ? 'Open and send the invoice' : CARD_LABEL[key]);
    case 'card.seeCal': return a(`/admin/day/${sched.date}`, `${CARD_LABEL[key]} (${shortDate(sched.date)})`);
    case 'card.checklist': return a(`/admin/checklist/online?r=${rk}`, CARD_LABEL[key]);
    case 'card.printChecklist': return a(`/admin/checklist?r=${rk}`, CARD_LABEL[key], ' target="_blank" rel="noopener"');
    case 'ret.mark': case 'ret.see': return a(`/admin/returns?k=${rk}`, CARD_LABEL[key]);
    case 'msg.pickupText': { const m = ctx.msgs && ctx.msgs.pickup; return m && m.sms ? a(m.sms.href, 'Text about pickup time', ` data-msg-tap="pickupTime" data-rk="${esc(rk)}"`) : ''; }
    case 'card.schedInstall': case 'card.schedSetup': case 'card.schedPickup':
      return a(`/admin/calendar/new?r=${rk}&kind=${kind}`, CARD_LABEL[key]);
    case 'td.markDone': return ctx.td && ctx.td.booking ? `<form method="post" action="/admin/calendar/bookings/${ctx.td.booking.id}/takedown-done">${wrap(`<button class="${cls}" type="submit"${tip(key)}>Mark takedown done</button>`)}</form>` : '';
    case 'card.jobDone':
      // Takedown not decided yet: ask once, at the moment of Job done; never blocks it.
      // On a step card the words name the step: "Mark setup done" / "Mark install done".
      if (ctx.tdNotSure) return confirmStep({ key, yesKey: 'td.jobDoneYes', label: ctx.jobWord || 'Mark job done', cls: primary ? 'primary' : 'ghost', question: `The takedown is not decided yet for ${ctx.who}. Mark the job done anyway? You can still schedule the takedown later.`, action: '/admin/requests/jobdone', hidden: hiddenInputs({ r: rk }), helper: primary });
      return `<form method="post" action="/admin/requests/jobdone">${hiddenInputs({ r: rk })}${wrap(`<button class="${cls}" type="submit"${tip(key)}>${esc(ctx.jobWord || 'Mark job done')}</button>`)}</form>`;
    case 'card.undoJobDone': return `<form method="post" action="/admin/requests/jobdone">${hiddenInputs({ r: rk, undo: '1' })}${wrap(`<button class="${cls}" type="submit"${tip(key)}>Undo job done</button>`)}</form>`;
    case 'card.archive': return `<form method="post" action="/admin/requests/archive" data-archive>${hiddenInputs({ r: rk })}${wrap(`<button class="${primary ? 'btn primary' : 'btn ghost'}" type="submit"${tip(key)}>Done — put away</button>`)}</form>`;
    case 'pa.bringBack': return `<form method="post" action="/admin/requests/unarchive">${hiddenInputs({ r: rk })}${wrap(`<button class="${cls}" type="submit"${tip(key)}>Bring back</button>`)}</form>`;
    case 'pay.unvoid': { const t = ctx.payTarget; return `<form method="post" action="${esc(t.action)}">${hiddenInputs({ ...t.extra, [t.field]: 'unvoid' })}${wrap(`<button class="${cls}" type="submit"${tip(key)}>Bring back (undo Void)</button>`)}</form>`; }
    case 'pay.deposit': case 'pay.paid': {
      const t = ctx.payTarget;
      const isInvoice = t.field === 'action';
      const dep = key === 'pay.deposit';
      return confirmStep({ key, yesKey: dep ? 'pay.depositYes' : 'pay.paidYes', label: dep ? 'Mark deposit received' : 'Mark paid in full', cls: primary ? 'primary' : 'ghost', helper: primary && helper,
        question: dep ? `Mark ${ctx.who}'s deposit as received? Only do this after the money is in your account.` : `Mark ${ctx.who} as paid in full? Only do this after the money is in your account.`,
        action: t.action, hidden: hiddenInputs({ ...t.extra, [t.field]: dep ? 'deposit_paid' : 'paid' }), extra: isInvoice ? methodPicker() : '' });
    }
    default: return '';
  }
}

// The inline takedown row (owner, 18 Oct 2026: "too many steps"). ONE line on every porch and
// party & decor card: "Takedown:" + date box (the booked day, else the form's / owner's date,
// else the day after the install / setup) + optional time + Save · Not sure yet · Customer will
// handle it. Save books it right here (POST /admin/requests/takedown-inline) and comes back to
// this card. Booked: "Booked for Tue 20 Oct" + one-tap Mark takedown done (any day) + Change /
// Remove. Grazing gets the same line for its optional pickup (Save / Change / Remove only).
// Rentals never have it (cards.mjs inlineRowKind).
function takedownRow({ kind, tdS, r, rk, bookings, eventDate, primaryDone, saved, savedWords }) {
  const grazing = kind === 'grazing_pickup';
  const label = grazing ? 'Pickup (optional):' : 'Takedown:';
  const booking = (bookings || []).find((b) => b.kind === kind) || null;
  const dateIn = (id, value) => `<label class="sr" for="${id}">${grazing ? 'Pickup day' : 'Takedown day'}</label><input type="date" id="${id}" name="date" value="${esc(value)}" required${tip('td.date')}>`;
  const timeIn = (id, value) => `<label class="sr" for="${id}">Time (optional)</label><input type="time" id="${id}" name="time" value="${esc(value || '')}"${tip('td.time')}>`;
  const ok = saved ? `<p class="tdsaved" data-takedown-saved role="status">${esc(savedWords || '')}</p>` : '';
  const id = `td-${esc(rk)}`;
  const hid = hiddenInputs({ r: rk, kind });
  if (!grazing && tdS.status === 'done') {
    return `<div class="tdrow okrow" data-takedown-row="done"><span class="tdl">${label}</span> <strong>Done ✓</strong>${booking ? ` <span class="muted">(${esc(shortDate(booking.date))})</span>
      <form method="post" action="/admin/calendar/bookings/${booking.id}/takedown-done">${hiddenInputs({ undo: '1' })}<button class="linkbtn" type="submit"${tip('td.undoDone')}>Undo</button></form>` : ''}${ok}</div>`;
  }
  if (!grazing && tdS.status === 'customer_handles') {
    return `<div class="tdrow" data-takedown-row="customer_handles"><span class="tdl">${label}</span> <span>The customer will handle it${r.takedownNote ? ` (${esc(r.takedownNote)})` : ''}.</span>
      <form method="post" action="/admin/requests/takedown">${hiddenInputs({ r: rk, plan: '' })}<button class="linkbtn" type="submit"${tip('td.change')}>Change</button></form>${ok}</div>`;
  }
  if (booking) {
    const when = `Booked for ${shortDate(booking.date)}${booking.time ? `, ${prettyTimeOf(booking.time)}` : ''}`;
    const done = grazing ? '' : `<form method="post" action="/admin/calendar/bookings/${booking.id}/takedown-done"><button class="btn ${primaryDone ? 'primary' : 'ghost'}" type="submit" data-takedown-done-tap${tip('td.markDone')}>Mark takedown done</button></form>${primaryDone ? hint('td.markDone') : ''}`;
    return `<div class="tdrow okrow" data-takedown-row="booked"><span class="tdl">${label}</span> <strong data-takedown-booked="${esc(booking.date)}">${esc(when)}</strong> ${done}
      <details><summary${tip('td.changeDate')}>Change</summary><form method="post" action="/admin/requests/takedown-inline" class="tdmore">${hid}${dateIn(`${id}-c`, booking.date)}${timeIn(`${id}-ct`, booking.time)}<button class="btn ghost" type="submit" name="go" value="save"${tip('td.save')}>Save</button></form></details>
      <form method="post" action="/admin/requests/takedown-inline">${hid}<button class="linkbtn" type="submit" name="go" value="remove"${tip('td.remove')}>Remove</button></form>${ok}</div>`;
  }
  const value = inlineDefaultDate({ kind, bookings, takedownDate: r.takedownDate, eventDate });
  const notSure = !grazing && tdS.status === 'not_sure';
  const choices = grazing ? '' : `<span class="tdchoices"><button class="linkbtn" type="submit" formaction="/admin/requests/takedown" name="plan" value="not_sure"${tip('td.notSure')}>Not sure yet</button><span class="muted">·</span><button class="linkbtn" type="submit" formaction="/admin/requests/takedown" name="plan" value="customer_handles"${tip('td.customer')}>Customer will handle it</button></span>`;
  const asked = !grazing && tdS.status === 'to_schedule';
  return `<div class="tdrow${notSure || asked ? ' amber' : ''}" data-takedown-row="${notSure ? 'not_sure' : 'open'}"><form method="post" action="/admin/requests/takedown-inline">${hid}<span class="tdl">${label}</span>${notSure ? ` <span class="tdpill">Not decided yet</span>${r.takedownNote ? ` <em data-takedown-note>${esc(r.takedownNote)}</em>` : ''}` : ''}${asked ? ' <span class="tdpill">Asked for, not booked yet</span>' : ''}
    ${dateIn(id, value)}${timeIn(`${id}-t`, '')}<button class="btn ${primaryDone ? 'primary' : 'ghost'}" type="submit" name="go" value="save"${tip('td.save')}>Save</button>${choices}</form>${primaryDone ? hint('td.save') : ''}${ok}</div>`;
}
const prettyTimeOf = (hhmm) => { const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/); if (!m) return ''; const h = Number(m[1]); return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`; };

function payTargetFor(r, inv) {
  return inv ? { action: `/admin/invoices/${inv.id}/status`, field: 'action', extra: { back: '/admin/' } } : { action: '/admin/requests/status', field: 'status', extra: { r: b64urlText(r.key) } };
}

// Group 4: all notes first, then the history newest first (the newest 5, then "Show all (N)").
export const HISTORY_SHOWN = 5;
function historyHtml(events = [], notes = []) {
  const nt = [...notes].reverse().map((n) => `<li data-note><span class="muted">${esc(n.created_at ? memphisDay(n.created_at) : 'Note')}</span> ${esc(n.body)}</li>`).join('');
  const ev = [...events].reverse().map((e) => `<li><span class="muted">${esc(memphisWhen(e.at))}</span> ${esc(plainHistory(e.what))}</li>`);
  const shown = ev.slice(0, HISTORY_SHOWN).join('');
  const rest = ev.slice(HISTORY_SHOWN).join('');
  return `${nt ? `<h4>Notes (only you see these)</h4><ul data-notes>${nt}</ul>` : ''}${ev.length ? `<h4>History</h4><ul data-history>${shown}</ul>${rest ? `<details class="histall" data-history-all><summary${tip('card.historyAll')}>Show all (${ev.length})</summary><ul>${rest}</ul></details>` : ''}` : ''}${nt || ev.length ? '' : '<p class="muted" data-history-empty>Nothing yet.</p>'}`;
}

// A message pair as small links, never a big button (owner, 18 Oct 2026): "Text about pickup
// time · Email it". The text is a free sms: link from Valerie's phone (tap logged by TAP_JS);
// the email twin sends at once from hello@. showText: false leaves only the email link (when
// the text is already the card's one primary button).
export function msgPair({ sms, rk, template, textKey, emailKey, textLabel, emailLabel = 'Email it', canEmail = true, showText = true }) {
  const text = showText && sms ? `<a class="msglink" href="${esc(sms.href)}" data-msg-tap="${esc(template)}" data-rk="${esc(rk)}"${tip(textKey)}>${esc(textLabel)}</a>` : '';
  const email = canEmail ? `<form method="post" action="/admin/msg/email">${hiddenInputs({ r: rk, template })}<button class="linkbtn" type="submit"${tip(emailKey)}>${esc(emailLabel)}</button></form>` : '';
  if (!text && !email) return showText ? '<span class="muted">No mobile number on file.</span>' : '';
  return `<span class="msgpair" data-msg="${esc(template)}">${[text, email].filter(Boolean).join('<span class="muted">·</span>')}</span>`;
}

// The small "Messages" line on a card: the confirmation and the pickup-time question.
function messagesLine(msgs, { rk, services, primary, returned, quiet }) {
  if (!msgs || quiet) return '';
  const out = [];
  if (msgs.confirm) out.push(msgPair({ sms: msgs.confirm.sms, rk, template: 'confirmation', textKey: 'conf.text', emailKey: 'conf.email', textLabel: "Text them it's confirmed", canEmail: msgs.confirm.canEmail }));
  if (msgs.pickup && services.includes('rentals') && !returned) {
    const isPrimary = String(primary).split('|')[0] === 'msg.pickupText';
    out.push(msgPair({ sms: msgs.pickup.sms, rk, template: 'pickupTime', textKey: 'msg.pickupText', emailKey: 'msg.pickupEmail', textLabel: 'Text about pickup time', emailLabel: isPrimary ? 'Email the pickup question' : 'Email it', canEmail: msgs.pickup.canEmail, showText: !isPrimary }));
  }
  const pairs = out.filter(Boolean);
  return pairs.length ? `<div class="msgline" data-messages><span class="mlabel">Messages</span>${pairs.join('<span class="msgsep" aria-hidden="true">|</span>')}</div>` : '';
}

const chicagoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// ---- Step cards (owner-approved 19 Oct 2026, the "one step at a time" mock-up) --------------
// Top: NEW, service, name, one date line. Then the green bar, "N of M done" and the named steps
// (done = green ✓, the current one bold, later ones grey) with "undo" beside the last ✓. Then
// ONE "Next step" box: one plain sentence and ONE big button. Above it, always (owner-approved
// mock-up, 20 Oct 2026): Call / Text, the dates, the 🚚 Business delivery tag and the Latest
// note with "+ Add a note". Everything else is under "More about <first name>", in four groups
// (What they booked (open), Money, Their details and ID, Notes and history) and a quiet row
// (Edit · Print checklist · Put away · Cancel this job…). The steps come from steps.mjs (derived
// from the facts, so doing a thing anywhere ticks its step here).
export const STEP_CSS = `
.stepcard{display:grid;gap:12px}
.stepcard .schead{display:grid;gap:4px;grid-template-columns:minmax(0,1fr) auto;align-items:start}.stepcard .schead>*{grid-column:1}.stepcard .schead>.qa{grid-column:2;grid-row:1 / span 3}
.stepcard .qa{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;max-width:190px}.stepcard .qa a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:0 12px;border:2px solid var(--accent);border-radius:999px;font-weight:700;font-size:.98rem;text-decoration:none;color:var(--accent);background:#fff;white-space:nowrap}.stepcard .svcs{margin:0}.stepcard .sctags{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.stepcard h3.who{font-size:1.6rem;margin:0}.stepcard .scwhen{color:var(--muted);font-size:1rem;margin:0}.stepcard .scdelivery{margin:2px 0 0;font-size:1rem}
.scbar{height:10px;border-radius:5px;background:var(--line);overflow:hidden;margin:2px 0 0}.scbar i{display:block;height:100%;background:var(--ok)}
.scof{font-size:.9rem;color:var(--muted);margin:4px 0 0}
.sclist{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:2px}
.sclist li{display:flex;align-items:center;gap:10px;padding:6px 6px;border-radius:8px;font-size:1rem;flex-wrap:wrap}
.sclist .ck{width:26px;height:26px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;font-size:.85rem;font-weight:700;flex:none;background:#fff}
.sclist li.d .ck{background:var(--ok);border-color:var(--ok);color:#fff}.sclist li.d .t{color:var(--muted)}
.sclist li.c{background:var(--cream);font-weight:700}.sclist li.c .ck{border-color:var(--accent);color:var(--accent)}
.sclist li.u{color:#8a7d73}
.sclist details.undo{margin-left:auto}.sclist details.undo[open]{flex-basis:100%;margin-left:36px}
.undolink{list-style:none;cursor:pointer;color:var(--muted);font-size:.9rem;text-decoration:underline;min-height:32px;display:inline-flex;align-items:center;padding:0 4px}
.undolink::-webkit-details-marker{display:none}
.undobox{margin:6px 0 4px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;font-weight:400}
.undobox form{margin:8px 0 0}.undobox .btn{min-height:48px}
.nextbox{border-radius:12px;background:var(--cream);border:1px solid var(--line);padding:12px;display:grid;gap:10px}
.nextbox .lbl{font-size:.78rem;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);font-weight:700;margin:0}
.nextbox .what{font-weight:700;font-size:1.15rem;line-height:1.3;margin:0}
.nextbox .why{font-size:.98rem;color:var(--muted);margin:0}
.nextbox .actions{margin:0}.nextbox .hint{margin:4px 0 0}
.nextbox .smallrow{display:flex;gap:8px}.nextbox .smallrow>*{flex:1}.nextbox .smallrow .btn{min-height:48px}
.waitline{margin:0;font-weight:700;color:var(--muted)}.waitline.late{color:#b42318}
.holdline{background:#fdf3d8;color:#7a4a0c;border-radius:8px;padding:8px 10px;font-weight:600;margin:0}
.nextbox .tdrow{margin:0}.nextbox .nextslot{margin:0}
.nextbox .done-msg{color:var(--ok);font-weight:700;font-size:1.1rem;margin:0}
.tentline{margin:0;padding:8px 10px;border:2px dashed #b9aea5;border-radius:10px;color:var(--muted);font-size:.95rem}
details.talk>summary{list-style:none}details.talk>summary::-webkit-details-marker{display:none}
details.talk[open]>summary{margin-bottom:10px}
.talkbox{display:grid;gap:10px;padding:12px;border:2px solid var(--accent);border-radius:12px;background:#fff}
.talkbox .q{margin:0;font-size:1.15rem}
.talkbox label{font-weight:600}.talkbox input[type=date]{min-height:48px;font-size:1.05rem}
.talkbox form{margin:0;display:grid;gap:8px}
.btn.yes{background:var(--ok);border-color:var(--ok);color:#fff;min-height:56px;font-size:1.1rem}
.pickform{display:grid;gap:8px;margin:0}.pickform .choice{display:flex;gap:10px;align-items:center;font-weight:600}
.pickform .choice input{width:24px;height:24px}
details.more>summary{font-weight:600}
.morerow{display:flex;flex-wrap:wrap;gap:6px 8px;margin:10px 0 0}.morerow .act{margin:0}
.morerow .btn,.morerow .editlink{width:auto;min-height:44px;font-size:.95rem;padding:6px 14px;border-width:1px;border-radius:999px}
.morerow form{margin:0}
.noteform{margin:10px 0 0}.noteform textarea{min-height:70px}
.biztag{display:inline-block;padding:2px 10px;border-radius:999px;background:#e8f0fe;color:#1e3a8a;font-weight:700;margin-right:4px}
.nextbox .biz{margin:0;font-weight:700;color:#1e3a8a}
.lnote{display:grid;gap:4px;padding:10px 12px;border-radius:10px;background:#fffaf0;border:1px solid #ebcf96}.lnote.empty{background:none;border:0;padding:0}
.lnote .lnh{margin:0}.lnote .lnb{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:1rem}
.lnote details.addnote>summary{display:inline-flex;align-items:center;min-height:44px;color:var(--accent);font-weight:700;text-decoration:underline;cursor:pointer;list-style:none}
.lnote details.addnote>summary::-webkit-details-marker{display:none}
details.grp{padding:0}details.grp>summary{display:flex;align-items:center;gap:8px;min-height:48px;font-weight:700;font-size:1.05rem;cursor:pointer}
details.grp>summary small{font-weight:400;color:var(--muted);font-size:.9rem}
details.disclose.more{border-top:0}
details.disclose.more>summary{justify-content:space-between;gap:10px;min-height:48px;padding:10px 14px;background:#f6efe6;border:1px solid var(--line);border-radius:12px;color:var(--ink);font-size:1.05rem}
details.disclose.more>summary::before{content:none}details.disclose.more>summary::marker{content:""}
details.disclose.more .mhide{display:none}details.disclose.more[open]>summary .mshow{display:none}details.disclose.more[open]>summary .mhide{display:inline}
.mchev{flex:none;font-size:1.6rem;line-height:1;color:var(--accent);transition:transform .15s}details.disclose.more[open]>summary .mchev{transform:rotate(180deg)}
.mhint{margin:10px 2px 4px;color:var(--muted);font-size:.95rem}
details.grp>summary{list-style:none;justify-content:space-between;padding:8px 12px;margin:6px 0;background:#fbf7f1;border:1px solid var(--line);border-radius:10px}
details.grp>summary::-webkit-details-marker{display:none}details.grp>summary::marker{content:""}
details.grp>summary .gt{flex:1;min-width:0}.tapopen{font-weight:400;color:var(--muted);font-size:.85rem;white-space:nowrap}details.grp[open]>summary .tapopen{display:none}
.gchev{flex:none;font-size:1.8rem;line-height:1;color:var(--accent);transition:transform .15s}details.grp[open]>summary .gchev{transform:rotate(90deg)}
details.disclose>summary:focus-visible,details.grp>summary:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.gin{display:grid;gap:6px;padding:0 0 10px}.gin .gl{margin:0;overflow-wrap:anywhere}.gin .gl.ok{color:#2f5a2b}.gin .warnline{color:#8f3427;font-weight:600}
.gin .glink{display:inline-flex;align-items:center;min-height:44px;color:var(--accent);font-weight:700}
.gin ul{margin:0;padding-left:18px}.gin h4{margin:6px 0 2px}
.morerow.quiet{border-top:1px solid var(--line);padding-top:8px;align-items:center}.morerow .voidlink{margin:0;border:0;padding:0}
.dlform{display:grid;gap:8px;margin:0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fff}.dlform .dlq{margin:0}
.dlform .choice{display:flex;gap:10px;align-items:center;min-height:44px}.dlform .choice input{width:24px;height:24px;flex:none}
.dlform .dlfields{display:grid;gap:4px}.dlform:has(input[data-how=pickup]:checked) .dlfields{display:none}
.dlform .btn{min-height:48px}
details.dlprompt>summary{display:inline-flex;align-items:center;min-height:44px;color:#1e3a8a;font-weight:700;text-decoration:underline;cursor:pointer;list-style:none}
@media(min-width:700px){.nextbox .actions .btn.primary{max-width:420px}}
`;

const wdOf = (d) => shortDate(d).split(' ')[0];
function whenLine(r, services, bookings) {
  const booked = (k) => ((bookings || []).find((b) => b.kind === k) || {}).date || '';
  const rentalsOnly = services.length === 1 && services[0] === 'rentals';
  const ans = (re) => parseFormDate(answerOf(r, re));
  if (rentalsOnly) {
    const ev = ans(/what date is your event|^event date/i);
    const { pickup, ret } = rentalDates(r, bookings);
    if (ev && pickup) return `Event ${shortDate(ev)} · pick up ${pickup === ev ? 'that morning' : wdOf(pickup)}${ret ? `, return ${wdOf(ret)}` : ''}`;
    if (pickup) return `Pick up ${shortDate(pickup)}${ret ? `, return ${shortDate(ret)}` : ''}`;
    return ev ? `Event ${shortDate(ev)}` : '';
  }
  const first = services.filter((k) => SCHEDULE_FIRST[k] && k !== 'rentals').map((k) => booked(SCHEDULE_FIRST[k][1])).filter(Boolean).sort()[0] || ans(/event date/i);
  const what = r.porchLine ? `Porch: ${String(r.porchLine).split(' · ')[0]}` : (r.eventType || '');
  const where = answerOf(r, /^location|address|where is it/i);
  const tail = [what, where ? `at ${where}` : ''].filter(Boolean).join(' ');
  return [first ? shortDate(first) : '', tail].filter(Boolean).join(' · ');
}

// The checklist with the one undo beside the last ✓.
function stepList(s, undo, ctx) {
  const pct = s.total ? Math.round((100 * s.doneCount) / s.total) : 0;
  const items = s.steps.map((x) => {
    const cls = x.done ? 'd' : (x.key === s.current ? 'c' : 'u');
    const u = undo && s.lastDone && s.lastDone.key === x.key ? undoHtml(undo, ctx) : '';
    return `<li class="${cls}" data-step="${esc(x.key)}"${x.done ? ' data-step-done' : ''}${x.key === s.current ? ' data-step-current' : ''}><span class="ck" aria-hidden="true">${x.done ? '✓' : x.n}</span><span class="t">${esc(x.label)}${x.done ? '<span class="sr"> (done)</span>' : ''}</span>${u}</li>`;
  }).join('');
  return `<div class="scprog" data-step-progress><div class="scbar" role="progressbar" aria-valuemin="0" aria-valuemax="${s.total}" aria-valuenow="${s.doneCount}" aria-label="Steps done"><i style="width:${pct}%"></i></div>
    <p class="scof" data-step-count>${s.finished ? 'Finished ✓' : `${s.doneCount} of ${s.total} done`}</p><ol class="sclist" data-progress data-step-list>${items}</ol></div>`;
}

function undoHtml(u, ctx) {
  let body;
  if (u.kind === 'form') {
    body = `<p style="margin:0"><strong>${esc(u.question)}</strong></p><form method="post" action="${esc(u.action)}">${hiddenInputs({ r: ctx.rk, ...u.fields })}<button class="btn ghost" type="submit"${tip('step.undoYes')}>Yes, take it back</button></form>`;
  } else if (u.kind === 'returns') {
    body = `<p style="margin:0">${esc(u.question)}</p><p style="margin:8px 0 0"><a href="/admin/returns?k=${esc(ctx.rk)}"${tip('ret.see')}>See the check-in</a></p>`;
  } else {
    body = `<p style="margin:0">${esc(u.words)}</p>${u.link === 'invoice' && ctx.inv ? `<p style="margin:8px 0 0"><a href="/admin/invoices/${ctx.inv.id}"${tip('step.undoOpen')}>Open the invoice</a> · <a href="/admin/requests/edit?r=${esc(ctx.rk)}"${tip('card.edit')}>Edit page</a></p>` : ''}`;
  }
  return `<details class="undo" data-undo="${esc(u.key)}" data-undo-kind="${esc(u.kind)}"><summary class="undolink"${tip('step.undo')}>undo</summary><div class="undobox">${body}</div></details>`;
}

// The ONE "Yes, book it" form (owner-approved 19 Oct 2026): the day(s) she sees, editable, then
// POST /admin/requests/talked go=yes (admin-steps.mjs talkedRoute). The Requests card uses it as
// is; Calendar & Bookings uses the same form (Step 2 and a tapped day on a phone) with
// label "Book it", an id prefix (two copies on one page) and back= so she stays on the calendar.
export function bookYesForm(r, { rk, services, bookings }, { label = 'Yes, book it', idp = 't', back = '', key = 'step.bookYes' } = {}) {
  const rentalsOnly = services.length === 1 && services[0] === 'rentals';
  let dates;
  if (services.includes('rentals')) {
    const { pickup, ret } = rentalDates(r, bookings);
    dates = `<label for="${idp}p-${esc(rk)}">Pickup day</label><input type="date" id="${idp}p-${esc(rk)}" name="date" value="${esc(pickup || '')}" required${tip('step.date')}>
      <label for="${idp}r-${esc(rk)}">Return day</label><input type="date" id="${idp}r-${esc(rk)}" name="return_date" value="${esc(ret || '')}" required${tip('step.date')}>`;
  }
  if (!rentalsOnly) {
    const first = services.filter((k) => k !== 'rentals').map((k) => ((bookings || []).find((b) => b.kind === SCHEDULE_FIRST[k][1]) || {}).date).filter(Boolean).sort()[0] || parseFormDate(answerOf(r, /event date/i));
    const word = services.includes('porch') ? 'Install day' : 'Setup day';
    dates = `${dates || ''}<label for="${idp}e-${esc(rk)}">${word}</label><input type="date" id="${idp}e-${esc(rk)}" name="${services.includes('rentals') ? 'event_date' : 'date'}" value="${esc(first || '')}" required${tip('step.date')}>`;
  }
  return `<form method="post" action="/admin/requests/talked" data-talk-yes>${hiddenInputs({ r: rk, go: 'yes', ...(back ? { back } : {}) })}${dates}<button class="btn yes" type="submit"${tip(key)}>${esc(label)}</button></form>`;
}

// "Are you taking this job?" Yes, book it (the date editable right here) / Not yet / No, put it away.
function talkBox(r, s, x, { withNo = true } = {}) {
  const { rk } = x;
  const yes = bookYesForm(r, x);
  const later = `<form method="post" action="/admin/requests/talked">${hiddenInputs({ r: rk, go: 'later' })}<button class="btn ghost" type="submit"${tip('step.notYet')}>Not yet</button></form>`;
  const no = withNo ? `<form method="post" action="/admin/requests/talked">${hiddenInputs({ r: rk, go: 'no' })}<button class="btn danger" type="submit"${tip('step.putAwayNo')}>No, put it away</button></form>` : '';
  return `<div class="talkbox" data-talk-box><p class="q"><strong>Are you taking this job?</strong></p>${yes}${s.called ? '' : later}${no}</div>`;
}

const holdUntilWords = (h) => {
  if (!h) return '';
  if (h.by_hand) return RESERVED_BY_HAND;
  if (!Number.isFinite(h.untilMs)) return '';
  return `Games reserved until ${reservedWords(h.untilMs)}`;
};

// The ONE next-step box. -> { html, big } (big = the help key of its one big button, or '').
function nextBox(r, s, x) {
  const { rk, services, inv, ctx, dates, bookings, tdS, hold, holdHtml, pickupPlace, today } = x;
  const who = firstName(r.name);
  const rentalsOnly = services.length === 1 && services[0] === 'rentals';
  const box = (what, why, actions, extra = '', big = '') => ({ big, html: `<section class="nextbox" data-next-step="${esc(s.current)}"><p class="lbl">Next step · step ${s.currentN}</p><p class="what" data-next-what>${esc(what)}</p>${why ? `<p class="why">${esc(why)}</p>` : ''}${actions}${extra}</section>` });
  const bigA = (key, href, label, extra = '') => `<div class="actions" data-primary>${act(`<a class="btn primary" href="${esc(href)}"${extra}${tip(key)}>${esc(label)}</a>`, key)}</div>`;
  const wait = (key, words, date) => `<p class="nextslot" data-primary-wait data-next-wait="${esc(key)}"${tip(key)}>Next: ${esc(words)}${date ? ` (${esc(shortDate(date))})` : ''}</p>`;
  const tent = s.called && !s.confirmed && !s.jobDone ? `<details class="talk" data-book-later><summary class="tentline"${tip('step.bookLater')}>Not booked yet: the date is pencilled in. <u>Book it now</u></summary>${talkBox(r, s, x)}</details>` : '';
  const money = (c) => `$${(c / 100).toFixed(2).replace(/\.00$/, '')}`;
  const bal = inv && inv.balance;
  const plan = inv ? payPlanOf(inv, inv.total_cents || 0) : 'half';
  const firstKind = services.filter((k) => k !== 'rentals').map((k) => SCHEDULE_FIRST[k][1])[0];
  const firstB = firstKind ? (bookings || []).find((b) => b.kind === firstKind) : null;
  switch (s.current) {
    case 'void': return { big: 'pay.unvoid', html: `<section class="nextbox" data-next-step="void"><p class="what">Void — cancelled</p><p class="why">The customer was not told. Tap Bring back if it was a mistake.</p><div class="actions" data-primary>${cardButton('pay.unvoid', ctx, true)}</div></section>` };
    case 'finished': return { big: 'card.archive', html: `<section class="nextbox" data-next-step="finished"><p class="done-msg" data-put-away-prompt>✓ All done. This request moves to Finished.</p><div class="actions" data-primary>${cardButton('card.archive', ctx, true)}</div></section>` };
    case 'called': {
      const tel = r.phone ? `<a class="btn ghost" href="tel:${esc(String(r.phone).replace(/[^\d+]/g, ''))}"${tip('step.call')}>Call</a>` : '';
      const sms = r.phone ? `<a class="btn ghost" href="sms:${esc(String(r.phone).replace(/[^\d+]/g, ''))}"${tip('step.text')}>Text</a>` : '';
      const why = rentalsOnly ? 'Confirm the games and the date. If you already talked, tap the button.' : 'Talk about what they want and the date. If you already talked, tap the button.';
      // How long they have waited (Memphis days; the daily "Call these people back" email says the same).
      const wd = waitingDays(sentMs(r), today);
      const waitLine = `<p class="waitline${wd >= WAIT_HIGHLIGHT_DAYS ? ' late' : ''}" data-waiting="${wd}">${esc(waitingWords(wd))}</p>`;
      const how = services.includes('rentals') ? `<div class="dlstep" data-delivery-step>${deliveryForm(r, rk)}</div>` : '';
      return box(`Call or text ${who} back`, why, `${waitLine}${tel || sms ? `<div class="smallrow">${tel}${sms}</div>` : ''}<details class="talk" data-talk><summary class="btn primary"${tip('step.talked')}>I've talked to them</summary>${talkBox(r, s, x)}</details>${hint('step.talked')}${how}`, '', 'step.talked');
    }
    case 'invoiced': {
      const lines = inv && inv.lines ? inv.lines : null;
      if (inv && inv.status === 'draft') {
        const sum = lines && lines.length ? `It is already filled in: ${lines.filter((l) => !l.refundable).map((l) => l.description).slice(0, 2).join(', ')}${bal ? `, ${money(bal.charges)}` : ''}${bal && bal.refundable ? `, plus the ${money(bal.refundable)} deposit` : ''}. Check it, then send.` : 'It is already filled in. Check it, then send.';
        return box('Send the invoice', sum, `${bigA('step.reviewSend', `/admin/invoices/${inv.id}/edit`, 'Review & send invoice')}`, tent, 'step.reviewSend');
      }
      return box(rentalsOnly ? 'Send the invoice' : 'Send the quote or invoice', rentalsOnly ? 'The games and prices fill in by themselves. Check it, then send.' : 'Use what you agreed on the call.', bigA('card.createInvoice', `/admin/invoices/new?r=${rk}`, 'Create invoice'), tent, 'card.createInvoice');
    }
    case 'deposit': {
      const full = plan === 'full';
      const amt = inv ? (full ? (bal ? bal.remaining : 0) : inv.deposit_due_cents) : 0;
      // "Games reserved until Fri 23 Oct, 11:59 PM" + "Reserve their games longer" (the button,
      // then Save for 3 days). Reserved by hand (no end date): the same control sets now + N days.
      const holdBit = hold ? `<p class="holdline" data-hold-line>${esc(holdUntilWords(hold))}</p><style>${HOLD_CSS}</style>${reserveLongerControl(rk, { untilMs: hold.by_hand ? NaN : hold.untilMs, card: true })}` : '';
      const key = full ? 'pay.paid' : 'pay.deposit';
      const due = inv && inv.status !== 'draft' ? dueWords(bal) : '';
      const moneyLine = due ? `<p class="why" data-next-money>Invoice sent · ${esc(due)}</p>` : '';
      return box(full ? 'Wait for the payment' : 'Wait for the deposit', `Tap the button when the ${amt ? `${money(amt)} ` : ''}${full ? 'payment' : 'deposit'} comes in.`, `${moneyLine}${holdBit}<div class="actions" data-primary>${cardButton(key, ctx, true)}</div>`, tent, key);
    }
    case 'setup': {
      const word = services.includes('porch') ? 'Install' : 'Setup';
      if (!firstB) {
        const k = services.includes('porch') ? 'card.schedInstall' : 'card.schedSetup';
        return box(`Book the ${word.toLowerCase()} day`, 'Pick the day on the calendar. The setup checklist goes on the Day sheet.', bigA(k, `/admin/calendar/new?r=${rk}&kind=${firstKind}`, `Book the ${word.toLowerCase()} day`), '', k);
      }
      const where = answerOf(r, /^location|address|where is it/i);
      const why = [r.eventType, where ? `at ${where}` : '', firstB.time ? prettyTimeOf(firstB.time) : ''].filter(Boolean).join(', ');
      const reached = !today || today >= firstB.date;
      const btn = reached ? `<div class="actions" data-primary>${cardButton('card.jobDone', { ...ctx, jobWord: `Mark ${word.toLowerCase()} done` }, true)}</div>` : wait('card.jobDone', `Mark ${word.toLowerCase()} done, on the day`, firstB.date);
      return box(`${word} day: ${shortDate(firstB.date)}`, `${why ? `${why}. ` : ''}The Day sheet has the checklist.`, btn, '', reached ? 'card.jobDone' : '');
    }
    case 'takedown': case 'pickup': {
      const grazing = s.current === 'pickup';
      const kind = grazing ? 'grazing_pickup' : (services.includes('porch') ? 'porch_takedown' : 'party_takedown');
      const b = (bookings || []).find((y) => y.kind === kind);
      const notNeeded = `<form method="post" action="/admin/requests/takedown">${hiddenInputs({ r: rk, plan: 'customer_handles' })}<button class="btn ghost" type="submit"${tip('step.notNeeded')}>Not needed</button></form>`;
      if (b && grazing) {
        return box(`Pickup: ${shortDate(b.date)}`, 'Pick up the grazing table things. Or tap "Not needed".', `<div class="actions" data-primary><form method="post" action="/admin/calendar/bookings/${b.id}/done">${hiddenInputs({ r: rk })}${act(`<button class="btn primary" type="submit"${tip('step.pickupDone')}>Mark pickup done</button>`, 'step.pickupDone')}</form></div><div class="smallrow">${notNeeded}</div>`, '', 'step.pickupDone');
      }
      const row = takedownRow({ kind, tdS, r, rk, bookings, eventDate: dates.eventDate, primaryDone: true, saved: Boolean(x.tdSaved), savedWords: x.tdSaved });
      const what = b ? `Takedown: ${shortDate(b.date)}` : (grazing ? 'Pickup (optional)' : 'Book the takedown');
      const why = b ? 'Or tap "Not needed" if they are keeping the decor.' : (grazing ? 'Book a pickup day, or tap "Not needed".' : 'Pick the day and tap Save. Or tap "Not needed" if they are keeping the decor.');
      return box(what, why, `${row}<div class="smallrow">${notNeeded}</div>`, '', b ? 'td.markDone' : 'td.save');
    }
    case 'picked': {
      const pb = s.pickupBooking;
      if (!pb) return box('Book the pickup and return', 'Pick both days on the calendar.', bigA('card.schedPickup', `/admin/calendar/new?r=${rk}&kind=rental_pickup`, 'Book pickup + return'), tent, 'card.schedPickup');
      const owed = bal ? bal.owed : 0;
      const addr = deliveryAddress(r);
      const due = dueWords(bal);
      const to = [answerOf(r, /^business name$/i), addr].filter(Boolean).join(', ');
      const why = addr ? `Deliver to ${to}. Hand over the games.${due ? ` ${due}.` : ''}` : `At ${pickupPlace || 'Mt. Moriah Station'}. Hand over the games.${due ? ` ${due}.` : ''}`;
      const pw = addr ? 'Delivery' : 'Pickup';
      const bizTag = addr ? '<p class="biz" data-next-biz>🚚 Business delivery</p>' : '';
      // No pickup time yet: the small "Text about pickup time" sits in the box (never big).
      const m = ctx.msgs && ctx.msgs.pickup && ctx.msgs.pickup.sms;
      const timeText = m && !pb.time ? `<div class="smallrow"><a class="btn ghost" href="${esc(m.href)}" data-msg-tap="pickupTime" data-rk="${esc(rk)}"${tip('msg.pickupText')}>Text about pickup time</a></div>` : '';
      if (today && today < pb.date) return box(`${pw}: ${shortDate(pb.date)}`, why, `${bizTag}${timeText}${wait('step.picked', addr ? 'Mark delivered, on delivery day' : 'Mark picked up, on pickup day', pb.date)}`, tent, '');
      const pay = owed > 0 && inv ? `<label class="choice"><input type="checkbox" name="paid_rest" value="1" checked${tip('step.paidRest')}> They paid the rest (${money(owed)}) now</label>${methodPicker()}` : '';
      const btn = `<button class="btn primary" type="submit"${tip('step.picked')}>${addr ? 'Mark delivered' : 'Mark picked up'}</button>`;
      return box(`${pw}: ${shortDate(pb.date)}`, why, `${bizTag}<form class="pickform" method="post" action="/admin/calendar/bookings/${pb.id}/done" data-primary>${hiddenInputs({ r: rk })}${pay}${pay ? act(btn, 'step.picked') : `<div class="act">${btn}</div>`}</form>`, '', 'step.picked');
    }
    case 'returned': {
      const { ret } = rentalDates(r, bookings);
      const addr = deliveryAddress(r);
      const from = [answerOf(r, /^business name$/i), addr].filter(Boolean).join(', ');
      return box(`${addr ? 'Collect' : 'Return'}: ${ret ? shortDate(ret) : 'not set'}`, addr ? `Collect the games from ${from}. Check every game is back and nothing is damaged.` : 'Check every game is back and nothing is damaged.', `${addr ? '<p class="biz" data-next-biz>🚚 Business delivery</p>' : ''}<div class="actions" data-primary>${cardButton('ret.mark', ctx, true)}</div>`, '', 'ret.mark');
    }
    case 'deposit_back': {
      if (!inv || !s.refundable) return box('Make the invoice', 'The damage deposit is on the invoice.', bigA('card.createInvoice', `/admin/invoices/new?r=${rk}`, 'Create invoice'), '', 'card.createInvoice');
      const damaged = x.ret && x.ret.damaged;
      const amt = s.held;
      const form = `<form class="pickform" method="post" action="/admin/invoices/${inv.id}/deposit" data-primary>${hiddenInputs({ kind: 'refund', amount: (amt / 100).toFixed(2), back: `/admin/#c-${rk}` })}${methodPicker()}${act(`<button class="btn primary" type="submit"${tip('step.depositBack')}>Deposit returned, finish</button>`, 'step.depositBack')}</form>`;
      const keep = `<p style="margin:0"><a href="/admin/invoices/${inv.id}#deposit"${tip('step.keepDamage')}>Keep some for damage</a></p>`;
      return box(`Give back the ${money(amt)} deposit`, damaged ? 'Something came back damaged: keep some for damage, or give it all back.' : 'Everything came back fine? Return the deposit and the rental is finished.', `${form}${keep}`, '', 'step.depositBack');
    }
    case 'paid': {
      const owed = bal ? bal.owed : 0;
      return box('Collect the rest', owed > 0 ? `${dueWords(bal)}.` : 'Mark it paid when the rest is in.', `<div class="actions" data-primary>${cardButton('pay.paid', ctx, true)}</div>`, '', 'pay.paid');
    }
    default: return { big: '', html: '' };
  }
}

// The next step on a card whose job was missed (owner-approved mock-up, panel 7): "Call <first
// name> and set a new <job> day", Pick a new day (the booking's own edit page), Mark done (it
// happened) through the route that job is normally marked done with, and Not needed where the
// card has it (porch / party takedown, grazing pickup).
const DONE_ROUTE_KINDS = /_takedown$|^rental_pickup$|^grazing_pickup$|^other$/;
function missedNextBox(m, { rk, ctx, s }) {
  const done = /^(porch_install|party_setup|grazing_setup)$/.test(m.kind)
    ? cardButton('card.jobDone', { ...ctx, jobWord: 'Mark done (it happened)' }, false)
    : (m.kind === 'rental_return'
      ? `<div class="act"><a class="btn ghost" href="/admin/returns?k=${esc(b64urlText(m.returnKey))}" data-missed-done${tip('ret.mark')}>Mark done (it happened)</a></div>`
      : (DONE_ROUTE_KINDS.test(m.kind) ? `<form method="post" action="/admin/calendar/bookings/${esc(m.id)}/done" data-missed-done>${hiddenInputs({ r: rk })}<div class="act"><button class="btn ghost" type="submit"${tip('step.missedDone')}>Mark done (it happened)</button></div></form>` : ''));
  const notNeeded = /_takedown$|^grazing_pickup$/.test(m.kind) ? `<div class="smallrow"><form method="post" action="/admin/requests/takedown">${hiddenInputs({ r: rk, plan: 'customer_handles' })}<button class="btn ghost" type="submit"${tip('step.notNeeded')}>Not needed</button></form></div>` : '';
  return { big: 'step.missedNewDay', html: `<section class="nextbox missbox" data-next-step="missed" data-missed-step="${esc(m.kind)}"><p class="lbl">Next step · overdue</p><p class="what" data-next-what>${esc(`Call ${m.first} and set a new ${m.short} day`)}</p><p class="why">${esc(`Was due ${dayWords(m.date)} · ${lateWords(m.days)} · not marked done.`)}</p>
    <div class="actions" data-primary>${act(`<a class="btn primary" href="/admin/calendar/bookings/${esc(m.id)}/edit" data-missed-new-day${tip('step.missedNewDay')}>Pick a new day</a>`, 'step.missedNewDay')}${done}</div>${notNeeded}</section>` };
}

// The thin red strip at the top of Requests (panel 7): one line for one missed job, a <details>
// of thin rows for several (oldest first). Card ↓ jumps to the card (#c-<key>), which never
// moves; ✕ hides the strip until tomorrow morning on every device (missed.mjs dismissStrip).
export const MISSED_CSS = `.mstrip1,.mstrip{background:#c0392b;color:#fff;border-radius:8px;font-size:.95rem;margin:0 0 10px}
.mstrip1{display:flex;align-items:center;gap:10px;padding:2px 4px 2px 12px;min-height:40px}
.mstrip1 .st,.mstrip .st{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mstrip1 a,.mstrip .mrow a,.mstrip .see{color:#fff;font-weight:700;text-decoration:underline;flex:none}
.mstrip>summary{list-style:none;display:flex;align-items:center;gap:10px;padding:2px 4px 2px 12px;min-height:40px;cursor:pointer}
.mstrip>summary::-webkit-details-marker{display:none}
.mstrip form,.mstrip1 form{margin:0;flex:none}
.mstrip .sx,.mstrip1 .sx{background:transparent;border:0;color:#fff;font:inherit;font-weight:700;width:40px;height:36px;border-radius:6px;cursor:pointer}
.mstrip .mrow{display:flex;align-items:center;gap:12px;padding:7px 12px;border-top:1px solid rgba(255,255,255,.35)}
.card.miss{border:2px solid #c0392b !important}
.mchip{display:inline-block;background:#c0392b;color:#fff;font-weight:800;font-size:.85rem;padding:3px 12px;border-radius:99px;margin:0 0 6px}
.nextbox.missbox{border-color:#c0392b}.nextbox.missbox .lbl{color:#c0392b}`;
const telOf = (p) => String(p || '').replace(/[^\d+]/g, '');
export function missedStrip(missed = []) {
  if (!missed.length) return '';
  const cardOf = (m) => (m.key ? `#c-${b64urlText(m.key)}` : `/admin/day/${m.date}`);
  const call = (m) => (telOf(m.phone) ? `<a href="tel:${esc(telOf(m.phone))}"${tip('step.call')}>Call</a>` : '');
  const x = `<form method="post" action="/admin/missed/dismiss" data-missed-dismiss>${hiddenInputs({ ids: missed.map((m) => m.id).join(',') })}<button type="submit" class="sx" aria-label="Dismiss until tomorrow"${tip('req.missedDismiss')}>✕</button></form>`;
  if (missed.length === 1) {
    const m = missed[0];
    return `<div class="mstrip1" role="alert" data-missed-strip data-missed-count="1"><span class="st">⚠ <b>Missed:</b> ${esc(`${m.who} ${m.strip}, ${dayWords(m.date)}`)}</span>${call(m)}<a href="${esc(cardOf(m))}" data-missed-card${tip('req.missedCard')}>Card ↓</a>${x}</div>`;
  }
  return `<details class="mstrip" role="alert" data-missed-strip data-missed-count="${missed.length}"><summary${tip('req.missedSee')}><span class="st">⚠ <b>${esc(missedCountWords(missed.length))}</b></span><span class="see">See them ▾</span>${x}</summary>
    ${missed.map((m) => `<div class="mrow" data-missed-row="${esc(m.id)}"><span class="st">${esc(`${m.who} · ${m.strip} · ${dayWords(m.date)}`)}</span>${call(m)}<a href="${esc(cardOf(m))}" data-missed-card${tip('req.missedCard')}>Card ↓</a></div>`).join('')}</details>`;
}

// One request card. o: everything dashboardPage knows about this request.
export function requestCard(r, o) {
  const { st = { status: 'new' }, inv = null, sched = null, ret = null, cl = '', kinds = [], extras = '', referrers = {}, events = [], notes = [], archived = false, foodPerHead = null, pickupPlace,
    bookings = [], today = chicagoToday(), msgs = null, invoiceTakedown = false, bottom = '', tdSaved = '', isNew = false, stored = null, depositOut = null, hold = null, holdHtml = '', missed = [] } = o;
  const rk = b64urlText(r.key);
  const services = servicesOf(r);
  const rental = Boolean(r.gamesAnswer) || (r.wantsRentals && !r.wantsDecor);
  const tdS = takedownState({ services, takedownPlan: r.takedownPlan, takedownDate: r.takedownDate, invoiceTakedown, bookings, today });
  const pr = deriveProgress({ st, inv, scheduled: Boolean(sched), ret, rental, takedown: tdS });
  // The bookings the steps read: the real ones, else (older callers) the earliest booked day.
  const firstK = services.map((k) => SCHEDULE_FIRST[k] && SCHEDULE_FIRST[k][1]).filter(Boolean);
  const bk = bookings.length ? bookings : (sched ? (kinds.length ? kinds : firstK).map((kind) => ({ kind, date: sched.date })) : []);
  const s = deriveSteps({ r, services, pr, inv, st, bookings: bk, ret, tdS, stored, depositOut, today });
  // Finished means every step on the card is done (cards.mjs cardStage reads the same facts).
  const stage = cardStage({ pr: { ...pr, finished: pr.finished && s.finished }, inv, archived });
  const returned = Boolean(ret && ret.returned_at);
  const plan = inv ? payPlanOf(inv, inv.total_cents || 0) : 'half';
  const dates = cardDates({ r, services, bookings: bookings.length ? bookings : (sched ? kinds.map((kind) => ({ kind, date: sched.date })) : []), today });
  const rules = cardButtons({ services, stage, inv, plan, sched: Boolean(sched), kinds, returned, jobDoneAt: Boolean(st.job_done_at), takedownPlan: r.takedownPlan,
    eventReached: dates.eventReached, pickupReached: dates.pickupReached, pickupTimeSet: dates.pickupTimeSet, canText: Boolean(msgs && msgs.pickup && msgs.pickup.sms),
    takedown: tdS, paidFull: s.paidFull });
  const quiet = ['void', 'finished', 'archived'].includes(stage);
  const rowKind = inlineRowKind({ services, stage });
  const ctx = { rk, inv, st, sched, who: r.name || 'this customer', payTarget: payTargetFor(r, inv), tdNotSure: tdS.status === 'not_sure', msgs, td: tdS };
  const first = serviceBadge(services[0]);
  const deposit = inv && inv.balance && inv.balance.refundable ? inv.balance : null;
  const chips = [
    isNew ? `<button type="button" class="newb big" data-new-badge${tip('req.new')}>NEW</button>` : '',
    isPhone(r) ? `<span class="chip phone" data-phone-chip${tip('card.phoneChip')}>From a phone call</span>` : '',
    pr.void ? '<span class="chip void" data-step="void">Void — cancelled</span>' : '',
    stage === 'finished' ? '<span class="chip paid" data-finished>Finished: job done and paid</span>' : '',
    returned && ret.damaged ? '<span class="chip deposit_paid" data-returned-damage>Returned — check damage</span>' : '',
  ].join('');
  const svcBadges = services.map((k) => { const b = serviceBadge(k); return b ? `<span class="svc" data-service="${k}" style="border-color:${b.bar};background:${b.tint}">${esc(b.label)}</span>` : ''; }).join('');
  const x = { rk, services, inv, ctx, dates, bookings: bk, tdS, hold, holdHtml, pickupPlace, today, ret, tdSaved };
  // A missed job (missed.mjs, oldest first) takes over the next step; the card stays in its place.
  const miss = !archived && !pr.void && missed.length ? missed[0] : null;
  const nb = archived ? { big: 'pa.bringBack', html: `<section class="nextbox" data-next-step="archived"><p class="what">Put away</p><div class="actions" data-primary>${cardButton('pa.bringBack', ctx, true)}</div></section>` }
    : (miss ? missedNextBox(miss, { rk, ctx, s }) : nextBox(r, s, x));
  const undo = archived || pr.void ? null : undoFor(s, { tdS, stored });
  const steps = archived || pr.void ? '' : stepList(s, undo, ctx);
  const big = nb.big;
  // The takedown / pickup line lives in the next-step box while it IS the next step; otherwise
  // under More, never twice.
  const rowInBox = ['takedown', 'pickup'].includes(s.current) && !archived && !pr.void && !miss;
  const row = rowKind && !rowInBox ? takedownRow({ kind: rowKind, tdS, r, rk, bookings, eventDate: dates.eventDate, primaryDone: false, saved: Boolean(tdSaved), savedWords: tdSaved }) : '';
  const g = services.includes('grazing') ? grazingFacts(r, foodPerHead) : null;
  const gLine = g && (g.guests || g.estimate) ? `<div class="want" data-grazing-facts>${esc([g.guests ? `Guests: ${g.guests}` : '', g.estimate].filter(Boolean).join(' · '))}</div>` : '';
  const damage = returned && ret.damaged && stage !== 'archived' && stage !== 'void' ? `<div class="notice warn" data-deposit-reminder><strong>Something came back damaged or missing.</strong> ${deposit ? `Damage deposit ${esc(money(deposit.refundable))}, refundable. ` : ''}Decide whether to refund the deposit in full or keep part of it. Nothing is sent to the customer by itself.</div>` : '';
  const payment = quiet ? '' : cardPaymentBox(r, st, inv, big, ctx);
  const bigBase = String(big).split('|')[0];
  const others = [...rules.secondary, ...rules.more].filter((k) => k.split('|')[0] !== bigBase && k !== 'card.printChecklist' && k.split('|')[0] !== 'card.seeCal');
  // The other buttons, each in the group it belongs to: money ones under Money, the put-away /
  // bring-back ones in the quiet bottom row, the rest (calendar, checklist, returns, job done)
  // under What they booked.
  const MONEY_KEYS = /^(card\.(createInvoice|openInvoice)|pay\.)/;
  const BOTTOM_KEYS = /^(card\.archive|pa\.bringBack)$/;
  const btnRow = (keys, attr) => (keys.length ? `<div class="secrow" ${attr}>${keys.map((k) => cardButton(k, ctx, false)).join('')}</div>` : '');
  const moneyBtns = others.filter((k) => MONEY_KEYS.test(k.split('|')[0]));
  const bottomBtns = others.filter((k) => BOTTOM_KEYS.test(k.split('|')[0]));
  const bookedBtns = others.filter((k) => !moneyBtns.includes(k) && !bottomBtns.includes(k));
  const decorish = services.some((k) => k !== 'rentals');
  // The hold controls (Text a reminder, Release the games now) and the other notices sit under Money.
  const extrasHere = quiet ? '' : `${extras}${holdHtml || ''}`;
  const who = firstName(r.name);
  const addr = deliveryAddress(r);
  const biz = answerOf(r, /^business name$/i);
  // Reverse case: the invoice has a Delivery fee line but the request has no business delivery.
  const feeNoAddr = !addr && services.includes('rentals') && inv && (inv.lines || []).some((l) => DELIVERY_LINE.test(String(l.description || '')));
  const bizLine = addr ? `<p class="scdelivery" data-business-delivery><span class="biztag">🚚 Business delivery</span> ${esc([biz, addr].filter(Boolean).join(', '))}</p>`
    : (feeNoAddr && !quiet ? `<details class="dlprompt" data-delivery-prompt><summary${tip('card.deliveryPrompt')}>🚚 Business delivery: add the business name and address</summary>${deliveryForm(r, rk, { prompt: true, place: pickupPlace, idp: 'dp' })}</details>` : '');
  // Latest note (owner-approved mock-up, 20 Oct 2026): the newest note in full, its day, and
  // "+ Add a note" right there (never behind More).
  const last = notes.length ? notes[notes.length - 1] : null;
  const noteForm = `<details class="disclose addnote" data-add-note><summary${tip('card.addNote')}>+ Add a note</summary><form class="noteform" method="post" action="/admin/requests/note">${hiddenInputs({ r: rk })}<label for="nt-${esc(rk)}">Note (only you see this)</label><textarea id="nt-${esc(rk)}" name="body" required></textarea>${act(`<button class="btn ghost" type="submit"${tip('card.noteSave')}>Save note</button>`, 'card.noteSave')}</form></details>`;
  const latest = `<div class="lnote${last ? '' : ' empty'}" data-latest-note>${last ? `<p class="lnh"><b>Latest note</b>${last.created_at ? ` <span class="muted" data-latest-note-day>${esc(memphisDay(last.created_at))}</span>` : ''}</p><p class="lnb" data-latest-note-body>${esc(last.body)}</p>` : ''}${noteForm}</div>`;
  // 1. What they booked (open).
  const bk1 = bookedGroupBody(r, { services, bookings: bk, pickupPlace, row, gLine, cl, sched });
  const grp = (key, title, small, body, open = false) => `<details class="grp" data-more-group="${key}"${open ? ' open' : ''}><summary${tip(`card.grp${key[0].toUpperCase()}${key.slice(1)}`)}><span class="gt">${esc(title)}${small ? ` <small>${esc(small)}</small>` : ''} <span class="tapopen" data-tap-open>Tap to open</span></span><span class="gchev" aria-hidden="true">›</span></summary><div class="gin">${body}</div></details>`;
  const booked = grp('booked', 'What they booked', '', `${bk1.html}${btnRow(bookedBtns, 'data-secondary')}`, true);
  // 2. Money.
  const moneySmall = inv && inv.balance && inv.status !== 'draft' ? (dueWords(inv.balance) || (inv.balance.void ? 'void' : 'paid')) : (inv ? 'not sent yet' : 'no invoice yet');
  const reserveHere = hold && s.current !== 'deposit' && !quiet ? `<style>${HOLD_CSS}</style>${reserveLongerControl(rk, { untilMs: hold.by_hand ? NaN : hold.untilMs, card: true })}` : '';
  const moneyBody = `${payment}${btnRow(moneyBtns, 'data-money-buttons')}${messagesLine(msgs, { rk, services, primary: big, returned, quiet })}${extrasHere}${reserveHere}${damage}${quiet ? '' : bottom}`;
  const moneyG = grp('money', 'Money', moneySmall, moneyBody || '<p class="muted" style="margin:0">Nothing here yet.</p>');
  // 3. Their details and ID.
  const detailsG = grp('details', 'Their details and ID', 'phone, email, ID, rules', detailsGroupBody(r, rk, { referrers, used: bk1.used, archived, st }));
  // 4. Notes and history.
  const historyG = grp('history', 'Notes and history', 'newest first', historyHtml(events, notes));
  const moreRow = `<div class="morerow quiet" data-more-row><a class="editlink" href="/admin/requests/edit?r=${esc(rk)}" data-edit-link${tip('card.edit')}>Edit</a>
      ${decorish && !archived ? `<div class="act"><a class="btn ghost" href="/admin/checklist?r=${esc(rk)}" target="_blank" rel="noopener"${tip('card.printChecklist')}>Print checklist</a></div>` : ''}
      ${!archived && !quiet ? `<form method="post" action="/admin/requests/archive" data-archive>${hiddenInputs({ r: rk })}<div class="act"><button class="btn ghost" type="submit"${tip('card.putAway')}>Put away</button></div></form>` : ''}
      ${stage === 'void' && !bottomBtns.some((k) => k.startsWith('card.archive')) ? cardButton('card.archive', ctx, false) : ''}${bottomBtns.map((k) => cardButton(k, ctx, false)).join('')}
      ${quiet ? '' : voidLink(r, inv, ctx)}</div>`;
  return `<article class="card stepcard${miss ? ' miss' : ''}" ${archived ? 'data-archived' : 'data-card'}="${esc(rk)}" id="c-${esc(rk)}" data-reqcard${isNew ? ' data-new' : ''}${miss ? ` data-missed="${esc(miss.id)}"` : ''} data-services="${esc(services.join(' '))}" data-stage="${esc(stage)}" data-current-step="${esc(archived ? 'archived' : s.current)}" data-confirmed="${s.confirmed ? '1' : '0'}"${first ? ` style="border-left-color:${first.bar}"` : ''}>
      ${miss ? `<span class="mchip" data-missed-tag>⚠ MISSED · ${esc(lateWords(miss.days))}</span>` : ''}<div class="schead">${quickContact(r)}<div class="sctags">${chips}<span class="svcs" data-badges>${svcBadges}</span></div>
        <h3 class="who">${esc(r.name || 'No name given')}</h3>${(() => { const w = whenLine(r, services, bk); return w ? `<p class="scwhen" data-when>${esc(w)}</p>` : ''; })()}
        ${bizLine}</div>
      ${latest}
      ${steps}
      ${nb.html}
      <details class="disclose more" data-details><summary${tip('card.details')}><span class="mshow" data-more-show>Show more about ${esc(r.name ? who : 'this request')}</span><span class="mhide" data-more-hide>Hide more about ${esc(r.name ? who : 'this request')}</span><span class="mchev" aria-hidden="true">▾</span></summary>
        <p class="mhint" data-more-hint>Tap any line below to see more.</p>
        ${booked}${moneyG}${detailsG}${historyG}
        ${moreRow}
      </details>
    </article>`;
}

// Group 1: what they booked, each fact once. -> { html, used: the answer labels it shows }.
const lengthWords = (v) => (/weekend/i.test(v) ? 'the weekend' : (/^(day|one day|1 day|a day)$/i.test(String(v).trim()) ? 'one day' : String(v || '').trim().toLowerCase()));
const choiceWords = (v, choices) => {
  const t = String(v || '').trim();
  const hit = [...choices.day, ...choices.weekend].find(([k, l]) => k === t || l.toLowerCase() === t.toLowerCase());
  return (hit ? hit[1] : t).replace(/^The /, 'the ');
};
function bookedGroupBody(r, { services, bookings = [], pickupPlace = 'Mt. Moriah Station', row = '', gLine = '', cl = '', sched = null }) {
  const used = new Set();
  const all = [...r.rentals, ...r.decor, ...r.other];
  const ans = (re) => { const hit = all.find((x) => re.test(String(x.label || ''))); if (hit) used.add(hit.label); return hit ? String(hit.value || '') : ''; };
  const lines = [];
  const line = (k, v, attr) => { if (v) lines.push(`<p class="gl" ${attr}><b>${esc(k)}:</b> ${esc(v)}</p>`); };
  if (services.includes('rentals')) {
    const games = ans(/^which games/i) || r.gamesAnswer;
    line('Games', games, 'data-booked-games');
    const ev = parseFormDate(ans(/what date is your event/i));
    const { pickup, ret } = rentalDates(r, bookings);
    // How long: from the pickup and return days when both are known (owner, 18 Oct 2026), else the answer.
    const L = pickup && ret ? rentalLength(pickup, ret) : null;
    const len = L ? (L.weekend ? 'the weekend' : (L.days === 1 ? 'one day' : L.length)) : lengthWords(ans(/^how long/i) || r.durationAnswer || '');
    ans(/^how long/i);
    const occ = ans(/occasion/i);
    line('Event', ev || occ ? [ev ? shortDate(ev) : '', len, occ].filter(Boolean).join(' · ') : '', 'data-booked-event');
    const lenTail = !(ev || occ) && len ? ` (${len})` : '';
    ans(/^pickup date|^delivery date/i); ans(/^return date/i);
    const pw = choiceWords(ans(/when do you pick up/i), PICKUP_CHOICES);
    const rw = choiceWords(ans(/when do you bring/i), RETURN_CHOICES);
    const pb = bookings.find((b) => b.kind === 'rental_pickup');
    const place = ans(/^pickup place/i) || (pb && pb.place) || pickupPlace;
    const addr = deliveryAddress(r);
    const when = (d, w) => [d ? shortDate(d) : 'not set', w].filter(Boolean).join(', ');
    if (addr) {
      line('Delivery', `${when(pickup, pw)} · Deliver to ${[answerOf(r, /^business name$/i), addr].filter(Boolean).join(', ')}`, 'data-booked-pickup');
      line('Collect', `${when(ret, rw)}${lenTail}`, 'data-booked-return');
    } else {
      line('Pickup', `${when(pickup, pw)} · ${addr || place}`, 'data-booked-pickup');
      line('Back', `${when(ret, rw)}${lenTail}`, 'data-booked-return');
    }
  }
  if (services.some((k) => k !== 'rentals')) {
    if (r.porchLine) { ans(/season or occasion/i); ans(/^how much decor/i); ans(/^book both/i); ans(/^add-ons/i); line('Porch', `${r.porchLine}${r.porchAddOns ? `. Add-ons: ${r.porchAddOns}` : ''}`, 'data-booked-porch'); }
    const type = r.porchLine ? '' : ans(/event type/i);
    const ev = parseFormDate(ans(/^event date/i));
    line('Event', [ev ? shortDate(ev) : '', type].filter(Boolean).join(' · '), 'data-booked-event');
    line('Where', ans(/^location|where is it/i), 'data-booked-where');
    if (gLine) { ans(/how many guests/i); ans(/source the food/i); }
  }
  const calDate = (sched && sched.date) || ((bookings || []).map((b) => b.date).filter(Boolean).sort()[0]) || '';
  const cal = calDate ? `<p class="gl"><a class="glink" href="/admin/day/${esc(calDate)}" data-see-cal${tip('card.seeCal')}>See it on the calendar</a></p>` : '';
  const clLine = cl && cl !== 'none' ? `<p class="gl muted" data-checklist-state>Checklist ${cl === 'done' ? 'done ✓' : 'started'}</p>` : '';
  return { used, html: `<div data-booked>${lines.join('')}${gLine}${row}${clLine}${cal}</div>` };
}

// "How do they get the games?" (Step 1, rentals; the reverse prompt uses the same form).
const FEE_DOLLARS = Number((SERVICES_DATA.invoiceQuickAdds || {}).deliveryFee || 0);
export function deliveryForm(r, rk, { prompt = false, place = 'Mt. Moriah Station', idp = 'dl' } = {}) {
  const addr = deliveryAddress(r);
  const on = prompt || Boolean(addr);
  const id = (k) => `${idp}${k}-${esc(rk)}`;
  return `<form class="dlform" method="post" action="/admin/requests/delivery" data-delivery-form>${hiddenInputs({ r: rk })}
    <p class="dlq"><strong>How do they get the games?</strong></p>
    <label class="choice"><input type="radio" name="how" value="pickup"${on ? '' : ' checked'} data-how="pickup"> <span>They pick up at ${esc(place || 'Mt. Moriah Station')}</span></label>
    <label class="choice"><input type="radio" name="how" value="delivery"${on ? ' checked' : ''} data-how="delivery"> <span><b>Business delivery</b>${FEE_DOLLARS ? ` (+$${FEE_DOLLARS} on the invoice)` : ''}</span></label>
    <div class="dlfields" data-delivery-fields><label for="${id('n')}">Business name</label><input id="${id('n')}" name="delivery_name" value="${esc(answerOf(r, /^business name$/i))}" autocomplete="off">
    <label for="${id('a')}">Delivery address</label><input id="${id('a')}" name="delivery_address" value="${esc(addr)}" autocomplete="off"></div>
    <div class="act"><button class="btn ghost" type="submit"${tip('step.deliverySave')}>Save</button></div></form>`;
}

function filterChips(filter, base = '/admin/') {
  return `<nav class="filters" aria-label="Show only" data-filters>${FILTERS.map(([k, label]) => `<a href="${base}${k === 'all' ? '' : `?f=${k}`}"${k === filter ? ' aria-current="true"' : ''} data-filter="${k}"${tip('req.filter')}>${esc(label)}</a>`).join('')}</nav>`;
}

export function requestsPanel(folderUrl) {
  const b = (href, label, key, extra = '') => `<a class="btn ghost" href="${esc(href)}"${extra}${tip(key)}>${esc(label)}</a>`;
  return stepsPanel('requests', [
    [b('/admin/?fresh=1', 'Check for new requests', 'sub.refresh'), b('/admin/search', 'Find a customer', 'sub.find')],
    [b('/admin/invoices/new', 'Start a blank invoice', 'sub.blankInvoice'), b('/admin/checklist', 'Print a blank checklist', 'sub.blankChecklist', ' target="_blank" rel="noopener"')],
    [b('/admin/day/today', "Today's list", 'sub.today'), b('/admin/calendar', 'Calendar & Bookings', 'nav.calendar')],
  ], [
    `<a href="${esc(SHEET_URL)}" target="_blank" rel="noopener noreferrer"${tip('req.sheet')}>Open responses sheet</a> <a href="${esc(folderUrl)}" target="_blank" rel="noopener noreferrer"${tip('req.idFolder')}>Open ID folder</a>`,
    `<a href="/admin/packages"${tip('sub.packages')}>Porch packages</a>`,
    '',
  ]);
}

// schedule: { [request_key]: { date } } earliest booking per request; kinds: { [request_key]: [kind] }.
export function dashboardPage({ newKeys = new Set(), remindersLine = '', requests, statuses, checklists = {}, invoices = {}, schedule = {}, returns = {}, folderUrl, sheetError, flash, error = '', missingPayment = [], putAway = '', extraTop = '', referrers = {}, weekBox: week = '', idsBox = '', cardExtras = {}, holdsBox = '',
  cardMsgs = {}, cardBottom = {}, tdSaved = null, bookings = {}, takedownInvoices = new Set(), today = chicagoToday(), archived = [], filter = 'all', openPutAway = false, kinds = {}, events = {}, notes = {}, foodPerHead = null, pickupPlace = 'Mt. Moriah Station',
  stored = {}, depositOut = {}, holds = {}, holdHtml = {}, missedBy = {}, missedTop = '' }) {
  const err = sheetError ? `<div class="notice err"><strong>The requests could not be loaded right now.</strong> ${/not shared/i.test(sheetError)
    ? `The responses sheet needs to be shared with the site. In Google Sheets tap Share and add <code>${esc(SA_EMAIL)}</code> as a Viewer.`
    : 'Please try again in a minute.'}<div class="muted" style="margin-top:6px;font-size:.95rem">Details: ${esc(sheetError)}</div></div>` : '';
  const f = FILTERS.some(([k]) => k === filter) ? filter : 'all';
  const one = (r, isArchived) => {
    const st = statuses[r.key] || { status: 'new' };
    const inv = st.invoice_id ? invoices[st.invoice_id] : null;
    return { r, inv, services: servicesOf(r), html: () => requestCard(r, { st, inv, sched: schedule[r.key], ret: returns[r.key], cl: checklists[r.key], kinds: kinds[r.key] || [], extras: cardExtras[r.key] || '', referrers, events: events[r.key] || [], notes: notes[r.key] || [], archived: isArchived, foodPerHead, pickupPlace, bookings: bookings[r.key] || [], today, msgs: cardMsgs[r.key] || null, invoiceTakedown: Boolean(st.invoice_id && takedownInvoices.has(st.invoice_id)), bottom: cardBottom[r.key] || '', tdSaved: tdSaved && tdSaved.key === r.key ? tdSaved.words : '', isNew: !isArchived && newKeys.has(r.key),
      stored: stored[r.key] || null, depositOut: inv ? depositOut[inv.id] || null : null, hold: holds[r.key] || null, holdHtml: holdHtml[r.key] || '', missed: isArchived ? [] : (missedBy[r.key] || []) }) };
  };
  const shown = requests.map((r) => one(r, false)).filter((x) => matchesFilter(f, x));
  const putRows = archived.map((r) => one(r, true)).filter((x) => matchesFilter(f, x));
  const empty = f === 'all'
    ? '<div class="card"><p style="margin:0">No requests waiting. New ones from the website form show up here within a minute. Finished ones are in Put away at the bottom.</p></div>'
    : '<div class="card"><p style="margin:0">Nothing here for this filter. Tap All to see every request.</p></div>';
  const putSection = `<section class="putaway" id="put-away-section" data-put-away><h2>Put away (${putRows.length})</h2>
    <details class="disclose" id="put-away"${openPutAway ? ' open' : ''}><summary${tip('pa.show')}>Show put-away requests</summary>
      ${putRows.length ? putRows.map((x) => x.html()).join('') : '<p class="muted">Nothing put away yet. Tap <strong>Done — put away</strong> on a finished request to move it here.</p>'}
    </details></section>`;
  // Phone first (owner, 19 Oct 2026): the request list comes straight after the heading and the
  // one-line week card; tomorrow's reminders are one tappable line at the bottom; the three-step
  // panel sits under the list on a phone and stays on top on a wide screen (CSS order, .rqflow).
  return layout('Requests', `<style>${CARD_CSS}${NEW_CSS}${STEP_CSS}${MISSED_CSS}</style>${missedTop}${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}
${setupBanner(missingPayment)}
    <div class="rqflow"><div class="rqpanel">${requestsPanel(folderUrl)}</div>
    <div class="rqmain"><h1>Requests</h1>${extraTop}${week}${holdsBox}${err}
    ${filterChips(f)}
    <div data-request-list>${shown.length ? shown.map((x) => x.html()).join('') : (sheetError ? '' : empty)}</div>
    ${remindersLine}</div></div>
    ${putSection}
    ${idsBox}
    <template id="undo-tpl">${undoBanner('')}</template>
    <div class="undo-slot" id="undo-slot" aria-live="polite">${putAway ? undoBanner(putAway) : ''}</div>
    <script>${DASH_JS}${NEW_JS}if(location.hash==='#put-away'){var pa=document.getElementById('put-away');if(pa)pa.open=true;}</script>`, { screen: '', panelWide: true });
}

export function invoicesPage({ invoices }) {
  const rows = invoices.map((i) => `<tr><td><a href="/admin/invoices/${i.id}"${tip('inv.row')}><strong>${esc(i.customer_name || 'No name')}</strong></a><div class="muted">${esc(i.number)}</div></td>
    <td>${chip(i.status)}</td><td class="right">${money(i.total_cents)}</td></tr>`).join('');
  return layout('Invoices', `<h1>Invoices</h1>
    ${invoices.length ? `<div class="card"><table class="list">${rows}</table></div>` : '<div class="card"><p style="margin:0">No invoices yet. Tap <strong>Create invoice</strong> on a request to make one.</p></div>'}
    ${act(`<a class="btn ghost" href="/admin/invoices/new"${tip('sub.blankInvoice')}>Start a blank invoice</a>`, 'sub.blankInvoice')}`, { screen: 'invoices', back: BACK_REQUESTS });
}

export function lineEditor(line) {
  return `<div class="line" data-line>
    <div class="grid">
      <div class="full"><label>What it is</label><input name="line_desc" value="${esc(line.description)}"></div>
      <div><label>How many</label><input name="line_qty" type="number" step="any" min="0" inputmode="decimal" value="${esc(line.qty)}" data-qty></div>
      <div><label>Price each ($)</label><input name="line_price" type="number" step="0.01" inputmode="decimal" value="${esc((line.unit_cents / 100).toFixed(2))}" data-price></div>
      <div class="full"><label>Given back after the event?</label><select name="line_refundable"><option value="0"${line.refundable ? '' : ' selected'}>No</option><option value="1"${line.refundable ? ' selected' : ''}>Yes, it is a refundable deposit</option></select></div>
      <div class="full"><label>Note on this line (optional)</label><input name="line_note" value="${esc(line.note)}"></div>
    </div>
    <div style="margin-top:10px"><button type="button" class="btn danger" data-remove${tip('ed.removeLine')}>Remove this line</button></div>
  </div>`;
}

// The invoice editor (owner, 19 Oct 2026: "calm and light, especially on a phone"). Each line is
// ONE compact row (what · how many × price · line total); tap it to change it right there. The
// quick-adds are one row of chips. One summary at the bottom (total, due now, the rest and by
// when), ONE big "Send invoice"; Save draft and See it before sending are small. Every ability
// stays: add / remove / change any line, the refundable flag, the line note, the customer, the
// pay plan, the due date and the message to the customer.
const EDITOR_JS = `
(function(){
  var form=document.getElementById('inv');if(!form)return;
  var list=form.querySelector('[data-lines]'),tpl=document.getElementById('line-tpl'),dep=form.querySelector('[name=deposit]');
  function plan(){var r=form.querySelector('[name=pay_plan]:checked');return r?r.value:'half';}
  function txt(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  function show(id,on){var el=document.getElementById(id);if(el)el.hidden=!on;}
  function fmt(c){return (c<0?'-':'')+'$'+(Math.abs(c)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function recalc(){var t=0,missing=[];list.querySelectorAll('[data-line]').forEach(function(el){var d=el.querySelector('[name=line_desc]').value.trim(),q=parseFloat(el.querySelector('[data-qty]').value)||0,p=Math.round((parseFloat(el.querySelector('[data-price]').value)||0)*100),lt=Math.round(q*p),r=el.querySelector('[name=line_refundable]').value==='1',free=el.querySelector('[name=line_note]').value==='free';
      var sd=el.querySelector('[data-l-desc]'),sq=el.querySelector('[data-l-qty]'),st=el.querySelector('[data-l-total]');
      if(sd)sd.textContent=d||'New line: tap to fill in';if(sq)sq.textContent=(q!==1?q+' × '+fmt(p):'')+(r?(q!==1?' · ':'')+'given back':'');
      if(st){st.textContent=!d?'':(lt===0?(free?'Free':'Price needed'):fmt(lt));st.classList.toggle('need',Boolean(d)&&lt===0&&!free);}
      if(!d)return;t+=lt;if(lt===0&&!free)missing.push(d);});
    var pn=document.getElementById('price-needed');if(pn){pn.hidden=!missing.length;pn.querySelector('span').textContent=missing.join(', ');}
    var p=plan();show('custom-wrap',p==='custom');
    var dc=p==='full'?t:(p==='custom'?Math.min(t,Math.round((parseFloat(dep&&dep.value)||0)*100)):Math.round(t/2));
    if(p!=='custom'&&dep)dep.value=(dc/100).toFixed(2);
    txt('sum-total',fmt(t));txt('sum-deposit',fmt(dc));txt('sum-rest',fmt(t-dc));
    show('sum-rest-row',p!=='full');txt('sum-now-label',p==='full'?'Due now (all of it)':(p==='half'?'Due now (half)':'Due now (deposit)'));
    txt('sum-due-label',p==='full'?'Pay by':'The rest by');
    var due=form.querySelector('[name=due_date]').value;txt('sum-due',due?new Date(due+'T12:00:00Z').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}):'');}
  form.addEventListener('input',recalc);
  form.addEventListener('change',recalc);
  form.addEventListener('click',function(e){if(e.target.matches('[data-remove]')){e.target.closest('[data-line]').remove();recalc();}});
  function addLine(desc,price,o){o=o||{};list.insertAdjacentHTML('beforeend',tpl.innerHTML);var el=list.lastElementChild;el.querySelector('[name=line_desc]').value=desc||'';
    var pr=el.querySelector('[data-price]');pr.value=(price!==null&&price!==undefined)?price:'';if(o.discount){el.setAttribute('data-discount','');pr.placeholder='Amount off, e.g. 20';}
    if(o.refundable)el.querySelector('[name=line_refundable]').value='1';if(o.note)el.querySelector('[name=line_note]').value=o.note;
    el.open=(price===null||price===undefined||!desc);recalc();if(el.open)(desc?pr:el.querySelector('[name=line_desc]')).focus();return el;}
  document.getElementById('add-line').addEventListener('click',function(){addLine('',null);});
  form.addEventListener('click',function(e){var q=e.target.closest('[data-quick]');if(!q)return;
    if(q.hasAttribute('data-q-game')){var sel=form.querySelector('[data-quick-game-pick]'),opt=sel&&sel.options[sel.selectedIndex];if(!opt||opt.disabled)return;var name=opt.value,comp=form.querySelector('[data-quick-comp]').checked;
      var n=Number(q.getAttribute('data-base'))+[].slice.call(list.querySelectorAll('[name=line_desc]')).filter(function(i){return /^Extra game: /.test(i.value);}).length+1;
      addLine('Extra game: '+name,comp?'0.00':q.getAttribute('data-price'),{note:comp?'free':''});
      if(comp){var nt=form.querySelector('[name=notes]'),ord=['','1st','2nd','3rd'][n]||(n+'th'),line='Complimentary '+ord+' game: '+name;nt.value=nt.value?nt.value.replace(/\\s*$/,'')+'\\n'+line:line;var nd=nt.closest('details');if(nd)nd.open=true;}
      opt.disabled=true;opt.textContent=name+' (added)';q.closest('details').open=false;recalc();return;}
    addLine(q.getAttribute('data-desc'),q.hasAttribute('data-price')?q.getAttribute('data-price'):null,{discount:q.hasAttribute('data-discount'),refundable:q.hasAttribute('data-refundable')});});
  form.addEventListener('change',function(e){var l=e.target.closest('[data-discount]');if(l&&e.target.matches('[data-price]')){var v=parseFloat(e.target.value);if(v>0){e.target.value=(-v).toFixed(2);recalc();}}},true);
  form.addEventListener('submit',function(e){var b=e.submitter||document.activeElement;if(b&&b.name==='go'&&b.value==='send'){
    var pn=document.getElementById('price-needed');if(pn&&!pn.hidden){e.preventDefault();pn.scrollIntoView({behavior:'smooth'});
      var first=[].slice.call(list.querySelectorAll('[data-line]')).find(function(el){return el.querySelector('[name=line_desc]').value.trim()&&!(parseFloat(el.querySelector('[data-price]').value)>0)&&el.querySelector('[name=line_note]').value!=='free'&&!el.hasAttribute('data-discount');});if(first){first.open=true;first.querySelector('[data-price]').focus();}return;}
    b.disabled=true;b.textContent='Sending…';
    var h=document.createElement('input');h.type='hidden';h.name='go';h.value='send';form.appendChild(h);}});
  recalc();
})();`;

// "Text the invoice (PDF)": on a phone this opens the share sheet with the PDF and the
// message (Messages, WhatsApp, Mail...). Where sharing files is not possible it downloads.
const SHARE_JS = `
(function(){
  document.addEventListener('click',async function(e){
    var b=e.target.closest('[data-share-pdf]');
    if(b){e.preventDefault();var url=b.getAttribute('data-share-pdf'),name=b.getAttribute('data-name'),text=b.getAttribute('data-text'),was=b.textContent;b.disabled=true;b.textContent='Getting the PDF...';
      try{var r=await fetch(url,{credentials:'same-origin'});if(!r.ok)throw new Error('pdf');var f=new File([await r.blob()],name,{type:'application/pdf'});
        if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:name,text:text});}
        else{var a=document.createElement('a');a.href=URL.createObjectURL(f);a.download=name;document.body.appendChild(a);a.click();a.remove();}
      }catch(err){if(!(err&&err.name==='AbortError'))location.href=url+'?dl=1';}
      b.disabled=false;b.textContent=was;return;}
    var c=e.target.closest('[data-copy]');
    if(c){var t=document.getElementById(c.getAttribute('data-copy'));try{await navigator.clipboard.writeText(t.value);c.textContent='Copied';setTimeout(function(){c.textContent='Copy the message';},1500);}catch(err){t.select();}}
  });
})();`;

function paymentWarning(pay) {
  if (pay.complete) return '';
  return `<div class="notice warn"><strong>Payment details are missing.</strong> Add your ${esc(pay.missing.join(', ').replace(/, ([^,]*)$/, ' and $1'))} in Settings before sending, so the customer knows how to pay. If you send now, the email says "Payment details coming".
    <div style="margin-top:10px"><a class="btn inline ghost" href="/admin/settings"${tip('settings.open')}>Open Settings</a></div></div>`;
}

// One screen: the prefilled invoice as the customer will see it, and ONE button that sends it.
// Changing anything is possible (under "Change what goes into the total") but never required.
// One invoice line as a compact row: tap to open its fields in place.
export function lineRow(line, { open = false } = {}) {
  const cents = Math.round(Number(line.qty || 0) * Number(line.unit_cents || 0));
  const need = line.description && needsPrice(line);
  // The small second line only says what the total does not: how many, and "given back".
  const sum = line.description && (Number(line.qty) !== 1 || line.refundable) ? `${Number(line.qty) !== 1 ? `${esc(line.qty)} × ${money(line.unit_cents)}` : ''}${line.refundable ? `${Number(line.qty) !== 1 ? ' · ' : ''}given back` : ''}` : '';
  return `<details class="lrow" data-line${open || need || !line.description ? ' open' : ''}${/^discount\b/i.test(line.description || '') ? ' data-discount' : ''}>
    <summary class="lsum"${tip('ed.lineRow')}><span class="ld" data-l-desc>${esc(line.description || 'New line: tap to fill in')}</span><span class="lq" data-l-qty>${sum}</span><span class="lt${need ? ' need' : ''}" data-l-total>${line.description ? (cents === 0 ? (line.note === 'free' ? 'Free' : 'Price needed') : money(cents)) : ''}</span></summary>
    <div class="lgrid">
      <div class="full"><label>What it is</label><input name="line_desc" value="${esc(line.description)}"></div>
      <div><label>How many</label><input name="line_qty" type="number" step="any" min="0" inputmode="decimal" value="${esc(line.qty)}" data-qty></div>
      <div><label>Price each ($)</label><input name="line_price" type="number" step="0.01" inputmode="decimal" value="${esc((line.unit_cents / 100).toFixed(2))}" data-price></div>
      <div class="full"><label>Given back after the event?</label><select name="line_refundable"><option value="0"${line.refundable ? '' : ' selected'}>No</option><option value="1"${line.refundable ? ' selected' : ''}>Yes, it is a refundable deposit</option></select></div>
      <div class="full"><label>Note on this line (optional)</label><input name="line_note" value="${esc(line.note)}"></div>
      <div class="full"><button type="button" class="linkbtn danger" data-remove${tip('ed.removeLine')}>Remove this line</button></div>
    </div></details>`;
}

const EDITOR_CSS = `.ed .card{padding:14px}.ed h2{font-size:1.3rem;margin:0 0 8px}
.ed .who{display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline}.ed .who strong{font-size:1.15rem}.ed .who .muted{word-break:break-all}
.ed .who details{flex-basis:100%}.ed .who summary,.ed .note summary{color:var(--accent);font-weight:600;cursor:pointer;min-height:40px;display:inline-flex;align-items:center}
.lrow{border-bottom:1px solid var(--line)}.lrow:last-child{border-bottom:0}
.lsum{display:grid;grid-template-columns:1fr auto;gap:0 10px;padding:10px 2px;cursor:pointer;list-style:none;min-height:48px}.lsum::-webkit-details-marker{display:none}
.lsum .ld{font-weight:600;grid-column:1;overflow-wrap:anywhere}.lsum .lq{grid-column:1;color:var(--muted);font-size:.92rem}.lsum .lt{grid-column:2;grid-row:1 / span 2;align-self:center;font-weight:700;white-space:nowrap}
.lsum .lt.need{color:#8f3427}
.lrow[open] .lsum{background:var(--cream);border-radius:8px}
.lgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px 10px;padding:4px 2px 12px}.lgrid .full{grid-column:1 / -1}.lgrid label{font-size:.9rem;margin:0}.lgrid input,.lgrid select{margin:2px 0 0}
.qchips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.qchips .chipbtn,.qchips summary{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1.5px solid var(--accent);border-radius:999px;background:#fff;color:var(--accent);font:600 .98rem Inter,Arial,sans-serif;cursor:pointer;list-style:none;width:auto}
.qchips summary::-webkit-details-marker{display:none}.qchips details[open]{flex-basis:100%}.qchips details[open]>summary{background:var(--cream)}
.qgamebox{margin-top:8px;padding:10px 12px;border:1px solid var(--line);border-radius:10px}.qgamebox select{min-height:48px;font-size:1.05rem}
.plans.compact{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.plans.compact .plan{padding:8px;min-height:48px;text-align:center}.plans.compact small{display:none}
.ed .note textarea{min-height:80px}
.sumbox .row2{display:flex;justify-content:space-between;gap:10px;padding:4px 0}.sumbox .big{font-size:1.4rem;font-weight:700}.sumbox .now{color:var(--accent);font-weight:700}
.ed .linkbtn{background:none;border:0;padding:0 4px;color:var(--accent);font:600 1rem Inter,Arial,sans-serif;text-decoration:underline;cursor:pointer;min-height:44px}.ed .linkbtn.danger{color:#8f3427}
.ed .sendrow{display:grid;gap:8px;margin-top:6px}.ed .sendrow .small{display:flex;flex-wrap:wrap;gap:6px 14px;justify-content:center}`;

// The quick-add chips (owner-approved 19 Oct 2026): one tap adds a ready line; prices from
// data/offers/services.json invoiceQuickAdds (quickAddsFor in admin.mjs), never typed here.
// A line with no price opens itself with the cursor in its price. "+ Extra game" (rentals only)
// lists the games free for the whole pickup -> return span; booked ones cannot be picked.
function quickAdds(q) {
  const d = (c) => (c / 100).toFixed(2);
  const b = (key, label, attrs) => `<button type="button" class="chipbtn" data-quick ${attrs}${tip(key)}>${esc(label)}</button>`;
  const add = `<button type="button" class="chipbtn" id="add-line"${tip('ed.addLine')}>+ Line</button>`;
  if (!q) return `<div class="qchips" data-quick-adds>${add}</div>`;
  const games = q.rental ? `<details class="qgame" data-quick-game><summary${tip('ed.qExtraGame')}>+ Extra game</summary><div class="qgamebox">
      ${q.games.length ? `<p class="muted" style="margin:0 0 6px">Free for the whole rental${q.span ? ` (${esc(q.span)})` : ''}. Booked ones cannot be picked.</p>
      <label for="qg">Which game</label><select id="qg" data-quick-game-pick${tip('ed.qGamePick')}>${q.games.map((g) => `<option value="${esc(g.name)}"${g.free ? '' : ' disabled'}>${esc(g.name)}${g.mine ? ' (already in this rental)' : (g.free ? '' : ' (booked those days)')}</option>`).join('')}</select>
      <label class="choice" style="display:flex;gap:10px;align-items:center;margin-top:8px"><input type="checkbox" data-quick-comp style="width:24px;height:24px"${tip('ed.qComp')}> Complimentary (no charge)</label>
      <div style="margin-top:8px">${b('ed.qAddGame', 'Add this game', `data-q-game data-price="${d(q.extraGameCents)}" data-base="${Number(q.baseCount) || 0}"`)}</div>`
    : '<p class="muted" style="margin:0">Book the pickup and return days first: then the free games show here.</p>'}</div></details>` : '';
  return `<div class="qchips" data-quick-adds>${add}
      ${b('ed.qDelivery', '+ Delivery fee', `data-desc="Delivery fee" data-price="${d(q.deliveryCents)}"`)}
      ${b('ed.qDiscount', '+ Discount', 'data-desc="Discount" data-discount')}
      ${b('ed.qSetupFee', '+ Setup / takedown fee', 'data-desc="Setup / takedown fee"')}
      ${b('ed.qDamage', '+ Damage deposit', 'data-desc="Damage deposit (refundable)" data-refundable')}
      ${games}</div>`;
}

export function invoiceEditorPage({ invoice, lines, request, action, title, warnings = [], pay, mode = 'new', backHref = '/admin/', quick = null }) {
  const blank = { description: '', qty: 1, unit_cents: 0, note: '', refundable: 0 };
  const total = invoiceTotal(lines);
  const plan = invoice.pay_plan || 'half';
  const priceNeeded = lines.filter((l) => l.description && needsPrice(l));
  return layout(title, `<style>${EDITOR_CSS}</style><h1>${esc(title)}</h1>
  ${pay ? paymentWarning(pay) : ''}
  ${warnings.map((w) => `<div class="notice warn">${esc(w)}</div>`).join('')}
  <form id="inv" class="ed" method="post" action="${esc(action)}">
    ${request ? `<input type="hidden" name="r" value="${esc(b64urlText(request.key))}">` : ''}
    <section class="card who" data-ed-who><span class="muted">For</span> <strong>${esc(invoice.customer_name || 'No name yet')}</strong> <span class="muted">${esc(invoice.customer_email || 'no email: text them the PDF after saving')}</span>
      <details><summary${tip('ed.change')}>Change name, email or phone</summary>
        <label for="cn">Customer name</label><input id="cn" name="customer_name" value="${esc(invoice.customer_name)}">
        <label for="ce">Customer email (leave blank if you only text them)</label><input id="ce" name="customer_email" type="email" value="${esc(invoice.customer_email)}">
        <label for="cp">Customer phone</label><input id="cp" name="customer_phone" type="tel" value="${esc(invoice.customer_phone)}"></details></section>
    <section class="card" data-ed-lines><h2>What goes into the total</h2>
      <div data-lines>${lines.map((l) => lineRow(l)).join('')}</div>
      <template id="line-tpl">${lineRow(blank, { open: true })}</template>
      ${quickAdds(quick)}
      <p style="margin:10px 0 0;font-size:.95rem"><a href="/admin/packages" target="_blank" rel="noopener"${tip('ed.packages')}>See the porch packages</a></p></section>
    <section class="card" data-ed-plan><h2>How they pay</h2>
      <div class="plans compact">${[['half', 'Half now'], ['full', 'All now'], ['custom', 'Other deposit']].map(([v, big]) => `<label class="plan"><input type="radio" name="pay_plan" value="${v}"${plan === v ? ' checked' : ''}><span><strong>${big}</strong></span></label>`).join('')}</div>
      <div id="custom-wrap"${plan === 'custom' ? '' : ' hidden'}><label for="dep">Deposit to ask for now ($)</label><input id="dep" name="deposit" type="number" step="0.01" inputmode="decimal" value="${esc((invoice.deposit_due_cents / 100).toFixed(2))}"></div>
      <label for="dd">Due date</label><input id="dd" name="due_date" type="date" value="${esc(invoice.due_date)}">
      <input type="hidden" name="issue_date" value="${esc(invoice.issue_date)}"></section>
    <details class="card note"${invoice.notes ? ' open' : ''}><summary${tip('ed.note')}>Message to the customer (optional)</summary><textarea id="nt" name="notes" aria-label="Message to the customer">${esc(invoice.notes)}</textarea></details>
    <section class="card sumbox" data-ed-summary>
      <div class="notice err" id="price-needed"${priceNeeded.length ? '' : ' hidden'}><strong>Add a price first:</strong> <span>${esc(priceNeeded.map((l) => l.description).join(', '))}</span>. Tap the line, type the price, then send.</div>
      <div class="row2"><span>Total</span><span class="big" id="sum-total">${money(total)}</span></div>
      <div class="row2" id="sum-now-row"><span id="sum-now-label">Due now</span><span class="now" id="sum-deposit">${money(invoice.deposit_due_cents)}</span></div>
      <div class="row2" id="sum-rest-row"><span>Rest after that</span><strong id="sum-rest">${money(total - invoice.deposit_due_cents)}</strong></div>
      <div class="row2"><span id="sum-due-label">The rest by</span><strong id="sum-due">${esc(prettyDate(invoice.due_date))}</strong></div></section>
    <div class="sendrow">${act(`<button class="btn primary" type="submit" name="go" value="send"${tip('ed.sendNow')}>Send invoice</button>`, 'ed.sendNow')}
      <div class="small"><button class="linkbtn" type="submit" name="go" value="save"${tip('ed.saveOnly')}>Save draft</button><button class="linkbtn" type="submit" name="go" value="preview"${tip('ed.preview')}>See it before sending</button></div></div>
  </form>
  <script>${EDITOR_JS}</script>`, { screen: 'invoiceEdit', back: { href: backHref, label: 'Back' } });
}

export function invoiceViewPage({ invoice, lines, pay, flash, error, emailHtml = '', smsText = '', pickup = '', balance = null }) {
  const total = invoiceTotal(lines);
  const plan = payPlanOf(invoice, total);
  const now = plan === 'full' ? total : invoice.deposit_due_cents;
  const id = invoice.id;
  const who = firstName(invoice.customer_name);
  const status = (action, label, key, cls = 'ghost') => `<form method="post" action="/admin/invoices/${id}/status"><input type="hidden" name="action" value="${action}"><button class="btn ${cls}" type="submit"${tip(key)}>${label}</button></form>`;
  const sendForm = (label, cls, key, test = false) => `<form method="post" action="/admin/invoices/${id}/send">${test ? '<input type="hidden" name="test" value="1">' : ''}<button class="btn ${cls}" type="submit"${tip(key)}>${label}</button></form>`;
  const voided = invoice.status === 'void';
  const hasEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(invoice.customer_email || '');
  const pdfUrl = `/admin/invoices/${id}/invoice.pdf`;
  const pdfName = `Porch-and-Party-Invoice-${invoice.number}.pdf`;
  const textBtn = (cls) => `<button type="button" class="btn ${cls}" data-share-pdf="${pdfUrl}" data-name="${esc(pdfName)}" data-text="${esc(smsText)}"${tip('iv.text')}>Text the invoice (PDF)</button>`;
  let main = '';
  if (voided) main = '';
  else if (invoice.status === 'draft' && !hasEmail) main = `<p class="muted" style="margin:0 0 8px">No email on this invoice, so send the PDF by text. Then tap Mark as sent.</p><div class="actions">${act(textBtn('primary'), 'iv.text')}${act(status('texted', 'Mark as sent by text', 'iv.texted'), 'iv.texted')}</div>`;
  else if (invoice.status === 'draft') main = `<div class="actions">${act(sendForm(`Send invoice to ${esc(who)}`, 'primary', 'iv.send'), 'iv.send')}${act(textBtn('ghost'), 'iv.text')}${act(status('texted', 'Mark as sent by text', 'iv.texted'), 'iv.texted')}</div>`;
  else main = `<div class="actions">${act(sendForm('Resend', 'ghost', 'iv.resend'), 'iv.resend')}${act(textBtn('ghost'), 'iv.text')}</div>`;
  const payment = paymentBox({ who: invoice.customer_name || 'this customer', status: invoice.status, plan, rest: balance ? balance.remaining : total - now, number: invoice.number,
    balanceLine: balance && !balance.void ? esc([balance.owed > 0 ? dueWords(balance) : 'Paid in full ✓', balance.paid ? `${money(balance.paid)} received` : '', balance.refundable ? `Damage deposit ${money(balance.refundable)}, refundable` : ''].filter(Boolean).join(' · ')) : '',
    target: { action: `/admin/invoices/${id}/status`, field: 'action', extra: {} } });
  const preview = emailHtml && !voided ? `<div class="card" style="padding:0;overflow:hidden"><div class="muted" style="padding:10px 14px;border-bottom:1px solid var(--line)">The email the customer gets</div>
    <iframe class="emailframe" title="Invoice email" srcdoc="${esc(emailHtml)}" onload="try{this.style.height=(this.contentDocument.documentElement.scrollHeight+24)+'px'}catch(e){}"></iframe></div>` : '';
  return layout(invoice.customer_name || invoice.number, `<div class="spread"><h1 style="margin:0">${esc(invoice.customer_name || 'Invoice')}</h1>${chip(invoice.status)}</div>
  <p class="muted" style="margin-top:4px">Invoice ${esc(invoice.number)}${invoice.sent_at ? ` · last sent ${esc(prettyDate(invoice.sent_at.slice(0, 10)))}` : ' · not sent yet'}</p>
  ${voided ? '<div class="stamp" data-void-stamp aria-label="This invoice is void">VOID</div><div class="notice warn">This invoice is void. It cannot be sent or marked paid, and it is off the calendar. It keeps its number.</div>' : ''}
  ${flash ? `<div class="notice ok" style="font-size:1.1rem"><strong>${esc(flash)}</strong></div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}
  ${!voided && invoice.status === 'draft' ? paymentWarning(pay) : ''}
  <div class="card"><table class="sumlines">
    ${lines.map((l) => `<tr><td>${esc(l.description)}${Number(l.qty) !== 1 ? ` × ${esc(l.qty)}` : ''}${l.refundable ? '<div class="muted">Given back after the event</div>' : ''}</td><td class="amt">${needsPrice(l) ? '<strong style="color:#8f3427">Price needed</strong>' : (lineTotal(l) === 0 ? 'Free' : money(lineTotal(l)))}</td></tr>`).join('')}
  </table>
    <div class="calc">
      <div class="spread"><span>Total</span><span class="bigtotal">${money(total)}</span></div>
      ${plan === 'full' ? `<div class="spread"><span>Full amount due by</span><strong>${esc(prettyDate(invoice.due_date))}</strong></div>`
    : `<div class="spread"><span>Deposit asked for now${plan === 'half' ? ' (half)' : ''}</span><strong class="now">${money(now)}</strong></div>
      <div class="spread"><span>Rest after the deposit</span><strong>${money(total - now)}</strong></div>
      <div class="spread"><span>Rest due by</span><strong>${esc(prettyDate(invoice.due_date))}</strong></div>`}
      ${pickup ? `<p class="muted" style="margin:8px 0 0" data-pickup-line>${esc(pickup)}</p>` : ''}
    </div>
  </div>
  ${invoice.status === 'draft' ? preview : ''}
  ${main}
  ${payment}
  ${depositBox(invoice, balance)}
  ${invoice.status !== 'draft' ? preview : ''}
  <details class="disclose"><summary${tip('iv.more')}>More options</summary>
    <div class="actions">
      ${voided ? '' : `<a class="btn ghost" href="/admin/invoices/${id}/edit"${tip('iv.edit')}>Change the invoice</a>`}
      <a class="btn ghost" href="/admin/invoices/${id}/preview" target="_blank" rel="noopener"${tip('iv.seeEmail')}>See the email</a>
      <a class="btn ghost" href="${pdfUrl}?dl=1" download="${esc(pdfName)}"${tip('iv.downloadPdf')}>Download the PDF</a>
      <a class="btn ghost" href="${pdfUrl}" target="_blank" rel="noopener"${tip('iv.openPdf')}>Open the PDF</a>
      ${voided ? '' : sendForm('Send a test copy to hello@porchandparty901.com', 'ghost', 'iv.test', true)}
      ${voided || invoice.status === 'done' ? '' : status('done', 'Job finished (mark done)', 'iv.done')}
    </div>
    <p class="muted">Email: ${esc(invoice.customer_email || 'none')}${invoice.customer_phone ? ` · Phone: ${esc(invoice.customer_phone)}` : ''}</p>
    <label for="sms">Text message to send with the PDF</label><textarea id="sms" readonly rows="4">${esc(smsText)}</textarea>
    <button type="button" class="btn ghost" data-copy="sms"${tip('iv.copySms')}>Copy the message</button>
  </details>
  <script>${SHARE_JS}</script>`, { screen: 'invoice', back: { href: '/admin/invoices', label: 'Back to invoices' } });
}

// Damage deposit after the event: refund it, or keep some for damage. Own rows, never "owed".
function depositBox(invoice, bal) {
  if (!bal || bal.void || !bal.refundable) return '';
  const collected = bal.refundable - bal.depositOwed;
  const held = Math.max(0, collected - (bal.refunded || 0) - (bal.kept || 0));
  const who = invoice.customer_name || 'the customer';
  const amount = (id) => `<label for="${id}">Amount ($)</label><input id="${id}" name="amount" inputmode="decimal" value="${esc((held / 100).toFixed(2))}">${methodPicker()}`;
  return `<section class="paybox" data-deposit-box><h3>Damage deposit</h3>
    <p class="words">Damage deposit ${esc(money(bal.refundable))}, refundable. ${collected ? `You hold ${esc(money(held))}.` : 'Not collected yet.'}${bal.refunded ? ` Refunded ${esc(money(bal.refunded))}.` : ''}${bal.kept ? ` Kept for damage ${esc(money(bal.kept))}.` : ''}</p>
    ${held > 0 ? `<div class="actions">
      ${confirmStep({ key: 'dep.refund', yesKey: 'dep.refundYes', label: 'Refund the damage deposit', question: `Record a damage-deposit refund to ${who}? Send the money yourself first; this only records it.`, action: `/admin/invoices/${invoice.id}/deposit`, hidden: hiddenInputs({ kind: 'refund' }), extra: amount(`ra-${invoice.id}`) })}
      ${confirmStep({ key: 'dep.keep', yesKey: 'dep.keepYes', label: 'Keep some for damage', question: `Keep part of ${who}'s damage deposit for damage? It counts as income on the Money tab.`, action: `/admin/invoices/${invoice.id}/deposit`, hidden: hiddenInputs({ kind: 'deposit_kept' }), extra: amount(`ka-${invoice.id}`) })}
    </div>` : ''}</section>`;
}

// ---- How to use this (/admin/help): printable, every button from the one map --------------
export function helpPage() {
  const tab = (name, screen, extra = '') => `<section class="card"><h2>${esc(name)}</h2><ol class="steps">${STEPS[screen].map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${extra}</section>`;
  return layout('How to use this', `<h1>How to use this</h1>
  <p class="noprint">${act(`<button type="button" class="btn ghost inline" onclick="window.print()"${tip('help.print')}>Print this page</button>`, 'help.print')}</p>
  ${tab('Requests', 'requests', '<p>Each request has a <strong>Payment</strong> box. Money buttons always ask "Are you sure?" first. When a job is over, tap <strong>Done — put away</strong>.</p>')}
  ${tab('Calendar', 'calendar', '<p>Bookings from invoices appear by themselves. A booking you make or change by hand keeps your date, even if the invoice is sent again.</p><p data-help-chips><strong>Filled = booked · Outlined = asked for, not booked yet.</strong> An outlined chip says <strong>Requested</strong> with the first name; tap it to open the request card. A held rental is filled and says <strong>Held</strong>.</p>')}
  <section class="card" data-help-takedown><h2>The takedown, on the card</h2><ol class="steps">
    <li>Every porch and party card has one line: <strong>Takedown:</strong> with a day, a time (optional) and <strong>Save</strong>. The day starts on the one the customer asked for.</li>
    <li>Tap <strong>Save</strong>: it is on the calendar. The card says <strong>Takedown on the calendar for Tue 20 Oct ✓</strong>. Or tap <strong>Not sure yet</strong> or <strong>Customer will handle it</strong>.</li>
    <li>When it is done, tap <strong>Mark takedown done</strong> on that line, any day. <strong>Change</strong> moves it, <strong>Remove</strong> takes it off.</li>
  </ol><p>A takedown date on the form is booked by itself. A grazing table has the same line for its optional pickup.</p></section>
  <section class="card" data-help-phone><h2>A booking that came by phone</h2><ol class="steps">
    <li>On <strong>Calendar</strong>, tap <strong>Add a booking</strong>. Pick the service: <strong>Porch</strong>, <strong>Party &amp; decor</strong>, <strong>Grazing</strong> or <strong>Game rentals</strong>.</li>
    <li>Type the day, their name and phone (their email if you have it), then tap <strong>Save booking</strong>. A rental books its pickup and its return together.</li>
    <li>It is on the calendar and on <strong>Requests</strong> as a normal card with a <strong>From a phone call</strong> chip: steps, invoice, Edit and Not paid yet all work.</li>
  </ol><p>A phone booking has no ID or rules step (the card says <strong>ID: not collected (phone booking)</strong>; you can add their ID photo later), no hold and no automatic confirmation email. The thank-you and the day-before reminder still go out when there is an email on file. For a block with no customer, pick <strong>Just a calendar note (no customer)</strong>: it never reaches Requests.</p>
    <p>A rental card says how long from the booked days: <strong>pickup Sun 18 Oct, back Tue 20 Oct (2 days)</strong>. On a phone the month shows as a list of days.</p></section>
  <section class="card" data-help-inventory><h2>Your rental items (Inventory, in Settings)</h2><ol class="steps">
    <li>Open <strong>Settings</strong> and tap <strong>Inventory: your rental items</strong> (or <strong>Change the items</strong> under the games grid on a Day sheet).</li>
    <li>Tap <strong>Add an item</strong>, or <strong>Edit</strong> on one. Type the name, how many you have and the price, add a photo and check its description, then tap <strong>Save</strong>.</li>
    <li>The admin and the booking form use it straight away. The box at the top says <strong>Website updating…</strong>, then <strong>Live ✓</strong> about 5 minutes later.</li>
  </ol><p><strong>Remove</strong> takes an item off the website, the booking form and the booking picker; bookings and invoices that have it keep it, and <strong>Bring back</strong> puts it back. Whole Yard and The Whole Party always include every game on the website. Switch <strong>Show on website</strong> off for something only you track, like the projector.</p></section>
  ${tab('Money', 'money', '<p>Tap any total to see the payments or jobs behind it. Damage deposits are never counted as income. Your Bookings tab in the request sheet updates by itself.</p>')}
  ${tab('Put away', 'archive')}
  ${tab('Invoice', 'invoice')}
  ${tab('Settings', 'settings')}
  <section class="card"><h2>Put the bookings in your Google Calendar (one time, on a computer)</h2><ol class="steps">
    <li>In this console, open <strong>Calendar</strong>, then <strong>Link my Google Calendar</strong>, and tap <strong>Copy link</strong>.</li>
    <li>On a computer, go to <strong>calendar.google.com</strong> and sign in as valeriektaylor13@gmail.com.</li>
    <li>On the left, next to <strong>Other calendars</strong>, click the <strong>+</strong>, then <strong>From URL</strong>.</li>
    <li>Paste the link into the box and click <strong>Add calendar</strong>. It now shows on your phone too.</li>
  </ol><p>Google refreshes linked calendars on its own schedule, which can take several hours. A brand-new booking is always on the admin <strong>Calendar</strong> tab straight away.</p></section>
  <section class="card" data-status-meanings><h2>What each status means</h2><table class="sumlines">${STATUS_MEANINGS.map(([k, v], i) => `<tr><td><strong>${i < 6 ? `${i + 1}. ` : ''}${esc(k)}</strong></td><td>${esc(v)}</td></tr>`).join('')}</table>
    <p style="margin-bottom:0">Payment and the job are tracked separately, so a card can say <strong>Scheduled</strong> and <strong>Paid in full ✓</strong> at the same time. It is <strong>Finished</strong> when the job is done and it is paid in full.</p></section>
  <h2 style="margin-top:22px">Every button, screen by screen</h2>
  ${helpGlossary()}`, { screen: 'help', back: BACK_REQUESTS });
}

// Settings, calm layout (owner, 19 Oct 2026): short plainly named sections, each opening with one
// sentence saying what it is for; folded on a phone (open on a computer); every form, field and
// button that was here is still here, saving the same way.
const SET_CSS = `
details.set-sec{background:var(--card);border:1px solid var(--line);border-radius:14px;margin:0 0 12px;padding:0 16px}
details.set-sec>summary{list-style:none;cursor:pointer;min-height:60px;display:flex;align-items:center;justify-content:space-between;gap:10px;font:600 1.35rem "Cormorant Garamond",Georgia,serif;color:var(--ink)}
details.set-sec>summary::-webkit-details-marker{display:none}
details.set-sec>summary::after{content:"+";font:600 1.5rem Inter,Arial,sans-serif;color:var(--accent)}details.set-sec[open]>summary::after{content:"\\2013"}
details.set-sec[open]{padding-bottom:16px}
.set-head{display:flex;flex-direction:column;gap:2px;padding:10px 0}.set-why{font:400 .98rem/1.4 Inter,Arial,sans-serif;color:var(--muted)}
details.set-sec[open] .set-why{margin-bottom:4px}
.set-sec h3{font-size:1.2rem;margin:16px 0 4px}
.set-sec form+form,.set-sec form+h3{margin-top:12px}
.set-row{display:flex;align-items:center;gap:10px;min-height:48px;color:var(--ink)}.set-row input{width:24px;height:24px;min-height:24px;flex:none}
`;
const SET_JS = `<script>(function(){var phone=window.matchMedia&&window.matchMedia('(max-width:700px)').matches;var h=location.hash.slice(1);
document.querySelectorAll('details.set-sec').forEach(function(d){if(phone&&d.id!==h&&!d.querySelector('#'+(h||'x')))d.open=false;});})();</script>`;
function setSec(id, title, why, body, open = true) {
  return `<details class="set-sec" id="${id}" data-set-sec="${id}"${open ? ' open' : ''}><summary${tip(id === 'password' ? 'set.password' : `set.sec.${id}`)}><span class="set-head"><span class="set-title">${esc(title)}</span><span class="set-why">${esc(why)}</span></span></summary>${body}</details>`;
}
// The Settings sections, in order (validate:admin-settings reads this list).
export const SETTINGS_SECTIONS = [
  ['pay', 'Your payment details'], ['emails', 'Emails & reminders'], ['inventory', 'Inventory'], ['gcal', 'Google Calendar link'],
  ['website', 'Website auto-update status'], ['sheet', 'Google Sheet'], ['categories', 'Expense categories'], ['password', 'Password'],
];

export function settingsPage({ settings, flash, error, hasQr, categories = [], pendingSync = 0, inventory = '', websiteStatus = '' }) {
  const T = Object.fromEntries(SETTINGS_SECTIONS);
  const pay = `<form method="post" action="/admin/settings" enctype="multipart/form-data">
    <label for="z">Zelle (the email or phone number people send Zelle to)</label><input id="z" name="zelle" value="${esc(settings.zelle || '')}" autocomplete="off">
    <label for="c">Cash App name (starts with $)</label><input id="c" name="cashapp" placeholder="$yourname" value="${esc(settings.cashapp || '')}" autocomplete="off" autocapitalize="off">
    <label for="q">Payment QR code (a photo or screenshot of it)</label>
    ${hasQr ? '<div style="margin:6px 0"><img src="/api/admin/qr.png" alt="Your QR code" width="160" height="160" style="border:1px solid var(--line);border-radius:10px"></div>' : '<div class="muted">No QR code yet.</div>'}
    <input id="q" name="qr" type="file" accept="image/png,image/jpeg">
    ${hasQr ? '<label class="set-row"><input type="checkbox" name="remove_qr" value="1"> Remove the QR code</label>' : ''}
    <details class="disclose"><summary${tip('set.business')}>Business name and address</summary>
      <label for="bn">Business name on invoices</label><input id="bn" name="business_name" value="${esc(settings.business_name || 'Porch & Party')}">
      <label for="ba">Address line on invoices</label><input id="ba" name="business_address" placeholder="Memphis, Tennessee" value="${esc(settings.business_address || '')}">
      <label for="f">Link to the Google Drive folder with ID photos (only if the button on Requests opens the wrong place)</label><input id="f" name="id_folder_url" value="${esc(settings.id_folder_url || '')}">
    </details>
    <input type="hidden" name="day_list_phone" value="${esc(settings.day_list_phone || '901-355-1518')}"><input type="hidden" name="day_list_email" value="${esc(settings.day_list_email || 'hello@porchandparty901.com')}">
    <div style="margin-top:16px">${act(`<button class="btn primary" type="submit"${tip('set.save')}>Save</button>`, 'set.save')}</div>
  </form>`;
  const emails = `<form method="post" action="/admin/settings" enctype="multipart/form-data" data-day-list>
    <h3>My day list and new-request emails</h3>
    ${['zelle', 'cashapp', 'business_name', 'business_address', 'id_folder_url'].map((k) => `<input type="hidden" name="${k}" value="${esc(settings[k] || (k === 'business_name' ? 'Porch & Party' : ''))}">`).join('')}
    <label for="dlp">My phone number for my day list</label><input id="dlp" name="day_list_phone" type="tel" value="${esc(settings.day_list_phone || '901-355-1518')}">
    <label for="dle">My email for my day list</label><input id="dle" name="day_list_email" type="email" value="${esc(settings.day_list_email || 'hello@porchandparty901.com')}">
    <div style="margin-top:12px">${act(`<button class="btn" type="submit"${tip('set.saveDayList')}>Save my day list details</button>`, 'set.saveDayList')}</div>
  </form>
  <div data-todo-settings><h3>Daily to-do email</h3>
    <p>Every day at 7 AM: today's jobs, who to call back, times to set, what to book and money, to ${esc(settings.day_list_email || 'hello@porchandparty901.com')}. It is ${settings.todo_email === '0' ? '<strong>off</strong>' : '<strong>on</strong>'}.</p>
    <form method="post" action="/admin/settings/todo">${hiddenInputs({ todo_email: settings.todo_email === '0' ? '1' : '0' })}${act(`<button class="btn ghost" type="submit"${tip('set.todoToggle')}>${settings.todo_email === '0' ? 'Turn the daily to-do email on' : 'Turn the daily to-do email off'}</button>`, 'set.todoToggle')}</form>
    <form method="post" action="/admin/settings/todo-now" style="margin-top:10px">${act(`<button class="btn ghost" type="submit"${tip('set.todoNow')}>Send me today's list now</button>`, 'set.todoNow')}</form>
  </div>
  <div data-weekly-settings><h3>Your week, on Mondays</h3>
    <p>On Mondays the to-do email ends with Your week: last week's new requests, jobs done, money in, tips, expenses and the jobs in the next 14 days. It is ${settings.weekly_summary === '0' ? '<strong>off</strong>' : '<strong>on</strong>'}.</p>
    <form method="post" action="/admin/settings/weekly">${hiddenInputs({ weekly_summary: settings.weekly_summary === '0' ? '1' : '0' })}${act(`<button class="btn ghost" type="submit"${tip('set.weeklyToggle')}>${settings.weekly_summary === '0' ? 'Turn the Monday summary on' : 'Turn the Monday summary off'}</button>`, 'set.weeklyToggle')}</form>
  </div>
  <form method="post" action="/admin/settings/holds" data-hold-settings><h3>Game rental holds and their reminder</h3>
    <p class="muted">A rental booked on the website holds its games while the customer pays the deposit.</p>
    <label for="hh">How long a hold lasts (hours)</label><input id="hh" name="hold_hours" type="number" min="1" max="336" inputmode="numeric" value="${esc(settings.hold_hours || String(HOLD_DEFAULT_HOURS))}">
    <label class="set-row"><input type="checkbox" name="hold_auto_expire" value="1"${settings.hold_auto_expire === '0' ? '' : ' checked'}> Expire unpaid holds automatically (off: every new hold is held by hand until you release it)</label>
    <label class="set-row"><input type="checkbox" name="hold_reminder" value="1"${settings.hold_reminder === '0' ? '' : ' checked'}> Email the customer a reminder before the hold ends</label>
    <label for="hrh">Send that reminder this many hours before the end</label><input id="hrh" name="hold_reminder_hours" type="number" min="1" max="48" inputmode="numeric" value="${esc(settings.hold_reminder_hours || '4')}">
    <label for="hsh">Show "Holds ending soon" for holds ending within (hours)</label><input id="hsh" name="hold_soon_hours" type="number" min="1" max="72" inputmode="numeric" value="${esc(settings.hold_soon_hours || '12')}">
    <div style="margin-top:12px">${act(`<button class="btn primary" type="submit"${tip('set.holds')}>Save hold settings</button>`, 'set.holds')}</div>
  </form>`;
  const gcal = `${act(`<a class="btn" href="/admin/calendar/link"${tip('cal.link')}>Link my Google Calendar</a>`, 'cal.link')}
    <div style="margin-top:12px">${confirmStep({ key: 'set.newToken', yesKey: 'set.newTokenYes', label: 'Make a new private calendar link', question: 'Make a new calendar link? The old link stops working, so Google Calendar stops updating until you add the new link there again.', action: '/admin/settings/calendar-token', hidden: '', danger: true })}</div>`;
  const sheet = `<p>Your Bookings, Monthly totals and Expenses tabs in the request sheet update by themselves.${settings.sheet_synced_at ? ` Last updated ${esc(prettyDate(settings.sheet_synced_at.slice(0, 10)))}.` : ''}${pendingSync ? ' <strong>An update is waiting and will be tried again.</strong>' : ''}</p>
    <form method="post" action="/admin/settings/sheet-sync">${act(`<button class="btn ghost" type="submit"${tip('set.sheetSync')}>Update the Google Sheet now</button>`, 'set.sheetSync')}</form>`;
  const cats = `<form method="post" action="/admin/settings/categories">
    <label for="cats">One per line</label><textarea id="cats" name="categories" rows="8">${esc(categories.join('\n'))}</textarea>
    <div style="margin-top:12px">${act(`<button class="btn ghost" type="submit"${tip('set.categories')}>Save categories</button>`, 'set.categories')}</div>
  </form>`;
  const pw = `<form method="post" action="/admin/settings/password">
    <label for="cur">Current password</label><input id="cur" name="current" type="password" autocomplete="current-password" required>
    <label for="np">New password (at least 10 letters or numbers)</label><input id="np" name="next" type="password" autocomplete="new-password" minlength="10" required>
    <label for="np2">New password again</label><input id="np2" name="confirm" type="password" autocomplete="new-password" minlength="10" required>
    <p class="muted">Changing it signs out every other phone or computer.</p>
    <button class="btn" type="submit"${tip('set.passwordSave')}>Change password</button>
  </form>`;
  return layout('Settings', `<style>${SET_CSS}</style><h1>Settings</h1>
  ${flash ? `<div class="notice ok"><strong>${esc(flash)}</strong></div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}
  ${setSec('pay', T.pay, 'How customers pay you: this goes on every invoice.', pay)}
  ${setSec('emails', T.emails, 'Where your day list and emails go, the Monday summary, and how long website rentals are held.', emails)}
  ${setSec('inventory', T.inventory, 'Your rental games and items, In or Out today, have their own page.', inventory)}
  ${setSec('gcal', T.gcal, 'Shows all your bookings in your own Google Calendar.', gcal)}
  ${setSec('website', T.website, 'After an inventory change the website updates by itself, and this box says when it is done.', websiteStatus || '<p class="muted">Nothing to show.</p>')}
  ${setSec('sheet', T.sheet, 'A copy of your bookings, monthly totals and expenses in the Google Sheet.', sheet)}
  ${setSec('categories', T.categories, 'The categories you pick from when you add an expense on Money.', cats, false)}
  ${setSec('password', T.password, 'The password for this console (rarely needed).', pw, false)}
  ${SET_JS}`, { screen: 'settings', back: BACK_REQUESTS });
}

const CHECKLIST_CSS = `
.sec summary{min-height:48px;font-family:"Cormorant Garamond",Georgia,serif;font-size:1.35rem;padding:6px 0}.sec summary span{font:600 .85rem Inter,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin-right:6px}
.sec h3{margin:16px 0 6px;color:var(--accent)}.sec h3 small{font:500 .9rem Inter,Arial,sans-serif;text-transform:uppercase;letter-spacing:.04em}
.cks{display:grid;grid-template-columns:1fr;gap:2px}@media(min-width:640px){.cks{grid-template-columns:1fr 1fr}}
.ckl{display:flex;gap:12px;align-items:flex-start;color:var(--ink);font-size:1.05rem;margin:0;padding:10px 4px;min-height:48px;border-radius:8px}
.ckl input{width:26px;height:26px;min-height:26px;flex:none;margin:0;padding:0;accent-color:var(--accent)}
.fld{margin:0 0 4px}.quote .qrow{border-bottom:1px solid var(--line);padding:8px 0}.qlabel{font-weight:600}
.quote .qrow label{display:none}.quote .qrow>div{margin-top:6px}
.savebar{position:sticky;top:0;z-index:2;background:var(--cream);padding:8px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);margin-bottom:12px}
#save-state{color:var(--muted)}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin:10px 0}
.photos figure{margin:0;position:relative}.photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid var(--line);display:block}
.photos button{margin-top:6px}
`;

const CHECKLIST_JS = `
(function(){
  var root=document.getElementById('cl');if(!root)return;
  var url=root.dataset.save,photosUrl=root.dataset.photos,state=document.getElementById('save-state'),timer=null,inflight=false,again=false;
  function collect(){var out={};root.querySelectorAll('[data-field]').forEach(function(el){if(el.type==='checkbox'){if(el.checked)out[el.dataset.field]=true;}else if(el.value.trim()!==''){out[el.dataset.field]=el.value;}});
    var d=document.getElementById('cl-done');if(d&&d.checked)out._done=true;return out;}
  function save(){if(inflight){again=true;return;}inflight=true;state.textContent='Saving…';
    fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(collect()),credentials:'same-origin'})
    .then(function(r){state.textContent=r.ok?'Saved':'Not saved ('+r.status+'), will retry';if(!r.ok)setTimeout(save,4000);})
    .catch(function(){state.textContent='Offline, will retry';setTimeout(save,4000);})
    .finally(function(){inflight=false;if(again){again=false;save();}});}
  function queue(){state.textContent='Unsaved changes';clearTimeout(timer);timer=setTimeout(save,700);}
  root.addEventListener('input',queue);root.addEventListener('change',queue);
  window.addEventListener('pagehide',function(){if(timer){clearTimeout(timer);fetch(url,{method:'PUT',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify(collect()),credentials:'same-origin'});}});
  var file=document.getElementById('photo-input'),grid=document.getElementById('photos'),pstate=document.getElementById('photo-state');
  function shrink(f){return new Promise(function(res,rej){var img=new Image();img.onload=function(){var s=Math.min(1,1600/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);var q=0.85;(function go(){c.toBlob(function(b){if(!b)return rej(new Error('could not read that image'));if(b.size>1500000&&q>0.4){q-=0.1;go();}else res(b);},'image/jpeg',q);})();URL.revokeObjectURL(img.src);};
    img.onerror=function(){rej(new Error('could not read that image'));};img.src=URL.createObjectURL(f);});}
  if(file)file.addEventListener('change',function(){var files=[].slice.call(file.files);file.value='';(function next(){var f=files.shift();if(!f){pstate.textContent='';return;}
    pstate.textContent='Uploading…';shrink(f).then(function(b){return fetch(photosUrl,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:b,credentials:'same-origin'});})
    .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||r.status);var fig=document.createElement('figure');fig.setAttribute('data-photo',j.id);fig.innerHTML=document.getElementById('photo-tpl').innerHTML+document.getElementById('del-tpl').innerHTML;
      var a=fig.querySelector('a');a.href=j.url;a.innerHTML='<img src="'+j.url+'" alt="Walk-through photo" loading="lazy">';fig.querySelector('[data-del]').setAttribute('data-del',j.url);grid.appendChild(fig);});})
    .then(next).catch(function(e){pstate.textContent='Photo not added: '+e.message;});})();});
  if(grid)grid.addEventListener('click',function(e){var u=e.target.dataset&&e.target.dataset.del;if(!u||!confirm('Delete this photo?'))return;
    fetch(u,{method:'DELETE',credentials:'same-origin'}).then(function(r){if(r.ok)e.target.closest('figure').remove();});});
})();`;

export function checklistOnlinePage({ request, rk, sections, photos, values, maxPhotos }) {
  const done = Boolean(values && values._done);
  const del = (url) => `<button type="button" class="btn danger" data-del="${esc(url)}"${tip('cl.deletePhoto')}>Delete</button>`;
  return layout(`Checklist · ${request.name || 'request'}`, `<style>${CHECKLIST_CSS}</style>
  <div id="cl" data-save="/api/admin/checklist?r=${esc(rk)}" data-photos="/api/admin/checklist/photos?r=${esc(rk)}">
    <div class="savebar"><div><strong>${esc(request.name || 'No name given')}</strong> <span class="muted">· checklist</span></div>
      <div class="row"><span id="save-state">Saves by itself</span>
      </div></div>
    ${sections}
    <div class="card"><h3 style="margin-top:0">Photos <small class="muted">up to ${maxPhotos}</small></h3>
      <div class="photos" id="photos">${photos.map((p) => `<figure data-photo="${p.id}"><a href="${esc(p.url)}" target="_blank" rel="noopener"${tip('cl.photo')}><img src="${esc(p.url)}" alt="Walk-through photo" loading="lazy"></a>${del(p.url)}</figure>`).join('')}</div>
      ${act(`<label class="btn ghost" style="color:var(--accent);margin:0"${tip('cl.addPhotos')}>Add photos<input id="photo-input" type="file" accept="image/*" multiple style="display:none"></label>`, 'cl.addPhotos')}
      <template id="del-tpl">${del('')}</template><template id="photo-tpl"><a href="" target="_blank" rel="noopener"${tip('cl.photo')}></a></template>
      <div id="photo-state" class="muted" style="margin-top:6px"></div></div>
    <div class="card"><label class="ckl"><input type="checkbox" id="cl-done"${done ? ' checked' : ''}><span><strong>Checklist done</strong></span></label></div>
    <div class="actions three">${act(`<a class="btn" href="/admin/invoices/new?r=${esc(rk)}"${tip('card.createInvoice')}>Create invoice</a>`, 'card.createInvoice')}
      ${act(`<a class="btn ghost" href="/admin/checklist?r=${esc(rk)}" target="_blank" rel="noopener"${tip('card.printChecklist')}>Print checklist</a>`, 'card.printChecklist')}
      <a class="btn ghost" href="/admin/"${tip('nav.back')}>Back to requests</a></div>
  </div>
  <script>${CHECKLIST_JS}</script>`, { screen: 'checklist', back: BACK_REQUESTS });
}

export { act, chip, confirmStep, hiddenInputs, BACK_REQUESTS };
