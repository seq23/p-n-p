#!/usr/bin/env node
/**
 * Customer numbers, the laptop "Customers" spine and the phone menu / filter / customer bar
 * (owner-approved mock-up, 20 Oct 2026). Drives the real router over a fresh local database.
 * Fails when:
 *  1. a request card on /admin lacks its number (circle on the left edge + "Customer N" label), or
 *     the numbers are not 1..N by arrival time over ALL active requests (oldest = 1, newest at the
 *     top = highest), or a filter renumbers, or putting one away renumbers anything but by closing
 *     the gap in arrival order, or a put-away card wears a number;
 *  2. the spine's entries are not exactly the visible cards, in order, each "Customer N" / first
 *     name / service and a plain #c-<key> anchor that exists on the page, in the service colour;
 *  3. any admin screen's nav lacks the labelled "☰ Menu ▾" button (a #admin-menu link), the
 *     "✕ Close menu" link, the panel around the full nav, the :target no-JS fallback, or the
 *     current screen marked aria-current="page";
 *  4. Requests lacks the labelled native <select> ("Filter: tap to choose ▾", "Everything (active + done) (N)"
 *     then the five filters with counts, data-href = the bubbles' hrefs, a no-JS Show button), or
 *     the dark customer bar directly below it (‹ name ▾ ›, sticky, a <details> jump list of the
 *     visible cards "N Name · Service"), or the phone/laptop CSS split at 900 px, or the scripts
 *     do not parse; or the missed/tidy strips no longer sit above the filter.
 * Rule 0: fewer than 60 checks, or fewer than 3 active cards in the scenario, is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const V = await mod('functions/_lib/views.mjs');
const C = await mod('functions/_lib/cards.mjs');

// ---- 1a. the rule, as a unit --------------------------------------------------------------
const fake = [{ key: 'c', sortTime: 300 }, { key: 'a', sortTime: 100 }, { key: 'b', sortTime: 200 }, { key: 'b2', sortTime: 200 }, { key: 'z', sortTime: NaN }];
const n = V.customerNumbers(fake);
must(n.get('z') === 1 && n.get('a') === 2 && n.get('b') === 3 && n.get('b2') === 4 && n.get('c') === 5, `customerNumbers is not oldest = 1 with ties by key: ${JSON.stringify([...n])}`);
must(JSON.stringify([...V.customerNumbers([...fake].reverse())].sort()) === JSON.stringify([...n].sort()), 'customerNumbers depends on the input order');

// ---- 1a'. which card is current, as a unit (the one-card lag, 20 Oct 2026) ----------------------
// Live repro: Customer 3's last "Show more" row peeks in under the bar while Customer 2's card
// (top ~120 px down) fills the screen; the old picker (last card whose top <= bar + 8) kept 3.
{
  const P = V.pickCurrentCard;
  must(typeof P === 'function', 'pickCurrentCard is not exported');
  const R = (...xs) => xs.map(([top, bottom]) => ({ top, bottom }));
  // Laptop, no bar, 900 px tall: the previous card's tail only, the next card's top at 120 px.
  must(P(R([-1400, 100], [120, 1500], [1520, 2400]), 0, 900, false) === 1, 'laptop: the previous card\'s tail wins over the card filling the screen');
  // Phone, bar bottom 56, 800 tall: the next card's top just below the bar.
  must(P(R([-900, 50], [70, 1400], [1420, 2000]), 56, 800, false) === 1, 'phone: a card whose top sits just below the bar is not current');
  must(P(R([-900, 30], [40, 1400]), 56, 800, false) === 1, 'phone: the previous card\'s tail hidden behind the bar still wins');
  // Line = 56 + 0.25 * 744 = 242: a top just above it is current, just below it is not yet.
  must(P(R([-900, 240], [241, 1400]), 56, 800, false) === 1 && P(R([-900, 243], [244, 1400]), 56, 800, false) === 0, 'the switch does not happen when a card\'s top crosses the reading line');
  // A card covering the whole screen stays current; above every card, the first; a gap holds the last above.
  must(P(R([-2000, 2000], [2010, 3000]), 56, 800, false) === 0, 'a card covering the screen is not current');
  must(P(R([300, 900], [920, 1400]), 56, 800, false) === 0, 'above every card the first is not current');
  must(P(R([-500, 200], [260, 900]), 56, 800, false) === 0, 'in the gap between cards the card above does not hold');
  // A jump lands the card's top just under the bar (bar + 8): that card is current.
  must(P(R([-600, 40], [64, 300], [320, 900]), 56, 800, false) === 1, 'after a jump the landed card is not current');
  // At the very bottom the last short card (top on screen) is reachable by ‹ / ›.
  must(P(R([-600, 400], [420, 700]), 56, 800, true) === 1, 'at the bottom the last card on screen is not current');
  must(P(R([-600, 400], [820, 900]), 56, 800, true) === 0, 'at the bottom a card below the screen is current');
}

// ---- 1b. through the router ---------------------------------------------------------------
const s = await session();
// Two more website requests (newest), so the list has several cards and the numbers are not trivial.
const F = await mod('functions/_lib/request-form.mjs');
const plus = (d) => { const x = new Date(`${F.chicagoToday()}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
for (const [i, name] of ['Nadia Newer', 'Odette Newest'].entries()) {
  const res = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', event_date: plus(20 + i), location: 'Bartlett', name, phone: `(901) 555-017${i}`, email: `cust${i}@example.com` });
  must(res.status === 303, `the scenario request ${name} did not go through (${res.status})`);
}
const { loadRequests } = await mod('functions/_lib/requests.mjs');
const allReq = await loadRequests(s.env);
const cardsOf = (html) => [...html.matchAll(/<article class="card stepcard[^"]*" data-card="([^"]+)"[^>]*>/g)].map((m) => {
  const start = m.index;
  const body = html.slice(start, html.indexOf('</article>', start));
  return { rk: m[1], tag: m[0], body, num: Number((m[0].match(/data-customer="(\d+)"/) || [])[1] || 0) };
});
const home = await s.get('/admin/');
must(home.status === 200, `/admin answered ${home.status}`);
const H = home.text;
const cards = cardsOf(H);
must(cards.length >= 3, `Rule 0: only ${cards.length} active cards in the scenario`);
const byRk = new Map(allReq.map((r) => [s.rk(r.key), r]));
const active = cards.map((c) => byRk.get(c.rk)).filter(Boolean);
must(active.length === cards.length, 'a card does not match a request');
const want = [...active].sort((a, b) => (a.sortTime || 0) - (b.sortTime || 0) || String(a.key).localeCompare(String(b.key)));
for (const c of cards) {
  const r = byRk.get(c.rk);
  const expect = want.indexOf(r) + 1;
  must(c.num === expect, `${r.name}: Customer ${c.num}, want ${expect} (oldest = 1 by arrival)`);
  must(new RegExp(`<span class="cnum" data-customer-num aria-hidden="true">${expect}</span>`).test(c.body), `${r.name}: no numbered circle`);
  must(new RegExp(`<p class="custno" data-customer-label>Customer ${expect}</p>`).test(c.body), `${r.name}: no "Customer ${expect}" label`);
  const bar = (C.serviceBadge(C.servicesOf(r)[0]) || {}).bar;
  must(!bar || c.tag.includes(`--cc:${bar}`), `${r.name}: the circle is not in the service colour`);
}
must(cards.every((c, i) => i === 0 || c.num < cards[i - 1].num), `the numbers do not count down from the top: ${cards.map((c) => c.num)}`);
must(cards[0].num === cards.length && Math.min(...cards.map((c) => c.num)) === 1, 'the top card is not the highest number or the oldest is not 1');
must(/\.cnum\{position:absolute;left:-19px;top:-10px/.test(H) && /article\[data-reqcard\]\{position:relative/.test(H), 'the circle does not sit on the left edge at the top');

// Filters never renumber.
const numOf = new Map(cards.map((c) => [c.rk, c.num]));
let filtered = 0;
for (const [k] of C.FILTERS) {
  const res = await s.get(k === 'all' ? '/admin/' : `/admin/?f=${k}`);
  const fc = cardsOf(res.text);
  filtered += fc.length;
  must(fc.every((c) => c.num === numOf.get(c.rk)), `filter ${k} renumbers cards`);
  // 2. the spine = the visible cards, in order.
  const spine = (res.text.match(/<nav class="spine" aria-label="Customers" data-spine>([\s\S]*?)<\/nav>/) || [])[1];
  must(spine !== undefined && /<p class="sph">Customers<\/p>/.test(spine), `filter ${k}: no "Customers" spine`);
  const items = [...(spine || '').matchAll(/<a href="#c-([^"]+)" data-spine-to="([^"]+)" style="--c:(#[0-9a-f]{6})"[^>]*><span>Customer (\d+)<\/span>([^<]+)<small>([^<]+)<\/small><\/a>/g)];
  must(JSON.stringify(items.map((m) => m[1])) === JSON.stringify(fc.map((c) => c.rk)), `filter ${k}: spine entries are not the visible cards in order`);
  for (const m of items) {
    const r = byRk.get(m[1]);
    must(m[1] === m[2] && res.text.includes(`id="c-${m[1]}"`), `filter ${k}: spine anchor #c-${m[1]} has no card`);
    must(Number(m[4]) === numOf.get(m[1]) && m[5] === V.firstName(r.name).replace(/&/g, '&amp;') && m[3] === (C.serviceBadge(C.servicesOf(r)[0]) || { bar: '#57534e' }).bar, `filter ${k}: spine entry for ${r.name} is wrong: ${m[0].slice(0, 160)}`);
  }
  // 4. the select: every option, its count and href; the current one selected.
  const sel = (res.text.match(/<form class="ffl" method="get" action="\/admin\/" data-filter-select><label for="ffsel">Filter: tap to choose &#9662;<\/label><select id="ffsel" name="f" data-filter-pick[^>]*>([\s\S]*?)<\/select><noscript><button class="btn ghost" type="submit"[^>]*>Show<\/button><\/noscript><\/form>/) || [])[1];
  must(Boolean(sel), `filter ${k}: no labelled filter drop-down with a no-JS Show button`);
  const opts = [...(sel || '').matchAll(/<option value="([a-z]+)" data-href="([^"]+)"( selected)?>([^<]+) \((\d+)\)<\/option>/g)];
  // Three endings (owner-approved "Done Cards", 20 Oct 2026): Everything (active + done), Active
  // only, Done only, Cancelled only, then the services and Not paid yet.
  must(opts.length === C.FILTERS.length && C.FILTERS.length === 9 && opts.map((o) => o[1]).join() === 'all,active,done,cancelled,porch,party,grazing,rentals,unpaid' && opts[0][4] === 'Everything (active + done)' && Number(opts[0][5]) === cards.length, `filter ${k}: the options are not Everything (active + done) (${cards.length}), Active only, Done only, Cancelled only, the services, Not paid yet`);
  for (const o of opts) {
    const bubble = (res.text.match(new RegExp(`<a href="([^"]+)"[^>]*data-filter="${o[1]}"`)) || [])[1];
    must(o[2] === bubble, `filter ${k}: option ${o[1]} goes to ${o[2]}, the bubble goes to ${bubble}`);
    const label = (C.FILTERS.find(([x]) => x === o[1]) || [])[1];
    must(o[4] === label.replace(/&/g, '&amp;'), `filter ${k}: option ${o[1]} reads "${o[4]}"`);
    must(Boolean(o[3]) === (o[1] === k), `filter ${k}: option ${o[1]} selected wrongly`);
  }
  if (opts.find((o) => o[1] === k)) must(Number(opts.find((o) => o[1] === k)[5]) === fc.length, `filter ${k}: the count ${opts.find((o) => o[1] === k)[5]} is not the ${fc.length} cards it shows`);
  // 4. the customer bar directly below the drop-down.
  const after = res.text.slice(res.text.indexOf('</form>', res.text.indexOf('data-filter-select')) + 7).trimStart();
  if (fc.length) {
    must(after.startsWith('<div class="cbar" data-customer-bar>'), `filter ${k}: the customer bar is not directly below the filter`);
    const bar = after.slice(0, after.indexOf('<div data-request-list>'));
    const top = byRk.get(fc[0].rk);
    must(new RegExp(`^<div class="cbar" data-customer-bar><a class="cstep" href="#c-${fc[0].rk}" data-cstep="-1" aria-label="Previous customer"[^>]*>&#8249;</a><details class="cjump" data-customer-jump><summary data-customer-now[^>]*>Customer ${fc[0].num} · [^<]+ &#9662;</summary>`).test(bar), `filter ${k}: the bar is not ‹ Customer ${fc[0].num} · ${top.name} ▾ ›`);
    must(new RegExp(`<a class="cstep" href="#c-${(fc[1] || fc[0]).rk}" data-cstep="1" aria-label="Next customer"[^>]*>&#8250;</a></div>`).test(bar), `filter ${k}: › does not go to the next card`);
    const jl = [...bar.matchAll(/<a href="#c-([^"]+)" data-cjump="([^"]+)" style="--c:#[0-9a-f]{6}"[^>]*><b>(\d+)<\/b> ([^<]+) · ([^<]+)<\/a>/g)];
    must(JSON.stringify(jl.map((m) => [m[1], Number(m[3])])) === JSON.stringify(fc.map((c) => [c.rk, c.num])), `filter ${k}: the jump list is not the visible cards "N Name · Service"`);
  } else must(!res.text.includes('<div class="cbar" data-customer-bar>'), `filter ${k}: a customer bar with no cards`);
}
must(filtered > cards.length, 'Rule 0: the filters showed no cards beyond All');

// 1c. Put one away: no number on it; the rest keep their arrival order with the gap closed.
const away = cards[Math.floor(cards.length / 2)];
const pa = await s.post('/admin/requests/archive', { r: away.rk });
must(pa.status === 303, `put away answered ${pa.status}`);
const after = await s.get('/admin/?pa=1');
const left = cardsOf(after.text);
must(left.length === cards.length - 1 && !left.some((c) => c.rk === away.rk), 'put away did not take the card off the list');
for (const c of left) must(c.num === numOf.get(c.rk) - (numOf.get(c.rk) > away.num ? 1 : 0), `after put away, ${byRk.get(c.rk).name} is ${c.num}, not ${numOf.get(c.rk) - (numOf.get(c.rk) > away.num ? 1 : 0)}`);
const archivedCard = (after.text.match(new RegExp(`<article[^>]*data-archived="${away.rk}"[^>]*>[\\s\\S]*?</article>`)) || [''])[0];
must(archivedCard && !/data-customer|class="cnum"|data-customer-label/.test(archivedCard), 'the put-away card wears a number');
must(!new RegExp(`data-spine-to="${away.rk}"|data-cjump="${away.rk}"`).test(after.text), 'the put-away card is in the spine or the jump list');

// ---- 3. the phone menu on every admin screen ----------------------------------------------
const SCREENS = [['/admin/', '/admin/'], ['/admin/calendar', '/admin/calendar'], ['/admin/money', '/admin/money'], ['/admin/inventory', '/admin/inventory'], ['/admin/library', '/admin/library'], ['/admin/settings', '/admin/settings'], ['/admin/help', '/admin/help'], ['/admin/pricing', '/admin/pricing'], ['/admin/search', '']];
for (const [p, current] of SCREENS) {
  const res = await s.get(p);
  const t = res.text;
  must(res.status === 200, `${p} answered ${res.status}`);
  must(/<header class="top" id="admin-menu" data-topbar><a class="brand" href="\/admin\/"[^>]*>Porch &amp; Party<\/a><a class="menubtn mopen" href="#admin-menu" role="button" aria-controls="admin-nav" aria-expanded="false" data-menu-btn[^>]*>&#9776; Menu &#9662;<\/a><a class="menubtn mclose" href="#" role="button" aria-controls="admin-nav" data-menu-close[^>]*>&#10005; Close menu<\/a><div class="navpanel" id="admin-nav" data-menu-panel><nav aria-label="Main">/.test(t), `${p}: no "Porch & Party" + "☰ Menu ▾" / "✕ Close menu" line with the panel around the nav`);
  const nav = (t.match(/<nav aria-label="Main">([\s\S]*?)<\/nav><\/div><\/header>/) || [])[1] || '';
  must((nav.match(/<a href="\/admin\//g) || []).length === 8 && /Sign out<\/button>/.test(nav), `${p}: the panel does not hold every nav item`);
  const marked = [...nav.matchAll(/<a href="([^"]+)" aria-current="page"/g)].map((m) => m[1]);
  must(JSON.stringify(marked) === JSON.stringify(current ? [current] : []), `${p}: the current screen marked is ${JSON.stringify(marked)}`);
  // The main page has no ← Back, it says it is the main page; every other screen keeps the ← Back bar.
  if (p === '/admin/') must(/<div class="adminbar mainhead" data-adminbar data-mainpage><h1>Main page: Customers<small>Every request, newest first<\/small><\/h1><\/div>/.test(t) && !/&larr; Back|\sdata-back[\s>]|aria-label="Back"/.test(t), `${p}: the main page has a ← Back, or lacks "Main page: Customers"`);
  else must(/<nav class="adminbar noprint" aria-label="Back" data-adminbar>/.test(t) && !/data-mainpage/.test(t), `${p}: the ← Back bar is gone`);
  must(/header\.top\.open \.navpanel,header\.top:target \.navpanel\{display:block\}/.test(t) && /header\.top \.navpanel\{display:none;flex-basis:100%/.test(t) && /@media\(max-width:899px\)\{header\.top\{/.test(t), `${p}: the menu panel is not hidden on a phone with a :target (no-JS) and .open fallback`);
  must(/header\.top\.open \.mclose,header\.top:target \.mclose\{display:inline-flex\}/.test(t) && /header\.top\.open \.mopen,header\.top:target \.mopen\{display:none\}/.test(t), `${p}: the button does not become "✕ Close menu" when open`);
  must(/\.menubtn\{display:none\}/.test(t), `${p}: the Menu button shows on a laptop`);
  const scripts = [...t.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  must(scripts.some((x) => x.includes("[data-menu-btn]")), `${p}: no menu script`);
  for (const x of scripts) { let ok = true; try { new Function(x); } catch (e) { ok = false; errors.push(`${p}: a script does not parse: ${e.message}`); } must(ok, `${p}: script check`); }
}

// ---- 4. layout on Requests ----------------------------------------------------------------
must(/@media\(max-width:899px\)\{\.filters\{display:none\}\.ffl\{display:block;margin:0 0 10px\}\.cbar\{display:flex\}/.test(H), 'on a phone the bubbles are not swapped for the drop-down + customer bar');
must(/\.ffl,\.cbar,\.spine\{display:none\}/.test(H), 'the drop-down, bar or spine shows outside its own layout');
must(/\.cbar\{position:sticky;top:0;/.test(H) && /body\{overflow-x:clip\}/.test(H), 'the customer bar is not sticky (or body is a scroll container that breaks sticky)');
must(/@media\(min-width:900px\)\{\.wrap\.panelwide\.hasspine\{max-width:1270px\}\.rqgrid\{display:grid;grid-template-columns:170px minmax\(0,1fr\)/.test(H) && /\.spine\{display:grid;gap:6px;position:sticky;top:12px/.test(H), 'the spine is not a sticky column of its own beside the cards on a laptop');
must(/<main class="wrap panelwide hasspine">/.test(H), 'the Requests page is not widened for the spine');
// The spine is its own grid column: at 1280 the main column is 1270-32-170-22 px, never under the cards.
must(1270 - 32 - 170 - 22 >= 1000, 'Rule 0: the card column is narrower than before the spine');
must(H.indexOf('data-spine') < H.indexOf('data-request-list') && H.indexOf('<div class="rqgrid">') < H.indexOf('data-spine'), 'the spine is not left of the list');
must(H.includes(V.pickCurrentCard.toString()) && /mark\(pickCurrentCard\(cards\.map\(/.test(H) && !/getBoundingClientRect\(\)\.top<=y/.test(H), 'the page script does not pick the current card with the tested pickCurrentCard');
must(/IntersectionObserver/.test(H) && /\[data-filter-pick\]/.test(H) && /location\.href=o\.getAttribute\('data-href'\)/.test(H), 'the scroll highlight or the drop-down change handler is missing');
must(/@media\(min-width:900px\)\{\.rqpanel\{order:0;margin-top:0\}\}/.test(H) && /\.rqmain\{order:1\}\.rqpanel\{order:2;margin-top:18px\}/.test(H), 'the 1·2·3 panel no longer sits under the list on a phone');
// Missed / tidy strips stay above the filter.
const V2 = V.dashboardPage({ requests: active.slice(0, 2), statuses: {}, folderUrl: 'https://x', missedTop: '<details class="mstrip" data-missed-strip></details>' });
must(V2.indexOf('data-missed-strip') > 0 && V2.indexOf('data-missed-strip') < V2.indexOf('data-filter-select') && V2.indexOf('data-filter-select') < V2.indexOf('<div class="cbar" data-customer-bar>'), 'the missed strip is not above the filter, or the bar is not below it');
// The empty list: no bar, an empty spine note.
const V3 = V.dashboardPage({ requests: [], statuses: {}, folderUrl: 'https://x' });
must(!V3.includes('<div class="cbar" data-customer-bar>') && /<option value="all" data-href="\/admin\/" selected>Everything \(active \+ done\) \(0\)<\/option>/.test(V3), 'the empty list shows a customer bar or a wrong count');

if (checks < 60) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`customer nav: FAIL (${errors.length})\n- ${errors.slice(0, 40).join('\n- ')}`); process.exit(1); }
console.log(`customer nav: OK (${checks} checks: ${cards.length} cards numbered oldest = 1 by arrival over all active, stable under ${C.FILTERS.length} filters and put away, circle + label, spine = visible cards with live anchors, phone menu on ${SCREENS.length} screens with no-JS fallback, labelled drop-down with counts + bubble hrefs, sticky customer bar below it)`);
