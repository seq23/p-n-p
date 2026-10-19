#!/usr/bin/env node
/**
 * The site request form (porchandparty901.com/request, owner-approved 18 Oct 2026) does what
 * the spec and every owner correction say. Drives the real public handler and the real admin
 * router over a fresh local database (never production). Fails when:
 *  1. page 1 is not the four services in the canonical brand order with their prices and the
 *     party parenthetical, or a service has no section of its own;
 *  2. any path (porch, party, grazing, rentals, more than one) is accepted without a photo ID,
 *     or without the rules checkbox; or a complete path is refused;
 *  3. the agreement is not stored with its time, rules version, name and IP, and logged;
 *  4. a rental does not hold its games (bookings count as games out, an overlapping booking of
 *     the same game is refused, availability greys it), or the hold does not expire at its
 *     end time (games free again, "Hold expired" logged), or no draft invoice is made with the
 *     exact deposit (damage deposit + 50% of the rental);
 *  5. the ID photo keeps its EXIF, is reachable without signing in, or "Delete this ID" does
 *     not remove it for good (and log it); the IDs-ready list misses a paid-in-full request;
 *  6. a referral code does not attribute the next request, or the code carries a name/email;
 *  7. the honeypot, the signed timing or the per-IP limit can be bypassed;
 *  8. the confirmation email is not sent (rentals: hold end and exact total), or any customer
 *     template says "review", "discount" or "% off";
 *  9. the weekly counts cross a Memphis Monday wrongly, or the month count is wrong;
 * 10. the imported Google Form row does not read back exactly as the sheet row did, key kept;
 * 11. request.html / rules.html carry a forms.gle link, rules.html lacks a section or its version.
 * Rule 0: fewer than 60 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT, call } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

const F = await mod('functions/_lib/request-form.mjs');
const RS = await mod('functions/_lib/request-submit.mjs');
const RQ = await mod('functions/_lib/requests.mjs');
const H = await mod('functions/_lib/holds.mjs');
const M = await mod('functions/_lib/messages.mjs');
const S = await mod('functions/_lib/sheet.mjs');
const AM = await mod('functions/_lib/admin-money.mjs');
const { PRICE_TABLE } = await mod('functions/_lib/prices.mjs');
const offers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8'));
// The scenario inventory the form is driven with (the validator harness loads the same fixture).
const games = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/validators/fixtures/games.json'), 'utf8'));
const games_ = games;
// brand.js is CommonJS reading JSON; read it in a plain child process (this one hooks JSON).
const { execFileSync } = await import('node:child_process');
const brand = JSON.parse(execFileSync(process.execPath, ['-e', `const b=require(${JSON.stringify(path.join(ROOT, 'scripts/lib/brand.js'))});console.log(JSON.stringify({SERVICES:b.SERVICES,PRICES:b.PRICES}))`], { encoding: 'utf8' }));

// ---- 1. Page 1 and sections ------------------------------------------------------------
const choices = F.serviceChoices(offers, PRICE_TABLE);
must(JSON.stringify(choices.map((c) => c.key)) === JSON.stringify(brand.SERVICES.map((s) => s.key)), 'page-1 services are not in the canonical brand order');
must(choices.every((c, i) => c.label.toLowerCase() === brand.SERVICES[i].label.replace('grazing tables', 'grazing tables')), `page-1 labels drift from brand SERVICES: ${choices.map((c) => c.label).join(' / ')}`);
must(choices[1].note.includes(F.PARTY_PARENTHETICAL.slice(1, -1)) && F.PARTY_PARENTHETICAL === '(hotel-room surprises, home celebrations, showers, event spaces — big or small)', 'party choice lacks the owner parenthetical');
must(choices[0].note.includes(`$${brand.PRICES.porch}`) && choices[1].note.includes(`$${brand.PRICES.party}`) && choices[2].note.includes(`$${brand.PRICES.grazing}`) && choices[3].note.includes(`$${brand.PRICES.gameDay}`), 'page-1 prices do not come from the data files');
const blank = F.renderForm({ offers, table: PRICE_TABLE });
for (const sec of ['porch', 'party', 'grazing', 'event', 'rentals', 'contact', 'id', 'agree']) must(blank.includes(`data-section="${sec}"`), `form has no ${sec} section`);
must(blank.includes(F.ID_NOTE) && F.ID_NOTE === 'Your photo ID is for our safety and security. We never share it, and we delete it after your final payment.', 'the owner ID note is missing or reworded');
must(blank.indexOf(F.ID_NOTE) < blank.indexOf('name="id_photo"'), 'the ID note is not right above the upload');
must(/href="\/rules" target="_blank"/.test(blank) && /href="\/terms-and-conditions" target="_blank"/.test(blank), 'the agreement links do not open the rules and terms in a new tab');
must(/name="website"[^>]*tabindex="-1"/.test(blank) && blank.includes('class="rq-hp" aria-hidden="true"'), 'no hidden honeypot field');
must(/<label for="f-name">/.test(blank) && /<legend>What are you planning\?/.test(blank), 'questions are not labelled (label/legend)');
must(blank.includes('enctype="multipart/form-data"') && blank.includes('action="/request"') && blank.includes('method="post"'), 'the form does not post to /request without JavaScript');
const page = fs.readFileSync(path.join(ROOT, 'request.html'), 'utf8');
const rules = fs.readFileSync(path.join(ROOT, 'rules.html'), 'utf8');
must(page.includes('<!--request-form-->') && page.includes('<!--/request-form-->') && /<meta name="robots" content="index,follow/.test(page) && page.includes('<link rel="canonical" href="https://porchandparty901.com/request"'), 'request.html is not an indexable page with the form block');
must(!/forms\.gle/.test(page) && !/forms\.gle/.test(rules), 'request.html or rules.html links the old Google Form');
// No published page links the retired Google Form any more (the link swap, 18 Oct 2026).
{
  const walk = (d, acc = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git', '.pages-output', 'reports', 'data', 'scripts', 'functions', 'docs', 'templates', 'workers', '.wrangler'].includes(e.name) || e.name.startsWith('.')) continue; const a = path.join(d, e.name); if (e.isDirectory()) walk(a, acc); else if (/\.(html|txt|xml|webmanifest)$/.test(e.name)) acc.push(a); } return acc; };
  const files = walk(ROOT);
  const left = files.filter((f) => /forms\.gle|docs\.google\.com\/forms/.test(fs.readFileSync(f, 'utf8')));
  must(files.length > 100 && !left.length, `published files still link the Google Form: ${left.slice(0, 5).map((f) => path.relative(ROOT, f)).join(', ')}`);
  const rentalsPage = fs.readFileSync(path.join(ROOT, 'rentals/index.html'), 'utf8');
  must((rentalsPage.match(/href="\/request\?service=rentals"[^>]*>Book your games<\/a>/g) || []).length >= 4, 'the rentals page buttons do not read "Book your games" and open the rentals path');
  must(/<a href="\/rules">Rules &amp; Responsibilities<\/a>/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')), 'the footer legal links lack Rules & Responsibilities');
}
for (const id of ['everyone', 'rentals', 'porch', 'party', 'grazing', 'photo-id']) must(rules.includes(`<h2 id="${id}">`), `rules.html lacks the ${id} section`);
must(rules.includes(`data-rules-version="${F.RULES_VERSION}"`) && rules.includes(`Version ${F.RULES_VERSION}`), 'rules.html does not show its version');
must(!/\$\d+(?!\d)/.test(rules.replace(/\$5 each|\$50|\$75|\$40|\$60/g, '')), 'rules.html quotes a fee the Terms do not state');

// ---- A session with the real handlers ----------------------------------------------------
const s = await session();
const env = s.env;
let ipN = 0;
const today = F.chicagoToday();
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const JPEG_EXIF = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
  0xff, 0xe1, 0, 22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x47, 0x50, 0x53, 0x2d, 0x4c, 0x41, 0x54, 0x3d, 0x33, 0x35, 0x2e, 0x31, 0x34, 0x39,
  0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9]);
const handler = (ctx) => RS.handleRequestPage(ctx);
async function send(fields, { file = JPEG_EXIF, type = 'image/jpeg', ip = null, ts = null, cookie = '' } = {}) {
  const fd = new FormData();
  const all = { ts: ts === null ? await RS.signTs(env, Date.now() - 10000) : ts, website: '', agree: 'yes', rules_version: F.RULES_VERSION, ...fields };
  for (const [k, v] of Object.entries(all)) (Array.isArray(v) ? v : [v]).forEach((x) => { if (x !== undefined && x !== null) fd.append(k, x); });
  if (file) fd.append('id_photo', new File([file], 'id.jpg', { type }));
  ipN += 1;
  const request = new Request('https://porchandparty901.com/request', { method: 'POST', body: fd, headers: { 'CF-Connecting-IP': ip || `198.51.100.${ipN}`, ...(cookie ? { Cookie: cookie } : {}) } });
  const res = await handler({ request, env, params: {} });
  return { status: res.status, location: res.headers.get('Location') || '', text: res.status === 303 ? '' : await res.text() };
}
const contact = (n) => ({ name: `Casey Path${n}`, phone: '(901) 555-01' + String(10 + n).slice(-2), email: `path${n}@example.com`, dob: '1990-02-03', heard: 'Google', notes: 'Blue and gold' });
const PATHS = {
  porch: { service: 'porch', porch_season: 'Fall / Halloween', porch_takedown: 'not_sure', event_date: plus(14), location: 'Germantown' },
  party: { service: 'party', party_event: 'Birthday', party_where: 'Hotel room', party_takedown: 'yes', event_date: plus(15), location: 'The Peabody' },
  grazing: { service: 'grazing', grazing_event: 'Graduation', grazing_guests: '15–40', grazing_food: 'Yes, include food in my quote', event_date: plus(16), location: 'Cordova' },
  rentals: { service: 'rentals', games: ['giant-connect-four', 'giant-uno'], duration: 'day', rental_date: plus(9), pickup_when: 'morning', return_when: 'after'},
  multi: { service: 'multi', multi: ['party', 'rentals'], party_event: 'Anniversary', party_where: 'Home', event_date: plus(17), location: 'Bartlett', games: ['cornhole'], duration: 'day', rental_date: plus(17) , pickup_when: 'morning', return_when: 'after'},
};

// ---- 2/3. Every path: ID required, rules required, complete path accepted ---------------
let n = 0;
const made = {};
for (const [p, fields] of Object.entries(PATHS)) {
  n += 1;
  const noId = await send({ ...fields, ...contact(n) }, { file: null });
  must(noId.status === 400 && noId.text.includes('Please add a photo of your government photo ID.'), `${p}: accepted without a photo ID`);
  const noAgree = await send({ ...fields, ...contact(n), agree: '' });
  must(noAgree.status === 400 && noAgree.text.includes('Please tick the box to agree'), `${p}: accepted without the rules checkbox`);
  const ok = await send({ ...fields, ...contact(n) });
  must(ok.status === 303 && /^\/request\/received\?k=[a-f0-9]{32}$/.test(ok.location), `${p}: a complete request was refused (${ok.status}) ${ok.text.slice(ok.text.indexOf('rq-summary'), ok.text.indexOf('rq-summary') + 400)}`);
  const row = await s.one('SELECT * FROM requests WHERE email = ?1', `path${n}@example.com`);
  made[p] = row;
  must(row && row.source === 'site' && row.id_object && row.agreed_at && row.rules_version === F.RULES_VERSION && row.agreed_name === `Casey Path${n}` && row.agreed_ip === `198.51.100.${ipN}`, `${p}: the agreement (time, version, name, IP) or the ID was not stored`);
  const ev = row ? await s.all('SELECT what FROM request_events WHERE request_key = ?1', row.request_key) : [];
  must(ev.some((e) => e.what.includes(`version ${F.RULES_VERSION}`)), `${p}: the agreement is not logged with its version`);
  must(row && JSON.parse(row.services).length >= 1, `${p}: services not stored`);
}
must(made.porch && made.party && made.porch.takedown_plan === 'not_sure' && made.party.takedown_plan === 'scheduled', 'the takedown answer does not map into takedown_plan');
must(made.multi && JSON.stringify(JSON.parse(made.multi.services)) === JSON.stringify(['party', 'rentals']), 'the "more than one" path did not store both services');
const bad = await send({ ...PATHS.porch, ...contact(9), porch_season: '' });
 must(bad.status === 400 && bad.text.includes('rq-summary') && bad.text.includes('value="path9@example.com"') && bad.text.includes('id="err-porch_season"') && bad.text.includes('href="#q-porch_season"'), 'a missing answer does not re-show the form with the answers kept and the error named');
// The entire weekend is Fri-Sun: a Monday-Thursday event date with "The entire weekend" is refused.
const wedOffset = (() => { for (let k = 9; k < 16; k += 1) if (new Date(`${plus(k)}T12:00:00Z`).getUTCDay() === 3) return k; return 9; })();
const weekendNotFriday = await send({ ...PATHS.rentals, ...contact(10), duration: 'weekend', rental_date: plus(wedOffset), pickup_when: 'friday', return_when: 'monday' });
must(weekendNotFriday.status === 400 && weekendNotFriday.text.includes('Pick a Friday, Saturday or Sunday event date'), 'a weekend rental on a Wednesday event was accepted');
const mixed = await send({ ...PATHS.rentals, ...contact(10), duration: 'weekend', rental_date: plus(wedOffset + 3), pickup_when: 'morning', return_when: 'monday' });
must(mixed.status === 400 && mixed.text.includes('Please pick &quot;Thursday&quot; or &quot;Friday&quot;'), 'a one-day pickup choice was accepted on a weekend rental');
const past = await send({ ...PATHS.party, ...contact(11), event_date: plus(-2) });
must(past.status === 400 && past.text.includes('That date has passed'), 'a past event date was accepted');

// ---- 5. EXIF, private ID, delete ------------------------------------------------------
const stored = env.idObjects.get(made.porch.id_object);
must(stored && !Buffer.from(stored.bytes).includes(Buffer.from('Exif')) && !Buffer.from(stored.bytes).includes(Buffer.from('GPS-LAT')), 'the ID photo kept its EXIF (location) data');
must(stored && stored.bytes[0] === 0xff && stored.bytes[1] === 0xd8 && Buffer.from(stored.bytes).includes(Buffer.from([0xff, 0xda])), 'the cleaned ID photo lost its image data');
must(/^ids\/[a-f0-9]{32}\.jpg$/.test(made.porch.id_object), 'the R2 key carries something other than a random id');
const rkPorch = s.rk(made.porch.request_key);
must((await s.get(`/admin/requests/id?r=${rkPorch}`, { auth: false })).status === 303, 'the ID photo is reachable signed out');
const idRes = await s.get(`/admin/requests/id?r=${rkPorch}`);
must(idRes.status === 200 && /image\/jpeg/.test(idRes.headers.get('Content-Type')) && /no-store/.test(idRes.headers.get('Cache-Control')) && idRes.headers.get('X-Robots-Tag'), 'the signed-in ID view is not a private, uncached image');
const pubRoutes = ['functions/request/index.js', 'functions/request/received.js', 'functions/api/request/availability.js', 'functions/r/[code].js'];
must(pubRoutes.every((f) => fs.existsSync(path.join(ROOT, f))), 'a request-form route file is missing');
const libSrc = fs.readdirSync(path.join(ROOT, 'functions/_lib')).filter((f) => f.endsWith('.mjs')).map((f) => [f, fs.readFileSync(path.join(ROOT, 'functions/_lib', f), 'utf8')]);
must(libSrc.filter(([, t]) => /env\.IDS\.get\(/.test(t)).map(([f]) => f).join() === 'admin.mjs', 'something other than the signed-in admin route reads ID photos');
const toml = fs.readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
must(/binding = "IDS"\s*\nbucket_name = "pnp-ids"/.test(toml) && !/pnp-ids[\s\S]{0,200}(custom_domain|public|r2\.dev)\s*=/.test(toml), 'wrangler.toml does not bind the private pnp-ids bucket as IDS');
let dash = await s.get('/admin/');
must(dash.text.includes(`/admin/requests/id?r=${rkPorch}`) && dash.text.includes('Agreed to rules on') && dash.text.includes(`(version ${F.RULES_VERSION})`), 'the card does not show the ID link and "Agreed to rules on ..."');
must(dash.text.includes('data-week-counts') && /This week: \d+ new requests?<\/strong> \(/.test(dash.text), 'the weekly count is missing from Requests');
const del = await s.post('/admin/requests/id/delete', { r: rkPorch });
must(del.status === 303 && /ID%20deleted%20for%20good/.test(del.location), 'Delete this ID did not confirm');
must(!env.idObjects.has(made.porch.id_object), 'Delete this ID left the photo in storage');
const afterDel = await s.one('SELECT id_deleted_at, id_object FROM requests WHERE request_key = ?1', made.porch.request_key);
must(afterDel.id_deleted_at && afterDel.id_object === null, 'Delete this ID did not record the deletion');
must((await s.all('SELECT who, what FROM request_events WHERE request_key = ?1', made.porch.request_key)).some((e) => /deleted for good/.test(e.what) && /signed-in admin/.test(e.who)), 'the ID deletion is not logged with who and when');
must((await s.get(`/admin/requests/id?r=${rkPorch}`)).status === 404, 'a deleted ID can still be opened');
// IDs ready to delete: a paid-in-full decor request appears; a rental appears only once returned.
await s.post('/admin/requests/status', { r: s.rk(made.party.request_key), status: 'paid' });
dash = await s.get('/admin/');
const ready = dash.text.slice(dash.text.indexOf('data-ids-ready'), dash.text.indexOf('</section>', dash.text.indexOf('data-ids-ready')));
must(ready.includes('Casey Path2') && !ready.includes('Casey Path1') && !ready.includes('Casey Path4'), 'IDs ready to delete does not list exactly the paid-in-full requests');
// Nothing deletes an ID by itself: no code path deletes from IDS except the button.
must(libSrc.filter(([, t]) => /IDS\.delete\(/.test(t)).map(([f]) => f).join() === 'admin.mjs' && !fs.readFileSync(path.join(ROOT, 'workers/pnp-mailer/src/index.js'), 'utf8').includes('IDS'), 'an ID can be deleted by something other than the Delete this ID button');

// ---- 4. Holds, availability, draft invoice ----------------------------------------------
const rent = made.rentals;
const hold = await s.one('SELECT * FROM holds WHERE request_key = ?1', rent.request_key);
const holdMs = H.fromSql(hold && hold.until) - H.fromSql(rent.submitted_at);
must(hold && hold.state === 'held' && hold.by_hand === 0 && Math.abs(holdMs - 24 * 3600000) < 5000, `the rental hold is not 24 hours (${hold && hold.until})`);
const bk = await s.all('SELECT kind, date, items FROM bookings WHERE request_key = ?1 ORDER BY kind', rent.request_key);
must(bk.length === 2 && bk[0].kind === 'rental_pickup' && bk[0].date === plus(9) && bk[1].kind === 'rental_return' && bk[1].date === plus(10) && /Giant Connect Four/.test(bk[0].items), 'the hold did not put the pickup and return on the calendar');
const avail = async (pickup, g = '') => (await (await RS.handleAvailability({ request: new Request(`https://porchandparty901.com/api/request/availability?event=${pickup}&pickup_when=morning&return_when=after&duration=day&games=${g}`), env })).json());
let a = await avail(plus(9), 'giant-connect-four,giant-uno');
must(a.ok && a.left['giant-connect-four'] === 0 && a.left['giant-uno'] === 0 && a.left.cornhole === 1 && a.left['giant-color-stack'] === 2, `availability does not grey held games (Cornhole stock 1, Color Stack 2; owner 18 Oct 2026): ${JSON.stringify(a.left)}`);
const q = F.rentalQuote(['giant-connect-four', 'giant-uno'], 'day', PRICE_TABLE, games.holdPercent);
must(q.rental === 2 * games.rates.day * 100 && q.damage === games.damageDeposit * 100 && q.dueNow === q.damage + q.rental / 2 && q.atPickup === q.rental / 2, `rental money is wrong: ${JSON.stringify({ rental: q.rental, damage: q.damage, dueNow: q.dueNow })}`);
must(a.html.includes(F.money(q.total)) && a.html.includes(F.money(q.dueNow)) && a.html.includes('Due now'), 'the live total does not show the exact total and due-now amount');

// ---- The inventory (owner, 18 Oct 2026): Giant Checkers unavailable, both Color Stack sets count --
must(a.left['giant-color-stack'] === 2 && !('giant-checkers' in a.left) && !F.rentalItems(PRICE_TABLE).some((i) => i.slug === 'giant-checkers'), `availability does not count 2 Color Stack sets, or still offers Giant Checkers: ${JSON.stringify(a.left)}`);
must(!/giant-checkers|Giant Checkers/.test(blank), 'the /request form still offers Giant Checkers');

// ---- The projector, on request (owner, 18 Oct 2026) ------------------------------------------
// One checkbox, only beside the movie screen (hidden until it is ticked), saved as an answer that
// shows on the admin card; it never adds the admin-only Projector, a price or an availability count.
{
  const box = /<label class="rq-choice rq-projector( rq-hide)?" data-projector><input type="checkbox" name="projector" value="yes"( checked)?> <span>([^<]*)<\/span><\/label>/g;
  const inBlank = [...blank.matchAll(box)];
  must(F.PROJECTOR_ASK === 'Please include a projector (just ask, one available)' && F.PROJECTOR_ANSWER === 'Asked for a projector' && F.SCREEN_SLUG === 'inflatable-movie-screen', 'the projector wording or the screen slug drifted');
  must(inBlank.length === 1 && inBlank[0][1] === ' rq-hide' && inBlank[0][3] === F.PROJECTOR_ASK, 'the blank form does not carry exactly one hidden projector checkbox with the owner wording');
  const games = blank.split('id="q-games"')[1].split('</fieldset>')[0];
  must(games.includes('name="projector"') && games.indexOf('value="inflatable-movie-screen"') < games.indexOf('name="projector"'), 'the projector checkbox is not with the games, after the movie screen');
  const withScreen = F.renderForm({ offers, table: PRICE_TABLE, values: { games: ['inflatable-movie-screen'], projector: 'yes' } });
  const ws = [...withScreen.matchAll(box)];
  must(ws.length === 1 && ws[0][1] === undefined && ws[0][2] === ' checked', 'with the movie screen ticked the projector checkbox is not shown (or loses its tick)');
  const noScreenTable = { ...PRICE_TABLE, items: PRICE_TABLE.items.filter((i) => i.slug !== 'inflatable-movie-screen') };
  must(!F.renderForm({ offers, table: noScreenTable }).includes('name="projector"'), 'the projector checkbox shows when the movie screen is not offered');
  must(/function proj\(\)\{[^}]*inflatable-movie-screen/.test(blank) && /e\.target\.name==='games'\)proj\(\)/.test(blank), 'the page script does not show the projector checkbox only while the movie screen is ticked');
  must(!/value="projector"/.test(blank) && !/>\s*Projector\s*</.test(blank) && !/projector[^<]{0,40}\$\d/i.test(blank), 'the form offers the Projector as an item or quotes it a price');
  const pq = F.rentalQuote(['inflatable-movie-screen'], 'day', PRICE_TABLE, games_.holdPercent);
  const asked = await send({ service: 'rentals', games: ['inflatable-movie-screen'], projector: 'yes', duration: 'day', rental_date: plus(31), pickup_when: 'morning', return_when: 'after', ...contact(60) });
  must(asked.status === 303, `a movie-screen request asking for the projector was refused (${asked.status})`);
  const ar = await s.one('SELECT * FROM requests WHERE email = ?1', 'path60@example.com');
  const aa = ar ? JSON.parse(ar.answers) : [];
  must(aa.filter((x) => x.label === 'Asked for a projector').length === 1 && aa.some((x) => x.group === 'rentals' && x.label === 'Asked for a projector' && x.value === 'Yes'), `the projector ask is not saved as a rentals answer: ${JSON.stringify(aa)}`);
  const abk = ar ? await s.all('SELECT items FROM bookings WHERE request_key = ?1', ar.request_key) : [];
  must(abk.length === 2 && abk.every((b) => /Inflatable Movie Screen/.test(b.items) && !/projector/i.test(b.items)), `the projector ask added the Projector to the booking: ${JSON.stringify(abk)}`);
  const pa = await avail(plus(31), 'inflatable-movie-screen');
  must(!('projector' in pa.left) && pa.left['inflatable-movie-screen'] === 0, `the projector ask touched public availability: ${JSON.stringify(pa.left)}`);
  must(pq.rental === games_.extras.find((x) => x.slug === 'inflatable-movie-screen').dayPrice * 100 && !pq.lines.some((l) => /projector/i.test(l.description)), 'the projector ask changed the price');
  const card = (await s.get('/admin/')).text;
  must(card.includes('<dt>Asked for a projector</dt><dd>Yes</dd>'), 'the admin request card does not show "Asked for a projector: Yes"');
  // Ticked without the movie screen (no JavaScript): never saved.
  const stray = await send({ service: 'rentals', games: ['giant-uno'], projector: 'yes', duration: 'day', rental_date: plus(33), pickup_when: 'morning', return_when: 'after', ...contact(61) });
  const sr = await s.one('SELECT answers FROM requests WHERE email = ?1', 'path61@example.com');
  must(stray.status === 303 && sr && !/projector/i.test(sr.answers), 'a projector ask without the movie screen was saved');
}
must(!/@|555-01|Casey/.test(JSON.stringify(a)), 'the availability API leaks customer details');
const clash = await send({ ...PATHS.rentals, ...contact(20) });
must(clash.status === 400 && clash.text.includes('already booked for those dates'), 'an overlapping rental of a held game was accepted');
const st = await s.one('SELECT rs.invoice_id, i.status, i.deposit_due_cents, i.pay_plan FROM request_status rs JOIN invoices i ON i.id = rs.invoice_id WHERE rs.request_key = ?1', rent.request_key);
must(st && st.status === 'draft' && st.pay_plan === 'custom' && st.deposit_due_cents === q.dueNow, `no draft invoice with the exact deposit (${JSON.stringify(st)})`);
// "Mark deposit received" turns a hold into a booking that never expires (checked below).
const multiKey = made.multi.request_key;
must(await H.confirmHold(s.db, multiKey), 'confirmHold did not confirm a held rental');
// Expiry at the end time, not before.
must((await H.expireHolds(s.db, H.fromSql(hold.until) - 60000)) === 0, 'a hold expired before its end time');
must((await H.expireHolds(s.db, H.fromSql(hold.until) + 1000)) >= 1, 'a hold did not expire at its end time');
must((await s.one('SELECT state FROM holds WHERE request_key = ?1', rent.request_key)).state === 'expired', 'the expired hold is not marked expired');
must((await s.all('SELECT id FROM bookings WHERE request_key = ?1', rent.request_key)).length === 0, 'an expired hold kept its games on the calendar');
a = await avail(plus(9));
must(a.left['giant-connect-four'] === 1, 'games of an expired hold are not free again');
must((await s.all('SELECT what FROM request_events WHERE request_key = ?1', rent.request_key)).some((e) => /Hold expired/.test(e.what)), '"Hold expired" is not logged');
const rentSt = await s.one('SELECT status FROM request_status WHERE request_key = ?1', rent.request_key);
must(rentSt && rentSt.status === 'new', 'an expired hold did not leave the request New');
// A confirmed hold never expires.
must((await H.expireHolds(s.db, Date.now() + 30 * 86400000)) === 0 && (await s.all('SELECT id FROM bookings WHERE request_key = ?1', multiKey)).length >= 2, 'a confirmed booking expired');
// Settings: automatic expiry off -> held by hand, no end time.
await s.db.prepare("INSERT INTO settings (key, value) VALUES ('hold_auto_expire', '0')").run();
const byHand = await send({ service: 'rentals', games: ['cornhole'], duration: 'day', rental_date: plus(25), pickup_when: 'morning', return_when: 'after', ...contact(21) });
must(byHand.status === 303, 'a rental with automatic expiry off was refused');
const bh = await s.one("SELECT h.* FROM holds h JOIN requests r ON r.request_key = h.request_key WHERE r.email = 'path21@example.com'");
must(bh && bh.by_hand === 1 && bh.until === null && (await H.expireHolds(s.db, Date.now() + 90 * 86400000)) === 0, 'with automatic expiry off a hold still has an end time or expires');
await s.db.prepare("DELETE FROM settings WHERE key = 'hold_auto_expire'").run();

// ---- received page -----------------------------------------------------------------------
const rec = await s.one('SELECT receipt_id FROM requests WHERE request_key = ?1', multiKey);
const recPage = await (await RS.handleReceived({ request: new Request(`https://porchandparty901.com/request/received?k=${rec.receipt_id}`), env })).text();
must(recPage.includes('Thank you, Casey!') && recPage.includes('Due now to confirm') && recPage.includes('How to pay') && recPage.includes('What happens next'), 'the received page lacks the thanks, the total or the next steps');
must(!recPage.includes('path5@example.com') && !recPage.includes('555-01') && /noindex/.test(recPage), 'the received page shows private details or is indexable');

// ---- 6. Referral ---------------------------------------------------------------------
const code = made.party.referral_code;
must(/^[a-hjkmnp-z2-9]{8}$/.test(code) && !/casey|path/i.test(code), 'the referral code is not a short random code');
const r302 = await RS.handleReferral({ params: { code } });
must(r302.status === 302 && r302.headers.get('Location') === '/' && (r302.headers.get('Set-Cookie') || '').startsWith(`pnp_ref=${code};`), '/r/<code> does not set the cookie and go home');
must(!(await RS.handleReferral({ params: { code: 'Robert@x' } })).headers.get('Set-Cookie'), '/r/ accepts any text as a code');
const refd = await send({ ...PATHS.porch, ...contact(30), event_date: plus(30) }, { cookie: `pnp_ref=${code}` });
must(refd.status === 303, 'a referred request was refused');
const refRow = await s.one("SELECT referred_by FROM requests WHERE email = 'path30@example.com'");
must(refRow && refRow.referred_by === code, 'the referral was not attributed');
dash = await s.get('/admin/');
must(dash.text.includes('Referred by</dt><dd>Casey Path2'), 'the card does not say "Referred by <name>"');
const fake = await send({ ...PATHS.porch, ...contact(31), event_date: plus(31) }, { cookie: 'pnp_ref=zzzzzzzz' });
must(fake.status === 303 && (await s.one("SELECT referred_by FROM requests WHERE email = 'path31@example.com'")).referred_by === null, 'an unknown referral code was stored');

// ---- 7. Spam protection ----------------------------------------------------------------
const before = (await s.one('SELECT COUNT(*) AS n FROM requests')).n;
const hp = await send({ ...PATHS.porch, ...contact(40), website: 'http://spam.example' });
must(hp.status === 303 && (await s.one('SELECT COUNT(*) AS n FROM requests')).n === before, 'the honeypot let a bot request in');
const fast = await send({ ...PATHS.porch, ...contact(41) }, { ts: await RS.signTs(env, Date.now()) });
must(fast.status === 400, 'a submission faster than a person was accepted');
const forged = await send({ ...PATHS.porch, ...contact(42) }, { ts: `${Math.floor(Date.now() / 1000) - 60}.forged` });
must(forged.status === 400, 'a forged render time was accepted');
let last = null;
for (let i = 0; i < RS.RATE.perHourNoJs + 1; i += 1) last = await send({ ...PATHS.porch, ...contact(50 + i), event_date: plus(40 + i) }, { ip: '203.0.113.9' });
must(last.status === 429, `the per-IP limit did not stop request ${RS.RATE.perHourNoJs + 1} (got ${last.status})`);
must((await s.one("SELECT robot_check FROM requests WHERE email = 'path50@example.com'")).robot_check === 'no-js', 'a request without Turnstile is not marked "sent without the robot check"');

// ---- 8. Emails and templates -----------------------------------------------------------
const mails = env.sent.filter((m) => /We got your request|Your games are held/.test(m.subject));
must(mails.some((m) => m.to === 'path1@example.com' && /We got your request/.test(m.subject) && /text you a quote/.test(m.text)), 'no confirmation email for a quote request');
const rm = mails.find((m) => m.to === 'path4@example.com');
must(rm && /Your games are held/.test(rm.subject) && rm.text.includes(F.money(q.dueNow)) && rm.text.includes(F.money(q.total)) && /held for you until/.test(rm.text), 'the rental confirmation email lacks the hold end or the exact total');
for (const t of Object.keys(M.TEMPLATES)) {
  const out = M.render(t, { name: 'Jane Doe', services: ['porch', 'rentals'], rentals: { items: 'Giant Uno', pickup: 'Sat 25 Oct', returnDate: 'Sun 26 Oct', holdEnds: 'Fri 24 Oct, 3:00 PM', total: '$90', damage: '$50', dueNow: '$70', atPickup: '$20' }, pay: {} });
  must(!/review|discount|% off/i.test(`${out.subject} ${out.text} ${out.html}`), `template ${t} says review/discount`);
}

// ---- 9. Weekly counts across a Memphis Monday -------------------------------------------
const at = (iso, hhmm) => ({ isTest: false, services: ['porch'], sortTime: Date.parse(`${iso}T${hhmm}:00Z`) });
// 2026-10-19 is a Monday; the stored sortTime is the Memphis wall clock.
const wk = RQ.weekCounts([at('2026-10-18', '23:59'), at('2026-10-19', '00:00'), at('2026-10-25', '23:59'), at('2026-10-26', '00:00'), at('2026-10-12', '00:00'), { ...at('2026-10-20', '10:00'), services: ['party', 'rentals'] }, { ...at('2026-10-21', '10:00'), isTest: true }], '2026-10-22');
must(wk.start === '2026-10-19' && wk.end === '2026-10-25' && wk.thisWeek.length === 3 && wk.lastWeek.length === 2, `week window wrong: ${wk.start}..${wk.end} this=${wk.thisWeek.length} last=${wk.lastWeek.length}`);
must(wk.byService.porch === 2 && wk.byService.party === 1 && wk.byService.rentals === 1, 'week counts by service wrong');
must(RQ.mondayOf('2026-10-19') === '2026-10-19' && RQ.mondayOf('2026-10-25') === '2026-10-19' && RQ.mondayOf('2026-11-01') === '2026-10-26', 'Monday of the week is wrong');
must(RQ.monthCount([at('2026-10-01', '00:00'), at('2026-10-31', '23:59'), at('2026-11-01', '00:00'), at('2026-09-30', '23:59')], '2026-10') === 2, 'month count wrong at the month edges');
must(RQ.wallClockMs('2026-10-19 04:59:00') === Date.parse('2026-10-18T23:59:00Z') && RQ.wallClockMs('2026-10-19 05:00:00') === Date.parse('2026-10-19T00:00:00Z'), 'site requests are not counted on their Memphis day');
const money = await s.get('/admin/money');
must(/Requests this month: \d+/.test(money.text), 'the Money tab lacks "Requests this month"');

// ---- 10. The imported Google Form row reads back as it was --------------------------------
const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/admin/fixture-request.json'), 'utf8')).values;
const viaSheet = S.rowsToRequests(fx);
const viaDb = (await RQ.loadRequests(env)).filter((r) => r.source === 'google_form');
must(viaSheet.length === viaDb.length && viaSheet.every((r) => { const d = viaDb.find((x) => x.key === r.key); return d && ['name', 'email', 'phone', 'dob', 'idFile', 'need', 'gamesAnswer', 'durationAnswer', 'eventType', 'wantsRentals', 'wantsDecor', 'sortTime'].every((k) => JSON.stringify(d[k]) === JSON.stringify(r[k])) && JSON.stringify(d.rentals) === JSON.stringify(r.rentals); }), 'an imported Google Form row does not read back exactly as the sheet row (or its key changed)');
await RQ.seedFixture(s.db);
must((await s.one("SELECT COUNT(*) AS n FROM requests WHERE source = 'google_form'")).n === viaSheet.length, 'the import is not idempotent (a second run duplicated rows)');
const rec2 = RQ.importRowFor(fx[0], fx[1]);
must(rec2.request_key === viaSheet.find((r) => r.email === fx[1][1]).key && JSON.parse(rec2.raw_row).row.join('|') === fx[1].join('|'), 'the import does not keep the raw row and the original key');

// ---- Checklist: the /party/ hazard and the comma-joined answers ----------------------------
{
  const CL = await mod('functions/_lib/checklist.mjs');
  const { CHECKLIST_SOURCE } = await mod('functions/_lib/checklist-source.mjs');
  const fields = CL.fieldIndex(CHECKLIST_SOURCE);
  const id = (re) => (fields.find((f) => f.page === 1 && re.test(f.label)) || {}).id;
  const [party, porch, rental] = [id(/^party \/ event decor/i), id(/^porch decor/i), id(/^game rentals/i)];
  const base = { name: 'X', rentals: [], decor: [], other: [] };
  const v1 = CL.prefillFromRequest(CHECKLIST_SOURCE, { ...base, need: 'Party game rentals (giant yard games, $40 a game a day)', wantsRentals: true, gamesAnswer: 'Giant Uno' });
  must(party && !v1[party] && v1[rental], 'a rentals-only answer ("Party game rentals ...") ticks the party/event decor box');
  const v2 = CL.prefillFromRequest(CHECKLIST_SOURCE, { ...base, need: `Porch decorating (seasonal and holiday porches, from $350), Party planning & decor ${F.PARTY_PARENTHETICAL.replace(')', '; from $300)')}` });
  must(v2[party] && v2[porch], 'a porch + party answer with commas inside the parentheses does not tick both boxes');
  const v3 = CL.prefillFromRequest(CHECKLIST_SOURCE, { ...base, need: 'Porch decorating (seasonal and holiday porches, from $350)' });
  must(v3[porch] && !v3[party], 'a porch-only answer ticks the party box');
  const v4 = CL.prefillFromRequest(CHECKLIST_SOURCE, { ...base, need: 'rentals', services: ['rentals'], wantsRentals: true, gamesAnswer: 'Giant Uno' });
  must(!v4[party] && !v4[porch] && v4[rental], 'a site rentals request ticks a decor box');
  must(JSON.stringify(CL.splitChoices('Party planning & decor (a, b, c), Grazing tables')) === JSON.stringify(['Party planning & decor (a, b, c)', 'Grazing tables']), 'a comma-joined service answer is split inside the parentheses');
}

// ---- Sheet tab -----------------------------------------------------------------------------
const rows = await AM.sheetRows(env);
must(rows.siteRequests.length >= 8 && rows.siteRequests.every((r) => r.length === 16) && rows.siteRequests.every((r) => !String(r.join('|')).includes('ids/')), 'Site requests rows are missing, mis-shaped, or carry the ID storage key');

if (checks < 60) errors.push(`only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: request form (${errors.length} of ${checks} checks)\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`validate_request_form: OK (${checks} checks: page 1 order + prices, 5 paths, ID + rules required on each, agreement logged, EXIF stripped, private ID + delete, IDs ready, 24 h hold + expiry + by hand, availability greying, exact deposit, referral, honeypot/timing/rate limit, emails, no review/discount, week/month counts, import fidelity, sheet tab)`);
