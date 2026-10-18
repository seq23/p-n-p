-- The takedown gates Finished (owner, 18 Oct 2026; functions/_lib/takedown.mjs).
--   requests.takedown_date  the day the customer (old Google Form "Takedown date") or the owner
--                           named for the takedown. It PREFILLS "Schedule takedown"; it never
--                           creates a booking by itself.
--   bookings.done_at        "Mark takedown done" on a takedown booking (from its day). A request
--                           that asked for a takedown is Finished only once this is set, or once
--                           takedown_plan = 'customer_handles'.
-- Additive only. Existing rows are mapped by scripts/admin/backfill_takedown.mjs (idempotent).
ALTER TABLE requests ADD COLUMN takedown_date TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN done_at TEXT;
