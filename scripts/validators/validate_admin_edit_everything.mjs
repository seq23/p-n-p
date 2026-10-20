#!/usr/bin/env node
/**
 * "Everything about <first name>" (owner-approved mock-up, 20 Oct 2026; functions/_lib/admin-edit.mjs):
 * the Edit page collects what the customer sent and Valerie's side in one place.
 *
 * Fails when:
 *  1. the page is not titled "Everything about <first name>" (heading and <title>), lacks
 *     "← Back to main page", the name line, or a "Jump to:" line linking every section;
 *  2. the two parts are missing or out of order (What they sent 1-4, Your side 5-9, History
 *     last), or are not two columns on a laptop and one on a phone;
 *  3. section 1 lacks the four tick boxes in canonical order, the "The form said:" line, or the
 *     yellow heads-up before saving when bookings exist (and shows it when none exist);
 *  4. saving with nothing ticked is accepted (server side) or changes the row; a change does not
 *     write requests.services in canonical order, keep "The form said:" at the original, log
 *     "Changed <old> → <new>", switch porch_install/party_setup and porch_takedown/party_takedown
 *     in place at the same day and time, or keep any other booking with a heads-up;
 *     it touches invoices, invoice lines, payments or the form answers;
 *  5. section 3 lacks the rules line, Open ID photo (with the overlay on this page), Delete this
 *     ID with its confirm step, the deleted-state line, or Add ID photo for a phone booking; the
 *     delete / upload from this page does not come back to section 3;
 *  6. section 4 lacks the answers exactly as sent, the "To change the date or the games" note or
 *     the takedown fields (and Status still has them);
 *  7. after a save the green flash is not inside the section she saved.
 * Rule 0: fewer than 60 checks is a failure.
 */
import { mod } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const AE = await mod('functions/_lib/admin-edit.mjs');
const { CARD_SERVICES } = await mod('functions/_lib/cards.mjs');
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const sectionOf = (html, id) => { const i = html.indexOf(`id="${id}" data-edit-section="${id}"`); return i < 0 ? '' : html.slice(i, html.indexOf('</section>', i)); };

const s = await session();
const plus = (n) => s.util.todayISO(n);
const req = await s.siteRequest({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'classic', porch_takedown: 'yes', event_date: plus(8), location: 'Germantown', name: 'Wren Example', phone: '901-555-0960', email: 'wren.example@example.com', notes: 'Orange please' });
must(req.status === 303 && req.row, 'the porch request did not go through');
const key = req.row.request_key; const rk = s.rk(key);
const page0 = await s.get(`/admin/requests/edit?r=${rk}`);
const h0 = page0.text;

// 1. Title, back, name line, jump line.
must(/<h1>Everything about Wren<\/h1>/.test(h0), 'the heading is not "Everything about Wren"');
must(/<title>Everything about Wren · Porch &amp; Party<\/title>/.test(h0), 'the page <title> is not "Everything about Wren"');
must(!/Change anything on this request/.test(h0), 'the old "Change anything on this request" name is still on the page');
must(/data-back[^>]*>&larr; Back to main page</.test(h0), 'no "← Back to main page"');
must(/<strong>Wren Example<\/strong> · Customer \d+ · now: 1\. New · sent /.test(h0), 'the name line lacks name · Customer N · now: step · sent day');
const jump = (h0.match(/<nav class="jump"[^>]*data-jump>([\s\S]*?)<\/nav>/) || [])[1] || '';
must(/^Jump to: /.test(jump), 'no "Jump to:" line');
const jumpIds = [...jump.matchAll(/href="#([a-z]+)"/g)].map((m) => m[1]);
for (const id of AE.SECTIONS) {
  must(jumpIds.includes(id), `Jump to: has no link to #${id}`);
  must(h0.includes(`id="${id}" data-edit-section="${id}"`), `the page has no section #${id}`);
}
must(jumpIds.length === AE.SECTIONS.length + (h0.includes('id="history"') ? 1 : 0), `Jump to: links ${jumpIds.join(',')}`);
must(jump.match(/data-help="edit.jump"/g)?.length === jumpIds.length, 'a Jump to link has no tooltip');

// 2. Two parts, order, columns.
const order = [...h0.matchAll(/data-edit-section="([^"]+)"/g)].map((m) => m[1]);
must(order.join(',') === AE.SECTIONS.join(','), `sections out of order: ${order.join(',')}`);
const iSent = h0.indexOf('data-edit-part="sent"'); const iYours = h0.indexOf('data-edit-part="yours"');
must(iSent > 0 && iYours > iSent && h0.indexOf('data-edit-section="answers"') < iYours && h0.indexOf('data-edit-section="bookings"') > iYours, 'sections 1-4 are not under What they sent and 5-9 under Your side');
must(/<div class="editpart">What they sent<\/div>/.test(h0) && /<div class="editpart">Your side<\/div>/.test(h0), 'the part labels are missing');
const heads = [...h0.matchAll(/data-edit-section="[^"]+"><h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
must(heads.join('|') === "1. What they want|2. Contact details|3. ID and rules|4. Wren&#39;s answers on the form|5. Bookings|6. Done dates|7. Invoice|8. Payments|9. Status", `section headings: ${heads.join('|')}`);
must(/\.editpage \.editcols\{display:grid;grid-template-columns:minmax\(0,1fr\);/.test(h0) && /\.editpage \.editcols>div\{min-width:0\}/.test(h0) && /@media\(min-width:960px\)\{\.editpage \.editcols\{grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/.test(h0), 'not one column on a phone (no sideways scroll) and two on a laptop');
must(/wrap wide/.test(h0), 'the page is not wide on a laptop (no room for two columns)');

// 3. Section 1 before any booking.
const want0 = sectionOf(h0, 'want');
const boxes = [...want0.matchAll(/<input type="checkbox" name="services" value="([a-z]+)"( checked)?>/g)];
must(boxes.map((m) => m[1]).join(',') === CARD_SERVICES.join(','), `the tick boxes are not Porch, Party & decor, Grazing, Game rentals in order (${boxes.map((m) => m[1]).join(',')})`);
must(boxes.filter((m) => m[2]).map((m) => m[1]).join(',') === 'porch', 'the tick boxes do not show what they want now (porch)');
for (const w of ['Porch', 'Party &amp; decor', 'Grazing', 'Game rentals']) must(want0.includes(`> ${w}</label>`), `tick box "${w}" has no words`);
must(/data-form-said>The form said: Porch\. Tick everything Wren wants\./.test(want0), 'no "The form said: Porch" line');
must((want0.match(/data-help="edit.saveWant"/g) || []).length === 1 && />Save what they want</.test(want0), 'no single "Save what they want"');
must(!/data-want-heads-up/.test(want0), 'the booking heads-up shows with nothing booked');

// 4. Saves.
const inv = await s.invoiceFor((await (await mod('functions/_lib/requests.mjs')).loadRequests(s.env)).find((x) => x.key === key), { go: 'send' });
await s.post(`/admin/invoices/${inv.id}/status`, { action: 'deposit_paid', method: 'zelle' });
for (const [kind, date, time] of [['porch_install', plus(8), '10:00'], ['porch_takedown', plus(12), ''], ['grazing_setup', plus(8), '15:00']]) {
  await s.post('/admin/calendar/bookings', { r: rk, kind, date, time, customer_name: 'Wren Example', phone: '901-555-0960', email: '', place: 'Germantown', items: 'Porch' });
}
const bk0 = await s.all('SELECT id, kind, date, time FROM bookings WHERE request_key = ?1 ORDER BY id', key);
must(bk0.length === 3, `the three test bookings were not made (${bk0.length})`);
const snap = async () => JSON.stringify([await s.all('SELECT * FROM invoices WHERE request_key = ?1', key), await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY id', inv.id),
  await s.all('SELECT * FROM payments WHERE invoice_id = ?1 ORDER BY id', inv.id), (await s.one('SELECT answers, raw_row FROM requests WHERE request_key = ?1', key))]);
const before = await snap();
const want1 = sectionOf((await s.get(`/admin/requests/edit?r=${rk}`)).text, 'want');
must(/<div class="notice warn" data-want-heads-up>Heads up: Wren already has bookings on the calendar \(Porch install [^)]*\)\. If you change what they want, a porch booking becomes a party booking \(and the other way round\) on the same day and time\. Any other booking stays as it is: check it under Bookings\.<\/div>/.test(want1), 'no yellow heads-up before saving when bookings exist');
must(want1.indexOf('data-want-heads-up') < want1.indexOf('data-help="edit.saveWant"'), 'the heads-up is not before the Save');

const none = await s.post('/admin/requests/edit/want', { r: rk });
must(/[?&]e=/.test(none.location) && /at=want#want$/.test(none.location) && /Tick%20at%20least%20one/.test(none.location), `nothing ticked was accepted (${none.location})`);
must((await s.one('SELECT services FROM requests WHERE request_key = ?1', key)).services === '["porch"]', 'nothing ticked changed the services');
const bad = await s.post('/admin/requests/edit/want', { r: rk, services: ['bogus'] });
must(/[?&]e=/.test(bad.location), 'an unknown service alone was accepted');
must(/data-want-need[^>]*hidden/.test(want1) && /input\[name=services\]:checked/.test(want1), 'no on-page "Tick at least one" before posting');

const res = await s.post('/admin/requests/edit/want', { r: rk, services: ['rentals', 'party'] });
must(/[?&]m=/.test(res.location) && /at=want#want$/.test(res.location), `the save did not come back to section 1 (${res.location})`);
const row = await s.one('SELECT services, details_edits FROM requests WHERE request_key = ?1', key);
must(row.services === '["party","rentals"]', `requests.services is not canonical order (${row.services})`);
must(JSON.parse(row.details_edits).services_sent.join(',') === 'porch', 'the original form services were not kept');
const bk1 = await s.all('SELECT id, kind, date, time FROM bookings WHERE request_key = ?1 ORDER BY id', key);
const byId = Object.fromEntries(bk1.map((b) => [b.id, b]));
must(byId[bk0[0].id].kind === 'party_setup' && byId[bk0[0].id].date === bk0[0].date && byId[bk0[0].id].time === bk0[0].time, 'porch_install did not switch to party_setup at the same day and time');
must(byId[bk0[1].id].kind === 'party_takedown' && byId[bk0[1].id].date === bk0[1].date && (byId[bk0[1].id].time || '') === (bk0[1].time || ''), 'porch_takedown did not switch to party_takedown at the same day and time');
must(byId[bk0[2].id] && byId[bk0[2].id].kind === 'grazing_setup' && byId[bk0[2].id].date === bk0[2].date, 'the grazing booking (no match) did not stay as it was');
must(bk1.length === 3, 'a booking was added or removed');
must(await snap() === before, 'saving what they want changed an invoice, line, payment or the form answers');
const ev = await s.all('SELECT what, who FROM request_events WHERE request_key = ?1 ORDER BY id DESC LIMIT 6', key);
must(ev.some((e) => e.what === 'Changed Porch → Party & decor + Game rentals (by Valerie)' && e.who === 'Valerie'), `no history line "Changed Porch → Party & decor + Game rentals" (${ev.map((e) => e.what).join(' | ')})`);
must(ev.some((e) => /^Porch install on .* → Party setup \(same day and time\) \(by Valerie\)$/.test(e.what)), 'the booking switch wrote no history line');
const w = decodeURIComponent((res.location.match(/[?&]w=([^&#]+)/) || [])[1] || '');
must(/^Heads up: the Grazing table setup on .* is still on the calendar, but Grazing is no longer ticked\. Check it under Bookings: change it or remove it\.$/.test(w), `no heads-up for the booking that stays (${w})`);
const after = await s.get(res.location.replace('https://porchandparty901.com', ''));
const want2 = sectionOf(after.text, 'want');
// 7. The flash and the heads-up sit inside section 1.
must(/<h2>1\. What they want<\/h2><div class="notice ok" data-flash role="status">What they want saved ✓ Now: Party &amp; decor \+ Game rentals\. The Porch install on .* is now a Party setup, same day and time\./.test(want2), 'the green flash is not inside section 1 after its save');
must(/data-clash>Heads up: the Grazing table setup/.test(want2), 'the yellow heads-up is not inside section 1 after its save');
must(!/data-flash/.test(after.text.slice(0, after.text.indexOf('id="want"'))), 'the flash is (also) at the top of the page, away from the section');
must(/data-form-said>The form said: Porch\./.test(want2), '"The form said:" did not keep the original after the change');
must(/value="party" checked/.test(want2) && /value="rentals" checked/.test(want2) && !/value="porch" checked/.test(want2), 'the tick boxes do not show the saved services');
must(/Nothing%20changed/.test((await s.post('/admin/requests/edit/want', { r: rk, services: ['party', 'rentals'] })).location), 'saving the same ticks again did not say Nothing changed');
// Back to porch: party bookings switch back.
await s.post('/admin/requests/edit/want', { r: rk, services: ['porch', 'grazing'] });
const bk2 = await s.all('SELECT id, kind FROM bookings WHERE request_key = ?1 ORDER BY id', key);
must(bk2.map((b) => b.kind).join(',') === 'porch_install,porch_takedown,grazing_setup', `party bookings did not switch back to porch (${bk2.map((b) => b.kind).join(',')})`);
must(JSON.parse((await s.one('SELECT details_edits FROM requests WHERE request_key = ?1', key)).details_edits).services_sent.join(',') === 'porch', 'a second change overwrote the original form services');
// The card follows the new services.
must(/data-svc="grazing"|Grazing/.test((await s.get('/admin/')).text), 'the main page does not show the new service');

// 5. Section 3: rules, Open ID, delete, deleted state.
const id0 = sectionOf((await s.get(`/admin/requests/edit?r=${rk}`)).text, 'id');
const full = (await s.get(`/admin/requests/edit?r=${rk}`)).text;
must(/data-rules>✓ Agreed to the rules, /.test(id0), 'section 3 has no "✓ Agreed to the rules" line');
must(/<a class="btn ghost" href="\/admin\/requests\/id\/view\?r=[^"]+" data-id-open data-src="\/admin\/requests\/id\?r=/.test(id0) && />🪪 Open ID photo<\/a>/.test(id0), 'section 3 has no Open ID photo button');
must(/data-id-viewer hidden role="dialog"/.test(full) && /&#10005; Close/.test(full) && /go back to this page/.test(full), 'the ID overlay (with ✕ Close) is not on the Edit page');
must(/<details class="confirm"><summary class="btn danger" data-help="card.idDelete"[^>]*>Delete this ID<\/summary>/.test(id0) && /Delete Wren Example&#39;s ID photo for good\? It cannot be brought back\.|Delete Wren Example's ID photo for good\? It cannot be brought back\./.test(id0), 'Delete this ID has no confirm step with the question');
must(/<input type="hidden" name="from" value="edit">/.test(id0), 'Delete this ID does not come back to this page');
const del = await s.post('/admin/requests/id/delete', { r: rk, from: 'edit' });
must(new RegExp(`^/admin/requests/edit\\?r=${rk}&m=[^&]+&at=id#id$`).test(del.location), `deleting the ID did not come back to section 3 (${del.location})`);
const id1 = sectionOf((await s.get(del.location)).text, 'id');
must(/data-id-deleted>ID photo deleted on [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}\.</.test(id1) && /data-rules>✓ Agreed/.test(id1), 'the deleted state does not say "ID photo deleted on <day>." under the rules line');
must(/<h2>3\. ID and rules<\/h2><div class="notice ok" data-flash/.test(id1), 'the delete flash is not inside section 3');
must(!/data-id-open/.test(id1), 'a deleted ID can still be opened');
// The card path is unchanged.
const req2 = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', event_date: plus(9), location: 'Bartlett', name: 'Cass Card', phone: '901-555-0961', email: 'cass.card@example.com' });
must(/^\/admin\/\?m=/.test((await s.post('/admin/requests/id/delete', { r: s.rk(req2.row.request_key) })).location), 'Delete this ID from the card no longer goes back to the main page');

// Phone booking: no ID yet, rules not asked, Add ID photo comes back here.
await s.post('/admin/calendar/bookings', { service: 'porch', kind: 'porch_install', date: plus(10), time: '', customer_name: 'Pia Phone', phone: '901-555-0962', email: '', place: 'Cordova', items: 'Porch' });
const pr = await s.one("SELECT request_key FROM requests WHERE name = 'Pia Phone'");
must(Boolean(pr), 'the phone booking made no request');
if (pr) {
  const prk = s.rk(pr.request_key);
  const idp = sectionOf((await s.get(`/admin/requests/edit?r=${prk}`)).text, 'id');
  must(/data-id-none><strong>Phone booking, no ID yet<\/strong>/.test(idp) && /data-rules>Rules: not asked \(phone booking\)/.test(idp), 'a phone booking does not say "Phone booking, no ID yet" and "Rules: not asked"');
  must(/data-id-upload><input type="hidden" name="r" value="[^"]+"><input type="hidden" name="from" value="edit">/.test(idp) && /data-help="card.idUpload"/.test(idp), 'no Add ID photo (back to this page) for a phone booking');
  const jpg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9])], 'id.jpg', { type: 'image/jpeg' });
  const up = await s.post('/admin/requests/id/upload', { r: prk, from: 'edit', id_photo: jpg });
  must(new RegExp(`^/admin/requests/edit\\?r=${prk}&m=ID%20photo%20added%20%E2%9C%93&at=id#id$`).test(up.location), `Add ID photo did not come back to section 3 (${up.location})`);
  must(/data-id-open/.test(sectionOf((await s.get(up.location)).text, 'id')), 'after Add ID photo, section 3 has no Open ID photo');
  const upErr = await s.post('/admin/requests/id/upload', { r: prk, from: 'edit' });
  must(/^\/admin\/requests\/edit\?r=.*at=id#id$/.test(upErr.location), 'an Add ID photo message does not come back to section 3');
}

// 6. Section 4: answers as sent, the note, takedown here and not under Status.
const pg = (await s.get(`/admin/requests/edit?r=${rk}`)).text;
const ans = sectionOf(pg, 'answers');
for (const [label, value] of [['What season or occasion?', 'Fall / Halloween'], ['Want us to take it down afterwards?', ''], ['Event date', ''], ['Date of birth', '3 Feb 1990']]) {
  must(new RegExp(`<dt>${label.replace(/[?()/]/g, '\\$&')}</dt><dd>${value ? value.replace(/[/]/g, '\\$&') : '[^<]+'}</dd>`).test(ans), `section 4 does not show "${label}" as sent`);
}
must(!/<dt>Location/.test(ans) && !/Orange please/.test(ans), 'section 4 repeats the address or their notes (those are Contact details)');
must(!/<input(?![^>]*type="hidden")[^>]*name="(?!takedown_)/.test(ans), 'section 4 has an editable form answer (only the takedown may be changed there)');
must(/data-one-place>To change the date or the games, use Bookings or the Invoice below\./.test(ans), 'section 4 lacks the "To change the date or the games" note');
must(/name="takedown_plan"/.test(ans) && /name="takedown_date"/.test(ans) && /name="takedown_note"/.test(ans) && /data-help="edit.saveTakedown"[^>]*>Save takedown</.test(ans), 'the takedown plan / date / note and Save takedown are not in section 4');
must(!/name="takedown_/.test(sectionOf(pg, 'status')), 'Status still has the takedown fields');
const td = await s.post('/admin/requests/edit/takedown', { r: rk, takedown_plan: 'not_sure', takedown_date: plus(13), takedown_note: 'Call first' });
const tdr = await s.one('SELECT takedown_plan, takedown_date, takedown_note FROM requests WHERE request_key = ?1', key);
must(tdr.takedown_plan === 'not_sure' && tdr.takedown_date === plus(13) && tdr.takedown_note === 'Call first', 'Save takedown did not save');
must(/<h2>4\. Wren&#39;s answers on the form<\/h2><div class="notice ok" data-flash|<h2>4\. Wren's answers on the form<\/h2><div class="notice ok" data-flash/.test(sectionOf((await s.get(td.location)).text, 'answers')), 'the takedown flash is not inside section 4');
// Every section save lands back in its own section.
for (const [what, form, at] of [['customer', { name: 'Wren Example', phone: '901-555-0960', email: 'wren.example@example.com', address: 'Germantown', notes: 'Orange please' }, 'customer'], ['status', { step: 'new' }, 'status'], ['dates', {}, 'dates']]) {
  const r = await s.post(`/admin/requests/edit/${what}`, { r: rk, ...form });
  must(new RegExp(`&at=${at}#${at}$`).test(r.location), `saving ${what} does not come back to its section (${r.location})`);
}

if (checks < 60) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: admin edit everything (${errors.length})\n${errors.map((e) => `- ${e}`).join('\n')}`); process.exit(1); }
console.log(`validate_admin_edit_everything: OK (${checks} checks: "Everything about <first name>", Jump to, two parts in order (2 columns on a laptop), What they want ticks + server-side one-tick rule + canonical services + porch/party booking switch in place + heads-up before and after + money/answers untouched + history; ID and rules (overlay, delete asks first, deleted line, phone Add ID back to section 3); answers as sent + takedown moved from Status; the flash lands in the saved section)`);
