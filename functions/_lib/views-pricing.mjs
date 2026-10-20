// Quick Pricing Summary page (/admin/pricing; owner-approved mock-up, 20 Oct 2026), in the
// admin's own look: one block per service in its service colour (kinds.mjs SERVICE_KINDS), jump
// chips, and per section Text it (an sms: link, free, from her phone), Email it (a small form that
// sends from hello@ through the mailer) and Print (that section only). Every number comes from
// price-summary.mjs priceSummary(); this file only lays it out.
//
// The yellow "Only you see this" box is the ONLY place section.private is rendered, and it is
// hidden from print (@media print, plus .noprint); the text and the email never read it.
import { esc } from './util.mjs';
import { tip, hint } from './helptext.mjs';
import { layout } from './views.mjs';
import { SERVICE_KINDS } from './kinds.mjs';
import { smsHref } from './price-summary.mjs';

const COLOR = { rentals: SERVICE_KINDS.rentals, porch: SERVICE_KINDS.porch, party: SERVICE_KINDS.party, grazing: SERVICE_KINDS.grazing };

export const PRICING_CSS = `
.pjump,.pall{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
.pjump a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:999px;border:1.5px solid var(--line);background:var(--card);color:var(--ink);font-weight:600;text-decoration:none}
.pall>*{flex:1 1 140px}
.svc{border-left:8px solid var(--c);scroll-margin-top:12px}
.svc h2{margin:0 0 2px}.svc .from{color:var(--ink);font-weight:700;font-size:1.1rem;margin:0 0 8px;padding:2px 10px;border-radius:8px;background:var(--t);display:inline-block}
.svc .blurb{color:var(--muted);margin:0 0 8px}
table.prices{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
table.prices td{padding:8px 0;border-top:1px solid var(--line);vertical-align:top}
table.prices tr:first-child td{border-top:0}
table.prices td.p{text-align:right;font-weight:700;white-space:nowrap;padding-left:10px}
table.prices small{display:block;color:var(--muted);font-size:.9rem}
.psub{margin:12px 0 2px;font-weight:700;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.pcols{text-align:right;color:var(--muted);font-weight:600;font-size:.95rem}
.pnote{color:var(--muted);font-size:.95rem;margin:8px 0 0}
.priv{background:#fff3dc;border:1px solid #ebcf96;color:#5c3a07;border-radius:10px;padding:10px 12px;margin:12px 0 0}
.priv b{display:block;font-size:.78rem;letter-spacing:.08em;text-transform:uppercase}
.pshare{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.pshare>*{min-width:0}
.pshare .btn,.pall .btn{min-height:52px;padding:10px 8px}
details.pmail{margin-top:8px}details.pmail>summary{list-style:none}details.pmail>summary::-webkit-details-marker{display:none}
details.pmail .pform{margin-top:8px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--cream)}
.psent{margin:10px 0 0;font-weight:600;color:var(--ok)}
@media(max-width:420px){.pshare{grid-template-columns:1fr}}
@media print{.priv,.pshare,.pjump,.pall,details.pmail,.psent,.adminbar,.topsteps{display:none!important}
body[data-print] .svc:not(.printing),body[data-print] .pagehead{display:none!important}
.svc{break-inside:avoid;border:1px solid #bbb;border-left:8px solid var(--c);padding:10px;margin:0 0 12px}}
`;

const PRINT_JS = `document.addEventListener('click',function(e){var b=e.target.closest('[data-print-section]');if(!b)return;e.preventDefault();
var k=b.getAttribute('data-print-section'),body=document.body;
if(k!=='all'){var s=document.getElementById(k);if(s){body.setAttribute('data-print',k);s.classList.add('printing');}}
var done=function(){body.removeAttribute('data-print');document.querySelectorAll('.svc.printing').forEach(function(x){x.classList.remove('printing');});window.removeEventListener('afterprint',done);};
window.addEventListener('afterprint',done);window.print();setTimeout(done,1500);});`;

function rowsHtml(rows) {
  return `<table class="prices">${rows.map((r) => `<tr><td>${esc(r.label)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</td><td class="p">${esc(r.price)}</td></tr>`).join('')}</table>`;
}

// The Email it form (also Email all): a disclosure, open again when a send failed.
function mailForm(which, { emails, flash }) {
  const mine = flash && flash.s === which;
  const err = mine && flash.err ? `<div class="notice err" data-pricing-err>${esc(flash.err)}</div>` : '';
  const id = `to-${which}`;
  const label = which === 'all' ? 'Email all' : 'Email it';
  const key = which === 'all' ? 'pr.emailAll' : 'pr.email';
  return `<details class="pmail" data-pricing-mail="${esc(which)}"${mine && flash.err ? ' open' : ''}><summary class="btn ghost"${tip(key)}>${label}</summary>
  <form class="pform" method="post" action="/admin/pricing/email">
    <input type="hidden" name="s" value="${esc(which)}">
    <label for="${esc(id)}">Send to</label>
    <input id="${esc(id)}" name="to" type="email" inputmode="email" autocomplete="email" required list="pricing-emails" value="${esc(mine && flash.err ? flash.to : '')}" placeholder="name@example.com">
    ${err}
    <div style="margin-top:10px">${`<button class="btn" type="submit"${tip('pr.send')}>Send</button>`}${hint('pr.send')}</div>
  </form></details>${mine && flash.sent ? `<p class="psent" data-pricing-sent role="status">Sent to ${esc(flash.sent)} &#10003;</p>` : ''}`;
}

function sectionHtml(sec, opts) {
  const c = COLOR[sec.key];
  const groups = sec.groups.map((g, i) => `${g.heading ? `<p class="psub">${esc(g.heading)}</p>` : ''}${i === 0 && sec.columns ? `<p class="pcols">${esc(sec.columns)}</p>` : ''}${rowsHtml(g.rows)}`).join('');
  const priv = sec.private.length ? `<div class="priv noprint" data-private><b>Only you see this</b>${esc(sec.private.join(' · '))}.</div>` : '';
  return `<section class="card svc" id="${esc(sec.key)}" style="--c:${c.bar};--t:${c.tint}" data-pricing-section="${esc(sec.key)}">
  <h2>${esc(sec.title)}</h2>
  <p class="from" data-headline>${esc(sec.headline)}</p>
  ${sec.blurb ? `<p class="blurb">${esc(sec.blurb)}</p>` : ''}
  ${groups}
  ${sec.notes.map((n) => `<p class="pnote">${esc(n)}</p>`).join('')}
  ${priv}
  <div class="pshare">
    <a class="btn" href="${esc(smsHref(sec))}" data-pricing-text${tip('pr.text')}>Text it</a>
    <button class="btn ghost" type="button" data-print-section="${esc(sec.key)}"${tip('pr.print')}>Print</button>
  </div>
  ${mailForm(sec.key, opts)}
</section>`;
}

// model: price-summary.mjs priceSummary(); emails: request customers' addresses (type-ahead);
// flash: { s, sent, err, to } from the redirect after a send.
export function pricingPage(model, { emails = [], flash = null } = {}) {
  const opts = { emails, flash };
  const body = `<div class="pagehead"><h1>Quick Pricing Summary</h1>
  <p class="hint">The same prices customers see on the website. Text, email or print one service, or all of them.</p></div>
  <nav class="pjump" aria-label="Jump to">${model.sections.map((s) => `<a href="#${esc(s.key)}"${tip('pr.jump')}>${esc(s.short)}</a>`).join('')}</nav>
  <div class="pall"><button class="btn ghost" type="button" data-print-section="all"${tip('pr.printAll')}>Print all</button><div>${mailForm('all', opts)}</div></div>
  ${model.sections.map((s) => sectionHtml(s, opts)).join('\n')}
  <datalist id="pricing-emails">${emails.map((e) => `<option value="${esc(e)}"></option>`).join('')}</datalist>
  <style>${PRICING_CSS}</style><script>${PRINT_JS}</script>`;
  return layout('Quick Pricing Summary', body, { screen: 'pricing', back: { href: '/admin/' } });
}
