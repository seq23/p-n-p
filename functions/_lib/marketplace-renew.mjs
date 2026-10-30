// Marketplace renewal reminder (owner, 18 Oct 2026): an email to the owner each time the
// Facebook Marketplace listings are due for "Renew listing" (every 7 days from when they went
// up on 16 Oct 2026; never delete and re-add). Sent by the pnp-mailer hourly cron at 4 PM
// Memphis on a due day, claimed per due date in `settings` so it never sends twice.
import { chicagoDate, chicagoHour } from './reminders.mjs';

export const RENEW_TO = 'seq.taylor@gmail.com';
export const RENEW_ANCHOR = '2026-10-16'; // the 8 listings went up
export const RENEW_EVERY_DAYS = 7;
export const RENEW_HOUR = 16; // 4 PM Memphis: Simone renews at 1:40 PM first; this is the backup (30 Oct 2026)
export const LISTINGS = [
  'RENTAL ONLY: Pick 3', 'RENTAL ONLY: Pick 5', 'RENTAL ONLY: Whole Yard', 'RENTAL ONLY: Movie Night',
  'RENTAL ONLY: Game Night', 'RENTAL ONLY: The Whole Party', 'Room Decor Setup (home or hotel)', 'Porch Decor, Fall & Winter',
];
const SELLING = 'https://www.facebook.com/marketplace/you/selling';

const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);

// True on 23 Oct 2026 and every 7 days after.
export function isRenewDay(iso) {
  const n = dayNum(iso) - dayNum(RENEW_ANCHOR);
  return n > 0 && n % RENEW_EVERY_DAYS === 0;
}

export function renderRenew(today) {
  const subject = `Porch & Party: renew the Marketplace listings today (${today})`;
  const steps = [
    `Open Your listings: ${SELLING} (on your personal profile).`,
    'On each listing tap the three dots (…), then "Renew listing". If Renew is not offered yet, try again tomorrow.',
    'Do not delete and re-add: renewing gives the same fresh bump and keeps buyer messages.',
  ];
  const text = [`Time to renew the ${LISTINGS.length} Porch & Party Marketplace listings.`, '', ...steps.map((s, i) => `${i + 1}. ${s}`), '', 'The listings:', ...LISTINGS.map((l) => `- ${l}`)].join('\n');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<p>Time to renew the ${LISTINGS.length} Porch &amp; Party Marketplace listings.</p><ol>${steps.map((s) => `<li>${esc(s).replace(SELLING, `<a href="${SELLING}">${SELLING}</a>`)}</li>`).join('')}</ol><p>The listings:</p><ul>${LISTINGS.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
  return { subject, text, html };
}

export async function sendMarketplaceRenew(env, { now = new Date(), send }) {
  const today = chicagoDate(now);
  if (chicagoHour(now) !== RENEW_HOUR || !isRenewDay(today)) return { ok: true, skipped: 'not a renewal morning' };
  const claim = await env.DB.prepare(`INSERT INTO settings (key, value) VALUES ('marketplace_renew_sent', ?1)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE settings.value <> excluded.value`).bind(today).run();
  if (!(claim && claim.meta && claim.meta.changes)) return { ok: true, skipped: `already sent for ${today}` };
  try {
    const ok = await send({ to: RENEW_TO, ...renderRenew(today) });
    if (!ok) throw new Error('the mailer did not accept it');
    return { ok: true, to: RENEW_TO, today };
  } catch (e) {
    await env.DB.prepare("DELETE FROM settings WHERE key = 'marketplace_renew_sent' AND value = ?1").bind(today).run();
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}
