// Inventory (owner-approved 18 Oct 2026; its own page since 19 Oct 2026): /admin/inventory lists
// every rental item with its In / Out today (inventory.mjs itemStatuses), /admin/inventory/<slug>
// shows its upcoming bookings with Edit / Remove / Bring back, /admin/inventory/new and
// /admin/inventory/<slug>/edit are the Add / Edit form. Settings keeps a link card (#inventory).
// Big buttons, plain words, every control explained from helptext.mjs. Where the page sits in the
// admin is INVENTORY_HOME (one line) plus the nav link in views.mjs layout().
import { esc, shortDate } from './util.mjs';
import { tip } from './helptext.mjs';
import { layout, act, confirmStep, hiddenInputs } from './views.mjs';
import INV from '../../scripts/lib/inventory.js';
import { photoUrl } from './inventory.mjs';

const money = (n) => (n == null || Number.isNaN(n) ? '' : `$${n}`);
export const INVENTORY_HOME = '/admin/inventory';
const BACK_INVENTORY = { href: INVENTORY_HOME, label: 'Back to Inventory' };

export const INV_CSS = `
.inv-hide,[data-inv-form] [hidden],#inv-preview[hidden]{display:none!important}
.inv-list{display:grid;gap:12px;margin:12px 0}
.inv-item{display:grid;grid-template-columns:96px 1fr;gap:12px;align-items:start;border:1px solid var(--line);border-radius:14px;padding:12px;background:#fff}
.inv-item.removed{background:#f6f3ee}.inv-item.removed .inv-photo{filter:grayscale(1);opacity:.7}
.inv-photo{width:96px;height:72px;object-fit:cover;border-radius:10px;border:1px solid var(--line);background:var(--cream);display:flex;align-items:center;justify-content:center;font-size:.8rem;color:var(--muted);text-align:center}
.inv-item h3{font-family:Inter,Arial,sans-serif;font-size:1.15rem;font-weight:700;margin:0 0 4px}
.inv-facts{margin:0 0 6px;color:var(--ink)}.inv-facts span{display:block}
.inv-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}
.chip.web{background:#e4f1e1;border-color:#b2d3ab;color:var(--ok)}.chip.adminonly{background:#e6f2f5;border-color:#8fbfcc;color:#1d4652}
.chip.avail{background:#fff;border-color:#b2d3ab;color:var(--ok)}.chip.gone{background:#ececec;color:#444}
.inv-buttons{grid-column:1 / -1;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.inv-buttons .act{margin:0;min-width:0}.inv-buttons>*{min-width:0}.inv-buttons details.confirm{min-width:0}.inv-buttons details.confirm>summary{width:100%;box-sizing:border-box}.inv-item>div{min-width:0}
.inv-status{border-radius:12px;padding:14px 16px;margin:0 0 12px;border:2px solid var(--line);font-size:1.1rem;font-weight:600;background:#fff}
.inv-status[data-state=running],.inv-status[data-state=deploying],.inv-status[data-state=queued],.inv-status[data-state=superseded]{border-color:#ebcf96;background:#fff3dc}
.inv-status[data-state=live],.inv-status[data-state=none]{border-color:#b2d3ab;background:#e4f1e1}
.inv-status[data-state=failed],.inv-status[data-state=needs_key]{border-color:#e3ada2;background:#f9e3de}
.inv-status small{display:block;font-weight:400;font-size:.95rem;color:var(--muted);margin-top:4px}
.inv-kind{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:6px 0 4px;border:0;padding:0}
.inv-kind label{display:flex;align-items:center;gap:10px;min-height:56px;margin:0;padding:8px 12px;border:2px solid var(--line);border-radius:12px;background:#fff;color:var(--ink);font-weight:600}
.inv-kind input{width:24px;height:24px;min-height:24px;flex:none}.inv-kind label:has(input:checked){border-color:var(--accent);outline:2px solid var(--accent)}
.inv-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}.inv-two>div{min-width:0}
.inv-switch{display:flex;align-items:center;gap:12px;min-height:56px;margin:14px 0 4px;padding:8px 12px;border:2px solid var(--line);border-radius:12px;background:#fff;color:var(--ink);font-weight:600}
.inv-switch input{width:28px;height:28px;min-height:28px;flex:none}
.inv-preview{display:block;width:100%;max-width:360px;aspect-ratio:4/3;object-fit:cover;border-radius:12px;border:1px solid var(--line);margin:8px 0;background:var(--cream)}
.inv-photo-btn{position:relative;overflow:hidden}.inv-photo-btn input{position:absolute;inset:0;opacity:0;cursor:pointer;min-height:0}
.inv-note{color:var(--muted);font-size:.95rem;margin:4px 0 0}
.inv-errors li{margin:4px 0}
a.inv-item{color:var(--ink);text-decoration:none}a.inv-item:hover,a.inv-item:focus{border-color:var(--accent);outline:2px solid var(--accent)}
.inv-pill{display:inline-block;border-radius:999px;padding:4px 12px;font:600 1rem Inter,Arial,sans-serif;border:2px solid;margin:0 0 4px}
.inv-pill[data-state=in]{background:#e4f1e1;border-color:#8fc485;color:#24561c}
.inv-pill[data-state=out],.inv-pill[data-state=some]{background:#e3eefb;border-color:#8fb3e0;color:#1d3f6e}
.inv-pill[data-state=hold]{background:#fff3dc;border-color:#e2b65d;color:#6b4a07}
.inv-pill[data-state=off]{background:#ececec;border-color:#bdbdbd;color:#444}
.inv-next{display:block;color:var(--muted);font-size:.95rem}
.inv-open{display:block;margin-top:4px;color:var(--accent);font-weight:600}
.inv-add{margin:6px 0 14px}.inv-add .btn{font-size:1.15rem;min-height:60px}
.inv-group{margin:18px 0 6px;font-size:1.3rem}
.inv-bookings{list-style:none;padding:0;margin:8px 0 14px;display:grid;gap:8px}
.inv-bookings li{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:#fff}
.inv-bookings li[data-now]{border-color:#8fb3e0;background:#f3f8fe}.inv-bookings li[data-hold]{border-color:#e2b65d;background:#fffaf0}
.inv-bookings strong{display:block}
details.inv-more{margin-top:14px}details.inv-more>summary{min-height:48px;display:flex;align-items:center;font-weight:600;color:var(--accent);cursor:pointer}
@media(min-width:1100px){.wide .inv-list{grid-template-columns:1fr 1fr 1fr}}@media(min-width:900px){.inv-list{grid-template-columns:1fr 1fr}.inv-item{grid-template-columns:120px 1fr}.inv-photo{width:120px;height:90px}}
`;

const SECTION_WORDS = { games: 'Game', extras: 'Extra', adminItems: 'Admin only' };

// The In / Out pill. Never the word "available" (owner, 19 Oct 2026): offered is set by hand,
// In / Out comes from the bookings.
export function statusPill(st) {
  const state = st ? st.state : 'in';
  return `<span class="inv-pill" data-inv-pill data-state="${esc(state)}">${esc(st ? st.label : 'In')}</span>`;
}

const priceWords = (row, item, data) => (row.section === 'adminItems' ? 'Not priced (admin only)'
  : row.section === 'games' ? `${money(data.rates.day)} a day · ${money(data.rates.weekend)} a weekend`
    : `${money(item.dayPrice)} a day · ${money(item.weekendPrice)} a weekend`);
const photoOf = (row, item) => { const src = photoUrl(row); return src ? `<img class="inv-photo" src="${esc(src)}" alt="${esc(item.alt || item.name)}" width="120" height="90" loading="lazy">` : '<div class="inv-photo">No photo</div>'; };
const restoreForm = (slug, label = 'Bring back') => `<form method="post" action="${INVENTORY_HOME}/${esc(slug)}/restore">${act(`<button class="btn" type="submit"${tip('inv.restore')}>${esc(label)}</button>`, 'inv.restore')}</form>`;
const removeStep = (slug, item, futureCount) => confirmStep({ key: 'inv.remove', yesKey: 'inv.removeYes', label: 'Remove', danger: true, hidden: '', action: `${INVENTORY_HOME}/${esc(slug)}/remove`,
  question: `Remove ${item.name}?${futureCount ? ` ${futureCount} future ${futureCount === 1 ? 'booking has' : 'bookings have'} it. ${futureCount === 1 ? 'It keeps' : 'They keep'} it.` : ''} It shows as Not offered: off the website, the booking form and the booking picker. Past bookings and invoices keep it.` });

// One item in the list. Offered: the whole card opens the item (its bookings, Edit, Remove).
// Not offered: grey, its own group, with Bring back.
function itemCard(row, item, data, st, futureCount = 0) {
  const isAdmin = row.section === 'adminItems';
  const off = item.availableNow === false;
  const chips = off ? '' : `<div class="inv-chips">${isAdmin ? '<span class="chip adminonly">Admin only</span>' : '<span class="chip web">On the website</span>'}</div>`;
  const inner = `${photoOf(row, item)}<div><h3>${esc(item.name)}</h3>${statusPill(off ? { state: 'off', label: 'Not offered' } : st)}
    ${!off && st && st.next ? `<span class="inv-next" data-inv-next>${esc(st.next.words)}</span>` : ''}${chips}
    <p class="inv-facts"><span>How many: <strong>${esc(item.quantity)}</strong></span><span>${priceWords(row, item, data)}</span></p>`;
  const attrs = `data-inv-item="${esc(row.slug)}" data-inv-section="${esc(row.section)}" data-inv-state="${off ? 'removed' : 'offered'}" data-inv-now="${esc(off ? 'off' : (st ? st.state : 'in'))}"`;
  if (!off) return `<a class="inv-item" href="${INVENTORY_HOME}/${esc(row.slug)}" ${attrs}${tip('inv.open')}>${inner}<span class="inv-open">See its bookings, edit or remove &rarr;</span></div></a>`;
  return `<article class="inv-item removed" ${attrs}>${inner}${futureCount ? `<p class="inv-note" data-inv-future>${futureCount} future ${futureCount === 1 ? 'booking' : 'bookings'}</p>` : ''}</div>
    <div class="inv-buttons">${act(`<a class="btn ghost" href="${INVENTORY_HOME}/${esc(row.slug)}"${tip('inv.openOff')}>Open</a>`, 'inv.openOff')}${restoreForm(row.slug)}</div></article>`;
}

// The website-update box: "Website updating…", "Live ✓", or a plain failure with Try again.
export function statusBox(words) {
  const retry = ['failed', 'needs_key'].includes(words.state)
    ? `<form method="post" action="/admin/settings/inventory/publish" style="margin-top:10px">${act(`<button class="btn" type="submit"${tip('inv.retry')}>Try again</button>`, 'inv.retry')}</form>` : '';
  const small = words.state === 'live' && words.liveAt ? `<small>The website matches your inventory (updated ${esc(words.liveAt)} UTC).</small>`
    : ['running', 'deploying', 'queued', 'superseded'].includes(words.state) ? '<small>About 5 minutes. You can keep working; this box updates by itself.</small>'
      : words.state === 'none' ? '<small>Every change you save here goes on the website by itself in about 5 minutes.</small>' : '';
  return `<div class="inv-status" data-inv-status data-state="${esc(words.state)}" aria-live="polite"><span data-inv-status-text>${esc(words.text)}</span>${small}${retry}</div>`;
}

const POLL_JS = `<script>(function(){var box=document.querySelector('[data-inv-status]');if(!box)return;var t0=Date.now();
function busy(s){return s==='running'||s==='deploying'||s==='queued'||s==='superseded'}
function tick(){if(!busy(box.getAttribute('data-state')))return;fetch('/api/admin/inventory/status',{credentials:'same-origin'}).then(function(r){return r.json()}).then(function(j){
if(!j||!j.state)return;box.setAttribute('data-state',j.state);var el=box.querySelector('[data-inv-status-text]');
var mins=Math.max(0,Math.round((Date.now()-t0)/60000));el.textContent=busy(j.state)?j.text+(mins?' ('+mins+' min)':''):j.text;
if(!busy(j.state)){setTimeout(function(){location.reload()},800);return}setTimeout(tick,8000)}).catch(function(){setTimeout(tick,15000)})}
setTimeout(tick,4000)})();</script>`;

// Settings -> Inventory: a link card (the list has its own page). An old link to
// /admin/settings#inventory lands on the Inventory page (the hash never reaches the server).
export function settingsInventoryCard() {
  return `<p data-inv-link>${act(`<a class="btn" href="${INVENTORY_HOME}"${tip('set.inventoryLink')}>Open Inventory &rarr;</a>`, 'set.inventoryLink')}</p>
  <p class="inv-note">The game price is on the Inventory page too.</p>
  <script>if(location.hash==='#inventory')location.replace('${INVENTORY_HOME}')</script>`;
}

// Settings -> Website auto-update status: the same box the Inventory page shows.
export function websiteStatusCard({ words, keyMissing = false }) {
  return `<style>${INV_CSS}</style>${statusBox(words)}${keyMissing ? KEY_STOP : ''}${POLL_JS}`;
}

const KEY_STOP = '<p class="inv-note" data-inv-key-stop><strong>Website auto-update needs a GitHub key (PNP_GITHUB_TOKEN) to start at once.</strong> Until it is added, each change waits for GitHub\'s 5-minute round, which can run late. Your changes always count in the admin and on the booking form straight away.</p>';

// /admin/inventory: every item with In / Out today.
export function inventoryPage({ state, words, statuses = {}, future = {}, keyMissing = false, flash = '', error = '' }) {
  const data = state.data;
  const bySlug = Object.fromEntries(state.rows.map((r) => [r.slug, r]));
  const list = (section, removed) => (data[section] || []).filter((i) => (i.availableNow === false) === removed)
    .map((i) => itemCard(bySlug[i.slug] || { slug: i.slug, section }, i, data, statuses[i.slug], future[i.slug] || 0));
  const live = INV.SECTIONS.flatMap((sec) => list(sec, false));
  const gone = INV.SECTIONS.flatMap((sec) => list(sec, true));
  const off = (data.bundles || []).filter((b) => b.offBecause);
  const allGames = (data.bundles || []).find((b) => b.allGames);
  const counts = Object.values(statuses).filter((st) => st.offered);
  const outNow = counts.filter((st) => st.state !== 'in').length;
  const body = `<h1>Inventory</h1>
  ${flash ? `<div class="notice ok"><strong>${esc(flash)}</strong></div>` : ''}${error ? `<div class="notice err">${esc(error)}</div>` : ''}
  <section id="inventory" data-inventory>
    <p>Everything you rent out, and whether it is <strong>In</strong> (in the shed today) or <strong>Out</strong> with a customer. In and Out come from your bookings by themselves.${outNow ? ` <strong data-inv-outcount>Out or on hold today: ${outNow}.</strong>` : ''}</p>
    <div class="inv-add">${act(`<a class="btn primary" href="${INVENTORY_HOME}/new"${tip('inv.add')}>+ Add a game or item</a>`, 'inv.add')}</div>
    ${statusBox(words)}
    ${keyMissing ? KEY_STOP : ''}
    ${off.length ? `<div class="notice warn" data-inv-bundles-off>${off.map((b) => `<div><strong>${esc(b.name)}</strong> is off the website: ${esc(b.offBecause)}.</div>`).join('')}</div>` : ''}
    <h2 class="inv-group">Offered</h2>
    <div class="inv-list" data-inv-live>${live.join('')}</div>
    ${gone.length ? `<h2 class="inv-group">Not offered</h2><p class="inv-note">Off the website and the booking form. Bring back puts one back.</p><div class="inv-list" data-inv-removed>${gone.join('')}</div>` : ''}
    ${allGames ? `<p class="inv-note" data-inv-bundles>Whole Yard and The Whole Party include every game on the website: <strong>${esc(allGames.includes.split(',')[0])}</strong>.</p>` : ''}
    <form method="post" action="${INVENTORY_HOME}/rates" class="card" style="margin-top:14px;background:var(--cream)" data-inv-rates>
      <h3>Game price (every game is the same price)</h3>
      <div class="inv-two"><div><label for="rd">Day price ($)</label><input id="rd" name="rate_day" inputmode="numeric" value="${esc(data.rates.day)}"></div>
      <div><label for="rw">Weekend price ($)</label><input id="rw" name="rate_weekend" inputmode="numeric" value="${esc(data.rates.weekend)}"></div></div>
      <div style="margin-top:12px">${act(`<button class="btn ghost" type="submit"${tip('inv.rates')}>Save the game price</button>`, 'inv.rates')}</div>
    </form>
  </section>${POLL_JS}`;
  return layout('Inventory', `<style>${INV_CSS}</style>${body}`, { wide: true, screen: 'inventoryList', back: { href: '/admin/', label: 'Back to requests' } });
}

// /admin/inventory/<slug>: In / Out today, the upcoming bookings, then Edit / Remove / Bring back.
export function itemDetailPage({ row, item, data, status, futureCount = 0, flash = '' }) {
  const off = item.availableNow === false;
  const st = off ? { state: 'off', label: 'Not offered' } : status;
  const ups = (status && status.upcoming) || [];
  const li = (u) => `<li data-inv-booking${u.outNow ? ' data-now' : ''}${u.hold ? ' data-hold' : ''}><strong>${esc(shortDate(u.start))}${u.end !== u.start ? ` &rarr; ${esc(shortDate(u.end))}` : ''}</strong>
    ${esc(u.name)}${u.count > 1 ? ` · ${u.count} sets` : ''}${u.outNow ? (u.late ? ` · out now, was due back ${esc(shortDate(u.end))}` : ' · out now') : ''}${u.hold ? ` · ${esc(u.hold)}` : ''}
    <a href="/admin/day/${esc(u.start)}"${tip('inv.bookingDay')}>Open that day</a></li>`;
  const body = `<h1>${esc(item.name)}</h1>
  ${flash ? `<div class="notice ok"><strong>${esc(flash)}</strong></div>` : ''}
  <div class="card" data-inv-detail="${esc(row.slug)}">
    <div class="inv-item" style="border:0;padding:0">${photoOf(row, item)}<div>${statusPill(st)}${!off && status && status.next ? `<span class="inv-next">${esc(status.next.words)}</span>` : ''}
      <p class="inv-facts"><span>How many: <strong>${esc(item.quantity)}</strong></span><span>${priceWords(row, item, data)}</span>${row.section === 'adminItems' ? '<span>Admin only (not on the website)</span>' : ''}</p></div></div>
    <h2 style="margin-top:14px">Upcoming bookings</h2>
    ${ups.length ? `<ul class="inv-bookings" data-inv-upcoming>${ups.map(li).join('')}</ul>` : '<p data-inv-upcoming-none>No bookings coming up. It is in the shed.</p>'}
    <div class="inv-buttons">${act(`<a class="btn ghost" href="${INVENTORY_HOME}/${esc(row.slug)}/edit"${tip('inv.edit')}>Edit</a>`, 'inv.edit')}${off ? restoreForm(row.slug) : removeStep(row.slug, item, futureCount)}</div>
  </div>`;
  return layout(item.name, `<style>${INV_CSS}</style>${body}`, { screen: 'inventoryList', back: BACK_INVENTORY });
}

const PHOTO_JS = `<script>(function(){var f=document.getElementById('inv-form');if(!f)return;
var file=f.querySelector('[name=photo]'),prev=document.getElementById('inv-preview'),alt=f.querySelector('[name=alt]'),name=f.querySelector('[name=name]'),
kinds=f.querySelectorAll('[name=kind]'),prices=document.getElementById('inv-prices'),gameNote=document.getElementById('inv-game-price'),touched=alt.value!==alt.getAttribute('data-suggest');
alt.addEventListener('input',function(){touched=true});
function kind(){var k='game';kinds.forEach(function(r){if(r.checked)k=r.value});prices.hidden=k!=='extra';gameNote.hidden=k==='extra';
 if(!touched){alt.value=suggest()}}
function suggest(){var n=(name.value||'the item').trim().toLowerCase(),k='game';kinds.forEach(function(r){if(r.checked)k=r.value});
 return k==='extra'?n.charAt(0).toUpperCase()+n.slice(1)+' set up for a backyard party in Memphis':'Black family and friends playing '+n+' on a backyard lawn at a Memphis party'}
kinds.forEach(function(r){r.addEventListener('change',kind)});name.addEventListener('input',function(){if(!touched)alt.value=suggest()});kind();
file.addEventListener('change',function(){var src=file.files&&file.files[0];if(!src)return;var img=new Image();img.onload=function(){
 var W=1200,H=900,c=document.createElement('canvas');c.width=W;c.height=H;var s=Math.max(W/img.naturalWidth,H/img.naturalHeight),w=img.naturalWidth*s,h=img.naturalHeight*s;
 c.getContext('2d').drawImage(img,(W-w)/2,(H-h)/2,w,h);c.toBlob(function(b){if(!b)return;try{var dt=new DataTransfer();dt.items.add(new File([b],'photo.jpg',{type:'image/jpeg'}));file.files=dt.files}catch(e){}
 prev.src=URL.createObjectURL(b);prev.hidden=false},'image/jpeg',0.85)};img.src=URL.createObjectURL(src)});
})();</script>`;

// Add / Edit form. item: the games.json object (or {} for a new one); section: its section.
export function itemFormPage({ item = {}, section = 'games', isNew = true, errors = [], data, row = null, futureCount = 0 }) {
  const kind = section === 'extras' || (section === 'adminItems' && item.kind === 'extra') || (section === 'adminItems' && !item.kind && !isNew) ? 'extra' : 'game';
  const onWebsite = section !== 'adminItems';
  const deposit = item.deposit != null ? item.deposit : data.damageDeposit;
  const suggest = INV.suggestAlt(item.name || '', kind);
  const alt = item.alt || (isNew ? suggest : '');
  const src = row ? photoUrl(row) : '';
  const action = isNew ? `${INVENTORY_HOME}/new` : `${INVENTORY_HOME}/${esc(item.slug)}/edit`;
  const title = isNew ? 'Add an item' : `Edit ${item.name}`;
  const body = `<h1>${esc(title)}</h1>
  ${errors.length ? `<div class="notice err" data-inv-errors><strong>Not saved yet. Please fix:</strong><ul class="inv-errors">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
  <form class="card" id="inv-form" method="post" action="${action}" enctype="multipart/form-data" data-inv-form>
    <fieldset class="inv-kind"><legend style="font-weight:700;margin-bottom:6px">What is it?</legend>
      <label><input type="radio" name="kind" value="game"${kind === 'game' ? ' checked' : ''}> A game</label>
      <label><input type="radio" name="kind" value="extra"${kind === 'extra' ? ' checked' : ''}> An extra (like the movie screen)</label>
    </fieldset>
    <label for="in">Name</label><input id="in" name="name" required maxlength="${INV.LIMITS.name}" value="${esc(item.name || '')}" autocomplete="off">
    <label for="iq">How many do you have?</label><input id="iq" name="quantity" type="number" min="1" max="${INV.LIMITS.quantity}" inputmode="numeric" required value="${esc(item.quantity || 1)}">
    <p class="inv-note" id="inv-game-price" data-inv-game-price>Every game is ${money(data.rates.day)} a day and ${money(data.rates.weekend)} a weekend. Change it for all games under Game price on the Inventory page.</p>
    <div id="inv-prices" class="inv-two" data-inv-prices><div><label for="idp">Day price ($)</label><input id="idp" name="day_price" inputmode="numeric" value="${esc(item.dayPrice != null ? item.dayPrice : '')}"></div>
      <div><label for="iwp">Weekend price ($)</label><input id="iwp" name="weekend_price" inputmode="numeric" value="${esc(item.weekendPrice != null ? item.weekendPrice : '')}"></div></div>
    <label for="idep">Refundable deposit ($)</label><input id="idep" name="deposit" inputmode="numeric" value="${esc(deposit)}">
    <p class="inv-note">One deposit per order: the biggest one among the items rented. The usual deposit is ${money(data.damageDeposit)}.</p>
    <label for="ib">Short description (for the website)</label><textarea id="ib" name="blurb" maxlength="${INV.LIMITS.blurb}" rows="3">${esc(item.blurb || '')}</textarea>
    <label for="is">Size, or what comes with it (one line)</label><input id="is" name="size" maxlength="${INV.LIMITS.size}" placeholder="4 ft tall" value="${esc(item.size || '')}">
    <label for="iu">Indoor or outdoor?</label><select id="iu" name="use">${[['both', 'Indoor or outdoor'], ['outdoor', 'Outdoor only'], ['indoor', 'Indoor (tabletop)']].map(([v, l]) => `<option value="${v}"${(item.use || 'both') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <label>Photo</label>
    <img id="inv-preview" class="inv-preview" alt="The photo you picked"${src ? ` src="${esc(src)}"` : ' hidden'} width="360" height="270">
    ${act(`<label class="btn ghost inv-photo-btn"${tip('inv.photo')}>${src ? 'Change the photo' : 'Add a photo'}<input type="file" name="photo" accept="image/jpeg,image/png,image/*"></label>`, 'inv.photo')}
    <label for="ia">Photo description (read out to blind visitors and to Google)</label><textarea id="ia" name="alt" rows="2" maxlength="${INV.LIMITS.alt}" data-suggest="${esc(suggest)}">${esc(alt)}</textarea>
    <p class="inv-note">We wrote a suggestion. Change it to say what is really in the photo.</p>
    <input type="hidden" name="on_website" value="0">
    <label class="inv-switch"><input type="checkbox" name="on_website" value="1"${onWebsite ? ' checked' : ''}${tip('inv.onWebsite')}> Show on website (off = admin only)</label>
    ${!isNew && futureCount ? `<p class="inv-note">${futureCount} future ${futureCount === 1 ? 'booking has' : 'bookings have'} this item.</p>` : ''}
    <div style="margin-top:16px">${act(`<button class="btn primary" type="submit"${tip('inv.save')}>Save</button>`, 'inv.save')}</div>
    <p style="margin-top:12px"><a href="${isNew ? INVENTORY_HOME : `${INVENTORY_HOME}/${esc(item.slug)}`}"${tip('inv.cancel')}>Cancel, go back to Inventory</a></p>
  </form>${PHOTO_JS}`;
  return layout(title, `<style>${INV_CSS}</style>${body}`, { screen: 'inventory', back: isNew ? BACK_INVENTORY : { href: `${INVENTORY_HOME}/${esc(item.slug)}`, label: `Back to ${item.name}` } });
}

export { hiddenInputs, SECTION_WORDS };
