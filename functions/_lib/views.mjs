// Server-rendered pages for the /admin console. Built for one non-technical person on a phone:
// plain words, one obvious button per step, big tap targets (48 px+), 16 px+ type, no hover-only
// controls, no framework, no analytics. Every button and link carries data-help + a title from
// the one map in helptext.mjs, primary actions carry a visible helper line under them, every
// screen opens with a numbered 1-2-3 and (except Requests itself) a Back link.
import { esc, money, lineTotal, invoiceTotal, prettyDate, shortDate, STATUS_LABELS, SHEET_URL, SA_EMAIL, b64urlText, needsPrice, payPlanOf } from './util.mjs';
import { tip, hint, stepsBar, stepsPanel, helpGlossary, STEPS } from './helptext.mjs';
import { servicesOf, cardStage, cardButtons, cardPayment, keyFacts, grazingFacts, notPaidYet, matchesFilter, serviceBadge, FILTERS, takedownChoice } from './cards.mjs';
import { kindCss } from './kinds.mjs';
import { deriveProgress, STATUS_MEANINGS } from './progress.mjs';
import PP from '../../scripts/lib/porch_packages.js';

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

export function layout(title, body, { authed = true, screen = '', back = null, subnav = '', wide = false, panelWide = false } = {}) {
  const nav = authed ? `<nav aria-label="Main">
    <a href="/admin/"${tip('nav.requests')}>Requests</a><a href="/admin/calendar"${tip('nav.calendar')}>Calendar &amp; Bookings</a><a href="/admin/money"${tip('nav.money')}>Money</a><a href="/admin/settings"${tip('nav.settings')}>Settings</a><a href="/admin/help"${tip('nav.help')}>Help</a>
    <form method="post" action="/admin/logout" style="display:inline"><button type="submit"${tip('nav.signout')}>Sign out</button></form></nav>` : '';
  const backLink = back ? `<a class="back" href="${esc(back.href)}"${tip('nav.back')}>&larr; ${esc(back.label || 'Back')}</a>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<meta name="format-detection" content="telephone=no">
<title>${esc(title)} · Porch &amp; Party</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>${CSS}${EXTRA_CSS}</style></head><body>
<header class="top"><a class="brand" href="/admin/"${tip('nav.brand')}>Porch &amp; Party</a>${nav}</header>${subnav}
<main class="wrap${wide ? ' wide' : ''}${panelWide ? ' panelwide' : ''}">${backLink}${screen ? stepsBar(screen) : ''}${body}</main></body></html>`;
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
export function wantSummary(r) {
  const parts = [];
  if (r.gamesAnswer) {
    const how = /weekend/i.test(r.durationAnswer) ? 'for the weekend' : (r.durationAnswer ? 'for one day' : '');
    const when = answerOf(r, /pickup date|delivery date/i);
    parts.push(`Games: ${r.gamesAnswer}${how ? ` ${how}` : ''}${when ? `, ${when}` : ''}`);
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
  'day.deleteYes': 'Yes, delete it', 'card.idDeleteYes': 'Yes, delete the ID for good', 'hold.releaseYes': 'Yes, release the games', 'hold.depositYes': 'Yes, mark deposit received', 'set.newTokenYes': 'Yes, make a new link', 'td.jobDoneYes': 'Yes, mark job done', 'note.deleteYes': 'Yes, delete the note', 'ret.undoYes': 'Yes, undo returned' };

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

function idCell(r, rk) {
  if (r.idDeletedAt) return esc(`Deleted ${memphisWhen(r.idDeletedAt)}`);
  if (r.idObject) return `<a href="/admin/requests/id?r=${esc(rk)}" target="_blank" rel="noopener"${tip('card.idPhoto')}>Open ID photo</a>`;
  return r.idFile ? r.idFile.split(/,\s*/).map((u, i) => link(u, i ? `Open ID photo ${i + 1}` : 'Open ID photo', 'card.idPhoto')).join('<br>') : '';
}

function deleteIdStep(r, rk) {
  if (r.idDeletedAt || !(r.idObject || r.idFile)) return '';
  return confirmStep({ key: 'card.idDelete', yesKey: 'card.idDeleteYes', label: 'Delete this ID', question: `Delete ${r.name || 'this customer'}'s ID photo for good? It cannot be brought back.`, action: '/admin/requests/id/delete', hidden: hiddenInputs({ r: rk }), danger: true });
}

function requestDetailsBody(r, { referrers = {} } = {}) {
  const rk = b64urlText(r.key);
  return `${kv([
      ['Phone', r.phone ? `<a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}"${tip('card.phone')}>${esc(r.phone)}</a>` : '', true],
      ['Email', r.email ? `<a href="mailto:${esc(r.email)}"${tip('card.email')}>${esc(r.email)}</a>` : '', true],
      ['Date of birth', r.dob],
      ['Social media', [r.social1, r.social2].filter(Boolean).map((u) => link(u, '', 'card.social')).join('<br>'), true],
      ['Photo ID', idCell(r, rk), true],
      ['Rules', r.agreedAt ? `Agreed to rules on ${memphisWhen(r.agreedAt)} (version ${r.rulesVersion})` : ''],
      ['Referred by', r.referredBy ? (referrers[r.referredBy] || 'a past customer') : ''],
      ['Robot check', r.robotCheck === 'no-js' ? 'Sent without the robot check (their phone had JavaScript off). Check it looks real.' : ''],
      ['Found us through', r.heard],
      ['What they picked', r.need],
      ...r.rentals.map((x) => [x.label, x.value]),
      ...r.decor.map((x) => [x.label, x.value]),
      ...r.other.map((x) => [x.label, x.value]),
    ])}
    ${deleteIdStep(r, rk)}`;
}

// Top of Requests: this week (Mon–Sun, Memphis) by service, and last week.
export function weekBox(w) {
  const n = w.thisWeek.length;
  const parts = [['porch', 'porch'], ['party', 'party & decor'], ['grazing', 'grazing'], ['rentals', 'rentals']].filter(([k]) => w.byService[k]).map(([k, word]) => `${w.byService[k]} ${word}`);
  const list = w.thisWeek.map((r) => `<li>${esc(r.name || 'No name given')} <span class="muted">${esc(shortDate(new Date(r.sortTime).toISOString().slice(0, 10)))}</span></li>`).join('');
  return `<section class="card" data-week-counts><p class="weekline"><strong>This week: ${n} new request${n === 1 ? '' : 's'}</strong>${parts.length ? ` (${esc(parts.join(', '))})` : ''}</p>
    <p class="muted" style="margin:0">Last week: ${w.lastWeek.length}</p>
    ${n ? `<details class="disclose" data-week-list><summary${tip('req.weekList')}>See this week's requests</summary><ul>${list}</ul></details>` : ''}</section>`;
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
  const owed = bal ? bal.owed : (inv ? Math.max(0, (inv.total_cents || 0)) : 0);
  const dmg = bal && bal.refundable ? ` · damage deposit ${money(bal.refundable)}, refundable` : '';
  const words = {
    none: 'No invoice yet.', draft: 'Invoice made, not sent yet.',
    sent: `Invoice sent · owes ${money(owed)}`,
    deposit: inv ? `Deposit in · still owes ${money(owed)}` : 'Deposit in.',
    paid: 'Paid in full ✓',
  }[p.state] || '';
  if (p.state === 'none' || p.state === 'draft') return `<p class="payline muted" data-payment data-pay-state="${p.state}" data-pay-words>${esc(words)}</p>`;
  const out = [];
  if (p.button) out.push(cardButton(p.button, ctx, false, { helper: false }));
  if (p.undo) out.push(confirmStep({ key: 'pay.unpaid', yesKey: 'pay.unpaidYes', label: 'That was a mistake: mark as not paid', question: `Mark ${who} as not paid? Only do this to fix a mistake.`, action: t.action, hidden: hiddenInputs({ ...t.extra, [t.field]: 'unpaid' }), link: true }));
  return `<section class="paybox calm" data-payment data-pay-state="${p.state}"><p class="words" data-pay-words>${esc(words + dmg)}</p>${out.length ? `<div class="payacts">${out.join('')}</div>` : ''}</section>`;
}

// Void, as a small danger link under Show details (never a big button on a card).
function voidLink(r, inv, ctx) {
  const t = ctx.payTarget;
  const q = inv && inv.number ? `Void invoice ${inv.number} for ${ctx.who}? The customer is not told. Use this when the job is cancelled or the invoice was a mistake.`
    : `Void the request from ${ctx.who}? The customer is not told. Use this when the job is cancelled or the request was a mistake.`;
  return `<div class="voidlink" data-void-link>${confirmStep({ key: 'pay.void', yesKey: 'pay.voidYes', label: 'Void this request…', question: q, action: t.action, hidden: hiddenInputs({ ...t.extra, [t.field]: 'void' }), danger: true, link: true })}</div>`;
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
.facts{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;margin:6px 0 2px;font-size:1.05rem}
.facts .call{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:999px;background:var(--ok);color:#fff;font-weight:700;text-decoration:none}
.progress.mini{gap:4px;margin:8px 0}.progress.mini li{padding:1px 8px;font-size:.82rem}
.secrow{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.secrow>*{min-width:0}
.secrow .btn{min-height:48px;font-size:.98rem;padding:8px 10px}
@media(min-width:700px){.secrow{grid-template-columns:repeat(3,1fr)}}
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
.tdbox{margin:10px 0}.tdbox .secrow{margin-top:8px}.linkbtn{background:none;border:0;color:var(--accent);font:600 1rem Inter,Arial,sans-serif;text-decoration:underline;cursor:pointer;min-height:44px}
`;

function badges(services) {
  return `<div class="svcs" data-badges>${services.map((k) => { const b = serviceBadge(k); return b ? `<span class="svc" data-service="${k}" style="border-color:${b.bar};background:${b.tint}">${esc(b.label)}</span>` : ''; }).join('')}</div>`;
}

function factsLine(f) {
  const bits = [];
  if (f.date) bits.push(`<span data-fact-date>${esc(f.dateWord)} ${esc(shortDate(f.date))}</span>`);
  if (f.where) bits.push(`<span data-fact-where>${esc(f.where)}</span>`);
  const call = f.phone ? `<a class="call" href="tel:${esc(f.phone.replace(/[^\d+]/g, ''))}"${tip('card.call')}>Call</a>` : '';
  return bits.length || call ? `<div class="facts" data-facts>${bits.join('<span class="muted">·</span>')}${call}</div>` : '';
}

const CARD_LABEL = {
  'card.createInvoice': 'Create invoice', 'card.openInvoice': 'Open invoice', 'card.seeCal': 'See it on the calendar',
  'card.checklist': 'Walk-through checklist', 'card.printChecklist': 'Print checklist', 'ret.mark': 'Mark returned', 'ret.see': 'See the check-in',
  'card.schedInstall': 'Schedule install', 'card.schedSetup': 'Schedule setup', 'card.schedPickup': 'Schedule pickup + return',
  'card.schedTakedown': 'Schedule takedown', 'card.schedGrazingPickup': 'Schedule pickup (optional)',
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
    case 'card.schedInstall': case 'card.schedSetup': case 'card.schedPickup': case 'card.schedTakedown': case 'card.schedGrazingPickup':
      return a(`/admin/calendar/new?r=${rk}&kind=${kind}`, CARD_LABEL[key]);
    case 'card.jobDone':
      // Takedown not decided yet: ask once, at the moment of Job done; never blocks it.
      if (ctx.tdNotSure) return confirmStep({ key, yesKey: 'td.jobDoneYes', label: 'Mark job done', cls: primary ? 'primary' : 'ghost', question: `The takedown is not decided yet for ${ctx.who}. Mark the job done anyway? You can still schedule the takedown later.`, action: '/admin/requests/jobdone', hidden: hiddenInputs({ r: rk }), helper: primary });
      return `<form method="post" action="/admin/requests/jobdone">${hiddenInputs({ r: rk })}${wrap(`<button class="${cls}" type="submit"${tip(key)}>Mark job done</button>`)}</form>`;
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

// The takedown box (porch/party, once the install/setup is booked): the second step is never
// required. "Schedule it" · "Not sure yet" (amber, listed in Still to decide on the calendar) ·
// "Customer will handle it" (no booking, no nagging), each with a note.
function takedownBox(td, r, rk, services) {
  const k = services.includes('porch') ? 'porch' : 'party';
  const sched = `<a class="btn ghost" href="/admin/calendar/new?r=${rk}&kind=${k}_takedown"${tip('td.schedule')}>Schedule it</a>`;
  const choose = (plans) => `<form method="post" action="/admin/requests/takedown" class="tdform">${hiddenInputs({ r: rk })}
      <label for="tdn-${esc(rk)}">Note (optional)</label><input id="tdn-${esc(rk)}" name="note" value="${esc(r.takedownNote || '')}" placeholder="e.g. they will tell us after the party">
      <div class="secrow"><div class="act">${sched}</div>${plans.map(([v, key, label]) => `<div class="act"><button class="btn ghost" type="submit" name="plan" value="${v}"${tip(key)}>${label}</button></div>`).join('')}</div></form>`;
  if (td === 'customer_handles') return `<div class="tdbox muted" data-takedown="customer_handles">Takedown: the customer will handle it${r.takedownNote ? ` (${esc(r.takedownNote)})` : ''}.
    <form method="post" action="/admin/requests/takedown" style="display:inline">${hiddenInputs({ r: rk, plan: '' })}<button class="linkbtn" type="submit"${tip('td.change')}>Change</button></form></div>`;
  if (td === 'not_sure') return `<div class="notice warn tdbox" data-takedown="not_sure"><strong>Takedown: not decided yet.</strong>${r.takedownNote ? ` ${esc(r.takedownNote)}` : ''}
    ${choose([['customer_handles', 'td.customer', 'Customer will handle it']])}</div>`;
  return `<div class="tdbox card" style="background:var(--cream)" data-takedown="ask"><strong>Takedown afterwards?</strong> <span class="muted">Never required.</span>
    ${choose([['not_sure', 'td.notSure', 'Not sure yet'], ['customer_handles', 'td.customer', 'Customer will handle it']])}</div>`;
}

function payTargetFor(r, inv) {
  return inv ? { action: `/admin/invoices/${inv.id}/status`, field: 'action', extra: { back: '/admin/' } } : { action: '/admin/requests/status', field: 'status', extra: { r: b64urlText(r.key) } };
}

function historyHtml(events = [], notes = []) {
  const ev = events.map((e) => `<li><span class="muted">${esc(memphisWhen(e.at))}</span> ${esc(e.what)}</li>`).join('');
  const nt = notes.map((n) => `<li>${esc(n.body)}</li>`).join('');
  return `${nt ? `<h4>Notes (only you see these)</h4><ul data-notes>${nt}</ul>` : ''}${ev ? `<h4>History</h4><ul data-history>${ev}</ul>` : ''}`;
}

// One request card. o: everything dashboardPage knows about this request.
export function requestCard(r, o) {
  const { st = { status: 'new' }, inv = null, sched = null, ret = null, cl = '', kinds = [], extras = '', referrers = {}, events = [], notes = [], archived = false, foodPerHead = null, pickupPlace } = o;
  const rk = b64urlText(r.key);
  const services = servicesOf(r);
  const rental = Boolean(r.gamesAnswer) || (r.wantsRentals && !r.wantsDecor);
  const pr = deriveProgress({ st, inv, scheduled: Boolean(sched), ret, rental });
  const stage = cardStage({ pr, inv, archived });
  const returned = Boolean(ret && ret.returned_at);
  const plan = inv ? payPlanOf(inv, inv.total_cents || 0) : 'half';
  const rules = cardButtons({ services, stage, inv, plan, sched: Boolean(sched), kinds, returned, jobDoneAt: Boolean(st.job_done_at), takedownPlan: r.takedownPlan });
  const td = takedownChoice({ services, kinds, takedownPlan: r.takedownPlan, stage });
  const ctx = { rk, inv, st, sched, who: r.name || 'this customer', payTarget: payTargetFor(r, inv), tdNotSure: td === 'not_sure' };
  const first = serviceBadge(services[0]);
  const deposit = inv && inv.balance && inv.balance.refundable ? inv.balance : null;
  const chips = [
    pr.void ? '<span class="chip void" data-step="void">Void — cancelled</span>' : (pr.current === 'scheduled' && sched && !pr.finished ? '' : `<span class="chip ${pr.current === 'paid' ? 'paid' : (pr.damaged && pr.current === 'job_done' ? 'deposit_paid' : 'step')}" data-step="${pr.current}">${esc(pr.finished ? 'Finished: job done and paid' : pr.label)}</span>`),
    pr.paidEarly ? '<span class="chip paid" data-paid-early>Paid in full ✓</span>' : '',
    sched && !pr.void ? `<span class="chip sched" data-scheduled>Scheduled for ${esc(shortDate(sched.date))}</span>` : '',
    returned ? (ret.damaged ? '<span class="chip deposit_paid" data-returned-damage>Returned — check damage</span>' : `<span class="chip paid" data-returned>Returned ${esc(shortDate(String(ret.returned_at).slice(0, 10)))}</span>`) : '',
    notPaidYet(inv) ? `<span class="chip deposit_paid" data-owes>Owes ${esc(money(inv.balance.owed))}</span>` : '',
  ].join('');
  const progress = pr.void || archived ? '' : `<ol class="progress mini" data-progress aria-label="Step ${pr.steps.findIndex((x) => x.key === pr.current) + 1} of 6">${pr.steps.map((x) => `<li class="${x.done ? 'done' : ''}${x.key === pr.current ? ' now' : ''}"><span class="pn">${x.done ? '✓' : x.n}</span> ${esc(x.label)}</li>`).join('')}</ol>`;
  const g = services.includes('grazing') ? grazingFacts(r, foodPerHead) : null;
  const gLine = g && (g.guests || g.estimate) ? `<div class="want" data-grazing-facts>${esc([g.guests ? `Guests: ${g.guests}` : '', g.estimate].filter(Boolean).join(' · '))}</div>` : '';
  const quiet = ['void', 'finished', 'archived'].includes(stage);
  const finishedNote = stage === 'finished' ? '<div class="notice ok" data-put-away-prompt><strong>Finished: the job is done and it is paid in full.</strong> Put it away?</div>' : '';
  const damage = returned && ret.damaged && stage !== 'archived' && stage !== 'void' ? `<div class="notice warn" data-deposit-reminder><strong>Something came back damaged or missing.</strong> ${deposit ? `Damage deposit ${esc(money(deposit.refundable))}, refundable. ` : ''}Decide whether to refund the deposit in full or keep part of it. Nothing is sent to the customer by itself.</div>` : '';
  const payment = quiet ? '' : cardPaymentBox(r, st, inv, rules.primary, ctx);
  return `<article class="card" ${archived ? 'data-archived' : 'data-card'}="${esc(rk)}" id="c-${esc(rk)}" data-reqcard data-services="${esc(services.join(' '))}" data-stage="${esc(stage)}"${first ? ` style="border-left-color:${first.bar}"` : ''}>
      ${badges(services)}
      <div class="spread"><h3 class="who">${esc(r.name || 'No name given')}</h3><div class="row">${chips}</div></div>
      ${factsLine(keyFacts(r, services, { pickupPlace }))}
      ${wantSummary(r).map((w) => `<div class="want">${esc(w)}</div>`).join('')}${gLine}
      ${progress}
      ${quiet ? '' : extras}
      ${damage}${finishedNote}
      ${td ? takedownBox(td, r, rk, services) : ''}
      ${rules.primary ? `<div class="actions" data-primary>${cardButton(rules.primary, ctx, true)}</div>` : ''}
      ${rules.secondary.length ? `<div class="secrow" data-secondary>${rules.secondary.map((k) => cardButton(k, ctx, false)).join('')}</div>` : ''}
      ${payment}
      <details class="disclose" data-details><summary${tip('card.details')}>Show details</summary>
        <div class="muted" style="margin-top:4px">${esc(friendlyWhen(r))}${archived && st.archived_at ? ` · put away ${esc(prettyDate(String(st.archived_at).slice(0, 10)))}` : ''}</div>
        ${cl && cl !== 'none' ? `<div class="muted" style="margin-top:4px">Checklist ${cl === 'done' ? 'done ✓' : 'started'}</div>` : ''}
        ${requestDetailsBody(r, { referrers })}
        ${historyHtml(events, notes)}
        ${rules.more.length ? `<div class="secrow" data-more-buttons>${rules.more.map((k) => cardButton(k, ctx, false)).join('')}</div>` : ''}
        ${quiet ? '' : voidLink(r, inv, ctx)}
      </details>
    </article>`;
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
export function dashboardPage({ requests, statuses, checklists = {}, invoices = {}, schedule = {}, returns = {}, folderUrl, sheetError, flash, error = '', missingPayment = [], putAway = '', extraTop = '', referrers = {}, weekBox: week = '', idsBox = '', cardExtras = {}, holdsBox = '',
  archived = [], filter = 'all', openPutAway = false, kinds = {}, events = {}, notes = {}, foodPerHead = null, pickupPlace = 'Mt. Moriah Station' }) {
  const err = sheetError ? `<div class="notice err"><strong>The requests could not be loaded right now.</strong> ${/not shared/i.test(sheetError)
    ? `The responses sheet needs to be shared with the site. In Google Sheets tap Share and add <code>${esc(SA_EMAIL)}</code> as a Viewer.`
    : 'Please try again in a minute.'}<div class="muted" style="margin-top:6px;font-size:.95rem">Details: ${esc(sheetError)}</div></div>` : '';
  const f = FILTERS.some(([k]) => k === filter) ? filter : 'all';
  const one = (r, isArchived) => {
    const st = statuses[r.key] || { status: 'new' };
    const inv = st.invoice_id ? invoices[st.invoice_id] : null;
    return { r, inv, services: servicesOf(r), html: () => requestCard(r, { st, inv, sched: schedule[r.key], ret: returns[r.key], cl: checklists[r.key], kinds: kinds[r.key] || [], extras: cardExtras[r.key] || '', referrers, events: events[r.key] || [], notes: notes[r.key] || [], archived: isArchived, foodPerHead, pickupPlace }) };
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
  return layout('Requests', `<style>${CARD_CSS}</style>${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}${setupBanner(missingPayment)}
    ${requestsPanel(folderUrl)}
    <h1>Requests</h1>${week}${holdsBox}${extraTop}${err}${idsBox}
    ${filterChips(f)}
    ${shown.length ? shown.map((x) => x.html()).join('') : (sheetError ? '' : empty)}
    ${putSection}
    <template id="undo-tpl">${undoBanner('')}</template>
    <div class="undo-slot" id="undo-slot" aria-live="polite">${putAway ? undoBanner(putAway) : ''}</div>
    <script>${DASH_JS}if(location.hash==='#put-away'){var pa=document.getElementById('put-away');if(pa)pa.open=true;}</script>`, { screen: '', panelWide: true });
}

export function invoicesPage({ invoices }) {
  const rows = invoices.map((i) => `<tr><td><a href="/admin/invoices/${i.id}"${tip('inv.row')}><strong>${esc(i.customer_name || 'No name')}</strong></a><div class="muted">${esc(i.number)}</div></td>
    <td>${chip(i.status)}</td><td class="right">${money(i.total_cents)}</td></tr>`).join('');
  return layout('Invoices', `<h1>Invoices</h1>
    ${invoices.length ? `<div class="card"><table class="list">${rows}</table></div>` : '<div class="card"><p style="margin:0">No invoices yet. Tap <strong>Create invoice</strong> on a request to make one.</p></div>'}
    ${act(`<a class="btn ghost" href="/admin/invoices/new"${tip('sub.blankInvoice')}>Start a blank invoice</a>`, 'sub.blankInvoice')}`, { screen: 'invoices', back: BACK_REQUESTS });
}

function lineEditor(line) {
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

const EDITOR_JS = `
(function(){
  var form=document.getElementById('inv');if(!form)return;
  var list=form.querySelector('[data-lines]'),tpl=document.getElementById('line-tpl'),dep=form.querySelector('[name=deposit]');
  function plan(){var r=form.querySelector('[name=pay_plan]:checked');return r?r.value:'half';}
  function txt(id,v){var el=document.getElementById(id);if(el)el.textContent=v;}
  function show(id,on){var el=document.getElementById(id);if(el)el.hidden=!on;}
  function fmt(c){return '$'+(c/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
  function recalc(){var t=0,rows='',missing=[];list.querySelectorAll('[data-line]').forEach(function(el){var d=el.querySelector('[name=line_desc]').value.trim();if(!d)return;var q=parseFloat(el.querySelector('[data-qty]').value)||0,p=Math.round((parseFloat(el.querySelector('[data-price]').value)||0)*100),lt=Math.round(q*p),r=el.querySelector('[name=line_refundable]').value==='1',free=el.querySelector('[name=line_note]').value==='free';t+=lt;if(lt===0&&!free)missing.push(d);
      rows+='<tr><td>'+esc(d)+(q!==1?' &times; '+q:'')+(r?'<div class="muted">Given back after the event</div>':'')+'</td><td class="amt">'+(lt===0?(free?'Free':'<strong style="color:#8f3427">Price needed</strong>'):fmt(lt))+'</td></tr>';});
    var pn=document.getElementById('price-needed');if(pn){pn.hidden=!missing.length;pn.querySelector('span').textContent=missing.join(', ');}
    var p=plan();show('custom-wrap',p==='custom');
    var dc=p==='full'?t:(p==='custom'?Math.min(t,Math.round((parseFloat(dep&&dep.value)||0)*100)):Math.round(t/2));
    if(p!=='custom'&&dep)dep.value=(dc/100).toFixed(2);
    document.getElementById('sum-lines').innerHTML=rows||'<tr><td class="muted">Nothing in the total yet. Tap Change what goes into the total.</td><td></td></tr>';
    txt('sum-total',fmt(t));txt('sum-deposit',fmt(dc));txt('sum-rest',fmt(t-dc));
    show('sum-now-row',p!=='full');show('sum-rest-row',p!=='full');
    txt('sum-now-label',p==='half'?'Deposit asked for now (half)':'Deposit asked for now');
    txt('sum-due-label',p==='full'?'Full amount due by':'Rest due by');
    var due=form.querySelector('[name=due_date]').value;txt('sum-due',due?new Date(due+'T12:00:00Z').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}):'');}
  form.addEventListener('input',recalc);
  form.addEventListener('change',recalc);
  form.addEventListener('click',function(e){if(e.target.matches('[data-remove]')){e.target.closest('[data-line]').remove();recalc();}});
  document.getElementById('add-line').addEventListener('click',function(){list.insertAdjacentHTML('beforeend',tpl.innerHTML);recalc();});
  form.addEventListener('submit',function(e){var b=e.submitter||document.activeElement;if(b&&b.name==='go'&&b.value==='send'){
    var pn=document.getElementById('price-needed');if(pn&&!pn.hidden){e.preventDefault();var dt=form.querySelector('details');dt.open=true;pn.scrollIntoView({behavior:'smooth'});
      var first=[].slice.call(list.querySelectorAll('[data-line]')).find(function(el){return el.querySelector('[name=line_desc]').value.trim()&&!(parseFloat(el.querySelector('[data-price]').value)>0)&&el.querySelector('[name=line_note]').value!=='free';});if(first)first.querySelector('[data-price]').focus();return;}
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
export function invoiceEditorPage({ invoice, lines, request, action, title, warnings = [], pay, mode = 'new', backHref = '/admin/' }) {
  const blank = { description: '', qty: 1, unit_cents: 0, note: '', refundable: 0 };
  const who = firstName(invoice.customer_name);
  const sendLabel = mode === 'new' ? `Send to ${who}` : `Save and send to ${who}`;
  return layout(title, `<h1>${esc(title)}</h1>
  ${pay ? paymentWarning(pay) : ''}
  ${warnings.map((w) => `<div class="notice warn">${esc(w)}</div>`).join('')}
  <div class="notice err" id="price-needed"${lines.some((l) => l.description && needsPrice(l)) ? '' : ' hidden'}><strong>Add a price first:</strong> <span>${esc(lines.filter((l) => l.description && needsPrice(l)).map((l) => l.description).join(', '))}</span>. Tap <strong>Change what goes into the total</strong>, type the price, then send.</div>
  <form id="inv" method="post" action="${esc(action)}">
    ${request ? `<input type="hidden" name="r" value="${esc(b64urlText(request.key))}">` : ''}
    <div class="card">
      <div class="muted">For</div>
      <div style="font-size:1.2rem;font-weight:600">${esc(invoice.customer_name || 'No name yet')}</div>
      <div class="muted" style="word-break:break-all">${esc(invoice.customer_email || 'No email: text them the PDF after saving')}</div>
      <div class="muted" style="margin-top:14px">What goes into the total</div>
      <table class="sumlines"><tbody id="sum-lines"></tbody></table>
      <div class="calc">
        <div class="spread"><span>Total</span><span class="bigtotal" id="sum-total">${money(invoiceTotal(lines))}</span></div>
        <div class="spread" id="sum-now-row"><span id="sum-now-label">Deposit asked for now</span><strong class="now" id="sum-deposit">${money(invoice.deposit_due_cents)}</strong></div>
        <div class="spread" id="sum-rest-row"><span>Rest after the deposit</span><strong id="sum-rest">${money(invoiceTotal(lines) - invoice.deposit_due_cents)}</strong></div>
        <div class="spread"><span id="sum-due-label">Rest due by</span><strong id="sum-due">${esc(prettyDate(invoice.due_date))}</strong></div>
      </div>
    </div>
    <div class="card">
      <div class="muted">How they pay</div>
      <div class="plans">
        ${[['half', 'Half now', 'A deposit of half holds the date. The rest is due by the due date.'], ['full', 'Full amount', 'No deposit. The whole total is due by the due date.'], ['custom', 'Other deposit', 'You type the deposit. The rest is due by the due date.']]
          .map(([v, big, small]) => `<label class="plan"><input type="radio" name="pay_plan" value="${v}"${(invoice.pay_plan || 'half') === v ? ' checked' : ''}><span><strong>${big}</strong><small>${small}</small></span></label>`).join('')}
      </div>
      <div id="custom-wrap"${(invoice.pay_plan || 'half') === 'custom' ? '' : ' hidden'}>
        <label for="dep">Deposit to ask for now ($)</label>
        <input id="dep" name="deposit" type="number" step="0.01" inputmode="decimal" value="${esc((invoice.deposit_due_cents / 100).toFixed(2))}">
      </div>
      <label for="dd">Due date</label><input id="dd" name="due_date" type="date" value="${esc(invoice.due_date)}">
      <input type="hidden" name="issue_date" value="${esc(invoice.issue_date)}">
    </div>
    <details class="more card" style="padding-top:0"${lines.some((l) => l.description && needsPrice(l)) ? ' open' : ''}><summary${tip('ed.change')}>Change what goes into the total</summary>
      <label for="cn">Customer name</label><input id="cn" name="customer_name" value="${esc(invoice.customer_name)}">
      <label for="ce">Customer email (leave blank if you only text them)</label><input id="ce" name="customer_email" type="email" value="${esc(invoice.customer_email)}">
      <label for="cp">Customer phone</label><input id="cp" name="customer_phone" type="tel" value="${esc(invoice.customer_phone)}">
      <h3 style="margin-top:18px">Lines</h3>
      <div data-lines>${lines.map(lineEditor).join('')}</div>
      <template id="line-tpl">${lineEditor(blank)}</template>
      <button type="button" class="btn ghost" id="add-line"${tip('ed.addLine')}>Add a line</button>
      <p style="margin:10px 0 0"><a href="/admin/packages" target="_blank" rel="noopener"${tip('ed.packages')}>See the porch packages</a></p>
      <label for="nt">Message to the customer (optional)</label><textarea id="nt" name="notes">${esc(invoice.notes)}</textarea>
      <div style="margin-top:12px"><button class="btn ghost" type="submit" name="go" value="save"${tip('ed.saveOnly')}>Save without sending</button></div>
    </details>
    ${act(`<button class="btn primary" type="submit" name="go" value="preview"${tip('ed.preview')}>See it before sending</button>`, 'ed.preview')}
    <div style="margin-top:10px">${act(`<button class="btn ghost" type="submit" name="go" value="send"${tip('ed.sendNow')}>${esc(sendLabel)} now</button>`, 'ed.sendNow')}</div>
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
    balanceLine: balance && !balance.void ? esc([balance.owed > 0 ? `Owes ${money(balance.owed)}` : 'Paid in full ✓', balance.paid ? `${money(balance.paid)} received` : '', balance.refundable ? `Damage deposit ${money(balance.refundable)}, refundable` : ''].filter(Boolean).join(' · ')) : '',
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
  ${tab('Calendar', 'calendar', '<p>Bookings from invoices appear by themselves. A booking you make or change by hand keeps your date, even if the invoice is sent again.</p>')}
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

export function settingsPage({ settings, flash, error, hasQr, categories = [], pendingSync = 0 }) {
  return layout('Settings', `<h1>Settings</h1>
  ${flash ? `<div class="notice ok"><strong>${esc(flash)}</strong></div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}
  <form class="card" method="post" action="/admin/settings" enctype="multipart/form-data">
    <h2>How customers pay you</h2>
    <label for="z">Zelle (the email or phone number people send Zelle to)</label><input id="z" name="zelle" value="${esc(settings.zelle || '')}" autocomplete="off">
    <label for="c">Cash App name (starts with $)</label><input id="c" name="cashapp" placeholder="$yourname" value="${esc(settings.cashapp || '')}" autocomplete="off" autocapitalize="off">
    <label for="q">Payment QR code (a photo or screenshot of it)</label>
    ${hasQr ? '<div style="margin:6px 0"><img src="/api/admin/qr.png" alt="Your QR code" width="160" height="160" style="border:1px solid var(--line);border-radius:10px"></div>' : '<div class="muted">No QR code yet.</div>'}
    <input id="q" name="qr" type="file" accept="image/png,image/jpeg">
    ${hasQr ? '<label class="row" style="color:var(--ink);gap:10px;min-height:48px"><input type="checkbox" name="remove_qr" value="1" style="width:24px;min-height:24px"> Remove the QR code</label>' : ''}
    <details class="disclose"><summary${tip('set.business')}>Business name and address</summary>
      <label for="bn">Business name on invoices</label><input id="bn" name="business_name" value="${esc(settings.business_name || 'Porch & Party')}">
      <label for="ba">Address line on invoices</label><input id="ba" name="business_address" placeholder="Memphis, Tennessee" value="${esc(settings.business_address || '')}">
      <label for="f">Link to the Google Drive folder with ID photos (only if the button on Requests opens the wrong place)</label><input id="f" name="id_folder_url" value="${esc(settings.id_folder_url || '')}">
    </details>
    <input type="hidden" name="day_list_phone" value="${esc(settings.day_list_phone || '901-355-1518')}"><input type="hidden" name="day_list_email" value="${esc(settings.day_list_email || 'hello@porchandparty901.com')}">
    <div style="margin-top:16px">${act(`<button class="btn primary" type="submit"${tip('set.save')}>Save</button>`, 'set.save')}</div>
  </form>
  <section class="card"><h2>Google Calendar</h2>
    ${act(`<a class="btn" href="/admin/calendar/link"${tip('cal.link')}>Link my Google Calendar</a>`, 'cal.link')}
    <div style="margin-top:12px">${confirmStep({ key: 'set.newToken', yesKey: 'set.newTokenYes', label: 'Make a new private calendar link', question: 'Make a new calendar link? The old link stops working, so Google Calendar stops updating until you add the new link there again.', action: '/admin/settings/calendar-token', hidden: '', danger: true })}</div>
  </section>
  <form class="card" method="post" action="/admin/settings" enctype="multipart/form-data">
    <h2>My day list</h2>
    ${['zelle', 'cashapp', 'business_name', 'business_address', 'id_folder_url'].map((k) => `<input type="hidden" name="${k}" value="${esc(settings[k] || (k === 'business_name' ? 'Porch & Party' : ''))}">`).join('')}
    <label for="dlp">My phone number for my day list</label><input id="dlp" name="day_list_phone" type="tel" value="${esc(settings.day_list_phone || '901-355-1518')}">
    <label for="dle">My email for my day list</label><input id="dle" name="day_list_email" type="email" value="${esc(settings.day_list_email || 'hello@porchandparty901.com')}">
    <div style="margin-top:12px">${act(`<button class="btn" type="submit"${tip('set.saveDayList')}>Save my day list details</button>`, 'set.saveDayList')}</div>
  </form>
  <section class="card" data-weekly-settings><h2>Monday summary email</h2>
    <p>Every Monday at 7 AM: last week, this week and what needs you, to ${esc(settings.day_list_email || 'hello@porchandparty901.com')}. It is ${settings.weekly_summary === '0' ? '<strong>off</strong>' : '<strong>on</strong>'}.</p>
    <form method="post" action="/admin/settings/weekly">${hiddenInputs({ weekly_summary: settings.weekly_summary === '0' ? '1' : '0' })}${act(`<button class="btn ghost" type="submit"${tip('set.weeklyToggle')}>${settings.weekly_summary === '0' ? 'Turn the Monday summary on' : 'Turn the Monday summary off'}</button>`, 'set.weeklyToggle')}</form>
    <form method="post" action="/admin/settings/weekly-now" style="margin-top:10px">${act(`<button class="btn" type="submit"${tip('set.weeklyNow')}>Send me this week's summary now</button>`, 'set.weeklyNow')}</form>
  </section>
  <section class="card"><h2>Google Sheet</h2>
    <p>Your Bookings, Monthly totals and Expenses tabs in the request sheet update by themselves.${settings.sheet_synced_at ? ` Last updated ${esc(prettyDate(settings.sheet_synced_at.slice(0, 10)))}.` : ''}${pendingSync ? ' <strong>An update is waiting and will be tried again.</strong>' : ''}</p>
    <form method="post" action="/admin/settings/sheet-sync">${act(`<button class="btn ghost" type="submit"${tip('set.sheetSync')}>Update the Google Sheet now</button>`, 'set.sheetSync')}</form>
  </section>
  <form class="card" method="post" action="/admin/settings/holds" data-hold-settings><h2>Game rental holds</h2>
    <p class="muted">A rental booked on the website holds its games while the customer pays the deposit.</p>
    <label for="hh">How long a hold lasts (hours)</label><input id="hh" name="hold_hours" type="number" min="1" max="336" inputmode="numeric" value="${esc(settings.hold_hours || '24')}">
    <label class="row" style="color:var(--ink);gap:10px;min-height:48px"><input type="checkbox" name="hold_auto_expire" value="1"${settings.hold_auto_expire === '0' ? '' : ' checked'} style="width:24px;min-height:24px"> Expire unpaid holds automatically (off: every new hold is held by hand until you release it)</label>
    <label class="row" style="color:var(--ink);gap:10px;min-height:48px"><input type="checkbox" name="hold_reminder" value="1"${settings.hold_reminder === '0' ? '' : ' checked'} style="width:24px;min-height:24px"> Email the customer a reminder before the hold ends</label>
    <label for="hrh">Send that reminder this many hours before the end</label><input id="hrh" name="hold_reminder_hours" type="number" min="1" max="48" inputmode="numeric" value="${esc(settings.hold_reminder_hours || '4')}">
    <label for="hsh">Show "Holds ending soon" for holds ending within (hours)</label><input id="hsh" name="hold_soon_hours" type="number" min="1" max="72" inputmode="numeric" value="${esc(settings.hold_soon_hours || '12')}">
    <div style="margin-top:12px">${act(`<button class="btn primary" type="submit"${tip('set.holds')}>Save hold settings</button>`, 'set.holds')}</div>
  </form>
  <form class="card" method="post" action="/admin/settings/categories"><h2>Expense categories</h2>
    <label for="cats">One per line</label><textarea id="cats" name="categories" rows="8">${esc(categories.join('\n'))}</textarea>
    <div style="margin-top:12px">${act(`<button class="btn ghost" type="submit"${tip('set.categories')}>Save categories</button>`, 'set.categories')}</div>
  </form>
  <details class="disclose card" style="padding-top:0"><summary${tip('set.password')}>Change password</summary>
  <form method="post" action="/admin/settings/password">
    <label for="cur">Current password</label><input id="cur" name="current" type="password" autocomplete="current-password" required>
    <label for="np">New password (at least 10 letters or numbers)</label><input id="np" name="next" type="password" autocomplete="new-password" minlength="10" required>
    <label for="np2">New password again</label><input id="np2" name="confirm" type="password" autocomplete="new-password" minlength="10" required>
    <p class="muted">Changing it signs out every other phone or computer.</p>
    <button class="btn" type="submit"${tip('set.passwordSave')}>Change password</button>
  </form></details>`, { screen: 'settings', back: BACK_REQUESTS });
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
