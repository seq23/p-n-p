// Server-rendered pages for the /admin console. Built for one non-technical person on a phone:
// plain words, one obvious button per step, big tap targets (48 px+), 16 px+ type, no hover-only
// controls, no framework, no analytics. Secondary things fold under "More".
import { esc, money, lineTotal, invoiceTotal, prettyDate, STATUS_LABELS, SHEET_URL, SA_EMAIL, b64urlText, needsPrice, payPlanOf } from './util.mjs';

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

export function layout(title, body, { authed = true } = {}) {
  const nav = authed ? `<nav><a href="/admin/">Requests</a><a href="/admin/invoices">Invoices</a><a href="/admin/settings">Settings</a><a href="/admin/help">How this works</a>
    <form method="post" action="/admin/logout" style="display:inline"><button type="submit">Sign out</button></form></nav>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<meta name="format-detection" content="telephone=no">
<title>${esc(title)} · Porch &amp; Party</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<header class="top"><a class="brand" href="/admin/">Porch &amp; Party</a>${nav}</header>
<main class="wrap">${body}</main></body></html>`;
}

export function loginPage({ error = '', disabled = false } = {}) {
  return layout('Sign in', `<div class="card" style="max-width:420px;margin:24px auto">
  <h1>Sign in</h1>
  ${error ? `<div class="notice err">${esc(error)}</div>` : ''}
  ${disabled ? '<div class="notice warn">Sign-in is not switched on for this copy of the site.</div>' : ''}
  <form method="post" action="/admin/login">
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
    <div style="margin-top:16px"><button class="btn primary" type="submit">Sign in</button></div>
  </form></div>`, { authed: false });
}

function chip(status) {
  return `<span class="chip ${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;
}

function link(url, label) {
  if (!url) return '';
  const safe = /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/+/, '')}`;
  return `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label || url)}</a>`;
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
    const when = answerOf(r, /delivery date/i);
    parts.push(`Games: ${r.gamesAnswer}${how ? ` ${how}` : ''}${when ? `, ${when}` : ''}`);
  } else if (r.wantsRentals) parts.push('Game rentals');
  if (r.wantsDecor) {
    const when = answerOf(r, /event date/i);
    const take = /^\s*yes/i.test(r.takedownAnswer) ? ', with takedown' : '';
    parts.push(`Decor: ${r.eventType || 'setup'}${when ? `, ${when}` : ''}${take}`);
  }
  if (!parts.length && r.need) parts.push(r.need);
  return parts;
}

export function setupBanner(missing) {
  if (!missing.length) return '';
  return `<div class="notice warn"><strong>Finish setup: add your payment details.</strong><br>Customers need your ${esc(missing.join(', ').replace(/, ([^,]*)$/, ' and $1'))} to pay you.
    <div style="margin-top:10px"><a class="btn inline" href="/admin/settings">Open Settings</a></div></div>`;
}

export function dashboardPage({ requests, statuses, checklists = {}, folderUrl, sheetError, flash, missingPayment = [] }) {
  const top = `<div class="big-buttons">
    <a class="btn ghost" href="${esc(SHEET_URL)}" target="_blank" rel="noopener noreferrer">Open responses sheet</a>
    <a class="btn ghost" href="${esc(folderUrl)}" target="_blank" rel="noopener noreferrer">Open ID folder</a>
  </div>`;
  const err = sheetError ? `<div class="notice err"><strong>The requests could not be loaded right now.</strong> ${/not shared/i.test(sheetError)
    ? `The responses sheet needs to be shared with the site. In Google Sheets tap Share and add <code>${esc(SA_EMAIL)}</code> as a Viewer.`
    : 'Please try again in a minute.'}<div class="muted" style="margin-top:6px;font-size:.95rem">Details: ${esc(sheetError)}</div></div>` : '';
  const cards = requests.map((r) => {
    const st = statuses[r.key] || { status: 'new' };
    const rk = b64urlText(r.key);
    const cl = checklists[r.key];
    const want = wantSummary(r);
    return `<article class="card">
      <div class="spread"><h3 style="margin:0">${esc(r.name || 'No name given')}</h3>${chip(st.invoice_id && st.status === 'new' ? 'draft' : st.status)}</div>
      <div class="when">${esc(friendlyWhen(r))}</div>
      ${want.map((w) => `<div class="want">${esc(w)}</div>`).join('')}
      ${cl && cl !== 'none' ? `<div class="muted" style="margin-top:4px">Checklist ${cl === 'done' ? 'done ✓' : 'started'}</div>` : ''}
      <div class="actions three">
        <a class="btn ghost" href="/admin/checklist/online?r=${rk}">Open checklist</a>
        ${st.invoice_id ? `<a class="btn" href="/admin/invoices/${st.invoice_id}">Open invoice</a>` : `<a class="btn" href="/admin/invoices/new?r=${rk}">Create invoice</a>`}
        <a class="btn ghost" href="/admin/checklist?r=${rk}" target="_blank" rel="noopener">Print checklist</a>
      </div>
      <details class="more"><summary>More</summary>
        ${kv([
          ['Phone', r.phone ? `<a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>` : '', true],
          ['Email', r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '', true],
          ['Date of birth', r.dob],
          ['Social media', [r.social1, r.social2].filter(Boolean).map((u) => link(u)).join('<br>'), true],
          ['Photo ID', r.idFile ? r.idFile.split(/,\s*/).map((u, i) => link(u, i ? `Open ID photo ${i + 1}` : 'Open ID photo')).join('<br>') : '', true],
          ['Found us through', r.heard],
          ['What they picked', r.need],
          ...r.rentals.map((x) => [x.label, x.value]),
          ...r.decor.map((x) => [x.label, x.value]),
          ...r.other.map((x) => [x.label, x.value]),
        ])}
        <form method="post" action="/admin/requests/status">
          <input type="hidden" name="r" value="${rk}">
          <label for="st-${rk}">Change status by hand</label>
          <select id="st-${rk}" name="status">
            ${['new', 'invoiced', 'deposit_paid', 'paid', 'done'].map((s) => `<option value="${s}"${s === st.status ? ' selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
          </select><div style="margin-top:10px"><button class="btn ghost" type="submit">Save status</button></div>
        </form>
      </details>
    </article>`;
  }).join('');
  return layout('Requests', `${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}${setupBanner(missingPayment)}${top}${err}
    <h1>Requests</h1>
    ${requests.length ? cards : (sheetError ? '' : '<div class="card"><p style="margin:0">No requests yet. New ones from the website form show up here within a minute.</p></div>')}
    <details class="more"><summary>More</summary>
      <div class="actions"><a class="btn ghost" href="/admin/invoices/new">Start a blank invoice</a>
      <a class="btn ghost" href="/admin/checklist" target="_blank" rel="noopener">Print a blank checklist</a>
      <a class="btn ghost" href="/admin/?fresh=1">Check for new requests now</a></div>
    </details>`);
}

export function invoicesPage({ invoices }) {
  const rows = invoices.map((i) => `<tr><td><a href="/admin/invoices/${i.id}"><strong>${esc(i.customer_name || 'No name')}</strong></a><div class="muted">${esc(i.number)}</div></td>
    <td>${chip(i.status)}</td><td class="right">${money(i.total_cents)}</td></tr>`).join('');
  return layout('Invoices', `<h1>Invoices</h1>
    ${invoices.length ? `<div class="card"><table class="list">${rows}</table></div>` : '<div class="card"><p style="margin:0">No invoices yet. Tap <strong>Create invoice</strong> on a request to make one.</p></div>'}
    <a class="btn ghost" href="/admin/invoices/new">Start a blank invoice</a>`);
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
    <div style="margin-top:10px"><button type="button" class="btn danger" data-remove>Remove this line</button></div>
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

function paymentWarning(pay) {
  if (pay.complete) return '';
  return `<div class="notice warn"><strong>Payment details are missing.</strong> Add your ${esc(pay.missing.join(', ').replace(/, ([^,]*)$/, ' and $1'))} in Settings before sending, so the customer knows how to pay. If you send now, the email says "Payment details coming".
    <div style="margin-top:10px"><a class="btn inline ghost" href="/admin/settings">Open Settings</a></div></div>`;
}

// One screen: the prefilled invoice as the customer will see it, and ONE button that sends it.
// Changing anything is possible (under "Change the invoice") but never required.
export function invoiceEditorPage({ invoice, lines, request, action, title, warnings = [], pay, mode = 'new' }) {
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
      <div class="muted" style="word-break:break-all">${esc(invoice.customer_email || 'No email yet: add one under Change what goes into the total')}</div>
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
    <details class="more card" style="padding-top:0"${lines.some((l) => l.description && needsPrice(l)) ? ' open' : ''}><summary>Change what goes into the total</summary>
      <label for="cn">Customer name</label><input id="cn" name="customer_name" value="${esc(invoice.customer_name)}">
      <label for="ce">Customer email</label><input id="ce" name="customer_email" type="email" value="${esc(invoice.customer_email)}">
      <label for="cp">Customer phone</label><input id="cp" name="customer_phone" type="tel" value="${esc(invoice.customer_phone)}">
      <h3 style="margin-top:18px">Lines</h3>
      <div data-lines>${lines.map(lineEditor).join('')}</div>
      <template id="line-tpl">${lineEditor(blank)}</template>
      <button type="button" class="btn ghost" id="add-line">Add a line</button>
      <label for="nt">Message to the customer (optional)</label><textarea id="nt" name="notes">${esc(invoice.notes)}</textarea>
      <div style="margin-top:12px"><button class="btn ghost" type="submit" name="go" value="save">Save without sending</button></div>
    </details>
    <button class="btn primary" type="submit" name="go" value="preview">See it before sending</button>
    <button class="btn ghost" type="submit" name="go" value="send" style="margin-top:10px">${esc(sendLabel)} now</button>
  </form>
  <script>${EDITOR_JS}</script>`);
}

export function invoiceViewPage({ invoice, lines, pay, flash, error, emailHtml = '' }) {
  const total = invoiceTotal(lines);
  const plan = payPlanOf(invoice, total);
  const now = plan === 'full' ? total : invoice.deposit_due_cents;
  const id = invoice.id;
  const who = firstName(invoice.customer_name);
  const act = (action, label, cls = 'ghost') => `<form method="post" action="/admin/invoices/${id}/status"><input type="hidden" name="action" value="${action}"><button class="btn ${cls}" type="submit">${label}</button></form>`;
  const sendForm = (label, cls, test = false) => `<form method="post" action="/admin/invoices/${id}/send">${test ? '<input type="hidden" name="test" value="1">' : ''}<button class="btn ${cls}" type="submit">${label}</button></form>`;
  const voided = invoice.status === 'void';
  let main = '';
  if (voided) main = `<div class="actions">${act('unvoid', 'Bring this invoice back')}</div>`;
  else if (invoice.status === 'draft') main = `<div class="actions">${sendForm(`Send invoice to ${esc(who)}`, 'primary')}</div>`;
  else if (plan === 'full') main = `<div class="actions">${act('paid', 'Paid in full', invoice.status === 'sent' ? '' : 'ghost')}${sendForm('Resend', 'ghost')}</div>`;
  else main = `<div class="actions three">${act('deposit_paid', 'Deposit received', invoice.status === 'sent' ? '' : 'ghost')}${act('paid', 'Paid in full', invoice.status === 'deposit_paid' ? '' : 'ghost')}${sendForm('Resend', 'ghost')}</div>`;
  const preview = emailHtml && !voided ? `<div class="card" style="padding:0;overflow:hidden"><div class="muted" style="padding:10px 14px;border-bottom:1px solid var(--line)">The email the customer gets</div>
    <iframe class="emailframe" title="Invoice email" srcdoc="${esc(emailHtml)}" onload="try{this.style.height=(this.contentDocument.documentElement.scrollHeight+24)+'px'}catch(e){}"></iframe></div>` : '';
  return layout(invoice.customer_name || invoice.number, `<div class="spread"><h1 style="margin:0">${esc(invoice.customer_name || 'Invoice')}</h1>${chip(invoice.status)}</div>
  <p class="muted" style="margin-top:4px">Invoice ${esc(invoice.number)}${invoice.sent_at ? ` · last sent ${esc(prettyDate(invoice.sent_at.slice(0, 10)))}` : ' · not sent yet'}</p>
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
    </div>
  </div>
  ${invoice.status === 'draft' ? preview : ''}
  ${main}
  ${invoice.status !== 'draft' ? preview : ''}
  <details class="more"><summary>More</summary>
    <div class="actions">
      ${voided ? '' : `<a class="btn ghost" href="/admin/invoices/${id}/edit">Change the invoice</a>`}
      <a class="btn ghost" href="/admin/invoices/${id}/preview" target="_blank" rel="noopener">See the email</a>
      ${voided ? '' : sendForm('Send a test copy to hello@porchandparty901.com', 'ghost', true)}
      ${voided || invoice.status === 'done' ? '' : act('done', 'Job finished (mark done)')}
      ${voided ? '' : act('void', 'Cancel this invoice (void)', 'danger')}
    </div>
    <p class="muted">Email: ${esc(invoice.customer_email)}</p>
  </details>`);
}

export function helpPage() {
  const pic = (label, cls = '') => `<div class="pic"><span class="btn ${cls}">${esc(label)}</span></div>`;
  return layout('How this works', `<h1>How this works</h1>
  <div class="card"><ol class="steps">
    <li><strong>A request comes in.</strong> It shows up under Requests within a minute, newest at the top, marked <span class="chip new">New</span>.</li>
    <li><strong>Visit or call, and fill the checklist.</strong> Tap ${pic('Open checklist', 'ghost')} It saves by itself as you type. Or tap ${pic('Print checklist', 'ghost')} for the paper version.</li>
    <li><strong>Send the invoice.</strong> Tap ${pic('Create invoice')} Prices are already filled in. Check what goes into the total, pick <strong>Half now</strong>, <strong>Full amount</strong> or <strong>Other deposit</strong>, set the due date, then tap ${pic('See it before sending', 'primary')} The email shows on screen. When it looks right, tap ${pic('Send invoice to Jane', 'primary')}</li>
    <li><strong>When money arrives, tap one button.</strong> ${pic('Deposit received', 'ghost')} ${pic('Paid in full', 'ghost')} If they lost the email, tap ${pic('Resend', 'ghost')}</li>
  </ol></div>
  <div class="card"><h2>Good to know</h2>
    <p>Add your Zelle, Cash App and QR code once in Settings. They go on every invoice.</p><a class="btn ghost" href="/admin/settings">Open Settings</a>
    <p>Anything less common (change prices, cancel an invoice, see the email) is under <strong>More</strong>.</p>
    <p>A line that says <strong style="color:#8f3427">Price needed</strong> (usually decor) needs its price typed in under <strong>Change what goes into the total</strong> before it can be sent.</p>
    <p>With a deposit, the email asks for the deposit right away and shows the rest (total minus deposit) and its due date. With Full amount, it asks for the whole total by the due date.</p>
    <p style="margin-bottom:0">Every invoice is also copied to hello@porchandparty901.com.</p></div>`);
}

export function settingsPage({ settings, flash, error, hasQr }) {
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
    <details class="more"><summary>More</summary>
      <label for="bn">Business name on invoices</label><input id="bn" name="business_name" value="${esc(settings.business_name || 'Porch & Party')}">
      <label for="ba">Address line on invoices</label><input id="ba" name="business_address" placeholder="Memphis, Tennessee" value="${esc(settings.business_address || '')}">
      <label for="f">Link to the Google Drive folder with ID photos (only if the button on Requests opens the wrong place)</label><input id="f" name="id_folder_url" value="${esc(settings.id_folder_url || '')}">
    </details>
    <div style="margin-top:16px"><button class="btn primary" type="submit">Save</button></div>
  </form>
  <details class="more card" style="padding-top:0"><summary>Change password</summary>
  <form method="post" action="/admin/settings/password">
    <label for="cur">Current password</label><input id="cur" name="current" type="password" autocomplete="current-password" required>
    <label for="np">New password (at least 10 letters or numbers)</label><input id="np" name="next" type="password" autocomplete="new-password" minlength="10" required>
    <label for="np2">New password again</label><input id="np2" name="confirm" type="password" autocomplete="new-password" minlength="10" required>
    <p class="muted">Changing it signs out every other phone or computer.</p>
    <button class="btn" type="submit">Change password</button>
  </form></details>`);
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
    .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||r.status);grid.insertAdjacentHTML('beforeend','<figure data-photo="'+j.id+'"><a href="'+j.url+'" target="_blank" rel="noopener"><img src="'+j.url+'" alt="Walk-through photo" loading="lazy"></a><button type="button" class="btn danger" data-del="'+j.url+'">Delete</button></figure>');});})
    .then(next).catch(function(e){pstate.textContent='Photo not added: '+e.message;});})();});
  if(grid)grid.addEventListener('click',function(e){var u=e.target.dataset&&e.target.dataset.del;if(!u||!confirm('Delete this photo?'))return;
    fetch(u,{method:'DELETE',credentials:'same-origin'}).then(function(r){if(r.ok)e.target.closest('figure').remove();});});
})();`;

export function checklistOnlinePage({ request, rk, sections, photos, values, maxPhotos }) {
  const done = Boolean(values && values._done);
  return layout(`Checklist · ${request.name || 'request'}`, `<style>${CHECKLIST_CSS}</style>
  <div id="cl" data-save="/api/admin/checklist?r=${esc(rk)}" data-photos="/api/admin/checklist/photos?r=${esc(rk)}">
    <div class="savebar"><div><strong>${esc(request.name || 'No name given')}</strong> <span class="muted">· checklist</span></div>
      <div class="row"><span id="save-state">Saves by itself</span>
      </div></div>
    ${sections}
    <div class="card"><h3 style="margin-top:0">Photos <small class="muted">up to ${maxPhotos}</small></h3>
      <div class="photos" id="photos">${photos.map((p) => `<figure data-photo="${p.id}"><a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="Walk-through photo" loading="lazy"></a><button type="button" class="btn danger" data-del="${esc(p.url)}">Delete</button></figure>`).join('')}</div>
      <label class="btn ghost" style="color:var(--accent);margin:0">Add photos<input id="photo-input" type="file" accept="image/*" multiple style="display:none"></label>
      <div id="photo-state" class="muted" style="margin-top:6px"></div></div>
    <div class="card"><label class="ckl"><input type="checkbox" id="cl-done"${done ? ' checked' : ''}><span><strong>Checklist done</strong></span></label></div>
    <div class="actions three"><a class="btn" href="/admin/invoices/new?r=${esc(rk)}">Create invoice</a>
      <a class="btn ghost" href="/admin/checklist?r=${esc(rk)}" target="_blank" rel="noopener">Print checklist</a>
      <a class="btn ghost" href="/admin/">Back to requests</a></div>
  </div>
  <script>${CHECKLIST_JS}</script>`);
}
