'use strict';
/**
 * The two price tools at the top of /pricing (owner, 6 Nov 2026 preview review: "the modules
 * that help people the most"): "Price my porch" and "Price my grazing table".
 *
 * Every number comes from the same data the FAQ calculators and the porch pages read
 * (data/offers/porch_packages.json through scripts/lib/faq_content.js, and the grazing tiers and
 * food range there). Money words follow the site: from-prices, and the date-holding deposit as
 * the FAQ states it ("50% of the quote"; the rest by the time we arrive to set up).
 * Rendered by scripts/install_price_tools.js; every page that talks price links here
 * (scripts/lib/site_chrome.js PRICE_TOOLS).
 */
const faq = require('./faq_content');
const PP = require('./porch_packages');
const PARTY = require('./party_pricing');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const DEPOSIT_SHARE = 0.5; // "What holds my date?": 50% of the quote (faq_content booking section)
// The live site's own words, nothing derived (FAQ "What holds my date?", "Can I cancel or move my
// date?", "When is the rest due?"; the admin invoices default to the same half deposit, and the
// request confirmation says the same): the deposit is refundable 48 hours or more before.
const DEPOSIT_LINE = '50% of the quote holds your date. Cancel 48 hours or more before and the deposit comes back in full. The rest is due by the time we arrive to set up.';

function porchConfig() {
  const pk = faq.porchPackages;
  const tiers = PP.tierKeys(pk);
  return {
    seasons: pk.seasons.map((s) => ({ key: s.key, name: s.name, short: s.short, tiers: Object.fromEntries(tiers.map((t) => [t, { from: s.tiers[t].from, includes: s.tiers[t].includes }])) })),
    tiers: tiers.map((t) => ({ key: t, name: pk.tiers[t].name, hint: pk.tiers[t].picturing || '' })),
    deposit: DEPOSIT_SHARE,
    depositLine: DEPOSIT_LINE,
  };
}

function porchToolHtml() {
  const cfg = porchConfig();
  const lead = cfg.seasons.find((s) => s.key === 'christmas') || cfg.seasons[0];
  const seasonChoices = cfg.seasons.map((s) => `<label class="pt-choice"><input type="radio" name="pt-season" value="${s.key}"${s.key === lead.key ? ' checked' : ''}> <span>${esc(s.name)}</span></label>`).join('');
  const sizeChoices = cfg.tiers.map((t, i) => `<label class="pt-choice"><input type="radio" name="pt-tier" value="${t.key}"${i === 1 ? ' checked' : ''}> <span><b>${esc(t.name)}</b>${t.hint ? ` <small>${esc(t.hint)}</small>` : ''}</span></label>`).join('');
  const noscript = cfg.seasons.map((s) => `${esc(s.name)}: ${cfg.tiers.map((t) => `${esc(t.name)} from ${money(s.tiers[t.key].from)}`).join(', ')}.`).join(' ');
  const json = JSON.stringify(cfg).replace(/'/g, '&#39;');
  return `<article class="price-tool" id="price-my-porch" data-price-tool="porch" data-config='${json}'>`
    + `<h3>Price my porch</h3><p class="price-tool-lead">Two taps: the season and how much decor you want.</p>`
    + `<form class="pt-form" onsubmit="return false"><fieldset class="pt-q"><legend>Which season?</legend><div class="pt-choices">${seasonChoices}</div></fieldset>`
    + `<fieldset class="pt-q"><legend>How much decor?</legend><div class="pt-choices">${sizeChoices}</div></fieldset></form>`
    + `<div class="pt-result" aria-live="polite"><p class="pt-price"><span data-out="name"></span> <strong data-out="price"></strong></p><p class="pt-incl" data-out="includes"></p>`
    + `<p class="pt-money" data-out="deposit">${esc(DEPOSIT_LINE)}</p>`
    + `<a class="btn-primary pt-go" data-out="href" href="/request?service=porch#request-form" data-quote-cta="price-my-porch">Request this porch</a></div>`
    + `<noscript><p class="muted">${noscript}</p></noscript>`
    + `<p class="pt-more"><a href="#porch-packages">See all four packages for both seasons</a></p></article>`;
}

function grazingConfig() {
  return { tiers: faq.grazingTiers, food: { low: faq.food.low, high: faq.food.high }, deposit: DEPOSIT_SHARE, depositLine: DEPOSIT_LINE };
}

function grazingToolHtml() {
  const cfg = grazingConfig();
  const json = JSON.stringify(cfg).replace(/'/g, '&#39;');
  const noscript = cfg.tiers.map((t) => `${esc(t.name)}: ${t.feedsSnack[0]} to ${t.feedsSnack[1]} as a snack, ${t.feedsMeal[0]} to ${t.feedsMeal[1]} as the meal, styling from ${money(t.from)}.`).join(' ');
  return `<article class="price-tool" id="price-my-grazing-table" data-price-tool="grazing" data-config='${json}'>`
    + `<h3>Price my grazing table</h3><p class="price-tool-lead">Type your guest count; we size the table and price it.</p>`
    + `<form class="pt-form" onsubmit="return false"><div class="pt-q"><label for="pt-guests" class="pt-label">How many guests?</label><input id="pt-guests" type="number" name="guests" min="1" max="500" value="30" inputmode="numeric"></div>`
    + `<fieldset class="pt-q"><legend>Serving it as</legend><div class="pt-choices"><label class="pt-choice"><input type="radio" name="pt-style" value="snack" checked> <span>A snack with drinks</span></label><label class="pt-choice"><input type="radio" name="pt-style" value="meal"> <span>The meal</span></label></div></fieldset>`
    + `<fieldset class="pt-q"><legend>Food</legend><div class="pt-choices"><label class="pt-choice"><input type="radio" name="pt-food" value="us" checked> <span>Porch &amp; Party brings the food</span></label><label class="pt-choice"><input type="radio" name="pt-food" value="you"> <span>I supply the food</span></label></div></fieldset></form>`
    + `<div class="pt-result" aria-live="polite"><p class="pt-price"><span data-out="size"></span> <strong data-out="styling"></strong></p><p class="pt-incl" data-out="food"></p>`
    + `<p class="pt-money" data-out="deposit">${esc(DEPOSIT_LINE)}</p>`
    + `<a class="btn-primary pt-go" href="/request?service=grazing#request-form" data-quote-cta="price-my-grazing-table">Request this table</a></div>`
    + `<noscript><p class="muted">${noscript}</p></noscript>`
    + `<p class="pt-more muted">${esc(faq.food.line)}</p></article>`;
}

// Party and hotel-room decor: what your budget buys (owner, 6 Nov 2026), the request form's own
// words from scripts/lib/party_pricing.js (never retyped here).
function partyToolHtml() {
  const tiers = PARTY.PARTY_BUDGETS.filter(([v]) => /^\$/.test(v));
  const lobby = PARTY.LOBBY_CHOICES.filter(([v]) => v !== 'not_sure').map(([, l]) => esc(l)).join(' · ');
  return `<article class="price-tool" id="price-my-party-room" data-price-tool="party">`
    + `<h3>Hotel room and party room decor: what your budget buys</h3>`
    + `<ul class="pt-tiers">${tiers.map(([, label]) => `<li>${esc(label)}</li>`).join('')}</ul>`
    + `<p class="pt-incl">${esc(PARTY.BUDGET_HELP)}</p>`
    + `<p class="pt-incl">${esc(PARTY.HOTEL_WINDOW)}</p>`
    + `<p class="pt-incl">For a business, ask for: ${lobby}.</p>`
    + `<p class="pt-money">${esc(DEPOSIT_LINE)}</p>`
    + `<a class="btn-primary pt-go" href="/request?service=party#request-form" data-quote-cta="price-my-party-room">Price my party or hotel room &rsaquo;</a></article>`;
}

// One small script for both tools. Plain words, the same numbers as the data above.
const SCRIPT = `<script>(function(){var m=function(n){return '$'+Math.round(n).toLocaleString('en-US')};
var p=document.querySelector('[data-price-tool="porch"]');if(p){var c=JSON.parse(p.getAttribute('data-config'));var f=p.querySelector('form');var o=function(k){return p.querySelector('[data-out="'+k+'"]')};
var run=function(){var s=f.querySelector('input[name=pt-season]:checked').value,t=f.querySelector('input[name=pt-tier]:checked').value;var se=c.seasons.filter(function(x){return x.key===s})[0];var ti=c.tiers.filter(function(x){return x.key===t})[0];var from=se.tiers[t].from;
o('name').textContent=se.short+' '+ti.name+':';o('price').textContent='from '+m(from);o('includes').textContent=se.tiers[t].includes;o('deposit').textContent=c.depositLine;o('href').setAttribute('href','/request?service=porch&season='+s+'&decor='+t+'#request-form');};
f.addEventListener('change',run);run();}
var g=document.querySelector('[data-price-tool="grazing"]');if(g){var c2=JSON.parse(g.getAttribute('data-config'));var f2=g.querySelector('form');var o2=function(k){return g.querySelector('[data-out="'+k+'"]')};
var pick=function(n,st){var key=st==='meal'?'feedsMeal':'feedsSnack';var main=c2.tiers.slice(0,3),extra=c2.tiers[3];for(var i=0;i<main.length;i++){if(n<=main[i][key][1])return {t:main[i],x:0};}var full=main[2];return {t:full,x:Math.max(0,Math.ceil((n-full[key][1])/extra[key][1]))};};
var run2=function(){var n=Math.max(1,parseInt(f2.guests.value,10)||1);var st=f2.querySelector('input[name=pt-style]:checked').value;var fd=f2.querySelector('input[name=pt-food]:checked').value;var r=pick(n,st);var from=r.t.from+r.x*c2.tiers[3].from;
o2('size').textContent=r.t.name+(r.x?' + '+r.x+' additional table'+(r.x>1?'s':''):'')+' for '+n+' guests:';o2('styling').textContent='styling from '+m(from);o2('food').textContent=fd==='you'?'Food: $0, you supply it.':'Food: about '+m(n*c2.food.low)+' to '+m(n*c2.food.high)+' ('+m(c2.food.low)+' to '+m(c2.food.high)+' a guest), quoted exactly once the menu is set.';o2('deposit').textContent=c2.depositLine;};
f2.addEventListener('input',run2);f2.addEventListener('change',run2);run2();}})();</script>`;

/** The whole block for the top of /pricing. */
function pricingBlockHtml() {
  return `<!--price-tools--><section class="section price-tools" id="price-tools" data-price-tools><div class="container">`
    + `<div class="answer-block"><span class="eyebrow">Price it yourself</span><h2>Get a starting price in under a minute.</h2>`
    + `<p>Pick your porch, your guest count or your decor budget and see what it costs, then send the request with it filled in.</p></div>`
    + `<div class="price-tool-grid">${porchToolHtml()}${grazingToolHtml()}${partyToolHtml()}</div>${SCRIPT}</div></section><!--/price-tools-->`;
}

module.exports = { partyToolHtml, DEPOSIT_LINE, porchConfig, grazingConfig, porchToolHtml, grazingToolHtml, pricingBlockHtml, DEPOSIT_SHARE };
