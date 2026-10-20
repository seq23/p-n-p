#!/usr/bin/env node
/**
 * The top of the main page (owner-approved mock-up, 20 Oct 2026). Fails when:
 *  1. the main page (/admin/) shows a "← Back", or does not say "Main page: Customers" with
 *     "Every request, newest first" under it;
 *  2. another screen loses its "← Back", or the label is wrong: "← Back to main page" when it goes
 *     to /admin/ (any card or query on it), plain "← Back" anywhere else;
 *  3. the menu (phone panel and laptop nav are the same <nav>) still says "Requests" instead of
 *     "Customers (main page)", on any screen;
 *  4. the week banner is not the thin line: "This week: N new · last week M", this week's requests
 *     newest first, " · " between them, NEW on each unopened one, a "|" after the count for the
 *     laptop, at most 6 names then "+K more" jumping to the first card not named; a quiet week reads
 *     "This week: no new requests · last week M"; no service breakdown, no pull-down, no arrow.
 * Rule 0: fewer than 40 checks is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const V = await mod('functions/_lib/views.mjs');
const U = await mod('functions/_lib/util.mjs');
const H = await mod('functions/_lib/helptext.mjs');

// ---- 4. the banner, from made-up requests -----------------------------------------------------
const NAMES = ['Ada Example', 'Ben Sample', 'Cleo Test', 'Dev Madeup', 'Eve Fiction', 'Finn Placeholder', 'Gus Pretend', 'Hal Invented'];
const reqs = (n) => NAMES.slice(0, n).map((name, i) => ({ key: `site|2026-10-1${i}|${i}@example.com`, name, sortTime: Date.UTC(2026, 9, 12, 9 + i) }));
const rk = (r) => U.b64urlText(r.key);
const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'");
const shape = (html, label) => {
  must(/^<section class="card weekcard" data-week-counts><p class="wkline">[\s\S]*<\/p><\/section>$/.test(html), `${label}: the banner is not one thin <section> line`);
  must(!/<details|<summary|▾|▸|›|chev|rental|party &amp; decor|porch|grazing/i.test(html), `${label}: the banner has a pull-down, an arrow or a service breakdown`);
};

const zero = V.weekBox({ thisWeek: [], lastWeek: reqs(4) }, new Set());
shape(zero, '0 requests');
must(plain(zero) === 'This week: no new requests · last week 4', `0 requests: reads "${plain(zero)}"`);
must(!/data-week-list|wkbar|<a /.test(zero), '0 requests: the banner still has a names list or a link');

const two = reqs(2);
const twoHtml = V.weekBox({ thisWeek: two, lastWeek: reqs(3) }, new Set([two[1].key]));
shape(twoHtml, '2 requests');
must(plain(twoHtml) === 'This week: 2 new · last week 3|NEWBen S.·Ada E.', `2 requests: reads "${plain(twoHtml)}"`);
must(twoHtml.includes(`<span class="wkhead">This week: 2 new</span> <span class="muted">· last week 3</span><span class="wkbar" aria-hidden="true">|</span><span class="wknames" data-week-list>`), '2 requests: the count, last week and the laptop "|" are not in that order');
must(twoHtml.includes(`<span class="wki"><span class="newb" data-new-count data-week-new="${rk(two[1])}">NEW</span><a href="#c-${rk(two[1])}"`), '2 requests: the unopened (newest) one has no NEW badge in front of its name, or does not jump to its card');
must(twoHtml.includes(`<span class="wki"><a href="#c-${rk(two[0])}"`) && (twoHtml.match(/data-new-count/g) || []).length === 1, '2 requests: the opened one wears NEW, or does not jump to its card');
must((twoHtml.match(/<span class="wkdot" aria-hidden="true">·<\/span>/g) || []).length === 1, '2 requests: the names are not separated by one dot');
must(/data-help="req\.weekJump"/.test(twoHtml) && H.HELP['req.weekJump'], '2 requests: a name has no help line');

const eight = reqs(8);
const eightHtml = V.weekBox({ thisWeek: eight, lastWeek: [] }, new Set(eight.map((r) => r.key)));
shape(eightHtml, '8 requests');
must(plain(eightHtml) === 'This week: 8 new · last week 0|NEWHal I.·NEWGus P.·NEWFinn P.·NEWEve F.·NEWDev M.·NEWCleo T.·+2 more', `8 requests: reads "${plain(eightHtml)}"`);
must(eightHtml.includes(`<a href="#c-${rk(eight[1])}" data-week-more`) && /data-help="req\.weekMore"/.test(eightHtml) && H.HELP['req.weekMore'], '8 requests: "+2 more" does not jump to the first card not named (the 7th newest), or has no help line');
must((eightHtml.match(/data-week-new="/g) || []).length === 6 && !eightHtml.includes(`data-week-new="${rk(eight[0])}"`), '8 requests: NEW is not on exactly the 6 names shown');
must(V.WEEK_NAMES_MAX === 6, 'the banner does not name at most 6');
// Order is by time, not by how the list arrived.
const shuffled = V.weekBox({ thisWeek: [eight[2], eight[0], eight[1]], lastWeek: [] }, new Set());
must(plain(shuffled).endsWith('Cleo T.·Ben S.·Ada E.'), `the banner is not newest first: "${plain(shuffled)}"`);

// ---- 2. the Back label ------------------------------------------------------------------------
for (const [href, want] of [['/admin/', 'Back to main page'], ['/admin/#c-abc', 'Back to main page'], ['/admin/?pa=1#put-away', 'Back to main page'], ['/admin/inventory', 'Back'], ['/admin/money', 'Back'], ['/admin/calendar?month=2026-10', 'Back'], ['/admin/invoices', 'Back']]) {
  must(V.backLabel(href) === want, `Back to ${href} reads "${V.backLabel(href)}", not "${want}"`);
  const page = V.layout('Somewhere', '<p>x</p>', { back: { href } });
  must(page.includes(`<a class="back" href="${U.esc(href)}" data-back`) && page.includes(`>&larr; ${want}</a>`) && !/data-mainpage/.test(page), `a screen whose Back goes to ${href} does not show "← ${want}"`);
}
const homeShell = V.layout(V.MAIN_PAGE_NAV, '<p>x</p>', { home: true });
must(!/&larr; Back|\sdata-back[\s>]|aria-label="Back"/.test(homeShell) && homeShell.includes('<div class="adminbar mainhead" data-adminbar data-mainpage><h1>Main page: Customers<small>Every request, newest first</small></h1></div>'), 'the main page shell has a Back, or lacks its heading');

// ---- 1-3. the real pages ----------------------------------------------------------------------
const s = await session();
const home = (await s.get('/admin/')).text;
must(/<div class="adminbar mainhead" data-adminbar data-mainpage><h1>Main page: Customers<small>Every request, newest first<\/small><\/h1><\/div>/.test(home), '/admin/: no "Main page: Customers / Every request, newest first" heading');
must(!/&larr; Back|\sdata-back[\s>]|aria-label="Back"/.test(home), '/admin/: the main page still shows a ← Back');
must((home.match(/<h1[\s>]/g) || []).length === 1 && !/<h1>Requests<\/h1>/.test(home), '/admin/: the old "Requests" heading is still there (one heading only)');
must(home.indexOf('data-mainpage') < home.indexOf('data-week-counts') && home.indexOf('data-week-counts') < home.indexOf('data-request-list'), '/admin/: the heading, the week banner and the list are not in that order');
must(/<title>Customers \(main page\) · Porch &amp; Party<\/title>/.test(home), '/admin/: the browser tab does not say Customers (main page)');
const SCREENS = ['/admin/', '/admin/calendar', '/admin/money', '/admin/inventory', '/admin/settings', '/admin/help', '/admin/pricing', '/admin/invoices'];
for (const p of SCREENS) {
  const t = (await s.get(p)).text;
  const nav = (t.match(/<nav aria-label="Main">([\s\S]*?)<\/nav>/) || [])[1] || '';
  must(/^\s*<a href="\/admin\/"( aria-current="page")?[^>]*>Customers \(main page\)<\/a><a href="\/admin\/calendar"/.test(nav), `${p}: the menu's first item is not "Customers (main page)"`);
  must(!/>Requests</.test(nav), `${p}: the menu still says "Requests"`);
  must((p === '/admin/') === /aria-current="page"[^>]*>Customers \(main page\)/.test(nav), `${p}: "Customers (main page)" is marked as here on the wrong screen`);
  if (p !== '/admin/') must(/data-adminbar><a class="back" href="\/admin\/" data-back[^>]*>&larr; Back to main page<\/a>/.test(t), `${p}: Back (to the main page) does not read "← Back to main page"`);
}
const item = (await s.get('/admin/inventory/giant-uno')).text;
must(/data-adminbar><a class="back" href="\/admin\/inventory" data-back[^>]*>&larr; Back<\/a>/.test(item), '/admin/inventory/giant-uno: Back to Inventory does not read plain "← Back"');
must(H.HELP['nav.requests'] && H.HELP['nav.requests'].label === 'Customers (main page)', 'the menu help line still calls it Requests');

if (checks < 40) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`main page top: FAIL (${errors.length} of ${checks})\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`main page top: OK (${checks} checks: no Back on the main page, Back to main page elsewhere, menu rename, week banner 0/2/8 with NEW)`);
