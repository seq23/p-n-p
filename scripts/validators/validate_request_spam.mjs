#!/usr/bin/env node
/**
 * The request form cannot be used by strangers to send Porch & Party email or hold games, and a
 * real customer is never turned away (owner, 23 Nov 2026: "anyone can trigger them and use up your
 * quota"). Drives the real public form handler over a fresh local database (never production),
 * with a fake Cloudflare siteverify that only passes tokens it issued, once. Fails when:
 *  1. a forged robot-check token stores, emails, holds or drafts anything;
 *  2. a missing token, Cloudflare down / timing out / internal error, an expired token, or our own
 *     secret refused gets the confirmation email or a hold (it must be KEPT for Valerie, flagged,
 *     with her notice and the draft invoice, and the received page must not claim an email or hold);
 *  3. a real token does not get the whole flow (both emails, the draft invoice, the hold, bookings);
 *  4. the 4th request from one IP in an hour, the 4th for one email in 24 hours, or a request past
 *     the 20-a-day site cap gets the confirmation email or a hold; a flood of held-back requests
 *     uses up real customers' confirmations; past 20 an hour from one IP anything is stored;
 *  5. with no keys set the form refuses anyone (it must run the full flow on the limits alone);
 *  6. a name with a link, tag or address in it reaches the confirmation email.
 */
import { session } from './lib/admin_scenario.mjs';
import { mod } from './lib/admin_harness.mjs';

let checks = 0;
const fails = [];
const must = (ok, msg) => { checks += 1; if (!ok) fails.push(msg); };

const F = await mod('functions/_lib/request-form.mjs');
const M = await mod('functions/_lib/messages.mjs');
const today = F.chicagoToday();
const plus = (n) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
const VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SECRET = 'test-turnstile-secret';

// A fake Cloudflare siteverify: passes only tokens it issued, each once, for our secret.
function fakeSiteverify() {
  const issued = new Set();
  const used = new Set();
  const state = { mode: 'up', calls: 0 };
  state.issue = () => { const t = `tok-${Math.random().toString(36).slice(2)}${Date.now()}`; issued.add(t); return t; };
  state.fetch = async (url, init) => {
    if (String(url) !== VERIFY) throw new Error(`unexpected fetch ${url}`);
    state.calls += 1;
    if (state.mode === 'down') return new Response('bad gateway', { status: 502 });
    if (state.mode === 'throw') throw new TypeError('network connection lost');
    // Never answers. Node's AbortSignal.timeout timer does not keep the process alive, so a ref'd
    // backstop does (and fails the case if the form never aborts: it answers success after 15 s).
    if (state.mode === 'hang') return new Promise((resolve, reject) => {
      const backstop = setTimeout(() => resolve(Response.json({ success: true })), 15000);
      init.signal.addEventListener('abort', () => { clearTimeout(backstop); reject(init.signal.reason); });
    });
    if (state.mode === 'internal') return Response.json({ success: false, 'error-codes': ['internal-error'] });
    const body = new URLSearchParams(init.body);
    if (body.get('secret') !== SECRET) return Response.json({ success: false, 'error-codes': ['invalid-input-secret'] });
    const token = body.get('response');
    if (issued.has(token)) { issued.delete(token); used.add(token); return Response.json({ success: true, hostname: 'porchandparty901.com' }); }
    if (used.has(token)) return Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    return Response.json({ success: false, 'error-codes': ['invalid-input-response'] });
  };
  return state;
}

async function world({ keys = true } = {}) {
  const s = await session();
  const cf = fakeSiteverify();
  s.env.FETCH = cf.fetch;
  if (keys) { s.env.TURNSTILE_SITEKEY = 'test-sitekey'; s.env.TURNSTILE_SECRET = SECRET; }
  let ipN = 0;
  let n = 0;
  async function send(fields, { token = undefined, ip = null } = {}) {
    n += 1;
    const fd = new FormData();
    const all = { ts: await s.RS.signTs(s.env, Date.now() - 10000), website: '', agree: 'yes', rules_version: F.RULES_VERSION, ...fields };
    if (token !== undefined) all['cf-turnstile-response'] = token;
    for (const [k, v] of Object.entries(all)) (Array.isArray(v) ? v : [v]).forEach((x) => fd.append(k, x));
    fd.append('id_photo', new File([JPEG], 'id.jpg', { type: 'image/jpeg' }));
    ipN += 1;
    const request = new Request('https://porchandparty901.com/request', { method: 'POST', body: fd, headers: { 'CF-Connecting-IP': ip || `198.51.100.${ipN}` } });
    const res = await s.RS.handleRequestPage({ request, env: s.env, params: {} });
    return { status: res.status, location: res.headers.get('Location') || '', text: res.status === 303 ? '' : await res.text() };
  }
  // Everything one request led to, by the email typed on the form.
  async function state(email) {
    const row = await s.one('SELECT * FROM requests WHERE email = ?1', email);
    const key = row ? row.request_key : '';
    const count = async (sql) => (await s.one(sql, key)).n;
    return {
      row,
      heldBack: row ? Boolean(await s.one('SELECT 1 AS y FROM request_events WHERE request_key = ?1 AND substr(what, 1, length(?2)) = ?2', key, s.RS.HELD_BACK)) : false,
      holds: await count('SELECT COUNT(*) AS n FROM holds WHERE request_key = ?1'),
      bookings: await count('SELECT COUNT(*) AS n FROM bookings WHERE request_key = ?1'),
      drafts: await count('SELECT COUNT(*) AS n FROM invoices WHERE request_key = ?1'),
      customerMail: s.env.sent.filter((m) => m.to === email).length,
      ownerMail: row ? s.env.sent.filter((m) => /^New request: /.test(m.subject) && m.to !== email && m.text.includes(email)).length : 0,
    };
  }
  async function received(location) {
    const res = await s.RS.handleReceived({ request: new Request(new URL(location, 'https://porchandparty901.com')), env: s.env });
    return res.text();
  }
  return { s, cf, send, state, received, n: () => n };
}

const rental = (n, extra = {}) => ({ service: 'rentals', games: ['giant-connect-four'], duration: 'day', rental_date: plus(9 + 3 * (n % 20)), pickup_when: 'morning', return_when: 'after',
  name: `Robin Spam${n}`, phone: `(901) 555-0${String(100 + n).slice(-3)}`, email: `spam${n}@example.com`, dob: '1990-02-03', heard: 'Google', ...extra });
const porch = (n, extra = {}) => ({ service: 'porch', porch_season: 'Fall / Halloween', porch_decor: 'not_sure', porch_address: '88 Elm St, Germantown, TN 38138', porch_size: 'A wide or wraparound porch',
  porch_steps: '4 or more', porch_features: ['Columns or railings'], porch_takedown: 'not_sure', event_date: plus(14), location: 'Germantown',
  name: `Robin Porch${n}`, phone: `(901) 555-1${String(100 + n).slice(-3)}`, email: `porch${n}@example.com`, dob: '1990-02-03', heard: 'Google', ...extra });

// ---- 1-3. The robot check, keys set --------------------------------------------------------
{
  const w = await world();
  // The page shows the widget once keys exist.
  const page = await w.s.RS.handleRequestPage({ request: new Request('https://porchandparty901.com/request'), env: w.s.env, params: {} });
  must(/class="cf-turnstile" data-sitekey="test-sitekey"/.test(await page.text()), 'the form page has no robot-check widget although the keys are set');

  // Happy path: a real token gets the whole flow.
  const ok = await w.send(rental(1), { token: w.cf.issue() });
  const okS = await w.state('spam1@example.com');
  must(ok.status === 303 && okS.row && okS.row.robot_check === 'turnstile', `a verified request was not stored as checked (status ${ok.status})`);
  must(okS.holds === 1 && okS.bookings === 2 && okS.drafts === 1 && !okS.heldBack, `a verified rental lacks its hold, bookings or draft (holds ${okS.holds}, bookings ${okS.bookings}, drafts ${okS.drafts}, held back ${okS.heldBack})`);
  must(okS.customerMail === 1 && okS.ownerMail === 1, `a verified request did not send both emails (customer ${okS.customerMail}, owner ${okS.ownerMail})`);
  const okPage = await w.received(ok.location);
  must(/We sent a copy to your email/.test(okPage) && /Your games are held until/.test(okPage), 'the received page for a verified rental does not say the email went and the games are held');

  // A forged token: refused, and nothing at all happens.
  const before = { req: (await w.s.one('SELECT COUNT(*) AS n FROM requests')).n, mail: w.s.env.sent.length, holds: (await w.s.one('SELECT COUNT(*) AS n FROM holds')).n, inv: (await w.s.one('SELECT COUNT(*) AS n FROM invoices')).n, att: (await w.s.one('SELECT COUNT(*) AS n FROM form_attempts')).n };
  for (const [i, token] of [[2, 'forged-token'], [3, 'x'.repeat(2049)]]) {
    const r = await w.send(rental(i), { token });
    must(r.status === 400 && /robot check did not pass/.test(r.text) && /901-355-1518/.test(r.text), `a forged token (${token.length} chars) was not refused with a retry message (status ${r.status})`);
  }
  const after = { req: (await w.s.one('SELECT COUNT(*) AS n FROM requests')).n, mail: w.s.env.sent.length, holds: (await w.s.one('SELECT COUNT(*) AS n FROM holds')).n, inv: (await w.s.one('SELECT COUNT(*) AS n FROM invoices')).n, att: (await w.s.one('SELECT COUNT(*) AS n FROM form_attempts')).n };
  must(JSON.stringify(before) === JSON.stringify(after), `a forged token still stored, emailed, held or drafted something (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);

  // Kept, flagged, no customer email and no hold: no token, Cloudflare down / throwing / slow /
  // internal error, a replayed token, and our own secret refused.
  const replay = w.cf.issue();
  await w.send(porch(1), { token: replay });
  const cases = [
    [4, 'no token', {}, null],
    [5, 'Cloudflare 502', { token: w.cf.issue() }, 'down'],
    [6, 'network error', { token: w.cf.issue() }, 'throw'],
    [7, 'Cloudflare internal error', { token: w.cf.issue() }, 'internal'],
    [8, 'a replayed token', { token: replay }, null],
    [9, 'Cloudflare never answers', { token: w.cf.issue() }, 'hang'],
  ];
  for (const [i, what, opts, mode] of cases) {
    w.cf.mode = mode || 'up';
    const t0 = Date.now();
    const r = await w.send(rental(i), opts);
    const took = Date.now() - t0;
    w.cf.mode = 'up';
    const st = await w.state(`spam${i}@example.com`);
    must(r.status === 303 && st.row && st.row.robot_check === 'no-js' && st.heldBack, `${what}: the request was not kept and flagged for Valerie (status ${r.status})`);
    must(st.holds === 0 && st.bookings === 0, `${what}: the games were held or booked (holds ${st.holds}, bookings ${st.bookings})`);
    must(st.customerMail === 0, `${what}: a confirmation email went to the typed address`);
    must(st.ownerMail === 1 && st.drafts === 1, `${what}: Valerie's notice or the draft invoice is missing (owner ${st.ownerMail}, drafts ${st.drafts})`);
    if (mode === 'hang') must(took >= w.s.RS.TURNSTILE_TIMEOUT_MS - 200 && took < w.s.RS.TURNSTILE_TIMEOUT_MS + 3000, `${what}: the form did not give up on Cloudflare at the time limit (took ${took} ms)`);
    if (i === 4) {
      const pg = await w.received(r.location);
      must(/Valerie will text you shortly/.test(pg) && !/We sent a copy to your email/.test(pg), `${what}: the received page claims an email that was not sent`);
      must(/Your games request is in/.test(pg) && !/Your games are held/.test(pg), `${what}: the received page claims the games are held`);
    }
  }
  // Our own secret refused by Cloudflare: kept, never refused (and named in the log).
  w.s.env.TURNSTILE_SECRET = 'wrong-secret';
  const r10 = await w.send(rental(10), { token: w.cf.issue() });
  const s10 = await w.state('spam10@example.com');
  must(r10.status === 303 && s10.heldBack && s10.holds === 0 && s10.customerMail === 0, `our own secret refused: the request was refused or got the full flow (status ${r10.status})`);
  w.s.env.TURNSTILE_SECRET = SECRET;
  // The held-back reason is on the card for Valerie.
  const k4 = (await w.state('spam4@example.com')).row.request_key;
  const home = (await w.s.get('/admin/')).text;
  const cardAt = home.indexOf(`data-card="${w.s.rk(k4)}"`);
  const nextCard = home.indexOf('data-card="', cardAt + 12);
  const card = cardAt < 0 ? '' : home.slice(cardAt, nextCard < 0 ? undefined : nextCard);
  must(/data-robot-check>⚠ Sent without the robot check/.test(card), `the admin card of a held-back request does not say it was sent without the robot check (card found: ${cardAt >= 0})`);
}

// ---- 4. The limits (no keys: the form runs on the limits alone) ----------------------------
{
  const w = await world({ keys: false });
  // No keys: the full flow, nobody refused.
  const r = await w.send(rental(20));
  const st = await w.state('spam20@example.com');
  must(r.status === 303 && st.holds === 1 && st.customerMail === 1 && st.ownerMail === 1 && !st.heldBack, `with no keys set a request did not get the full flow (status ${r.status}, holds ${st.holds}, mail ${st.customerMail})`);

  // One IP: the 4th in an hour is kept without email or hold; past ipHardHour nothing is stored.
  const ip = '203.0.113.77';
  for (let i = 0; i < w.s.RS.RATE.perIpHour; i += 1) await w.send(rental(30 + i), { ip });
  const fourth = await w.send(rental(30 + w.s.RS.RATE.perIpHour), { ip });
  const f = await w.state(`spam${30 + w.s.RS.RATE.perIpHour}@example.com`);
  const third = await w.state(`spam${30 + w.s.RS.RATE.perIpHour - 1}@example.com`);
  must(third.holds === 1 && third.customerMail === 1, `request ${w.s.RS.RATE.perIpHour} from one IP lost its email or hold (it is inside the limit)`);
  must(fourth.status === 303 && await w.s.one('SELECT 1 AS y FROM request_events WHERE request_key = ?1 AND what = ?2', f.row.request_key, w.s.RS.heldBackNote('ip')) && f.holds === 0 && f.customerMail === 0 && f.ownerMail === 1, `request ${w.s.RS.RATE.perIpHour + 1} from one IP got the email or hold, or was lost (status ${fourth.status} ${(fourth.text.match(/class="rq-err[^>]*>[^<]*/g) || []).join(' | ')})`);
  for (let i = w.s.RS.RATE.perIpHour + 1; i < w.s.RS.RATE.ipHardHour; i += 1) await w.send(porch(100 + i), { ip });
  const reqBefore = (await w.s.one('SELECT COUNT(*) AS n FROM requests')).n;
  const hard = await w.send(porch(200), { ip });
  must(hard.status === 429 && /901-355-1518/.test(hard.text) && (await w.s.one('SELECT COUNT(*) AS n FROM requests')).n === reqBefore, `request ${w.s.RS.RATE.ipHardHour + 1} from one IP was stored (status ${hard.status})`);

  // One email address: the 4th in 24 hours, from new IPs and in any letter case, is held back.
  for (let i = 0; i < w.s.RS.RATE.perEmailDay; i += 1) {
    await new Promise((res) => setTimeout(res, 1100)); // the request key is site|second|email
    await w.send(porch(300 + i, { email: i % 2 ? 'Victim@Example.com' : 'victim@example.com', event_date: plus(20 + i) }));
  }
  const mailBefore = w.s.env.sent.filter((m) => /victim@example\.com/i.test(m.to)).length;
  await new Promise((res) => setTimeout(res, 1100));
  const e4 = await w.send(porch(310, { email: 'VICTIM@example.com', event_date: plus(30) }));
  const e4row = await w.s.one("SELECT request_key FROM requests WHERE email = 'VICTIM@example.com'");
  must(mailBefore === w.s.RS.RATE.perEmailDay, `the first ${w.s.RS.RATE.perEmailDay} requests for one email did not each get their confirmation (${mailBefore})`);
  must(e4.status === 303 && e4row && w.s.env.sent.filter((m) => /victim@example\.com/i.test(m.to)).length === mailBefore
    && await w.s.one('SELECT 1 AS y FROM request_events WHERE request_key = ?1 AND what = ?2', e4row.request_key, w.s.RS.heldBackNote('email')), `request ${w.s.RS.RATE.perEmailDay + 1} for one email address was refused or still emailed it`);
}

// ---- 4b. The site-wide daily cap, and a flood of held-back requests not using it up --------
{
  const w = await world({ keys: false });
  // 25 held-back requests (one IP, past its limit) never eat into real customers' confirmations.
  for (let i = 0; i < w.s.RS.RATE.perIpHour; i += 1) await w.send(porch(400 + i), { ip: '203.0.113.200' });
  for (let i = w.s.RS.RATE.perIpHour; i < 8; i += 1) await w.send(porch(400 + i), { ip: '203.0.113.200' });
  const held = (await w.s.one('SELECT COUNT(*) AS n FROM request_events WHERE substr(what, 1, length(?1)) = ?1', w.s.RS.HELD_BACK)).n;
  must(held === 8 - w.s.RS.RATE.perIpHour, `the IP flood was not held back (${held})`);
  // Real customers, each from their own IP and address: confirmations up to the cap (the 3 above
  // count), then held back.
  const room = w.s.RS.RATE.confirmationsDay - w.s.RS.RATE.perIpHour;
  for (let i = 0; i < room; i += 1) await w.send(porch(500 + i));
  const last = await w.state(`porch${500 + room - 1}@example.com`);
  must(last.customerMail === 1 && !last.heldBack, `confirmation ${w.s.RS.RATE.confirmationsDay} of the day was held back (the flood used up real customers' emails)`);
  const over = await w.send(rental(600));
  const o = await w.state('spam600@example.com');
  must(over.status === 303 && o.heldBack && o.customerMail === 0 && o.holds === 0 && o.ownerMail === 1 && /more than 20 confirmation emails/.test(JSON.stringify(await w.s.all('SELECT what FROM request_events WHERE request_key = ?1', o.row.request_key))),
    `request ${w.s.RS.RATE.confirmationsDay + 1} of the day still got the email or hold, or was lost`);
  const total = w.s.env.sent.filter((m) => /^We got your request|^Your games are held/.test(m.subject)).length;
  must(total === w.s.RS.RATE.confirmationsDay, `${total} confirmation emails went out in one day (cap ${w.s.RS.RATE.confirmationsDay})`);
}

// ---- 4c. Valerie's own notices are capped too --------------------------------------------
{
  const w = await world({ keys: false });
  // Pretend ownerNoticesDay notices already went in the last day.
  for (let i = 0; i < w.s.RS.RATE.ownerNoticesDay; i += 1) {
    await w.s.db.prepare(`INSERT INTO requests (request_key, source, submitted_at, services, name, email, phone, answers, owner_emailed_at) VALUES (?1, 'site', datetime('now'), '["porch"]', 'Old One', ?2, '9015550000', '[]', datetime('now'))`).bind(`site|old|${i}`, `old${i}@example.com`).run();
  }
  const ownerBefore = w.s.env.sent.filter((m) => /^New request: /.test(m.subject)).length;
  const r = await w.send(porch(700));
  const ownerAfter = w.s.env.sent.filter((m) => /^New request: /.test(m.subject)).length;
  const key = (await w.state('porch700@example.com')).row.request_key;
  must(r.status === 303 && ownerAfter === ownerBefore && await w.s.one("SELECT 1 AS y FROM request_events WHERE request_key = ?1 AND what LIKE 'New-request email to Valerie not sent%'", key),
    `past ${w.s.RS.RATE.ownerNoticesDay} owner notices in a day another one went out, or the request was lost`);
}

// ---- 6. The name in the confirmation email ------------------------------------------------
{
  const w = await world({ keys: false });
  const bad = ['www.evil-prize.com', 'http://evil.example/x', '<a href="https://evil.example">Claim</a>', 'Click→evil.example', 'Bob1', `${'A'.repeat(31)}`];
  for (const [i, name] of bad.entries()) {
    await w.send(porch(800 + i, { name: `${name} Smith` }));
    const m = w.s.env.sent.find((x) => x.to === `porch${800 + i}@example.com`);
    const all = m ? `${m.subject} ${m.text} ${m.html}` : '';
    must(m && /Hi there,/.test(m.text) && !/evil|Claim|Bob1|AAAAAAAAAA/.test(all), `the name "${name}" reached the confirmation email: ${m ? m.text.slice(0, 80) : 'no email'}`);
  }
  for (const name of ['Mary-Jo', 'José', "O'Brien"]) must(M.first(`${name} Lee`) === name, `the real first name ${name} is not kept`);
}

if (checks < 50) fails.push(`only ${checks} checks ran (expected at least 50): the validator did less than it should`);
if (fails.length) { for (const f of fails) console.error(`VALIDATION FAIL: ${f}`); process.exit(1); }
console.log(`validate_request_spam: OK (${checks} checks: forged token refused with nothing stored; no token, Cloudflare down/slow/erroring, replayed token and our own bad secret kept for Valerie with no email or hold; verified rental gets both emails, draft, hold, bookings; IP, email, site and owner-notice limits; plain-letters name)`);
