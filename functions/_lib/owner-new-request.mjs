// "New request" email to Valerie (owner, 19 Oct 2026). When a request arrives through the
// website form (request-submit.mjs), Valerie gets one email at her day-list address (Settings ->
// "My email for my day list", settings.day_list_email, hello@ when unset) with EVERY answer from
// the form, labelled in plain words, and a big button that opens the card in /admin. The ID photo
// is never attached: the email only says it was uploaded. Phone-call requests never send it.
//
// Once per request: requests.owner_emailed_at (migration 0014) is claimed BEFORE sending, and a
// failed send releases the claim and logs the failure. Nothing here can block the submission.
import { esc, getSettings, FROM_EMAIL, b64urlText } from './util.mjs';
import { wrapEmail } from './messages.mjs';

export const SERVICE_NAMES = { porch: 'Porch decorating', party: 'Party planning & decor', grazing: 'Grazing tables', rentals: 'Party game rentals' };
export const SENT_EVENT = 'New-request email sent to Valerie';
const SITE = 'https://porchandparty901.com';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// "Sat 25 Oct 2026" for an ISO date; anything else unchanged.
export function plainDate(v) {
  if (!ISO.test(String(v || ''))) return String(v || '');
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()} ${d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
}

// "Casey P." from "Casey Path Jones".
export function firstAndInitial(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'No name';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

const answersOf = (row) => { try { return JSON.parse(row.answers || '[]'); } catch { return []; } };
const servicesOf = (row) => { try { return JSON.parse(row.services || '[]'); } catch { return []; } };

// The date in the subject: the event date for decor work, the pickup date for rentals.
function headlineDate(answers) {
  const a = answers.find((x) => /^event date$/i.test(x.label)) || answers.find((x) => /pickup date|date is your event/i.test(x.label));
  return a ? plainDate(a.value) : 'no date given';
}

const GROUP_TITLES = { decor: 'About the event', rentals: 'Game rentals', other: 'Anything else' };

// The email itself, from the stored requests row. Every value is escaped.
export function newRequestEmail(row, { site = SITE } = {}) {
  const answers = answersOf(row);
  const services = servicesOf(row);
  const words = services.map((s) => SERVICE_NAMES[s] || s).join(' + ') || 'a request';
  const subject = `New request: ${firstAndInitial(row.name)} · ${words} · ${headlineDate(answers)}`;
  const href = `${site}/admin/#c-${b64urlText(row.request_key)}`;
  const contact = [
    ['Name', row.name], ['Mobile', row.phone], ['Email', row.email], ['Date of birth', plainDate(row.dob)],
    ['Social media link', row.social], ['How they heard about us', row.heard], ['What they want', words],
  ];
  const sections = [['Who it is', contact.filter(([, v]) => String(v || '').trim())]];
  for (const g of ['decor', 'rentals', 'other']) {
    const rows = answers.filter((a) => (a.group || 'other') === g && String(a.value || '').trim()).map((a) => [a.label, plainDate(a.value)]);
    if (rows.length) sections.push([GROUP_TITLES[g], rows]);
  }
  const loose = answers.filter((a) => !['decor', 'rentals', 'other'].includes(a.group || 'other') && String(a.value || '').trim()).map((a) => [a.label, plainDate(a.value)]);
  if (loose.length) sections.push(['More answers', loose]);
  const idLine = row.id_object ? 'ID photo uploaded (open the card to see it; it is not attached here).' : 'No ID photo on file.';
  const agreed = row.agreed_at ? `Agreed to the Rules & Responsibilities${row.rules_version ? ` (version ${row.rules_version})` : ''} as "${row.agreed_name || row.name}".` : '';
  const S = "Inter, 'Helvetica Neue', Arial, sans-serif";
  const table = sections.map(([title, rows]) => `<h3 style="margin:18px 0 6px;font-family:${S};font-size:17px;color:#3b302a;">${esc(title)}</h3>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;vertical-align:top;width:42%;font-family:${S};font-size:15px;color:#5f5148;border-bottom:1px solid #e8dfd4;">${esc(k)}</td><td style="padding:6px 0;vertical-align:top;font-family:${S};font-size:15px;color:#3b302a;border-bottom:1px solid #e8dfd4;">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`).join('');
  const button = `<p style="margin:22px 0 8px;"><a href="${esc(href)}" style="display:inline-block;padding:16px 26px;border-radius:10px;background:#b85f40;color:#fff;text-decoration:none;font-family:${S};font-size:19px;font-weight:600;" data-open-card>Open this request</a></p>`;
  const extra = `${button}${table}<p style="margin:16px 0 0;font-family:${S};font-size:15px;color:#3b302a;" data-id-line>${esc(idLine)}</p>${agreed ? `<p style="margin:6px 0 0;font-family:${S};font-size:14px;color:#5f5148;">${esc(agreed)}</p>` : ''}`;
  const html = wrapEmail({ title: subject, paragraphs: [`A new request just came in from the website: ${firstAndInitial(row.name)}, ${words}. Every answer is below.`], extraHtml: extra });
  const text = [
    `A new request just came in from the website. Open it: ${href}`,
    ...sections.map(([title, rows]) => `${title}\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}`),
    idLine, agreed,
  ].filter(Boolean).join('\n\n');
  return { subject, html, text, href };
}

// Send it once for a website request. Returns { sent|skipped|failed }. Never throws.
export async function sendNewRequestEmail(env, key, { log } = {}) {
  try {
    const row = await env.DB.prepare('SELECT * FROM requests WHERE request_key = ?1').bind(key).first();
    if (!row) return { skipped: 'no such request' };
    if (row.source !== 'site') return { skipped: `not a website request (${row.source})` };
    if (row.owner_emailed_at) return { skipped: 'already sent' };
    if (!env.MAILER) { if (log) await log(`New-request email to Valerie did not go out (email is not connected on this copy of the site)`); return { failed: 'no mailer' }; }
    const claim = await env.DB.prepare("UPDATE requests SET owner_emailed_at = datetime('now') WHERE request_key = ?1 AND owner_emailed_at IS NULL").bind(key).run();
    if (claim && claim.meta && claim.meta.changes === 0) return { skipped: 'already sent' };
    const settings = await getSettings(env.DB);
    const to = settings.day_list_email || FROM_EMAIL;
    const mail = newRequestEmail(row, { site: env.SITE_ORIGIN || SITE });
    let ok = false; let err = '';
    try {
      const res = await env.MAILER.fetch('https://pnp-mailer.internal/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, replyTo: row.email || FROM_EMAIL, subject: mail.subject, html: mail.html, text: mail.text }) });
      const out = await res.json().catch(() => ({}));
      ok = res.ok && out.ok; err = out.error || String(res.status);
    } catch (e) { err = String(e && e.message ? e.message : e); }
    if (!ok) {
      await env.DB.prepare('UPDATE requests SET owner_emailed_at = NULL WHERE request_key = ?1').bind(key).run();
      if (log) await log(`New-request email to Valerie did not go out (${err})`);
      return { failed: err };
    }
    if (log) await log(SENT_EVENT);
    return { sent: to };
  } catch (e) { return { failed: String(e && e.message ? e.message : e) }; }
}
