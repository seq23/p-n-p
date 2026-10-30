#!/usr/bin/env node
/**
 * The owner's Marketplace renewal reminder (owner, 18 Oct 2026): one email to seq.taylor@gmail.com
 * at 4 PM Memphis on 23 Oct 2026 and every 7 days after, never twice for a day, never on other
 * days or hours, retried the next hour if the send fails, wired into the pnp-mailer cron.
 */
import fs from 'node:fs';
import * as R from '../../functions/_lib/marketplace-renew.mjs';

const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };

// A settings table, enough for the claim.
function fakeDb() {
  const rows = new Map();
  return { rows, prepare: (sql) => ({ bind: (v) => ({ run: async () => {
    if (/^INSERT/.test(sql)) { if (rows.get('marketplace_renew_sent') === v) return { meta: { changes: 0 } }; rows.set('marketplace_renew_sent', v); return { meta: { changes: 1 } }; }
    if (/^DELETE/.test(sql) && rows.get('marketplace_renew_sent') === v) rows.delete('marketplace_renew_sent');
    return { meta: { changes: 1 } };
  } }) }) };
}

const due = ['2026-10-23', '2026-10-30', '2026-11-06', '2026-12-25'];
const notDue = ['2026-10-16', '2026-10-18', '2026-10-22', '2026-10-24', '2026-10-29'];
for (const d of due) must(R.isRenewDay(d), `${d} should be a renewal day`);
for (const d of notDue) must(!R.isRenewDay(d), `${d} should not be a renewal day`);

const sent = [];
const env = { DB: fakeDb() };
const send = async (m) => { sent.push(m); return true; };
// 4 PM CDT = 21:00 UTC on 23 Oct.
let r = await R.sendMarketplaceRenew(env, { now: new Date('2026-10-23T21:00:00Z'), send });
must(r.ok && sent.length === 1 && sent[0]?.to === 'seq.taylor@gmail.com', `4 PM on 23 Oct did not email the owner (${JSON.stringify(r)})`);
must(sent[0] && /Renew listing/.test(sent[0].text) && /marketplace\/you\/selling/.test(sent[0].html) && R.LISTINGS.every((l) => sent[0].text.includes(l)), 'the email lacks the steps, the link or a listing');
must(sent[0] && /Do not delete/.test(sent[0].text), 'the email does not say renew, never delete and re-add');
r = await R.sendMarketplaceRenew(env, { now: new Date('2026-10-23T21:30:00Z'), send });
must(sent.length === 1, 'a second run on the same morning sent it twice');
r = await R.sendMarketplaceRenew(env, { now: new Date('2026-10-23T22:00:00Z'), send });
must(sent.length === 1, 'it sent at 10 AM');
r = await R.sendMarketplaceRenew(env, { now: new Date('2026-10-24T21:00:00Z'), send });
must(sent.length === 1, 'it sent on a day that is not due');
// 4 PM CST = 22:00 UTC on 6 Nov.
r = await R.sendMarketplaceRenew(env, { now: new Date('2026-11-06T22:00:00Z'), send });
must(sent.length === 2, 'it did not send at 4 PM Memphis in standard time (6 Nov)');
// A failed send releases the claim so the next hour can retry.
const env2 = { DB: fakeDb() };
r = await R.sendMarketplaceRenew(env2, { now: new Date('2026-10-30T21:00:00Z'), send: async () => false });
must(!r.ok && !env2.DB.rows.has('marketplace_renew_sent'), 'a failed send kept the claim, so it would never retry');

const worker = fs.readFileSync('workers/pnp-mailer/src/index.js', 'utf8');
must(/import \{ sendMarketplaceRenew \} from '..\/..\/..\/functions\/_lib\/marketplace-renew.mjs'/.test(worker) && /sendMarketplaceRenew\(env/.test(worker.split('export async function runReminders')[1] || ''), 'the mailer cron does not call sendMarketplaceRenew');

if (checks < 15) errors.push(`only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: marketplace renew (${errors.length} of ${checks})`); for (const e of errors) console.error(`- ${e}`); process.exit(1); }
console.log(`validate_marketplace_renew: OK (${checks} checks: 23 Oct + every 7 days, 4 PM Memphis CDT/CST, once per day, retry after a failed send, steps + link + all listings, wired into the mailer cron)`);
