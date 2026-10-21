// Money tab screens: the month in big plain numbers, a 12-month list, details behind each
// total, expenses with receipts, and the year-end summary for taxes. Same rules as views.mjs.
import { esc, money, shortDate, prettyDate } from './util.mjs';
import { tip, stepsPanel } from './helptext.mjs';
import { serviceBadge } from './cards.mjs';
import { smsLink } from './reminders.mjs';
import { render } from './messages.mjs';
import { layout, act, confirmStep, hiddenInputs, BACK_REQUESTS, CARD_CSS } from './views.mjs';
import { CATEGORY_KEYS, CATEGORY_LABELS, METHOD_LABELS, FOOTER, TIP_METHODS, counted, rowOwed } from './money.mjs';
import { KIND_LABELS } from './kinds.mjs';
import { LOW_CONFIDENCE } from './expenses.mjs';

const MONEY_CSS = `
.big{font-size:1.5rem;font-weight:700;margin:4px 0}.big small{display:block;font-size:.95rem;font-weight:400;color:var(--muted)}
.tot{display:block;text-decoration:none;color:var(--ink);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 10px;background:#fff}
.mbar{height:12px;background:#dbeafe;border-radius:6px;margin-top:4px}.mbar span{display:block;height:12px;background:#1d4ed8;border-radius:6px}
.amber{border:2px solid #d97706 !important;background:#fff8ea}.amber-note{color:#7a4a0c;font-weight:700;font-size:.95rem}
.np{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 10px;background:#fff}
.np .owed{font-size:1.6rem;font-weight:800}.np .late{color:#8f3427;font-weight:700}.np .soon{color:#7a4a0c;font-weight:700}
.np .nums{display:flex;flex-wrap:wrap;gap:4px 14px;color:var(--muted)}
.np .secrow{grid-template-columns:1fr 1fr}
.nptotal{font-size:1.25rem;font-weight:700;margin:6px 0 0}
.exp{display:block;padding:10px 0;border-bottom:1px solid var(--line);text-decoration:none;color:var(--ink)}
@media print{.noprint{display:none!important}}
`;

// The calm Money tab (owner-approved 19 Oct 2026): a few big plain numbers first, then the
// lists; light rules instead of boxes; phone first (390 px), laptop no worse.
const CALM_CSS = `
.mhead{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px;margin:4px 0 10px}.mhead h1{margin:0}
.seg{display:grid;grid-template-columns:1fr 1fr;background:#efe8df;border-radius:12px;padding:4px;gap:4px;margin:0 0 10px}
.seg a{display:flex;align-items:center;justify-content:center;min-height:46px;border-radius:9px;text-decoration:none;color:var(--ink);font-weight:600}
.seg a.on{background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.mnav{display:grid;grid-template-columns:56px 1fr 56px;align-items:center;gap:6px;margin:0 0 6px}
.mnav a.arrow{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:12px;background:#fff;border:1px solid var(--line);text-decoration:none;font-size:1.6rem;line-height:1;color:var(--accent)}
.mnav strong{text-align:center;font-family:"Cormorant Garamond",Georgia,serif;font-size:1.45rem;font-weight:600}
.thism{text-align:center;margin:0 0 8px}.thism a{font-weight:600}
.ticks{display:grid;gap:4px;margin:6px 0 14px}
.tick{display:flex;gap:12px;align-items:flex-start;padding:8px 4px;margin:0;cursor:pointer;font-weight:600;color:var(--ink);font-size:1.02rem}
.tick input{width:26px;height:26px;margin:1px 0 0;flex:none;accent-color:var(--accent)}
.tick small{display:block;font-weight:400;color:var(--muted);font-size:.92rem;line-height:1.35}
.figs{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 18px}
.fig{display:block;text-decoration:none;color:var(--ink);background:#fff;border-radius:14px;padding:12px 14px;min-width:0}
.fig .fl{display:block;color:var(--muted);font-size:.95rem}
.fig .fv{display:block;font-size:1.55rem;font-weight:700;letter-spacing:-.01em;line-height:1.2;margin-top:2px;overflow-wrap:anywhere}
.fig .fs{display:block;color:var(--muted);font-size:.85rem;line-height:1.3;margin-top:2px}
.fig.main{grid-column:1/-1}.fig.main .fv{font-size:2.1rem}
.fig.owe .fv{color:#8f3427}.fig.exp{background:#f6f2fb}.fig.exp .fv{color:#5b4a8a}
.mlist{list-style:none;margin:0;padding:0}
.job{padding:12px 2px;border-bottom:1px solid var(--line)}.job:last-child{border-bottom:0}
.job .jt{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center}.job .jt a,.job .jt strong{font-size:1.1rem;font-weight:700;color:var(--ink)}
.sv{display:inline-block;padding:1px 9px;border-radius:999px;font-size:.82rem;font-weight:600;border:1px solid;color:#2b2420;white-space:nowrap}
.job .jd{color:var(--muted);font-size:.95rem;margin:2px 0 4px}
.jn{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:2px 8px;margin:0}
.jn div{min-width:0}.jn dt{color:var(--muted);font-size:.8rem}.jn dd{margin:0;font-weight:600;white-space:nowrap}
.jn dd.owe{color:#8f3427}.jn dd.zero{color:var(--muted);font-weight:400}
.job .dep{color:var(--muted);font-size:.85rem;margin-top:2px}
.job.unconf{border:2px dashed #b9aea3;border-radius:12px;padding:10px 12px;margin:8px 0;background:#f6f3ef;color:#5f5148}
.job.unconf .jt a,.job.unconf .jt strong{color:#5f5148}
.nc{display:inline-block;padding:1px 9px;border-radius:999px;font-size:.82rem;font-weight:700;background:#e6e0d9;color:#4a3f37}
.grp{margin:14px 0 2px;font-size:1.25rem}
.sect{background:#fff;border-radius:14px;padding:14px 16px;margin:0 0 14px}
.sect h2{margin:0 0 6px}
.two{display:grid;grid-template-columns:1fr;gap:10px;margin:6px 0 10px}
.row{display:flex;justify-content:space-between;gap:10px;padding:12px 2px;border-bottom:1px solid var(--line);text-decoration:none;color:var(--ink);min-height:48px;align-items:center}
.row:last-child{border-bottom:0}.row .rw{min-width:0}.row .rw .muted{font-size:.92rem}.row .ra{font-weight:700;white-space:nowrap}
.checkline{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:12px;background:#fff3dc;color:#7a4a0c;font-weight:700;text-decoration:none;margin:4px 0 8px;min-height:48px}
details.more{margin:0 0 14px}details.more>summary{cursor:pointer;font-weight:600;color:var(--accent);padding:12px 2px;min-height:48px;list-style:none}
details.more>summary::-webkit-details-marker{display:none}
.hist{list-style:none;padding:0;margin:0}.hist li{padding:6px 0;border-bottom:1px solid var(--line);font-size:.95rem}
.radios{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:4px 0 6px}
.radios label{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;min-height:50px;font-weight:600;margin:0;background:#fff}
.radios input{width:22px;height:22px;margin:0;accent-color:var(--accent)}
@media(min-width:700px){.figs{grid-template-columns:repeat(5,minmax(0,1fr))}.fig.main{grid-column:auto}.fig.main .fv{font-size:1.75rem}.two{grid-template-columns:1fr 1fr}.ticks{grid-template-columns:1fr 1fr}.radios{grid-template-columns:repeat(4,1fr)}}
@media(max-width:380px){.jn{grid-template-columns:repeat(2,minmax(0,1fr))}}
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

// "Not paid yet" (top of Money): every customer still owing on a sent invoice, most overdue first.
export function notPaidBox(np, { prettyDue = (d) => shortDate(d) } = {}) {
  const row = (r) => {
    const badges = r.services.map((k) => { const b = serviceBadge(k); return b ? `<span class="svc" style="border-color:${b.bar};background:${b.tint}">${esc(b.label)}</span>` : ''; }).join('');
    const sms = smsLink(r.phone, render('paymentReminder', { name: r.name, amount: money(r.remaining), due: r.due ? prettyDue(r.due) : '', late: r.tone === 'late', number: r.number }).text);
    const tel = String(r.phone || '').replace(/[^\d+]/g, '');
    return `<article class="np" data-not-paid="${r.id}"><div class="svcs">${badges}</div>
      <div class="spread"><strong style="font-size:1.25rem">${esc(r.name)}</strong><span class="${esc(r.tone)}" data-due-words>${esc(r.words)}</span></div>
      <div class="muted">${esc(r.whatFor)} · ${esc(r.number)}</div>
      <div class="nums"><span>Total ${esc(money(r.total))}</span><span>Paid ${esc(money(r.paid))}</span></div>
      <div><span class="owed" data-owed>${esc(r.dueWords || `${money(r.remaining)} due`)}</span></div>
      ${r.remindedAt ? `<div class="muted" data-reminded>Reminder emailed ${esc(String(r.remindedAt).slice(0, 10))}</div>` : ''}
      <div class="secrow">
        ${tel ? `<div class="act"><a class="btn ghost" href="tel:${esc(tel)}"${tip('np.call')}>Call</a></div>` : ''}
        ${sms ? `<div class="act"><a class="btn ghost" href="${esc(sms)}"${tip('np.text')}>Text a reminder</a></div>` : ''}
        ${r.email ? `<form method="post" action="/admin/money/remind">${hiddenInputs({ invoice: r.id })}<div class="act"><button class="btn ghost" type="submit"${tip('np.email')}>Email a reminder</button></div></form>` : ''}
        <div class="act"><a class="btn ghost" href="/admin/invoices/${r.id}"${tip('np.open')}>Open invoice</a></div>
      </div>
      ${confirmStep({ key: 'np.paid', yesKey: 'pay.paidYes', label: 'Mark paid', question: `Mark ${r.name} as paid in full (${money(r.remaining)})? Only do this after the money is in your account.`, action: `/admin/invoices/${r.id}/status`, hidden: hiddenInputs({ action: 'paid', back: '/admin/money' }), extra: `<label>How did they pay?</label><select name="method">${[['zelle', 'Zelle'], ['cashapp', 'Cash App'], ['cash', 'Cash'], ['card', 'Card'], ['other', 'Other']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>` })}
    </article>`;
  };
  return `<section class="card" id="not-paid" data-not-paid-box><h2>Not paid yet</h2>
    ${np.owed.length ? `${np.owed.map(row).join('')}<p class="nptotal" data-not-paid-total>${np.count} ${np.count === 1 ? 'customer owes' : 'customers owe'} ${esc(money(np.total))} in all${np.depositTotal ? ` (${esc(money(np.total - np.depositTotal))} + ${esc(money(np.depositTotal))} refundable deposits)` : ''}.</p>` : '<p class="muted" style="margin:0">Everyone has paid. Nothing is owed on a sent invoice.</p>'}
    ${np.drafts.length ? `<h3>Invoice not sent yet</h3>${np.drafts.map((r) => `<div class="exp" data-draft><a href="/admin/invoices/${r.id}"${tip('np.open')}><strong>${esc(r.name)}</strong></a> · ${esc(r.number)} · ${esc(money(r.total))}</div>`).join('')}<p class="muted">Not counted as owed until you send them.</p>` : ''}
  </section>`;
}

export function moneyPanel() {
  return stepsPanel('money', [
    [`<a class="btn ghost" href="/admin/?f=unpaid"${tip('np.filter')}>Not paid yet on Requests</a>`],
    [`<a class="btn ghost" href="/admin/invoices"${tip('money.invoices')}>All invoices</a>`],
    [`<a class="btn ghost" href="/admin/money/expenses/new"${tip('exp.manual')}>Type in a receipt</a>`, `<a class="btn ghost" href="/admin/money/year"${tip('mon.taxes')}>Year-end summary for taxes</a>`],
  ]);
}

// The URL that keeps the view (moneyState in admin-money.mjs reads it back).
export function moneyHref(state, over = {}) {
  const st = { ...state, ...over };
  const q = [];
  if (st.view === 'all') q.push('view=all'); else q.push(`month=${st.month}`);
  if (st.includeUnconfirmed) q.push('unconf=1');
  if (st.includeDeposits) q.push('deposits=in');
  if (st.year) q.push(`year=${st.year}`);
  return `/admin/money?${q.join('&')}`;
}

const dayWords = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(String(iso || '')) ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'No date yet');
const chips = (services) => services.map((k) => { const b = serviceBadge(k); return b ? `<span class="sv" style="border-color:${b.bar};background:${b.tint}">${esc(b.label)}</span>` : '<span class="sv" style="border-color:#c9bfb4;background:#f3efe9">Other</span>'; }).join('');

// One job: name, service chip, date, total, paid, still owed, tips. Unconfirmed: dashed and
// grey, "Not confirmed", and what it would bring in ("Expected if confirmed"), never "paid".
// A sent invoice is owed money whether or not the job is confirmed (money.mjs counted): its row
// always shows Total / Paid / Still owed, with "Not confirmed" beside the name if it is not.
export function jobRow(r, { includeDeposits = false } = {}) {
  const total = r.charges + (includeDeposits ? r.refundable : 0);
  const paid = r.paidCharges + (includeDeposits ? r.paidDeposit : 0);
  // Total - Paid = Still owed on every row (ledger.mjs balanceOf numbers, via money.mjs jobRows).
  const owed = rowOwed(r, includeDeposits);
  const shows = counted(r);
  const amt = (v, cls = '') => `<dd class="${v ? cls : 'zero'}">${esc(money(v))}</dd>`;
  const name = r.invoiceId ? `<a href="/admin/invoices/${r.invoiceId}"${tip('mon.jobOpen')}>${esc(r.name)}</a>` : (r.date ? `<a href="/admin/day/${esc(r.date)}"${tip('mon.jobDay')}>${esc(r.name)}</a>` : `<strong>${esc(r.name)}</strong>`);
  const nums = shows
    ? `<dl class="jn"><div><dt>Total</dt><dd data-job-total>${esc(money(total))}</dd></div><div><dt>Paid</dt>${amt(paid)}</div><div><dt>Still owed</dt>${amt(owed, 'owe')}</div><div><dt>Tips</dt>${amt(r.tips)}</div></dl>`
    : `<dl class="jn"><div style="grid-column:span 2"><dt>Expected if confirmed</dt><dd data-job-expected>${r.hasPrice ? esc(money(r.expected)) : 'No price yet'}</dd></div><div><dt>Tips</dt>${amt(r.tips)}</div></dl>`;
  const dep = includeDeposits && r.refundable ? `<div class="dep" data-job-deposit>Total includes ${esc(money(r.refundable))} deposit (given back later)</div>` : '';
  return `<li class="job${shows ? '' : ' unconf'}" data-job data-confirmed="${r.confirmed ? 1 : 0}" data-billed="${r.billed ? 1 : 0}" data-job-key="${esc(r.key)}">
    <div class="jt">${name}${chips(r.services)}${r.confirmed ? '' : '<span class="nc" data-not-confirmed>Not confirmed</span>'}</div>
    <div class="jd">${esc(dayWords(r.date))}${r.number ? ` · ${esc(r.number)}` : ''}</div>${nums}${dep}</li>`;
}

export function moneyPage({ month, year, state, today = '', requestsThisMonth = 0, t, sum, shown, months, needs, expenses = [], tips = [], depositsHeld, flash = '', error = '', notPaid = null }) {
  const here = moneyHref(state);
  const back = encodeURIComponent(here);
  const all = state.view === 'all';
  const detail = (what) => `/admin/money/detail?${all ? 'view=all&amp;' : ''}month=${month}&amp;what=${encodeURIComponent(what)}${state.includeDeposits ? '&amp;deposits=in' : ''}&amp;back=${back}`;
  const fig = (what, label, value, sub = '', cls = '') => `<a class="fig${cls ? ` ${cls}` : ''}" href="${detail(what)}"${tip('mon.total')}><span class="fl">${esc(label)}</span><span class="fv" data-total="${esc(what)}">${esc(value)}</span>${sub ? `<span class="fs">${esc(sub)}</span>` : ''}</a>`;
  const depSub = sum.includeDeposits ? (sum.depositsIn ? `includes ${money(sum.depositsIn)} deposit (given back later)` : '') : (sum.depositsIn ? `leaves out ${money(sum.depositsIn)} of damage deposits` : '');
  const thisMonth = today.slice(0, 7);
  const max = Math.max(1, ...months.map((m) => m.received));
  const list = (rows) => `<ul class="mlist" data-jobs-list>${rows.map((r) => jobRow(r, state)).join('')}</ul>`;
  const jobsHtml = all
    ? `${shown.upcoming.length ? `<h3 class="grp" data-group="upcoming">Upcoming</h3>${list(shown.upcoming)}` : ''}${shown.past.length ? `<h3 class="grp" data-group="past">Past</h3>${list(shown.past)}` : ''}${shown.list.length ? '' : '<p class="muted">No jobs yet.</p>'}`
    : (shown.list.length ? list(shown.list) : `<p class="muted">No jobs in ${esc(monthName(month))}.</p>`);
  const tipRow = (x) => `<a class="row" href="/admin/money/tips/${x.id}?back=${back}"${tip('tip.open')} data-tip-row><span class="rw"><strong>${esc(TIP_METHODS[x.method] || 'Other')}</strong> · ${esc(shortDate(x.date))}${x.job_label ? `<div class="muted">${esc(x.job_label)}</div>` : ''}${x.note ? `<div class="muted">${esc(x.note)}</div>` : ''}</span><span class="ra">${esc(money(x.amount_cents))}</span></a>`;
  const expRow = (e) => `<a class="row" href="/admin/money/expenses/${e.id}"${tip('exp.open')} data-expense-row><span class="rw"><strong>${esc(e.vendor || 'Expense')}</strong><div class="muted">${esc(shortDate(e.date))} · ${esc(e.category)}</div></span><span class="ra">${esc(money(e.total_cents))}</span></a>`;
  return layout('Money', `<style>${MONEY_CSS}${CARD_CSS}${CALM_CSS}</style>
    ${flash ? `<div class="notice ok">${esc(flash)}</div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}
    <div class="mhead"><h1>Money</h1></div>
    <section data-money-controls>
      <nav class="seg" aria-label="Show">
        <a class="${all ? '' : 'on'}" href="${esc(moneyHref(state, { view: 'month' }))}"${all ? '' : ' aria-current="page"'}${tip('mon.viewMonth')}>By month</a>
        <a class="${all ? 'on' : ''}" href="${esc(moneyHref(state, { view: 'all' }))}"${all ? ' aria-current="page"' : ''}${tip('mon.viewAll')}>All jobs</a>
      </nav>
      ${all ? '' : `<div class="mnav" data-month="${esc(month)}"><a class="arrow" href="${esc(moneyHref(state, { month: shift(month, -1) }))}" aria-label="Previous month"${tip('mon.prev')}>&lsaquo;</a><strong>${esc(monthName(month))}</strong><a class="arrow" href="${esc(moneyHref(state, { month: shift(month, 1) }))}" aria-label="Next month"${tip('mon.next')}>&rsaquo;</a></div>
      ${month !== thisMonth ? `<p class="thism"><a href="${esc(moneyHref(state, { month: thisMonth }))}"${tip('mon.this')}>Back to this month</a></p>` : ''}`}
      <form class="ticks" method="get" action="/admin/money" data-ticks>
        ${all ? '<input type="hidden" name="view" value="all">' : `<input type="hidden" name="month" value="${esc(month)}">`}<input type="hidden" name="f" value="1">
        <label class="tick"><input type="checkbox" name="unconf" value="1"${state.includeUnconfirmed ? ' checked' : ''} onchange="this.form.submit()" data-tick="unconf"${tip('mon.unconf')}><span>Include unconfirmed jobs<small>Requests you have not said yes to yet. They show grey, and their price is counted apart.</small></span></label>
        <label class="tick"><input type="checkbox" name="deposits" value="out"${state.includeDeposits ? '' : ' checked'} onchange="this.form.submit()" data-tick="deposits"${tip('mon.refundables')}><span>Leave out refundable deposits<small>Damage deposits ($50) are given back, so they are not your money</small></span></label>
        <noscript><button class="btn ghost" type="submit"${tip('mon.apply')}>Show</button></noscript>
      </form>
    </section>
    <section class="figs" data-money-summary>
      ${fig('received', all ? 'Money in (all time)' : 'Money in', money(sum.moneyIn), depSub, 'main')}
      ${fig('owed', 'Still owed', money(sum.owed), `${all ? 'on sent invoices' : 'on this month\'s sent invoices'}${sum.depositOwed ? ` · includes ${money(sum.depositOwed)} refundable deposit` : ''}`, 'owe')}
      ${fig('tips', 'Tips', money(sum.tips), 'on top of invoices')}
      ${fig('expenses', 'Expenses', money(sum.expenses), '', 'exp')}
      <div class="fig" data-left><span class="fl">Left after expenses</span><span class="fv">${esc(money(sum.left))}</span><span class="fs">money in + tips − expenses (not profit or tax)</span></div>
      ${state.includeUnconfirmed ? `<div class="fig" data-expected style="border:2px dashed #b9aea3;background:#f6f3ef"><span class="fl">Expected if confirmed</span><span class="fv" data-total="expected">${esc(money(sum.expected))}</span><span class="fs">${sum.unconfirmedCount} not confirmed · not money in yet</span></div>` : ''}
    </section>
    ${notPaid ? notPaidBox(notPaid) : ''}
    <section class="sect" data-jobs><h2>${all ? 'All jobs' : `Jobs in ${esc(monthName(month).split(' ')[0])}`}</h2>${jobsHtml}</section>
    <section class="sect" id="tips" data-tips><div class="spread"><h2>Tips</h2><strong data-tips-total>${esc(money(sum.tips))}</strong></div>
      <div class="two">${act(`<a class="btn" href="/admin/money/tips/new?back=${back}"${tip('mon.tipAdd')}>+ Record a tip</a>`, 'mon.tipAdd')}</div>
      ${tips.length ? tips.map(tipRow).join('') : `<p class="muted" style="margin:0">No tips ${all ? 'yet' : 'this month'}. Tips are kept apart: never on an invoice, never owed.</p>`}
    </section>
    <section class="sect" id="expenses" data-expenses><div class="spread"><h2>Expenses</h2><strong>${esc(money(sum.expenses))}</strong></div>
      <div class="two">
        ${act(`<a class="btn" href="/admin/money/expenses/new"${tip('exp.manual')}>+ Add an expense</a>`, 'exp.manual')}
        ${act(`<label class="btn ghost"${tip('exp.add')}>Upload a receipt<input id="receipt-input" type="file" accept="image/*,application/pdf" multiple style="display:none"></label>`, 'exp.add')}
      </div>
      <div id="receipt-state" class="muted" aria-live="polite"></div>
      ${needs.length ? `<a class="checkline" href="/admin/money/expenses/${needs[needs.length - 1].id}"${tip('exp.check')} data-check-receipts><span>Check ${needs.length} ${needs.length === 1 ? 'receipt' : 'receipts'}</span><span aria-hidden="true">&rsaquo;</span></a>` : ''}
      ${expenses.length ? expenses.map(expRow).join('') : `<p class="muted" style="margin:0">No expenses ${all ? 'yet' : 'this month'}.</p>`}
    </section>
    <details class="more" data-more-numbers><summary${tip('mon.more')}>More numbers: by service, deposits, month by month ›</summary>
      <section class="sect">
        <div class="row" data-requests-month><span class="rw">New requests that came in ${esc(monthName(month))}</span><span class="ra">Requests this month: ${esc(String(requestsThisMonth))}</span></div>
        ${[['jobs', `Jobs ${all ? '(all time)' : 'this month'}`, String(t.jobs)], ...CATEGORY_KEYS.map((k) => [`category:${k}`, CATEGORY_LABELS[k], money(t.byCategory[k] || 0)]), ['deposits', 'Damage deposits held (never income)', `${money(depositsHeld)} · refunded ${money(t.depositRefunds)}${t.kept ? ` · kept ${money(t.kept)}` : ''}`]]
    .map(([w, l, v]) => `<a class="row" href="${detail(w)}"${tip('mon.total')}><span class="rw">${esc(l)}</span><span class="ra" data-total="${esc(w)}">${esc(v)}</span></a>`).join('')}
      </section>
      <section class="sect"><h2>${esc(year)}, month by month</h2>
        <div class="monthbar">
          <a class="btn ghost" href="${esc(moneyHref(state, { year: Number(year) - 1 }))}"${tip('mon.yearPrev')}>&lsaquo; ${Number(year) - 1}</a>
          <a class="btn ghost" href="/admin/money/year?year=${year}"${tip('mon.taxes')}>Taxes</a>
          <a class="btn ghost" href="${esc(moneyHref(state, { year: Number(year) + 1 }))}"${tip('mon.yearNext')}>${Number(year) + 1} &rsaquo;</a>
        </div>
        <table class="sumlines" data-year-list>${months.map((m) => `<tr><td><a href="${esc(moneyHref(state, { view: 'month', month: m.month, year: '' }))}"${tip('mon.month')}>${esc(monthName(m.month))}</a><div class="mbar" role="presentation"><span style="width:${Math.round((m.received / max) * 100)}%"></span></div></td>
          <td class="amt">${esc(money(m.received))}<div class="muted">${m.jobs} ${m.jobs === 1 ? 'job' : 'jobs'}</div></td></tr>`).join('')}</table>
      </section>
    </details>
    ${moneyPanel()}
    <script>${UPLOAD_JS}</script>`, { screen: '', back: BACK_REQUESTS, panelWide: true });
}

// "+ Record a tip" and a tip's own page (change it, remove it, its history).
export function tipForm({ tip: x, jobs = [], picked = '', jobValue, back = '/admin/money', log = [], error = '' }) {
  const amount = x.amount_cents ? (x.amount_cents / 100).toFixed(2) : '';
  return layout(x.id ? 'Change a tip' : 'Record a tip', `<style>${MONEY_CSS}${CARD_CSS}${CALM_CSS}</style>
    <h1>${x.id ? 'Change a tip' : 'Record a tip'}</h1>
    ${error ? `<div class="notice err">${esc(error)}</div>` : ''}
    <p class="muted">A tip is money on top of the invoice. It is kept apart: never on the invoice, never owed.</p>
    <form class="sect" method="post" action="/admin/money/tips${x.id ? `/${x.id}` : ''}" data-tip-form>
      <input type="hidden" name="back" value="${esc(back)}">
      <label for="t-amount">How much? ($)</label><input id="t-amount" name="amount" inputmode="decimal" required value="${esc(amount)}" placeholder="20.00"${tip('tip.amount')}>
      <label for="t-date">Date</label><input id="t-date" name="date" type="date" value="${esc(x.date)}"${tip('tip.date')}>
      <label>How did they give it?</label>
      <div class="radios">${Object.entries(TIP_METHODS).map(([v, l]) => `<label><input type="radio" name="method" value="${v}"${x.method === v ? ' checked' : ''}${tip('tip.method')}>${esc(l)}</label>`).join('')}</div>
      <label for="t-job">Which job? (optional)</label><select id="t-job" name="job"${tip('tip.job')}><option value="|">Not for a particular job</option>${jobs.map((j) => `<option value="${esc(jobValue(j))}"${jobValue(j) === picked ? ' selected' : ''}>${esc(j.name)}${j.date ? ` · ${esc(shortDate(j.date))}` : ''}</option>`).join('')}</select>
      <label for="t-note">Note (optional)</label><textarea id="t-note" name="note" rows="2">${esc(x.note || '')}</textarea>
      <div style="margin-top:16px">${act(`<button class="btn primary" type="submit"${tip('tip.save')}>${x.id ? 'Save the change' : 'Save the tip'}</button>`, 'tip.save')}</div>
    </form>
    ${x.id ? confirmStep({ key: 'tip.delete', yesKey: 'tip.deleteYes', label: 'Remove this tip', question: `Remove this ${money(x.amount_cents)} tip? It comes off the totals; its history stays.`, action: `/admin/money/tips/${x.id}/delete`, hidden: hiddenInputs({ back }), danger: true }) : ''}
    ${log.length ? `<section class="sect" data-history><h2>History</h2><ul class="hist">${log.map((h) => `<li><strong>${esc(h.action)}</strong> · ${esc(String(h.at).slice(0, 16))}${h.detail ? `<div class="muted">${esc(h.detail)}</div>` : ''}</li>`).join('')}</ul></section>` : ''}`,
  { screen: 'tip', back: { href: back, label: 'Back to Money' } });
}

export function detailPage({ month, what, t, byInv, all = false, back = '', owedRows = null, includeDeposits = false }) {
  let title = ''; let rows = '';
  const payRow = (p) => { const x = byInv[p.invoice_id]; return `<tr><td>${esc(shortDate(p.received_on))} · ${esc(x ? x.inv.customer_name : '')} <span class="muted">${esc(x ? x.inv.number : '')}</span><div class="muted">${esc(p.kind === 'payment' ? (METHOD_LABELS[p.method] || p.method || 'Not recorded') : p.note)}</div></td><td class="amt">${esc(money(p.amount_cents))}</td></tr>`; };
  if (what === 'received') { title = 'Money received'; rows = t.payments.filter((p) => p.kind === 'payment').map(payRow).join(''); }
  else if (what === 'deposits') { title = 'Damage deposits'; rows = t.payments.filter((p) => p.deposit > 0 || p.kind !== 'payment').map(payRow).join(''); }
  // The same rows the Still owed figure adds up (money.mjs moneySummary owedRows): every sent
  // invoice still owing, confirmed or not.
  else if (what === 'owed' && owedRows) { title = all ? 'Still owed on sent invoices' : "Still owed for this month's jobs"; rows = owedRows.map((r) => `<tr data-owed-row><td>${r.invoiceId ? `<a href="/admin/invoices/${r.invoiceId}"${tip('card.openInvoice')}>${esc(r.name)}</a>` : esc(r.name)}${r.date ? ` · ${esc(shortDate(r.date))}` : ''}${r.number ? ` <span class="muted">${esc(r.number)}</span>` : ''}</td><td class="amt">${esc(money(rowOwed(r, includeDeposits)))}</td></tr>`).join(''); }
  else if (what === 'owed') { title = "Still owed for this month's jobs"; rows = t.owedList.map((o) => `<tr><td><a href="/admin/invoices/${o.invoice.id}"${tip('card.openInvoice')}>${esc(o.invoice.customer_name)}</a> · ${esc(KIND_LABELS[o.booking.kind])} ${esc(shortDate(o.booking.date))}</td><td class="amt">${esc(money(o.owed))}</td></tr>`).join(''); }
  else if (what === 'jobs') { title = 'Jobs this month'; rows = t.jobList.map((b) => `<tr><td><a href="/admin/day/${esc(b.date)}"${tip('cal.day')}>${esc(shortDate(b.date))}</a> · ${esc(KIND_LABELS[b.kind])} · ${esc(b.customer_name)}</td><td></td></tr>`).join(''); }
  else if (what === 'tips') { title = 'Tips'; rows = t.tipList.map((x) => `<tr><td><a href="/admin/money/tips/${x.id}"${tip('tip.open')}>${esc(shortDate(x.date))} · ${esc(TIP_METHODS[x.method] || 'Other')}</a>${x.job_label ? `<div class="muted">${esc(x.job_label)}</div>` : ''}</td><td class="amt">${esc(money(x.amount_cents))}</td></tr>`).join(''); }
  else if (what === 'expenses') { title = 'Expenses'; rows = t.expenseList.map((e) => `<tr><td><a href="/admin/money/expenses/${e.id}"${tip('exp.open')}>${esc(e.vendor || 'Expense')}</a> · ${esc(shortDate(e.date))} · ${esc(e.category)}</td><td class="amt">${esc(money(e.total_cents))}</td></tr>`).join(''); }
  else if (what.startsWith('category:')) {
    const k = what.slice(9); title = CATEGORY_LABELS[k] || 'Category';
    rows = t.payments.filter((p) => p.cats && p.cats[k]).map((p) => { const x = byInv[p.invoice_id]; return `<tr><td>${esc(shortDate(p.received_on))} · ${esc(x ? x.inv.customer_name : '')}</td><td class="amt">${esc(money(p.cats[k]))}</td></tr>`; }).join('');
  }
  const backHref = /^\/admin\/money(\?[^#\s]*)?$/.test(back) ? back : (all ? '/admin/money?view=all' : `/admin/money?month=${month}`);
  return layout(title || 'Money', `<style>${MONEY_CSS}</style><h1>${esc(title)}: ${esc(all ? 'all time' : monthName(month))}</h1><div class="card"><table class="sumlines" data-detail>${rows || `<tr><td>Nothing ${all ? 'yet' : 'this month'}.</td><td></td></tr>`}</table></div>`,
    { screen: 'moneyDetail', back: { href: backHref, label: 'Back to Money' } });
}

export function expenseForm({ expense: e, cats, conf, manual, log = [] }) {
  const low = (k) => !manual && e.status === 'needs_check' && (conf[k] === undefined || conf[k] < LOW_CONFIDENCE);
  const field = (k, label, html) => `<div${low(k) ? ' class="amberbox"' : ''}><label for="f-${k}">${esc(label)}</label>${html}${low(k) ? '<div class="amber-note" data-check>Please check this</div>' : ''}</div>`;
  const cls = (k) => (low(k) ? ' class="amber"' : '');
  return layout(e.id ? 'Check a receipt' : 'Add an expense', `<style>${MONEY_CSS}${CALM_CSS}</style>
    <h1>${e.id ? (e.status === 'saved' ? 'Change an expense' : 'Check what the computer read') : 'Add an expense'}</h1>
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
    ${e.id ? confirmStep({ key: 'exp.delete', yesKey: 'exp.deleteYes', label: 'Delete this expense', question: 'Are you sure? The expense and its receipt picture will be gone for good.', action: `/admin/money/expenses/${e.id}/delete`, hidden: '', danger: true }) : ''}
    ${log.length ? `<section class="card" data-history><h2>History</h2><ul class="hist">${log.map((h) => `<li><strong>${esc(h.action)}</strong> · ${esc(String(h.at).slice(0, 16))}${h.detail ? `<div class="muted">${esc(h.detail)}</div>` : ''}</li>`).join('')}</ul></section>` : ''}`,
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
