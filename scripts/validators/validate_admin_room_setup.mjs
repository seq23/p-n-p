#!/usr/bin/env node
/**
 * Room setups start at the basic room setup line (owner-approved 25 Oct 2026;
 * functions/_lib/pricing.mjs prefillLines + isRoomSetup, data/offers/services.json
 * services.celebration.roomSetup).
 *
 * Fails when:
 *  1. a party request in a hotel room / suite / Airbnb / bedroom (or with event type "hotel room" /
 *     "room setup") does not start its prefill with exactly "Basic room setup (15 ceiling balloons,
 *     banner, petal walkway, bed design, 8–12 LED tea lights)" at $300, qty 1, auto 'start';
 *  2. a home, backyard, venue, living-room or hotel-ballroom party, a grazing-only request, a
 *     porch or a rental gets that line, or loses its own starting line;
 *  3. the line's words or price are typed into the code instead of read from services.json (a
 *     perturbed services.json must move the line);
 *  4. a hotel-room website request's auto draft is not an unsent draft starting with that line, or
 *     rebuildAutoDraft drops it or sends anything.
 *  5. the three presets (Basic $300 / Luxury $500 / Signature $1,500) are not defined once in
 *     services.json with the owner's exact words, prices and note rows, or mention champagne,
 *     desserts, food or drinks; the picker label is not exact;
 *  6. a preset replaces more than the room setup lines, does not go where the room setup line was,
 *     or Signature leaves a separate Takedown (double charge); a rebuild re-adds Basic or Takedown;
 *  7. the unsent editor lacks the picker under the lines (labelled buttons, hidden preview, Use these
 *     lines / Cancel), the browser plans the swap with other code than the server, a non-room or
 *     sent invoice shows it, or saving does not land back on the same invoice;
 *  8. a Luxury line or note row is missing on the invoice page, HTML email, text email, text
 *     message or PDF, or the total is not $500.
 * Rule 0: fewer than 120 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pdfTextItems } from './lib/pdf_streams.mjs';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

const LINE = 'Basic room setup (15 ceiling balloons, banner, petal walkway, bed design, 8–12 LED tea lights)';
const P = await mod('functions/_lib/pricing.mjs');
const AD = await mod('functions/_lib/auto-draft.mjs');
const s = await session();
const T = s.PRICE_TABLE;
const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8'));
const games = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/validators/fixtures/games.json'), 'utf8'));

// ---- 3. One definition: the table reads services.json --------------------------------------------
const basicData = (services.services.celebration.roomSetupPresets || [])[0];
must(basicData && basicData.key === 'basic' && basicData.lines.length === 1 && basicData.lines[0].description === LINE && basicData.lines[0].price === 300 && basicData.total === 300, 'services.json celebration.roomSetupPresets does not start with the approved Basic line at $300');
must(!('roomSetup' in services.services.celebration), 'services.json still carries a second room setup definition (celebration.roomSetup)');
must(T.roomSetup && T.roomSetup.description === LINE && T.roomSetup.cents === 30000, `the price table room setup is ${JSON.stringify(T.roomSetup)}`);
const src = fs.readFileSync(path.join(ROOT, 'functions/_lib/pricing.mjs'), 'utf8');
must(!src.includes('ceiling balloons') && !/30000/.test(src), 'the room setup words or price are typed into pricing.mjs');

const party = (where, event = 'Anniversary', extra = {}) => ({ services: ['party'], wantsDecor: true, decor: [{ label: "What's the event type?", value: event }, { label: 'Where is it?', value: where }, { label: 'How many guests?', value: '2' }], ...extra });

// ---- 1. Room setups --------------------------------------------------------------------------------
for (const where of ['Hotel room', 'hotel ROOM', 'Hotel', 'Airbnb', 'Air BnB downtown', 'Hotel suite', 'Bedroom', 'Master bedroom at home', 'Room 412 at the Peabody', 'Motel']) {
  const l = P.prefillLines(party(where), T);
  must(l[0] && l[0].description === LINE && l[0].unit_cents === 30000 && l[0].qty === 1 && l[0].auto === 'start' && l[0].refundable === 0, `"${where}" does not start at the basic room setup line: ${JSON.stringify(l[0])}`);
  must(l[0] && l[0].note === `${where} · 2 guests`, `"${where}" lost its answers in the note: ${JSON.stringify(l[0] && l[0].note)}`);
  must(!l.some((x) => /^Party decor/.test(x.description)), `"${where}" also carries a Party decor line`);
}
for (const event of ['Hotel room surprise', 'Room setup']) {
  const l = P.prefillLines(party('Not sure yet', event), T);
  must(l[0] && l[0].description === LINE && l[0].unit_cents === 30000, `event type "${event}" does not start at the room setup line: ${JSON.stringify(l[0])}`);
}
// A phone booking names its event type on the request, not in the decor answers.
const phoneRoom = P.prefillLines({ services: ['party'], wantsDecor: true, decor: [], eventType: 'Hotel room setup' }, T);
must(phoneRoom[0] && phoneRoom[0].description === LINE, `a phone "hotel room setup" does not start at the room setup line: ${JSON.stringify(phoneRoom[0])}`);

// ---- 2. Everything else is unchanged -----------------------------------------------------------
for (const where of ['Backyard or outdoors', 'Home', 'Event space or venue', 'Living room', 'Hotel ballroom', 'Church party room']) {
  const l = P.prefillLines(party(where, 'Birthday'), T);
  must(l[0] && l[0].description === 'Party decor: Birthday' && l[0].unit_cents === T.celebrationFromCents && l[0].auto === 'start', `"${where}" does not keep the Party decor starting line: ${JSON.stringify(l[0])}`);
  must(!l.some((x) => x.description === LINE), `"${where}" got the room setup line`);
}
const graz = P.prefillLines({ services: ['grazing'], wantsDecor: true, decor: [{ label: "What's the event type?", value: 'Hotel room' }] }, T);
must(graz[0] && /^Grazing table styling/.test(graz[0].description) && !graz.some((x) => x.description === LINE), `a grazing request got the room setup line: ${JSON.stringify(graz)}`);
const rental = P.prefillLines({ wantsRentals: true, gamesAnswer: '', durationAnswer: '1 day', eventType: 'Hotel room' }, T);
must(rental.length && !rental.some((x) => x.description === LINE), 'a rental request got the room setup line');
const oldRow = P.prefillLines({ wantsDecor: true, eventType: 'Hotel room' }, T);
must(oldRow.length === 1 && oldRow[0].description === 'Decor: Hotel room' && oldRow[0].unit_cents === 0, `an old form row (no service ticks) changed: ${JSON.stringify(oldRow)}`);
must(P.isRoomSetup({ services: ['party'], decor: [{ label: 'Where is it?', value: 'Backyard or outdoors' }] }) === false, 'isRoomSetup says a backyard is a room setup');

// ---- 3b. A perturbed services.json moves the line ---------------------------------------------------
const s2 = JSON.parse(JSON.stringify(services));
s2.services.celebration.roomSetupPresets[0].lines[0] = { ...s2.services.celebration.roomSetupPresets[0].lines[0], description: 'Perturbed room line', price: 417 };
const T2 = P.buildPriceTable(games, s2);
const pl2 = P.prefillLines(party('Hotel room'), T2);
must(pl2[0] && pl2[0].description === 'Perturbed room line' && pl2[0].unit_cents === 41700, `the line does not follow services.json: ${JSON.stringify(pl2[0])}`);
const s3 = JSON.parse(JSON.stringify(services)); delete s3.services.celebration.roomSetupPresets;
const pl3 = P.prefillLines(party('Hotel room'), P.buildPriceTable(games, s3));
must(pl3[0] && pl3[0].description === 'Party decor: Anniversary', 'with no roomSetupPresets in services.json the hotel party does not fall back to Party decor');

// ---- 4. The website auto draft, end to end, and its rebuild -----------------------------------------
const mailsBefore = s.env.sent.length;
const { todayISO } = s.util;
const r = await s.siteRequest({ service: 'party', party_event: 'Anniversary', party_where: 'Hotel room', party_guests: 'Just the two of us', party_budget: '$300–$500', party_takedown: 'no', event_date: todayISO(20), location: 'Downtown Memphis', name: 'Rho Example', phone: '901-555-0791', email: 'rho.example@example.com' });
must(r.status === 303 && r.row, 'the hotel-room request did not go through');
const key = r.row && r.row.request_key;
const invs = await s.all('SELECT * FROM invoices WHERE request_key = ?1 ORDER BY id', key);
must(invs.length === 1 && invs[0].status === 'draft' && !invs[0].sent_at && invs[0].auto_draft === 1, `the hotel-room request has ${JSON.stringify(invs.map((i) => [i.status, i.sent_at, i.auto_draft]))}`);
const lines = invs[0] ? await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id', invs[0].id) : [];
must(lines[0] && lines[0].description === LINE && lines[0].unit_cents === 30000 && lines[0].qty === 1 && lines[0].auto === 'start', `the hotel-room draft starts with ${JSON.stringify(lines[0])}`);
must(lines.length === 1, `the hotel-room draft has ${lines.length} lines`);
const rb = await AD.rebuildAutoDraft(s.env, key);
const after = invs[0] ? await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id', invs[0].id) : [];
must(rb && rb.rebuilt && after.length === 1 && after[0].description === LINE && after[0].auto === 'start', `the rebuilt draft is ${JSON.stringify(after)}`);
must(!s.env.sent.slice(mailsBefore).some((m) => /invoice/i.test(String(m.subject || ''))), 'an invoice email went out by itself');

// ---- 5. The three presets: one definition, exact words, totals ---------------------------------
const WANT = {
  basic: [[LINE, 300, []]],
  luxury: [
    ['Luxury Balloon Display', 175, ['Custom-designed black, white, and silver balloon arrangement', 'Premium metallic and coordinating balloon accents', 'Elegant statement display tailored to the room']],
    ['Floating Balloon Décor', 75, ['Coordinating ceiling balloons with decorative ribbons', 'Placement customized to complement the overall design']],
    ['Romantic LED Candle Styling', 65, ['Elegant, flameless votive-style LED candles', 'Beautiful candle arrangements throughout designated areas', 'Warm ambient lighting accents']],
    ['Luxury Rose-Petal Styling', 65, ['Decorative faux rose-petal walkway', 'Elegant rose-petal bed arrangement', 'Additional petal accents where appropriate']],
    ['Personalized Decorative Touches', 35, ['Celebration signage or lettering', 'Coordinating ribbons and decorative accents', 'Finishing details to complement the theme']],
    ['Professional Design & Installation', 85, ['Custom décor planning and styling', 'Arrangement of all decorative elements', 'Local delivery and professional room installation']],
  ],
  signature: [
    ['Grand Balloon Installation', 400, ['Balloon arch or floor-standing design, installed', 'Oversized or glossy luxury balloons', 'Can include a photo backdrop']],
    ['Floating Balloon Ceiling', 150, ['Full ceiling of coordinating balloons with ribbon tails', "Placement planned around the room's layout"]],
    ['Luxury Floral Arrangements', 250, ['Premium floral centerpieces and accents', 'Coordinated with the color palette', 'Placed on tables, nightstands and entry']],
    ['Candlelit Ambiance', 150, ['40+ flameless LED pillar and votive candles', 'Candle clusters throughout the room', 'Warm fairy-light accents']],
    ['Rose-Petal Luxe Styling', 125, ['Faux rose-petal walkway', 'Petal heart or initials on the bed', 'Petal accents in the bath and seating areas']],
    ['Personalized Signage', 125, ['Custom name or celebration sign', 'Coordinating lettering and décor accents']],
    ['Signature Styling Accents', 100, ['Extra décor touches chosen for the room', 'Styled table, tray or vignette accents', 'Finishing details to complete the look']],
    ['Professional Design, Installation & Takedown', 200, ['Design call and custom plan', 'Local delivery and full room installation', 'Takedown included']],
  ],
};
const TOTALS = { basic: 30000, luxury: 50000, signature: 150000 };
const PR = T.roomSetupPresets || [];
must(PR.map((p) => p.key).join() === 'basic,luxury,signature' && PR.map((p) => p.name).join() === 'Basic,Luxury,Signature', `the presets are ${JSON.stringify(PR.map((p) => p.key))}`);
for (const p of PR) {
  const w = WANT[p.key] || [];
  must(p.totalCents === TOTALS[p.key] && p.declaredCents === TOTALS[p.key], `${p.name} totals ${p.totalCents} (declared ${p.declaredCents}), not ${TOTALS[p.key]}`);
  must(p.lines.length === w.length, `${p.name} has ${p.lines.length} lines, not ${w.length}`);
  w.forEach(([d, price, note], i) => {
    const l = p.lines[i] || {};
    must(l.description === d && l.unit_cents === price * 100 && l.qty === 1 && l.refundable === 0 && l.note === note.join('\n'), `${p.name} line ${i + 1} is ${JSON.stringify(l)}`);
  });
}
must(PR[2] && PR[2].includesTakedown === true && !PR[0].includesTakedown && !PR[1].includesTakedown, 'only Signature should include takedown');
must(!/champagne|dessert|food|drink/i.test(JSON.stringify(services.services.celebration.roomSetupPresets)), 'a preset mentions champagne, desserts, food or drinks');
const VIEWS = await mod('functions/_lib/views.mjs');
must(VIEWS.roomPresetLabel(PR) === 'Room setup presets: Basic $300 · Luxury $500 · Signature $1,500', `the picker label is "${VIEWS.roomPresetLabel(PR)}"`);

// ---- 6. Applying a preset: room setup lines only; Signature takes out the Takedown --------------
const hand = { description: 'Extra photo backdrop', qty: 1, unit_cents: 4000, note: 'Gold', refundable: 0 };
const draft = [{ description: LINE, qty: 1, unit_cents: 30000, note: 'Hotel room', refundable: 0, auto: 'start' }, { description: 'Takedown', qty: 1, unit_cents: T.takedownCents, note: '', refundable: 0, auto: 'takedown' }, hand];
const sum = (ls) => ls.reduce((t, l) => t + l.qty * l.unit_cents, 0);
const lux = P.applyRoomPreset(draft, PR, 'luxury');
must(lux.length === 8 && lux.slice(0, 6).map((l) => l.description).join('|') === WANT.luxury.map((x) => x[0]).join('|') && lux[6].description === 'Takedown' && lux[7].description === hand.description && lux[7].unit_cents === 4000 && lux[7].note === 'Gold', `Luxury applied gives ${JSON.stringify(lux.map((l) => l.description))}`);
must(sum(lux.slice(0, 6)) === 50000 && sum(lux) === 50000 + T.takedownCents + 4000, `Luxury applied totals ${sum(lux)}`);
const sig = P.applyRoomPreset(lux, PR, 'signature');
must(sig.length === 9 && sig.slice(0, 8).map((l) => l.description).join('|') === WANT.signature.map((x) => x[0]).join('|') && sig[8].description === hand.description, `Signature over Luxury gives ${JSON.stringify(sig.map((l) => l.description))}`);
must(!sig.some((l) => /^takedown$/i.test(l.description)) && sum(sig) === 150000 + 4000, `Signature still charges a separate Takedown or totals ${sum(sig)}`);
const back = P.applyRoomPreset(sig, PR, 'basic');
must(back.length === 2 && back[0].description === LINE && back[0].unit_cents === 30000 && back[1].description === hand.description, `Basic over Signature gives ${JSON.stringify(back.map((l) => l.description))}`);
must(P.applyRoomPreset([hand], PR, 'luxury')[0].description === WANT.luxury[0][0] && P.applyRoomPreset([hand], PR, 'luxury')[6] && P.applyRoomPreset([hand], PR, 'luxury')[6].description === hand.description, 'a preset on an invoice with no room setup line does not go on top, keeping her line');
const rec = P.reconcileRoomPreset([draft[0], draft[1]], sig.slice(0, 8), PR);
must(rec.length === 0, `a rebuild over Signature would add back ${JSON.stringify(rec.map((l) => l.description))}`);
const recL = P.reconcileRoomPreset([draft[0], draft[1]], lux.slice(0, 6), PR);
must(recL.length === 1 && recL[0].description === 'Takedown', `a rebuild over Luxury gives ${JSON.stringify(recL.map((l) => l.description))}`);
must(P.reconcileRoomPreset([draft[0], draft[1]], [hand], PR).length === 2, 'a rebuild with no preset kept dropped a line');

// ---- 7. The editor: picker on an unsent room setup invoice only; the browser runs the same plan --
const r2 = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Hotel room', party_guests: 'Just the two of us', party_budget: '$300–$500', party_takedown: 'yes', event_date: todayISO(25), location: 'Memphis', name: 'Sig Example', phone: '901-555-0792', email: 'sig.example@example.com' });
const key2 = r2.row && r2.row.request_key;
const inv2 = (await s.all('SELECT * FROM invoices WHERE request_key = ?1', key2))[0] || {};
const l2 = await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id', inv2.id);
must(l2.length === 2 && l2[0].description === LINE && l2[1].description === 'Takedown', `the hotel-room draft with takedown is ${JSON.stringify(l2.map((l) => l.description))}`);
const ed = (await s.get(`/admin/invoices/${inv2.id}/edit`)).text;
const edq = ed.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
must(ed.includes('<details class="paste roompre" data-room-presets>') && edq.includes('🛏️ Room setup presets: Basic $300 · Luxury $500 · Signature $1,500</summary>'), 'the unsent room setup invoice has no "Room setup presets" picker with its label');
must(['basic', 'luxury', 'signature'].every((k) => ed.includes(`data-room-preset="${k}"`)) && edq.includes('See the Luxury lines · $500') && edq.includes('See the Signature lines · $1,500'), 'the picker lacks a labelled button per preset');
must(ed.includes('data-room-use') && ed.includes('>Use these lines</button>') && ed.includes('data-room-cancel') && /data-room-cancel[^>]*>Cancel<\/button>/.test(ed) && ed.includes('data-room-preview hidden'), 'the picker lacks its hidden preview with Use these lines / Cancel');
must(ed.indexOf('data-room-presets') > ed.indexOf('data-total-so-far') && ed.indexOf('data-room-presets') < ed.indexOf('id="add-open"'), 'the picker is not right under the lines and Total so far');
const dataJson = (ed.match(/<script type="application\/json" id="room-presets-data">([\s\S]*?)<\/script>/) || [])[1] || '';
let pageData = []; try { pageData = JSON.parse(dataJson); } catch { pageData = []; }
must(pageData.length === 3 && pageData[1].lines.length === 6 && pageData[1].lines[0].note === WANT.luxury[0][2].join('\n') && pageData[2].totalCents === 150000, 'the page carries other preset data than the price table');
const script = (ed.match(/<script>([\s\S]*?)<\/script>/g) || []).map((x) => x.slice(8, -9)).find((x) => x.includes('function roomPresetPlan')) || '';
const fnSrc = (name) => { const i = script.indexOf(`function ${name}(`); if (i < 0) return ''; let depth = 0; for (let j = script.indexOf('{', i); j < script.length; j += 1) { if (script[j] === '{') depth += 1; else if (script[j] === '}') { depth -= 1; if (!depth) return script.slice(i, j + 1); } } return ''; };
let parses = true; try { new vm.Script(script); } catch { parses = false; }
must(script && parses, 'the editor script does not parse');
const descs = [LINE, 'Takedown', 'Extra photo backdrop'];
const ctx = {}; vm.createContext(ctx);
try { vm.runInContext(`${fnSrc('roomPresetPlan')}\nthis.out = JSON.stringify(roomPresetPlan(${JSON.stringify(descs)}, ${dataJson}, 'signature'));`, ctx); } catch (e) { ctx.out = `threw ${e.message}`; }
const serverPlan = P.roomPresetPlan(descs, pageData, 'signature');
must(ctx.out === JSON.stringify(serverPlan) && serverPlan.remove.join() === '0,1' && serverPlan.takedown.join() === '1' && serverPlan.at === 0, `the page plans the swap differently from the server: ${String(ctx.out).slice(0, 160)}`);
const yard = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Backyard or outdoors', party_guests: 'Just the two of us', party_budget: '$300–$500', party_takedown: 'yes', event_date: todayISO(26), location: 'Memphis', name: 'Yard Example', phone: '901-555-0793', email: 'yard.example@example.com' });
const yardInv = yard.row ? (await s.all('SELECT id FROM invoices WHERE request_key = ?1', yard.row.request_key))[0] : null;
const bEd = yardInv ? (await s.get(`/admin/invoices/${yardInv.id}/edit`)).text : '';
must(yard.status === 303 && bEd.includes('data-ed-lines') && !bEd.includes('<details class="paste roompre" data-room-presets>'), 'a backyard party invoice shows the room setup presets (or did not load)');

// "Use these lines" posts the editor's save with the preset swapped in; she lands on the same invoice.
const post = (ls) => s.post(`/admin/invoices/${inv2.id}`, {
  customer_name: inv2.customer_name, customer_email: inv2.customer_email, customer_phone: inv2.customer_phone, issue_date: inv2.issue_date, due_date: inv2.due_date, pay_plan: 'half', deposit: '', notes: '', go: 'save',
  line_desc: ls.map((l) => l.description), line_qty: ls.map((l) => String(l.qty)), line_price: ls.map((l) => (l.unit_cents / 100).toFixed(2)), line_note: ls.map((l) => (l.note || '').replace(/\n/g, '\r\n')), line_refundable: ls.map((l) => String(l.refundable || 0)), line_auto: ls.map(() => ''),
});
const usedSig = P.applyRoomPreset(l2, PR, 'signature');
const sv = await post(usedSig);
must(sv.status === 303 && new RegExp(`^/admin/invoices/${inv2.id}(\\?|$)`).test(sv.location || ''), `saving the preset did not land back on the same invoice: ${sv.status} ${sv.location}`);
const savedSig = await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id', inv2.id);
must(savedSig.length === 8 && sum(savedSig) === 150000 && !savedSig.some((l) => /^takedown$/i.test(l.description)), `the saved Signature invoice is ${savedSig.length} lines, ${sum(savedSig)} cents`);
must(savedSig.length === 8 && savedSig.every((l, i) => l.note === WANT.signature[i][2].join('\n')), 'a Signature line note lost its rows on save');
const rb2 = await AD.rebuildAutoDraft(s.env, key2);
const afterRb = await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id', inv2.id);
must(rb2 && afterRb.length === 8 && sum(afterRb) === 150000 && !afterRb.some((l) => l.description === LINE || /^takedown$/i.test(l.description)), `a rebuild after Signature gives ${JSON.stringify(afterRb.map((l) => l.description))}`);

// ---- 8. Luxury notes intact on every invoice surface ------------------------------------------
const usedLux = P.applyRoomPreset(afterRb, PR, 'luxury');
await post(usedLux);
const savedLux = await s.all('SELECT * FROM invoice_lines WHERE invoice_id = ?1 ORDER BY position, id', inv2.id);
const invLux = await s.one('SELECT * FROM invoices WHERE id = ?1', inv2.id);
must(savedLux.length === 6 && sum(savedLux) === 50000, `the Luxury invoice is ${savedLux.length} lines, ${sum(savedLux)} cents (the Takedown Signature took out does not come back)`);
const E = await mod('functions/_lib/email.mjs');
const PDF = await mod('functions/_lib/pdf.mjs');
const pageLux = (await s.get(`/admin/invoices/${inv2.id}`)).text.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const mail = E.renderInvoiceEmail({ invoice: invLux, lines: savedLux, settings: {}, contact: {}, qrSrc: null });
const mailHtml = mail.html.replace(/&amp;/g, '&').replace(/&#39;/g, "'");
const sms = PDF.textMessage({ invoice: invLux, lines: savedLux, settings: { zelle: '901-555-0100' } });
const pdfRaw = await PDF.renderInvoicePdf({ invoice: invLux, lines: savedLux, settings: {}, contact: {} });
const pdfTxt = pdfTextItems(pdfRaw);
must(pdfTxt.length > 10, `Rule 0: the PDF decoder read only ${pdfTxt.length} text items`);
for (const [d, price, note] of WANT.luxury) {
  must(pageLux.includes(d) && note.every((n) => pageLux.includes(`<span>${n}</span>`)), `invoice page: "${d}" or its note rows are missing`);
  must(mailHtml.includes(d) && note.every((n) => mailHtml.includes(`>${n}</`)), `HTML email: "${d}" or its note rows are missing`);
  must(mail.text.includes(`${d}: $${price}.00\n${note.map((n) => `  ${n}\n`).join('')}`), `plain-text email: "${d}" or its note rows are missing or run together`);
  must(sms.includes(`${d}: $${price}.00\n${note.map((n) => `  ${n}`).join('\n')}`), `text message: "${d}" or its note rows are missing or run together`);
  must(pdfTxt.some((t) => t.startsWith(d.slice(0, 20))) && note.every((n) => pdfTxt.some((t) => n.startsWith(t) && t.length > 10)), `PDF: "${d}" or its note rows are missing`);
}
must(mail.text.includes('$500.00') && sms.includes('Total: $500.00'), 'the Luxury invoice does not total $500 on the email and the text');

// A sent invoice never shows the presets.
await s.db.prepare("UPDATE invoices SET sent_at = datetime('now'), status = 'sent' WHERE id = ?1").bind(inv2.id).run();
const sentEd = (await s.get(`/admin/invoices/${inv2.id}/edit`)).text;
must(sentEd.includes('data-ed-lines') && !sentEd.includes('<details class="paste roompre" data-room-presets>'), 'a sent invoice shows the room setup presets (or its editor did not load)');

if (checks < 120) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`Room setup line FAILED (${errors.length}):\n - ${errors.join('\n - ')}`); process.exit(1); }
console.log(`Room setup line + presets OK: ${checks} checks; Basic $300 / Luxury $500 / Signature $1,500 from services.json, swap only the room setup lines, Signature takes out the Takedown, notes on all five surfaces; hotel / suite / Airbnb / bedroom party requests start at the $300 basic room setup line from services.json; home, backyard, venue, grazing, porch and rental requests unchanged; the auto draft and its rebuild carry it, nothing sent.`);
