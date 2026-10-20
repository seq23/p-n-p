// The "NEW" badge on Requests (owner, 19 Oct 2026). A request wears NEW until Valerie opens it or
// acts on it. Opened = a request_opened row (migration 0016: the badge tapped, Show details, Edit,
// any button or link on the card, or the New-request email's link); acted on = status past New, or
// put away. A phone-call request is never NEW: Valerie typed it in herself.
// What does NOT clear it (19 Oct 2026 repair): the draft invoice the website makes for every rental
// at submit (request-submit.mjs createDraftInvoice keeps status 'new'), and any history line written
// by the system (the form, the mailer, a hold placed or expired, an auto-booked takedown). Real
// actions are clicks on the card, and every click there writes request_opened, so history is not read.
export function isNewRequest(r, { st = null, opened = false } = {}) {
  if (!r || opened) return false;
  if (r.source === 'phone') return false;
  if (st && ((st.status && st.status !== 'new') || st.archived_at)) return false;
  return true;
}

export async function openedSet(db) {
  try {
    const { results } = await db.prepare('SELECT request_key FROM request_opened').all();
    return new Set((results || []).map((r) => r.request_key));
  } catch { return new Set(); }
}

export async function markOpened(db, key, how = '') {
  if (!key) return false;
  try {
    const r = await db.prepare('INSERT OR IGNORE INTO request_opened (request_key, how) VALUES (?1, ?2)').bind(key, String(how).slice(0, 40)).run();
    return Boolean(r && r.meta && r.meta.changes);
  } catch { return false; }
}
