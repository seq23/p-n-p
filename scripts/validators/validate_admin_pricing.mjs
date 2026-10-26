#!/usr/bin/env node
/**
 * Quick Pricing Summary (/admin/pricing; owner-approved mock-up, 20 Oct 2026).
 *
 * Fails unless:
 *  1. every price on the page equals the data the public site renders from
 *     (data/rentals/games.json rates, bundles incl. The Whole Party weekend price, extras,
 *     damage deposit, pickup place; data/offers/porch_packages.json fall + Christmas tiers and the
 *     bundle percentOff; data/offers/services.json celebration + grazing from-prices, grazing
 *     tiers, food per guest, takedown), and every $ amount in a public block is one of them;
 *  2. a perturbed copy of all three files moves every number on the page (admin page = data,
 *     like validate_porch_packages' "admin grid = public grid"), and the yellow "Only you see
 *     this" facts follow services.json invoiceQuickAdds and the hold length (Settings);
 *  3. the private facts NEVER reach a text (sms:), an email (subject, HTML, plain text, the
 *     rendered branded email, the one the mailer received) or print (the box is .noprint and
 *     hidden by @media print), for every section and for "all";
 *  4. Text it is a real sms: href of at most 300 characters with the public page URL, for each
 *     section; Print is per section (data-print-section) plus Print all;
 *  5. the route: behind the guard (signed out -> /admin; noindex header), "Quick Pricing Summary"
 *     is the LAST nav link, the heading, the jump chips Rentals · Porch · Party & decor · Grazing
 *     point at the four blocks in the service colours; POST /admin/pricing/email sends through
 *     the stubbed mailer with subject "Porch & Party prices: <service>" (or "Porch & Party
 *     prices" for all), refuses an invalid address and a cross-site post, sends the same address
 *     + section at most once a minute, says "Sent to <email> ✓", explains a mailer failure in
 *     plain words, and logs "Price list emailed (<service>)" on the matching request only.
 * Rule 0: fewer than 80 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const PS = await mod('functions/_lib/price-summary.mjs');
const VP = await mod('functions/_lib/views-pricing.mjs');
const M = await mod('functions/_lib/messages.mjs');
const INV = (await import(path.join(ROOT, 'scripts/lib/inventory.js'))).default;

const usd = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const sectionHtml = (page, key) => (page.match(new RegExp(`<section class="card svc" id="${key}"[\\s\\S]*?</section>`)) || [''])[0];
const withoutPrivate = (html) => html.replace(/<div class="priv[^"]*" data-private>[\s\S]*?<\/div>/g, '');
const amounts = (html) => [...html.replace(/&amp;/g, '&').matchAll(/\$\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0]);

// The prices each block must show, worked out here from the files (not from the module).
function expected(games, services, pk) {
  const g = INV.resolve(games);
  const offered = INV.offeredBundles(g);
  const rentals = [g.rates.day, g.rates.weekend, g.damageDeposit,
    ...offered.flatMap((b) => [b.dayPrice, ...(b.weekendPrice == null ? [] : [b.weekendPrice])]),
    ...(g.extras || []).filter((x) => x.availableNow).flatMap((x) => [x.dayPrice, x.weekendPrice])].map(usd);
  const porch = [...pk.seasons.flatMap((s) => pk.tierOrder.map((t) => s.tiers[t].from)), services.addOns.takedown.fromPrice].map(usd);
  const num = (p) => Number(String(p).replace(/[^0-9.]/g, ''));
  const gr = services.services.grazing;
  const party = [num(services.services.celebration.price), services.addOns.takedown.fromPrice].map(usd);
  const grazing = [num(gr.price), ...(gr.tiers || []).map((t) => t.from), gr.foodPerHead.low, gr.foodPerHead.high].map(usd);
  return { rentals, porch, party, grazing, percent: `${pk.bundle.percentOff}% off`, whole: offered.find((b) => b.weekendPrice != null), pickup: String(g.pickup.place).split(',')[0] };
}

function checkPage(label, games, services, pk, holdHours) {
  const model = PS.priceSummary({ games, services, porchPackages: pk, holdHours });
  const page = VP.pricingPage(model);
  const want = expected(games, services, pk);
  for (const key of PS.SECTION_KEYS) {
    const html = sectionHtml(page, key);
    must(html, `${label}: no ${key} block on the page`);
    const pub = withoutPrivate(html);
    const got = new Set(amounts(pub));
    for (const a of want[key]) must(got.has(a), `${label}: the ${key} block does not show ${a} from the data`);
    for (const a of got) must(want[key].includes(a), `${label}: the ${key} block shows ${a}, which is not in the data files (a typed price?)`);
  }
  const rent = sectionHtml(page, 'rentals');
  must(want.whole && rent.includes(`${usd(want.whole.dayPrice)} day · ${usd(want.whole.weekendPrice)} weekend`), `${label}: The Whole Party does not show its day and weekend price`);
  must(rent.includes(want.pickup), `${label}: the pickup place is not on the rentals block`);
  must(sectionHtml(page, 'porch').includes(want.percent), `${label}: the porch bundle ${want.percent} is missing`);
  for (const s of pk.seasons) must(sectionHtml(page, 'porch').includes(s.short), `${label}: porch season ${s.short} is missing`);
  return { model, page };
}

// ---- 1 + 2. Live data, then every number perturbed --------------------------------------
const games = readJson('data/rentals/games.json');
const services = readJson('data/offers/services.json');
const pk = readJson('data/offers/porch_packages.json');
const HOLD = Number(services.rentalHolds.defaultHours);
const live = checkPage('live', games, services, pk, HOLD);

const bump = (n) => n + 7;
const g2 = JSON.parse(JSON.stringify(games));
g2.rates.day = bump(g2.rates.day); g2.rates.weekend = bump(g2.rates.weekend); g2.damageDeposit = bump(g2.damageDeposit);
g2.bundles.forEach((b) => { b.dayPrice = bump(b.dayPrice); if (b.weekendPrice != null) b.weekendPrice = bump(b.weekendPrice); });
(g2.extras || []).forEach((x) => { x.dayPrice = bump(x.dayPrice); x.weekendPrice = bump(x.weekendPrice); });
g2.pickup.place = `Elsewhere Station, ${g2.pickup.place}`;
const s2 = JSON.parse(JSON.stringify(services));
s2.addOns.takedown.fromPrice = bump(s2.addOns.takedown.fromPrice);
s2.services.celebration.price = `$${bump(Number(services.services.celebration.price.replace(/[^0-9]/g, '')))}+`;
s2.services.grazing.price = `$${bump(Number(services.services.grazing.price.replace(/[^0-9]/g, '')))}+`;
s2.services.grazing.tiers.forEach((t) => { t.from = bump(t.from); });
s2.services.grazing.foodPerHead.low = bump(s2.services.grazing.foodPerHead.low); s2.services.grazing.foodPerHead.high = bump(s2.services.grazing.foodPerHead.high);
s2.invoiceQuickAdds.deliveryFee = 23; s2.invoiceQuickAdds.extraGame = 29;
const pk2 = JSON.parse(JSON.stringify(pk));
pk2.seasons.forEach((s) => pk2.tierOrder.forEach((t) => { s.tiers[t].from = bump(s.tiers[t].from); }));
pk2.bundle.percentOff = 13;
const pert = checkPage('perturbed', g2, s2, pk2, 51);
must(live.page !== pert.page, 'the page did not change when every number in the data changed');
for (const key of PS.SECTION_KEYS) {
  const a = sectionHtml(live.page, key); const b = sectionHtml(pert.page, key);
  must(a !== b, `the ${key} block did not change with the data`);
  must(PS.sectionOf(live.model, key).sms !== PS.sectionOf(pert.model, key).sms, `the ${key} text did not change with the data`);
}

// The private box: from invoiceQuickAdds + the hold length, and only on the page.
const priv = (page) => (sectionHtml(page, 'rentals').match(/data-private>([\s\S]*?)<\/div>/) || ['', ''])[1];
must(priv(live.page).includes(`Business delivery ${usd(services.invoiceQuickAdds.deliveryFee)}`), 'the private box lacks business delivery from invoiceQuickAdds');
must(priv(live.page).includes(`Extra game on a bundle ${usd(services.invoiceQuickAdds.extraGame)} (or complimentary)`), 'the private box lacks the extra game price from invoiceQuickAdds');
must(priv(live.page).includes(`held ${HOLD} hours`), 'the private box lacks the hold hours from rentalHolds');
must(/Projector on request/.test(priv(live.page)) === (games.adminItems || []).some((x) => /projector/i.test(x.name) && x.availableNow !== false), 'the private box projector line does not follow games.json adminItems');
must(priv(pert.page).includes('Business delivery $23') && priv(pert.page).includes('$29 (or complimentary)') && priv(pert.page).includes('held 51 hours'), 'the private box does not follow a perturbed invoiceQuickAdds / hold length');
must(/data-private>[\s\S]*quick-adds/.test(sectionHtml(live.page, 'porch')), 'the porch private box (takedown / setup fee and discount are quick-adds) is missing');

// ---- 3. Private facts never leave the admin ---------------------------------------------
for (const { model } of [live, pert]) {
  const secret = model.sections.flatMap((s) => s.private);
  must(secret.length >= 4, 'fewer than 4 private facts: the check below would prove nothing (Rule 0)');
  const leaks = (text, where) => { for (const f of secret) must(!String(text).includes(f), `a private fact ("${f}") is in ${where}`); must(!/Only you see this|Business delivery|quick-add|complimentary/i.test(String(text)), `admin-only words are in ${where}`); };
  for (const key of [...PS.SECTION_KEYS, 'all']) {
    const e = PS.emailFor(model, key);
    must(e && e.subject === (key === 'all' ? 'Porch & Party prices' : `Porch & Party prices: ${PS.sectionOf(model, key).title}`), `the ${key} email subject is wrong (${e && e.subject})`);
    leaks(e.subject + e.plain + e.extraHtml + e.lines.join(' '), `the ${key} email`);
    const r = M.renderPriceList(e);
    leaks(r.html + r.emailText + r.subject, `the rendered ${key} email`);
    for (const s of key === 'all' ? model.sections : [PS.sectionOf(model, key)]) {
      must(r.html.includes(s.url) && r.emailText.includes(s.url), `the ${key} email lacks the public link ${s.url}`);
      for (const row of s.groups.flatMap((g) => g.rows)) must(r.emailText.includes(row.price) && r.html.includes(row.price.replace(/&/g, '&amp;')), `the ${key} email lacks ${row.label} ${row.price}`);
    }
    if (key !== 'all') {
      const sec = PS.sectionOf(model, key);
      leaks(sec.sms + PS.smsHref(sec) + decodeURIComponent(PS.smsHref(sec)), `the ${key} text`);
      must(sec.sms.length <= 300, `the ${key} text is ${sec.sms.length} characters (max 300)`);
      must(sec.sms.includes(sec.url.replace(/^https?:\/\//, '')), `the ${key} text lacks the public page link`);
      must(/^sms:\?&body=/.test(PS.smsHref(sec)), `the ${key} Text it is not an sms: link`);
      must(sec.url.startsWith('https://porchandparty901.com/'), `the ${key} public URL is not on the site (${sec.url})`);
    }
  }
}
// Print: the box is .noprint and @media print hides .priv, the nav and the other blocks.
const printCss = (VP.PRICING_CSS.match(/@media print\{([\s\S]*)\}\s*$/) || ['', ''])[1];
must(/\.priv[,{]/.test(printCss) && /display:none!important/.test(printCss), 'print does not hide the "Only you see this" box');
must(/body\[data-print\] \.svc:not\(\.printing\)/.test(printCss), 'Print does not print just that section');
must((live.page.match(/class="priv noprint" data-private/g) || []).length === live.model.sections.filter((s) => s.private.length).length, 'a private box is not marked noprint');
must(/@media print\{[^}]*\.noprint[^}]*display:none!important/.test((await mod('functions/_lib/views.mjs')).layout('x', '<p></p>')), 'the admin print CSS no longer hides .noprint');
for (const key of PS.SECTION_KEYS) must(new RegExp(`data-print-section="${key}"`).test(sectionHtml(live.page, key)), `no Print button on the ${key} block`);
must(/data-print-section="all"[^>]*>Print all</.test(live.page), 'no Print all');

// ---- 5. The route, through the real guard + router --------------------------------------
const s = await session();
const P = await mod('functions/_lib/prices.mjs');
const fixtureWant = expected(P.GAMES, services, pk);
const pageRes = await s.get('/admin/pricing');
must(pageRes.status === 200, `/admin/pricing answered ${pageRes.status}`);
must(/noindex/.test(pageRes.headers.get('X-Robots-Tag') || ''), '/admin/pricing is not noindex');
must(/<meta name="robots" content="noindex,nofollow">/.test(pageRes.text), '/admin/pricing lacks the noindex meta');
const out = await s.get('/admin/pricing', { auth: false });
must(out.status === 303 && out.location === '/admin', `signed out, /admin/pricing must send to sign-in (got ${out.status} ${out.location})`);
const nav = (pageRes.text.match(/<nav aria-label="Main">([\s\S]*?)<\/nav>/) || ['', ''])[1];
const links = [...nav.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
// The whole menu, in order (owner: Quick Pricing Summary last, 20 Oct 2026; Design Library after
// Inventory, 22 Oct 2026).
const MENU = [['/admin/', 'Customers (main page)'], ['/admin/calendar', 'Calendar &amp; Bookings'], ['/admin/money', 'Money'], ['/admin/inventory', 'Inventory'], ['/admin/library', 'Design Library'], ['/admin/settings', 'Settings'], ['/admin/help', 'Help'], ['/admin/pricing', 'Quick Pricing Summary']];
must(JSON.stringify(links) === JSON.stringify(MENU), `the menu is not ${MENU.map((l) => l[1]).join(' · ')} with Quick Pricing Summary last (got ${links.map((l) => l[1]).join(' · ')})`);
must(/<h1>Quick Pricing Summary<\/h1>/.test(pageRes.text), 'the heading is not "Quick Pricing Summary"');
const chips = [...(pageRes.text.match(/<nav class="pjump"[^>]*>([\s\S]*?)<\/nav>/) || ['', ''])[1].matchAll(/<a href="#([a-z]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]);
must(JSON.stringify(chips.map((c) => c[1])) === JSON.stringify(['Rentals', 'Porch', 'Party & decor', 'Grazing']), `the jump chips read ${chips.map((c) => c[1]).join(' · ')}`);
const K = await mod('functions/_lib/kinds.mjs');
for (const [id] of chips) {
  const html = sectionHtml(pageRes.text, id);
  must(html, `jump chip #${id} points at no block`);
  must(html.includes(`--c:${K.SERVICE_KINDS[id].bar}`), `the ${id} block is not in its service colour`);
  for (const a of fixtureWant[id]) must(amounts(withoutPrivate(html)).includes(a), `/admin/pricing ${id} block lacks ${a} (live inventory)`);
}
must(/<a class="btn" href="sms:\?&amp;body=/.test(pageRes.text), 'Text it is not a real sms: href');

// Email it.
const sent0 = s.env.sent.length;
const match = s.requests.find((r) => r.email === 'test.renter@example.com');
const ok = await s.post('/admin/pricing/email', { s: 'rentals', to: 'Test.Renter@example.com ' });
must(ok.status === 303 && /\/admin\/pricing\?s=rentals&sent=test\.renter%40example\.com#rentals$/.test(ok.location), `a good send must land back on the rentals block with Sent (got ${ok.status} ${ok.location})`);
const mail = s.env.sent[sent0];
must(s.env.sent.length === sent0 + 1 && mail && mail.to === 'test.renter@example.com', 'Email it did not send one email to that address through the mailer');
must(mail && mail.subject === 'Porch & Party prices: Game rentals', `the email subject is ${mail && mail.subject}`);
must(mail && mail.replyTo === 'hello@porchandparty901.com' && !mail.bcc, 'the email does not reply to hello@ (or copies hello@)');
const fixtureModel = PS.priceSummary({ games: P.GAMES, services, porchPackages: pk, holdHours: HOLD });
for (const f of fixtureModel.sections.flatMap((x) => x.private)) must(mail && !mail.html.includes(f) && !mail.text.includes(f), `the sent email carries the private fact "${f}"`);
must(mail && !/Only you see this/.test(mail.html + mail.text), 'the sent email carries the private box');
for (const a of fixtureWant.rentals) must(mail && mail.text.includes(a), `the sent email lacks ${a}`);
const ev = await s.all("SELECT what, who FROM request_events WHERE what LIKE 'Price list emailed%'");
must(ev.length === 1 && ev[0].what === 'Price list emailed (game rentals)', `the matching request did not get one "Price list emailed (game rentals)" event (${JSON.stringify(ev)})`);
must(match && (await s.one("SELECT COUNT(*) AS n FROM request_events WHERE request_key = ?1 AND what = 'Price list emailed (game rentals)'", match.key)).n === 1, 'the event is not on the request with that email');
const shown = await s.get(ok.location.replace(/#.*$/, ''));
must(/data-pricing-sent role="status">Sent to test\.renter@example\.com &#10003;<\/p>/.test(sectionHtml(shown.text, 'rentals') + shown.text.slice(shown.text.indexOf('id="rentals"'))), 'no "Sent to <email> ✓" line after the send');
// Once a minute per address + section.
const again = await s.post('/admin/pricing/email', { s: 'rentals', to: 'test.renter@example.com' });
must(s.env.sent.length === sent0 + 1 && /err=/.test(again.location) && /a%20moment%20ago/.test(again.location), 'the same address + section was sent twice within a minute');
const other = await s.post('/admin/pricing/email', { s: 'porch', to: 'test.renter@example.com' });
must(s.env.sent.length === sent0 + 2 && /sent=/.test(other.location), 'another section to the same address was refused');
// All, to an address with no request: sent, no event.
const all = await s.post('/admin/pricing/email', { s: 'all', to: 'stranger@example.org' });
const allMail = s.env.sent[sent0 + 2];
must(/sent=stranger/.test(all.location) && allMail && allMail.subject === 'Porch & Party prices', 'Email all did not send "Porch & Party prices"');
for (const sec of fixtureModel.sections) must(allMail && allMail.text.includes(sec.url) && allMail.text.includes(sec.headline), `Email all lacks the ${sec.key} list`);
must((await s.all("SELECT 1 FROM request_events WHERE what LIKE 'Price list emailed%'")).length === 2, 'an address with no request logged an event (or the porch send to a request did not)');
// Bad input.
for (const bad of ['', 'not-an-email', 'a@b', 'x y@example.com']) {
  const n = s.env.sent.length;
  const r = await s.post('/admin/pricing/email', { s: 'grazing', to: bad });
  must(s.env.sent.length === n && /err=That%20email%20address%20does%20not%20look%20right/.test(r.location), `an invalid address (${JSON.stringify(bad)}) was not refused in plain words`);
}
const errPage = await s.get('/admin/pricing?s=grazing&to=not-an-email&err=That%20email%20address%20does%20not%20look%20right.');
must(/<details class="pmail" data-pricing-mail="grazing" open>/.test(errPage.text) && /data-pricing-err>That email address does not look right\.</.test(errPage.text), 'a refused send does not reopen its box with the plain-words error');
const unknown = await s.post('/admin/pricing/email', { s: 'yachts', to: 'a@example.com' });
must(/err=/.test(unknown.location), 'an unknown section was not refused');
const cross = await s.post('/admin/pricing/email', { s: 'party', to: 'a@example.com' }, { headers: { Origin: 'https://evil.example' } });
must(cross.status === 403, `a cross-site post was not refused (got ${cross.status})`);
const signedOut = await s.post('/admin/pricing/email', { s: 'party', to: 'a@example.com' }, { auth: false });
must(signedOut.status === 303 && signedOut.location === '/admin', 'a signed-out post was not sent to sign-in');
// The mailer failing: plain words, nothing marked sent, nothing logged.
const realMailer = s.env.MAILER;
s.env.MAILER = { fetch: async () => Response.json({ ok: false, error: 'mailer down' }, { status: 502 }) };
const fail = await s.post('/admin/pricing/email', { s: 'party', to: 'test.renter@example.com' });
must(/err=The%20email%20did%20not%20go%20out\.%20\(mailer%20down\)/.test(fail.location), `a mailer failure is not explained (${fail.location})`);
s.env.MAILER = realMailer;
const retry = await s.post('/admin/pricing/email', { s: 'party', to: 'test.renter@example.com' });
must(/sent=/.test(retry.location), 'a failed send blocked the retry for a minute');

if (checks < 80) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) {
  console.error(`validate_admin_pricing: FAIL (${errors.length})`);
  for (const e of errors.slice(0, 40)) console.error(` - ${e}`);
  process.exit(1);
}
console.log(`validate_admin_pricing: OK - ${checks} checks: every price on /admin/pricing equals the data files and tracks a perturbed copy; the private box never reaches a text, an email or print; Email it sends once a minute and logs on the request.`);
