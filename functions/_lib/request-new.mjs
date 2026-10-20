// The "NEW" badge on Requests (owner, 19 Oct 2026). A request wears NEW until Valerie opens it or
// acts on it: opened = a request_opened row (migration 0016: the badge tapped, Show details, Edit,
// any button on the card, or the New-request email's link); acted on = derived from what is
// already stored (status past New, an invoice, put away, any history line Valerie made). A
// phone-call request is never NEW: Valerie typed it in herself.
export const FORM_WHO = ['website form', ''];

export function isNewRequest(r, { st = null, opened = false, events = [] } = {}) {
  if (!r || opened) return false;
  if (r.source === 'phone') return false;
  if (st && ((st.status && st.status !== 'new') || st.invoice_id || st.archived_at)) return false;
  if (events.some((e) => !FORM_WHO.includes(String(e.who || '')))) return false;
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
