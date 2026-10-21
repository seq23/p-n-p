-- Three endings for a request card (owner-approved mock-up "Done Cards", 20 Oct 2026;
-- functions/_lib/admin-endings.mjs, docs/admin-console.md "Three ways a job ends").
--   request_status.done_at       "✓ Mark as done" on a Finished card. The card moves to the Done
--                                group under the active cards. "Not done after all (undo)" clears it.
--   request_status.cancelled_at  when the request was cancelled (voided), for the
--                                "✕ CANCELLED · <date>" label. Cleared by "Not cancelled after all".
--                                Requests voided before this migration read their updated_at.
-- Additive only: no existing row is changed. Put away (archived_at) is unchanged.
ALTER TABLE request_status ADD COLUMN done_at TEXT;
ALTER TABLE request_status ADD COLUMN cancelled_at TEXT;
