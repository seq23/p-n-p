// Entirely local: made-up prospects, SQLite in memory, fake Email/forward/R2 bindings.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeDb, makeEnv, mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';
const O = await mod('functions/_lib/outreach.mjs');
const I = await mod('functions/_lib/outreach-inbound.mjs');
const worker = (await mod('workers/pnp-mailer/src/index.js')).default;
const token = 'test-only-token-with-at-least-thirty-two-characters';
const now = new Date('2026-10-30T16:00:00Z');
const input = (i = 0, extra = {}) => ({ prospect_id: `fixture-${i}`, to: `hello@fixture${i}.example.com`, subject: `Christmas decor for Fixture ${i}?`, text: 'Hi there,\n\nA plain text fixture.\n\nExample team', ...extra });
function setup() {
  const db = makeDb(); const env = makeEnv(db); env.PNP_OUTREACH_TOKEN = token;
  db.raw.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('outreach_do_not_contact', '[]');
  db.raw.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('outreach_mailing_address', ADDRESS);
  env.RESEND_OUTREACH_KEY = 're_test_only_fixture_key';
  // Sends go to the Resend API (never pnp-mailer): every fetch is captured here, nothing leaves.
  env.MAILER.fetch = async () => { throw new Error('outreach must never go through pnp-mailer'); };
  env.resend = []; env.resendFail = false;
  globalThis.fetch = async (url, init) => {
    if (String(url) !== 'https://api.resend.com/emails') throw new Error(`unexpected fetch ${url}`);
    if (env.resendFail) throw new Error('lost response');
    const body = JSON.parse(init.body); env.resend.push({ init, body }); env.sent.push(body);
    return Response.json({ id: `resend-fixture-${env.sent.length}` });
  };
  return { db, env };
}
const ADDRESS = '100 Fixture Street, Example City, ZZ 00000';
const mid = (env, i) => env.resend[i].body.headers['Message-ID'];
const api = (env, action, { body, auth = `Bearer ${token}`, method = action === 'send' ? 'POST' : 'GET', query = '' } = {}) => O.handleOutreach({ env, request: new Request(`https://example.com/api/outreach/${action}${query}`, { method, headers: { Authorization: auth }, ...(body ? { body: JSON.stringify(body) } : {}) }) }, action, now);
for (const action of ['send','status']) {
  for (const auth of ['', 'Bearer wrong-token', `Basic ${token}`]) assert.equal((await api({}, action, { auth, body: action === 'send' ? input() : null })).status, 401);
  assert.equal((await api({ PNP_OUTREACH_TOKEN: '' }, action)).status, 401);
}
{
  const { env, db } = setup();
  assert.equal((await api(env, 'send', { method: 'GET' })).status, 405);
  assert.equal((await api(env, 'status', { query: '?since=2026-02-30' })).status, 400);
  assert.equal((await api(env, 'status', { query: '?since=not-a-date' })).status, 400);
  const res = await api(env, 'send', { body: input() }); assert.equal(res.status, 200); assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const sent = await res.json();
  assert.deepEqual(sent, { ok: true, message_id: mid(env, 0) }); assert.match(sent.message_id, /^<outreach-[0-9a-f-]{36}@porchandparty901\.com>$/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM outreach_messages').get().n, 1);
  assert.equal(db.raw.prepare('SELECT message_id FROM outreach_messages').get().message_id, sent.message_id);
  // The contract: fixed sender + Reply-To, Resend key, multipart text + html, footer, List-Unsubscribe.
  const { init, body } = env.resend[0];
  assert.equal(init.headers.Authorization, 'Bearer re_test_only_fixture_key'); assert.ok(init.headers['Idempotency-Key']);
  assert.equal(body.from, 'Porch & Party 901 <sequoia@porchandparty901.com>'); assert.equal(body.reply_to, 'sequoia@porchandparty901.com');
  assert.deepEqual(body.to, [input().to]); assert.equal(body.subject, input().subject);
  assert.ok(!('cc' in body) && !('bcc' in body) && !('attachments' in body));
  const FOOT = `Porch & Party 901 · ${ADDRESS} · Don't want these emails? Reply "remove" and we'll stop.`;
  assert.equal(body.text, `${input().text}\n\n${FOOT}`);
  assert.match(body.html, /<p style="margin:0 0 14px">Hi there,<\/p>/); assert.match(body.html, /A plain text fixture\./);
  const footHtml = /<p style="font-size:11px;color:#888;margin-top:24px">([^<]+)<\/p>\n<\/body><\/html>$/.exec(body.html);
  assert.ok(footHtml, body.html); assert.equal(footHtml[1].replace(/&amp;/g,'&').replace(/&#39;|&#x27;/g,"'").replace(/&quot;/g,'"'), FOOT);
  assert.ok(!/<img|<script|https?:\/\/(?!porchandparty901)/i.test(body.html), 'html carries no images, scripts or tracking links');
  assert.equal(body.headers['List-Unsubscribe'], '<mailto:sequoia@porchandparty901.com?subject=remove>');
  assert.equal(body.headers['In-Reply-To'], undefined);
  assert.ok(!fs.readFileSync(`${ROOT}/functions/_lib/outreach.mjs`, 'utf8').includes(ADDRESS));
  assert.equal((await O.sendOutreach(env, input(), now)).ok, false);
  assert.equal((await O.sendOutreach(env, input(1, { to: input().to }), now)).ok, false);
  const status = await (await api(env, 'status', { query: '?since=2026-10-30' })).json();
  assert.deepEqual(Object.keys(status).sort(), ['sent_today','followups_today','suppressed','taken_over','replies','corporate_booked','stopped'].sort());
  assert.equal(status.sent_today, 1); assert.equal(status.stopped, null);
}
for (const extra of [{ to: 'bad' }, { to: 'a@example.com\r\nBcc: other@example.com' }, { subject: 'Hello\nBcc: x' }, { text: '<b>html</b>' }, { html: '<p>x</p>' }, { from: 'fake@example.com' }, { bcc: 'copy@example.com' }, { text: '' }, { prospect_id: '' }, { in_reply_to: '\r\nheader' }]) {
  const { env } = setup(); assert.equal((await O.sendOutreach(env, input(0, extra), now)).ok, false, JSON.stringify(extra)); assert.equal(env.sent.length, 0);
}
for (const val of [null, {}, [], 'bad']) {
  const { env } = setup(); assert.equal((await api(env, 'send', { body: val })).status === 200 ? (await O.sendOutreach(env, val, now)).ok : false, false);
}
{
  const { env } = setup();
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => O.sendOutreach(env, input(i), now)));
  assert.equal(results.filter((r) => r.ok).length, 15); assert.equal(env.sent.length, 15);
  assert.equal((await O.outreachStatus(env.DB, '2026-01-01', now)).sent_today, 15);
  assert.equal((await O.sendOutreach(env, input(90), new Date('2026-10-31T04:59:59Z'))).ok, false);
  assert.equal((await O.sendOutreach(env, input(91), new Date('2026-10-31T05:00:00Z'))).ok, true);
  assert.equal(O.chicagoDay(new Date('2026-11-02T05:59:59Z')), '2026-11-01'); // CST
  assert.equal(O.chicagoDay(new Date('2026-11-02T06:00:00Z')), '2026-11-02');
}
{
  const { env } = setup();
  for (let i = 0; i < 15; i++) assert.equal((await O.sendOutreach(env, input(i), now)).ok, true);
  const later = new Date('2026-11-04T16:00:00Z');
  for (let i = 0; i < 15; i++) {
    const follow = input(i, { in_reply_to: mid(env, i), subject: `Re: ${input(i).subject}` });
    assert.equal((await O.sendOutreach(env, follow, new Date('2026-11-03T16:00:00Z'))).ok, false);
    assert.equal((await O.sendOutreach(env, { ...follow, in_reply_to: 'unknown' }, later)).ok, false);
    assert.equal((await O.sendOutreach(env, follow, later)).ok, true);
    const fu = env.resend[env.resend.length - 1].body;
    assert.equal(fu.headers['In-Reply-To'], follow.in_reply_to); assert.equal(fu.headers.References, follow.in_reply_to);
    assert.match(fu.text, /\n\nPorch & Party 901 · .+ · Don't want these emails\? Reply "remove" and we'll stop\.$/); assert.match(fu.html, /font-size:11px;color:#888;margin-top:24px/);
    assert.equal(fu.headers['List-Unsubscribe'], '<mailto:sequoia@porchandparty901.com?subject=remove>');
    assert.equal((await O.sendOutreach(env, follow, later)).ok, false);
  }
  const status = await O.outreachStatus(env.DB, '2026-01-01', later); assert.equal(status.followups_today, 15); assert.equal(status.sent_today, 0);
  assert.equal((await O.sendOutreach(env, input(90), later)).ok, true); // independent quota
}
for (const [address, kind, target] of [
  ['hello@fixture0.example.com','suppressed',input().to], ['example.com','suppressed','new@sub.example.com'],
  ['old@fixture0.example.com','taken_over','new@fixture0.example.com'], ['old@fixture0.example.com','taken_over','new@sub.fixture0.example.com']]) {
  const { env, db } = setup(); db.raw.prepare('INSERT INTO outreach_blocks VALUES (?,?,?,?)').run(address, O.domainOf(address), kind, now.toISOString());
  assert.equal((await O.sendOutreach(env, input(0, { to: target }), now)).ok, false); assert.equal(env.sent.length, 0);
}
for (const value of ['["example.com"]','["Fixture 0"]','["fixture0.example.com"]','["fixture-0"]','broken','{}','[null]']) {
  const { env, db } = setup(); db.raw.prepare("UPDATE settings SET value = ? WHERE key = 'outreach_do_not_contact'").run(value);
  assert.equal((await O.sendOutreach(env, input(), now)).ok, false, value); assert.equal(env.sent.length, 0);
}
{
  const { env, db } = setup(); db.raw.exec("DELETE FROM settings WHERE key = 'outreach_do_not_contact'"); assert.equal((await O.sendOutreach(env,input(),now)).ok, false);
}
// No mailing address (footer) or no Resend key: refused before anything is reserved or sent.
for (const value of [null, '', '   ']) {
  const { env, db } = setup();
  if (value === null) db.raw.exec("DELETE FROM settings WHERE key = 'outreach_mailing_address'"); else db.raw.prepare("UPDATE settings SET value = ? WHERE key = 'outreach_mailing_address'").run(value);
  const r = await O.sendOutreach(env, input(), now); assert.equal(r.ok, false); assert.match(r.reason, /mailing address/);
  assert.equal(env.sent.length, 0); assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM outreach_messages').get().n, 0);
}
{
  const { env } = setup(); env.RESEND_OUTREACH_KEY = ''; assert.equal((await O.sendOutreach(env, input(), now)).ok, false); assert.equal(env.sent.length, 0);
}
// Resend refuses (4xx) or answers without an id: never reported as sent.
{
  const { env, db } = setup(); globalThis.fetch = async () => Response.json({ message: 'invalid' }, { status: 422 });
  assert.equal((await O.sendOutreach(env, input(), now)).ok, false);
  assert.equal(db.raw.prepare('SELECT state FROM outreach_messages').get().state, 'uncertain');
}
{
  const { env } = setup();
  assert.equal((await O.sendOutreach(env, input(), new Date('2026-12-06T05:59:59Z'))).ok, true);
  assert.equal((await O.sendOutreach(env, input(1), new Date('2026-12-06T06:00:00Z'))).ok, false);
  env.resendFail = true;
  assert.equal((await O.sendOutreach(env, input(2), now)).ok, false);
  assert.equal((await O.sendOutreach(env, input(2), now)).ok, false);
  assert.equal(env.DB.raw.prepare("SELECT state FROM outreach_messages WHERE prospect_id = 'fixture-2'").get().state, 'uncertain');
}
// Count payment truth, not a status flag. Draft invoices with real deposits count too.
{
  const { db, env } = setup();
  for (let n = 0; n < 8; n++) {
    db.raw.prepare('INSERT INTO requests (request_key,source,submitted_at,corporate,is_test,answers) VALUES (?,\'site\',?, ?,?,?)').run(`r${n}`, now.toISOString(), n === 4 ? 0 : 1, n === 5 ? 1 : 0, JSON.stringify([{ label: 'Event date', value: n === 6 ? '2027-12-01' : '2026-12-01' }]));
    db.raw.prepare("INSERT INTO invoices (id,number,request_key,issue_date,due_date,deposit_due_cents,status) VALUES (?,?,?,?,?,5000,'draft')").run(n+1, `FIX-${n}`, `r${n}`, '2026-10-30','2026-11-01');
    db.raw.prepare('INSERT INTO invoice_lines (invoice_id,position,description,qty,unit_cents) VALUES (?,0,\'Fixture\',1,10000)').run(n+1);
    db.raw.prepare('INSERT INTO payments (invoice_id,amount_cents,received_on,voided_at) VALUES (?,?,?,?)').run(n+1, n === 7 ? 4999 : 5000, '2026-10-30', n === 3 ? '2026-10-30' : null);
  }
  assert.equal((await O.outreachStatus(db, undefined, now)).corporate_booked, 3);
  assert.equal((await O.sendOutreach(env,input(),now)).ok,true);
  db.raw.exec('UPDATE payments SET voided_at = NULL WHERE invoice_id = 4');
  assert.equal((await O.outreachStatus(db, undefined, now)).corporate_booked, 4);
  assert.equal((await O.sendOutreach(env,input(1),now)).ok,false);
  db.raw.exec("UPDATE invoices SET status = 'void' WHERE id = 4");
  assert.equal((await O.outreachStatus(db, undefined, now)).corporate_booked, 3);
  db.raw.exec('UPDATE invoices SET deposit_due_cents = 0 WHERE id = 1');
  assert.equal((await O.outreachStatus(db, undefined, now)).corporate_booked, 2);
}
// Inbound tests exercise the actual Worker email() entry point, MIME parser and original forward.
async function incoming(env, text, { headers = {}, from = 'reply@fictional.example.com', subject = 'Re: holiday decor', mime = null, failForward = false } = {}) {
  const raw = mime || `From: ${from}\r\nTo: ${O.OUTREACH_FROM}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n${Object.entries(headers).map(([k,v]) => `${k}: ${v}\r\n`).join('')}\r\n${text}`;
  const forwards = [];
  const message = { from, to: O.OUTREACH_FROM, headers: new Headers({ subject, 'content-type': 'text/plain', ...headers }), raw: new Blob([raw]).stream(), forward: async (...args) => { forwards.push(args); if (failForward) throw new Error('temporary failure'); } };
  await worker.email(message, env);
  return { raw, forwards };
}
function inboundSetup() {
  const s = setup(); const raw = new Map(); s.env.PNP_OUTREACH_OWNER = 'owner@example.net';
  s.env.OUTREACH_RAW = { put: async (k,v) => raw.set(k,new Uint8Array(v)) }; return { ...s, raw };
}
for (const [text, opts, kind] of [
  ['No thanks',{},'opt_out'], ['Not interested.',{},'opt_out'], ['Remove me',{},'opt_out'], ['unsubscribe',{},'opt_out'],
  ['remove',{},'opt_out'], ['Remove.',{},'opt_out'], ['STOP',{},'opt_out'], ['Please stop emailing me',{},'opt_out'], ['',{ subject:'remove' },'opt_out'],
  ['Sounds lovely, what dates are open\n> Don\'t want these emails? Reply "remove" and we\'ll stop.',{},'reply'],
  ['Can you remove the old tree and put up a new one?',{},'reply'], ['Stop by Tuesday and we can talk',{},'reply'], ['',{},'reply'],
  ['Thanks for your email',{ headers: { 'Auto-Submitted':'auto-replied' } },'ooo'], ['Away',{ headers:{ 'X-Autoreply':'yes' } },'ooo'],
  ['Out of office',{},'ooo'], ['I am out of office until Monday.',{},'ooo'], ['I will return soon',{ subject:'Out of office: leave' },'ooo'],
  ['How much would a lobby tree cost?',{},'reply'], ['Yes, interested',{},'reply'], ['Hmm',{},'reply'],
  ['No thanks, but can you quote our other office?',{},'reply'], ['Can you help?\nUnsubscribe',{},'reply'],
  ['Sounds good\n> no thanks',{},'reply'], ['How much?\nOn Friday someone wrote:\nUnsubscribe',{},'reply'],
  ['I am not out of office. Could you send a quote?',{},'reply'], ['Can you help?',{headers:{'Auto-Submitted':'auto-replied'}},'reply'], ['Please send me a quote',{headers:{'Auto-Submitted':'auto-replied'}},'reply'],
]) {
  const { env, db, raw } = inboundSetup(); const result = await incoming(env,text,opts);
  const row = db.raw.prepare('SELECT * FROM outreach_inbound').get(); assert.equal(row.kind,kind,text);
  assert.equal(raw.size,1); assert.equal(new TextDecoder().decode([...raw.values()][0]),result.raw);
  assert.deepEqual(result.forwards, kind === 'reply' ? [[env.PNP_OUTREACH_OWNER]] : [], text);
  const block = db.raw.prepare('SELECT * FROM outreach_blocks').get();
  assert.equal(block?.kind, kind === 'reply' ? 'taken_over' : kind === 'opt_out' ? 'suppressed' : undefined);
  if (kind === 'reply') assert.ok(row.forwarded_at); else assert.equal(row.forwarded_at,null);
}
{
  const { env,db } = inboundSetup(); await O.sendOutreach(env,input(),now);
  await incoming(env, 'Final-Recipient: rfc822; hello@fixture0.example.com\r\nAction: failed\r\nStatus: 5.1.1', { from:'mailer-daemon@example.net', headers:{'content-type':'multipart/report; report-type=delivery-status'} });
  assert.equal(db.raw.prepare('SELECT kind FROM outreach_inbound').get().kind,'bounce');
  assert.equal(db.raw.prepare('SELECT address FROM outreach_blocks').get().address,input().to);
  const status = await O.outreachStatus(db,'2026-10-30',new Date()); assert.deepEqual(status.suppressed,[input().to]); assert.equal(status.replies.length,1);
  assert.equal((await O.outreachStatus(db,'2027-01-01',now)).replies.length,0);
}
{
  const { env,db } = inboundSetup();
  const r = await incoming(env,'Final-Recipient: rfc822; stranger@example.com',{ headers:{'content-type':'multipart/report; report-type=delivery-status'} });
  assert.equal(r.forwards.length,1); assert.equal(db.raw.prepare('SELECT kind FROM outreach_inbound').get().kind,'reply');
}
{
  const { env,db } = inboundSetup();
  await incoming(env,'', { mime:'From: reply@fictional.example.com\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\nTm8gdGhhbmtz' });
  assert.equal(db.raw.prepare('SELECT kind FROM outreach_inbound').get().kind,'opt_out');
}
{
  const { env,db } = inboundSetup();
  await assert.rejects(incoming(env,'What is your price?',{failForward:true}));
  assert.equal(db.raw.prepare('SELECT kind FROM outreach_blocks').get().kind,'taken_over');
  assert.equal(db.raw.prepare('SELECT forwarded_at FROM outreach_inbound').get().forwarded_at,null);
  assert.equal((await O.sendOutreach(env,input(1,{to:'another@fictional.example.com'}),now)).ok,false);
}
{
  const { env } = inboundSetup(); let forwarded = 0; env.OUTREACH_RAW.put = async () => { throw new Error('archive unavailable'); };
  await assert.rejects(worker.email({from:'x@example.com',to:O.OUTREACH_FROM,raw:new Blob(['hello']).stream(),forward:async () => {forwarded++;}},env)); assert.equal(forwarded,1);
}
// Owner forward address missing (Worker secret): rejected back to the sender, never filed.
{
  const { env, db } = inboundSetup(); delete env.PNP_OUTREACH_OWNER; let rejected = '';
  await assert.rejects(worker.email({ from:'x@example.com', to:O.OUTREACH_FROM, headers:new Headers(), raw:new Blob(['hi']).stream(), forward:async () => {}, setReject:(r) => { rejected = r; } }, env));
  assert.ok(rejected); assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM outreach_inbound').get().n, 0);
}
// pnp-mailer never sends outreach and never allows the sequoia@ sender (contract: Resend only).
{
  const toml = fs.readFileSync(`${ROOT}/workers/pnp-mailer/wrangler.toml`,'utf8'); const src = fs.readFileSync(`${ROOT}/workers/pnp-mailer/src/index.js`,'utf8');
  assert.ok(!toml.includes('sequoia@') && !/['"]\/outreach['"]|PNP_OUTREACH_FROM|EMAIL\.send\([^)]*sequoia/.test(src), 'pnp-mailer must not send outreach');
  assert.match(toml, /binding = "OUTREACH_RAW"/);
  assert.match(fs.readFileSync(`${ROOT}/package.json`,'utf8'), /"mailer:deploy": "cd workers\/pnp-mailer && npx wrangler@[0-9.]+ deploy"/);
}
// Actual form POST -> corporate storage -> admin card -> owner feed. Home stays untagged.
{
  const s = await session(); const F = await mod('functions/_lib/request-form.mjs');
  const offers = JSON.parse(fs.readFileSync(`${ROOT}/data/offers/services.json`));
  const html = F.renderForm({offers,table:s.PRICE_TABLE,values:{audience:'corporate'}});
  assert.match(html,/<legend>Who is this for\?<\/legend>/);assert.match(html,/value="corporate" checked/);assert.match(html,/>Home</);assert.match(html,/>Business or lobby</);
  const day = new Date(Date.now()+10*86400000).toISOString().slice(0,10);
  const fields = {name:'Avery Example',email:'avery@example.com',phone:'202-555-0100',service:'party',party_event:'Birthday',party_where:'Home',party_takedown:'not_sure',event_date:day,location:'Fictional office',audience:'corporate'};
  const made = await s.siteRequest(fields); assert.equal(made.status,303,made.text);assert.equal(made.row.corporate,1);
  const R = await mod('functions/_lib/requests.mjs'); assert.equal(R.fromRow(made.row).corporate,true);
  const page = await s.get('/admin/');assert.match(page.text,/data-corporate>Business \/ lobby<\/p>/);
  const { buildOwnerFeed } = await mod('functions/_lib/owner-feed.mjs');
  const feed = await buildOwnerFeed(s.env,'day');assert.ok(feed.items.some((it) => it.detail.includes('Business / lobby')));
  const home = await s.siteRequest({...fields,email:'home@example.com',audience:'home'});assert.equal(home.status,303,home.text);assert.equal(home.row.corporate,0);
  assert.equal(F.validateSubmission({...fields,audience:'invalid'},{offers,table:s.PRICE_TABLE,today:day}).errors.audience,'Please pick Home or Business or lobby.');
}
// Signatures change, body text/logo stay. Stored sent invoices are never updated.
{
  const M = await mod('functions/_lib/messages.mjs'); const E = await mod('functions/_lib/email.mjs'); const Q = await mod('functions/_lib/quick-texts.mjs'); const T = await mod('functions/_lib/card-told.mjs');
  const msg = M.render('requestReceived',{name:'Avery Example',services:['party'],rentals:null,pay:{}});
  assert.match(msg.text,/— Valerie, Porch & Party 901$/);assert.match(msg.html,/Porch &amp; Party 901, Memphis/);assert.match(msg.html,/>Porch &amp; Party<\/td>/);
  assert.equal(Q.SIGN_OFF,'— Valerie at Porch & Party 901');assert.equal(T.QUESTIONS_SIGN_OFF,'— Valerie, Porch & Party 901');
  const invoice = {id:1,number:'FIXTURE',customer_name:'Avery Example',issue_date:'2026-10-30',due_date:'2026-11-01',deposit_due_cents:5000};
  const rendered = E.renderInvoiceEmail({invoice,lines:[{description:'Fixture',qty:1,unit_cents:10000}],settings:{business_name:'Porch & Party'},contact:{}});
  assert.match(rendered.text,/Porch & Party 901 - Memphis/);assert.match(rendered.html,/Porch &amp; Party 901 &middot;/);assert.match(rendered.html,/Thank you for booking with Porch &amp; Party\./);
  const {db} = setup();db.raw.prepare("INSERT INTO invoices (number,issue_date,due_date) VALUES ('SENT','2026-10-30','2026-11-01')").run();
  db.raw.prepare("INSERT INTO invoice_sent_copies (invoice_id,sent_at,to_email,subject,r2_prefix) VALUES (1,'2026-10-30','fixture@example.com','Fixture','sent-invoices/1/old')").run();
  const before = db.raw.prepare('SELECT * FROM invoice_sent_copies').get();
  await O.outreachStatus(db,undefined,now); assert.deepEqual(db.raw.prepare('SELECT * FROM invoice_sent_copies').get(),before);
}
console.log('validate_corporate_outreach: OK (auth, atomic quotas, campaign and payment gates, suppression and takeover, do-not-contact, one threaded follow-up, MIME classes, original forwarding, form storage, owner labels, signatures, Resend-only delivery with footer and List-Unsubscribe)');
