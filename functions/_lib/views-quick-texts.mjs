// The quick-texts menu behind "💬 Text ▾" (quick-texts.mjs has the words and the rules).
// Phone: a bottom sheet (✕ Close, ← Back to texts, one-handed, nothing on the page moves).
// Laptop (900 px and wider): a panel under the button, the list left and the chosen text right,
// Copy text first. Each card carries its menu, filled in, in a <template>; QT_JS opens it.
import { esc } from './util.mjs';
import { tip } from './helptext.mjs';
import { menuFor, fullText, smsHref, quickCtx } from './quick-texts.mjs';

const opt = (q, c, best) => {
  const body = fullText(q, c);
  return `<button type="button" class="qtopt${best ? ' best' : ''}" data-qt-pick="${esc(q.id)}" data-qt-name="${esc(q.t)}"${tip('qt.option')}><b>${esc(q.t)}</b><small>${esc(q.b(c))}</small><span hidden data-qt-body>${esc(body)}</span></button>`;
};

// The menu for one card. facts: { r, bookings, inv, hold, dates, services, current, rk }.
export function quickMenu(facts) {
  const c = quickCtx(facts);
  const digits = String(c.phone || '').replace(/\D/g, '');
  if (digits.length < 7) return '';
  const m = menuFor({ services: facts.services, current: facts.current });
  const blank = `<button type="button" class="qtblank" data-qt-pick="blank" data-qt-name="Blank text"${tip('qt.blank')}>✏️ Blank text<small>Write your own message to ${esc(c.first)}</small><span hidden data-qt-body>${esc(fullText(null, c))}</span></button>`;
  const best = `<div class="qtgrp" data-qt-best><span class="qtlabel">Best right now (${esc(m.best.words)})</span>${m.best.items.map((q) => opt(q, c, true)).join('')}</div>`;
  const groups = m.groups.filter((g) => g.items.length).map((g) => `<div class="qtgrp" data-qt-group="${esc(g.key)}"><span class="qtlabel">${esc(g.name)}</span>${g.items.map((q) => opt(q, c, false)).join('')}</div>`).join('');
  return `<template data-qt-menu><div class="qtbox" role="dialog" aria-label="Texts for ${esc(c.first)}" data-qt-box data-qt-rk="${esc(facts.rk)}" data-qt-phone="${esc(digits)}" data-qt-first="${esc(c.first)}">
<div class="qthead"><div><b>Text ${esc(c.first)}</b><small>${esc(c.phone)}</small></div><button type="button" class="qtx" data-qt-close${tip('qt.close')}>✕ Close</button></div>
<div class="qtcols"><div class="qtlist" data-qt-list>${blank}${best}
<button type="button" class="qtall" data-qt-all aria-expanded="false"${tip('qt.all')}>All texts for this job ▾</button><div class="qtallbox" data-qt-allbox hidden>${groups}</div></div>
<div class="qtpv" data-qt-pv hidden><button type="button" class="qtx qtback" data-qt-back${tip('qt.back')}>← Back to texts</button>
<span class="qtlabel" data-qt-pvlabel></span><textarea data-qt-ta rows="7" aria-label="Text message"></textarea><p class="qthint" data-qt-hint></p>
<a class="qtgo" data-qt-send href="sms:${esc(digits)}"${tip('qt.send')}><span class="qtph">Open in Messages to send</span><span class="qtwd">Open in Messages (Mac linked to iPhone)</span></a>
<button type="button" class="qtgo2" data-qt-copy${tip('qt.copy')}>Copy text</button><p class="qtmsg" data-qt-msg aria-live="polite"></p></div>
<p class="qtchoose" data-qt-choose>Choose a text on the left.</p></div></div></template>`;
}

export const QT_CSS = `
.stepcard .qa button.qttext,.stepcard .qa a[data-card-text]{background:var(--accent);color:#fff}
.qtshade{position:fixed;inset:0;z-index:60;background:rgba(30,20,15,.45);display:flex;align-items:flex-end}
.qtbox{background:#fff;color:var(--ink);width:100%;max-height:88vh;overflow:auto;overscroll-behavior:contain;border-radius:18px 18px 0 0;padding:12px 14px calc(18px + env(safe-area-inset-bottom,0px));display:grid;gap:10px;box-shadow:0 -8px 30px rgba(0,0,0,.2);font-size:1.05rem}
.qthead{display:flex;justify-content:space-between;align-items:center;gap:8px;position:sticky;top:-12px;background:#fff;padding:6px 0;z-index:1}
.qthead b{font-size:1.15rem}.qthead small{display:block;color:var(--muted);font-weight:400;font-size:.95rem}
.qtx{font:inherit;font-weight:700;min-height:48px;border:2px solid var(--line);background:#faf7f2;color:var(--ink);border-radius:12px;padding:6px 14px;cursor:pointer;white-space:nowrap}
.qtcols,.qtlist,.qtgrp,.qtallbox,.qtpv{display:grid;gap:8px;align-content:start;min-width:0}
.qtallbox[hidden],.qtpv[hidden],.qtlist[hidden]{display:none}
.qtlabel{font-weight:700;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.qtblank{font:inherit;text-align:left;min-height:56px;border:2px dashed var(--accent);background:#fbeee7;color:var(--ink);border-radius:12px;padding:12px;cursor:pointer;font-weight:700;display:grid;gap:2px}
.qtblank small{font-weight:400;color:var(--muted)}
.qtopt{font:inherit;text-align:left;min-height:56px;border:1px solid var(--line);background:#faf7f2;color:var(--ink);border-radius:12px;padding:10px 12px;cursor:pointer;display:grid;gap:2px}
.qtopt small{color:var(--muted);font-size:.9rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.qtopt.best{border:2px solid #2f7a46;background:#e5f2e8}
.qtopt[aria-current=true],.qtblank[aria-current=true]{outline:3px solid var(--accent);outline-offset:1px}
.qtall{font:inherit;font-weight:700;text-align:left;min-height:48px;border:0;background:none;color:var(--accent);cursor:pointer;padding:6px 0;text-decoration:underline}
.qtpv textarea{font:inherit;font-size:1.05rem;width:100%;min-height:180px;border:2px solid var(--line);border-radius:12px;padding:10px;background:#faf7f2;color:var(--ink);resize:vertical;margin:0}
.qthint{margin:0;font-size:.95rem;color:var(--muted)}.qthint.blank{color:#92400e;font-weight:700}
.qtgo{display:flex;align-items:center;justify-content:center;min-height:52px;border-radius:12px;background:var(--accent);color:#fff;font-weight:700;font-size:1.1rem;text-decoration:none;text-align:center;padding:8px 12px}
.qtgo2{font:inherit;font-weight:700;min-height:48px;border:2px solid var(--accent);background:#fff;color:var(--accent);border-radius:12px;cursor:pointer}
.qtmsg{margin:0;font-weight:700;color:#2f5a2b}.qtmsg:empty{display:none}
.qtwd,.qtchoose{display:none}
.qtsent{margin:4px 0 0;padding:6px 10px;border-radius:10px;background:#e5f2e8;color:#2f5a2b;font-weight:700;font-size:.95rem}
@media(min-width:900px){
.qtshade{display:none}
.qtbox.wide{position:absolute;right:12px;width:min(680px,calc(100% - 24px));max-height:none;border-radius:14px;border:1px solid var(--line);box-shadow:0 14px 40px rgba(0,0,0,.22);z-index:30;padding:12px}
.qtbox.wide .qthead{grid-column:1/-1;position:static}
.qtbox.wide .qtcols{grid-template-columns:1fr 1fr;gap:14px}
.qtbox.wide .qtlist{max-height:440px;overflow:auto}
.qtbox.wide .qtlist[hidden]{display:grid}
.qtbox.wide .qtback{display:none}
.qtbox.wide .qtchoose{display:block;margin:0;color:var(--muted)}
.qtbox.wide .qtpv:not([hidden])~.qtchoose{display:none}
.qtbox.wide .qtph{display:none}.qtbox.wide .qtwd{display:inline}
.qtbox.wide .qtgo2{order:1;background:var(--accent);color:#fff;min-height:52px;font-size:1.1rem}
.qtbox.wide .qtgo{order:2;background:#fff;color:var(--accent);border:2px solid var(--accent);min-height:48px;font-size:1rem}
.qtbox.wide .qtmsg{order:3}
}
@media (prefers-reduced-motion:no-preference){.qtshade .qtbox{animation:qtup .18s ease-out}@keyframes qtup{from{transform:translateY(30px);opacity:.6}}}
`;

// The page script. smsHref is the same function the server tests (quick-texts.mjs), and it
// reads the words in the box at the moment she taps Open in Messages.
export const QT_JS = `(function(){var smsHref=${smsHref.toString()};
var open=null;function wide(){return window.matchMedia('(min-width:900px)').matches;}
function close(){if(!open)return;var o=open;open=null;if(o.shade)o.shade.remove();else o.box.remove();document.documentElement.style.overflow='';o.btn.setAttribute('aria-expanded','false');try{o.btn.focus({preventScroll:true});}catch(e){}}
function hint(o){var v=o.ta.value,h=o.box.querySelector('[data-qt-hint]');if(/__/.test(v)){h.textContent='Fill in the blank before you send.';h.className='qthint blank';}else if(o.pick==='blank'){h.textContent='Write your message after "Hi '+o.box.getAttribute('data-qt-first')+'!", then send.';h.className='qthint';}else{h.textContent='You can change any word before it opens in Messages.';h.className='qthint';}}
function list(o){o.box.querySelector('[data-qt-pv]').hidden=true;o.box.querySelector('[data-qt-list]').hidden=false;}
function pick(o,b){var pv=o.box.querySelector('[data-qt-pv]');o.pick=b.getAttribute('data-qt-pick');o.title=b.getAttribute('data-qt-name');
o.box.querySelectorAll('[data-qt-pick]').forEach(function(x){x.removeAttribute('aria-current');});b.setAttribute('aria-current','true');
o.box.querySelector('[data-qt-pvlabel]').textContent=o.title+' · to '+o.box.getAttribute('data-qt-first');o.ta.value=b.querySelector('[data-qt-body]').textContent;o.box.querySelector('[data-qt-msg]').textContent='';
pv.hidden=false;if(!wide()){o.box.querySelector('[data-qt-list]').hidden=true;o.box.scrollTop=0;}hint(o);}
function openFor(btn){var card=btn.closest('article');var tpl=card&&card.querySelector('template[data-qt-menu]');if(!tpl)return false;close();
var box=tpl.content.firstElementChild.cloneNode(true);var o={btn:btn,box:box,card:card,ta:box.querySelector('[data-qt-ta]'),pick:'',title:''};
if(wide()){box.classList.add('wide');var all=box.querySelector('[data-qt-allbox]');all.hidden=false;box.querySelector('[data-qt-all]').setAttribute('aria-expanded','true');
var cr=card.getBoundingClientRect(),br=btn.getBoundingClientRect();box.style.top=(br.bottom-cr.top+8)+'px';card.appendChild(box);}
else{var sh=document.createElement('div');sh.className='qtshade';sh.setAttribute('data-qt-shade','');sh.appendChild(box);document.body.appendChild(sh);o.shade=sh;document.documentElement.style.overflow='hidden';}
open=o;btn.setAttribute('aria-expanded','true');o.ta.addEventListener('input',function(){hint(o);});try{box.querySelector('[data-qt-close]').focus({preventScroll:true});}catch(e){}return true;}
function sent(o){var line=document.createElement('p');line.className='qtsent';line.setAttribute('data-qt-sent','');line.textContent='✓ Texted: '+o.title+' · just now';
var head=o.card.querySelector('.schead');if(head)head.insertAdjacentElement('afterend',line);var h=o.card.querySelector('[data-history]');if(h){var li=document.createElement('li');li.textContent='Just now · Texted: '+o.title;h.insertBefore(li,h.firstChild);}}
document.addEventListener('click',function(e){var t=e.target;
var ob=t.closest('[data-qt-open]');if(ob){if(openFor(ob))e.preventDefault();return;}
if(!open)return;var o=open;
if(t.hasAttribute&&t.hasAttribute('data-qt-shade')){close();return;}
if(t.closest('[data-qt-close]')){close();return;}
if(t.closest('[data-qt-back]')){list(o);return;}
var al=t.closest('[data-qt-all]');if(al){var bx=o.box.querySelector('[data-qt-allbox]');bx.hidden=!bx.hidden;al.setAttribute('aria-expanded',bx.hidden?'false':'true');return;}
var pb=t.closest('[data-qt-pick]');if(pb&&o.box.contains(pb)){pick(o,pb);return;}
var sd=t.closest('[data-qt-send]');if(sd){var href=smsHref(o.box.getAttribute('data-qt-phone'),o.ta.value);if(!href){e.preventDefault();return;}sd.setAttribute('href',href);
var f=new FormData();f.append('r',o.box.getAttribute('data-qt-rk'));f.append('quick',o.pick);try{fetch('/admin/msg/tapped',{method:'POST',body:f,headers:{'X-Pnp-Fetch':'1'},credentials:'same-origin',keepalive:true});}catch(err){}
sent(o);setTimeout(close,400);return;}
if(t.closest('[data-qt-copy]')){var m=o.box.querySelector('[data-qt-msg]');var ok=function(){m.textContent='Copied. Paste it into Messages.';};
try{navigator.clipboard.writeText(o.ta.value).then(ok,function(){o.ta.select();document.execCommand('copy');ok();});}catch(err){o.ta.select();try{document.execCommand('copy');}catch(x){}ok();}return;}
if(o.box.classList.contains('wide')&&!o.box.contains(t)&&!t.closest('[data-qt-open]'))close();});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&open)close();});})();`;
