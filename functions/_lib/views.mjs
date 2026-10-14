// Server-rendered pages for the /admin console. Phone-width first (360 px up),
// no framework, no analytics, one small inline script on the invoice editor.
import { esc, money, lineTotal, invoiceTotal, prettyDate, STATUS_LABELS, SHEET_URL, SA_EMAIL, b64urlText } from './util.mjs';

const CSS = `
:root{--cream:#faf7f2;--ink:#3b302a;--accent:#c46e4e;--line:#e8dfd4;--muted:#7a6b60;--card:#fff;--ok:#4f7a4a;--warn:#a5671f}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--cream);color:var(--ink);font:16px/1.5 Inter,"Helvetica Neue",Arial,sans-serif}
a{color:var(--accent)}h1,h2,h3{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;line-height:1.15;margin:0 0 .4em}
h1{font-size:2rem}h2{font-size:1.5rem}h3{font-size:1.25rem}
.wrap{max-width:860px;margin:0 auto;padding:16px}
header.top{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--card)}
header.top .brand{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.4rem;font-weight:600;text-decoration:none;color:var(--ink)}
header.top nav{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:.95rem}
.big-buttons{display:grid;grid-template-columns:1fr;gap:12px;margin:8px 0 20px}
@media(min-width:560px){.big-buttons{grid-template-columns:1fr 1fr}}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:10px 16px;border-radius:10px;border:1px solid var(--accent);background:var(--accent);color:#fff;font:600 1rem Inter,Arial,sans-serif;text-decoration:none;cursor:pointer}
.btn.big{min-height:64px;font-size:1.1rem}.btn.ghost{background:transparent;color:var(--accent)}.btn.danger{background:#fff;color:#9b3b2e;border-color:#9b3b2e}
.btn.small{min-height:36px;padding:6px 12px;font-size:.9rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 14px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.chip{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.8rem;font-weight:600;border:1px solid var(--line);background:var(--cream)}
.chip.new{background:#fdeee8;border-color:#f0c6b6;color:#8a3f24}.chip.invoiced,.chip.sent{background:#eef2fb;border-color:#c9d3ee;color:#33457a}
.chip.deposit_paid{background:#fff6e5;border-color:#f0d9a8;color:var(--warn)}.chip.paid{background:#eaf4e8;border-color:#bcd9b6;color:var(--ok)}
.chip.done{background:#ececec;color:#555}.chip.void{background:#f4e1de;color:#9b3b2e}.chip.draft{background:#f3efe9}
dl.kv{display:grid;grid-template-columns:1fr;gap:2px 12px;margin:8px 0}dl.kv dt{color:var(--muted);font-size:.85rem}dl.kv dd{margin:0 0 6px;word-break:break-word}
@media(min-width:560px){dl.kv{grid-template-columns:minmax(130px,34%) 1fr}dl.kv dd{margin:0}}
details summary{cursor:pointer;font-weight:600;padding:4px 0}
label{display:block;font-size:.9rem;color:var(--muted);margin:10px 0 4px}
input,select,textarea{width:100%;font:16px Inter,Arial,sans-serif;padding:10px;border:1px solid var(--line);border-radius:8px;background:#fff;color:var(--ink)}
textarea{min-height:80px}
.notice{border-radius:10px;padding:12px 14px;margin:0 0 14px;border:1px solid}
.notice.warn{background:#fff6e5;border-color:#f0d9a8}.notice.err{background:#f9e5e1;border-color:#e8b9b0}.notice.ok{background:#eaf4e8;border-color:#bcd9b6}
.line{border:1px solid var(--line);border-radius:10px;padding:10px;margin:0 0 10px;background:var(--cream)}
.line .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media(min-width:640px){.line .grid{grid-template-columns:3fr 1fr 1.3fr 1.3fr}}
.totals{font-size:1.05rem}.totals strong{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.4rem}
table.list{width:100%;border-collapse:collapse}table.list td{padding:8px 4px;border-bottom:1px solid var(--line);vertical-align:top}
.muted{color:var(--muted)}.right{text-align:right}
`;

export function layout(title, body, { authed = true } = {}) {
  const nav = authed ? `<nav><a href="/admin/">Requests</a><a href="/admin/invoices">Invoices</a><a href="/admin/checklist" target="_blank" rel="noopener">Print</a><a href="/admin/settings">Settings</a>
    <form method="post" action="/admin/logout" style="display:inline"><button class="btn ghost small" type="submit">Sign out</button></form></nav>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · Porch &amp; Party admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>
<header class="top"><a class="brand" href="/admin/">Porch &amp; Party</a>${nav}</header>
<main class="wrap">${body}</main></body></html>`;
}

export function loginPage({ error = '', disabled = false } = {}) {
  return layout('Sign in', `<div class="card" style="max-width:420px;margin:24px auto">
  <h1>Sign in</h1>
  ${error ? `<div class="notice err">${esc(error)}</div>` : ''}
  ${disabled ? '<div class="notice warn">Sign-in is not set up on this deployment yet.</div>' : ''}
  <form method="post" action="/admin/login">
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
    <div style="margin-top:14px"><button class="btn" type="submit" style="width:100%">Sign in</button></div>
  </form></div>`, { authed: false });
}

function chip(status) {
  return `<span class="chip ${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;
}

function link(url, label) {
  if (!url) return '<span class="muted">none</span>';
  const safe = /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/+/, '')}`;
  return `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label || url)}</a>`;
}

function kv(items) {
  const rows = items.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!rows.length) return '';
  return `<dl class="kv">${rows.map(([k, v, raw]) => `<dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd>`).join('')}</dl>`;
}

export function dashboardPage({ requests, statuses, checklists = {}, folderUrl, sheetError, flash }) {
  const top = `<div class="big-buttons">
    <a class="btn big" href="${esc(SHEET_URL)}" target="_blank" rel="noopener noreferrer">Open responses sheet</a>
    <a class="btn big ghost" href="${esc(folderUrl)}" target="_blank" rel="noopener noreferrer">Open ID folder</a>
  </div>`;
  const err = sheetError ? `<div class="notice err"><strong>Could not read the requests.</strong> ${esc(sheetError)}
    ${/not shared/i.test(sheetError) ? `<br>Share the sheet (Viewer) with <code>${esc(SA_EMAIL)}</code>.` : ''}</div>` : '';
  const cards = requests.map((r) => {
    const st = statuses[r.key] || { status: 'new' };
    const rk = b64urlText(r.key);
    return `<article class="card">
      <div class="row" style="justify-content:space-between"><h3 style="margin:0">${esc(r.name || '(no name)')}</h3><span class="row" style="gap:6px">${checklists[r.key] && checklists[r.key] !== 'none' ? `<span class="chip ${checklists[r.key] === 'done' ? 'paid' : 'deposit_paid'}">Checklist ${checklists[r.key]}</span>` : ''}${chip(st.status)}</span></div>
      <div class="muted" style="font-size:.9rem">${esc(r.timestamp)}${r.need ? ` · ${esc(r.need)}` : ''}</div>
      ${kv([
        ['Email', r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '', true],
        ['Phone', r.phone ? `<a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>` : '', true],
        ['Date of birth', r.dob],
        ['Social', r.social1 ? link(r.social1) : '', true],
        ['Second social', r.social2 ? link(r.social2) : '', true],
        ['Photo ID', r.idFile ? r.idFile.split(/,\s*/).map((u, i) => link(u, `ID file${i ? ` ${i + 1}` : ''}`)).join(' · ') : '', true],
        ['Heard about us', r.heard],
      ])}
      ${r.rentals.length ? `<details open><summary>Game rentals</summary>${kv(r.rentals.map((x) => [x.label, x.value]))}</details>` : ''}
      ${r.decor.length ? `<details open><summary>Decor</summary>${kv(r.decor.map((x) => [x.label, x.value]))}</details>` : ''}
      ${r.other.length ? `<details><summary>Other answers</summary>${kv(r.other.map((x) => [x.label, x.value]))}</details>` : ''}
      <div class="row" style="margin-top:10px">
        ${st.invoice_id ? `<a class="btn small" href="/admin/invoices/${st.invoice_id}">Open invoice</a>` : `<a class="btn small" href="/admin/invoices/new?r=${rk}">Create invoice</a>`}
        <a class="btn ghost small" href="/admin/checklist/online?r=${rk}">Open checklist</a>
        <a class="btn ghost small" href="/admin/checklist?r=${rk}" target="_blank" rel="noopener">Print checklist</a>
        <form method="post" action="/admin/requests/status" class="row" style="gap:6px">
          <input type="hidden" name="r" value="${rk}">
          <select name="status" aria-label="Status" style="width:auto;min-height:36px;padding:6px">
            ${['new', 'invoiced', 'deposit_paid', 'paid', 'done'].map((s) => `<option value="${s}"${s === st.status ? ' selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
          </select><button class="btn ghost small" type="submit">Set</button>
        </form>
      </div>
    </article>`;
  }).join('');
  return layout('Requests', `${top}${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}${err}
    <div class="row" style="justify-content:space-between"><h1>Requests</h1><span class="row" style="gap:6px"><a class="btn ghost small" href="/admin/checklist" target="_blank" rel="noopener">Blank checklist</a><a class="btn ghost small" href="/admin/invoices/new">Blank invoice</a></span></div>
    ${requests.length ? cards : (sheetError ? '' : '<p class="muted">No requests yet.</p>')}`);
}

export function invoicesPage({ invoices }) {
  const rows = invoices.map((i) => `<tr><td><a href="/admin/invoices/${i.id}">${esc(i.number)}</a><div class="muted" style="font-size:.85rem">${esc(i.customer_name)}</div></td>
    <td>${chip(i.status)}</td><td class="right">${money(i.total_cents)}</td></tr>`).join('');
  return layout('Invoices', `<div class="row" style="justify-content:space-between"><h1>Invoices</h1><a class="btn small" href="/admin/invoices/new">Blank invoice</a></div>
    ${invoices.length ? `<div class="card"><table class="list">${rows}</table></div>` : '<p class="muted">No invoices yet.</p>'}`);
}

function lineEditor(line) {
  return `<div class="line" data-line>
    <div class="grid">
      <div style="grid-column:1/-1"><label>Item</label><input name="line_desc" value="${esc(line.description)}" required></div>
      <div><label>Qty</label><input name="line_qty" type="number" step="any" min="0" inputmode="decimal" value="${esc(line.qty)}" data-qty></div>
      <div><label>Price ($)</label><input name="line_price" type="number" step="0.01" inputmode="decimal" value="${esc((line.unit_cents / 100).toFixed(2))}" data-price></div>
      <div><label>Refundable</label><select name="line_refundable"><option value="0"${line.refundable ? '' : ' selected'}>No</option><option value="1"${line.refundable ? ' selected' : ''}>Yes</option></select></div>
      <div><label>Line total</label><div data-linetotal style="padding:10px 0">${money(lineTotal(line))}</div></div>
      <div style="grid-column:1/-1"><label>Note</label><input name="line_note" value="${esc(line.note)}"></div>
    </div>
    <button type="button" class="btn danger small" data-remove style="margin-top:8px">Remove line</button>
  </div>`;
}

const EDITOR_JS = `
(function(){
  var form=document.getElementById('inv');if(!form)return;
  var list=form.querySelector('[data-lines]'),tpl=document.getElementById('line-tpl'),dep=form.querySelector('[name=deposit]');
  var depTouched=dep&&dep.dataset.touched==='1';
  function fmt(c){return '$'+(c/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function recalc(){var t=0;list.querySelectorAll('[data-line]').forEach(function(el){var q=parseFloat(el.querySelector('[data-qty]').value)||0,p=Math.round((parseFloat(el.querySelector('[data-price]').value)||0)*100),lt=Math.round(q*p);t+=lt;el.querySelector('[data-linetotal]').textContent=fmt(lt);});
    document.getElementById('total').textContent=fmt(t);if(dep&&!depTouched){dep.value=(Math.round(t/2)/100).toFixed(2);}
    document.getElementById('half').textContent=fmt(Math.round(t/2));}
  form.addEventListener('input',function(e){if(e.target===dep){depTouched=true;form.querySelector('[name=deposit_touched]').value='1';}recalc();});
  form.addEventListener('click',function(e){if(e.target.matches('[data-remove]')){e.target.closest('[data-line]').remove();recalc();}});
  document.getElementById('add-line').addEventListener('click',function(){list.insertAdjacentHTML('beforeend',tpl.innerHTML);recalc();});
  recalc();
})();`;

export function invoiceEditorPage({ invoice, lines, request, action, title, warnings = [] }) {
  const total = invoiceTotal(lines);
  const blank = { description: '', qty: 1, unit_cents: 0, note: '', refundable: 0 };
  return layout(title, `<h1>${esc(title)}</h1>
  ${warnings.map((w) => `<div class="notice warn">${esc(w)}</div>`).join('')}
  ${request ? `<div class="card"><div class="muted" style="font-size:.9rem">From the request of ${esc(request.timestamp)}</div>
    ${request.gamesAnswer ? `<div><strong>Games:</strong> ${esc(request.gamesAnswer)}${request.durationAnswer ? ` · ${esc(request.durationAnswer)}` : ''}</div>` : ''}
    ${request.eventType ? `<div><strong>Decor:</strong> ${esc(request.eventType)}${request.takedownAnswer ? ` · takedown: ${esc(request.takedownAnswer)}` : ''}</div>` : ''}</div>` : ''}
  <form id="inv" method="post" action="${esc(action)}">
    ${request ? `<input type="hidden" name="r" value="${esc(b64urlText(request.key))}">` : ''}
    <div class="card">
      <label for="cn">Customer name</label><input id="cn" name="customer_name" value="${esc(invoice.customer_name)}" required>
      <label for="ce">Customer email</label><input id="ce" name="customer_email" type="email" value="${esc(invoice.customer_email)}" required>
      <label for="cp">Customer phone</label><input id="cp" name="customer_phone" type="tel" value="${esc(invoice.customer_phone)}">
      <div class="row" style="gap:12px"><div style="flex:1;min-width:140px"><label for="id">Issue date</label><input id="id" name="issue_date" type="date" value="${esc(invoice.issue_date)}" required></div>
      <div style="flex:1;min-width:140px"><label for="dd">Due date</label><input id="dd" name="due_date" type="date" value="${esc(invoice.due_date)}" required></div></div>
    </div>
    <h2>Lines</h2>
    <div data-lines>${lines.map(lineEditor).join('')}</div>
    <template id="line-tpl">${lineEditor(blank)}</template>
    <button type="button" class="btn ghost" id="add-line">Add line</button>
    <div class="card totals" style="margin-top:14px">
      <div class="row" style="justify-content:space-between"><span>Total</span><strong id="total">${money(total)}</strong></div>
      <div class="muted" style="font-size:.9rem">50% of total: <span id="half">${money(Math.round(total / 2))}</span></div>
      <label for="dep">Deposit due now ($)</label>
      <input id="dep" name="deposit" type="number" step="0.01" inputmode="decimal" value="${esc((invoice.deposit_due_cents / 100).toFixed(2))}" data-touched="${invoice.deposit_touched ? '1' : '0'}">
      <input type="hidden" name="deposit_touched" value="${invoice.deposit_touched ? '1' : '0'}">
      <label for="nt">Notes for the customer</label><textarea id="nt" name="notes">${esc(invoice.notes)}</textarea>
    </div>
    <button class="btn" type="submit" style="width:100%">Save invoice</button>
  </form>
  <script>${EDITOR_JS}</script>`);
}

export function invoiceViewPage({ invoice, lines, pay, flash, error }) {
  const total = invoiceTotal(lines);
  const id = invoice.id;
  const act = (action, label, cls = 'ghost') => `<form method="post" action="/admin/invoices/${id}/status"><input type="hidden" name="action" value="${action}"><button class="btn ${cls} small" type="submit">${label}</button></form>`;
  const editable = invoice.status !== 'void';
  return layout(invoice.number, `<div class="row" style="justify-content:space-between"><h1 style="margin:0">${esc(invoice.number)}</h1>${chip(invoice.status)}</div>
  <p class="muted">${esc(invoice.customer_name)} · <a href="mailto:${esc(invoice.customer_email)}">${esc(invoice.customer_email)}</a>${invoice.sent_at ? ` · last sent ${esc(invoice.sent_at)} UTC` : ''}</p>
  ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}
  <div class="card"><table class="list">
    ${lines.map((l) => `<tr><td>${esc(l.description)}${Number(l.qty) !== 1 ? ` × ${esc(l.qty)}` : ''}${l.refundable ? ' <span class="chip">refundable</span>' : ''}${l.note ? `<div class="muted" style="font-size:.85rem">${esc(l.note)}</div>` : ''}</td><td class="right">${money(lineTotal(l))}</td></tr>`).join('')}
    <tr><td><strong>Total</strong></td><td class="right"><strong>${money(total)}</strong></td></tr>
    <tr><td>Deposit due now</td><td class="right">${money(invoice.deposit_due_cents)}</td></tr>
    <tr><td>Due date</td><td class="right">${esc(prettyDate(invoice.due_date))}</td></tr>
  </table></div>
  ${editable ? `<div class="card"><h2>Send</h2>
    ${pay.complete ? '' : `<div class="notice warn"><strong>Payment details are incomplete.</strong> Missing: ${esc(pay.missing.join(', '))}. The email will say "Payment details coming". <a href="/admin/settings">Add them in Settings</a>.</div>`}
    ${lines.some((l) => lineTotal(l) === 0 && l.note !== 'free') ? '<div class="notice warn">One or more lines are $0. Check prices before sending.</div>' : ''}
    <form method="post" action="/admin/invoices/${id}/send">
      <label class="row" style="color:var(--ink);gap:8px"><input type="checkbox" name="test" value="1" style="width:auto"> Test send: only to hello@porchandparty901.com, subject starts with TEST, status unchanged</label>
      <div class="row" style="margin-top:10px"><button class="btn" type="submit">${invoice.sent_at ? 'Resend invoice' : 'Send invoice'}</button>
      <a class="btn ghost" href="/admin/invoices/${id}/preview" target="_blank" rel="noopener">Preview email</a></div>
    </form></div>` : ''}
  <div class="card"><h2>Status</h2><div class="row">
    ${editable ? act('deposit_paid', 'Mark deposit paid') + act('paid', 'Mark paid') + act('done', 'Mark done') + act('void', 'Void', 'danger') : act('unvoid', 'Restore as draft')}
  </div></div>
  ${editable ? `<p><a class="btn ghost" href="/admin/invoices/${id}/edit">Edit invoice</a></p>` : ''}`);
}

export function settingsPage({ settings, flash, error, hasQr }) {
  return layout('Settings', `<h1>Settings</h1>
  ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}
  <form class="card" method="post" action="/admin/settings" enctype="multipart/form-data">
    <h2>Payment details</h2>
    <label for="z">Zelle handle (email or phone)</label><input id="z" name="zelle" value="${esc(settings.zelle || '')}">
    <label for="c">Cash App cashtag</label><input id="c" name="cashapp" placeholder="$yourtag" value="${esc(settings.cashapp || '')}">
    <label for="q">Payment QR code image (PNG or JPEG, up to 1 MB)</label>
    ${hasQr ? '<div style="margin:6px 0"><img src="/api/admin/qr.png" alt="Current QR code" width="140" height="140" style="border:1px solid var(--line);border-radius:8px"></div>' : '<div class="muted">No QR code yet.</div>'}
    <input id="q" name="qr" type="file" accept="image/png,image/jpeg">
    ${hasQr ? '<label class="row" style="color:var(--ink);gap:8px"><input type="checkbox" name="remove_qr" value="1" style="width:auto"> Remove the QR code</label>' : ''}
    <h2 style="margin-top:18px">Invoice footer</h2>
    <label for="bn">Business name</label><input id="bn" name="business_name" value="${esc(settings.business_name || 'Porch & Party')}">
    <label for="ba">Address line</label><input id="ba" name="business_address" placeholder="Memphis, Tennessee" value="${esc(settings.business_address || '')}">
    <h2 style="margin-top:18px">ID folder</h2>
    <label for="f">Google Drive folder link for uploaded IDs (optional; found automatically when possible)</label><input id="f" name="id_folder_url" value="${esc(settings.id_folder_url || '')}">
    <div style="margin-top:14px"><button class="btn" type="submit">Save settings</button></div>
  </form>
  <form class="card" method="post" action="/admin/settings/password">
    <h2>Change password</h2>
    <label for="cur">Current password</label><input id="cur" name="current" type="password" autocomplete="current-password" required>
    <label for="np">New password (at least 10 characters)</label><input id="np" name="next" type="password" autocomplete="new-password" minlength="10" required>
    <label for="np2">New password again</label><input id="np2" name="confirm" type="password" autocomplete="new-password" minlength="10" required>
    <div class="muted" style="font-size:.9rem;margin-top:6px">Changing it signs out every other device.</div>
    <div style="margin-top:14px"><button class="btn" type="submit">Change password</button></div>
  </form>`);
}

const CHECKLIST_CSS = `
.sec summary{font-family:"Cormorant Garamond",Georgia,serif;font-size:1.35rem;padding:6px 0}.sec summary span{font:600 .75rem Inter,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin-right:6px}
.sec h3{margin:16px 0 6px;color:var(--accent)}.sec h3 small{font:500 .75rem Inter,Arial,sans-serif;text-transform:uppercase;letter-spacing:.04em}
.cks{display:grid;grid-template-columns:1fr;gap:2px}@media(min-width:640px){.cks{grid-template-columns:1fr 1fr}}
.ckl{display:flex;gap:10px;align-items:flex-start;color:var(--ink);font-size:1rem;margin:0;padding:8px 4px;border-radius:8px}
.ckl input{width:22px;height:22px;flex:none;margin:1px 0 0;accent-color:var(--accent)}
.fld{margin:0 0 4px}.quote .qrow{border-bottom:1px solid var(--line);padding:8px 0}.qlabel{font-weight:600}
.quote .qrow label{display:none}.quote .qrow>div{margin-top:6px}
.savebar{position:sticky;top:0;z-index:2;background:var(--cream);padding:8px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);margin-bottom:12px}
#save-state{font-size:.9rem;color:var(--muted)}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;margin:10px 0}
.photos figure{margin:0;position:relative}.photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:1px solid var(--line);display:block}
.photos button{position:absolute;top:4px;right:4px;min-height:28px;padding:2px 8px;font-size:.8rem}
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
    .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||r.status);grid.insertAdjacentHTML('beforeend','<figure data-photo="'+j.id+'"><a href="'+j.url+'" target="_blank" rel="noopener"><img src="'+j.url+'" alt="Walk-through photo" loading="lazy"></a><button type="button" class="btn danger small" data-del="'+j.url+'">Delete</button></figure>');});})
    .then(next).catch(function(e){pstate.textContent='Photo not added: '+e.message;});})();});
  if(grid)grid.addEventListener('click',function(e){var u=e.target.dataset&&e.target.dataset.del;if(!u||!confirm('Delete this photo?'))return;
    fetch(u,{method:'DELETE',credentials:'same-origin'}).then(function(r){if(r.ok)e.target.closest('figure').remove();});});
})();`;

export function checklistOnlinePage({ request, rk, sections, photos, values, maxPhotos }) {
  const done = Boolean(values && values._done);
  return layout(`Checklist · ${request.name || 'request'}`, `<style>${CHECKLIST_CSS}</style>
  <div id="cl" data-save="/api/admin/checklist?r=${esc(rk)}" data-photos="/api/admin/checklist/photos?r=${esc(rk)}">
    <div class="savebar"><div><strong>${esc(request.name || '(no name)')}</strong> <span class="muted">· walk-through</span></div>
      <div class="row"><span id="save-state">Saved</span>
      <a class="btn ghost small" href="/admin/checklist?r=${esc(rk)}" target="_blank" rel="noopener">Print</a>
      <a class="btn small" href="/admin/invoices/new?r=${esc(rk)}">Create invoice</a></div></div>
    ${sections}
    <div class="card"><h3 style="margin-top:0">Photos <small class="muted">up to ${maxPhotos}</small></h3>
      <div class="photos" id="photos">${photos.map((p) => `<figure data-photo="${p.id}"><a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="Walk-through photo" loading="lazy"></a><button type="button" class="btn danger small" data-del="${esc(p.url)}">Delete</button></figure>`).join('')}</div>
      <label class="btn ghost" style="display:inline-flex;color:var(--accent)">Add photos<input id="photo-input" type="file" accept="image/*" multiple style="display:none"></label>
      <div id="photo-state" class="muted" style="font-size:.9rem;margin-top:6px"></div></div>
    <div class="card"><label class="ckl"><input type="checkbox" id="cl-done"${done ? ' checked' : ''}><span><strong>Checklist done</strong></span></label></div>
  </div>
  <script>${CHECKLIST_JS}</script>`);
}
