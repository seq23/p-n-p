-- The "NEW" badge on Requests (owner, 19 Oct 2026; functions/_lib/request-new.mjs). A request is
-- NEW until Valerie opens it or acts on it. "Opened" is recorded here (tapping the badge, Show
-- details, Edit, any button on the card, or arriving from the New-request email link); "acted on"
-- is derived (status past New, an invoice, put away, or any history line not from the website form).
-- Additive: a new table; no existing row changes. Every request already in D1 counts as opened
-- (backfill below) so only requests that arrive after this ships wear the badge.
CREATE TABLE IF NOT EXISTS request_opened (
  request_key TEXT PRIMARY KEY,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  how TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO request_opened (request_key, how) SELECT request_key, 'before the NEW badge' FROM requests;
