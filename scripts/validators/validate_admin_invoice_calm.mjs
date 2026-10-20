#!/usr/bin/env node
/**
 * Calm invoices (owner-approved mock-up "Invoices: total and deposit broken out", 20 Oct 2026;
 * functions/_lib/auto-draft.mjs, pay-steps.mjs, views.mjs invoiceEditorPage / invoiceViewPage).
 *
 * Fails when:
 *  1. a website or phone request does not get exactly ONE draft invoice the moment it arrives
 *     (never sent, never emailed, invoices.auto_draft = 1); party & decor does not start at the
 *     website's "from" price with the event / where / guests / budget in the note; grazing lacks
 *     its styling line or the "Food (at cost)" price-needed line when they asked us to source it;
 *     the takedown they said yes to is missing;
 *  2. a failed draft loses the request (it must save, log, and leave the card's Create invoice);
 *     a second draft is ever made; an existing request (from before) gets one by itself;
 *  3. a draft counts as owed anywhere (balances, Not paid yet, Money, the card, the 7 AM email);
 *  4. the card does not say "📄 Invoice draft ready: $X / Made from <name>'s request. Nothing has
 *     been sent. Check the price, then send." with ONE "Check and send the invoice";
 *  5. changing "What they want" does not rebuild an unsent auto draft, drops a line changed by hand,
 *     does not say so, or touches a sent / void invoice; an unchanged line loses its auto mark;
 *  6. the editor lacks a visible ✏️ Change per line, ✓ Done with this line, the in-page "Remove this
 *     line…" question (no window.confirm), "Total so far", ONE "＋ Add something to this invoice"
 *     with its labelled list in the mock-up's order, NEW LINE, or "Starting price from your price
 *     list" on a starting line;
 *  7. the numbered payments are wrong: a paid step is not green "✓ paid <date>" with "Still owed",
 *     or invoices shaped like the two real customer invoices (#4 All now $180 with a $50 damage
 *     deposit; #5 $300 − $100 discount, $50 deposit, due Wed 28 Oct) read other numbers than before;
 *  8. migration 0020 is not additive only.
 * Rule 0: fewer than 75 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const s = await session();
const PS = await mod('functions/_lib/pay-steps.mjs');
const AD = await mod('functions/_lib/auto-draft.mjs');
const L = await mod('functions/_lib/ledger.mjs');
const NP = await mod('functions/_lib/notpaid.mjs');
const TODO = await mod('functions/_lib/todo-email.mjs');
const V = await mod('functions/_lib/views.mjs');
const E = await mod('functions/_lib/email.mjs');
const PDF = await mod('functions/_lib/pdf.mjs');
const { money, todayISO, shortDate, lineSig, autoTag } = s.util;
const plus = (n) => todayISO(n);
const nq = (h) => String(h).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const cardOf = (html, key) => { const i = html.indexOf(`id="c-${s.rk(key)}"`); return i < 0 ? '' : html.slice(html.lastIndexOf('<article', i), html.indexOf('</article>', i)); };
const invsOf = (key) => s.all('SELECT * FROM invoices WHERE request_key = ?1 ORDER BY id', key);
const linesOf = (id) => s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id', id);
const T = s.PRICE_TABLE;
const offers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8'));
const fromCents = (k) => Math.round(Number(String(offers.services[k].price).replace(/[^0-9.]/g, '')) * 100);
must(T.celebrationFromCents === fromCents('celebration') && T.grazingFromCents === fromCents('grazing') && T.celebrationFromCents > 0, 'the starting prices are not the website "from" prices in services.json');

// ---- 1. Party & decor from the website -------------------------------------------------------
const mailsBefore = s.env.sent.length;
const party = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', party_guests: '15–40', party_budget: '$300–$500', party_takedown: 'yes', event_date: plus(20), location: 'Cordova', name: 'Carmen Example', phone: '901-555-0701', email: 'carmen.example@example.com' });
must(party.status === 303 && party.row, 'the party request did not go through');
const pKey = party.row.request_key;
let pInv = await invsOf(pKey);
must(pInv.length === 1, `the party request has ${pInv.length} invoices, not one draft`);
const pd = pInv[0] || {};
must(pd.status === 'draft' && !pd.sent_at && pd.auto_draft === 1 && pd.pay_plan === 'half', `the party draft is not an unsent auto draft (${JSON.stringify({ status: pd.status, sent: pd.sent_at, auto: pd.auto_draft, plan: pd.pay_plan })})`);
must(!s.env.sent.slice(mailsBefore).some((m) => /invoice/i.test(String(m.subject || ''))), 'an invoice email went out by itself');
const pl = await linesOf(pd.id);
must(pl[0] && pl[0].description === 'Party decor: Birthday' && pl[0].unit_cents === T.celebrationFromCents && pl[0].auto === 'start' && pl[0].note === 'Home · 15–40 guests · budget $300–$500', `the party starting line is ${JSON.stringify(pl[0])}`);
must(pl[1] && pl[1].description === 'Takedown' && pl[1].unit_cents === T.takedownCents && pl[1].auto === 'takedown', 'the takedown they said yes to is not on the draft');
must(pl.length === 2, `the party draft has ${pl.length} lines`);
const st0 = await s.one('SELECT status, invoice_id FROM request_status WHERE request_key = ?1', pKey);
must(st0 && st0.status === 'new' && st0.invoice_id === pd.id, 'the request is not still New with its draft attached');
must((await s.all('SELECT what FROM request_events WHERE request_key = ?1', pKey)).some((e) => e.what === 'Invoice draft made from the request (not sent)'), 'the history does not say the draft was made');
// Idempotent: never a second.
must((await AD.makeAutoDraft(s.env, pKey)) === null && (await invsOf(pKey)).length === 1, 'a second auto draft was made for the same request');

// ---- Grazing, food sourced and not ---------------------------------------------------------
const gz = await s.siteRequest({ service: 'grazing', grazing_event: 'Baby or bridal shower', grazing_guests: '15–40', grazing_food: 'Yes, include food in my quote', grazing_budget: '$500–$1,000', event_date: plus(21), location: 'Midtown', name: 'Gwen Example', phone: '901-555-0702', email: 'gwen.example@example.com' });
const gl = await linesOf(((await invsOf(gz.row.request_key))[0] || {}).id);
must(gl[0] && gl[0].description === 'Grazing table styling: Baby or bridal shower' && gl[0].unit_cents === T.grazingFromCents && gl[0].auto === 'start' && gl[0].note === '15–40 guests · budget $500–$1,000', `the grazing styling line is ${JSON.stringify(gl[0])}`);
must(gl[1] && gl[1].description === 'Food (at cost)' && gl[1].unit_cents === 0 && gl[1].auto === 'food' && s.util.needsPrice(gl[1]), 'the "Food (at cost)" price-needed line is missing');
must(gl.length === 2, `the grazing draft has ${gl.length} lines`);
const gz2 = await s.siteRequest({ service: 'grazing', grazing_event: 'Birthday', grazing_guests: 'Under 15', grazing_food: "No, I'll provide the food", event_date: plus(22), location: 'Midtown', name: 'Gale Example', phone: '901-555-0703', email: 'gale.example@example.com' });
const gl2 = await linesOf(((await invsOf(gz2.row.request_key))[0] || {}).id);
must(gl2.length === 1 && !gl2.some((l) => /food/i.test(l.description)), 'a grazing request that brings its own food got a food line');

// Porch and rentals keep today's lines (now made at once, marked).
const porch = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'no', event_date: plus(9), location: 'Germantown', name: 'Pia Example', phone: '901-555-0704', email: 'pia.example@example.com' });
const pol = await linesOf(((await invsOf(porch.row.request_key))[0] || {}).id);
must(pol.length === 1 && pol[0].description === 'Fall porch: Classic package' && pol[0].auto === 'porch', `the porch draft lines are ${JSON.stringify(pol.map((l) => l.description))}`);
const rent = await s.siteRequest({ service: 'rentals', games: ['cornhole'], duration: 'day', rental_date: plus(25), pickup_when: 'morning', return_when: 'after', name: 'Rhea Example', phone: '901-555-0705', email: 'rhea.example@example.com' });
const ri = (await invsOf(rent.row.request_key));
must(ri.length === 1 && ri[0].auto_draft === 1 && ri[0].pay_plan === 'custom', 'the rental draft is not the one custom-deposit auto draft');
const rl = await linesOf(ri[0] ? ri[0].id : 0);
must(rl.some((l) => l.refundable && l.auto === 'deposit') && rl.some((l) => !l.refundable && l.auto === 'rental'), 'the rental draft lines are not marked rental / deposit');
must((await s.all("SELECT invoice_id FROM bookings WHERE request_key = ?1", rent.row.request_key)).every((b) => b.invoice_id === ri[0].id), 'the rental bookings do not carry the draft');

// ---- Phone booking -------------------------------------------------------------------------
await s.post('/admin/calendar/bookings', { service: 'party', kind: 'party_setup', date: plus(15), time: '11:00', customer_name: 'Paz Example', phone: '901-555-0706', email: '', place: 'Bartlett', items: 'Anniversary' });
const phoneKey = (await s.one("SELECT request_key FROM requests WHERE name = 'Paz Example'") || {}).request_key;
const phInv = phoneKey ? await invsOf(phoneKey) : [];
must(phInv.length === 1 && phInv[0].auto_draft === 1 && phInv[0].status === 'draft', 'a phone booking did not get its one draft');
const phl = await linesOf(phInv[0] ? phInv[0].id : 0);
must(phl[0] && phl[0].description === 'Party decor: Anniversary' && phl[0].unit_cents === T.celebrationFromCents, `the phone draft starts with ${JSON.stringify(phl[0])}`);
must(phInv[0] && phInv[0].due_date === plus(7), 'the phone draft is not due in a week (its job is further off)');
must((await s.all('SELECT invoice_id FROM bookings WHERE request_key = ?1', phoneKey)).every((b) => b.invoice_id === (phInv[0] || {}).id), 'the phone booking does not carry its draft');

// ---- 2. A failed draft never loses the request; no backfill --------------------------------
s.db.raw.exec("CREATE TRIGGER boom BEFORE INSERT ON invoices BEGIN SELECT RAISE(ABORT, 'boom'); END;");
const failed = await s.siteRequest({ service: 'party', party_event: 'Graduation', party_where: 'Home', event_date: plus(30), location: 'Cordova', name: 'Fern Example', phone: '901-555-0707', email: 'fern.example@example.com' });
s.db.raw.exec('DROP TRIGGER boom');
must(failed.status === 303 && failed.row, 'a failed draft lost the request');
must((await invsOf(failed.row.request_key)).length === 0, 'a failed draft left an invoice behind');
must((await s.all('SELECT what FROM request_events WHERE request_key = ?1', failed.row.request_key)).some((e) => /could not be made by itself/.test(e.what)), 'a failed draft is not logged on the card');
let dash = (await s.get('/admin/')).text;
const fc = cardOf(dash, failed.row.request_key);
must(/data-help="card\.createInvoice"/.test(fc) || /\/admin\/invoices\/new\?r=/.test(fc) || /data-next-step="called"/.test(fc), 'the card of a failed draft has no way to Create invoice');
must(!/data-draft-ready/.test(fc), 'a card with no invoice shows a draft box');
// An older request (before this shipped, no invoice) never gets one by itself, even after loads.
await s.db.prepare("INSERT INTO requests (request_key, source, submitted_at, services, name, email, phone, answers) VALUES ('site|2026-10-01 10:00:00|old@example.com', 'site', '2026-10-01 10:00:00', '[\"party\"]', 'Olde Example', 'old@example.com', '9015550708', '[]')").run();
await s.get('/admin/'); await s.get('/admin/money'); await s.get('/admin/calendar');
must((await invsOf('site|2026-10-01 10:00:00|old@example.com')).length === 0, 'an existing request got a draft by itself (no backfill)');

// ---- 3. A draft is owed by nobody ----------------------------------------------------------
const bals = await L.balances(s.db);
const pb = bals[pd.id];
must(pb && pb.draft === true && pb.owed === 0 && pb.remaining === pb.total && pb.total > 0 && L.dueWords(pb) === '' && L.dueCents(pb) === 0 && L.balanceWords(pb) === 'Invoice not sent yet', `a draft's balance reads as owed or paid (${JSON.stringify(pb)})`);
const rb = bals[ri[0].id];
must(rb && rb.depositOwed === rb.refundable && rb.refundable > 0, 'a draft rental reads its damage deposit as collected');
const np = NP.notPaidRows(bals, await L.linesByInvoice(s.db), {}, todayISO());
must(!np.owed.some((r) => r.id === pd.id) && np.drafts.some((r) => r.id === pd.id), 'Not paid yet lists a draft as owed');
const moneyPage = nq((await s.get('/admin/money')).text);
must(!/Carmen Example[^<]*<\/a>[^]*?\$375 due/.test(moneyPage), 'Money counts the draft as owed');
const todo = await TODO.todoData(s.db, todayISO());
must(!JSON.stringify(todo).includes('Carmen E. · $'), 'the 7 AM email counts a draft as owed');
dash = (await s.get('/admin/')).text;
const pc = nq(cardOf(dash, pKey));
must(!/\$375 due/.test(pc), 'the card says a draft is due');

// ---- 4. The card ---------------------------------------------------------------------------
const total = pl.reduce((t, l) => t + l.qty * l.unit_cents, 0);
must(pc.includes(`📄 Invoice draft ready: ${money(total)}`) && pc.includes("Made from Carmen's request. Nothing has been sent. Check the price, then send."), 'the card lacks "📄 Invoice draft ready" with "Made from Carmen\'s request"');
must(new RegExp(`href="/admin/invoices/${pd.id}/edit" data-help="card\\.checkDraft"[^>]*>Check and send the invoice<`).test(pc), 'the card lacks "Check and send the invoice" (while Call back is the next step)');
must((pc.match(/class="btn primary"/g) || []).length <= 1 && !/data-help="card\.checkDraft"[^>]*class="btn primary"|class="btn primary"[^>]*data-help="card\.checkDraft"/.test(pc), 'the card has more than one big button');
must(!/data-help="card\.createInvoice"/.test(pc), 'the card still offers Create invoice next to its draft');
await s.post('/admin/requests/called', { r: s.rk(pKey) });
const pc2 = nq(cardOf((await s.get('/admin/')).text, pKey));
if (/data-next-step="invoiced"/.test(pc2)) {
  must(pc2.includes(`data-next-what>📄 Invoice draft ready: ${money(total)}<`) && /data-help="step\.reviewSend"[^>]*>Check and send the invoice</.test(pc2) && !/data-draft-ready/.test(pc2), 'on the invoice step the next-step box is not the draft (or the draft shows twice)');
} else must(/data-draft-ready/.test(pc2), 'the draft box disappeared after Called back');

// ---- 5. "What they want" rebuilds the unsent auto draft ------------------------------------
// She changes the price of the starting line by hand (sig no longer matches) and keeps the takedown as it was.
const ed0 = (await s.get(`/admin/invoices/${pd.id}/edit`)).text;
const autos = [...ed0.matchAll(/name="line_auto" value="([^"]*)"/g)].map((m) => m[1]);
must(autos.length === 3 && autos[0] === autoTag(pl[0]) && autos[1] === autoTag(pl[1]) && autos[2] === '', `the editor does not carry each line's auto mark (${autos.join(',')})`);
must(autoTag(pl[0]) === `start:${lineSig(pl[0])}`, 'autoTag is not kind:sig');
const form = (ls, tags) => ({ customer_name: 'Carmen Example', customer_email: 'carmen.example@example.com', customer_phone: '901-555-0701', issue_date: pd.issue_date, due_date: pd.due_date, pay_plan: 'half', deposit: '', notes: '', go: 'save',
  line_desc: ls.map((l) => l.description), line_qty: ls.map((l) => String(l.qty)), line_price: ls.map((l) => (l.unit_cents / 100).toFixed(2)), line_note: ls.map((l) => l.note), line_refundable: ls.map(() => '0'), line_auto: tags });
await s.post(`/admin/invoices/${pd.id}`, form([{ ...pl[0], unit_cents: 42000 }, pl[1]], autos.slice(0, 2)));
let after = await linesOf(pd.id);
must(after[0].unit_cents === 42000 && after[0].auto === null && after[1].auto === 'takedown', `a line changed by hand kept its auto mark, or an unchanged one lost it (${JSON.stringify(after.map((l) => [l.description, l.auto]))})`);
// A forged mark (wrong sig) never marks a line.
await s.post(`/admin/invoices/${pd.id}`, form(after.map((l) => ({ ...l })), [`start:${lineSig(pl[0])}`, autos[1]]));
after = await linesOf(pd.id);
must(after[0].auto === null, 'a line_auto whose sig does not match was accepted');
const res = await s.post('/admin/requests/edit/want', { r: s.rk(pKey), services: ['party', 'grazing'] });
const flash = decodeURIComponent((res.location.match(/[?&]m=([^&#]+)/) || [])[1] || '');
after = await linesOf(pd.id);
must(after.some((l) => l.description === 'Party decor: Birthday' && l.unit_cents === 42000 && l.auto === null), 'the rebuild dropped the line she changed by hand');
must(after.filter((l) => l.description === 'Party decor: Birthday').length === 1, 'the rebuild wrote the hand-changed line twice');
must(after.some((l) => /^Grazing table styling/.test(l.description) && l.unit_cents === T.grazingFromCents && l.auto === 'start') && after.some((l) => l.description === 'Takedown' && l.auto === 'takedown'), `the rebuild did not add grazing or keep the takedown (${after.map((l) => l.description).join(' | ')})`);
must(/The invoice draft \(not sent\) was rebuilt to match; the line you changed by hand was kept\. Check the price before you send it\./.test(flash), `the page does not say the draft was rebuilt and the hand line kept ("${flash}")`);
const upd = (await s.one('SELECT status, sent_at, deposit_due_cents FROM invoices WHERE id = ?1', pd.id));
must(upd.status === 'draft' && !upd.sent_at && upd.deposit_due_cents === Math.round(after.reduce((t, l) => t + l.qty * l.unit_cents, 0) / 2), 'the rebuilt draft is not still an unsent half-deposit draft');
// A sent invoice is never touched; a void one neither.
await s.post(`/admin/invoices/${pd.id}/status`, { action: 'texted' });
const sentSnap = JSON.stringify(await linesOf(pd.id));
const res2 = await s.post('/admin/requests/edit/want', { r: s.rk(pKey), services: ['party'] });
must(JSON.stringify(await linesOf(pd.id)) === sentSnap, 'a sent invoice was rebuilt');
must(/was already sent, so it was not changed/.test(decodeURIComponent(res2.location)), 'the page does not say the sent invoice was left alone');
const gInv = (await invsOf(gz.row.request_key))[0];
await s.post(`/admin/invoices/${gInv.id}/status`, { action: 'void' });
const voidSnap = JSON.stringify(await linesOf(gInv.id));
await s.post('/admin/requests/edit/want', { r: s.rk(gz.row.request_key), services: ['grazing', 'party'] });
must(JSON.stringify(await linesOf(gInv.id)) === voidSnap, 'a void invoice was rebuilt');
// A hand-made draft (not auto) is never rebuilt.
must((await AD.rebuildAutoDraft(s.env, 'site|2026-10-01 10:00:00|old@example.com')) === null, 'rebuild acted on a request with no auto draft');

// ---- 6. The editor -------------------------------------------------------------------------
const ed = (await s.get(`/admin/invoices/${phInv[0].id}/edit`)).text;
const edq = nq(ed);
must(/<h2>What Paz is paying for<\/h2>/.test(ed), 'the editor heading is not "What Paz is paying for"');
must((ed.match(/data-help="ed\.lineChange"[^>]*>✏️ Change<\/button>/g) || []).length === phl.length + 1, 'not every line has a visible ✏️ Change');
must(/class="lstart" data-l-start>Starting price from your price list</.test(ed), 'the starting line does not say "Starting price from your price list"');
must((ed.match(/data-help="ed\.lineDone"[^>]*>✓ Done with this line</g) || []).length === phl.length + 1, 'a line lacks ✓ Done with this line');
must(/class="linkbtn danger" data-remove data-help="ed\.removeLine"[^>]*>Remove this line…<\/button>\s*<div class="rmask" data-rm-ask hidden><p>Remove <b data-rm-name>Party decor: Anniversary<\/b> from this invoice\?<\/p>/.test(ed) && /data-rm-yes[^>]*>Yes, remove it</.test(ed) && /data-rm-no[^>]*>No, keep it</.test(ed), 'Remove this line… does not ask "Remove <line> from this invoice?" in the page');
must(!/window\.confirm|[^.\w]confirm\(/.test(ed.slice(ed.indexOf('<script>(function(){\n  var form=document.getElementById(\'inv\')') )), 'the editor uses a browser confirm pop-up');
must(/class="newtag" data-new-tag>NEW LINE</.test(ed) && /<template id="line-tpl"><div class="lrow" data-line data-open data-new>/.test(ed), 'a new line is not marked NEW LINE and opened');
must(/<div class="sofar" data-total-so-far><span>Total so far<\/span><strong id="sum-sofar">/.test(ed), 'no "Total so far"');
const menu = ed.slice(ed.indexOf('data-add-menu'), ed.indexOf('id="add-close"'));
const opts = [...menu.matchAll(/<b>([^<]+)<\/b><small>([^<]+)<\/small>/g)].map((m) => `${nq(m[1])}/${nq(m[2])}`);
must(opts.slice(0, 6).join('|') === 'Something else/Type what it is and its price|Delivery fee/For business delivery|Setup / takedown fee/Taking it down after|Damage deposit/Given back after the event|Discount/Takes money off the total|A porch package/Pick from your price list', `the ＋ Add list is ${opts.join('|')}`);
must((ed.match(/＋ Add something to this invoice/g) || []).length === 1 && /id="add-close"[^>]*>✕ Close</.test(ed) && /aria-controls="add-menu"/.test(ed), 'not ONE "＋ Add something to this invoice" with ✕ Close');
must(/function openLine\(el,focus\)\{list\.querySelectorAll\('\[data-line\]\[data-open\]'\)/.test(ed) && /openLine\(el,desc\?'\[data-price\]':'\[name=line_desc\]'\);el\.setAttribute\('data-new',''\)/.test(ed), 'one-line-open / focus-in-price for a new line is not in the editor script');
must(/\.ed\.js \.lrow:not\(\[data-open\]\) \.lgrid\{display:none\}/.test(ed), 'lines without JavaScript would be hidden (no .js guard)');
must(edq.includes('Nothing now · all ') && /value="none"/.test(ed), 'the editor lacks No deposit with its grey amount');

// ---- 7. Numbered payments, paid steps, and the two real invoices' shapes ---------------------
// Paid steps on a sent invoice: the rental (custom deposit) with its deposit recorded.
const rInv = ri[0];
await s.post(`/admin/invoices/${rInv.id}/status`, { action: 'texted' });
await s.post(`/admin/invoices/${rInv.id}/status`, { action: 'deposit_paid', method: 'zelle' });
const page = nq((await s.get(`/admin/invoices/${rInv.id}`)).text);
const today = shortDate(s.util.todayISO ? (await mod('functions/_lib/reminders.mjs')).chicagoDate() : '');
must(new RegExp(`data-pay-step="1" data-step-paid><span><span class="n">①</span>Deposit · now · holds the date<span class="pd">✓ paid ${today}</span>`).test(page), `the paid deposit step is not green "✓ paid ${today}"`);
must(/data-pay-step="2"><span><span class="n">②<\/span>The rest · by /.test(page) && /data-still-owed>Still owed \$/.test(page), 'the unpaid rest / Still owed is missing');
const rc = nq(cardOf((await s.get('/admin/')).text, rent.row.request_key));
must(/data-pay-steps/.test(rc) && rc.includes('✓ paid') && /How Rhea pays/.test(rc), "the card's Payment box lacks the numbered payments");
const todo2 = TODO.renderTodo(await TODO.todoData(s.db, todayISO()));
must(typeof todo2.text === 'string', 'the to-do email did not render');

// #4's shape: All now, $130 of games + $50 damage deposit, due Fri 23 Oct (made-up name).
const lines4 = [{ description: 'Pick 3 bundle, 1 day: Giant Connect 4, Cornhole, Giant Uno', qty: 1, unit_cents: 13000, note: '', refundable: 0 }, { description: 'Damage deposit (refundable)', qty: 1, unit_cents: 5000, note: 'Refunded at return if everything comes back undamaged', refundable: 1 }];
const inv4 = { id: 4, number: 'PNP-2026-0004', customer_name: 'Tam Example', customer_email: 't@example.com', issue_date: '2026-10-19', due_date: '2026-10-23', deposit_due_cents: 18000, pay_plan: 'full', notes: 'Pick up Friday after 5 pm.', status: 'sent' };
const ps4 = PS.payStepsOf(inv4, lines4);
must(ps4.total === 18000 && ps4.now === 18000 && ps4.rest === 0 && ps4.steps.length === 1 && ps4.steps[0].what === 'All of it' && ps4.steps[0].when === 'now' && ps4.totalWords === '$130 rental + $50 refundable damage deposit', `#4's shape reads ${JSON.stringify(ps4)}`);
const m4 = E.renderInvoiceEmail({ invoice: inv4, lines: lines4, settings: {}, contact: {}, qrSrc: null });
must(m4.text.includes('Total: $180.00') && m4.text.includes('① All of it, now: $180.00') && !m4.text.includes('②'), "#4's email does not read $180 total, all of it now");
// #5's shape: $300 decor − $100 discount, $50 deposit (custom), due Wed 28 Oct.
const lines5 = [{ description: 'Party decor: Birthday', qty: 1, unit_cents: 30000, note: 'Home setup', refundable: 0 }, { description: 'Discount: friends & family', qty: 1, unit_cents: -10000, note: '', refundable: 0 }];
const inv5 = { id: 5, number: 'PNP-2026-0005', customer_name: 'Cara Example', customer_email: 'c@example.com', issue_date: '2026-10-20', due_date: '2026-10-28', deposit_due_cents: 5000, pay_plan: 'custom', notes: '', status: 'draft' };
const ps5 = PS.payStepsOf(inv5, lines5);
must(ps5.total === 20000 && ps5.now === 5000 && ps5.rest === 15000 && ps5.sumWords === '$50 + $150 = $200 total' && ps5.steps[1].when === 'by Wed 28 Oct' && !ps5.totalWords, `#5's shape reads ${JSON.stringify(ps5)}`);
const p5 = nq(V.invoiceViewPage({ invoice: inv5, lines: lines5, pay: { complete: true, missing: [] }, flash: '', error: '' }));
must(p5.includes('How Cara pays') && p5.includes('Deposit · now · holds the date') && p5.includes('$50.00') && p5.includes('The rest · by Wed 28 Oct') && p5.includes('$150.00') && p5.includes('$50 + $150 = $200 total') && p5.includes('$200.00'), "#5's invoice page does not read $200 = $50 now + $150 by Wed 28 Oct");
const m5 = E.renderInvoiceEmail({ invoice: inv5, lines: lines5, settings: {}, contact: {}, qrSrc: null });
must(m5.text.includes('① Deposit now (holds your date): $50.00') && m5.text.includes('② The rest, by Wed 28 Oct: $150.00') && m5.text.includes('Total: $200.00'), "#5's email does not read ① $50 now, ② $150 by Wed 28 Oct");
const sms5 = PDF.textMessage({ invoice: inv5, lines: lines5, settings: {} });
must(sms5.includes('Total $200.00') && sms5.includes('$50 + $150 = $200 total'), "#5's text message numbers changed");
must(PS.payStepsOf({ ...inv5, pay_plan: 'custom', deposit_due_cents: 0 }, lines5).noDeposit, 'a $0 typed deposit does not read as No deposit');
// A row from before 'none' existed keeps its plan.
must(s.util.payPlanOf({ pay_plan: 'half', deposit_due_cents: 0 }, 1000) === 'half' && s.util.payPlanOf({ pay_plan: 'custom', deposit_due_cents: 0 }, 1000) === 'custom', 'an existing invoice changed plan');

// ---- 8. Migration 0020 is additive only ----------------------------------------------------
const mig = fs.readFileSync(path.join(ROOT, 'migrations/0020_invoice_auto_draft.sql'), 'utf8').replace(/--.*$/gm, '');
const stmts = mig.split(';').map((x) => x.trim()).filter(Boolean);
must(stmts.length === 2 && stmts.every((x) => /^ALTER TABLE (invoices|invoice_lines) ADD COLUMN \w+ (INTEGER|TEXT)$/.test(x)), `migration 0020 is not two nullable ADD COLUMNs: ${stmts.join(' / ')}`);

if (checks < 75) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: calm invoices (${errors.length} of ${checks})\n - ${errors.join('\n - ')}`); process.exit(1); }
console.log(`calm invoices: OK (${checks} checks: auto draft on website + phone requests, one per request, failure keeps the request, no backfill, drafts never owed, card draft box, rebuild keeps hand lines + leaves sent/void alone, editor ✏️ Change / Done / Remove… / ＋ Add list / NEW LINE, numbered payments with paid steps, #4/#5 shapes unchanged, additive migration)`);
