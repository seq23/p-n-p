#!/usr/bin/env node
/**
 * Valerie's copies of customer emails, and her "New request" email (owner, 19 Oct 2026).
 * Drives the real handlers over a fresh local database with a fake mailer (never production).
 * Fails when:
 *  1. the copy policy (util.mjs ownerCopy) gives a Bcc to anything but invoices and receipts, or
 *     any file in functions/_lib or the mailer writes its own "bcc:" instead of asking it;
 *  2. a real invoice send has no Bcc to hello@, or a test invoice send has one;
 *  3. any customer template sent through sendMessage (thank-you, request confirmation,
 *     confirmation, hold reminder, pickup time, reminder, payment reminder) carries a Bcc, or the
 *     cron's day-before reminders do;
 *  4. a website request does not email Valerie's day-list address exactly once with the subject
 *     "New request: <First L.> · <services> · <date>", every answer from the form (every
 *     question of every path answered), escaped, "ID photo uploaded", no attachment, and the
 *     button to the card; or the card is not logged "New-request email sent to Valerie";
 *  5. a second call sends it again, a phone-call request sends it, a mailer failure blocks the
 *     submission or is not logged, or something other than request-submit.mjs sends it.
 * Rule 0: fewer than 40 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mod, ROOT } from './lib/admin_harness.mjs';
import { session } from './lib/admin_scenario.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const HELLO = 'hello@porchandparty901.com';

const U = await mod('functions/_lib/util.mjs');
const M = await mod('functions/_lib/messages.mjs');
const R = await mod('functions/_lib/reminders.mjs');
const F = await mod('functions/_lib/request-form.mjs');
const O = await mod('functions/_lib/owner-new-request.mjs');
const { PRICE_TABLE } = await mod('functions/_lib/prices.mjs');
const offers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8'));

// ---- 1. The policy, and nobody writes their own bcc ---------------------------------------
must(JSON.stringify([...U.OWNER_COPY_KINDS].sort()) === '["invoice","receipt"]', `owner copies go to ${U.OWNER_COPY_KINDS.join(', ')}, not exactly invoices and receipts`);
must(U.ownerCopy('invoice').bcc === HELLO && U.ownerCopy('receipt').bcc === HELLO, 'invoices or receipts lost the copy to hello@');
const templates = Object.keys(M.TEMPLATES);
must(templates.length >= 7, `only ${templates.length} customer templates found`);
for (const t of [...templates, 'reminder', 'thankyou', 'holdEnding', 'requestReceived']) must(!('bcc' in U.ownerCopy(t)), `the ${t} email would copy Valerie`);
const libDir = path.join(ROOT, 'functions/_lib');
const sources = [...fs.readdirSync(libDir).filter((f) => f.endsWith('.mjs')).map((f) => [`functions/_lib/${f}`, fs.readFileSync(path.join(libDir, f), 'utf8')])];
const ownBcc = sources.filter(([f, t]) => f !== 'functions/_lib/util.mjs' && /\bbcc\s*:/.test(t)).map(([f]) => f);
must(!ownBcc.length, `these files set a Bcc themselves instead of asking ownerCopy(): ${ownBcc.join(', ')}`);
const mailerSrc = fs.readFileSync(path.join(ROOT, 'workers/pnp-mailer/src/index.js'), 'utf8');
must(!/bcc\s*:\s*['"`]|bcc\s*:\s*from\b|bcc\s*:\s*FROM/.test(mailerSrc), 'the mailer Worker adds its own Bcc');
must(/ownerCopy\('invoice'\)/.test(fs.readFileSync(path.join(libDir, 'admin.mjs'), 'utf8')), 'the invoice send does not ask ownerCopy(\'invoice\')');

// ---- 2/3. Real sends --------------------------------------------------------------------
const s = await session();
const env = s.env;
const sentSince = (n) => env.sent.slice(n);
// Invoices.
{
  const req = s.requests[0];
  const before = env.sent.length;
  const inv = await s.invoiceFor(req, { go: 'send' });
  const mails = sentSince(before);
  must(inv.id > 0 && mails.length === 1 && mails[0].bcc === HELLO && mails[0].to === req.email, `a real invoice send does not copy hello@: ${JSON.stringify(mails.map((m) => ({ to: m.to, bcc: m.bcc })))}`);
  const b2 = env.sent.length;
  await s.post(`/admin/invoices/${inv.id}/send`, { test: '1' });
  const test = sentSince(b2);
  must(test.length === 1 && test[0].to === HELLO && !('bcc' in test[0]) && /^TEST /.test(test[0].subject), 'a test invoice send is not a lone TEST copy to hello@');
}
// Every customer template through the one seam.
const ctx = { name: 'Casey Copy', email: 'casey.copy@example.com', phone: '9015550199', services: ['rentals'], service: 'rentals', items: 'Giant Uno', day: 'Sat 24 Oct', holdEnds: 'Fri 23 Oct, 3:00 PM', dueNow: '$70', amount: '$40', number: 'PNP-2026-0001', rest: '$20', referralUrl: 'porchandparty901.com/r/abcdefgh',
  rentals: { items: 'Giant Uno', pickup: 'Sat 24 Oct', returnDate: 'Sun 25 Oct', holdEnds: 'Fri 23 Oct', total: '$90', damage: '$50', dueNow: '$70', atPickup: '$20' }, pay: { zelle: 'z', cashapp: 'c' } };
const fetchImg = async () => new Response(new Uint8Array([1, 2, 3]));
for (const t of templates) {
  const before = env.sent.length;
  const out = await M.sendMessage({ ...env, FETCH: fetchImg }, 'email', t, ctx);
  const mails = sentSince(before);
  must(out.ok && mails.length === 1, `${t}: did not send`);
  must(mails.length === 1 && !('bcc' in mails[0]) && !('cc' in mails[0]) && mails[0].to === ctx.email, `${t}: the customer email copies Valerie (${JSON.stringify(mails[0] && { to: mails[0].to, bcc: mails[0].bcc })})`);
}
// The cron's day-before reminders (they send through their own function).
{
  const tomorrow = (() => { const d = new Date(`${R.chicagoDate()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
  await s.db.prepare("INSERT INTO bookings (kind, date, customer_name, email, phone, items) VALUES ('rental_pickup', ?1, 'Rem Inder', 'rem@example.com', '9015550123', 'Giant Uno')").bind(tomorrow).run();
  const got = [];
  const r = await R.sendEmailReminders(s.db, async (m) => { got.push(m); return true; });
  must(r.sent >= 1 && got.length >= 1 && got.every((m) => !('bcc' in m) && m.to !== HELLO), `day-before reminders copy Valerie: ${JSON.stringify(got.map((m) => m.bcc || null))}`);
}

// ---- 4. The "New request" email -----------------------------------------------------------
await s.db.prepare("INSERT INTO settings (key, value) VALUES ('day_list_email', 'valerie.day@example.com') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
const today = F.chicagoToday();
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Answer EVERY question of every path (all four services at once), from the form's own list.
const Q = F.questions(offers, PRICE_TABLE);
const fields = { service: 'multi', multi: ['porch', 'party', 'grazing', 'rentals'] };
let textN = 0;
for (const sec of ['porch', 'party', 'grazing', 'rentals', 'event', 'contact']) {
  for (const q of Q[sec]) {
    if (q.type === 'games') fields.games = ['giant-uno', 'cornhole'];
    else if (q.type === 'radio') { const c = q.choices[q.choices.length > 1 ? 1 : 0]; fields[q.name] = Array.isArray(c) ? c[0] : c; }
    else if (q.type === 'checks') fields[q.name] = q.choices.slice(0, 2);
    else if (q.type === 'check') fields[q.name] = 'yes';
    else if (q.type === 'date') fields[q.name] = q.name === 'dob' ? '1985-04-12' : plus(20);
    else { textN += 1; fields[q.name] = `Answer ${textN} <b>&amp; "quoted"</b>`; }
  }
}
Object.assign(fields, { duration: 'day', name: 'Casey <Every> Answer', phone: '(901) 555-0142', email: 'every.answer@example.com', social: '@casey.every' });
const sub = await s.siteRequest(fields);
must(sub.status === 303 && sub.row, `the full request was refused (${sub.status}): ${sub.text.slice(sub.text.indexOf('rq-summary'), sub.text.indexOf('rq-summary') + 300)}`);
const row = sub.row || {};
const answers = JSON.parse(row.answers || '[]');
const asked = Object.values(Q).flat().filter((q) => q.group).length;
must(answers.length >= asked, `only ${answers.length} of ${asked} grouped answers were stored, so the test does not cover every field`);
const toVal = env.sent.filter((m) => m.to === 'valerie.day@example.com' && /^New request: /.test(m.subject));
must(toVal.length === 1, `expected one New-request email to the day-list address, got ${toVal.length}`);
const mail = toVal[0] || { subject: '', html: '', text: '' };
const svc = 'Porch decorating + Party planning & decor + Grazing tables + Party game rentals';
must(mail.subject === `New request: Casey A. · ${svc} · ${O.plainDate(plus(20))}`, `subject is "${mail.subject}"`);
const escAll = (v) => U.esc(O.plainDate(v));
for (const a of answers) {
  must(mail.html.includes(U.esc(a.label)) && mail.html.includes(escAll(a.value)), `the email lacks the answer "${a.label}": ${a.value}`);
  must(mail.text.includes(`${a.label}: ${O.plainDate(a.value)}`), `the plain-text email lacks "${a.label}"`);
}
for (const [label, v] of [['Name', row.name], ['Mobile', row.phone], ['Email', row.email], ['Date of birth', O.plainDate(row.dob)], ['Social media link', row.social], ['How they heard about us', row.heard]]) {
  must(v && mail.html.includes(U.esc(label)) && mail.html.includes(U.esc(v)) && mail.text.includes(`${label}: ${v}`), `the email lacks the contact answer "${label}"`);
}
must(!mail.html.includes('<b>&amp;') && !mail.html.includes('Casey <Every>') && mail.html.includes('Casey &lt;Every&gt; Answer'), 'form answers are not escaped in the email');
must(/ID photo uploaded/.test(mail.html) && /ID photo uploaded/.test(mail.text) && !(mail.attachments && mail.attachments.length), 'the email does not say "ID photo uploaded", or attaches something');
const href = `https://porchandparty901.com/admin/#c-${s.rk(row.request_key)}`;
must(mail.html.includes(`href="${U.esc(href)}"`) && /data-open-card>Open this request</.test(mail.html) && /padding:16px 26px/.test(mail.html), 'no big "Open this request" button to the card');
must(!('bcc' in mail) && mail.replyTo === row.email, 'the owner email carries a Bcc, or Reply does not go to the customer');
const evs = await s.all('SELECT what, who FROM request_events WHERE request_key = ?1', row.request_key);
must(evs.filter((e) => e.what === O.SENT_EVENT).length === 1, 'the card is not logged "New-request email sent to Valerie" exactly once');
must(Boolean((await s.one('SELECT owner_emailed_at FROM requests WHERE request_key = ?1', row.request_key)).owner_emailed_at), 'owner_emailed_at not recorded');
// The confirmation to the customer still goes, with no copy.
must(env.sent.some((m) => m.to === row.email && !('bcc' in m)), 'the customer confirmation did not go, or copies Valerie');

// ---- 5. Once, never for phone, failure logged, single sender ------------------------------
{
  const before = env.sent.length;
  const again = await O.sendNewRequestEmail(env, row.request_key, { log: (w) => s.db.prepare("INSERT INTO request_events (request_key, who, what) VALUES (?1, 'x', ?2)").bind(row.request_key, w).run() });
  must(again.skipped && env.sent.length === before, 'a second call sent the New-request email again');
  await s.db.prepare("INSERT INTO requests (request_key, source, submitted_at, services, name, email, phone, answers) VALUES ('phone|x|1', 'phone', datetime('now'), '[\"rentals\"]', 'Phone Caller', 'phone@example.com', '9015550100', '[]')").run();
  const ph = await O.sendNewRequestEmail(env, 'phone|x|1');
  must(ph.skipped && env.sent.length === before, 'a phone-call request sent the New-request email');
}
{
  const realFetch = env.MAILER.fetch;
  env.MAILER.fetch = async (u, init) => { const b = JSON.parse(init.body); if (/^New request: /.test(b.subject)) return Response.json({ ok: false, error: 'mailer down' }, { status: 502 }); return realFetch(u, init); };
  const f = await s.siteRequest({ service: 'party', party_event: 'Birthday', party_where: 'Home', event_date: plus(21), location: 'Bartlett', name: 'Fail Safe', phone: '(901) 555-0177', email: 'fail.safe@example.com' });
  env.MAILER.fetch = realFetch;
  must(f.status === 303 && f.row, 'a mailer failure blocked the submission');
  const fe = f.row ? await s.all('SELECT what FROM request_events WHERE request_key = ?1', f.row.request_key) : [];
  must(fe.some((e) => /^New-request email to Valerie did not go out \(mailer down\)/.test(e.what)) && !fe.some((e) => e.what === O.SENT_EVENT), 'the failed New-request email is not logged on the card');
  must(f.row && !(await s.one('SELECT owner_emailed_at FROM requests WHERE request_key = ?1', f.row.request_key)).owner_emailed_at, 'a failed send kept its claim, so it can never be retried');
}
const callers = sources.filter(([, t]) => /sendNewRequestEmail\(/.test(t)).map(([f]) => f).sort();
must(JSON.stringify(callers) === JSON.stringify(['functions/_lib/owner-new-request.mjs', 'functions/_lib/request-submit.mjs']), `the New-request email is sent from ${callers.join(', ')}`);
must(fs.existsSync(path.join(ROOT, 'migrations/0014_owner_new_request_email.sql')) && /ADD COLUMN owner_emailed_at/.test(fs.readFileSync(path.join(ROOT, 'migrations/0014_owner_new_request_email.sql'), 'utf8')), 'migration 0014 is missing');

if (checks < 40) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`owner email: FAIL (${errors.length} of ${checks})\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`owner email: OK (${checks} checks)`);
