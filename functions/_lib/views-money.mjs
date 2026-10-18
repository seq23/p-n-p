// Money tab screens: the month in big plain numbers, a 12-month list, details behind each
// total, expenses with receipts, and the year-end summary for taxes. Same rules as views.mjs.
import { esc, money, shortDate, prettyDate } from './util.mjs';
import { tip } from './helptext.mjs';
import { layout, act, confirmStep, hiddenInputs, BACK_REQUESTS } from './views.mjs';
import { CATEGORY_KEYS, CATEGORY_LABELS, METHOD_LABELS, FOOTER } from './money.mjs';
import { KIND_LABELS } from './kinds.mjs';
import { LOW_CONFIDENCE } from './expenses.mjs';

const MONEY_CSS = `
.big{font-size:1.5rem;font-weight:700;margin:4px 0}.big small{display:block;font-size:.95rem;font-weight:400;color:var(--muted)}
.tot{display:block;text-decoration:none;color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 10px;background:#fff}
.mbar{height:12px;background:#dbeafe;border-radius:6px;margin-top:4px}.mbar span{display:block;height:12px;background:#1d4ed8;border-radius:6px}
.amber{border:2px solid #d97706 !important;background:#fff8ea}.amber-note{color:#7a4a0c;font-weight:700;font-size:.95rem}
.exp{display:block;padding:10px 0;border-bottom:1px solid var(--line);text-decoration:none;color:var(--ink)}
@media print{.noprint{display:none!important}}
`;

const monthName = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shift = (m, n) => { const d = new Date(`${m}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };

const UPLOAD_JS = `
(function(){
  var input=document.getElementById('receipt-input'),st=document.getElementById('receipt-state');if(!input)return;
  function shrink(f){return new Promise(function(res,rej){var img=new Image();img.onload=function(){var s=Math.min(1,1600/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);c.toBlob(function(b){b?res(b):rej(new Error('could not read that picture'));},'image/jpeg',0.85);};img.onerror=function(){rej(new Error('could not read that picture'));};img.src=URL.createObjectURL(f);});}
  input.addEventListener('change',function(){var files=[].slice.call(input.files);input.value='';var first=null,n=0;
    (function next(){var f=files.shift();if(!f){st.textContent='';if(first)location.href='/admin/money/expenses/'+first;return;}n++;st.textContent='Reading receipt '+n+'… (this can take half a minute)';
      var body=/pdf$/i.test(f.type)?Promise.resolve(f):shrink(f);
      body.then(function(b){return fetch('/api/admin/receipts',{method:'POST',headers:{'Content-Type':/pdf$/i.test(f.type)?'application/pdf':'image/jpeg'},body:b,credentials:'same-origin'});})
      .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||r.status);if(!first)first=j.id;});}).then(next).catch(function(e){st.textContent='Receipt not added: '+e.message;});})();});
})();`;

export function moneyPage({ month, year, t, months, needs, recent, depositsHeld, flash = '', error = '' }) {
  const tot = (what, label, value, sub = '') => `<a class="tot" href="/admin/money/detail?month=${month}&amp;what=${what}"${tip('mon.total')}><div class="muted">${esc(label)}</div><div class="big" data-total="${what}">${esc(value)}${sub ? `<small>${esc(sub)}</small>` : ''}</div></a>`;
  const max = Math.max(1, ...months.map((m) => m.received));
  return layout('Money', `<style>${MONEY_CSS}</style>
    ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}
    <h1>Money: ${esc(monthName(month))}</h1>
    <div class="monthbar">
      <a class="btn ghost" href="/admin/money?month=${shift(month, -1)}"${tip('mon.prev')}>&lsaquo; Previous</a>
      <a class="btn ghost" href="/admin/money"${tip('mon.this')}>This month</a>
      <a class="btn ghost" href="/admin/money?month=${shift(month, 1)}"${tip('mon.next')}>Next &rsaquo;</a>
    </div>
    <section class="card">
      ${tot('received', 'Money received', `Money received: ${money(t.received)}`, t.depositsIn ? `includes ${money(t.depositsIn)} of damage deposits (not income)` : '')}
      ${tot('owed', "Still owed for this month's jobs", `Still owed for this month's jobs: ${money(t.owed)}`)}
      ${tot('jobs', 'Jobs this month', `Jobs this month: ${t.jobs}`)}
      ${tot('expenses', 'Expenses', `Expenses: ${money(t.expenses)}`)}
      <div class="tot" data-left><div class="muted">A simple difference (income minus expenses), not profit or tax</div><div class="big">Left after expenses: ${esc(money(t.left))}</div></div>
      <h3>By service</h3>
      ${CATEGORY_KEYS.map((k) => tot(`category:${k}`, CATEGORY_LABELS[k], `${CATEGORY_LABELS[k]}: ${money(t.byCategory[k] || 0)}`)).join('')}
      ${tot('deposits', 'Damage deposits (never income)', `Damage deposits held: ${money(depositsHeld)} · refunded: ${money(t.depositRefunds)}`, t.kept ? `kept for damage this month: ${money(t.kept)} (income)` : '')}
    </section>
    <section class="card"><h2>Expenses</h2>
      <ol class="steps"><li>Take a photo of the receipt (or pick one).</li><li>Check what the computer read — fix anything wrong.</li><li>Tap Save.</li></ol>
      <div class="actions">
        ${act(`<label class="btn primary"${tip('exp.add')}>Add a receipt<input id="receipt-input" type="file" accept="image/*,application/pdf" multiple style="display:none"></label>`, 'exp.add')}
        ${act(`<a class="btn ghost" href="/admin/money/expenses/new"${tip('exp.manual')}>Type it in instead</a>`, 'exp.manual')}
      </div>
      <div id="receipt-state" class="muted" aria-live="polite"></div>
      ${needs.length ? `<h3>Needs checking</h3>${needs.map((e) => `<a class="exp" href="/admin/money/expenses/${e.id}"${tip('exp.open')}><strong>${esc(e.vendor || 'Receipt')}</strong> · ${esc(e.date || 'no date')} · ${esc(money(e.total_cents))} <span class="money owe">Needs checking</span></a>`).join('')}` : ''}
      <h3>Saved</h3>${recent.length ? recent.map((e) => `<a class="exp" href="/admin/money/expenses/${e.id}"${tip('exp.open')}><strong>${esc(e.vendor || 'Expense')}</strong> · ${esc(shortDate(e.date))} · ${esc(e.category)} · ${esc(money(e.total_cents))}</a>`).join('') : '<p class="muted">No expenses yet.</p>'}
    </section>
    <section class="card"><h2>${esc(year)}, month by month</h2>
      <div class="monthbar">
        <a class="btn ghost" href="/admin/money?month=${month}&amp;year=${Number(year) - 1}"${tip('mon.yearPrev')}>&lsaquo; ${Number(year) - 1}</a>
        ${act(`<a class="btn" href="/admin/money/year?year=${year}"${tip('mon.taxes')}>Year-end summary for taxes</a>`, 'mon.taxes')}
        <a class="btn ghost" href="/admin/money?month=${month}&amp;year=${Number(year) + 1}"${tip('mon.yearNext')}>${Number(year) + 1} &rsaquo;</a>
      </div>
      <table class="sumlines" data-year-list>${months.map((m) => `<tr><td><a href="/admin/money?month=${m.month}"${tip('mon.month')}>${esc(monthName(m.month))}</a><div class="mbar" role="presentation"><span style="width:${Math.round((m.received / max) * 100)}%"></span></div></td>
        <td class="amt">${esc(money(m.received))}<div class="muted">${m.jobs} ${m.jobs === 1 ? 'job' : 'jobs'}</div></td></tr>`).join('')}</table>
    </section>
    <script>${UPLOAD_JS}</script>`, { screen: 'money', back: BACK_REQUESTS });
}

export function detailPage({ month, what, t, byInv }) {
  let title = ''; let rows = '';
  const payRow = (p) => { const x = byInv[p.invoice_id]; return `<tr><td>${esc(shortDate(p.received_on))} · ${esc(x ? x.inv.customer_name : '')} <span class="muted">${esc(x ? x.inv.number : '')}</span><div class="muted">${esc(p.kind === 'payment' ? (METHOD_LABELS[p.method] || p.method || 'Not recorded') : p.note)}</div></td><td class="amt">${esc(money(p.amount_cents))}</td></tr>`; };
  if (what === 'received') { title = 'Money received'; rows = t.payments.filter((p) => p.kind === 'payment').map(payRow).join(''); }
  else if (what === 'deposits') { title = 'Damage deposits'; rows = t.payments.filter((p) => p.deposit > 0 || p.kind !== 'payment').map(payRow).join(''); }
  else if (what === 'owed') { title = "Still owed for this month's jobs"; rows = t.owedList.map((o) => `<tr><td><a href="/admin/invoices/${o.invoice.id}"${tip('card.openInvoice')}>${esc(o.invoice.customer_name)}</a> · ${esc(KIND_LABELS[o.booking.kind])} ${esc(shortDate(o.booking.date))}</td><td class="amt">${esc(money(o.owed))}</td></tr>`).join(''); }
  else if (what === 'jobs') { title = 'Jobs this month'; rows = t.jobList.map((b) => `<tr><td><a href="/admin/day/${esc(b.date)}"${tip('cal.day')}>${esc(shortDate(b.date))}</a> · ${esc(KIND_LABELS[b.kind])} · ${esc(b.customer_name)}</td><td></td></tr>`).join(''); }
  else if (what === 'expenses') { title = 'Expenses'; rows = t.expenseList.map((e) => `<tr><td><a href="/admin/money/expenses/${e.id}"${tip('exp.open')}>${esc(e.vendor || 'Expense')}</a> · ${esc(shortDate(e.date))} · ${esc(e.category)}</td><td class="amt">${esc(money(e.total_cents))}</td></tr>`).join(''); }
  else if (what.startsWith('category:')) {
    const k = what.slice(9); title = CATEGORY_LABELS[k] || 'Category';
    rows = t.payments.filter((p) => p.cats && p.cats[k]).map((p) => { const x = byInv[p.invoice_id]; return `<tr><td>${esc(shortDate(p.received_on))} · ${esc(x ? x.inv.customer_name : '')}</td><td class="amt">${esc(money(p.cats[k]))}</td></tr>`; }).join('');
  }
  return layout(title || 'Money', `<style>${MONEY_CSS}</style><h1>${esc(title)}: ${esc(monthName(month))}</h1><div class="card"><table class="sumlines" data-detail>${rows || '<tr><td>Nothing this month.</td><td></td></tr>'}</table></div>`,
    { screen: 'moneyDetail', back: { href: `/admin/money?month=${month}`, label: 'Back to Money' } });
}

export function expenseForm({ expense: e, cats, conf, manual }) {
  const low = (k) => !manual && e.status === 'needs_check' && (conf[k] === undefined || conf[k] < LOW_CONFIDENCE);
  const field = (k, label, html) => `<div${low(k) ? ' class="amberbox"' : ''}><label for="f-${k}">${esc(label)}</label>${html}${low(k) ? '<div class="amber-note" data-check>Please check this</div>' : ''}</div>`;
  const cls = (k) => (low(k) ? ' class="amber"' : '');
  return layout(e.id ? 'Check a receipt' : 'Type in an expense', `<style>${MONEY_CSS}</style>
    <h1>${e.id ? (e.status === 'saved' ? 'Change an expense' : 'Check what the computer read') : 'Type in an expense'}</h1>
    ${conf.message ? `<div class="notice warn">${esc(conf.message)}</div>` : ''}
    ${e.status === 'needs_check' && e.id ? '<div class="notice warn"><strong>Needs checking.</strong> Nothing is saved until you tap Save.</div>' : ''}
    ${e.receipt_key ? `<div class="card">${/pdf/.test(e.receipt_type) ? '' : `<img src="/admin/money/expenses/${e.id}/receipt" alt="The receipt" style="max-width:100%;border-radius:10px">`}
      ${act(`<a class="btn ghost" href="/admin/money/expenses/${e.id}/receipt" target="_blank" rel="noopener"${tip('exp.receipt')}>See the receipt</a>`, 'exp.receipt')}</div>` : ''}
    <form class="card" method="post" action="/admin/money/expenses${e.id ? `/${e.id}` : ''}">
      ${field('vendor', 'Store or vendor', `<input id="f-vendor" name="vendor" value="${esc(e.vendor)}"${cls('vendor')}>`)}
      ${field('date', 'Date', `<input id="f-date" name="date" type="date" value="${esc(e.date)}"${cls('date')}>`)}
      ${field('total', 'Total paid ($)', `<input id="f-total" name="total" inputmode="decimal" value="${esc((e.total_cents / 100).toFixed(2))}"${cls('total')}>`)}
      ${field('tax', 'Tax on the receipt ($)', `<input id="f-tax" name="tax" inputmode="decimal" value="${esc((e.tax_cents / 100).toFixed(2))}"${cls('tax')}>`)}
      <label for="f-cat">What it was for</label><select id="f-cat" name="category">${cats.map((c) => `<option${c === e.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <label for="f-pm">How you paid (optional)</label><input id="f-pm" name="payment_method" value="${esc(e.payment_method || '')}">
      <label for="f-note">Note (optional)</label><textarea id="f-note" name="note" rows="3">${esc(e.note || '')}</textarea>
      <div style="margin-top:16px">${act(`<button class="btn primary" type="submit"${tip('exp.save')}>Save</button>`, 'exp.save')}</div>
    </form>
    ${e.id ? confirmStep({ key: 'exp.delete', yesKey: 'exp.deleteYes', label: 'Delete this expense', question: 'Are you sure? The expense and its receipt picture will be gone for good.', action: `/admin/money/expenses/${e.id}/delete`, hidden: '', danger: true }) : ''}`,
  { screen: 'expense', back: { href: '/admin/money', label: 'Back to Money' } });
}

export function yearPage({ year, sum, flash = '', error = '' }) {
  const t = sum.total;
  const row = (k, v) => `<tr><td>${esc(k)}</td><td class="amt">${esc(v)}</td></tr>`;
  return layout(`Year-end summary ${year}`, `<style>${MONEY_CSS}</style>
    ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}
    <h1>Year-end summary for taxes: ${esc(year)}</h1>
    <p><strong>Porch &amp; Party</strong> · Legal entity: Kerseta LLC</p>
    <div class="monthbar noprint">
      <a class="btn ghost" href="/admin/money/year?year=${Number(year) - 1}"${tip('mon.yearPrev')}>&lsaquo; ${Number(year) - 1}</a>
      <a class="btn ghost" href="/admin/money"${tip('mon.this')}>Back to this month</a>
      <a class="btn ghost" href="/admin/money/year?year=${Number(year) + 1}"${tip('mon.yearNext')}>${Number(year) + 1} &rsaquo;</a>
    </div>
    <div class="actions noprint" style="grid-template-columns:1fr 1fr">
      ${act(`<a class="btn" href="/admin/money/year.pdf?year=${year}"${tip('yr.pdf')}>Download PDF</a>`, 'yr.pdf')}
      ${act(`<a class="btn" href="/admin/money/year.csv?year=${year}"${tip('yr.csv')}>Download spreadsheet (CSV)</a>`, 'yr.csv')}
      <form method="post" action="/admin/money/year/email?year=${year}">${act(`<button class="btn ghost" type="submit"${tip('yr.email')}>Email it to me</button>`, 'yr.email')}</form>
      <form method="post" action="/admin/settings/sheet-sync?year=${year}">${act(`<button class="btn ghost" type="submit"${tip('yr.sheet')}>Write the Year ${esc(year)} tab in the Google Sheet</button>`, 'yr.sheet')}</form>
      ${act(`<a class="btn ghost" href="/admin/money/receipts.zip?year=${year}"${tip('yr.zip')}>Download all receipts (zip)</a>`, 'yr.zip')}
    </div>
    <section class="card" data-year-summary><table class="sumlines">
      ${row('Gross money received', money(t.received))}${row('  of which charges (income)', money(t.revenue))}${row('  of which damage deposits taken (not income)', money(t.depositsIn))}
      ${row('Damage deposits kept for damage (income)', money(t.kept))}${row('Refunds issued (incl. damage-deposit refunds)', money(t.refunds))}
      ${row('Damage deposits held at year end (owed back, not income)', money(sum.depositsHeld))}${row('Number of jobs', String(t.jobs))}
    </table></section>
    <section class="card"><h2>By category</h2><table class="sumlines">${CATEGORY_KEYS.map((k) => row(CATEGORY_LABELS[k], money(t.byCategory[k] || 0))).join('')}</table></section>
    <section class="card"><h2>By payment method</h2><table class="sumlines">${Object.entries(t.byMethod).map(([k, v]) => row(METHOD_LABELS[k] || k, money(v))).join('') || row('Nothing received', '')}</table></section>
    <section class="card"><h2>By month</h2><table class="sumlines">${sum.months.map((m) => row(monthName(m.month), `${money(m.received)} · ${m.jobs} jobs · expenses ${money(m.expenses)}`)).join('')}</table></section>
    <section class="card"><h2>Expenses</h2><table class="sumlines">${row('Total expenses', money(t.expenses))}${Object.entries(t.expenseByCategory).map(([k, v]) => row(k, money(v))).join('')}</table>
      <table class="sumlines">${t.expenseList.map((e) => row(`${e.date} · ${e.vendor} · ${e.category}${e.receipt_key ? ' · receipt saved in admin' : ''}`, `${money(e.total_cents)} (tax ${money(e.tax_cents)})`)).join('')}</table></section>
    <section class="card"><h2>Invoices</h2><table class="sumlines">${sum.list.map((i) => row(`${i.number} · ${prettyDate(i.date)} · ${i.customer}`, `${money(i.total)} total · ${money(i.paid)} paid`)).join('') || row('No invoices', '')}</table>
      ${sum.voided.length ? `<h3>Voided invoices (for the record, $0)</h3><table class="sumlines">${sum.voided.map((v) => row(`${v.number} · ${prettyDate(v.date)} · ${v.customer}`, '$0.00')).join('')}</table>` : ''}</section>
    <p class="muted" data-footer>${esc(FOOTER)}</p>`, { screen: 'year', back: { href: '/admin/money', label: 'Back to Money' } });
}
