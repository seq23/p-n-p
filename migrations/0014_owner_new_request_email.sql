-- Valerie's "New request" email (owner, 19 Oct 2026; functions/_lib/owner-new-request.mjs).
--   requests.owner_emailed_at  when the one email with every form answer went to her day-list
--                              address. Claimed before sending, so a request never emails twice;
--                              a failed send clears it again. NULL for every existing row.
-- Additive: one nullable column, no row changed.
ALTER TABLE requests ADD COLUMN owner_emailed_at TEXT;
