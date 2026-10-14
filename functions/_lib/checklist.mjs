// The walk-through checklist, from ONE source: functions/_lib/assets/walkthrough-checklist.html.txt
// (owner-approved wording, four letter-size print pages). Stored as .html.txt on purpose: the
// site build walks every .html file and injects analytics, nav and contact chrome; this one must
// stay byte-for-byte the approved form and never carry analytics. annotate() walks that file once and
// gives every checkbox, field, table cell and notes block a stable id. The print page and the
// online form are both built from that single walk, so an online field cannot exist without
// its printed label (validate:admin-checklist holds both to it). Pure: no bindings, no imports
// of data files, so the validator runs it under Node.
import { esc } from './util.mjs';

const TOKEN = /<h2>([\s\S]*?)<\/h2>|<ul class="ck[^"]*"[^>]*>([\s\S]*?)<\/ul>|<div class="f"><label>([\s\S]*?)<\/label><div class="w( tall)?"><\/div><\/div>|<div class="lines([^"]*)"><\/div>|<table>([\s\S]*?)<\/table>|<div class="note">([\s\S]*?)<\/div>/g;

export function text(html) {
  return String(html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function slug(s) {
  return text(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
}

function show(v) {
  return v === undefined || v === null || v === false ? '' : String(v);
}

// Walk the source. With values, the returned html is the print page filled in.
export function annotate(source, values = {}) {
  const fields = []; const pages = []; const used = new Set();
  const uid = (base) => { let id = base; let n = 2; while (used.has(id)) { id = `${base}-${n}`; n += 1; } used.add(id); return id; };
  let pageNo = 0;
  const html = source.replace(/<section class="page">([\s\S]*?)<\/section>/g, (whole, inner) => {
    pageNo += 1;
    const titleMatch = inner.match(/<p class="title">([\s\S]*?)<\/p>/);
    const page = { n: pageNo, title: text(titleMatch ? titleMatch[1] : `Page ${pageNo}`), blocks: [] };
    pages.push(page);
    let heading = '';
    const add = (f) => { const field = { page: pageNo, heading, ...f }; fields.push(field); return field; };
    const body = inner.replace(TOKEN, (m, h2, ul, label, tall, linesCls, table, note) => {
      if (h2 !== undefined) {
        heading = text(h2.split('<small>')[0]);
        const small = h2.includes('<small>') ? text(h2.split('<small>')[1]) : '';
        page.blocks.push({ type: 'heading', text: heading, small });
        return m;
      }
      if (ul !== undefined) {
        const ids = [];
        const out = ul.replace(/<li>([\s\S]*?)<\/li>/g, (li, inside) => {
          const f = add({ id: uid(`p${pageNo}-${slug(inside)}`), kind: 'check', label: text(inside) });
          ids.push(f.id);
          return `<li data-field="${f.id}"${values[f.id] ? ' class="on"' : ''}>${inside}</li>`;
        });
        page.blocks.push({ type: 'checks', ids });
        return m.replace(ul, out);
      }
      if (label !== undefined) {
        const f = add({ id: uid(`p${pageNo}-${slug(label)}`), kind: tall ? 'tall' : 'text', label: text(label) });
        page.blocks.push({ type: 'field', id: f.id });
        const v = show(values[f.id]);
        return `<div class="f"><label>${label}</label><div class="w${tall || ''}" data-field="${f.id}">${v ? `<span class="v">${esc(v)}</span>` : ''}</div></div>`;
      }
      if (linesCls !== undefined) {
        const f = add({ id: uid(`p${pageNo}-notes-${slug(heading) || 'notes'}`), kind: 'notes', label: heading ? `${heading} (notes)` : 'Notes' });
        page.blocks.push({ type: 'notes', id: f.id });
        const v = show(values[f.id]);
        return `<div class="lines${linesCls}" data-field="${f.id}">${v ? `<div class="v">${esc(v)}</div>` : ''}</div>`;
      }
      if (table !== undefined) {
        const rows = [];
        const out = table.replace(/<tr>([\s\S]*?)<\/tr>/g, (tr, cells) => {
          if (/<th/.test(cells)) return tr;
          const first = cells.match(/<td>([\s\S]*?)<\/td>/);
          const rowLabel = text(first ? first[1] : '');
          const row = { label: rowLabel, notesId: null, amountId: null };
          const rowCells = cells.replace(/<td class="(num )?blank"><\/td>/g, (td, num) => {
            const kind = num ? 'amount' : 'cell';
            const f = add({ id: uid(`p${pageNo}-quote-${slug(rowLabel)}-${num ? 'amount' : 'notes'}`), kind, label: `${rowLabel} (${num ? 'amount' : 'notes'})`, row: rowLabel });
            if (num) row.amountId = f.id; else row.notesId = f.id;
            const v = show(values[f.id]);
            return `<td class="${num ? 'num ' : ''}blank" data-field="${f.id}">${esc(v)}</td>`;
          });
          rows.push(row);
          return `<tr>${rowCells}</tr>`;
        });
        page.blocks.push({ type: 'table', rows });
        return m.replace(table, out);
      }
      page.blocks.push({ type: 'tip', text: text(note) });
      return m;
    });
    return `<section class="page">${body}</section>`;
  });
  return { html, fields, pages };
}

export function fieldIndex(source) {
  const { fields } = annotate(source);
  return fields;
}

const PRINT_CSS = `
ul.ck li.on::before{background:var(--ink);box-shadow:inset 0 0 0 2px var(--card)}
.f .w{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.f .w.tall{white-space:normal}
.v{font-family:var(--serif);font-size:14px;color:var(--ink)}
.lines{overflow:hidden}.lines .v{white-space:pre-wrap;line-height:24px;font-size:13px}
td[data-field]{font-family:var(--serif);font-size:13px}
.pp-toolbar{max-width:8.5in;margin:0 auto 14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-family:var(--sans)}
.pp-toolbar button,.pp-toolbar a{min-height:44px;padding:10px 16px;border-radius:10px;border:1px solid var(--accent);background:var(--accent);color:#fff;font:600 15px var(--sans);text-decoration:none;cursor:pointer;display:inline-flex;align-items:center}
.pp-toolbar a{background:transparent;color:var(--accent)}
.pp-toolbar span{color:var(--muted);font-size:13px}
@media print{.pp-toolbar{display:none}}
`;

export function renderPrintPage(source, values = {}, { who = '', onlineHref = '' } = {}) {
  const { html } = annotate(source, values);
  const toolbar = `<div class="pp-toolbar"><button type="button" onclick="window.print()">Print</button>
<a href="/admin/">Back to requests</a>${onlineHref ? `<a href="${esc(onlineHref)}">Open online checklist</a>` : ''}
<span>${who ? `Pre-filled for ${esc(who)}` : 'Blank checklist'}</span></div>`;
  const firstPage = html.indexOf('<section class="page">');
  const head = html.slice(0, firstPage).replace('</style>', `${PRINT_CSS}</style>`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
${head}</head><body>${toolbar}${html.slice(firstPage)}</body></html>`;
}

// ---- Values from a form request ------------------------------------------------

function answer(request, re) {
  const all = [...(request.rentals || []), ...(request.decor || []), ...(request.other || [])];
  const hit = all.find((x) => re.test(x.label));
  return hit ? hit.value : '';
}

function norm(s) {
  return text(s).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\bsets?\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function prefillFromRequest(source, request) {
  const fields = fieldIndex(source);
  const values = {};
  const byLabel = (page, re) => fields.find((f) => f.page === page && re.test(f.label));
  const set = (page, re, v) => { const f = byLabel(page, re); if (f && v) values[f.id] = v; };
  const address = [answer(request, /delivery address|^address/i), answer(request, /^city/i)].filter(Boolean).join(', ') || answer(request, /^location/i);
  set(1, /^name$/i, request.name);
  set(1, /^phone$/i, request.phone);
  set(1, /^email$/i, request.email);
  set(1, /^event address$/i, address);
  set(1, /^event date$/i, answer(request, /event date/i) || answer(request, /delivery date/i));
  set(1, /^occasion$/i, answer(request, /occasion/i) || request.eventType);
  set(1, /^guests/i, answer(request, /guest/i));
  set(1, /how they found us/i, request.heard);
  const need = String(request.need || '');
  const tick = (re, on) => { const f = byLabel(1, re); if (f && on) values[f.id] = true; };
  tick(/^party \/ event decor/i, /party|event|celebration|hotel|decor(?!.*porch)/i.test(need.replace(/porch[^,]*/i, '')));
  tick(/^porch decor/i, /porch/i.test(need));
  tick(/^game rentals/i, /game|rental/i.test(need) || Boolean(request.gamesAnswer));
  const games = ` ${norm(request.gamesAnswer)} `;
  if (games.trim()) {
    const gameHeading = fields.filter((f) => f.page === 4 && f.kind === 'check' && /game rentals/i.test(f.heading));
    for (const f of gameHeading) if (games.includes(` ${norm(f.label)} `)) values[f.id] = true;
    const duration = byLabel(4, /^day \(/i);
    if (duration && request.durationAnswer) values[duration.id] = /weekend/i.test(request.durationAnswer) ? 'Weekend' : 'Day';
  }
  const budget = byLabel(4, /their budget/i);
  const b = answer(request, /budget/i);
  if (budget && b) values[budget.id] = b;
  return values;
}

// ---- Online form -----------------------------------------------------------------

export function checklistState(values) {
  const keys = Object.keys(values || {}).filter((k) => k !== '_done' && values[k] !== '' && values[k] !== false && values[k] != null);
  if (values && values._done) return 'done';
  return keys.length ? 'started' : 'none';
}

function input(f, v) {
  const val = v == null || v === false ? '' : String(v);
  if (f.kind === 'check') return `<label class="ckl"><input type="checkbox" id="${f.id}" data-field="${f.id}"${v ? ' checked' : ''}><span>${esc(f.label)}</span></label>`;
  if (f.kind === 'notes') return `<label for="${f.id}">${esc(f.label)}</label><textarea id="${f.id}" data-field="${f.id}" rows="5">${esc(val)}</textarea>`;
  if (f.kind === 'tall') return `<label for="${f.id}">${esc(f.label)}</label><textarea id="${f.id}" data-field="${f.id}" rows="2">${esc(val)}</textarea>`;
  return `<label for="${f.id}">${esc(f.label)}</label><input id="${f.id}" data-field="${f.id}" value="${esc(val)}"${f.kind === 'amount' ? ' inputmode="decimal"' : ''}>`;
}

export function renderOnlineSections(source, values = {}) {
  const { fields, pages } = annotate(source);
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  return pages.map((page, i) => {
    const body = page.blocks.map((b) => {
      if (b.type === 'heading') return `<h3>${esc(b.text)}${b.small ? ` <small class="muted">${esc(b.small)}</small>` : ''}</h3>`;
      if (b.type === 'checks') return `<div class="cks">${b.ids.map((id) => input(byId[id], values[id])).join('')}</div>`;
      if (b.type === 'field' || b.type === 'notes') return `<div class="fld">${input(byId[b.id], values[b.id])}</div>`;
      if (b.type === 'tip') return `<div class="notice warn" style="font-size:.9rem">${esc(b.text)}</div>`;
      return `<div class="quote">${b.rows.map((r) => `<div class="qrow"><div class="qlabel">${esc(r.label)}</div>
        ${r.notesId ? `<div>${input(byId[r.notesId], values[r.notesId])}</div>` : ''}${r.amountId ? `<div>${input(byId[r.amountId], values[r.amountId])}</div>` : ''}</div>`).join('')}</div>`;
    }).join('');
    return `<details class="card sec"${i === 0 ? ' open' : ''}><summary><span>Page ${page.n}</span> ${esc(page.title)}</summary>${body}</details>`;
  }).join('');
}

// ---- Checklist -> invoice --------------------------------------------------------

function amount(v) {
  const m = String(v || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Math.round(Number(m[0]) * 100) : 0;
}

function parseDue(textValue) {
  const s = String(textValue || '');
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) {
    const now = new Date();
    let y = m[3] ? Number(m[3]) : now.getUTCFullYear();
    if (y < 100) y += 2000;
    return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }
  return null;
}

// Quote worksheet lines become invoice lines; "Agreed price / deposit / due date" sets the
// deposit and due date. Returns null when the checklist holds no price at all.
export function invoiceFromChecklist(source, values) {
  if (!values) return null;
  const fields = fieldIndex(source);
  const lines = [];
  let depositCents = null;
  const rows = [];
  for (const f of fields) {
    if (f.kind !== 'amount') continue;
    const notes = fields.find((g) => g.kind === 'cell' && g.row === f.row);
    rows.push({ label: f.row, cents: amount(values[f.id]), note: notes ? String(values[notes.id] || '').trim() : '' });
  }
  for (const r of rows) {
    if (/^total$/i.test(r.label)) continue;
    if (/^deposit/i.test(r.label)) { if (r.cents) depositCents = r.cents; continue; }
    if (!r.cents) continue;
    const base = r.label.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    lines.push({ description: r.note ? `${base}: ${r.note}` : base, qty: 1, unit_cents: r.cents, note: '', refundable: 0 });
  }
  const agreedField = fields.find((f) => f.kind !== 'check' && /agreed price/i.test(f.label));
  const agreed = agreedField ? String(values[agreedField.id] || '') : '';
  const noDates = agreed.replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ').replace(/(\d),(?=\d{3}\b)/g, '$1');
  const nums = (noDates.match(/\d+(?:\.\d+)?/g) || []).map((n) => Math.round(Number(n) * 100));
  const agreedPrice = nums[0] || 0;
  const agreedDeposit = nums[1] || 0;
  if (!lines.length && agreedPrice) lines.push({ description: 'Agreed price', qty: 1, unit_cents: agreedPrice, note: '', refundable: 0 });
  if (!lines.length && depositCents === null && !agreedDeposit) return null;
  return {
    lines,
    depositCents: depositCents !== null ? depositCents : (agreedDeposit || null),
    dueDate: parseDue(agreed),
    agreedPriceCents: agreedPrice || null,
  };
}
