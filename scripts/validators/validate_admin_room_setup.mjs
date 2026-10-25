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
 * Rule 0: fewer than 25 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
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
must(services.services.celebration.roomSetup && services.services.celebration.roomSetup.description === LINE && services.services.celebration.roomSetup.price === 300, 'services.json celebration.roomSetup is not the approved line at $300');
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
s2.services.celebration.roomSetup = { ...s2.services.celebration.roomSetup, description: 'Perturbed room line', price: 417 };
const T2 = P.buildPriceTable(games, s2);
const pl2 = P.prefillLines(party('Hotel room'), T2);
must(pl2[0] && pl2[0].description === 'Perturbed room line' && pl2[0].unit_cents === 41700, `the line does not follow services.json: ${JSON.stringify(pl2[0])}`);
const s3 = JSON.parse(JSON.stringify(services)); delete s3.services.celebration.roomSetup;
const pl3 = P.prefillLines(party('Hotel room'), P.buildPriceTable(games, s3));
must(pl3[0] && pl3[0].description === 'Party decor: Anniversary', 'with no roomSetup in services.json the hotel party does not fall back to Party decor');

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

if (checks < 25) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`Room setup line FAILED (${errors.length}):\n - ${errors.join('\n - ')}`); process.exit(1); }
console.log(`Room setup line OK: ${checks} checks; hotel / suite / Airbnb / bedroom party requests start at the $300 basic room setup line from services.json; home, backyard, venue, grazing, porch and rental requests unchanged; the auto draft and its rebuild carry it, nothing sent.`);
